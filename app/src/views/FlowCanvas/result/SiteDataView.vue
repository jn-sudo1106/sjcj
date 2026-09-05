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
import { dataApi, parseNextStepReceipt, siteApi, sourceApi, type DataTableMeta, type DataRow, type Source, type EntryDetail, type RowQuery } from '@/api'
import {
  buildHorizontalLayout, buildSourceSeed, effectiveInputTable, firstRunnableNodeId, nodeOutputTable, isDecision, isParallel,
  hasDirectSuccessor, type NodeConfig, type BranchSeed, type FlowBranchGroup,
} from '@/views/FlowCanvas/canvas/flowModel'
import { nextStepColumns } from '@/utils/flow/nextStepFields'
import { confirmDanger } from '@/utils/confirmDanger'
import SummaryDrawer from '@/components/data/SummaryDrawer.vue'
import DataGrid from './DataGrid.vue'
import FilePreview from './components/FilePreview.vue'
import { backTraceSources } from '@/utils/data/backTraceSources'
import { extFromName } from '@/utils/ossFile'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { readRailOpen, writeRailOpen } from './railPref'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'
import SiteTableSelect from './components/SiteTableSelect.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import { initMergeState, mergeLoadMore, type MergeLoadMoreResult, type MergeSourceState } from './siteDataMerge'
import RowDetailFields from './RowDetailFields.vue'
import { fieldsFromShowItems, fieldsFromTableMeta } from './rowDetailFields'
import { readFieldPreset, readShowEmpty, visibleDetailProps, writeFieldPreset, writeShowEmpty, type RowFieldPreset } from './rowDetailPrefs'

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

// 本视图与具体源结果视图（ResultView.vue）长得几乎一样——都是流程图选节点 + 数据表格——
// 但能力不同：这里是纯查看，发起抓取/发后续/输入输出切换都在那边。2026-08-20 拍板保持
// 这个分工（不合并、不改成"选中源即跳转"），代价是必须让用户看得出差别，否则会困惑
// "为什么这里不能发任务"。于是给一个明确的只读标识 + 一个去那边的入口。
function openSourceView() {
  if (!selectedSourceId.value) return
  void router.push({ path: '/canvas', query: { siteId: props.siteId, sourceId: selectedSourceId.value, view: 'data' } })
}

const PAGE_SIZE = 20
const MAX_PARALLEL_REQUESTS = 4

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
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })

const rows = ref<DataRow[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const dataError = ref('')
const failedSources = ref<MergeLoadMoreResult<DataRow>['failedSources']>([])
const allExhausted = ref(false)
const noCandidateSources = ref(false)

const siteChildren = ref<Source[]>([])
const sourceNames = computed<Record<string, string>>(() => Object.fromEntries(siteChildren.value.map((s) => [s.sourceId, s.name])))
// 具体源下 DataGrid「所属源」列改叫「所属节点」：每行本来就是同一个已选源，展示节点名字
// 而不是源名字，才不会看着像跨源归并。
const gridSourceNames = computed<Record<string, string>>(() => (selectedSourceId.value
  ? { [selectedSourceId.value]: selectedCfg.value?.title || selectedNodeId.value }
  : sourceNames.value))

let mergeStates: MergeSourceState[] = []
let candidateSourceIds: string[] = []
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
  if (!cond?.tableId) return
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
    sortField: 'ENTRY_ID',
    sortOrder: 'descend',
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
    const result = await mergeLoadMore(mergeStates, PAGE_SIZE, PAGE_SIZE,
      async (sourceId, page, size) => {
        const list = await fetchPage(sourceId, page, size, condition)
        queried = true
        return list
      }, MAX_PARALLEL_REQUESTS)
    if (id !== requestId) return
    if (queried && !result.failedSources.length) rememberSqlCondition(condition.tableId, condition.sql)
    rows.value = [...rows.value, ...result.rows]
    failedSources.value = result.failedSources
    allExhausted.value = result.allExhausted
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
  const tid = effectiveTableId.value
  if (!tid) return
  loading.value = true
  startSlowTimer()
  try {
    if (selectedSourceId.value) {
      // 具体源：候选源集合永远只有它自己，退化成单源归并，复用同一套分页逻辑。
      candidateSourceIds = [selectedSourceId.value]
    } else {
      // 全部源：先收窄源集合（方案 §6.2.2）：问这张表实际有哪些源的数据，跟当前网站源集合取交集。
      // 收窄本身失败不阻断整体查询，退回用网站全部源（请求量更大，但结果仍然正确）。
      siteChildren.value = await siteApi.siteSources(props.siteId)
      if (id !== requestId) return
      // ⚠️ entryDistinctSource 不按网站过滤，返回的是全平台写过这张表的源；不传 size 会退回
      // buildLegacyRowQuery 的分页默认值 20（真实 bug，2026-08-14 生产环境实测发现：某些共用表
      // 全平台引用源数超过 20，本网站的源恰好不在前 20 个里，交集算出来是空的，页面误报"没有可
      // 查询的源"）。size 传大值取全量，1000 是 Q10 已实测确认不截断的安全值。
      let distinctIds: string[] | null = null
      try {
        distinctIds = await dataApi.distinctSource({ tableId: tid, size: 1000 })
      } catch {
        distinctIds = null
      }
      if (id !== requestId) return
      const siteSourceIds = new Set(siteChildren.value.map((s) => s.sourceId))
      const scopedDistinctIds = distinctIds?.filter((sid) => siteSourceIds.has(sid)) ?? []
      // entryDistinctSource 只是优化候选源的接口，不是“没有数据”的最终判定。
      // 旧接口可能因分页、数据口径或表级记录异常返回空集合；空集合时回退到网站全部源，
      // 让 entryDataPaged 进行真实查询，避免把 TB_CNEWS 这类有效表提前判成不可查。
      candidateSourceIds = scopedDistinctIds.length ? scopedDistinctIds : [...siteSourceIds]
    }
    mergeStates = initMergeState(candidateSourceIds)
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
})

function runQuery() {
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
  const sourceCount = groups.size
  const rowCount = [...groups.values()].reduce((sum, ids) => sum + ids.length, 0)
  const nodeName = selectedCfg.value?.title || selectedNodeId.value
  const tableId = effectiveTableId.value
  await confirmDanger(
    '发后续任务',
    `将对 ${sourceCount} 个源 · ${rowCount} 条数据发起「${nodeName}」的后续处理，是否继续？`,
    async () => {
      let last: { message?: string } = {}
      for (const [sourceId, ids] of groups) {
        last = await dataApi.nextStep(sourceId, tableId, ids)
      }
      selectedRowIds.value = []
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
async function openBackTrace() {
  if (!canBackTrace.value || backTracing.value) return
  const hasCondition = !!(filters.sql || filters.state || filters.dataId || filters.parentId)
  // 无条件 = 全部源：不必发请求，直接进源视图不带 sourceIds
  if (!hasCondition) {
    void router.push({ path: '/canvas', query: { siteId: props.siteId, view: 'source' } })
    return
  }
  backTracing.value = true
  try {
    const { sourceIds } = await backTraceSources(buildSummaryQuery(), siteChildren.value.map((s) => s.sourceId))
    if (!sourceIds.length) {
      // 不跳：跳过去是一张空源列表，用户会以为源视图坏了
      ElMessage.info('当前条件没有命中任何源')
      return
    }
    // 带着源 ID 去源视图：那边的「源 ID」筛选框本来就收逗号分隔的多个 ID
    void router.push({ path: '/canvas', query: { siteId: props.siteId, view: 'source', sourceIds: sourceIds.join(',') } })
  } catch (e) {
    ElMessage.error(`反查源失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    backTracing.value = false
  }
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
  }
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
const detailFields = computed(() => fieldsFromTableMeta(meta.value?.fields, detailRow.value?.values))
const parentFields = computed(() => fieldsFromShowItems(parentDetail.value?.showItems))
const detailVisibleProps = computed(() => visibleDetailProps(fieldPreset.value, detailFields.value, presetCols.value))

// 单元格里的文件预览（0819 N2-7）：路径类字段点开就地看内容，不用先跳到文件视图再找。
// 用居中 dialog 而不是右侧抽屉——这是"看一眼就关"的操作型短流程，抽屉留给实体详情
// （项目弹层规范）。预览器与文件详情共用一个组件，取数、降级、下载全在里面。
const filePreview = reactive({ visible: false, path: '', name: '' })
function onCellFile(path: string) {
  filePreview.path = path
  filePreview.name = path.split('/').pop() || ''
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
        <SqlConditionEditor v-model="filters.sql" v-slot="{ value, update }" :table-id="effectiveTableId" :table-name="meta?.tableName" class="sdv2-sql">
          <input :value="value" @input="update(($event.target as HTMLInputElement).value)" class="sdv2-input flex" data-testid="data-cond-sql" placeholder="SQL 条件，用列头上的物理列名（如 K1 LIKE '%关键词%')" />
        </SqlConditionEditor>
        <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
        <button class="rc-btn" type="button" @click="clearFilters">清空</button>
        <!-- 0903 Y2：会上「我不知道有哪些语言……你这个条件能带回去吗？」——筛出脏数据之后，
             得知道这批数据来自哪些源才能整批重发。这是数据条件通向源的唯一一条路。 -->
        <button
          class="rc-btn"
          type="button"
          data-testid="site-data-backtrace"
          :disabled="!canBackTrace"
          :title="canBackTrace ? '按当前数据条件反查命中的源' : '先填至少一个数据条件（SQL / 状态 / 数据 ID / 父 ID）'"
          @click="openBackTrace"
        >{{ backTracing ? '反查中…' : '按条件查源 →' }}</button>
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
        @reach-end="loadMore"
        :hide-actions="!!selectedSourceId"
        @update:selected-ids="selectedRowIds = $event"
        @file-click="onCellFile"
        @row-click="onRowClick"
        @row-action="onRowAction"
      >
        <template #head>
          <span class="sdv2-tablename">{{ meta?.tableName || effectiveTableId }}</span>
          <span class="sdv2-count">已加载 {{ rows.length }} 条</span>
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
      </div>
    </template>

    <el-drawer v-model="detail.visible" class="sdv2-detail-drawer" :with-header="false" size="560px">
      <div v-if="detailRow" class="sdv2-detail">
        <div class="sdv2-d-head">
          <div class="sdv2-d-head-main">
            <div class="sdv2-d-title">{{ detailRow.title }}</div>
            <div class="sdv2-d-sub">
              数据 ID {{ detailRow.dataId }} · 源 ID {{ detailRow.sourceId }}<template v-if="!selectedSourceId && sourceNames[detailRow.sourceId]"> {{ sourceNames[detailRow.sourceId] }}</template>
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
              <span>上游数据 · {{ parentDetail.row.dataId }}</span>
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
        :ext="extFromName(filePreview.name)"
        style="height: min(72vh, 720px)"
        data-testid="site-data-cell-file-preview"
      />
    </el-dialog>
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
.sdv2-foot { display: flex; justify-content: center; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.sdv2-foot .rc-btn { height: 28px; padding: 0 16px; font-size: 12px; }
.muted { color: var(--rc-faint); font-size: 12px; }
.sdv2-detail-drawer :deep(.el-drawer__body) { display: flex; flex-direction: column; height: 100%; padding: 0; overflow: hidden; }
.sdv2-detail { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.sdv2-d-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.sdv2-d-head-main { min-width: 0; flex: 1; }
.sdv2-d-close { flex: none; height: 28px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.sdv2-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); line-height: 1.4; word-break: break-word; }
.sdv2-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 4px; }
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
