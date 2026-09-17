<script setup lang="ts">
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import { rememberSqlCondition } from '@/utils/sqlConditionHistory'
// 网站数据视图（0812 计划 M2-4/M2-5A + M2-3 交互纠偏，2026-08-14 第三次修正）。
// 方案 §5.2/§6.5：全部源＝按表筛选，具体源＝按节点筛选，"页面任何时刻只展示表筛选或
// 节点筛选中的一种"——但用户明确要求两种状态必须是"同一套"查询视图，只是可编辑字段
// （选表 vs 选节点、是否有执行按钮）不同，不能做成切换时跳到另一个看起来不一样的组件
// （之前 SourceNodeDataView.vue 独立组件的做法太割裂，已合并回本文件）。
//
// 分页也统一成一套：全部源本来就是前端按源逐个查、拼在一起做"加载更多"（旧接口
// entry/entryDataPaged 的 sourceId 是 Long 单值，不支持一次查整个网站，见方案 §6.2.1 R1，
// 未来后端补齐网站维度查询接口后页面表现不应该变——所以现在就不能让具体源用另一套
// "总数+上一页/下一页"）；具体源退化成 candidateSourceIds 只有一个元素的归并，天然复用同一套
// initMergeState/mergeLoadMore，不再维护单独的 total/page。
//
// 具体源下的"节点"来自本组件本地状态（不碰全局 useFlowStore() 单例，那是主画布正在编辑的
// 对象）：并行拉 sourceDetail/sourceSteps/flowLoad，口径跟 sourceStore.loadFromSource 一致
// （有已保存 FlowDef 优先用它，否则用纯函数 buildSourceSeed 按步骤拼默认骨架）。节点选择用
// 跟"选表"一样的纯下拉（不复用流程画布的节点链路图/ProcessNodeRail，那是流程编排视角，这里
// 只是顺手看一眼具体源的数据）。
//
// 这里默认是查看；0831 X6：具体源 + 当前表就是发后续那张表时，可以勾行发任务。
// 全部源+选表仍只读（无法确定流程节点）。发起抓取 / 输入输出切换仍在 ResultView。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dataApi, parseNextStepReceipt, siteApi, sourceApi, type DataTableMeta, type DataRow, type Source, type EntryDetail, type RowQuery, type Step } from '@/api'
import {
  buildHorizontalLayout, buildSourceSeed, effectiveInputTable, firstRunnableNodeId, nodeOutputTable, isDecision, isParallel,
  hasDirectSuccessor, directSuccessorIds, directPredecessorIds, type NodeConfig, type BranchSeed, type FlowBranchGroup,
} from '@/views/FlowCanvas/canvas/flowModel'
import { nextStepColumns } from '@/utils/flow/nextStepFields'
import { fetchNextStepConfig } from '@/utils/flow/nextStepConfig'
import { confirmDanger } from '@/utils/confirmDanger'
import SummaryDrawer from '@/components/data/SummaryDrawer.vue'
import DataGrid from './DataGrid.vue'
import SnatchLauncher from '@/views/FlowCanvas/source/SnatchLauncher.vue'
import FilePreview from './components/FilePreview.vue'
import { backTraceSources } from '@/utils/data/backTraceSources'
import { useWorkspaceStore } from '@/stores/workspace'
import { extFromName } from '@/utils/ossFile'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { readRailOpen, writeRailOpen } from './railPref'
import { APPEND_SIZE_OPTIONS, readAppendSize, writeAppendSize } from './pageSizePref'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'
import SiteTableSelect from './components/SiteTableSelect.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import { initMergeState, mergeLoadMore, type MergeLoadMoreResult, type MergeOrder, type MergeSourceState } from './siteDataMerge'
import RowDetailFields from './RowDetailFields.vue'
import { fieldsFromShowItems, fieldsFromTableMeta } from './rowDetailFields'
import { readFieldPreset, readShowEmpty, visibleDetailProps, writeFieldPreset, writeShowEmpty, type RowFieldPreset } from './rowDetailPrefs'
import { copyToClipboard } from '@/utils/clipboard'

function copyText(val: string, label?: string) {
  void copyToClipboard(val, label)
}

/** 单源视图「按条件查源 →」带过来的数据条件（0903 Y2-7），由 SiteDetailView 从路由解析 */
export interface SiteDataInitialCondition {
  tableId: string
  sql?: string
  state?: string
  dataId?: string
  parentId?: string
}
const props = defineProps<{ siteId: string; initialCondition?: SiteDataInitialCondition | null }>()
const router = useRouter()
// 0915-03 起，页签/快照/待应用条件都要用到它，声明必须早于第一个使用点
// （原来在文件中段，钻取相关的函数在它前面，immediate watch 里调会撞 TDZ）
const ws = useWorkspaceStore()

// 本视图与具体源结果视图（ResultView.vue）长得几乎一样——都是流程图选节点 + 数据表格——
// 但能力不同：这里是纯查看，发起抓取/发后续/输入输出切换都在那边。2026-08-20 拍板保持
// 这个分工（不合并、不改成"选中源即跳转"），代价是必须让用户看得出差别，否则会困惑
// "为什么这里不能发任务"。于是给一个明确的只读标识 + 一个去那边的入口。
function openSourceView() {
  if (!selectedSourceId.value) return
  void router.push({ path: '/canvas', query: { siteId: props.siteId, sourceId: selectedSourceId.value, view: 'data' } })
}

// ---- 钻取闭环（0915-03）----
// 会上原话：「最好方法就跟他打开网站一样，这个源就是一个网站。我点这个源，就像开一个网页标签」
// ——点数据行里的源，在**当前页**开一个源页签、把查询条件一起带过去；看完点回「全部」页签，
// 这边的表和条件原样还在。在此之前这条动线是「按条件查源 → 点源 → 跳走 → 回来重查一遍」。

/** 当前查询条件的指纹：换了表或任一条件，收窄出来的命中源名单就不再成立。 */
const conditionKey = computed(() => [
  effectiveTableId.value, filters.sql, filters.state, filters.dataId, filters.parentId,
].join('|'))

/** 把「全部」这边的现场存进网站页签快照，供点回来时复现。 */
function saveSiteScene(narrowed?: { sourceIds: string[]; totalHits: number | null }) {
  ws.saveSiteSnapshot(props.siteId, {
    view: 'data',
    tableId: tableId.value,
    filters: { ...filters },
    // 命中源名单太长就不存：sessionStorage 每次写入都要整份序列化，几千个 ID 不值得；
    // 而且那种规模基本等于全站，收窄本来也没省下什么。
    ...(narrowed && narrowed.sourceIds.length <= NARROWED_CACHE_MAX
      ? { narrowed: { key: conditionKey.value, ...narrowed } }
      : {}),
  })
}
const NARROWED_CACHE_MAX = 2000

function onSourceClick(row: DataRow) {
  const sourceId = row.sourceId
  if (!sourceId) return
  const name = sourceNames.value[sourceId] || sourceId
  // 条件走 store 不走 URL：源→源切换时旧实例会先收到路由变化、填完条件顺手把 query 抹掉，
  // 表现为"点第一个源好使，点第二个条件就没了"（见 workspace.ts pendingSourceCondition 的注释）。
  // 接收端 ResultView 已实现 takePendingSourceCondition()，这边只负责放进去。
  ws.setPendingSourceCondition({
    tableId: effectiveTableId.value,
    sql: filters.sql || undefined,
    state: filters.state || undefined,
    dataId: filters.dataId || undefined,
    parentId: filters.parentId || undefined,
  })
  saveSiteScene()
  if (!ws.open(sourceId, name)) {
    ElMessage.warning('页签已达上限（8 个），请先关闭部分页签再打开新的源')
  }
  void router.push({ path: '/canvas', query: { siteId: props.siteId, sourceId, view: 'data' } })
}

/** 点回「全部」页签时复现上次的表与条件（数据行不恢复，按条件重查首屏）。 */
const sceneRestored = ref(false)
function restoreSiteScene(): boolean {
  const snap = ws.siteSnapshotOf(props.siteId)
  if (!snap?.tableId) return false
  tableId.value = snap.tableId
  selectedSourceId.value = ''
  if (snap.filters) Object.assign(filters, snap.filters)
  sceneRestored.value = true
  return true
}

// 每个源向后端要多少条（固定）。0910 会议把「每次加载条数」做成可选之后，这个值刻意
// 不跟着用户的选择走：用户选 100 是想"一屏多看点"，若透传成"每源每页取 100 条"，
// 源多的网站请求体积和内存直接翻五倍，反而更卡。两件事在此拆开。
/**
 * 列头排序（2026-09-11）。此前这个视图**根本没接** DataGrid 的 sort-change——列头照常
 * 画着 ↕、点了却毫无反应，而隔壁具体源视图是好的，纯属漏接。
 *
 * 只开放 ENTRY_ID 一列：这里是多源 top-K 归并，归并键固定取 dataId(=ENTRY_ID)，
 * 只有按它排出来的全局顺序才是真的。若放开业务列，后端会按该列排、前端却仍按 dataId
 * 弹出，结果是"每个源内部排好了、合起来还是乱的"——比现在点了没反应更糟，
 * 因为它看着像生效了。要支持任意列得先改造归并键，那是另一件事。
 */
// 白名单按**内容是不是纯数字**来定，不是按 meta 的 type——实测 type 全是 'string'，
// 连 K7「正文大小」(值 "2979") 也是，完全不可用。
// 这里只收确定为数值的列：三个身份列 + 正文大小/文件大小。
// **不要往里加日期列**（K3 '2025-07-30'）：后端 `(K3+0)` 只取前导数字，排出来是按年份，
// 同年的几万条内部全乱——界面上却看着像排好了，比不排更坏。文本列同理，全部得 0。
// prop 与物理列名都认：白名单写 content_size，而 emit/归并用的是 K7。
const SORTABLE_PROPS = ['ENTRY_ID', 'PARENT_ID', 'SOURCE_ID', 'content_size', 'filesize']
//
// ⚠️ 一个继承下来的限制，排序只是让它更显眼：**归并只在"已激活的源池"内有序**。
// 源是分批进池的（SOURCE_SCAN_BATCH 每轮 20 个），所以首屏排出来的是这 20 个源里的
// 前 N 条，不是全网站的前 N 条；继续往下加载、后面的源进池后，可能出现比前面更小/更大的值。
// 2026-09-11 实测：按 SOURCE_ID 升序，首屏第一条是 430016944，而网站里存在更小的
// 430016928——它那时还没进池。
//
// 按 ENTRY_ID 排时这个偏差不明显（ENTRY_ID 全局递增、各源分布均匀），换成业务列就看得出来。
// 根治要等后端支持按网站维度查询（见本文件顶部 §6.2.1 R1 的说明），那之后整套归并都可以删掉；
// 在此之前不要试图用"先扫完所有源再排"来修——6496 个源全扫一遍是几百个串行请求。
const sortField = ref('ENTRY_ID')
const sortOrder = ref<MergeOrder>('descend')
function onSortChange(field: string, order: 'ascend' | 'descend' | '') {
  // DataGrid 走的是三态循环（升 → 降 → 取消），但归并视图**没有"不排序"这一态**：
  // 归并每弹一条都要比较归并键，方向必须确定。所以这里把三态压成两态——
  // 收到"取消"就翻到另一个方向。
  //
  // 不这么做的话点列头会原地打转：sortField 固定是 ENTRY_ID、初始又是降序，
  // DataGrid 那边一算就落进第三态发出 ('', '')，若把它当成"回到默认降序"，
  // 就永远切不到升序（2026-09-11 实测，先前版本正是这个毛病）。
  if (order === 'ascend' || order === 'descend') {
    sortField.value = field
    sortOrder.value = order
  } else {
    // 取消态：同一列翻方向（换列时 DataGrid 会直接给 ascend，走不到这里）
    sortOrder.value = sortOrder.value === 'descend' ? 'ascend' : 'descend'
  }
  void resetAndLoad()
}

const SOURCE_PAGE_SIZE = 20
// 表格每次追加多少行（用户可选，见 pageSizePref.ts）。改动只影响下一次加载，
// 不重置已经加载出来的行——用户是滚到一半才嫌慢/嫌少的，清空重来等于惩罚他。
const appendSize = ref(readAppendSize())
function onAppendSizeChange(size: number) {
  appendSize.value = size
  writeAppendSize(size)
}
const MAX_PARALLEL_REQUESTS = 4
// 全部源首屏若一次激活全部候选源，top-K 归并必须等数百/数千个首屏请求全部返回才展示。
// 每次只把一小批源加入归并，先给出可用数据；滚动/“加载更多”时继续扫描后续源。
const SOURCE_SCAN_BATCH = 20

// 全屏（参考 ResultView.vue 的具体源数据视图）：整个面板 position:fixed 铺满视口，不复制
// 模板、不引入弹层。轨道在全屏下不做任何自动折叠——它是唯一的节点选择器，藏起来就没法
// 切节点了（0819 N1-2，ResultView 那边也已按同一口径去掉了自动收起）。
const fullscreen = ref(false)
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKeydown)
  stopSlowTimer()
})

const tableId = ref('')
const selectedSourceId = ref('')
const meta = ref<DataTableMeta | null>(null)
const metaError = ref('')
const queryFields = computed(() => {
  const dynamic = meta.value?.fields ?? []
  const systemCols = [
    { prop: 'ENTRY_ID', columnName: 'ENTRY_ID', desc: '主键 ID', type: 'string' },
    { prop: 'PARENT_ID', columnName: 'PARENT_ID', desc: '父行 ID', type: 'string' },
    { prop: 'SOURCE_ID', columnName: 'SOURCE_ID', desc: '所属源 ID', type: 'string' },
    { prop: 'UPDATE_DT', columnName: 'UPDATE_DT', desc: '更新时间', type: 'string' },
    { prop: 'CREATE_DT', columnName: 'CREATE_DT', desc: '创建时间', type: 'string' },
  ]
  return [...systemCols, ...dynamic]
})
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })

const rows = ref<DataRow[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const dataError = ref('')
const failedSources = ref<MergeLoadMoreResult<DataRow>['failedSources']>([])
const allExhausted = ref(false)
const noCandidateSources = ref(false)
/**
 * 当前条件命中的总条数（2026-09-09）。`null` = 这次查询没有这个数（没带条件、或收窄失败）。
 *
 * 归并视图是逐源懒加载的，自己永远算不出总量，表头一直只有「已加载 N 条」——那是加载进度，
 * 用户问的"一共多少条"看不到（旧平台分页器上的「共 7030 条」）。这个数从收窄那步的
 * summaryEntryData 分组计数求和而来，不额外发请求。
 */
const totalHits = ref<number | null>(null)
/** 总数正在后台算。用于区分「还没算出来」和「算不出来」——两者都没有数字，但一个该等一个别等。 */
const totalHitsLoading = ref(false)

/**
 * 后台补算总条数：把源集合分片写进条件问 summaryEntryData，各组 CNT 求和。
 * 与 loadData 共用 requestId 防竞态——切表/改条件后旧的那轮算完也不该再写进来。
 */
async function computeTotalHits(reqId: number, sourceIds: string[]) {
  if (!sourceIds.length) return
  totalHitsLoading.value = true
  try {
    const r = await backTraceSources(buildSummaryQuery(), sourceIds)
    if (reqId !== requestId) return
    totalHits.value = [...r.hitCountBySource.values()].reduce((a, b) => a + b, 0)
  } catch {
    // 算不出来就不显示，不拿个错数字糊弄；数据本身照常展示
    if (reqId === requestId) totalHits.value = null
  } finally {
    if (reqId === requestId) totalHitsLoading.value = false
  }
}

const siteChildren = ref<Source[]>([])
const sourceNames = computed<Record<string, string>>(() => Object.fromEntries(siteChildren.value.map((s) => [s.sourceId, s.name])))
// 具体源下 DataGrid「所属源」列改叫「所属节点」：每行本来就是同一个已选源，展示节点名字
// 而不是源名字，才不会看着像跨源归并。
const gridSourceNames = computed<Record<string, string>>(() => (selectedSourceId.value
  ? { [selectedSourceId.value]: selectedCfg.value?.title || selectedNodeId.value }
  : sourceNames.value))

let mergeStates: MergeSourceState[] = []
let candidateSourceIds: string[] = []
let candidateCursor = 0
let requestId = 0

// ---------- 具体源：本地流程数据 + 节点选择（不碰全局 useFlowStore()） ----------
interface LocalFlowData { main: string[]; branches: BranchSeed[]; configs: Record<string, NodeConfig>; branchGroups: FlowBranchGroup[] }
const flowData = ref<LocalFlowData | null>(null)
const flowLoading = ref(false)
const flowLoadError = ref('')

async function loadFlowData(sourceId: string) {
  flowLoading.value = true
  flowLoadError.value = ''
  flowData.value = null
  try {
    // 不再读 flowApi.flowLoad 的本地草稿：没有真实后端对应物，画布保存过一次就会
    // 一直挡住这里的真实拓扑展示，见 FlowCanvas/index.vue 的同一处修复说明。
    const [source, steps] = await Promise.all([
      sourceApi.sourceDetail(sourceId),
      sourceApi.sourceSteps(sourceId),
    ])
    if (sourceId !== selectedSourceId.value) return
    if (!source) {
      flowLoadError.value = '源不存在或加载失败'
      return
    }
    flowData.value = { ...buildSourceSeed(source, steps ?? []), branchGroups: [] }
  } catch {
    if (sourceId !== selectedSourceId.value) return
    flowLoadError.value = '流程加载失败，请重试'
  } finally {
    if (sourceId === selectedSourceId.value) flowLoading.value = false
  }
}

const allNodes = computed(() => (flowData.value
  ? buildHorizontalLayout(flowData.value.main, flowData.value.branches, flowData.value.configs, flowData.value.branchGroups, { includeTerminals: false }).nodes
  : []))
const processLayout = computed(() => (flowData.value
  ? buildHorizontalLayout(flowData.value.main, flowData.value.branches, flowData.value.configs, flowData.value.branchGroups, { includeTerminals: false })
  : null))

const selectedNodeId = ref('')
// 节点选择复用流程图 ProcessNodeRail，与具体源结果视图（ResultView.vue）完全同构
// ——0819 会议 04:33"这个页面不是应该搞成跟单个源一样的效果"、04:47"给我加个流程图"。
// 本文件此前的"用跟选表一样的纯下拉、不复用 ProcessNodeRail"的决定已被该次会议推翻。
// 条件改了但还没查：上一次的结果此刻已经不对应输入框里的条件了。不清理的话表现极具
// 误导性——失败后把输入框清空重打，那条报错和空表格一直挂着不走，看着像"边打字边查还一直报错"
// （2026-08-20 实测，ResultView.vue 同源问题一并修）。
// 从单源数据视图「按条件查源 →」带过来的条件（0903 Y2-7）。
//
// 走 prop 不走 useRoute()：本组件的测试全是裸 shallowMount，没装 router——
// Y2-4 在 SourceOverviewView 上已经踩过一次同样的坑。路由解析留在持有 route 的 SiteDetailView。
// 仍然用 watch 而不是只读初始值：同一棵组件树里换 query 不会重新挂载 setup。
watch(() => props.initialCondition, (cond) => {
  if (!cond?.tableId) {
    // 0915-03：没人从外面带条件进来时，尝试复现上次在「全部」这边的现场
    // （点源页签走开又点回来属于这条路径）。只在本网站的首次进入做一次，
    // 之后不再自动恢复，否则会盖掉用户正在改的筛选。
    if (!sceneRestored.value && restoreSiteScene()) void nextTick(() => runQuery())
    return
  }
  tableId.value = cond.tableId
  selectedSourceId.value = ''   // 反查要看的是"全部源"，不能停在某个具体源上
  filters.sql = cond.sql ?? ''
  filters.state = cond.state ?? ''
  filters.dataId = cond.dataId ?? ''
  filters.parentId = cond.parentId ?? ''
  void nextTick(() => runQuery())
}, { immediate: true, deep: true })

const filtersDirty = ref(false)
watch(() => ({ ...filters }), () => { filtersDirty.value = true })

// 慢查询提示（0819 N3-3）：与 ResultView 同口径。全部源模式还要按源逐个查再归并，
// 更容易慢；超时只提示、不中断，结果仍然会等回来。
const SLOW_QUERY_MS = 8000
const slowQuery = ref(false)
let slowTimer: ReturnType<typeof setTimeout> | undefined
function startSlowTimer() {
  stopSlowTimer()
  slowTimer = setTimeout(() => { slowQuery.value = true }, SLOW_QUERY_MS)
}
function stopSlowTimer() {
  if (slowTimer) clearTimeout(slowTimer)
  slowTimer = undefined
  slowQuery.value = false
}

const railOpen = ref(readRailOpen())
watch(railOpen, writeRailOpen)

const selectedCfg = computed<NodeConfig | undefined>(() => allNodes.value.find((n) => n.id === selectedNodeId.value)?.cfg)
const outputTableId = computed(() => (selectedCfg.value ? nodeOutputTable(selectedCfg.value) : ''))
const inputTableId = computed(() => {
  if (!selectedNodeId.value || !flowData.value) return ''
  return effectiveInputTable(flowData.value.main, flowData.value.branches, flowData.value.configs, selectedNodeId.value, flowData.value.branchGroups)
})
const isStructuralNode = computed(() => !!selectedCfg.value && (isDecision(selectedCfg.value) || isParallel(selectedCfg.value)))
const hasAnyTable = computed(() => !isStructuralNode.value && (!!outputTableId.value || !!inputTableId.value))
// 纯查看，没有输入/输出切换：优先看输出表（节点产出的结果），没有输出表的节点看输入表。
const nodeTableId = computed(() => outputTableId.value || inputTableId.value)
const sameTable = computed(() => !!inputTableId.value && !!outputTableId.value && inputTableId.value === outputTableId.value)
const hasSuccessor = computed(() => {
  if (!selectedNodeId.value || !flowData.value) return false
  return hasDirectSuccessor(flowData.value.main, flowData.value.configs, selectedNodeId.value, flowData.value.branchGroups)
})
const successorTableId = computed(() => {
  if (!selectedNodeId.value || !flowData.value) return ''
  const succIds = directSuccessorIds(flowData.value.main, flowData.value.configs, selectedNodeId.value, flowData.value.branchGroups)
  if (!succIds.length) return ''
  return effectiveInputTable(flowData.value.main, flowData.value.branches, flowData.value.configs, succIds[0], flowData.value.branchGroups) || outputTableId.value
})
// 具体源才开发任务：全部源+选表无法确定流程节点（0831 X6 / Q4）。
// 输入≠输出时这张表是产出数据，跟 ResultView 一样不在这里勾发，请到源数据视图切输入。
const canPickRows = computed(() => !!selectedSourceId.value && hasSuccessor.value && !isStructuralNode.value
  && (sameTable.value || !inputTableId.value || !outputTableId.value))
const selectedRowIds = ref<string[]>([])
const launchDisabledReason = computed(() => {
  if (!selectedSourceId.value) return '选表无法确定流程节点，请先选择具体源'
  if (!canPickRows.value) return hasSuccessor.value ? '输入与输出不是同一张表，请到源数据视图勾选输入行' : '当前节点没有后继，无法发后续'
  if (!selectedRowIds.value.length) return '请先勾选要发送的数据'
  return ''
})
// 两种状态查的是同一套 rows/meta/分页，只是"当前要查哪张表"的来源不同：全部源来自选表，
// 具体源来自选中节点的输出/输入表。
const effectiveTableId = computed(() => (selectedSourceId.value ? nodeTableId.value : tableId.value))

// 流程加载完成后选中**首个**节点（跟 ResultView 一致的默认值，0831 F09 反转了此前的
// 「默认末端」）；不做页签快照恢复——这里是网站数据视图里"顺手看一眼"的轻量入口，
// 不是持久化的编辑页签。
watch(allNodes, (nodes) => {
  if (!nodes.some((n) => n.id === selectedNodeId.value)) {
    selectedNodeId.value = (flowData.value
      ? firstRunnableNodeId(flowData.value.main, flowData.value.configs)
      : '') || nodes[0]?.id || ''
  }
})

function onSelectNode(id: string) {
  if (!id || id === selectedNodeId.value) return
  selectedNodeId.value = id
}

// 默认列收敛（0831 F10），口径与 ResultView 完全一致；这里的流程数据是本组件局部拉的
// flowData，不走全局 useFlowStore()。全部源（选表）态下没有节点上下文，算不出预设，
// 自然退回全部列。
const presetCols = computed(() => (flowData.value
  ? nextStepColumns({
    columns: meta.value?.fields ?? [],
    main: flowData.value.main,
    configs: flowData.value.configs,
    branchGroups: flowData.value.branchGroups,
    nodeId: selectedNodeId.value,
  })
  : []))
// ---------- 全部源 / 具体源共用的查询 + 归并分页 ----------
function inferTableMeta(tableId2: string, dataRows: DataRow[]): DataTableMeta {
  const samples = new Map<string, unknown>()
  dataRows.forEach((row) => {
    Object.entries(row.values ?? {}).forEach(([prop, value]) => {
      if (!samples.has(prop)) samples.set(prop, value)
    })
  })
  return {
    tableId: tableId2,
    tableName: tableId2,
    rowCount: dataRows.length,
    fields: [...samples.entries()].map(([prop, sample]) => ({
      prop,
      type: sample !== null && typeof sample === 'object' ? 'json' : typeof sample === 'number' ? 'number' : 'string',
      desc: prop,
      sample: sample == null ? undefined : String(sample),
    })),
  }
}

async function fetchPage(sourceId: string, page: number, size: number, condition: { tableId: string; sql: string }): Promise<DataRow[]> {
  const result = await dataApi.rowQueryPaged({
    tableId: condition.tableId,
    sourceId,
    dataId: filters.dataId || undefined,
    parentId: filters.parentId || undefined,
    state: filters.state || undefined,
    sql: condition.sql || undefined,
    page,
    size,
    // 排序参数已实测确认真实生效（2026-08-15，测试环境，见计划 §3.2 Q9）：不传/ascend/descend
    // 三次真实调用返回了方向相反的不同批次数据，不是静默忽略。客户端二次排序兜底仍保留
    // （siteDataMerge.ts），但已不再是"建立在未验证假设上"，是多源归并后的防御性再排序。
    sortField: sortField.value,
    // 必须与归并方向一致：归并假设每个源返回的分页本身就按归并键有序（见 siteDataMerge.ts
    // 顶部），后端排一个方向、前端归并另一个方向，弹出来的顺序就是错的。
    sortOrder: sortOrder.value,
  })
  return result.list
}

// 触底自动加载会在滚动中反复触发，必须挡住重入——原先只有按钮触发，点第二下之前
// 上一次早就回来了，没有这个风险（0819 N3-1）。
const autoLoadFailed = ref(false)
async function loadMore() {
  const id = requestId
  if (!candidateSourceIds.length || allExhausted.value || loadingMore.value) return
  autoLoadFailed.value = false
  loadingMore.value = true
  dataError.value = ''
  const condition = { tableId: effectiveTableId.value, sql: filters.sql }
  let queried = false
  try {
    // 具体源一次激活完；全部源每轮最多新增 SOURCE_SCAN_BATCH 个，避免首屏等待所有源。
    const nextCursor = selectedSourceId.value
      ? candidateSourceIds.length
      : Math.min(candidateCursor + SOURCE_SCAN_BATCH, candidateSourceIds.length)
    if (nextCursor > candidateCursor) {
      mergeStates.push(...initMergeState(candidateSourceIds.slice(candidateCursor, nextCursor)))
      candidateCursor = nextCursor
    }
    const result = await mergeLoadMore(mergeStates, appendSize.value, SOURCE_PAGE_SIZE,
      async (sourceId, page, size) => {
        const list = await fetchPage(sourceId, page, size, condition)
        queried = true
        return list
      }, { maxParallel: MAX_PARALLEL_REQUESTS, order: sortOrder.value, sortField: sortField.value })
    if (id !== requestId) return
    if (queried && !result.failedSources.length) rememberSqlCondition(condition.tableId, condition.sql)
    rows.value = [...rows.value, ...result.rows]
    failedSources.value = result.failedSources
    allExhausted.value = candidateCursor >= candidateSourceIds.length && result.allExhausted
    if (!meta.value && rows.value.length) meta.value = inferTableMeta(effectiveTableId.value, rows.value)
    if (result.rows.length === 0 && result.failedSources.length && !result.allExhausted) {
      dataError.value = '本次未能取到新数据，可能是相关源暂时查询失败，请点击“加载更多”重试'
    }
  } catch {
    if (id !== requestId) return
    dataError.value = '数据加载失败，请重试'
    // 失败后停掉自动加载，退回按钮让用户自己决定要不要重试——
    // 否则观察器会在同一个位置反复触发同一个失败请求。
    autoLoadFailed.value = true
  } finally {
    if (id === requestId) loadingMore.value = false
  }
}

async function resetAndLoad() {
  const id = ++requestId
  rows.value = []
  selectedRowIds.value = []
  closeDetail()
  meta.value = null
  metaError.value = ''
  dataError.value = ''
  failedSources.value = []
  allExhausted.value = false
  autoLoadFailed.value = false
  // 换批次时必须显式复位 loadingMore：上一批若还卡在飞行中，它的 finally 会因为
  // requestId 已经变了而跳过复位，标志位就永远停在 true——加了重入保护之后，
  // 这个残留会把新批次的首次加载一起挡掉（切节点后表格空白）。
  loadingMore.value = false
  noCandidateSources.value = false
  mergeStates = []
  candidateSourceIds = []
  candidateCursor = 0
  const tid = effectiveTableId.value
  if (!tid) return
  loading.value = true
  startSlowTimer()
  try {
    if (selectedSourceId.value) {
      // 具体源：候选源集合永远只有它自己，退化成单源归并，复用同一套分页逻辑。
      candidateSourceIds = [selectedSourceId.value]
      totalHits.value = null
      totalHitsLoading.value = false
    } else {
      // 全部源：候选源**只在本网站范围内算**（2026-09-09 定案，用户原话「明确点，肯定是
      // 这个网站下的」）。
      //
      // 原来这里先问 entryDistinctSource「这张表有哪些源的数据」再跟网站源取交集。那个接口
      // 按表和条件搜**全库、不认 siteId**，共用大表下必被上限截断，本网站的源整个排在名单
      // 之外——实测同一条件 size=1000 返 1000、size=5000 返 5000，上限调多大都堵不住。
      // 后果极隐蔽：侧栏反查说命中 276 个源，数据列表只扫了 122 个、凑出 10 条，另外
      // 154 个源的数据凭空消失，页面上没有任何异常提示。
      //
      // 现在两条路都限定在网站的源集合里：
      //   · 带条件：用与「按条件查源」同一套精确收窄（把网站源写进查询条件分片问
      //     summaryEntryData，服务端只在这批源里筛，不存在截断），把候选压到真正命中的那些；
      //   · 不带条件：直接用网站全部源。此时数据密集，归并查询本来就是扫到够一页就停，
      //     不值得为收窄先付一轮请求。
      siteChildren.value = await siteApi.siteSources(props.siteId)
      if (id !== requestId) return
      const siteSourceIds = siteChildren.value.map((s) => s.sourceId)
      const hasCondition = !!(filters.sql || filters.state || filters.dataId || filters.parentId)
      if (hasCondition && siteSourceIds.length) {
        // 0915-03：同一套条件的收窄结果直接复用——6496 个源的网站实测要几十秒，
        // 从源页签点回「全部」每次都重算一遍等于这条动线没法用。指纹一变就照常重算。
        // 命中过缓存就跳过收窄这一步，其余流程（表结构、归并加载）照常走——
        // ⚠️ 不能在这里 return：后面还要 tableMeta，提前返回会让表头列渲染不出来。
        const cached = ws.siteSnapshotOf(props.siteId)?.narrowed
        const hitCache = !!cached && cached.key === conditionKey.value && cached.sourceIds.length > 0
        const exact = hitCache ? null : await backTraceSources(buildSummaryQuery(), siteSourceIds).catch(() => null)
        if (id !== requestId) return
        if (hitCache && cached) {
          candidateSourceIds = cached.sourceIds
          totalHits.value = cached.totalHits
          totalHitsLoading.value = false
        } else {
        // 收窄失败不阻断整体查询，退回网站全部源（请求量更大，但结果仍然正确）
        candidateSourceIds = exact?.sourceIds.length ? exact.sourceIds : siteSourceIds
        // 总数是白捡的（2026-09-09）：收窄用的 summaryEntryData 本来就按 SOURCE_ID 分了组、
        // 每组带 CNT，加起来就是当前条件命中的总条数，不必为它再发一次请求。
        // 归并视图是逐源懒加载的，自己永远算不出总数——在此之前表头只有「已加载 N 条」，
        // 那是加载进度不是总量，旧平台分页器上那个「共 7030 条」一直没迁过来。
        totalHits.value = exact ? [...exact.hitCountBySource.values()].reduce((a, b) => a + b, 0) : null
        totalHitsLoading.value = false
        // 存进网站页签快照，供从源页签点回「全部」时复用（0915-03）
        if (exact?.sourceIds.length) saveSiteScene({ sourceIds: candidateSourceIds, totalHits: totalHits.value })
        }
      } else {
        candidateSourceIds = siteSourceIds
        // 不带条件时没有收窄那一步，总数**另起一轮异步补算**（2026-09-09 修正）。
        // 上一版这里是直接不显示总数，理由是"不值得为一个数字先付一轮请求"——想窄了：
        // 「一共多少条」跟有没有筛选条件无关，进来就该看得到。
        // 放异步是因为分片统计要 ceil(源数/200) 个请求（6496 个源 = 33 个），
        // 同步等会把数据展示也拖住；现在数据先出来，总数算好了再补上。
        totalHits.value = null
        void computeTotalHits(id, siteSourceIds)
      }
    }
    if (!candidateSourceIds.length) {
      noCandidateSources.value = true
      return
    }
    try {
      meta.value = await dataApi.tableMeta(tid)
    } catch {
      meta.value = null
    }
    if (id !== requestId) return
    if (!meta.value) metaError.value = '表结构暂不可用，已根据当前数据生成列'
    await loadMore()
  } finally {
    if (id === requestId) {
      loading.value = false
      filtersDirty.value = false
      stopSlowTimer()
    }
  }
}

watch(effectiveTableId, resetAndLoad)
// 全部源 ⇔ 具体源切换（方案 §6.5 规则 1/3）：两种状态各自的筛选维度不同（表 vs 节点），
// 不带着上一个状态选好的表/节点过去，强制在新状态里重新选；具体源的流程数据只在选中
// 具体源时才加载。
watch(selectedSourceId, (id) => {
  tableId.value = ''
  selectedNodeId.value = ''
  if (id) {
    void loadFlowData(id)
  } else {
    flowData.value = null
    flowLoadError.value = ''
  }
})
watch(() => props.siteId, () => {
  tableId.value = ''
  selectedSourceId.value = ''
  // 每个网站各有各的现场（0915-03）：换网站要重新按新网站的快照恢复一次
  sceneRestored.value = false
  if (restoreSiteScene()) void nextTick(() => runQuery())
})

function runQuery() {
  // 点「查询」就把侧栏的命中态清掉（2026-09-09，用户原话「点击查询后左侧的条件就要去掉了，
  // 不能带着」）：那份名单是**上一次**反查按**当时**条件算出来的快照，条件一改就过期了。
  // 留着它，侧栏显示的源和眼前这批数据对不上，人会以为是查询出了问题。
  ws.clearBackTraceHits()
  void resetAndLoad()
}
function clearFilters() {
  filters.dataId = ''
  filters.parentId = ''
  filters.state = ''
  filters.sql = ''
  runQuery()
}
function failedSourceText({ sourceId, error }: MergeLoadMoreResult<DataRow>['failedSources'][number]): string {
  const name = sourceNames.value[sourceId] || sourceId
  const reason = error.replaceAll(/\s+/g, ' ').slice(0, 120)
  return `${name}（${sourceId}）：${reason}`
}

function showNextStepReceipt(res: { message?: string }) {
  const receipt = parseNextStepReceipt(res?.message || '')
  if (receipt.entries.length === 0) ElMessage.success(res?.message || '操作已提交（演示）')
  else if (receipt.rejectCount > 0 && receipt.okCount === 0) ElMessage.warning(`已提交 ${receipt.submitted} 条，全部被目标节点的进入条件拒绝，未进入下一步`)
  else if (receipt.rejectCount > 0) ElMessage.warning(`已提交 ${receipt.submitted} 条：${receipt.okCount} 条已进入下一步，${receipt.rejectCount} 条被进入条件拒绝`)
  else ElMessage.success(`已提交 ${receipt.submitted} 条，${receipt.okCount} 条已进入下一步`)
}

async function onSendNextStep() {
  if (!canPickRows.value || !effectiveTableId.value || !selectedRowIds.value.length) return
  const groups = new Map<string, string[]>()
  for (const id of selectedRowIds.value) {
    const row = rows.value.find((item) => item.dataId === id)
    const sourceId = row?.sourceId || selectedSourceId.value
    if (!sourceId) continue
    const list = groups.get(sourceId) ?? []
    list.push(id)
    groups.set(sourceId, list)
  }
  await sendNextStepFor(groups, { clearSelection: true })
}

/**
 * 行尾「发后续任务（本行）」（0915-04）：只发这一行，其余与顶部按钮完全一致。
 *
 * 前提跟勾选发送同一个 `canPickRows`——必须已收窄到具体源，否则解析不出后继节点配置
 * （见 sendNextStepFor 里 selectedSourceId 那段）。菜单项本身也受同一个开关控制，
 * 这里再挡一次是防止条件在菜单弹开后变化。
 */
async function onSendRowNextStep(row: DataRow) {
  if (!canPickRows.value || !effectiveTableId.value) return
  const sourceId = row.sourceId || selectedSourceId.value
  if (!sourceId || !row.dataId) return
  await sendNextStepFor(new Map([[sourceId, [row.dataId]]]))
}

/**
 * 发后续任务的唯一实现。`groups` 是 `sourceId → dataId[]`。
 *
 * 顶部按钮传勾选行（可能跨多个源），行尾菜单传单独一行——两者除了数据来源没有任何区别。
 * 后继节点解析、确认文案、回执分组解析都在这里，**不要为行尾再复制一份**：
 * 回执那段尤其不能分叉，后端回的「本次发送 N 条」是提交条数，被目标节点进入条件拒绝的
 * 也算在里面，少解析一次就会把「全部被拒」显示成「全部成功」。
 */
async function sendNextStepFor(groups: Map<string, string[]>, opts: { clearSelection?: boolean } = {}) {
  if (!groups.size) return
  const sourceCount = groups.size
  const rowCount = [...groups.values()].reduce((sum, ids) => sum + ids.length, 0)
  let nextConfigInfo
  if (selectedSourceId.value) {
    const currentFlow = flowData.value
    const fallbackSteps: Step[] = currentFlow
      ? Object.entries(currentFlow.configs).map(([id, cfg]) => ({
          stepId: id,
          sourceId: selectedSourceId.value,
          name: cfg.title,
          configId: cfg.configId,
          inputTable: cfg.collectCfg?.inputTable || cfg.ruleCfg?.inputTableId,
          outputTable: cfg.collectCfg?.outputTable || cfg.ruleCfg?.outputTableId,
          enabled: !cfg.disabled,
          topic: cfg.taskCfg?.queue,
          dependsOn: directPredecessorIds(currentFlow.main, currentFlow.configs, id, currentFlow.branchGroups),
        }))
      : []
    const currentConfigHint = {
      configId: selectedCfg.value?.configId,
      stepId: (selectedCfg.value as any)?.stepId || (/^\d+$/.test(selectedNodeId.value) ? selectedNodeId.value : undefined),
      title: selectedCfg.value?.title,
      queue: selectedCfg.value?.taskCfg?.queue,
    }
    try {
      nextConfigInfo = await fetchNextStepConfig(selectedSourceId.value, selectedNodeId.value, fallbackSteps, currentConfigHint)
    } catch {
      // fallback
    }
    if (nextConfigInfo && !nextConfigInfo.hasNext) {
      ElMessage.warning(nextConfigInfo.reason || '当前节点在流程中没有后续节点配置，无法发后续')
      return
    }
  }
  // 发**整条下游**，不是只发直接后继（2026-09-17 定，与 ResultView 同口径）。
  // 后端实测：传单个 stepId 只发那一个、不会沿链路带下游；传逗号串则按步骤分别派发，
  // 回执自己分组（`本次发送:1 条, 结果:,ok_40598: [1条],ok_41685: [1条]`）。
  // 算不出下游时退回单个后继，保持旧行为。
  const downstreamIds = (nextConfigInfo?.downstreamSteps ?? [])
    .map((step) => String(step.stepId))
    .filter((id) => /^\d+$/.test(id))
  const targetStepIds = downstreamIds.length ? downstreamIds.join(',') : nextConfigInfo?.targetStepId
  // 文案要跟实际发送的范围一致：发整条下游就把下游都列出来
  const downstreamNames = (nextConfigInfo?.downstreamSteps ?? []).map((step) => step.name || step.stepId).filter(Boolean)
  const targetNodeName = (downstreamNames.length ? downstreamNames.join('、') : '')
    || nextConfigInfo?.targetNodeName || selectedCfg.value?.title || selectedNodeId.value
  const tableId = nextConfigInfo?.targetTableId || successorTableId.value || effectiveTableId.value
  const configOptions = {
    configId: nextConfigInfo?.targetConfigId,
    itemConfig: targetStepIds,
    stepId: targetStepIds,
    nextStep: targetStepIds,
  }
  await confirmDanger(
    '发后续任务',
    `将对 ${sourceCount} 个源 · ${rowCount} 条数据发起后续节点「${targetNodeName}」的处理任务，是否继续？`,
    async () => {
      let last: { message?: string } = {}
      for (const [sourceId, ids] of groups) {
        last = await dataApi.nextStep(sourceId, tableId, ids, configOptions)
      }
      // 行尾菜单没用到勾选，别把用户已经勾好的行清掉
      if (opts.clearSelection) selectedRowIds.value = []
      return last
    },
    showNextStepReceipt,
  )
}

function buildSummaryQuery(): RowQuery {
  return {
    tableId: effectiveTableId.value,
    siteId: props.siteId || undefined,
    sourceId: selectedSourceId.value || undefined,
    dataId: filters.dataId || undefined,
    parentId: filters.parentId || undefined,
    state: filters.state || undefined,
    sql: filters.sql || undefined,
  }
}

// 按条件反查源（0903 Y2 / H12 → 0904 I01 改为直达）。
//
// **弹窗那层已经拆掉**：会上原话「那你还不如把这个东西直接放到那个源列表」
// 「你直接反向你不是直接跑两步？」——先弹窗看清单再决定去哪，是多余的一步。
// 现在点一下就把命中的源写进源视图筛选直接落过去，看源、勾选、发任务都用源视图现成的能力。
// 求命中源的算法原样保留在 `utils/data/backTraceSources.ts`（09-04 六轮修复换来的，别重写）。
//
// 复用 buildSummaryQuery——统计和反查问的是同一批数据，条件口径必须一致，不另拼一份。
const backTracing = ref(false)
/**
 * 反查按钮的可用性。
 *
 * **不再要求"必须有条件"**（0904 I01）：产品明确「你不带条件就是查的所有的，
 * 你带条件就是查这个条件下的」——无条件是合法语义，直接进源视图看全部源。
 */
const canBackTrace = computed(() => !!effectiveTableId.value)
/** 反查一次，把命中源交给调用方。无条件 / 空结果都返回 null，由调用方决定怎么提示。 */
async function runBackTrace(): Promise<{ sourceIds: string[]; hitCountBySource: Map<string, number> } | null> {
  const hasCondition = !!(filters.sql || filters.state || filters.dataId || filters.parentId)
  if (!hasCondition) {
    ElMessage.info('先填至少一个数据条件（SQL / 状态 / 数据 ID / 父 ID），再按条件查源')
    return null
  }
  backTracing.value = true
  try {
    const { sourceIds, hitCountBySource } = await backTraceSources(
      buildSummaryQuery(),
      siteChildren.value.map((s) => s.sourceId),
    )
    if (!sourceIds.length) {
      ElMessage.info('当前条件没有命中任何源')
      return null
    }
    return { sourceIds, hitCountBySource }
  } catch (e) {
    ElMessage.error(`反查源失败：${(e as Error)?.message ?? String(e)}`)
    return null
  } finally {
    backTracing.value = false
  }
}

/**
 * 主路径（0909 改）：命中源写进**左侧源侧栏**，人留在数据视图。
 *
 * 原来是 router.push 到源视图。会上原话「就是要再加到左边最好」「因为我点一个源又要进去」
 * ——跳过去只是换了个地方看列表，挨个排查问题源还是得在两个视图之间来回跳。
 * 写侧栏之后，侧栏收窄成命中的这几个源、按命中条数从多到少排，点一个看一个，不用离开。
 */
async function openBackTrace() {
  if (!canBackTrace.value || backTracing.value) return
  const hit = await runBackTrace()
  if (!hit) return
  ws.setBackTraceHits(
    props.siteId,
    hit.sourceIds.map((sourceId) => ({ sourceId, count: hit.hitCountBySource.get(sourceId) ?? 0 })),
    // 条件一并记下：点侧栏某个源进去时要带过去，否则侧栏那个「906 条」跟进去看到的对不上
    {
      tableId: effectiveTableId.value,
      sql: filters.sql || undefined,
      state: filters.state || undefined,
      dataId: filters.dataId || undefined,
      parentId: filters.parentId || undefined,
    },
  )
  ElMessage.success(`命中 ${hit.sourceIds.length} 个源，已填进左侧源列表`)
}

/** 第二条路：仍旧跳源视图。反查完要批量发任务 / 批量改标签时，那边的勾选和批量条更好使。 */
async function openBackTraceInSourceView() {
  if (!canBackTrace.value || backTracing.value) return
  const hit = await runBackTrace()
  if (!hit) return
  // 那边的「源 ID」筛选框本来就收逗号分隔的多个 ID
  void router.push({ path: '/canvas', query: { siteId: props.siteId, view: 'source', sourceIds: hit.sourceIds.join(',') } })
}

const summaryOpen = ref(false)

const detail = reactive<{ visible: boolean; index: number }>({ visible: false, index: -1 })
const detailRow = computed(() => (detail.visible && detail.index >= 0 ? rows.value[detail.index] ?? null : null))
const showEmpty = ref(readShowEmpty())
watch(showEmpty, writeShowEmpty)
const fieldPreset = ref<RowFieldPreset>(readFieldPreset(effectiveTableId.value))
watch(effectiveTableId, (tableId) => { fieldPreset.value = readFieldPreset(tableId) })
watch(fieldPreset, (preset) => writeFieldPreset(effectiveTableId.value, preset))
watch(presetCols, (cols) => {
  if (fieldPreset.value === 'next' && !cols.length) fieldPreset.value = 'filled'
})
const taskInst = reactive<{ visible: boolean; sourceId: string; parentId: string | null }>({ visible: false, sourceId: '', parentId: null })
function closeDetail() {
  detail.visible = false
  detail.index = -1
  closeParentDetail()
}
function openDetailAt(index: number) {
  closeParentDetail()
  if (index < 0 || index >= rows.value.length) return
  detail.index = index
  detail.visible = true
}
function stepDetail(delta: number) {
  openDetailAt(detail.index + delta)
}
function onRowClick(row: DataRow) {
  openDetailAt(rows.value.findIndex((item) => item.dataId === row.dataId))
}
function onRowAction(row: DataRow, cmd: string) {
  if (cmd === 'detail') {
    openDetailAt(rows.value.findIndex((item) => item.dataId === row.dataId))
  } else if (cmd === 'tasks') {
    taskInst.sourceId = row.sourceId
    taskInst.parentId = row.dataId
    taskInst.visible = true
  } else if (cmd === 'row-next-step') {
    void onSendRowNextStep(row)
  } else if (cmd === 'row-launch') {
    void onLaunchRowSource(row)
  }
}

// ---- 0915-04 行尾「对该源发抓取…」----
const snatchLauncher = ref<InstanceType<typeof SnatchLauncher>>()

/**
 * 不能直接发抓取的源：`sourceId → 原因`。
 *
 * 只挡**停用**的源——发了也不会跑。**参数源不挡**：`SnatchLauncher.launch()` 会先 loadParams，
 * 有参数就弹框让人填，单源场景本来就该走这条路（具体源数据视图的「发起抓取」一直是这么做的，
 * 见 ResultView.onSendFetch）。方案 §2.2 里写的「参数源禁用」出自批量发送那套
 * （partitionLaunchTargets 服务的是 LaunchConfirmDialog，一次几百个源没法逐个填参数），
 * 挪到单行上就成了无谓的拦截。
 */
const launchBlocked = computed(() => {
  const map = new Map<string, string>()
  for (const src of siteChildren.value) {
    if (src.disabled) map.set(src.sourceId, `源「${src.name}」已停用，请先启用再发抓取`)
  }
  return map
})

/**
 * 对这一行所属的**整个源**发起抓取。
 *
 * 确认文案必须点明作用域：它和「这一行」没有关系，作用于该源全部数据。
 * 不加 admin 门禁——同页面顶部的「发后续任务」同为写操作、也没有这道门禁，
 * 只在行尾单独加会让同一个页面自相矛盾；写入风险由 confirmDanger 的二次确认兜住。
 */
async function onLaunchRowSource(row: DataRow) {
  const sourceId = row.sourceId || selectedSourceId.value
  if (!sourceId) return
  const blocked = launchBlocked.value.get(sourceId)
  if (blocked) {
    ElMessage.warning(blocked)
    return
  }
  const name = sourceNames.value[sourceId] || sourceId
  await confirmDanger(
    '发起抓取',
    `将对源「${name}」（${sourceId}）发起抓取，作用于该源全部数据，不只是当前这条。是否继续？`,
    async () => snatchLauncher.value?.launch(sourceId, { onSuccess: () => ElMessage.success('已发起抓取') }),
    () => {},
  )
}

// 上游数据下钻（M3-0H）：ResultView.vue 已有的 M3-0B 只落在具体源流程页，网站数据视图
// 这边一直没补——筛选行有「父 ID」输入框能按父 ID 筛，但点不开任何一行的父数据，
// 同一页面内口径不一致。categoryId/parentId 同样早就在 DataRow 里，只是没渲染入口。
const parentDetail = ref<EntryDetail | null>(null)
// 0904 I06：详情抽屉里的「下级数据」面板已删除（Z0-1，与 ResultView 同批）。
// 这个 rowDetail 请求当时只为拿 subs/subsCnt——抽屉字段一直是列表行 + 表 meta 现拼的，
// 面板撤掉后它没有任何消费方，一并删。下钻改走「带条件跳转 + 可返回」。

const parentLoading = ref(false)
const parentError = ref('')
/**
 * 父行所在的表 = **本节点的有效输入表**，不是本行自己的 `categoryId`（2026-09-04 修，与 ResultView 同因）。
 * `categoryId` 是这一行自己在哪张表；同表链路下两者恰好相等，异表链路下拿它去查父行会 500
 * （真实故障：源 430002879 父行在 6200023、子行在 900）。
 */
const parentTableId = computed(() => inputTableId.value || detailRow.value?.categoryId || '')
const canDrillParent = computed(() => !!parentTableId.value && !!detailRow.value?.parentId && detailRow.value.parentId !== '0')
async function openParentDetail() {
  if (!parentTableId.value || !detailRow.value?.parentId) return
  parentLoading.value = true
  parentError.value = ''
  try {
    const res = await dataApi.rowDetail(parentTableId.value, detailRow.value.parentId)
    parentDetail.value = res
    if (!res) parentError.value = '未找到上游数据'
  } catch (error) {
    parentError.value = error instanceof Error ? error.message : '获取上游数据失败'
  } finally {
    parentLoading.value = false
  }
}
function closeParentDetail() {
  parentDetail.value = null
  parentError.value = ''
}
// row.values 的键是旧平台物理列名（K1/K2...），不是 f.prop 这个逻辑字段名（如 "title"）——
// 两者只在 f.columnName 上能对上，直接拿 f.prop 去 row.values 里取永远是 undefined。真实
// bug，2026-08-14 生产环境实测发现：详情弹层每个字段都显示"—"，不是接口没数据，是取错了 key。
const detailFields = computed(() => fieldsFromTableMeta(meta.value?.fields, detailRow.value?.values, detailRow.value))
const parentFields = computed(() => fieldsFromShowItems(parentDetail.value?.showItems, parentDetail.value?.row))
const detailVisibleProps = computed(() => visibleDetailProps(fieldPreset.value, detailFields.value, presetCols.value))

// 单元格里的文件预览（0819 N2-7）：路径类字段点开就地看内容，不用先跳到文件视图再找。
// 用居中 dialog 而不是右侧抽屉——这是"看一眼就关"的操作型短流程，抽屉留给实体详情
// （项目弹层规范）。预览器与文件详情共用一个组件，取数、降级、下载全在里面。
const filePreview = reactive({ visible: false, path: '', name: '', url: '', ext: '' })
// sourceUrl 由 DataGrid 从被点的那一行算好带过来（2026-09-11）。此前是从 detailFields
// 取——那是详情抽屉当前行的字段，直接点单元格时详情没开，于是永远取不到，
// 预览里的「原始地址 ↗」一直不显示。
function onCellFile(path: string, field?: unknown, sourceUrl = '') {
  filePreview.path = path
  filePreview.name = path.split('/').pop() || ''
  filePreview.url = sourceUrl
    || detailFields.value.find((f) => f.prop === 'url')?.href
    || detailFields.value.find((f) => f.href)?.href
    || ''
  const f = field as { prop?: string; columnName?: string; desc?: string } | undefined
  const col = (f?.columnName || '').toUpperCase()
  const prop = (f?.prop || '').toLowerCase()
  const desc = f?.desc || ''
  if (col === 'K17' || prop === 'html' || desc.includes('html')) {
    filePreview.ext = 'html'
  } else if (col === 'K6' || prop.includes('content') || desc.includes('正文')) {
    filePreview.ext = 'txt'
  } else {
    filePreview.ext = ''
  }
  filePreview.visible = true
}
</script>

<template>
  <main class="sdv2-shell" :class="{ 'is-fullscreen': fullscreen }">
    <div class="sdv2-toolbar">
      <SiteSourceSelect v-model="selectedSourceId" :site-id="siteId" />
      <SiteTableSelect v-if="!selectedSourceId" v-model="tableId" :site-id="siteId" />
      <template v-if="effectiveTableId">
        <input v-model="filters.dataId" class="sdv2-input" placeholder="数据 ID" />
        <input v-model="filters.parentId" class="sdv2-input" placeholder="父 ID" />
        <select v-model="filters.state" class="sdv2-input">
          <option value="">状态（全部）</option>
          <option value="C">C 成功</option>
          <option value="E">E 出错</option>
          <option value="L">L 处理中</option>
        </select>
        <SqlConditionEditor v-model="filters.sql" v-slot="{ value, update }" :table-id="effectiveTableId" :table-name="meta?.tableName" :fields="queryFields" class="sdv2-sql">
          <input :value="value" @input="update(($event.target as HTMLInputElement).value)" class="sdv2-input flex" data-testid="data-cond-sql" placeholder="SQL 条件，可点右端漏斗按字段查询（如 K23 = '...'）" />
        </SqlConditionEditor>
        <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
        <button class="rc-btn" type="button" @click="clearFilters">清空</button>
        <!-- 0903 Y2：会上「我不知道有哪些语言……你这个条件能带回去吗？」——筛出脏数据之后，
             得知道这批数据来自哪些源才能整批重发。这是数据条件通向源的唯一一条路。 -->
        <button
          class="rc-btn"
          type="button"
          data-testid="site-data-backtrace"
          :disabled="!canBackTrace || backTracing"
          :title="canBackTrace ? '按当前数据条件反查命中的源，结果填进左侧源列表' : '先选一张表'"
          @click="openBackTrace"
        >{{ backTracing ? '反查中…' : '按条件查源 ←' }}</button>
        <!-- 反查完还想批量发任务 / 批量改标签时，源视图的勾选与批量条仍然有用，
             所以旧的跳转不删，收进下拉当第二条路（0909）。 -->
        <el-dropdown trigger="click">
          <button class="rc-btn" type="button" data-testid="site-data-backtrace-more" :disabled="!canBackTrace || backTracing">⋯</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="openBackTraceInSourceView">在源视图打开（可勾选批量发任务）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
    </div>

    <!-- 具体源：节点选择走流程图，与 ResultView.vue 同构（0819 N1-3/N1-4）。放在工具行之后、
         数据之前——先定范围（选源）、再定节点、最后看数据；"全部源"态没有唯一流程，
         不渲染轨道（沿用 0812 §1.1-5，那时是选表）。 -->
    <div v-if="selectedSourceId && processLayout" class="sdv2-railbox">
      <div v-if="railOpen" class="sdv2-bar" data-testid="site-data-process-rail">
        <ProcessNodeRail :model-value="selectedNodeId" :layout="processLayout" @update:model-value="onSelectNode" />
        <div v-if="!allNodes.length" class="sdv2-bar-empty">该源没有可查看数据的节点</div>
      </div>
      <div class="sdv2-rail-ctl">
        <button
          type="button"
          class="sdv2-rail-toggle"
          :class="{ open: railOpen }"
          data-testid="site-data-rail-toggle"
          :title="railOpen ? '收起流程节点轨道' : '展开流程节点轨道'"
          @click="railOpen = !railOpen"
        >{{ railOpen ? '收起流程' : '展开流程' }} <span class="arrow">▾</span></button>
        <span v-if="!canPickRows" class="sdv2-readonly">只读查看</span>
        <button
          type="button"
          class="sdv2-goto"
          data-testid="site-data-goto-source"
          title="到该源的数据视图，那里可以发起抓取、发后续任务"
          @click="openSourceView"
        >进入源流程 →</button>
      </div>
    </div>

    <template v-if="selectedSourceId && flowLoadError">
      <div class="sdv2-empty">{{ flowLoadError }}</div>
    </template>
    <template v-else-if="selectedSourceId && flowLoading && !processLayout">
      <div class="sdv2-empty">加载中…</div>
    </template>
    <template v-else-if="selectedSourceId && selectedNodeId && !hasAnyTable">
      <div class="sdv2-empty" data-testid="source-node-empty">该节点不产生可查看的数据</div>
    </template>
    <template v-else-if="!selectedSourceId && !tableId">
      <div class="sdv2-empty">请先选择一张表，查看该网站下所有源在这张表里的数据</div>
    </template>
    <template v-else-if="!selectedSourceId && noCandidateSources">
      <div class="sdv2-empty">当前筛选条件下，这张表在本网站没有可查询的源</div>
    </template>
    <template v-else-if="effectiveTableId">
      <div v-if="slowQuery" class="sdv2-notice" role="status" data-testid="site-data-slow-query">查询较慢，可缩小条件范围再试；本次请求仍在等待结果</div>
      <div v-else-if="filtersDirty && !loading" class="sdv2-notice" role="status" data-testid="site-data-filters-dirty">查询条件已修改，点「查询」执行</div>
      <template v-else>
        <div v-if="metaError" class="sdv2-notice" role="status">{{ metaError }}</div>
        <div v-if="dataError" class="sdv2-notice error" role="alert">{{ dataError }}</div>
      </template>
      <div v-if="failedSources.length" class="sdv2-notice warn" data-testid="site-data-partial-fail">
        {{ failedSources.length }} 个源本次查询失败，结果可能不完整：{{ failedSources.map(failedSourceText).join('；') }}
      </div>

      <!-- 表头内容走 DataGrid 的 #head 插槽，跟「列」共用同一条横条——参考 ResultView.vue
           的具体源数据视图（2026-08-15 第十二次纠偏）；这里此前是独立的 .sdv2-tablehead
           单占一行，跟 DataGrid 自己的「列」行分开，同一类信息在两个数据视图里长得不一样。 -->
      <DataGrid
        class="sdv2-grid"
        :meta="meta"
        :rows="rows"
        :loading="loading"
        :selected-id="detailRow?.dataId"
        :source-names="gridSourceNames"
        :source-col-label="selectedSourceId ? '所属节点' : undefined"
        :preset-cols="presetCols"
        :selectable="canPickRows"
        :selected-ids="selectedRowIds"
        :auto-load-more="!allExhausted && !loadingMore && !autoLoadFailed"
        :sort-field="sortField"
        :sort-order="sortOrder"
        :sortable-props="SORTABLE_PROPS"
        @sort-change="onSortChange"
        @reach-end="loadMore"
        :allow-row-next-step="canPickRows"
        :allow-row-launch="true"
        :launch-blocked="launchBlocked"
        :hide-actions="!!selectedSourceId && !canPickRows"
        :source-clickable="!selectedSourceId"
        @source-click="onSourceClick"
        @update:selected-ids="selectedRowIds = $event"
        @file-click="onCellFile"
        @row-click="onRowClick"
        @row-action="onRowAction"
      >
        <template #head>
          <span class="sdv2-tablename">{{ meta?.tableName || effectiveTableId }}</span>
          <span v-if="totalHits !== null" class="sdv2-count" data-testid="site-data-total">共 {{ totalHits.toLocaleString() }} 条</span>
          <span v-else-if="totalHitsLoading" class="muted" data-testid="site-data-total-loading">总数统计中…</span>
          <span class="sdv2-count" :class="{ muted: totalHits !== null }">已加载 {{ rows.length }} 条</span>
          <span v-if="!selectedSourceId && candidateSourceIds.length" class="muted">已扫描 {{ candidateCursor }}/{{ candidateSourceIds.length }} 个源</span>
          <span v-if="canPickRows" class="muted">已选 {{ selectedRowIds.length }} 条</span>
          <button
            v-if="canPickRows"
            class="rc-btn primary"
            type="button"
            data-testid="source-node-exec-btn"
            :disabled="!!launchDisabledReason"
            :title="launchDisabledReason"
            @click="onSendNextStep"
          >发后续任务</button>
          <span v-else-if="!selectedSourceId" class="muted" :title="launchDisabledReason">选表无法发任务，请先选择具体源</span>
        </template>
        <template #head-right>
          <button
            class="rc-btn tiny"
            type="button"
            data-testid="site-data-summary-btn"
            title="按当前筛选条件统计"
            @click="summaryOpen = true"
          >统计</button>
          <button
            class="rc-btn tiny"
            type="button"
            data-testid="site-data-fullscreen-toggle"
            :title="fullscreen ? '退出全屏（Esc）' : '全屏查看数据'"
            @click="fullscreen = !fullscreen"
          >{{ fullscreen ? '⤡ 退出全屏' : '⤢ 全屏' }}</button>
        </template>
      </DataGrid>

      <div class="sdv2-foot">
        <span v-if="allExhausted" class="muted">已加载全部数据</span>
        <span v-else-if="loadingMore" class="muted" data-testid="site-data-loading-more">加载中…</span>
        <!-- 按钮始终作为兜底出现：加载失败后（自动加载已停）、以及浏览器没有
             IntersectionObserver 时，它是唯一的继续加载入口。 -->
        <button
          v-else
          class="rc-btn"
          type="button"
          data-testid="site-data-load-more"
          @click="loadMore"
        >加载更多</button>
        <!-- 每次加载条数（0910 会议 §1-2）：放在「加载更多」旁边而不是顶部计数区——
             用户是在这里才产生"一次少了/多了"的念头的，顶部那条横条也已经很挤。
             已全部加载完时不再显示：那时它调不动任何东西，只会让人以为还能再点出数据。 -->
        <label v-if="!allExhausted" class="sdv2-pagesize">
          每次
          <select
            :value="appendSize"
            data-testid="site-data-append-size"
            :disabled="loadingMore"
            @change="onAppendSizeChange(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="n in APPEND_SIZE_OPTIONS" :key="n" :value="n">{{ n }}</option>
          </select>
          条
        </label>
      </div>
    </template>

    <el-drawer v-model="detail.visible" class="sdv2-detail-drawer" :with-header="false" size="560px">
      <div v-if="detailRow" class="sdv2-detail">
        <div class="sdv2-d-head">
          <div class="sdv2-d-head-main">
            <div class="sdv2-d-title">{{ detailRow.title }}</div>
            <div class="sdv2-d-sub">
              <span class="sdv2-d-sub-item">
                <span>ENTRY_ID {{ detailRow.dataId }}</span>
                <button
                  v-if="detailRow.dataId"
                  type="button"
                  class="sdv2-sub-copy"
                  data-testid="row-detail-head-copy-entry"
                  title="复制 ENTRY_ID"
                  @click="copyText(detailRow.dataId, 'ENTRY_ID')"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                      fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </span>
              <span> · 源 ID {{ detailRow.sourceId }}<template v-if="!selectedSourceId && sourceNames[detailRow.sourceId]"> {{ sourceNames[detailRow.sourceId] }}</template></span>
            </div>
            <button
              v-if="canDrillParent"
              type="button"
              class="sdv2-parent-link"
              data-testid="site-data-parent-drill"
              :disabled="parentLoading"
              @click="openParentDetail"
            >父 ID {{ detailRow.parentId }} <span aria-hidden="true">↗</span></button>
            <div class="sdv2-d-tools">
              <button class="rc-btn tiny" type="button" data-testid="row-detail-prev" :disabled="detail.index <= 0" title="上一条" @click="stepDetail(-1)">‹</button>
              <span class="sdv2-d-pos" data-testid="row-detail-pos">{{ detail.index + 1 }}/{{ rows.length }}</span>
              <button
                class="rc-btn tiny"
                type="button"
                data-testid="row-detail-next"
                :disabled="detail.index >= rows.length - 1"
                :title="detail.index >= rows.length - 1 ? '本页最后一条，翻页后继续' : '下一条'"
                @click="stepDetail(1)"
              >›</button>
              <label class="sdv2-d-empty">
                <input v-model="showEmpty" type="checkbox" data-testid="row-detail-empty-toggle" />
                显示空字段
              </label>
              <select
                :value="fieldPreset"
                class="sdv2-d-preset"
                data-testid="row-detail-preset"
                @change="fieldPreset = ($event.target as HTMLSelectElement).value as RowFieldPreset"
              >
                <option value="all">全部字段</option>
                <option value="filled">仅非空</option>
                <option v-if="presetCols.length" value="next">下一步字段</option>
              </select>
            </div>
          </div>
          <button class="rc-btn ghost sdv2-d-close" type="button" @click="closeDetail">关闭</button>
        </div>
        <div class="sdv2-d-body">
          <div v-if="parentError" class="sdv2-notice error">{{ parentError }}</div>
          <div v-if="parentDetail" class="sdv2-parent-panel" data-testid="site-data-parent-panel">
            <div class="sdv2-parent-panel-head">
              <span class="sdv2-d-sub-item">
                <span>上游数据 · ENTRY_ID {{ parentDetail.row.dataId }}</span>
                <button
                  v-if="parentDetail.row.dataId"
                  type="button"
                  class="sdv2-sub-copy"
                  data-testid="row-detail-parent-copy-entry"
                  title="复制上游 ENTRY_ID"
                  @click="copyText(parentDetail.row.dataId, '上游 ENTRY_ID')"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                      fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
                    />
                  </svg>
                </button>
              </span>
              <button class="rc-btn ghost" type="button" @click="closeParentDetail">收起</button>
            </div>
            <RowDetailFields compact :fields="parentFields" />
          </div>
          <RowDetailFields
            :key="detailRow.dataId"
            :fields="detailFields"
            :show-empty="showEmpty"
            :visible-props="detailVisibleProps"
            @file-click="onCellFile"
          />
          <!-- 下级数据（0904）：与上游面板对称。这里不给「查看全部」——
               全部源视图没有 Y1 的下钻（它不锁定单一流程，跳不到"后继节点"）。 -->
        </div>
      </div>
    </el-drawer>
    <TaskInstDialog
      v-model="taskInst.visible"
      :source-id="taskInst.sourceId"
      :parent-id="taskInst.parentId"
      :can-write="false"
    />
    <SummaryDrawer v-model="summaryOpen" :table-meta="meta" :build-query="buildSummaryQuery" :hit-count="rows.length" />
  </main>

    <el-dialog
      v-model="filePreview.visible"
      :title="filePreview.name || '文件预览'"
      width="92vw"
      top="4vh"
      :style="{ maxWidth: '1180px' }"
      append-to-body
    >
      <FilePreview
        :path="filePreview.path"
        :name="filePreview.name"
        :ext="filePreview.ext || extFromName(filePreview.name)"
        :external-url="filePreview.url"
        style="height: min(72vh, 720px)"
        data-testid="site-data-cell-file-preview"
      />
    </el-dialog>

    <!-- 行尾「对该源发抓取…」用它：loadParams → 有参数弹框 / 无参数直发，
         与具体源数据视图的「发起抓取」同一条路径（ResultView 也是挂这个组件）。 -->
    <SnatchLauncher ref="snatchLauncher" />
</template>

<style scoped>
.sdv2-sql { flex: 1; min-width: 200px; }
.sdv2-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
/* 全屏（参考 ResultView.vue）：fixed 铺满视口逃逸到父级布局之外，父级（SiteDetailView.vue
   的网站标题/页签）不需要跟着让位——position:fixed 本来就会跳出正常文档流。 */
.sdv2-shell.is-fullscreen { position: fixed; inset: 0; z-index: 60; height: 100vh; border: 0; border-radius: 0; }
.sdv2-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; position: relative; }
.sdv2-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.sdv2-input.flex { flex: 1; min-width: 200px; font-family: var(--rc-mono, monospace); }
.sdv2-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sdv2-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.sdv2-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; padding: 40px 12px; text-align: center; }
.sdv2-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.sdv2-notice.error { border-bottom-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.sdv2-notice.warn { border-bottom-color: #fde68a; background: #fffbeb; color: #92400e; }
.sdv2-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); }
.sdv2-count { font-size: 12px; color: var(--rc-faint); }
.sdv2-toolbar :deep(.dcb) { flex: 1; min-width: 200px; }
.rc-btn.tiny { height: 24px; padding: 0 10px; font-size: 11.5px; }
.sdv2-grid { flex: 1; min-height: 0; }
.sdv2-foot { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.sdv2-foot .rc-btn { height: 28px; padding: 0 16px; font-size: 12px; }
.sdv2-pagesize { display: inline-flex; align-items: center; gap: 5px; color: var(--rc-faint); font-size: 12px; }
.sdv2-pagesize select { height: 24px; padding: 0 4px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); background: #fff; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.sdv2-pagesize select:disabled { cursor: default; opacity: 0.6; }
.muted { color: var(--rc-faint); font-size: 12px; }
.sdv2-detail-drawer :deep(.el-drawer__body) { display: flex; flex-direction: column; height: 100%; padding: 0; overflow: hidden; }
.sdv2-detail { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sdv2-d-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.sdv2-d-head-main { min-width: 0; flex: 1; }
.sdv2-d-close { flex: none; height: 28px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.sdv2-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); line-height: 1.4; word-break: break-word; }
.sdv2-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 4px; }
.sdv2-d-sub-item { display: inline-flex; align-items: center; gap: 4px; }
.sdv2-sub-copy {
  border: 0;
  background: transparent;
  color: var(--rc-faint);
  padding: 1px 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.5;
  transition: opacity .12s, color .12s, background-color .12s;
}
.sdv2-d-sub-item:hover .sdv2-sub-copy { opacity: 1; }
.sdv2-sub-copy:hover { color: var(--rc-primary); background: var(--rc-primary-bg); }
.sdv2-d-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 18px 16px; }
.sdv2-parent-link { margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; padding: 0; font-size: 11px; color: var(--rc-primary); cursor: pointer; }
.sdv2-parent-link:hover { text-decoration: underline; }
.sdv2-parent-link:disabled { opacity: .6; cursor: default; text-decoration: none; }
.sdv2-parent-panel { margin: 6px 0 12px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; padding: 10px 12px; }
.sdv2-parent-panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--rc-text-2); margin-bottom: 4px; }
.sdv2-d-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.sdv2-d-pos { color: var(--rc-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.sdv2-d-empty { display: inline-flex; align-items: center; gap: 4px; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.sdv2-d-preset { height: 24px; padding: 0 6px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 11px; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }

/* 节点轨道：与 ResultView.vue 的 .rv-railbox 一套取值，两个数据视图的流程图观感必须一致
   （0819 N1-4）。折叠开关长在轨道自己身上——控件应该长在它所控制的东西上。 */
.sdv2-railbox { position: relative; min-height: 32px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }
.sdv2-bar { position: relative; padding: 8px 0; background: #f8fafc; overflow: auto; }
.sdv2-bar-empty { color: var(--rc-faint); font-size: 12px; padding: 16px; text-align: center; }
.sdv2-rail-ctl { position: absolute; top: 4px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 6px; }
.sdv2-rail-toggle { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11.5px; cursor: pointer; }
.sdv2-rail-toggle:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.sdv2-rail-toggle .arrow { display: inline-block; transition: transform .18s ease; }
.sdv2-rail-toggle.open .arrow { transform: rotate(180deg); }
/* 只读标识 + 去具体源的入口：本视图不提供执行动作，必须让人看出来它跟源结果视图的差别 */
.sdv2-readonly { flex: none; padding: 2px 8px; border-radius: 999px; background: #f1f5f9; color: var(--rc-faint); font-size: 11px; }
.sdv2-goto { flex: none; height: 24px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-primary); font-size: 11.5px; cursor: pointer; }
.sdv2-goto:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
</style>
