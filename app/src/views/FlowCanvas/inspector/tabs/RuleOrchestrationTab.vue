<script setup lang="ts">
// 编排配置 Tab（0801 方案 §6.2/§6.4/§7.2）：规则处理节点专属，替换原「表配置」。
// 路径 A（新增业务规则→保存元数据拿 ruleId）+ 路径 B（描述/生成/全屏/测试/保存脚本）。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { makeDefaultRuleOrchestration, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, ruleApi, type EntryType, type RuleFieldOption, type RuleOrchestration } from '@/api'
import { ruleFieldOptionFromEntryField } from '@/utils/flow/ruleOrchestration'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import RuleTableFieldBinder from '../RuleTableFieldBinder.vue'
import RuleScriptDialog from '../RuleScriptDialog.vue'
import RuleSystemPromptDialog from '../RuleSystemPromptDialog.vue'
import RuleTestDialog from '../RuleTestDialog.vue'

const flow = useFlowStore()
const { tables } = useNodeInspectorAssets()

const id = computed<string>(() => flow.selectedId)
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const ruleCfg = computed<RuleOrchestration>(() => ({ ...makeDefaultRuleOrchestration(), ...cfg.value?.ruleCfg }))

function patch(p: Partial<RuleOrchestration>) {
  flow.patchRuleConfig(id.value, p)
}

// 表列表（entryApi.entryPaged）不带字段定义，真实后端的字段只在单表详情里（entryApi.entryDetail →
// config/entryType，live）。选中输入/输出表时按需拉一次详情并缓存，避免每次切换都重复请求。
const tableDetails = ref<Map<string, EntryType>>(new Map())
async function ensureTableDetail(tableId: string | undefined) {
  if (!tableId || tableDetails.value.has(tableId)) return
  try {
    const detail = await entryApi.entryDetail(tableId)
    tableDetails.value.set(tableId, detail)
  } catch (e) {
    ElMessage.error(`加载表字段失败：${(e as Error)?.message ?? String(e)}`)
  }
}
watch(
  () => [ruleCfg.value.inputTableId, ruleCfg.value.outputTableId],
  ([inputTableId, outputTableId]) => {
    ensureTableDetail(inputTableId)
    ensureTableDetail(outputTableId)
  },
  { immediate: true },
)
const tablesWithFields = computed(() => tables.value.map((t) => tableDetails.value.get(t.tableId) ?? t))

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
    // userCode：优先当前登录账号（sessionStorage），缺省由 ruleApi 回退 'admin'
    const res = await ruleApi.orchestrationSaveMeta(ruleCfg.value)
    patch({ mode: 'ref', ruleId: res.ruleId })
    // 表相关字段同步到 NodeConfig（0801 方案 §4.6）：节点侧存 tableId，不是物理表名
    if (ruleCfg.value.inputTableId) flow.setInputTable(id.value, ruleCfg.value.inputTableId)
    if (ruleCfg.value.outputTableId) flow.setOutputTable(id.value, ruleCfg.value.outputTableId)
    editingMeta.value = false
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

function fieldsOf(tableId: string | undefined): RuleFieldOption[] {
  if (!tableId) return []
  const entry = tableDetails.value.get(tableId) ?? tables.value.find((t) => t.tableId === tableId)
  return entry ? entry.fields.map(ruleFieldOptionFromEntryField) : []
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
function onDescribeChange(e: Event) {
  patch({ describe: (e.target as HTMLTextAreaElement).value })
}
function onSystemPromptChange(value: string) {
  patch({ systemPrompt: value })
}

const generating = ref(false)
async function onGenerateScript() {
  if (!ruleCfg.value.describe.trim()) {
    ElMessage.warning('请先填写规则处理描述')
    return
  }
  if (!ruleCfg.value.inputFields?.length || !ruleCfg.value.outputFields?.length) {
    ElMessage.warning('请先完成入参/出参字段绑定')
    return
  }
  generating.value = true
  try {
    const res = await ruleApi.orchestrationGenerate(ruleCfg.value)
    patch({ script: res.script, scriptPath: res.scriptPath })
    ElMessage.success('脚本已生成')
  } catch (e) {
    ElMessage.error(`生成脚本失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
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
    <RuleTableFieldBinder :model-value="ruleCfg" :tables="tablesWithFields" @update:model-value="patch" />
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
    </div>

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
