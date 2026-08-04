<script setup lang="ts">
// 编排配置 Tab（0801 方案 §6.2/§6.4/§7.2）：规则处理节点专属，替换原「表配置」。
// 路径 A（新增业务规则→保存元数据拿 ruleId）+ 路径 B（描述/生成/全屏/测试/保存脚本）。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { makeDefaultRuleOrchestration, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { ruleApi, type RuleFieldOption, type RuleOrchestration, type RuleTableOption } from '@/api'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import RuleTableFieldBinder from '../RuleTableFieldBinder.vue'
import RuleScriptDialog from '../RuleScriptDialog.vue'
import RuleSystemPromptDialog from '../RuleSystemPromptDialog.vue'
import RuleTestDialog from '../RuleTestDialog.vue'

const flow = useFlowStore()
const { ruleOrchestrations } = useNodeInspectorAssets()

const id = computed<string>(() => flow.selectedId)
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const ruleCfg = computed<RuleOrchestration>(() => ({ ...makeDefaultRuleOrchestration(), ...cfg.value?.ruleCfg }))

function patch(p: Partial<RuleOrchestration>) {
  flow.patchRuleConfig(id.value, p)
}

// 表字段（0803 改造）：表来源已换成 vrule 跨租户搜索（RuleTableFieldBinder 内部自搜），采集中心的
// entryDetail 根本不认识这些表，字段改走 ruleApi.orchestrationTableFields（news-getTableFields）。
// 选中输入/输出表时按需拉一次并缓存，key 带上 dataSource 避免跨数据源撞 tableId。
const tableFields = ref<Map<string, RuleFieldOption[]>>(new Map())
async function ensureTableFields(tableId: string | undefined, dataSource: string | undefined) {
  if (!tableId || !dataSource) return
  const key = `${dataSource}:${tableId}`
  if (tableFields.value.has(key)) return
  try {
    const fields = await ruleApi.orchestrationTableFields(tableId, dataSource)
    tableFields.value.set(key, fields)
  } catch (e) {
    ElMessage.error(`加载表字段失败：${(e as Error)?.message ?? String(e)}`)
  }
}
watch(
  () => [ruleCfg.value.inputTableId, ruleCfg.value.outputTableId, ruleCfg.value.dataSource] as const,
  ([inputTableId, outputTableId, dataSource]) => {
    ensureTableFields(inputTableId, dataSource)
    ensureTableFields(outputTableId, dataSource)
  },
  { immediate: true },
)

// 有 ruleId 时默认只读摘要，需显式「修改表字段」才回到可编辑态（0801 方案 §6.2，默认不鼓励改表字段）
const editingMeta = ref(false)
const showBinder = computed(() => !ruleCfg.value.ruleId || editingMeta.value)

function validateMeta(): string | undefined {
  if (!ruleCfg.value.dataSource) return '请选择数据源'
  if (!ruleCfg.value.name?.trim()) return '请填写规则名称'
  if (!ruleCfg.value.inputTableId) return '请选择输入表'
  if (!ruleCfg.value.inputFields?.length) return '请至少选择 1 个入参字段'
  if (!ruleCfg.value.outputFields?.length) return '请至少选择 1 个出参字段'
  return undefined
}

const saving = ref(false)
async function onSaveMeta() {
  const error = validateMeta()
  if (error) {
    ElMessage.warning(error)
    return
  }
  saving.value = true
  try {
    // userCode：优先用选中输入表所属的租户（0803 追加，见 RuleOrchestration.userCode 注释），
    // 保证规则归属的租户和它引用的表所属租户一致；没有表来源时才回退登录账号/'admin'
    const res = await ruleApi.orchestrationSaveMeta(ruleCfg.value, ruleCfg.value.userCode)
    patch({ mode: 'ref', ruleId: res.ruleId })
    // 表相关字段同步到 NodeConfig（0801 方案 §4.6）：节点侧存 tableId，不是物理表名
    if (ruleCfg.value.inputTableId) flow.setInputTable(id.value, ruleCfg.value.inputTableId)
    if (ruleCfg.value.outputTableId) flow.setOutputTable(id.value, ruleCfg.value.outputTableId)
    editingMeta.value = false
    // 新拿到的 ruleId 允许进入 Path B 时再回灌一次（详情/脚本）
    hydrateToken.value = ''
    ElMessage.success(res.message || '业务规则已保存')
  } catch (e) {
    ElMessage.error(`保存业务规则失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}
function onEditMeta() {
  editingMeta.value = true
}
function onCancelEditMeta() {
  editingMeta.value = false
}

// 引用已有规则（0803 会议）：规则名称 combobox 选中已有项后触发。拉详情 + 缺脚本时读脚本正文，
// 若引用规则原关联的输入表和当前节点已选表冲突则先确认覆盖（拍板：提示冲突，用户确认）。
const selectingExisting = ref(false)
async function onSelectExisting(ruleId: string) {
  if (selectingExisting.value) return
  selectingExisting.value = true
  try {
    const detail = await ruleApi.orchestrationDetail(ruleId)
    // 详情只返回物理表名（targetTable），需要反查 vrule 那边的 tableId 才能和 NodeConfig 打通（§4.6）。
    // 0803 改造：表来源已换成跨租户搜索，用规则自己的物理表名当关键词去搜（news-getTableList 的 name
    // 参数已实测对物理表名做模糊匹配），优先取和该规则自身 userCode 同租户的那条，避免撞到别的租户下同名表。
    let matchedTable: RuleTableOption | undefined
    if (detail.dataSource && detail.inputTable) {
      try {
        const candidates = await ruleApi.orchestrationTableSearch(detail.dataSource, detail.inputTable)
        const exact = candidates.filter((t) => t.dbTableName === detail.inputTable)
        matchedTable = exact.find((t) => t.ownerUserCode === detail.userCode) ?? exact[0]
      } catch (e) {
        ElMessage.warning(`反查表 ID 失败：${(e as Error)?.message ?? String(e)}`)
      }
    }
    const nextInputTableId = matchedTable?.tableId ?? ''
    const currentInputTableId = ruleCfg.value.inputTableId
    const hasConflict = !!currentInputTableId && !!nextInputTableId && currentInputTableId !== nextInputTableId
    if (hasConflict) {
      try {
        await ElMessageBox.confirm(
          `该规则原关联的输入表为「${detail.inputTable}」，与当前节点已选表不一致。是否用该规则的表 / 字段配置覆盖当前节点？`,
          '表配置冲突',
          { type: 'warning', confirmButtonText: '确认覆盖', cancelButtonText: '取消引用' },
        )
      } catch {
        return // 用户取消引用，保持当前草稿不变
      }
    }
    if (!matchedTable && detail.inputTable) {
      // 反查表失败（search 抛错）或搜到空结果，两种情况 matchedTable 都是 undefined——
      // 不管哪种，输入表都没法确定，不能让规则带着空 inputTableId 落进 store 却弹"已引用"成功，
      // 所以这里直接 return，保持当前草稿不变，让用户看着提示手动重新选择输入表。
      ElMessage.warning(`该规则原关联表「${detail.inputTable}」在 vrule 表清单里搜不到，请手动重新选择输入表`)
      return
    }
    let script = detail.script ?? ''
    if (!script.trim() && detail.scriptPath?.trim()) {
      try {
        script = await ruleApi.orchestrationLoadScript(detail.scriptPath)
      } catch {
        // 脚本读取失败不阻塞引用；进入查看态后 hydrateViewFromServer 仍会再试一次
      }
    }
    // REVIEW-2026-08-04 P1：显式列出要采纳的字段，不用 `...detail` 展开——避免 detail 以后
    // 加了新字段、且这个字段本不该被新规则采纳时，被悄悄带进来。
    patch({
      mode: detail.mode,
      ruleId: detail.ruleId,
      name: detail.name,
      describe: detail.describe,
      systemPrompt: detail.systemPrompt,
      scriptPath: detail.scriptPath,
      enabled: detail.enabled,
      dataSource: detail.dataSource,
      inputTable: detail.inputTable,
      inputFields: detail.inputFields,
      outputFields: detail.outputFields,
      script,
      inputTableId: nextInputTableId,
      outputTable: '',
      outputTableId: '',
      userCode: matchedTable?.ownerUserCode ?? detail.userCode,
    })
    if (nextInputTableId) flow.setInputTable(id.value, nextInputTableId)
    editingMeta.value = false
    hydrateToken.value = ''
    ElMessage.success(`已引用规则「${detail.name}」`)
  } catch (e) {
    ElMessage.error(`加载规则详情失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    selectingExisting.value = false
  }
}

function fieldsOf(tableId: string | undefined): RuleFieldOption[] {
  if (!tableId || !ruleCfg.value.dataSource) return []
  return tableFields.value.get(`${ruleCfg.value.dataSource}:${tableId}`) ?? []
}
const inputFieldOptions = computed(() => fieldsOf(ruleCfg.value.inputTableId))
const outputFieldOptions = computed(() =>
  ruleCfg.value.outputTableId ? fieldsOf(ruleCfg.value.outputTableId) : inputFieldOptions.value,
)
function labelOf(options: RuleFieldOption[], code: string) {
  return options.find((f) => f.itemCode === code)?.itemName ?? code
}
const inputFieldsLabel = computed(() => (ruleCfg.value.inputFields ?? []).map((c) => labelOf(inputFieldOptions.value, c)).join('、') || '—')
const outputFieldsLabel = computed(() => (ruleCfg.value.outputFields ?? []).map((c) => labelOf(outputFieldOptions.value, c)).join('、') || '—')
const outputTableLabel = computed(() => (ruleCfg.value.outputTableId ? ruleCfg.value.outputTable : '默认 = 输入表'))

// ---- 路径 B：描述 / 生成脚本 / 全屏查看 / 编辑系统提示词 / 保存脚本（0801 方案 §6.4）----
// 进入查看态时按 ruleId 回灌详情 + 缺正文时按 scriptPath 拉 MinIO（对齐旧 handleOpenRecord）
const hydrateToken = ref('')
const hydrating = ref(false)
async function hydrateViewFromServer() {
  const ruleId = ruleCfg.value.ruleId
  if (!ruleId || showBinder.value) return
  const token = `${id.value}:${ruleId}`
  if (hydrateToken.value === token || hydrating.value) return
  hydrating.value = true
  hydrateToken.value = token
  try {
    const stored = cfg.value?.ruleCfg
    try {
      const detail = await ruleApi.orchestrationDetail(ruleId)
      const next: Partial<RuleOrchestration> = {}
      // 服务端有值才覆盖，避免 saveMeta 后详情尚无 nlDescribe 时用空串抹掉本地草稿
      if (detail.describe?.trim()) next.describe = detail.describe
      if (detail.systemPrompt?.trim()) next.systemPrompt = detail.systemPrompt
      if (detail.scriptPath?.trim()) next.scriptPath = detail.scriptPath
      if (detail.name?.trim() && !stored?.name?.trim()) next.name = detail.name
      if (Object.keys(next).length) patch(next)
    } catch {
      // 详情失败不阻塞；下面仍可凭本地 scriptPath 拉脚本
    }
    const path = (cfg.value?.ruleCfg?.scriptPath || ruleCfg.value.scriptPath || '').trim()
    if (path && !cfg.value?.ruleCfg?.script?.trim()) {
      try {
        const script = await ruleApi.orchestrationLoadScript(path)
        if (script.trim()) patch({ script })
      } catch (e) {
        ElMessage.warning(`加载脚本失败：${(e as Error)?.message ?? String(e)}`)
      }
    }
  } finally {
    hydrating.value = false
  }
}
watch(
  () => [id.value, ruleCfg.value.ruleId, showBinder.value] as const,
  () => { void hydrateViewFromServer() },
  { immediate: true },
)

function onDescribeChange(e: Event) {
  patch({ describe: (e.target as HTMLTextAreaElement).value })
}
function onSystemPromptChange(value: string) {
  patch({ systemPrompt: value })
}

const generating = ref(false)
const generateAbort = ref<AbortController | null>(null)
function onCancelGenerate() {
  generateAbort.value?.abort()
}
async function onGenerateScript() {
  if (!ruleCfg.value.describe.trim()) {
    ElMessage.warning('请先填写规则处理描述')
    return
  }
  if (!ruleCfg.value.inputFields?.length || !ruleCfg.value.outputFields?.length) {
    ElMessage.warning('请先完成入参/出参字段绑定')
    return
  }
  generateAbort.value?.abort()
  const controller = new AbortController()
  generateAbort.value = controller
  generating.value = true
  try {
    const res = await ruleApi.orchestrationGenerate(ruleCfg.value, controller.signal)
    patch({ script: res.script, scriptPath: res.scriptPath })
    ElMessage.success('脚本已生成')
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.message?.includes('已取消')) {
      ElMessage.info('已取消生成')
    } else {
      ElMessage.error(`生成脚本失败：${(e as Error)?.message ?? String(e)}`)
    }
  } finally {
    if (generateAbort.value === controller) generateAbort.value = null
    generating.value = false
  }
}

const scriptDialogOpen = ref(false)
const systemPromptDialogOpen = ref(false)

const savingScript = ref(false)
async function onSaveScript() {
  if (!ruleCfg.value.script?.trim()) {
    ElMessage.warning('请先生成脚本')
    return
  }
  try {
    await ElMessageBox.confirm('保存后将把当前脚本绑定到该规则处理节点，是否继续？', '保存规则脚本', {
      type: 'warning',
      confirmButtonText: '确认保存',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  savingScript.value = true
  try {
    const res = await ruleApi.orchestrationSave(ruleCfg.value)
    patch({ mode: 'ref', ruleId: res.ruleId, scriptPath: res.scriptPath })
    ElMessage.success(res.message || '规则脚本已保存')
  } catch (e) {
    ElMessage.error(`保存脚本失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    savingScript.value = false
  }
}

// ---- 全屏测试台（L3，拍板 #12，见 §6.5）：测试脚本条件为 script + inputTable ----
const testDialogOpen = ref(false)
const canTest = computed(() => !!ruleCfg.value.script?.trim() && !!ruleCfg.value.inputTable)
</script>

<template>
  <div class="ni-section-title">规则编排</div>

  <template v-if="showBinder">
    <RuleTableFieldBinder
      :model-value="ruleCfg"
      :rule-options="ruleOrchestrations"
      :input-field-options="inputFieldOptions"
      :output-field-options="outputFieldOptions"
      @update:model-value="patch"
      @select-existing="onSelectExisting"
    />
    <div v-if="selectingExisting" class="rc-help">正在加载已引用规则的详情…</div>
    <div class="rc-actions-row">
      <button class="rc-btn primary" type="button" :disabled="saving" @click="onSaveMeta">
        {{ saving ? '保存中...' : '保存业务规则' }}
      </button>
      <button v-if="ruleCfg.ruleId" class="rc-btn" type="button" :disabled="saving" @click="onCancelEditMeta">取消</button>
    </div>
  </template>

  <template v-else>
    <div class="rc-list ni-rule-meta">
      <div class="rc-list-row"><b>规则 ID</b><span>{{ ruleCfg.ruleId }}</span></div>
      <div class="rc-list-row"><b>规则名称</b><span>{{ ruleCfg.name }}</span></div>
      <div class="rc-list-row"><b>输入表</b><span>{{ ruleCfg.inputTable }}</span></div>
      <div class="rc-list-row"><b>输出表</b><span>{{ outputTableLabel }}</span></div>
      <div class="rc-list-row"><b>入参字段</b><span>{{ inputFieldsLabel }}</span></div>
      <div class="rc-list-row"><b>出参字段</b><span>{{ outputFieldsLabel }}</span></div>
    </div>
    <div class="rc-actions-row"><button class="rc-btn" type="button" @click="onEditMeta">修改表字段</button></div>

    <div class="ni-section-title">查看业务编排</div>
    <div class="rc-field"><label>规则处理描述</label>
      <textarea
        class="rc-input rc-textarea"
        :value="ruleCfg.describe"
        placeholder="描述规则处理逻辑，如根据输入字段生成指标数值"
        @input="onDescribeChange"
      />
    </div>
    <div class="rc-actions-row">
      <button class="rc-btn" type="button" @click="systemPromptDialogOpen = true">编辑系统提示词</button>
      <button class="rc-btn primary" type="button" :disabled="generating" @click="onGenerateScript">
        {{ generating ? '生成中...' : '生成脚本' }}
      </button>
      <button v-if="generating" class="rc-btn" type="button" @click="onCancelGenerate">取消</button>
    </div>
    <div v-if="hydrating" class="rc-help">正在同步编排详情…</div>

    <div class="rc-list ni-rule-meta">
      <div class="rc-list-row"><b>脚本路径</b><span>{{ ruleCfg.scriptPath || '未生成' }}</span></div>
    </div>
    <textarea class="rc-code-box" readonly :value="ruleCfg.script || '生成脚本后展示 Python 预览'" />
    <div class="rc-actions-row">
      <button class="rc-btn" type="button" :disabled="!ruleCfg.script?.trim()" @click="scriptDialogOpen = true">全屏查看</button>
      <button class="rc-btn" type="button" :disabled="!canTest" @click="testDialogOpen = true">测试脚本</button>
      <button class="rc-btn primary" type="button" :disabled="savingScript || !ruleCfg.script?.trim()" @click="onSaveScript">
        {{ savingScript ? '保存中...' : '保存脚本' }}
      </button>
    </div>

    <RuleScriptDialog v-model:open="scriptDialogOpen" :script-path="ruleCfg.scriptPath" :script="ruleCfg.script || ''" />
    <RuleSystemPromptDialog
      v-model:open="systemPromptDialogOpen"
      :model-value="ruleCfg.systemPrompt ?? ''"
      @update:model-value="onSystemPromptChange"
    />
    <RuleTestDialog
      v-model:open="testDialogOpen"
      :rule-id="ruleCfg.ruleId"
      :script="ruleCfg.script || ''"
      :input-table="ruleCfg.inputTable || ''"
      :input-table-id="ruleCfg.inputTableId || ''"
      :input-fields="ruleCfg.inputFields ?? []"
      :output-fields="ruleCfg.outputFields ?? []"
      :fields="inputFieldOptions"
    />
  </template>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-textarea { min-height: 74px; resize: vertical; line-height: 1.5; }
.rc-actions-row { display: flex; gap: 8px; margin-top: 12px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ni-section-title { margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; font-weight: 700; }
.ni-section-title:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.rc-list { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.rc-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-top: 1px solid #eef2f7; font-size: 11px; color: var(--rc-text-2); }
.rc-list-row:first-child { border-top: 0; }
.rc-list-row b { color: var(--rc-text); font-weight: 600; flex-shrink: 0; }
.rc-list-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.ni-rule-meta { margin: 10px 0 8px; }
.rc-code-box { width: 100%; min-height: 112px; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #0f172a; color: #dbeafe; font-size: 11px; line-height: 1.55; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 10px; overflow: auto; resize: vertical; box-sizing: border-box; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
</style>
