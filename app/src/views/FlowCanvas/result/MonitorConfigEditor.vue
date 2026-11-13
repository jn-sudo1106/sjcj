<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dataApi, fetchDefaultModels, fetchModelProviders, sourceApi } from '@/api'
import type { EntryType } from '@/api/types/collect'
import type { EntryTypeGroup } from '@/api/types/data'
import type { MonitorCheckConf, MonitorKind, MonitorRecordView } from '@/api/types/monitorCenter'
import type { ModelOption, ModelProviderOption } from '@/api/types/rule'
import { listMonitorsOfSource, saveMonitor } from '@/api/monitorCenter'
import { checkOneManual } from '@/api/monitor'
import { defaultDescription, defaultSystemPrompt } from '@/utils/monitor/methods'
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
 * 只有「生成 → 保存」才会把候选写进记录；「生成」本身不落库。
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
  { value: 'ok', label: '仅正常时', hint: '恢复或正常时通知' },
  { value: 'all', label: '每次运行', hint: '每次结果都通知，噪音大' },
  { value: 'none', label: '静默', hint: '只记录结果，不发送通知' },
] as const

const activeTab = ref<TabKey>('basic')
const form = reactive<MonitorEditorForm>(emptyForm())
const recordState = ref<MonitorRecordView | null>(props.record ?? null)
const committedForm = ref<MonitorEditorForm>({ ...emptyForm() })
const baseline = ref(formSignature(form))
const descTouched = ref(false)
const loading = ref(false)
const loadError = ref('')
const tableOptions = ref<Array<{ tableId: string; tableName: string; label: string }>>([])
/** 执行环境返回的物理字段，不能用目录中的业务字段别名替代。 */
const timeColumnFields = ref<string[]>([])
const providerOptions = ref<ModelProviderOption[]>([])
const modelOptions = ref<ModelOption[]>([])
const saving = ref(false)
const busy = computed(() => saving.value || generating.value || testing.value)
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

/** 仅展示执行环境真实存在的时间列；旧配置仍保留，但缺失字段需重新选择。 */
const timeColumnOptions = computed(() => timeColumnFields.value.length
  ? timeColumnOptionsOf(timeColumnFields.value).filter((field) => timeColumnFields.value.includes(field))
  : [])
const timeColumnError = ref('')
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
/** 写进业务描述里的窗口口径（要具体，不能留占位符） */
const descriptionWindow = computed(() => {
  if (form.windowType === 'hours') return `最近 ${normalizeWindowHours(form.windowHours)} 小时（Asia/Shanghai 业务时区）`
  if (form.windowType === 'period') return `上一个检查周期（约 ${windowPeriodHours.value} 小时，Asia/Shanghai 业务时区）`
  return '当日 00:00 至当前（Asia/Shanghai 业务时区）'
})

const versionText = computed(() => {
  const current = form.version || versionOf(recordState.value?.conf)
  if (pending.value) return `新生成，尚未保存（候选 ${nextVersionOf(current)}）`
  if (effectiveScript.value || effectivePath.value) return `生效中的脚本 ${current || ''}（只读）`
  return '草稿 · 未生效，不执行'
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
const candidateScope = ref<{ tableName: string; timeColumn: string } | null>(null)

const candidateStale = computed(() => {
  const scope = candidateScope.value
  if (!pending.value || !scope) return false
  return scope.tableName !== form.tableName.trim() || scope.timeColumn !== form.timeColumn.trim()
})

/**
 * 候选脚本按旧范围生成时的提示。这里不直接作废：用户可能只是想换个表看看，
 * 真到保存（会把脚本按新表发布）时再确认一次，给他重新生成的机会。
 */
const candidateStaleNotice = computed(() => {
  const scope = candidateScope.value
  if (!candidateStale.value || !scope) return ''
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
  descTouched.value = !!next.desc.trim()
  candidate.script = ''
  candidate.scriptPath = ''
  candidateScope.value = null
  pending.value = false
  generationError.value = ''
  generatingPreview.value = ''
  syncCommitted()
  void loadSourceContext()
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
    baseline.value = formSignature(form)
    committedForm.value = { ...form, methods: [...form.methods], channels: [...form.channels] }
    void loadSourceContext()
  }
  void loadModels()
}

onMounted(initialize)

watch(() => props.record, (record) => {
  if (record) applyRecord(record)
})

watch(() => props.sourceId, (sourceId) => {
  if (recordState.value) return
  if (!sourceId || sourceId === form.sourceId) return
  form.sourceId = sourceId
  void loadSourceContext()
})

/** 空表单才用模板填描述；用户改过（descTouched）后任何异步/切换都不覆盖（R09/T01） */
watch(
  () => [form.methods.slice(), form.tableName, form.sourceName],
  () => {
    if (descTouched.value) return
    if (form.desc.trim()) return
    if (!form.methods.length) return
    form.desc = defaultDescription({
      sourceName: form.sourceName,
      tableName: form.tableName,
      methods: [...form.methods],
      window: descriptionWindow.value,
      nullPolicy: form.nullPolicy,
      noDataPolicy: form.noDataPolicy,
    })
  },
  { deep: true },
)

/**
 * 字段清单 → 入库时间字段候选。
 * 只在「当前没选」且真实清单只有一个像时间列的字段时自动选中；多个候选不猜
 * （脚本会自报「无法自动识别入库时间列」，由用户确认，不偷偷填假列名）。
 */
function applyTimeColumnFields(fields: readonly string[]): void {
  timeColumnFields.value = fields.map((field) => (field || '').trim()).filter(Boolean)
  if (form.timeColumn.trim() || !timeColumnFields.value.length) return
  const candidates = timeColumnOptionsOf(timeColumnFields.value)
  if (candidates.length === 1) form.timeColumn = candidates[0]!
}

/** 换表/读源后向执行器查询实际物理字段。 */
function syncTimeColumnFields(): void {
  const tableName = form.tableName.trim()
  if (!tableName) {
    timeColumnFields.value = []
    return
  }
  timeColumnFields.value = []
  void loadTimeColumnFields()
}

async function loadTimeColumnFields(): Promise<void> {
  const request = ++timeColumnRequest
  const tableName = form.tableName.trim()
  if (!tableName) {
    timeColumnFields.value = []
    return
  }
  const tableId = tableOptions.value.find((table) => table.tableName === tableName)?.tableId ?? ''
  timeColumnError.value = ''
  try {
    const fields = await resolveMonitorTableFields({ tableName, tableId })
    if (request !== timeColumnRequest || form.tableName.trim() !== tableName) return
    const wasClean = formSignature(form) === baseline.value
    applyTimeColumnFields(fields)
    // 异步带出的唯一候选属于系统补全，不算用户改动（同「唯一关联表」的处理）
    if (wasClean) baseline.value = formSignature(form)
  } catch (error) {
    if (request !== timeColumnRequest) return
    applyTimeColumnFields([])
    timeColumnError.value = errorText(error)
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
  // 候选本身保留（candidateStale 会标出来，保存时再确认）；但按旧表跑出来的试跑结果已无意义
  if (pending.value) testResult.value = null
  if (!form.tableName) {
    timeColumnFields.value = []
    form.timeColumn = ''
    return
  }
  // 换表后旧表的时间列可能不存在：清空再由新表字段重新给候选（唯一候选自动选中）
  form.timeColumn = ''
  timeColumnFields.value = []
  syncTimeColumnFields()
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

async function onSourceChanged(sourceId: string): Promise<void> {
  if (busy.value) return
  if (sourceId === form.sourceId) return
  if (!(await confirmDiscard('监控源'))) return
  candidate.script = ''
  candidate.scriptPath = ''
  candidateScope.value = null
  pending.value = false
  testResult.value = null
  generationError.value = ''
  form.sourceId = sourceId
  form.sourceName = ''
  form.tableName = ''
  form.timeColumn = ''
  timeColumnFields.value = []
  await loadSourceContext()
}

async function onSourcePicked(sourceId: string, name: string): Promise<void> {
  if (busy.value) return
  if (sourceId === form.sourceId) return
  if (!(await confirmDiscard('监控源'))) return
  candidate.script = ''
  candidate.scriptPath = ''
  candidateScope.value = null
  pending.value = false
  testResult.value = null
  generationError.value = ''
  form.sourceId = sourceId
  form.sourceName = name
  form.tableName = ''
  form.timeColumn = ''
  timeColumnFields.value = []
  await loadSourceContext()
}

function onDescInput(): void {
  descTouched.value = true
}

function fillDescription(): void {
  if (form.desc.trim() && descTouched.value) {
    ElMessage.info('业务描述已有内容，未自动覆盖')
    return
  }
  form.desc = defaultDescription({
    sourceName: form.sourceName,
    tableName: form.tableName,
    methods: [...form.methods],
    window: descriptionWindow.value,
    nullPolicy: form.nullPolicy,
    noDataPolicy: form.noDataPolicy,
  })
}

function switchKind(kind: MonitorKind): void {
  if (form.kind === kind) return
  form.kind = kind
  // 切换只改变本次保存写哪一组字段，不删另一组定义；旧记录切回时仍能看到原来的脚本/规则
  if (kind === 'rule' && !form.schedule.trim()) form.schedule = DEFAULT_SCHEDULE
  if (kind === 'ai' && !form.methods.length && form.desc.trim()) {
    ElMessage.info('已切换到 AI 检查：还需要勾选监控方法')
  }
}

async function onGenerate(): Promise<void> {
  if (busy.value) return
  if (!form.sourceId.trim()) {
    ElMessage.warning('请先选择被监控源')
    return
  }
  if (!form.methods.length) {
    activeTab.value = 'check'
    ElMessage.warning('AI 检查至少选择一个监控方法')
    return
  }
  if (!form.desc.trim()) {
    activeTab.value = 'check'
    ElMessage.warning('请先填写业务描述')
    return
  }
  if (!form.providerCode || !form.modelCode) {
    activeTab.value = 'check'
    ElMessage.warning('请先选择模型供应商与模型')
    return
  }
  generating.value = true
  generationError.value = ''
  generatingPreview.value = ''
  generatingThinking.value = ''
  scriptExpanded.value = false
  startElapsedTimer()
  const previous = { script: candidate.script, scriptPath: candidate.scriptPath }
  try {
    // 源结果检查只读本条检查选定的表：不读源流程、不借任何监控节点的 configId/输入表
    const tableId = tableOptions.value.find((table) => table.tableName === form.tableName)?.tableId ?? ''
    const fields = await resolveMonitorTableFields({ tableName: form.tableName, tableId })
    applyTimeColumnFields(fields)
    if (!form.timeColumn || !fields.includes(form.timeColumn)) {
      throw new Error(`请选择当前表实际存在的入库时间字段（当前：${form.timeColumn || '未选择'}），然后重新生成脚本`)
    }
    const context = await resolveSourceResultContext({ tableName: form.tableName, tableId })
    const result = await generateMonitorScript({
      context,
      description: form.desc,
      methods: [...form.methods],
      // data-engine 对空 systemPrompt 直接抛「text cannot be null or empty」，必须兜底；
      // 再追加主表真实字段与入库时间列，避免模型自己发明列名（实测失败原因之一）
      systemPrompt: augmentMonitorSystemPrompt(
        form.systemPrompt.trim() || defaultSystemPrompt(),
        fields,
        form.timeColumn,
      ),
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
    if (!result.script.trim() && !result.scriptPath.trim()) {
      throw new Error('生成完成但没有返回脚本正文或文件路径')
    }
    candidate.script = result.script
    candidate.scriptPath = result.scriptPath
    candidateScope.value = { tableName: form.tableName.trim(), timeColumn: form.timeColumn.trim() }
    pending.value = true
    testResult.value = null
    ElMessage.success('脚本已生成（尚未保存）：保存后才会生效，生成不改变当前版本')
  } catch (error) {
    // 失败保留原正文：不吃掉已有的生效脚本/上一次候选，也不落库
    candidate.script = previous.script
    candidate.scriptPath = previous.scriptPath
    pending.value = !!previous.script || !!previous.scriptPath
    if (!pending.value) candidateScope.value = null
    generationError.value = errorText(error)
    ElMessage.error(`生成脚本失败：${generationError.value}`)
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

function pickReadback(monitors: MonitorRecordView[] | null, beforeIds: string[] | null): MonitorRecordView | null {
  if (!monitors) return null
  const current = recordState.value
  if (current) return monitors.find((item) => item.id === current.id) ?? null
  // 新建记录没有 id 回执时按「保存前不存在的 id + 同名」定位；定位不到宁可不猜（不把旧记录当新记录）
  if (!beforeIds) return null
  const before = new Set(beforeIds)
  const created = monitors.filter((item) => !before.has(item.id) && item.name === form.name.trim())
  return created.length === 1 ? created[0]! : null
}

async function onSave(): Promise<void> {
  if (busy.value) return
  const invalid = validateForm(form)
  if (invalid) {
    activeTab.value = invalid.key === 'methods' ? 'check' : 'basic'
    ElMessage.warning(invalid.message)
    return
  }
  saving.value = true
  try {
    // 不阻断：执行器不传 --time-column 时脚本会自报「无法自动识别入库时间列」并退出，
    // 比页面偷偷填一个假列名再跑错要好
    if (form.kind === 'ai' && !form.timeColumn.trim()) {
      ElMessage.warning('未选择入库时间字段：表里有多个时间列时脚本会自报错，本次仍会保存')
    }
    const baseConf: MonitorCheckConf = recordState.value?.conf ?? {}
    const generated = pending.value && !!(candidate.script.trim() || candidate.scriptPath.trim())
    // 候选是按旧表/旧时间列生成的：脚本列名写死，直接发布会把旧范围套到新表上
    if (generated && candidateStale.value && candidateScope.value) {
      try {
        await ElMessageBox.confirm(
          `候选脚本是按「${candidateScope.value.tableName || '未选表'}」生成的，当前检查范围是「${[form.tableName, form.timeColumn].filter(Boolean).join(' · ') || '未选表'}」。继续保存会按新范围发布这份旧表脚本，是否仍然保存？`,
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
      script: generated ? candidate.script : undefined,
      scriptPath: generated ? candidate.scriptPath : undefined,
    })
    if (form.kind === 'ai') conf.version = savedVersion || undefined

    let beforeIds: string[] | null = null
    if (!recordState.value) {
      const before = await listMonitorsOfSource(form.sourceId.trim()).catch(() => null)
      beforeIds = before?.map((item) => item.id) ?? null
    }

    await saveMonitor({
      record: recordState.value ?? undefined,
      sourceId: form.sourceId.trim(),
      name: form.name.trim(),
      kind: form.kind,
      conf,
      tableName: form.tableName.trim(),
      schedule: form.schedule.trim(),
    })

    // 保存回执不含完整记录（C01 未就绪）：按源回读，把回读结果当新基线；读不到就不猜 ID
    const monitors = await listMonitorsOfSource(form.sourceId.trim()).catch(() => null)
    const readback = pickReadback(monitors, beforeIds)
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
          {{ isEditing ? recordStatusText : '草稿 · 未生效' }}
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

      <section v-show="activeTab === 'basic'" class="mc-section" data-testid="mc-panel-basic">
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
            @update:model-value="onSourceChanged"
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
          勾选检查方法并填写业务描述后生成脚本；不生成直接保存 = 草稿（未生效，不执行）。
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
              <section class="mc-pane">
                <div class="mc-pane-head">
                  <h4>业务描述 <em>*</em></h4>
                  <button type="button" class="mc-mini" data-testid="mc-desc-template" @click="fillDescription">按模板填充</button>
                </div>
                <textarea
                  id="mc-desc-input"
                  v-model="form.desc"
                  class="mc-input mc-textarea"
                  rows="4"
                  placeholder="说明检查什么、正常标准、异常条件"
                  data-testid="mc-desc-input"
                  @input="onDescInput"
                />
                <p class="mc-hint">默认描述只在空白表单时填入；修改后切换方法/关联表不会被静默覆盖。</p>
              </section>

              <section class="mc-pane">
                <AiMethodsField v-model="form.methods" />
              </section>

              <section class="mc-pane">
                <div class="mc-pane-head"><h4>数据范围与关联</h4></div>
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
                      data-testid="mc-time-column"
                    >
                      <option value="">请选择</option>
                      <option v-for="column in timeColumnOptions" :key="column" :value="column">{{ column }}</option>
                    </select>
                    <p class="mc-hint">脚本按这一列统计；不确定时选表的入库时间列</p>
                    <p v-if="timeColumnError" class="mc-hint">{{ timeColumnError }}</p>
                    <p v-else-if="form.timeColumn && timeColumnFields.length && !timeColumnFields.includes(form.timeColumn)" class="mc-hint">
                      当前表不存在字段 {{ form.timeColumn }}，请重新选择并生成脚本。
                    </p>
                  </div>
                  <div class="mc-field">
                    <label class="mc-label" for="mc-null-policy">字段值为空时</label>
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
                <div class="mc-grid">
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
                <div class="mc-field">
                  <label class="mc-label" for="mc-system-prompt">系统提示词</label>
                  <textarea
                    id="mc-system-prompt"
                    v-model="form.systemPrompt"
                    class="mc-input mc-textarea"
                    rows="3"
                    placeholder="留空则使用默认提示词"
                    data-testid="mc-system-prompt"
                  />
                </div>
                <p class="mc-hint">生成与测试不改变生效版本；保存即生效。</p>
              </section>
            </div>

            <div class="mc-col mc-col-script">
              <section class="mc-pane mc-pane-script">
                <div class="mc-script-card" data-testid="mc-script-card">
            <div class="mc-script-head">
              <div class="mc-script-title">
                <h4>脚本</h4>
                <p class="mc-hint" data-testid="mc-script-version">{{ versionText }}</p>
              </div>
              <span v-if="hasAnyScript" class="mc-badge" :class="pending ? 'mc-badge-warn' : 'mc-badge-ok'">{{ pending ? '待保存' : '已生效' }}</span>

            </div>

            <p v-if="pending" class="mc-notice mc-notice-warn" data-testid="mc-script-pending">
              新生成，尚未保存：保存后才会生效，生成不改变当前版本
            </p>
            <p v-else-if="!hasAnyScript" class="mc-hint" data-testid="mc-script-empty">
              当前是「草稿 · 未生效，不执行」：没有可执行脚本，保存后也不会运行；先生成脚本再保存。
            </p>
            <p v-if="needsRegenerateNotice" class="mc-notice mc-notice-warn" data-testid="mc-needs-regenerate">
              {{ needsRegenerateNotice }}
            </p>

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
            <p v-else-if="activePath.trim()" class="mc-script-path" data-testid="mc-script-path">
              生效脚本文件：{{ activePath }}（暂未取得正文）
            </p>

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
            <p v-if="generationError" class="mc-error" data-testid="mc-generate-error">
              生成失败：{{ generationError }}（已保留原正文）
            </p>

              <div class="mc-script-actions">
                <button type="button" class="mc-btn" :disabled="generating || saving" data-testid="mc-generate" @click="onGenerate">
                  {{ generating ? '生成中…' : '生成脚本' }}
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
            <label class="mc-check"><input v-model="form.channels" type="checkbox" value="dingtalk" data-testid="mc-channel-dingtalk"> 钉钉</label>
          </div>
          <p class="mc-hint">通知将发送至所选渠道。</p>
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
          <div class="mc-card-row">
            <span class="mc-k">恢复通知</span>
            <span class="mc-v">开启后，异常转正常会单独通知；执行失败不算恢复</span>
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
        <button type="button" class="mc-btn mc-btn-primary" :disabled="busy" data-testid="mc-save" @click="onSave">
          {{ saving ? '保存中…' : (saveLabel) }}
        </button>
      </div>
    </footer>
  </div>
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
.mc-split { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.mc-col-script { position: sticky; top: 0; }
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
.mc-script-path { margin: 0; padding: 8px 10px; background: var(--rc-bg); border-radius: 6px; color: var(--rc-text-2); overflow-wrap: anywhere; }
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
.mc-radio span { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-quick-row { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-btn, .mc-mini { display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-surface); color: var(--rc-text-2); font: inherit; cursor: pointer; white-space: nowrap; }
.mc-mini { height: 25px; padding: 0 9px; font-size: 11px; }
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
  .mc-col-script { position: static; }
  .mc-kindbar { align-items: flex-start; flex-direction: column; }
  .mc-shell { height: calc(100dvh - 32px); }
  .mc-foot-hint { max-width: 55%; }
}
</style>
