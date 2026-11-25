<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElButton, ElDrawer, ElMessage, ElMessageBox } from 'element-plus'
import { dataApi, fetchDefaultModels, fetchModelProviders, ruleApi, sourceApi } from '@/api'
import type { EntryType } from '@/api/types/collect'
import type { EntryTypeGroup } from '@/api/types/data'
import type { MonitorCheckConf, MonitorKind, MonitorRecordView } from '@/api/types/monitorCenter'
import type { ModelOption, ModelProviderOption } from '@/api/types/rule'
import { loadMonitorRecord, saveMonitor } from '@/api/monitorCenter'
import { checkOneManual } from '@/api/monitor'
import { defaultSystemPrompt, methodLabel } from '@/utils/monitor/methods'
import PromptAiEditor from '@/components/PromptAiEditor.vue'
import PromptTemplatePicker from '../inspector/PromptTemplatePicker.vue'
import type { NodePromptTemplate } from '@/api/nodePrompts'
import { loadMonitorPromptTemplate, monitorUserPrompt, prepareMonitorUserPrompt, templateSystemPrompt, type MonitorPromptInput } from './monitor-editor/promptTemplate'
import {
  archiveStatusText,
  defaultMonitorDirectory,
  defaultMonitorRepo,
  generateMonitorScriptWithAgent,
  loadAgentGenerationOptions,
  loadMonitorDirectories,
  monitorScriptPath,
} from './monitor-editor/agentGeneration'
import type { CodeRepository, CodeRepositoryDirectory, GeneratedCodeArchive, ModelInterface } from '@/api/runnerManagement'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import AiMethodsField from './monitor-editor/AiMethodsField.vue'
import SourcePickerRemote from './monitor-editor/SourcePickerRemote.vue'
import {
  DEFAULT_SCHEDULE,
  buildSaveFeedback,
  confFromForm,
  effectiveScriptOf,
  effectiveScriptPathOf,
  emptyForm,
  formFromRecord,
  formSignature,
  needsRegenerate,
  nextVersionOf,
  normalizeWindowHours,
  regenerateReasons,
  scheduleIntervalHours,
  looksLikeTimeColumn,
  timeColumnOptionsOf,
  validateForm,
  versionOf,
  windowOfForm,
} from './monitor-editor/model'
import './monitor-editor/dialog.css'
import { EXEC_TEXT } from '@/utils/monitor/record'
import type { MonitorEditorForm } from './monitor-editor/model'
import {
  augmentMonitorSystemPrompt,
  generateMonitorScript,
  resolveMonitorMetadataFields,
  resolveMonitorTableFields,
  resolveSourceResultContext,
  summarizeExecutionResult,
  testMonitorScript,
  testMonitorScriptWithRunner,
} from './monitor-editor/generation'

/**
 * 监控编辑弹窗（1111 规格第五/六节）。
 *
 * 三层状态必须分开，否则回执会假报成功（T01/T02）：
 * 1. recordState —— 服务端已生效的记录（含生效脚本正文/路径）；
 * 2. candidate —— 页面新生成、尚未保存的候选脚本；
 * 3. form —— 用户正在编辑但未保存的字段。
 * 只有「生成 → 保存」才会发布候选。智能体模式可先保存无脚本的草稿取 ID。
 */
const props = withDefaults(defineProps<{
  siteId?: string
  sourceId?: string
  record?: MonitorRecordView | null
  sourceLocked?: boolean
}>(), {
  siteId: '',
  sourceId: '',
  record: null,
  sourceLocked: false,
})

const emit = defineEmits<{
  saved: [record: MonitorRecordView | null]
  /** 新建监控生成脚本前先存的草稿（拿监控 ID）：容器只刷新列表，不关编辑器 */
  'draft-saved': [record: MonitorRecordView]
  cancel: []
}>()

const TABS = [
  { key: 'basic', label: '基本信息' },
  { key: 'check', label: '检查方式' },
  { key: 'plan', label: '执行计划' },
  { key: 'notify', label: '通知' },
] as const
type TabKey = typeof TABS[number]['key']

const NOTIFY_OPTIONS = [
  { value: 'error', label: '仅异常时', hint: '（默认）检查不通过才通知' },
  // 执行器 should_notify：ok = 每次结论正常都建通知事件，没有「异常转正常只发一次」的恢复语义。
  { value: 'ok', label: '仅正常时', hint: '每次检查通过都通知（不是只在恢复时发一次）' },
  { value: 'all', label: '每次运行', hint: '每次结果都通知，噪音大' },
  { value: 'none', label: '静默', hint: '只记录结果，不发送通知' },
] as const

const activeTab = ref<TabKey>('basic')
const form = reactive<MonitorEditorForm>(emptyForm())
/** 历史记录可能已勾钉钉：只有这种情况下允许操作该复选框（用于取消），并提示收不到 */
const dingtalkSelected = computed(() => form.channels.includes('dingtalk'))
const recordState = ref<MonitorRecordView | null>(props.record ?? null)
const committedForm = ref<MonitorEditorForm>({ ...emptyForm() })
const baseline = ref(formSignature(form))
const promptTemplates = ref<NodePromptTemplate[]>([])
const defaultPromptTemplate = ref<NodePromptTemplate | null>(null)
const promptTemplate = computed(() => form.promptTemplateId
  ? promptTemplates.value.find(row => row.promptId === form.promptTemplateId) ?? null
  : defaultPromptTemplate.value)
const promptTemplateError = ref('')
const promptTemplateLoaded = ref(false)
const promptTab = ref<'system' | 'user'>('user')
const systemTouched = ref(false)
const customPromptScope = ref('')
const acknowledgedPromptScope = ref('')
const advancedOpen = ref(false)
const preflighting = ref(false)
const draftConfirmationFailed = ref(false)
const loading = ref(false)
const loadError = ref('')
const tableOptions = ref<Array<{ tableId: string; tableName: string; label: string }>>([])
const timeColumnFields = ref<string[]>([])
const metadataTimeFields = ref<Array<{ name: string; label: string; type: string }>>([])
const timeColumnError = ref('')
const timeColumnsLoading = ref(false)
const timeColumnSelected = ref(false)
const providerOptions = ref<ModelProviderOption[]>([])
const modelOptions = ref<ModelOption[]>([])
const saving = ref(false)
const busy = computed(() => saving.value || generating.value || testing.value || preflighting.value)
let sourceRequest = 0
let modelRequest = 0
let timeColumnRequest = 0
onBeforeUnmount(() => { sourceRequest += 1; modelRequest += 1; timeColumnRequest += 1; stopElapsedTimer() })

/** 页面候选脚本：只存在内存里，保存成功后才进入记录（生成不自动保存） */
const candidate = reactive({ script: '', scriptPath: '' })
const pending = ref(false)
const generating = ref(false)
const generatingPreview = ref('')
/** 生成过程中的思考文本（vibecoding 式过程展示，只保留最新片段） */
const generatingThinking = ref('')
const generatingElapsed = ref(0)
const streamRef = ref<HTMLElement | null>(null)
/** 脚本正文默认折叠到固定高度，避免长脚本把弹窗撑爆 */
const scriptExpanded = ref(false)
let elapsedTimer: number | undefined

function startElapsedTimer(): void {
  generatingElapsed.value = 0
  const startedAt = Date.now()
  window.clearInterval(elapsedTimer)
  elapsedTimer = window.setInterval(() => {
    generatingElapsed.value = (Date.now() - startedAt) / 1000
  }, 200)
}

function stopElapsedTimer(): void {
  window.clearInterval(elapsedTimer)
  elapsedTimer = undefined
}

async function scrollStreamToEnd(): Promise<void> {
  await nextTick()
  const el = streamRef.value
  if (el) el.scrollTop = el.scrollHeight
}

/**
 * 思考内容是**增量**推送的（generation.ts 透传每个 delta）。
 * 之前误当成全量、只取最后 160 字，界面上就只剩孤零零一个词，看着像坏了。
 * 这里累积全文，超长只保留尾部，交给 `<pre>` 自己滚动。
 */
const THINKING_LIMIT = 6000

function appendThinking(prev: string, delta: string): string {
  const text = `${prev}${delta}`
  return text.length > THINKING_LIMIT ? `…${text.slice(-THINKING_LIMIT)}` : text
}

async function onCopyScript(): Promise<void> {
  const text = displayedScript.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制脚本（${text.length} 字）`)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    document.body.removeChild(area)
    ElMessage.success(`已复制脚本（${text.length} 字）`)
  }
}

const generationError = ref('')
const preflightError = ref('')

/**
 * 智能体生成（1117 第 2 批）：生成方式 = 智能体时选智能体 / 仓库 / 目录，产物提交 Git。
 * 选项只在切到智能体模式（或打开的记录本来就是智能体模式）时加载，内置模式不碰 Runner 服务。
 */
const agentOptions = ref<ModelInterface[]>([])
const repoOptions = ref<CodeRepository[]>([])
const directoryOptions = ref<CodeRepositoryDirectory[]>([])
const agentOptionsError = ref('')
const directoryError = ref('')
const agentOptionsLoading = ref(false)
const agentOptionsLoaded = ref(false)
/** 本次智能体生成的归档（提交状态展示用）；保存后以 form.archiveId 为准 */
const candidateArchive = ref<GeneratedCodeArchive | null>(null)
let directoryRequest = 0

async function loadAgentOptions(): Promise<void> {
  if (agentOptionsLoading.value) return
  agentOptionsLoading.value = true
  try {
    const result = await loadAgentGenerationOptions()
    agentOptions.value = result.agents
    repoOptions.value = result.repos
    agentOptionsError.value = [result.agentError && `智能体加载失败：${result.agentError}`, result.repoError && `代码仓库加载失败：${result.repoError}`]
      .filter(Boolean).join('；')
    agentOptionsLoaded.value = true
    const wasClean = formSignature(form) === baseline.value
    if (!form.agentInterfaceId || !result.agents.some(agent => agent.id === form.agentInterfaceId)) form.agentInterfaceId = result.agents[0]?.id || ''
    if (!form.repoId || !result.repos.some((repo) => repo.repoId === form.repoId)) form.repoId = defaultMonitorRepo(result.repos) || form.repoId
    if (wasClean) baseline.value = formSignature(form)
    await loadDirectories()
  } finally {
    agentOptionsLoading.value = false
  }
}

async function loadDirectories(): Promise<void> {
  const request = ++directoryRequest
  directoryOptions.value = []
  directoryError.value = ''
  if (!form.repoId) return
  try {
    const rows = await loadMonitorDirectories(form.repoId)
    if (request !== directoryRequest) return
    directoryOptions.value = rows
    const wasClean = formSignature(form) === baseline.value
    if (!rows.some((row) => row.directoryId === form.directoryId)) form.directoryId = defaultMonitorDirectory(rows)
    if (wasClean) baseline.value = formSignature(form)
    if (!rows.length) directoryError.value = '该仓库没有启用的数据监控（610）目录，请先在「系统设置 → 代码仓库」配置'
  } catch (error) {
    if (request === directoryRequest) directoryError.value = `仓库目录加载失败：${errorText(error)}`
  }
}

function switchGenerationMode(mode: 'builtin' | 'agent'): void {
  if (form.generationMode === mode) return
  preflightError.value = ''
  form.generationMode = mode
  if (mode === 'agent' && !agentOptionsLoaded.value) void loadAgentOptions()
}

function onRepoChange(): void {
  form.directoryId = ''
  void loadDirectories()
}

const archiveText = computed(() => archiveStatusText(candidateArchive.value)
  // 已保存的智能体记录：只有归档 ID（提交详情要等后端按 archiveId 单条查询，契约 4）
  || (form.generationMode === 'agent' && form.archiveId ? `已归档 ${form.archiveId.slice(0, 8)}` : ''))
const testing = ref(false)
const testResult = ref<null | {
  label: string
  target: string
  summary: string
  note: string
  at: string
}>(null)

const isEditing = computed(() => !!recordState.value)
const sourceLockedEffective = computed(() => props.sourceLocked || !!recordState.value)
const isDirty = computed(() => formSignature(form) !== baseline.value || pending.value)
const lockedSourceLabel = computed(() => {
  const sourceId = form.sourceId.trim()
  if (!sourceId) return '未指定'
  return form.sourceName ? `${form.sourceName}（${sourceId}）` : sourceId
})

const effectiveScript = computed(() => effectiveScriptOf(recordState.value?.conf))
const effectivePath = computed(() => effectiveScriptPathOf(recordState.value?.conf))
const displayedScript = computed(() => (pending.value ? candidate.script : effectiveScript.value))
const activePath = computed(() => (pending.value ? candidate.scriptPath : effectivePath.value))
const hasAnyScript = computed(() => !!displayedScript.value.trim() || !!activePath.value.trim())
const canTest = computed(() => hasAnyScript.value)

interface ScriptFileView { name: string; path: string; body: string; label: string }
const scriptFile = computed<ScriptFileView>(() => {
  const path = activePath.value.trim()
  const name = path.split(/[\\/]/).pop() || `monitor-${recordState.value?.id || form.sourceId || 'draft'}-${pending.value ? 'candidate' : form.version || 'draft'}.py`
  return {
    name: name.endsWith('.py') ? name : `${name}.py`, path, body: displayedScript.value,
    label: pending.value ? '待保存候选' : '已保存脚本',
  }
})
const filePreviewOpen = ref(false)
const previewFile = ref<ScriptFileView | null>(null)
const filePreviewError = ref('')
const filePreviewLoading = ref(false)
const downloadingScript = ref(false)
let filePreviewRequest = 0
onBeforeUnmount(() => { filePreviewRequest += 1 })

async function readScriptFile(file: ScriptFileView): Promise<string> {
  const body = file.body.trim() ? file.body : await ruleApi.fileDownloadScript(file.path)
  if (!body.trim()) throw new Error('脚本文件为空，暂时无法预览或下载')
  return body
}

async function onPreviewScript(): Promise<void> {
  const file = { ...scriptFile.value }
  const request = ++filePreviewRequest
  previewFile.value = file
  filePreviewError.value = ''
  filePreviewOpen.value = true
  filePreviewLoading.value = true
  try {
    const body = await readScriptFile(file)
    if (request === filePreviewRequest) previewFile.value = { ...file, body }
  } catch (error) {
    if (request === filePreviewRequest) filePreviewError.value = errorText(error)
  } finally {
    if (request === filePreviewRequest) filePreviewLoading.value = false
  }
}

async function onDownloadScript(file: ScriptFileView = scriptFile.value): Promise<void> {
  if (downloadingScript.value) return
  downloadingScript.value = true
  try {
    const body = await readScriptFile(file)
    const url = URL.createObjectURL(new Blob([body], { type: 'text/x-python;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch (error) {
    ElMessage.error(`下载脚本失败：${errorText(error)}`)
  } finally {
    downloadingScript.value = false
  }
}

/**
 * 底部主按钮：AI 检查有脚本才可能「生效」，没脚本只能是草稿；
 * 有脚本但计划为空时保存后不会自动跑，按钮明确写「仅手动」。
 * 规则检查切过来时会自动补 DEFAULT_SCHEDULE（见 switchKind），保持「保存并生效」。
 */
const saveLabel = computed(() => {
  if (form.kind !== 'ai') return '保存并生效'
  if (!hasAnyScript.value) return '保存为草稿'
  return form.schedule.trim() ? '保存并生效' : '保存（仅手动）'
})

const saveHint = computed(() => {
  if (form.kind === 'ai') {
    if (!hasAnyScript.value) return '没有可执行脚本：保存后为草稿，启用也不会执行'
    if (!form.schedule.trim()) return '有脚本但未设执行计划：保存后只能手动运行；需要定时请填写执行计划'
  }
  return '生成与测试不改变生效版本；保存即生效'
})

const timeColumnOptions = computed(() => {
  const physical = timeColumnFields.value
  const options = metadataTimeFields.value.length
    ? metadataTimeFields.value.filter(field => !physical.length || physical.includes(field.name))
      .filter(field => /入库|采集|抓取|创建|发布|时间|日期/.test(field.label)
      || /date|time/i.test(field.type) || looksLikeTimeColumn(field.name))
      .sort((a, b) => Number(!/入库|采集|抓取|创建/.test(a.label)) - Number(!/入库|采集|抓取|创建/.test(b.label)))
      .map(field => ({ value: field.name, label: field.label === field.name ? field.name : `${field.label}（${field.name}）` }))
    : timeColumnOptionsOf(timeColumnFields.value).filter(field => timeColumnFields.value.includes(field))
      .map(value => ({ value, label: value }))
  const current = form.timeColumn.trim()
  if (current && !options.some(option => option.value === current)) options.unshift({ value: current, label: current })
  return options
})
const selectedTimeLabel = computed(() => timeColumnOptions.value.find(option => option.value === form.timeColumn)?.label
  || form.timeColumn || '不限时间（全表检查）')
/** 「上一个周期」的窗口长度 = 当前执行计划间隔（算不出来按 24 小时） */
const windowPeriodHours = computed(() => scheduleIntervalHours(form.schedule))
const windowHint = computed(() => {
  if (form.windowType === 'hours') {
    return `执行器按最近 ${normalizeWindowHours(form.windowHours)} 小时算好 DQ_START_DATE / DQ_END_DATE 再跑脚本`
  }
  if (form.windowType === 'period') {
    return `按当前计划间隔约 ${windowPeriodHours.value} 小时取上一个周期（算不出间隔时按 24 小时）`
  }
  return '按业务时区 Asia/Shanghai，从当日 00:00 到执行时刻'
})
function windowDescription(input: MonitorEditorForm): string {
  if (input.windowType === 'hours') return `最近 ${normalizeWindowHours(input.windowHours)} 小时（Asia/Shanghai 业务时区）`
  if (input.windowType === 'period') return `上一个检查周期（约 ${scheduleIntervalHours(input.schedule)} 小时，Asia/Shanghai 业务时区）`
  return '当日 00:00 至当前（Asia/Shanghai 业务时区）'
}
const descriptionWindow = computed(() => form.timeColumn ? windowDescription(form) : '不限时间（全表检查）')

const versionText = computed(() => {
  const current = form.version || versionOf(recordState.value?.conf)
  if (pending.value) return `新生成，尚未保存（候选 ${nextVersionOf(current)}）`
  if (effectiveScript.value || effectivePath.value) return `生效中的脚本 ${current || ''}（只读）`
  return recordState.value ? '草稿 · 未生效，不执行' : '未保存 · 尚未生成脚本'
})

const recordStatusText = computed(() => {
  if (!recordState.value) return ''
  if (form.kind === 'ai') {
    return effectiveScript.value || effectivePath.value
      ? `已生效 ${form.version || versionOf(recordState.value.conf) || ''}`.trim()
      : '草稿 · 未生效，不执行'
  }
  return '规则检查 · 已生效'
})

const needsRegenerateNotice = computed(() => {
  if (form.kind !== 'ai' || pending.value) return ''
  if (!hasAnyScript.value) return ''
  const reasons = regenerateReasons(form, committedForm.value)
  if (!reasons.length) return ''
  return `${reasons.join('、')}有改动：保存后计划/通知会生效，但检查逻辑仍是 ${form.version || '当前版本'}，需重新生成脚本才会改变`
})

/** 生成候选时的检查范围；表/时间列之后被改，就说明候选可能对不上当前范围 */
const candidateScope = ref<{ tableName: string; timeColumn: string; mode: MonitorEditorForm['generationMode']; signature: string } | null>(null)
const scriptInputSignature = computed(() => JSON.stringify([
  promptScope.value, form.desc, form.systemPrompt, form.providerCode, form.modelCode,
  form.agentInterfaceId, form.repoId, form.directoryId,
]))

const candidateStale = computed(() => {
  const scope = candidateScope.value
  if (!pending.value || !scope) return false
  return scope.signature !== scriptInputSignature.value
})

/**
 * 候选脚本按旧范围生成时的提示。这里不直接作废：用户可能只是想换个表看看，
 * 真到保存（会把脚本按新表发布）时再确认一次，给他重新生成的机会。
 */
const candidateStaleNotice = computed(() => {
  const scope = candidateScope.value
  if (!candidateStale.value || !scope) return ''
  if (scope.mode !== form.generationMode) return '候选脚本的生成方式已变更。请重新生成或切回原生成方式后再保存。'
  if (scope.tableName === form.tableName.trim() && scope.timeColumn === form.timeColumn.trim()) {
    return '生成后检查配置已变更。保存前请重新生成，或确认仍使用当前候选脚本。'
  }
  const now = [form.tableName, form.timeColumn].filter(Boolean).join(' · ') || '未选表'
  return `候选脚本是按「${scope.tableName || '未选表'}」生成的；当前范围已改为「${now}」。保存前请重新生成，或确认仍按旧脚本发布。`
})

const importHint = computed(() => (form.kind === 'ai' ? 'AI 脚本检查' : '规则检查'))

function stamp(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

/**
 * 试跑回执里的检查范围：表 + 入库时间字段。生成、试跑、保存、正式运行必须回显同一份范围
 *（1113 修订稿 §7.9），所以试跑结果不能只说「生效 v3 的脚本」。
 */
/** 试跑对象的描述：候选过期时把「按哪张表生成」也写出来，避免看错范围 */
function testTarget(): string {
  if (pending.value) {
    const scope = candidateScope.value
    const stale = candidateStale.value && scope ? ` · 按「${scope.tableName || '未选表'}」生成` : ''
    return `新生成、尚未保存的脚本（候选）${stale}${scopeText()}`
  }
  const version = form.version || versionOf(recordState.value?.conf) || '当前'
  return `生效 ${version} 的脚本${scopeText()}`
}

function scopeText(): string {
  const parts: string[] = []
  if (form.tableName.trim()) parts.push(`表 ${form.tableName.trim()}`)
  if (form.timeColumn.trim()) parts.push(`时间列 ${form.timeColumn.trim()}`)
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function syncCommitted(): void {
  committedForm.value = { ...form, methods: [...form.methods], channels: [...form.channels] }
  baseline.value = formSignature(form)
}

function applyRecord(record: MonitorRecordView): void {
  recordState.value = record
  const next = formFromRecord(record)
  Object.assign(form, next)
  systemTouched.value = !!next.systemPrompt.trim()
  timeColumnSelected.value = !!next.timeColumn
  customPromptScope.value = promptScope.value
  acknowledgedPromptScope.value = ''
  if (promptTemplateLoaded.value) classifyStoredPrompt(next)
  candidate.script = ''
  candidate.scriptPath = ''
  candidateScope.value = null
  pending.value = false
  generationError.value = ''
  preflightError.value = ''
  draftConfirmationFailed.value = false
  generatingPreview.value = ''
  syncCommitted()
  candidateArchive.value = null
  void loadSourceContext()
  if (form.generationMode === 'agent' && !agentOptionsLoaded.value) void loadAgentOptions()
}

function promptInput(input: MonitorEditorForm = form): MonitorPromptInput {
  return {
    sourceId: input.sourceId, sourceName: input.sourceName, tableName: input.tableName,
    timeColumn: input.timeColumn || '不限时间（全表检查）', methods: input.methods,
    window: input.timeColumn ? windowDescription(input) : '不限时间（全表检查）',
    nullPolicy: input.nullPolicy, noDataPolicy: input.noDataPolicy,
    overdue: input.overdueMinutes ? `超期判定：${input.overdueMinutes} 分钟无新增，宽限 ${input.overdueGrace || '0'} 分钟。` : '',
    generationMode: input.generationMode,
  }
}

const promptScope = computed(() => JSON.stringify([
  form.sourceId, form.tableName, [...form.methods].sort(), form.timeColumn, descriptionWindow.value,
  form.nullPolicy, form.noDataPolicy, form.overdueMinutes, form.overdueGrace, form.generationMode,
]))
const promptScopeChanged = computed(() => form.promptCustom === true && customPromptScope.value !== promptScope.value)
const promptConflict = computed(() => promptScopeChanged.value && acknowledgedPromptScope.value !== promptScope.value)
const autoUserPrompt = computed(() => monitorUserPrompt(promptTemplate.value, promptInput()))
const autoSystemPrompt = computed(() => templateSystemPrompt(promptTemplate.value, promptInput()) ?? defaultSystemPrompt())
const displayUserPrompt = computed(() => form.desc.replace(
  /\{\{\s*(?:file_name|code_dir|code_file_path|code_save_requirement|reference_files)\s*\}\}/g,
  '生成时由平台自动填入',
))
const activePrompt = computed(() => promptTab.value === 'user' ? displayUserPrompt.value : form.systemPrompt)
const selectedPromptId = computed(() => form.promptCustom || systemTouched.value ? 0
  : form.promptTemplateId ?? promptTemplate.value?.promptId ?? 0)
/** 模板下拉里「未选模板」那一项的文案：没改过但也没有模板可用（读取失败 / 未配置）时是内置默认，不是「自定义」 */
const promptCurrentLabel = computed(() => form.promptCustom || systemTouched.value || form.promptTemplateId
  ? '当前提示词（自定义）'
  : promptTemplate.value ? '当前提示词' : '内置默认提示词')
/** 提示词回退到内置默认（模板读取失败或未配置）：能生成，但在检查清单里用提示图标标出 */
const promptFallback = computed(() => promptTemplateLoaded.value && !promptTemplate.value && !form.promptTemplateId && !form.promptCustom)
const promptSourceText = computed(() => {
  if (!promptTemplateLoaded.value) return '正在读取数据监控提示词模板…'
  if (form.promptTemplateId && !promptTemplate.value) return promptTemplateError.value
    ? `提示词模板读取失败（${promptTemplateError.value}），保留已保存的提示词`
    : '当前引用的提示词模板已停用或不可用，请重新选择'
  if (promptTemplate.value) return `来自节点提示词模板「${promptTemplate.value.promptName || promptTemplate.value.promptId}」`
  if (promptTemplateError.value) return `提示词模板读取失败（${promptTemplateError.value}），使用内置默认`
  return '未配置数据监控（610）提示词模板，使用内置默认'
})

function classifyStoredPrompt(stored: MonitorEditorForm): void {
  const input = promptInput(stored)
  if (stored.systemPrompt.trim() && stored.systemPrompt === form.systemPrompt) {
    const defaultSystem = templateSystemPrompt(promptTemplate.value, input) ?? defaultSystemPrompt()
    systemTouched.value = stored.systemPrompt !== defaultSystem
  }
  if (!stored.desc.trim() || stored.promptCustom !== undefined || form.promptCustom !== undefined) return
  const legacy = { ...input, window: windowDescription(stored), timeColumn: stored.timeColumn, overdue: undefined, generationMode: undefined }
  const matchesDefault = (!stored.promptTemplateId || promptTemplate.value)
    && [monitorUserPrompt(promptTemplate.value, input), monitorUserPrompt(promptTemplate.value, legacy),
      monitorUserPrompt(null, legacy)].includes(stored.desc.trim())
  form.promptCustom = !matchesDefault
  if (matchesDefault && !form.promptTemplateId) form.promptTemplateId = promptTemplate.value?.promptId
}

function syncAutoPrompts(): void {
  if (!promptTemplateLoaded.value || form.kind !== 'ai' || (form.promptTemplateId && !promptTemplate.value)) return
  const wasClean = formSignature(form) === baseline.value
  if (!form.promptCustom) form.desc = autoUserPrompt.value
  if (!systemTouched.value && (!recordState.value || form.systemPrompt)) form.systemPrompt = autoSystemPrompt.value
  if (wasClean) syncCommitted()
}

async function loadPromptTemplate(): Promise<void> {
  const { template, templates, error } = await loadMonitorPromptTemplate()
  const wasClean = formSignature(form) === baseline.value
  promptTemplates.value = templates
  defaultPromptTemplate.value = template
  promptTemplateError.value = error
  if (recordState.value) classifyStoredPrompt(formFromRecord(recordState.value))
  else form.promptTemplateId = template?.promptId
  promptTemplateLoaded.value = true
  if (wasClean) baseline.value = formSignature(form)
  syncAutoPrompts()
}

function restoreUserPrompt(): void {
  if (form.promptTemplateId && !promptTemplate.value) form.promptTemplateId = undefined
  form.promptCustom = false
  acknowledgedPromptScope.value = ''
  form.desc = autoUserPrompt.value
}

function restoreSystemPrompt(): void {
  if (form.promptTemplateId && !promptTemplate.value) form.promptTemplateId = undefined
  systemTouched.value = false
  form.systemPrompt = autoSystemPrompt.value
}

function applyPromptEdit(value: string): void {
  if (busy.value) return
  if (promptTab.value === 'system') {
    systemTouched.value = true
    form.systemPrompt = value
  } else {
    if (!form.promptCustom) customPromptScope.value = promptScope.value
    form.promptCustom = true
    form.desc = value
  }
}

async function selectPromptTemplate(id: number): Promise<void> {
  if (busy.value || id === selectedPromptId.value) return
  if (!id) {
    customPromptScope.value = promptScope.value
    form.promptCustom = true
    return
  }
  if (!promptTemplates.value.some(row => row.promptId === id)) return
  if (form.promptCustom || systemTouched.value) {
    try {
      await ElMessageBox.confirm('切换提示词将替换当前系统和用户提示词，是否继续？', '切换提示词', {
        confirmButtonText: '切换', cancelButtonText: '保留当前内容', type: 'warning',
      })
    } catch { return }
  }
  form.promptTemplateId = id
  restoreUserPrompt()
  restoreSystemPrompt()
}

function initialize(): void {
  const record = props.record
  if (record) {
    applyRecord(record)
  } else {
    form.sourceId = props.sourceId || ''
    form.sourceName = ''
    form.name = ''
    form.kind = 'ai'
    form.methods = ['today_landed', 'daily_count']
    form.promptCustom = false
    baseline.value = formSignature(form)
    committedForm.value = { ...form, methods: [...form.methods], channels: [...form.channels] }
    void loadSourceContext()
  }
  void loadModels()
  void loadPromptTemplate()
  if (form.generationMode === 'agent' && !agentOptionsLoaded.value) void loadAgentOptions()
}

onMounted(initialize)

watch(() => props.record, (record) => {
  if (record) applyRecord(record)
})

watch(() => props.sourceId, (sourceId) => {
  if (recordState.value) return
  if (!sourceId || sourceId === form.sourceId) return
  resetSourceScope(sourceId, '')
  void loadSourceContext()
})

watch([autoUserPrompt, autoSystemPrompt, () => form.kind], syncAutoPrompts)

function applyTimeColumnFields(autoSelect: boolean): void {
  if (!autoSelect || timeColumnSelected.value) return
  const options = timeColumnOptions.value
  const preferred = ['create_time', 'insert_time', 'crawl_time', 'update_time']
    .map(name => options.find(option => option.value.toLowerCase() === name))
    .find(Boolean)
  form.timeColumn = preferred?.value || options[0]?.value || ''
}

/** 换表后刷新执行器字段；读取失败时用表目录提供候选。 */
function syncTimeColumnFields(autoSelect = !recordState.value): void {
  timeColumnFields.value = []
  metadataTimeFields.value = []
  if (form.tableName.trim()) void loadTimeColumnFields(autoSelect)
  else {
    timeColumnRequest += 1
    timeColumnsLoading.value = false
    timeColumnError.value = ''
  }
}

async function loadTimeColumnFields(autoSelect = false): Promise<void> {
  const request = ++timeColumnRequest
  const tableName = form.tableName.trim()
  if (!tableName) return
  const tableId = tableOptions.value.find(table => table.tableName === tableName)?.tableId
  timeColumnsLoading.value = true
  try {
    let fields: string[] = []
    let metadata: typeof metadataTimeFields.value = []
    let failure = ''
    try {
      fields = await resolveMonitorTableFields({ tableName, tableId: tableId ?? '' })
    } catch (error) {
      failure = errorText(error)
    }
    if (failure || (fields.length && !fields.some(looksLikeTimeColumn))) {
      metadata = await resolveMonitorMetadataFields({ tableName, tableId }).catch(() => [])
    }
    if (request !== timeColumnRequest || form.tableName.trim() !== tableName) return
    const wasClean = formSignature(form) === baseline.value
    timeColumnFields.value = fields.map(field => field.trim()).filter(Boolean)
    metadataTimeFields.value = metadata
    timeColumnError.value = failure
    applyTimeColumnFields(autoSelect)
    if (wasClean) baseline.value = formSignature(form)
  } finally {
    if (request === timeColumnRequest) timeColumnsLoading.value = false
  }
}

function mergeTableOptions(group: EntryTypeGroup | null): void {
  const merged: EntryType[] = [...(group?.list2 ?? []), ...(group?.list1 ?? []), ...(group?.list3 ?? [])]
  const seen = new Set<string>()
  const options: Array<{ tableId: string; tableName: string; label: string }> = []
  for (const table of merged) {
    if (!table?.tableId || seen.has(table.tableId)) continue
    seen.add(table.tableId)
    options.push({ tableId: table.tableId, tableName: table.tableName, label: table.name || table.tableName })
  }
  if (form.tableName && !options.some((table) => table.tableName === form.tableName)) {
    options.unshift({ tableId: form.tableName, tableName: form.tableName, label: '当前关联表' })
  }
  tableOptions.value = options
}

async function loadSourceContext(): Promise<void> {
  const request = ++sourceRequest
  const sourceId = form.sourceId.trim()
  if (!sourceId) {
    tableOptions.value = []
    loading.value = false
    loadError.value = ''
    return
  }
  loading.value = true
  loadError.value = ''
  const wasClean = formSignature(form) === baseline.value
  try {
    const [detail, group] = await Promise.all([
      sourceApi.sourceDetail(sourceId).catch(() => null),
      dataApi.entryTypesGroup(sourceId).catch(() => null),
    ])
    if (request !== sourceRequest) return
    const stillClean = wasClean && formSignature(form) === baseline.value
    if (detail?.name) form.sourceName = detail.name
    mergeTableOptions(group)
    // 新建时默认带出源的最终落库主表（1113 修订 §4.1.1）；主表不在可选清单里才退回「唯一表」
    if (!form.tableName && detail?.mainTable) {
      const landed = tableOptions.value.find((table) => table.tableName === detail.mainTable)
      if (landed) form.tableName = landed.tableName
    }
    if (!form.tableName && tableOptions.value.length === 1) form.tableName = tableOptions.value[0].tableName
    // 关联表定下来后再出「入库时间字段」候选（唯一候选的自动选中同样算系统补全）
    syncTimeColumnFields()
    // 异步带出的源名/唯一关联表是系统补全，不算用户改动；
    // 否则打开已有记录/新建表单会立刻显示「未保存」，关窗还要多一次无意义确认。
    if (stillClean) baseline.value = formSignature(form)
  } catch (error) {
    if (request === sourceRequest) loadError.value = `读取源信息失败：${errorText(error)}`
  } finally {
    if (request === sourceRequest) loading.value = false
  }
}

async function loadModelsOfProvider(providerCode: string): Promise<void> {
  const request = ++modelRequest
  if (!providerCode) {
    modelOptions.value = []
    return
  }
  try {
    const models = await fetchDefaultModels(providerCode)
    if (request !== modelRequest || form.providerCode !== providerCode) return
    modelOptions.value = models
  } catch {
    if (request !== modelRequest) return
    modelOptions.value = []
  }
  if (!form.modelCode && modelOptions.value.length) form.modelCode = modelOptions.value[0].modelCode
}

async function loadModels(): Promise<void> {
  const initialSignature = formSignature(form)
  const wasClean = initialSignature === baseline.value
  try {
    providerOptions.value = await fetchModelProviders()
  } catch {
    providerOptions.value = []
  }
  const unchanged = formSignature(form) === initialSignature
  // 有供应商但没有选模型时带出第一个，避免用户点生成才被「缺模型」拦住；仍可改
  if (!form.providerCode && providerOptions.value.length) form.providerCode = providerOptions.value[0].providerCode
  if (form.providerCode) await loadModelsOfProvider(form.providerCode)
  // 默认供应商/模型是系统补全，不算用户改动（同 loadSourceContext 的处理）
  if (wasClean && unchanged) baseline.value = formSignature(form)
}

function onProviderChange(): void {
  form.modelCode = ''
  void loadModelsOfProvider(form.providerCode)
}

function onTableChange(): void {
  if (pending.value) testResult.value = null
  timeColumnSelected.value = false
  form.timeColumn = ''
  syncTimeColumnFields(true)
}

async function confirmDiscard(what: string): Promise<boolean> {
  if (!isDirty.value) return true
  try {
    await ElMessageBox.confirm(`切换${what}会丢弃当前未保存的编辑，是否继续？`, '未保存的修改', {
      confirmButtonText: '继续',
      cancelButtonText: '留在本页',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}

function resetSourceScope(sourceId: string, name: string): void {
  candidate.script = ''
  candidate.scriptPath = ''
  candidateScope.value = null
  pending.value = false
  testResult.value = null
  generationError.value = ''
  preflightError.value = ''
  form.sourceId = sourceId
  form.sourceName = name
  form.tableName = ''
  form.timeColumn = ''
  timeColumnSelected.value = false
  syncTimeColumnFields()
}

async function onSourcePicked(sourceId: string, name = ''): Promise<void> {
  if (busy.value || sourceId === form.sourceId || !(await confirmDiscard('监控源'))) return
  resetSourceScope(sourceId, name)
  await loadSourceContext()
}

function switchKind(kind: MonitorKind): void {
  if (form.kind === kind) return
  form.kind = kind
  // 切换只改变本次保存写哪一组字段，不删另一组定义；旧记录切回时仍能看到原来的脚本/规则
  if (kind === 'rule' && !form.schedule.trim()) form.schedule = DEFAULT_SCHEDULE
}

/**
 * 脚本按监控 ID 命名（1117 契约 3：<仓库目录>/<sourceId>/<监控ID>.py），新建监控还没有 ID。
 * 生成前先按草稿保存（无脚本 = 草稿，不执行），回读拿到 ID 再继续；用户取消则不生成。
 */
const monitorId = computed(() => recordState.value?.id ? String(recordState.value.id) : '')
const selectedDirectory = computed(() => directoryOptions.value.find((row) => row.directoryId === form.directoryId))
/** 只在智能体模式有意义；目录取所选的数据监控目录（2806 上是 dataMonitor，不写死 monitor） */
const targetScriptPath = computed(() =>
  monitorScriptPath(selectedDirectory.value?.path ?? '', form.sourceId.trim(), monitorId.value))
const targetPathHint = computed(() => {
  if (!monitorId.value) return '检查通过并保存草稿取得 ID 后确定'
  if (!form.directoryId) return '请先选择仓库目录'
  return '目录信息加载中…'
})

async function ensureMonitorId(): Promise<void> {
  if (monitorId.value) return
  const saved = await saveMonitor({
    record: undefined,
    sourceId: form.sourceId.trim(),
    name: form.name.trim(),
    kind: form.kind,
    conf: confFromForm(form, {}, {}),
    tableName: form.tableName.trim(),
    schedule: form.schedule.trim(),
  })
  const readback = await readbackAfterSave(saved.raw)
  if (!readback?.id) {
    draftConfirmationFailed.value = true
    throw new Error('草稿已提交，但未回读到监控 ID，请刷新列表后在该草稿上继续生成')
  }
  recordState.value = readback
  syncCommitted()
  emit('draft-saved', readback)
}

const generationChecks = computed(() => {
  const invalid = validateForm(form)
  const agent = form.generationMode === 'agent'
  const basicError = !form.sourceId.trim() ? '请先选择被监控源'
    : !form.name.trim() ? '请填写监控名称'
      : !form.tableName.trim() ? '请先选择要检查的表' : ''
  const modeError = agent
    ? agentOptionsLoading.value ? '正在读取智能体和仓库配置'
      : agentOptionsError.value || directoryError.value
        || (!agentOptions.value.some(item => item.id === form.agentInterfaceId)
          || !repoOptions.value.some(item => item.repoId === form.repoId)
          || !selectedDirectory.value?.path ? '请选择可用的智能体、仓库和目录' : '')
    : !form.providerCode || !form.modelCode ? '请选择模型供应商与模型' : ''
  const promptError = !promptTemplateLoaded.value ? '正在读取提示词模板'
    : form.promptTemplateId && !promptTemplate.value && !promptTemplateError.value ? '当前引用的提示词模板不可用，请重新选择'
      : !form.desc.trim() ? '请先设置用户提示词'
        : promptConflict.value ? '表单与自定义用户提示词可能不一致' : ''
  const tableError = timeColumnsLoading.value ? '正在读取表字段'
    : agent && timeColumnError.value ? `执行器不可用：${timeColumnError.value}` : ''
  return [
    { key: 'basic', ok: !basicError, text: basicError || '监控源、名称和检查表已填写' },
    { key: 'methods', ok: !!form.methods.length, text: form.methods.length ? `已选 ${form.methods.length} 个检查方法` : '至少选一个检查方法' },
    { key: 'scope', ok: !tableError && invalid?.key !== 'overdue', text: tableError || (invalid?.key === 'overdue' ? invalid.message
      : `时间字段：${selectedTimeLabel.value}${timeColumnError.value && metadataTimeFields.value.length ? ' · 使用表元数据' : ''}`
        + (!form.timeColumn ? ' · 依赖时间列的检查项可能无法判定' : '')) },
    { key: 'prompt', ok: !promptError, warn: !promptError && promptFallback.value, text: promptError || (form.promptCustom ? '生成时使用自定义用户提示词' : promptSourceText.value) },
    { key: 'mode', ok: !modeError, text: modeError || (agent ? '智能体和仓库配置已就绪' : '已选内置接口模型，无需先保存草稿') },
  ]
})
const generationBlocked = computed(() => draftConfirmationFailed.value || generationChecks.value.some(check => !check.ok))

async function focusGenerationCheck(key: string): Promise<void> {
  if (key === 'basic') activeTab.value = 'basic'
  else if (key === 'scope' || key === 'mode') advancedOpen.value = true
  else if (key === 'prompt') promptTab.value = 'user'
  await nextTick()
  const targets: Record<string, string> = {
    basic: 'mc-basic-fields', methods: 'mc-methods-pane', scope: 'mc-time-column',
    mode: 'mc-generation-mode', prompt: 'mc-prompt',
  }
  document.getElementById(targets[key])?.focus()
}

async function onGenerate(): Promise<void> {
  if (busy.value || generationBlocked.value) return
  preflighting.value = true
  preflightError.value = ''
  generationError.value = ''
  const agent = form.generationMode === 'agent'
  const tableName = form.tableName
  const sourceId = form.sourceId
  const recordId = monitorId.value
  const tableId = tableOptions.value.find(table => table.tableName === tableName)?.tableId ?? ''
  let context: Awaited<ReturnType<typeof resolveSourceResultContext>> | undefined
  let fields: string[] = []
  let fieldSource: 'runner' | 'metadata' = 'runner'
  try {
    if (agent || !timeColumnError.value) await loadTimeColumnFields()
    if (agent && timeColumnError.value) return
    if (!agent) context = await resolveSourceResultContext({ tableName, tableId })
    if (form.tableName !== tableName || form.sourceId !== sourceId || monitorId.value !== recordId) return
    const actualFields = timeColumnFields.value
    const metadata = metadataTimeFields.value.map(field => field.name)
    fields = actualFields.length ? actualFields : metadata
    fieldSource = actualFields.length ? 'runner' : 'metadata'
    if (fields.length && form.timeColumn && !fields.includes(form.timeColumn)) {
      form.timeColumn = ''
      timeColumnSelected.value = false
      applyTimeColumnFields(true)
      await nextTick()
    }
    if (generationBlocked.value) return
    if (agent) await ensureMonitorId()
  } catch (error) {
    preflightError.value = errorText(error)
    return
  } finally {
    preflighting.value = false
  }

  generating.value = true
  generatingPreview.value = ''
  generatingThinking.value = ''
  scriptExpanded.value = false
  startElapsedTimer()
  const previous = { script: candidate.script, scriptPath: candidate.scriptPath, archive: candidateArchive.value, archiveId: form.archiveId }
  try {
    const systemPrompt = augmentMonitorSystemPrompt(form.systemPrompt.trim() || autoSystemPrompt.value, fields, form.timeColumn, fieldSource)
    const userPrompt = prepareMonitorUserPrompt(form.desc, form.generationMode)
    const scope = { tableName: form.tableName.trim(), timeColumn: form.timeColumn.trim(), mode: form.generationMode, signature: scriptInputSignature.value }
    let result: { script: string; scriptPath: string }
    if (agent) {
      const agentResult = await generateMonitorScriptWithAgent({
        sourceId: form.sourceId.trim(),
        monitorId: monitorId.value,
        sourceName: form.sourceName,
        monitorName: form.name.trim(),
        interfaceId: form.agentInterfaceId,
        repoId: form.repoId,
        directoryId: form.directoryId,
        directoryPath: selectedDirectory.value?.path,
        systemPrompt,
        userPrompt,
        onEvent: (event) => {
          if (event.type === 'chunk') generatingPreview.value += event.text
          else if (event.type === 'progress') generatingThinking.value = appendThinking(generatingThinking.value, `${event.message}\n`)
          else return
          void scrollStreamToEnd()
        },
      })
      candidateArchive.value = agentResult.archive
      form.archiveId = agentResult.archive?.archiveId ?? ''
      result = agentResult
    } else {
      result = await generateMonitorScript({
        context: context!,
        description: userPrompt,
        methods: promptScopeChanged.value ? [] : [...form.methods],
        systemPrompt,
        providerCode: form.providerCode,
        modelCode: form.modelCode,
        onContent: (scriptSoFar) => {
          generatingPreview.value = scriptSoFar
          void scrollStreamToEnd()
        },
        onThinking: (text) => {
          generatingThinking.value = appendThinking(generatingThinking.value, text)
          void scrollStreamToEnd()
        },
      })
    }
    if (!result.script.trim() && !result.scriptPath.trim()) {
      throw new Error('生成完成但没有返回脚本正文或文件路径')
    }
    candidate.script = result.script
    candidate.scriptPath = result.scriptPath
    candidateScope.value = scope
    pending.value = true
    testResult.value = null
    ElMessage.success('脚本已生成（尚未保存）：保存后才会生效，生成不改变当前版本')
  } catch (error) {
    // 失败保留原正文：不吃掉已有的生效脚本/上一次候选，也不落库
    candidate.script = previous.script
    candidate.scriptPath = previous.scriptPath
    candidateArchive.value = previous.archive
    form.archiveId = previous.archiveId
    pending.value = !!previous.script || !!previous.scriptPath
    if (!pending.value) candidateScope.value = null
    generationError.value = errorText(error)
    if (form.generationMode === 'agent') {
      generationError.value += '（智能体生成依赖后端「监控上下文」支持，未上线前可切回「内置接口」生成）'
    }
  } finally {
    stopElapsedTimer()
    generating.value = false
    generatingPreview.value = ''
    generatingThinking.value = ''
  }
}

async function onTest(): Promise<void> {
  if (busy.value) return
  if (form.kind === 'rule') {
    await verifyRule()
    return
  }
  const target = testTarget()
  const scriptText = displayedScript.value.trim()
  const path = activePath.value.trim()
  if (!scriptText && !path) {
    ElMessage.warning('还没有可测试的脚本：先生成脚本')
    return
  }
  testing.value = true
  try {
    // 优先用数据监控执行器试跑正文：186 这类环境没有 vrule 执行器，旧端点会 404/504。
    const viaRunner = scriptText
      ? await testMonitorScriptWithRunner({
          script: scriptText,
          sourceId: form.sourceId,
          tableName: form.tableName,
          timeColumn: form.timeColumn,
          window: windowOfForm(form),
        })
      : null
    if (!viaRunner && !path) throw new Error('执行器不可用，且脚本没有文件路径，无法测试')
    const outcome = viaRunner ?? await testMonitorScript(path)
    testResult.value = {
      label: outcome.ok ? '测试，未通知' : '测试失败，未通知',
      target,
      summary: outcome.summary,
      note: '未发送业务通知，未更新正式最近结果与启停状态',
      at: stamp(),
    }
    const message = `${outcome.summary}；未发送业务通知，未更新正式结果`
    if (!outcome.ok) {
      ElMessage.error(message)
    } else if (outcome.raw && typeof outcome.raw === 'object' && 'status' in outcome.raw && outcome.raw.status === 'ABNORMAL') {
      ElMessage.warning(message)
    } else {
      ElMessage.success(message)
    }
  } catch (error) {
    testResult.value = {
      label: '测试失败，未通知',
      target,
      summary: errorText(error),
      note: '未写入正式结果',
      at: stamp(),
    }
    ElMessage.error(`测试失败：${errorText(error)}`)
  } finally {
    testing.value = false
  }
}

async function verifyRule(): Promise<void> {
  if (busy.value) return
  if (!form.sourceId.trim()) {
    ElMessage.warning('请先选择被监控源')
    return
  }
  if (!form.tableName) {
    ElMessage.warning('请先选择表名')
    return
  }
  testing.value = true
  try {
    const ruleConf = confFromForm(form, recordState.value?.conf ?? {})
    const raw = await checkOneManual({
      checkConf: JSON.stringify(ruleConf),
      name: form.name.trim(),
      tableName: form.tableName,
      sourceId: form.sourceId,
    })
    testResult.value = {
      label: '测试，未通知',
      target: `规则检查配置（未保存校验）${scopeText()}`,
      summary: summarizeExecutionResult(raw),
      note: '未发送业务通知，未更新正式最近结果与启停状态',
      at: stamp(),
    }
    ElMessage.success('规则校验完成：未发送业务通知')
  } catch (error) {
    testResult.value = {
      label: '测试失败，未通知',
      target: `规则检查配置（未保存校验）${scopeText()}`,
      summary: errorText(error),
      note: '未写入正式结果',
      at: stamp(),
    }
    ElMessage.error(`规则校验失败：${errorText(error)}`)
  } finally {
    testing.value = false
  }
}

/** 保存回执里的记录 id：`/add` 与 `/update` 都带 `data.id`，两种保存都能拿到确切主键。 */
function savedIdOf(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const id = (raw as Record<string, unknown>).id
  return id == null || id === '' ? '' : String(id)
}

/**
 * 保存后回读。
 *
 * 1109 §5.3 时期没有单条读接口，只能按源拉全量再按「保存前不存在的 id + 同名」猜是哪条；
 * C01 `/source/check/detail` 上线后改成按主键单条读：同源多条检查、名字重复、并发新增都不会错行。
 * 读不到（接口失败或记录已被删）返回 null，由调用方提示刷新，不拿同源其它记录顶上。
 */
async function readbackAfterSave(raw: unknown): Promise<MonitorRecordView | null> {
  const monitorId = recordState.value?.id || savedIdOf(raw)
  if (!monitorId) return null
  return (await loadMonitorRecord(monitorId).catch(() => undefined)) ?? null
}

async function onSave(): Promise<void> {
  if (busy.value || draftConfirmationFailed.value) return
  const invalid = validateForm(form)
  if (invalid) {
    activeTab.value = invalid.key === 'methods' || invalid.key === 'overdue' ? 'check' : 'basic'
    ElMessage.warning(invalid.message)
    return
  }
  if (form.kind === 'ai' && promptConflict.value) {
    activeTab.value = 'check'
    await focusGenerationCheck('prompt')
    return
  }
  saving.value = true
  try {
    const baseConf: MonitorCheckConf = recordState.value?.conf ?? {}
    const generated = pending.value && !!(candidate.script.trim() || candidate.scriptPath.trim())
    if (form.kind === 'ai' && generated && candidateScope.value && candidateScope.value.mode !== form.generationMode) {
      activeTab.value = 'check'
      await focusGenerationCheck('mode')
      return
    }
    // 候选是按旧表/旧时间列生成的：脚本列名写死，直接发布会把旧范围套到新表上
    if (generated && candidateStale.value && candidateScope.value) {
      try {
        await ElMessageBox.confirm(
          `${candidateStaleNotice.value} 是否仍然保存？`,
          '候选脚本与当前检查范围不一致',
          { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '取消，先重新生成' },
        )
      } catch {
        return
      }
    }
    const baseVersion = versionOf(baseConf) || form.version
    const savedVersion = form.kind === 'ai' ? (generated ? nextVersionOf(baseVersion) : baseVersion) : ''
    const regenerate = needsRegenerate(form, committedForm.value)
    const regenerateReasonsOf = regenerate ? regenerateReasons(form, committedForm.value) : []
    const conf = confFromForm(form, baseConf, {
      // 智能体模式脚本只在 Git（执行从 Git 取），不存正文；内置接口仍按原样存正文
      script: generated && form.generationMode !== 'agent' ? candidate.script : undefined,
      scriptPath: generated ? candidate.scriptPath : undefined,
    })
    if (form.kind === 'ai') conf.version = savedVersion || undefined

    const saved = await saveMonitor({
      record: recordState.value ?? undefined,
      sourceId: form.sourceId.trim(),
      name: form.name.trim(),
      kind: form.kind,
      conf,
      tableName: form.tableName.trim(),
      schedule: form.schedule.trim(),
    })

    // 保存回执只带 id/ver：按主键回读完整记录当新基线；读不到就不猜 ID
    const readback = await readbackAfterSave(saved.raw)
    if (!readback) {
      ElMessage.warning('已提交，未回读到记录：请刷新列表确认，本次不标记为已生效')
      emit('saved', null)
      return
    }
    const feedback = buildSaveFeedback(readback.conf, savedVersion, {
      kind: form.kind,
      generated,
      needsRegenerate: regenerate,
      regenerateReasons: regenerateReasonsOf,
      // 用本次提交的计划判定（服务端回读只作展示）：空计划 = 保存后只能手动运行
      scheduleEmpty: form.kind === 'ai' && !form.schedule.trim(),
    })
    applyRecord(readback)
    ElMessage.success(feedback)
    emit('saved', readback)
  } catch (error) {
    ElMessage.error(`保存失败：${errorText(error)}`)
  } finally {
    saving.value = false
  }
}

async function onCancel(): Promise<void> {
  if (busy.value) return
  if (isDirty.value) {
    try {
      await ElMessageBox.confirm('当前修改尚未保存，确认取消？', '取消编辑', {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  emit('cancel')
}

defineExpose({
  isDirty: () => isDirty.value,
  isBusy: () => busy.value,
})
</script>

<template>
  <div class="mc-shell" data-testid="monitor-editor">
    <header class="mc-head">
      <div class="mc-title-line">
        <h3 class="mc-title">{{ isEditing ? '编辑监控' : '新建监控' }}</h3>
        <span class="mc-badge" :class="isEditing && (form.kind === 'rule' || hasAnyScript) ? 'mc-badge-ok' : 'mc-badge-draft'" data-testid="mc-mode">
          {{ isEditing ? recordStatusText : '未保存' }}
        </span>
        <span v-if="isDirty" class="mc-badge mc-badge-warn" data-testid="mc-dirty">有未保存修改</span>
        <span class="mc-head-meta" :title="lockedSourceLabel">
          <template v-if="form.sourceId">源结果检查 · 源「{{ form.sourceName || form.sourceId }}」 · 检查表：{{ form.tableName || '未选择' }} · {{ form.schedule ? '独立定时' : '仅手动' }} · </template>
          <template v-if="isEditing">
            记录 {{ recordState?.id || '' }} · {{ importHint }} ·
            {{ recordState?.enabled ? '已启用' : '已停用（保存不改启停）' }}
          </template>
          <template v-else>{{ importHint }} · 保存后生效；未生成脚本时保存为草稿，不会执行</template>
        </span>
      </div>
    </header>

    <nav class="mc-tabs" role="tablist" aria-label="监控配置分区">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        role="tab"
        class="mc-tab"
        :class="{ active: activeTab === tab.key }"
        :aria-selected="activeTab === tab.key"
        :data-testid="`mc-tab-${tab.key}`"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </nav>

    <fieldset class="mc-body" :disabled="busy" :aria-busy="busy" data-testid="mc-content">
      <legend class="mc-sr-only">监控配置内容</legend>
      <div v-if="loading" class="mc-hint" data-testid="mc-loading">加载源信息…</div>
      <div v-else-if="loadError" class="mc-error">
        {{ loadError }}
        <button type="button" class="mc-mini" data-testid="mc-retry" @click="loadSourceContext">重试</button>
      </div>

      <section v-show="activeTab === 'basic'" id="mc-basic-fields" tabindex="-1" class="mc-section" data-testid="mc-panel-basic">
        <div class="mc-grid mc-grid-basic">
        <div class="mc-field">
          <label class="mc-label" for="mc-name-input">监控名称 <em>*</em></label>
          <input
            id="mc-name-input"
            v-model="form.name"
            class="mc-input"
            type="text"
            placeholder="例如：沐言社媒-日增量"
            data-testid="mc-name-input"
          >
        </div>

        <div class="mc-field">
          <label class="mc-label">被监控源 <em>*</em></label>
          <div v-if="sourceLockedEffective" class="mc-readonly" data-testid="mc-source-locked">
            当前源：{{ lockedSourceLabel }}
          </div>
          <SiteSourceSelect
            v-else-if="siteId"
            :site-id="siteId"
            :model-value="form.sourceId"
            @update:model-value="onSourcePicked"
          />
          <SourcePickerRemote
            v-else
            :model-value="form.sourceId"
            :selected-name="form.sourceName"
            @update:model-value="onSourcePicked"
          />
          <p v-if="sourceLockedEffective" class="mc-hint">编辑已有记录锁定源；如需换源请新建监控。</p>
        </div>

        <div class="mc-field">
          <label
            class="mc-label"
            for="mc-table-select"
            title="本条检查的数据范围：生成、试跑和正式运行都读取这张表，不随源流程的监控节点变化"
          >
            {{ form.kind === 'ai' ? '关联表（数据范围）' : '表名' }}
          </label>
          <select id="mc-table-select" v-model="form.tableName" class="mc-input" data-testid="mc-table-select" @change="onTableChange">
            <option value="">（未绑定表）</option>
            <option v-for="table in tableOptions" :key="table.tableId" :value="table.tableName">
              {{ table.label }}（{{ table.tableName }}）
            </option>
          </select>
        </div>
        </div>

        <div v-if="recordState" class="mc-card">
          <div class="mc-card-row">
            <span class="mc-k">当前生效</span>
            <span class="mc-v" data-testid="mc-record-status">{{ recordStatusText }}</span>
          </div>
          <div class="mc-card-row">
            <span class="mc-k">最近一次执行</span>
            <span class="mc-v">{{ recordState.lastRun || '—' }}（{{ EXEC_TEXT[recordState.exec] }}）</span>
          </div>
          <div class="mc-card-row">
            <span class="mc-k">下次执行</span>
            <span class="mc-v">{{ recordState.nextRun || '待计算' }}</span>
          </div>
          <div class="mc-card-row">
            <span class="mc-k">调度覆盖</span>
            <span class="mc-v">—（需服务端聚合）</span>
          </div>
        </div>
        <p v-else class="mc-note" data-testid="mc-new-note">
          检查方法会自动填入用户提示词。需要补充规则时，可在「检查方式」里用 AI 修改。
        </p>
      </section>

      <section v-show="activeTab === 'check'" class="mc-section" data-testid="mc-panel-check">
        <div class="mc-kindbar">
          <div class="mc-field">
          <label class="mc-label" title="新建默认 AI 检查；编辑旧记录保持其原有方式">检查方式</label>
          <div class="mc-segment" role="radiogroup" aria-label="检查方式">
            <button
              type="button"
              role="radio"
              class="mc-segment-item"
              :class="{ active: form.kind === 'ai' }"
              :aria-checked="form.kind === 'ai'"
              data-testid="mc-kind-ai"
              @click="switchKind('ai')"
            >AI 脚本检查</button>
            <button
              type="button"
              role="radio"
              class="mc-segment-item"
              :class="{ active: form.kind === 'rule' }"
              :aria-checked="form.kind === 'rule'"
              data-testid="mc-kind-rule"
              @click="switchKind('rule')"
            >规则检查</button>
          </div>
          </div>

          <p class="mc-hint mc-kindbar-hint">同一检查项首期只选一种执行方式；需要不同调度/通知请拆成两条记录。</p>
        </div>
        <template v-if="form.kind === 'ai'">
          <div class="mc-split">
            <div class="mc-col">
              <section id="mc-methods-pane" class="mc-pane" tabindex="-1">
                <AiMethodsField v-model="form.methods" />
              </section>

              <section id="mc-prompt" class="mc-pane" tabindex="-1" aria-label="提示词">
                <PromptTemplatePicker
                  :items="promptTemplates" :model-value="selectedPromptId" :loading="!promptTemplateLoaded"
                  :disabled="busy" test-id="mc-prompt-template" :current-label="promptCurrentLabel" @select="selectPromptTemplate"
                />
                <p class="mc-hint" data-testid="mc-prompt-facts">
                  {{ form.promptCustom ? '当前表单（使用自定义提示词）' : '表单已填入' }}：
                  {{ form.methods.map(methodLabel).join('、') || '未选检查方法' }} · {{ selectedTimeLabel }}<template v-if="form.timeColumn"> · {{ descriptionWindow }}</template>
                  · {{ form.nullPolicy === 'abnormal' ? '空值记异常' : form.nullPolicy === 'allow' ? '允许为空' : '空值行跳过' }}
                </p>
                <div class="mc-prompt-columns">
                  <div class="mc-field">
                    <div class="mc-quick-row" role="group" aria-label="选择提示词类型">
                      <el-button :type="promptTab === 'system' ? 'primary' : 'default'" data-testid="mc-prompt-tab-system" @click="promptTab = 'system'">系统提示词</el-button>
                      <el-button :type="promptTab === 'user' ? 'primary' : 'default'" data-testid="mc-prompt-tab-user" @click="promptTab = 'user'">用户提示词</el-button>
                    </div>
                    <div v-show="promptTab === 'user'" class="mc-field">
                      <div class="mc-field-head">
                        <label class="mc-label" for="mc-desc-input">用户提示词 <span v-if="form.promptCustom" class="mc-faint">· 已自定义</span></label>
                        <button type="button" class="mc-mini" data-testid="mc-user-prompt-restore" @click="restoreUserPrompt">恢复默认</button>
                      </div>
                      <p v-if="promptConflict" class="mc-hint mc-hint-error">表单已变更，当前提示词仍保留原规则。请确认生成使用的提示词，执行范围仍按当前表单。</p>
                      <textarea id="mc-desc-input" :value="displayUserPrompt" readonly class="mc-input mc-textarea mc-prompt-text" data-testid="mc-desc-input" />
                    </div>
                    <div v-show="promptTab === 'system'" class="mc-field">
                      <div class="mc-field-head">
                        <label class="mc-label" for="mc-system-prompt">系统提示词 <span v-if="systemTouched" class="mc-faint">· 已自定义</span></label>
                        <button type="button" class="mc-mini" data-testid="mc-system-prompt-restore" @click="restoreSystemPrompt">恢复默认</button>
                      </div>
                      <textarea id="mc-system-prompt" v-model="form.systemPrompt" maxlength="12000" class="mc-input mc-textarea mc-prompt-text"
                        placeholder="留空则使用默认提示词" data-testid="mc-system-prompt" @input="systemTouched = true" />
                    </div>
                    <p class="mc-hint" data-testid="mc-prompt-source">{{ promptSourceText }}</p>
                  </div>
                  <PromptAiEditor
                    v-if="activeTab === 'check'" :key="`${recordState?.id || form.sourceId}:${promptTab}`"
                    embedded :prompt-type="promptTab" :prompt="activePrompt" :disabled="busy" @apply="applyPromptEdit"
                  />
                </div>
              </section>

              <details class="mc-pane mc-advanced" :open="advancedOpen" @toggle="advancedOpen = ($event.currentTarget as HTMLDetailsElement).open">
                <summary data-testid="mc-advanced">
                  <strong>高级选项</strong>
                  <span class="mc-hint">{{ selectedTimeLabel }}<template v-if="form.timeColumn"> · {{ form.windowType === 'today' ? '当日' : windowHint }}</template> · {{ form.nullPolicy === 'abnormal' ? '空值记异常' : form.nullPolicy === 'allow' ? '允许为空' : '空值行跳过' }} · {{ form.generationMode === 'agent' ? '智能体' : '内置接口' }}</span>
                </summary>
                <div class="mc-grid mc-range-grid">
                  <div class="mc-field">
                    <span class="mc-label">主表</span>
                    <div class="mc-readonly" data-testid="mc-range-table">{{ form.tableName || '—' }}</div>
                  </div>
                  <div class="mc-field">
                    <label class="mc-label" for="mc-time-column">入库时间字段</label>
                    <select
                      id="mc-time-column"
                      v-model="form.timeColumn"
                      class="mc-input"
                      data-testid="mc-time-column" @change="timeColumnSelected = true"
                    >
                      <option value="">不限时间（全表检查）</option>
                      <option v-for="column in timeColumnOptions" :key="column.value" :value="column.value">{{ column.label }}</option>
                    </select>
                    <p class="mc-hint">脚本按这一列统计；不确定时选表的入库时间列</p>
                    <p v-if="timeColumnsLoading" class="mc-hint">正在读取表字段…</p>
                    <p v-else-if="timeColumnError" class="mc-hint" data-testid="mc-time-fallback">{{ metadataTimeFields.length ? '执行器字段不可用，候选来自表元数据。' : '字段读取失败，可选不限时间。' }} {{ timeColumnError }}</p>
                    <p v-else-if="form.timeColumn && timeColumnFields.length && !timeColumnFields.includes(form.timeColumn)" class="mc-hint">
                      当前表不存在字段 {{ form.timeColumn }}，请重新选择并生成脚本。
                    </p>
                  </div>
                  <div class="mc-field">
                    <label class="mc-label" for="mc-null-policy">被检查字段为空时</label>
                    <select id="mc-null-policy" v-model="form.nullPolicy" class="mc-input" data-testid="mc-null-policy">
                      <option value="abnormal">记为异常</option>
                      <option value="allow">允许为空（不告警）</option>
                      <option value="skip">跳过该行</option>
                    </select>
                  </div>
                  <div class="mc-field">
                    <label class="mc-label" for="mc-no-data-policy">本次无待检记录时</label>
                    <select id="mc-no-data-policy" v-model="form.noDataPolicy" class="mc-input" data-testid="mc-no-data-policy">
                      <option value="no_data">按无数据处理（不报警）</option>
                      <option value="alarm">判为异常并告警</option>
                      <option value="unknown">结论未知</option>
                    </select>
                  </div>
                </div>
                <div class="mc-field mc-window-field">
                  <span class="mc-label">检查窗口</span>
                  <div class="mc-segment mc-window-segment">
                    <button
                      type="button"
                      class="mc-segment-item"
                      :class="{ active: form.windowType === 'today' }"
                      data-testid="mc-window-today"
                      @click="form.windowType = 'today'"
                    >当日（00:00 → 现在）</button>
                    <button
                      type="button"
                      class="mc-segment-item"
                      :class="{ active: form.windowType === 'hours' }"
                      data-testid="mc-window-hours"
                      @click="form.windowType = 'hours'"
                    >最近 N 小时</button>
                    <button
                      type="button"
                      class="mc-segment-item"
                      :class="{ active: form.windowType === 'period' }"
                      data-testid="mc-window-period"
                      @click="form.windowType = 'period'"
                    >上一个周期</button>
                  </div>
                  <div v-if="form.windowType === 'hours'" class="mc-inline mc-window-hours">
                    <span class="mc-label">小时数</span>
                    <input
                      id="mc-window-hours"
                      v-model="form.windowHours"
                      class="mc-input"
                      type="number"
                      min="1"
                      max="720"
                      step="1"
                      data-testid="mc-window-hours-input"
                    />
                  </div>
                  <p class="mc-hint" data-testid="mc-window-hint">{{ windowHint }}</p>
                </div>
                <div class="mc-grid mc-overdue-grid">
                  <div class="mc-field">
                    <label class="mc-label" for="mc-overdue-minutes">超期无新增（分钟）</label>
                    <input
                      id="mc-overdue-minutes"
                      v-model="form.overdueMinutes"
                      class="mc-input"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="留空不判定"
                      data-testid="mc-overdue-minutes"
                    />
                  </div>
                  <div class="mc-field">
                    <label class="mc-label" for="mc-overdue-grace">宽限（分钟）</label>
                    <input
                      id="mc-overdue-grace"
                      v-model="form.overdueGrace"
                      class="mc-input"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      data-testid="mc-overdue-grace"
                    />
                  </div>
                </div>
                <p class="mc-hint" data-testid="mc-overdue-hint">
                  按「距上次有新增数据过了多久」判断流：超过更新周期 + 宽限仍没有新增，判为超期异常（窗口内没数据不再一律按「无待检记录」放过）。留空只按上面的「本次无待检记录时」处理，不判超期。
                </p>
                <!-- 1117 第 2 批：生成方式。内置接口 = 现有 data-process（供应商 + 模型，脚本存文件服务）；
                     智能体 = Runner 智能体 + Git 仓库目录（依赖后端监控上下文，未上线前生成会被后端拒绝）。 -->
                <div id="mc-generation-mode" class="mc-field" tabindex="-1">
                  <label class="mc-label">生成方式</label>
                  <div class="mc-segment" role="radiogroup" aria-label="生成方式">
                    <button
                      type="button"
                      role="radio"
                      class="mc-segment-item"
                      :class="{ active: form.generationMode === 'agent' }"
                      :aria-checked="form.generationMode === 'agent'"
                      data-testid="mc-gen-agent"
                      @click="switchGenerationMode('agent')"
                    >智能体 · 提交 Git</button>
                    <button
                      type="button"
                      role="radio"
                      class="mc-segment-item"
                      :class="{ active: form.generationMode === 'builtin' }"
                      :aria-checked="form.generationMode === 'builtin'"
                      data-testid="mc-gen-builtin"
                      @click="switchGenerationMode('builtin')"
                    >内置接口</button>
                  </div>
                </div>
                <template v-if="form.generationMode === 'agent'">
                  <div class="mc-field">
                    <label class="mc-label" for="mc-agent">智能体</label>
                    <select id="mc-agent" v-model="form.agentInterfaceId" class="mc-input" data-testid="mc-agent" :disabled="agentOptionsLoading">
                      <option value="">{{ agentOptionsLoading ? '加载中…' : '请选择' }}</option>
                      <option v-for="agent in agentOptions" :key="agent.id" :value="agent.id">{{ agent.name }}{{ agent.model ? ` · ${agent.model}` : '' }}</option>
                    </select>
                  </div>
                  <div class="mc-grid">
                    <div class="mc-field">
                      <label class="mc-label" for="mc-repo">代码仓库</label>
                      <select id="mc-repo" v-model="form.repoId" class="mc-input" data-testid="mc-repo" :disabled="agentOptionsLoading" @change="onRepoChange">
                        <option value="">请选择</option>
                        <option v-for="repo in repoOptions" :key="repo.repoId" :value="repo.repoId">{{ repo.name }}{{ repo.configType ? ' · 数据监控' : ' · 通用' }}</option>
                      </select>
                    </div>
                    <div class="mc-field">
                      <label class="mc-label" for="mc-directory">仓库目录</label>
                      <select id="mc-directory" v-model="form.directoryId" class="mc-input" data-testid="mc-directory" :disabled="!form.repoId">
                        <option value="">请选择</option>
                        <option v-for="row in directoryOptions" :key="row.directoryId" :value="row.directoryId">{{ row.name }}（{{ row.path }}/）</option>
                      </select>
                    </div>
                  </div>
                  <p v-if="agentOptionsError || directoryError" class="mc-hint mc-hint-error" data-testid="mc-agent-error">{{ [agentOptionsError, directoryError].filter(Boolean).join('；') }}</p>
                  <p class="mc-hint">默认方式。文件名与子目录固定为 <code>&lt;源ID&gt;/&lt;监控ID&gt;.py</code>，生成后自动提交 Git；后端支持监控上下文之前生成会失败，可临时切到「内置接口」。</p>
                </template>
                <div v-else class="mc-grid">
                  <div class="mc-field">
                    <label class="mc-label" for="mc-provider">模型供应商</label>
                    <select id="mc-provider" v-model="form.providerCode" class="mc-input" data-testid="mc-provider" @change="onProviderChange">
                      <option value="">请选择</option>
                      <option v-for="provider in providerOptions" :key="provider.providerCode" :value="provider.providerCode">
                        {{ provider.providerName }}
                      </option>
                    </select>
                  </div>
                  <div class="mc-field">
                    <label class="mc-label" for="mc-model">模型</label>
                    <select id="mc-model" v-model="form.modelCode" class="mc-input" data-testid="mc-model">
                      <option value="">请选择</option>
                      <option v-for="model in modelOptions" :key="model.modelCode" :value="model.modelCode">
                        {{ model.modelName }}
                      </option>
                    </select>
                  </div>
                </div>
              </details>
            </div>

            <div class="mc-col mc-col-script">
              <section class="mc-pane mc-pane-script">
                <div class="mc-script-card" data-testid="mc-script-card">
            <div class="mc-script-head">
              <div class="mc-script-title">
                <h4>脚本</h4>
                <p class="mc-hint" data-testid="mc-script-version">{{ versionText }}</p>
                <!-- 1117 契约 3：脚本按 <仓库目录>/<sourceId>/<监控ID>.py 存 Git；只在智能体模式显示（内置接口存文件服务） -->
                <p v-if="form.kind === 'ai' && form.generationMode === 'agent'" class="mc-hint mc-target-path" data-testid="mc-target-path" :title="targetScriptPath || undefined">
                  Git 目标路径：<code v-if="targetScriptPath">{{ targetScriptPath }}</code><template v-else>{{ targetPathHint }}</template>
                </p>
                <p v-if="form.kind === 'ai' && archiveText" class="mc-hint" data-testid="mc-archive-status">Git：{{ archiveText }}</p>
              </div>
              <span v-if="hasAnyScript" class="mc-badge" :class="pending ? 'mc-badge-warn' : 'mc-badge-ok'">{{ pending ? '待保存' : '已生效' }}</span>

            </div>

            <p v-if="pending" class="mc-notice mc-notice-warn" data-testid="mc-script-pending">
              新生成，尚未保存：保存后才会生效，生成不改变当前版本
            </p>
            <p v-else-if="!hasAnyScript" class="mc-hint" data-testid="mc-script-empty">
              还没有可执行脚本。直接保存会成为草稿，草稿不会执行。
            </p>
            <p v-if="needsRegenerateNotice" class="mc-notice mc-notice-warn" data-testid="mc-needs-regenerate">
              {{ needsRegenerateNotice }}
            </p>

            <div v-if="hasAnyScript" class="mc-script-file" data-testid="mc-script-file">
              <span class="mc-file-icon" aria-hidden="true">PY</span>
              <div class="mc-file-info">
                <strong :title="scriptFile.name" data-testid="mc-script-filename">{{ scriptFile.name }}</strong>
                <span class="mc-faint">Python · {{ scriptFile.label }} · {{ displayedScript.length ? `${displayedScript.length} 字` : '正文待读取' }}</span>
              </div>
              <div class="mc-file-actions">
                <button type="button" class="mc-linkbtn" data-testid="mc-script-file-preview" @click="onPreviewScript">预览</button>
                <button type="button" class="mc-linkbtn" :disabled="downloadingScript" data-testid="mc-script-download" @click="onDownloadScript()">{{ downloadingScript ? '下载中…' : '下载' }}</button>
              </div>
              <p class="mc-file-location" data-testid="mc-script-path">{{ activePath || '仅保存脚本正文，下载时导出为 .py 文件' }}</p>
            </div>

            <div v-if="displayedScript.trim()" class="mc-script-preview" data-testid="mc-script-preview">
              <div class="mc-script-preview-head">
                <strong>脚本正文</strong>
                <span class="mc-faint">{{ displayedScript.length }} 字 · {{ pending ? '待保存' : '生效中' }}</span>
                <span class="mc-script-preview-ops">
                  <button type="button" class="mc-linkbtn" data-testid="mc-script-copy" @click="onCopyScript">复制</button>
                  <button
                    v-if="displayedScript.length > 600"
                    type="button"
                    class="mc-linkbtn"
                    data-testid="mc-script-toggle"
                    @click="scriptExpanded = !scriptExpanded"
                  >
                    {{ scriptExpanded ? '收起' : '展开全部' }}
                  </button>
                </span>
              </div>
              <pre
                class="mc-script-body"
                :class="{ 'is-expanded': scriptExpanded }"
                data-testid="mc-script-body"
              >{{ displayedScript }}</pre>
            </div>

            <div v-if="generating" class="mc-stream" data-testid="mc-stream">
              <div class="mc-stream-head">
                <strong>
                  <span class="mc-stream-dot" />
                  {{ generatingPreview ? '模型正在生成代码' : '模型正在思考' }}
                </strong>
                <span class="mc-faint">
                  {{ generatingElapsed.toFixed(1) }}s
                  <template v-if="generatingPreview"> · 已接收 {{ generatingPreview.length }} 字</template>
                  <template v-else-if="generatingThinking"> · 已思考 {{ generatingThinking.length }} 字</template>
                </span>
              </div>

              <!-- 代码开始输出后，思考过程收进折叠区，把空间让给正文 -->
              <template v-if="generatingPreview">
                <details v-if="generatingThinking" class="mc-stream-think">
                  <summary>思考过程（{{ generatingThinking.length }} 字）</summary>
                  <pre class="mc-stream-think-body" data-testid="mc-stream-thinking">{{ generatingThinking }}</pre>
                </details>
                <pre ref="streamRef" class="mc-script-body mc-stream-body" data-testid="mc-generating">{{ generatingPreview }}</pre>
              </template>

              <!-- 思考阶段：模型只推 thinking，代码在思考结束后才开始 -->
              <template v-else>
                <p class="mc-stream-note">
                  模型先思考、再输出代码；这一段不会出现代码，代码会在思考结束后逐字出现。
                </p>
                <pre ref="streamRef" class="mc-stream-think-body is-live" data-testid="mc-stream-thinking">{{ generatingThinking || '正在连接模型…' }}</pre>
              </template>
            </div>
            <ul class="mc-generation-checks" aria-label="生成前检查" data-testid="mc-generation-checks">
              <li v-for="check in generationChecks" :key="check.key">
                <span aria-hidden="true" :class="!check.ok ? 'mc-hint-error' : check.warn ? 'mc-check-warn' : 'mc-check-ok'" :data-testid="`mc-check-${check.key}`">{{ !check.ok ? '!' : check.warn ? 'i' : '✓' }}</span>
                {{ check.text }}
                <template v-if="!check.ok">
                  <button type="button" class="mc-mini" @click="focusGenerationCheck(check.key)">去查看</button>
                  <template v-if="check.key === 'prompt' && promptConflict">
                    <button type="button" class="mc-mini" data-testid="mc-prompt-sync" @click="restoreUserPrompt">按表单重新生成提示词</button>
                    <button type="button" class="mc-mini" data-testid="mc-prompt-keep" @click="acknowledgedPromptScope = promptScope">继续使用自定义提示词</button>
                  </template>
                  <button v-if="check.key === 'scope' && timeColumnError" type="button" class="mc-mini"
                    @click="loadTimeColumnFields()">重试读取字段</button>
                  <button v-if="form.generationMode === 'agent' && (check.key === 'mode' || (check.key === 'scope' && timeColumnError))"
                    type="button" class="mc-mini" @click="switchGenerationMode('builtin'); focusGenerationCheck('mode')">改用内置接口</button>
                </template>
              </li>
              <li v-if="form.generationMode === 'agent' && !monitorId">检查通过后先保存草稿取得监控 ID，草稿不会执行。</li>
            </ul>
            <p v-if="preflightError" class="mc-error" role="alert" data-testid="mc-preflight-error">{{ preflightError }}</p>
            <p v-if="generationError" class="mc-error" role="alert" data-testid="mc-generate-error">
              生成失败：{{ generationError }}（已保留原正文）
            </p>

              <div class="mc-script-actions">
                <button type="button" class="mc-btn" :disabled="busy || generationBlocked" data-testid="mc-generate" @click="onGenerate">
                  {{ preflighting ? '正在检查…' : generating ? '生成中…' : '生成脚本' }}
                </button>
                <button type="button" class="mc-btn" :disabled="testing || !canTest" data-testid="mc-test" @click="onTest">
                  {{ testing ? '测试中…' : '测试脚本' }}
                </button>
              </div>
            <p v-if="candidateStaleNotice" class="mc-notice mc-notice-warn" data-testid="mc-candidate-stale">
              {{ candidateStaleNotice }}
            </p>
            <p class="mc-hint">生成失败保留原脚本；保存成功后生效，不会自动运行检查。</p>
            <div v-if="testResult" class="mc-test-result" data-testid="mc-test-result">
              <div class="mc-test-head">
                <strong>{{ testResult.label }}</strong>
                <span class="mc-faint">· 测试对象：{{ testResult.target }}</span>
              </div>
              <div class="mc-test-line">{{ testResult.summary }}</div>
              <div class="mc-faint">{{ testResult.note }} · {{ testResult.at }}</div>
            </div>
          </div>
              </section>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="mc-grid">
            <div class="mc-field">
              <label class="mc-label" for="mc-rule-time">时间口径</label>
              <select id="mc-rule-time" v-model="form.timeType" class="mc-input" data-testid="mc-rule-timeType">
                <option value="C">C · 创建时间</option>
                <option value="U">U · 更新时间</option>
                <option value="M">M · 修改时间</option>
                <option value="T">T · 修改时间（起点取源上次任务）</option>
              </select>
            </div>
            <div class="mc-field">
              <label class="mc-label">数量范围</label>
              <div class="mc-inline">
                <input v-model="form.minSize" class="mc-input" type="number" placeholder="最小" data-testid="mc-rule-minSize">
                <span class="mc-faint">~</span>
                <input v-model="form.maxSize" class="mc-input" type="number" placeholder="最大" data-testid="mc-rule-maxSize">
              </div>
            </div>
          </div>

          <div class="mc-grid">
            <div class="mc-field">
              <label class="mc-label" for="mc-rule-start">时间表达（起）</label>
              <input id="mc-rule-start" v-model="form.startDt" class="mc-input" type="text" placeholder="yyyy-MM-dd HH:mm:ss" data-testid="mc-rule-startDt">
            </div>
            <div class="mc-field">
              <label class="mc-label" for="mc-rule-end">时间表达（止）</label>
              <input id="mc-rule-end" v-model="form.endDt" class="mc-input" type="text" placeholder="yyyy-MM-dd HH:mm:ss" data-testid="mc-rule-endDt">
            </div>
          </div>

          <div class="mc-field">
            <label class="mc-label" for="mc-rule-cond">自定义条件 SQL</label>
            <textarea id="mc-rule-cond" v-model="form.cond" class="mc-input mc-textarea" rows="3" placeholder="完整 SELECT 时替换默认 SQL；片段则附加" data-testid="mc-rule-cond" />
          </div>

          <div class="mc-field">
            <div class="mc-field-head">
              <label class="mc-label" for="mc-rule-expression">动态校验表达式</label>
              <button type="button" class="mc-mini" :disabled="testing" data-testid="mc-rule-verify" @click="verifyRule">
                {{ testing ? '校验中…' : '验证' }}
              </button>
            </div>
            <textarea id="mc-rule-expression" v-model="form.checkRule" class="mc-input mc-textarea" rows="3" placeholder="有值时不再与数量范围 AND" data-testid="mc-rule-checkRule" />
            <p class="mc-hint">验证只在本页执行 check-one，不发送业务通知、不更新正式最近结果。</p>
          </div>

          <div class="mc-field">
            <label class="mc-label" for="mc-rule-msg">告警提示</label>
            <input id="mc-rule-msg" v-model="form.checkMsg" class="mc-input" type="text" placeholder="例如：今日新增数据量为 0" data-testid="mc-rule-checkMsg">
          </div>

          <div v-if="testResult" class="mc-test-result" data-testid="mc-test-result">
            <div class="mc-test-head">
              <strong>{{ testResult.label }}</strong>
              <span class="mc-faint">· 测试对象：{{ testResult.target }}</span>
            </div>
            <div class="mc-test-line">{{ testResult.summary }}</div>
            <div class="mc-faint">{{ testResult.note }} · {{ testResult.at }}</div>
          </div>

          <p class="mc-hint">规则检查保留旧面板全部字段与行为（数量/时间/SQL/动态校验/消息）；旧配置不存在时默认「当日无新增数据即告警」。</p>
        </template>
      </section>

      <section v-show="activeTab === 'plan'" class="mc-section" data-testid="mc-panel-plan">
        <div class="mc-field">
          <label class="mc-label" for="mc-schedule">执行计划</label>
          <input
            id="mc-schedule"
            v-model="form.schedule"
            class="mc-input"
            type="text"
            placeholder="cron，例如 0 0 6-22 * * ?"
            data-testid="mc-schedule"
          >
          <div class="mc-quick-row">
            <button type="button" class="mc-mini" data-testid="mc-schedule-default" @click="form.schedule = DEFAULT_SCHEDULE">每天 06-22 点每小时</button>
            <button type="button" class="mc-mini" data-testid="mc-schedule-morning" @click="form.schedule = '0 30 8 * * ?'">每天 08:30</button>
            <button type="button" class="mc-mini" data-testid="mc-schedule-after" @click="form.schedule = 'AFTER:30'">采集任务后 30 分钟</button>
            <button type="button" class="mc-mini" data-testid="mc-schedule-clear" @click="form.schedule = ''">清空（不自动调度）</button>
          </div>
          <p class="mc-hint">
            支持 cron；AFTER:30 表示采集任务后 30 分钟触发校验。旧值原样回显，保存后由服务端重算下次时间。
          </p>
        </div>

        <div class="mc-card">
          <div class="mc-card-row">
            <span class="mc-k">下次执行</span>
            <span class="mc-v" data-testid="mc-next-run">{{ recordState?.nextRun || '待计算' }}</span>
          </div>
          <div class="mc-card-row">
            <span class="mc-k">调度覆盖</span>
            <span class="mc-v">—（需服务端聚合）</span>
          </div>
          <div class="mc-card-row">
            <span class="mc-k">改计划后</span>
            <span class="mc-v">下次时间「待计算」，覆盖状态「待重算」</span>
          </div>
        </div>
        <p class="mc-hint">执行计划作为运行参数随保存直接生效；不需要重新生成脚本。</p>
      </section>

      <section v-show="activeTab === 'notify'" class="mc-section" data-testid="mc-panel-notify">
        <div class="mc-field">
          <label class="mc-label">通知时机</label>
          <div class="mc-radio-list" role="radiogroup" aria-label="通知时机">
            <label v-for="option in NOTIFY_OPTIONS" :key="option.value" class="mc-radio">
              <input
                v-model="form.notifyOn"
                type="radio"
                :value="option.value"
                :data-testid="`mc-notify-${option.value}`"
              >
              <span>
                <strong>{{ option.label }}</strong>
                <span class="mc-faint">{{ option.hint }}</span>
              </span>
            </label>
          </div>
        </div>

        <div class="mc-field">
          <label class="mc-label">通知渠道</label>
          <div class="mc-inline">
            <label class="mc-check"><input v-model="form.channels" type="checkbox" value="mail" data-testid="mc-channel-mail"> 邮件</label>
            <!--
              钉钉暂不支持：AI 检查的执行器只投邮件（monitor_events.MAIL_CHANNELS），规则检查走 Java 时
              也不按所选渠道分发。勾选只会让人以为能收到，所以新选禁用；历史记录已勾的允许取消。
            -->
            <label
              class="mc-check"
              :class="{ 'is-disabled': !dingtalkSelected }"
              title="钉钉通知暂未接入，选了也收不到，请使用邮件"
            >
              <input
                v-model="form.channels"
                type="checkbox"
                value="dingtalk"
                :disabled="!dingtalkSelected"
                data-testid="mc-channel-dingtalk"
              >
              钉钉<span class="mc-faint">（暂不支持）</span>
            </label>
          </div>
          <p v-if="dingtalkSelected" class="mc-notice-warn mc-channel-warn" data-testid="mc-dingtalk-warn">
            这条记录勾选了钉钉，但钉钉通知暂未接入，不会收到{{ form.channels.includes('mail') ? '钉钉消息，只会发邮件' : '任何通知；请改勾邮件' }}。取消勾选后不能再选回。
          </p>
          <p v-else class="mc-hint">目前只支持邮件通知，钉钉暂未接入。</p>
        </div>

        <div class="mc-field">
          <label class="mc-label" for="mc-receivers">附加收件人</label>
          <input
            id="mc-receivers"
            v-model="form.receivers"
            class="mc-input"
            type="text"
            placeholder="多个用逗号分隔；默认收件人按记录回读，不在本页覆盖"
            data-testid="mc-receivers"
          >
        </div>

        <div class="mc-card">
          <div class="mc-card-row">
            <span class="mc-k">通知投递</span>
            <span class="mc-v" data-testid="mc-delivery">未取得回执</span>
          </div>
          <!-- 执行器 monitor_events.py 还没有 recovery 事件（2026-11-16 核对），不能写成「开启后会通知」。 -->
          <div class="mc-card-row">
            <span class="mc-k">恢复通知</span>
            <span class="mc-v" data-testid="mc-recovery">暂不支持：异常转正常时不会单独发「已恢复」通知</span>
          </div>
        </div>
        <p class="mc-hint">通知失败只影响投递，不改变数据结论与执行状态；测试脚本不会发送业务通知。</p>
      </section>
    </fieldset>

    <footer class="mc-foot">
      <span class="mc-foot-hint" data-testid="mc-foot-hint">
        {{ busy ? '正在处理，请稍候…' : (isDirty ? '修改尚未保存' : saveHint) }}
      </span>
      <div class="mc-foot-actions">
        <button type="button" class="mc-btn" :disabled="busy" data-testid="mc-cancel" @click="onCancel">取消</button>
        <button type="button" class="mc-btn mc-btn-primary" :disabled="busy || draftConfirmationFailed" data-testid="mc-save" @click="onSave">
          {{ saving ? '保存中…' : (saveLabel) }}
        </button>
      </div>
    </footer>
  </div>
  <el-drawer
    v-model="filePreviewOpen"
    :title="`脚本预览 · ${previewFile?.name || ''}`"
    size="min(760px, calc(100vw - 24px))"
    append-to-body
    class="mc-file-preview-drawer"
    @close="filePreviewRequest += 1; filePreviewLoading = false"
  >
    <div v-if="previewFile" class="mc-file-preview-content">
      <div class="mc-file-preview-toolbar">
        <span class="mc-faint">{{ previewFile.label }} · 只读预览</span>
        <button type="button" class="mc-btn" :disabled="filePreviewLoading || downloadingScript || !!filePreviewError" data-testid="mc-preview-download" @click="onDownloadScript(previewFile)">下载 .py</button>
      </div>
      <p class="mc-file-location">{{ previewFile.path || previewFile.name }}</p>
      <p v-if="filePreviewLoading" class="mc-hint">正在读取脚本文件…</p>
      <p v-else-if="filePreviewError" class="mc-error" role="alert">{{ filePreviewError }}</p>
      <pre v-else class="mc-file-full-code" data-testid="mc-file-full-code">{{ previewFile.body }}</pre>
    </div>
  </el-drawer>
</template>

<style scoped>

.mc-shell {
  display: flex;
  flex-direction: column;
  height: min(700px, calc(100dvh - 64px));
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--rc-surface);
  color: var(--rc-text);
  font-size: 12px;
}
.mc-head { flex: none; padding: 18px 52px 14px 16px; }
.mc-title-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mc-title { margin: 0; font-size: 14px; font-weight: 700; }
.mc-head-meta { flex-basis: 100%; color: var(--rc-text-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-badge { display: inline-flex; align-items: center; padding: 1px 6px; border: 1px solid transparent; border-radius: 4px; font-size: 11px; line-height: 18px; }
.mc-badge-ok { color: var(--rc-ok); background: var(--rc-ok-bg); border-color: #bbf7d0; }
.mc-badge-draft { color: var(--rc-muted); background: var(--rc-bg); border-color: var(--rc-border); }
.mc-badge-warn { color: var(--rc-warn); background: var(--rc-warn-bg); border-color: #fed7aa; }
.mc-tabs { display: flex; flex: none; padding: 0 16px; gap: 4px; border-block: 1px solid var(--rc-border-soft); background: #fafcff; }
.mc-tab { padding: 10px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; font-size: 12px; color: var(--rc-muted); cursor: pointer; white-space: nowrap; }
.mc-tab.active { color: var(--rc-primary); border-bottom-color: var(--rc-primary); font-weight: 600; }
.mc-body { flex: 1; min-width: 0; min-height: 0; width: 100%; margin: 0; padding: 14px 16px 20px; border: 0; overflow-y: auto; overflow-x: hidden; }
.mc-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.mc-section, .mc-col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.mc-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mc-field-head, .mc-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mc-label, .mc-pane-head h4 { margin: 0; color: var(--rc-text); font-size: 12px; font-weight: 600; }
.mc-label em, .mc-pane-head em { color: var(--rc-error); font-style: normal; }
.mc-input { width: 100%; min-width: 0; height: 30px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-surface); color: var(--rc-text); font: inherit; outline: none; }
.mc-input:hover { border-color: #b8c7dc; }
.mc-input:focus { border-color: var(--rc-primary); box-shadow: 0 0 0 2px var(--rc-primary-bg); }
.mc-textarea { height: auto; min-height: 72px; padding: 8px 9px; resize: vertical; line-height: 1.65; }
.mc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; min-width: 0; }
.mc-range-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mc-grid-basic { max-width: 840px; gap: 18px 20px; }
.mc-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mc-inline .mc-input { flex: 1; width: 0; }
.mc-readonly { min-height: 30px; padding: 6px 9px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-bg); color: var(--rc-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-kindbar { display: flex; align-items: center; gap: 10px; }
.mc-kindbar .mc-field { flex-direction: row; align-items: center; flex: none; }
.mc-kindbar .mc-label { display: none; }
.mc-kindbar-hint { flex: 1; }
.mc-segment { display: inline-flex; padding: 2px; border: 1px solid #cbd8ed; border-radius: 6px; background: var(--rc-bg); }
.mc-segment-item { height: 26px; padding: 0 14px; border: 0; border-radius: 4px; background: transparent; color: var(--rc-text-2); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
.mc-segment-item.active { background: var(--rc-primary); color: #fff; }
.mc-window-field { margin-top: 12px; }
.mc-window-segment { align-self: flex-start; flex-wrap: wrap; }
.mc-window-hours { align-self: flex-start; }
.mc-window-hours .mc-input { flex: none; width: 96px; }
.mc-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.mc-prompt-columns { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 12px; }
.mc-prompt-text { min-height: 230px; }
.mc-advanced { display: block; }
.mc-advanced[open] > :not(summary) { margin-top: 10px; }
.mc-advanced summary { cursor: pointer; }
.mc-advanced summary .mc-hint { margin-left: 8px; }
.mc-generation-checks { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px 12px; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); }
.mc-generation-checks li { overflow-wrap: anywhere; }
.mc-generation-checks button { margin-left: 6px; }
.mc-check-ok { color: var(--rc-ok); }
/* 能生成但走了兜底（如提示词模板读取失败用内置默认）：提示色，不用绿勾 */
.mc-check-warn { color: var(--rc-warning, #b45309); font-weight: 700; }
.mc-pane { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 12px; border: 1px solid #dce5f3; border-radius: 8px; background: var(--rc-surface); }
.mc-pane-script { padding: 0; border: 0; }
.mc-card { display: flex; flex-direction: column; padding: 2px 12px; border: 1px solid var(--rc-border); border-radius: 8px; background: var(--rc-surface); min-width: 0; }
.mc-card-row { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--rc-border-soft); }
.mc-card-row:last-child { border: 0; }
.mc-k { flex: 0 0 88px; color: var(--rc-muted); }
.mc-v { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.mc-script-card { display: flex; flex-direction: column; gap: 12px; padding: 12px; border: 1px solid #dce5f3; border-radius: 8px; min-width: 0; background: var(--rc-surface); }
.mc-script-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.mc-script-title h4 { margin: 0 0 12px; font-size: 12px; }
.mc-script-title p { margin: 0; }
.mc-script-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mc-script-preview { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mc-script-preview-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--rc-text); }
.mc-script-preview-ops { margin-left: auto; display: inline-flex; gap: 10px; }
.mc-linkbtn { padding: 0; border: 0; background: none; color: var(--rc-primary); font-size: 12px; font-weight: 600; cursor: pointer; }
.mc-linkbtn:hover { text-decoration: underline; }
.mc-script-body { margin: 0; padding: 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-bg); color: var(--rc-text-2); font: 11px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow: auto; }
.mc-script-body.is-expanded { max-height: none; overflow: visible; }
.mc-stream { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--rc-primary); border-radius: 8px; background: rgba(37, 99, 235, 0.03); min-width: 0; }
.mc-stream-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--rc-text); }
.mc-stream-head strong { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
/* 呼吸点：告诉用户“还在跑”，而不是卡住了 */
.mc-stream-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--rc-primary); animation: mc-pulse 1.2s ease-in-out infinite; }
@keyframes mc-pulse { 0%, 100% { opacity: 0.25; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
.mc-stream-note { margin: 0; color: var(--rc-muted); font-size: 11.5px; line-height: 1.6; }
/* 思考正文：等宽 + 自动滚到底，避免像一行乱码 */
.mc-stream-think-body { margin: 0; padding: 8px 10px; max-height: 180px; overflow: auto; border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.mc-stream-think-body.is-live { max-height: 220px; }
/* 代码开始输出后，思考收进折叠区 */
.mc-stream-think { border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #fff; }
.mc-stream-think > summary { padding: 6px 10px; cursor: pointer; color: var(--rc-muted); font-size: 11.5px; user-select: none; }
.mc-stream-think > summary:hover { color: var(--rc-primary); }
.mc-stream-think > .mc-stream-think-body { border-radius: 0 0 6px 6px; max-height: 140px; background: #f8fafc; }
.mc-stream-body { max-height: 280px; }
.mc-script-file { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 8px 10px; align-items: center; border: 1px solid var(--rc-border); border-radius: 6px; padding: 10px; background: var(--rc-bg); }
.mc-file-icon { display: grid; place-items: center; width: 34px; height: 38px; border: 1px solid var(--rc-border); border-radius: 5px; color: var(--rc-primary); background: var(--rc-surface); font-size: 11px; font-weight: 700; }
.mc-file-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mc-file-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.mc-file-actions { display: flex; gap: 12px; }
.mc-file-location { grid-column: 1 / -1; margin: 0; color: var(--rc-muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.mc-file-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.mc-file-preview-content { display: flex; flex-direction: column; gap: 12px; }
.mc-file-full-code { margin: 0; padding: 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-bg); color: var(--rc-text-2); font: 12px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.mc-test-result { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-bg); min-width: 0; }
.mc-test-head { display: flex; flex-wrap: wrap; gap: 6px; }
.mc-test-line { color: var(--rc-text-2); overflow-wrap: anywhere; white-space: pre-wrap; }
.mc-hint { margin: 0; font-size: 11px; line-height: 1.6; color: var(--rc-muted); }
.mc-faint { font-size: 11px; color: var(--rc-muted); }
.mc-note, .mc-notice { margin: 0; padding: 9px 10px; border-radius: 6px; background: var(--rc-bg); color: var(--rc-muted); line-height: 1.6; }
.mc-notice-warn { background: var(--rc-warn-bg); color: var(--rc-warn); border: 1px solid #fed7aa; }
.mc-error { margin: 0; padding: 8px 0; color: var(--rc-error); overflow-wrap: anywhere; }
.mc-radio-list { display: flex; flex-direction: column; gap: 12px; }
.mc-radio, .mc-check { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
.mc-check.is-disabled { cursor: not-allowed; color: var(--rc-muted); }
.mc-channel-warn { margin: 6px 0 0; padding: 6px 10px; border-radius: 6px; font-size: 12px; line-height: 1.6; }
.mc-radio span { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-quick-row { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-btn, .mc-mini { display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-surface); color: var(--rc-text-2); font: inherit; cursor: pointer; white-space: nowrap; }
.mc-mini { height: 25px; padding: 0 9px; font-size: 11px; }
.mc-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.mc-label-row .mc-label { margin-bottom: 0; }
.mc-target-path code { font-family: var(--rc-mono, monospace); font-size: 11px; color: var(--rc-text-2); word-break: break-all; }
.mc-hint-error { color: var(--rc-danger, #b91c1c); }
.mc-h4-note { margin-left: 4px; color: var(--rc-faint); font-size: 11px; font-weight: 400; }
.mc-btn:hover:not(:disabled), .mc-mini:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary); }
.mc-btn-primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; font-weight: 600; }
.mc-btn-primary:hover:not(:disabled) { background: var(--rc-primary-ink); color: #fff; }
.mc-btn:disabled, .mc-mini:disabled, .mc-body:disabled { cursor: wait; }
.mc-btn:disabled, .mc-mini:disabled { opacity: .55; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: 2px; }
.mc-foot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); background: var(--rc-bg); }
.mc-foot-hint { color: var(--rc-muted); font-size: 11px; }
.mc-foot-actions { display: flex; flex: none; gap: 8px; }
@media (max-width: 760px) {
  .mc-split, .mc-grid { grid-template-columns: minmax(0, 1fr); }
  .mc-prompt-columns { grid-template-columns: minmax(0, 1fr); }
  .mc-kindbar { align-items: flex-start; flex-direction: column; }
  .mc-shell { height: calc(100dvh - 32px); }
  .mc-foot-hint { max-width: 55%; }
}
</style>
