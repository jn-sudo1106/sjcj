<script lang="ts">
// 0927 P1-4：计数器必须放模块级（独立 script 块）——script setup 每挂载一个实例就重跑一遍，
// 写在里面恒为 rc-arrow-1，0926 F-R15 的「marker id 实例化」修复实际不生效（先挂实例一卸载
// 箭头就集体消失）。ProcessNodeRail.vue 同款修复用 <script setup> 外的模块变量才是对的写法。
let flowBoardSeq = 0
</script>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore, type EdgeSlot } from '@/stores/flow'
import { tableForDownstream } from '@/utils/flow/tableSync'
import { useSourceStore } from '@/stores/source'
import { useDuplicateNode } from './useDuplicateNode'
import { useStepWrite } from './useStepWrite'
import { useRuntimeStore } from '@/stores/runtime'
import { useUiStore } from '@/stores/ui'
import { entryApi, flowApi, flowCenterApi, type FlowRecord } from '@/api'
import { extraParentsOf, isWritableStepId, relinkCandidates, validFlowIdOf } from '@/utils/flow/stepPersist'
import { copyToClipboard } from '@/utils/clipboard'
import CanvasHeader from '../shared/CanvasHeader.vue'
import SourceWorkflowTabs from '../source/SourceWorkflowTabs.vue'
import AddNodePopover from './AddNodePopover.vue'
import FlowXmlDialog from './FlowXmlDialog.vue'
import { canvasFlowIdOf, useFlowVersionStore } from '@/stores/flowVersion'
import { flowToXml } from '@/utils/flow/flowXml'
import { nodeStatusOf } from './nodeStatus'
import { reloadFlowIntoCanvas, reloadSourceIntoCanvas, reportDetachResult } from '@/utils/flow/applyTemplateToSource'
import { detachConfigsInPlace } from '@/utils/flow/copiedConfigs'
import {
  effectiveOutputTable,
  isDataNode,
  nodeClassFor,
  nodeEntryCondition,
  nodeOutputTable,
  nodeInputTable,
  nodeTypeLabel,
  conditionGroupIsSet,
  conditionGroupLabel,
  type NodeConfig,
} from './flowModel'

// 0927 P1-4 收尾：marker id 实例化。计数器在文件顶部独立 <script> 块里（模块级唯一），
// 这行语句必须留在 import 区之后——插在 import 之间会让其后所有 import 解析失败
// （vue-tsc：TS1232 + TS2307 + 连带 any）。
const markerPrefix = `rc-arrow-${++flowBoardSeq}`

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ workflowStatus: [status: 'loading' | 'ready' | 'empty' | 'error'] }>()
const workflowStatus = ref<'loading' | 'ready' | 'empty' | 'error'>('loading')
function onWorkflowStatus(status: 'loading' | 'ready' | 'empty' | 'error') {
  workflowStatus.value = status
  emit('workflowStatus', status)
}
const flow = useFlowStore()
// 复制节点 = 新增一套配置（0828 D02）：副本必须绑一份新配置，不能沿用原 configId
const duplicateNode = useDuplicateNode()
const { deleteCanvasNode, relinkOrphan } = useStepWrite()
const runtime = useRuntimeStore()
const ui = useUiStore()
const flowEl = ref<HTMLElement | null>(null)
const canvasScrollEl = ref<HTMLElement | null>(null)
let canvasResizeObserver: ResizeObserver | null = null
const xmlOpen = ref(false)
const xml = computed(() => (xmlOpen.value ? flowToXml(flow.serialize()) : ''))
const canExportXml = computed(() => !flow.dirty && flow.validateFlow().length === 0)
const recommending = ref(false)
// 2026-10-10：217 流程版本——发布版 / 锁定草稿同样只读（画布不能操作，「+」不显示），点版本条「编辑草稿」后放开
const flowVersion = useFlowVersionStore()
const isLeoPublishedView = computed(() => flow.sourceCtx?.workflowVersionManaged !== false
  && flow.sourceCtx?.workflowVersionStatus === 'PUBLISHED')
const isPublishedView = computed(() => isLeoPublishedView.value
  || (flowVersion.readonly && flowVersion.flowId === canvasFlowIdOf(flow)))

// 编排对象切换器已升级为页面级源侧栏（0710 会议 B1），组件与接线整体迁至 index.vue

async function loadTemplateDefaults(template: FlowRecord) {
  flow.load({
    id: flow.flowId,
    name: flow.flowName,
    version: `template-v${template.version}`,
    main: template.definition.main,
    branches: template.definition.branches,
    configs: template.definition.configs,
    branchGroups: template.definition.branchGroups,
    updatedAt: template.updatedAt,
  })
  // 0929 F2：空白画布套模板同样不能带着模板的真实 configId 落库（本地编辑会直接改模板配置）
  await detachTemplateConfigs(template)
}

/**
 * 智能推荐 / 默认模板落地后的配置去共享（0929 F2 红线补漏）：applyTemplate 与
 * loadTemplateDefaults 是**本地拼装**路径，节点 configId 仍是模板真实配置——编辑保存会直接
 * 写模板配置。这里逐条复制并就地换绑画布 store（画布下次落库按新配置重建步骤行），
 * 失败登记知情确认，不阻断推荐主流程。
 */
async function detachTemplateConfigs(template: FlowRecord) {
  const detach = await detachConfigsInPlace(flow.configs, {
    flowId: validFlowIdOf(flow.flowId),
    sourceFlowRef: `模板「${template.name}」`,
  })
  reportDetachResult({ ok: true, copied: detach.copied, remainShared: detach.remainShared })
}

async function recommendTemplateFlow() {
  if (recommending.value) return
  recommending.value = true
  try {
    const prompt = [flow.sourceCtx?.name, flow.sourceCfg?.url, flow.sourceCtx?.url].filter(Boolean).join(' ')
    // 0925 REVIEW：候选必须是「可复用流程」= 模板全集（templates() 不分页、templateFlag=1、仅有效流程）；
    // 原来用 list()（paged 前 500 条按 updateDt 倒序）——推荐 id 若落在第 500 名之后必然落空，只剩无谓的
    // preset-web-public 兜底。preset-web-public 是 mock 时代的假 id，真实后端永远找不到，保留只作最后兜底。
    const [recommendation, templates] = await Promise.all([flowApi.flowRecommend(prompt), flowCenterApi.templates()])
    const template = (recommendation.templateId ? templates.find((item) => item.id === recommendation.templateId) : undefined)
      ?? templates.find((item) => item.id === 'preset-web-public')
    if (!template) {
      ElMessage.info('暂未匹配到可复用流程，请用「＋」手工添加节点，或从右上角选择流程。')
      return
    }
    if (flow.sourceCtx || flow.sourceCfg) {
      flow.applyTemplate(template)
      // 0929 F2：applyTemplate 是本地拼装，configId 仍指向模板——套完必须去共享
      await detachTemplateConfigs(template)
    } else await loadTemplateDefaults(template)
    ElMessage.success(recommendation.templateId
      ? `已推荐并应用「${template.name}」v${template.version}`
      : `未识别具体场景，已应用默认流程「${template.name}」v${template.version}`)
  } catch {
    ElMessage.error('流程推荐异常')
  } finally {
    recommending.value = false
  }
}


const menu = reactive<{ show: boolean; x: number; y: number; nodeId: string | null; afterId: string }>({
  show: false, x: 0, y: 0, nodeId: null, afterId: 'start',
})
// 0707 优化·Phase6·补：addPop 扩展 branch 模式（ownerId/branchId），供 fan-out 分支列「+」复用同一浮层。
// 1008-BR-04：再加 edge（分支区域线上「+」→ insertOnEdge）与 siblingOf（节点左右「+」→ addSibling）。
const addPop = reactive<{
  show: boolean; x: number; y: number; afterId: string
  branch: { ownerId: string; branchId: string } | null
  edge: { parentId: string; childIds: string[] } | null
  siblingOf: string | null
}>({
  show: false, x: 0, y: 0, afterId: 'start', branch: null, edge: null, siblingOf: null,
})
const nodePalette = reactive({ show: false, x: 0, y: 0 })

// 表 tableId → 可读 label 的缓存（0901）：这条标注之前直接把 tableId 拼进字符串显示
// （比如「6200026 → ?」），用户看不出是哪张表。按 id 查一次 entryDetail 换成业务名
// （没有业务名退物理表名），查询期间先显示 id 兜底，缓存后同一个 id 不重复查。
// 标注本身是画布上的小字浮层，不叠 RuleTableFieldBinder 下拉里"业务名 · 物理表名"那种全称格式。
// 0926 拍板：**卡片上的输入/输出表展示需要同时带表 ID**（业务沟通都用 id），连线小字浮层空间
// 有限仍只显示名称——withId 只给卡片用。
const edgeTableLabelCache = reactive<Record<string, string>>({})
const edgeTableLabelPending = new Set<string>()
function edgeTableLabel(tableId: string, withId = false): string {
  if (!edgeTableLabelCache[tableId] && !edgeTableLabelPending.has(tableId)) {
    edgeTableLabelPending.add(tableId)
    entryApi.entryDetail(tableId)
      .then((detail) => { edgeTableLabelCache[tableId] = detail ? (detail.name || detail.tableName) : tableId })
      .catch(() => { edgeTableLabelCache[tableId] = tableId })
  }
  const name = edgeTableLabelCache[tableId] || tableId
  return withId && name !== tableId ? `${name} (${tableId})` : name
}

// 连线表关系标注（Phase 4.2；0701 问题五升级；0707 连线配置撤掉后纯读节点级数据；0901 加有效输出表兜底）：
// 输出表 → 输入表（全节点落库 + 输入表自动继承后，链路血缘天然可标注）。
// 输出表用 effectiveOutputTable 而非 nodeOutputTable：节点自己没显式落表时，「输出表」编辑框
// 本就承诺「默认 = 输入表」（见 RuleTableFieldBinder.vue），这里要跟那份承诺对上。
function edgeTableTag(fromId: string, toId: string): string {
  const fromCfg = flow.configs[fromId]
  const toCfg = flow.configs[toId]
  const out = fromCfg ? effectiveOutputTable(fromCfg) : ''
  const inp = toCfg ? flow.effectiveInputTableFor(toId) : ''
  if (!out && !inp) return ''
  return `${out ? edgeTableLabel(out) : '?'} → ${inp ? edgeTableLabel(inp) : '?'}`
}
// 连线上只保留表血缘标签；分支的进入条件显示在分支列标签上（branchColText，取列首节点自己的进入条件）。
function nodeClasses(id: string, cfg: NodeConfig) {
  return [
    nodeClassFor(cfg),
    cfg.disabled ? 'disabled-node' : '',
    flow.selectedId === id ? 'active' : '',
    runtime.nodeStates[id] ? `run-${runtime.nodeStates[id]}` : '',
  ]
}
function runText(id: string) {
  const s = runtime.nodeStates[id]
  return s === 'L' ? '处理中' : s === 'C' ? '完成' : s === 'E' ? '失败' : ''
}
/**
 * 节点卡片上的表标签（2026-09-04 修；0926 拍板「展示一一输入输出表」）。
 *
 * 0926 起卡片把**输入表 → 输出表**成对展示（输入取画布继承链 effectiveInputTableFor，
 * 输出取显式 nodeOutputTable）：
 *  - 输入、输出都有：`⊞ 输入表 → 输出表`；
 *  - 采集节点缺输出表：`⊞ 输入表 → ?`（unset，title 说明没设置输出表——它的编辑框写着
 *    「请选择输出表」，输出表必填，不能拿输入表冒充，2026-09-04 用户实例：流程 1400984）；
 *  - 非采集节点缺显式输出表：只显示输入表（title 说明「默认继承输入表」——编辑框承诺过）
 *  - 都没有：不显示。
 */
function tableChip(cfg: NodeConfig, id?: string): { label: string; title: string; unset: boolean } | null {
  const inp = id ? flow.effectiveInputTableFor(id) : nodeInputTable(cfg)
  const out = nodeOutputTable(cfg)
  if (!inp && !out) return null
  if (out) {
    const outLabel = edgeTableLabel(out, true)
    if (!inp) return { label: outLabel, title: `输出表 ${outLabel}`, unset: false }
    const inpLabel = edgeTableLabel(inp, true)
    return { label: `${inpLabel} → ${outLabel}`, title: `输入表 ${inpLabel} → 输出表 ${outLabel}`, unset: false }
  }
  const inpLabel = edgeTableLabel(inp, true)
  if (cfg.collectCfg) return { label: `${inpLabel} → ?`, title: `输入表 ${inpLabel} · 尚未设置输出表`, unset: true }
  return { label: inpLabel, title: `输入表 ${inpLabel} · 输出表未显式设置，默认继承输入表`, unset: false }
}



function footFor(cfg: NodeConfig) {
  const { configured, left, missing } = nodeStatusOf(cfg)
  const right = cfg.disabled
    ? '数据在此节点不处理'
    : cfg.collect
      ? '源配置'
      : isDataNode(cfg)
        ? '待发起抓取'
        : '待配置'
  return {
    left,
    right,
    hint: missing.length ? `还缺：${missing.join('、')}` : '',
    warn: cfg.disabled || ((cfg.collect || isDataNode(cfg)) && !configured),
  }
}
function footClass(cfg: NodeConfig) {
  const foot = footFor(cfg)
  return { warn: foot.warn, ok: foot.left === '运行' }
}

// ---- 拖放 ----
function onDragOver(ev: DragEvent) {
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}
function nearestAfterId(clientY: number): string {
  const rect = flowEl.value?.getBoundingClientRect()
  if (!rect) return flow.layout.slots[0]?.afterId ?? 'start'
  const y = clientY - rect.top
  let best = flow.layout.slots[0]
  let bestD = Number.POSITIVE_INFINITY
  flow.layout.slots.forEach((s) => {
    const d = Math.abs(s.top - y)
    if (d < bestD) { bestD = d; best = s }
  })
  return best?.afterId ?? 'start'
}
function onDrop(ev: DragEvent) {
  ev.preventDefault()
  if (isPublishedView.value) return
  const afterId = nearestAfterId(ev.clientY)
  const nodeId = ev.dataTransfer?.getData('node-id')
  if (nodeId) {
    flow.moveTo(nodeId, afterId)
    return
  }
  const template = ev.dataTransfer?.getData('text/plain')
  if (!template) return
  flow.insertAfter(afterId, template)
}
function onSlotDrop(ev: DragEvent, afterId: string) {
  ev.preventDefault()
  ev.stopPropagation()
  const nodeId = ev.dataTransfer?.getData('node-id')
  if (nodeId) {
    flow.moveTo(nodeId, afterId)
    return
  }
  const template = ev.dataTransfer?.getData('text/plain') || 'web'
  flow.insertAfter(afterId, template)
}
// 拖拽画布节点本身 → 重排
function onNodeDragStart(ev: DragEvent, id: string) {
  if (!ev.dataTransfer) return
  ev.dataTransfer.setData('node-id', id)
  ev.dataTransfer.effectAllowed = 'move'
}

// ---- 选择 / 右键 ----
function onNodeClick(id: string) {
  flow.select(id)
  closeMenu()
}
function onNodeMenu(ev: MouseEvent, id: string) {
  ev.preventDefault()
  ev.stopPropagation()
  flow.select(id)
  // 只读（发布版 / 锁定草稿）：右键菜单全是改动操作（插入 / 复制 / 移动 / 启停 / 删除），不弹
  if (isPublishedView.value) return
  openMenu(ev.clientX, ev.clientY, id)
}
function onPaneMenu(ev: MouseEvent) {
  ev.preventDefault()
  if (isPublishedView.value) return
  openMenu(ev.clientX, ev.clientY, null, nearestAfterId(ev.clientY))
}
function openMenu(x: number, y: number, nodeId: string | null, afterId?: string) {
  menu.show = true
  menu.x = Math.min(x, window.innerWidth - 190)
  menu.y = Math.min(y, window.innerHeight - 320)
  menu.nodeId = nodeId
  menu.afterId = afterId ?? (nodeId ?? 'start')
}
function closeMenu() {
  menu.show = false
}
function menuAction(action: string) {
  const id = menu.nodeId
  const after = id ?? menu.afterId
  const x = menu.x
  const y = menu.y
  closeMenu()
  // 右键时 onNodeMenu 已 flow.select(id)，节点即已选中/面板即已打开，无需再给「配置节点」入口
  if (action === 'insert-node') openAddPopover(x, y, after)
  else if (action === 'copy' && id) void duplicateNode(id)
  else if (action === 'move-up' && id) flow.move(id, -1)
  else if (action === 'move-down' && id) flow.move(id, 1)
  else if (action === 'toggle' && id) flow.toggleDisabled(id)
  else if (action === 'run-node' && id) runNode(id)
  else if (action === 'delete' && id) void deleteCanvasNode(id)
}

// 孤儿步骤关联（0925）：解析不出 lastStep 的步骤节点在画布上带「孤儿」标记，
// 点它把归属显式挂到某个已有节点（写 stepModify lastStep=目标 → 重载画布重建树）。
const sourceStore = useSourceStore()
const relink = reactive<{ show: boolean; nodeId: string; nodeTitle: string; targetId: string }>({
  show: false, nodeId: '', nodeTitle: '', targetId: '',
})
const relinking = ref(false)

// 候选计算见 utils/flow/stepPersist.ts 的 relinkCandidates：
//   - 排除孤儿自己及其子子孙孙（按快照 dependsOn 闭包，防成环）；
//   - **流程入口（'0' 虚拟入口 / isRoot 真实根行）也允许**——孤儿最常见的正确归属就是
//     「挂回入口」（lastStep 指向入口 = 旧平台的"挂在根上"，后端归一回 '0' 哨兵），
//     此前入口被排除导致只挂得回入口的孤儿下拉是空的（2026-09-26 用户反馈）；
//   - 候选只看画布（configs），不要求步骤快照——快照是写入时才需要的。
const relinkTargets = computed(() => {
  const id = relink.nodeId
  if (!id) return []
  return relinkCandidates(flow.main, flow.branchGroups, flow.configs, sourceStore.stepSnapshots, id)
})

/**
 * 分支列标签（0926 视觉调整）：不再画橙色底纹框/胶囊底色，只展示**该分支各步骤的进入条件**——
 *  1. 列首节点自己的进入条件（历史流程的条件在目标步骤 entryCondition 上，不在分支对象上；
 *     0925 前画布从不展示这批条件，用户反馈「应该只要展示各个步骤进入的条件」）；
 *  2. 没有才回退分支名（= 列首节点名；否则一列条件缺失时整列没有标识）。
 *  （1008-BR-06 前还有决策 / 分头节点的分支条件 FlowBranch.condition，已随节点一起去掉。）
 */
function branchColText(br: { label: string; chain: string[] }): string {
  const head = br.chain[0]
  const headCond = head ? conditionGroupLabel(nodeEntryCondition(flow.configs[head])) : ''
  return headCond || br.label
}

/** 0926 反馈「步骤的进入条件没在流程图上展示」：普通节点卡片的进入条件文案；未设条件返回空串（不占行） */
function nodeCondText(cfg: NodeConfig): string {
  const group = nodeEntryCondition(cfg)
  return group && conditionGroupIsSet(group) ? conditionGroupLabel(group) : ''
}

// 1008-BR-01：多上级（旧平台 lastStep="A,B"）只按第一个上级连线，其余上级在卡片上标出来
function extraParentsTitle(id: string): string {
  const snapshot = sourceStore.stepSnapshots[id]
  const extra = extraParentsOf(snapshot)
  if (!extra.length) return ''
  const name = (pid: string) => (pid === '0' ? '流程入口' : `#${pid}${flow.configs[pid]?.title ? ` ${flow.configs[pid].title}` : ''}`)
  const drawn = snapshot?.dependsOn?.find((pid) => pid && pid !== id) ?? ''
  return `该步骤有多个上级：画布连线的是 ${name(drawn)}，另有 ${extra.map(name).join('、')}。为了不丢上级，此流程不自动重算挂接关系。`
}

function openRelinkDialog(nodeId: string) {
  // 关联会重载画布（本地拼树会丢掉未保存的草稿），脏画布先拦下
  if (flow.dirty) {
    ElMessage.warning('画布有未保存的改动，请稍候自动保存完成后再调整节点归属')
    return
  }
  relink.nodeId = nodeId
  relink.nodeTitle = flow.configs[nodeId]?.title ?? nodeId
  relink.targetId = ''
  relink.show = true
}

async function doRelink() {
  if (!relink.targetId || relinking.value) return
  const sourceId = flow.sourceCtx?.sourceId
  relinking.value = true
  try {
    await relinkOrphan(relink.nodeId, relink.targetId)
    relink.show = false
    ElMessage.success('归属已保存，正在重新加载画布…')
    if (sourceId) {
      if (!await reloadSourceIntoCanvas(sourceId)) ElMessage.warning('归属已保存，但画布重新加载失败，请刷新页面查看')
      return
    }
    // 无源上下文（流程工作区抽屉）：按流程 ID 重载，与 deriveFromFlowConfig 同一条路径
    // 0927 P2-4：口径收敛到 stepPersist.validFlowIdOf（四处共用）。
    const flowId = validFlowIdOf(flow.sourceCfg?.flowId ?? flow.sourceCtx?.flowId ?? flow.flowId)
    if (!flowId || !await reloadFlowIntoCanvas(flowId)) {
      ElMessage.warning('归属已保存，但画布重新加载失败，请刷新页面查看')
    }
  } catch (e) {
    ElMessage.error(`关联失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    relinking.value = false
  }
}

// 单节点运行（右键菜单入口，S7-1 改判 0806）：与 NodeInspector 头部按钮同一套 runtime.runSingleNode，
// 只是不用先选中/打开节点面板——右键即可发起，跟"上移/下移/运行 停止"这些既有的免选中操作放一起更顺手。
function runNode(id: string) {
  if (flow.dirty) {
    ElMessage.warning('画布有未保存的改动，请稍候自动保存完成后再运行节点')
    return
  }
  const { runId, reason } = runtime.runSingleNode(flow.serialize({ includeLoginPasswords: true }), id)
  if (!runId) {
    ElMessage.warning(reason || '当前节点不可运行')
    return
  }
  ElMessage.success(`已发起「${flow.configs[id]?.title ?? id}」单节点运行 ${runId}`)
}

// ---- 添加节点浮层（0707 优化·Phase1，参照 Dify：锚定弹层 + 搜索 + 分组，点选即插） ----
function showAddPopover(x: number, y: number, target: Partial<Pick<typeof addPop, 'afterId' | 'branch' | 'edge' | 'siblingOf'>>) {
  addPop.show = true
  addPop.x = x
  addPop.y = y
  addPop.afterId = target.afterId ?? 'start'
  addPop.branch = target.branch ?? null
  addPop.edge = target.edge ?? null
  addPop.siblingOf = target.siblingOf ?? null
}
function openAddPopover(x: number, y: number, afterId: string) {
  showAddPopover(x, y, { afterId })
}
// 0707 优化·Phase6·补：fan-out 分支列「+」——挂进分支 chain 末尾，而非主链
function openBranchAddPopover(x: number, y: number, ownerId: string, branchId: string) {
  showAddPopover(x, y, { branch: { ownerId, branchId } })
}
// 1008-BR-04：分支区域线上「+」——分叉前（接管全部分支）/ 分支链头上方 / 链内两节点之间
function openEdgeAddPopover(x: number, y: number, slot: EdgeSlot) {
  showAddPopover(x, y, { edge: { parentId: slot.parentId, childIds: slot.childIds } })
}

// ---- 节点左右「+」（1008-BR-04）：给节点加一个兄弟节点 = 在它的上级处分叉，新节点排同级最右 ----
// 旧平台语义（SourceStepCard openCreatePanel）：新步骤上级 = 该节点的上级；上级没有输出表不能加后续。
/** 根位节点（没有上级）不能加兄弟；已发布只读版本不显示 */
function canAddSibling(id: string): boolean {
  return !isPublishedView.value && !!flow.canvasParentMap.get(id)
}
/** 上级没有可给下游的表时不能加（提示沿用旧平台原文） */
function siblingBlockedReason(id: string): string {
  const parent = flow.canvasParentMap.get(id)
  const parentCfg = parent ? flow.configs[parent] : undefined
  return parentCfg && tableForDownstream(parentCfg) ? '' : '所选步骤输出表为空，无法增加后续步骤'
}
function openSiblingAddPopover(x: number, y: number, id: string) {
  const reason = siblingBlockedReason(id)
  if (reason) {
    ElMessage.warning(reason)
    return
  }
  showAddPopover(x, y, { siblingOf: id })
}
// 左右「+」只在悬停 / 选中的节点上出现：卡片和按钮之间有缝，离开时延迟收起，鼠标挪到按钮上不会消失
const hoverNodeId = ref('')
let hoverLeaveTimer: ReturnType<typeof setTimeout> | undefined
function onNodeHover(id: string) {
  clearTimeout(hoverLeaveTimer)
  hoverNodeId.value = id
}
function onNodeLeave() {
  clearTimeout(hoverLeaveTimer)
  hoverLeaveTimer = setTimeout(() => { hoverNodeId.value = '' }, 150)
}
function sideAddVisible(id: string): boolean {
  return (hoverNodeId.value === id || flow.selectedId === id) && canAddSibling(id)
}
/** 链尾节点自己就是嵌套分叉点时，列底的「追加」入口不显示：它下面的分支各有自己的「+」 */
function isForkOwner(id: string): boolean {
  let n = 0
  for (const parent of flow.canvasParentMap.values()) if (parent === id && ++n > 1) return true
  return false
}
function closeAddPopover() {
  addPop.show = false
}
function onPickNode(template: string) {
  if (addPop.siblingOf) flow.addSibling(addPop.siblingOf, template)
  else if (addPop.edge) flow.insertOnEdge(addPop.edge.parentId, addPop.edge.childIds, template)
  else if (addPop.branch) flow.addNodeToBranch(addPop.branch.ownerId, addPop.branch.branchId, template)
  else flow.insertAfter(addPop.afterId, template)
  closeAddPopover()
}

// 画布左侧节点库：沿用新增节点浮层与画布既有拖放契约。
function openNodePalette() {
  const rect = canvasScrollEl.value?.getBoundingClientRect()
  nodePalette.x = rect ? rect.left + 28 : 8
  nodePalette.y = rect ? rect.top + 54 : 20
  nodePalette.show = true
  addPop.show = false
  menu.show = false
}
function pickNodeFromPalette(template: string) {
  flow.insertAfter(flow.selectedId || 'end', template)
}
function onPaletteDragStart(event: DragEvent, template: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('text/plain', template)
  event.dataTransfer.effectAllowed = 'copy'
}
function closeNodePalette() {
  nodePalette.show = false
}

// 点击画布外任意处关闭右键菜单 / 添加节点浮层
function onWindowClick() {
  if (menu.show) closeMenu()
  if (addPop.show) closeAddPopover()
  if (nodePalette.show) closeNodePalette()
}
async function centerCanvas() {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const el = canvasScrollEl.value
  if (!el) return
  el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
}
onMounted(() => {
  window.addEventListener('click', onWindowClick)
  void centerCanvas()
  canvasResizeObserver = new ResizeObserver(() => void centerCanvas())
  if (canvasScrollEl.value) canvasResizeObserver.observe(canvasScrollEl.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
  canvasResizeObserver?.disconnect()
})

// 展开配置区后画布变窄，固定宽度的 .rc-flow 可能超出可视区域（0703 反馈）：
// 展开宽度维持原样，改为把画布滚动条居中，保证默认就能看到节点，而不是贴左露一半
watch(
  () => ui.inspectorExpanded,
  () => void centerCanvas(),
)
</script>

<template>
  <main class="rc-canvas" :class="{ 'is-embedded': props.embedded }" @contextmenu="onPaneMenu" @click="closeMenu">
    <CanvasHeader v-if="!props.embedded" />
    <SourceWorkflowTabs
      v-if="!props.embedded && flow.sourceCtx"
      :key="flow.sourceCtx.sourceId"
      :source-id="flow.sourceCtx.sourceId"
      @status="onWorkflowStatus"
    />

    <!-- 画布主体单独做定位容器（0928）：节点库按钮原来相对整块 .rc-canvas 用写死的 top:108px
         躲开头部，头部一多出分支提示条就压到提示文字上；改成相对画布区域定位，头部多高都不影响。 -->
    <div v-if="!props.embedded && flow.sourceCtx && workflowStatus !== 'ready'" class="rc-workflow-empty" data-testid="workflow-canvas-status">
      {{ workflowStatus === 'empty' ? '当前源暂无关联流程，请先关联流程；来源组的流程请到来源组配置。' : workflowStatus === 'error' ? '流程列表加载失败，请刷新后重试。' : '正在加载流程…' }}
    </div>
    <template v-else>
    <div v-if="isLeoPublishedView" class="rc-version-readonly" data-testid="published-version-readonly">
      已发布 v{{ flow.sourceCtx?.workflowVersionNo ?? '—' }} 为只读版本；点击上方“编辑新版本”后再修改节点。
    </div>
    <div class="rc-canvas-body" :class="{ 'is-version-readonly': isPublishedView }">
    <button
      v-if="!isPublishedView"
      class="rc-node-library-toggle"
      type="button"
      :title="nodePalette.show ? '收起节点库' : '打开节点库'"
      :aria-label="nodePalette.show ? '收起节点库' : '打开节点库'"
      data-testid="node-library-toggle"
      :class="{ active: nodePalette.show }"
      @click.stop="nodePalette.show ? closeNodePalette() : openNodePalette()"
    >＋</button>

    <div ref="canvasScrollEl" class="rc-canvas-scroll" @dragover="onDragOver" @drop="onDrop">
      <div ref="flowEl" class="rc-flow" :style="{ height: flow.layout.totalHeight + 'px', width: flow.layout.width + 'px' }">
        <svg :width="flow.layout.width" :height="flow.layout.totalHeight" :viewBox="`0 0 ${flow.layout.width} ${flow.layout.totalHeight}`" aria-hidden="true">
          <!-- 0925 视觉修复：连线补方向箭头（原来一条箭头都没有，分叉/汇聚看不出流向）。三种线色各配一个
               marker：主链/旁路灰、fan-out 分叉琥珀、规则边蓝；markerUnits=userSpaceOnUse 保证缩放/线宽变化
               时箭头大小稳定。箭头端点即目标节点顶边（refY 居中、refX 收在尖端）。 -->
          <defs>
            <marker :id="markerPrefix" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0 0.6L7.4 4L0 7.4L1.8 4Z" fill="#94a3b8" />
            </marker>
            <marker :id="`${markerPrefix}-fan`" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0 0.6L7.4 4L0 7.4L1.8 4Z" fill="#f59e0b" />
            </marker>
            <marker :id="`${markerPrefix}-rule`" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0 0.6L7.4 4L0 7.4L1.8 4Z" fill="#60a5fa" />
            </marker>
          </defs>
          <path v-for="(e, i) in flow.layout.mainEdges" :key="'m' + i" class="rc-edge" :class="{ rule: e.rule }" :d="e.d" :marker-end="e.rule ? `url(#${markerPrefix}-rule)` : `url(#${markerPrefix})`" />
          <path v-for="(e, i) in flow.layout.branchEdges" :key="'b' + i" class="rc-edge" :d="e.d" :marker-end="`url(#${markerPrefix})`" />
          <!-- 0707 优化·Phase6：分叉点的 fan-out 分支连线（0925 改实线：虚线+无箭头是"看不出流向"的主因） -->
          <path v-for="(e, i) in flow.layout.fanOutEdges" :key="'f' + i" class="rc-edge fan-out" :d="e.d" :marker-end="`url(#${markerPrefix}-fan)`" />
        </svg>

        <!-- 空白源画布引导卡 -->
        <div v-if="!flow.layout.nodes.length" class="rc-empty-cta">
          <div class="rc-empty-cta-title">空白编排画布</div>
          <div class="rc-empty-cta-sub">可以用「＋」手工添加步骤，或按当前对象智能生成一套初始流程；生成后再逐节点调整。</div>
          <div class="rc-empty-cta-btns">
            <button class="rc-btn primary" type="button" :disabled="recommending" @click="recommendTemplateFlow">{{ recommending ? '推荐中…' : '智能推荐流程' }}</button>
          </div>
        </div>

        <!-- 终端 -->
        <div
          v-for="t in flow.layout.terminals"
          :key="t.id"
          class="rc-term"
          :style="{ left: t.pos.left + 'px', top: t.pos.top + 'px' }"
        >{{ t.label }}</div>

        <!-- 插入点 -->
        <button
          v-for="(s, i) in isPublishedView ? [] : flow.layout.slots"
          :key="'s' + i"
          class="rc-drop-slot"
          type="button"
          :style="{ top: s.top + 'px', left: (flow.layout.axisX - 20) + 'px' }"
          aria-label="插入节点"
          @click.stop="openAddPopover($event.clientX, $event.clientY, s.afterId)"
          @dragover="onDragOver"
          @drop="onSlotDrop($event, s.afterId)"
        >＋</button>

        <!-- 连线血缘标注（0707 撤掉连线独立配置后，连线纯视觉连接，仅保留只读的表血缘标注；条件标签退役，见上方注释） -->
        <template v-for="(e, i) in flow.layout.mainEdges" :key="'l' + i">
        <div
          v-if="edgeTableTag(e.fromId, e.toId)"
          class="rc-edge-table-tag"
          :style="{ left: e.lx + 'px', top: e.ly + 'px' }"
        >{{ edgeTableTag(e.fromId, e.toId) }}</div>
        </template>

        <!-- 0707 优化·Phase6：分叉点的 fan-out 分支列标签（0926 起只展示该分支/首步骤的进入条件，无底色无边框） -->
        <template v-for="(col, ownerId) in flow.layout.fanOutColMeta" :key="'col-' + ownerId">
          <template v-for="br in col.branches" :key="'coltag-' + br.id">
            <div
              v-if="branchColText(br)"
              class="rc-fanout-col-tag"
              :title="branchColText(br)"
              :style="{ left: br.colX + 'px', top: (br.labelTop ?? (br.top - 16)) + 'px' }"
            >{{ branchColText(br) }}</div>
            <!-- 0707 优化·Phase6·补：分支内添加节点入口——挂到 chain 末尾。链中间的插入见下方 edgeSlots（1008-BR-04）；
                 链尾节点是嵌套分叉点时不显示（它下面的分支各有自己的「+」） -->
            <button
              v-if="!isPublishedView && !(br.chain.length && isForkOwner(br.chain[br.chain.length - 1]))"
              class="rc-branch-add-slot"
              type="button"
              :style="{ left: (br.colX - 12) + 'px', top: (br.top + br.height + 6) + 'px' }"
              :title="`在「${br.label}」分支内添加节点`"
              @click.stop="openBranchAddPopover($event.clientX, $event.clientY, String(ownerId), br.id)"
            >＋</button>
          </template>
        </template>

        <!-- 分支区域线上「+」（1008-BR-04）：分叉前 / 分支链头上方 / 链内两节点之间 -->
        <template v-if="!isPublishedView">
          <button
            v-for="s in flow.layout.edgeSlots"
            :key="s.key"
            class="rc-edge-slot"
            type="button"
            :data-testid="`edge-slot-${s.key}`"
            :style="{ left: s.cx + 'px', top: s.top + 'px' }"
            :title="s.key.startsWith('trunk:') ? '在分叉之前插入节点（新节点接管全部分支）' : '在这条线上插入节点'"
            aria-label="插入节点"
            @click.stop="openEdgeAddPopover($event.clientX, $event.clientY, s)"
          >＋</button>
        </template>

        <!-- 节点左右「+」（1008-BR-04）：新建分支。离卡片 16px，落在分支列间 32px 的空隙里 -->
        <template v-for="n in flow.layout.nodes" :key="'side-' + n.id">
          <template v-if="sideAddVisible(n.id)">
            <button
              v-for="side in ['left', 'right'] as const"
              :key="side"
              class="rc-side-add"
              :class="{ blocked: !!siblingBlockedReason(n.id) }"
              type="button"
              :data-testid="`side-add-${side}-${n.id}`"
              :style="{ left: (side === 'left' ? n.pos.left - 16 : n.pos.left + 210 + 16) + 'px', top: (n.pos.top + n.pos.height / 2) + 'px' }"
              :title="siblingBlockedReason(n.id) || '新建分支：加一个与它并列的节点（同一个上级），排在最右'"
              aria-label="新建分支"
              @mouseenter="onNodeHover(n.id)"
              @mouseleave="onNodeLeave"
              @click.stop="openSiblingAddPopover($event.clientX, $event.clientY, n.id)"
            >＋</button>
          </template>
        </template>

        <!-- 节点 -->
        <div
          v-for="n in flow.layout.nodes"
          :key="n.id"
          class="rc-flow-node"
          :class="nodeClasses(n.id, n.cfg)"
          :style="{ left: n.pos.left + 'px', top: n.pos.top + 'px' }"
          :draggable="!isPublishedView"
          @dragstart.stop="onNodeDragStart($event, n.id)"
          @click.stop="onNodeClick(n.id)"
          @contextmenu="onNodeMenu($event, n.id)"
          @mouseenter="onNodeHover(n.id)"
          @mouseleave="onNodeLeave"
        >
          <!-- 删除按钮（0828 D05）：会上明确「那个节点上面要搞个叉」——删节点不该非得回右侧面板或右键菜单。
               hover 才显形，避免每个节点常驻一个叉；右键菜单里的「删除节点」保留，同一个 store 动作。 -->
          <button
            v-if="!isPublishedView"
            class="rc-node-del"
            type="button"
            title="删除节点"
            data-testid="node-delete"
            @click.stop="void deleteCanvasNode(n.id)"
          >✕</button>
          <!-- 0930 顶栏（用户选定方案 A）：左边类型名，右边状态标签 + 步骤 ID。
               0904 I12（Z6-1）要求把类型写出来；左侧 `90`/`R` 类型编号徽标 0930 去掉（「没什么用」）。
               步骤 ID = cs_item_config 行 ID（旧平台节点图的 #41800），只有已落库的节点才有，
               草稿节点是本地临时 ID，不显示。状态标签原来绝对定位在右上角，与 ID 抢位置，并进来排在 ID 前。 -->
          <div class="rc-node-meta">
            <div class="rc-node-type" data-testid="node-type-label">{{ nodeTypeLabel(n.cfg) }}</div>
            <div class="rc-node-meta-end">
              <span v-if="runtime.nodeStates[n.id]" class="rc-run-badge" :class="runtime.nodeStates[n.id]">{{ runText(n.id) }}</span>
              <button
                v-if="n.orphan && !isPublishedView"
                class="rc-node-orphan"
                type="button"
                title="孤儿步骤：没有可解析的前置步骤（lastStep 缺失或指向集合外）。点击选择它要挂到的节点。"
                data-testid="node-orphan-relink"
                @click.stop="openRelinkDialog(n.id)"
              >孤儿·关联</button>
              <span v-else-if="n.cfg.disabled" class="rc-node-plan">已停止</span>
              <span v-else-if="n.cfg.planned" class="rc-node-plan">规划中</span>
              <button
                v-if="isWritableStepId(n.id)"
                class="rc-node-stepid"
                type="button"
                :title="`步骤 ID ${n.id}，点击复制`"
                data-testid="node-step-id"
                @click.stop="void copyToClipboard(n.id, '步骤 ID')"
              >#{{ n.id }}</button>
            </div>
          </div>
          <div class="rc-node-title">{{ n.cfg.title }}</div>

          <!-- 0926 反馈→拍板：卡片只标「条件」tag（提示该节点有条件进入），不再展示 cond 具体文案——
               具体内容在连线/分支列标签上展示；条件与「运行」状态同行；悬停仍可看全文 -->
          <div v-if="tableChip(n.cfg, n.id)" class="rc-node-table" :class="{ unset: tableChip(n.cfg, n.id)!.unset }" :title="tableChip(n.cfg, n.id)!.title">⊞ {{ tableChip(n.cfg, n.id)!.label }}</div>
          <div class="rc-node-foot">
            <span v-if="nodeCondText(n.cfg)" :data-testid="`node-cond-${n.id}`" class="rc-node-cond" :title="nodeCondText(n.cfg)">条件</span>
            <span v-if="extraParentsTitle(n.id)" :data-testid="`node-extra-parents-${n.id}`" class="rc-node-cond" :title="extraParentsTitle(n.id)">另有上级</span>
            <span class="rc-chip" :class="footClass(n.cfg)" :title="footFor(n.cfg).hint">{{ footFor(n.cfg).left }}</span>
            <span>{{ footFor(n.cfg).right }}</span>
          </div>
        </div>
      </div>
    </div>
    </div>

    <button class="rc-btn rc-flow-xml" type="button" @click.stop="xmlOpen = true">XML</button>
    <FlowXmlDialog v-model:open="xmlOpen" :xml="xml" :flow-id="flow.flowId" :can-export="canExportXml" />

    <!-- 右键菜单 -->
    <div v-if="menu.show" class="rc-node-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
      <template v-if="menu.nodeId">
        <button type="button" @click="menuAction('insert-node')">添加节点</button>
        <div class="sep" />
        <button type="button" @click="menuAction('copy')">复制节点</button>
        <button type="button" @click="menuAction('move-up')">上移</button>
        <button type="button" @click="menuAction('move-down')">下移</button>
        <button type="button" @click="menuAction('toggle')">运行 / 停止</button>
        <button type="button" :disabled="runtime.running" @click="menuAction('run-node')">运行此节点</button>
        <div class="sep" />
        <button class="danger" type="button" @click="menuAction('delete')">删除节点</button>
      </template>
      <template v-else>
        <button type="button" @click="menuAction('insert-node')">添加节点</button>
      </template>
    </div>

    <!-- 添加节点浮层（0707 优化·Phase1，参照 Dify：锚定弹层 + 搜索 + 分组，点选即插） -->
    <AddNodePopover
      v-if="addPop.show"
      :x="addPop.x"
      :y="addPop.y"
      @pick="onPickNode"
      @close="closeAddPopover"
    />
    <AddNodePopover
      v-if="nodePalette.show"
      :x="nodePalette.x"
      :y="nodePalette.y"
      compact
      @pick="pickNodeFromPalette"
      @dragstart="onPaletteDragStart"
      @close="closeNodePalette"
    />

    <!-- 孤儿步骤关联弹窗（0925）：操作型短流程，居中 dialog；目标 = 画布上可写步骤 + 流程入口
         （'0' 虚拟入口 / isRoot 真实入口行），排除该孤儿子树里的节点（避免成环） -->
    <el-dialog
      v-model="relink.show"
      title="关联孤儿步骤"
      width="480px"
      top="22vh"
      append-to-body
      data-testid="orphan-relink-dialog"
    >
      <p class="relink-tip">「{{ relink.nodeTitle }}」（#{{ relink.nodeId }}）没有可解析的前置步骤（lastStep 缺失或指向集合外）。选择它要挂到哪个节点后面（列表第一项「流程入口」= 挂回流程起点）：</p>
      <el-select
        v-model="relink.targetId"
        placeholder="选择目标节点"
        style="width: 100%"
        data-testid="orphan-relink-target"
      >
        <el-option
          v-for="opt in relinkTargets"
          :key="opt.id"
          :label="`${opt.title}（#${opt.id}）`"
          :value="opt.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="relink.show = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!relink.targetId || relinking"
          data-testid="orphan-relink-confirm"
          @click="doRelink"
        >关联</el-button>
      </template>
    </el-dialog>
    </template>
  </main>
</template>

<style scoped>
.rc-version-readonly { padding: 6px 12px; border-bottom: 1px solid #bfdbfe; background: #eff6ff; color: #1e40af; font-size: 11px; }
/* 只读（发布版 / 锁定草稿）：不再整块 pointer-events: none——那会连滚动条、滚轮、点节点查看都禁掉
   （2026-10-10 用户反馈「发布状态下拉框都无法拖动」）。改动入口（+ / 删除 / 拖拽 / 右键 / 节点库）在模板里逐个关掉 */
.rc-canvas-body.is-version-readonly { background: #f8fafc; }
.rc-canvas-body.is-version-readonly :deep(.rc-flow-node) { opacity: .9; }
.rc-canvas { position: relative; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.rc-canvas-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.rc-canvas-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-canvas-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.rc-canvas-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.rc-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }

.rc-canvas-scroll { flex: 1; overflow: auto; background-color: #f7f9fc; background-image: radial-gradient(#dfe7f2 0.8px, transparent 0.8px); background-size: 22px 22px; }
.rc-flow-xml { position: absolute; z-index: 30; right: 32px; bottom: 32px; height: 28px; padding: 0 10px; border-color: var(--rc-border); background: rgba(255, 255, 255, .9); color: var(--rc-text-2); font-size: 11px; }
.rc-flow-xml:hover { border-color: #bfdbfe; background: #fff; color: var(--rc-primary-ink); }
.rc-workflow-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; color: var(--rc-muted); font-size: 13px; text-align: center; }
.rc-canvas-body { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.rc-node-library-toggle { position: absolute; z-index: 31; top: 12px; left: 12px; width: 30px; height: 30px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; color: var(--rc-primary); font-size: 21px; font-weight: 400; line-height: 1; cursor: pointer; transition: border-color .12s, background .12s, color .12s; }
.rc-node-library-toggle:hover, .rc-node-library-toggle.active { border-color: #93c5fd; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.rc-flow { position: relative; margin: 56px auto 28px; }
.rc-flow svg { position: absolute; inset: 0; pointer-events: none; }
.rc-edge { fill: none; stroke: #94a3b8; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.rc-edge.rule { stroke: #60a5fa; stroke-dasharray: 5 4; }
.rc-edge.fan-out { stroke: #f59e0b; stroke-width: 1.5; }
/* 分支列标签（0926 视觉调整）：无底色无边框的纯文本，只展示该分支/首步骤的进入条件 */
.rc-fanout-col-tag { position: absolute; transform: translateX(-50%); max-width: 200px; box-sizing: border-box; text-align: center; font-size: 10px; font-weight: 500; color: #475569; pointer-events: none; z-index: 22; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-branch-add-slot { position: absolute; z-index: 20; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border: 1px dashed #fbbf24; background: #fffbeb; color: #b45309; border-radius: 999px; font-size: 15px; line-height: 1; opacity: 0.75; cursor: pointer; transition: opacity 0.12s, transform 0.12s; }
.rc-branch-add-slot:hover { opacity: 1; transform: scale(1.08); background: #fef3c7; }
/* 1008-BR-04：分支区域线上「+」与节点左右「+」——小圆钮，中心对准 (left, top) */
.rc-edge-slot, .rc-side-add { position: absolute; z-index: 24; width: 20px; height: 20px; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; padding: 0; border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary); border-radius: 999px; font-size: 13px; line-height: 1; opacity: 0.7; cursor: pointer; box-shadow: 0 4px 10px -8px rgba(37, 99, 235, 0.8); transition: opacity 0.12s, transform 0.12s, border-color 0.12s, background 0.12s; }
.rc-edge-slot:hover, .rc-side-add:hover { opacity: 1; border-color: var(--rc-primary); background: var(--rc-primary-bg); transform: translate(-50%, -50%) scale(1.1); }
.rc-side-add { width: 22px; height: 22px; opacity: 0.9; }
.rc-side-add.blocked { color: var(--rc-faint); border-color: var(--rc-border); cursor: not-allowed; }

.rc-term { position: absolute; width: 150px; height: 36px; border: 1px solid var(--rc-border); border-radius: 18px; background: #fff; color: var(--rc-text-2); display: flex; align-items: center; justify-content: center; font-weight: 600; box-shadow: 0 2px 8px -5px rgba(15, 23, 42, 0.2); }

.rc-empty-cta { position: absolute; left: 50%; top: 168px; transform: translateX(-50%); width: 340px; padding: 20px; text-align: center; border: 1px dashed #bfdbfe; border-radius: 12px; background: rgba(255, 255, 255, 0.92); box-shadow: 0 10px 30px -18px rgba(37, 99, 235, 0.5); }

.rc-empty-cta-btns { display: flex; gap: 8px; justify-content: center; }
.rc-empty-cta-title { font-size: 14px; font-weight: 800; color: var(--rc-text); }
.rc-empty-cta-sub { margin: 7px 0 14px; font-size: 11px; line-height: 1.6; color: var(--rc-muted); }
.rc-empty-cta .rc-btn { height: 34px; padding: 0 14px; font-size: 13px; }

.rc-drop-slot { position: absolute; left: 300px; z-index: 20; width: 40px; height: 22px; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; border: 1px solid #bfdbfe; background: #fff; color: var(--rc-primary); border-radius: 999px; font-size: 17px; line-height: 1; opacity: 0.62; cursor: pointer; box-shadow: 0 4px 12px -9px rgba(37, 99, 235, 0.8); transition: opacity 0.12s, transform 0.12s, border-color 0.12s, background 0.12s; }
.rc-drop-slot::before, .rc-drop-slot::after { content: ''; position: absolute; top: 50%; width: 86px; height: 1px; background: #bfdbfe; pointer-events: none; }
.rc-drop-slot::before { right: 42px; }
.rc-drop-slot::after { left: 42px; }
.rc-drop-slot:hover { opacity: 1; border-color: var(--rc-primary); background: var(--rc-primary-bg); transform: translateY(-50%) scale(1.08); }

.rc-edge-table-tag { position: absolute; transform: translate(-50%, 0); font-size: 9px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; pointer-events: none; z-index: 21; }

/* 0925 美化：卡片高度**必须等于布局常量**（NODE_H=108 / TERM_H=36）——此前只有
   min-height:74px，卡片实际比布局矮，连线端点落在卡片下方一段空白处，整棵树看着"散"。
   现在固定高度 + flex 竖向排布（脚注沉底）+ 溢出裁剪，连线和卡片严丝合缝。 */
.rc-flow-node { position: absolute; display: flex; flex-direction: column; box-sizing: border-box; width: 210px; height: 108px; padding: 10px 12px; border: 1px solid var(--rc-border); border-radius: 10px; background: #fff; box-shadow: 0 4px 14px -10px rgba(15, 23, 42, 0.35); overflow: hidden; cursor: pointer; transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s; }
.rc-node-del { position: absolute; top: 4px; right: 4px; z-index: 3; width: 18px; height: 18px; line-height: 1; border: 0; border-radius: 4px; background: transparent; color: var(--rc-faint); font-size: 11px; cursor: pointer; opacity: 0; transition: opacity .12s; }
.rc-flow-node:hover .rc-node-del { opacity: 1; }
.rc-node-del:hover { background: var(--rc-error-bg, #fef2f2); color: #b91c1c; }
/* 孤儿步骤标记（0925）：lastStep 解析不出前置的节点，右上角常驻警示徽标，点击走关联弹窗。
   top 让开 8px 处的运行态/停用徽标，删除叉 hover 显示时与之左右错开 */
.rc-node-orphan { flex: none; height: 16px; line-height: 1; padding: 0 6px; border: 1px solid #fca5a5; border-radius: 9px; background: #fef2f2; color: #b91c1c; font-size: 10px; font-weight: 600; cursor: pointer; transition: background .12s, border-color .12s; }
.rc-node-orphan:hover { background: #fee2e2; border-color: #f87171; }
.relink-tip { margin: 0 0 12px; font-size: 12px; line-height: 1.7; color: var(--rc-text-2); }
.rc-flow-node:hover { transform: translateY(-1px); border-color: #bfdbfe; }
.rc-flow-node.active { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe, 0 10px 22px -12px rgba(37, 99, 235, 0.5); }
.rc-flow-node.rule-node { border-color: #bfdbfe; background: #fbfdff; }
.rc-flow-node.check-node { border-color: #fed7aa; background: #fffaf0; }
.rc-flow-node.mail-node { border-color: #d9f99d; background: #fcfff7; }
.rc-flow-node.planned { border-style: dashed; opacity: 0.72; }
.rc-flow-node.disabled-node { opacity: 0.48; filter: saturate(0.72); }

.rc-node-title { margin-top: 4px; font-size: 13px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-node-type { margin-top: 1px; font-size: 10px; color: var(--rc-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 顶栏：类型名左，状态标签 + 步骤 ID 右。悬停时右侧整组左移，给删除 ✕（绝对定位右上角）让位 */
.rc-node-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 18px; }
.rc-node-meta .rc-node-type { margin-top: 0; min-width: 0; }
.rc-node-meta-end { display: flex; align-items: center; gap: 4px; flex: none; transition: padding-right .12s; }
.rc-flow-node:hover .rc-node-meta-end { padding-right: 14px; }
.rc-node-stepid { flex: none; padding: 1px 6px; border: 0; border-radius: 5px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font: 600 10px/14px ui-monospace, SFMono-Regular, Menlo, monospace; cursor: pointer; }
.rc-node-stepid:hover { color: var(--rc-primary); }
.rc-node-plan { flex: none; font-size: 9px; color: var(--rc-faint); border: 1px solid var(--rc-border); background: #f8fafc; border-radius: 5px; padding: 1px 5px; }
.rc-run-badge { flex: none; font-size: 9px; font-weight: 700; border-radius: 5px; padding: 1px 6px; }
.rc-run-badge.L { background: var(--rc-primary-bg); color: var(--rc-primary); }
.rc-run-badge.C { background: var(--rc-ok-bg); color: var(--rc-ok); }
.rc-run-badge.E { background: var(--rc-error-bg); color: var(--rc-error); }
.rc-flow-node.run-L { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe; }
.rc-flow-node.run-C { border-color: #86efac; }
.rc-flow-node.run-E { border-color: #fca5a5; }
/* foot：条件 tag + 运行状态 chip + 右侧说明同行；说明文字长时压缩省略，不换行撑破卡片 */
.rc-node-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: auto; padding-top: 6px; color: var(--rc-muted); font-size: 10px; min-width: 0; }
.rc-node-foot > span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-node-table.unset { color: var(--rc-warn, #d98b25); }
.rc-node-table { margin-top: 6px; font-size: 10px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 0926 反馈→拍板：卡片上的「条件」tag（琥珀色小胶囊，与分支列条件标签同色系），
   与「运行」状态 chip 同处 foot 行，有进入条件即显示 */
.rc-node-cond { display: inline-block; padding: 1px 6px; border-radius: 5px; background: #fef3c7; color: #b45309; font-size: 10px; line-height: 16px; white-space: nowrap; flex: none; }
.rc-chip { padding: 1px 6px; border-radius: 5px; background: #f1f5f9; color: var(--rc-muted); }
.rc-chip.ok { background: var(--rc-ok-bg); color: var(--rc-ok); }
.rc-chip.warn { background: var(--rc-warn-bg); color: var(--rc-warn); }

.rc-node-menu { position: fixed; z-index: 80; min-width: 174px; background: #fff; border: 1px solid var(--rc-border); border-radius: 8px; box-shadow: 0 16px 34px -16px rgba(15, 23, 42, 0.36); padding: 4px; }
.rc-node-menu button { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent; color: #334155; padding: 7px 10px; border-radius: 5px; font-size: 12px; cursor: pointer; text-align: left; }
.rc-node-menu button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-node-menu button.danger:hover { background: var(--rc-error-bg); color: #b91c1c; }
.rc-node-menu .sep { height: 1px; background: var(--rc-border-soft); margin: 4px 0; }
</style>
