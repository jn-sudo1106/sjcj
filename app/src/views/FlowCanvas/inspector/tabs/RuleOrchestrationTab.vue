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
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, UploadFilled } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useFlowStore } from '@/stores/flow'
import { isMonitorNode, isRuleNode, makeDefaultRuleOrchestration, makeDefaultExecConfig, MONITOR_METHODS, type MonitorAlertConfig, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { configApi, entryApi, fetchDefaultModels, fetchModelProviders, ruleApi, type EntryType, type ModelOption, type ModelProviderOption, type PromptCategory, type RuleOrchestration, type RuleOrchestrationItem } from '@/api'
import { isVruleNumericRuleId } from '@/api/legacyAdapters'
import { RULE_DATA_SOURCE } from '@/constants/rule'
import { useRuleTableFields } from '@/composables/useRuleTableFields'
import { parseCaptureConfig, validateColumns } from '@/utils/flow/captureConfig'
import { buildDataProcessGeneratePayload } from '@/utils/flow/dataProcess'
import { syncMonitorCkSource } from '@/utils/flow/monitorCkSource'
import { promptCategoryGroupsForNode, promptListCategoryForNode, resolvePromptCategoryForNode } from '../promptCategory'
import { loadPromptTemplateForNode } from '../promptTemplateLoader'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import RuleWorkbenchDialog from '../RuleWorkbenchDialog.vue'
import AlertConfigPanel from '../AlertConfigPanel.vue'

const flow = useFlowStore()
const router = useRouter()
const route = useRoute()
const { tables } = useNodeInspectorAssets()

const id = computed<string>(() => flow.selectedId)
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))
const isMonitor = computed(() => (cfg.value ? isMonitorNode(cfg.value) : false))
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
const describeLabel = computed(() => (isMonitor.value ? '数据监控描述' : isRule.value ? '规则处理描述' : '抓取需求描述'))
const describePlaceholder = computed(() => (isRule.value ? '请使用自然语言描述你需要生成脚本的规则或转换关系' : '描述抓取需求，如打开列表页提取表格前 20 行数据'))
const generateLabel = computed(() => (isRule.value ? '生成脚本' : '生成配置'))
const saveLabel = computed(() => (isRule.value ? '保存脚本' : '保存配置'))
// S6-1：编排工作区（合并原 RuleScriptDialog/RuleSystemPromptDialog）的文案分流
const workbenchTitle = computed(() => (isRule.value ? '规则脚本工作区' : '抓取配置工作区'))
const scriptLabel = computed(() => (isRule.value ? 'Python 脚本' : '抓取配置 XML'))
const promptCategoryGroups = computed(() => promptCategoryGroupsForNode(cfg.value))
const promptCategory = computed(() => resolvePromptCategoryForNode(cfg.value, orchCfg.value.promptCategory))
const promptListCategory = computed(() => promptListCategoryForNode(cfg.value))
const describeTouched = ref(false)

// 数据监控节点：监控方法与规则描述同属编排语义，放在「设置业务规则」上方。
const monitorMethods = computed<string[]>(() => cfg.value?.monitorMethods ?? [])
function setMonitorMethods(values: string[]) {
  flow.setMonitorMethods(id.value, values ?? [])
}
function setMonitorAlertConfig(config: MonitorAlertConfig) {
  flow.setMonitorAlertConfig(id.value, config)
}

// 监控方法随 config 的 checkRule 落库（逗号分隔，生成脚本时仍按原口径传给后端）。
// 本地已有勾选时不覆盖；否则按当前配置详情回填已保存的候选项。
const checkRuleRestoreToken = ref('')
watch(
  () => [id.value, isMonitor.value, cfg.value?.configId ?? '', cfg.value?.monitorMethods?.length ?? 0] as const,
  ([nid, monitor, configId, methodCount]) => {
    if (!monitor || !configId || methodCount) return
    const token = `${nid}:${configId}`
    if (checkRuleRestoreToken.value === token) return
    checkRuleRestoreToken.value = token
    void (async () => {
      try {
        const record = await configApi.configDetailRaw(String(configId))
        const saved = String(record?.checkRule ?? '').trim()
        if (!saved) return
        const known = new Set(MONITOR_METHODS)
        const restored = saved.split(',').map((m) => m.trim()).filter((m) => m && known.has(m))
        if (restored.length) flow.setMonitorMethods(String(nid), restored)
      } catch {
        // 回填失败不阻断编排配置，用户仍可手动选择。
      }
    })()
  },
  { immediate: true },
)

function formatTableLabel(table?: Pick<EntryType, 'name' | 'tableName'> | null): string {
  const name = table?.name?.trim() || ''
  const tableName = table?.tableName?.trim() || ''
  if (name && tableName) return `${name}:${tableName}`
  return name || tableName || ''
}

function resolveTableLabel(tableRef: string): string {
  const ref = tableRef.trim()
  if (!ref) return ''
  const table = tables.value.find((item) => item.tableId === ref || item.tableName === ref || item.name === ref)
  return formatTableLabel(table) || ref
}

const sourceTableName = computed(() => resolveTableLabel(
  cfg.value?.collectCfg?.inputTable?.trim()
  || cfg.value?.inputTable?.trim()
  || orchCfg.value.inputTableId?.trim()
  || orchCfg.value.inputTable?.trim()
  || '',
))

function readRawTextField(value: unknown, keys: string[]): string {
  const readObject = (record: Record<string, unknown>): string => {
    for (const key of keys) {
      const raw = record[key]
      if (raw == null) continue
      const text = String(raw).trim()
      if (text) return text
    }
    return ''
  }
  if (value == null) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    if (/^[{\[]/.test(text)) {
      try {
        const parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return readObject(parsed as Record<string, unknown>) || text
        }
      } catch {
        // 不是 JSON 就按原文本看
      }
    }
    return text
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return readObject(value as Record<string, unknown>)
  }
  return ''
}

function resolveConfigDetailPrefill(raw: Record<string, unknown>): { describe: string; scriptPath: string; script: string } {
  const describe = readRawTextField(raw.snatchConf, ['description', 'describe', 'nlDescribe'])
  const codeRuleValue = raw.codeRule
  const codeRuleText = readRawTextField(codeRuleValue, ['scriptPath', 'codePath', 'codeFileName', 'path'])
  const scriptText = (codeRuleValue && typeof codeRuleValue === 'object' && !Array.isArray(codeRuleValue))
    ? readRawTextField(codeRuleValue, ['script', 'scriptCode', 'code', 'body', 'content'])
    : ''
  const codeRuleRaw = String(codeRuleValue ?? '').trim()
  const scriptPath = codeRuleText || (/^[^\n]+\.[a-z0-9]+$/i.test(codeRuleRaw) ? codeRuleRaw : '')
  return { describe, scriptPath, script: scriptText }
}

watch(id, () => {
  describeTouched.value = false
}, { immediate: true })

function buildMonitorDescribe() {
  if (!isMonitor.value) return ''
  const tableLabel = sourceTableName.value
  const methods = (cfg.value?.monitorMethods ?? []).map((item) => item.trim()).filter(Boolean)
  if (!tableLabel || !methods.length) return ''
  return `我想对${tableLabel}进行如下监控：\n${methods.map((item, index) => `${index + 1}.${item}`).join('\n')}`
}
const monitorDescribeSeed = computed(() => buildMonitorDescribe())

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
const { inputFieldOptions, outputFieldOptions } = useRuleTableFields(orchCfg)

const providerOptions = ref<ModelProviderOption[]>([])
const modelOptions = ref<ModelOption[]>([])
const providerLoading = ref(false)
const modelLoading = ref(false)
const providerError = ref('')
const modelError = ref('')
function firstProviderCode() {
  return providerOptions.value[0]?.providerCode || ''
}
function firstModelCode() {
  return modelOptions.value[0]?.modelCode || ''
}
async function loadModels(providerCode: string, preferredModelCode?: string) {
  modelLoading.value = true
  modelError.value = ''
  try {
    modelOptions.value = await fetchDefaultModels(providerCode)
    const modelCode = modelOptions.value.find((item) => item.modelCode === preferredModelCode)?.modelCode || firstModelCode()
    if (modelCode !== (orchCfg.value.modelCode || '')) patch({ modelCode })
  } catch (e) {
    modelOptions.value = []
    patch({ modelCode: '' })
    modelError.value = `模型加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    modelLoading.value = false
  }
}
async function loadProviderModelOptions() {
  providerLoading.value = true
  providerError.value = ''
  try {
    providerOptions.value = await fetchModelProviders()
    const providerCode = providerOptions.value.find((item) => item.providerCode === orchCfg.value.modelProviderCode)?.providerCode || firstProviderCode()
    if (providerCode !== (orchCfg.value.modelProviderCode || '')) patch({ modelProviderCode: providerCode })
    if (!providerCode) {
      modelOptions.value = []
      patch({ modelCode: '' })
      return
    }
    await loadModels(providerCode, orchCfg.value.modelCode)
  } catch (e) {
    providerOptions.value = []
    modelOptions.value = []
    patch({ modelProviderCode: '', modelCode: '' })
    providerError.value = `模型供应商加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    providerLoading.value = false
  }
}
watch(
  () => [id.value, isRule.value] as const,
  () => { if (isRule.value) void loadProviderModelOptions() },
  { immediate: true },
)

const configDetailPrefillToken = ref('')
watch(
  () => [id.value, isRule.value, cfg.value?.configId] as const,
  () => {
    configDetailPrefillToken.value = ''
  },
  { immediate: true },
)
watch(
  () => [id.value, isRule.value, cfg.value?.configId] as const,
  () => {
    if (!isRule.value) return
    const configId = cfg.value?.configId?.trim()
    if (!configId) return
    const token = `${id.value}:${configId}`
    if (configDetailPrefillToken.value === token) return
    void (async () => {
      try {
        const raw = await configApi.configDetailRaw(configId)
        if (configDetailPrefillToken.value === token) return
        const prefill = raw ? resolveConfigDetailPrefill(raw) : { describe: '', scriptPath: '', script: '' }
        const next: Partial<RuleOrchestration> = {}
        if (prefill.describe) next.describe = prefill.describe
        if (prefill.scriptPath) next.scriptPath = prefill.scriptPath
        if (prefill.script) next.script = prefill.script
        if (Object.keys(next).length) patch(next)
        if (prefill.scriptPath && !prefill.script) {
          const loadedScript = await ruleApi.fileDownloadScript(prefill.scriptPath).catch(() => '')
          if (loadedScript.trim()) patch({ script: loadedScript })
        }
        configDetailPrefillToken.value = token
      } catch {
        // 详情回填失败不阻断编排页，其它回填逻辑仍可继续。
      }
    })()
  },
  { immediate: true },
)
let promptRefreshSeq = 0
watch(
  () => [
    id.value,
    isRule.value,
    isMonitor.value,
    sourceTableName.value,
    promptCategory.value,
    promptListCategory.value,
    orchCfg.value.inputFields?.join(',') ?? '',
    orchCfg.value.outputFields?.join(',') ?? '',
    inputFieldOptions.value.map((field) => `${field.itemCode}:${field.itemName}`).join(','),
    outputFieldOptions.value.map((field) => `${field.itemCode}:${field.itemName}`).join(','),
  ] as const,
  () => {
    if (!isRule.value && !isMonitor.value) return
    const refreshSeq = ++promptRefreshSeq
    // 数据监控节点进入编排 Tab 时即拼接系统提示词，与脚本编辑弹窗的行为一致——
    // 弹窗 loadPromptTemplate 无条件调用，这里也不卡 sourceTableName/inputFields。
    if (isRule.value && !isMonitor.value) {
      if (!sourceTableName.value) return
      if (!orchCfg.value.inputFields?.length) return
      if (!orchCfg.value.outputFields?.length) return
    }
    void (async () => {
      const applied = await loadPromptTemplateForNode({
        promptListCategory: promptListCategory.value,
        promptCategory: promptCategory.value,
        inputTableName: sourceTableName.value,
        outputTableName: orchCfg.value.outputTable?.trim() || sourceTableName.value,
        sourceId: isMonitor.value ? (cfg.value?.stepSourceId ?? '') : '',
        sourceCron: isMonitor.value ? (cfg.value?.schedule?.cron ?? '') : '',
        inputFields: orchCfg.value.inputFields ?? [],
        outputFields: orchCfg.value.outputFields ?? [],
        inputFieldOptions: inputFieldOptions.value,
        outputFieldOptions: outputFieldOptions.value.length ? outputFieldOptions.value : inputFieldOptions.value,
      })
      if (!applied) return
      if (refreshSeq !== promptRefreshSeq) return
      if (applied !== orchCfg.value.systemPrompt) patch({ systemPrompt: applied })
    })()
  },
  { immediate: true },
)

watch(
  () => [id.value, isMonitor.value, monitorDescribeSeed.value] as const,
  () => {
    if (!isMonitor.value || describeTouched.value) return
    const autoDescribe = monitorDescribeSeed.value
    if (autoDescribe && orchCfg.value.describe !== autoDescribe) patch({ describe: autoDescribe })
  },
  { immediate: true },
)

function onDescribeChange(e: Event) {
  describeTouched.value = true
  patch({ describe: (e.target as HTMLTextAreaElement).value })
}
function onSystemPromptChange(value: string) {
  patch({ systemPrompt: value })
}
function onPromptCategoryChange(value: PromptCategory) {
  patch({ promptCategory: resolvePromptCategoryForNode(cfg.value, value) })
}
async function onModelProviderChange(value: string) {
  patch({ modelProviderCode: value })
  // 换供应商必须重拉该供应商的模型列表，否则下拉里留着上一家的模型（原 onMainModelProviderChange 的行为）
  await loadModels(value, orchCfg.value.modelCode)
}
function onModelChange(value: string) {
  patch({ modelCode: value })
}
function onScriptChange(value: string) {
  patch({ script: value })
}
const generating = ref(false)
const generateAbort = ref<AbortController | null>(null)
const thinkingText = ref('')
const generationMessage = ref('')
const generationState = ref<'idle' | 'thinking' | 'content' | 'done' | 'error'>('idle')
const selectedExcelFile = ref<File | null>(null)
const excelFileError = ref('')
const excelFileInput = ref<HTMLInputElement | null>(null)
const MAX_EXCEL_FILE_SIZE = 10 * 1024 * 1024
const mainThinkingRef = ref<HTMLElement | null>(null)
const mainResultRef = ref<HTMLElement | null>(null)
function formatResultLabel(value: string): string {
  const text = value.trim()
  if (!text) return ''
  return text.replace(/^#?\s*(?:当前文件已保存到|保存到)\s*/, '')
}
const mainResultLabel = computed(() => formatResultLabel(orchCfg.value.scriptPath?.trim() || generationMessage.value))
const loadingResultScript = ref(false)
async function scrollMainThinkingToBottom() {
  await nextTick()
  const el = mainThinkingRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
async function scrollMainResultToBottom() {
  await nextTick()
  const el = mainResultRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
// 点击「生成结果」路径按钮时，把脚本下载到本地，文件名取路径最后一段（如 1788931403322.py）。
// 之前叫 loadResultScriptFromFile，做的是回填编辑器；本次改为本地下载，不再改 orchCfg.script。
function basenameOfPath(p: string): string {
  const trimmed = p.replace(/[?#].*$/, '').replace(/\/+$/, '')
  const slash = trimmed.lastIndexOf('/')
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  return base || 'script.txt'
}
async function downloadResultScriptToLocal() {
  const fileId = orchCfg.value.scriptPath?.trim() || mainResultLabel.value
  if (!fileId || loadingResultScript.value) return
  loadingResultScript.value = true
  try {
    const script = await ruleApi.fileDownloadScript(fileId)
    const fileName = basenameOfPath(fileId)
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objectUrl)
    ElMessage.success(`已下载到本地：${fileName}`)
  } catch (e) {
    ElMessage.error((e as Error)?.message ?? String(e))
  } finally {
    loadingResultScript.value = false
  }
}
watch(
  () => [thinkingText.value, generating.value, generationState.value] as const,
  () => {
    if (!isRule.value) return
    if (generating.value || thinkingText.value.trim() || generationState.value === 'done' || generationState.value === 'error') {
      void scrollMainThinkingToBottom()
    }
  },
  { flush: 'post' },
)
watch(
  () => [orchCfg.value.script, generating.value, generationState.value] as const,
  () => {
    if (!isRule.value) return
    if (generating.value || orchCfg.value.script?.trim() || generationState.value === 'content' || generationState.value === 'done') {
      void scrollMainResultToBottom()
    }
  },
  { flush: 'post' },
)
function onCancelGenerate() {
  generateAbort.value?.abort()
}
function formatExcelFileSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
function onExcelFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  excelFileError.value = ''
  if (!file) return
  if (!/\.(?:xls|xlsx)$/i.test(file.name)) {
    selectedExcelFile.value = null
    excelFileError.value = '仅支持 .xls 或 .xlsx 文件'
    input.value = ''
    return
  }
  if (file.size > MAX_EXCEL_FILE_SIZE) {
    selectedExcelFile.value = null
    excelFileError.value = 'Excel 文件不能超过 10MB'
    input.value = ''
    return
  }
  selectedExcelFile.value = file
}
function removeExcelFile() {
  selectedExcelFile.value = null
  excelFileError.value = ''
  if (excelFileInput.value) excelFileInput.value.value = ''
}
/** 仅非规则节点的旧 XML 抓取配置复用还依赖 compose ruleId；规则/监控节点生成脚本走 configId。 */
async function resolveInputTableName(): Promise<string> {
  if (!isRule.value) return ''
  const named = orchCfg.value.inputTable?.trim()
  if (named) return named
  const tableId = orchCfg.value.inputTableId?.trim()
  if (!tableId) return ''
  try {
    const entry = await entryApi.entryDetail(tableId)
    const tableName = entry.tableName?.trim() || ''
    if (tableName) patch({ inputTable: tableName })
    return tableName
  } catch {
    return ''
  }
}
async function ensureLegacyComposeRuleId(): Promise<string | undefined> {
  if (isVruleNumericRuleId(orchCfg.value.ruleId)) return orchCfg.value.ruleId
  // 已有非数字 id（mock orch-*）：生成接口会走 mock，不必再打 saveMeta。`-1` 除外。
  const existing = orchCfg.value.ruleId?.trim()
  if (existing && existing !== '-1') return existing
  if (!cfg.value?.title?.trim()) {
    ElMessage.warning('请先在「节点配置」填写节点名称')
    return undefined
  }
  try {
    const inputTable = await resolveInputTableName()
    const res = await ruleApi.orchestrationSaveMeta({
      ...orchCfg.value,
      dataSource: RULE_DATA_SOURCE,
      inputTable,
      outputTable: isRule.value ? orchCfg.value.outputTable : outputTableId.value,
    })
    patch({ mode: 'ref', ruleId: res.ruleId })
    if (!isVruleNumericRuleId(res.ruleId)) {
      ElMessage.error('编排记录未返回有效 ruleId，无法生成配置')
      return undefined
    }
    return res.ruleId
  } catch (e) {
    ElMessage.error(`保存编排记录失败：${(e as Error)?.message ?? String(e)}`)
    return undefined
  }
}
async function onGenerateScript(
  draft?: Partial<Pick<RuleOrchestration, 'systemPrompt' | 'promptCategory' | 'modelProviderCode' | 'modelCode'>> & { file?: File },
) {
  if (!orchCfg.value.describe.trim()) {
    ElMessage.warning(isMonitor.value ? '请先填写数据监控描述' : isRule.value ? '请先填写规则处理描述' : '请先填写抓取需求描述')
    return
  }
  if (isRule.value && !cfg.value?.configId) {
    ElMessage.warning('请先保存表配置，再生成脚本')
    return
  }
  if (isRule.value && (!((draft?.modelProviderCode ?? orchCfg.value.modelProviderCode) || '').trim() || !((draft?.modelCode ?? orchCfg.value.modelCode) || '').trim())) {
    ElMessage.warning('请先选择模型供应商和模型')
    return
  }
  if (isRule.value && !isMonitor.value && (!orchCfg.value.inputFields?.length || !orchCfg.value.outputFields?.length)) {
    ElMessage.warning('请先在「表配置」完成入参/出参字段绑定')
    return
  }
  // 数据监控节点无出参字段，只校验入参，跳过出参校验（2026-09-01）
  if (isMonitor.value && !orchCfg.value.inputFields?.length) {
    ElMessage.warning('请先在「表配置」完成入参字段绑定')
    return
  }
  generateAbort.value?.abort()
  const controller = new AbortController()
  generateAbort.value = controller
  generating.value = true
  thinkingText.value = ''
  generationMessage.value = ''
  generationState.value = 'idle'
  patch({ script: '', scriptPath: '' })
  try {
    const legacyRuleId = !isRule.value ? await ensureLegacyComposeRuleId() : undefined
    if (!isRule.value && !legacyRuleId) return
    if (controller.signal.aborted) throw new Error('已取消生成')
    const currentOrchCfg = { ...orchCfg.value }
    if (isRule.value) delete currentOrchCfg.ruleId
    const genCfg = {
      ...currentOrchCfg,
      ...draft,
      ...(legacyRuleId ? { ruleId: legacyRuleId } : {}),
    }
    let streamedScript = ''
    let res: Awaited<ReturnType<typeof ruleApi.orchestrationGenerate>>
    if (isRule.value) {
      res = await ruleApi.dataProcessGenerate(buildDataProcessGeneratePayload({
        description: genCfg.describe,
        configId: Number(cfg.value?.configId ?? 0),
        providerCode: genCfg.modelProviderCode ?? '',
        model: genCfg.modelCode ?? '',
        sourceTable: sourceTableName.value,
        targetTable: genCfg.outputTable ?? '',
        inputFields: genCfg.inputFields ?? [],
        outputFields: genCfg.outputFields ?? [],
        inputFieldOptions: inputFieldOptions.value,
        outputFieldOptions: outputFieldOptions.value,
        systemPrompt: genCfg.systemPrompt ?? '',
        checkRule: isMonitor.value ? (cfg.value?.monitorMethods ?? []).join(',') || undefined : undefined,
      }), {
        file: selectedExcelFile.value ?? undefined,
        signal: controller.signal,
        onThinking: (delta) => {
          if (!delta) return
          generationState.value = 'thinking'
          thinkingText.value = `${thinkingText.value}${delta}`
        },
        onContent: (delta) => {
          if (!delta) return
          generationState.value = 'content'
          streamedScript += delta
          patch({ script: streamedScript })
        },
        onDone: (payload) => {
          generationState.value = 'done'
          generationMessage.value = payload.message || '保存完成'
          // 流式接口在 onDone 提示里带回保存路径（如「已保存到/code01/202609/x.py」），
          // 没有独立 scriptPath 字段——从 message 提取并 patch，否则「测试脚本」拿不到 codePath
          const savedPath = (payload.message || '').match(/保存到\s*([^\s]+)/)?.[1]
          if (savedPath) patch({ scriptPath: savedPath })
        },
      })
    } else {
      res = await ruleApi.orchestrationGenerate(genCfg, controller.signal)
    }
    // 流式分支的 scriptPath 由 onDone 从提示文本提取并 patch，res.scriptPath 为空——
    // 这里只有 res.scriptPath 有值时才覆盖，避免把流式提取到的路径清空
    patch({ script: res.script, ...(res.scriptPath ? { scriptPath: res.scriptPath } : {}) })
    if (isRule.value) {
      generationState.value = 'done'
      generationMessage.value = generationMessage.value || '保存完成'
    }
    ElMessage.success(isRule.value ? '脚本已生成' : '配置已生成')
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.message?.includes('已取消')) {
      ElMessage.info('已取消生成')
    } else {
      generationState.value = 'error'
      generationMessage.value = (e as Error)?.message ?? String(e)
      ElMessage.error(`生成${isRule.value ? '脚本' : '配置'}失败：${(e as Error)?.message ?? String(e)}`)
    }
  } finally {
    if (generateAbort.value === controller) generateAbort.value = null
    generating.value = false
  }
}

const workbenchOpen = ref(false)

const savingScript = ref(false)
const codeTestLoading = ref(false)
const codeTestResult = ref('')
const codeTestError = ref('')
const monitorCodeTestVisible = ref(false)

async function onSaveScript() {
  if (!orchCfg.value.script?.trim()) {
    ElMessage.warning(isRule.value ? '请先生成脚本' : '请先生成配置')
    return
  }
  // 文件服务按 scriptPath 原地覆盖写文件；scriptPath 为空时不能确定写入目标。
  // 开放手写脚本后，script 非空不再等价于已经生成过文件路径，因此这里必须显式校验。
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
    // 保存脚本文本直接写入当前节点的 scriptPath，不再调用已废弃的编排脚本编辑接口。
    const fileId = orchCfg.value.scriptPath.trim()
    const res = await ruleApi.fileUploadScript(fileId, orchCfg.value.script ?? '')
    patch({ mode: 'ref', scriptPath: fileId })
    // 数据监控节点：脚本保存成功后同步 ck_source（失败不回滚，单独提示）。
    // 同步实现在 utils/flow/monitorCkSource.ts——2026-09-07 起 NodeInspector 底部「保存」
    //（编排配置 Tab）也触发同一条同步，两处共用保证 payload 口径一致。
    if (isMonitor.value) {
      try {
        await syncMonitorCkSource(flow.sourceCfg?.sourceId, cfg.value)
      } catch (e) {
        ElMessage.error(`监控源配置同步失败：${(e as Error)?.message ?? String(e)}`)
      }
    }
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
  // 非规则节点必须有自己的旧 compose 记录才能切换套用，否则只拷内容不带 ruleId 没有落点。
  if (!isVruleNumericRuleId(orchCfg.value.ruleId)) {
    if (!(await ensureLegacyComposeRuleId())) return
  }
  applyingSwitch.value = true
  try {
    const detail = await ruleApi.orchestrationDetail(target.ruleId)
    const sourceScriptPath = detail.scriptPath || target.scriptPath
    const script = sourceScriptPath ? await ruleApi.orchestrationLoadScript(sourceScriptPath).catch(() => '') : ''
    // 只拷内容当草稿，ruleId/scriptPath 不跟着换——这两个决定「保存脚本」实际写去哪，沿用源节点的
    // 会直接覆盖它的文件，不是"另存"（文件服务按 scriptPath 原地覆盖写，
    // 跟 ruleId 无关）。
    // scriptPath 清空，强制先点一次「生成配置」换成本节点
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

// ---- 测试脚本：普通规则处理仍切换到「数据视图」tab；数据监控脚本不需要行参数，直接执行 codePath ----
const canTest = computed(() => {
  const hasScript = !!(orchCfg.value.script?.trim() || orchCfg.value.scriptPath?.trim())
  const hasScriptPath = !!orchCfg.value.scriptPath?.trim()
  if (isMonitor.value) return hasScriptPath
  const hasInputTable = !!(
    orchCfg.value.inputTable?.trim()
    || orchCfg.value.inputTableId?.trim()
    || cfg.value?.inputTable?.trim()
    || cfg.value?.collectCfg?.inputTable?.trim()
  )
  return hasScript && hasInputTable
})
function formatCodeTestResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result, null, 2)
  } catch {
    return String(result)
  }
}
async function executeMonitorCode() {
  const codePath = orchCfg.value.scriptPath?.trim()
  if (!codePath) {
    ElMessage.warning('请先生成脚本')
    return
  }
  monitorCodeTestVisible.value = true
  codeTestLoading.value = true
  codeTestResult.value = ''
  codeTestError.value = ''
  try {
    const result = await ruleApi.executeCode({ codePath, timeout: 300 })
    codeTestResult.value = formatCodeTestResult(result)
    ElMessage.success('测试脚本执行完成')
  } catch (e) {
    const message = (e as Error)?.message ?? String(e)
    codeTestError.value = message
    ElMessage.error(`测试脚本失败：${message}`)
  } finally {
    codeTestLoading.value = false
  }
}
function goToDataView() {
  const query: Record<string, string> = { ...route.query } as Record<string, string>
  query.view = 'data'
  if (id.value) query.nodeId = id.value
  if (orchCfg.value.scriptPath?.trim()) query.scriptPath = orchCfg.value.scriptPath.trim()
  void router.replace({ path: '/canvas', query })
}
function onTestScript() {
  if (isMonitor.value) {
    void executeMonitorCode()
    return
  }
  goToDataView()
}
</script>

<template>
  <div v-if="isMonitor" class="rc-field rc-monitor-methods-field" data-testid="monitor-methods-field">
    <label>监控方法</label>
    <el-select
      class="rc-monitor-methods-select"
      :model-value="monitorMethods"
      multiple
      collapse-tags
      collapse-tags-tooltip
      clearable
      placeholder="选择监控方法"
      @update:model-value="setMonitorMethods"
    >
      <el-option v-for="m in MONITOR_METHODS" :key="m" :label="m" :value="m" />
    </el-select>
  </div>
  <div class="ni-section-title ni-section-title-row">
    <span>{{ isRule ? '设置业务规则' : '抓取配置' }}</span>
    <span class="ni-section-actions">
      <button class="rc-btn" type="button" @click="workbenchOpen = true">脚本编辑</button>
    </span>
  </div>
  <div class="rc-field">
    <textarea
      class="rc-input rc-textarea"
      :value="orchCfg.describe"
      :placeholder="describePlaceholder"
      @input="onDescribeChange"
    />
  </div>
  <div v-if="isRule" class="rc-model-row">
    <span class="rc-model-fields">
      <label class="rc-inline-field">
        <span>模型供应商</span>
        <el-select
          :model-value="orchCfg.modelProviderCode ?? ''"
          class="rc-inline-select"
          size="small"
          :loading="providerLoading"
          placeholder="模型供应商"
          data-testid="main-model-provider"
          @change="onModelProviderChange"
        >
          <el-option v-for="item in providerOptions" :key="item.providerCode" :label="item.providerName" :value="item.providerCode" />
        </el-select>
      </label>
      <label class="rc-inline-field">
        <span>模型</span>
        <el-select
          :model-value="orchCfg.modelCode ?? ''"
          class="rc-inline-select rc-inline-select-model"
          size="small"
          :loading="modelLoading"
          :disabled="!orchCfg.modelProviderCode || !providerOptions.length"
          placeholder="模型"
          data-testid="main-model"
          @change="onModelChange"
        >
          <el-option v-for="item in modelOptions" :key="item.modelCode" :label="item.modelName" :value="item.modelCode" />
        </el-select>
      </label>
    </span>
  </div>
  <div v-if="isRule" class="rc-generation-actions" data-testid="rule-generation-actions">
    <input
      ref="excelFileInput"
      class="rc-file-input"
      data-testid="main-excel-file-input"
      type="file"
      accept=".xls,.xlsx"
      @change="onExcelFileChange"
    />
    <button class="rc-btn rc-upload-btn" type="button" data-testid="main-upload-excel" @click="excelFileInput?.click()">
      <UploadFilled aria-hidden="true" />
      <span>{{ selectedExcelFile ? '更换 Excel' : '上传 Excel' }}</span>
    </button>
    <button
      class="rc-btn primary"
      type="button"
      :class="{ 'is-generating': generating }"
      data-testid="main-generate-script"
      :aria-label="generating ? '取消生成脚本' : generateLabel"
      :title="generating ? '取消生成脚本' : generateLabel"
      @click="generating ? onCancelGenerate() : onGenerateScript()"
    >
      <span v-if="generating" class="rc-stop-icon" data-testid="stop-generation-icon" aria-hidden="true" />
      <template v-else>{{ generateLabel }}</template>
    </button>
    <button
      class="rc-btn"
      type="button"
      :disabled="!canTest"
      data-testid="main-test-script"
      @click="onTestScript"
    >
      {{ codeTestLoading ? '测试中...' : '测试脚本' }}
    </button>
  </div>
  <div v-if="isRule && (selectedExcelFile || excelFileError)" class="rc-file-summary">
    <div v-if="selectedExcelFile" class="rc-file-selected">
      <span class="rc-file-name" :title="selectedExcelFile.name">{{ selectedExcelFile.name }}</span>
      <span class="rc-file-size">{{ formatExcelFileSize(selectedExcelFile.size) }}</span>
      <button type="button" class="rc-file-remove" title="移除 Excel 文件" aria-label="移除 Excel 文件" @click="removeExcelFile">
        <Delete aria-hidden="true" />
      </button>
    </div>
    <span v-if="excelFileError" class="rc-file-error">{{ excelFileError }}</span>
  </div>
  <div v-if="isRule && generationState !== 'done' && (generating || thinkingText.trim() || generationState === 'error')" class="rc-main-stream" data-testid="main-stream-thinking">
    <div class="rc-main-stream-head">
      <span>思考过程</span>
      <span>{{ generationState === 'error' ? '出错' : generating ? '生成中' : '已完成' }}</span>
    </div>
    <pre ref="mainThinkingRef" class="rc-main-stream-text">{{ thinkingText.trim() || (generating ? '等待模型返回思考过程…' : '暂无思考过程') }}</pre>
  </div>
  <div v-if="isRule && (orchCfg.script?.trim() || generationState === 'content' || generationState === 'done')" class="rc-main-result" data-testid="main-stream-result">
    <div class="rc-main-result-head">
      <span>生成结果</span>
      <button
        v-if="mainResultLabel"
        class="rc-main-result-link"
        type="button"
        :disabled="loadingResultScript"
        @click="downloadResultScriptToLocal"
      >
        {{ mainResultLabel }}
      </button>
    </div>
    <pre v-if="generating || generationState === 'content' || generationState === 'error'" ref="mainResultRef" class="rc-main-result-code">{{ orchCfg.script || '等待模型输出结果…' }}</pre>
  </div>
  <el-dialog v-model="monitorCodeTestVisible" title="脚本测试结果" width="820px" top="6vh" append-to-body data-testid="monitor-script-test-dialog">
    <div class="rc-code-test">
      <div class="rc-code-test-meta">
        <span>脚本路径</span>
        <b :title="orchCfg.scriptPath">{{ orchCfg.scriptPath || '未提供' }}</b>
      </div>
      <div v-if="codeTestLoading" class="rc-code-test-hint">测试中…</div>
      <div v-else-if="codeTestError" class="rc-code-test-hint error">{{ codeTestError }}</div>
      <pre v-else class="rc-code-test-output">{{ codeTestResult || '暂无返回结果' }}</pre>
    </div>
  </el-dialog>
  <AlertConfigPanel
    v-if="isMonitor"
    :node-id="id"
    :node-title="cfg?.title ?? ''"
    :source-label="sourceTableName"
    :script-path="orchCfg.scriptPath"
    @update:alert-config="setMonitorAlertConfig"
  />

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

  <div v-if="isRule && (providerError || modelError)" class="rc-help">{{ providerError || modelError }}</div>
  <!-- S6-1（方案 §4.1）：合并原 RuleScriptDialog（只读脚本查看）+ RuleSystemPromptDialog（编辑系统提示词）
       为一个双栏工作区——两个入口按钮（编辑系统提示词/全屏查看）现在打开同一个弹层，左右两栏一屏对照，
       面板内直接能生成/保存，不用退出去。 -->
  <RuleWorkbenchDialog
    v-model:open="workbenchOpen"
    :title="workbenchTitle"
    :script-label="scriptLabel"
    :system-prompt="orchCfg.systemPrompt ?? ''"
    :prompt-category="promptCategory"
    :prompt-list-category="promptListCategory"
    :prompt-category-groups="promptCategoryGroups"
    :input-table-name="sourceTableName"
    :output-table-name="orchCfg.outputTable"
    :source-id="isMonitor ? (cfg?.stepSourceId ?? '') : ''"
    :source-cron="isMonitor ? (cfg?.schedule?.cron ?? '') : ''"
    :thinking="thinkingText"
    :generation-state="generationState"
    :generation-message="generationMessage"
    :input-fields="orchCfg.inputFields ?? []"
    :output-fields="orchCfg.outputFields ?? []"
    :input-field-options="inputFieldOptions"
    :output-field-options="outputFieldOptions"
    :model-provider-code="orchCfg.modelProviderCode ?? ''"
    :model-code="orchCfg.modelCode ?? ''"
    :script="orchCfg.script ?? ''"
    :script-path="orchCfg.scriptPath"
    :generate-label="generateLabel"
    :save-label="saveLabel"
    :generating="generating"
    :saving="savingScript"
    :is-rule="isRule"
    :can-test="canTest"
    :describe="orchCfg.describe ?? ''"
    :describe-label="describeLabel"
    :hide-prompt-by-default="isRule"
    @update:system-prompt="onSystemPromptChange"
    @update:prompt-category="onPromptCategoryChange"
    @update:model-provider-code="onModelProviderChange"
    @update:model-code="onModelChange"
    @update:script="onScriptChange"
    @generate="onGenerateScript"
    @cancel-generate="onCancelGenerate"
    @save="onSaveScript"
    @test="onTestScript"
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
.rc-main-result-link { margin: 0; padding: 0; border: 0; background: transparent; color: #047857; font-size: 11px; font-weight: 700; cursor: pointer; text-align: right; }
.rc-main-result-link:disabled { opacity: 0.6; cursor: not-allowed; }
.rc-model-row { display: block; margin: -2px 0 8px; min-width: 0; }
.rc-model-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 10px; min-width: 0; }
.rc-inline-field { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; color: var(--rc-muted); font-size: 11px; font-weight: 600; }
.rc-inline-field > span { flex: 0 0 auto; white-space: nowrap; }
.rc-inline-select { width: 100%; min-width: 0; }
.rc-inline-select-model { min-width: 0; }
.rc-generation-actions { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; min-width: 0; }
.rc-generation-actions > .rc-btn { flex: 1 1 0; min-width: 0; white-space: nowrap; }
.rc-generation-actions > .rc-btn.is-generating { flex: 0 0 32px; width: 32px; padding: 0; }
.rc-upload-btn { gap: 6px; }
.rc-upload-btn svg { width: 14px; height: 14px; }
.rc-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.rc-file-summary { margin: -2px 0 10px; min-width: 0; }
.rc-file-selected { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 4px 6px 4px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-size: 11px; }
.rc-file-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-file-size { flex: none; color: var(--rc-faint); font-variant-numeric: tabular-nums; }
.rc-file-remove { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; background: transparent; color: var(--rc-muted); cursor: pointer; }
.rc-file-remove:hover { color: #dc2626; }
.rc-file-remove svg { width: 14px; height: 14px; }
.rc-file-error { color: #b91c1c; font-size: 11px; line-height: 1.4; }
.rc-stop-icon { display: block; width: 10px; height: 10px; border-radius: 1px; background: currentColor; }
.rc-main-stream, .rc-main-result { margin: 10px 0 12px; border: 1px solid #dbe3ee; border-radius: 8px; overflow: hidden; background: #fff; }
.rc-main-stream { border-color: #1e293b; background: #0b1220; }
.rc-main-stream-head, .rc-main-result-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; }
.rc-main-stream-head { background: #111827; color: #e5eefc; }
.rc-main-stream-head span:last-child { color: #93c5fd; font-size: 11px; }
.rc-main-result-head { background: #f8fafc; color: var(--rc-text); border-bottom: 1px solid #eef2f7; }
.rc-main-result-head span:last-child { color: #047857; font-size: 11px; }
.rc-main-stream-text, .rc-main-result-code { margin: 0; max-height: 180px; overflow: auto; padding: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.rc-main-stream-text { color: #cbd5e1; border-top: 1px solid #1e293b; }
.rc-main-result-code { color: #dbeafe; background: #0f172a; }
.rc-code-test { display: flex; flex-direction: column; gap: 10px; }
.rc-code-test-meta { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--rc-text-2); }
.rc-code-test-meta span { color: var(--rc-faint); font-size: 11px; }
.rc-code-test-meta b { font-family: var(--rc-mono, monospace); word-break: break-all; }
.rc-code-test-hint { padding: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; color: var(--rc-text-2); font-size: 12px; line-height: 1.6; }
.rc-code-test-hint.error { border-color: #fecaca; background: #fef2f2; color: #b91c1c; word-break: break-all; }
.rc-code-test-output { margin: 0; padding: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #0f172a; color: #dbeafe; font-family: var(--rc-mono, monospace); font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; min-height: 180px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ni-section-title { margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; font-weight: 700; }
.ni-section-title:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.ni-section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ni-section-actions { display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px; flex: none; }
.ni-section-title-row .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.rc-list { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.rc-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-top: 1px solid #eef2f7; font-size: 11px; color: var(--rc-text-2); }
.rc-list-row:first-child { border-top: 0; }
.rc-list-row b { color: var(--rc-text); font-weight: 600; flex-shrink: 0; }
.rc-list-row span, .rc-link-btn { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
.rc-link-btn { border: 0; background: transparent; color: var(--rc-primary); font: inherit; cursor: pointer; padding: 0; }
.rc-link-btn:hover { text-decoration: underline; }
.rc-link-btn:disabled { color: var(--rc-faint); cursor: not-allowed; text-decoration: none; }
.ni-rule-meta { margin: 10px 0 8px; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
</style>
