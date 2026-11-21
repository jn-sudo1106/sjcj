<script setup lang="ts">
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import { rememberSqlCondition } from '@/utils/sqlConditionHistory'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElIcon, ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowUp, Search } from '@element-plus/icons-vue'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { dataApi, isMockMode, isProductionBackend, parseNextStepReceipt, ruleApi, type DataTableMeta, type DataRow, type EntryDetail, type RowQuery, type Step } from '@/api'
import {
  buildHorizontalLayout, nodeOutputTable, nodeEntryCondition, conditionGroupLabel, conditionGroupIsSet,
  isFirstRunnableNode, hasDirectSuccessor, directPredecessorIds, directSuccessorIds, directSuccessorIdsIncludingDisabled, type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import { nextStepColumns } from '@/utils/flow/nextStepFields'
import { scriptParamName } from '@/utils/flow/dataProcess'
import { fetchNextStepConfig } from '@/utils/flow/nextStepConfig'
import { planSkipCondSend } from '@/utils/flow/skipCondPlan'
import { fetchChildCountsForPage, isPerRowMode, resolveChildTargets, type ChildCountCell } from '@/utils/flow/childCounts'
import { ApiError } from '@/api/client'
import { confirmDanger, confirmOrRun } from '@/utils/confirmDanger'
import SummaryDrawer from '@/components/data/SummaryDrawer.vue'
import TableDetailDialog from '@/views/DataView/TableDetailDialog.vue'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import DataGrid from './DataGrid.vue'
import AddDataMenu from '@/components/ResultToolbar/AddDataMenu.vue'
import ExportMenu from '@/components/ResultToolbar/ExportMenu.vue'
import FullscreenToggle from '@/components/ResultToolbar/FullscreenToggle.vue'
import BrowseModeToggle from '@/components/ResultToolbar/BrowseModeToggle.vue'
import FilePreview from './components/FilePreview.vue'
import { extFromFieldHint, extFromName, ossPathWithExt } from '@/utils/ossFile'
import ProcessNodeRail from './ProcessNodeRail.vue'
import RailNodePicker from './components/RailNodePicker.vue'
import { initialRailOpen, readResultRailHeight, readDataBrowseMode, writeDataBrowseMode, type DataBrowseMode } from './resultLayoutPref'
import RailResizeHandle from './RailResizeHandle.vue'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'
import RowEditDialog from '@/views/DataView/RowEditDialog.vue'
import DataImportDialog from '@/views/DataView/DataImportDialog.vue'
import SnatchLauncher from '@/views/FlowCanvas/source/SnatchLauncher.vue'
import CodeConfigButton from './CodeConfigButton.vue'
import { codeTargetForNode, codeTargetsForRows } from '@/utils/flow/codeConfigTargets'
import { canvasFlowIdOf, useFlowVersionStore } from '@/stores/flowVersion'
import RowDetailFields from './RowDetailFields.vue'
import { fieldsFromShowItems, fieldsFromTableMeta } from './rowDetailFields'
import { readFieldPreset, readShowEmpty, visibleDetailProps, writeFieldPreset, writeShowEmpty, type RowFieldPreset } from './rowDetailPrefs'
import { copyToClipboard } from '@/utils/clipboard'
import { downloadCsv } from '@/utils/format/csvExport'
import { resultRowsCsv } from './exportRows'
import DataFetchApiDialog from '@/components/data/DataFetchApiDialog.vue'

function copyText(val: string, label?: string) {
  void copyToClipboard(val, label)
}

// 数据视图只属于具体源流程（0812 计划 M2-4：网站"全部源"态改用独立的 SiteDataView.vue，
// 不再靠 siteWide 布尔开关把两种数据流塞进同一个组件——那正是 M1-4 删掉的"代表源"问题的成因）。
const flow = useFlowStore()
const ui = useUiStore()
const ws = useWorkspaceStore()
const flowVersion = useFlowVersionStore()
function nodeCodeTargets(nodeId = selectedNodeId.value) {
  const flowId = canvasFlowIdOf(flow)
  return [codeTargetForNode(sourceId.value, flowId, nodeId, flowVersion.flowId === flowId && !flowVersion.published ? flowVersion.viewVersionId : null)]
}
function dataCodeTargets() {
  if (execMode.value === 'fetch') return nodeCodeTargets()
  const flowId = canvasFlowIdOf(flow)
  if (!stepIdOfNode(selectedNodeId.value)) throw new Error('请先保存当前步骤，再选择后续步骤生成代码')
  return codeTargetsForRows(rows.value, selectedRowIds.value, selectedTable.value, sourceId.value, {
    flowId, ver: flowVersion.flowId === flowId && !flowVersion.published ? flowVersion.viewVersionId : null,
    ...(isCurrentNodeAction.value ? { stepId: stepIdOfNode(selectedNodeId.value) } : {}),
  }).map(target => ({ ...target, ...(!isCurrentNodeAction.value ? { fromStepId: stepIdOfNode(selectedNodeId.value) } : {}) }))
}

const source = computed(() => flow.sourceCtx)
const route = useRoute()
const router = useRouter()
const sourceId = computed(() => source.value?.sourceId ?? '')
const siteId = computed(() => source.value?.siteId ?? '')
const tabKey = computed(() => sourceId.value)
const queryNodeId = computed(() => String(route.query.nodeId ?? ''))
const queryScriptPath = computed(() => String(route.query.scriptPath ?? '').trim())
const queryDataId = computed(() => String(route.query.dataId ?? '').trim())

// 节点候选不再要求"必须有输出表"（0812 计划 M2-6，方案 §6.3）：没有表的节点选中后走只读上下文 + 空态分支，
// 不强行伪装成有数据的节点；候选就是流程里的全部真实节点。
const processLayout = computed(() =>
  buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }),
)
const allNodes = computed(() => processLayout.value.nodes)
const selectedNodeId = ref<string>('')
// 明确的步骤深链优先；普通进入默认按表，并恢复个人浏览偏好。
const browseMode = ref<DataBrowseMode>(queryNodeId.value ? 'step' : route.query.tableId ? 'table' : readDataBrowseMode())
const tableChoice = ref('')
const outputTables = computed(() => {
  const tables = new Map<string, { id: string; nodeIds: string[]; titles: string[] }>()
  for (const node of allNodes.value) {
    const id = nodeOutputTable(node.cfg)
    if (!id) continue
    const item = tables.get(id) ?? { id, nodeIds: [], titles: [] }
    item.nodeIds.push(node.id); item.titles.push(node.cfg.title)
    tables.set(id, item)
  }
  const main = source.value?.mainTable
  if (main && !tables.has(main)) tables.set(main, { id: main, nodeIds: [], titles: [] })
  return [...tables.values()]
})
watch(outputTables, tables => {
  if (tables.some(t => t.id === tableChoice.value)) return
  const saved = route.query.tableId ?? ws.snapshotOf(tabKey.value)?.dataTableId
  tableChoice.value = saved && tables.some(t => t.id === saved) ? String(saved) : tables[0]?.id ?? ''
}, { immediate: true })
const tableNames = ref<Record<string, string>>({})
// 1117：输入 / 输出块只留标签，表就看紧跟着的物理表名（点开「表结构详情」，库类型也在那里），
// 不再并排显示表 ID / 表名称两套名字。悬停标签可看表 ID 与物理表名，和下拉同一次 tableMeta 拿到。
const tableTitles = ref<Record<string, string>>({})
function tableTip(id: string) {
  return [`表 ID：${id}`, tableTitles.value[id]].filter(Boolean).join(' · ')
}
let tableNamesRequest = 0
watch(() => outputTables.value.map(t => t.id), async ids => {
  const request = ++tableNamesRequest
  const results = await Promise.allSettled(ids.map(id => dataApi.tableMeta(id)))
  if (request !== tableNamesRequest) return
  tableNames.value = Object.fromEntries(results.map((result, index) => {
    const table = result.status === 'fulfilled' ? result.value : null
    const label = [...new Set([table?.name?.trim(), table?.tableName?.trim()].filter(Boolean))].join(' · ')
    return [ids[index]!, label]
  }))
  tableTitles.value = Object.fromEntries(results.flatMap((result, index) => {
    const table = result.status === 'fulfilled' ? result.value : null
    const title = table?.tableName?.trim()
    return title ? [[ids[index]!, title]] : []
  }))
}, { immediate: true })
onBeforeUnmount(() => { tableNamesRequest += 1 })
const snatchLauncher = ref<InstanceType<typeof SnatchLauncher>>()
const scope = ref<'output' | 'input'>('output')
const page = ref(1)
const filters = reactive({ dataId: '', parentId: '', state: '', sql: '' })

/**
 * 从网站汇总的「按条件查源」命中列表点进某个源时带过来的条件（2026-09-09）。
 * 侧栏那一行写着「906 条」，进来看到的就得是那 906 条，否则那个数字是误导。
 *
 * 走 store 而不是 URL：本视图按 sourceId 做 key，源→源切换会销毁重建，用 query 传会撞上
 * 「旧实例先填完条件顺手抹掉 query、新实例挂载时已读不到」的竞态——表现为点第一个源
 * 好使、再点别的源条件就没了。store 里那份取走即清，只应用一次。
 */
const pendingCondition = ws.takePendingSourceCondition()
if (pendingCondition) {
  filters.sql = pendingCondition.sql ?? ''
  filters.state = pendingCondition.state ?? ''
  filters.dataId = pendingCondition.dataId ?? ''
  filters.parentId = pendingCondition.parentId ?? ''
} else if (queryDataId.value) {
  filters.dataId = queryDataId.value
}

// 节点轨道**默认收起**（0910 会议 §2-2「点数据视图时自动收起上方流程配置区域」）。
// 这条推翻了 2026-08-15 的定案（原话是"不靠默认折叠常规页面换那几行"，理由是轨道
// 是流程上下文、第一眼就该看到）——会上给的新权衡是：进数据视图的人是来看数据的，
// 那 96px 应该先归数据，想看流程的人点一下展开。
//
// 收起后仍要能展开：开合按钮站在主干行左端（0910 定案）。曾试过让它浮在轨道区右上角
// 与全部源视图同构，但那样收起时得靠 .rv-railbox 的 min-height 留一条 32px 窄带专门
// 托住按钮——一整行高度只换一个按钮，而主干行左边又只剩「筛选」「查询」两个，空了半边。
// 收起状态下主干行左端是节点下拉 + 流程图开合（0930-02），不展开也能换节点。
// 0930-02：每次进来都收起、不再记住展开（会上：默认折叠；记住后展开过一次就一直是展开的）。
const railOpen = ref(initialRailOpen())
const railNodeOptions = computed(() => allNodes.value.map((n) => ({ id: n.id, title: n.cfg.title })))
// 流程图区最大高度（0928）：内容更矮时按内容收缩，更高时在区内滚动，底边分隔条拖拽调整。
const railHeight = ref(readResultRailHeight())
// 全屏：整个面板 position:fixed 铺满视口，不复制模板、不引入弹层——详情抽屉本来就渲染在
// .rv-shell 内部，会跟着一起进全屏；祖先链上没有 transform/filter/contain，fixed 能正常
// 逃逸到视口（已核对 AppShell.vue / FlowCanvas/index.vue）。
const fullscreen = ref(false)
const gridToolsTarget = ref<HTMLElement | null>(null)
// 全屏不动轨道（0819 会议 N1-2）：删掉节点下拉后，流程图是唯一的节点选择器，
// 进全屏再把它自动收起来，等于逼用户先想起来去点"展开流程"才能切节点。
// 节点选择在全屏与非全屏下应当完全一致；想让出纵向空间的人自己点折叠即可。
function onWindowKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false
}
onMounted(() => window.addEventListener('keydown', onWindowKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown))

// 节点上下文（0812 计划 M2-8）：输出表统一口径 + 有效输入表（显式覆盖优先，否则继承上游输出表）。
const selectedCfg = computed<NodeConfig | undefined>(() => allNodes.value.find((n) => n.id === selectedNodeId.value)?.cfg)
const visibleFieldProps = computed<string[] | undefined>(() => {
  if (ui.inspectorCollapsed || !ui.inspectorFieldFilterActive) return undefined
  const inputFields = selectedCfg.value?.ruleCfg?.inputFields ?? selectedCfg.value?.inputFields ?? []
  return inputFields.length ? [...inputFields] : undefined
})
const outputTableId = computed(() => (selectedCfg.value ? nodeOutputTable(selectedCfg.value) : ''))
const inputTableId = computed(() => (selectedNodeId.value ? flow.effectiveInputTableFor(selectedNodeId.value) : ''))
const hasAnyTable = computed(() => browseMode.value === 'table' ? !!tableChoice.value : (!!outputTableId.value || !!inputTableId.value))
const bothScopesAvailable = computed(() => !!(inputTableId.value && outputTableId.value))
// 输入表===输出表（0812 会议同时要了"展示看输出表"+"发送用输入数据"两件事，输入≠输出时
// 这两件事天然落在两张表上、需要两个 tab；相同时落在同一张表，双 tab 就成了自我矛盾——
// 合并成一个 tab，这张表两个身份都占，不需要切换（M3-0C，2026-08-15 定案）。
const sameTable = computed(() => !!inputTableId.value && !!outputTableId.value && inputTableId.value === outputTableId.value)
const scopeSwitchable = computed(() => bothScopesAvailable.value && !sameTable.value)
// 「测试脚本」带 scriptPath 进来时，脚本要吃的是规则节点的**输入**行；输入≠输出时默认停在输入表，
// 否则打开就是空的输出表，测试拿不到行（2026-11-17 186 走查：规则节点输出表 6910003 为空）。
const scriptTestOnInput = computed(() => !!queryScriptPath.value && !!selectedCfg.value?.ruleCfg && !!inputTableId.value)
function defaultScope(): 'output' | 'input' {
  if (scriptTestOnInput.value) return 'input'
  return outputTableId.value ? 'output' : 'input'
}
const selectedTable = computed(() => browseMode.value === 'table' ? tableChoice.value : (scope.value === 'output' ? outputTableId.value : inputTableId.value))

// 节点手动执行（0824：末节点无发后续；有后继则从当前表勾行发给后继）：
// 列表→详情的前一个节点往往只有输出表（如 900 TB_CNEWS），那张表的行就是要发给后继的数据，
// 不能因为没有输入表就改成「发起抓取」并把勾选列拿掉。发起抓取仍在画布头 SnatchLauncher。
// 后继无法唯一解析仍走 M2-14 阻断（旧 nextStep 没有 targetNodeId）。
const isVerifiedFirstNode = computed(() => (selectedNodeId.value ? isFirstRunnableNode(flow.main, flow.configs, selectedNodeId.value) : false))
const hasSuccessor = computed(() => (selectedNodeId.value ? hasDirectSuccessor(flow.main, flow.configs, selectedNodeId.value, flow.branchGroups) : false))
const predecessorIds = computed(() => (selectedNodeId.value
  ? directPredecessorIds(flow.main, flow.configs, selectedNodeId.value, flow.branchGroups)
  : []))
const predecessorId = computed(() => (predecessorIds.value.length === 1 ? predecessorIds.value[0] : ''))
const predecessorTitle = computed(() => flow.configs[predecessorId.value]?.title || predecessorId.value)
const predecessorTableId = computed(() => {
  const cfg = predecessorId.value ? flow.configs[predecessorId.value] : undefined
  if (!cfg) return ''
  return nodeOutputTable(cfg) || flow.effectiveInputTableFor(predecessorId.value)
})

/**
 * 被停用的直接后继（2026-09-04）。
 *
 * `hasDirectSuccessor` 会跳过停用节点——这是对的，停用的节点不该被当成可发送目标。
 * 但它把两件事压成了同一个"没有后继"：**真末节点** vs **后继存在但停用了**。
 * 于是中间节点也会落到 `upstream` 分支，按钮写着「从上一节点重跑」——
 * 实测：源 430016398 的规则处理节点后面挂着已停用的「1400917-详情」，
 * 用户看到的是"这不是最后一个节点，为什么叫从上一节点重跑"。
 *
 * 这里不改判定（停用的后继确实不能发），只把原因说出来。
 */
const disabledSuccessorTitles = computed(() => {
  if (!selectedNodeId.value) return []
  const all = directSuccessorIdsIncludingDisabled(flow.main, flow.configs, selectedNodeId.value, flow.branchGroups)
  return all.filter((id) => flow.configs[id]?.disabled).map((id) => flow.configs[id]?.title || id)
})

type ExecMode = 'fetch' | 'input' | 'none' | 'upstream'
const execMode = computed<ExecMode>(() => {
  if (!outputTableId.value && !inputTableId.value) return 'none'
  if (hasSuccessor.value) return 'input'
  // 末节点：有唯一上游就能从上一节点重跑（0831 X7-B）。上游不唯一宁可不给入口。
  if (predecessorId.value) return 'upstream'
  /**
   * 孤立首节点（没有后继、也没有上游）：唯一能做的就是把这个源重抓一遍（2026-09-17 接上）。
   *
   * `'fetch'` 这个模式连同 onSendFetch / actionBtnText / execDisabledReason 的分支早就写好了，
   * 但在此之前**没有任何路径产生它**，整块是死代码——工具栏于是一片空白，用户看着像"这里没功能"。
   * 公众号那批源正是这种形态：起点自己就是完整的抓取配置（网页抓取 → 直接写 6200029），
   * 抓完入库、流程到此为止，5429 个源共 83 万条数据都是这么来的。
   */
  if (isVerifiedFirstNode.value) return 'fetch'
  return 'none'
})

/**
 * 真的什么都做不了时，说清楚是为什么（2026-09-17）。
 *
 * 之前 execMode==='none' 会让整个按钮组 `v-else` 掉、连个 tooltip 都没有，
 * 「没配后续节点」和「这里本来就没这功能」在界面上长得一模一样，而这两件事完全不同。
 *
 * ⚠️ 上面接上 `'fetch'` 之后，这段**大部分分支已经走不到了**，留着是兜底：
 * - 没有任何表 → 外层 `hasAnyTable` 的空态先接管，根本到不了工具栏；
 * - 孤立首节点 → 现在是 `'fetch'`；
 * - 末节点单上游 → `'upstream'`。
 * 实际还能落到这里的只剩「末节点 + 多个上游」（上游不唯一时 predecessorId 为空），
 * 那需要 branchGroups 里两条分支汇到同一节点，真实流程里罕见，因此没有配套单测。
 */
const noExecReason = computed(() => {
  if (execMode.value !== 'none') return ''
  // 按表浏览时页面不指向具体节点（这张表可能由多个节点产出，也可能就是源主表），
  // 说「当前节点没有配置输入表 / 输出表」是错的——表明明就在下面显示着。
  if (browseMode.value === 'table' && !selectedNodeId.value) return '按表浏览：切到「按步骤」并选中节点后可发任务'
  if (!outputTableId.value && !inputTableId.value) return '当前节点没有配置输入表 / 输出表，无法执行'
  return '当前节点没有后续节点，也没有可回退的上游，无法发任务'
})

function onScopeChange(next: 'output' | 'input') {
  if (scope.value === next) return
  scope.value = next
  page.value = 1
  selectedRowIds.value = []
}

/**
 * 同一张输入表挂多个后继时，这批数据会分流到哪几个节点（2026-09-04 重做）。
 *
 * **原来这里是一条阻断**（0812 M2-14）：只要输入表被多个节点共用就禁用勾选与手动执行，
 * 理由是「旧 nextStep 没有 targetNodeId，后端没法知道任务该发给哪一个」。
 *
 * **这个前提是错的。** 后端按**各后继节点的进入条件**逐个求值来分流——2026-09-04 确认，
 * 实例：源 yahoo 的两个后继入参都是 900，靠条件区分
 *   `K19 == nil || K1=='guce' || K1==nil` → python正文提取(38779)
 *   `K19 != nil && K6 == nil`             → python正文提取_dev(38878)
 * 「同表多后继」是旧平台的**正常设计**，不是配置错误。
 *
 * 代价是这条阻断把很常见的形态整条链都锁死了：920663 那种一条链全在 TB_CNEWS 上的源，
 * 除第一个节点外全都不能发任务（用户两次报「为什么这个节点没有勾选框」）。
 *
 * 现在不拦，改成执行前把分流去向说清楚。
 */
const branchTargets = computed(() => {
  if (execMode.value !== 'input' || !selectedNodeId.value) return []
  const ids = directSuccessorIds(flow.main, flow.configs, selectedNodeId.value, flow.branchGroups)
  if (ids.length < 2) return []
  return ids.map((id) => {
    const cfg = flow.configs[id]
    const group = cfg ? nodeEntryCondition(cfg) : undefined
    return {
      id,
      title: cfg?.title || id,
      condition: group && conditionGroupIsSet(group) ? conditionGroupLabel(group) : '无进入条件',
    }
  })
})



const successorIds = computed(() => {
  if (!selectedNodeId.value) return []
  return directSuccessorIds(flow.main, flow.configs, selectedNodeId.value, flow.branchGroups)
})
const successorTitles = computed(() => {
  return successorIds.value.map((id) => flow.configs[id]?.title || id).join('、')
})
const successorTableId = computed(() => {
  if (!successorIds.value.length) return ''
  return flow.effectiveInputTableFor(successorIds.value[0]) || outputTableId.value
})

const isCurrentNodeAction = computed(() => {
  return execMode.value === 'input' && scope.value === 'input' && !sameTable.value && !!outputTableId.value
})

const actionBtnText = computed(() => {
  if (execMode.value === 'fetch') return '发起抓取'
  if (execMode.value === 'upstream') return '从上一节点重跑'
  if (execMode.value === 'input') {
    if (isCurrentNodeAction.value) return '发起本节点任务'
    return sendSettingOptions.value.length && sendSettingSelectedCount.value < sendSettingOptions.value.length
      ? `发后续（${sendSettingSelectedCount.value} 个节点）` : '发后续'
  }
  return '发后续'
})

// 发后续任务（0824/0912）：发后续是发给直接后继节点处理当前节点产出的输出数据。
// 在输出 tab（或单表节点）勾选行发后续任务，此时 entryTypeId 传入后继节点的输入表（即本节点输出表）。
// 在输入 tab 勾选行则是发起本节点任务（entryTypeId 传本节点输入表）。
const execDisabledReason = computed(() => {
  if (execMode.value === 'fetch' && !isVerifiedFirstNode.value) return '当前节点无输入表，暂不支持独立手动执行'
  if (execMode.value === 'input') {
    if (!selectedRowIds.value.length) return '请先勾选要发送的数据'
    if (!isCurrentNodeAction.value && sendSettingOptions.value.length && !sendSettingSelectedCount.value) return '请至少选择一个发送节点'
    if (!isCurrentNodeAction.value && !successorTableId.value && !outputTableId.value) {
      return '后续节点无有效输入表，无法发后续'
    }
  }
  if (execMode.value === 'upstream') {
    if (!selectedRowIds.value.length) return '请先勾选要从上一节点重跑的数据'
  }
  return ''
})
const canExecute = computed(() => execMode.value !== 'none' && !execDisabledReason.value)
/**
 * 「本次跳过条件」只给"发后续"用（1109-R01）：它跳过的是**下游节点的进入条件**，
 * "发起本节点任务 / 发起抓取 / 从上一节点重跑"根本不是这个语境，给了开关也没处生效。
 * 只要处在"发后续"语境就**显示**（哪怕还没勾数据）：第一版把它绑在 canExecute 上，
 * 结果表里没数据时整个开关都不渲染，用户只看到"发后续"是灰的，以为这功能不存在。
 * 不可执行时改为 disabled + tooltip，别隐藏。
 */
const canSkipCondThisSend = computed(() => execMode.value === 'input' && !isCurrentNodeAction.value)
const canPickRows = computed(() => {
  if (execMode.value === 'upstream') return true
  if (execMode.value === 'input') return true
  // 单节点源（孤立首节点，2026-09-24 用户要求也给勾选）：「发起抓取」发的是整个源、不看勾选，
  // 但同一排的「删除数据 → 删除选中的数据」要靠勾选——不给勾选列，那一项就永远是灰的。
  if (execMode.value === 'fetch') return true
  /**
   * 按表浏览 + 这张表不归属唯一节点（多个节点产出同一张表 / 选的是源主表）时，
   * `selectedNodeId` 是空的，execMode 落在 'none'，勾选列整列都不渲染；
   * 可「删除数据」的门禁只看测试表，菜单还在——于是「删除选中的数据」永远是灰的
   * （2026-11-05 用户报「按照表筛选前面的勾选没有了」）。要删数据就得先能勾，这里放行。
   */
  return meta.value?.state === 'C'
})

const selectedRowIds = ref<string[]>([])

/**
 * 勾了这个数以内就直接发，不弹确认（0917-05，2026-09-21 用户定 20）。
 * 会上原话：「就不要弹框」「什么确认一下，不要确认」。
 *
 * **和源视图的 `DIRECT_SEND_MAX = 2` 是两个数，不要统一**：那个数的是**源**
 * （一个源可能带几万条数据，2 是旧平台口径），这个数的是**数据行**
 * （勾 20 条发后续就是 20 个任务）。两个粒度差几个数量级，共用一个数
 * 要么源那边太松、要么这边太紧。
 *
 * 超过阈值、以及"按当前条件全部发"那两个入口（命中数不可见、上限 50 万）仍然确认。
 */
const DIRECT_ROWS_MAX = 20

/**
 * 本次不发后续的节点（0917-06）。会上原话：「默认我不点的时候他就全部发，
 * 如果我点个（叉），他就只发第一个」。
 *
 * **与节点「停用」（`Step.enabled`）是两件事**：那个落在后端 `cs_item_config` 上、
 * 对所有源所有运行生效；这里仅影响本次发送，不保存到页签快照。
 *
 * 语义是**过滤不截断**（2026-09-21 用户定）：A→B→C 跳过 B，C 照发。
 * 代价用户知道——B 不跑，C 这次多半空跑；这是临时排错动作，不是配置变更。
 */
const skippedNodeIds = ref<string[]>([])
const isNodeSkipped = (nodeId: string) => skippedNodeIds.value.includes(nodeId)

/** 节点 ID → 后端认的步骤 ID。与 onSendNextStep 里 currentStepId / predStepId 同一套判据。 */
function stepIdOfNode(nodeId: string): string {
  const cfg = flow.configs[nodeId] as { stepId?: string | number } | undefined
  const fromCfg = cfg?.stepId != null ? String(cfg.stepId) : ''
  if (/^\d+$/.test(fromCfg)) return fromCfg
  return /^\d+$/.test(nodeId) ? nodeId : ''
}
const skippedStepIds = computed(() => new Set(skippedNodeIds.value.map(stepIdOfNode).filter(Boolean)))
/** 确认框里点明这次跳了几个——超阈值才会弹，但弹的时候必须说 */
const skipHintText = computed(() => (skippedNodeIds.value.length
  ? `\n已标「本次不发」的 ${skippedNodeIds.value.length} 个节点不会收到任务。`
  : ''))

/**
 * 「本次跳过进入条件」（1109-R01 第一档/第二档，2026-11-09 用户定先做这两档）。
 *
 * 对应后端 `source/nextStep` 的存量参数 `skipCond=1`（InfoSourceController:2300-2313）：
 * 把本次 `itemConfig` 里的步骤**整批**跳过进入条件（cond），但 `hasExecNext` 幂等检查照常执行
 * （ItemConfigService:559-563、:635），所以不会绕过"已执行就不重复发"的防线。
 *
 * 两点边界，别在这个开关上想当然：
 * - **按节点**（2026-11-09 用户要求"要能选节点"）：`skipCondStepIds` 存本次勾选要跳的步骤 ID。
 *   后端只有**整批** `skipCond=1`（没有 `ignoreConditionStepIds`），所以勾选非全量时前端按
 *   「跳过组 / 正常组」拆成两次 `nextStep` 请求：后端是按 `itemConfig` 逐节点独立建任务，
 *   两次请求与一次请求语义等价（同一批 entryId、不同 configId，互不依赖）。
 *   勾选覆盖全部目标节点时只发一次，避免多余请求。
 * - 一次性动作：不写回节点配置，也不进页签快照，受理成功或换源/换节点/换版本即清，
 *   避免下一次普通发送继承上一次的放行状态（验收要求"再次普通发送恢复原行为"）。
 */
const forceSkipCond = ref(false)
/** 本次勾选要跳过进入条件的步骤 ID（空 = 未启用；全量 = 等价旧的整批跳过）。 */
const skipCondStepIds = ref<string[]>([])

/** 本次发送范围与节点菜单共用既有排除/忽略条件状态，默认全部发送。 */
type SendSettingMode = 'normal' | 'skipCond' | 'mute'
interface SendSettingOption {
  stepId: string
  nodeId: string
  name: string
  condition: string
  configId?: string
}
const sendSettingVisible = ref(false)
const sendSettingLoading = ref(false)
const sendSettingError = ref('')
const sendSettingOptions = ref<SendSettingOption[]>([])
const sendSettingSearch = ref('')
const sendNodeSelection = ref(false)
let sendSettingRequest = 0
const sendSettingBadge = computed(() => skipCondStepIds.value.length + skippedNodeIds.value.length)
const sendSettingMatches = computed(() => {
  const query = sendSettingSearch.value.trim().toLowerCase()
  return sendSettingOptions.value.filter(opt => `${opt.name} ${opt.stepId}`.toLowerCase().includes(query))
})
function sendSettingModeOf(opt: SendSettingOption): SendSettingMode {
  if (isNodeSkipped(opt.nodeId)) return 'mute'
  return skipCondStepIds.value.includes(opt.stepId) ? 'skipCond' : 'normal'
}
const sendSettingSelectedCount = computed(() => sendSettingOptions.value.filter(opt => sendSettingModeOf(opt) !== 'mute').length)
const sendSelectedNodeIds = computed(() => sendSettingOptions.value.filter(opt => !isNodeSkipped(opt.nodeId)).map(opt => opt.nodeId))
const ignoreConditionNodeIds = computed(() => skipCondStepIds.value.map(nodeIdOfStepId).filter(Boolean))
const sendConditionOptions = computed(() => sendSettingMatches.value.filter(opt => opt.condition && !isNodeSkipped(opt.nodeId)))
const sendConditionCount = computed(() => sendConditionOptions.value.filter(opt => skipCondStepIds.value.includes(opt.stepId)).length)
const allSendConditionsIgnored = computed(() => sendConditionOptions.value.length > 0 && sendConditionCount.value === sendConditionOptions.value.length)
const sendSettingRangeLabel = computed(() => {
  if (sendSettingOptions.value.length && sendSettingSelectedCount.value < sendSettingOptions.value.length) {
    return `${sendSettingSelectedCount.value}/${sendSettingOptions.value.length}`
  }
  return skippedNodeIds.value.length ? `已排除 ${skippedNodeIds.value.length}` : '全部'
})

/** 节点轨道的右键菜单（0917-06 / 0917-08）。菜单项按被右键的那个节点算，不看当前选中。 */
const nodeMenu = ref<{ show: boolean; nodeId: string; x: number; y: number }>({ show: false, nodeId: '', x: 0, y: 0 })
const menuNodeIsFirst = computed(() => (nodeMenu.value.nodeId
  ? isFirstRunnableNode(flow.main, flow.configs, nodeMenu.value.nodeId)
  : false))
const menuNodeTitle = computed(() => flow.configs[nodeMenu.value.nodeId]?.title || nodeMenu.value.nodeId)
const menuSendOption = computed<SendSettingOption>(() => {
  const nodeId = nodeMenu.value.nodeId
  const loaded = sendSettingOptions.value.find(opt => opt.nodeId === nodeId)
  if (loaded) return loaded
  const cfg = flow.configs[nodeId]
  const condition = cfg ? nodeEntryCondition(cfg) : undefined
  return { nodeId, stepId: stepIdOfNode(nodeId), name: menuNodeTitle.value,
    condition: condition && conditionGroupIsSet(condition) ? conditionGroupLabel(condition) : '' }
})
function openNodeMenu(payload: { nodeId: string; x: number; y: number }) {
  nodeMenu.value = {
    show: true,
    nodeId: payload.nodeId,
    x: Math.max(8, Math.min(payload.x, window.innerWidth - 220)),
    y: Math.max(8, Math.min(payload.y, window.innerHeight - 200)),
  }
  if (canSkipCondThisSend.value) void loadSendSettings()
}
function closeNodeMenu() {
  nodeMenu.value.show = false
}
function toggleSkipNode(nodeId: string) {
  skippedNodeIds.value = isNodeSkipped(nodeId)
    ? skippedNodeIds.value.filter((id) => id !== nodeId)
    : [...skippedNodeIds.value, nodeId]
  if (isNodeSkipped(nodeId)) {
    skipCondStepIds.value = skipCondStepIds.value.filter(id => id !== stepIdOfNode(nodeId))
    forceSkipCond.value = skipCondStepIds.value.length > 0
  }
}
function restoreAllSkipped() {
  skippedNodeIds.value = []
  closeNodeMenu()
}
/** 右键菜单里的「发起抓取」：按**被右键的那个节点**限定配置，不用当前选中的 */
async function sendFetchForNode(nodeId: string) {
  closeNodeMenu()
  if (!sourceId.value) return
  await snatchLauncher.value?.launch(sourceId.value, {
    configId: flow.configs[nodeId]?.configId,
    flowId: canvasFlowIdOf(flow),
    onSuccess: () => ElMessage.success('已发起抓取'),
  })
}

async function onSendFetch() {
  if (execMode.value !== 'fetch' || !sourceId.value) return
  // 不弹确认（0917-05）：SnatchLauncher.launch 内部本来就是 loadParams → 有参数弹参数框、
  // 无参数直发，与源视图那三档同一套。外面再套一层"是否继续"纯属多点一次。
  await snatchLauncher.value?.launch(sourceId.value, {
    configId: selectedCfg.value?.configId,
    flowId: canvasFlowIdOf(flow),
    onSuccess: () => ElMessage.success('已发起抓取'),
  })
}

// M3-0J：真实回执里"本次发送:N 条"是提交条数，不是实际进入条数——被目标节点进入条件
// 拒绝的数据也算在"发送"里（2026-08-18 测试环境实测，见方案 §12.1B）。原样把 message 当
// 成功 toast 弹出会把"全部被拒绝"误显示成"全部成功"，必须先解析分组。抽成共享函数是因为
// M3-0E「发本页任务」发的是同一个 nextStep 接口，回执格式完全一样，不能一个按钮解析、
// 另一个按钮不解析。
function showNextStepReceipt(res: { message?: string }) {
  const receipt = parseNextStepReceipt(res?.message || '')
  if (receipt.entries.length === 0) {
    // 解析不出任何 ok_/reject_ 分组（如全部 ID 无效）：按提交数原样展示，不假装有结果。
    ElMessage.success(res?.message || '操作已提交（演示）')
    return
  }
  // 1109-R01：`skip_`（因已执行跳过）和 `condError_`（条件表达式异常）都不是成功。
  // 尤其 condError_ 必须单独走 warning——它既没发出去、又不属于"被进入条件拒绝"，
  // 混进 success 文案就成了"把未发送显示成成功"。
  const extra: string[] = []
  if (receipt.skipCount > 0) extra.push(`${receipt.skipCount} 条因已执行跳过`)
  if (receipt.condErrorCount > 0) extra.push(`${receipt.condErrorCount} 条条件表达式异常`)
  const extraText = extra.length ? `，${extra.join('，')}` : ''
  // 强制跳过条件模式（skipCond=1）的回执口径是「共处理 / 强制跳过条件发送」，点出来才看得懂为什么放行了
  const forceText = receipt.forceSkipped > 0 ? `（强制跳过条件发送 ${receipt.forceSkipped} 条）` : ''
  if (receipt.condErrorCount > 0) {
    ElMessage.warning(`已提交 ${receipt.submitted} 条${forceText}：${receipt.okCount} 条已进入下一步${extraText}`)
  } else if (receipt.rejectCount > 0 && receipt.okCount === 0) {
    ElMessage.warning(`已提交 ${receipt.submitted} 条${forceText}，全部被目标节点的进入条件拒绝，未进入下一步${extraText}`)
  } else if (receipt.rejectCount > 0) {
    ElMessage.warning(`已提交 ${receipt.submitted} 条${forceText}：${receipt.okCount} 条已进入下一步，${receipt.rejectCount} 条被进入条件拒绝${extraText}`)
  } else {
    ElMessage.success(`已提交 ${receipt.submitted} 条${forceText}，${receipt.okCount} 条已进入下一步${extraText}`)
  }
}
// M3-0K：nextStep 失败时原始报错定位不到是哪个节点配错（旧平台节点条件语法出错会导致
// 整条请求业务失败，见方案 §12.1B）。这里统一补上当前节点名；命中后端固定措辞时才追加
// 排查提示——写保护、网络失败等其他原因不应被误导成配置问题。
function nextStepErrorHint(raw: string): string {
  if (raw.includes('运行时异常')) return '（多为该节点的进入条件表达式写错，可检查节点配置里的进入条件）'
  // 「没有详情配置」是后端按源上的 item/next 步骤链找后继时返回的真实 msg（client.test 用过）。
  // 接口入参只有 sourceId + 当前表 + 行 ID，没有 targetNodeId，也不传 isMulti——
  // 后继可以是规则节点（0812 §12.1B 实测 ok_39025 算法打标），不是必须详情页。
  if (raw.includes('没有详情配置')) {
    return '（发后续接口并不要求下一个节点必须是详情页。后端按源的步骤链找后继配置，找不到才会回这句。请核对后继步骤是否已保存且未删除；规则处理节点不用改「是否列表」。）'
  }
  return ''
}
async function withNodeErrorContext<T>(nodeName: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    throw new Error(`目标节点"${nodeName}"处理失败：${raw}${nextStepErrorHint(raw)}`)
  }
}
function buildCurrentFallbackSteps(): Step[] {
  return Object.entries(flow.configs).map(([id, cfg]) => ({
    stepId: (cfg as any).stepId || id,
    sourceId: sourceId.value,
    name: cfg.title,
    configId: cfg.configId,
    inputTable: cfg.collectCfg?.inputTable || cfg.ruleCfg?.inputTableId || cfg.inputTable,
    outputTable: cfg.collectCfg?.outputTable || cfg.ruleCfg?.outputTableId || cfg.outputTable,
    enabled: !cfg.disabled,
    topic: cfg.taskCfg?.queue,
    dependsOn: directPredecessorIds(flow.main, flow.configs, id, flow.branchGroups),
  }))
}

function buildCurrentConfigHint() {
  return {
    flowId: canvasFlowIdOf(flow),
    configId: selectedCfg.value?.configId,
    stepId: (selectedCfg.value as any)?.stepId || (/^\d+$/.test(selectedNodeId.value) ? selectedNodeId.value : undefined),
    title: selectedCfg.value?.title,
    queue: selectedCfg.value?.taskCfg?.queue,
  }
}

/** 步骤 ID → 画布节点 ID。发送参数仍使用真实步骤 ID。 */
function nodeIdOfStepId(stepId: string): string {
  const hit = Object.entries(flow.configs).find(([nodeId]) => stepIdOfNode(nodeId) === stepId)
  if (hit) return hit[0]
  return /^\d+$/.test(stepId) ? stepId : ''
}
async function loadSendSettings() {
  if (!canSkipCondThisSend.value) return
  const request = ++sendSettingRequest
  sendSettingLoading.value = true
  sendSettingError.value = ''
  try {
    const info = await fetchNextStepConfig(
      sourceId.value, selectedNodeId.value, buildCurrentFallbackSteps(), buildCurrentConfigHint(),
    )
    if (request !== sendSettingRequest) return
    sendSettingOptions.value = (info?.downstreamSteps ?? []).map(step => {
      const stepId = String(step.stepId)
      return { stepId, nodeId: nodeIdOfStepId(stepId), name: step.name || stepId,
        condition: step.condition || '', configId: step.configId }
    }).filter(opt => /^\d+$/.test(opt.stepId))
    if (!sendSettingOptions.value.length) sendSettingError.value = '当前节点没有可发送的下游节点'
  } catch (err) {
    if (request === sendSettingRequest) sendSettingError.value = (err as Error)?.message || '读取下游节点失败，请稍后重试'
  } finally {
    if (request === sendSettingRequest) sendSettingLoading.value = false
  }
}
watch(sendSettingVisible, visible => {
  if (visible) openSendSettings()
})
function openSendSettings() {
  sendSettingSearch.value = ''
  void loadSendSettings()
}
function setSendSettingMode(opt: SendSettingOption, mode: SendSettingMode) {
  if (mode === 'skipCond' && (!opt.condition || !opt.stepId || isNodeSkipped(opt.nodeId))) return
  skippedNodeIds.value = skippedNodeIds.value.filter(id => id !== opt.nodeId)
  if (mode === 'mute') skippedNodeIds.value.push(opt.nodeId)
  skipCondStepIds.value = skipCondStepIds.value.filter(id => id !== opt.stepId)
  if (mode === 'skipCond') skipCondStepIds.value.push(opt.stepId)
  forceSkipCond.value = skipCondStepIds.value.length > 0
}
function setSendTargets(options: SendSettingOption[], selected: boolean) {
  const nodeIds = new Set(options.map(opt => opt.nodeId))
  const stepIds = new Set(options.map(opt => opt.stepId))
  skippedNodeIds.value = skippedNodeIds.value.filter(id => !nodeIds.has(id))
  if (!selected) {
    skippedNodeIds.value.push(...nodeIds)
    skipCondStepIds.value = skipCondStepIds.value.filter(id => !stepIds.has(id))
    forceSkipCond.value = skipCondStepIds.value.length > 0
  }
}
function setSendConditions(ignored: boolean) {
  for (const opt of sendConditionOptions.value) setSendSettingMode(opt, ignored ? 'skipCond' : 'normal')
}
async function startSendNodeSelection() {
  await loadSendSettings()
  if (!canSkipCondThisSend.value || sendSettingLoading.value || sendSettingError.value || !sendSettingOptions.value.length) return
  sendSettingVisible.value = false
  sendSettingSearch.value = ''
  railOpen.value = true
  sendNodeSelection.value = true
}
function canSelectSendNode(nodeId: string) {
  return !sendNodeSelection.value || sendSettingOptions.value.some(opt => opt.nodeId === nodeId)
}
function setRailSendTargets(nodeIds: string[]) {
  setSendTargets(sendSettingOptions.value.filter(opt => nodeIds.includes(opt.nodeId)), true)
  setSendTargets(sendSettingOptions.value.filter(opt => !nodeIds.includes(opt.nodeId)), false)
}
/** 仅受理成功或切换发送上下文后恢复默认，失败重试保留设置。 */
function clearSendSettings() {
  ++sendSettingRequest
  skipCondStepIds.value = []
  forceSkipCond.value = false
  skippedNodeIds.value = []
  sendSettingOptions.value = []
  sendSettingVisible.value = false
  sendSettingLoading.value = false
  sendSettingError.value = ''
  sendSettingSearch.value = ''
  sendNodeSelection.value = false
}

function runNextStep(
  ids: string[],
  tableId: string,
  nodeName: string,
  configOptions?: { configId?: string; itemConfig?: string; stepId?: string; nextStep?: string; skipCond?: 0 | 1 },
) {
  return withNodeErrorContext(nodeName, () =>
    configOptions ? dataApi.nextStep(sourceId.value, tableId, ids, configOptions) : dataApi.nextStep(sourceId.value, tableId, ids),
  )
}
async function onSendNextStep() {
  if (execMode.value !== 'input' || !canExecute.value || !selectedRowIds.value.length) return
  const count = selectedRowIds.value.length
  const ids = [...selectedRowIds.value]

  // 如果是在"输入"Tab（且输入≠输出）：这是发起本节点任务！
  if (isCurrentNodeAction.value) {
    const nodeName = selectedCfg.value?.title || selectedNodeId.value
    const tableId = inputTableId.value
    if (!tableId) return
    const currentStepId = /^\d+$/.test(selectedNodeId.value) ? selectedNodeId.value : (selectedCfg.value as any)?.stepId
    const hasCurrentStepId = currentStepId && /^\d+$/.test(currentStepId)
    const currentOptions = {
      ...(selectedCfg.value?.configId ? { configId: selectedCfg.value.configId } : {}),
      ...(hasCurrentStepId ? { itemConfig: currentStepId, stepId: currentStepId, nextStep: currentStepId } : {}),
    }
    const hasCurrentOpts = Object.keys(currentOptions).length > 0
    await confirmOrRun(
      ids.length > DIRECT_ROWS_MAX,
      '发起本节点任务',
      `将对选中的 ${count} 条数据发起当前节点「${nodeName}」的处理任务。\n是否继续？`,
      async () => {
        const res = await runNextStep(ids, tableId, nodeName, hasCurrentOpts ? currentOptions : undefined)
        return res
      },
      showNextStepReceipt,
    )
    return
  }

  // 否则是在"输出"Tab 或 sameTable：这是发后续任务！
  // 必须根据当前节点请求流程的下一个节点配置（nextConfigPaged）去发任务！
  let nextInfo: Awaited<ReturnType<typeof fetchNextStepConfig>> | undefined
  try {
    nextInfo = await fetchNextStepConfig(sourceId.value, selectedNodeId.value, buildCurrentFallbackSteps(), buildCurrentConfigHint())
  } catch {
    // ignore
  }

  if (nextInfo?.allDisabled) {
    ElMessage.warning(nextInfo.reason || '后续节点已停用，无法发起后续任务')
    return
  }

  if (nextInfo && !nextInfo.hasNext && !hasSuccessor.value) {
    ElMessage.warning(nextInfo.reason || '当前节点在流程中没有后续节点配置，无法发后续')
    return
  }

  const firstSuccId = successorIds.value[0]
  const firstSuccCfg = firstSuccId ? flow.configs[firstSuccId] : undefined
  const fallbackSuccConfigId = firstSuccCfg?.configId
  const fallbackSuccStepId = (firstSuccCfg as any)?.stepId || (firstSuccId && /^\d+$/.test(firstSuccId) ? firstSuccId : undefined)

  const tableId = (nextInfo?.hasNext ? nextInfo.targetTableId : undefined) || successorTableId.value || outputTableId.value || selectedTable.value
  if (!tableId) return
  // 标了「本次不发」的先摘出去，名字、configId、itemConfig 三处都要跟着走（0917-06）
  const keptDownstream = (nextInfo?.downstreamSteps ?? [])
    .filter((step) => !skippedStepIds.value.has(String(step.stepId)))
  // 文案要跟实际发送的范围一致：发整条下游就把下游都列出来，不能只报直接后继的名字
  const downstreamNames = keptDownstream.map((s) => s.name || s.stepId).filter(Boolean)
  const targetNodeName = (downstreamNames.length ? downstreamNames.join('、') : '')
    || (nextInfo?.hasNext ? nextInfo.targetNodeName : undefined) || successorTitles.value || '后续节点'
  /**
   * `configId` 也得跳过（2026-09-21 实测发现）：默认它取 `primaryNext` 的配置，
   * 而 primaryNext 恰好可能正是被标「本次不发」的那个——实测请求里出现过
   * `itemConfig=40598` 配 `configId=1400974`（40597 的配置）这种自相矛盾的组合。
   * 后端到底优先看哪个我们不知道，**不赌**：直接改指第一个真正要发的节点。
   */
  const keptConfigId = keptDownstream.find((step) => step.configId)?.configId
  const targetConfigId = (skippedStepIds.value.size ? keptConfigId : undefined)
    || (nextInfo?.hasNext ? nextInfo.targetConfigId : undefined) || fallbackSuccConfigId
  // 发**整条下游**，不是只发直接后继（2026-09-17 定）。后端实测：传单个 stepId 只发那一个，
  // 不会沿链路带下游；传逗号串则按步骤分别派发。算不出下游时退回单个后继，保持旧行为。
  // 本次不发的节点从下游集合里剔除（0917-06）：只剔它自己，它后面的照发。
  // 后端真正按 `itemConfig`（逗号分隔的 stepId）逐个派发，所以在这一层过滤就够；
  // configId 仍指向 primaryNext，那只是辅助定位——**若实测发现它影响派发目标，
  // 就得把 skip 透传进 fetchNextStepConfig 从 enabledSuccessors 起排除**。
  const downstreamIds = keptDownstream
    .map((s) => String(s.stepId))
    .filter((id) => /^\d+$/.test(id))
  const singleStepId = (nextInfo?.hasNext ? nextInfo.targetStepId : undefined) || fallbackSuccStepId
  const targetStepId = downstreamIds.length
    ? downstreamIds.join(',')
    : singleStepId
  const hasTargetStepId = !!targetStepId && /^[\d,]+$/.test(targetStepId)
  const fanout = (nextInfo?.branchHint ? `\n这批数据会按各后继节点的进入条件分流到：${nextInfo.branchHint}` : '') ||
    (branchTargets.value.length ? `\n这批数据会按各后继节点的进入条件分流到：${branchTargets.value.map((t) => `${t.title}（${t.condition}）`).join('、')}` : '')

  /**
   * 1109-R01 按节点：本次实际跳过的步骤 = 弹窗勾选集 ∩ 本次发送范围。
   * 勾了又标「本次不发后续」的节点会自动失效（它本来就不发，谈不上跳过条件）。
   */
  const skipPlan = planSkipCondSend(downstreamIds, forceSkipCond.value ? skipCondStepIds.value : [])
  const skipSendIds = skipPlan.skipIds
  const normalSendIds = skipPlan.normalIds
  const skipCondActive = skipSendIds.length > 0
  // 后端只有整批 `skipCond=1`：既要跳一部分、又要正常发另一部分时拆两次请求。
  // 覆盖全部目标节点就只发一次（等于旧整批行为），少一次网络往返与一次失败面。
  const splitSend = skipPlan.split
  const skipSendNames = keptDownstream
    .filter((step) => skipSendIds.includes(String(step.stepId)))
    .map((step) => step.name || step.stepId)
    .join('、')

  const configOptions = {
    ...(targetConfigId ? { configId: targetConfigId } : {}),
    ...(hasTargetStepId ? { itemConfig: targetStepId, stepId: targetStepId, nextStep: targetStepId } : {}),
    // 1109-R01：只有真的指定了目标步骤才传 skipCond——没有 itemConfig 时后端会防御性忽略该参数
    // （InfoSourceController:2310-2313），传了会让确认文案说"已跳过"而实际没跳过。
    // 拆两次时不走这条整批请求，skipCond 由 skip 那批自己带。
    ...(skipPlan.skipCond && hasTargetStepId ? { skipCond: 1 as const } : {}),
  }
  const hasOpts = Object.keys(configOptions).length > 0
  const skipCondHint = !skipCondActive
    ? ''
    : splitSend
      ? `\n本次只忽略这些节点的进入条件：${skipSendNames}；其余 ${normalSendIds.length} 个节点照常判断条件。`
        + `\n（后端只有整批跳过参数，会拆成两次发送：先发忽略条件的节点，再发正常判断的节点；不改节点保存的条件，发完自动关闭。）`
      : `\n本次将跳过「${targetNodeName}」的进入条件判断（不改节点保存的条件，发完自动关闭）。`
  // 开关开着但没有可指定的步骤：别让请求悄悄退回"普通发送"，用户会以为条件已被跳过
  if (forceSkipCond.value && !hasTargetStepId) {
    ElMessage.warning('当前找不到可指定的目标步骤，「本次跳过条件」无法生效，请先刷新后重试')
    return
  }
  // 弹窗里勾的节点全被「本次不发」摘掉了：这时不能静默退回普通发送，得让用户知道开关没生效
  if (forceSkipCond.value && hasTargetStepId && !skipCondActive && downstreamIds.length) {
    ElMessage.warning('已勾选跳过的节点不在本次发送范围内（可能刚标了「本次不发后续」），请重新选择')
    return
  }

  // 整条下游都被标了"本次不发"：别发一个空 itemConfig 出去（后端会当成"发所有下一步"，
  // 正好跟用户的意图相反）
  if (skippedStepIds.value.size && !downstreamIds.length
    && ((nextInfo?.downstreamSteps?.length ?? 0) > 0 || !singleStepId || skippedStepIds.value.has(String(singleStepId)))) {
    ElMessage.warning('这条下游的节点都标了「本次不发」，没有可发的节点')
    return
  }

  // 有分支分流时**必须确认**：分流去了哪几个节点是用户不知道的信息，
  // 不能因为只勾了两条就把它咽掉（0917-05 口径）
  // 拆两次请求是用户看不到的实现细节，必须先说清楚再发（和"分流去向"同理，别咽掉）
  await confirmOrRun(
    ids.length > DIRECT_ROWS_MAX || !!fanout || splitSend,
    '发后续任务',
    `将对选中的 ${count} 条数据发起后续节点「${targetNodeName}」的处理任务。${fanout}${skipHintText.value}${skipCondHint}\n是否继续？`,
    async () => {
      // 单批（含"全部跳过"与"完全不跳过"）：保持一次请求，行为和旧平台一致
      if (!splitSend) {
        const res = await withNodeErrorContext(targetNodeName, () =>
          hasOpts ? dataApi.nextStep(sourceId.value, tableId, ids, configOptions) : dataApi.nextStep(sourceId.value, tableId, ids),
        )
        // 受理成功才清：失败时保留勾选，用户可以直接重试同一批（不至于悄悄变回正常条件判断）
        clearSendSettings()
        return res
      }
      /**
       * 拆两次：后端 `nextStep` 按 `itemConfig` 逐节点独立建任务（7 个 stepId 就是 7 组回执，
       * 互不依赖），配不同 `configId` 也不会撞 `hasExecNext` 幂等检查，所以"跳过组一次 +
       * 正常组一次"与"一次请求里逐节点判断"等价。先发跳过组：它放行的节点若失败，
       * 后面正常组还没发，用户重试代价小。
       */
      const runBatch = async (batchIds: string[], withSkip: boolean) => {
        const batchItem = batchIds.join(',')
        const batchConfigId = keptDownstream
          .find((step) => batchIds.includes(String(step.stepId)) && step.configId)?.configId
          || targetConfigId
        return withNodeErrorContext(targetNodeName, () => dataApi.nextStep(sourceId.value, tableId, ids, {
          ...(batchConfigId ? { configId: batchConfigId } : {}),
          itemConfig: batchItem,
          stepId: batchItem,
          nextStep: batchItem,
          ...(withSkip ? { skipCond: 1 as const } : {}),
        }))
      }
      const skipRes = await runBatch(skipSendIds, true)
      // 跳过组的回执先单独展示（口径是"共处理/强制跳过条件发送"），正常组的回执交给 onSuccess
      showNextStepReceipt(skipRes)
      const normalRes = await runBatch(normalSendIds, false)
      clearSendSettings()
      return normalRes
    },
    showNextStepReceipt,
  )
}

async function onSendUpstream() {
  if (execMode.value !== 'upstream' || !canExecute.value || !selectedTable.value || !selectedRowIds.value.length) return
  const predName = predecessorTitle.value
  const picked = rows.value.filter((row) => selectedRowIds.value.includes(row.dataId))
  const sameTableAsPred = !!predecessorTableId.value && predecessorTableId.value === selectedTable.value
  let tableId = selectedTable.value
  let ids = [...selectedRowIds.value]
  let skipped = 0
  if (!sameTableAsPred) {
    const withParent = picked.filter((row) => row.parentId && row.parentId !== '0')
    skipped = picked.length - withParent.length
    ids = [...new Set(withParent.map((row) => String(row.parentId)))]
    tableId = predecessorTableId.value
  }
  if (!ids.length || !tableId) {
    ElMessage.warning(skipped ? `${skipped} 条缺少父 ID，无法从上一节点重跑` : '没有可发送的数据')
    return
  }
  const skipHint = skipped ? `（另有 ${skipped} 条缺少父 ID，已跳过）` : ''
  const predId = predecessorId.value
  const predCfg = predId ? flow.configs[predId] : undefined
  const predStepId = (predCfg as any)?.stepId || (predId && /^\d+$/.test(predId) ? predId : undefined)
  const hasPredStepId = predStepId && /^\d+$/.test(predStepId)
  const predOptions = {
    ...(predCfg?.configId ? { configId: predCfg.configId } : {}),
    ...(hasPredStepId ? { itemConfig: predStepId, stepId: predStepId, nextStep: predStepId } : {}),
  }
  const hasPredOpts = Object.keys(predOptions).length > 0
  await confirmOrRun(
    ids.length > DIRECT_ROWS_MAX,
    '从上一节点重跑',
    `将从上一节点「${predName}」重新发起 ${ids.length} 条${skipHint}。重跑结果需等任务完成后刷新。是否继续？`,
    async () => {
      const res = await runNextStep(ids, tableId, predName, hasPredOpts ? predOptions : undefined)
      selectedRowIds.value = []
      return res
    },
    showNextStepReceipt,
  )
}
// ⚠️ 0903 Y0-B：**发任务只保留两档**——「按勾选发」和「按当前条件全部发」。
// 「发本页任务」「发大量后续」两项已删除（会上原话：「什么发本页发大量什么这是？不要把它全抄
// 过来」）。它们都是旧平台 EntryList2 的按钮，迁过来只是"能抄就抄"，语义和"发全部"高度重叠：
// 发本页 = 发全部的一个任意子集（页大小决定，不是业务条件）；发大量 = 发全部再加一套跟主筛选
// 不共用的独立字段，用户要在两套条件之间来回对照。**不要因为旧平台有就加回来。**
//
// 注意：`views/DataView/index.vue`（旧平台 EntryList2 的 1:1 迁移页）**不在此列**，
// 那一页的按钮是迁移契约的一部分，保持原样。
//
// 收敛成两个并排按钮之后，原来那套「Teleport 到 body + fixed 定位」的下拉面板机制一并删除
// （它存在的唯一原因是 .dg-head 的 overflow-x:auto 会裁掉绝对定位的下拉面板；没有面板就
// 没有这个问题）。将来若要再往这行加第三个动作，**先想清楚它是不是真的和前两档并列**，
// 不要为了塞按钮把下拉又请回来。
// 发全部后续（M3-0G 复议，2026-08-19）：旧平台硬编码 size=500000、start=0，用户不填任何
// 数量，只受当前筛选条件约束（sourceId 天然由具体源页面锁定）。数量不可调，唯一的防护
// 就是确认框把量级说清楚，不能悄悄把 50 万条包装成"点一下就发"。
//
// ⚠️ **「当前条件」是打折的**（0903 发现）：`nextStep2` 的参数里只有 state / cond / start /
// end / nextFlag，**没有 dataId、更没有 parentId**。筛选区有 4 个框，这条只认其中 2 个
// （状态、SQL 条件）。填了数据 ID 或父 ID 却照发，发出去的就是**整张表**，而按钮上写着
// "当前条件"——名不副实且后果很大。
//
// 这个坑在 0903 Y1 之后被放大了：点「下级」条数会自动填上 `父 ID = 当前行` 再跳过去，
// 用户看到 5 行、点「发全部」，实际发几万条。
//
// 现在的处置：**填了这两个条件就禁用**（下面的 sendAllBlockedReason），并在 title 里说明
// 为什么、该改用什么。把 parentId 塞进 cond 拼成 `PARENT_ID='x'` 是另一条路，但那等于把
// 用户没写过的条件偷偷混进他的 SQL，报错时会指向一个他没写过的东西，不做。
// 要真正支持，需要后端在 nextStep2 上加 parentId（已并入 0903 后端需求 H9 一起问）。
const sendAllBlockedReason = computed(() => {
  if (!isCurrentNodeAction.value && sendSettingBadge.value) return '本次发送设置仅支持勾选数据后发后续，请先恢复全部发送并取消忽略条件'
  if (filters.dataId && filters.parentId) return '「发全部」不支持按数据 ID / 父 ID 筛选，请改用勾选后「发后续任务」'
  if (filters.dataId) return '「发全部」不支持按数据 ID 筛选，请改用勾选后「发后续任务」'
  if (filters.parentId) return '「发全部」不支持按父 ID 筛选，请改用勾选后「发后续任务」'
  return ''
})
async function onSendAllUnderFilter() {
  if (execMode.value !== 'input' || !canPickRows.value) return
  if (sendAllBlockedReason.value) return
  // 1109-R01：批量接口 nextStep2 没有 skipCond（对应旧组件 skipCondUnavailableTip「批量接口暂不支持」）。
  // 开关在工具栏上是共用的，这里必须**明确挡住**——否则用户勾了"本次跳过条件"再点"发全部"，
  // 条件照常判断、数据被静默拒绝，看起来像功能失效。
  if (forceSkipCond.value) {
    ElMessage.warning('「发全部」暂不支持忽略进入条件：请先在节点菜单取消忽略条件，或改用勾选数据后的「发后续」')
    return
  }

  if (isCurrentNodeAction.value) {
    const nodeName = selectedCfg.value?.title || selectedNodeId.value
    const tableId = inputTableId.value
    if (!tableId) return
    const currentStepId = /^\d+$/.test(selectedNodeId.value) ? selectedNodeId.value : (selectedCfg.value as any)?.stepId
    await confirmDanger(
      '发全部本节点',
      `[实验性] 将对当前筛选条件下"${nodeName}"的全部输入数据发起处理（命中 ${total.value} 条，最多 500000 条），是否继续？`,
      () => withNodeErrorContext(nodeName, () => dataApi.nextStepBatch({
        tableId, sourceId: sourceId.value,
        ...(selectedCfg.value?.configId ? { configId: selectedCfg.value.configId } : {}),
        ...(currentStepId ? { itemConfig: currentStepId, stepId: currentStepId } : {}),
        state: filters.state || undefined,
        cond: filters.sql || undefined,
        size: 500000, start: 0,
      })),
      showNextStepReceipt,
    )
    return
  }

  let nextInfo: Awaited<ReturnType<typeof fetchNextStepConfig>> | undefined
  try {
    nextInfo = await fetchNextStepConfig(sourceId.value, selectedNodeId.value, buildCurrentFallbackSteps(), buildCurrentConfigHint())
  } catch {
    // ignore
  }

  if (nextInfo?.allDisabled) {
    ElMessage.warning(nextInfo.reason || '后续节点已停用，无法发起后续任务')
    return
  }

  if (nextInfo && !nextInfo.hasNext && !hasSuccessor.value) {
    ElMessage.warning(nextInfo.reason || '当前节点在流程中没有后续节点配置，无法发全部后续')
    return
  }

  const firstSuccId = successorIds.value[0]
  const firstSuccCfg = firstSuccId ? flow.configs[firstSuccId] : undefined
  const fallbackSuccConfigId = firstSuccCfg?.configId
  const fallbackSuccStepId = (firstSuccCfg as any)?.stepId || (firstSuccId && /^\d+$/.test(firstSuccId) ? firstSuccId : undefined)

  const tableId = (nextInfo?.hasNext ? nextInfo.targetTableId : undefined) || successorTableId.value || outputTableId.value || selectedTable.value
  if (!tableId) return
  const targetNodeName = (nextInfo?.hasNext ? nextInfo.targetNodeName : undefined) || successorTitles.value || '后续节点'
  const targetConfigId = (nextInfo?.hasNext ? nextInfo.targetConfigId : undefined) || fallbackSuccConfigId
  const targetStepId = (nextInfo?.hasNext ? nextInfo.targetStepId : undefined) || fallbackSuccStepId
  await confirmDanger(
    '发全部后续',
    `[实验性] 将对当前筛选条件下"${targetNodeName}"的全部数据发起后续处理（命中 ${total.value} 条，最多 500000 条），是否继续？`,
    () => withNodeErrorContext(targetNodeName, () => dataApi.nextStepBatch({
      tableId, sourceId: sourceId.value,
      ...(targetConfigId ? { configId: targetConfigId } : {}),
      ...(targetStepId && /^\d+$/.test(targetStepId) ? { itemConfig: targetStepId, stepId: targetStepId } : {}),
      state: filters.state || undefined,
      cond: filters.sql || undefined,
      size: 500000, start: 0,
    })),
    showNextStepReceipt,
  )
}

// ---- 删除数据（2026-09-09 从数据中心迁入）----
// 数据中心那套下拉共 9 项，这里**只迁 4 项**：删除该源当日/所有、删除选中、行内删单条。
// 刻意不迁的两类：
//   ① 「清空表数据【当日/全量】」——不带 sourceId 的整表删除。在源视图里危险性质变了：
//      selectedTable 是节点的输入/输出表，同网站多个源共用一张表是常态（详情节点都写 900），
//      在「某个源」的页面上点一下清掉全网站所有源的数据，杀伤范围远超这个页面的语义。
//      表是主语的动作留在数据中心。
//   ② 「设为正式表」——表级配置切换，不是数据视图的职责。
// 与数据中心一致的门禁：仅测试表可删（方案 §1.4-4）。
const isTestTable = computed(() => meta.value?.state === 'C')

const deleteError = ref<{ tableId: string; message: string; detail: string } | null>(null)

function reportDeleteError(err: unknown, tableId: string) {
  const cause = err instanceof ApiError ? err.cause : err
  const reason = cause instanceof Error ? cause.message : '操作失败，请重试'
  const message = reason.includes('当前账号无该表删除权限')
    ? `删除失败：当前账号无表 ${tableId} 的删除权限`
    : `删除失败：${reason.replace(/^错误信息[:：]\s*运行时异常[:：]?\s*/, '')}`
  deleteError.value = { tableId, message, detail: err instanceof Error ? err.message : String(err) }
}

/** 删除后统一回到第 1 页重查：删掉的行可能横跨当前页，留在原页会看到空洞或错位的分页。 */
function afterDelete() {
  selectedRowIds.value = []
  runQuery()
}

function onDeleteSelected() {
  if (!selectedRowIds.value.length || !selectedTable.value) return
  const tableId = selectedTable.value
  const ids = [...selectedRowIds.value]
  deleteError.value = null
  void confirmDanger(
    '警告',
    `[实验性]，批量删除选中的数据,共[${ids.length} ] 条记录? 表:${tableId}`,
    async () => {
      const r = await dataApi.rowDeleteBatch(tableId, ids)
      if (r.success === 0) ElMessage.warning('未能改变数据, 可能原因:\n【未找到对应ID】')
      return { message: `成功，删:${r.success}, 共:${r.all}, 未找到:${r.not_found}` }
    },
    (res) => {
      ElMessage.success(res?.message || '删除成功')
      afterDelete()
    },
    (err) => reportDeleteError(err, tableId),
  )
}

/** all=0 当日 / all=1 所有。始终带 sourceId——这个页面就是单源视图，不提供跨源删除。 */
function onDeleteByRange(all: 0 | 1) {
  if (!selectedTable.value || !sourceId.value) return
  const tableId = selectedTable.value
  const sid = sourceId.value
  const rangeText = all === 1 ? '所有' : '当天'
  deleteError.value = null
  void confirmDanger(
    '确认删除',
    `确认删除该源【${rangeText}】数据，源[${source.value?.name || sid}], 表:${tableId}，注意删除后无法恢复`,
    async () => {
      const r = await dataApi.rowDelete(tableId, { sourceId: sid, all })
      if (!r.success) ElMessage.warning('未能改变数据, 可能原因:\n【数据超过14天或未找到对应ID】')
      return { message: `删除该源[${all === 1 ? '所有' : '当日'}]成功，清除条数:${r.success ?? 0}` }
    },
    (res) => {
      ElMessage.success(res?.message || '删除成功')
      afterDelete()
    },
    (err) => reportDeleteError(err, tableId),
  )
}

function onDeleteOne(row: DataRow) {
  if (!selectedTable.value) return
  const tableId = selectedTable.value
  deleteError.value = null
  void confirmDanger(
    '确认删除',
    `确认删除一条:${row.dataId} / 是否确认删除数据？ 【删除后无法恢复】`,
    async () => {
      const r = await dataApi.rowDelete(tableId, { sourceId: row.sourceId || sourceId.value, all: 1, entryId: row.dataId })
      if (!r.success) ElMessage.warning('未能改变数据, 可能原因:\n【数据超过14天或未找到对应ID】')
      return { message: '删除成功' }
    },
    (res) => {
      ElMessage.success(res?.message || '删除成功')
      afterDelete()
    },
    (err) => reportDeleteError(err, tableId),
  )
}

// 默认选**首个可跑节点**。页签快照恢复用户上次选中的节点、筛选与页码。
// 解决切换到任务视图/其他视图再切回时选中的节点被重置为初始节点的问题。
// URL `nodeId`（任务视图跳过来、查看条件深链）仍然优先。
watch(
  allNodes,
  (nodes) => {
    if (!nodes.some((n) => n.id === selectedNodeId.value)) {
      const firstId = nodes[0]?.id || ''
      const fromQuery = queryNodeId.value && nodes.some((n) => n.id === queryNodeId.value) ? queryNodeId.value : ''
      const snap = ws.snapshotOf(tabKey.value)
      const snapId = snap?.selectedNodeId && nodes.some((n) => n.id === snap.selectedNodeId) ? snap.selectedNodeId : ''
      const tableNodes = outputTables.value.find(t => t.id === tableChoice.value)?.nodeIds ?? []
      const targetId = browseMode.value === 'table' ? (tableNodes.length === 1 ? tableNodes[0]! : '') : fromQuery || snapId || firstId
      selectedNodeId.value = targetId
      if (flow.selectedId !== targetId) {
        flow.select(targetId)
      }
      if (!fromQuery && snapId === targetId) {
        page.value = snap?.page ?? 1
        if (snap?.filters) {
          const { dataId, parentId, state, sql } = snap.filters
          Object.assign(filters, { dataId, parentId, state, sql })
        }
      } else {
        page.value = 1
      }
      scope.value = defaultScope()
    }
  },
  { immediate: true },
)

// 手动切节点（节点轨道 / 下拉框都走这一个入口，0812 计划 M2-9）：范围、页码、条件展开态
// 一并重置，不残留上一个节点的浏览状态串到新节点上。
function onSelectNode(id: string) {
  ui.clearInspectorFieldFilter()
  if (id === selectedNodeId.value) return
  selectedNodeId.value = id
  if (browseMode.value === 'table' && id) {
    const cfg = allNodes.value.find(n => n.id === id)?.cfg
    const table = cfg ? nodeOutputTable(cfg) : ''
    if (table) tableChoice.value = table
  }
  // 与右侧节点配置联动（0904 I10 / Z3-2，用户 2026-09-05 补充「点击中间的流程需要跟右侧联动」）：
  // 三栏之后右侧常驻节点配置，点中间轨道上的节点，右边就该跟着换成这个节点的配置——
  // 否则会出现"左边在看 A 的数据、右边在改 B 的配置"这种最容易误操作的状态。
  flow.select(id)
  scope.value = defaultScope()
  page.value = 1
  selectedRowIds.value = []
  sortField.value = ''
  sortOrder.value = ''
}
function selectTable(id: string) {
  tableChoice.value = id
  if (browseMode.value === 'table') {
    const query = { ...route.query }
    delete query.nodeId
    if (id) query.tableId = id
    else delete query.tableId
    if (route.query.nodeId || route.query.tableId !== query.tableId) void router.replace({ path: route.path, query })
  }
  const nodes = outputTables.value.find(t => t.id === id)?.nodeIds ?? []
  onSelectNode(nodes.length === 1 ? nodes[0]! : '')
  scope.value = 'output'
  page.value = 1
  selectedRowIds.value = []
  sortField.value = ''; sortOrder.value = ''
  ui.clearInspectorFieldFilter()
}
function switchBrowseMode(mode: DataBrowseMode) {
  if (mode === browseMode.value) return
  const table = selectedTable.value
  browseMode.value = mode
  writeDataBrowseMode(mode)
  railOpen.value = false
  if (mode === 'table') selectTable(outputTables.value.some(t => t.id === table) ? table : outputTables.value[0]?.id ?? '')
  else {
    const query = { ...route.query }
    delete query.tableId
    delete query.nodeId
    void router.replace({ path: route.path, query })
    const nodes = outputTables.value.find(t => t.id === table)?.nodeIds ?? []
    onSelectNode(nodes[0] ?? allNodes.value[0]?.id ?? '')
    scope.value = 'output'
    page.value = 1
  }
}
watch(tableChoice, dataTableId => {
  if (tabKey.value) ws.saveSnapshot(tabKey.value, { dataTableId })
}, { immediate: true })
watch(() => route.query.tableId, value => {
  const id = String(value ?? '')
  if (outputTables.value.some(t => t.id === id)) { browseMode.value = 'table'; selectTable(id) }
})
// 反向联动：从画布切到数据视图时，右侧已经选中的节点应当就是中间默认看的那个。
watch(() => flow.selectedId, (id) => {
  if (browseMode.value === 'step' && id && id !== selectedNodeId.value && allNodes.value.some((n) => n.id === id)) onSelectNode(id)
})

watch(queryNodeId, (id) => {
  if (id && allNodes.value.some((n) => n.id === id)) { browseMode.value = 'step'; onSelectNode(id) }
})

watch(queryDataId, (dataId) => {
  if (dataId && dataId !== filters.dataId) {
    filters.dataId = dataId
    runQuery()
  }
})

// 条件改了但还没查：上一次的结果（尤其是失败态）此刻已经不对应输入框里的条件了。
// 不清理的话表现极具误导性——2026-08-20 实测：输入一个错的条件回车失败后，
// 把输入框清空、重新打字，那条"真实数据接口暂不可用"和 0 行的空表格一直挂着不走，
// 看起来就像"边打字边查、而且一直报错"。所以条件一变就把失效的结果状态换成待查询提示。
const filtersDirty = ref(false)
watch(() => ({ ...filters }), () => { filtersDirty.value = true })

// 慢查询提示（0819 N3-3，会议 12:00"数量大的话查询都查崩掉"）：大表上一次范围过宽的查询
// 可能跑很久，页面除了转圈没有任何交代，用户不知道是卡死了还是还在跑。超过阈值就提示可以
// 缩小范围，但**不中断请求**——结果还是要的，中断了等于白等。
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
onBeforeUnmount(stopSlowTimer)

// 后端的 SQL 报错是整段 MyBatis 异常：真正有用的是 `Unknown column 'title' in 'where clause'`
// 这一句，前后还裹着 jar 路径、mapper 类名、参数占位的 SQL，实测一千多字，整段铺在提示条上
// 没法看。这里抽出首要原因显示，完整原文挂 title 悬浮，排查时仍拿得到。
function briefError(message: string): string {
  const m = message.match(/SQLSyntaxErrorException:\s*([^#;]+)/)
    || message.match(/Cause:\s*([^#;]+)/)
    || message.match(/错误信息:\s*([^#;]+)/)
  return m ? m[1].trim() : message
}
const dataErrorFull = ref('')

// 排序（迁移旧平台 EntryList2.vue 的 @sort-change，0819 补迁）：状态由本页持有，
// DataGrid 只负责显示与派发；载荷拼装在 api/index.ts，与旧平台同为 `(列名+ 0)` + ASC/DESC。
const sortField = ref('')
const sortOrder = ref<'ascend' | 'descend' | ''>('')
// 旧平台按总行数 > 50 万关掉业务列排序（watch pageForm.total → allSort）：K 列没有索引，
// 大表上排序会拖垮库。ENTRY_ID / SOURCE_ID / STATE 这些固定列不受限，旧平台也是始终可排。
const allowColumnSort = computed(() => total.value <= 500000)
function onSortChange(field: string, order: 'ascend' | 'descend' | '') {
  sortField.value = field
  sortOrder.value = order
  page.value = 1
  void loadData()
}

// 浏览状态实时写入源页签快照，切换后恢复。
watch([selectedNodeId, page, () => ({ ...filters })], () => {
  const key = tabKey.value
  if (key) ws.saveSnapshot(key, { selectedNodeId: selectedNodeId.value, page: page.value, filters: { ...filters } })
})

// 「本次跳过条件」是一次性动作（1109-R01 验收：再次普通发送必须恢复原行为）：
// 换源 / 换节点 / 换读的流程版本都清掉，别让上一次的放行状态跟着走。
// 它刻意不进快照——恢复页签时如果需要，得重新勾一次，避免以为"这次还在跳过"。
watch([sourceId, selectedNodeId, () => canvasFlowIdOf(flow), () => flowVersion.viewVersionId], () => {
  clearSendSettings()
})

// 表元 + 数据
const meta = ref<DataTableMeta | null>(null)
// 默认列收敛（0831 F10）：只显示后继节点真正会读到的字段。算不出来（末节点 / 三处配置都空）
// 时返回空数组，DataGrid 据此退回全部列——现网大量源的 contextMap 和进入条件都还没填，
// 这个功能对它们等于不生效，但不能让它们看到一张空表。
const presetCols = computed(() => nextStepColumns({
  columns: meta.value?.fields ?? [],
  main: flow.main,
  configs: flow.configs,
  branchGroups: flow.branchGroups,
  nodeId: selectedNodeId.value,
}))
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
const rows = ref<DataRow[]>([])
const total = ref(0)
const loading = ref(false)
const metaError = ref('')
const dataError = ref('')
const demoFallback = ref(false)
// M3-0F：旧平台页大小是 [20,40,100,200]，这里此前写死 20——不只是少个控件，是真实能力
// 缩水：「发后续任务」按当页勾选发送，20 条封顶时旧平台用户能勾 200 条一次发完，这里要翻
// 10 次页各勾一次。
const PAGE_SIZES = [20, 40, 100, 200]
const size = ref(PAGE_SIZES[0])

function inferTableMeta(tableId: string, dataRows: DataRow[], rowCount: number): DataTableMeta {
  const samples = new Map<string, unknown>()
  dataRows.forEach((row) => {
    Object.entries(row.values ?? {}).forEach(([prop, value]) => {
      if (!samples.has(prop)) samples.set(prop, value)
    })
  })
  return {
    tableId,
    tableName: tableId,
    rowCount,
    fields: [...samples.entries()].map(([prop, sample]) => ({
      prop,
      type: sample !== null && typeof sample === 'object' ? 'json' : typeof sample === 'number' ? 'number' : 'string',
      desc: prop,
      sample: sample == null ? undefined : String(sample),
    })),
  }
}

// 请求竞态保护（0812 计划 M2-9）：节点/范围/表切换很快，后发的请求不一定后到——
// 用单调递增的 requestId 让每次调用只认自己发起时的最新一次，过期响应直接丢弃，
// 不会用旧节点/旧范围的数据覆盖用户已经切换到的新节点。
let requestId = 0
async function loadData() {
  const id = ++requestId
  // 行集合即将变化（换节点/范围/筛选/翻页），已勾选的行 id 不再对应当前展示内容，清空——
  // 不做"跨页累积勾选"，方案 §6.7-B 没有这个要求，避免带来"发的是哪些数据"的困惑。
  selectedRowIds.value = []
  if (detail.visible) closeDetail()
  if (!selectedTable.value) {
    meta.value = null
    rows.value = []
    total.value = 0
    metaError.value = ''
    dataError.value = ''
    dataErrorFull.value = ''
    demoFallback.value = false
    loading.value = false
    stopSlowTimer()
    return
  }
  loading.value = true
  startSlowTimer()
  metaError.value = ''
  dataError.value = ''
  demoFallback.value = false
  try {
    // 表结构与数据是两条独立能力：后端某张表未注册时 tableMeta 可能失败，
    // 不能连带阻断仍可返回的数据行（例如演示流程的输出表）。
    const query = {
      tableId: selectedTable.value,
      siteId: siteId.value || undefined,
      sourceId: sourceId.value,
      dataId: filters.dataId || undefined,
      parentId: filters.parentId || undefined,
      state: filters.state || undefined,
      sql: filters.sql || undefined,
      sortField: sortField.value || undefined,
      sortOrder: sortOrder.value || undefined,
      page: page.value,
      size: size.value,
    }
    let [metaRes, dataRes] = await Promise.allSettled([
      dataApi.tableMeta(selectedTable.value),
      dataApi.rowQueryPaged(query),
    ])
    if (id !== requestId) return
    // 真实请求失败时，先把失败原因留下来——它一直都在（client.ts 会把 4xx/5xx 响应体里的
    // 后端 msg 解出来拼成 `请求失败 500: xxx`），此前却被下面的回退整个盖成一句
    // "真实数据接口暂不可用"，把"你的 SQL 条件写错了"说成"服务挂了"，用户完全无从判断。
    const failReason = (r: PromiseSettledResult<unknown>) =>
      (r.status === 'rejected' ? String((r.reason as Error)?.message || r.reason || '') : '')
    const dataSucceeded = dataRes.status === 'fulfilled'
    const dataFail = failReason(dataRes)
    const metaFail = failReason(metaRes)

    // 默认是 Mock + 已联调端点走真实后端：演示流程的表可能只存在本地种子数据，失败时回退
    // 到种子数据看一眼是有意义的。但**连着生产后端时绝不回退**：页面顶着"生产环境"徽标
    // 却显示本地演示数据，只靠一行小字提示，误判成真实数据是迟早的事——宁可空着报错。
    if (isMockMode() && !isProductionBackend() && (metaRes.status === 'rejected' || dataRes.status === 'rejected')) {
      const [fallbackMeta, fallbackData] = await Promise.allSettled([
        dataApi.tableMeta(selectedTable.value, { mode: 'mock' }),
        dataApi.rowQueryPaged(query, { mode: 'mock' }),
      ])
      if (id !== requestId) return
      if (fallbackMeta.status === 'fulfilled' && fallbackMeta.value) metaRes = fallbackMeta
      if (fallbackData.status === 'fulfilled') dataRes = fallbackData
      demoFallback.value = fallbackMeta.status === 'fulfilled' || fallbackData.status === 'fulfilled'
    }
    if (metaRes.status === 'fulfilled' && metaRes.value) {
      meta.value = metaRes.value
    } else {
      meta.value = dataRes.status === 'fulfilled'
        ? inferTableMeta(selectedTable.value, dataRes.value.list ?? [], dataRes.value.total ?? 0)
        : null
      metaError.value = demoFallback.value
        ? `真实数据接口暂不可用，已切换到本地演示数据${metaFail || dataFail ? `（${briefError(metaFail || dataFail)}）` : ''}`
        : meta.value?.fields.length
          ? '表结构暂不可用，已根据当前数据生成列'
          : `表结构暂不可用，暂无法展示字段${metaFail ? `（${metaFail}）` : ''}`
    }
    if (demoFallback.value) {
      metaError.value = `真实数据接口暂不可用，已切换到本地演示数据${metaFail || dataFail ? `（${briefError(metaFail || dataFail)}）` : ''}`
    }
    if (dataRes.status === 'fulfilled') {
      if (dataSucceeded) rememberSqlCondition(query.tableId, query.sql)
      rows.value = dataRes.value.list ?? []
      total.value = dataRes.value.total ?? 0
    } else {
      rows.value = []
      total.value = 0
      // 把后端的真实报错摆出来：SQL 条件写错时这里是「Unknown column 'title'」之类，
      // 比一句“请重试”有用得多——重试多少次结果都一样。
      dataErrorFull.value = dataFail
      dataError.value = dataFail ? briefError(dataFail) : '数据加载失败，请点击“查询”重试'
    }
  } finally {
    if (id === requestId) {
      loading.value = false
      filtersDirty.value = false
      stopSlowTimer()
    }
  }
}
// ---- 「下级」条数（0903 H10/Y1-B）----
// 每行在后继节点里产出了几条。整页一次 GROUP BY 拿回来，不是一行发一枪。
const childTargets = computed(() => resolveChildTargets(
  { main: flow.main, configs: flow.configs, branchGroups: flow.branchGroups },
  selectedNodeId.value,
))
// 末节点 / 后继没有输出表 → 整列不渲染。显示一整列 `—` 会让人以为"数据没跑出来"，
// 而实际是"这里本来就没有下一层"。
const showChildCol = computed(() => childTargets.value.length > 0)
const childCounts = ref<Map<string, ChildCountCell> | null>(null)
const childCountsError = ref('')
let childRequestId = 0
async function loadChildCounts() {
  const id = ++childRequestId
  childCountsError.value = ''
  if (!showChildCol.value || !rows.value.length) {
    childCounts.value = new Map()
    return
  }
  // 降级模式（H5 实测不通过时切 CHILD_COUNT_MODE）：整页预取会变成 20 次请求，翻页就打 20 枪。
  // 那种情况下不预取，列显示 `—`，等 Y1 后续按行懒加载。
  if (isPerRowMode()) {
    childCounts.value = new Map()
    return
  }
  const result = await fetchChildCountsForPage(childTargets.value, rows.value.map((r) => r.dataId))
  if (id !== childRequestId) return
  childCounts.value = result
  if (result === null) childCountsError.value = '下级条数统计失败（不影响数据本身）'
}
// 统计跟在数据之后单独触发：它失败不能拖累主表，所以不并进 loadData 的 try 里。
watch(rows, () => { void loadChildCounts() })
watch(childTargets, () => { void loadChildCounts() })

/**
 * 点「下级」条数（Y1-12）：跳到后继节点，并把 `父 ID = 当前行` 带过去。
 * 单后继直接跳；多后继（分支）先让用户选去哪一个——两个分支各有各的表，跳错了看到的是空表。
 */
async function onChildCountClick(row: DataRow, cell: ChildCountCell) {
  const candidates = cell.byTarget.filter((t) => t.count > 0)
  if (!candidates.length) return
  let picked = candidates[0]
  if (candidates.length > 1) {
    try {
      const { value } = await ElMessageBox.prompt(
        candidates.map((t, i) => `${i + 1}. ${t.title}（${t.count} 条）`).join('\n'),
        '这行的下级数据分布在多个节点，看哪一个？',
        { inputPattern: /^\d+$/, inputErrorMessage: '请输入序号', inputValue: '1', confirmButtonText: '查看', cancelButtonText: '取消' },
      )
      picked = candidates[Number(value) - 1] ?? candidates[0]
    } catch {
      return
    }
  }
  const beforeTable = selectedTable.value
  const beforePage = page.value
  onSelectNode(picked.nodeId)
  filters.parentId = row.dataId
  // `watch([selectedTable, page], loadData)` 已经覆盖了"换了表"和"回到第 1 页"两种情况；
  // 只有**同表节点且本来就在第 1 页**时它不会触发，这时才手动查一次。
  // 无脑再调一次 runQuery 会在换表时白发一个请求（两次结果还一样）。
  if (selectedTable.value === beforeTable && page.value === beforePage) loadData()
}

watch([selectedTable, page], loadData, { immediate: false })
onMounted(loadData)

function runQuery() {
  page.value = 1
  loadData()
}
// el-pagination 的 v-model:page-size 已经把 size.value 设成新值了，这里只管"页大小变了要
// 从第一页重新查"这半件事，跟 runQuery 是同一件事，不用另起一个函数。
/**
 * 清掉单个条件（2026-09-22）。
 *
 * 数据 ID / 父 ID **没有输入框**：只能由别处带进来（任务视图点「数据 ID」定位、
 * 数据行点「下级」）。不显示出来就是一个**隐形筛选**——筛不到时表格看着完全正常，
 * 只是空的，用户会当成"这条数据没了"。实测从任务视图点数据 ID 跳过来正是这样。
 * 所以给这两个条件配可一键清除的标签，`清空` 之外还得能只去掉这一条。
 */
function clearOneFilter(key: 'dataId' | 'parentId') {
  filters[key] = ''
  runQuery()
}

function clearFilters() {
  filters.dataId = ''
  filters.parentId = ''
  filters.state = ''
  filters.sql = ''
  runQuery()
}

function buildSummaryQuery(): RowQuery {
  return {
    tableId: selectedTable.value,
    siteId: siteId.value || undefined,
    sourceId: sourceId.value,
    dataId: filters.dataId || undefined,
    parentId: filters.parentId || undefined,
    state: filters.state || undefined,
    sql: filters.sql || undefined,
  }
}
const pageExportBlocked = computed(() => loading.value || filtersDirty.value || !!dataError.value || !rows.value.length)
// 0930-14B：Excel 按当前查询条件导出（与统计同一套条件）。SQL / 数据 ID / 父 ID 经 exportUrl 的 more
// 生效（2026-10-08 217 实测 entryExportAll 按 more 过滤）。条件改了未点「查询」时不让导，否则与表格对不上
const excelExportReason = computed(() => {
  if (!sourceId.value || !selectedTable.value) return '请先选择源和数据表'
  if (filtersDirty.value) return '查询条件已修改，先点「查询」再导出'
  return ''
})
function exportCurrentPage() {
  if (pageExportBlocked.value) return
  try {
    const name = `${source.value?.name || sourceId.value}_${meta.value?.tableName || selectedTable.value}_第${page.value}页`.replace(/[\\/:*?"<>|]/g, '_')
    downloadCsv(`${name}.csv`, resultRowsCsv(rows.value, meta.value))
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '导出失败') }
}
function exportSourceExcel() {
  if (excelExportReason.value) { ElMessage.warning(excelExportReason.value); return }
  window.open(dataApi.exportUrl(buildSummaryQuery()), '_blank', 'noopener,noreferrer')
}
const apiOpen = ref(false)
const apiIdFetchUrl = computed(() => {
  const restBase = import.meta.env.VITE_LEGACY_REST_BASE || `${window.location.origin}/rest`
  const appId = import.meta.env.VITE_LEGACY_API_APP_ID || 'dev'
  const appKey = import.meta.env.VITE_LEGACY_API_APP_KEY || 'dev1'
  const params = [
    `appId=${encodeURIComponent(appId)}`,
    `appKey=${encodeURIComponent(appKey)}`,
    `type=${encodeURIComponent(selectedTable.value || '<tableId>')}`,
  ]
  if (sourceId.value) params.push(`sourceId=${encodeURIComponent(sourceId.value)}`)
  params.push('startId=0', 'size=10')
  return `${restBase.endsWith('/') ? restBase.slice(0, -1) : restBase}/api/v1/data/entry?${params.join('&')}`
})
const apiParams = [
  { name: 'appId', type: '字符串', required: '是', limit: '-', description: '取数应用 ID，由部署环境提供' },
  { name: 'appKey', type: '字符串', required: '是', limit: '-', description: '取数应用密钥，由部署环境提供' },
  { name: 'type', type: '整型', required: '是', limit: '-', description: '实体类型 ID，对应当前数据表' },
  { name: 'sourceId', type: '长整型', required: '非', limit: '-', description: '限制为当前源采集的数据' },
  { name: 'size', type: '整型', required: '是', limit: '1-200', description: '每次获取数量' },
  { name: 'startId', type: '长整型', required: '必填', limit: '最小为0', description: '取数起始 ID，下一批使用上次返回的 lastId+1' },
  { name: 'endId', type: '长整型', required: '非', limit: '-', description: '限制取数最大 ID' },
  { name: 'dataRange', type: '字符串', required: '非', limit: '时间范围', description: '时间上下限格式为“开始 - 结束”' },
]
const apiReturns = computed(() => [
  { code: 'data.lastId', name: '本次最大 ID', type: '长整型', description: '下一批 startId 使用 lastId+1' },
  { code: 'data.size', name: '本次返回数量', type: '整型', description: 'list 实际返回条数' },
  { code: 'data.list[].id', name: 'ID', type: '长整型', description: '数据主键' },
  { code: 'data.list[].state', name: '数据状态', type: '字符串', description: 'D 表示软删除' },
  { code: 'data.list[].sourceId', name: '源 ID', type: '长整型', description: '数据所属源' },
  { code: 'data.list[].parentId', name: '上层数据 ID', type: '长整型', description: '有关联时返回' },
  { code: 'data.list[].createDt', name: '生成时间', type: '字符串', description: '数据生成时间' },
  { code: 'data.list[].updateDt', name: '更新时间', type: '字符串', description: '数据更新时间' },
  ...(meta.value?.fields ?? []).map((field) => ({
    code: `data.list[].${field.prop}`,
    name: `${field.desc}（${field.columnName || field.prop}）`,
    type: field.type || '-',
    description: '当前数据表字段',
  })),
])
const manualAddOpen = ref(false)
const importOpen = ref(false)
const addConfigId = computed(() => (
  rows.value[0]?.configId
  || selectedCfg.value?.configId
  || source.value?.rootConfigId
  || source.value?.configId
  || ''
))
function openManualAdd() {
  if (!selectedTable.value || !sourceId.value) {
    ElMessage.warning('请先选择数据表和源')
    return
  }
  manualAddOpen.value = true
}
function openDataImport() {
  if (!selectedTable.value || !sourceId.value) {
    ElMessage.warning('请先选择数据表和源')
    return
  }
  importOpen.value = true
}
const summaryOpen = ref(false)
// 0930-04：点表名查看当前表的字段结构。meta 是按数据现拼的（metaError 有值）时没有真实结构，表名不可点
const tableStructOpen = ref(false)

// 详情 drawer：按当前页 index 翻，不跨页请求（0831 X4）。
const detail = reactive<{ visible: boolean; index: number }>({ visible: false, index: -1 })
const detailRow = computed(() => (detail.visible && detail.index >= 0 ? rows.value[detail.index] ?? null : null))
const showEmpty = ref(readShowEmpty())
watch(showEmpty, writeShowEmpty)
const fieldPreset = ref<RowFieldPreset>(readFieldPreset(selectedTable.value))
watch(selectedTable, (tableId) => { fieldPreset.value = readFieldPreset(tableId) })
watch(fieldPreset, (preset) => writeFieldPreset(selectedTable.value, preset))
watch(presetCols, (cols) => {
  if (fieldPreset.value === 'next' && !cols.length) fieldPreset.value = 'filled'
})
const taskInst = reactive<{ visible: boolean; sourceId: string; parentId: string | null }>({ visible: false, sourceId: '', parentId: null })
const editing = ref(false)
function closeDetail() {
  detail.visible = false
  detail.index = -1
  editing.value = false
  closeParentDetail()
}
function openDetailAt(index: number) {
  closeParentDetail()
  editing.value = false
  if (index < 0 || index >= rows.value.length) return
  detail.index = index
  detail.visible = true
}
function stepDetail(delta: number) {
  openDetailAt(detail.index + delta)
}
function onRowClick(r: DataRow) {
  openDetailAt(rows.value.findIndex((row) => row.dataId === r.dataId))
}
function onRowAction(r: DataRow, cmd: string) {
  if (cmd === 'detail') {
    openDetailAt(rows.value.findIndex((row) => row.dataId === r.dataId))
  } else if (cmd === 'edit') {
    const idx = rows.value.findIndex((row) => row.dataId === r.dataId)
    if (idx >= 0) {
      openDetailAt(idx)
      startEdit()
    }
  } else if (cmd === 'tasks') {
    taskInst.sourceId = r.sourceId
    taskInst.parentId = r.dataId
    taskInst.visible = true
  } else if (cmd === 'delete') {
    onDeleteOne(r)
  }
}

// 上游数据下钻（M3-0B）：categoryId/parentId 早就在 DataRow 里（legacyAdapters 已经映射），
// 只是没有渲染入口——旧平台 EntryList2.vue 有这个功能（父ID 列可点），新平台迁移时漏了。
// 只放详情抽屉、不占表格列宽：横向已经 25 列只露 4 列，"看血缘"本来就是逐条排查动作，
// 不需要常驻占一列（M3-0B 方案 A，2026-08-15 定案）。
const parentDetail = ref<EntryDetail | null>(null)
const parentLoading = ref(false)
const parentError = ref('')
/**
 * 父行所在的表 = **上游节点的输出表**，不是本行自己的 `categoryId`（2026-09-04 修）。
 *
 * `row.categoryId` 是这一行**自己**在哪张表。同表链路（父子都在 900）时两者恰好相等，
 * 所以一直没暴露；异表链路下就是错的——真实故障：源 430002879「观察者网-财经」
 * 父行 2790368 在 6200023、子行 8974800 在 900，拿 categoryId(900) 去查父行，
 * 后端直接 500（`entryDetail?entryId=2790368&type=900`），
 * 详情抽屉里飘一条红色「请求异常 [data/rowDetail]: 500」，而字段又照常显示（那些来自列表行），
 * 用户不知道该信哪个。
 *
 * 优先用**本节点的有效输入表**（`inputTableId`）：父行正是写进这张表的。
 * 比 `predecessorTableId` 稳——后者要求上游唯一，分叉汇合处会算不出来。两者都解析不出才退回 categoryId。
 */
const parentTableId = computed(() => inputTableId.value || predecessorTableId.value || detailRow.value?.categoryId || '')
const canDrillParent = computed(() => !!parentTableId.value && !!detailRow.value?.parentId && detailRow.value.parentId !== '0')
async function loadParentDetail(row: DataRow) {
  const tableId = inputTableId.value || predecessorTableId.value || row.categoryId
  if (!tableId || !row.parentId || row.parentId === '0') return
  parentLoading.value = true
  parentError.value = ''
  try {
    const res = await dataApi.rowDetail(tableId, row.parentId)
    parentDetail.value = res
    if (!res) parentError.value = '未找到上游数据'
  } catch (error) {
    parentError.value = error instanceof Error ? error.message : '获取上游数据失败'
  } finally {
    parentLoading.value = false
  }
}
// 0904 I06：详情抽屉里的「下级数据」面板**已删除**（Z0-1）。
// 它 2026-09-04 才迁进来（commit 58d35e0），当天走查就被否掉——产品原话
// 「这个不合理啊，这个不用你点，下级是点进去就这个条件才能下去，然后可以返回就行了」
// 「你在这个下级之下，你那个详情的就不要了」。逐条罗列子行被形容为「看猴年马月」。
//
// **这不是误删回滚**：下钻的形态定为「带条件跳转 + 可返回」（Z2 做返回），
// 详情层不再内嵌子表列表。随之删除的还有 RowDetailSubs.vue、rowDetail/loadRowDetail
// （那个请求只为拿 subs/subsCnt，字段本来就是列表行 + 表 meta 现拼的）、onSubsViewAll、childCountFor。
// 列表层的下级条数列与点击下钻（Y1）**保留不动**，那才是产品认可的入口。

/** 详情抽屉里的「父 ID ↗」 */
async function openParentDetail() {
  if (detailRow.value) await loadParentDetail(detailRow.value)
}
/**
 * 表格里 PARENT_ID 单元格被点（0903 Y1-3）：先打开这一行的详情，再把上游面板展开。
 * 走同一个 loadParentDetail，不另起一套"父行查看"——两个入口要是各查各的，
 * 迟早在错误提示、空态、加载态上分叉。
 */
async function onParentCellClick(r: DataRow) {
  openDetailAt(rows.value.findIndex((row) => row.dataId === r.dataId))
  await loadParentDetail(r)
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

// 行编辑（Phase 4.4）
const editValues = reactive<Record<string, string>>({})
const saving = ref(false)
function startEdit() {
  if (!detailRow.value) return
  Object.keys(editValues).forEach((k) => delete editValues[k])
  // 复用 detailFields 已经按 columnName 取对的值，不再用 f.prop 重新取一遍错的。
  detailFields.value.forEach((f) => { editValues[f.prop] = f.empty ? '' : f.value })
  editing.value = true
}
function cancelEdit() {
  editing.value = false
}
/** 系统列：rowUpdate 自己带 ENTRY_ID，其余由后端维护，编辑表单里有也不提交 */
const SYSTEM_COLUMNS = new Set(['ENTRY_ID', 'SOURCE_ID', 'PARENT_ID', 'CREATE_DT', 'UPDATE_DT'])

/**
 * 保存行编辑：**只提交改过的字段，键用物理列名（K1/K19…）**（2026-09-23 修）。
 *
 * 此前把整张表单按逻辑字段名（f.prop，如 `video_minio`）原样发给 entry/entryUpdate，
 * 而后端认的是物理列名——旧平台 EntryList2.vue 单元格编辑发的就是
 * `{ ENTRY_ID, ENTRY_TYPE_ID, [K 列]: 值 }`，本仓 dataHttp.test 的 rowUpdate 契约也是 `{ K1: … }`。
 * 逻辑名后端不认、当没传，于是逻辑名 ≠ K 列名的表（如 TB_YOUTUBE）**改什么都存不进去**
 * （用户报：改 K19「视频minio地址」保存不了）。没有物理列名的字段才退回用 prop。
 */
async function saveEdit() {
  if (!detailRow.value || !selectedTable.value) return
  const changes: Record<string, string> = {}
  for (const f of detailFields.value) {
    const column = f.columnName || f.prop
    if (SYSTEM_COLUMNS.has(column.toUpperCase())) continue
    const next = editValues[f.prop] ?? ''
    const before = f.empty ? '' : f.value
    if (next !== before) changes[column] = next
  }
  if (!Object.keys(changes).length) {
    ElMessage.info('没有改动')
    editing.value = false
    return
  }
  saving.value = true
  try {
    const res = await dataApi.rowUpdate(selectedTable.value, detailRow.value.dataId, changes)
    const idx = detail.index
    if (idx >= 0) {
      // 后端回了整行就用它；没回（entryUpdate 通常只回 msg）就把改过的列就地合进去，免得要手动刷新才看得到
      const values = res?.row?.values ?? { ...rows.value[idx].values, ...changes }
      rows.value[idx] = { ...rows.value[idx], values }
    }
    ElMessage.success(res?.message || '已保存')
    editing.value = false
  } finally {
    saving.value = false
  }
}

// 单元格里的文件预览（0819 N2-7）：路径类字段点开就地看内容，不用先跳到文件视图再找。
// 用居中 dialog 而不是右侧抽屉——这是"看一眼就关"的操作型短流程，抽屉留给实体详情
// （项目弹层规范）。预览器与文件详情共用一个组件，取数、降级、下载全在里面。
const filePreview = reactive({ visible: false, path: '', basePath: '', name: '', url: '', ext: '' })
// sourceUrl 由 DataGrid 从被点的那一行算好带过来（2026-09-11）。此前是从 detailFields
// 取——那是详情抽屉当前行的字段，直接点单元格时详情没开，于是永远取不到，
// 预览里的「原始地址 ↗」一直不显示。
function onCellFile(path: string, field?: unknown, sourceUrl = '') {
  const hintedExt = extFromFieldHint(field as { prop?: string; columnName?: string; desc?: string } | undefined)
  // 库里存的正文路径可能少了后缀，取之前先补上——预览、下载、「新窗口打开」都拿这个 path
  const fullPath = ossPathWithExt(path, hintedExt)
  filePreview.path = fullPath
  // 原始路径（可能没后缀）一起带给预览器：它据此决定要不要给 TXT / HTML 切换（0920-02）
  filePreview.basePath = path
  filePreview.name = fullPath.split('/').pop() || ''
  filePreview.url = sourceUrl
    || detailFields.value.find((f) => f.prop === 'url')?.href
    || detailFields.value.find((f) => f.href)?.href
    || ''
  // 路径自带后缀时以它为准，字段猜测只补"没后缀"的（与 ossPathWithExt 同一口径）。
  // 2026-09-23 踩到：extFromFieldHint 把 K17 一律猜成 html（新闻表 K17 是网页快照），
  // 而 TB_YOUTUBE 的 K17 是字幕 mp3——猜的 html 盖掉了真实的 .mp3，被塞进网页 iframe 打不开。
  filePreview.ext = extFromName(path) || hintedExt
  filePreview.visible = true
}
const codeTest = reactive<{ visible: boolean; loading: boolean; error: string; output: string }>({
  visible: false,
  loading: false,
  error: '',
  output: '',
})
function buildCodeParams(row: { values?: Record<string, unknown> } | null): Record<string, string> {
  const inputFields = selectedCfg.value?.ruleCfg?.inputFields ?? []
  // ruleCfg.inputFields 只在打开「表配置」时由 contextMap 还原；直接从数据视图进来（刷新后）是空数组，
  // 这时用已落库的步骤入参列（taskCfg.contextMap，K 列名）匹配（2026-11-17 186 复测：参数全空）。
  const contextColumns = selectedCfg.value?.taskCfg?.contextMap ?? []
  if (!inputFields.length && !contextColumns.length) return {}

  const params: Record<string, unknown> = {}
  for (const field of meta.value?.fields ?? []) {
    const column = field.columnName ?? ''
    const picked = inputFields.length
      ? inputFields.includes(field.prop) || inputFields.includes(column)
      : !!column && contextColumns.includes(column)
    if (!picked) continue
    const raw = row?.values?.[field.columnName ?? field.prop]
    // 入参名与生成时告诉模型的一致：去掉「-K列号」（scriptParamName），否则 INDICATOR-K1 不是合法参数名。
    params[scriptParamName(field.prop)] = raw == null ? '' : String(raw)
  }
  return params as Record<string, string>
}
function stringifyCodeResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
async function onTestScript() {
  // 停在输出表时行不是脚本的输入（输入≠输出），先切到输入表再让用户选行。
  if (scriptTestOnInput.value && scope.value === 'output' && scopeSwitchable.value) {
    onScopeChange('input')
    ElMessage.info('已切换到输入表，请选择要测试的行后再点「测试脚本」')
    return
  }
  // 工具条触发时未打开行详情，回退到选中行第一行，再回退到本页第一行
  const row = detailRow.value
    ?? (selectedRowIds.value.length ? rows.value.find((r) => selectedRowIds.value.includes(r.dataId)) : null)
    ?? rows.value[0]
    ?? null
  if (!row) {
    ElMessage.warning('没有可测试的行数据')
    return
  }
  const codePath = queryScriptPath.value
  if (!codePath) {
    ElMessage.warning('脚本路径为空')
    return
  }
  codeTest.visible = true
  codeTest.loading = true
  codeTest.error = ''
  codeTest.output = ''
  try {
    const result = await ruleApi.executeCode({
      codePath,
      params: buildCodeParams(row),
      timeout: 300,
    })
    codeTest.output = stringifyCodeResult(result)
    ElMessage.success('脚本测试已完成')
  } catch (error) {
    codeTest.error = error instanceof Error ? error.message : String(error)
  } finally {
    codeTest.loading = false
  }
}
</script>

<template>
  <main class="rv-shell" :class="{ 'is-fullscreen': fullscreen }">
    <!-- 全屏是"只看数据"的模式：只有源信息头让位，节点轨道保留（它是唯一的节点选择器，
         藏起来就没法切节点了）；筛选行与表头行（含发起抓取、输入/输出切换、分页、列）
         全部保留——不然全屏就只能看不能用了。 -->
    <CanvasHeader v-if="!fullscreen" />

    <!-- 0930：源信息头以下整体一个滚动区，与任务视图同构。流程图展开后把表格挤得只剩两三行，
         现在表格保底高度、不够就整体往下滚。 -->
    <div class="rv-scroll" data-testid="data-view-scroll">

    <!-- 折叠开关和「查看条件」都放在轨道自己身上：控件应该长在它所控制的东西上，
         而且这两个都是"这个节点的上下文"，跟下面那行"怎么查"不是一回事
         （2026-08-15 第十三次纠偏：原来把它俩塞进筛选行，等于把一组筛选条件劈成两半）。
         收起后 .rv-railbox 靠 min-height 留出一条窄带，展开按钮不会跟着消失。 -->
    <div v-if="browseMode === 'step' && selectedNodeId && railOpen" class="rv-railbox">
      <button v-if="canSkipCondThisSend && !sendNodeSelection" class="rc-btn rv-rail-select-send" type="button" data-testid="rail-select-send-nodes" @click="startSendNodeSelection">多选发送节点</button>
      <div v-if="sendNodeSelection" class="rv-rail-send-controls" data-testid="rail-send-controls">
        <strong>选择发送节点</strong><span>已选 {{ sendSettingSelectedCount }} 个</span>
        <button type="button" @click="setSendTargets(sendSettingOptions, true)">全选</button>
        <button type="button" @click="setSendTargets(sendSettingOptions, false)">清空</button>
        <label><input type="checkbox" data-testid="rail-ignore-selected" :checked="allSendConditionsIgnored"
          :indeterminate="sendConditionCount > 0 && !allSendConditionsIgnored" :disabled="!sendConditionOptions.length"
          @change="setSendConditions(($event.target as HTMLInputElement).checked)" />忽略已选节点条件</label>
        <button class="rc-btn" type="button" data-testid="rail-send-done" @click="sendNodeSelection = false">完成</button>
      </div>
      <div class="rv-bar" data-testid="data-process-rail" :style="{ maxHeight: `${railHeight}px` }">
        <ProcessNodeRail
          :model-value="selectedNodeId"
          :layout="processLayout"
          :skipped="skippedNodeIds"
          :selected-ids="sendNodeSelection ? sendSelectedNodeIds : undefined"
          :selectable="canSelectSendNode"
          :ignored-conditions="ignoreConditionNodeIds"
          @update:model-value="onSelectNode"
          @update:selected-ids="setRailSendTargets"
          @node-menu="openNodeMenu"
        />
        <div v-if="!allNodes.length" class="rv-bar-empty">当前流程没有可查看数据的节点</div>
      </div>
      <div class="rv-rail-ctl">
        <button
          type="button"
          class="rv-rail-icon-btn"
          data-testid="data-rail-toggle"
          title="收起流程"
          aria-label="收起流程"
          @click="railOpen = false"
        ><el-icon :size="14"><ArrowUp /></el-icon></button>
      </div>
      <RailResizeHandle v-model="railHeight" />
    </div>

    <!-- 主干行（0910 重排）：左端是节点展开流程入口，中间「查询」+「筛选」，
         右端是数据操作。四个筛选维度收进「筛选」抽屉，输入/输出/执行方式在下面的表头行。
         节点选择归流程图（0819 会议 05:13"上面那个和下面那个不是两个都有了吗？只要有一个
         就行了"——原来这里还有一个与轨道完全同步的节点下拉，同一件事两个控件，已删）。 -->
    <!-- 查询条件一律点「查询」执行，不绑回车（2026-08-20 决定）。原先绑了 @keyup.enter，
         但中文输入法上屏时也会发 Enter 的 keyup，而 Vue 的 @keyup.enter 不过滤 isComposing——
         实测打字打到一半就被当成回车查了一次，条件只输了半截，结果还看不出是怎么来的。 -->
    <div class="ctx-summary" data-testid="data-node-context">
      <!-- 全屏时源信息头被藏起来了，这里把源名补回来，否则看不出在看哪个源的数据。 -->
      <span v-if="fullscreen" class="rv-fs-source" :title="source?.name || sourceId">{{ source?.name || sourceId }}</span>
      <!-- 流程轨道展开时收起按钮合并在轨道区右上角；轨道收起时在主干行左端保留展开按钮。 -->
      <!-- 1008-07：切换按钮抽成共用组件（数据中心同款）；rv-browse-mode 只留作定位钩子，样式在组件里 -->
      <BrowseModeToggle class="rv-browse-mode" :model-value="browseMode" @update:model-value="switchBrowseMode" />
      <select v-if="browseMode === 'table' && outputTables.length" class="rv-table-picker" aria-label="数据表" data-testid="data-table-select" :title="tableNames[tableChoice] || tableChoice" :value="tableChoice" @change="selectTable(($event.target as HTMLSelectElement).value)">
        <option v-for="table in outputTables" :key="table.id" :value="table.id">{{ tableNames[table.id] || table.id }}</option>
      </select>
      <RailNodePicker
        v-if="browseMode === 'step' && !railOpen && railNodeOptions.length"
        v-model:open="railOpen"
        :model-value="selectedNodeId"
        :nodes="railNodeOptions"
        toggle-testid="data-rail-toggle"
        @update:model-value="onSelectNode"
      />
      <template v-if="hasAnyTable">
        <div class="rv-table-context">
          <!-- 输入表===输出表：会议要的"展示看输出/发送用输入"两件事落在同一张表上，
               双 tab 自我矛盾，合并成一个（M3-0C 方案 A）；标签写"输入·输出"明示这张表
               两个身份都占，不是随便挑了一个名字。 -->
          <span v-if="browseMode === 'step' && sameTable" class="ctx-piece" data-testid="data-scope-merged" :title="tableTip(inputTableId)"><span class="k">输入·输出</span></span>
          <template v-else-if="browseMode === 'step'">
            <template v-if="inputTableId">
              <button
                v-if="scopeSwitchable"
                type="button"
                class="ctx-piece scope-piece"
                :class="{ active: scope === 'input' }"
                data-testid="data-scope-input"
                @click="onScopeChange('input')"
               :title="tableTip(inputTableId)"><span class="k">输入</span></button>
              <span v-else class="ctx-piece" :title="tableTip(inputTableId)" data-testid="data-input-table"><span class="k">输入</span></span>
            </template>
            <template v-if="outputTableId">
              <span v-if="inputTableId" class="ctx-sep">·</span>
              <button
                v-if="scopeSwitchable"
                type="button"
                class="ctx-piece scope-piece"
                :class="{ active: scope === 'output' }"
                data-testid="data-scope-output"
                @click="onScopeChange('output')"
               :title="tableTip(outputTableId)"><span class="k">输出</span></button>
              <span v-else class="ctx-piece" :title="tableTip(outputTableId)" data-testid="data-output-table"><span class="k">输出</span></span>
            </template>
          </template>
          <!-- 「按源抓取 / 按输入数据执行」徽标已删除（2026-08-19）：它当初存在是因为
               08-14 那阵执行按钮文案一度统一成"发起抓取"、不分首节点/后续节点，需要
               额外说明这个节点按什么发；M3-0A 把按钮文案改回两种之后（发起抓取 /
               发后续任务），这层信息就被按钮本身接管了——左边还有「输入·输出 表ID」，
               三处说同一件事。禁用/输出 tab 场景的解释也已经由按钮 title 和
               data-view-only-hint 承担，删掉它还能给这行让出 93px。 -->
          <!-- 表名是这行里最长、也最可省略的一项（实测 sense_data.TB_TB_NEWS_TAGS 独占
               188px）：允许它收缩并省略号截断，完整值走 title 悬浮看，把宽度让给按钮。 -->
          <button
            v-if="meta && !metaError"
            type="button"
            class="rv-tablename is-link"
            data-testid="data-table-struct-btn"
            :title="`${meta.tableName || selectedTable}（点击查看表结构）`"
            @click="tableStructOpen = true"
          >{{ meta.tableName || selectedTable }}</button>
          <span v-else class="rv-tablename" :title="meta?.tableName || selectedTable || ''">{{ meta?.tableName || selectedTable || '—' }}</span>
          <span class="rv-tablecount">{{ total.toLocaleString() }} 行</span>
        </div>
        <SqlConditionEditor v-model="filters.sql" v-slot="{ value, update }" :table-id="selectedTable" :table-name="meta?.tableName" :fields="queryFields" class="rv-sql">
          <input :value="value" @input="update(($event.target as HTMLInputElement).value)" class="rv-input flex" data-testid="data-cond-sql" placeholder="SQL 条件，可点右端漏斗按字段查询（如 K23 = '...'）" />
        </SqlConditionEditor>
        <!-- 数据 ID / 父 ID 这两个条件没有输入框，不摆出来就是隐形筛选（见 clearOneFilter） -->
        <span v-if="filters.dataId || filters.parentId" class="rv-cond-chips" data-testid="data-cond-chips">
          <button
            v-if="filters.dataId"
            class="rv-cond-chip"
            type="button"
            data-testid="data-cond-chip-dataId"
            title="当前只看这一条数据；点击清除这个条件"
            @click="clearOneFilter('dataId')"
          >数据 ID：{{ filters.dataId }} <span class="rv-cond-x">×</span></button>
          <button
            v-if="filters.parentId"
            class="rv-cond-chip"
            type="button"
            data-testid="data-cond-chip-parentId"
            title="当前只看这条数据的下级；点击清除这个条件"
            @click="clearOneFilter('parentId')"
          >父 ID：{{ filters.parentId }} <span class="rv-cond-x">×</span></button>
        </span>
        <span class="rv-actions">
          <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
          <button class="rc-btn" type="button" @click="clearFilters">清空</button>
          <AddDataMenu compact @manual="openManualAdd" @import="openDataImport" />
          <button
            class="rc-btn tiny"
            type="button"
            data-testid="data-summary-btn"
            title="按当前筛选条件统计"
            @click="summaryOpen = true"
          >统计</button>
          <ExportMenu
            compact
            :page-disabled="pageExportBlocked"
            :excel-reason="excelExportReason"
            :api-disabled="!selectedTable"
            @export-page="exportCurrentPage"
            @export-excel="exportSourceExcel"
            @show-api="apiOpen = true"
          />

        </span>
        <!-- 数据操作组：发后续任务与发全部合并为组合操作按钮 -->
        <span class="rv-data-ops">
          <span v-if="canPickRows" class="muted">{{ (execMode === 'input' || execMode === 'upstream') && !selectedRowIds.length ? '请先勾选表格数据' : `已选 ${selectedRowIds.length} 条` }}</span>
          <!-- 什么都做不了时给出原因，别让工具栏空着——见 noExecReason 的说明 -->
          <span
            v-if="noExecReason"
            class="muted rv-no-exec"
            data-testid="data-no-exec-reason"
            :title="noExecReason"
          >{{ noExecReason }}</span>
          <el-popover
            v-if="canSkipCondThisSend"
            v-model:visible="sendSettingVisible"
            trigger="click"
            placement="bottom-end"
            :width="360"
          >
            <template #reference>
              <button class="rc-btn rv-send-setting-btn" type="button" data-testid="data-send-settings"
                :class="{ 'is-on': sendSettingBadge > 0 }"
                title="本次发送范围，默认全部发送；仅对勾选数据的发后续生效"
              >发送范围：{{ sendSettingRangeLabel }}<span v-if="skipCondStepIds.length"> · 忽略条件 {{ skipCondStepIds.length }}</span><el-icon><ArrowDown /></el-icon></button>
            </template>
            <section v-if="sendSettingVisible" class="rv-send-range" role="dialog" aria-label="本次发送范围" data-testid="send-range-panel">
              <header><strong>本次发送范围</strong><span>仅本次</span></header>
              <div class="rv-send-range-search"><el-icon><Search /></el-icon><input v-model="sendSettingSearch" aria-label="搜索发送节点" placeholder="搜索节点名称 / 步骤 ID" /></div>
              <p v-if="sendSettingLoading" class="rv-send-setting-loading">正在读取下游节点…</p>
              <p v-else-if="sendSettingError" class="rv-send-setting-error">{{ sendSettingError }}<button type="button" @click="loadSendSettings">重试</button></p>
              <template v-else>
                <div class="rv-send-range-ops"><span>已选 <b>{{ sendSettingSelectedCount }}</b> / {{ sendSettingOptions.length }} 个节点</span><button type="button" data-testid="send-range-all" @click="setSendTargets(sendSettingOptions, true)">全选</button><button type="button" data-testid="send-range-clear" @click="setSendTargets(sendSettingOptions, false)">清空</button></div>
                <div v-if="sendSettingSearch.trim()" class="rv-send-range-filter-ops"><span>匹配 {{ sendSettingMatches.length }} 个</span><button type="button" :disabled="!sendSettingMatches.length" @click="setSendTargets(sendSettingMatches, true)">勾选搜索结果</button><button type="button" :disabled="!sendSettingMatches.length" @click="setSendTargets(sendSettingMatches, false)">取消搜索结果</button></div>
                <label class="rv-send-condition-all" title="仅对当前列表中已选发送且有进入条件的节点生效">
                  <input type="checkbox" data-testid="send-range-ignore-all" :checked="allSendConditionsIgnored"
                    :indeterminate="sendConditionCount > 0 && !allSendConditionsIgnored" :disabled="!sendConditionOptions.length"
                    @change="setSendConditions(($event.target as HTMLInputElement).checked)" />
                  {{ sendSettingSearch.trim() ? '忽略搜索结果中已选节点条件' : '忽略已选节点条件' }}
                </label>
                <div class="rv-send-range-list">
                  <div v-for="opt in sendSettingMatches" :key="opt.stepId" class="rv-send-range-row" :class="{ 'is-ignored': sendSettingModeOf(opt) === 'skipCond' }">
                    <label class="rv-send-range-target" :title="opt.name">
                    <input type="checkbox" :checked="sendSettingModeOf(opt) !== 'mute'" :aria-label="`发送到${opt.name}`" :data-testid="`send-range-${opt.stepId}`" @change="setSendTargets([opt], ($event.target as HTMLInputElement).checked)" />
                    <span>{{ opt.name }}</span><small>#{{ opt.stepId }}</small>
                    </label>
                    <label class="rv-send-range-condition" :title="isNodeSkipped(opt.nodeId) ? '请先选择发送到此节点' : opt.condition || '此节点没有进入条件'">
                      <input type="checkbox" :checked="sendSettingModeOf(opt) === 'skipCond'" :disabled="!opt.condition || isNodeSkipped(opt.nodeId)"
                        :aria-label="`忽略${opt.name}进入条件`" :data-testid="`send-range-ignore-${opt.stepId}`"
                        @change="setSendSettingMode(opt, ($event.target as HTMLInputElement).checked ? 'skipCond' : 'normal')" />忽略条件
                    </label>
                  </div>
                  <p v-if="!sendSettingMatches.length" class="rv-send-range-empty">没有匹配的节点</p>
                </div>
              </template>
              <footer><span>{{ sendSettingOptions.length && !sendSettingSelectedCount ? '请至少选择一个节点' : '仅本次，发送成功后恢复默认' }}</span><button v-if="browseMode === 'step'" class="rc-btn" type="button" data-testid="send-range-rail-select" :disabled="sendSettingLoading || !!sendSettingError" @click="startSendNodeSelection">流程图多选</button><button class="rc-btn" type="button" data-testid="send-range-done" @click="sendSettingVisible = false">完成</button></footer>
            </section>
          </el-popover>
          <div v-if="execMode !== 'none'" class="rc-btn-group">
            <button
              class="rc-btn primary rv-exec-btn"
              type="button"
              data-testid="data-exec-btn"
              :disabled="!canExecute"
              :title="execDisabledReason"
              @click="execMode === 'fetch' ? onSendFetch() : execMode === 'upstream' ? onSendUpstream() : onSendNextStep()"
            >{{ actionBtnText }}</button>
            <el-dropdown
              v-if="execMode === 'input' && canPickRows"
              trigger="click"
            >
              <button
                class="rc-btn primary rv-split-arrow"
                type="button"
                data-testid="data-exec-split-arrow"
                title="更多执行选项"
              ><span class="arrow">▾</span></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    data-testid="data-exec-all-btn"
                    :disabled="!!sendAllBlockedReason"
                    :title="sendAllBlockedReason || (isCurrentNodeAction ? '不按勾选，按当前筛选条件发起本节点全部数据' : '不按勾选，按当前筛选条件发全部后续')"
                    @click="onSendAllUnderFilter"
                  >发全部（命中 {{ total }} 条）</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <!-- 代码生成原先并进上面的连体按钮组里，跟「发后续」共用一个外轮廓，
               看起来像被切碎的一个按钮（2026-11-09 用户："按钮都并在一起太丑"）。
               它不是主操作，挪出连体组单独占一格，间距交给 .rv-data-ops 的 gap。 -->
          <CodeConfigButton v-if="execMode !== 'upstream'" data-testid="data-code-btn" :build-targets="dataCodeTargets" :select-step="execMode !== 'fetch' && !isCurrentNodeAction" :node-configs="flow.configs" :disabled="execMode !== 'fetch' && !selectedRowIds.length" label="代码生成" />
          <!-- 同表多后继：不再拦，只说清会分流到哪几个（2026-09-04）。
               原来这里是禁用勾选 + 一句藏在 title 里的"无法确定任务目标节点"，纯黑盒。 -->
          <span
            v-if="branchTargets.length"
            class="muted"
            data-testid="data-fanout-hint"
            :title="branchTargets.map((t) => `${t.title}：${t.condition}`).join('\n')"
          >按进入条件分流到 {{ branchTargets.length }} 个后继</span>
          <!-- 「从上一节点重跑」出现在中间节点上会让人困惑（"这不是最后一个节点啊"）——
               说清楚是后继被停用了，不是它变成了末节点。 -->
          <span
            v-if="execMode === 'upstream' && disabledSuccessorTitles.length"
            class="muted"
            data-testid="data-disabled-successor-hint"
          >下游「{{ disabledSuccessorTitles.join('、') }}」已停用，无法发后续</span>
          <!-- 「测试脚本」来自规则处理那条线（origin/master）：有脚本路径时才出现，与发任务无关。 -->
          <button
            v-if="queryScriptPath"
            class="rc-btn primary"
            type="button"
            :disabled="codeTest.loading"
            @click="onTestScript"
          >{{ codeTest.loading ? '测试中…' : '测试脚本' }}</button>
          <!-- 删除数据（2026-09-09 从数据中心迁入）：跟发任务并排——都是「对这批数据动手」。
               仅测试表出现（meta.state === 'C'），与数据中心同一道门禁。
               标红（.danger）：它是这组里唯一不可撤销的操作，跟旁边的发任务按钮必须一眼分得开。 -->
          <el-dropdown v-if="isTestTable" trigger="click">
            <button class="rc-btn tiny danger" type="button" data-testid="data-delete">删除数据 <span class="arrow">▾</span></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :disabled="!selectedRowIds.length" @click="onDeleteSelected">删除选中的数据</el-dropdown-item>
                <el-dropdown-item divided @click="onDeleteByRange(0)">删除该源-当日数据</el-dropdown-item>
                <el-dropdown-item @click="onDeleteByRange(1)">删除该源-所有数据</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </span>
        <div class="rv-view-tools">
          <FullscreenToggle v-model="fullscreen" />
          <div ref="gridToolsTarget" class="rv-grid-tools" />
        </div>
      </template>
    </div>

    <template v-if="hasAnyTable">
      <!-- 条件已改但未执行：盖住上一次的结果状态，避免把旧的失败/空表当成当前条件的结果 -->
      <div v-if="slowQuery" class="rv-notice" role="status" data-testid="data-slow-query">查询较慢，可缩小条件范围再试；本次请求仍在等待结果</div>
      <div v-else-if="filtersDirty && !loading" class="rv-notice" role="status" data-testid="data-filters-dirty">查询条件已修改，点「查询」执行</div>
      <template v-else>
        <div v-if="metaError" class="rv-notice" role="status">{{ metaError }}</div>
        <div v-if="dataError" class="rv-notice error" role="alert" :title="dataErrorFull || dataError">{{ dataError }}</div>
      </template>

      <div v-if="deleteError && deleteError.tableId === selectedTable" class="rv-notice error rv-delete-error" role="alert" data-testid="data-delete-error">
        <div class="rv-delete-error-head">
          <span data-testid="data-delete-error-message">{{ deleteError.message }}</span>
          <button class="rc-btn tiny ghost" type="button" @click="deleteError = null">关闭</button>
        </div>
        <details>
          <summary>技术详情</summary>
          <pre data-testid="data-delete-error-detail">{{ deleteError.detail }}</pre>
          <button class="rc-btn tiny ghost" type="button" @click="copyToClipboard(deleteError.detail, '错误详情')">复制详情</button>
        </details>
      </div>

      <!-- 列控制挂到上方查询工具栏，表格不再额外占用一行工具栏。 -->
      <DataGrid
        class="rv-grid"
        :toolbar-target="gridToolsTarget"
        :meta="meta"
        :rows="rows"
        :loading="loading"
        :selected-id="detailRow?.dataId"
        :selectable="canPickRows"
        :selected-ids="selectedRowIds"
        :sort-field="sortField"
        :sort-order="sortOrder"
        :allow-column-sort="allowColumnSort"
        :preset-cols="presetCols"
        :visible-field-props="visibleFieldProps"
        :force-all-columns="!ui.inspectorFieldFilterActive"
        :show-child-col="showChildCol"
        :allow-row-edit="true"
        :allow-row-delete="isTestTable"
        :child-counts="childCounts"
        :child-counts-error="childCountsError"
        @sort-change="onSortChange"
        @update:selected-ids="selectedRowIds = $event"
        @file-click="onCellFile"
        @parent-click="onParentCellClick"
        @child-click="onChildCountClick"
        @row-click="onRowClick"
        @row-action="onRowAction"
      >
        <!-- 分页移到表格下方（0819 N1-8，会议 19:13"页子一般放下面"）。原先它并在 #head
             里是为了省纵向空间，现在由顶部区收窄（N1-10）补偿。 -->
        <template #foot>
          <!-- 简化分页：页码文字 + 独立页大小下拉 + 上一页/下一页两个按钮四个元素合并成
               一个 el-pagination（2026-08-19，用户反馈"分页那块也散"）。size 变化时
               v-model:page-size 已经把 size.value 设好了，@size-change 只需要把页
               重置到第 1 页再重新查——跟 watch([selectedTable, page], loadData) 分工：
               page 变化交给 watch，size 变化这里手动触发（watch 没监听 size，故意的，
               避免 v-model 更新 page/size 时被同一次操作触发两次查询）。 -->
          <!-- layout 带 total（2026-09-09）：`:total` 一直传着，只是没在 layout 里列出来，
               分页器左边那块就一直空着。全项目 20 个分页器里 18 个都带 total，这里是漏的。 -->
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="PAGE_SIZES"
            layout="total, sizes, prev, pager, next"
            size="small"
            data-testid="data-pagination"
            @size-change="runQuery"
          />
        </template>

      </DataGrid>
    </template>
    <div v-else-if="browseMode === 'table'" class="rv-empty-scope">当前源尚未配置输出数据表</div>
    <div v-else-if="!selectedNodeId" class="rv-empty-scope">当前源尚未配置流程步骤</div>
    <div v-else-if="selectedNodeId" class="rv-empty-scope" data-testid="data-node-empty">该节点不产生可查看的数据，也不提供手动执行入口</div>

    <el-drawer v-model="detail.visible" class="rv-detail-drawer" :with-header="false" size="560px">
      <div v-if="detailRow" class="rv-detail">
        <div class="rv-d-head">
          <div class="rv-d-head-main">
            <div class="rv-d-title">{{ detailRow.title }}</div>
            <!-- 源 ID 跟 ENTRY_ID 并列：详情是"这条数据是什么"的完整视图，
                 光有 ENTRY_ID 看不出它属于哪个源（0819 会议 09:23～09:44）。 -->
            <div class="rv-d-sub">
              <span class="rv-d-sub-item">
                <span>ENTRY_ID {{ detailRow.dataId }}</span>
                <button
                  v-if="detailRow.dataId"
                  type="button"
                  class="rv-sub-copy"
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
              <span> · 源 ID {{ detailRow.sourceId || sourceId }}</span>
            </div>
            <button
              v-if="canDrillParent"
              type="button"
              class="rv-parent-link"
              data-testid="data-parent-drill"
              :disabled="parentLoading"
              @click="openParentDetail"
            >父 ID {{ detailRow.parentId }} <span aria-hidden="true">↗</span></button>
            <div class="rv-d-tools">
              <button
                class="rc-btn tiny"
                type="button"
                data-testid="row-detail-prev"
                :disabled="detail.index <= 0"
                title="上一条"
                @click="stepDetail(-1)"
              >‹</button>
              <span class="rv-d-pos" data-testid="row-detail-pos">{{ detail.index + 1 }}/{{ rows.length }}</span>
              <button
                class="rc-btn tiny"
                type="button"
                data-testid="row-detail-next"
                :disabled="detail.index >= rows.length - 1"
                :title="detail.index >= rows.length - 1 ? '本页最后一条，翻页后继续' : '下一条'"
                @click="stepDetail(1)"
              >›</button>
              <label class="rv-d-empty">
                <input v-model="showEmpty" type="checkbox" data-testid="row-detail-empty-toggle" />
                显示空字段
              </label>
              <select
                :value="fieldPreset"
                class="rv-d-preset"
                data-testid="row-detail-preset"
                @change="fieldPreset = ($event.target as HTMLSelectElement).value as RowFieldPreset"
              >
                <option value="all">全部字段</option>
                <option value="filled">仅非空</option>
                <option v-if="presetCols.length" value="next">下一步字段</option>
              </select>
            </div>
          </div>
          <button class="rc-btn ghost rv-d-close" type="button" @click="closeDetail">关闭</button>
        </div>
        <div class="rv-d-body">
          <div v-if="parentError" class="rv-notice error">{{ parentError }}</div>
          <div v-if="parentDetail" class="rv-parent-panel" data-testid="data-parent-panel">
            <div class="rv-parent-panel-head">
              <span class="rv-d-sub-item">
                <span>上游数据 · ENTRY_ID {{ parentDetail.row.dataId }}</span>
                <button
                  v-if="parentDetail.row.dataId"
                  type="button"
                  class="rv-sub-copy"
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
            :editing="editing"
            :values="editValues"
            :show-empty="showEmpty"
            :visible-props="detailVisibleProps"
            @update:field="editValues[$event.prop] = $event.value"
            @file-click="onCellFile"
          />
        </div>
        <div class="rv-d-foot">
          <template v-if="editing">
            <button class="rc-btn primary" type="button" :disabled="saving" @click="saveEdit">{{ saving ? '保存中…' : '保存' }}</button>
            <button class="rc-btn" type="button" :disabled="saving" @click="cancelEdit">取消</button>
          </template>
          <template v-else>
            <button class="rc-btn" type="button" @click="startEdit">编辑</button>
          </template>
        </div>
      </div>
    </el-drawer>
    <TaskInstDialog
      v-model="taskInst.visible"
      :source-id="taskInst.sourceId"
      :parent-id="taskInst.parentId"
      :can-write="false"
    />
    <SummaryDrawer v-model="summaryOpen" :table-meta="meta" :build-query="buildSummaryQuery" :hit-count="total" />
    <TableDetailDialog v-model="tableStructOpen" :table-meta="meta" />
    <RowEditDialog
      v-model="manualAddOpen"
      :table-id="selectedTable"
      :table-meta="meta"
      mode="add"
      :first-row="rows[0] ?? null"
      :initial-source-id="sourceId"
      :initial-config-id="addConfigId"
      lock-source
      @saved="runQuery"
    />
    <DataImportDialog
      v-model="importOpen"
      :table-id="selectedTable"
      :source-id="sourceId"
      :initial-config-id="addConfigId"
      @uploaded="runQuery"
    />

    <DataFetchApiDialog
      v-model="apiOpen"
      :url="apiIdFetchUrl"
      :params="apiParams"
      :returns="apiReturns"
      :table-label="meta?.tableName || selectedTable"
      :source-label="source?.name ? `${source.name}（${sourceId}）` : sourceId"
      test-id="source-data-api-dialog"
    />
    <SnatchLauncher ref="snatchLauncher" />

    <!-- 节点右键菜单（0917-06 / 0917-08，2026-09-21 用户定）：
         轨道只把"在哪个节点上右键了"抛出来，菜单内容在这里定——另外三个复用轨道的视图
         （文件 / 任务 / 监控）不需要这些动作。样式对齐源侧栏的 .ssw-row-menu。 -->
    <div v-if="nodeMenu.show" class="rv-node-menu-mask" @click="closeNodeMenu" @contextmenu.prevent="closeNodeMenu" />
    <div
      v-if="nodeMenu.show"
      class="rv-node-menu"
      :style="{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }"
      data-testid="rail-node-menu"
    >
      <div class="rv-node-menu-title" :title="menuNodeTitle">{{ menuNodeTitle }}</div>
      <!-- 首节点就是这个流程的抓取入口（0917-08）：会上原话「第一个节点其实就是发这个流程的抓取」。
           有后继的首节点此前只有「发后续任务」，没有重抓列表的入口。 -->
      <button
        v-if="menuNodeIsFirst"
        type="button"
        data-testid="rail-menu-send-fetch"
        @click="sendFetchForNode(nodeMenu.nodeId)"
      >发起抓取</button>
      <label class="rv-node-send-option">
        <input type="checkbox" data-testid="rail-menu-toggle-skip" :checked="isNodeSkipped(nodeMenu.nodeId)" @change="toggleSkipNode(nodeMenu.nodeId)" />
        <span>本次不发后续</span>
      </label>
      <label class="rv-node-send-option" :class="{ disabled: sendSettingLoading || !menuSendOption.condition || !menuSendOption.stepId || isNodeSkipped(nodeMenu.nodeId) || !canSkipCondThisSend }">
        <input type="checkbox" data-testid="rail-menu-ignore-condition" :checked="skipCondStepIds.includes(menuSendOption.stepId)"
          :disabled="sendSettingLoading || !menuSendOption.condition || !menuSendOption.stepId || isNodeSkipped(nodeMenu.nodeId) || !canSkipCondThisSend"
          @change="setSendSettingMode(menuSendOption, ($event.target as HTMLInputElement).checked ? 'skipCond' : 'normal')" />
        <span>本次忽略进入条件</span>
      </label>
      <button
        v-if="skippedNodeIds.length > 1 || (skippedNodeIds.length === 1 && !isNodeSkipped(nodeMenu.nodeId))"
        type="button"
        data-testid="rail-menu-restore-all"
        @click="restoreAllSkipped"
      >全部恢复（{{ skippedNodeIds.length }}）</button>
    </div>

    <el-dialog
      v-model="filePreview.visible"
      :title="filePreview.name || '文件预览'"
      width="92vw"
      top="4vh"
      :style="{ maxWidth: '1180px' }"
      append-to-body
      destroy-on-close
    >
      <FilePreview
        :path="filePreview.path"
        :base-path="filePreview.basePath"
        :name="filePreview.name"
        :ext="filePreview.ext || extFromName(filePreview.name)"
        :external-url="filePreview.url"
        style="height: min(72vh, 720px)"
        data-testid="data-cell-file-preview"
      />
    </el-dialog>
    <el-dialog v-model="codeTest.visible" title="脚本测试结果" width="820px" top="6vh" append-to-body data-testid="script-test-dialog">
      <div class="rv-code-test">
        <div class="rv-code-test-meta">
          <span>脚本路径</span>
          <b :title="queryScriptPath">{{ queryScriptPath || '未提供' }}</b>
        </div>
        <div v-if="codeTest.loading" class="rv-code-test-hint">测试中…</div>
        <div v-else-if="codeTest.error" class="rv-code-test-hint error">{{ codeTest.error }}</div>
        <pre v-else class="rv-code-test-output">{{ codeTest.output || '暂无返回结果' }}</pre>
      </div>
    </el-dialog>
    </div>
  </main>
</template>

<style scoped>
.rv-delete-error-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rv-delete-error details { margin-top: 4px; }
.rv-delete-error summary { cursor: pointer; }
.rv-delete-error pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }

/* 1117：表 ID 后带库类型标签（MYSQL / CK），整块不再参与收缩——以前 190px 封顶 + 先收缩，标签被裁成「M」；
   挤的时候让 SQL 框（min 260px）让位，再不够整条工具栏本来就能横向滚动。 */
.rv-table-context { display: flex; align-items: center; gap: 5px; flex: none; flex-wrap: nowrap; }
.rv-table-context .rv-tablename { min-width: 0; max-width: 105px; }
.rv-view-tools { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.rv-grid-tools { display: flex; align-items: center; }

.rv-table-picker { height: 28px; border: 0; background: var(--rc-surface); color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.rv-table-picker { width: 160px; min-width: 160px; max-width: 160px; padding: 0 24px 0 8px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); text-overflow: ellipsis; }

.ctx-summary .rv-sql { flex: 1 1 380px; min-width: 260px; width: auto; }
.rv-shell { min-width: 0; min-height: 0; width: 100%; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
/* 全屏：同一份 DOM 直接铺满视口，不复制模板也不套弹层。祖先链上没有 transform/filter/
   contain（已核对 AppShell.vue、FlowCanvas/index.vue），fixed 能正常逃逸；外层 .rc-shell
   的 z-index 是 21、顶栏是 20，所以这里盖得住顶栏。详情抽屉渲染在 .rv-shell 内部，
   会跟着一起进全屏。 */
.rv-shell.is-fullscreen { position: fixed; inset: 0; z-index: 60; height: 100vh; border: 0; border-radius: 0; }

/* 轨道容器：多选入口在左上角、收起在右上角；控件放在滚动容器外，不随流程图滚走。 */
.rv-railbox { position: relative; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }
/* 节点右键菜单：视觉对齐源侧栏的 .ssw-row-menu（全站第 5 处右键菜单，样式刻意一致） */
.rv-node-menu-mask { position: fixed; z-index: 91; inset: 0; }
.rv-node-menu {
  position: fixed; z-index: 92; width: 212px; padding: 4px;
  background: #fff; border: 1px solid var(--rc-border); border-radius: 7px;
  box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.38);
}
.rv-node-menu-title { overflow: hidden; padding: 3px 8px 5px; border-bottom: 1px solid var(--rc-border-soft); margin-bottom: 4px; color: var(--rc-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.rv-node-menu button {
  display: block; width: 100%; height: 28px; padding: 0 8px; border: 0; border-radius: 4px;
  background: transparent; color: var(--rc-text-2); font-size: 12px; text-align: left; cursor: pointer;
}
.rv-node-send-option { display: flex; align-items: center; gap: 8px; padding: 8px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }
.rv-node-send-option input { width: 14px; height: 14px; margin: 0; accent-color: var(--rc-primary); }
.rv-node-send-option:hover { background: var(--rc-primary-bg); border-radius: 4px; }
.rv-node-send-option.disabled { color: var(--rc-faint); cursor: default; }
.rv-node-menu button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rv-rail-ctl { position: absolute; top: 6px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 6px; }
.rv-rail-select-send { position: absolute; top: 6px; left: 10px; z-index: 2; }
.rv-rail-icon-btn { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); background: #fff; color: var(--rc-text-2); cursor: pointer; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); }
.rv-rail-icon-btn:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); background: var(--rc-primary-bg); }

/* 折叠开关：默认收起，展开后收起按钮置于轨道区右上角；收起时在主干行左端保留展开按钮。 */

/* 全屏下源信息头被藏起来，用这个补回"在看哪个源"。 */
.rv-fs-source { flex: none; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 700; color: var(--rc-text); }

.rv-bar { position: relative; padding: 8px 0; background: #f8fafc; overflow: auto; }
.rv-bar-canvas { position: relative; }
.rv-bar svg { position: absolute; inset: 0; pointer-events: none; }
.rv-edge { fill: none; stroke: #94a3b8; stroke-width: 1.4; }
.rv-edge.rule { stroke: #60a5fa; }
.rv-edge.dashed { stroke-dasharray: 5 4; }
.rv-bar-empty { color: var(--rc-faint); font-size: 12px; padding: 16px; text-align: center; }
.rv-term { position: absolute; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; box-shadow: 0 2px 8px -5px rgba(15, 23, 42, 0.2); }
.rv-node { position: absolute; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 10px; background: #fff; cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s; box-sizing: border-box; text-align: left; }
.rv-node:hover:not(.disabled):not(.on) { border-color: #bfdbfe; box-shadow: 0 4px 12px -8px rgba(37, 99, 235, 0.4); }
.rv-node.on { border: 2px solid var(--rc-primary); background: var(--rc-primary-bg); }
.rv-node.disabled { opacity: 0.5; cursor: not-allowed; background: #f8fafc; }
.rv-node.branch { border-style: dashed; }
.rv-node-icon { width: 30px; height: 30px; flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 7px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-size: 12px; font-weight: 700; }
.rv-node.disabled .rv-node-icon { background: #f1f5f9; color: var(--rc-faint); }
.rv-node-text { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; flex: 1; }
.rv-node-title { font-size: 12px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-node.on .rv-node-title { color: var(--rc-primary-ink); }
.rv-node-sub { font-size: 10px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-node.on .rv-node-sub { color: var(--rc-primary); }
.rv-node-final { position: absolute; top: -8px; right: 8px; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 5px; background: var(--rc-ok-bg); color: var(--rc-ok); border: 1px solid currentColor; line-height: 1.4; }

/* ---- 节点上下文摘要（折叠式，0812 计划 M2-8）----
   默认只占一行：输入表/输出表/执行方式都是每次都想看的信息，常驻展示；节点名不在
   这里重复——节点轨道上已经高亮了当前选中节点（2026-08-14 第五次纠偏，去掉重复展示）。
   进入条件、路径条件大多数节点是"无"，收进展开区，且只有真的有内容时才出现展开
   按钮。上游节点不在这里重复——节点轨道本身的连线就是流程图（0813 评审定案）。 */
/* 换行会让这两条工具栏高度随窗口变窄一路往上涨，挤掉下面数据表格的空间——改成不换行、
   放不下就横向滚动，工具栏高度锁死为固定的一行，数据表格永远拿到最多的剩余空间
   （2026-08-15 第十次纠偏：目的是"下面数据行更多"，不是"这一行摆得下"）。 */
/* 2026-10-05 明确要求查询、发后续任务、删除数据始终同一行。空间不足时整行横向滚动，
   不再把数据操作折到第二行；表上下文和 SQL 先收缩，尽量减少出现滚动条的机会。
   flex-shrink: 0：overflow-x:auto 让它在纵向 flex 里的最小高度变成 0，展开流程图后高度不够时整行会被压成一条缝。 */
.ctx-summary { display: flex; flex-shrink: 0; align-items: center; flex-wrap: nowrap; gap: 6px; padding: 7px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.ctx-summary::-webkit-scrollbar { height: 5px; }
.ctx-summary::-webkit-scrollbar-thumb { border-radius: 999px; background: #cbd5e1; }
.ctx-summary > * { flex-shrink: 0; }
.ctx-summary > .rv-sql { flex-shrink: 1; }
/* SQL 框是这一行唯一可伸缩的元素，负责吸收多余/不足的宽度。必须比上面那条 no-shrink
   规则更具体，否则整行永远超宽、把右端的「查询/清空」挤出可视区——2026-08-15 实测回归，
   跟之前"查看条件被滚没"是同一类错误：nowrap 的行里必须留一个能缩的元素。 */
/* SQL 是这一行里唯一需要长内容的输入框，基准给大、独占伸缩，把剩余宽度全吃掉。
   但这一行在常规面板宽度下（左边 220px 主侧栏 + 200px 源列表，实际只剩约 800px）
   本来就装不下 6 个控件，所以再加一手：聚焦时临时变宽到 560px，把其他控件挤到横向
   滚动区外——查询/清空是 sticky 钉住的，照样点得到。真要长时间写 SQL 走全屏，
   那边这一行有 1280px（2026-08-15 第十三次纠偏：SQL 框太小）。 */
.ctx-summary .rv-input.flex { flex: 1 1 380px; min-width: 260px; width: auto; }
/* 聚焦时必须连 flex-shrink 一起退掉：这一行常态是刚好塞满的，可用空间为 0，
   只加大 flex-basis 会被 shrink 原样拉回 min-width，等于没写（实测踩过）。
   固定宽度后整行转为横向滚动，浏览器会把聚焦元素滚进视野，查询/清空是 sticky 的照样点得到。 */
/* 不再有 .rv-input.flex:focus 的固定放大（原为 width:520px）：它把这一行顶宽 340px，
   是窄屏下一点输入框就冒出横向滚动条的直接原因。flex:1 本来就会吃掉整行剩余宽度。 */
@media (prefers-reduced-motion: reduce) { .ctx-summary .rv-input.flex { transition: none; } }
/* select 会自己撑到最长选项的宽度：节点名一长就吃掉 230px+，把 SQL 挤没。截断显示，
   当前选中是哪个节点在轨道上也有高亮，信息不会丢。 */
.ctx-summary .rv-input.st { width: 104px; min-width: 0; flex: none; }
/* 再兜一层：窗口真的很窄、SQL 框缩到底之后整行还是会横向滚动，这时把查询/清空钉在右端，
   保证任何宽度下都点得到。 */
/* 不再 sticky：那是为横向滚动时钉住按钮准备的，改成换行后没有横向滚动，渐变底也失去意义 */
.rv-actions { display: inline-flex; align-items: center; gap: 6px; padding-left: 4px; white-space: nowrap; }
.rv-cond-chips { display: inline-flex; align-items: center; gap: 6px; padding-left: 8px; }
.rv-cond-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: 1px solid var(--rc-primary-bd, #bfdbfe); border-radius: 12px; background: var(--rc-primary-bg, #eff6ff); color: var(--rc-primary-ink, #1d4ed8); font-size: 11px; cursor: pointer; white-space: nowrap; }
.rv-cond-chip:hover { border-color: var(--rc-primary); }
.rv-cond-x { color: var(--rc-muted); font-size: 12px; }
.ctx-piece { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--rc-text-2); white-space: nowrap; }
.ctx-piece .k { font-size: 11px; color: var(--rc-faint); }
.ctx-piece .v.code { font-family: var(--rc-mono, monospace); font-size: 11.5px; }
.ctx-sep { color: #cbd5e1; }
/* 输入/输出两侧都存在时，摘要行里的这两小段文字本身就是切换器——点哪个看哪个，
   被查看的高亮；不额外放一套"输出数据/输入数据"页签跟这里的表名对不上号。 */
button.ctx-piece.scope-piece { border: 0; background: transparent; font: inherit; padding: 2px 6px; margin: -2px -6px; border-radius: 6px; cursor: pointer; opacity: .55; }
button.ctx-piece.scope-piece:hover { opacity: .85; background: var(--rc-border-soft); }
button.ctx-piece.scope-piece.active { opacity: 1; background: var(--rc-primary-bg); }
button.ctx-piece.scope-piece.active .k, button.ctx-piece.scope-piece.active .v { color: var(--rc-primary-ink); }
.rv-empty-scope { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 12px; text-align: center; color: var(--rc-faint); font-size: 12px; }

.rv-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 110px; background: #fff; }

/* 61 不是随便挑的：.rv-shell.is-fullscreen 也是 60，全屏模式下打开这个菜单必须严格盖过它，
   不能靠"Teleport 到 body 末尾、DOM 顺序更靠后所以层叠更上"这种偶然性。 */

/* 数据 ID / 父 ID 本来就是短数字，不用跟节点选择、状态这些下拉一样宽——
   窄一点给查询/清空腾地方，尽量跟筛选条件同一行（2026-08-15 第九次纠偏）。 */
.rv-input.id { width: 78px; min-width: 0; flex: none; }
/* 不换行之后"填满剩余空间"没有意义了（反正内容一多就横向滚动），改固定宽度，
   跟同一行其他字段一样不参与 flex 伸缩。 */
.rv-input.flex { flex: none; width: 220px; min-width: 0; font-family: var(--rc-mono, monospace); }
.rv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ctx-summary .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
/* 数据操作组（发起抓取/发后续/从上一节点重跑/测试脚本/发全部/删除数据 + 各自的说明文字）：
   钉在筛选行右端。margin-left:auto 在 .ctx-summary 的 wrap 行内把它推到最右；窄屏 wrap 到
   下一行时自然左对齐，不做额外处理——响应式下让位比硬撑更好。
   按钮尺寸由上面的 .ctx-summary .rc-btn（28px）统一接管，跟同行的「查询/清空」一致；
   删除数据那个 .tiny 也一并拉齐，这行不再有 24px 的邻居。 */
/* 数据操作组前面加一道分隔线（2026-11-09 用户："这一排按钮优化下"）：
   左边是"对这批数据做什么"，右边是"对查询做什么"，十几个 28px 按钮直接连排分不清组。 */
.rv-data-ops {
  margin-left: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  padding-left: 10px;
  border-left: 1px solid var(--rc-border-soft);
}
/* 主操作（发后续）与后面的次要操作之间再松一点：同一排 28px 按钮贴等距，
   眼睛没法一眼分出"哪个是发出去的"（2026-11-09 用户："按钮都并在一起太丑"）。 */
.rv-data-ops > .rc-btn-group { margin-right: 4px; }
/* 数据操作组里的文字按钮统一内边距，避免"跳过条件 · 3 个"这种长文案把行撑开；
   宽度差异交给文字本身，不固定宽度——固定宽度反而会让中文短文案显空。 */
.rv-data-ops > .rc-btn { padding: 0 10px; }
/* 无可执行操作时的说明：工具栏本来就挤，超出就省略，全文走 title */
.rv-no-exec { font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctx-summary .rc-btn.tiny { height: 28px; padding: 0 12px; font-size: 12px; }

/* 发后续任务与发全部的组合操作按钮 */
.rc-btn-group { display: inline-flex; align-items: stretch; vertical-align: middle; }
.rc-btn-group > .rc-btn:first-child:not(:last-child) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.rc-btn-group :deep(.el-dropdown) { display: inline-flex; }
.rc-btn-group .rv-split-arrow { height: 28px; padding: 0 8px; border-top-left-radius: 0; border-bottom-left-radius: 0; border-left: 1px solid rgba(255, 255, 255, 0.35); display: inline-flex; align-items: center; justify-content: center; }
.rc-btn-group .rv-split-arrow:disabled { opacity: 0.6; cursor: not-allowed; }
.rc-btn.primary.rv-exec-btn:disabled { background: var(--rc-bg-soft); border-color: var(--rc-border); color: var(--rc-faint); box-shadow: none; cursor: not-allowed; }

/* 表头内容现在渲染在 DataGrid 的 #head 插槽里（那条横条由 .dg-toolbar 负责排版），
   这里只留下内容本身的样式，不再有独立的 .rv-tablehead / .rv-pager 横条。 */
/* 这一行的空间预算（2026-08-19 实测：需要 988px 只有 924px，溢出 64px 出横向滚动条）：
   表名是唯一可以牺牲的——允许收缩+省略号，其余按钮/分页都得完整可见可点。
   注意 .dg-head > * 有 flex-shrink: 0，这里要显式改回 1 才收缩得动。 */
.rv-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); min-width: 60px; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-tablename.is-link { padding: 0; border: 0; background: none; text-align: left; color: var(--rc-primary); cursor: pointer; }
.rv-tablename.is-link:hover, .rv-tablename.is-link:focus-visible { text-decoration: underline; }
.rv-tablecount { font-size: 12px; color: var(--rc-faint); }
.muted { color: var(--rc-faint); font-size: 12px; }
.rv-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.rv-notice.error { border-bottom-color: #fecaca; background: #fef2f2; color: #b91c1c; }

.rv-scroll { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; }
/* 表格保底 360px：流程图展开时不再被挤成两三行，超出由 .rv-scroll 整体滚动 */
.rv-grid { flex: 1 0 auto; height: 0; min-height: 360px; }
/* 表头行里的按钮比筛选行矮一档，免得这条横条被撑高又把数据区挤回去。 */
.rc-btn.tiny { height: 24px; padding: 0 10px; font-size: 11.5px; }

.rv-detail-drawer :deep(.el-drawer__body) { display: flex; flex-direction: column; height: 100%; padding: 0; overflow: hidden; }
.rv-detail { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.rv-d-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.rv-d-head-main { min-width: 0; flex: 1; }
.rv-d-close { flex: none; height: 28px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.rv-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); line-height: 1.4; word-break: break-word; }
.rv-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 4px; }
.rv-d-sub-item { display: inline-flex; align-items: center; gap: 4px; }
.rv-sub-copy {
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
.rv-d-sub-item:hover .rv-sub-copy { opacity: 1; }
.rv-sub-copy:hover { color: var(--rc-primary); background: var(--rc-primary-bg); }
.rv-d-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 18px 16px; }
.rv-d-foot { flex: none; display: flex; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.rv-code-test { display: flex; flex-direction: column; gap: 10px; }
.rv-code-test-meta { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--rc-text-2); }
.rv-code-test-meta span { color: var(--rc-faint); font-size: 11px; }
.rv-code-test-meta b { font-family: var(--rc-mono, monospace); word-break: break-all; }
.rv-code-test-hint { padding: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; color: var(--rc-text-2); font-size: 12px; line-height: 1.6; }
.rv-code-test-hint.error { border-color: #fecaca; background: #fef2f2; color: #b91c1c; word-break: break-all; }
.rv-code-test-output { margin: 0; padding: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #0f172a; color: #dbeafe; font-family: var(--rc-mono, monospace); font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; min-height: 180px; }
.rv-parent-link { margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; padding: 0; font-size: 11px; color: var(--rc-primary); cursor: pointer; }
.rv-parent-link:hover { text-decoration: underline; }
.rv-parent-link:disabled { opacity: .6; cursor: default; text-decoration: none; }
.rv-parent-panel { margin: 6px 0 12px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; padding: 10px 12px; }
.rv-parent-panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--rc-text-2); margin-bottom: 4px; }
.rv-d-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.rv-d-pos { color: var(--rc-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.rv-d-empty { display: inline-flex; align-items: center; gap: 4px; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.rv-d-preset { height: 24px; padding: 0 6px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 11px; }
.ctx-summary :deep(.dcb) { flex: 1 1 380px; min-width: 260px; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }
/* 1109-R01「本次发送设置」：一次性动作，开启态用主色描边+浅底，和 primary 实心按钮区分开，
   避免被当成"发出去"的主操作。2026-11-09 用户反馈这排按钮太碎：去掉虚线（截图里像没做完的
   按钮），改实线浅底，开启态用"圆点 + 主色"表示生效，不再靠文字里塞"已开"撑宽按钮。 */
.rv-send-setting-btn {
  border-color: var(--rc-border);
  background: #fff;
  color: var(--rc-text-2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rv-send-setting-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary); }
.rv-send-setting-btn:disabled { opacity: .5; cursor: not-allowed; }
.rv-send-setting-btn.is-on {
  border-color: var(--rc-primary);
  color: var(--rc-primary);
  background: color-mix(in srgb, var(--rc-primary) 10%, #fff);
  font-weight: 600;
}
.rv-send-setting-btn.is-on::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

/* 本次发送范围与条件覆盖共用状态，并同步到流程图多选。 */
.rv-rail-send-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 42px 8px 10px; color: var(--rc-text-2); font-size: 12px; border-bottom: 1px solid var(--rc-border-soft); }
.rv-rail-send-controls > button:not(.rc-btn) { padding: 0; border: 0; background: none; color: var(--rc-primary); cursor: pointer; font-size: 12px; }
.rv-rail-send-controls label, .rv-send-condition-all { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px; }
.rv-rail-send-controls input, .rv-send-range input[type="checkbox"] { flex: none; width: 14px; height: 14px; margin: 0; accent-color: var(--rc-primary); }
.rv-send-range { display: flex; flex-direction: column; gap: 10px; color: var(--rc-text-2); font-size: 12px; }
.rv-send-range header { display: flex; align-items: center; gap: 8px; }
.rv-send-range header strong { color: var(--rc-text); font-size: 13px; }
.rv-send-range header > span { color: var(--rc-faint); font-size: 10px; }
.rv-send-range-search { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 5px; color: var(--rc-faint); }
.rv-send-range-search:focus-within { border-color: var(--rc-primary); }
.rv-send-range-search input { width: 100%; min-width: 0; border: 0; outline: none; background: transparent; font-size: 12px; color: var(--rc-text); }
.rv-send-range-ops, .rv-send-range-filter-ops { display: flex; align-items: center; gap: 12px; font-size: 11px; }
.rv-send-range-ops > span, .rv-send-range-filter-ops > span { margin-right: auto; }
.rv-send-range-ops b { color: var(--rc-primary); }
.rv-send-range-ops button, .rv-send-range-filter-ops button, .rv-send-setting-error button { padding: 0; border: 0; background: none; color: var(--rc-primary); cursor: pointer; font-size: 11px; }
.rv-send-range-filter-ops button:disabled { opacity: .45; cursor: default; }
.rv-send-range-list { max-height: min(280px, 38vh); overflow: auto; border-block: 1px solid var(--rc-border-soft); }
.rv-send-range-row { display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 8px 4px; }
.rv-send-range-row + .rv-send-range-row { border-top: 1px solid var(--rc-border-soft); }
.rv-send-range-row:hover { background: var(--rc-primary-bg); }
.rv-send-range-row.is-ignored { background: var(--rc-primary-bg); }
.rv-send-range-target { display: flex; flex: 1; min-width: 0; align-items: center; gap: 8px; cursor: pointer; }
.rv-send-range-target > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-send-range-condition { display: flex; flex: none; align-items: center; gap: 4px; font-size: 11px; cursor: pointer; }
.rv-send-range-condition:has(input:disabled), .rv-send-condition-all:has(input:disabled) { color: var(--rc-faint); cursor: default; }
.rv-send-range-row small { margin-left: auto; flex: none; color: var(--rc-faint); font-size: 10px; }
.rv-send-range-empty, .rv-send-setting-loading, .rv-send-setting-error { margin: 0; padding: 18px 0; text-align: center; color: var(--rc-muted); font-size: 12px; }
.rv-send-setting-error { color: var(--rc-error); }
.rv-send-setting-error button { display: block; margin: 8px auto 0; }
.rv-send-range footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.rv-send-range footer > span { color: var(--rc-faint); font-size: 10px; }
.rv-send-range footer .rc-btn { padding: 4px 10px; font-size: 12px; }

</style>
