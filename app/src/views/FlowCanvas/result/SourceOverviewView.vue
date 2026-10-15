<script setup lang="ts">
// 源总览，两处在用：
// 1. 网站详情（左侧“全部”）下的「源视图」：传 currentSiteId，只查当前网站，不提供跨网站范围切换
//    （0812 会议纠偏：进入网站后源/数据/文件/监控范围必须固定为当前 siteId，不能从网站详情跨站查询）；
// 2. 采集资产的「源列表视图」（0924-06，表格视图改为源列表）：currentSiteId 传空 = 不限网站，
//    此时多出「所属网站」列和「网站」筛选；页签范围（最近打开的网站）经 scopeSiteIds 传入。
//    同一个组件而不是另写一套，是为了两处的列、筛选、批量操作完全一致，用户学一次就会。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Star, StarFilled } from '@element-plus/icons-vue'
import { dataApi, siteApi, sourceApi, sourceGroupApi, flowCenterApi, type DataTableMeta, type FlowRecord, type Source } from '@/api'
import { isProductionBackend } from '@/api/client'
import { useLaunchJobStore } from '@/stores/launchJob'
import { useUiStore } from '@/stores/ui'
import {
  mergeIssueTags,
  normalizeIssueTag,
  readRecentIssueTags,
  rememberIssueTags,
  visibleIssueTags,
} from '@/utils/sourceMark'
import SourceMarkPopover from './SourceMarkPopover.vue'
import EditSourceMarkDialog from './EditSourceMarkDialog.vue'
import FlowDetailDrawer from '@/views/FlowCenter/FlowDetailDrawer.vue'
import TableDetailDialog from '@/views/DataView/TableDetailDialog.vue'
import SourceFlowConfigDrawer from '@/views/CollectAssets/SourceFlowConfigDrawer.vue'
import AdjustSourceGroupDialog from '@/views/CollectAssets/AdjustSourceGroupDialog.vue'
import RunOnceDialog from '@/views/CollectAssets/RunOnceDialog.vue'
import { scopedSourceIds } from './sourceScope'
import { HIDEABLE_SOURCE_COLUMNS, viewStateFilter, type SourceListViewState } from './sourceListViewState'
import LaunchConfirmDialog from './LaunchConfirmDialog.vue'
import SourceParamModal from '@/views/FlowCanvas/source/SourceParamModal.vue'
import { hasLoadParams, normalizeLoadParams } from '@/views/FlowCanvas/source/paramNormalize'
import { downloadXlsx } from '@/utils/format/xlsxExport'
import { timeAgo } from '@/utils/format/relativeTime'
import { isFavoriteSource, loadFavoriteSources, toggleFavoriteSource } from '@/utils/sourceFavorites'
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
import {
  SOURCE_COND_FIELDS,
  defaultSourceCondOp,
  detectSourceSearchField,
  mightBeUrlFragment,
  sourceCondActive,
  sourceCondFieldOf,
  sourceCondNeedsValue,
  sourceConditionParams,
  type SourceCondField,
  type SourceCondition,
} from './sourceSearchField'

// `initialSourceIds`：从数据视图「按条件查源」跳过来时带的那批源 ID（0903 Y2-4）。
// 直接预填「源 ID」筛选框——那个框本来就收逗号分隔的多个 ID，不为反查另造一套筛选。
//
// 走 prop 而不是在这里 useRoute()：本组件此前完全不依赖 router，测试都是裸 shallowMount；
// 为了一个初始值把整棵测试树都绑上 router 不划算，路由解析留在已经持有 route 的上层。
/** `initialFlowId`：从流程中心「查看全部关联源」跳过来时带的流程 ID（0904 I16 / Z7-2）。
 *  **不用 sourceIds 传**：一个流程最多见过 5439 个源（流程 1400976），拼进 URL 不现实；
 *  `sourcePaged` 本来就认 flowId 这个服务端条件（2026-09-02 实测：flowId=1400330 得 46 条、
 *  与该流程 sourceCnt 一致，传不存在的得 0 条，不是静默忽略）。 */
const props = defineProps<{
  currentSiteId: string
  initialSourceIds?: string
  initialFlowId?: string
  /**
   * 不限网站时的范围（采集资产「最近打开」页签，0924-06）：只查这些网站下的源。
   * `undefined` = 不限；空数组 = 范围为空，直接空态、不发请求（空的 siteIds 会被后端当成"不限"）。
   * 传了 currentSiteId 时忽略。
   */
  scopeSiteIds?: string[]
  /**
   * 固定源范围（「我的收藏」的收藏源 0924-08 / 「我的分组」的分组源）。语义同 scopeSiteIds：
   * `undefined` = 不限；空数组 = 范围为空，直接空态、不发请求（空的 ids 会被后端当成"不限"返回全部源）。
   * 与「源 ID」查询条件同时存在时取交集；清空查询条件也不解除此范围。
   */
  scopeSourceIds?: string[]
  /**
   * 固定来源组范围（1008-03「来源组」目录页签）：只查这个组的成员源。
   * `undefined` = 不限；空字符串 = 范围为空，直接空态、不发请求。
   * 走 `sourcePaged` 的 `sourceGroupId` 服务端条件（2026-10-09 实测支持），255 个成员的组天然翻页；
   * 与其它筛选条件（名称 / 状态等）取交集，清空查询条件也不解除此范围。
   */
  scopeSourceGroupId?: string
  /**
   * 固定「我的视图」目录范围（10-15）：走 `sourcePaged` 的 `viewCategoryId`，后端算目录里的源 ∪ 绑定来源组的当前成员。
   * 只有 sourcePaged 认这个条件，所以给了它时「按筛选范围调整来源组」禁用（那个接口会当成不限）。
   */
  scopeViewCategoryId?: string
  /** 范围内容变了但范围参数没变（如往视图目录里加了源）时由父级加 1，触发重查 */
  scopeVersion?: number
  /** 范围为空时的空态文案（如最近打开一个都没有） */
  scopeEmptyText?: string
  /**
   * 源列表「来源组」能力开关（1008-04）：只在源管理源列表视图（`CollectAssets/SourceTab.vue`）开。
   * 开时多出三列（来源组 / 默认流程 / 流程配置）、来源组筛选下拉、勾选后的「选中来源」批量操作
   * （源流程配置 / 调整来源组 / 指定流程运行一次）。
   */
  groupOps?: boolean
  /**
   * 「我的视图」（2026-10-12）：外部给定一套视图状态（条件 / 排序 / 每页条数 / 隐藏列），
   * 挂载时和每次换成新对象时套用并重查。不传 = 原来的默认条件、全部列。
   */
  viewState?: SourceListViewState
  /**
   * 额外一列（2026-10-13「我的视图」目录版的「所在目录」）：给了表头文字就在「源名称」后面多一列，
   * 内容由父级用 `extra-cell` 槽位按行渲染。不给 = 原样。
   */
  extraColumnLabel?: string
}>()
const emit = defineEmits<{
  openSource: [source: Source]
  /** 点「所属网站」（仅不限网站时有这一列） */
  openSite: [siteId: string]
  /** 点「数据量」这个数字（0903 Y1-15）：进这个源的数据视图，而不是流程视图 */
  openSourceData: [source: Source]
  /** 点来源组名（1008-04）：跳到「来源组」目录页签并选中该组 */
  openSourceGroup: [sourceGroupId: string]
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
 * 查询：多条件并行（2026-09-28 产品：「改成和数据搜索一样」，用户定按多条件做）。
 * 每行 = 字段 ＋ 条件 ＋ 值，行与行之间是「并且」；备注也并进来了（原先单独一格的有 / 无备注
 * 就是这里的「非空 / 为空」）。字段、条件和参数口径见 sourceSearchField.ts。
 *
 * 沿革：0917-11 把源 ID / 名称 / URL 并成「字段 ▾ ＋ 一个输入框」，一次只能按一个字段查；
 * 2026-09-28 产品嫌「要点 2 下」加了自动识别；同日改成多条件，两者都保留——
 * 没手动选过字段的行，照样按输入内容自动识别 ID / 名称 / URL（不会识别成备注，也不抢别的行已占的字段）；
 * 说不准的单个英文词按名称查，查空了给「改按 URL 查」的提示（urlFallback），不静默漏。
 *
 * **状态 / 标签 / 网站 / 数据量不并进来**：它们是枚举或数值，各自一个下拉 / 数字框更顺手。
 */
interface ConditionRow extends SourceCondition {
  key: number
  /** 用户手动点下拉选过字段：之后不再自动识别覆盖它；清空输入框后恢复自动 */
  pinned: boolean
}
let conditionSeq = 0
function newCondition(field: SourceCondField, value = ''): ConditionRow {
  return { key: ++conditionSeq, field, op: defaultSourceCondOp(field), value, pinned: false }
}
const conditions = ref<ConditionRow[]>([
  // 流程中心「查看全部关联源」带过来的流程 ID 落成一行「流程 ID 等于」（0930-15），不再单独挂芯片；
  // 没带源 ID 时就只有这一行，不留一个空的源 ID 行在前面
  ...(props.initialSourceIds || !props.initialFlowId ? [newCondition('sourceIds', props.initialSourceIds ?? '')] : []),
  ...(props.initialFlowId ? [{ ...newCondition('flowId', props.initialFlowId), pinned: true }] : []),
])
/** 同一字段只能有一行（后端一个参数只带一个值）：别的行占了的字段在下拉里置灰 */
function fieldTakenByOther(field: SourceCondField, row: ConditionRow) {
  return conditions.value.some((c) => c !== row && c.field === field)
}
const canAddCondition = computed(() => conditions.value.length < SOURCE_COND_FIELDS.length)
function addCondition() {
  const free = SOURCE_COND_FIELDS.find((f) => !conditions.value.some((c) => c.field === f.value))
  if (free) conditions.value.push(newCondition(free.value))
}
function removeCondition(row: ConditionRow) {
  const wasActive = sourceCondActive(row)
  if (conditions.value.length > 1) conditions.value = conditions.value.filter((c) => c !== row)
  else conditions.value = [newCondition('sourceIds')]
  if (wasActive) search()
}
function conditionPlaceholder(row: ConditionRow) {
  if (row.pinned || row.field === 'remark' || row.field === 'flowId') return sourceCondFieldOf(row.field).placeholder
  return '源 ID / 名称 / URL，自动识别'
}
function onConditionInput(row: ConditionRow, value: string) {
  row.value = value
  if (!value.trim()) {
    row.pinned = false
    return
  }
  if (row.pinned || row.field === 'remark' || row.field === 'flowId') return
  // 识别出的字段被别的行占了，退回按名称查（名称是兜底口径）；名称也占了就不动
  const target = ([detectSourceSearchField(value), 'name'] as const).find((f) => f && !fieldTakenByOther(f, row))
  if (target && target !== row.field) {
    row.field = target
    row.op = defaultSourceCondOp(target)
  }
}
function onFieldPicked(row: ConditionRow) {
  row.pinned = true
  if (!sourceCondFieldOf(row.field).ops.some((o) => o.value === row.op && !o.unsupported)) row.op = defaultSourceCondOp(row.field)
  if (sourceCondActive(row)) search()
}
/** 切到「非空 / 为空」立刻生效；切回要填值的条件时框里有值才重查，空着不白打一次请求 */
function onOpPicked(row: ConditionRow) {
  if (sourceCondActive(row)) search()
}
/**
 * 某行按名称自动识别、查出 0 条，且输入像网址片段（如 `centec`）时，提示改按 URL 查。
 * 记下的是当时查的词：用户改了输入框提示就不再成立，下一次查询会重算。
 */
const urlFallback = ref<{ key: number; keyword: string } | null>(null)
function useUrlFallback() {
  const row = conditions.value.find((c) => c.key === urlFallback.value?.key)
  if (!row) return
  row.field = 'sourceUrl'
  row.op = defaultSourceCondOp('sourceUrl')
  row.pinned = true
  search()
}

/** 不限网站模式（采集资产源列表视图）：多出「所属网站」列与「网站」筛选 */
const crossSite = computed(() => !props.currentSiteId)
/** 「网站」筛选：'' = 不限，'-1' = 未关联网站（后端约定，source-api.md §1.1） */
const siteFilter = ref('')
const UNBOUND_SITE = '-1'
/**
 * 来源组筛选（1008-04）：'' = 不限。候选来自 `sourceGroupApi.list()`；**不含「未归组」**
 * ——后端 sourcePaged 只接受正数 sourceGroupId，传 -1 / 0 报「sourceGroupId 必须为正数」
 * （2026-10-09 实测），所以下拉不提供筛未归组的选项。
 */
const sourceGroupFilter = ref('')
const sourceGroupOptions = ref<{ sourceGroupId: string; name: string; state: string }[]>([])
async function loadSourceGroupOptions() {
  if (!props.groupOps || sourceGroupOptions.value.length) return
  try {
    const rows = await sourceGroupApi.list()
    sourceGroupOptions.value = rows.map((g) => ({ sourceGroupId: g.sourceGroupId, name: g.sourceGroupName, state: g.state }))
  } catch {
    // 候选只是筛选辅助，拉不到就只剩「全部来源组」，不打断列表
    sourceGroupOptions.value = []
  }
}
const sourceGroupNameById = computed(() => new Map(sourceGroupOptions.value.map((g) => [g.sourceGroupId, g.name])))
/** 来源组列显示：组名；组列表没拉到（候选加载失败）时用「组 #ID」兜底 */
function sourceGroupNameOf(source: Source): string {
  if (!source.sourceGroupId) return '—'
  return sourceGroupNameById.value.get(source.sourceGroupId) ?? `组 #${source.sourceGroupId}`
}
/** 流程候选（默认流程列名称、指定流程运行一次的选项），排除停用 */
const flowOptions = ref<FlowRecord[]>([])
async function loadFlowOptions() {
  if (flowOptions.value.length) return
  try {
    const rows = await flowCenterApi.list()
    flowOptions.value = rows.filter((f) => f.state !== 'D')
  } catch {
    flowOptions.value = []
  }
}
const flowNameById = computed(() => new Map(flowOptions.value.map((f) => [f.id, f.name])))
/** 默认流程列显示：流程名 · ID；流程列表没拉到时用 ID */
function flowNameOf(flowId: string): string {
  const name = flowNameById.value.get(flowId)
  return name ? `${name} · ${flowId}` : flowId
}
/** 点默认流程：拉详情后打开流程拓扑（复用现有流程拓扑查看） */
const flowDetail = ref<FlowRecord | null>(null)
async function openFlowNode(flowId: string) {
  try {
    flowDetail.value = await flowCenterApi.detail(flowId)
  } catch (error) {
    ElMessage.error(`加载流程失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
/** 点主表：拉表结构后在右侧抽屉展示（旧平台 SourceList 点主表看表信息；复用数据查询的「表结构详情」抽屉） */
const mainTableOpen = ref(false)
const mainTableMeta = ref<DataTableMeta | null>(null)
async function openMainTable(tableId: string) {
  try {
    const meta = await dataApi.tableMeta(tableId)
    if (!meta) {
      ElMessage.warning(`未找到主表 ${tableId} 的结构`)
      return
    }
    mainTableMeta.value = meta
    mainTableOpen.value = true
  } catch (error) {
    ElMessage.error(`加载表结构失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
/**
 * 不限网站时自己拉一次全量网站（当前约 98 个，一个请求），两处用：「网站」筛选的候选，
 * 以及「所属网站」列的名称——**sourcePaged 列表不返回 siteName**，只有 siteId
 * （2026-09-24 生产实测；source-api.md 字段对照表里的 siteName 在分页列表里并不出现）。
 */
const siteOptions = ref<{ siteId: string; name: string }[]>([])
async function loadSiteOptions() {
  if (!crossSite.value || siteOptions.value.length) return
  try {
    const result = await siteApi.sitePaged({ page: 1, size: 2000 })
    siteOptions.value = result.list.map((s) => ({ siteId: s.siteId, name: s.name }))
  } catch {
    // 候选只是筛选辅助，拉不到就只剩「未关联网站」，不打断列表
    siteOptions.value = []
  }
}
const siteNameById = computed(() => new Map(siteOptions.value.map((s) => [s.siteId, s.name])))
function siteNameOf(source: Source): string {
  return source.siteName || siteNameById.value.get(String(source.siteId)) || String(source.siteId)
}
/** 候选按范围收窄：最近打开页签里只列最近打开的那几个网站 */
const siteFilterOptions = computed(() => {
  const all = siteOptions.value
  if (!props.scopeSiteIds) return all
  const scope = new Set(props.scopeSiteIds)
  return all.filter((s) => scope.has(s.siteId))
})
/** 范围给了但是空的：不发请求，直接空态 */
const scopeEmpty = computed(() => (crossSite.value && !!props.scopeSiteIds && props.scopeSiteIds.length === 0)
  || (!!props.scopeSourceIds && props.scopeSourceIds.length === 0)
  || (props.scopeSourceGroupId != null && props.scopeSourceGroupId === ''))
/** 当前条件在范围内必然一个都查不到：列表、导出、按条件发任务都不能发请求，否则会变成"不限" */
const noScopeMatch = computed(() => scopeEmpty.value
  || scopedSourceIds(props.scopeSourceIds, sourceConditionParams(conditions.value).sourceIds) === '')
/** 实际发给后端的 siteIds（逗号分隔）。当前网站 > 网站筛选 > 页签范围 > 不限 */
function effectiveSiteIds(): string | undefined {
  if (props.currentSiteId) return props.currentSiteId
  if (siteFilter.value) return siteFilter.value
  if (props.scopeSiteIds) return props.scopeSiteIds.join(',') || undefined
  return undefined
}
// 同 initialSourceIds：本组件常常已经挂载着，prop 变了也要落进「流程 ID」那一行并重查。
watch(() => props.initialFlowId, (id) => {
  if (!id) return
  const existing = conditions.value.find((c) => c.field === 'flowId')
  if (existing?.value === id) return
  const first = conditions.value[0]!
  if (existing) existing.value = id
  else if (!sourceCondActive(first)) Object.assign(first, { field: 'flowId', op: 'eq', value: id, pinned: true })
  else conditions.value.push({ ...newCondition('flowId', id), pinned: true })
  page.value = 1
  void loadSources()
})
// prop 变化也要生效：反查跳过来时本组件常常已经挂载着（同一个 SiteDetailView 里切视图），
// 只把它当初始值用等于永远不生效。清空不跟随——那是用户自己在筛选框里的操作，别覆盖他。
watch(() => props.initialSourceIds, (ids) => {
  if (!ids) return
  const existing = conditions.value.find((c) => c.field === 'sourceIds')
  if (existing?.value === ids) return
  // 反查跳过来带的是一串源 ID，要落在「源 ID」那一行，否则这串 ID 会被当成名称关键字发出去。
  // 已有源 ID 行就改它；第一行空着就把它改成源 ID；否则另加一行，不冲掉用户别的条件。
  const first = conditions.value[0]!
  if (existing) existing.value = ids
  else if (!sourceCondActive(first)) Object.assign(first, { field: 'sourceIds', op: 'eq', value: ids, pinned: false })
  else conditions.value.push(newCondition('sourceIds', ids))
  page.value = 1
  void loadSources()
})
const statusFilter = ref<StatusFilter>('all')
const tagFilter = ref('')
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

/** 隐藏的列（「我的视图」显示设置）；不在视图里时恒为空 = 全部显示 */
const hiddenColumns = ref<string[]>([])
const showCol = (key: string) => !hiddenColumns.value.includes(key)
/** 实际隐藏掉的列数（空态行 colspan 用）：只算当前列表本来就有的列——网站列只在不限网站时有，来源组三列只在 groupOps 时有 */
const hiddenColumnCount = computed(() => HIDEABLE_SOURCE_COLUMNS.filter((c) => hiddenColumns.value.includes(c.key)
  && (c.key !== 'site' || crossSite.value) && (!c.groupOps || (crossSite.value && props.groupOps))).length)

/** 当前视图状态：查询条件 + 排序 + 每页条数 + 隐藏列 */
const currentViewState = computed<SourceListViewState>(() => ({
  v: 1,
  conditions: conditions.value.map((c) => ({ field: c.field, op: c.op, value: c.value })),
  site: siteFilter.value,
  sourceGroup: sourceGroupFilter.value,
  status: statusFilter.value,
  tag: tagFilter.value,
  countMax: String(dataCountMax.value ?? ''),
  sortField: sortField.value,
  sortDirection: sortDirection.value,
  pageSize: size.value,
  hiddenColumns: [...hiddenColumns.value],
}))

/** 套用一套视图状态（不发请求，调用方决定何时查） */
function applyViewState(state: SourceListViewState) {
  const rows = state.conditions.length ? state.conditions : [{ field: 'sourceIds' as const, op: 'eq' as const, value: '' }]
  // 保存下来的字段是用户定过的：一律 pinned，不再按输入内容自动改字段
  conditions.value = rows.map((c) => ({ ...newCondition(c.field, c.value), op: c.op, pinned: !!c.value.trim() }))
  siteFilter.value = state.site
  sourceGroupFilter.value = state.sourceGroup
  statusFilter.value = state.status
  tagFilter.value = state.tag
  dataCountMax.value = state.countMax
  sortField.value = state.sortField
  sortDirection.value = state.sortDirection
  size.value = state.pageSize || 20
  hiddenColumns.value = [...state.hiddenColumns]
  page.value = 1
}
if (props.viewState) applyViewState(props.viewState)
watch(() => props.viewState, (state) => {
  if (!state) return
  applyViewState(state)
  clearSelection()
  void loadSources()
})

function currentQuery(): SourceFilter {
  const base = viewStateFilter(currentViewState.value)
  const cond = sourceConditionParams(conditions.value)
  return {
    ...base,
    // 当前网站 > 网站筛选 > 页签范围；源 ID 与页签的固定源范围取交集
    siteIds: effectiveSiteIds(),
    sourceIds: scopedSourceIds(props.scopeSourceIds, cond.sourceIds),
    // 1008-03 来源组范围：固定按组筛（sourcePaged 服务端条件），不受用户查询条件影响
    sourceGroupId: props.scopeSourceGroupId || base.sourceGroupId,
    ...(props.scopeViewCategoryId ? { viewCategoryId: props.scopeViewCategoryId } : {}),
  }
}

async function fetchSourcePage(query: SourceFilter & { page: number; size: number }) {
  if (query.sourceIds === '') return { list: [], total: 0 }
  return sourceApi.sourcePaged(query)
}

async function loadSources() {
  const requestId = ++sourceRequestSeq
  if (noScopeMatch.value) {
    rows.value = []
    total.value = 0
    loadError.value = ''
    loading.value = false
    return
  }
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
    const guess = result.total === 0
      ? conditions.value.find((c) => c.field === 'name' && !c.pinned && mightBeUrlFragment(c.value) && !fieldTakenByOther('sourceUrl', c))
      : undefined
    urlFallback.value = guess ? { key: guess.key, keyword: guess.value.trim() } : null
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
  conditions.value = [newCondition('sourceIds')]
  statusFilter.value = 'all'
  tagFilter.value = ''
  dataCountMax.value = ''
  siteFilter.value = ''
  sourceGroupFilter.value = ''
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
/** 表头排序态 class，对齐 el-table 的 ascending / descending（当前方向的小三角高亮） */
function sortClass(field: string) {
  if (sortField.value !== field) return ''
  return sortDirection.value === 'asc' ? 'ascending' : 'descending'
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
// ---- 1008-04 来源组批量操作（勾选后「选中来源 ▾」下拉）----
const sourceGroupOpsOpen = ref(false)
const flowConfigOpen = ref(false)
const flowConfigSource = ref<Source | null>(null)
const adjustGroupOpen = ref(false)
const runOnceOpen = ref(false)
function openFlowConfigForSelected() {
  if (selectedIds.value.length !== 1) {
    ElMessage.warning('源流程配置一次只看一个源，请只勾选 1 个')
    return
  }
  const source = rows.value.find((r) => r.sourceId === selectedIds.value[0])
  if (!source) return
  flowConfigSource.value = source
  flowConfigOpen.value = true
}
/** 「流程配置」列点击：直接打开该源的配置抽屉 */
function openFlowConfigForSource(source: Source) {
  flowConfigSource.value = source
  flowConfigOpen.value = true
}
/** 生产写保护没放开 changeMembersByRange（2026-10-10 定）：连生产时调整来源组只能按勾选 */
const rangeAdjustAllowed = !isProductionBackend()
function openAdjustGroup() {
  if (!selectedIds.value.length && !rangeAdjustAllowed) {
    ElMessage.warning('请先勾选要调整的来源')
    return
  }
  // 没勾选 = 按当前筛选范围调整（弹窗内二次确认）
  adjustGroupOpen.value = true
}
function openRunOnce() {
  if (!selectedIds.value.length) {
    ElMessage.warning('请先勾选要运行一次的来源')
    return
  }
  runOnceOpen.value = true
}
function onGroupOpsCommand(command: string) {
  sourceGroupOpsOpen.value = false
  if (command === 'flow-config') openFlowConfigForSelected()
  else if (command === 'adjust-group') openAdjustGroup()
  else if (command === 'run-once') openRunOnce()
}
/** 来源组批量操作写完后：清勾选、重拉来源组候选、重查列表（组归属 / 默认流程列变了） */
function onGroupOpsChanged() {
  clearSelection()
  sourceGroupOptions.value = []
  void loadSourceGroupOptions()
  page.value = 1
  void loadSources()
}
/** 当前查询是否带着筛选条件（调整来源组按范围时：没有任何条件 → 警告将对全部可见来源调整） */
const hasQueryFilter = computed(() => {
  const cond = sourceConditionParams(conditions.value)
  return Object.keys(cond).length > 0
    || statusFilter.value !== 'all'
    || !!tagFilter.value
    || !!dataCountMax.value
    || !!siteFilter.value
    || !!sourceGroupFilter.value
})
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
  // 范围为空时 currentQuery 里的 siteIds / sourceIds 是空的 = 不限，照发就成了导出全库
  if (noScopeMatch.value) {
    ElMessage.warning('当前查询条件没有命中任何源')
    return
  }
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
    downloadXlsx(`源列表_${props.currentSiteId || '全部网站'}_${date}.xlsx`, rows, '源列表')
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
    const cond = sourceConditionParams(conditions.value)
    const sourceIds = scopedSourceIds(props.scopeSourceIds, cond.sourceIds)
    if (sourceIds === '') { serverTags.value = []; return }
    serverTags.value = await sourceApi.sourceTags({
      siteIds: effectiveSiteIds(),
      sourceIds,
      name: cond.name,
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
  void loadSiteOptions()
  void loadSourceGroupOptions()
  void loadFlowOptions()
  void loadFavoriteSources()
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
// 源范围变了（本页取消了收藏 / 切了分组）：清掉勾选再重查，「我的收藏」里就不再有它
watch(() => (props.scopeSourceIds ? props.scopeSourceIds.join(',') : null), () => {
  clearSelection()
  page.value = 1
  void loadSources()
})
// 来源组 / 视图目录范围变了：清掉勾选再重查
watch(() => `${props.scopeSourceGroupId ?? ''}|${props.scopeViewCategoryId ?? ''}|${props.scopeVersion ?? 0}`, () => {
  clearSelection()
  page.value = 1
  void loadSources()
})
// 页签范围变了（最近打开多了一个网站）：已选的网站若不在新范围里就放掉，再重查
watch(() => (props.scopeSiteIds ? props.scopeSiteIds.join(',') : null), () => {
  if (siteFilter.value && siteFilter.value !== UNBOUND_SITE && !siteFilterOptions.value.some((s) => s.siteId === siteFilter.value)) {
    siteFilter.value = ''
  }
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
    <!-- 不限网站（采集资产源列表视图）用紧凑样式：与同页的网站查询工具条同一套外观——
         一行排开、不要控件上方的小标题（改由首项 / 占位文字说明）、34px 高。网站详情里保持原样。 -->
    <div class="sov-filter" :class="{ 'is-compact': crossSite }">
      <!-- 查询：多条件并行（2026-09-28），每行 字段 ＋ 条件 ＋ 值，行与行之间是「并且」。
           备注也在这里（非空 / 为空 = 原来的有备注 / 无备注）。同一字段只能一行。 -->
      <div class="sov-field"><span class="sov-label-text">查询</span>
        <div class="sov-conds" data-testid="source-overview-conditions">
          <div v-for="(row, index) in conditions" :key="row.key" class="sov-search" data-testid="source-overview-condition">
            <select v-model="row.field" data-testid="source-overview-search-field" :aria-label="`第 ${index + 1} 个条件的字段`" @change="onFieldPicked(row)">
              <option v-for="f in SOURCE_COND_FIELDS" :key="f.value" :value="f.value" :disabled="fieldTakenByOther(f.value, row)">{{ f.label }}</option>
            </select>
            <select v-model="row.op" class="sov-op" data-testid="source-overview-search-op" :aria-label="`第 ${index + 1} 个条件的匹配方式`" @change="onOpPicked(row)">
              <option
                v-for="o in sourceCondFieldOf(row.field).ops"
                :key="o.value"
                :value="o.value"
                :disabled="!!o.unsupported"
                :title="o.unsupported"
              >{{ o.unsupported ? `${o.label}（暂不支持）` : o.label }}</option>
            </select>
            <input
              :value="sourceCondNeedsValue(row.op) ? row.value : ''"
              data-testid="source-overview-search-text"
              :placeholder="sourceCondNeedsValue(row.op) ? conditionPlaceholder(row) : '无需填写'"
              :disabled="!sourceCondNeedsValue(row.op)"
              @input="onConditionInput(row, ($event.target as HTMLInputElement).value)"
              @keyup.enter="search"
            />
            <button
              v-if="conditions.length > 1 || sourceCondActive(row)"
              type="button"
              class="sov-cond-btn"
              data-testid="source-overview-condition-remove"
              :title="conditions.length > 1 ? '删除这个条件' : '清空这个条件'"
              :aria-label="conditions.length > 1 ? '删除这个条件' : '清空这个条件'"
              @click="removeCondition(row)"
            >×</button>
            <button
              v-if="index === conditions.length - 1 && canAddCondition"
              type="button"
              class="sov-cond-btn add"
              data-testid="source-overview-condition-add"
              title="添加条件（与已有条件同时满足）"
              aria-label="添加条件"
              @click="addCondition"
            >+</button>
          </div>
        </div>
      </div>
      <!-- 网站筛选：只在不限网站（采集资产源列表视图）时出现；网站详情里范围固定为当前网站 -->
      <label v-if="crossSite" class="sov-fl-site"><span class="sov-label-text">网站</span>
        <select v-model="siteFilter" data-testid="source-overview-site" @change="search">
          <option value="">全部网站</option>
          <option v-if="!scopeSiteIds" :value="UNBOUND_SITE">未关联网站</option>
          <option v-for="s in siteFilterOptions" :key="s.siteId" :value="s.siteId">{{ s.name }}</option>
        </select>
      </label>
      <!-- 来源组筛选（1008-04）：只在源列表视图（groupOps）出现；不含「未归组」 -->
      <label v-if="crossSite && groupOps" class="sov-fl-group"><span class="sov-label-text">来源组</span>
        <select v-model="sourceGroupFilter" data-testid="source-overview-group" @change="search">
          <option value="">全部来源组</option>
          <option v-for="g in sourceGroupOptions" :key="g.sourceGroupId" :value="g.sourceGroupId" :disabled="g.state !== 'ACTIVE'">{{ g.name }}</option>
        </select>
      </label>
      <label class="sov-fl-state"><span class="sov-label-text">状态</span>
        <select v-model="statusFilter" data-testid="source-overview-state" @change="search">
          <option value="all">{{ crossSite ? '全部状态' : '全部' }}</option>
          <option value="C">正常</option>
          <option value="L">运行中</option>
          <option value="E">异常</option>
          <option value="disabled">已停用</option>
        </select>
      </label>
      <label class="sov-fl-tag"><span class="sov-label-text">标签</span>
        <!-- 跟「状态」同一套原生 select。候选来自 sourceTags + 本机最近使用；
             当前筛选项若不在候选里（查看这一批、程序刚打的）仍单独占一项，避免被下拉冲掉。 -->
        <select v-model="tagFilter" data-testid="source-overview-tag" @change="search">
          <option value="">{{ crossSite ? '全部标签' : '全部' }}</option>
          <option v-if="tagFilter && !tagCandidates.includes(tagFilter)" :value="tagFilter">{{ tagFilter }}</option>
          <option v-for="tag in tagCandidates" :key="tag" :value="tag">{{ tag }}</option>
        </select>
      </label>
      <!-- 「≤」不是「<」：后端 count 的语义含等于（2026-09-20 实测，count=5 的结果里有 47 行正好是 5） -->
      <label class="sov-fl-count"><span class="sov-label-text">数据量 ≤</span>
        <input
          v-model="dataCountMax"
          type="number"
          min="0"
          step="1"
          class="sov-num"
          data-testid="source-overview-count"
          :placeholder="crossSite ? '数据量 ≤' : '如 5'"
          @keyup.enter="search"
        />
      </label>
      <div class="sov-filter-actions" data-testid="source-overview-actions">
        <button class="sov-btn primary" type="button" data-testid="source-overview-search" @click="search">查询</button>
        <button class="sov-btn" type="button" @click="clearFilters">清空</button>
        <template v-if="!crossSite">
          <button class="sov-btn primary" type="button" data-testid="source-launch" @click="openLaunch">发任务</button>
          <button class="sov-btn" type="button" data-testid="source-export" title="按当前查询条件导出全部命中的源，不是当前页或勾选项" @click="exportSources">导出</button>
        </template>
        <!-- 采集资产源列表视图把「视图切换 / 刷新」放在这里，与筛选并成一条栏（网站详情不传） -->
        <slot name="filter-extra" />
      </div>
    </div>

    <div class="sov-summary">
      <span>共 {{ total }} 个源</span>
      <span v-if="urlFallback && !loading" class="sov-url-fallback" data-testid="source-overview-url-fallback">
        按名称没查到「{{ urlFallback.keyword }}」，<button type="button" class="sov-link" @click="useUrlFallback">改按 URL 查</button>
      </span>
      <span v-if="collectProgress" class="sov-progress" data-testid="source-collect-progress">{{ collectProgress }}</span>
      <button v-if="failedBatches.length" class="sov-btn" type="button" data-testid="source-retry-failed" @click="retryFailedBatches">重试失败批次（{{ failedBatches.reduce((n, b) => n + b.ids.length, 0) }}）</button>
      <template v-if="selectMode">
        <span class="sov-batch-count" data-testid="source-batch-count">已选 {{ selectedIds.length }}</span>
        <slot name="selection-actions" :ids="selectedIds" />
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
      <!-- 紧凑样式下筛选栏一行放不下，针对整批结果的两个操作挪到这一行右侧 -->
      <span v-if="crossSite" class="sov-summary-ops">
        <!-- 1008-04 来源组操作：不勾选也能用（调整来源组按当前筛选范围，连生产时除外；另两项需先勾选） -->
        <el-dropdown v-if="groupOps" trigger="click" data-testid="source-group-ops" @command="onGroupOpsCommand">
          <button class="sov-btn" type="button">选中来源 ▾</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="flow-config" data-testid="sg-ops-flow-config">源流程配置（勾选 1 个）</el-dropdown-item>
              <el-dropdown-item command="adjust-group" data-testid="sg-ops-adjust-group">{{ rangeAdjustAllowed ? '调整来源组（不勾选 = 按当前筛选范围）' : '调整来源组' }}</el-dropdown-item>
              <el-dropdown-item command="run-once" data-testid="sg-ops-run-once">指定流程运行一次</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="sov-btn primary" type="button" data-testid="source-launch" @click="openLaunch">发任务</button>
        <button class="sov-btn" type="button" data-testid="source-export" title="按当前查询条件导出全部命中的源，不是当前页或勾选项" @click="exportSources">导出</button>
      </span>
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
            <th class="sov-fav-col" title="收藏"></th>
            <th><button class="sov-sort" :class="sortClass('SOURCE_ID')" type="button" data-testid="sort-source-id" :title="sortLabel('SOURCE_ID')" @click="toggleSort('SOURCE_ID')">源 ID<span class="sov-caret"><i class="sov-caret-up" /><i class="sov-caret-down" /></span></button></th>
            <th>源名称</th>
            <th v-if="extraColumnLabel" data-testid="source-overview-extra-head">{{ extraColumnLabel }}</th>
            <th v-if="crossSite && showCol('site')">所属网站</th>
            <!-- 1008-04 来源组三列：只在源列表视图（groupOps）出现 -->
            <th v-if="crossSite && groupOps && showCol('sourceGroup')">来源组</th>
            <th v-if="crossSite && groupOps && showCol('defaultFlow')">默认流程</th>
            <th v-if="crossSite && groupOps && showCol('flowConfig')">流程配置</th>
            <th v-if="showCol('url')">URL</th><th v-if="showCol('mainTable')">主表</th>
            <th v-if="showCol('tags')">标签</th>
            <th v-if="showCol('dataCount')"><button class="sov-sort" :class="sortClass('DATA_CNT')" type="button" data-testid="sort-data-cnt" :title="sortLabel('DATA_CNT')" @click="toggleSort('DATA_CNT')">数据<span class="sov-caret"><i class="sov-caret-up" /><i class="sov-caret-down" /></span></button></th>
            <th v-if="showCol('newIn')">新入</th><th v-if="showCol('success')">成功</th>
            <th v-if="showCol('lastTask')"><button class="sov-sort" :class="sortClass('LAST_RUN')" type="button" data-testid="sort-last-task" :title="sortLabel('LAST_RUN')" @click="toggleSort('LAST_RUN')">最近任务<span class="sov-caret"><i class="sov-caret-up" /><i class="sov-caret-down" /></span></button></th>
            <th v-if="showCol('lastSuccess')"><button class="sov-sort" :class="sortClass('LAST_SUCCESS')" type="button" data-testid="sort-last-success" :title="sortLabel('LAST_SUCCESS')" @click="toggleSort('LAST_SUCCESS')">最近成功<span class="sov-caret"><i class="sov-caret-up" /><i class="sov-caret-down" /></span></button></th>
            <th v-if="showCol('state')">状态</th><th v-if="showCol('remark')">备注</th>
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
            <!-- 源收藏（0924-08）：与网站收藏同款星标，状态来自 utils/sourceFavorites，
                 采集资产源列表和网站详情源视图共用一份；收藏的源在「我的收藏」页签里看 -->
            <td class="sov-fav-col">
              <button
                class="sov-fav"
                :class="{ on: isFavoriteSource(source.sourceId) }"
                type="button"
                :data-testid="`source-fav-${source.sourceId}`"
                :title="isFavoriteSource(source.sourceId) ? '取消收藏' : '收藏这个源（在采集资产「我的收藏」里看）'"
                :aria-pressed="isFavoriteSource(source.sourceId)"
                :aria-label="isFavoriteSource(source.sourceId) ? '取消收藏' : '收藏'"
                @click="toggleFavoriteSource(source.sourceId)"
              ><el-icon :size="14"><component :is="isFavoriteSource(source.sourceId) ? StarFilled : Star" /></el-icon></button>
            </td>
            <!-- 源 ID 与源名称走同一个入口（2026-09-09）：两列指的是同一个源，
                 名称能点、ID 不能点没有道理——用户拿 ID 认源比拿名称更多（名称长且相似，
                 ID 才是唯一标识）。等宽字体保持 ID 的可读性与列表其它 ID 一致。 -->
            <td><button class="sov-link sov-id-link" type="button" data-testid="source-overview-id-link" :title="`打开源 ${source.sourceId} 的详情`" @click="emit('openSource', source)">{{ source.sourceId }}</button></td>
            <td class="sov-name" :title="source.name"><button class="sov-link sov-source-link" type="button" data-testid="source-overview-source-link" @click="emit('openSource', source)">{{ source.name }}</button></td>
            <td v-if="extraColumnLabel" class="sov-extra"><slot name="extra-cell" :source="source" /></td>
            <td v-if="crossSite && showCol('site')" class="sov-site" :title="siteNameOf(source)">
              <button
                v-if="source.siteId && source.siteId !== '0'"
                class="sov-link"
                type="button"
                data-testid="source-overview-site-link"
                @click="emit('openSite', source.siteId)"
              >{{ siteNameOf(source) }}</button>
              <span v-else class="sov-muted">未关联</span>
            </td>
            <!-- 1008-04 来源组三列：来源组（点组名跳来源组页签）/ 默认流程（点开流程节点）/ 流程配置（组统一 / 单源，点开源流程配置抽屉） -->
            <td v-if="crossSite && groupOps && showCol('sourceGroup')" class="sov-group" :title="sourceGroupNameOf(source)">
              <button
                v-if="source.sourceGroupId"
                class="sov-link"
                type="button"
                data-testid="source-overview-group-link"
                @click="emit('openSourceGroup', source.sourceGroupId)"
              >{{ sourceGroupNameOf(source) }}</button>
              <span v-else class="sov-muted">—</span>
            </td>
            <td v-if="crossSite && groupOps && showCol('defaultFlow')" class="sov-default-flow">
              <button
                v-if="source.defaultFlowId"
                class="sov-link"
                type="button"
                data-testid="source-overview-default-flow"
                :title="`打开流程 ${source.defaultFlowId}`"
                @click="openFlowNode(source.defaultFlowId)"
              >{{ flowNameOf(source.defaultFlowId) }}</button>
              <span v-else class="sov-muted">—</span>
            </td>
            <td v-if="crossSite && groupOps && showCol('flowConfig')" class="sov-flow-config">
              <button
                class="sov-link"
                type="button"
                data-testid="source-overview-flow-config"
                @click="openFlowConfigForSource(source)"
              >{{ source.sourceGroupId ? '组统一' : '单源' }}</button>
            </td>
            <td v-if="showCol('url')" class="sov-url" :title="source.url">
              <!-- 没有 URL 就留空，不画「—」（2026-09-28 用户定，与旧平台一致） -->
              <a v-if="source.url" :href="source.url" target="_blank" rel="noopener noreferrer" @click.stop>{{ source.url }}</a>
            </td>
            <td v-if="showCol('mainTable')">
              <button
                v-if="source.mainTable"
                class="sov-link"
                type="button"
                data-testid="source-overview-main-table"
                :title="`查看表 ${source.mainTable} 结构`"
                @click.stop="openMainTable(source.mainTable)"
              >{{ source.mainTable }}</button>
              <template v-else>—</template>
            </td>
            <td v-if="showCol('tags')">
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
            <td v-if="showCol('dataCount')">
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
            <td v-if="showCol('newIn')" :title="source.lastInsertAt || ''">{{ timeAgo(source.lastInsertAt) }}</td>
            <td v-if="showCol('success')" :title="source.lastSuccessAt || ''">{{ timeAgo(source.lastSuccessAt) }}</td>
            <td v-if="showCol('lastTask')">{{ source.lastTaskAt || '—' }}</td>
            <td v-if="showCol('lastSuccess')">{{ source.lastSuccessAt || '—' }}</td>
            <td v-if="showCol('state')"><span class="sov-state" :class="{ error: source.state === 'E' && !source.disabled, muted: source.disabled }">{{ sourceState(source) }}</span></td>
            <td v-if="showCol('remark')">
              <button
                class="sov-remark sov-cell-edit"
                type="button"
                data-testid="source-remark-edit"
                :title="source.remark || '编辑标签与备注'"
                @click="openMarkEditor(source)"
              >{{ source.remark || '—' }}</button>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length"><td :colspan="(crossSite ? 15 : 14) + (crossSite && groupOps ? 3 : 0) - hiddenColumnCount + (extraColumnLabel ? 1 : 0)" class="sov-empty">{{ loadError || (scopeEmpty && scopeEmptyText) || '暂无符合条件的源' }}</td></tr>
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
    <!-- 1008-04 来源组批量操作弹窗 / 抽屉 -->
    <SourceFlowConfigDrawer
      v-if="flowConfigOpen && flowConfigSource"
      :source="flowConfigSource"
      :flows="flowOptions"
      @close="flowConfigOpen = false; flowConfigSource = null"
      @saved="onGroupOpsChanged"
      @open-group="emit('openSourceGroup', $event)"
    />
    <AdjustSourceGroupDialog
      v-if="adjustGroupOpen"
      :selected-sources="selectedSources"
      :query="currentQuery()"
      :has-query-filter="hasQueryFilter"
      :range-blocked="!!scopeViewCategoryId"
      :query-text="describeFilters(currentQuery())"
      :groups="sourceGroupOptions"
      @close="adjustGroupOpen = false"
      @saved="onGroupOpsChanged"
    />
    <RunOnceDialog
      v-if="runOnceOpen"
      :source-ids="selectedIds"
      :flows="flowOptions"
      @close="runOnceOpen = false"
    />
    <FlowDetailDrawer v-if="flowDetail" :flow="flowDetail" @close="flowDetail = null" />
    <TableDetailDialog v-model="mainTableOpen" :table-meta="mainTableMeta" />
  </section>
</template>

<style scoped>
.sov-shell { display: flex; flex: 1; min-height: 0; flex-direction: column; padding: 12px; background: #f8fafc; gap: 10px; }
.sov-filter { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.sov-filter label, .sov-filter .sov-field { display: grid; gap: 4px; color: var(--rc-muted); font-size: 11px; }
.sov-filter input, .sov-filter select { height: 30px; min-width: 116px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; color: var(--rc-text); background: #fff; font-size: 12px; }
.sov-filter input:focus, .sov-filter select:focus { outline: 0; border-color: #60a5fa; box-shadow: 0 0 0 2px #dbeafe; }
.sov-filter input:disabled { background: #f4f6f9; color: var(--rc-faint); cursor: not-allowed; }
/* 查询那格：一行一个条件（字段 + 条件 + 值 + ×/+），多个条件往下叠 */
.sov-conds { display: grid; gap: 6px; }
.sov-search { display: flex; align-items: center; gap: 4px; }
.sov-filter .sov-search select { min-width: 88px; }
.sov-filter .sov-search select.sov-op { min-width: 0; width: 72px; }
.sov-filter .sov-search input { min-width: 190px; }
.sov-cond-btn {
  flex: none; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%;
  background: transparent; color: var(--rc-muted); font-size: 15px; line-height: 22px; cursor: pointer;
}
.sov-cond-btn:hover { background: #e2e8f0; color: var(--rc-text); }
.sov-cond-btn.add { color: var(--rc-primary); font-weight: 700; }
.sov-cond-btn.add:hover { background: var(--rc-primary-bg); }
/* 数字框不需要和文本框一样宽：一行已经很挤（源 ID / 名称 / URL / 状态 / 标签 / 备注 / 数据量） */
.sov-filter input.sov-num { min-width: 84px; width: 84px; }
/* ---- 紧凑样式（采集资产源列表视图）：外观对齐同页 FilterToolbar 的网站查询工具条 ---- */
.sov-filter.is-compact {
  /* 一行（用户 2026-10-12 定，不要换行）。1366 宽度下可用 1110px：基准宽度合计约 1050，更窄时各控件按比例压缩，
     但每个控件都有下限（label 的 min-width: auto 把下限传给里面的下拉 / 输入框），压到下限就不再压，不会重叠 */
  flex-wrap: nowrap; align-items: center; gap: 8px; min-height: 52px; padding: 8px 12px;
  border: 1px solid var(--rc-border); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}
.sov-filter.is-compact .sov-label-text { display: none; }
/* 每个筛选项：label 带「基准宽度 + 压缩下限」，里面的下拉 / 输入框跟着 label 走（width: 100%）。
   不能给下拉 / 输入框自己设固定宽度——固定宽度会把 label 的最小尺寸撑死，窄屏下压不动就重叠 */
.sov-filter.is-compact label { display: flex; flex: 0 1 auto; min-width: 0; }
.sov-filter.is-compact label select, .sov-filter.is-compact label input { width: 100%; }
/* 查询那格：字段 84 + 条件 64 + 输入框下限 120 + 「+」22 + 间距 12，再留 8 的余量（1280 实测 306 时「+」会碰到右边的网站下拉） */
.sov-filter.is-compact .sov-field { display: flex; flex: 0 1 342px; min-width: 314px; }
/* 条件网格要跟着外框缩，否则里面的「+」会伸到右边的下拉上 */
.sov-filter.is-compact .sov-conds { flex: 1 1 auto; min-width: 0; grid-template-columns: minmax(0, 1fr); }
.sov-filter.is-compact input,
.sov-filter.is-compact select {
  height: 34px; min-width: 0; border-color: var(--rc-border); border-radius: 6px; font-size: 13px;
}
.sov-filter.is-compact input:hover,
.sov-filter.is-compact select:hover { border-color: #bfdbfe; }
/* 各控件基准宽 + 压缩下限：放不下时先压搜索框，其余守住能读全的宽度 */
.sov-filter.is-compact .sov-search { flex-wrap: nowrap; flex: 1 1 auto; }
.sov-filter.is-compact .sov-search select { width: 84px; flex: none; }
.sov-filter.is-compact .sov-search select.sov-op { width: 64px; }
.sov-filter.is-compact .sov-search input { width: 160px; flex: 1 1 160px; min-width: 120px; }
/* 基准宽 / 下限（下限刚好读全：「全部网站」约 88px） */
.sov-filter.is-compact .sov-fl-site { flex-basis: 108px; min-width: 88px; }
.sov-filter.is-compact .sov-fl-group { flex-basis: 108px; min-width: 94px; }
.sov-filter.is-compact .sov-fl-state { flex-basis: 92px; min-width: 84px; }
.sov-filter.is-compact .sov-fl-tag { flex-basis: 96px; min-width: 84px; }
.sov-filter.is-compact .sov-fl-count { flex-basis: 80px; min-width: 76px; }
.sov-filter.is-compact .sov-filter-actions { flex-wrap: nowrap; flex: none; }
.sov-summary-ops { display: inline-flex; gap: 8px; margin-left: auto; }
.sov-filter-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; }
.sov-btn { height: 30px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-text-2); cursor: pointer; font-size: 12px; font-weight: 600; }

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
.sov-extra { max-width: 260px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-text-2); font-size: 12px; }
.sov-source-link { display: block; max-width: 190px; overflow: hidden; padding: 0; text-align: left; text-overflow: ellipsis; }
.sov-url { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--rc-primary) !important; }
.sov-url a { color: inherit; text-decoration: none; }
.sov-url a:hover { text-decoration: underline; }
.sov-site { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sov-muted { color: var(--rc-faint); }
.sov-url-fallback { color: var(--rc-muted); }
.sov-empty { padding: 42px !important; text-align: center !important; color: var(--rc-faint) !important; }
.sov-check-col { width: 34px; text-align: center; }
.sov-check-col input { cursor: pointer; accent-color: var(--rc-primary); margin: 0; }
.sov-table .sov-fav-col { width: 26px; padding-left: 0; padding-right: 0; text-align: center; }
.sov-fav { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--rc-faint); cursor: pointer; }
.sov-fav:hover { color: var(--rc-text-2); background: var(--rc-primary-bg); }
.sov-fav.on { color: #f59e0b; }
.sov-fav.on:hover { color: #d97706; }
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
/* 可排序表头：照 el-table 的 .caret-wrapper / .sort-caret 画上下两个小三角，文字不变色，
   只有当前方向的三角用主色——与 el-table sortable 列及流程中心一致。 */
.sov-sort { display: inline-flex; align-items: center; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; }
.sov-caret { position: relative; display: inline-flex; flex-direction: column; align-items: center; width: 24px; height: 14px; vertical-align: middle; }
.sov-caret i { position: absolute; left: 7px; width: 0; height: 0; border: 5px solid transparent; }
.sov-caret .sov-caret-up { top: -5px; border-bottom-color: var(--el-text-color-placeholder, #a8abb2); }
.sov-caret .sov-caret-down { bottom: -3px; border-top-color: var(--el-text-color-placeholder, #a8abb2); }
.sov-sort.ascending .sov-caret .sov-caret-up { border-bottom-color: var(--el-color-primary, #409eff); }
.sov-sort.descending .sov-caret .sov-caret-down { border-top-color: var(--el-color-primary, #409eff); }
.sov-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
</style>
