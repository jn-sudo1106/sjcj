<script setup lang="ts">
// 编排配置 Tab（0801 方案 §6.2/§6.4/§7.2）：规则处理节点=业务规则脚本（路径 B：描述/生成/全屏/测试/保存），
// 0804 S3-3 起非规则节点（采集/登录）也走这个 Tab，内容换成抓取配置 XML——两者同构复用 RuleOrchestration
// （content 概念 ≙ script/scriptPath/describe/systemPrompt，见 flowModel.ts execCfg 字段注释与方案 §3.1 修正 D），
// 存储位置不同（ruleCfg vs execCfg，避免污染 isRuleNode() 判定），UI/接口调用整套照搬，只有文案、
// 字段校验、测试入口（规则节点专属）、切换已有配置（非规则节点专属，规则节点的等价能力已被 D3 砍掉）不同。
// 0804 S2-2 拍板：路径 A（表/字段绑定 + 保存元数据）整个搬去「表配置」Tab（TableTab.vue），
// 本 Tab 不再有 showBinder/editingMeta 两态切换——表配置本来就是常驻可编辑的一个 Tab，
// 编排配置只消费已经选好的表/字段，不重复展示可编辑摘要。
// 0804 拍板：规则名称 = 节点名称，不再单独输入（下面 orchCfg 计算时强制用 cfg.title 覆盖）；
// 「引用已有规则」能力整体砍掉，复用需求交给模板功能承接（等于回退 edc08d1）。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { isRuleNode, makeDefaultRuleOrchestration, makeDefaultExecConfig, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, ruleApi, type PromptCategory, type RuleOrchestration, type RuleOrchestrationItem } from '@/api'
import { useRuleTableFields } from '@/composables/useRuleTableFields'
import { parseCaptureConfig, validateColumns } from '@/utils/flow/captureConfig'
import { promptCategoryGroupsForNode, resolvePromptCategoryForNode } from '../promptCategory'
import RuleWorkbenchDialog from '../RuleWorkbenchDialog.vue'
import RuleTestDialog from '../RuleTestDialog.vue'

const flow = useFlowStore()

const id = computed<string>(() => flow.selectedId)
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))
const orchCfg = computed<RuleOrchestration>(() => ({
  ...(isRule.value ? makeDefaultRuleOrchestration() : makeDefaultExecConfig()),
  ...(isRule.value ? cfg.value?.ruleCfg : cfg.value?.execCfg),
  name: cfg.value?.title ?? '',
}))

function patch(p: Partial<RuleOrchestration>) {
  if (isRule.value) flow.patchRuleConfig(id.value, p)
  else flow.patchExecConfig(id.value, p)
}

// 文案分流：内容同构，只有措辞按节点类型切换
const describeLabel = computed(() => (isRule.value ? '规则处理描述' : '抓取需求描述'))
const describePlaceholder = computed(() => (isRule.value ? '描述规则处理逻辑，如根据输入字段生成指标数值' : '描述抓取需求，如打开列表页提取表格前 20 行数据'))
const pathLabel = computed(() => (isRule.value ? '脚本路径' : '配置路径'))
const generateLabel = computed(() => (isRule.value ? '生成脚本' : '生成配置'))
const saveLabel = computed(() => (isRule.value ? '保存脚本' : '保存配置'))
const codeEmptyHint = computed(() => (isRule.value ? '生成脚本后展示 Python 预览' : '生成配置后展示 XML 预览'))
// S6-1：编排工作区（合并原 RuleScriptDialog/RuleSystemPromptDialog）的文案分流
const workbenchTitle = computed(() => (isRule.value ? '规则脚本工作区' : '抓取配置工作区'))
const scriptLabel = computed(() => (isRule.value ? 'Python 脚本' : '抓取配置 XML'))
const promptCategoryGroups = computed(() => promptCategoryGroupsForNode(cfg.value))
const promptCategory = computed(() => resolvePromptCategoryForNode(cfg.value, orchCfg.value.promptCategory))

// ---- 抓取配置 XML 轻解析（0804 S3-4，方案 §3.1 修正 B · 附录 §十）：仅非规则节点 ----
// 只读动作链摘要（顶部展示）+ 保存前的字段一致性提示，不做可视化编辑（方案已拍板不做）。
const parsedCapture = computed(() => (!isRule.value && orchCfg.value.script?.trim() ? parseCaptureConfig(orchCfg.value.script) : undefined))
function summarizeActions(actions: { title: string }[]): string {
  const groups: { title: string; count: number }[] = []
  for (const a of actions) {
    const last = groups[groups.length - 1]
    if (last && last.title === a.title) last.count++
    else groups.push({ title: a.title, count: 1 })
  }
  return groups.map((g) => (g.count > 1 ? `${g.title} ×${g.count}` : g.title)).join(' → ')
}
const actionSummary = computed(() => (parsedCapture.value ? summarizeActions(parsedCapture.value.actions) : ''))

// 采集节点没有逐字段勾选 UI（跟规则节点的 inputFields/outputFields 不同），校验对象退化为
// 输出表的全部字段——校验"XML 引用的 BizId 是否都在这张表上"，而不是"是否都在某个已选子集里"。
const outputTableId = computed(() => cfg.value?.collectCfg?.outputTable || cfg.value?.outputTable || '')
async function checkColumnConsistency(): Promise<boolean> {
  if (isRule.value || !parsedCapture.value?.columns.length || !outputTableId.value) return true
  try {
    const entry = await entryApi.entryDetail(outputTableId.value)
    const issues = validateColumns(parsedCapture.value, entry.fields.map((f) => f.prop))
    if (!issues.length) return true
    try {
      await ElMessageBox.confirm(issues.join('\n'), '字段一致性提示', {
        type: 'warning', confirmButtonText: '仍要保存', cancelButtonText: '取消',
      })
      return true
    } catch {
      return false
    }
  } catch {
    return true // 拉字段失败不阻塞保存，只是跳过这次校验
  }
}

// 表字段：只读消费「表配置」Tab 已经选好的表——测试台需要按字段回填入参标签，见 RuleTestDialog。
// 非规则节点的 orchCfg 没有 inputTableId/outputTableId，watch 里的字段拉取会静默 no-op，安全。
const { inputFieldOptions } = useRuleTableFields(orchCfg)

// 进入查看态时按 ruleId 回灌详情 + 缺正文时按 scriptPath 拉 MinIO（对齐旧 handleOpenRecord）
const hydrateToken = ref('')
const hydrating = ref(false)
async function hydrateViewFromServer() {
  const ruleId = orchCfg.value.ruleId
  if (!ruleId) return
  const token = `${id.value}:${ruleId}`
  if (hydrateToken.value === token || hydrating.value) return
  hydrating.value = true
  hydrateToken.value = token
  try {
    try {
      const detail = await ruleApi.orchestrationDetail(ruleId)
      const next: Partial<RuleOrchestration> = {}
      // 服务端有值才覆盖，避免 saveMeta 后详情尚无 nlDescribe 时用空串抹掉本地草稿
      // name 不在此列：规则名称 = 节点名称（0804 拍板），orchCfg 计算时已强制用 cfg.title 覆盖
      if (detail.describe?.trim()) next.describe = detail.describe
      if (detail.systemPrompt?.trim()) next.systemPrompt = detail.systemPrompt
      if (detail.scriptPath?.trim()) next.scriptPath = detail.scriptPath
      if (Object.keys(next).length) patch(next)
    } catch {
      // 详情失败不阻塞；下面仍可凭本地 scriptPath 拉脚本
    }
    const stored = isRule.value ? cfg.value?.ruleCfg : cfg.value?.execCfg
    const path = (stored?.scriptPath || orchCfg.value.scriptPath || '').trim()
    if (path && !stored?.script?.trim()) {
      try {
        const script = await ruleApi.orchestrationLoadScript(path)
        if (script.trim()) patch({ script })
      } catch (e) {
        ElMessage.warning(`加载失败：${(e as Error)?.message ?? String(e)}`)
      }
    }
  } finally {
    hydrating.value = false
  }
}
watch(
  () => [id.value, isRule.value, orchCfg.value.ruleId] as const,
  () => { void hydrateViewFromServer() },
  { immediate: true },
)

function onDescribeChange(e: Event) {
  patch({ describe: (e.target as HTMLTextAreaElement).value })
}
function onSystemPromptChange(value: string) {
  patch({ systemPrompt: value })
}
function onPromptCategoryChange(value: PromptCategory) {
  patch({ promptCategory: resolvePromptCategoryForNode(cfg.value, value) })
}
function onScriptChange(value: string) {
  patch({ script: value })
}

const generating = ref(false)
const generateAbort = ref<AbortController | null>(null)
function onCancelGenerate() {
  generateAbort.value?.abort()
}
async function onGenerateScript() {
  if (!orchCfg.value.describe.trim()) {
    ElMessage.warning(isRule.value ? '请先填写规则处理描述' : '请先填写抓取需求描述')
    return
  }
  if (isRule.value && (!orchCfg.value.inputFields?.length || !orchCfg.value.outputFields?.length)) {
    ElMessage.warning('请先在「表配置」完成入参/出参字段绑定')
    return
  }
  generateAbort.value?.abort()
  const controller = new AbortController()
  generateAbort.value = controller
  generating.value = true
  try {
    const res = await ruleApi.orchestrationGenerate(orchCfg.value, controller.signal)
    patch({ script: res.script, scriptPath: res.scriptPath })
    ElMessage.success(isRule.value ? '脚本已生成' : '配置已生成')
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.message?.includes('已取消')) {
      ElMessage.info('已取消生成')
    } else {
      ElMessage.error(`生成${isRule.value ? '脚本' : '配置'}失败：${(e as Error)?.message ?? String(e)}`)
    }
  } finally {
    if (generateAbort.value === controller) generateAbort.value = null
    generating.value = false
  }
}

const workbenchOpen = ref(false)

const savingScript = ref(false)
async function onSaveScript() {
  if (!orchCfg.value.script?.trim()) {
    ElMessage.warning(isRule.value ? '请先生成脚本' : '请先生成配置')
    return
  }
  // S6-2 联调后端实测（vanv-rule-center DashScopeServiceImpl.editGenerateCode）：/script/edit 按
  // scriptPath 直接原地覆盖写文件，不认 ruleId，也不会新建——scriptPath 为空等于拿空文件名去覆盖，
  // 明显不对。S6-1 开放手写脚本前，script 非空必然等价于已经点过一次「生成脚本」（两者一起写入），
  // 这条守卫本来隐式成立；手写脚本之后不再成立，必须显式补上。
  if (!orchCfg.value.scriptPath?.trim()) {
    ElMessage.warning(isRule.value ? '请先点「生成脚本」换一个本节点自己的文件路径，再保存' : '请先点「生成配置」换一个本节点自己的文件路径，再保存')
    return
  }
  if (!(await checkColumnConsistency())) return
  try {
    await ElMessageBox.confirm(
      isRule.value ? '保存后将把当前脚本绑定到该规则处理节点，是否继续？' : '保存后将把当前配置绑定到该节点，是否继续？',
      isRule.value ? '保存规则脚本' : '保存抓取配置',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  savingScript.value = true
  try {
    const res = await ruleApi.orchestrationSave(orchCfg.value)
    patch({ mode: 'ref', ruleId: res.ruleId, scriptPath: res.scriptPath })
    ElMessage.success(res.message || (isRule.value ? '规则脚本已保存' : '抓取配置已保存'))
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    savingScript.value = false
  }
}

// ---- 切换已有配置（P0，仅非规则节点；规则节点的「引用已有规则」已被 D3 砍掉，见方案 §1.3）----
// 复用 ruleApi.orchestrationPaged（vrule 编排列表接口，无新增端点）；列表项不带 format，
// 按 scriptPath 是否 .xml 后缀筛出抓取配置类记录——后续如果有专用接口，只用改这一个函数。
const switchOptions = ref<RuleOrchestrationItem[]>([])
const switchLoading = ref(false)
const switchLoaded = ref(false)
const switchLoadError = ref('')
const switchSelected = ref('')
async function loadSwitchOptions() {
  if (switchLoaded.value || switchLoading.value) return
  switchLoading.value = true
  switchLoadError.value = ''
  try {
    const paged = await ruleApi.orchestrationPaged({ size: 100 })
    switchOptions.value = paged.list.filter((item) => item.scriptPath?.endsWith('.xml'))
    switchLoaded.value = true
  } catch (e) {
    // 既有配置只是可选的复用入口，列表接口异常不能阻断当前节点的新建/生成/保存流程。
    switchLoadError.value = `既有配置列表暂时不可用：${(e as Error)?.message ?? String(e)}`
  } finally {
    switchLoading.value = false
  }
}
function retryLoadSwitchOptions() {
  void loadSwitchOptions()
}
watch(isRule, (v) => { if (!v) void loadSwitchOptions() }, { immediate: true })

const applyingSwitch = ref(false)
async function onApplySwitch() {
  const target = switchOptions.value.find((o) => o.ruleId === switchSelected.value)
  if (!target) return
  // 本节点必须已经有自己的编排记录（「表配置」保存过一次）才能切换套用，否则下面只拷内容不带
  // ruleId 的做法没有落点——没有自己的 ruleId，点「生成脚本」时 dashscopeStream 会因 ruleId 不存在报错。
  if (!orchCfg.value.ruleId) {
    ElMessage.warning('请先在「表配置」保存一次，本节点有自己的编排记录后才能切换套用')
    return
  }
  applyingSwitch.value = true
  try {
    const detail = await ruleApi.orchestrationDetail(target.ruleId)
    const sourceScriptPath = detail.scriptPath || target.scriptPath
    const script = sourceScriptPath ? await ruleApi.orchestrationLoadScript(sourceScriptPath).catch(() => '') : ''
    // 只拷内容当草稿，ruleId/scriptPath 不跟着换——这两个决定「保存脚本」实际写去哪，沿用源节点的
    // 会直接覆盖它的文件/数据库记录，不是"另存"（后端实测：/script/edit 按 scriptPath 原地覆盖写
    // 文件，跟 ruleId 无关；生成脚本按 ruleId saveOrUpdate 数据库记录，也是更新不是新建，见
    // vanv-rule-center DashScopeServiceImpl）。scriptPath 清空，强制先点一次「生成脚本」换成本节点
    // 自己的新文件，才允许「保存脚本」（onSaveScript 的 scriptPath 非空校验兜底）。
    patch({
      describe: detail.describe || target.describe || '',
      systemPrompt: detail.systemPrompt || orchCfg.value.systemPrompt,
      script,
      scriptPath: '',
    })
    ElMessage.success(`已复制「${target.name}」的内容，点「生成脚本」换成本节点自己的文件后再保存`)
  } catch (e) {
    ElMessage.error(`切换配置失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    applyingSwitch.value = false
  }
}

// ---- 全屏测试台（L3，拍板 #12，见 §6.5）：仅规则节点——抓取配置的"测试"是真打开网页抓一次，
// 跟脚本测试台的输入来源完全不同，测试台复用不了，本期不做（方案 §3.1 修正 D / §9.2-11）----
const testDialogOpen = ref(false)
const canTest = computed(() => !!orchCfg.value.script?.trim() && !!orchCfg.value.inputTable)
</script>

<template>
  <div class="ni-section-title">{{ isRule ? '查看业务编排' : '抓取配置' }}</div>
  <div class="rc-field"><label>{{ describeLabel }}</label>
    <textarea
      class="rc-input rc-textarea"
      :value="orchCfg.describe"
      :placeholder="describePlaceholder"
      @input="onDescribeChange"
    />
  </div>

  <template v-if="!isRule">
    <!-- 只读动作链摘要（0804 S3-4，方案 §3.1）：按 NextActionId 链表走出来的执行顺序，不可编辑 -->
    <div v-if="actionSummary" class="rc-list ni-rule-meta">
      <div class="rc-list-row"><b>动作链</b><span :title="actionSummary">{{ actionSummary }}</span></div>
    </div>
    <div v-if="parsedCapture?.warnings.length" class="rc-help">{{ parsedCapture.warnings.join('；') }}</div>
    <div class="rc-field"><label>切换已有配置</label>
      <div class="rc-input-group">
        <select v-model="switchSelected" class="rc-select grow" :disabled="switchLoading">
          <option value="">{{ switchLoading ? '加载中...' : (switchOptions.length ? '选择既有抓取配置' : '暂无既有抓取配置') }}</option>
          <option v-for="o in switchOptions" :key="o.ruleId" :value="o.ruleId">{{ o.name }} · {{ o.ruleId }}</option>
        </select>
        <button class="rc-input-btn" type="button" :disabled="!switchSelected || applyingSwitch" @click="onApplySwitch">
          {{ applyingSwitch ? '切换中...' : '应用' }}
        </button>
      </div>
      <div v-if="switchLoadError" class="rc-switch-load-error">
        <span>{{ switchLoadError }}</span>
        <button type="button" @click="retryLoadSwitchOptions">重试</button>
      </div>
    </div>
  </template>

  <div class="rc-actions-row">
    <button class="rc-btn" type="button" @click="workbenchOpen = true">编辑系统提示词</button>
    <button class="rc-btn primary" type="button" :disabled="generating" @click="onGenerateScript">
      {{ generating ? '生成中...' : generateLabel }}
    </button>
    <button v-if="generating" class="rc-btn" type="button" @click="onCancelGenerate">取消</button>
  </div>
  <div v-if="hydrating" class="rc-help">正在同步编排详情…</div>

  <div class="rc-list ni-rule-meta">
    <div class="rc-list-row"><b>{{ pathLabel }}</b><span>{{ orchCfg.scriptPath || '未生成' }}</span></div>
  </div>
  <textarea class="rc-code-box" readonly :value="orchCfg.script || codeEmptyHint" />
  <div class="rc-actions-row">
    <button class="rc-btn" type="button" :disabled="!orchCfg.script?.trim()" @click="workbenchOpen = true">全屏查看</button>
    <button v-if="isRule" class="rc-btn" type="button" :disabled="!canTest" @click="testDialogOpen = true">测试脚本</button>
    <button class="rc-btn primary" type="button" :disabled="savingScript || !orchCfg.script?.trim()" @click="onSaveScript">
      {{ savingScript ? '保存中...' : saveLabel }}
    </button>
  </div>

  <!-- S6-1（方案 §4.1）：合并原 RuleScriptDialog（只读脚本查看）+ RuleSystemPromptDialog（编辑系统提示词）
       为一个双栏工作区——两个入口按钮（编辑系统提示词/全屏查看）现在打开同一个弹层，左右两栏一屏对照，
       面板内直接能生成/保存/测试，不用退出去。 -->
  <RuleWorkbenchDialog
    v-model:open="workbenchOpen"
    :title="workbenchTitle"
    :script-label="scriptLabel"
    :system-prompt="orchCfg.systemPrompt ?? ''"
    :prompt-category="promptCategory"
    :prompt-category-groups="promptCategoryGroups"
    :script="orchCfg.script ?? ''"
    :script-path="orchCfg.scriptPath"
    :generate-label="generateLabel"
    :save-label="saveLabel"
    :generating="generating"
    :saving="savingScript"
    :show-test="isRule"
    :can-test="canTest"
    @update:system-prompt="onSystemPromptChange"
    @update:prompt-category="onPromptCategoryChange"
    @update:script="onScriptChange"
    @generate="onGenerateScript"
    @cancel-generate="onCancelGenerate"
    @save="onSaveScript"
    @test="testDialogOpen = true"
  />
  <RuleTestDialog
    v-if="isRule"
    v-model:open="testDialogOpen"
    :rule-id="orchCfg.ruleId"
    :script="orchCfg.script || ''"
    :input-table="orchCfg.inputTable || ''"
    :input-table-id="orchCfg.inputTableId || ''"
    :input-fields="orchCfg.inputFields ?? []"
    :output-fields="orchCfg.outputFields ?? []"
    :fields="inputFieldOptions"
  />
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-textarea { min-height: 74px; resize: vertical; line-height: 1.5; }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-select.grow { border-radius: 7px 0 0 7px; flex: 1; }
.rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-select:disabled { background: #f8fafc; color: var(--rc-faint); }
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-left: 0; border-radius: 0 7px 7px 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-input-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-switch-load-error { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-top: 6px; color: var(--rc-warn); font-size: 10px; line-height: 1.5; }
.rc-switch-load-error span { min-width: 0; }
.rc-switch-load-error button { flex: none; padding: 0; border: 0; background: transparent; color: var(--rc-primary); font-size: 10px; cursor: pointer; }
.rc-switch-load-error button:hover { text-decoration: underline; }
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
