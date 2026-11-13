<script setup lang="ts">
// 监控中心 · 源维度列表（1110 §3.2 / 1111）。
//
// 一行 = 一个源，检查项在行内展开（同一时刻只展开当前源），运行结果一律走右侧抽屉。
// 页面只读 MonitorRecordView / MonitorSourceRow，不解释旧接口的 state / isDelete；
// 无 C07 的维度显示「—（需服务端聚合）」，不按时隙推算、不把本页数量当全站。
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import type { MonitorKind, MonitorRecordView, MonitorSourceRow } from '@/api/types/monitorCenter'
import {
  MonitorQueryLimitError,
  listMonitors,
  listMonitorsOfSource,
  listSourceSummary,
  loadSourceSummaryStats,
  listSourceNames,
  listSourceOptions,
  runMonitorsNow,
  setMonitorsEnabled,
  type MonitorSourceOption,
  type SourceSummaryStats,
} from '@/api/monitorCenter'
import { deleteSourceCheck } from '@/api/monitor'
import { summarizeSources } from '@/utils/monitor/sourceSummary'
import { confirmDanger } from '@/utils/confirmDanger'
import MonitorBatchDialog from './MonitorBatchDialog.vue'
import MonitorWatchDrawer from './MonitorWatchDrawer.vue'
import MonitorConfigEditor from '@/views/FlowCanvas/result/MonitorConfigEditor.vue'
import RunsDrawer from '@/views/FlowCanvas/result/monitor-runs/RunsDrawer.vue'
import {
  CHECK_DATE_OPTIONS,
  ENABLE_OPTIONS,
  STATUS_OPTIONS,
  checkCoverageOf,
  sourceHintOf,
  sourceSubtitleOf,
  sourceTitleOf,
  coverageOf,
  dataHintOf,
  dataPillOf,
  execNotifyOf,
  filterSourceRows,
  lastCheckOf,
  monitorDataOf,
  monitorExecOf,
  monitorKindText,
  monitorPlanOf,
  monitorPublishText,
  monitorSummaryOf,
  sourceStats,
  type SourceListQuery,
} from './sourceRows'

defineOptions({ name: 'SourceCheck' })

const props = withDefaults(
  defineProps<{
    /** 嵌入弹窗（网站配置弹窗 / 源内视图）时去掉卡片壳，筛选保持完整 */
    embedded?: boolean
    /** 源上下文：锁定到当前源，不再加载整份源目录 */
    sourceId?: string
    /** 网站上下文：源目录按网站取，列表只保留该网站的源；不传则监控中心全局 */
    siteId?: string
    siteName?: string
  }>(),
  { embedded: false, sourceId: '', siteId: '', siteName: '' },
)

const PAGE_SIZES = [10, 30, 100, 200]

const loading = ref(false)
const records = ref<MonitorRecordView[]>([])
const directory = ref<MonitorSourceOption[]>([])
/** 按需取到的源名称（目录超限时仍能显示名字，而不是只剩 ID） */
const nameIndex = ref<MonitorSourceOption[]>([])
/** 源目录可用时才能列出「未配置检查的源」；不可用时降级为「仅已配置源 + 提示」 */
const directoryReady = ref(false)
/** 全局视图不再尝试拉全量源目录（24 万源必然超限，20 次串行请求只会让首屏变慢） */
const directorySkipped = ref(false)
/** 服务端源聚合（C07 首期）结果；null 表示不可用，页面回落到「只列已配置源」 */
const summaryRows = ref<MonitorSourceRow[] | null>(null)
const summaryTotal = ref(0)
/** 全站/本组统计（C07）：与分页同一范围口径；available=false 时显示「—」 */
const summaryStats = ref<SourceSummaryStats | null>(null)
const loadError = ref('')
const directoryError = ref('')
let refreshToken = 0

const draft = reactive<SourceListQuery>({
  sourceId: props.sourceId,
  enable: 'all',
  status: 'all',
  keyword: '',
  checkDate: 'all',
})
/** 已生效的筛选：刷新时用它，避免把输入到一半的草稿当成查询条件 */
const applied = reactive<SourceListQuery>({ ...draft })

const page = ref(1)
const pageSize = ref(30)
const expandedKeys = ref<string[]>([])
const expandedSourceId = ref('')
const selectedMonitors = ref<MonitorRecordView[]>([])

// 统一编辑器：新建默认 AI 检查，规则检查在同一弹窗里保留旧能力。
// 编辑时必须传 record（记录身份），否则会拿 blank 草稿保存成一条重复记录。
const editingSourceId = ref('')
const editorVisible = ref(false)
const editingRecord = ref<MonitorRecordView | null>(null)
const editorRef = ref<InstanceType<typeof MonitorConfigEditor>>()
// 统一运行抽屉（fe-runs 的 RunsDrawer）：列表层 → 单次详情层自带返回。
// monitorId 优先；只有源时按源范围列该源全部检查项的正式运行。
const runsOpen = ref(false)
const runsSourceId = ref<string>()
const runsMonitorId = ref<string>()
const runsTitle = ref<string>()

const editingLockSource = ref(true)
const batchVisible = ref(false)
const watchVisible = ref(false)

const scopeKind = computed<'global' | 'site' | 'source'>(() => {
  if (props.sourceId) return 'source'
  if (props.siteId) return 'site'
  return 'global'
})

const sourceNameById = computed(() => new Map(directory.value.map((item) => [item.sourceId, item.name])))

const scopeText = computed(() => {
  if (scopeKind.value === 'source') {
    const name =
      records.value.find((row) => row.sourceId === props.sourceId)?.sourceName ||
      sourceNameById.value.get(props.sourceId) ||
      ''
    return name ? `${name}（${props.sourceId}）` : `源：${props.sourceId}`
  }
  if (scopeKind.value === 'site') {
    const name = props.siteName || directory.value[0]?.siteName || ''
    return name ? `网站：${name}` : `网站：${props.siteId}`
  }
  return '权限内全局'
})

const scopeHint = computed(() => {
  if (scopeKind.value === 'source') return '已锁定到当前源，不能切换到其他源'
  if (scopeKind.value === 'site') return '已锁定到当前网站，只展示该网站下的源'
  return '一行一个源，展开查看检查项，运行结果在右侧抽屉查看'
})

const scopedRecords = computed(() => {
  if (scopeKind.value === 'source') return records.value.filter((row) => row.sourceId === props.sourceId)
  if (scopeKind.value === 'site') {
    // 网站上下文只能靠源目录收敛范围：目录不可用时不展示，避免串出其他网站的源
    const ids = new Set(directory.value.map((item) => item.sourceId))
    return records.value.filter((row) => ids.has(row.sourceId))
  }
  return records.value
})

/** 名称来源：目录优先，其次是按 ID 批量取回的那批 */
const sourceCatalog = computed<MonitorSourceOption[]>(() => {
  const map = new Map<string, MonitorSourceOption>()
  for (const item of nameIndex.value) map.set(item.sourceId, item)
  for (const item of directory.value) map.set(item.sourceId, item)
  return [...map.values()]
})

/** 传给聚合函数的源描述（id/name/siteId/siteName 四个字段） */
const sourceLikes = computed(() =>
  sourceCatalog.value.map((item) => ({
    id: item.sourceId,
    name: item.name,
    siteId: item.siteId,
    siteName: item.siteName,
    tableName: item.tableName,
  })),
)

const allRows = computed<MonitorSourceRow[]>(() => {
  // 服务端聚合可用时直接用它：一行一个源、含未配置检查的源，且分组权限由后端保证。
  if (scopeKind.value !== 'source' && summaryRows.value) {
    return summaryRows.value.map((row) => ({
      ...row,
      monitors: records.value.filter((monitor) => monitor.sourceId === row.sourceId),
    }))
  }
  if (scopeKind.value === 'source') {
    const monitors = scopedRecords.value
    return summarizeSources(monitors, [
      { id: props.sourceId, name: monitors[0]?.sourceName || sourceNameById.value.get(props.sourceId), siteId: props.siteId || undefined, siteName: props.siteName || undefined },
    ])
  }
  if (scopeKind.value === 'global' && !directoryReady.value) {
    // 降级：源目录拿不到（超限/失败）时只列已配置源，页面顶部另有提示，不把分页结果拼成「全量」。
    // 名称仍走「按 ID 取回」的那批，别退化成只剩 ID。
    return summarizeSources(records.value, sourceLikes.value)
  }
  return summarizeSources(scopedRecords.value, sourceLikes.value)
})

/** 服务端聚合模式：筛选与分页都在服务端，客户端不再二次切片（否则每页只剩几条） */
const summaryMode = computed(() => scopeKind.value !== 'source' && !!summaryRows.value)
/** 服务端不认的筛选（执行失败/未生效/待判断）只能在当前页内过滤，避免翻页后「筛了个寂寞」 */
const summaryUnsupported = computed(
  () => summaryMode.value && ['failed', 'draft', 'pending'].includes(applied.status),
)
const filteredRows = computed(() => {
  if (!summaryMode.value) return filterSourceRows(allRows.value, applied)
  if (!summaryUnsupported.value) return allRows.value
  return filterSourceRows(allRows.value, { ...applied, enable: 'all', checkDate: 'all' })
})
const pagedRows = computed(() =>
  summaryMode.value
    ? filteredRows.value
    : filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
)
/** 分页总数：服务端模式用后端 total，否则用本地筛选后的条数 */
const pagerTotal = computed(() => (summaryMode.value ? summaryTotal.value : filteredRows.value.length))
/** 统计只算本页：无 C07 时不能把全站异常数说成已知 */
const stats = computed(() => sourceStats(pagedRows.value))
const configuredCount = computed(() => filteredRows.value.filter((row) => row.monitorTotal > 0).length)

watch(
  () => filteredRows.value.length,
  (length) => {
    const pages = Math.max(1, Math.ceil(length / pageSize.value))
    if (page.value > pages) page.value = pages
  },
)

watch(
  () => [props.sourceId, props.siteId] as const,
  ([sourceId]) => {
    draft.sourceId = sourceId || ''
    applied.sourceId = sourceId || ''
    page.value = 1
    void refresh()
  },
)

function readableError(err: unknown, fallback: string): string {
  if (err instanceof MonitorQueryLimitError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}

async function loadRecords(request: number): Promise<void> {
  loadError.value = ''
  try {
    // 源上下文只需要这一个源的记录：走单源查询，避免整表 4000+ 条上限把页面卡在限制错误上
    const loaded =
      scopeKind.value === 'source'
        ? await listMonitorsOfSource(props.sourceId)
        : await listMonitors(applied.sourceId ? { sourceId: applied.sourceId } : {})
    if (request === refreshToken) records.value = loaded
  } catch (err) {
    if (request !== refreshToken) return
    records.value = []
    loadError.value = readableError(err, '监控记录加载失败')
  }
}

async function loadDirectory(request: number): Promise<void> {
  directoryError.value = ''
  directoryReady.value = false
  directorySkipped.value = false
  if (scopeKind.value === 'source') return
  if (scopeKind.value === 'global') {
    // 真机源 24 万条，`source/sourcePaged` 一页 200 拉满 20 页也取不完。
    // 与其串行打完 20 个请求再报错（首屏等十几秒），不如直接按「仅已配置源」出数据，
    // 名称走 `listSourceNames` 按 ID 批量取（2 个请求）。
    directorySkipped.value = true
    return
  }
  try {
    const loaded = await listSourceOptions(props.siteId ? { siteId: props.siteId } : {})
    if (request !== refreshToken) return
    directory.value = loaded
    directoryReady.value = true
  } catch (err) {
    if (request !== refreshToken) return
    directory.value = []
    directoryError.value = readableError(err, '源目录加载失败')
  }
}

/**
 * 记录拿到后按 sourceId 批量补名称。
 * 源目录 24 万+ 拉不全（全局会提示「源数量超过 4000」），但列表只需要这些源的名字。
 */
async function loadSourceNames(request: number): Promise<void> {
  const ids = [...new Set(records.value.map((row) => row.sourceId))]
  if (!ids.length) {
    nameIndex.value = []
    return
  }
  try {
    const loaded = await listSourceNames(ids)
    if (request !== refreshToken) return
    nameIndex.value = loaded
  } catch {
    if (request !== refreshToken) return
    nameIndex.value = []
  }
}

/**
 * 服务端源聚合（C07 首期）：真正把「未配置检查的源」列出来，并由后端按分组过滤。
 * 失败/未部署时保持 null，页面继续用老的「已配置源 + 按 ID 取名」路径，不假装聚合成功。
 */
async function loadSummary(request: number): Promise<void> {
  if (scopeKind.value === 'source') return
  const result = await listSourceSummary({
    siteId: props.siteId || undefined,
    keyword: applied.keyword || undefined,
    enabled: summaryEnabledParam.value,
    dataState: summaryDataStateParam.value,
    checkDate: applied.checkDate && applied.checkDate !== 'all' ? applied.checkDate : undefined,
    page: page.value,
    size: pageSize.value,
  })
  if (request !== refreshToken) return
  if (result.unavailable) {
    summaryRows.value = null
    summaryTotal.value = 0
    return
  }
  summaryRows.value = result.rows
  summaryTotal.value = result.total
  const stats = await loadSourceSummaryStats({
    siteId: props.siteId || undefined,
    keyword: applied.keyword || undefined,
  })
  if (request !== refreshToken) return
  summaryStats.value = stats.available ? stats : null
}

/** 启停筛选 → 服务端 enabled 参数（未配置走 dataState=none） */
const summaryEnabledParam = computed<'yes' | 'no' | undefined>(() => {
  if (applied.enable === 'enabled') return 'yes'
  if (applied.enable === 'disabled') return 'no'
  return undefined
})
/** 数据情况筛选 → 服务端 dataState 参数；执行失败/未生效/待判断服务端暂无对应口径 */
const summaryDataStateParam = computed<string | undefined>(() => {
  if (applied.enable === 'unconfigured') return 'none'
  const map: Record<string, string> = {
    abnormal: 'abnormal',
    normal: 'normal',
    disabled: 'disabled',
    unchecked: 'unknown',
  }
  return map[applied.status]
})

async function refreshData(): Promise<void> {
  const request = ++refreshToken
  loading.value = true
  try {
    await Promise.all([loadRecords(request), loadDirectory(request), loadSummary(request)])
    await loadSourceNames(request)
  } finally {
    if (request === refreshToken) {
      loading.value = false
      selectedMonitors.value = []
    }
  }
}

/** 紧凑刷新：保留已生效筛选与分页大小，不重置到第一页 */
async function refresh(): Promise<void> {
  await refreshData()
}

function applyFilters(): void {
  const sourceChanged = applied.sourceId !== draft.sourceId
  applied.sourceId = scopeKind.value === 'source' ? props.sourceId : draft.sourceId
  applied.enable = draft.enable
  applied.status = draft.status
  applied.checkDate = draft.checkDate ?? 'all'
  applied.keyword = draft.keyword.trim()
  page.value = 1
  collapseExpanded()
  if (sourceChanged || summaryMode.value) {
    void refresh()
  }
}

function resetFilters(): void {
  draft.sourceId = scopeKind.value === 'source' ? props.sourceId : ''
  draft.enable = 'all'
  draft.status = 'all'
  draft.checkDate = 'all'
  draft.keyword = ''
  applyFilters()
}

function onSizeChange(): void {
  page.value = 1
  if (summaryMode.value) void loadSummary(refreshToken)
}

function onPageChange(next: number): void {
  page.value = next
  if (summaryMode.value) void loadSummary(refreshToken)
}

function collapseExpanded(): void {
  expandedKeys.value = []
  expandedSourceId.value = ''
  selectedMonitors.value = []
}

function expandSource(sourceId: string): void {
  expandedKeys.value = [sourceId]
  expandedSourceId.value = sourceId
  selectedMonitors.value = []
}

function toggleExpand(row: MonitorSourceRow): void {
  if (expandedKeys.value.includes(row.sourceId)) collapseExpanded()
  else expandSource(row.sourceId)
}

/**
 * el-table 允许多行同时展开，而页面要求「只展开当前源」：
 * 保留最后触发的那个源，其余立即折叠（写入 expand-row-keys 由 el-table 同步）。
 */
function onExpandChange(row: MonitorSourceRow, expanded: unknown): void {
  const opened = Array.isArray(expanded)
    ? expanded.some((item) => item?.sourceId === row.sourceId)
    : Boolean(expanded)
  if (opened) {
    expandSource(row.sourceId)
    return
  }
  if (expandedSourceId.value === row.sourceId) collapseExpanded()
}

function onInnerSelectionChange(rows: MonitorRecordView[]): void {
  selectedMonitors.value = rows
}

/**
 * 新增监控直接进编辑器，源在编辑器里选（原型就是这么做的）。
 * 不再多一层「先选择源」弹窗：那一层既不进原型，也让「选源」和「填检查项」被切成两步。
 * 从某一行「加监控」或源内视图进来时带 sourceId 并锁源；全局入口 source 可搜索。
 */
function openAddDialog(): void {
  void openAddFor(props.sourceId)
}

async function openAddFor(sourceId: string): Promise<void> {
  editingSourceId.value = sourceId
  editingLockSource.value = !!sourceId
  editingRecord.value = null
  await nextTick()
  editorVisible.value = true
}

async function openEdit(row: MonitorSourceRow, monitor: MonitorRecordView): Promise<void> {
  editingSourceId.value = row.sourceId
  // 传视图记录而不是「原始行」：编辑器按 monitorId 保存、锁源、回读同一条记录
  editingRecord.value = monitor
  editingLockSource.value = true
  await nextTick()
  editorVisible.value = true
}

async function beforeEditorClose(done: () => void): Promise<void> {
  if (editorRef.value?.isBusy()) return
  if (editorRef.value?.isDirty()) {
    try {
      await ElMessageBox.confirm('编辑器里还有未保存的改动，确定放弃并关闭？', '放弃修改', {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  done()
}

function onEditorSaved(record: MonitorRecordView | null): void {
  // 回读不确定时保留编辑内容；确认保存成功后关闭弹窗。
  if (record) onEditorCancel()
  void refresh()
}

function onEditorCancel(): void {
  editorVisible.value = false
  editingRecord.value = null
}

function openLogs(row: MonitorSourceRow, monitor?: MonitorRecordView): void {
  // 旧日志的 jobId 存的是监控记录 id（ckSource.id），不是采集调度 jobId；
  // RunsDrawer 内部按 monitorId 查，这里不再自己拼 jobId。
  runsSourceId.value = row.sourceId
  runsMonitorId.value = monitor?.id
  runsTitle.value = monitor?.name
  runsOpen.value = true
}

async function toggleMonitor(monitor: MonitorRecordView, next: boolean): Promise<void> {
  try {
    await setMonitorsEnabled([monitor.id], next)
    ElMessage.success(next ? '已启用' : '已停用')
  } catch (err) {
    ElMessage.error(readableError(err, '启停失败，请重试'))
  } finally {
    await refresh()
  }
}

/** 检查方式决定立即运行走哪条链路：脚本检查走执行器，规则检查走旧调度器。 */
const kindIndex = computed<Record<string, MonitorKind>>(() =>
  Object.fromEntries(records.value.map((row) => [row.id, row.kind])),
)

async function runMonitor(monitor: MonitorRecordView): Promise<void> {
  try {
    const result = await runMonitorsNow([monitor.id], kindIndex.value)
    if (result.runnerSkipped) {
      // 没抢到占位锁：既没跑脚本也没写库，不能用「已提交」误导。
      ElMessage.warning('这条检查正在另一个执行实例运行，本次已跳过（没有产生新的运行记录）')
    } else if (result.runnerRunIds?.length) {
      ElMessage.success(`已提交执行 · ${result.runnerRunIds[0]}（受理不代表执行成功，结果见运行记录）`)
    } else {
      ElMessage.success('已提交执行（受理不代表执行成功）')
    }
  } catch (err) {
    ElMessage.error(readableError(err, '提交执行失败'))
  } finally {
    await refresh()
  }
}

const selectedIds = computed(() => selectedMonitors.value.map((monitor) => monitor.id))

async function batchRun(): Promise<void> {
  if (!selectedIds.value.length) return
  const ids = [...selectedIds.value]
  try {
    const result = await runMonitorsNow(ids, kindIndex.value)
    const parts: string[] = []
    if (result.viaRunner) parts.push(`${result.viaRunner} 项脚本检查走执行器`)
    if (result.viaLegacy) parts.push(`${result.viaLegacy} 项规则检查走调度器`)
    const head = parts.length ? `已提交 ${ids.length} 项：${parts.join('、')}` : `已提交 ${ids.length} 项执行`
    if (result.runnerSkipped) {
      ElMessage.warning(`${head}；另有 ${result.runnerSkipped} 项因另一实例正在运行而跳过`)
    } else {
      ElMessage.success(head)
    }
  } catch (err) {
    ElMessage.error(readableError(err, '提交执行失败'))
  } finally {
    await refresh()
  }
}

async function batchDelete(): Promise<void> {
  if (!selectedIds.value.length) return
  const ids = [...selectedIds.value]
  await confirmDanger(
    '删除所选检查',
    `将删除选中的 ${ids.length} 项检查，删除后不可恢复。`,
    async () => {
      await deleteSourceCheck(ids)
      await refresh()
      return { message: `已删除 ${ids.length} 项` }
    },
  )
}

async function batchEnable(enabled: boolean): Promise<void> {
  if (!selectedIds.value.length) return
  const ids = [...selectedIds.value]
  const run = async () => {
    await setMonitorsEnabled(ids, enabled)
    await refresh()
    return { message: enabled ? `已启用 ${ids.length} 项` : `已停用 ${ids.length} 项` }
  }
  if (enabled) {
    try {
      const res = await run()
      ElMessage.success(res.message)
    } catch (err) {
      ElMessage.error(readableError(err, '启停失败，请重试'))
    }
    return
  }
  await confirmDanger(
    '停用所选检查',
    `将停用选中的 ${ids.length} 项检查。停用后不再执行，列表也不再显示这些检查的数据结论。`,
    run,
  )
}

onMounted(() => {
  void refreshData()
})
</script>

<template>
  <div class="sc-shell" :class="{ 'sc-embedded': embedded }">
    <header class="sc-scope">
      <div class="sc-heading"><h2>数据质量监控</h2><span class="sc-scope-tag">{{ scopeText }}</span></div>
      <p class="sc-scope-hint">{{ scopeHint }}</p>
    </header>

    <div v-if="loadError" class="sc-hint sc-hint-error">
      <span>监控记录加载失败：{{ loadError }}</span>
      <button type="button" class="sc-link" @click="refresh()">重试</button>
    </div>
    <div v-if="summaryRows" data-testid="sc-summary-hint" class="sc-hint sc-hint-muted">
      <span>
        服务端按源聚合：<template v-if="summaryStats">
          共 {{ summaryStats.totalSources }} 个源 · 已配置 {{ summaryStats.configuredSources }}（启用
          {{ summaryStats.enabledSources }}）· 数据异常 {{ summaryStats.abnormalSources }} · 未配置检查
          {{ summaryStats.notConfiguredSources }}
        </template><template v-else>共 {{ summaryTotal }} 个源（全站统计暂不可用，显示「—」）</template>。
        已配置的排在最前；筛选与翻页都由服务端执行，「执行失败 / 未生效 / 待判断」当前只能在当前页内过滤。
        计划覆盖仍需服务端按时隙聚合，暂显示「—」。
      </span>
    </div>
    <div v-else-if="directorySkipped && scopeKind === 'global'" class="sc-hint sc-hint-muted">
      <span>
        按已配置监控的源展示。未配置检查的源、以及全站汇总，需服务端聚合（C07）后再出行；
        找不到源时用上面的关键词按名称 / ID / 主表筛选。
      </span>
    </div>
    <div v-else-if="directoryError" class="sc-hint">
      <span v-if="scopeKind === 'site'">
        网站源目录加载失败：{{ directoryError }}。为避免串出其他网站的数据，当前不展示列表。
      </span>
      <span v-else>
        源目录加载失败：{{ directoryError }}。当前只列出已配置监控的源，未配置检查的源暂不出现。
      </span>
      <button type="button" class="sc-link" @click="refresh()">重试</button>
    </div>

    <div class="sc-filter-row">
      <!--
        只有一个源筛选框：源目录在 24 万源的环境里拉不全，「源 ID 下拉」实际选不到东西，
        而它和下面的关键词框又都在做「找某个源」，两个框并排只会让人猜哪个生效。
        这里统一成关键词（名称 / ID / 主表，客户端过滤已加载行），源ID 精确匹配也在其中。
      -->

      <label class="sc-filter-field"><span>启停状态</span><el-select v-model="draft.enable" class="sc-filter-select" aria-label="启停状态" placeholder="启停状态">
        <el-option v-for="item in ENABLE_OPTIONS" :key="item.value" :value="item.value" :label="item.label" />
      </el-select></label>
      <label class="sc-filter-field"><span>数据情况</span><el-select v-model="draft.status" class="sc-filter-select" aria-label="数据情况" placeholder="数据情况">
        <el-option v-for="item in STATUS_OPTIONS" :key="item.value" :value="item.value" :label="item.label" />
      </el-select></label>
      <label class="sc-filter-field"><span>最近检查</span><el-select v-model="draft.checkDate" class="sc-filter-select" aria-label="最近检查日期" placeholder="最近检查">
        <el-option v-for="item in CHECK_DATE_OPTIONS" :key="item.value" :value="item.value" :label="item.label" />
      </el-select></label>
      <el-input
        v-model="draft.keyword"
        class="sc-filter-keyword"
        aria-label="按源名称、源 ID 或主表筛选已加载的源"
        clearable
        placeholder="源名称 / ID / 主表"
        @keyup.enter="applyFilters"
      />
      <el-button type="primary" @click="applyFilters">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>

      <div class="sc-headbar">
        <span class="sc-count">
          共 {{ pagerTotal }} 个源<template v-if="summaryMode"> · 本页已配置 {{ configuredCount }}</template>
          <template v-else> · 已配置 {{ configuredCount }}</template>
        </span>
        <el-button
          :icon="Refresh"
          circle
          size="small"
          title="保留当前筛选与分页大小重新查询"
          @click="refresh()"
        />
        <el-button type="primary" :icon="Plus" @click="openAddDialog">新增监控</el-button>
        <el-button @click="batchVisible = true">批量补齐入库监控</el-button>
      </div>
    </div>

    <div class="sc-stats">
      <span class="sc-stat">本页数据异常源 <b :class="{ 'is-bad': stats.abnormal > 0 }">{{ stats.abnormal }}</b></span>
      <span class="sc-stat">本页执行失败源 <b :class="{ 'is-bad': stats.execFailed > 0 }">{{ stats.execFailed }}</b></span>
      <span class="sc-stat">本页源数 <b>{{ stats.total }}</b></span>
      <span class="sc-stat-note" title="分项不互斥，同一源可同时计入数据异常与执行失败；计划覆盖和漏跑等待服务端汇总。">仅统计本页 · 计划覆盖暂未取得</span>
      <button type="button" class="sc-link sc-watch-link" @click="watchVisible = true">
        独立巡检（队列与漏跑）
      </button>
    </div>

    <el-table
      v-loading="loading"
      :data="pagedRows"
      row-key="sourceId"
      :expand-row-keys="expandedKeys"
      size="small"
      class="sc-table"
      @expand-change="onExpandChange"
    >
      <el-table-column type="expand" width="34">
        <template #default="{ row }">
          <section class="sc-inner">
            <div class="sc-inner-head">
              <span class="sc-inner-title">{{ row.sourceName || row.sourceId }}</span>
              <span class="subline">· {{ row.monitorTotal }} 项检查 · 各自独立记录身份、启停和通知</span>
              <template v-if="selectedMonitors.length">
                <span class="sc-selected">已选 {{ selectedMonitors.length }} 项</span>
                <el-button size="small" @click="batchRun">重跑所选</el-button>
                <el-button size="small" @click="batchEnable(true)">启用所选</el-button>
                <el-button size="small" @click="batchEnable(false)">停用所选</el-button>
                <el-button size="small" type="danger" plain @click="batchDelete">删除所选</el-button>
              </template>
              <span class="sc-inner-spacer"></span>
              <button type="button" class="sc-link" @click="openLogs(row)">查看运行记录</button>
              <button type="button" class="sc-link" @click="openAddFor(row.sourceId)">加监控</button>
            </div>

            <el-table
              :data="row.monitors"
              row-key="id"
              size="small"
              class="sc-inner-table"
              @selection-change="onInnerSelectionChange"
            >
              <el-table-column type="selection" width="34" />
              <el-table-column label="检查项" min-width="150">
                <template #default="{ row: monitor }">
                  <span class="sc-name" :title="monitor.name" @click="openEdit(row, monitor)">
                    {{ monitor.name || '未命名' }}
                  </span>
                  <div class="subline">#{{ monitor.id }}</div>
                </template>
              </el-table-column>
              <el-table-column label="方式" min-width="86">
                <template #default="{ row: monitor }">
                  <span class="rc-status" :class="monitor.kind === 'ai' ? 'run' : 'muted'">
                    {{ monitorKindText(monitor.kind) }}
                  </span>
                  <div class="subline">{{ monitorPublishText(monitor.publishStatus, monitor.effectiveVersion) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="检查摘要" min-width="160">
                <template #default="{ row: monitor }">
                  <span class="sc-ellipsis" :title="monitorSummaryOf(monitor)">{{ monitorSummaryOf(monitor) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="执行计划" min-width="130">
                <template #default="{ row: monitor }">
                  <span class="sc-ellipsis" :title="monitorPlanOf(monitor).plan">{{ monitorPlanOf(monitor).plan }}</span>
                  <div class="subline">下次 {{ monitorPlanOf(monitor).next }}</div>
                </template>
              </el-table-column>
              <el-table-column label="启用" width="80">
                <template #default="{ row: monitor }">
                  <el-switch
                    :model-value="monitor.enabled"
                    :aria-label="`${monitor.name}：${monitor.enabled ? '已启用' : '已停用'}`"
                    size="small"
                    @change="toggleMonitor(monitor, Boolean($event))"
                  />
                  <span class="subline">{{ monitor.enabled ? '启用' : '停用' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="最近数据结论" min-width="112">
                <template #default="{ row: monitor }">
                  <span class="rc-status" :class="monitorDataOf(monitor).tone" :title="monitorDataOf(monitor).title">
                    {{ monitorDataOf(monitor).text }}
                  </span>
                  <div class="subline">{{ monitorExecOf(monitor).text }}</div>
                </template>
              </el-table-column>
              <el-table-column label="操作" min-width="132">
                <template #default="{ row: monitor }">
                  <div class="sc-ops">
                    <button type="button" class="sc-link" @click="openEdit(row, monitor)">编辑</button>
                    <button type="button" class="sc-link" @click="runMonitor(monitor)">立即运行</button>
                    <button type="button" class="sc-link" @click="openLogs(row, monitor)">记录</button>
                  </div>
                </template>
              </el-table-column>
              <template #empty>
                <div class="sc-inner-empty">
                  该源尚未配置监控。可直接「加监控」，不需要先在画布上添加监控节点。
                </div>
              </template>
            </el-table>

            <div class="sc-inner-note">
              一个源可配置多项检查；源行上的「数据情况」只是该源最差事实的汇总，不把一项通过当整源正常，也不把各项数据量相加。
            </div>
          </section>
        </template>
      </el-table-column>

      <el-table-column label="源与网站" min-width="158">
        <template #default="{ row }">
          <span class="sc-name" :title="sourceHintOf(row)" @click="toggleExpand(row)">
            {{ sourceTitleOf(row) }}
          </span>
          <div class="subline" :title="sourceHintOf(row)">
            {{ sourceSubtitleOf(row) }}
          </div>
        </template>
      </el-table-column>

      <el-table-column label="检查覆盖" min-width="118">
        <template #default="{ row }">
          <div class="sc-ellipsis">{{ checkCoverageOf(row).main }}</div>
          <div class="subline">{{ checkCoverageOf(row).sub }}</div>
        </template>
      </el-table-column>

      <el-table-column label="计划覆盖" min-width="128">
        <template #default="{ row }">
          <div class="sc-ellipsis" :title="coverageOf(row).title">{{ coverageOf(row).main }}</div>
          <div class="subline">{{ coverageOf(row).sub }}</div>
        </template>
      </el-table-column>

      <el-table-column label="数据情况" min-width="122">
        <template #default="{ row }">
          <span class="rc-status" :class="dataPillOf(row).tone">{{ dataPillOf(row).text }}</span>
          <div class="subline" :title="dataHintOf(row)">{{ dataHintOf(row) }}</div>
        </template>
      </el-table-column>

      <el-table-column label="执行与通知" min-width="124">
        <template #default="{ row }">
          <div :title="execNotifyOf(row).execTitle" :class="`sc-exec is-${execNotifyOf(row).execTone}`">
            {{ execNotifyOf(row).exec }}
          </div>
          <div :title="execNotifyOf(row).notifyTitle" :class="`subline is-${execNotifyOf(row).notifyTone}`">
            {{ execNotifyOf(row).notify }}
          </div>
        </template>
      </el-table-column>

      <el-table-column label="最近检查" min-width="120">
        <template #default="{ row }">
          <div class="sc-ellipsis" :title="lastCheckOf(row).title">{{ lastCheckOf(row).main }}</div>
          <div class="subline">{{ lastCheckOf(row).sub }}</div>
        </template>
      </el-table-column>

      <el-table-column label="操作" min-width="142">
        <template #default="{ row }">
          <div class="sc-ops">
            <button type="button" class="sc-link" @click="toggleExpand(row)">
              {{ expandedKeys.includes(row.sourceId) ? '收起检查' : '展开检查' }}
            </button>
            <button type="button" class="sc-link" @click="openAddFor(row.sourceId)">加监控</button>
            <button type="button" class="sc-link" @click="openLogs(row)">结果</button>
          </div>
        </template>
      </el-table-column>

      <template #empty>
        <div class="sc-empty">
          <template v-if="scopeKind === 'site' && directoryError">
            网站源目录加载失败，暂不展示列表；请重试，或回到全局视图按源缩小范围。
          </template>
          <template v-else-if="!records.length">
            暂无监控记录。可直接点击「新增监控」开始配置。
          </template>
          <template v-else>
            没有符合筛选条件的源。
            <button type="button" class="sc-link" @click="resetFilters">重置筛选</button>
          </template>
        </div>
      </template>
    </el-table>

    <div v-if="pagerTotal" class="sc-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :page-sizes="PAGE_SIZES"
        :total="pagerTotal"
        size="small"
        background
        layout="total, sizes, prev, pager, next"
        @size-change="onSizeChange"
        @current-change="onPageChange"
      />
    </div>

    <el-dialog
      class="monitor-editor-dialog"
      v-model="editorVisible"
      title="监控配置"
      :width="'min(1080px, calc(100vw - 32px))'"
      append-to-body
      destroy-on-close
      :before-close="beforeEditorClose"
      data-testid="source-check-editor-dialog"
    >
      <MonitorConfigEditor
        ref="editorRef"
        :source-id="editingSourceId"
        :record="editingRecord"
        :source-locked="editingLockSource"
        @saved="onEditorSaved"
        @cancel="onEditorCancel"
      />
    </el-dialog>
    <MonitorBatchDialog v-model="batchVisible" :site-id="siteId || undefined" @changed="refresh" />
    <MonitorWatchDrawer :open="watchVisible" @close="watchVisible = false" />
    <RunsDrawer
      :open="runsOpen"
      :source-id="runsSourceId"
      :monitor-id="runsMonitorId"
      :title="runsTitle"
      @close="runsOpen = false"
    />

  </div>
</template>

<style scoped>
.sc-shell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: fit-content;
  padding: 0;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}
/* 嵌入弹窗时外层已有卡片，去掉重复壳 */
.sc-embedded {
  padding: 4px;
  border: 0;
  border-radius: 0;
}
.sc-scope { padding: 14px 14px 10px; border-bottom: 1px solid var(--rc-border-soft); }
.sc-heading { display: flex; align-items: center; gap: 8px; }
.sc-heading h2 { margin: 0; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.sc-scope-tag { padding: 2px 6px; background: var(--rc-bg); border-radius: 4px; font-size: 11px; font-weight: 600; color: var(--rc-muted); }
.sc-scope-hint { margin: 5px 0 0; font-size: 11px; color: var(--rc-muted); }
.sc-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 0 12px;
  padding: 6px 10px;
  border: 1px solid var(--rc-border-soft, #e2e8f0);
  border-left: 3px solid var(--rc-warn, #c2410c);
  border-radius: var(--rc-radius-sm, 6px);
  background: #fffdf8;
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.sc-hint-error {
  border-left-color: var(--rc-error, #dc2626);
  background: var(--rc-error-bg, #fef2f2);
}
/* 说明性提示（不是错误）：全局视图按已配置源展示 */
.sc-hint-muted {
  border-left-color: var(--rc-border, #e2e8f0);
  background: var(--rc-bg, #f8fafc);
  color: var(--rc-muted, #64748b);
}
.sc-filter-row {
  padding: 2px 12px 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.sc-filter-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--rc-muted); }
.sc-filter-row :deep(.el-button + .el-button) { margin-left: 0; }
.sc-filter-source {
  width: 190px;
}
.sc-filter-source :deep(.el-select) { width: 158px !important; }
.sc-filter-select {
  width: 96px;
}
.sc-filter-keyword {
  width: 154px;
}
.sc-headbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.sc-count {
  font-size: 12px;
  color: var(--rc-muted, #64748b);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.sc-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 0 12px;
  padding: 7px 0;
  border-top: 1px solid var(--rc-border-soft);
  font-size: 11px;
  color: var(--rc-text-2, #475569);
}
.sc-stat b {
  font-variant-numeric: tabular-nums;
}
.sc-stat b.is-bad {
  color: var(--rc-error, #dc2626);
}
.sc-watch-link {
  margin-left: auto;
  font-size: 12px;
}
.sc-stat-note {
  margin-left: auto;
  color: var(--rc-faint, #94a3b8);
  font-size: 11px;
  line-height: 1.5;
}
.sc-table {
  width: 100%;
  font-size: 12px;
}
.sc-table :deep(.el-table__header th) {
  color: var(--rc-text-2, #475569);
  font-weight: 700;
  background: #f8fafc;
}
.sc-table :deep(.el-table__expanded-cell) {
  padding: 0;
  background: #fbfdff;
}
.sc-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--rc-primary);
  cursor: pointer;
}
.sc-name:hover {
  color: var(--rc-primary, #2563eb);
}
.sc-ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subline {
  font-size: 11px;
  line-height: 1.5;
  color: var(--rc-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subline.is-err {
  color: var(--rc-error, #dc2626);
}
.sc-exec {
  font-size: 12px;
  font-weight: 600;
}
.sc-exec.is-err {
  color: var(--rc-error, #dc2626);
}
.sc-exec.is-run {
  color: var(--rc-primary, #2563eb);
}
.sc-exec.is-muted {
  color: var(--rc-muted, #64748b);
}
/* rc-status 由全局 tokens.css 提供，这里只补偿尺寸（表格内一行放得下） */
.sc-table .rc-status {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sc-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.sc-link:hover {
  text-decoration: underline;
}
.sc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px 12px;
}
.sc-empty {
  padding: 22px 12px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.sc-inner {
  margin: 0 10px 10px;
  background: #fff;
  border: 1px solid #dbe6f6;
  border-radius: var(--rc-radius-sm, 6px);
  overflow: hidden;
}
.sc-inner-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border-soft, #e2e8f0);
  background: #fbfdff;
}
.sc-inner-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--rc-text, #1e293b);
}
.sc-selected {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
  font-size: 11px;
  font-weight: 700;
}
.sc-inner-spacer {
  flex: 1 1 auto;
}
.sc-inner-table {
  width: 100%;
  font-size: 12px;
}
.sc-inner-table :deep(.el-table__header th) {
  color: var(--rc-text-2, #475569);
  font-weight: 700;
  background: #f8fafc;
}
.sc-inner-empty {
  padding: 18px 10px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.sc-inner-note {
  padding: 7px 10px;
  border-top: 1px solid var(--rc-border-soft, #e2e8f0);
  background: #fbfcfe;
  color: var(--rc-muted, #64748b);
  font-size: 11px;
  line-height: 1.5;
}
.sc-add-tip {
  margin-bottom: 10px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.sc-table :deep(.el-table__cell) { padding: 12px 0; border-color: #eaf0f8; }
.sc-table :deep(.el-table__header th) { padding: 9px 0; font-weight: 600; }
.sc-table :deep(.cell) { padding-inline: 10px; line-height: 1.6; }
.sc-ops { gap: 10px; flex-wrap: nowrap; white-space: nowrap; }
.sc-filter-row > .el-button { margin-left: 0; }
@media (max-width: 1100px) {
  .sc-headbar { width: 100%; justify-content: flex-end; }
  .sc-count { margin-right: auto; }
}
</style>
