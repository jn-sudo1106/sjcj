// stores/flow.ts - 流程核心状态（P2-1 · stores/flow.ts 拆分）
// 职责：configs/main/branches/branchGroups + 节点 CRUD + 分支操作 + 布局计算 + serialize/load
// 组合 source.ts 和 node.ts 保持 API 不变
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { applyConfigToNode } from '@/utils/flow/nodeConfigPayload'
import { applyStepSourceDefault, hasRealBranches } from '@/utils/flow/stepPersist'
import { inheritInputTable, nodeTablesSnapshot, tableForDownstream, propagateOutputChange, retargetFollowers, writeNodeOutputTable, type TableTopology } from '@/utils/flow/tableSync'
import {
  NODE_CONFIGS,
  TEMPLATE_TO_NODE,
  TEMPLATE_TO_NAME,
  TEMPLATE_TO_SNATCH,
  DEFAULT_TASK_QUEUES,
  cloneConfig,
  isDataNode,
  isRuleNode,
  isMonitorNode,
  isDataValidationNode,
  nodeOutputTable,
  nodeInputTable,
  effectiveInputTable,
  directSuccessorIdsIncludingDisabled,
  isFirstMainNode,
  makeBlankFlow,
  makeStandardFlow,
  buildHorizontalLayout,
  elbowVH,
  applyParamSourceUrlToFirstCollectNode,
  normalizeNodeConfigs,
  collectorCapabilityOf,
  allBranchChainNodes,
  branchGroupOf,
  branchOfNode,
  TERMINALS,
  type NodeConfig,
  type CollectConfig,
  type ConditionGroup,
  type TaskConfig,
  type TripleField,
  type BranchSeed,
  type FlowBranch,
  type FlowBranchGroup,
  type FlowDef,
  type RuleOrchestration,
  applyStepDetails as applyStepDetailsToConfigs,
} from '@/views/FlowCanvas/canvas/flowModel'
import { extractUrlParamIds, hasFragmentParams } from '@/utils/flow/urlParams'
import {
  composeTemplateFlow,
  extractTemplateNodeBindings,
} from '@/utils/flow/flowTemplates'
import type { FlowRecord, Source, Site, SourceJob, Step } from '../api'
import { useSourceStore } from './source'
import { topologyFromParents } from '@/views/FlowCanvas/canvas/flowTopology'
import { useNodeStore } from './node'
import { useRuntimeStore } from './runtime'

// 画布布局常量（对齐原型：节点宽 210、终端宽 150）
// 0925：主链 x 不再是常量 320——画布宽度随最宽分支组自适应（≥640），主链居中于 width/2；
// 单列分支的流程宽度仍是 640、主链仍是 320（原型基线不变）。
const NODE_W = 210
const TERM_W = 150
const TERM_H = 36
const NODE_H = 108
const GAP = 36
// 分叉带高度（0925 排版）：owner 底边到分支列首行顶边的距离。原来是 GAP(30)，
// 母线只能挤在 15px 处、贴着父节点，看起来"糊在一起"；加宽后短竖线 + 母线 + 短竖线层次分明。
const FORK_GAP = 64
// 汇合母线相对汇合点顶边的距离（0925 排版）：所有分支共用同一条母线，横向段不再各走各的、
// 在不同高度反复穿越别的列。
const CONVERGE_BUS = 26
const SIDE_OFFSET = 215 // 旁路节点相对主链左移/右移量 → 左列 x=0，右列 x=430

export interface PlacedPos { top: number; left: number; height: number }
export interface PlacedNode { id: string; cfg: NodeConfig; pos: PlacedPos; branch: boolean; side?: 'left' | 'right'; orphan?: boolean }
export interface PlacedTerm { id: string; label: string; pos: PlacedPos }
export interface DropSlot { afterId: string; top: number }
/**
 * 分支区域的线上「+」（1008-BR-04）：在 parentId → childIds 这段线上插入新节点（insertOnEdge）。
 * 三种：分叉点正下方（childIds = 全部分支链头，即在分叉之前插入）、分支链头上方（只接管这一支）、
 * 分支链内两节点之间。主链上的插入仍走 slots（afterId）。cx = 按钮中心横坐标，top = 中心纵坐标。
 */
export interface EdgeSlot { key: string; cx: number; top: number; parentId: string; childIds: string[] }
/** 分叉点的 fan-out 分支连线（0707 优化·Phase6）：owner 底边 → 每列首节点 + 列内节点连线。
 *  branchLabel 仅首段（owner → 列首节点）携带。条件属于列首节点自己，画布从节点读（branchColText）。 */
export interface FanOutEdge { d: string; branchLabel?: string }
/** fan-out 列 meta：用于 FlowBoard 渲染列头/列脚标签 */
export interface FanOutColMeta {
  ownerId: string
  branches: {
    id: string
    label: string
    colX: number
    top: number
    height: number
    chain: string[]
    /** 列标签的 y（0925 排版）：放在分叉母线之上、owner 底边下方，不再压住连线与节点 */
    labelTop?: number
  }[]
}
export interface MainEdge { fromId: string; toId: string; d: string; rule: boolean; lx: number; ly: number }
export interface BranchEdge { d: string }

/**
 * 从节点配置副本中摘除登录口令（流程定义**落库 / 导出**时不得带明文口令，F3，0929）：
 * 摘 `collectCfg.password`（普通采集登录密码）与各 `loginConfigs[].loginPwd`（登录节点密码）。
 *
 * 来源上下文：`serialize()`（源画布/模板导出）一直走这个口径；**流程工作区保存（definitionFromCanvas）
 * 曾绕过它直接把含密码的配置写进 cs_flow.flow_conf**——三个出口三种做法（REVIEW F3）。
 * 0929 起两个出口共用本函数；mutate 传入的副本（调用方先深拷贝，见两处调用）。
 */
export function stripLoginSecrets(configs: Record<string, NodeConfig>): void {
  Object.values(configs).forEach((c) => {
    if (!c.collectCfg) return
    Reflect.deleteProperty(c.collectCfg, 'password')
    c.collectCfg.loginConfigs?.forEach((config) => Reflect.deleteProperty(config, 'loginPwd'))
  })
}

export const useFlowStore = defineStore('flow', () => {
  // 组合子 store
  const sourceStore = useSourceStore()
  const nodeStore = useNodeStore()

  // 代理 source store 的状态（保持 API 不变）
  const flowId = computed({
    get: () => sourceStore.flowId,
    set: (v) => { sourceStore.flowId = v },
  })
  const flowName = computed({
    get: () => sourceStore.flowName,
    set: (v) => { sourceStore.flowName = v },
  })
  const sourceCtx = computed({
    get: () => sourceStore.sourceCtx,
    set: (v) => { sourceStore.sourceCtx = v },
  })
  const sourceCfg = computed({
    get: () => sourceStore.sourceCfg,
    set: (v) => { sourceStore.sourceCfg = v },
  })
  const siteCtx = computed({
    get: () => sourceStore.siteCtx,
    set: (v) => { sourceStore.siteCtx = v },
  })

  /**
   * 流程工作区形态（0926）：画布当前是不是「cs_flow 流程定义」的编辑现场（FlowDetailDrawer
   * 的 loadIntoWorkspace / deriveFromFlowConfig、模板应用后的 reloadFlowIntoCanvas）。
   *
   * 为什么要显式标志而不是靠 `!sourceCtx && flowId 是数字` 推断：网站详情页同样满足
   * "sourceCtx 为空 + flowId 是数字"（内部代表源不登记为编排对象），但那里是**源视角**，
   * 写步骤必须锚定源 / mainConfig，把流程 ID 当锚点会写坏数据。只有流程工作区把
   * `flow.flowId` 当作真实流程 ID（cs_flow.id），步骤写与自动保存的锚点随之切换为 flowId。
   *
   * 置位点（唯一三处）：FlowDetailDrawer 两条加载路径 + applyTemplateToSource.reloadFlowIntoCanvas；
   * 源视角入口（loadFromSource / newFlow / startSiteFlow / startDraftSource）统一复位。
   */
  const flowIdMode = ref(false)
  function setFlowIdMode(v: boolean) {
    flowIdMode.value = v
  }

  // 代理 node store 的状态（保持 API 不变）
  const selectedId = computed({
    get: () => nodeStore.selectedId,
    set: (v) => { nodeStore.selectedId = v },
  })
  const activeTab = computed({
    get: () => nodeStore.activeTab,
    set: (v) => { nodeStore.activeTab = v },
  })
  const dirty = computed({
    get: () => nodeStore.dirty,
    set: (v) => { nodeStore.dirty = v },
  })
  // 双层脏状态（0824-00 §5.4）：configDirty 归「保存节点配置」，flowDirty 归步骤自动保存
  const configDirty = computed(() => nodeStore.configDirty)
  const flowDirty = computed(() => nodeStore.flowDirty)
  const flowRev = computed(() => nodeStore.flowRev)
  const dirtyConfigNodes = computed(() => nodeStore.dirtyConfigNodes)

  // ---- 流程核心状态 ----
  const configs = reactive<Record<string, NodeConfig>>({})
  // 默认空白画布（M5.5）：首次进入为干净的 开始 → 完成；标准链路 / 预置意图经「＋ 新建流程」载入
  const main = ref<string[]>(['start', 'end'])
  const branches = reactive<BranchSeed[]>([])
  // 分叉点以下的分支（由各节点上级推导，见 flowTopology.ts）：与 BranchSeed 旁路挂靠并存，不互相替代。
  const branchGroups = reactive<FlowBranchGroup[]>([])
  // 孤儿步骤 id（0925）：随 load(def.orphanIds) 载入，仅用于画布标记与「关联到节点」修复，
  // 不参与序列化/保存；重新加载流程时按响应重新推导。
  const orphanIds = ref<string[]>([])
  // 显式插入后要改挂到新节点下的下游节点 id（1008-BR-05）。有分支的流程自动保存不重算 lastStep
  // （YB-A 冻结，防畸形拓扑被画布改坏），只有这里登记的节点按画布写；新上级落库前先挂着，
  // 写成功后由 useStepWrite 清掉。不参与序列化，换流程 / 重新加载时清空。
  const pendingRelinks = ref<string[]>([])
  let seq = 1

  // S6-3（方案 §4.4）：删节点待清理资源清单——本期只收集不真删，见 remove() 里的调用点。
  // scriptPath 对应脚本/配置文件（MinIO），configId 对应当前节点绑定的配置。
  interface NodeCleanupResource {
    nodeId: string
    nodeTitle: string
    scriptPath?: string
    configId?: string
  }
  const pendingCleanup = ref<NodeCleanupResource[]>([])
  function collectCleanupResources(id: string, cfg: NodeConfig | undefined): NodeCleanupResource | null {
    if (!cfg) return null
    const scriptPath = cfg.ruleCfg?.scriptPath || cfg.execCfg?.scriptPath || undefined
    const configId = cfg.configId || undefined
    if (!scriptPath && !configId) return null
    return { nodeId: id, nodeTitle: cfg.title, scriptPath, configId }
  }

  // 绑定 flow store 到 node store（供节点编辑函数访问 configs/main）
  nodeStore.bindFlowStore(configs, () => main.value, (id) => effectiveInputTableFor(id))

  // ---- 工具 ----
  function isTerm(id: string) {
    return id === 'start' || id === 'end'
  }
  function nodeHeight(id: string) {
    return isTerm(id) ? TERM_H : NODE_H
  }

  // ---- 布局（统一计算，供画布渲染） ----
  // 0925 视觉修复：原实现有两处硬缺陷——
  //  ① 分支列宽度不参与父级槽位计算：嵌套分叉的列围绕链节点中心对称展开，既会顶出画布
  //     （实测嵌套列 left=-11、右缘 >640，节点被裁切），又会和同层兄弟列在同一 y 带重叠
  //     （嵌套列 215..425 与兄弟列 328..538 叠了 97px）。
  //  ② fan-in 汇聚线拿「链尾节点」当列尾：链尾自己还有嵌套分叉时，线从嵌套 owner 底边直拉
  //     下去，穿过自己的子列节点。
  // 现改为「先测量、再按槽位摆放」：列槽宽 = max(节点宽, 列内嵌套组测宽)，同组各列依次排开
  // 互不重叠；画布宽度按最大组宽自适应（≥640，主链居中，新增 layout.width）；列尾取该列子树
  // 最深节点，汇聚线从它出发；嵌套组的收拢目标 = 本列下一个链节点（链尾则跟随父组目标）。
  const layout = computed(() => {
    const mainPos: Record<string, PlacedPos> = {}
    const branchPos: Record<string, PlacedPos> = {}
    // 分叉点的 fan-out 列布局（0707 Phase6 起；0925 完整还原扩展到任意分支组）
    // （还原拓扑的分叉 owner 是普通采集节点）并支持嵌套（subGroups 递归摆放、递归连线）
    const fanOutPos: Record<string, PlacedPos> = {}
    const fanOutColMeta: Record<string, FanOutColMeta> = {}
    const fanOutEdges: FanOutEdge[] = []
    const edgeSlots: EdgeSlot[] = []

    // 分支列横向间隙（0925 排版）：原来 16px，相邻两列卡片几乎贴在一起、同一行里挤成一片；
    // 放宽到 28px 后列与列之间留出可辨的留白（列底纹也才有呼吸空间）。
    const colGap = 32
    const PAD_X = 40
    /** 直角坐标点（列中心 x + y）：列尾 = 节点底边，收拢目标 = 目标节点顶边 */
    interface Pt { cx: number; y: number }
    /** 收拢目标引用：主链下一节点的 top 要等主链摆完才知道，先建引用、最后统一解析并连线 */
    interface ContRef { pt?: Pt | null }

    /** 测量：一个分支列的槽宽（至少一个节点宽，含列内所有嵌套组） */
    const measureBranchW = (b: FlowBranch): number => {
      let w = NODE_W
      for (const nid of b.chain) {
        const sg = branchGroupOf(branchGroups, nid)
        if (sg) w = Math.max(w, measureGroupW(sg))
      }
      return w
    }
    /** 测量：一个分支组的宽（各列槽宽 + 列间隙） */
    const measureGroupW = (g: FlowBranchGroup): number =>
      g.branches.reduce((sum, b) => sum + measureBranchW(b), 0) + Math.max(0, g.branches.length - 1) * colGap
    /** 测量：一个分支列的高（链 + 逐个嵌套组下探；末尾不留 GAP） */
    const measureBranchH = (b: FlowBranch): number => {
      let total = 0
      for (const nid of b.chain) {
        total += nodeHeight(nid) + GAP
        const sg = branchGroupOf(branchGroups, nid)
        // 0927 P1-1：嵌套组按 FORK_GAP + 组高测量（placeGroup 组顶 = ownerBottom + FORK_GAP）——
        // 原来只加 GAP，测量比实际矮 28px：嵌套组后的链节点实际只剩 8px 间隙，每多一层
        // 嵌套再欠 28px，二层直接重叠 20px。
        if (sg) total += FORK_GAP + measureGroupH(sg) + GAP
      }
      return Math.max(0, total - GAP)
    }
    /** 测量：一个分支组的高（各列高的最大值） */
    const measureGroupH = (g: FlowBranchGroup): number =>
      g.branches.reduce((max, b) => Math.max(max, measureBranchH(b)), 0)

    // 画布宽度：主链居中；容纳最宽的分支组（两侧留白），不小于原型 640
    const maxGroupW = main.value.reduce((max, id) => {
      const g = branchGroupOf(branchGroups, id)
      return g ? Math.max(max, measureGroupW(g)) : max
    }, 0)
    const width = Math.max(640, maxGroupW + PAD_X * 2)
    const center = width / 2

    // 待解析的汇聚线（列尾 → 收拢目标）与主链 owner 的目标引用
    const pendingConverges: Array<{ from: Pt; ref: ContRef }> = []
    const ownerContRefs: Array<{ ownerId: string; ref: ContRef }> = []

    /** 摆放一个分支列：链节点 + 列内嵌套组递归；返回本列子树最深点（列尾） */
    const placeChain = (b: FlowBranch, colCx: number, top: number, contRef: ContRef): Pt => {
      let cy = top
      let deepest: Pt = { cx: colCx, y: top }
      let prev: Pt | null = null
      b.chain.forEach((nid, i) => {
        const h = nodeHeight(nid)
        fanOutPos[nid] = { top: cy, left: colCx - NODE_W / 2, height: h }
        if (prev) {
          fanOutEdges.push({ d: `M${prev.cx} ${prev.y} L${colCx} ${cy}` })
          edgeSlots.push({ key: `in:${b.chain[i - 1]}`, cx: colCx, top: (prev.y + cy) / 2, parentId: b.chain[i - 1], childIds: [nid] })
        }
        const bottom = cy + h
        deepest = { cx: colCx, y: bottom }
        prev = { cx: colCx, y: bottom }
        cy = bottom + GAP
        // 链内再分叉（0925 还原拓扑）：嵌套组摆在链节点正下方，按本列中心展开
        const sg = branchGroupOf(branchGroups, nid)
        if (sg) {
          // 0927 P1-1：组顶基准统一为 bottom + FORK_GAP（placeGroup 内 top = ownerBottom +
          // FORK_GAP）——原记录的是 bottom + GAP，与摆放实测差 28px，后续链节点推进跟着错。
          const groupTop = bottom + FORK_GAP
          const groupH = measureGroupH(sg)
          const nestedRef: ContRef = b.chain[i + 1]
            ? { pt: { cx: colCx, y: groupTop + groupH + GAP } }
            : contRef
          const nestedDeepest = placeGroup(sg, colCx, bottom, nestedRef)
          if (nestedDeepest.y > deepest.y) deepest = nestedDeepest
          cy = groupTop + groupH + GAP
        }
      })
      return deepest
    }

    /** 摆放一个分支组（owner 底边 ownerBottom 下方 FORK_GAP 起）；返回子树最深点 */
    const placeGroup = (g: FlowBranchGroup, ownerCx: number, ownerBottom: number, contRef: ContRef): Pt => {
      const widths = g.branches.map(measureBranchW)
      // 分叉之前插入（接管全部分支）：「+」压在分叉点卡片下边沿；分支标签在它下方、母线上方（labelTop）
      edgeSlots.push({
        key: `trunk:${g.ownerId}`, cx: ownerCx, top: ownerBottom,
        parentId: g.ownerId, childIds: g.branches.map((b) => b.chain[0]).filter(Boolean),
      })
      const groupW = widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * colGap
      const top = ownerBottom + FORK_GAP
      let x = ownerCx - groupW / 2
      let groupDeepest: Pt = { cx: ownerCx, y: ownerBottom }
      const cols: FanOutColMeta['branches'] = []
      g.branches.forEach((b, i) => {
        const colCx = x + widths[i] / 2
        x += widths[i] + colGap
        const deepest = placeChain(b, colCx, top, contRef)
        pendingConverges.push({ from: deepest, ref: contRef })
        if (deepest.y > groupDeepest.y) groupDeepest = deepest

        // fan-out 连线：owner 底边 → 列首节点（空列直连列顶）；列内连线由 placeChain 产生
        const headPos = b.chain.length ? fanOutPos[b.chain[0]] : undefined
        // 分支链头上方：只插进这一支（分叉母线在 ownerBottom + FORK_GAP / 2）
        if (headPos) {
          edgeSlots.push({
            key: `head:${g.ownerId}:${b.chain[0]}`, cx: colCx, top: (ownerBottom + FORK_GAP / 2 + headPos.top) / 2,
            parentId: g.ownerId, childIds: [b.chain[0]],
          })
        }
        // 0925：直角折线（转弯在分叉带中间，同组各列共用一条水平母线）
        if (headPos) {
          fanOutEdges.push({
            d: elbowVH(ownerCx, ownerBottom, colCx, headPos.top, 12, ownerBottom + FORK_GAP / 2),
            branchLabel: b.label,
          })
        } else {
          fanOutEdges.push({
            d: elbowVH(ownerCx, ownerBottom, colCx, top, 12, ownerBottom + FORK_GAP / 2),
            branchLabel: b.label,
          })
        }
        cols.push({
          id: b.id,
          label: b.label,
          colX: colCx,
          top,
          height: Math.max(0, deepest.y - top),
          chain: b.chain,
          labelTop: ownerBottom + 14,
        })
        // 列标签的 y：放在分叉母线之上、owner 底边下方（不压住连线 / 节点）。1008-BR-04 起从 +4 下移到 +14，
        // 给压在 owner 下边沿的「分叉前插入」按钮（半径 10）让位；标签高约 15px，仍在母线（+32）之上。
      // 0926：列标签改为只展示进入条件的纯文本，不再配套底纹框（底纹渲染已移除）。
      })
      // 底纹按各列自身深度收边（0925 美化：曾试过同组对齐底边，短列会留一大片空底纹，
      // 反而让人以为"这个分支还有步骤"，故保持贴合内容）。
      fanOutColMeta[g.ownerId] = { ownerId: g.ownerId, branches: cols }
      return groupDeepest
    }

    let y = 0
    main.value.forEach((id) => {
      if (isTerm(id)) {
        mainPos[id] = { top: y, left: center - TERM_W / 2, height: TERM_H }
        y += TERM_H + GAP
        return
      }
      const baseH = nodeHeight(id)
      mainPos[id] = { top: y, left: center - NODE_W / 2, height: baseH }
      const bg = branchGroupOf(branchGroups, id)
      if (bg) {
        // fan-out 区域：owner 节点下方 N 列（含嵌套），占满后 y 继续推进
        const ref: ContRef = {}
        ownerContRefs.push({ ownerId: id, ref })
        y = placeGroup(bg, center, y + baseH, ref).y + GAP
      } else {
        y += baseH + GAP
      }
    })
    const totalHeight = Math.max(560, y)

    // 主链收拢目标：owner 在主链上的下一个节点（摆完主链才知道它的 top）
    ownerContRefs.forEach(({ ownerId, ref }) => {
      const nextId = main.value[main.value.indexOf(ownerId) + 1]
      const pos = nextId ? mainPos[nextId] : undefined
      ref.pt = pos ? { cx: center, y: pos.top } : null
    })
    // 生成汇聚线（列尾 → 收拢目标）。目标不在列尾下方（异常/自环数据）就不画，避免反向线。
    for (const { from, ref } of pendingConverges) {
      const to = ref.pt
      if (!to || to.y <= from.y + 1) continue
      fanOutEdges.push({ d: elbowVH(from.cx, from.y, to.cx, to.y, 12, to.y - CONVERGE_BUS) })
    }

    // 旁路挂靠（BranchSeed）
    branches.forEach((b) => {
      const anchor = mainPos[b.rowAnchor]
      if (!anchor || !configs[b.id]) return
      branchPos[b.id] = {
        top: anchor.top,
        left: center - NODE_W / 2 + (b.side === 'left' ? -SIDE_OFFSET : SIDE_OFFSET),
        height: NODE_H,
      }
    })

    // 节点列表
    const nodes: PlacedNode[] = []
    const terminals: PlacedTerm[] = []
    main.value.forEach((id) => {
      if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
      else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false, orphan: orphanIds.value.includes(id) })
    })
    // fan-out 节点
    for (const fid of Object.keys(fanOutPos)) {
      if (configs[fid]) nodes.push({ id: fid, cfg: configs[fid], pos: fanOutPos[fid], branch: true, orphan: orphanIds.value.includes(fid) })
    }
    // 旁路挂靠
    branches.forEach((b) => {
      if (branchPos[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true, side: b.side })
    })

    // 主链插入点 + 主链连线
    const slots: DropSlot[] = []
    const mainEdges: MainEdge[] = []
    for (let i = 0; i < main.value.length - 1; i++) {
      const a = main.value[i]
      const b = main.value[i + 1]
      if (!mainPos[a] || !mainPos[b]) continue
      const aBottom = mainPos[a].top + mainPos[a].height
      const bTop = mainPos[b].top
      // 1008-BR-04：分叉点下方插入 = 在分叉之前插入、接管全部分支，入口改由 edgeSlots 的 trunk「+」承担
      // （压在分叉点卡片下边沿）；原来这里的「+」放在所有分支下方「完成」之前，看着像在末尾追加
      if (fanOutColMeta[a]) continue
      slots.push({ afterId: a, top: (aBottom + bTop) / 2 })
      mainEdges.push({
        fromId: a,
        toId: b,
        d: `M${center} ${aBottom} L${center} ${bTop}`,
        rule: Boolean(configs[b] && /规则/.test(configs[b].title)),
        lx: center + 118,
        ly: (aBottom + bTop) / 2,
      })
    }

    // 旁路 bezier 连线（旁路节点固定挂在主链左右两侧 SIDE_OFFSET 处：起点/终点取节点中线 ±110，弧顶 ±195）
    const branchEdges: BranchEdge[] = []
    branches.forEach((b) => {
      const bp = branchPos[b.id]
      const mainEnd = b.edgeFrom === b.id ? b.edgeTo : b.edgeFrom
      const mp = mainPos[mainEnd]
      if (!bp || !mp) return
      const branchMid = bp.top + bp.height / 2
      const mainMid = mp.top + mp.height / 2
      branchEdges.push({
        d: b.side === 'right'
          ? `M${center + 110} ${mainMid} C${center + 195} ${mainMid} ${center + 195} ${branchMid} ${center + 110} ${branchMid}`
          : `M${center - 110} ${mainMid} C${center - 195} ${mainMid} ${center - 195} ${branchMid} ${center - 110} ${branchMid}`,
      })
    })

    // 0707 优化·Phase6：fan-in 收拢（列尾 → 汇合点）。
    // 0925 视觉修复：连线在 placeGroup/placeChain 里生成（列尾 = 该列子树最深节点，含嵌套），
    // 上面 pendingConverges 已统一解析并 push——这里不再重复生成（重复就是双层描边 / 反向线）。
    return {
      nodes,
      terminals,
      mainEdges,
      branchEdges,
      fanOutEdges,
      fanOutColMeta,
      slots,
      edgeSlots,
      totalHeight,
      /** 画布内容宽度（0925）：随最宽分支组自适应，FlowBoard 用它设容器/SVG 宽度（≥640） */
      width,
      /** 主链轴心 x（= width/2，0925）：插入点等需要对齐主链的元素用它，不再写死 320 */
      axisX: center,
    }
  })

  // 横向布局：供结果视图顶部节点条使用（纯函数版见 flowModel.buildHorizontalLayout，分屏对比 Phase 5 复用同一算法；
  // 这里保留 computed 版供画布内直接引用）
  const horizontalLayout = computed(() => buildHorizontalLayout(main.value, branches, configs, branchGroups))

  // ---- 选择 ----
  function select(id: string) {
    selectedId.value = id
    activeTab.value = 'config'
  }
  function setActiveTab(tab: string) {
    activeTab.value = tab
  }

  const selectedNode = computed<NodeConfig | undefined>(() => configs[selectedId.value])

  // 节点有效输入表 / 是否主链首节点（0701 问题五）：委托 flowModel 纯函数，供 UI 与 validateFlow 共用
  function effectiveInputTableFor(id: string): string {
    return effectiveInputTable(main.value, branches, configs, id, branchGroups)
  }
  function isFirstMainNodeId(id: string): boolean {
    return isFirstMainNode(main.value, configs, id)
  }

  /** 旧平台「添加后续步骤 → 规则处理」：名称 `{前置配置ID}-{类型名}`，规则 ID 默认 -1，输入表继承上游。
   *  typeName 取模板名（TEMPLATE_TO_NAME）：规则处理→「规则处理」、数据监控→「数据监控」，
   *  不再硬编码「规则处理」——monitor 复用 rule 种子（TEMPLATE_TO_NODE.monitor='rule'）也会走进本函数，
   *  硬编码会把「数据监控」节点名顶成「规则处理」。 */
  function applyRuleStepDefaults(cfg: NodeConfig, prevId: string, upstreamTable: string, typeName = '规则处理') {
    const prevConfigId = configs[prevId]?.configId
    if (prevConfigId) {
      cfg.title = `${prevConfigId}-${typeName}`
      cfg.configName = cfg.title
    }
    if (!cfg.itemId) cfg.itemId = '-1'
    // 「适用源」默认 -1 不再只给规则/监控：所有类型新增节点统一在调用方走
    // applyStepSourceDefault（2026-09-24 用户拍板），这里不重复设。
    if (upstreamTable) {
      cfg.inputTable = cfg.inputTable || upstreamTable
      if (cfg.ruleCfg && !cfg.ruleCfg.inputTableId) cfg.ruleCfg.inputTableId = upstreamTable
    }
  }

  // ---- 节点表联动（0928，见 utils/flow/tableSync）----
  function tableTopology(): TableTopology {
    return { main: main.value, branches, configs, branchGroups }
  }

  /**
   * 改某节点的表（表配置 / 更换配置）后联动：非采集节点输出表原本跟着输入表的，一起改；
   * 然后以变动前的有效输出表为旧值向下游传播。下游被改写时置流程脏，让它们的步骤随自动保存写回。
   */
  function withTableSync(id: string, mutate: () => void, opts: { propagateEmpty?: boolean } = {}) {
    const cfg = configs[id]
    if (!cfg) {
      mutate()
      return
    }
    const before = nodeTablesSnapshot(cfg)
    mutate()
    const after = configs[id]
    if (!after) return
    // 换配置（2026-09-29）：新配置没登记表 ≠ 用户要清空表。实测流程 1400994 的首节点换回配置
    // 1400994（entryTypeId 为空）时，空值沿链传下去把下游 41688 画布上的输入 / 输出表清空了
    // （库里靠快照回退才没写坏）。所以换配置时变动后下游读到的表为空就不联动；用户在表配置里
    // 主动清空（setInputTable / setOutputTable / patchCollect）照旧传播，断链校验才报得出来。
    if (opts.propagateEmpty === false && !tableForDownstream(after)) return
    if (!after.collectCfg && before.output === before.input && nodeOutputTable(after) === before.output
      && nodeInputTable(after) !== before.input) {
      writeNodeOutputTable(after, nodeInputTable(after))
    }
    if (propagateOutputChange(tableTopology(), id, before.effectiveOutput).length) nodeStore.touchFlow()
  }

  // ---- 编辑动作 ----
  /** 按模板新建一份节点配置（新建态：无 configId，配置名 = 节点名）。prevId / upstreamTable 只用于规则 / 数据节点默认值。 */
  function newNodeConfig(template: string, prevId: string, upstreamTable: string): { srcKey: string; cfg: NodeConfig } {
    const srcKey = TEMPLATE_TO_NODE[template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    cfg.template = template
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    // 配置名 = 节点名（0828 D08/P4）：新节点直接带上，用户不必为"起名"多点一次。
    // 模板里可能带着上一份配置的身份，连 configId 一起清干净——新节点是新建态。
    delete cfg.configId
    cfg.configName = cfg.title
    applyStepSourceDefault(cfg)
    if (template === 'rule' || srcKey === 'rule') applyRuleStepDefaults(cfg, prevId, upstreamTable, typeName)
    if (cfg.collectCfg) {
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      const cap = collectorCapabilityOf(cfg)
      cfg.collectCfg.outputTable = cap?.outputMode === 'fixed' ? (cap.fixedOutputTable ?? '') : ''
      cfg.collectCfg.inputParams = []
    }
    if (!cfg.collectCfg && isDataNode(cfg) && !cfg.outputTable) {
      cfg.outputTable = upstreamTable
    }
    const defaultQueue = DEFAULT_TASK_QUEUES[template]
    if (defaultQueue) {
      cfg.taskCfg = {
        ...(cfg.taskCfg ?? { urlRule: '' }),
        queue: defaultQueue,
      }
    }
    return { srcKey, cfg }
  }

  // ---- 拓扑编辑（1008-BR-03）：先改父子关系，再用 topologyFromParents 重建 main + branchGroups ----
  // 与画布还原（buildSourceSeed）同一个函数，编辑后看到的拓扑就是「保存 → 刷新」重建出来的样子。
  // 旧平台语义：每个节点一个上级，分叉以下不汇合；新节点排在同级最后（后端按步骤 ID 升序返回，
  // 新建的 ID 最大，刷新后本来就在最右，1008 方案 §2.2）。

  /** 画布当前每个节点的上级与展示顺序：主链按前一个节点，分支链按链内前一个（链头 = 分叉点）。 */
  function canvasParents(): { parentOf: Map<string, string | undefined>; order: string[] } {
    const parentOf = new Map<string, string | undefined>()
    const order: string[] = []
    let prev: string | undefined
    for (const id of main.value) {
      if (isTerm(id)) continue
      parentOf.set(id, prev)
      order.push(id)
      prev = id
    }
    const walk = (groups: FlowBranchGroup[]) => {
      for (const g of groups) {
        for (const b of g.branches) {
          let p = g.ownerId
          for (const id of b.chain) {
            parentOf.set(id, p)
            order.push(id)
            p = id
          }
          if (b.subGroups?.length) walk(b.subGroups)
        }
      }
    }
    walk(branchGroups)
    return { parentOf, order }
  }

  function rebuildTopology(parentOf: Map<string, string | undefined>, order: string[]) {
    const t = topologyFromParents({ order, parentOf, anchored: new Set(order), labelOf: (id) => configs[id]?.title })
    main.value = t.main
    branchGroups.splice(0, branchGroups.length, ...t.branchGroups)
  }

  /** 沿上级链找最近一个有输出表的节点（含 fromId 自身）；分支链里同样适用 */
  function upstreamOutputTableVia(parentOf: Map<string, string | undefined>, fromId: string | undefined): string {
    const seen = new Set<string>()
    for (let cur = fromId; cur && !seen.has(cur); cur = parentOf.get(cur)) {
      seen.add(cur)
      const t = configs[cur] ? nodeOutputTable(configs[cur]) : ''
      if (t) return t
    }
    return ''
  }

  /**
   * 新建节点挂到 parentId 下，并接管 childIds（这些子节点的上级改成新节点）。
   * childIds 为空 = 只追加一个子节点；parentId 已有其他子节点时新节点就成了一条新分支。
   */
  function attachNewNode(template: string, parentId: string | undefined, childIds: string[]): string {
    const { parentOf } = canvasParents()
    const { srcKey, cfg } = newNodeConfig(template, parentId ?? 'start', upstreamOutputTableVia(parentOf, parentId))
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    placeNode(id, parentId, childIds)
    // 0928 表联动：新节点输入表显式取上游有效输出表（采集节点原来不写，保存时 entryTypeId 为空）
    inheritInputTable(tableTopology(), id)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    select(id)
    nodeStore.touchFlow()
    return id
  }

  /** 把已在 configs 里的节点 id 挂到 parentId 下并接管 childIds，然后重建拓扑 */
  function placeNode(id: string, parentId: string | undefined, childIds: string[]) {
    const { parentOf, order } = canvasParents()
    parentOf.set(id, parentId)
    for (const c of childIds) parentOf.set(c, id)
    if (childIds.length) pendingRelinks.value = [...new Set([...pendingRelinks.value, ...childIds])]
    // 新节点一律排在同级最后 = 最右：后端按步骤 ID 升序返回同级，新建的 ID 最大，刷新后本来就在最右
    //（217 实测：在 41809→41827 线上插入的 41829 刷新后排在 41828 右边，原来插在原位会刷新跳位）。
    // 唯一例外是插到最前面（没有上级、接管原首节点）：它要当第一个根，排在原首节点之前
    const firstChild = parentId === undefined && childIds.length ? order.indexOf(childIds[0]) : -1
    if (firstChild >= 0) order.splice(firstChild, 0, id)
    else order.push(id)
    rebuildTopology(parentOf, order)
  }

  function clearPendingRelink(id: string) {
    pendingRelinks.value = pendingRelinks.value.filter((x) => x !== id)
  }

  /** 画布上每个节点的上级（1008-BR-04：左右「+」按它判断能否加兄弟、上级有没有输出表） */
  const canvasParentMap = computed(() => canvasParents().parentOf)

  /** 节点在画布上的上级（主链首节点 / 根位节点为 undefined） */
  function parentOfNode(id: string): string | undefined {
    return canvasParents().parentOf.get(id)
  }

  /** 节点在画布上的直接子节点（按展示顺序） */
  function childrenOfNode(id: string): string[] {
    const { parentOf, order } = canvasParents()
    return order.filter((c) => parentOf.get(c) === id)
  }

  /**
   * 在 prevId 下方插入：新节点挂到 prevId 下并**接管它的全部子节点**（分叉点下方插入 = 在分叉之前插）。
   * 'start' = 插到最前（新节点当根，原首节点挂到它下面）；'end' 或不在画布上的 id = 追加到主链末尾。
   */
  function insertAfter(prevId: string, template: string) {
    const { parentOf } = canvasParents()
    if (prevId === 'start') {
      const first = main.value.find((id) => !isTerm(id))
      return attachNewNode(template, undefined, first ? [first] : [])
    }
    if (prevId === 'end' || !parentOf.has(prevId)) {
      const last = [...main.value].reverse().find((id) => !isTerm(id))
      return attachNewNode(template, last, [])
    }
    return attachNewNode(template, prevId, childrenOfNode(prevId))
  }

  /** 在 parentId → childIds 这段线上插入（分支段只接管该分支的链头；接管全部子节点等同 insertAfter） */
  function insertOnEdge(parentId: string, childIds: string[], template: string): string {
    return attachNewNode(template, parentId, childIds)
  }

  /** 左右「+」：给 nodeId 加一个兄弟节点（同一个上级），排在同级最右。根位节点没有上级，不能加兄弟。 */
  function addSibling(nodeId: string, template: string): string | null {
    const parent = parentOfNode(nodeId)
    if (!parent) return null
    return attachNewNode(template, parent, [])
  }

  function upstreamOutputTableInBranch(ownerId: string, branch: FlowBranch): string {
    for (let i = branch.chain.length - 1; i >= 0; i--) {
      const c = configs[branch.chain[i]]
      if (c) {
        const t = nodeOutputTable(c)
        if (t) return t
      }
    }
    return effectiveInputTableFor(ownerId)
  }

  function addNodeToBranch(ownerId: string, branchId: string, template: string): string | null {
    const g = branchGroupOf(branchGroups, ownerId)
    const branch = g?.branches.find((b) => b.id === branchId)
    if (!branch) return null
    const prevInBranch = branch.chain.at(-1) || ownerId
    const { srcKey, cfg } = newNodeConfig(template, prevInBranch, upstreamOutputTableInBranch(ownerId, branch))
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    branch.chain.push(id)
    inheritInputTable(tableTopology(), id)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    select(id)
    nodeStore.touchFlow()
    return id
  }

  function duplicateNode(id: string) {
    const src = configs[id]
    if (!src) return
    const cfg = JSON.parse(JSON.stringify(src)) as NodeConfig
    // 副本不得继承原节点的 configId：一个节点只能引用一个配置，两个节点引用同一份配置时，
    // 在副本上改字段再保存就是在改原件（0828 D02「复制节点 = 新增一套配置」）。
    // 这里只保证"绝不指向原配置"；真正复制出一份新配置由调用方的 useDuplicateNode 异步完成。
    // 配置名跟新节点名走，不沿用原配置名（否则「当前配置」条会显示成原件的名字）。
    delete cfg.configId
    cfg.configName = cfg.title
    const newId = `${id.split('-')[0]}-${seq++}`
    configs[newId] = cfg
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx + 1, 0, newId)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    select(newId)
    nodeStore.touchFlow()
  }

  /**
   * 复制节点。**返回新节点 id**，调用方据此接着复制配置（见 useDuplicateNode）。
   *
   * 副本**不继承 configId**：`cloneConfig` 是整体深拷贝，原来把 configId 一起带走了，
   * 结果两个节点引用同一份配置——在副本上改一个字段再保存，改的是原件。
   * 配置名改成新节点名（标题已加「（复制）」），不沿用原配置名。
   * 0828 D02 把「复制节点」定为唯一的复用手段，这条路径会被高频触发，必须在 store 这一层就断干净：
   * 即使后续 config/copyAll 失败，副本也只会停在"未绑定配置"，不会污染原配置。
   */
  function duplicate(id: string): string | undefined {
    if (!configs[id]) return undefined
    const cfg = cloneConfig(configs[id])
    cfg.title = cfg.title.replace(/（复制）$/, '') + '（复制）'
    delete cfg.configId
    cfg.configName = cfg.title
    const newId = `${id}-copy-${seq++}`
    configs[newId] = cfg
    // 1008-BR-06：副本插在原节点下方并接管它的子节点（与 insertAfter 同口径，线性流程里就是「紧跟在原节点后」）。
    // 原先复制分叉点会连分支组一起复制、两组共用同一批链节点（决策节点时代的写法），普通分叉点上会让同一节点出现两次。
    // 旁路挂靠（BranchSeed）节点不在主链 / 分支里，副本同样不上画布，与原来一致。
    if (canvasParents().parentOf.has(id)) placeNode(newId, id, childrenOfNode(id))
    select(newId)
    nodeStore.touchFlow()
    return newId
  }

  /**
   * 把 config/copyAll 复制出来的新配置绑到副本节点上。
   * 内容不用回写——copyAll 是后端整条复制，服务端那份与副本节点当前内容一致，所以直接清配置脏标。
   */
  function bindCopiedConfig(id: string, configId: string, configName: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.configId = configId
    cfg.configName = configName
    nodeStore.markConfigSaved(id)
    nodeStore.touchFlow()
  }

  function move(id: string, dir: -1 | 1) {
    const i = main.value.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 1 || j > main.value.length - 2) return
    const next = [...main.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    main.value = next
    select(id)
    nodeStore.touchFlow()
  }

  function moveTo(id: string, afterId: string) {
    if (id === afterId) return
    const i = main.value.indexOf(id)
    if (i < 1 || i > main.value.length - 2) return
    const arr = main.value.filter((x) => x !== id)
    const at = arr.indexOf(afterId)
    if (at < 0) return
    arr.splice(at + 1, 0, id)
    main.value = arr
    select(id)
    nodeStore.touchFlow()
  }

  function toggleDisabled(id: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.disabled = !cfg.disabled
    select(id)
    nodeStore.touchFlow()
  }

  function removeBranchGroup(ownerId: string) {
    // 0925：分支组可能嵌在别的分支的 subGroups 里（还原拓扑），递归找再摘
    const removeFrom = (groups: FlowBranchGroup[]): boolean => {
      const i = groups.findIndex((bg) => bg.ownerId === ownerId)
      if (i >= 0) {
        const g = groups[i]
        const orphans = allBranchChainNodes([g])
        for (const orphan of orphans) delete configs[orphan]
        groups.splice(i, 1)
        return true
      }
      for (const g of groups) {
        for (const b of g.branches) {
          if (b.subGroups?.length && removeFrom(b.subGroups)) return true
        }
      }
      return false
    }
    if (removeFrom(branchGroups)) nodeStore.touchFlow()
  }

  function detachFromBranches(nodeId: string, groups?: FlowBranchGroup[]) {
    for (const g of groups ?? branchGroups) {
      for (const b of g.branches) {
        const i = b.chain.indexOf(nodeId)
        if (i >= 0) b.chain.splice(i, 1)
        if (b.subGroups?.length) detachFromBranches(nodeId, b.subGroups)
      }
    }
  }

  function remove(id: string) {
    // S6-3（方案 §4.4）：删节点语义上该连带清理它的业务规则/编排记录 + 脚本文件，但技术指导明确
    // "你暂时别删吧……后面删的时候你到底要删的时候你再删"——后端删除接口还没就绪验证过，本期只收集
    // "如果要清理，该清理什么"这份清单（scriptPath / configId），不真的调任何删除接口。
    const cleanup = collectCleanupResources(id, configs[id])
    if (cleanup) {
      pendingCleanup.value = [...pendingCleanup.value, cleanup]
      // eslint-disable-next-line no-console
      console.info('[TODO S6-3] 节点删除待清理资源（本期不真删，见方案 §4.4，后端接口就绪后再接）：', cleanup)
    }
    // 0928 表联动：删 X 前记下 X 的有效输出表、X 从上游拿到的表、X 的直接下游；删完把跟随 X 的
    // 下游改挂到 X 的上游表（A→X→B 删 X 后 B 读 A 的输出，而不是一张已没人写的表）
    const removedCfg = configs[id]
    const removedOut = removedCfg ? tableForDownstream(removedCfg) : ''
    const removedIn = removedCfg ? effectiveInputTableFor(id) : ''
    const removedSuccessors = removedCfg ? directSuccessorIdsIncludingDisabled(main.value, configs, id, branchGroups) : []
    // 分支段 owner 本身被删：连带整组分支（0925：嵌套组 owner 同样命中，递归摘除）
    if (branchGroupOf(branchGroups, id)) removeBranchGroup(id)
    // 删节点时，从所有 FlowBranchGroup 的 chain 里摘除（含嵌套；owner 删组后残留的链位一并清掉）
    detachFromBranches(id)
    delete configs[id]
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx, 1)
    // 旁路挂靠
    const branchIdx = branches.findIndex((b) => b.id === id)
    if (branchIdx >= 0) branches.splice(branchIdx, 1)
    if (selectedId.value === id) {
      const first = main.value.find((m) => !isTerm(m))
      if (first) select(first)
      else selectedId.value = ''
    }
    // 清理运行时态，避免删除正在运行/已完成的节点后 runtime.nodeStates 残留脏数据
    useRuntimeStore().clearNodeStates([id])
    retargetFollowers(tableTopology(), removedSuccessors, removedOut, removedIn)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    // 清理运行时态，避免删除正在运行/已完成的节点后 runtime.nodeStates 残留脏数据
    useRuntimeStore().clearNodeStates([id])
    nodeStore.touchFlow()
  }

  /**
   * 改节点名。**配置名跟着走**（0828 D08/P4：配置名 = 节点名）。
   *
   * 「跟不跟」不额外存标记，用**当前配置名是否还等于旧节点名**判断：
   * 相等（或为空）说明用户没单独改过配置名，跟着更新；一旦用户单独改过配置名就自动脱钩，
   * 之后改节点名不再覆盖他填的名字。
   */
  function setTitle(id: string, title: string) {
    const c = configs[id]
    // 允许输入框在编辑过程中暂时为空；保存/发布前由 validateFlow 统一校验，
    // 不能在每次 input 时回填“未命名节点”导致最后一个字无法删除。
    if (c) {
      const followed = !c.configName || c.configName === c.title
      c.title = title
      if (followed) c.configName = title
    }
    nodeStore.touchFlow()
  }

  function serialize(options: { includeLoginPasswords?: boolean } = {}): FlowDef {
    const defaultQueue =
      `${sourceCfg.value?.sourceId || siteCtx.value?.siteId || sourceCtx.value?.siteId || flowId.value}_main`
    const outConfigs = JSON.parse(JSON.stringify(configs)) as Record<string, NodeConfig>
    Object.values(outConfigs).forEach((c) => {
      if (!isDataNode(c)) return
      if (!c.taskCfg) c.taskCfg = { queue: '', urlRule: '' }
      if (!c.taskCfg.queue) c.taskCfg.queue = defaultQueue
    })
    if (!options.includeLoginPasswords) {
      stripLoginSecrets(outConfigs)
    }
    const outSource = sourceCfg.value ? (JSON.parse(JSON.stringify(sourceCfg.value)) as Source) : undefined
    if (outSource?.templateId) outSource.nodeBindings = extractTemplateNodeBindings(outConfigs)
    return {
      id: flowId.value,
      name: flowName.value,
      version: 'draft-0.3',
      main: [...main.value],
      branches: JSON.parse(JSON.stringify(branches)) as BranchSeed[],
      configs: outConfigs,
      updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      source: outSource,
      branchGroups: JSON.parse(JSON.stringify(branchGroups)) as FlowBranchGroup[],
    }
  }

  /**
   * 绑定已有配置（0824-00 §5.3）：把配置正文覆盖到节点，流程字段（节点名称/源 URL/进入条件）保持不动。
   * 内容来自后端已保存的配置，所以只置流程脏（节点的 configId 变了），不置配置脏。
   */
  function bindExistingConfig(id: string, config: import('@/api').Config) {
    const cfg = configs[id]
    if (!cfg) return
    withTableSync(id, () => applyConfigToNode(cfg, config), { propagateEmpty: false })
    nodeStore.markConfigSaved(id)
    nodeStore.touchFlow()
  }

  /**
   * configDetail 异步回填（2026-08-28）：画布先用 nextConfigPaged 的裸步骤画出来，
   * 补充字段随后打回。这是**回读**不是用户改动，所以不置任何脏标。
   * 返回被重建的节点（登录语义改变了模板路由），调用方据此决定要不要修选中态。
   */
  function applyStepDetails(steps: Step[]): string[] {
    if (!sourceCfg.value) return []
    sourceStore.rememberSteps(steps, 'merge')
    return applyStepDetailsToConfigs(configs, sourceCfg.value, steps)
  }

  /** 新建步骤落库后，把本地草稿 id 换成后端分配的 itemConfig。 */
  function rebindNodeId(from: string, to: string): boolean {
    if (!from || !to || from === to || !configs[from] || configs[to]) return false
    configs[to] = configs[from]
    delete configs[from]
    const i = main.value.indexOf(from)
    if (i >= 0) main.value[i] = to
    // 0926 REVIEW F-R1：分支组允许 subGroups 嵌套（还原拓扑 / 复制产物）后，换绑必须递归
    // 遍历全部组——原先只改顶层组的 ownerId 与 chain，嵌套子分叉链里新建的节点（草稿 id）
    // 落库换绑后画布/流程定义仍引用旧 id：节点从画布消失、保存的 flowConf 残留失效 id。
    const rebindGroup = (g: FlowBranchGroup) => {
      if (g.ownerId === from) g.ownerId = to
      for (const b of g.branches) {
        const j = b.chain.indexOf(from)
        if (j >= 0) b.chain[j] = to
        for (const sg of b.subGroups ?? []) rebindGroup(sg)
      }
    }
    for (const g of branchGroups) rebindGroup(g)
    for (const b of branches) {
      if (b.id === from) b.id = to
    }
    if (selectedId.value === from) selectedId.value = to
    // 1008-BR-05：插在草稿节点上方时，待改挂的下游本身也是草稿，换绑后跟着换
    if (pendingRelinks.value.includes(from)) pendingRelinks.value = pendingRelinks.value.map((x) => (x === from ? to : x))
    sourceStore.renameStepSnapshot(from, to)
    return true
  }

  /** 保存配置：清该节点的 config 脏标，并把流程置脏（配置内容变了，流程需要重新提交） */
  function markNodeConfigSaved(id: string) {
    nodeStore.markConfigSaved(id)
    nodeStore.touchFlow()
  }

  function load(def: FlowDef) {
    flowId.value = def.id
    flowName.value = def.name
    Object.keys(configs).forEach((k) => delete configs[k])
    Object.assign(configs, normalizeNodeConfigs(JSON.parse(JSON.stringify(def.configs)) as Record<string, NodeConfig>))
    branches.splice(0, branches.length, ...(JSON.parse(JSON.stringify(def.branches)) as BranchSeed[]))
    main.value = [...def.main]
    orphanIds.value = [...(def.orphanIds ?? [])]
    pendingRelinks.value = []
    sourceCfg.value = def.source ? (JSON.parse(JSON.stringify(def.source)) as Source) : null
    // 0806：历史流程的 Source/TaskConfig 定时字段仍需迁移，但不再把登录节点当作采集起点。
    const firstNodeId = main.value.find((nodeId) => {
      const cfg = configs[nodeId]
      return !!cfg?.collectCfg && collectorCapabilityOf(cfg)?.kind !== 'login'
    })
    const legacySchedule = sourceCfg.value
    if (firstNodeId && legacySchedule && configs[firstNodeId].collectCfg) {
      const firstCollect = configs[firstNodeId].collectCfg
      const firstTask = configs[firstNodeId].taskCfg as (TaskConfig & { scheduleType?: string; scheduleTime?: string; weekdays?: number[]; cron?: string }) | undefined
      firstCollect.scheduleType = legacySchedule.scheduleType ?? firstTask?.scheduleType ?? firstCollect.scheduleType
      firstCollect.scheduleTime = legacySchedule.scheduleTime ?? firstTask?.scheduleTime ?? firstCollect.scheduleTime
      firstCollect.weekdays = legacySchedule.weekdays ?? firstTask?.weekdays ?? firstCollect.weekdays
      firstCollect.cron = legacySchedule.cron ?? firstTask?.cron ?? firstCollect.cron
      configs[firstNodeId].schedule = {
        scheduleType: firstCollect.scheduleType,
        scheduleTime: firstCollect.scheduleTime,
        weekdays: firstCollect.weekdays,
        cron: firstCollect.cron,
      }
      delete legacySchedule.scheduleType
      delete legacySchedule.scheduleTime
      delete legacySchedule.weekdays
      delete legacySchedule.cron
      if (firstTask) {
        delete firstTask.scheduleType
        delete firstTask.scheduleTime
        delete firstTask.weekdays
        delete firstTask.cron
      }
    }
    branchGroups.splice(0, branchGroups.length, ...((JSON.parse(JSON.stringify(def.branchGroups ?? [])) as FlowBranchGroup[])))

    seq = Math.max(1, ...Object.keys(configs).map((k) => Number(/-(\d+)$/.exec(k)?.[1]) || 0)) + 1

    const first = main.value.find((m) => !isTerm(m))
    if (first) select(first)
    else {
      selectedId.value = ''
    }
    activeTab.value = 'config'
    nodeStore.markSaved()
  }

  function newFlow(kind: 'blank' | 'standard' = 'blank') {
    sourceStore.resetAllContext()
    flowIdMode.value = false
    load(kind === 'standard' ? makeStandardFlow() : makeBlankFlow())
  }

  function loadFromSource(source: Source, steps: Step[], persistedDef?: FlowDef | null) {
    const result = sourceStore.loadFromSource(source, steps, persistedDef)
    if (result) {
      sourceCtx.value = result.sourceCtx
      flowIdMode.value = false
      load(result.def)
    }
  }

  function clearSourceCtx() {
    sourceStore.clearSourceCtx()
  }

  /** 0926：清源上下文但保留步骤快照（流程工作区抽屉用，见 sourceStore.clearSourceCtxKeepSteps） */
  function clearSourceCtxKeepSteps() {
    sourceStore.clearSourceCtxKeepSteps()
  }

  function startSiteFlow(site: Site, def?: FlowDef | null) {
    const flowDef = sourceStore.startSiteFlow(site, def)
    sourceCtx.value = null
    flowIdMode.value = false
    load(flowDef)
    activeTab.value = 'config'
  }

  function clearSiteCtx() {
    sourceStore.clearSiteCtx()
  }

  function setSiteDisplayCtx(site: Site | null) {
    sourceStore.setSiteDisplayCtx(site)
  }

  function startDraftSource(source: Source) {
    const flowDef = sourceStore.startDraftSource(source)
    sourceCtx.value = flowDef.source ? (JSON.parse(JSON.stringify(flowDef.source)) as Source) : null
    flowIdMode.value = false
    load(flowDef)
  }

  /**
   * 应用一个流程模板到当前源：复制模板的节点，并把**模板里的那套配置复制出一套新的**给本源
   * （0903 H03——「新增配置」的确切含义是复制，不是凭空建空配置，也不是引用模板的配置）。
   *
   * 这是「选流程模板」的**唯一实现**，两个调用方共用：
   *   ① 源画布顶部的「切换流程模板」（`CanvasHeader.vue`）
   *   ② 新建源时选模板（Y8-C，待做）
   *
   * 0903 设计方案初稿一度要求删掉画布头那个入口、连带清理这个方法——**已推翻**，勿删。
   */
  function applyTemplate(template: FlowRecord): { retained: number; cleared: number } | null {
    const result = sourceStore.applyTemplate(template, configs)
    if (!result) {
      console.warn('[flow] applyTemplate skipped: sourceStore.applyTemplate returned null', { template })
      return null
    }
    const source = sourceCfg.value ?? sourceCtx.value
    if (!source) {
      console.warn('[flow] applyTemplate skipped: no source bound', { template })
      return null
    }
    const composed = composeTemplateFlow(template, source, source.nodeBindings ?? {})
    applyParamSourceUrlToFirstCollectNode(composed.main, composed.configs, source)
    load(composed)
    sourceCtx.value = JSON.parse(JSON.stringify(source)) as Source
    nodeStore.touchFlow()
    return result
  }

  /**
   * 这个源的真实步骤里是否有分支（两个及以上步骤的 lastStep 指向同一个前置）。
   *
   * 画布目前把子步骤一律拍成直线（buildSourceSeed 的 branches 恒为 []），所以这个值为 true 时
   * **画布展示的顺序不是真实拓扑**。两个用处：
   *   ① 自动保存据此冻结 lastStep 回写（useStepWrite，0903 YB-A 止血）
   *   ② 画布头据此显示只读提示，让用户知道看到的是拍平后的样子
   * 分支拓扑还原见 YB-B；那之后这个开关应当随之退役。
   */
  const hasBranchedSteps = computed(() => hasRealBranches(sourceStore.stepSnapshots))

  function setFlowName(name: string) {
    sourceStore.setFlowName(name)
    nodeStore.touchFlow()
  }

  function patchSource(patch: Partial<Source>) {
    sourceStore.patchSource(patch)
    // 源 URL 的真值只有一份，在源上；每个采集节点里的 collectCfg.url 是 buildNodeForStep 复制去的
    // 显示副本（0824-11 §1.1b）。改了源就把副本同步过去，否则画布/发抓取/XML 读到的还是旧值。
    // 参数源的首节点 URL 由下面 applyParamSourceUrlToFirstCollectNode 再覆盖一次，顺序不能反。
    if (patch.url !== undefined) {
      Object.values(configs).forEach((cfg) => {
        if (cfg.collectCfg) cfg.collectCfg.url = patch.url ?? ''
      })
    }
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    nodeStore.touchFlow()
  }

  function patchSourceCtx(patch: Partial<Source>) {
    sourceStore.patchSourceCtx(patch)
  }

  /** 回填源的定时 cron（来自 job 表）。见 sourceStore.applySourceSchedule——**不置脏**。 */
  function applySourceSchedule(cron: string) {
    sourceStore.applySourceSchedule(cron)
  }

  /** 源的定时任务原样存一份，供节点配置里只读展示"下次运行/上次运行/运行次数"。 */
  const sourceJob = computed(() => sourceStore.sourceJob)
  function setSourceJob(job: SourceJob | null) {
    sourceStore.setSourceJob(job)
    if (job?.schedule) sourceStore.applySourceSchedule(job.schedule)
  }

  function resetAllContext() {
    sourceStore.resetAllContext()
  }

  /**
   * 判断节点是否存在结构上的上游业务节点。
   * 这不是“首节点业务规则”：它只用于区分“链路断裂”与“流程入口本来就没有输入表”。
   */
  function hasUpstreamNode(def: FlowDef, id: string): boolean {
    const idx = def.main.indexOf(id)
    if (idx >= 0) return def.main.slice(0, idx).some((pid) => !!def.configs[pid] && !isTerm(pid))
    const side = def.branches.find((item) => item.id === id)
    if (side) return !!def.configs[side.rowAnchor]
    const found = branchOfNode(def.branchGroups, id)
    if (found) {
      return found.chainIndex > 0 || !!def.configs[found.group.ownerId]
    }
    return false
  }

  // 发布门禁
  function validateFlow(def?: FlowDef): string[] {
    const d = def ?? serialize({ includeLoginPasswords: true })
    const errs: string[] = []
    const mainIds = d.main.filter((idv) => !isTerm(idv))
    const branchIds = d.branches.map((b) => b.id).filter((id) => !isTerm(id))
    // 0925：chain 覆盖嵌套 subGroups（还原拓扑的链内再分叉）
    const chainIds = allBranchChainNodes(d.branchGroups).filter((nid) => !isTerm(nid))
    if (!mainIds.length) errs.push('流程为空：至少添加一个节点')
    const allIds = [...mainIds, ...branchIds, ...chainIds]
    allIds.forEach((nid) => {
      const c = d.configs[nid]
      if (!c) return
      if (!c.title.trim()) errs.push('节点名称不能为空')
      const capability = collectorCapabilityOf(c)
      if (c.collectCfg && !c.disabled) {
        if (!c.collectCfg.url) errs.push(`「${c.title}」缺少源 URL`)
          if (capability?.kind !== 'login' && !c.collectCfg.outputTable) errs.push(`「${c.title}」缺少输出表`)
          if (capability?.kind === 'login') {
            const configs = c.collectCfg.loginConfigs?.length
              ? c.collectCfg.loginConfigs
              : (c.collectCfg.account || c.collectCfg.loginUrl
                ? [{
                  id: 'legacy-default',
                  loginUrl: c.collectCfg.loginUrl || '',
                  loginName: c.collectCfg.account || '',
                  loginPwd: '',
                  newLoginConfig: '1' as const,
                  authConfig: '',
                  enabled: true,
                }]
                : [])
            const enabledConfigs = configs.filter((config) => config.enabled)
            if (!enabledConfigs.length) errs.push(`「${c.title}」至少需要一个启用的登录配置`)
            const invalidConfig = configs.find((config) => config.newLoginConfig === '0'
              ? !config.authConfig.trim()
              : !config.loginUrl.trim() || !config.loginName.trim() || !config.loginPwd.trim())
            if (invalidConfig) errs.push(`「${c.title}」登录配置的登录 URL、用户名、密码或已有登录模板不能为空`)
            const defaultId = c.collectCfg.defaultLoginConfigId
            if (enabledConfigs.length && !enabledConfigs.some((config) => config.id === defaultId)) {
              errs.push(`「${c.title}」请选择一个启用的默认登录配置`)
            }
          }
        if (capability?.kind === 'web' && hasFragmentParams(c.collectCfg.url)) {
          errs.push(`「${c.title}」URL 参数写在 # 片段里，普通网页抓取读不到，请改用浏览器抓取节点`)
        }
        const paramIds = extractUrlParamIds(c.collectCfg.url)
        const refs = c.collectCfg.urlParamRefs ?? []
        const unbound = paramIds.filter((pid) => !refs.includes(pid))
        if (unbound.length) errs.push(`「${c.title}」URL 参数 ${unbound.join('、')} 尚未绑定到参数配置`)
        const unresolved = paramIds.filter((pid) => refs.includes(pid) && !c.collectCfg?.urlParamValues?.[pid])
        if (unresolved.length) errs.push(`「${c.title}」URL 参数 ${unresolved.join('、')} 还没有选定取值`)
      } else if (!c.disabled && isRuleNode(c)) {
        // 规则处理节点走独立校验（0801 方案 §9.1）：默认输出表=输入表，NodeConfig.outputTable
        // 未显式指定时留空是正常状态，不能套用其他数据节点「缺少输出表」那条通用检查。
        const ruleCfg = c.ruleCfg
        if (!ruleCfg || !c.configId) {
          errs.push(`「${c.title}」请先保存表配置`)
        } else {
          if (!ruleCfg.inputFields?.length) errs.push(`「${c.title}」缺少入参字段`)
          if (!isMonitorNode(c) && !isDataValidationNode(c) && !ruleCfg.outputFields?.length) errs.push(`「${c.title}」缺少出参字段`)
          if (!ruleCfg.script?.trim()) errs.push(`「${c.title}」尚未生成规则脚本`)
        }
      } else if (!c.disabled && isDataNode(c) && !c.outputTable) {
        errs.push(`「${c.title}」缺少输出表`)
      }
      const effectiveInput = effectiveInputTable(d.main, d.branches, d.configs, nid, d.branchGroups ?? [])
      if (
        !c.disabled &&
        isDataNode(c) &&
        capability?.kind !== 'login' &&
        hasUpstreamNode(d, nid) &&
        !effectiveInput
      ) {
        errs.push(`「${c.title}」缺少输入表`)
      }
      if (effectiveInput) {
        const ownTaskParamRefs = new Set(c.collectCfg?.urlParamRefs ?? [])
        const paramValues = c.taskCfg?.paramValues ?? []
        const invalidTaskValues = paramValues.filter((item) => !ownTaskParamRefs.has(item.paramId)).map((item) => item.paramId)
        if (invalidTaskValues.length) errs.push(`「${c.title}」任务参数 ${invalidTaskValues.join('、')} 未绑定到当前节点`)
        const valueByParam = new Map(paramValues.map((item) => [item.paramId, item]))
        const missingValues = [...ownTaskParamRefs].filter((paramId) => {
          const value = valueByParam.get(paramId)
          return !value || (!value.fieldId && !value.valueExpr)
        })
        if (missingValues.length) errs.push(`「${c.title}」任务参数 ${missingValues.join('、')} 缺少取值字段或值函数`)
      }
    })
    return errs
  }

  return {
    // 流程核心状态
    configs,
    main,
    branches,
    branchGroups,
    // S6-3：删节点待清理资源清单（本期只收集不真删，见方案 §4.4）
    pendingCleanup,
    // 代理状态（保持 API 不变）
    flowId,
    flowName,
    sourceCtx,
    sourceCfg,
    siteCtx,
    // 流程工作区形态标志（0926）：写路径按 flowId 锚定 vs 源视角按 mainConfig/源锚定
    flowIdMode,
    setFlowIdMode,
    selectedId,
    activeTab,
    dirty,
    configDirty,
    flowDirty,
    flowRev,
    dirtyConfigNodes,
    bindExistingConfig,
    applyStepDetails,
    rebindNodeId,
    markNodeConfigSaved,
    selectedNode,
    // 布局
    layout,
    horizontalLayout,
    // 孤儿步骤（0925：随流程加载推导，仅供画布标记与关联修复）
    orphanIds,
    // 选择
    select,
    setActiveTab,
    // 节点有效输入表
    effectiveInputTableFor,
    isFirstMainNodeId,
    // 编辑动作
    insertAfter,
    insertOnEdge,
    canvasParentMap,
    pendingRelinks,
    clearPendingRelink,
    addSibling,
    parentOfNode,
    childrenOfNode,
    addNodeToBranch,
    duplicateNode,
    duplicate,
    bindCopiedConfig,
    move,
    moveTo,
    toggleDisabled,
    remove,
    setTitle,
    // 分支操作
    removeBranchGroup,
    detachFromBranches,
    // 序列化/加载
    serialize,
    load,
    newFlow,
    loadFromSource,
    clearSourceCtx,
    clearSourceCtxKeepSteps,
    startSiteFlow,
    clearSiteCtx,
    setSiteDisplayCtx,
    startDraftSource,
    hasBranchedSteps,
    applyTemplate,
    setFlowName,
    patchSource,
    patchSourceCtx,
    applySourceSchedule,
    sourceJob,
    setSourceJob,
    resetAllContext,
    // 发布门禁
    validateFlow,
    // 代理 node store 的操作
    touch: () => nodeStore.touchFlow(),
    markSaved: () => nodeStore.markSaved(),
    markFlowSaved: () => nodeStore.markFlowSaved(),
    setTripleCell: (id: string, field: TripleField, rowIndex: number, colIndex: 0 | 1 | 2, value: string) => nodeStore.setTripleCell(id, field, rowIndex, colIndex, value),
    addTripleRow: (id: string, field: TripleField) => nodeStore.addTripleRow(id, field),
    removeTripleRow: (id: string, field: TripleField, rowIndex: number) => nodeStore.removeTripleRow(id, field, rowIndex),
    patchCollect: (id: string, patch: Partial<CollectConfig>) => ('inputTable' in patch || 'outputTable' in patch
      ? withTableSync(id, () => nodeStore.patchCollect(id, patch))
      : nodeStore.patchCollect(id, patch)),
    patchTaskConfig: (id: string, patch: Partial<TaskConfig>) => nodeStore.patchTaskConfig(id, patch),
    patchSchedule: (id: string, patch: Partial<import('@/views/FlowCanvas/canvas/flowModel').CollectorSchedule>) => nodeStore.patchSchedule(id, patch),
    patchRuleConfig: (id: string, patch: Partial<RuleOrchestration>) => nodeStore.patchRuleConfig(id, patch),
    patchExecConfig: (id: string, patch: Partial<RuleOrchestration>) => nodeStore.patchExecConfig(id, patch),
    setMonitorMethods: (id: string, methods: string[]) => nodeStore.setMonitorMethods(id, methods),
    setMonitorAlertConfig: (id: string, config: import('@/views/FlowCanvas/canvas/flowModel').MonitorAlertConfig) => nodeStore.setMonitorAlertConfig(id, config),
    setOutputTable: (id: string, tableId: string) => withTableSync(id, () => nodeStore.setOutputTable(id, tableId)),
    setDedupMode: (id: string, mode: 'source' | 'table') => nodeStore.setDedupMode(id, mode),
    setOutFields: (id: string, fields: string[]) => nodeStore.setOutFields(id, fields),
    setInputTable: (id: string, tableId: string) => withTableSync(id, () => nodeStore.setInputTable(id, tableId)),
    setInputFields: (id: string, fields: string[]) => nodeStore.setInputFields(id, fields),
    resetInputFields: (id: string) => nodeStore.resetInputFields(id),
    setTaskQueue: (id: string, value: string) => nodeStore.setTaskQueue(id, value),
    setStructuredConfig: (id: string, value: string) => nodeStore.setStructuredConfig(id, value),
    setContentRules: (id: string, value: string) => nodeStore.setContentRules(id, value),
    setConfigName: (id: string, name: string) => nodeStore.setConfigName(id, name),
    setConfigUrl: (id: string, url: string) => nodeStore.setConfigUrl(id, url),
    hydrateConfigUrl: (id: string, url: string) => nodeStore.hydrateConfigUrl(id, url),
    setItemId: (id: string, itemId: string) => nodeStore.setItemId(id, itemId),
    setStepSourceId: (id: string, sourceId: string) => nodeStore.setStepSourceId(id, sourceId),
    setEntryCondition: (id: string, cond: ConditionGroup | undefined) => nodeStore.setEntryCondition(id, cond),
    setNodeDisabled: (id: string, disabled: boolean) => nodeStore.setNodeDisabled(id, disabled),
    setBaseRow: (id: string, index: number, value: string) => nodeStore.setBaseRow(id, index, value),
    setFieldRow: (id: string, index: number, value: string) => nodeStore.setFieldRow(id, index, value),
  }
})
