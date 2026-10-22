<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useUiStore } from '../../stores/ui'
import { MAX_WORKSPACE_TABS, useWorkspaceStore, type WorkspaceTabRef } from '../../stores/workspace'
import { flowCenterApi, siteApi, sourceApi, workflowBindingApi, type Source, type Step } from '../../api'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'
import { useFlowReadiness } from '@/views/FlowCanvas/canvas/useFlowReadiness'
import { useRuntimeStore } from '../../stores/runtime'
import { useFlowVersionStore } from '../../stores/flowVersion'
import FlowBoard from '@/views/FlowCanvas/canvas/FlowBoard.vue'
import LoginConfigSelectDialog from '@/views/FlowCanvas/launch/LoginConfigSelectDialog.vue'
import NodeInspector from '@/views/FlowCanvas/inspector/NodeInspector.vue'
import ResultView from './result/ResultView.vue'
import SourceSummaryView from './result/SourceSummaryView.vue'
import SourceTabsBar from './source/SourceTabsBar.vue'
import SourceWorkflowList from './source/SourceWorkflowList.vue'
import CompareSplit from './result/CompareSplit.vue'
import TaskView from './result/TaskView.vue'
import FileView from './result/FileView.vue'
import MonitorConfigView from './result/MonitorConfigView.vue'
import SiteSourceSwitcher from './source/SiteSourceSwitcher.vue'
import SnatchLauncher from './source/SnatchLauncher.vue'
import { nodeInspectorTabs } from './inspector/nodeInspectorTabs'
import SiteDetailView from './result/SiteDetailView.vue'
import { collectorCapabilityOf, type LoginConfigRef } from '@/views/FlowCanvas/canvas/flowModel'
import { firstUnboundDraftNodeId, validFlowIdOf } from '@/utils/flow/stepPersist'
import { normalizeSourceView, normalizeSiteView, sourceViewFromHash } from '@/utils/url/workspaceRoute'
import NewSiteWizard from './create/NewSiteWizard.vue'
import { flushNodeConfigs } from './inspector/nodeConfigAutosave'

const route = useRoute()
const router = useRouter()
const flow = useFlowStore()
const autosave = useFlowAutosave()
const { ensureFlowReady } = useFlowReadiness()
const ui = useUiStore()
const ws = useWorkspaceStore()
const runtime = useRuntimeStore()
// 三种结果视图均以当前源为粒度。
const activeView = ref(normalizeSourceView(route.query.view))
function syncActiveView() {
  activeView.value = sourceViewFromHash(window.location.hash)
}
// 切视图时套用默认布局（Z3-2）：数据视图默认收起右侧配置区让出表格空间，流程视图默认展开配置区。
//
// ⚠️ 不能拿 `activeView` 当"上一次的值"来比：它在 setup 里就已经按 URL 初始化过了，
// 首帧（immediate）比较必然相等，默认布局一次都套不上（2026-09-05 实测踩到）。
// 单独记一个"已套用过哪个视图"。
let layoutAppliedFor: string | null = null
watch(() => route.query.view, () => {
  const next = normalizeSourceView(route.query.view)
  if (next !== layoutAppliedFor) {
    layoutAppliedFor = next
    ui.applyViewLayoutDefault(next)
  }
  activeView.value = next
}, { immediate: true })
// 深链定位节点（0819 N4-1）：数据视图的「查看条件」不再就地展开，而是跳到流程画布并
// 选中该节点、打开对应配置页签。
//
// 实测下来这里有个绕不开的时序（浏览器逐帧采样确认）：跳过来后 selectedId 会先被正确设成
// 目标节点，约 200ms 后再被 store 的 load() 末尾那句无条件 select(第一个节点) 覆盖回去。
// load() 是异步加载完成后才跑的，而且它先清空 configs 再填回来（键数 2→0→2 最终不变），
// 所以既不能只设一次，也不能靠"键数变化"去等它。
//
// 解法是给一个短暂的纠正窗口：跳转后的 1.5 秒内，只要选中被改成别的节点就纠正回来；
// 窗口一过就彻底放手，用户之后手动点别的节点不会被拉回。
const pendingNodeId = ref('')
const pendingTab = ref('')
const pendingUntil = ref(0)
const PENDING_WINDOW_MS = 1500
watch(
  [() => route.query.nodeId, () => route.query.tab],
  () => {
    const id = String(route.query.nodeId ?? '')
    if (!id) return
    pendingNodeId.value = id
    pendingTab.value = String(route.query.tab ?? '')
    pendingUntil.value = Date.now() + PENDING_WINDOW_MS
  },
  { immediate: true },
)
watch(
  [pendingNodeId, () => flow.selectedId, () => Object.keys(flow.configs).length],
  () => {
    const id = pendingNodeId.value
    if (!id || Date.now() > pendingUntil.value) return
    if (!flow.configs[id] || flow.selectedId === id) return
    flow.selectedId = id
    // tab 未必适用于该节点（不同类型节点的页签不同），落不到就退到该节点
    // 的第一个页签——保持上一次的 activeTab 会让 inspector 停在一个对当前节点不存在的
    // 页签上，看起来像空白。
    const tabs = nodeInspectorTabs(flow.configs[id])
    const wanted = pendingTab.value
    if (tabs.length) flow.activeTab = tabs.some(([key]) => key === wanted) ? wanted : tabs[0][0]
  },
  { immediate: true, flush: 'post' },
)

// 网站详情页（0714 会议 Task 3）：siteId 且无 sourceId，只读聚合数据/文件/任务视图，没有流程视图
const isSiteDetail = computed(() => !!route.query.siteId && !route.query.sourceId)
const isPublishedFlowView = computed(() => flow.sourceCtx?.workflowVersionManaged !== false
  && flow.sourceCtx?.workflowVersionStatus === 'PUBLISHED')
// 源加载中的占位（2026-08-28 修）：三个结果视图原来都拿 `!!flow.sourceCtx` 当门槛，
// 而从网站详情页切源、或深链/刷新进 view=data 时 sourceCtx 是空的，条件不成立就掉进
// v-else 的流程画布——URL 明明是 view=data，中间却要闪 240ms 流程视图（逐帧实测）。
// 改成：有 sourceId 但 ctx 还没到位时渲染占位，不拿流程画布顶包。
// 源之间互切不受影响（ctx 是上一个源，非空，照旧直接换）。
// 占位文案（2026-09-03 补）：原来只有「sourceDetail 正常返回 null」才会置成「源不存在」，
// 请求本身抛异常（会话失效重定向、非 2xx、超时）时异常一路冒泡出 enterFromRoute 没人接，
// 标志位保持初值，占位就永远停在「正在加载源…」——真实故障和加载中看起来一模一样。
// 改成一个文案 ref：空串=加载中，非空=终态原因。
const sourceLoadError = ref('')
const awaitingSource = computed(() => !!route.query.sourceId && !flow.sourceCtx)
const isDataView = computed(() => activeView.value === 'data' && !!flow.sourceCtx)
// 数据 / 文件 / 任务视图的节点和表都跟着当前流程走：页头切换流程后整块重挂，不残留上一条流程的筛选（2026-10-19）
const flowScopedKey = computed(() => `${flow.sourceCtx?.sourceId ?? ''}:${flow.sourceCtx?.flowId ?? ''}`)
const isOverviewView = computed(() => activeView.value === 'overview' && !!flow.sourceCtx)
const isWorkflowListView = computed(() => activeView.value === 'flow' && route.query.flowMode === 'list' && !!flow.sourceCtx)
const isTaskView = computed(() => activeView.value === 'task' && !!flow.sourceCtx)
// 文件视图只挂源层（0711 R11：文件视图只有源才有）：网站态 URL 带 view=file 同理重定向回流程视图
const isFileView = computed(() => activeView.value === 'file' && !!flow.sourceCtx)
const isMonitorConfigView = computed(() => activeView.value === 'monitor-config' && !!flow.sourceCtx)

// 同一个源里的每条流程都是独立页签。切走前记住该流程选中的节点与右侧配置页签，
// 切回来恢复自己的现场，避免所有流程标签都落到同一个节点/配置页。
const flowInspectorSnapshots = reactive(new Map<string, { selectedId: string; activeTab: string }>())
function flowInspectorKey(sourceId: string, flowId: string) {
  return `${sourceId}:${flowId}`
}
function rememberCurrentFlowInspector() {
  const sourceId = flow.sourceCtx?.sourceId
  const flowId = validFlowIdOf(flow.sourceCtx?.flowId)
  if (!sourceId || !flowId) return
  flowInspectorSnapshots.set(flowInspectorKey(sourceId, flowId), {
    selectedId: flow.selectedId,
    activeTab: flow.activeTab,
  })
}
function restoreFlowInspector(sourceId: string, flowId: string | undefined) {
  if (!flowId) return
  const snapshot = flowInspectorSnapshots.get(flowInspectorKey(sourceId, flowId))
  if (!snapshot || !flow.configs[snapshot.selectedId]) return
  flow.selectedId = snapshot.selectedId
  const tabs = nodeInspectorTabs(flow.configs[snapshot.selectedId])
  flow.activeTab = tabs.some(([key]) => key === snapshot.activeTab)
    ? snapshot.activeTab
    : (tabs[0]?.[0] ?? '')
}


// 视图快照按源页签保存，避免切换源后丢失当前视图。
watch(
  () => [route.query.sourceId, route.query.view, flow.sourceCtx?.sourceId] as const,
  ([qSrc, v, ctxSrc]) => {
    if (!qSrc || ctxSrc !== String(qSrc)) return
    ws.saveSnapshot(ctxSrc, {
      view: normalizeSourceView(v),
    })
  },
  { immediate: true },
)

// ---- 源侧栏（0710 会议 B1）：页面级左列，流程/数据/任务视图共用；接线自 FlowBoard 顶部横排切换器迁入 ----
// 网站详情页没有 sourceCtx（画布内部代表源不登记为编排对象），侧栏 siteId 需要兜底读路由自己的 siteId
const sidebarSiteId = computed(() => flow.sourceCtx?.siteId || String(route.query.siteId ?? ''))
// 网站详情页态下侧栏不应高亮任何具体源（内部代表源只是取数据用，不是用户在看的对象）
const sidebarActiveKey = computed(() => (isSiteDetail.value ? '' : flow.sourceCtx?.sourceId ?? ''))
async function confirmDiscardIfDirty(): Promise<boolean> {
  // 1021-06：先把能自动保存的节点配置存掉，剩下存不掉的（新节点、共享配置等）才走下面的提示
  await flushNodeConfigs()
  // 没落库的草稿节点要单独说（0903）：`flow.dirty` 说的是"有改动"，而这里是**整个节点还不存在于
  // 后端**——切走就永久没了，重进画布连痕迹都没有（buildSourceSeed 只认 sourceSteps 的步骤行）。
  // 两种情况的后果差得远，提示不能共用一句"改动将丢弃"。
  const draftId = firstUnboundDraftNodeId(flow.main, flow.configs)
  if (draftId) {
    const name = flow.configs[draftId]?.title || draftId
    try {
      await ElMessageBox.confirm(
        `节点「${name}」还没有保存到后端，切换后会彻底消失——不是丢失改动，是整个节点没了。`
        + '请先在右侧保存节点配置，等顶部显示「已保存」再切换。',
        '有节点尚未保存',
        { type: 'warning', confirmButtonText: '仍然切换', cancelButtonText: '返回保存' },
      )
      return true
    } catch {
      return false
    }
  }
  if (!flow.dirty) return true
  try {
    await ElMessageBox.confirm('当前画布有未保存的改动，切换将丢弃，是否继续？', '切换编排对象', {
      type: 'warning', confirmButtonText: '切换', cancelButtonText: '取消',
    })
    return true
  } catch {
    return false
  }
}
// 切换只改路由，加载统一走 route watcher → enterFromRoute；视图随身携带（切源不切视图，0710 会议第 7/10 条）
async function onSwitchTarget(target: Source) {
  if (!(await confirmDiscardIfDirty())) return
  // 从「按条件查源」的命中态点进来（2026-09-09）：强制进数据视图并把产生这批命中的条件
  // 一并带过去。侧栏那一行写着「906 条」，进去看到的就得是那 906 条——不带条件的话
  // 看到的是这个源的全部数据，那个数字反而成了误导。
  // siteId 以 target 为准、路由兜底：侧栏本来就是当前网站的，缺了它跳过去整个源侧栏不渲染
  const siteId = target.siteId || String(route.query.siteId ?? '')
  const cond = siteId ? ws.backTraceConditionOf(siteId) : null
  // 条件走 store 不走 URL：具体源视图按 sourceId 做 key，源→源切换会销毁重建，
  // 用 query 传会撞上「旧实例抹掉 query、新实例读不到」的竞态（见 store 里的注释）。
  ws.setPendingSourceCondition(cond)
  void router.replace({
    path: '/canvas',
    query: {
      ...(siteId ? { siteId } : {}),
      sourceId: target.sourceId,
      view: cond ? 'data' : normalizeSourceView(route.query.view),
    },
  })
}
function onSwitchAdded(s: Source) {
  onSwitchTarget(s)
}
// ---- 左栏数据表模式（0924-10）----
/** 只在「网站态 + 数据视图」允许切到数据表列表（Q4）；其他视图左栏恒为源列表 */
const sidebarAllowTableMode = computed(() => isSiteDetail.value && normalizeSiteView(route.query.view) === 'data')
const sidebarActiveTableId = computed(() => String(route.query.tableId ?? ''))
/**
 * 每个网站上次选的表（'' = 用户选的是「全部」）。网站详情切视图时整包换 query（{siteId, view}），
 * tableId 会丢；切回数据视图时靠它选回原来那张。没记录时用网站页签快照里的表（从源页签点回「全部」页签）。
 * 跟着地址栏记：左栏点表、中间「全部」汇总里点表，最后都落到 tableId 上。
 */
const lastPickedTable = reactive(new Map<string, string>())
// 只记非空的表：切回数据视图的那一刻地址栏还没有 tableId，记成 '' 会把上次的表冲掉
// （2026-09-24 实测：选表 → 切任务视图 → 切回来，落到了「全部」）。「全部」只由 onPickTable(null) 显式记。
watch(() => [sidebarAllowTableMode.value, sidebarSiteId.value, sidebarActiveTableId.value] as const, ([allowed, siteId, tableId]) => {
  if (allowed && siteId && tableId) lastPickedTable.set(siteId, tableId)
})
const sidebarPreferredTableId = computed(() => {
  const siteId = sidebarSiteId.value
  if (lastPickedTable.has(siteId)) return lastPickedTable.get(siteId) ?? ''
  return ws.siteSnapshotOf(siteId)?.tableId || ''
})
/** 左栏点表；null = 「全部」（地址栏去掉 tableId，中间显示各表汇总） */
function onPickTable(table: { tableId: string } | null) {
  const tableId = table?.tableId ?? ''
  lastPickedTable.set(sidebarSiteId.value, tableId)
  if (String(route.query.tableId ?? '') === tableId) return
  const query: Record<string, unknown> = { ...route.query, siteId: sidebarSiteId.value, view: 'data' }
  if (tableId) query.tableId = tableId
  else delete query.tableId
  void router.replace({ path: '/canvas', query: query as Record<string, string> })
}

// 侧栏「网站」节点：切到网站详情页（全部源聚合），视图随身携带（数据/文件/任务，落不到流程视图）
async function onSwitchToSite() {
  if (!(await confirmDiscardIfDirty())) return
  ws.deactivate()
  const view = normalizeSiteView(route.query.view)
  void router.replace({ path: '/canvas', query: { siteId: sidebarSiteId.value, view } })
}
// 侧栏 ⇔（0710 会议 B4）：左栏=当前源，右栏=所选源（任意网站，按 id 直接加载）
function onSidebarCompare(rightId: string) {
  const left = flow.sourceCtx?.sourceId
  if (!left) {
    ElMessage.warning('请先切到具体源再对比')
    return
  }
  if (!ws.enterCompare(rightId, left)) ElMessage.warning('无法对比：请选择另一个源')
}

// ---- 新建采集闸门：单页网站 + 首批源；创建后进入画布。
const isGate = computed(() => route.query.mode === 'new')
// ---- 配置区宽度（优化 0701 问题一）：拖拽分隔条调宽 + 一键展开 ----
const inspWidth = computed(() => `${ui.inspectorWidth ?? (flow.sourceCtx ? 480 : 372)}px`)
let splitStartX = 0
let splitStartW = 0
function onSplitMove(e: MouseEvent) {
  // 分隔条在配置区左侧：向左拖增宽；下限随模式（普通 372 / 源详情 480），与 inspWidth/onSplitStart 三元一致；
  // 上限固定值由 ui.setInspectorWidth 统一夹住（不再跟当前窗口宽度挂钩），拖到头后要更大空间用「展开」
  const minW = flow.sourceCtx ? 480 : 372
  const next = Math.max(minW, splitStartW - (e.clientX - splitStartX))
  ui.setInspectorWidth(next)
}
function onSplitEnd() {
  window.removeEventListener('mousemove', onSplitMove)
  window.removeEventListener('mouseup', onSplitEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}
function onSplitStart(e: MouseEvent) {
  e.preventDefault()
  splitStartX = e.clientX
  splitStartW = ui.inspectorWidth ?? (flow.sourceCtx ? 480 : 372)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onSplitMove)
  window.addEventListener('mouseup', onSplitEnd)
}

async function loadSourceFlow(sourceId: string, fromOutside?: boolean) {
  const runtimeView = !!import.meta.env.VITE_FLOW_PROXY_TARGET && normalizeSourceView(route.query.view) !== 'flow'
  // 不再读 flowApi.flowLoad 的本地草稿：flow/save 没有真实后端对应物（旧平台流程存在
  // item/next 子步骤里，没有"流程定义"这个接口），画布保存过一次后本地草稿会一直挡住
  // 真实拓扑，源改了/后端数据变了也看不出来。节点链始终来自真实的 sourceSteps。
  // flowSave 仍然写本地草稿（不在这里删），但不再当作这个源自己的真相。
  sourceLoadError.value = ''
  // 首屏不等 config/configDetail 那一轮（withConfigDetails: false）：它必须等 nextConfigPaged
  // 出 configId 才能发，串在前面等于白等一个 RTT。步骤先到先画，补充字段随后回填。
  let source: Source | null
  let sourceSteps: { steps: Step[] } | { error: unknown }
  try {
    ;[source, sourceSteps] = await Promise.all([
      sourceApi.sourceDetail(sourceId),
      // 按源查的步骤只给未绑流程的源兜底，绑了流程的源用不上：它的失败先记下，真要用时再报（见下方 steps）。
      // 2026-10-12：217 后端对未绑流程的源报「源未绑定有效流程」，对绑了只有草稿的新流程报「请先进入流程草稿编辑…」
      sourceApi.sourceSteps(sourceId, { withConfigDetails: false }).then((steps) => ({ steps }), (error: unknown) => ({ error })),
    ])
  } catch (error) {
    // 异常不能再往外抛：调用方 enterFromRoute 的 promise 没人接，占位会永远停在「加载中」。
    const detail = (error as Error)?.message ?? '网络异常'
    sourceLoadError.value = `源加载失败：${detail}`
    ElMessage.error(sourceLoadError.value)
    return
  }
  if (!source) {
    sourceLoadError.value = '源不存在或已被删除'
    ElMessage.error('源不存在')
    return
  }
  // 0925 整体切 flowId：源已绑流程（Source.flowId 为有效数字、且非 '0' 哨兵）→ 步骤按流程
  // 查询（svg=true 自带真实根节点行 / 「流程入口」行，lastStep 已改写为根 ID），展示与
  // 流程管理画布一致；未绑流程的源维持源视角查询（源虚拟根）。源视角那份并行结果仅作兜底。
  // 0927 P2-4：口径收敛到 stepPersist.validFlowIdOf（ActiveFlow 判定四处共用）。
  // 新模型允许一个源关联多条流程（source-group 接口）。路由 flowId 是当前查看/编辑目标；primaryFlowId 才是运行入口。
  // 绑定列表读失败时不挡住画布：退回源上的默认流程 ID（Source.flowId 即后端的 defaultFlowId），流程标签栏自己会报错。
  let bindings = [] as Awaited<ReturnType<typeof workflowBindingApi.list>>
  try {
    if (!runtimeView) bindings = await workflowBindingApi.list(sourceId, { withNames: false })
  } catch {
    bindings = []
  }
  const legacyFlowId = validFlowIdOf(source.flowId)
  const primaryBinding = bindings.find(binding => binding.primary)
  const primaryFlowId = primaryBinding?.publishedFlowId ?? legacyFlowId
  const primaryWorkflowId = primaryBinding?.workflowId
  const requestedWorkflowId = String(route.query.workflowId ?? '').trim()
  const requestedFlowId = validFlowIdOf(String(route.query.flowId ?? ''))
  const selectedBinding = bindings.find(binding => binding.workflowId === requestedWorkflowId)
    ?? bindings.find(binding => [binding.workflowId, binding.draftFlowId, binding.publishedFlowId].includes(requestedFlowId))
    ?? primaryBinding
    ?? bindings[0]
  // 草稿是独立的 cs_flow 工作副本。路由同时保留稳定 workflowId 和实际加载的 flowId，
  // 现有步骤读写接口因此无需改协议，同时不会碰到正在运行的发布版步骤。
  const flowId = requestedFlowId && selectedBinding
    && [selectedBinding.workflowId, selectedBinding.draftFlowId, selectedBinding.publishedFlowId].includes(requestedFlowId)
    ? requestedFlowId
    : (selectedBinding?.draftFlowId ?? selectedBinding?.publishedFlowId ?? selectedBinding?.workflowId ?? primaryFlowId)
  let steps: Step[]
  try {
    // 2026-10-10 流程版本：流程视图（编辑）有草稿时读草稿的步骤——改动都写在草稿里，读发布版会对不上；
    // 数据 / 任务等视图反映正式运行，照旧读发布版。
    // 2026-10-12：新建的流程在 217 上只有草稿 v1、没有发布版，不带 versionId 读会被拒，任何视图都读草稿。
    const flowVersion = useFlowVersionStore()
    const editingView = normalizeSourceView(route.query.view) === 'flow'
    if (flowId) await flowVersion.load(flowId)
    const versionId = editingView || !flowVersion.published ? flowVersion.viewVersionId : null
    if (flowId) {
      steps = await flowCenterApi.steps(flowId, { withConfigDetails: false, backendScope: runtimeView ? 'default' : 'flow', ...(versionId ? { versionId } : {}) })
    } else if ('steps' in sourceSteps) {
      steps = sourceSteps.steps
    } else if (/源未绑定有效流程/.test((sourceSteps.error as Error)?.message ?? '')) {
      // 未绑流程（如新建采集失败没建出流程）就是没有步骤：画布照常打开，用流程标签栏「＋」新建流程
      steps = []
    } else {
      throw sourceSteps.error
    }
  } catch (error) {
    const detail = (error as Error)?.message ?? '网络异常'
    sourceLoadError.value = `流程步骤加载失败：${detail}`
    ElMessage.error(sourceLoadError.value)
    return
  }
  const viewingDraft = !!selectedBinding?.draftFlowId && flowId === selectedBinding.draftFlowId
  flow.loadFromSource({
    ...source,
    flowId,
    primaryFlowId,
    activeWorkflowId: selectedBinding?.workflowId,
    primaryWorkflowId,
    // 没有版本接口时（versionManaged=false）不带版本信息：否则头部会出现一个没有依据的「已发布」标签
    workflowVersionStatus: selectedBinding?.versionManaged ? (viewingDraft ? 'DRAFT' : selectedBinding.versionStatus) : undefined,
    workflowVersionNo: selectedBinding?.versionManaged ? (viewingDraft ? selectedBinding.draftVersionNo : selectedBinding.publishedVersionNo) : undefined,
    workflowVersionManaged: selectedBinding?.versionManaged,
    publishedFlowId: selectedBinding?.publishedFlowId,
    draftFlowId: selectedBinding?.draftFlowId,
  }, steps, null)
  restoreFlowInspector(sourceId, flowId)
  if (!ws.open(source.sourceId, source.name)) {
    onTabQuotaFull(fromOutside, () => ws.open(source.sourceId, source.name), '当前源')
  }
  // 把所属网站记进页签快照：切页签时 URL 上没有 siteId，而 sourceDetail 又不返回它（实测为 null），
  // 不记下来的话切到别的网站的源，左侧源列表会整块消失。只在拿得到时写，别用空值覆盖已有的。
  const ownerSiteId = source.siteId || String(route.query.siteId ?? '') || ws.snapshotOf(source.sourceId)?.siteId || ''
  if (ownerSiteId) ws.saveSnapshot(source.sourceId, { siteId: ownerSiteId })
  // 0915-02：源态下「全部」页签同样常驻——0915-03 的钻取闭环要靠它回到网站数据视图
  if (ownerSiteId) void ensureSiteTabNamed(ownerSiteId)
  else void resolveOwnerSite(source.sourceId)
  void backfillStepDetails(sourceId, steps ?? [], runtimeView ? 'default' : 'flow')
  void backfillSourceSchedule(sourceId)
}

/**
 * 建「全部 · 网站名」页签，并把名字补上（2026-09-17）。
 *
 * `ensureSiteTab` 只拿到 siteId 时用 siteId 顶着当名字，指望 `SiteDetailView` 拿到
 * `site/detail` 后再调一次把真名补上——但 **SiteDetailView 只在网站态才挂载**。
 * 从源进来（深链、点源页签、数据钻取）时它根本不挂，于是页签一直显示「全部 · 11」这种裸 ID，
 * 看不出是哪个网站。这里自己补一次。
 *
 * 补名失败就维持 ID：页签本身是能用的（点进去照样回网站态），不值得为一个名字报错打扰用户。
 */
async function ensureSiteTabNamed(siteId: string) {
  // 没建成（额度满）就别白查一次接口
  if (!ws.ensureSiteTab(siteId)) return
  // 已经有真名（之前进过这个网站）就不重复请求
  if (ws.siteTabs.find((t) => t.siteId === siteId)?.name !== siteId) return
  try {
    const detail = await siteApi.siteDetail(siteId)
    if (detail?.name) ws.ensureSiteTab(siteId, detail.name)
  } catch {
    /* 名字补不上，页签照常可用 */
  }
}

/**
 * 反查源所属网站（2026-08-28）。
 *
 * `source/sourceDetail` **不返回 siteId**（生产实测是 `null`），所以只拿到 sourceId 的入口
 * ——深链 `/canvas?sourceId=X`、会话恢复后的页签——都推不出归属，左侧源列表会整块空掉。
 * 但 `source/sourcePaged` 带 `sourceId` 过滤时**是返回 siteId 的**（同样实测），
 * 所以不用麻烦后端加字段，这里补一次查询即可。
 *
 * 异步补、不挡首屏：画布和右侧面板不依赖它，只有左侧源列表要。查不到就保持现状，不报错打扰用户。
 */
async function resolveOwnerSite(sourceId: string) {
  try {
    const res = await sourceApi.sourcePaged({ sourceId, page: 1, size: 1 })
    const row = res.list.find((s) => String(s.sourceId) === String(sourceId))
    const siteId = row?.siteId
    if (!siteId) return
    // ⚠️ 无网站归属的源，后端不是给 null，而是把 siteId **填成该源的 configId**
    //（2026-08-28 实测：抽样 200 个游离源，siteId 100% 等于 configId；而真正有归属的 7 个源
    // siteId 都是真实的小整数网站 ID，无一相等）。直接用会拿 configId 去查网站，
    // 侧栏显示「该网站暂无源」——比空着更误导。判定为游离源就不写。
    if (row?.configId && String(siteId) === String(row.configId)) return
    // 中途切走就丢弃，别把上一个源的归属写到当前上下文上
    if (String(route.query.sourceId ?? '') !== String(sourceId)) return
    ws.saveSnapshot(sourceId, { siteId })
    flow.patchSourceCtx({ siteId })
    // 反查出来了才建得了「全部」页签——上面那条路径（source.siteId 直接可用）已经建过
    void ensureSiteTabNamed(String(siteId))
  } catch {
    // 反查失败不影响主流程：左侧列表保持空态，用户仍可从网站列表进入
  }
}

/** configDetail 补充：首屏之后异步打回。中途切走了就丢弃，别把上一个源的数据写到当前画布上。 */
/**
 * 把源的定时 cron 补回来（2026-09-18）。
 *
 * 用户问「定时策略数据为什么没有同步过来」——因为定时**不在 source/config 上**：
 * `sourceDetail.schedule` 实测恒为 null（抽查列表前 20 个源全空），真正的 cron 在 job 表，
 * 就是旧平台「定时列表」那一页的数据（源 430016942 → `0 0 16 * * ?`）。
 *
 * 一个源可能挂多条定时，取**启用中的第一条**；都停用了就退回第一条，至少让人看到配过什么。
 * 查不到不影响画布——定时只是节点配置里的一栏。
 */
async function backfillSourceSchedule(sourceId: string) {
  flow.setSourceJob(null)   // 先清掉上一个源的，避免切源时短暂显示别人的定时
  try {
    const jobs = await sourceApi.sourceJobs(sourceId)
    const job = jobs.find((item) => item.schedule && !item.disabled) ?? jobs[0] ?? null
    // 中途切走就丢弃，别把上一个源的定时写到当前上下文上
    if (String(route.query.sourceId ?? '') !== String(sourceId)) return
    flow.setSourceJob(job)
  } catch {
    /* 定时查不到就维持原样，不打断画布 */
  }
}

async function backfillStepDetails(sourceId: string, steps: Step[], backendScope: 'default' | 'flow') {
  const requestedFlowId = flow.sourceCtx?.flowId
  if (!steps.length) return
  try {
    const enriched = await sourceApi.stepConfigDetails(steps, backendScope)
    if (flow.sourceCtx?.sourceId !== sourceId || flow.sourceCtx?.flowId !== requestedFlowId) return
    const rebuilt = flow.applyStepDetails(enriched)
    // 登录语义改变了模板路由、且被重建的正好是当前选中节点时，右侧面板要跟着换一份配置
    if (rebuilt.includes(flow.selectedId)) flow.select(flow.selectedId)
  } catch {
    // 补充失败不影响已经画出来的流程：节点仍是可用的，只是队列/配置名等回落到模板默认值
  }
}

// 发起抓取（0714 会议 Task 4）：唯一完整执行入口——试跑作为独立概念/入口已删除，
// 原来驱动运行态模拟的能力合并进这里；发起抓取请求成功后才驱动节点状态流转。
// capturing：runtime.running 要等 sendSnatch 的 await 完之后才置真，中间有个真空窗口，
// 单靠它挡不住同一按钮的快速二次点击，这里在校验通过后立即同步占位。
const capturing = ref(false)
const loginConfigDialogOpen = ref(false)
const loginConfigDialogConfigs = ref<LoginConfigRef[]>([])
const loginConfigDialogDefaultId = ref('')
let resolveLoginConfigSelection: ((configId?: string) => void) | null = null

function loginConfigsForNode(cfg: ReturnType<typeof flow.serialize>['configs'][string]): LoginConfigRef[] {
  const collect = cfg.collectCfg
  if (!collect) return []
  if (collect.loginConfigs?.length) return collect.loginConfigs
  return collect.account || collect.loginUrl
    ? [{
      id: 'legacy-default', loginUrl: collect.loginUrl || collect.url || '', loginName: collect.account || '', loginPwd: '',
      newLoginConfig: '1' as const, authConfig: '', enabled: true,
    }]
    : []
}

function loginNodeForStart() {
  const entries = Object.entries(flow.configs)
  for (const [nodeId, cfg] of entries) {
    if (collectorCapabilityOf(cfg)?.kind === 'login') return { nodeId, cfg }
  }
  return undefined
}

function chooseLoginConfigForStart(): Promise<{ nodeId: string; configId: string } | null | undefined> {
  const loginNode = loginNodeForStart()
  if (!loginNode) return Promise.resolve(null)
  const configs = loginConfigsForNode(loginNode.cfg)
  const enabled = configs.filter((config) => config.enabled)
  if (!enabled.length) {
    ElMessage.warning('请先在网页登录节点配置至少一条启用的登录配置')
    return Promise.resolve(undefined)
  }
  const defaultId = loginNode.cfg.collectCfg?.defaultLoginConfigId
  if (enabled.length === 1) return Promise.resolve({ nodeId: loginNode.nodeId, configId: enabled[0].id })

  loginConfigDialogConfigs.value = configs
  loginConfigDialogDefaultId.value = defaultId || enabled[0].id
  loginConfigDialogOpen.value = true
  return new Promise((resolve) => { resolveLoginConfigSelection = (configId) => resolve(configId ? { nodeId: loginNode.nodeId, configId } : undefined) })
}

function confirmLoginConfigSelection(configId: string) {
  loginConfigDialogOpen.value = false
  resolveLoginConfigSelection?.(configId)
  resolveLoginConfigSelection = null
}

function cancelLoginConfigSelection() {
  loginConfigDialogOpen.value = false
  resolveLoginConfigSelection?.()
  resolveLoginConfigSelection = null
}

const snatchLauncher = ref<InstanceType<typeof SnatchLauncher>>()

async function onStartCapture() {
  const s = flow.sourceCtx
  if (!s) return
  if (!await ensureFlowReady('发起抓取')) return
  if (runtime.running || capturing.value) {
    ElMessage.warning('已有发起抓取正在进行，请稍候')
    return
  }
  const loginSelection = await chooseLoginConfigForStart()
  if (loginSelection === undefined) return
  // 使用「当前节点」的配置发抓取：选中节点引用的 configId 决定参数范围，未选中节点则按整源。
  const node = flow.selectedNode
  const configId = node?.configId
  capturing.value = true
  try {
    await snatchLauncher.value?.launch(s.sourceId, {
      configId,
      queue: undefined,
      onSuccess: () => {
        const runId = runtime.startCapture(
          flow.serialize({ includeLoginPasswords: true }),
          loginSelection
            ? { loginNodeId: loginSelection.nodeId, loginConfigId: loginSelection.configId }
            : undefined,
        )
        if (!runId) {
          ElMessage.warning('当前画布没有可发起抓取的节点（已停止 / 规划中 / 缺 URL 或输出表的采集节点会被跳过）')
          return
        }
        // runId 是画布本地演示用的编号（stores/runtime），不是后端任务 ID，别展示给用户（10-22：用户拿它去任务列表找不到）
        ElMessage.success('已发起抓取，任务已下发，可到「任务」页签查看进度')
      },
    })
  } catch {
    // launch 内部已自行提示，这里仅兜底
  } finally {
    capturing.value = false
  }
}

// "发布"概念全删（0710 会议 C3）：默认草稿语义，保存即生效
// "试跑"入口已删除（0714 会议 Task 4）：CanvasHeader 的"发起抓取"按钮通过同一条动作总线触发 onStartCapture
function registerCanvasActions() {
  ui.clearActions()
  ui.registerAction('发起抓取', onStartCapture)
}

/**
 * 页签额度满了怎么办——两种入口两种处理（2026-09-18，见 enterFromRoute 的说明）。
 *
 * `retry` 是腾出位置后再试一次的建页签动作；腾不出来（全被保护）或不该腾时，退回提示。
 */
function onTabQuotaFull(fromOutside: boolean | undefined, retry: () => boolean, what: string) {
  if (fromOutside) {
    const evicted = ws.evictOldestTab(protectedTab())
    if (evicted && retry()) {
      // 文案说"最右侧"而不是"最早的"（2026-09-18 用户反馈看不明白）：
      // "最早"是我们内部的排序依据，用户看不见；"最右侧"他在页签条上一眼就能对上。
      // 末尾那句是为了打消顾虑——关的只是页签，网站/源都还在，随时能再打开。
      ElMessage.info(`页签已满，已自动关闭最右侧的「${evicted.name}」（可随时重新打开）`)
      return
    }
  }
  ElMessage.warning(`页签已满（${MAX_WORKSPACE_TABS} 个），${what}没能加进页签条——内容照常显示，关掉几个页签后重新进入即可固定`)
}

/**
 * 腾页签位置时**绝对不能关**的那个。
 *
 * 只有一种情况需要保护：当前画布有未保存改动。`flow.dirty` 只反映**正在编辑的那一个**
 * 页签（其余页签的状态都只是快照，没有"未保存"概念），所以保护它一个就够。
 * 不 dirty 时不保护——用户马上就要离开当前页面去新的了，关掉它反而省事。
 */
function protectedTab(): WorkspaceTabRef | null {
  if (!flow.dirty || !ws.activeSourceId) return null
  return { kind: 'source', id: ws.activeSourceId }
}

/**
 * `fromOutside` = 这次进入是**从工作区外部**来的（网站列表点卡片 / 深链 / 刷新），
 * 而不是已经在页签工作区里切来切去。
 *
 * 2026-09-18 产品定的口径：**入口不同，判断不同**——
 *  - 从网站列表点进来：他就是要打开这个网站，页签满了就自动关掉最右那个给它腾位；
 *  - 已经在页签页面里再开新的：他看得见自己有哪些页签，该由他决定关谁，只提示不代劳。
 *
 * 靠调用点区分：组件挂载时（从别的路由进来）传 true，路由 watch（工作区内导航）不传。
 */
async function enterFromRoute(opts: { fromOutside?: boolean } = {}) {
  const siteId = String(route.query.siteId ?? '')
  const sourceId = String(route.query.sourceId ?? '')
  if (siteId && !sourceId) {
    // 0915-05（2026-09-16）：这里原本把网站态的 view=task 重定向到一级任务中心 /tasks
    // （0812 计划 M1-3「网站汇总态任务页签已删除」）。该结论已被 0915 会议推翻——
    // 任务中心不区分网站，产品要的是"本网站、不分源"的任务视图，页签已恢复，故删除重定向。
    // 网站详情页（0714 会议 Task 3）：不再重定向到第一个源，本身就是一个页面；
    // 加载（含"该网站暂无源"兜底）交给 SiteDetailView 自己处理，这里只管路由归一化和顶部动作栏。
    // 0915-02：进网站态即登记「全部」页签（名字等 SiteDetailView 拿到 site/detail 再补）。
    //
    // 满额时**要说一声**（2026-09-18 用户提）：此前是静默失败，于是从网站卡片点进来之后，
    // 内容是这个网站的、页签条上却没有它，也没有任何一项高亮——用户既不知道自己在哪，
    // 也不知道为什么。源页签那条路（ws.open）一直是"照常切过去 + 提示"，这里对齐它。
    // 不会连弹：enterFromRoute 只在 sourceId/siteId 真正变化时触发（下方 watch 有 prev 守卫），
    // 点已在页签条上的网站走的是 exist 分支，返回 true 也不会弹。
    if (!ws.ensureSiteTab(siteId)) onTabQuotaFull(opts.fromOutside, () => ws.ensureSiteTab(siteId), '本网站')
    const view = normalizeSiteView(route.query.view)
    if (route.query.view !== view) await router.replace({ path: '/canvas', query: { siteId, view } })
    else ui.clearActions()
  } else if (sourceId) {
    const view = normalizeSourceView(route.query.view)
    const querySiteId = String(route.query.siteId ?? '')
    // 补全 view 后不依赖 route watcher 再次触发：它只监听 sourceId/siteId，
    // 因此缺省 view 的页签跳转或深链必须在本次调用里继续加载目标源。
    if (route.query.view !== view) {
      await router.replace({ path: '/canvas', query: { ...(querySiteId ? { siteId: querySiteId } : {}), sourceId, view } })
    }
    await loadSourceFlow(sourceId, opts.fromOutside)
    registerCanvasActions()
  } else {
    // 裸 /canvas 已由路由守卫导回采集资产；这里仅保留内部兜底
    flow.newFlow('blank')
    registerCanvasActions()
  }
}
onMounted(async () => {
  window.addEventListener('hashchange', syncActiveView)
  autosave.bind()
  if (isGate.value) {
    ui.clearActions()
    return
  }
  // 组件刚挂载 = 从工作区外部进来（网站列表点卡片 / 深链 / 刷新）
  await enterFromRoute({ fromOutside: true })
})
// sourceId / siteId 互斥；flowId / flowMode 负责同一个源内的流程切换。
watch(
  () => [route.query.sourceId, route.query.siteId, route.query.flowId, route.query.flowMode, route.query.view] as const,
  async ([sid, stid, fid, mode, view], prev) => {
    if (isGate.value) return
    const changedBackend = !!import.meta.env.VITE_FLOW_PROXY_TARGET && prev && (normalizeSourceView(view) === 'flow') !== (normalizeSourceView(prev[4]) === 'flow')
    if (prev && sid === prev[0] && stid === prev[1] && fid === prev[2] && mode === prev[3] && !changedBackend) return
    if (prev && sid === prev[0] && fid !== prev[2]) rememberCurrentFlowInspector()
    await enterFromRoute()
  },
)
watch(isGate, (v) => {
  if (v) ui.clearActions()
})
onUnmounted(() => {
  resolveLoginConfigSelection?.()
  resolveLoginConfigSelection = null
  window.removeEventListener('hashchange', syncActiveView)
  onSplitEnd()
  ui.inspectorExpanded = false
  ui.clearActions()
  autosave.unbind()
  flow.clearSourceCtx()
  flow.clearSiteCtx()
})
</script>

<template>
  <NewSiteWizard v-if="isGate" />

  <template v-else>
    <!-- 0915-02：网站聚合态也要有页签条（「全部」页签就挂在这），不能再只看 sourceCtx -->
    <SourceTabsBar v-if="flow.sourceCtx || ws.siteTabs.length" />
    <!-- 两列布局（0710 会议 B1）：左列源侧栏（页面级，在视图层之上），右列内容区随流程/数据/任务视图切换 -->
    <div class="rc-canvas-cols" :class="{ 'with-tabs': !!flow.sourceCtx || !!ws.siteTabs.length }">
      <SiteSourceSwitcher
        v-if="sidebarSiteId"
        :site-id="sidebarSiteId"
        :active-key="sidebarActiveKey"
        :allow-table-mode="sidebarAllowTableMode"
        :active-table-id="sidebarActiveTableId"
        :preferred-table-id="sidebarPreferredTableId"
        @pick-table="onPickTable"
        @pick="onSwitchTarget"
        @added="onSwitchAdded"
        @compare="onSidebarCompare"
        @pick-site="onSwitchToSite"
      />
      <div class="rc-canvas-main">
        <!-- key 用加载完成后的 ctx，避免切换时读到旧源数据。 -->
        <div v-if="awaitingSource" class="rc-source-loading" :class="{ 'is-error': !!sourceLoadError }">
          {{ sourceLoadError || '正在加载源…' }}
        </div>
        <SiteDetailView v-else-if="isSiteDetail" :key="sidebarSiteId" :site-id="sidebarSiteId" class="rc-flow-result" />
        <CompareSplit v-else-if="ws.compareSourceId" class="rc-flow-result" />
        <SourceSummaryView v-else-if="isOverviewView" :key="flow.sourceCtx?.sourceId" class="rc-flow-result" />
        <TaskView v-else-if="isTaskView" :key="flowScopedKey" class="rc-flow-result" />
        <FileView v-else-if="isFileView" :key="flowScopedKey" class="rc-flow-result" />
        <MonitorConfigView v-else-if="isMonitorConfigView" :key="flow.sourceCtx?.sourceId" class="rc-flow-result" />
        <SourceWorkflowList
          v-else-if="isWorkflowListView"
          :key="flow.sourceCtx?.sourceId"
          :source-id="flow.sourceCtx!.sourceId"
          class="rc-flow-result"
        />
        <!--
          0904 I10（Z3-1）：**数据视图也挂进这套三栏**，不再整屏铺开。
          结构 = 左源侧栏（`rc-canvas-cols` 那层，本来就固定）+ 中间可切换（流程 ↔ 数据）+ 右节点配置。
          产品原话「就相当于只是中间这边去切换，然后这边是固定的」「流程节点里面不是可以三栏吗？
          数据节点也是可以做成三栏的」。
          **动机**：从配置区点「测试脚本」跳到数据视图后，右侧配置面板原来整个消失了
          ——「你右边这个没有了，配置看不到了，所以到数据时候就看不到了」，
          于是"边写规则边看数据"根本不成立。
        -->
        <div
          v-else
          class="rc-flow-shell"
          :class="{ 'source-mode': !!flow.sourceCtx, expanded: ui.inspectorExpanded, 'insp-collapsed': ui.inspectorCollapsed, 'version-readonly': isPublishedFlowView && !isDataView }"
          :style="{ '--insp-w': inspWidth }"
        >
          <template v-if="!ui.inspectorExpanded">
            <ResultView v-if="isDataView" :key="flowScopedKey" class="rc-flow-center" />
            <FlowBoard v-else />
          </template>
          <button
            v-else
            type="button"
            class="rc-canvas-collapsed"
            :title="isDataView ? '点击恢复数据' : '点击恢复画布'"
            @click="ui.toggleInspectorExpanded()"
          >» {{ isDataView ? '数据已收起' : '画布已收起' }}</button>
          <div
            v-if="!ui.inspectorExpanded && !ui.inspectorCollapsed"
            class="rc-insp-splitter"
            title="拖动调整配置区宽度"
            @mousedown="onSplitStart"
          />
          <div v-else class="rc-insp-splitter placeholder" />
          <!-- 右侧配置区收起态（Z3-2）：点窄条即可展开。
               与"中间收起"是相反的两端，互斥。 -->
          <button
            v-if="ui.inspectorCollapsed"
            type="button"
            class="rc-insp-collapsed"
            data-testid="inspector-collapsed"
            title="点击展开节点配置"
            @click="ui.toggleInspectorCollapsed()"
          >« 节点配置</button>
          <NodeInspector v-else />
        </div>
      </div>
    </div>
  </template>
  <LoginConfigSelectDialog
    v-model:open="loginConfigDialogOpen"
    :configs="loginConfigDialogConfigs"
    :default-id="loginConfigDialogDefaultId"
    @confirm="confirmLoginConfigSelection"
    @cancel="cancelLoginConfigSelection"
  />
  <SnatchLauncher ref="snatchLauncher" />
</template>

<style scoped>
/* 两列骨架（0710 会议 B1）：高度收敛到 wrapper，一处管理页签条占位；子列全部 100% 撑满 */
.rc-source-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--rc-faint); font-size: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); }
.rc-source-loading.is-error { color: var(--rc-error); }
.rc-canvas-cols { display: flex; gap: 8px; align-items: stretch; height: calc(100vh - 168px); min-height: 600px; }
.rc-canvas-cols.with-tabs { height: calc(100vh - 204px); min-height: 564px; }
.rc-canvas-main { flex: 1; min-width: 0; min-height: 0; }
.rc-canvas-main > * { height: 100%; }
/* 三栏里的中间列（数据视图）：自己滚，别把整个 shell 撑高 */
.rc-flow-center { min-width: 0; min-height: 0; overflow: auto; }

.rc-flow-shell {
  display: grid;
  grid-template-columns: minmax(560px, 1fr) 6px var(--insp-w, 372px);
  gap: 8px;
  align-items: stretch;
}
.rc-flow-shell.source-mode { grid-template-columns: minmax(480px, 1fr) 6px var(--insp-w, 480px); }
/* 只读不再整块禁用右侧检查器（会连滚动都禁掉）：NodeInspector 自己判断只读、只禁改动 */
/* 展开态：画布收起为窄条（与左侧源侧栏收起态一致），配置区占满剩余空间 */
.rc-flow-shell.expanded,
.rc-flow-shell.source-mode.expanded { grid-template-columns: 36px 6px minmax(0, 1fr); }
/* 收起态：配置区缩成窄条（与上面的展开态左右对称），中间占满 */
.rc-flow-shell.insp-collapsed,
.rc-flow-shell.source-mode.insp-collapsed { grid-template-columns: minmax(0, 1fr) 6px 36px; }
.rc-insp-collapsed {
  display: flex; align-items: center; justify-content: center;
  writing-mode: vertical-rl; text-orientation: mixed;
  width: 36px; padding: 0; border: 1px solid var(--rc-border); border-radius: var(--rc-radius);
  background: #fff; color: var(--rc-muted); font-size: 12px; letter-spacing: 1px; cursor: pointer;
}
.rc-insp-collapsed:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); border-color: #93c5fd; }
.rc-canvas-collapsed {
  display: flex; align-items: center; justify-content: center;
  writing-mode: vertical-rl; text-orientation: mixed;
  width: 36px; padding: 0; border: 1px solid var(--rc-border); border-radius: var(--rc-radius);
  background: #fff; color: var(--rc-muted); font-size: 12px; letter-spacing: 1px; cursor: pointer;
}
.rc-canvas-collapsed:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); border-color: #93c5fd; }

.rc-insp-splitter { cursor: col-resize; position: relative; border-radius: 3px; }
.rc-insp-splitter::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 1px;
  background: var(--rc-border);
}
.rc-insp-splitter:hover::before, .rc-insp-splitter:active::before { background: var(--rc-primary); }
.rc-insp-splitter.placeholder { cursor: default; pointer-events: none; }
.rc-insp-splitter.placeholder::before { background: transparent; }

/* 13 寸视口：保留画布与配置区并排，同时给右侧 Tab 留出完整的可读宽度。
   收起与展开态必须具有最高优先级，防止被常规 source-mode 宽度覆盖。 */
@media (max-width: 1400px) and (min-width: 1241px) {
  .rc-flow-shell:not(.expanded):not(.insp-collapsed),
  .rc-flow-shell.source-mode:not(.expanded):not(.insp-collapsed) { grid-template-columns: minmax(360px, 1fr) 6px minmax(360px, 400px); }
  .rc-flow-shell.expanded,
  .rc-flow-shell.source-mode.expanded { grid-template-columns: 36px 6px minmax(0, 1fr); }
  .rc-flow-shell.insp-collapsed,
  .rc-flow-shell.source-mode.insp-collapsed { grid-template-columns: minmax(0, 1fr) 6px 36px; }
}

@media (max-width: 1240px) {
  .rc-canvas-cols, .rc-canvas-cols.with-tabs { height: auto; min-height: 0; }
  .rc-flow-shell,
  .rc-flow-shell.source-mode,
  .rc-flow-shell.expanded,
  .rc-flow-shell.insp-collapsed { grid-template-columns: minmax(0, 1fr); height: auto; }
  .rc-insp-splitter { display: none; }
  .rc-flow-shell > :last-child { grid-column: 1 / -1; }
  .rc-flow-shell > :last-child:not(.rc-insp-collapsed) { min-height: 520px; }
  .rc-flow-shell > .rc-insp-collapsed { width: 100%; height: 36px; writing-mode: horizontal-tb; }
}
</style>
