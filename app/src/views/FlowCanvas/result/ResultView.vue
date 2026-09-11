<script setup lang="ts">
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import { rememberSqlCondition } from '@/utils/sqlConditionHistory'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'
import { dataApi, isMockMode, isProductionBackend, parseNextStepReceipt, ruleApi, type DataTableMeta, type DataRow, type EntryDetail, type RowQuery } from '@/api'
import {
  buildHorizontalLayout, nodeOutputTable, nodeEntryCondition, conditionGroupLabel, conditionGroupIsSet,
  isDecision, isParallel, isFirstRunnableNode, firstRunnableNodeId, hasDirectSuccessor, directPredecessorIds, directSuccessorIds, directSuccessorIdsIncludingDisabled, type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import { nextStepColumns } from '@/utils/flow/nextStepFields'
import { fetchChildCountsForPage, isPerRowMode, resolveChildTargets, type ChildCountCell } from '@/utils/flow/childCounts'
import { confirmDanger } from '@/utils/confirmDanger'
import SummaryDrawer from '@/components/data/SummaryDrawer.vue'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import DataGrid from './DataGrid.vue'
import FilePreview from './components/FilePreview.vue'
import { extFromName } from '@/utils/ossFile'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { readResultRailOpen, writeResultRailOpen, readFilterBarOpen, writeFilterBarOpen } from './resultLayoutPref'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'
import SnatchLauncher from '@/views/FlowCanvas/source/SnatchLauncher.vue'
import RowDetailFields from './RowDetailFields.vue'
import { fieldsFromShowItems, fieldsFromTableMeta } from './rowDetailFields'
import { readFieldPreset, readShowEmpty, visibleDetailProps, writeFieldPreset, writeShowEmpty, type RowFieldPreset } from './rowDetailPrefs'

// 数据视图只属于具体源流程（0812 计划 M2-4：网站"全部源"态改用独立的 SiteDataView.vue，
// 不再靠 siteWide 布尔开关把两种数据流塞进同一个组件——那正是 M1-4 删掉的"代表源"问题的成因）。
const flow = useFlowStore()
const ui = useUiStore()
const ws = useWorkspaceStore()

const source = computed(() => flow.sourceCtx)
const router = useRouter()
const route = useRoute()
const sourceId = computed(() => source.value?.sourceId ?? '')
const siteId = computed(() => source.value?.siteId ?? '')
const tabKey = computed(() => sourceId.value)
const queryNodeId = computed(() => String(route.query.nodeId ?? ''))
const queryScriptPath = computed(() => String(route.query.scriptPath ?? '').trim())

// 节点候选不再要求"必须有输出表"（0812 计划 M2-6，方案 §6.3）：结构节点（决策/分头）
// 选中后走只读上下文 + 空态分支，不强行伪装成有数据的节点；候选就是流程里的全部真实节点。
const processLayout = computed(() =>
  buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }),
)
const allNodes = computed(() => processLayout.value.nodes)
const selectedNodeId = ref<string>('')
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
}

// 节点轨道**默认收起**（0910 会议 §2-2「点数据视图时自动收起上方流程配置区域」）。
// 这条推翻了 2026-08-15 的定案（原话是"不靠默认折叠常规页面换那几行"，理由是轨道
// 是流程上下文、第一眼就该看到）——会上给的新权衡是：进数据视图的人是来看数据的，
// 那 96px 应该先归数据，想看流程的人点一下展开。
//
// 收起后仍要能展开：开合按钮站在主干行左端（0910 定案）。曾试过让它浮在轨道区右上角
// 与全部源视图同构，但那样收起时得靠 .rv-railbox 的 min-height 留一条 32px 窄带专门
// 托住按钮——一整行高度只换一个按钮，而主干行左边又只剩「筛选」「查询」两个，空了半边。
// 代价：收起状态下看不出当前在哪个节点（与全部源视图现状一致），暂按会上口径保留。
const railOpen = ref(readResultRailOpen())
watch(railOpen, writeResultRailOpen)
// 筛选条件区的折叠（0910 会议 §2-3）。主干行只留每次都用的：节点入口、筛选开关、查询，
// 外加整组数据操作（发任务/删除——那是这个页面的主要动作，藏起来比藏筛选条件更伤）。
const filtersOpen = ref(readFilterBarOpen())
watch(filtersOpen, writeFilterBarOpen)
// 收起时唯一能说明"筛选还生效着"的东西。没有它，用户设完条件一折叠，回头看到数据变少
// 会当成 bug——条件本身此刻是看不见的。所以角标不是装饰，是这个折叠能成立的前提。
const activeFilterCount = computed(() =>
  [filters.dataId, filters.parentId, filters.state, filters.sql].filter(Boolean).length)
// 全屏：整个面板 position:fixed 铺满视口，不复制模板、不引入弹层——详情抽屉本来就渲染在
// .rv-shell 内部，会跟着一起进全屏；祖先链上没有 transform/filter/contain，fixed 能正常
// 逃逸到视口（已核对 AppShell.vue / FlowCanvas/index.vue）。
const fullscreen = ref(false)
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
const isStructuralNode = computed(() => !!selectedCfg.value && (isDecision(selectedCfg.value) || isParallel(selectedCfg.value)))
// 决策/分头是纯编排节点，不产生可查看的数据，也不提供手动执行——即使技术上继承了输入表也不当数据节点处理。
const hasAnyTable = computed(() => !isStructuralNode.value && (!!outputTableId.value || !!inputTableId.value))
const bothScopesAvailable = computed(() => !!(inputTableId.value && outputTableId.value))
// 输入表===输出表（0812 会议同时要了"展示看输出表"+"发送用输入数据"两件事，输入≠输出时
// 这两件事天然落在两张表上、需要两个 tab；相同时落在同一张表，双 tab 就成了自我矛盾——
// 合并成一个 tab，这张表两个身份都占，不需要切换（M3-0C，2026-08-15 定案）。
const sameTable = computed(() => !!inputTableId.value && !!outputTableId.value && inputTableId.value === outputTableId.value)
const scopeSwitchable = computed(() => bothScopesAvailable.value && !isStructuralNode.value && !sameTable.value)
function defaultScope(): 'output' | 'input' {
  return outputTableId.value ? 'output' : 'input'
}
const selectedTable = computed(() => (scope.value === 'output' ? outputTableId.value : inputTableId.value))

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
  if (isStructuralNode.value || (!outputTableId.value && !inputTableId.value)) return 'none'
  if (hasSuccessor.value) return 'input'
  // 末节点：有唯一上游就能从上一节点重跑（0831 X7-B）。上游不唯一宁可不给入口。
  if (predecessorId.value) return 'upstream'
  return 'none'
})

// 进入条件 / 路径条件（M2-8）：大多数节点是"无"，只在真的有内容时才提示可展开，
// 不产生一个空着也占位的展开按钮。上游节点不在这里重复展示——节点轨道的连线本身
// 就是流程图，这里只放轨道上看不出来的、节点配置里才有的东西（0813 评审定案）。
const entryConditionLabel = computed(() => {
  const cfg = selectedCfg.value
  if (!cfg) return ''
  const group = nodeEntryCondition(cfg)
  return conditionGroupIsSet(group) ? conditionGroupLabel(group) : ''
})
const pathConditionLabel = computed(() => {
  const id = selectedNodeId.value
  if (!id) return ''
  for (const bg of flow.branchGroups) {
    const branch = bg.branches.find((b) => b.chain.includes(id))
    if (branch && conditionGroupIsSet(branch.condition)) return `${conditionGroupLabel(branch.condition)}（${branch.label}）`
  }
  return ''
})
const hasCond = computed(() => !!entryConditionLabel.value || !!pathConditionLabel.value)

// 「查看条件」改为跳转到流程画布的节点配置（0819 N4-1）。会议 21:06："你看它可能不止那么
// 简单，可能会稍微复杂一点，直接点它，然后就跳过去，不要在这边搞个东西起来，不是很奇怪吗"
// ——就地展开只能塞下一行摘要，真要看清条件还是得去配置面板，索性直接送过去。
// entryConditionLabel / pathConditionLabel 保留：它们决定这个入口要不要出现（没条件的节点
// 不给一个点过去什么都没有的按钮），文案里也用来提示条件类型。
function openNodeCondition() {
  if (!selectedNodeId.value) return
  // siteId 必须带上：左侧源列表的渲染条件是 sidebarSiteId（flow.sourceCtx?.siteId
  // || route.query.siteId），跳转时丢了它整个源侧栏都不渲染。
  // 这里原先只取 source.value?.siteId——mock 的源详情带这个字段，生产上的真实源详情
  // 不带，于是单测一路绿灯、真实环境跳过去左栏就空了。故再兜一层当前路由上的 siteId。
  const navSiteId = siteId.value || String(route.query.siteId ?? '')
  void router.push({
    path: '/canvas',
    query: {
      ...(navSiteId ? { siteId: navSiteId } : {}),
      sourceId: sourceId.value,
      view: 'flow',
      nodeId: selectedNodeId.value,
      // 进入条件的编辑界面在「任务配置」页（TaskTab.vue 的 ConditionRow），不是节点配置页。
      // 例外：决策/分头节点在 nodeInspectorTabs 里只有「分支配置」一个页签（key 仍是
      // config），跳 task 会落到不存在的页签。
      tab: isStructuralNode.value ? 'config' : 'task',
    },
  })
}

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
// 有输入表的中间节点仍按 0812：只在输入 / 合并「输入·输出」tab 勾行（输出 tab 是本节点产物）。
// 没有输入表的节点（典型列表首节点）当前表就是输出，0824 要从这里勾行发给后继，勾选列必须留着。
const execDisabledReason = computed(() => {
  if (execMode.value === 'fetch' && !isVerifiedFirstNode.value) return '当前节点无输入表，暂不支持独立手动执行'
  if (execMode.value === 'input') {
    if (inputTableId.value && !sameTable.value && scope.value !== 'input') return '请先切到"输入数据"范围并勾选记录'
    if (!selectedRowIds.value.length) return '请先勾选要发送的数据'
  }
  if (execMode.value === 'upstream') {
    if (!selectedRowIds.value.length) return '请先勾选要从上一节点重跑的数据'
  }
  return ''
})
const canExecute = computed(() => execMode.value !== 'none' && !execDisabledReason.value)
const canPickRows = computed(() => {
  if (execMode.value === 'upstream') return true
  return execMode.value === 'input' && (sameTable.value || scope.value === 'input' || !inputTableId.value)
})
// 输入≠输出、且确实有输入表可切时，输出 tab 改用说明文字。没有输入表就没有可切的「输入」，
// 不能把发后续入口藏掉（列表节点输出 900 正是发给详情的那批行）。
const viewingOutputOnly = computed(() => execMode.value === 'input' && !sameTable.value && scope.value === 'output' && !!inputTableId.value)

const selectedRowIds = ref<string[]>([])

async function onSendFetch() {
  if (execMode.value !== 'fetch' || !sourceId.value) return
  await confirmDanger(
    '发起抓取',
    `将对源「${source.value?.name || sourceId.value}」发起抓取，是否继续？`,
    async () =>
      snatchLauncher.value?.launch(sourceId.value, {
        configId: selectedCfg.value?.configId,
        onSuccess: () => ElMessage.success('已发起抓取'),
      }),
    () => {},
  )
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
  } else if (receipt.rejectCount > 0 && receipt.okCount === 0) {
    ElMessage.warning(`已提交 ${receipt.submitted} 条，全部被目标节点的进入条件拒绝，未进入下一步`)
  } else if (receipt.rejectCount > 0) {
    ElMessage.warning(`已提交 ${receipt.submitted} 条：${receipt.okCount} 条已进入下一步，${receipt.rejectCount} 条被进入条件拒绝`)
  } else {
    ElMessage.success(`已提交 ${receipt.submitted} 条，${receipt.okCount} 条已进入下一步`)
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
function runNextStep(ids: string[], tableId: string, nodeName: string) {
  return withNodeErrorContext(nodeName, () => dataApi.nextStep(sourceId.value, tableId, ids))
}
async function onSendNextStep() {
  if (execMode.value !== 'input' || !canExecute.value || !selectedTable.value || !selectedRowIds.value.length) return
  const count = selectedRowIds.value.length
  const nodeName = selectedCfg.value?.title || selectedNodeId.value
  const ids = [...selectedRowIds.value]
  const tableId = selectedTable.value
  // 0824：数据视图这条工具栏只发后续（nextStep）；按源抓取走画布头 SnatchLauncher，不走这里。
  // 多后继时说清去向：后端按各后继的进入条件分流，不是"发给某一个"（2026-09-04 确认）
  const fanout = branchTargets.value.length
    ? `\n这批数据会按各后继节点的进入条件分流到：${branchTargets.value.map((t) => `${t.title}（${t.condition}）`).join('、')}`
    : ''
  await confirmDanger('发后续任务', `将对选中的 ${count} 条数据发起"${nodeName}"的后续处理任务。${fanout}\n是否继续？`, async () => {
    const res = await runNextStep(ids, tableId, nodeName)
    return res
  }, showNextStepReceipt)
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
  await confirmDanger(
    '从上一节点重跑',
    `将从上一节点「${predName}」重新发起 ${ids.length} 条${skipHint}。重跑结果需等任务完成后刷新。是否继续？`,
    async () => {
      const res = await runNextStep(ids, tableId, predName)
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
  if (filters.dataId && filters.parentId) return '「发全部」不支持按数据 ID / 父 ID 筛选，请改用勾选后「发后续任务」'
  if (filters.dataId) return '「发全部」不支持按数据 ID 筛选，请改用勾选后「发后续任务」'
  if (filters.parentId) return '「发全部」不支持按父 ID 筛选，请改用勾选后「发后续任务」'
  return ''
})
async function onSendAllUnderFilter() {
  if (execMode.value !== 'input' || !canPickRows.value || !selectedTable.value) return
  if (sendAllBlockedReason.value) return
  const nodeName = selectedCfg.value?.title || selectedNodeId.value
  const tableId = selectedTable.value
  await confirmDanger(
    '发全部后续',
    `[实验性] 将对当前筛选条件下"${nodeName}"的全部数据发起后续处理（命中 ${total.value} 条，最多 500000 条），是否继续？`,
    () => withNodeErrorContext(nodeName, () => dataApi.nextStepBatch({
      tableId, sourceId: sourceId.value,
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

/** 删除后统一回到第 1 页重查：删掉的行可能横跨当前页，留在原页会看到空洞或错位的分页。 */
function afterDelete() {
  selectedRowIds.value = []
  runQuery()
}

function onDeleteSelected() {
  if (!selectedRowIds.value.length || !selectedTable.value) return
  const tableId = selectedTable.value
  const ids = [...selectedRowIds.value]
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
  )
}

/** all=0 当日 / all=1 所有。始终带 sourceId——这个页面就是单源视图，不提供跨源删除。 */
function onDeleteByRange(all: 0 | 1) {
  if (!selectedTable.value || !sourceId.value) return
  const tableId = selectedTable.value
  const sid = sourceId.value
  const rangeText = all === 1 ? '所有' : '当天'
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
  )
}

function onDeleteOne(row: DataRow) {
  if (!selectedTable.value) return
  const tableId = selectedTable.value
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
  )
}

// 默认选**首个可跑节点**。页签快照可以记住筛选，但不能把人送回上次停的末节点——
// 0831 F09 会上原话：「我要看第一个节点的数据我还得点一下」。
// URL `nodeId`（任务视图跳过来、查看条件深链）仍然优先。
watch(
  allNodes,
  (nodes) => {
    if (!nodes.some((n) => n.id === selectedNodeId.value)) {
      const firstId = firstRunnableNodeId(flow.main, flow.configs) || nodes[0]?.id || ''
      const fromQuery = queryNodeId.value && nodes.some((n) => n.id === queryNodeId.value) ? queryNodeId.value : ''
      selectedNodeId.value = fromQuery || firstId
      const snap = ws.snapshotOf(tabKey.value)
      if (!fromQuery && snap?.selectedNodeId === firstId && snap.filters) {
        page.value = snap.page ?? 1
        const { dataId, parentId, state, sql } = snap.filters
        Object.assign(filters, { dataId, parentId, state, sql })
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
  if (!id) return
  ui.clearInspectorFieldFilter()
  if (id === selectedNodeId.value) return
  selectedNodeId.value = id
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
// 反向联动：从画布切到数据视图时，右侧已经选中的节点应当就是中间默认看的那个。
watch(() => flow.selectedId, (id) => {
  if (id && id !== selectedNodeId.value && allNodes.value.some((n) => n.id === id)) onSelectNode(id)
})

watch(queryNodeId, (id) => {
  if (id && allNodes.value.some((n) => n.id === id)) onSelectNode(id)
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
function clearFilters() {
  filters.dataId = ''
  filters.parentId = ''
  filters.state = ''
  filters.sql = ''
  runQuery()
}
/**
 * 「按条件查源 →」（0903 Y2-7 → 0904 Q1 改名，原名「按此条件反查源」被嫌奇怪：
 * 「这名字起的奇怪，这是不是按源统计？」「按源查源列表」）。
 *
 * 单源视图里**不直接反查**——这里只有一个源，反查它自己没有意义。用户在这个页面问的是
 * 「同样的脏数据，别的源上有没有」，那是全部源数据视图的事。所以这个按钮**带着条件跳过去**，
 * 到那边再点反查，而不是在这里塞第二套反查 UI。
 *
 * 条件通过 URL 传：目标是另一棵组件树（SiteDetailView → SiteDataView），没有共享状态可用。
 * 刻意**不带 sourceId**——带上就还是单源视图，跳了等于没跳。
 */
const canBackTrace = computed(() => !!selectedTable.value
  && !!(filters.sql || filters.state || filters.dataId || filters.parentId))
function openBackTraceInSiteView() {
  if (!canBackTrace.value) return
  if (!siteId.value) {
    ElMessage.warning('该源没有所属网站，无法切到全部源数据视图')
    return
  }
  void router.push({
    path: '/canvas',
    query: {
      siteId: siteId.value,
      view: 'data',
      condTable: selectedTable.value,
      ...(filters.sql ? { condSql: filters.sql } : {}),
      ...(filters.state ? { condState: filters.state } : {}),
      ...(filters.dataId ? { condDataId: filters.dataId } : {}),
      ...(filters.parentId ? { condParentId: filters.parentId } : {}),
    },
  })
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
const summaryOpen = ref(false)

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
const detailFields = computed(() => fieldsFromTableMeta(meta.value?.fields, detailRow.value?.values))
const parentFields = computed(() => fieldsFromShowItems(parentDetail.value?.showItems))
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
async function saveEdit() {
  if (!detailRow.value || !selectedTable.value) return
  saving.value = true
  try {
    const res = await dataApi.rowUpdate(selectedTable.value, detailRow.value.dataId, { ...editValues })
    if (res?.row) {
      const idx = detail.index
      if (idx >= 0) rows.value[idx] = { ...rows.value[idx], values: res.row.values }
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
const filePreview = reactive({ visible: false, path: '', name: '', url: '' })
// sourceUrl 由 DataGrid 从被点的那一行算好带过来（2026-09-11）。此前是从 detailFields
// 取——那是详情抽屉当前行的字段，直接点单元格时详情没开，于是永远取不到，
// 预览里的「原始地址 ↗」一直不显示。
function onCellFile(path: string, _field?: unknown, sourceUrl = '') {
  filePreview.path = path
  filePreview.name = path.split('/').pop() || ''
  filePreview.url = sourceUrl
    || detailFields.value.find((f) => f.prop === 'url')?.href
    || detailFields.value.find((f) => f.href)?.href
    || ''
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
  if (!inputFields.length) return {}

  const params: Record<string, unknown> = {}
  for (const field of meta.value?.fields ?? []) {
    if (!inputFields.includes(field.prop) && !inputFields.includes(field.columnName ?? '')) continue
    const raw = row?.values?.[field.columnName ?? field.prop]
    params[field.prop] = raw == null ? '' : String(raw)
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

    <!-- 折叠开关和「查看条件」都放在轨道自己身上：控件应该长在它所控制的东西上，
         而且这两个都是"这个节点的上下文"，跟下面那行"怎么查"不是一回事
         （2026-08-15 第十三次纠偏：原来把它俩塞进筛选行，等于把一组筛选条件劈成两半）。
         收起后 .rv-railbox 靠 min-height 留出一条窄带，展开按钮不会跟着消失。 -->
    <div v-if="selectedNodeId && railOpen" class="rv-railbox">
      <div class="rv-bar" data-testid="data-process-rail">
        <ProcessNodeRail :model-value="selectedNodeId" :layout="processLayout" @update:model-value="onSelectNode" />
        <div v-if="!allNodes.length" class="rv-bar-empty">当前流程没有可查看数据的节点</div>
      </div>
    </div>

    <!-- 主干行（0910 重排）：左端是节点上下文（展开流程 / 查看条件），中间「查询」+「筛选」，
         右端是数据操作。四个筛选维度收进「筛选」抽屉，输入/输出/执行方式在下面的表头行。
         节点选择归流程图（0819 会议 05:13"上面那个和下面那个不是两个都有了吗？只要有一个
         就行了"——原来这里还有一个与轨道完全同步的节点下拉，同一件事两个控件，已删）。 -->
    <!-- 查询条件一律点「查询」执行，不绑回车（2026-08-20 决定）。原先绑了 @keyup.enter，
         但中文输入法上屏时也会发 Enter 的 keyup，而 Vue 的 @keyup.enter 不过滤 isComposing——
         实测打字打到一半就被当成回车查了一次，条件只输了半截，结果还看不出是怎么来的。 -->
    <div v-if="selectedNodeId" class="ctx-summary" data-testid="data-node-context">
      <!-- 全屏时源信息头被藏起来了，这里把源名补回来，否则看不出在看哪个源的数据。 -->
      <span v-if="fullscreen" class="rv-fs-source" :title="source?.name || sourceId">{{ source?.name || sourceId }}</span>
      <!-- 轨道开合与「查看条件」放在主干行左端（0910）。它们一度浮在轨道区右上角——
           那样收起后得靠 .rv-railbox 的 min-height 留一条 32px 窄带专门托住按钮，
           一整行的高度只换一个按钮；而主干行左边又只剩「筛选」「查询」两个，空了半边。
           挪到这里两个问题一起解决，代价是规格必须跟这一行看齐（28px 方角），
           不能再用轨道条上那种 24px 胶囊——胶囊夹在一排方角按钮中间会参差扎眼。 -->
      <button
        type="button"
        class="rv-rail-toggle"
        :class="{ open: railOpen }"
        data-testid="data-rail-toggle"
        :title="railOpen ? '收起流程节点轨道' : '展开流程节点轨道'"
        @click="railOpen = !railOpen"
      >{{ railOpen ? '收起流程' : '展开流程' }} <span class="arrow">▾</span></button>
      <button
        v-if="hasCond"
        type="button"
        class="ctx-toggle"
        data-testid="data-node-condition-link"
        title="到流程画布查看该节点的完整配置与条件"
        @click="openNodeCondition"
      >查看条件 <span class="arrow">↗</span></button>
      <template v-if="hasAnyTable">
        <span class="rv-actions">
          <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
        </span>
        <button
          type="button"
          class="rv-filter-toggle"
          :class="{ on: activeFilterCount > 0, open: filtersOpen }"
          data-testid="data-filter-toggle"
          :title="filtersOpen ? '收起筛选条件' : '展开筛选条件（数据 ID / 父 ID / 状态 / SQL）'"
          @click="filtersOpen = !filtersOpen"
        >筛选<span v-if="activeFilterCount" class="n">{{ activeFilterCount }}</span></button>
        <!-- 数据操作组（0909 第二次重排，用户「把操作列的放一行」）：发任务/删除是「查出这批
             数据之后对它动手」，跟查询条件同一语境，放筛选行右端；表头行只留「这张表是什么 +
             怎么看它」。这三个按钮最宽（发全部带命中数、删除数据带下拉箭头），压在表头行上
             实测把那条横条撑到横向滚动——第一次重排只搬走了窄按钮，没解决溢出。
             「已选 N 条」跟着走：它唯一的用途就是告诉你「发后续任务」会发几条。 -->
        <span class="rv-data-ops">
          <span v-if="canPickRows" class="muted">已选 {{ selectedRowIds.length }} 条</span>
          <!-- 输入≠输出、当前看的是输出 tab：这批行不是本节点的输入，不给一个点了才发现
               被禁用的按钮，直接说清楚去哪操作（M3-0C，对应用户"为什么一个有checkbox一个
               没有"的反馈）。 -->
          <span v-if="viewingOutputOnly" class="muted" data-testid="data-view-only-hint">本节点产出数据；如需发起本节点任务，请切到"输入"勾选</span>
          <button
            v-else-if="execMode !== 'none'"
            class="rc-btn primary"
            type="button"
            data-testid="data-exec-btn"
            :disabled="!canExecute"
            :title="execDisabledReason"
            @click="execMode === 'fetch' ? onSendFetch() : execMode === 'upstream' ? onSendUpstream() : onSendNextStep()"
          >{{ execMode === 'fetch' ? '发起抓取' : execMode === 'upstream' ? '从上一节点重跑' : '发后续任务' }}</button>
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
          <!-- 0903 Y0-B：发任务只剩两档——主按钮（按勾选）+ 这一个「发全部」。
               原来是「发后续 ▾」下拉里装三项（发全部/发本页/发大量），后两项已删；
               只剩一项还做成下拉是坏交互（点一下才看见里面只有一个），改成并排按钮。
               末节点「从上一节点重跑」不走这一档，故 execMode === 'input' 仍是前提。 -->
          <!-- 文案直接摆出命中数（0903）：用户的困惑本质是"看不出这个按钮要发多少"，
               把 total 显示出来比任何说明都直接。禁用时 title 说明原因与替代做法。 -->
          <button
            v-if="execMode === 'input' && canPickRows"
            class="rc-btn"
            type="button"
            data-testid="data-exec-all-btn"
            :disabled="!!sendAllBlockedReason"
            :title="sendAllBlockedReason || '不按勾选，按当前筛选条件发全部'"
            @click="onSendAllUnderFilter"
          >发全部（命中 {{ total }} 条）</button>
          <!-- 删除数据（2026-09-09 从数据中心迁入）：跟发任务并排——都是「对这批数据动手」。
               仅测试表出现（meta.state === 'C'），与数据中心同一道门禁。
               标红（.danger）：它是这组里唯一不可撤销的操作，跟旁边的发任务按钮必须一眼分得开。
               （0909 重排前它一度去过红——当时它挤在一排 24px 的统计/全屏中间，红色让它在
               尺寸断层上格外刺眼；现在同组同规格，这个顾虑不存在了。） -->
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
      </template>
    </div>

    <!-- 筛选抽屉：四个筛选维度 + 清空 + 反查跳转。它们是"偶尔才改一次"的东西，
         常驻一整行不划算；而主干行上的动作（查询、发任务、删除）每次都用，留在外面。
         这里不再需要 0909 那个 .rv-linebreak 强制换行——分行点漂移的根源是条件与动作
         挤在同一个 flex 容器里，现在两者本就分属两行了。 -->
    <div v-if="selectedNodeId && hasAnyTable && filtersOpen" class="ctx-summary rv-filterbar" data-testid="data-filter-bar">
      <input v-model="filters.dataId" class="rv-input id" placeholder="数据 ID" />
      <input v-model="filters.parentId" class="rv-input id" placeholder="父 ID" />
      <select v-model="filters.state" class="rv-input st">
        <option value="">状态（全部）</option>
        <option value="C">C 成功</option>
        <option value="E">E 出错</option>
        <option value="L">L 处理中</option>
      </select>
      <SqlConditionEditor v-model="filters.sql" v-slot="{ value, update }" :table-id="selectedTable" :table-name="meta?.tableName" class="rv-sql">
        <input :value="value" @input="update(($event.target as HTMLInputElement).value)" class="rv-input flex" data-testid="data-cond-sql" placeholder="SQL 条件，用列头上的物理列名（如 K1 LIKE '%关键词%')" />
      </SqlConditionEditor>
      <button class="rc-btn" type="button" @click="clearFilters">清空</button>
      <!-- 0903 Y2-7：带着条件跳到全部源数据视图，在那儿才有"反查源"这件事 -->
      <button
        class="rc-btn"
        type="button"
        data-testid="data-backtrace-jump"
        :disabled="!canBackTrace"
        :title="canBackTrace ? '带着当前条件切到全部源数据视图，在那里反查哪些源命中' : '先填至少一个数据条件（SQL / 状态 / 数据 ID / 父 ID）'"
        @click="openBackTraceInSiteView"
      >按条件查源 →</button>
    </div>

    <template v-if="hasAnyTable">
      <!-- 条件已改但未执行：盖住上一次的结果状态，避免把旧的失败/空表当成当前条件的结果 -->
      <div v-if="slowQuery" class="rv-notice" role="status" data-testid="data-slow-query">查询较慢，可缩小条件范围再试；本次请求仍在等待结果</div>
      <div v-else-if="filtersDirty && !loading" class="rv-notice" role="status" data-testid="data-filters-dirty">查询条件已修改，点「查询」执行</div>
      <template v-else>
        <div v-if="metaError" class="rv-notice" role="status">{{ metaError }}</div>
        <div v-if="dataError" class="rv-notice error" role="alert" :title="dataErrorFull || dataError">{{ dataError }}</div>
      </template>

      <!-- 表头内容走 DataGrid 的 #head 插槽，跟「列」和分页共用同一条横条。原来这里是
           独立的 .rv-tablehead(47px) + DataGrid 自己的列按钮行(33px) + .rv-pager(45px)
           三条横条，加起来 125px 全在挤数据区（2026-08-15 第十二次纠偏）。
           输入/输出切换紧挨着表名——这两个按钮控制的正是"表头显示的是哪张表"。 -->
      <DataGrid
        class="rv-grid"
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
        <template #head>
          <!-- 输入表===输出表：会议要的"展示看输出/发送用输入"两件事落在同一张表上，
               双 tab 自我矛盾，合并成一个（M3-0C 方案 A）；标签写"输入·输出"明示这张表
               两个身份都占，不是随便挑了一个名字。 -->
          <span v-if="sameTable" class="ctx-piece" data-testid="data-scope-merged"><span class="k">输入·输出</span><span class="v code">{{ inputTableId }}</span></span>
          <template v-else>
            <template v-if="inputTableId">
              <button
                v-if="scopeSwitchable"
                type="button"
                class="ctx-piece scope-piece"
                :class="{ active: scope === 'input' }"
                data-testid="data-scope-input"
                @click="onScopeChange('input')"
              ><span class="k">输入</span><span class="v code">{{ inputTableId }}</span></button>
              <span v-else class="ctx-piece"><span class="k">输入</span><span class="v code">{{ inputTableId }}</span></span>
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
              ><span class="k">输出</span><span class="v code">{{ outputTableId }}</span></button>
              <span v-else class="ctx-piece"><span class="k">输出</span><span class="v code">{{ outputTableId }}</span></span>
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
          <span class="rv-tablename" :title="meta?.tableName || selectedTable || ''">{{ meta?.tableName || selectedTable || '—' }}</span>
          <span class="rv-tablecount">{{ total.toLocaleString() }} 行</span>
        </template>
        <!-- 视图控制回到 #head-right（0909 第二次重排）：这是 DataGrid 不随 .dg-head 横向
             滚动的常驻区，当初正是为「全屏」这类任何时候都该点得到的开关设的。它右边紧邻
             DataGrid 自己的列菜单（下一步字段 / 列 N/M），四个按钮同宽同高，连成一组。 -->
        <template #head-right>
          <button
            class="rc-btn tiny"
            type="button"
            data-testid="data-summary-btn"
            title="按当前筛选条件统计"
            @click="summaryOpen = true"
          >统计</button>
          <button
            class="rc-btn tiny"
            type="button"
            data-testid="data-fullscreen-toggle"
            :title="fullscreen ? '退出全屏（Esc）' : '全屏查看数据'"
            @click="fullscreen = !fullscreen"
          >{{ fullscreen ? '⤡ 退出全屏' : '⤢ 全屏' }}</button>
        </template>
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
            small
            data-testid="data-pagination"
            @size-change="runQuery"
          />
        </template>

      </DataGrid>
    </template>
    <div v-else-if="selectedNodeId" class="rv-empty-scope" data-testid="data-node-empty">该节点不产生可查看的数据，也不提供手动执行入口</div>

    <el-drawer v-model="detail.visible" class="rv-detail-drawer" :with-header="false" size="560px">
      <div v-if="detailRow" class="rv-detail">
        <div class="rv-d-head">
          <div class="rv-d-head-main">
            <div class="rv-d-title">{{ detailRow.title }}</div>
            <!-- 源 ID 跟数据 ID 并列：详情是"这条数据是什么"的完整视图，
                 光有数据 ID 看不出它属于哪个源（0819 会议 09:23～09:44）。 -->
            <div class="rv-d-sub">数据 ID {{ detailRow.dataId }} · 源 ID {{ detailRow.sourceId || sourceId }}</div>
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
              <span>上游数据 · {{ parentDetail.row.dataId }}</span>
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
    <SnatchLauncher ref="snatchLauncher" />
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
</template>

<style scoped>
.ctx-summary .rv-sql { flex: 1 1 320px; min-width: 180px; width: auto; }
.rv-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
/* 全屏：同一份 DOM 直接铺满视口，不复制模板也不套弹层。祖先链上没有 transform/filter/
   contain（已核对 AppShell.vue、FlowCanvas/index.vue），fixed 能正常逃逸；外层 .rc-shell
   的 z-index 是 21、顶栏是 20，所以这里盖得住顶栏。详情抽屉渲染在 .rv-shell 内部，
   会跟着一起进全屏。 */
.rv-shell.is-fullscreen { position: fixed; inset: 0; z-index: 60; height: 100vh; border: 0; border-radius: 0; }

/* 轨道容器：控件浮在轨道右上角（.rv-bar 自己会横向滚动，控件必须放在滚动容器外面，
   否则会跟着内容滚走）。0910 起收起时整块不渲染：开合按钮已挪到主干行，
   原先靠 min-height 留的那条 32px 窄带纯粹是为托住按钮，按钮走了它就只是占地方。 */
.rv-railbox { position: relative; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }

/* 折叠开关：0910 起默认收起（会议 §2-2），按钮站在主干行左端，
   所以规格跟这一行的其余按钮一致（28px / 6px 圆角 / 12px）。
   **不要改回 24px 胶囊**——那是给"浮在轨道右上角、不与任何按钮同排"设计的；
   放进这一行会夹在一排方角按钮中间参差扎眼（0910 两种都实测过）。 */
.rv-rail-toggle { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 700; cursor: pointer; }
.rv-rail-toggle:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.rv-rail-toggle .arrow { display: inline-block; flex: none; color: var(--rc-faint); transition: transform .18s ease; }
.rv-rail-toggle.open .arrow { transform: rotate(180deg); }

/* 筛选开关：没有条件时安静；一旦有条件生效就整体变主色并挂出数字——
   收起状态下这是唯一说明"还有筛选在起作用"的信号。 */
.rv-filter-toggle { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 700; cursor: pointer; }
.rv-filter-toggle:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.rv-filter-toggle.open { background: #f1f5f9; }
.rv-filter-toggle.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rv-filter-toggle .n { display: inline-block; min-width: 16px; padding: 0 4px; border-radius: 999px; background: var(--rc-primary); color: #fff; font-family: var(--rc-mono, monospace); font-size: 10.5px; line-height: 16px; text-align: center; }

/* 筛选抽屉：主干行的延伸，靠底色表示从属关系，不做成独立卡片。 */
.rv-filterbar { background: #f8fafc; }

/* 全屏下源信息头被藏起来，用这个补回"在看哪个源"。 */
.rv-fs-source { flex: none; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; font-weight: 700; color: var(--rc-text); }

.rv-bar { position: relative; padding: 8px 0; background: #f8fafc; overflow: auto; }
.rv-resize { height: 6px; background: var(--rc-border-soft); cursor: row-resize; position: relative; transition: background 0.15s; }
.rv-resize:hover { background: var(--rc-primary-bg); }
.rv-resize-grip { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 28px; height: 2px; background: var(--rc-faint); border-radius: 1px; box-shadow: 0 4px 0 var(--rc-faint); }
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
/* 窄屏换行，不横向滚动（2026-08-20）：这一行原本 nowrap + overflow-x:auto，窗口一窄就出现
   横向滚动条——筛选条件横向滚动很难用，「查询」按钮会被滚出视野，得先滚回去才点得到。
   换行只是多占一行高度，比这个代价小得多；宽屏下仍是一行，没有变化。 */
.ctx-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 10px; padding: 7px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.ctx-summary > * { flex-shrink: 0; }
/* SQL 框是这一行唯一可伸缩的元素，负责吸收多余/不足的宽度。必须比上面那条 no-shrink
   规则更具体，否则整行永远超宽、把右端的「查询/清空」挤出可视区——2026-08-15 实测回归，
   跟之前"查看条件被滚没"是同一类错误：nowrap 的行里必须留一个能缩的元素。 */
/* SQL 是这一行里唯一需要长内容的输入框，基准给大、独占伸缩，把剩余宽度全吃掉。
   但这一行在常规面板宽度下（左边 220px 主侧栏 + 200px 源列表，实际只剩约 800px）
   本来就装不下 6 个控件，所以再加一手：聚焦时临时变宽到 560px，把其他控件挤到横向
   滚动区外——查询/清空是 sticky 钉住的，照样点得到。真要长时间写 SQL 走全屏，
   那边这一行有 1280px（2026-08-15 第十三次纠偏：SQL 框太小）。 */
.ctx-summary .rv-input.flex { flex: 1 1 320px; min-width: 180px; width: auto; }
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
.rv-actions { display: inline-flex; align-items: center; gap: 6px; padding-left: 8px; }
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
/* 跟开合按钮同组，一起站在主干行上，规格随行（配色保留：黄＝跳出本页去画布看配置）。 */
.ctx-toggle { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 12px; border: 1px solid #fde68a; border-radius: var(--rc-radius-sm); background: #fffbeb; color: #92400e; font-size: 12px; font-weight: 700; cursor: pointer; }
.ctx-toggle:hover { border-color: #fbbf24; }
.ctx-toggle .arrow { display: inline-block; transition: transform .18s ease; }
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
.ctx-summary .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
/* 数据操作组（发起抓取/发后续/从上一节点重跑/测试脚本/发全部/删除数据 + 各自的说明文字）：
   钉在筛选行右端。margin-left:auto 在 .ctx-summary 的 wrap 行内把它推到最右；窄屏 wrap 到
   下一行时自然左对齐，不做额外处理——响应式下让位比硬撑更好。
   按钮尺寸由上面的 .ctx-summary .rc-btn（28px）统一接管，跟同行的「查询/清空」一致；
   删除数据那个 .tiny 也一并拉齐，这行不再有 24px 的邻居。 */
.rv-data-ops { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.ctx-summary .rc-btn.tiny { height: 28px; padding: 0 12px; font-size: 12px; }

/* 表头内容现在渲染在 DataGrid 的 #head 插槽里（那条横条由 .dg-toolbar 负责排版），
   这里只留下内容本身的样式，不再有独立的 .rv-tablehead / .rv-pager 横条。 */
/* 这一行的空间预算（2026-08-19 实测：需要 988px 只有 924px，溢出 64px 出横向滚动条）：
   表名是唯一可以牺牲的——允许收缩+省略号，其余按钮/分页都得完整可见可点。
   注意 .dg-head > * 有 flex-shrink: 0，这里要显式改回 1 才收缩得动。 */
.rv-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); min-width: 60px; flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-tablecount { font-size: 12px; color: var(--rc-faint); }
.muted { color: var(--rc-faint); font-size: 12px; }
.rv-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.rv-notice.error { border-bottom-color: #fecaca; background: #fef2f2; color: #b91c1c; }

.rv-grid { flex: 1; min-height: 0; }
/* 表头行里的按钮比筛选行矮一档，免得这条横条被撑高又把数据区挤回去。 */
.rc-btn.tiny { height: 24px; padding: 0 10px; font-size: 11.5px; }

.rv-detail-drawer :deep(.el-drawer__body) { display: flex; flex-direction: column; height: 100%; padding: 0; overflow: hidden; }
.rv-detail { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.rv-d-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.rv-d-head-main { min-width: 0; flex: 1; }
.rv-d-close { flex: none; height: 28px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.rv-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); line-height: 1.4; word-break: break-word; }
.rv-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 4px; }
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
.ctx-summary :deep(.dcb) { flex: 1 1 320px; min-width: 180px; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }
</style>
