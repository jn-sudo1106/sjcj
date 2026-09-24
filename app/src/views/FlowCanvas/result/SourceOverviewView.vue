<script setup lang="ts">
// 网站详情（左侧“全部”）下的源总览：只查当前网站，不提供跨网站/指定网站范围切换
// （0812 会议纠偏：进入网站后源/数据/文件/监控范围必须固定为当前 siteId，不能从网站详情跨站查询）。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import { useLaunchJobStore } from '@/stores/launchJob'
import { useUiStore } from '@/stores/ui'
import {
  issueTagForWrite,
  mergeIssueTags,
  normalizeIssueTag,
  readRecentIssueTags,
  rememberIssueTags,
  visibleIssueTags,
} from '@/utils/sourceMark'
import SourceMarkPopover from './SourceMarkPopover.vue'
import EditSourceMarkDialog from './EditSourceMarkDialog.vue'
import LaunchConfirmDialog from './LaunchConfirmDialog.vue'
import SourceParamModal from '@/views/FlowCanvas/source/SourceParamModal.vue'
import { hasLoadParams, normalizeLoadParams } from '@/views/FlowCanvas/source/paramNormalize'
import { downloadXlsx } from '@/utils/format/xlsxExport'
import { timeAgo } from '@/utils/format/relativeTime'
import {
  CollectLimitError,
  SOURCE_EXPORT_HEADER,
  collectAllUnderQuery,
  describeFilters,
  partitionLaunchTargets,
  resolveScope,
  sendInBatches,
  sourceToExportRow,
  type LaunchScope,
  type SourceFilter,
} from './useSourceLaunch'

// `initialSourceIds`：从数据视图「按条件查源」跳过来时带的那批源 ID（0903 Y2-4）。
// 直接预填「源 ID」筛选框——那个框本来就收逗号分隔的多个 ID，不为反查另造一套筛选。
//
// 走 prop 而不是在这里 useRoute()：本组件此前完全不依赖 router，测试都是裸 shallowMount；
// 为了一个初始值把整棵测试树都绑上 router 不划算，路由解析留在已经持有 route 的上层。
/** `initialFlowId`：从流程中心「查看全部关联源」跳过来时带的流程 ID（0904 I16 / Z7-2）。
 *  **不用 sourceIds 传**：一个流程最多见过 5439 个源（流程 1400976），拼进 URL 不现实；
 *  `sourcePaged` 本来就认 flowId 这个服务端条件（2026-09-02 实测：flowId=1400330 得 46 条、
 *  与该流程 sourceCnt 一致，传不存在的得 0 条，不是静默忽略）。 */
const props = defineProps<{ currentSiteId: string; initialSourceIds?: string; initialFlowId?: string }>()
const emit = defineEmits<{
  openSource: [source: Source]
  /** 点「数据量」这个数字（0903 Y1-15）：进这个源的数据视图，而不是流程视图 */
  openSourceData: [source: Source]
}>()

// UI 状态筛选：停用是启停字段（enable=1），不是旧接口没有的 state=disabled，
// 正常/运行中/异常需要额外带 enable=0 排除已停用记录（方案 §5.4 状态请求映射表）。
type StatusFilter = 'all' | 'C' | 'L' | 'E' | 'disabled'

const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const loadError = ref('')
/**
 * 源 ID / 源名称 / 源 URL 三格合并成「字段 ▾ ＋ 一个输入框」（0917-11，2026-09-21 用户定范围）。
 * 会上原话：「全部源的这个查询 2、3、4……我准备说放在一起的」。
 *
 * **这推翻了 2026-09-17 那次"源 URL 不跟源名称并成一格"的定法**，代价是明摆着的：
 * 三者原先能组合（实测 `name=盛科` 4 条、`sourceUrl=centec` 1 条、同时给 1 条，取交集），
 * 合并之后一次只能按一个字段查。用户接受这个代价，换筛选栏少两格。
 *
 * 做成**显式选字段**而不是"一个框自动猜类型"：猜错就是静默漏结果——
 * 实测 `name=centec` 命中 0 条、`sourceUrl=centec` 命中 1 条，两者互不覆盖，
 * 而用户根本不会知道自己被猜到了另一个参数上。
 *
 * **状态不并进来**（用户同意）：它是枚举，跟这三个文本条件不同类，并进来控件要变形，
 * 而且「状态=异常 ＋ 名称含 X」是常见组合，并了就做不了。
 */
type SearchField = 'sourceIds' | 'name' | 'sourceUrl'
const SEARCH_FIELDS: { value: SearchField; label: string; placeholder: string }[] = [
  { value: 'sourceIds', label: '源 ID', placeholder: '多个 ID 用逗号分隔' },
  { value: 'name', label: '源名称', placeholder: '源名称关键字' },
  { value: 'sourceUrl', label: '源 URL', placeholder: 'URL 关键字，如 centec' },
]
const searchField = ref<SearchField>('sourceIds')
const searchText = ref(props.initialSourceIds ?? '')
const searchPlaceholder = computed(() => SEARCH_FIELDS.find((f) => f.value === searchField.value)?.placeholder ?? '')
/** 当前这一格落到哪个后端参数上；没选中的两个恒为 undefined */
const searchValueOf = (field: SearchField) => (searchField.value === field ? (searchText.value.trim() || undefined) : undefined)
const flowFilterId = ref(props.initialFlowId ?? '')
watch(() => props.initialFlowId, (id) => { flowFilterId.value = id ?? '' })
// prop 变化也要生效：反查跳过来时本组件常常已经挂载着（同一个 SiteDetailView 里切视图），
// 只把它当初始值用等于永远不生效。清空不跟随——那是用户自己在筛选框里的操作，别覆盖他。
watch(() => props.initialSourceIds, (ids) => {
  if (!ids || (searchField.value === 'sourceIds' && ids === searchText.value)) return
  // 反查跳过来带的是一串源 ID，字段也要跟着切过去，否则这串 ID 会被当成名称关键字发出去
  searchField.value = 'sourceIds'
  searchText.value = ids
  page.value = 1
  void loadSources()
})
const statusFilter = ref<StatusFilter>('all')
const tagFilter = ref('')
// 备注：生产源列表页筛选区就有，后端认 remark（旧列表列同名）。本地那份旧代码快照比线上旧，
// queryParam 里还没有，不能拿它当"后端不支持"的依据。旁边的「责任人」0831 明确暂不做。
const remarkFilter = ref('')
/**
 * 备注三态（0920-07）。会上原话：「我想搜这个备注为空的、不为空的」。
 *
 * **后端本来就支持，是我们没发现**（2026-09-21 实测，站 12 共 5891 个源）：
 * `remark=%` 得 8 条、全部有备注；`remark=NULL` 得 5883 条、抽样全是 null；8 + 5883 = 5891。
 * 换站 81 复核也吻合。原先以为要提后端需求（B28），复测后撤回了。
 *
 * 2026-09-24 产品调整：去掉「不限」选项，只留「有备注 / 无备注」，且**有备注时也要能按关键字搜**。
 * - 未选（占位「备注」）：不按备注状态筛，关键字照常可用；
 * - 有备注：不填关键字 = `remark=%`（所有有备注的）；填了关键字 = 按关键字搜（命中关键字本身就意味着非空）；
 * - 无备注：`remark=NULL`，关键字框禁用——"没有备注又含 X"不成立。
 * 默认必须是"未选"而不是「有备注」：否则源列表一进来只剩有备注的那几个（站 12 是 8/5891）。
 */
const remarkMode = ref<'' | 'has' | 'none'>('')
function remarkParam(): string | undefined {
  const keyword = remarkFilter.value.trim()
  if (remarkMode.value === 'none') return 'NULL'
  if (keyword) return keyword
  return remarkMode.value === 'has' ? '%' : undefined
}
function clearRemarkMode() {
  remarkMode.value = ''
  search()
}
/**
 * 数据量上限（0920-01）。会上原话：「这个页面支持 sql 查询，比如数据<5」。
 *
 * **不做成 SQL 输入框**：实测 `sourcePaged` 的 `sql` 参数被完全忽略（传 `DATA_CNT < 5`、
 * 传乱码、不传，返回的 count 全是 5429），做成 SQL 框的话除 `dataCnt` 之外的任何条件
 * 都会静默不生效——就是任务视图那个队列筛选框的翻版（B24）。
 *
 * 后端认的是固定参数 `count`，语义是 **`dataCnt <= N`（含等于）**，所以 UI 写「≤」不写「<」。
 * 存字符串而不是数字：要分得清"没填"和"填了 0"——`count=0` 是有意义的条件。
 */
// ⚠️ 类型写成 string | number 不是啰嗦：`<input type="number">` 上的 v-model，
// Vue 会**自动把值转成数字**（vModelText 的 castToNumber），清空时又回到空串。
// 当成纯字符串写 `.trim()` 会在填了数字时抛 TypeError，而且是静默的——筛选直接失效。
const dataCountMax = ref<string | number>('')
const sortField = ref('')
const sortDirection = ref<'asc' | 'desc'>('asc')
let sourceRequestSeq = 0


/** 空 / 非法 / 负数都当没填；`0` 要保留（"一条数据都没有的源"是个真条件） */
const parsedDataCountMax = computed<number | undefined>(() => {
  const raw = String(dataCountMax.value ?? '').trim()
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
})

function currentQuery(): SourceFilter {
  return {
    siteIds: props.currentSiteId || undefined,
    sourceIds: searchValueOf('sourceIds'),
    flowId: flowFilterId.value || undefined,
    name: searchValueOf('name'),
    sourceUrl: searchValueOf('sourceUrl'),
    state: statusFilter.value === 'all' || statusFilter.value === 'disabled' ? undefined : statusFilter.value,
    enable: statusFilter.value === 'disabled' ? '1' : statusFilter.value === 'all' ? undefined : '0',
    tags: tagFilter.value ? [issueTagForWrite(tagFilter.value)].filter(Boolean) : [],
    remark: remarkParam(),
    count: parsedDataCountMax.value,
    field: sortField.value || undefined,
    sorted: sortField.value ? (sortDirection.value === 'asc' ? 1 : -1) : undefined,
    type: sortField.value ? (sortDirection.value === 'asc' ? 'ASC' : 'DESC') : undefined,
  }
}

async function fetchSourcePage(query: SourceFilter & { page: number; size: number }) {
  return sourceApi.sourcePaged(query)
}

async function loadSources() {
  const requestId = ++sourceRequestSeq
  loading.value = true
  loadError.value = ''
  try {
    const result = await fetchSourcePage({ ...currentQuery(), page: page.value, size: size.value })
    if (requestId !== sourceRequestSeq) return
    // 不再对服务端结果做二次过滤（0831 X0）。2026-08-31 会上实测：搜「内容重复」时
    // 开发人员当场说"他查到了，但是没返回"——就是这里，服务端明明返回了 N 行，
    // 客户端 matchesMarkFilters 又按精确相等滤了一遍，把 N 行滤成 0 行。
    // 两边口径本来就不可能对齐：服务端按什么语义匹配 tags（精确/前缀/模糊、要不要带 #）
    // 我们并不知道，任何本地复刻都是在猜；而且 total 一旦按过滤后的行数改写，
    // 分页页数也跟着错。服务端返回什么就展示什么，这是唯一自洽的口径。
    rows.value = applyMarkOverlay(result.list)
    total.value = result.total
  } catch (error) {
    if (requestId !== sourceRequestSeq) return
    rows.value = []
    total.value = 0
    loadError.value = `加载源列表失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (requestId === sourceRequestSeq) loading.value = false
  }
}
function search() {
  page.value = 1
  void loadSources()
}
function clearFilters() {
  searchField.value = 'sourceIds'
  searchText.value = ''
  flowFilterId.value = ''
  statusFilter.value = 'all'
  tagFilter.value = ''
  remarkFilter.value = ''
  remarkMode.value = ''
  dataCountMax.value = ''
  search()
}
function toggleSort(field: string) {
  if (sortField.value === field) {
    if (sortDirection.value === 'asc') sortDirection.value = 'desc'
    else sortField.value = ''
  } else {
    sortField.value = field
    sortDirection.value = 'asc'
  }
  search()
}
function sortLabel(field: string) {
  if (sortField.value !== field) return '未排序'
  return sortDirection.value === 'asc' ? '升序' : '降序'
}
/** 改每页条数后回到第 1 页：旧页码在新的页大小下多半越界 */
function onPageSizeChange() {
  page.value = 1
  void loadSources()
}
function sourceState(source: Source) {
  if (source.disabled) return '已停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}

// ---- 勾选 + 批量（0828 W5-4）----
// 落在**源视图这张表**上，不是左侧边栏：这里才是"面向一批源做事"的地方
//（左侧边栏是切换当前源用的，勾选批量放那儿是我一开始理解错了）。
// 复用已有接口，不新起批量端点：发抓取用 sendSnatchWithParam（与单源同一个，ids 传多个），
// 启停用 changeSourceEnable 逐个调（后端没有批量启停端点，旧平台源列表页也是自己循环调的）。
const selectedIds = ref<string[]>([])
const selectedSet = computed(() => new Set(selectedIds.value))
const selectMode = computed(() => selectedIds.value.length > 0)
const selectedSources = computed(() => rows.value.filter((r) => selectedSet.value.has(r.sourceId)))
const allChecked = computed(() => rows.value.length > 0 && rows.value.every((r) => selectedSet.value.has(r.sourceId)))
const someChecked = computed(() => selectMode.value && !allChecked.value)

function toggleRow(sourceId: string) {
  selectedIds.value = selectedSet.value.has(sourceId)
    ? selectedIds.value.filter((id) => id !== sourceId)
    : [...selectedIds.value, sourceId]
}
function toggleAll() {
  selectedIds.value = allChecked.value ? [] : rows.value.map((r) => r.sourceId)
}
function clearSelection() {
  selectedIds.value = []
}

// ---- 发任务（0831 X2）----
// 按钮常驻：没勾选 = 按当前筛选条件全量发（前端分页收 ID，G1 未给端点时的兜底）；
// 勾了 = 只发勾上的。`all` 恒为 0，那是「所有参数」不是「所有源」。
const launchOpen = ref(false)
const launchSending = ref(false)
/**
 * 勾了这个数以内、且没有参数要填，就直接发，不弹确认（2026-09-17 对齐旧平台）。
 *
 * 旧 `SourceList.sendBatch` 的三档口径（读代码 + 生产实测两次都验过）：
 *   有参数            → 弹参数框
 *   无参数 + ≤2 个     → **直接发**，只有成功提示
 *   无参数 + >2 个     → 一句话确认「是否确定要发送抓取任务，本次[ N ]条?」
 *
 * 我们原来不分情况一律先弹 LaunchConfirmDialog，勾一个源也要点两次才发得出去。
 * 顺序也反了：旧平台先探参数再决定弹不弹，我们是先弹、确认后才探参数。
 */
const DIRECT_SEND_MAX = 2
const launchScope = ref<LaunchScope | null>(null)
const launchPreview = ref({ sendCount: 0, disabledCount: 0, paramCount: 0, paramNames: [] as string[] })
const collectProgress = ref('')
const job = useLaunchJobStore()
const ui = useUiStore()
const failedBatches = ref<{ ids: string[]; error: string }[]>([])
/** query 模式在打开确认弹窗前就把可发送的 id 收齐，弹窗数字才能跟实际发送对得上 */
let collectedSendableIds: string[] = []
let collectAbort: AbortController | null = null
const paramModalRef = ref<InstanceType<typeof SourceParamModal>>()

async function sendWithParamsCallback(
  ids: string[],
  param: Record<string, string>,
  _all: number,
  include: string[],
  skip: number,
  queue: string,
) {
  // 即便弹窗把 all 勾上了，这里也压成 0：那是参数全排列，跟「发全部源」无关，不能从这条入口漏出去。
  return sourceApi.sendSnatchWithParam({ ids, param, all: 0, include, skip, queue })
}

async function openLaunch() {
  failedBatches.value = []
  collectedSendableIds = []
  const scope = resolveScope(selectedIds.value, total.value, currentQuery())
  launchScope.value = scope
  if (scope.mode === 'selected') {
    const { sendable, disabled, param } = partitionLaunchTargets(selectedSources.value)
    launchPreview.value = {
      sendCount: sendable.length + param.length,
      disabledCount: disabled.length,
      paramCount: param.length,
      paramNames: param.map((s) => s.name),
    }
    if (!sendable.length && !param.length) {
      ElMessage.warning('选中的源都已停用，无法发任务')
      return
    }
    // 先探参数，再决定弹不弹——顺序与旧平台一致（见 DIRECT_SEND_MAX 的说明）
    const ids = [...sendable, ...param].map((s) => s.sourceId)
    let needParams = false
    try {
      const raw = await sourceApi.loadParams(ids)
      needParams = hasLoadParams(normalizeLoadParams(raw))
      if (needParams) {
        paramModalRef.value?.showParam(raw, [...sendable, ...param].map((s) => ({ sourceId: s.sourceId, name: s.name })), false)
        clearSelection()
        return
      }
    } catch (error) {
      ElMessage.error(`读取参数失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    // 无参数且只勾了少量：直接发。skip 用默认 0，跟旧平台 sendBatch 不传 skip 等价。
    if (ids.length <= DIRECT_SEND_MAX) {
      await dispatchIds(ids, 0)
      return
    }
    launchOpen.value = true
    return
  }
  if (!scope.hitCount) {
    ElMessage.warning('当前筛选没有命中任何源')
    return
  }
  collectAbort = new AbortController()
  collectProgress.value = '正在收集源…'
  try {
    const sources = await collectAllUnderQuery(scope.query, {
      fetchPage: fetchSourcePage,
      signal: collectAbort.signal,
      onProgress: (got, all) => { collectProgress.value = `已获取 ${got.toLocaleString()} / ${all.toLocaleString()}` },
    })
    const { sendable, disabled, param } = partitionLaunchTargets(sources)
    collectedSendableIds = sendable.map((s) => s.sourceId)
    launchPreview.value = {
      sendCount: sendable.length,
      disabledCount: disabled.length,
      paramCount: param.length,
      paramNames: param.map((s) => s.name).slice(0, 8),
    }
    if (!sendable.length) {
      ElMessage.warning(param.length ? '命中的都是参数源，请勾选后单独发送' : '没有可发送的源')
      return
    }
    launchOpen.value = true
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return
    if (error instanceof CollectLimitError) {
      ElMessage.warning(error.message)
      return
    }
    ElMessage.error(`收集源失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    collectProgress.value = ''
  }
}

/**
 * 确认发送。`skip`（登陆策略）恒传 0——它属于参数弹窗，批量发抓取这条路旧平台也不传，
 * 后端默认即 0，理由见 LaunchConfirmDialog 顶部说明。
 */
async function confirmLaunch() {
  const scope = launchScope.value
  if (!scope || launchSending.value) return
  launchSending.value = true
  collectProgress.value = ''
  try {
    if (scope.mode === 'selected') await launchSelected(0)
    else await dispatchIds(collectedSendableIds, 0)
  } finally {
    launchSending.value = false
    collectProgress.value = ''
  }
}

/**
 * 确认弹窗点「确认发送」后的实际提交。
 *
 * 这里**不再探参数**：openLaunch 已经先探过一轮，有参数的直接走了参数框、根本不会开这个弹窗，
 * 能走到这儿的一定是无参数且勾了 >DIRECT_SEND_MAX 个。再探一次纯属多发一次请求。
 */
async function launchSelected(skip: number) {
  const { sendable, param } = partitionLaunchTargets(selectedSources.value)
  const ids = [...sendable, ...param].map((s) => s.sourceId)
  if (!ids.length) return
  await dispatchIds(ids, skip)
}

async function dispatchIds(ids: string[], skip: number) {
  // 接入作业条（Y4-5）：整个提交过程可暂停 / 结束。同时只允许一个作业在跑——
  // 并发批量提交既看不清进度，也容易把后端打满。
  if (!job.start(`对 ${ids.length} 个源发任务`, ids.length, () => void retryFailedBatches())) {
    ElMessage.warning('已有批量任务在进行中，请先在右下角的作业条上结束它')
    return
  }
  collectProgress.value = `发送中 0 / ${ids.length}`
  const result = await sendInBatches(ids, (batch) =>
    sourceApi.sendSnatchWithParam({ ids: batch, param: {}, all: 0, include: [], skip }),
    {
      signal: job.signal,
      onBatch: (done, all) => {
        collectProgress.value = `发送中 ${done} / ${all}`
        job.progress(done, all)
      },
    },
  )
  job.finish(result)
  failedBatches.value = result.failed
  launchOpen.value = false
  if (result.skipped.length) {
    // 中止：说清哪些发出去了、哪些没发。**不写「已终止」**——发出去的收不回来
    ElMessage.warning(`已停止提交后续批次：已发 ${result.sent} 个，${result.skipped.length} 个未提交。已提交的不会撤销。`)
    return
  }
  if (result.failed.length) {
    const failedCount = result.failed.reduce((n, item) => n + item.ids.length, 0)
    ElMessage.warning(`已发 ${result.sent} 个，失败 ${failedCount} 个。任务已下发的无法撤回，可重试失败批次。`)
  } else {
    ElMessage.success(`已对 ${result.sent} 个源发任务`)
    clearSelection()
  }
}

async function retryFailedBatches() {
  const pending = failedBatches.value
  if (!pending.length || launchSending.value) return
  launchSending.value = true
  try {
    const nextFailed: typeof pending = []
    let sent = 0
    for (const batch of pending) {
      try {
        await sourceApi.sendSnatchWithParam({ ids: batch.ids, param: {}, all: 0, include: [], skip: 0 })
        sent += batch.ids.length
      } catch (error) {
        nextFailed.push({ ids: batch.ids, error: error instanceof Error ? error.message : String(error) })
      }
    }
    failedBatches.value = nextFailed
    if (nextFailed.length) ElMessage.warning(`重试后又发出 ${sent} 个，仍失败 ${nextFailed.reduce((n, i) => n + i.ids.length, 0)} 个`)
    else ElMessage.success(`失败批次已全部重试成功，共 ${sent} 个`)
  } finally {
    launchSending.value = false
  }
}

function closeLaunch() {
  collectAbort?.abort()
  launchOpen.value = false
  launchSending.value = false
}

async function exportSources() {
  // 0831 F08：按当前查询条件全量导出，不是当前页，也不是勾选项。
  // 发任务在勾选时走 selected；导出始终走 currentQuery()，跟「查询」同一套字段。
  const query = currentQuery()
  collectAbort = new AbortController()
  collectProgress.value = '正在按查询条件收集…'
  try {
    const sources = await collectAllUnderQuery(query, {
      fetchPage: fetchSourcePage,
      signal: collectAbort.signal,
      onProgress: (got, all) => { collectProgress.value = `已获取 ${got.toLocaleString()} / ${all.toLocaleString()}` },
    })
    if (!sources.length) {
      ElMessage.warning('当前查询条件没有命中任何源')
      return
    }
    const rows = [[...SOURCE_EXPORT_HEADER], ...sources.map(sourceToExportRow)]
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    downloadXlsx(`源列表_${props.currentSiteId || 'site'}_${date}.xlsx`, rows, '源列表')
    ElMessage.success(`已按当前查询条件导出 ${sources.length} 个源`)
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return
    if (error instanceof CollectLimitError) {
      ElMessage.warning(error.message)
      return
    }
    ElMessage.error(`导出失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    collectProgress.value = ''
    collectAbort = null
  }
}

async function batchToggleEnable(disable: boolean) {
  const targets = selectedSources.value.filter((r) => !!r.disabled !== disable)
  if (!targets.length) {
    ElMessage.info(disable ? '所选源都已停用' : '所选源都已启用')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认${disable ? '停用' : '启用'}选中的 ${targets.length} 个源？`,
      disable ? '批量停用' : '批量启用',
      { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  // 一次请求发全部 id：旧 changeEnable 本来就是批量端点，之前这里逐个调是因为适配层还是 mock 占位
  try {
    const res = await sourceApi.changeSourceEnableBatch(targets.map((r) => r.sourceId), disable)
    ElMessage.success(res?.message || `已${disable ? '停用' : '启用'} ${targets.length} 个源`)
  } catch (error) {
    ElMessage.error(`批量${disable ? '停用' : '启用'}失败：${error instanceof Error ? error.message : String(error)}`)
  }
  clearSelection()
  await loadSources()
}

// ---- 问题标记（0824-03 / 源视图原型；0831 F01 去掉颜色，只剩标签）----
// 写入走旧 /v1/source/tagSource（live + 生产白名单），tags 入库后旧平台也能看到。
// 当前页仍用 overlay 立刻出效果；发抓取不清标。
const markOpen = ref(false)
const markAnchorRef = ref<HTMLElement | null>(null)
const markToast = ref('')
const lastSavedTag = ref('')

// 标签候选：服务端 source/sourceTags 拿到的是**当前查询条件下真实存在**的标签，
// 包含程序打进去的那些；本机 readRecentIssueTags() 只记得这台机器上手工打过的。
// 两者合并，服务端的排前面。拿不到就静默退回本地——候选只是输入辅助，不该因为它挂了就不能打标。
const localTags = ref(readRecentIssueTags())
const serverTags = ref<string[]>([])
const tagCandidates = computed(() => [...new Set([...serverTags.value, ...localTags.value])].slice(0, 24))

type MarkPatch = { tags?: string[]; remark?: string }
const markOverlay = new Map<string, MarkPatch>()
const MARK_OVERLAY_KEY = 'sjcj.source.markOverlay'
try {
  const stored = JSON.parse(sessionStorage.getItem(MARK_OVERLAY_KEY) || '{}') as Record<string, MarkPatch>
  Object.entries(stored).forEach(([id, patch]) => markOverlay.set(id, patch))
} catch {
  /* ignore broken session overlay */
}

function persistMarkOverlay() {
  sessionStorage.setItem(MARK_OVERLAY_KEY, JSON.stringify(Object.fromEntries(markOverlay)))
}

/**
 * 只给「查看这一批」用（打完标后不重新请求、就地把本页筛到刚标的那批）。
 * **不要拿它过滤服务端返回的列表**——那正是 X0 修掉的 bug。
 *
 * 匹配放宽成包含而不是精确相等：这里比的是本地 overlay 刚写进去的标签，
 * 而用户在筛选框里输的可能是「重复」这种半截词，精确相等会一条都留不下。
 */
function matchesMarkFilters(source: Source) {
  const wantTag = normalizeIssueTag(tagFilter.value)
  if (wantTag && !(source.tags ?? []).some((tag) => tag.includes(wantTag))) return false
  return true
}
function applyMarkOverlay(list: Source[]) {
  return list.map((source) => {
    const patch = markOverlay.get(source.sourceId)
    if (!patch) return source
    return {
      ...source,
      tags: patch.tags ?? source.tags,
      remark: patch.remark ?? source.remark,
    }
  })
}
/**
 * `tags` 三种写法各对应一种真实场景，别合并：
 *   - `string[]`  批量条追加（tagSource add，服务端也是追加，所以本地 merge）
 *   - `'clear'`   批量条清空
 *   - `{ set }`   行内编辑（updateSource 全量覆盖，本地必须同样覆盖而不是并进去，
 *                 否则用户删掉的那个标签会被 merge 又加回来）
 */
function writeOverlay(ids: string[], patch: { tags?: string[] | 'clear' | { set: string[] }; remark?: string }) {
  ids.forEach((id) => {
    const prev = markOverlay.get(id) ?? {}
    const row = rows.value.find((item) => item.sourceId === id)
    const current = prev.tags ?? row?.tags
    const tags = patch.tags === 'clear'
      ? []
      : Array.isArray(patch.tags)
        ? mergeIssueTags(current, patch.tags)
        : patch.tags
          ? [...patch.tags.set]
          : current
    markOverlay.set(id, { tags, remark: patch.remark ?? prev.remark ?? row?.remark })
  })
  rows.value.forEach((row) => {
    const next = markOverlay.get(row.sourceId)
    if (!next) return
    row.tags = next.tags
    row.remark = next.remark
  })
  persistMarkOverlay()
}
function toggleMarkPopover() {
  markOpen.value = !markOpen.value
}
function closeMarkPopover() {
  markOpen.value = false
}
function onMarkPointerDown(event: MouseEvent) {
  const root = markAnchorRef.value
  if (markOpen.value && root && !root.contains(event.target as Node)) closeMarkPopover()
}
function onMarkKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMarkPopover()
}

async function saveMarks(payload: { tags: string[] }) {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  if (!payload.tags.length) {
    ElMessage.warning('请选择或输入标签')
    return
  }
  try {
    const ack = await sourceApi.tagSource(ids, payload.tags, 'add')
    if (!ack?.ok) {
      ElMessage.error(ack?.message || '打标签失败')
      return
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // 会话失效会另弹「请重新登录」，这里不再叠一条含糊的「写入未成功」
    if (!detail.includes('登录失效')) ElMessage.error(`打标签失败：${detail}`)
    return
  }
  writeOverlay(ids, { tags: payload.tags })
  localTags.value = rememberIssueTags(payload.tags)
  lastSavedTag.value = payload.tags[0] || ''
  closeMarkPopover()
  markToast.value = `已更新 ${ids.length} 个源的标签`
}
async function clearSelectedTags() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确认清空选中的 ${ids.length} 个源的全部标签？这些源上的标签会一个不剩，无法只删其中一个。`,
      '清空标签',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await sourceApi.tagSource(ids, [], 'clear')
  } catch (error) {
    ElMessage.error(`清除标签失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  writeOverlay(ids, { tags: 'clear' })
  closeMarkPopover()
  markToast.value = `已清除 ${ids.length} 个源的标签`
  lastSavedTag.value = ''
}
// 批量设置备注（0901，老平台也没有——这是新功能，不是迁移）：整批覆盖成同一段文字，
// 跟标签"追加"不是一回事，所以独立于 saveMarks 单独提交，避免一次点击混着改两种语义不同的字段。
// updateSource 是行级全量覆盖接口，没有批量端点（跟 changeSourceEnable 同款限制），只能逐个调；
// 逐个调时把每行自己当前的标签原样带上，不然会被这次的 remark 提交顺带清空。
//
// 这里能按 `rows` 找到行，靠的是文件末尾那个 `watch(rows)` —— 它在每次列表重新加载（翻页 /
// 重查 / 排序，`rows` 被整份替换）时清空勾选，所以勾选永远只可能来自当前页。这个前提离这里
// 400 行远，一旦谁为了做「跨页批量」把那个 watcher 去掉，这里就会静默丢数据。故：
// 查不到行时传 `undefined` = 整个不带 tags 字段，**绝不退化成空数组**——空数组会被
// issueTagsForWrite 变成空串，而空串在两种后端语义下都等于「清空标签」（见 updateSourceMark 注释，
// 以及 tagSource 的 clear 分支本身就是靠发空串实现的）。
async function batchSetRemark(remark: string) {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await Promise.all(ids.map((id) => {
      const row = rows.value.find((item) => item.sourceId === id)
      return sourceApi.updateSourceMark(id, { tags: row?.tags, remark })
    }))
  } catch (error) {
    ElMessage.error(`批量设置备注失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  writeOverlay(ids, { remark })
  closeMarkPopover()
  markToast.value = `已设置 ${ids.length} 个源的备注`
}

// 清空备注：跟「清空标签」对称的入口，同样整批覆盖成空、需要二次确认——备注一旦清空
// 拿不回来，跟清标签的破坏性一致，不能因为字段不同就少一道确认。
async function clearSelectedRemark() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  try {
    await ElMessageBox.confirm(
      `确认清空选中的 ${ids.length} 个源的备注？`,
      '清空备注',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await Promise.all(ids.map((id) => {
      const row = rows.value.find((item) => item.sourceId === id)
      // 同 batchSetRemark：查不到行就不带 tags 字段，不能传空数组。
      return sourceApi.updateSourceMark(id, { tags: row?.tags, remark: '' })
    }))
  } catch (error) {
    ElMessage.error(`清空备注失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  writeOverlay(ids, { remark: '' })
  closeMarkPopover()
  markToast.value = `已清空 ${ids.length} 个源的备注`
}

function viewMarkedBatch() {
  if (lastSavedTag.value) tagFilter.value = lastSavedTag.value
  markToast.value = ''
  selectedIds.value = []
  rows.value = applyMarkOverlay(rows.value).filter(matchesMarkFilters)
  total.value = rows.value.length
}
function tagPreview(source: Source) {
  return visibleIssueTags(source.tags)
}

// ---- 行内编辑标签与备注（0831 F02/F04）----
// 批量条只能「追加」和「清空」——想删掉三个标签里中间那个，只有这条路。
// 走 updateSource 全量覆盖，与旧平台备注弹窗（SourceList.vue:1520-1561）同一条接口、同一批字段。
const editTarget = ref<Source | null>(null)
function openMarkEditor(source: Source) {
  editTarget.value = source
}
function onMarkEdited(payload: { tags: string[]; remark: string }) {
  const id = editTarget.value?.sourceId
  editTarget.value = null
  if (!id) return
  // set 而不是 merge：这是覆盖语义，用户删掉的标签不能被 merge 加回来
  writeOverlay([id], { tags: { set: payload.tags }, remark: payload.remark })
  if (payload.tags.length) localTags.value = rememberIssueTags(payload.tags)
}

/**
 * 标签候选：入参就是当前查询条件（旧 querySourceTags 的口径，SourceSearch.vue:199-207），
 * 所以候选跟着筛选条件走——筛到某个网站，看到的就是这个网站下真实存在的标签。
 * 失败不提示：候选只是输入辅助，为它弹一个红条会盖住用户正在做的事。
 */
async function loadTagCandidates() {
  try {
    serverTags.value = await sourceApi.sourceTags({
      siteIds: props.currentSiteId || undefined,
      sourceIds: searchValueOf('sourceIds'),
      name: searchValueOf('name'),
    })
  } catch {
    serverTags.value = []
  }
}

watch(rows, () => {
  clearSelection()
  closeMarkPopover()
})

onMounted(() => {
  document.addEventListener('mousedown', onMarkPointerDown)
  document.addEventListener('keydown', onMarkKeydown)
  void loadSources()
  void loadTagCandidates()
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onMarkPointerDown)
  document.removeEventListener('keydown', onMarkKeydown)
})
watch(() => props.currentSiteId, () => {
  page.value = 1
  void loadSources()
  void loadTagCandidates()
})

/**
 * 源归属被别处改过就重查（2026-09-18）。
 *
 * 触发方是侧栏的批量导入：它把一批源改挂到本网站后只刷新了自己，主区这张表还停在旧结果，
 * 于是出现"侧栏 2 个源、主区共 0 个源"，用户以为导入失败（实测反馈）。
 * **不动页码和筛选条件**——用户的查询上下文是他自己设的，重查即可，别把他弹回第一页。
 */
watch(() => ui.sourceListRevision, () => {
  void loadSources()
})
</script>

<template>
  <section class="sov-shell" data-testid="source-overview">
    <div class="sov-filter">
      <!-- 源 ID / 源名称 / 源 URL 三合一（0917-11）：选字段 + 填值，一次按一个字段查。
           显式选字段而不是自动猜类型——猜错是静默漏结果，用户不会知道。 -->
      <label>查询
        <span class="sov-search">
          <select v-model="searchField" data-testid="source-overview-search-field" @change="searchText && search()">
            <option v-for="f in SEARCH_FIELDS" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
          <input
            v-model="searchText"
            data-testid="source-overview-search-text"
            :placeholder="searchPlaceholder"
            @keyup.enter="search"
          />
        </span>
      </label>
      <label>状态
        <select v-model="statusFilter" data-testid="source-overview-state" @change="search">
          <option value="all">全部</option>
          <option value="C">正常</option>
          <option value="L">运行中</option>
          <option value="E">异常</option>
          <option value="disabled">已停用</option>
        </select>
      </label>
      <label>标签
        <!-- 跟「状态」同一套原生 select。候选来自 sourceTags + 本机最近使用；
             当前筛选项若不在候选里（查看这一批、程序刚打的）仍单独占一项，避免被下拉冲掉。 -->
        <select v-model="tagFilter" data-testid="source-overview-tag" @change="search">
          <option value="">全部</option>
          <option v-if="tagFilter && !tagCandidates.includes(tagFilter)" :value="tagFilter">{{ tagFilter }}</option>
          <option v-for="tag in tagCandidates" :key="tag" :value="tag">{{ tag }}</option>
        </select>
      </label>
      <!-- 备注：有备注 / 无备注 ＋ 关键字（2026-09-24 去掉「不限」，有备注时也能搜）。
           未选时是占位「备注」，不按备注状态筛；选了之后旁边的 × 回到未选。 -->
      <label>备注
        <span class="sov-remark-filter">
          <span class="sov-remark-mode">
            <select v-model="remarkMode" data-testid="source-overview-remark-mode" :class="{ placeholder: !remarkMode, 'has-clear': !!remarkMode }" @change="search">
              <option value="" disabled hidden>备注</option>
              <option value="has">有备注</option>
              <option value="none">无备注</option>
            </select>
            <button
              v-if="remarkMode"
              type="button"
              class="sov-remark-clear"
              data-testid="source-overview-remark-mode-clear"
              aria-label="不按备注状态筛选"
              @click.prevent="clearRemarkMode"
            >×</button>
          </span>
          <input
            v-model="remarkFilter"
            data-testid="source-overview-remark"
            placeholder="备注关键字"
            :disabled="remarkMode === 'none'"
            :title="remarkMode === 'none' ? '选了「无备注」时不能再按关键字搜' : ''"
            @keyup.enter="search"
          />
        </span>
      </label>
      <!-- 「≤」不是「<」：后端 count 的语义含等于（2026-09-20 实测，count=5 的结果里有 47 行正好是 5） -->
      <label>数据量 ≤
        <input
          v-model="dataCountMax"
          type="number"
          min="0"
          step="1"
          class="sov-num"
          data-testid="source-overview-count"
          placeholder="如 5"
          @keyup.enter="search"
        />
      </label>
      <div class="sov-filter-actions" data-testid="source-overview-actions">
        <!-- 从流程中心「查看全部关联源」跳过来时的过滤芯片（0904 I16 / Z7-2）。
             这条件不在任何输入框里，不显式标出来用户会以为"这个网站就这几个源"。 -->
        <span v-if="flowFilterId" class="sov-chip" data-testid="source-flow-chip">
          按流程 #{{ flowFilterId }} 过滤
          <button type="button" class="sov-chip-x" title="取消按流程过滤" @click="flowFilterId = ''; search()">✕</button>
        </span>
        <button class="sov-btn primary" type="button" data-testid="source-overview-search" @click="search">查询</button>
        <button class="sov-btn" type="button" @click="clearFilters">清空</button>
        <button class="sov-btn primary" type="button" data-testid="source-launch" @click="openLaunch">发任务</button>
        <button class="sov-btn" type="button" data-testid="source-export" title="按当前查询条件导出全部命中的源，不是当前页或勾选项" @click="exportSources">导出</button>
      </div>
    </div>

    <div class="sov-summary">
      <span>共 {{ total }} 个源</span>
      <span v-if="collectProgress" class="sov-progress" data-testid="source-collect-progress">{{ collectProgress }}</span>
      <button v-if="failedBatches.length" class="sov-btn" type="button" data-testid="source-retry-failed" @click="retryFailedBatches">重试失败批次（{{ failedBatches.reduce((n, b) => n + b.ids.length, 0) }}）</button>
      <template v-if="selectMode">
        <span class="sov-batch-count" data-testid="source-batch-count">已选 {{ selectedIds.length }}</span>
        <div ref="markAnchorRef" class="sov-mark-anchor">
          <button class="sov-btn sov-mark-btn" type="button" data-testid="batch-mark" :aria-expanded="markOpen" @click="toggleMarkPopover">添加标记</button>
          <SourceMarkPopover
            v-if="markOpen"
            :selected-count="selectedIds.length"
            :recent-tags="tagCandidates"
            @save="saveMarks"
            @clear-tags="clearSelectedTags"
            @set-remark="batchSetRemark"
            @clear-remark="clearSelectedRemark"
          />
        </div>
        <button class="sov-btn" type="button" data-testid="batch-enable" @click="batchToggleEnable(false)">启用</button>
        <button class="sov-btn danger" type="button" data-testid="batch-disable" @click="batchToggleEnable(true)">停用</button>
        <button class="sov-btn ghost" type="button" data-testid="batch-clear" @click="clearSelection">取消</button>
      </template>
    </div>
    <div class="sov-table-wrap" :class="{ loading }">
      <table class="sov-table">
        <thead>
          <tr>
            <th class="sov-check-col">
              <input
                type="checkbox"
                aria-label="全选本页"
                data-testid="source-check-all"
                :checked="allChecked"
                :indeterminate="someChecked"
                @change="toggleAll"
              />
            </th>
            <th><button class="sov-sort" type="button" data-testid="sort-source-id" :title="sortLabel('SOURCE_ID')" @click="toggleSort('SOURCE_ID')">源 ID <span>{{ sortField === 'SOURCE_ID' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>源名称</th>
            <th>URL</th><th>主表</th>
            <th>标签</th>
            <th><button class="sov-sort" type="button" data-testid="sort-data-cnt" :title="sortLabel('DATA_CNT')" @click="toggleSort('DATA_CNT')">数据 <span>{{ sortField === 'DATA_CNT' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>新入</th><th>成功</th>
            <th><button class="sov-sort" type="button" data-testid="sort-last-task" :title="sortLabel('LAST_RUN')" @click="toggleSort('LAST_RUN')">最近任务 <span>{{ sortField === 'LAST_RUN' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th><button class="sov-sort" type="button" data-testid="sort-last-success" :title="sortLabel('LAST_SUCCESS')" @click="toggleSort('LAST_SUCCESS')">最近成功 <span>{{ sortField === 'LAST_SUCCESS' ? (sortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span></button></th>
            <th>状态</th><th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in rows" :key="source.sourceId" :class="{ picked: selectedSet.has(source.sourceId) }">
            <td class="sov-check-col">
              <input
                type="checkbox"
                :aria-label="`选择 ${source.name}`"
                :data-testid="`source-check-${source.sourceId}`"
                :checked="selectedSet.has(source.sourceId)"
                @change="toggleRow(source.sourceId)"
              />
            </td>
            <!-- 源 ID 与源名称走同一个入口（2026-09-09）：两列指的是同一个源，
                 名称能点、ID 不能点没有道理——用户拿 ID 认源比拿名称更多（名称长且相似，
                 ID 才是唯一标识）。等宽字体保持 ID 的可读性与列表其它 ID 一致。 -->
            <td><button class="sov-link sov-id-link" type="button" data-testid="source-overview-id-link" :title="`打开源 ${source.sourceId} 的详情`" @click="emit('openSource', source)">{{ source.sourceId }}</button></td>
            <td class="sov-name" :title="source.name"><button class="sov-link sov-source-link" type="button" data-testid="source-overview-source-link" @click="emit('openSource', source)">{{ source.name }}</button></td>
            <td class="sov-url" :title="source.url">
              <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" @click.stop>{{ source.url }}</a>
              <template v-else>—</template>
            </td>
            <td>{{ source.mainTable || '—' }}</td>
            <td>
              <!-- 标签列与备注列都点开同一个弹窗：想删掉某一个标签只有这条路（批量条只能追加/清空） -->
              <button
                class="sov-cell-edit"
                type="button"
                data-testid="source-mark-edit"
                title="编辑标签与备注"
                @click="openMarkEditor(source)"
              >
                <span class="sov-row-tags" data-testid="source-issue-tags">
                  <span v-for="tag in tagPreview(source).shown" :key="tag">{{ tag }}</span>
                  <em v-if="tagPreview(source).extra">+{{ tagPreview(source).extra }}</em>
                  <template v-if="!(source.tags && source.tags.length)">—</template>
                </span>
              </button>
            </td>
            <!-- 数据量做成可点（0903 H11/Y1-15）：源视图是统计层、数据视图是明细层，
                 会上「这个 7 代表着这个圆下面有 7 条数据」——那这个数字本身就该是入口。
                 样式与数据视图里的「下级」条数保持一致（同为"点数字下钻一层"）。 -->
            <td>
              <button
                v-if="source.dataCount"
                class="sov-link sov-count-link"
                type="button"
                data-testid="source-data-count"
                :title="`查看这 ${source.dataCount} 条数据`"
                @click="emit('openSourceData', source)"
              >{{ source.dataCount }}</button>
              <template v-else>{{ source.dataCount ?? '—' }}</template>
            </td>
            <!-- 「新入 / 成功」对齐旧平台：显示最近入库 / 最近成功时间的相对描述（旧平台就是「N 天前」），
                 hover 看精确时间。右侧「最近任务 / 最近成功」保留绝对时间。 -->
            <td :title="source.lastInsertAt || ''">{{ timeAgo(source.lastInsertAt) }}</td>
            <td :title="source.lastSuccessAt || ''">{{ timeAgo(source.lastSuccessAt) }}</td>
            <td>{{ source.lastTaskAt || '—' }}</td>
            <td>{{ source.lastSuccessAt || '—' }}</td>
            <td><span class="sov-state" :class="{ error: source.state === 'E' && !source.disabled, muted: source.disabled }">{{ sourceState(source) }}</span></td>
            <td>
              <button
                class="sov-remark sov-cell-edit"
                type="button"
                data-testid="source-remark-edit"
                :title="source.remark || '编辑标签与备注'"
                @click="openMarkEditor(source)"
              >{{ source.remark || '—' }}</button>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td colspan="13" class="sov-empty">{{ loadError || '暂无符合条件的源' }}</td></tr>
        </tbody>
      </table>
    </div>
    <!-- 分页与数据中心统一（DataQueryPanel 的 .dqp-pager 同款 el-pagination）；
         全站列表都用这一个组件，别换回手写的上一页/下一页按钮。 -->
    <div class="sov-pager">
      <el-pagination
        data-testid="source-pagination"
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="loadSources"
        @size-change="onPageSizeChange"
      />
    </div>
    <div v-if="markToast" class="sov-toast" data-testid="source-mark-toast">
      <span>{{ markToast }}</span>
      <button v-if="lastSavedTag" type="button" data-testid="source-mark-view-batch" @click="viewMarkedBatch">查看这一批</button>
      <button class="sov-toast-close" type="button" aria-label="关闭提示" @click="markToast = ''">×</button>
    </div>
    <EditSourceMarkDialog
      v-if="editTarget"
      :source="editTarget"
      :tag-candidates="tagCandidates"
      @saved="onMarkEdited"
      @close="editTarget = null"
    />
    <LaunchConfirmDialog
      v-if="launchOpen && launchScope"
      :mode="launchScope.mode"
      :hit-count="launchScope.hitCount"
      :send-count="launchPreview.sendCount"
      :disabled-count="launchPreview.disabledCount"
      :param-count="launchPreview.paramCount"
      :param-names="launchPreview.paramNames"
      :filter-text="launchScope.mode === 'query' ? describeFilters(launchScope.query) : ''"
      :sending="launchSending"
      @confirm="confirmLaunch"
      @close="closeLaunch"
    />
    <SourceParamModal ref="paramModalRef" :callback="sendWithParamsCallback" />
  </section>
</template>

<style scoped>
.sov-shell { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 12px; background: #f8fafc; gap: 10px; }
.sov-filter { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-filter label { display: grid; gap: 4px; color: var(--rc-muted); font-size: 11px; }
.sov-filter input, .sov-filter select { height: 30px; min-width: 116px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; color: var(--rc-text); background: #fff; font-size: 12px; }
.sov-filter input:focus, .sov-filter select:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.sov-filter input:disabled { background: #f4f6f9; color: var(--rc-faint); cursor: not-allowed; }
/* 备注那格里的「三态 + 关键字」并排，整体占位与其它单控件的格子相当 */
/* 查询那格：字段下拉 + 输入框并排，输入框吃掉剩余宽度（它装的是 ID 串 / 关键字，比下拉需要地方） */
.sov-search { display: flex; gap: 4px; }
.sov-filter .sov-search select { min-width: 88px; }
.sov-filter .sov-search input { min-width: 190px; }
.sov-remark-filter { display: flex; gap: 4px; }
.sov-filter .sov-remark-filter select { min-width: 108px; }
/* 选中后右侧要放 ×（在下拉箭头左边），文字给它让出位置，别挤在一起 */
.sov-filter .sov-remark-filter select.has-clear { padding-right: 44px; }
.sov-remark-mode { position: relative; display: inline-flex; }
.sov-filter .sov-remark-filter select.placeholder { color: var(--rc-faint); }
.sov-remark-clear {
  position: absolute; right: 24px; top: 50%; transform: translateY(-50%);
  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--rc-muted); font-size: 13px; line-height: 16px; cursor: pointer;
}
.sov-remark-clear:hover { background: #e2e8f0; color: var(--rc-text); }
/* 下拉加宽了 32px（给 × 让位），关键字框相应收窄，备注这一格总宽不变——
   1366 下筛选栏第一行本来只剩 29px 余量，多出来会把「数据量 ≤」挤到第二行 */
.sov-filter .sov-remark-filter input { min-width: 104px; width: 121px; }
/* 数字框不需要和文本框一样宽：一行已经很挤（源 ID / 名称 / URL / 状态 / 标签 / 备注 / 数据量） */
.sov-filter input.sov-num { min-width: 84px; width: 84px; }
.sov-filter-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
.sov-btn { height: 30px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; font-size: 12px; font-weight: 600; }

.sov-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 12px; background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary-ink, #1d4ed8); font-size: 12px; }
.sov-chip-x { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 11px; padding: 0; }
.sov-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.sov-progress { color: var(--rc-muted); font-size: 11px; }
.sov-btn:disabled { cursor: not-allowed; opacity: .5; }
.sov-summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; color: var(--rc-text-2); font-size: 12px; }
.sov-summary b { color: var(--rc-text); }
.sov-summary span { color: var(--rc-faint); }
.sov-table-wrap { min-height: 0; flex: 1; overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-table-wrap.loading { opacity: .62; }
.sov-table { width: max(100%, 1260px); border-collapse: collapse; font-size: 12px; }
.sov-table th, .sov-table td { padding: 9px 10px; border-bottom: 1px solid #edf2f7; text-align: left; white-space: nowrap; color: var(--rc-text-2); }
.sov-table th { position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--rc-muted); font-weight: 700; }
.sov-name { max-width: 190px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-text) !important; font-weight: 600; }
.sov-source-link { display: block; max-width: 190px; overflow: hidden; padding: 0; text-align: left; text-overflow: ellipsis; }
.sov-url { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-primary) !important; }
.sov-url a { color: inherit; text-decoration: none; }
.sov-url a:hover { text-decoration: underline; }
.sov-empty { padding: 42px !important; text-align: center !important; color: var(--rc-faint) !important; }
.sov-check-col { width: 34px; text-align: center; }
.sov-check-col input { cursor: pointer; accent-color: var(--rc-primary); margin: 0; }
.sov-count-link { font-weight: 600; }
.sov-id-link { padding: 0; font-family: var(--rc-mono, monospace); }
.sov-table tbody tr.picked { background: var(--rc-primary-bg); }
.sov-batch-count { font-weight: 700; color: var(--rc-primary-ink); }
.sov-mark-anchor { position: relative; }
.sov-mark-btn { border-color: #7da4ff; color: var(--rc-primary); }
.sov-cell-edit { max-width: 200px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
.sov-cell-edit:hover { color: var(--rc-primary); }
.sov-remark { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sov-row-tags { display: inline-flex; align-items: center; gap: 4px; }
.sov-row-tags span, .sov-row-tags em { height: 23px; padding: 0 6px; border: 1px solid #dbe3ed; border-radius: 4px; background: #f8fafc; color: var(--rc-muted); font-size: 10px; font-style: normal; line-height: 21px; white-space: nowrap; }
.sov-row-tags em { padding: 0 5px; color: var(--rc-text-2); }
.sov-toast { position: fixed; z-index: 50; top: 18px; left: 50%; display: flex; align-items: center; gap: 9px; min-width: 300px; height: 44px; padding: 0 13px; border: 1px solid #d8eadc; border-radius: 7px; background: #f0fdf4; box-shadow: 0 8px 20px rgba(15, 23, 42, .12); color: #166534; transform: translateX(-50%); font-size: 12px; }
.sov-toast button { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 11px; font-weight: 700; }
.sov-toast-close { margin-left: auto; padding: 0; color: var(--rc-muted) !important; font-size: 16px !important; }
.sov-btn.danger { color: #b91c1c; border-color: #fecaca; }
.sov-btn.ghost { color: var(--rc-faint); }
.sov-state { display: inline-flex; padding: 2px 7px; border-radius: 999px; background: #ecfdf3; color: #15803d; font-size: 11px; font-weight: 700; }
.sov-state.error { background: #fef2f2; color: #dc2626; }
.sov-state.muted { background: #f1f5f9; color: #64748b; }
.sov-link { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.sov-sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.sov-sort span { color: #94a3b8; font-size: 11px; }
.sov-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
</style>
