<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useWorkspaceStore } from '@/stores/workspace'
import { dataApi, isMockMode, isProductionBackend, parseNextStepReceipt, type DataTableMeta, type DataRow, type EntryDetail } from '@/api'
import {
  buildHorizontalLayout, nodeOutputTable, nodeEntryCondition, conditionGroupLabel, conditionGroupIsSet,
  isDecision, isParallel, isFirstRunnableNode, hasAmbiguousInput, type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import { confirmDanger } from '@/utils/confirmDanger'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import DataGrid from './DataGrid.vue'
import FilePreview from './components/FilePreview.vue'
import { extFromName } from '@/utils/ossFile'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { readRailOpen, writeRailOpen } from './railPref'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'
import SnatchLauncher from '@/views/FlowCanvas/source/SnatchLauncher.vue'

// 数据视图只属于具体源流程（0812 计划 M2-4：网站"全部源"态改用独立的 SiteDataView.vue，
// 不再靠 siteWide 布尔开关把两种数据流塞进同一个组件——那正是 M1-4 删掉的"代表源"问题的成因）。
const flow = useFlowStore()
const ws = useWorkspaceStore()

const source = computed(() => flow.sourceCtx)
const router = useRouter()
const route = useRoute()
const sourceId = computed(() => source.value?.sourceId ?? '')
const siteId = computed(() => source.value?.siteId ?? '')
const tabKey = computed(() => sourceId.value)

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

// 节点轨道默认展开：轨道是"这个源的流程长什么样"的上下文，进页面第一眼就该看到；
// 想把这 96px 让给数据的人自己收起来。真要大量看数据走全屏，不靠默认折叠常规页面
// 换那几行（2026-08-15 定案）。
const railOpen = ref(readRailOpen())
watch(railOpen, writeRailOpen)
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

type ExecMode = 'fetch' | 'input' | 'none'
const execMode = computed<ExecMode>(() => {
  if (isStructuralNode.value || (!outputTableId.value && !inputTableId.value)) return 'none'
  return inputTableId.value ? 'input' : 'fetch'
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

// 节点手动执行（0812 计划 M2.2，方案 §6.7）：execMode 只描述"这个节点大概是什么类型"，
// 真正能不能点执行按钮还要过 M2-10/M2-14 两道判定——execMode==='fetch' 不代表真的是流程
// 拓扑意义上的首节点（可能只是恰好没有可解析的输入表），execMode==='input' 也不代表
// nextStep 能确定唯一目标节点（旧接口没有 targetNodeId，输入表被多个节点共用时必须禁用）。
const isVerifiedFirstNode = computed(() => (selectedNodeId.value ? isFirstRunnableNode(flow.main, flow.configs, selectedNodeId.value) : false))
const isAmbiguousInput = computed(() => {
  if (execMode.value !== 'input' || !selectedNodeId.value) return false
  return hasAmbiguousInput(allNodes.value, flow.main, flow.branches, flow.configs, flow.branchGroups, selectedNodeId.value)
})
// 「只能在输入范围勾行发送」是 0812 会议的明确决定，不是实现方便：方案 §6.7-B（会议
// 48:12～59:54）原文"首节点按源发起抓取，后续节点按输入表数据发起本节点任务，不能把两类
// 动作做成同一个无上下文按钮"。语义是"让**本节点**处理这批输入数据"（节点视角），跟旧平台
// EntryList2.vue 的"把当前这张表的行发去做下一步"（表视角）**是不同的模型，会议特意改的**。
// 输出表的行不是本节点的输入，所以那边不给勾选框。
// —— 2026-08-15 我一度按旧平台把这条限制去掉，是错的，已按会议记录恢复。
const execDisabledReason = computed(() => {
  if (execMode.value === 'fetch' && !isVerifiedFirstNode.value) return '当前节点无输入表，暂不支持独立手动执行'
  if (execMode.value === 'input') {
    if (isAmbiguousInput.value) return '该输入表被多个节点共用，无法确定任务目标节点，暂不支持手动执行'
    // sameTable 时只有一个合并 tab，没有"切到输入范围"这回事，天然满足。
    if (!sameTable.value && scope.value !== 'input') return '请先切到"输入数据"范围并勾选记录'
    if (!selectedRowIds.value.length) return '请先勾选要发送的数据'
  }
  return ''
})
const canExecute = computed(() => execMode.value !== 'none' && !execDisabledReason.value)
const canPickRows = computed(() => execMode.value === 'input' && !isAmbiguousInput.value && (sameTable.value || scope.value === 'input'))
// 输入≠输出时，输出 tab 上的行不是本节点的输入（M2-14/§6.7-B 的限制），这里不该留一个
// 点了才发现被禁用的按钮——改成就近说明去哪操作，而不是把理由藏进 disabled 按钮的 title
// 里（正是这条改动的起因：2026-08-15 用户反馈"为什么输入输出一个有checkbox一个没有"）。
const viewingOutputOnly = computed(() => execMode.value === 'input' && !sameTable.value && scope.value === 'output')

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
// 整条请求业务失败，见方案 §12.1B）。这里统一补上目标节点名；命中"运行时异常"这个
// 后端固定措辞时才追加条件排查提示——写保护、网络失败等其他原因不应被误导成条件问题。
// 抽成通用包装（不叫 runNextStep 了）是因为发全部后续/发大量后续调的是 nextStepBatch，
// 同一个错误定位问题同样存在，不能只给逐行/本页两个入口修。
async function withNodeErrorContext<T>(nodeName: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const hint = raw.includes('运行时异常') ? '（多为该节点的进入条件表达式写错，可检查节点配置里的进入条件）' : ''
    throw new Error(`目标节点"${nodeName}"处理失败：${raw}${hint}`)
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
  // 旧平台两个不一样的方法：首节点按源"发起抓取"（sendSnatch），后续节点按输入数据
  // "发后续任务"（nextStep）——0812 会议 53:40 原文明确是"两个不一样的方法"，统一叫
  // "发起抓取"是我之前的误判，已按会议记录改回两个文案（M3-0A）。
  await confirmDanger('发后续任务', `将对选中的 ${count} 条数据发起"${nodeName}"的后续处理任务，是否继续？`, async () => {
    const res = await runNextStep(ids, tableId, nodeName)
    selectedRowIds.value = []
    return res
  }, showNextStepReceipt)
}
// M3-0E：旧平台「发后续 ▾」下拉第二项 sendNextCurPage——取当页全部 ENTRY_ID 一次发送，
// 免去手点勾选框；guard 跟逐行勾选发送同一套（canPickRows 决定能不能勾行，这里是"整页
// 一起勾"，本质是同一件事）。成功后仅在确实还有下一页时才自动翻页，不像旧平台那样盲目
// +1（可能翻到确定为空的页）。
async function onSendCurrentPage() {
  if (!canPickRows.value || !selectedTable.value || !rows.value.length) return
  const count = rows.value.length
  const nodeName = selectedCfg.value?.title || selectedNodeId.value
  const ids = rows.value.map((r) => r.dataId)
  const tableId = selectedTable.value
  await confirmDanger('发本页任务', `将对本页全部 ${count} 条数据发起"${nodeName}"的后续处理任务，是否继续？`, async () => {
    const res = await runNextStep(ids, tableId, nodeName)
    selectedRowIds.value = []
    if (page.value * size.value < total.value) nextPage()
    return res
  }, showNextStepReceipt)
}

// 「发后续 ▾」下拉：把发全部后续/发本页任务/发大量后续收进同一个菜单，对齐旧平台自己的
// 布局（截图实测）。原来发后续任务+发本页任务两个按钮常驻，行里已经很挤，再加两个新按钮
// 会更挤；旧平台自己也是"发后续任务"常驻 + 其余三项收进下拉，不是我们发明的形态。
// 点击面板外关闭：跟 DataGrid.vue 的「列 ▾」同一套模式——全局 click 关闭，面板自己
// @click.stop 防止点面板内部时被同一次事件冒泡关掉。
//
// 真实浏览器验收发现（2026-08-19）：这个按钮渲染在 DataGrid 的 #head 插槽里，而 #head
// 的父容器 .dg-head 设了 overflow-x: auto——CSS 规范里 overflow-x 不是 visible 时
// overflow-y 会被浏览器强制按 auto 处理，绝对定位的下拉面板往下延伸的部分被这个容器
// 当成"内容溢出"裁掉了一截，出现滚动条、菜单显示不全。改成 Teleport 到 body、position:
// fixed 跟随触发按钮的真实坐标，彻底脱离 .dg-head 的裁剪盒子，不是靠加 overflow:visible
// 覆盖——那样反而会让 .dg-head 横向滚动条本身的意义（表头内容多时可横向滚）跟着失效。
const moreMenuOpen = ref(false)
const moreToggleRef = ref<HTMLElement | null>(null)
const morePanelPos = reactive({ top: 0, left: 0 })
async function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value
  if (!moreMenuOpen.value) return
  await nextTick()
  const rect = moreToggleRef.value?.getBoundingClientRect()
  if (rect) { morePanelPos.top = rect.bottom + 4; morePanelPos.left = rect.left }
}
function onWindowClickAway() {
  moreMenuOpen.value = false
}
onMounted(() => window.addEventListener('click', onWindowClickAway))
onBeforeUnmount(() => window.removeEventListener('click', onWindowClickAway))

// 发全部后续（M3-0G 复议，2026-08-19）：旧平台硬编码 size=500000、start=0，用户不填任何
// 数量，只受当前筛选条件约束（sourceId 天然由具体源页面锁定，state/cond 取自筛选行——
// 不含 dataId/parentId，旧平台 sendNextAll 本身就不认这两个字段）。数量不可调，唯一的
// 防护就是确认框把量级说清楚，不能悄悄把 50 万条包装成"点一下就发"。
async function onSendAllUnderFilter() {
  if (!canPickRows.value || !selectedTable.value) return
  const nodeName = selectedCfg.value?.title || selectedNodeId.value
  const tableId = selectedTable.value
  await confirmDanger(
    '发全部后续',
    `[实验性] 将对当前筛选条件下"${nodeName}"的全部数据发起后续处理（最多 500000 条，量级可能很大），是否继续？`,
    () => withNodeErrorContext(nodeName, () => dataApi.nextStepBatch({
      tableId, sourceId: sourceId.value,
      state: filters.state || undefined,
      cond: filters.sql || undefined,
      size: 500000, start: 0,
    })),
    showNextStepReceipt,
  )
}

// 发大量后续（M3-0G 复议）：旧平台面板字段 从该ID起/至该ID止/发送数量/状态过滤/后续标识/
// 自定SQL条件——是一套独立于主查询筛选行的字段，不共用 filters（旧平台叫 state1/more，
// 跟主查询的 state/more 是分开的两份状态）。
// 真实校验补丁：旧平台"发送数量(1-1W条)"只是标签文字，代码里从没校验过，填多少都能发
// （2026-08-18 读源码实测确认）。这里补上真实的 1-10000 上限，不再是摆设。
const SEND_MORE_MAX = 10000
const sendMoreOpen = ref(false)
const sendMoreForm = reactive({ start: '', end: '', size: String(SEND_MORE_MAX / 2), state: '', nextFlag: '', cond: '' })
const sendMoreSizeError = computed(() => {
  const n = Number(sendMoreForm.size)
  if (!sendMoreForm.size.trim() || !Number.isInteger(n) || n < 1) return '发送数量必须是 1 及以上的整数'
  if (n > SEND_MORE_MAX) return `发送数量最多 ${SEND_MORE_MAX} 条`
  return ''
})
function toggleSendMore() {
  if (!sendMoreOpen.value) {
    // 对齐旧平台 showSendMore：打开面板时把"至该ID止"预填成当页已加载数据里最大的 ID，
    // 方便用户"从这里接着往后发"，不用自己去翻数据表格里的 ID。
    const ids = rows.value.map((r) => Number(r.dataId)).filter((n) => !Number.isNaN(n))
    if (ids.length) sendMoreForm.end = String(Math.max(...ids))
  }
  sendMoreOpen.value = !sendMoreOpen.value
}
async function onSendMoreBatch() {
  if (!canPickRows.value || !selectedTable.value || sendMoreSizeError.value) return
  const nodeName = selectedCfg.value?.title || selectedNodeId.value
  const tableId = selectedTable.value
  await confirmDanger(
    '批量发后续',
    `将按填写的条件对"${nodeName}"批量发起后续处理，最多 ${sendMoreForm.size} 条，是否继续？`,
    () => withNodeErrorContext(nodeName, () => dataApi.nextStepBatch({
      tableId, sourceId: sourceId.value,
      state: sendMoreForm.state || undefined,
      size: Number(sendMoreForm.size),
      start: sendMoreForm.start ? Number(sendMoreForm.start) : 0,
      end: sendMoreForm.end ? Number(sendMoreForm.end) : undefined,
      nextFlag: sendMoreForm.nextFlag || undefined,
      cond: sendMoreForm.cond || undefined,
    })),
    (res) => {
      showNextStepReceipt(res)
      sendMoreOpen.value = false
    },
  )
}

// 默认选末端数据节点（最终结果表）；有页签快照（0701 问题三）时优先恢复快照里的节点/过滤/页码。
// 切换页签后旧节点 id 不在新流程里时也重置，避免表格变空。
watch(
  allNodes,
  (nodes) => {
    if (!nodes.some((n) => n.id === selectedNodeId.value)) {
      const snap = ws.snapshotOf(tabKey.value)
      const snapId = snap?.selectedNodeId && nodes.some((n) => n.id === snap.selectedNodeId) ? snap.selectedNodeId : ''
      selectedNodeId.value = snapId || nodes.at(-1)?.id || ''
      if (snapId) {
        page.value = snap?.page ?? 1
        if (snap?.filters) {
          // 旧快照可能残留 sourceFilter 字段（0710 会议 C4 已删源筛选），只回填仍存在的键
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
  if (!id || id === selectedNodeId.value) return
  selectedNodeId.value = id
  scope.value = defaultScope()
  page.value = 1
  selectedRowIds.value = []
  sortField.value = ''
  sortOrder.value = ''
}

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
function nextPage() {
  if (page.value * size.value < total.value) page.value += 1
}

// 详情 drawer
const detail = reactive<{ visible: boolean; row: DataRow | null }>({ visible: false, row: null })
const taskInst = reactive<{ visible: boolean; sourceId: string; parentId: string | null }>({ visible: false, sourceId: '', parentId: null })
function onRowClick(r: DataRow) {
  detail.row = r
  detail.visible = true
  editing.value = false
  closeParentDetail()
}
function onRowAction(r: DataRow, cmd: string) {
  if (cmd === 'detail') {
    detail.row = r
    detail.visible = true
    editing.value = false
    closeParentDetail()
  } else if (cmd === 'tasks') {
    taskInst.sourceId = r.sourceId
    taskInst.parentId = r.dataId
    taskInst.visible = true
  }
}

// 上游数据下钻（M3-0B）：categoryId/parentId 早就在 DataRow 里（legacyAdapters 已经映射），
// 只是没有渲染入口——旧平台 EntryList2.vue 有这个功能（父ID 列可点），新平台迁移时漏了。
// 只放详情抽屉、不占表格列宽：横向已经 25 列只露 4 列，"看血缘"本来就是逐条排查动作，
// 不需要常驻占一列（M3-0B 方案 A，2026-08-15 定案）。
const parentDetail = ref<EntryDetail | null>(null)
const parentLoading = ref(false)
const parentError = ref('')
const canDrillParent = computed(() => !!detail.row?.categoryId && !!detail.row?.parentId && detail.row.parentId !== '0')
async function openParentDetail() {
  if (!detail.row?.categoryId || !detail.row?.parentId) return
  parentLoading.value = true
  parentError.value = ''
  try {
    const res = await dataApi.rowDetail(detail.row.categoryId, detail.row.parentId)
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
function itemText(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// 行操作的"详情"复用列内容；为人类可读，做一份 prop → desc 映射
// row.values 的键是旧平台物理列名（K1/K2...），不是 f.prop 这个逻辑字段名（如 "title"）——
// 两者只在 f.columnName 上能对上，直接拿 f.prop 去 row.values 里取永远是 undefined。真实
// bug，2026-08-14 生产环境实测发现：详情弹层每个字段都显示"—"，不是接口没数据，是取错了 key。
const detailFields = computed(() => {
  if (!detail.row || !meta.value) return [] as { label: string; prop: string; value: string }[]
  return meta.value.fields.map((f) => ({
    label: `${f.desc}（${f.prop}）`,
    prop: f.prop,
    value: String(detail.row?.values?.[f.columnName ?? f.prop] ?? '—'),
  }))
})

// 行编辑（Phase 4.4）
const editing = ref(false)
const editValues = reactive<Record<string, string>>({})
const saving = ref(false)
function startEdit() {
  if (!detail.row) return
  Object.keys(editValues).forEach((k) => delete editValues[k])
  // 复用 detailFields 已经按 columnName 取对的值，不再用 f.prop 重新取一遍错的。
  detailFields.value.forEach((f) => { editValues[f.prop] = f.value === '—' ? '' : f.value })
  editing.value = true
}
function cancelEdit() {
  editing.value = false
}
async function saveEdit() {
  if (!detail.row || !selectedTable.value) return
  saving.value = true
  try {
    const res = await dataApi.rowUpdate(selectedTable.value, detail.row.dataId, { ...editValues })
    if (res?.row) {
      detail.row.values = res.row.values
      const idx = rows.value.findIndex((r) => r.dataId === detail.row?.dataId)
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
const filePreview = reactive({ visible: false, path: '', name: '' })
function onCellFile(path: string) {
  filePreview.path = path
  filePreview.name = path.split('/').pop() || ''
  filePreview.visible = true
}
</script>

<template>
  <main class="rv-shell" :class="{ 'is-fullscreen': fullscreen }">
    <!-- 全屏是"只看数据"的模式：只有源信息头让位，节点轨道保留（它是唯一的节点选择器，
         藏起来就没法切节点了）；筛选行与表头行（含发起抓取、输入/输出切换、分页、列 ▾）
         全部保留——不然全屏就只能看不能用了。 -->
    <CanvasHeader v-if="!fullscreen" />

    <!-- 折叠开关和「查看条件」都放在轨道自己身上：控件应该长在它所控制的东西上，
         而且这两个都是"这个节点的上下文"，跟下面那行"怎么查"不是一回事
         （2026-08-15 第十三次纠偏：原来把它俩塞进筛选行，等于把一组筛选条件劈成两半）。
         收起后 .rv-railbox 靠 min-height 留出一条窄带，展开按钮不会跟着消失。 -->
    <div v-if="selectedNodeId" class="rv-railbox">
      <div v-if="railOpen" class="rv-bar" data-testid="data-process-rail">
        <ProcessNodeRail :model-value="selectedNodeId" :layout="processLayout" @update:model-value="onSelectNode" />
        <div v-if="!allNodes.length" class="rv-bar-empty">当前流程没有可查看数据的节点</div>
      </div>
      <div class="rv-rail-ctl">
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
      </div>
    </div>

    <!-- 这一行只放"怎么查"：各个筛选条件 + 查询/清空。节点选择归流程图（0819 会议 05:13
         "上面那个和下面那个不是两个都有了吗？只要有一个就行了"——原来这里还有一个与轨道
         完全同步的节点下拉，同一件事两个控件，已删）；节点上下文（折叠开关、查看条件）在
         轨道上，输入/输出/执行方式在下面的表头行，各归各位。 -->
    <!-- 查询条件一律点「查询」执行，不绑回车（2026-08-20 决定）。原先绑了 @keyup.enter，
         但中文输入法上屏时也会发 Enter 的 keyup，而 Vue 的 @keyup.enter 不过滤 isComposing——
         实测打字打到一半就被当成回车查了一次，条件只输了半截，结果还看不出是怎么来的。 -->
    <div v-if="selectedNodeId" class="ctx-summary" data-testid="data-node-context">
      <!-- 全屏时源信息头被藏起来了，这里把源名补回来，否则看不出在看哪个源的数据。 -->
      <span v-if="fullscreen" class="rv-fs-source" :title="source?.name || sourceId">{{ source?.name || sourceId }}</span>
      <template v-if="hasAnyTable">
        <input v-model="filters.dataId" class="rv-input id" placeholder="数据 ID" />
        <input v-model="filters.parentId" class="rv-input id" placeholder="父 ID" />
        <select v-model="filters.state" class="rv-input st">
          <option value="">状态（全部）</option>
          <option value="C">C 成功</option>
          <option value="E">E 出错</option>
          <option value="L">L 处理中</option>
        </select>
        <input v-model="filters.sql" class="rv-input flex" placeholder="SQL 条件，用列头上的物理列名（如 K1 LIKE '%关键词%'）" />
        <span class="rv-actions">
          <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
          <button class="rc-btn" type="button" @click="clearFilters">清空</button>
        </span>
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

      <!-- 发大量后续（M3-0G 复议）：旧平台是"点开一个独立字段面板，跟主查询筛选行分开"，
           不是主查询自己的一部分——字段名也刻意不撞（start/end/size 而不是复用 filters）。 -->
      <div v-if="sendMoreOpen" class="rv-sendmore" data-testid="data-sendmore-panel">
        <div class="rv-sendmore-field">
          <label>从该 ID 起</label>
          <input v-model="sendMoreForm.start" class="rv-input" placeholder="不填则从头开始" />
        </div>
        <div class="rv-sendmore-field">
          <label>至该 ID 止</label>
          <input v-model="sendMoreForm.end" class="rv-input" placeholder="不填则不限" />
        </div>
        <div class="rv-sendmore-field">
          <label>发送数量（1～{{ SEND_MORE_MAX }}）</label>
          <input v-model="sendMoreForm.size" class="rv-input" data-testid="data-sendmore-size" />
        </div>
        <div class="rv-sendmore-field">
          <label>状态过滤</label>
          <input v-model="sendMoreForm.state" class="rv-input" placeholder="表中 state 列" />
        </div>
        <div class="rv-sendmore-field">
          <label>后续标识</label>
          <input v-model="sendMoreForm.nextFlag" class="rv-input" placeholder="-1 未抓后续，1 已..." />
        </div>
        <div class="rv-sendmore-field flex">
          <label>自定 SQL 条件</label>
          <input v-model="sendMoreForm.cond" class="rv-input" placeholder="如 K1 IS NULL" />
        </div>
        <div class="rv-sendmore-actions">
          <span v-if="sendMoreSizeError" class="rv-sendmore-error" data-testid="data-sendmore-error">{{ sendMoreSizeError }}</span>
          <button class="rc-btn" type="button" @click="sendMoreOpen = false">取消</button>
          <button class="rc-btn danger" type="button" data-testid="data-sendmore-submit" :disabled="!!sendMoreSizeError" @click="onSendMoreBatch">批量发后续</button>
        </div>
      </div>

      <!-- 表头内容走 DataGrid 的 #head 插槽，跟「列 ▾」和分页共用同一条横条。原来这里是
           独立的 .rv-tablehead(47px) + DataGrid 自己的列按钮行(33px) + .rv-pager(45px)
           三条横条，加起来 125px 全在挤数据区（2026-08-15 第十二次纠偏）。
           输入/输出切换紧挨着表名——这两个按钮控制的正是"表头显示的是哪张表"。 -->
      <DataGrid
        class="rv-grid"
        :meta="meta"
        :rows="rows"
        :loading="loading"
        :selected-id="detail.row?.dataId"
        :selectable="canPickRows"
        :selected-ids="selectedRowIds"
        :sort-field="sortField"
        :sort-order="sortOrder"
        :allow-column-sort="allowColumnSort"
        @sort-change="onSortChange"
        @update:selected-ids="selectedRowIds = $event"
        @file-click="onCellFile"
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
            @click="execMode === 'fetch' ? onSendFetch() : onSendNextStep()"
          >{{ execMode === 'fetch' ? '发起抓取' : '发后续任务' }}</button>
          <!-- 「发后续 ▾」：发全部后续/发本页任务/发大量后续收进同一个菜单，对齐旧平台自己
               的布局——不是三个常驻按钮堆在行里。触发按钮留在原位（跟表头其他内容同一行），
               展开的面板 Teleport 到 body、position:fixed 定位，脱离 .dg-head 的裁剪盒子
               （见上方 moreMenuOpen 声明处的说明）。 -->
          <div v-if="canPickRows" class="rv-more-menu" @click.stop>
            <button ref="moreToggleRef" class="rc-btn" type="button" data-testid="data-exec-more-toggle" @click="toggleMoreMenu">发后续 ▾</button>
          </div>
          <Teleport to="body">
            <div
              v-if="moreMenuOpen && canPickRows"
              class="rv-more-panel"
              :style="{ top: morePanelPos.top + 'px', left: morePanelPos.left + 'px' }"
              @click.stop
            >
              <button type="button" class="rv-more-item" data-testid="data-exec-all-btn" @click="onSendAllUnderFilter(); moreMenuOpen = false">发全部后续（当前条件下所有）</button>
              <button
                type="button"
                class="rv-more-item"
                data-testid="data-exec-page-btn"
                :disabled="!rows.length"
                @click="onSendCurrentPage(); moreMenuOpen = false"
              >发本页任务</button>
              <button type="button" class="rv-more-item" data-testid="data-exec-batch-toggle" @click="toggleSendMore(); moreMenuOpen = false">发大量后续</button>
            </div>
          </Teleport>
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
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="PAGE_SIZES"
            layout="sizes, prev, pager, next"
            small
            data-testid="data-pagination"
            @size-change="runQuery"
          />
        </template>

        <!-- 全屏放在不随 #head 横向滚动的常驻区：表头内容一多，原来它在最右边会被滚动条
             藏起来，得先拉滚动条才够得着（2026-08-19 用户反馈）。 -->
        <template #head-right>
          <button
            class="rc-btn tiny"
            type="button"
            data-testid="data-fullscreen-toggle"
            :title="fullscreen ? '退出全屏（Esc）' : '全屏查看数据'"
            @click="fullscreen = !fullscreen"
          >{{ fullscreen ? '⤡ 退出全屏' : '⤢ 全屏' }}</button>
        </template>
      </DataGrid>
    </template>
    <div v-else-if="selectedNodeId" class="rv-empty-scope" data-testid="data-node-empty">该节点不产生可查看的数据，也不提供手动执行入口</div>

    <el-drawer v-model="detail.visible" :with-header="false" size="480px">
      <div v-if="detail.row" class="rv-detail">
        <div class="rv-d-head">
          <div>
            <div class="rv-d-title">{{ detail.row.title }}</div>
            <!-- 源 ID 跟数据 ID 并列：详情是"这条数据是什么"的完整视图，
                 光有数据 ID 看不出它属于哪个源（0819 会议 09:23～09:44）。 -->
            <div class="rv-d-sub">数据 ID {{ detail.row.dataId }} · 源 ID {{ detail.row.sourceId || sourceId }}</div>
            <button
              v-if="canDrillParent"
              type="button"
              class="rv-parent-link"
              data-testid="data-parent-drill"
              :disabled="parentLoading"
              @click="openParentDetail"
            >父 ID {{ detail.row.parentId }} <span aria-hidden="true">↗</span></button>
          </div>
          <button class="rc-btn ghost" type="button" @click="detail.visible = false">关闭</button>
        </div>
        <div v-if="parentError" class="rv-notice error">{{ parentError }}</div>
        <div v-if="parentDetail" class="rv-parent-panel" data-testid="data-parent-panel">
          <div class="rv-parent-panel-head">
            <span>上游数据 · {{ parentDetail.row.dataId }}</span>
            <button class="rc-btn ghost" type="button" @click="closeParentDetail">收起</button>
          </div>
          <dl class="rc-kv">
            <template v-for="item in parentDetail.showItems" :key="item.columnName">
              <dt>{{ item.itemName || item.columnName }}</dt>
              <dd>{{ itemText(item.value) }}</dd>
            </template>
          </dl>
        </div>
        <dl v-if="!editing" class="rc-kv">
          <template v-for="f in detailFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
        <dl v-else class="rc-kv rc-kv-edit">
          <template v-for="f in detailFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd><input class="rv-edit-input" v-model="editValues[f.prop]" /></dd>
          </template>
        </dl>
        <div class="rv-d-foot">
          <template v-if="editing">
            <button class="rc-btn primary" type="button" :disabled="saving" @click="saveEdit">{{ saving ? '保存中…' : '保存' }}</button>
            <button class="rc-btn" type="button" :disabled="saving" @click="cancelEdit">取消</button>
          </template>
          <template v-else>
            <button class="rc-btn" type="button" @click="startEdit">编辑</button>
            <button class="rc-btn" type="button" @click="onRowAction(detail.row, 'tasks')">查后续任务实例 ›</button>
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
    <SnatchLauncher ref="snatchLauncher" />
  </main>

    <el-dialog v-model="filePreview.visible" :title="filePreview.name || '文件预览'" width="820px" top="6vh" append-to-body>
      <FilePreview
        :path="filePreview.path"
        :name="filePreview.name"
        :ext="extFromName(filePreview.name)"
        data-testid="data-cell-file-preview"
      />
    </el-dialog>
</template>

<style scoped>
.rv-shell { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
/* 全屏：同一份 DOM 直接铺满视口，不复制模板也不套弹层。祖先链上没有 transform/filter/
   contain（已核对 AppShell.vue、FlowCanvas/index.vue），fixed 能正常逃逸；外层 .rc-shell
   的 z-index 是 21、顶栏是 20，所以这里盖得住顶栏。详情抽屉渲染在 .rv-shell 内部，
   会跟着一起进全屏。 */
.rv-shell.is-fullscreen { position: fixed; inset: 0; z-index: 60; height: 100vh; border: 0; border-radius: 0; }

/* 轨道容器：控件浮在轨道右上角（.rv-bar 自己会横向滚动，控件必须放在滚动容器外面，
   否则会跟着内容滚走）。收起轨道后靠 min-height 留一条窄带，展开按钮不会一起消失。 */
.rv-railbox { position: relative; min-height: 32px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }
.rv-rail-ctl { position: absolute; top: 4px; right: 10px; z-index: 2; display: flex; align-items: center; gap: 6px; }

/* 折叠开关：默认展开（轨道是"这个源的流程长什么样"的上下文），想把 96px 让给数据的人
   自己收。控件长在它所控制的轨道上，不塞进下面那行筛选条件里。 */
.rv-rail-toggle { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11.5px; cursor: pointer; }
.rv-rail-toggle:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.rv-rail-toggle .arrow { display: inline-block; transition: transform .18s ease; }
.rv-rail-toggle.open .arrow { transform: rotate(180deg); }

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
.ctx-toggle { flex: none; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border: 1px solid #fde68a; border-radius: 999px; background: #fffbeb; color: #92400e; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.ctx-toggle:hover { border-color: #fbbf24; }
.ctx-toggle .arrow { display: inline-block; transition: transform .18s ease; }
.rv-empty-scope { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 12px; text-align: center; color: var(--rc-faint); font-size: 12px; }

.rv-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; min-width: 110px; background: #fff; }

.rv-more-menu { flex: none; }
/* Teleport 到 body 后用 position:fixed + JS 算出的 top/left（见 toggleMoreMenu），
   不能再用相对 .rv-more-menu 的 position:absolute——脱离原父级后没有定位基准了，
   这正是要脱离的原因：.dg-head 的 overflow-x:auto 会强制 overflow-y 变 auto，
   绝对定位在原位置会被那个裁剪盒子切掉一截、出现滚动条（2026-08-19 真实浏览器验收发现）。 */
/* 61 不是随便挑的：.rv-shell.is-fullscreen 也是 60，全屏模式下打开这个菜单必须严格盖过它，
   不能靠"Teleport 到 body 末尾、DOM 顺序更靠后所以层叠更上"这种偶然性。 */
.rv-more-panel { position: fixed; z-index: 61; min-width: 210px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; box-shadow: 0 12px 28px -12px rgba(15, 23, 42, 0.3); padding: 4px; }
.rv-more-item { display: block; width: 100%; text-align: left; padding: 7px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--rc-text-2); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.rv-more-item:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rv-more-item:disabled { opacity: .5; cursor: default; }
.rv-more-item:hover:disabled { background: transparent; color: var(--rc-text-2); }

.rv-sendmore { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; padding: 12px; margin-bottom: 10px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; }
.rv-sendmore-field { display: flex; flex-direction: column; gap: 4px; }
.rv-sendmore-field.flex { flex: 1; min-width: 200px; }
.rv-sendmore-field label { font-size: 11px; color: var(--rc-text-2); font-weight: 600; }
.rv-sendmore-field .rv-input { min-width: 0; width: 100%; }
.rv-sendmore-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.rv-sendmore-error { color: #b91c1c; font-size: 12px; }
/* 数据 ID / 父 ID 本来就是短数字，不用跟节点选择、状态这些下拉一样宽——
   窄一点给查询/清空腾地方，尽量跟筛选条件同一行（2026-08-15 第九次纠偏）。 */
.rv-input.id { width: 78px; min-width: 0; flex: none; }
/* 不换行之后"填满剩余空间"没有意义了（反正内容一多就横向滚动），改固定宽度，
   跟同一行其他字段一样不参与 flex 伸缩。 */
.rv-input.flex { flex: none; width: 220px; min-width: 0; font-family: var(--rc-mono, monospace); }
.rv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ctx-summary .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }

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

.rv-detail { padding: 18px; }
.rv-d-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.rv-d-title { font-size: 14px; font-weight: 700; color: var(--rc-text); }
.rv-d-sub { font-size: 11px; color: var(--rc-faint); margin-top: 3px; }
.rv-d-foot { display: flex; gap: 8px; margin-top: 16px; }
.rv-parent-link { margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; border: 0; background: transparent; padding: 0; font-size: 11px; color: var(--rc-primary); cursor: pointer; }
.rv-parent-link:hover { text-decoration: underline; }
.rv-parent-link:disabled { opacity: .6; cursor: default; text-decoration: none; }
.rv-parent-panel { margin-bottom: 14px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; padding: 10px 12px; }
.rv-parent-panel-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 700; color: var(--rc-text-2); margin-bottom: 8px; }
.rv-parent-panel .rc-kv { margin: 0; }
.rc-btn.ghost { background: transparent; border-color: var(--rc-border); color: var(--rc-text-2); }
.rv-edit-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 5px 8px; outline: none; }
.rv-edit-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
