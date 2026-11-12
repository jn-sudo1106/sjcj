// 流程画布纵向布局（纯函数）。2026-10-31 从 stores/flow.ts 的 layout computed 原样搬出，逻辑不变：
// 画布页（FlowBoard，经 flow store）和流程选择弹窗的只读预览（FlowReadonlyCanvas，不碰全局 store）共用同一算法。
// 只读预览不能借用 flow store：弹窗也会出现在画布页的网站详情里，那里 store 绑着自动保存。
import type { BranchSeed, FlowBranch, FlowBranchGroup, NodeConfig } from './flowModel'
import { branchGroupOf } from './flowModel'
import { elbowVH, TERMINALS } from './flowModel.layout'

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
export function buildVerticalLayout(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[],
  orphanIds: string[] = [],
) {
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
  const maxGroupW = main.reduce((max, id) => {
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
  main.forEach((id) => {
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
    const nextId = main[main.indexOf(ownerId) + 1]
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
  main.forEach((id) => {
    if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
    else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false, orphan: orphanIds.includes(id) })
  })
  // fan-out 节点
  for (const fid of Object.keys(fanOutPos)) {
    if (configs[fid]) nodes.push({ id: fid, cfg: configs[fid], pos: fanOutPos[fid], branch: true, orphan: orphanIds.includes(fid) })
  }
  // 旁路挂靠
  branches.forEach((b) => {
    if (branchPos[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true, side: b.side })
  })

  // 主链插入点 + 主链连线
  const slots: DropSlot[] = []
  const mainEdges: MainEdge[] = []
  for (let i = 0; i < main.length - 1; i++) {
    const a = main[i]
    const b = main[i + 1]
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
}
