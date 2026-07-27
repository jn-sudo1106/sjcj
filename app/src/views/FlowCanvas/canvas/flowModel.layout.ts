// flowModel.layout.ts — 流程画布布局与节点配置规范化算法
//
// 从 flowModel.ts（1270 行）物理切出：
//   - 节点配置规范化（normalizeInputMapping / normalizeFieldDef / emptyTripleRow / setTripleValue
//     / normalizeNodeConfig / normalizeNodeConfigs / cloneConfig）
//   - 画布布局算法（TERMINALS / HPlacedPos / buildHorizontalLayout / SourceSeed / effectiveInputTable
//     / isFirstMainNode / nowStamp / backfillOutputTables）
//   - 节点 UI 辅助（iconFor / nodeClassFor）
//
// 依赖关系：layout → flowModel (types) + @/utils/flow/urlParams（extractUrlParamIds）；
//          seeds → layout（用 cloneConfig / normalizeNodeConfigs / backfillOutputTables）

import type {
  BranchSeed,
  FieldDef,
  FlowBranchGroup,
  FlowDef,
  InputMapping,
  NodeConfig,
  NodeConfigSeed,
  TaskParamValue,
  TripleField,
} from './flowModel'
import { isDataNode, nodeInputTable, nodeOutputTable } from './flowModel'
import { extractUrlParamIds } from '@/utils/flow/urlParams'

// ---------- 节点配置规范化 ----------
function normalizeInputMapping(row: InputMapping | [string, string, string]): InputMapping {
  if (Array.isArray(row)) return { name: row[0] ?? '', from: row[1] ?? '', desc: row[2] ?? '' }
  return { name: row.name ?? '', from: row.from ?? '', desc: row.desc ?? '' }
}

function normalizeFieldDef(row: FieldDef | [string, string, string]): FieldDef {
  if (Array.isArray(row)) return { name: row[0] ?? '', type: row[1] ?? '', desc: row[2] ?? '' }
  return { name: row.name ?? '', type: row.type ?? '', desc: row.desc ?? '' }
}

export function emptyTripleRow(field: TripleField): InputMapping | FieldDef {
  return field === 'inmap' ? { name: '', from: '', desc: '' } : { name: '', type: '', desc: '' }
}

export function setTripleValue(field: TripleField, row: InputMapping | FieldDef, col: 0 | 1 | 2, value: string) {
  if (field === 'inmap') {
    const target = row as InputMapping
    if (col === 0) target.name = value
    else if (col === 1) target.from = value
    else target.desc = value
    return
  }
  const target = row as FieldDef
  if (col === 0) target.name = value
  else if (col === 1) target.type = value
  else target.desc = value
}

export function normalizeNodeConfig(cfg: NodeConfig | NodeConfigSeed): NodeConfig {
  const next = JSON.parse(JSON.stringify(cfg)) as NodeConfigSeed
  if (next.collectCfg && !next.collectCfg.urlParamRefs?.length) {
    // 旧流程只有 URL token；加载时迁移为显式节点绑定，保存后不再依赖隐式推导。
    next.collectCfg.urlParamRefs = extractUrlParamIds(next.collectCfg.url)
  }
  if (next.taskCfg) {
    const ownParamRefs = new Set(next.collectCfg?.urlParamRefs ?? [])
    const legacyValues: TaskParamValue[] = next.taskCfg.paramRefs?.map((paramId) => ({ paramId })) ?? []
    const paramValues: TaskParamValue[] = next.taskCfg.paramValues ?? legacyValues
    const seen = new Set<string>()
    const normalizedValues = paramValues.filter((item) => {
      if (!ownParamRefs.has(item.paramId) || seen.has(item.paramId)) return false
      seen.add(item.paramId)
      return true
    }).map((item) => ({
      paramId: item.paramId,
      fieldId: item.fieldId ?? '',
      valueExpr: item.valueExpr ?? '',
    }))
    if (normalizedValues.length) next.taskCfg.paramValues = normalizedValues
    else delete next.taskCfg.paramValues
    delete next.taskCfg.paramRefs
    next.taskCfg.contextMap = [...new Set((next.taskCfg.contextMap ?? []).filter(Boolean))]
    next.taskCfg.outColumns = [...new Set((next.taskCfg.outColumns ?? []).filter(Boolean))]
  }
  return {
    ...next,
    inmap: (next.inmap ?? []).map(normalizeInputMapping),
    params: (next.params ?? []).map(normalizeFieldDef),
    output: (next.output ?? []).map(normalizeFieldDef),
  }
}

export function normalizeNodeConfigs(configs: Record<string, NodeConfig | NodeConfigSeed>): Record<string, NodeConfig> {
  return Object.fromEntries(Object.entries(configs).map(([id, cfg]) => [id, normalizeNodeConfig(cfg)]))
}

export function cloneConfig(cfg: NodeConfig): NodeConfig {
  return normalizeNodeConfig(cfg)
}

// ---------- 节点 UI 辅助（与 buildHorizontalLayout 一起用） ----------
export function iconFor(cfg: NodeConfig): string {
  const sub = cfg.sub || ''
  if (sub.indexOf('[90]') >= 0) return '90'
  if (sub.indexOf('[95]') >= 0) return '95'
  if (sub.indexOf('[150]') >= 0) return '150'
  if (sub.indexOf('[155]') >= 0) return '155'
  if (sub.indexOf('[300]') >= 0) return '300'
  if (sub.indexOf('[400]') >= 0) return '400'
  if (sub.indexOf('[BROWSER]') >= 0) return '180'
  if (sub.indexOf('[WECHAT]') >= 0) return '185'
  if (cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)) return 'IF'
  if (cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)) return 'PAR'
  if (/规则/.test(cfg.title)) return 'R'
  if (/指标/.test(cfg.title)) return 'M'
  if (/解析/.test(cfg.title)) return 'PARSE'
  if (/清洗/.test(cfg.title)) return 'CLEAN'
  if (/去重/.test(cfg.title)) return 'DEDUP'
  return 'NODE'
}

export function nodeClassFor(cfg: NodeConfig): string {
  if (cfg.planned && /邮件|告警/.test(cfg.title)) return 'mail-node planned'
  if (cfg.planned) return 'planned'
  if (cfg.kind === 'decision' || /决策|条件路径/.test(cfg.title + cfg.sub)) return 'logic-node'
  if (cfg.kind === 'parallel' || /分头|多路径并行/.test(cfg.title + cfg.sub)) return 'parallel-node'
  if (/规则/.test(cfg.title)) return 'rule-node'
  if (/校验/.test(cfg.title)) return 'check-node'
  if (/邮件|告警/.test(cfg.title)) return 'mail-node'
  return ''
}

// ---------- 画布布局算法 ----------
// ---------- 结果视图横向布局 / 源 → 链路构造（纯函数，供 flow store 与分屏对比 Phase 5 共用）----------

export const TERMINALS: Record<string, string> = { start: '开始', end: '完成 / 发布候选' }

export interface HPlacedPos { left: number; top: number; width: number; height: number }
export interface HPlacedNode { id: string; cfg: NodeConfig; pos: HPlacedPos; branch: boolean }
export interface HPlacedTerm { id: string; label: string; pos: HPlacedPos }
export interface HEdge { d: string; rule: boolean }
export interface HorizontalLayout {
  nodes: HPlacedNode[]
  terminals: HPlacedTerm[]
  mainEdges: HEdge[]
  branchEdges: HEdge[]
  totalWidth: number
  totalHeight: number
  axisY: number
}

export interface HorizontalLayoutOptions {
  includeTerminals?: boolean
}

/** 结果视图顶部节点条布局（纯函数版，从 flow store 的 horizontalLayout 计算逻辑提取，二者算法一致）
 *  0707 优化·Phase6：扩展支持 FlowBranchGroup 决策/分头节点的分支列（chain 节点平铺在 owner 节点下方一行） */
export function buildHorizontalLayout(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  branchGroups: FlowBranchGroup[] = [],
  options: HorizontalLayoutOptions = {},
): HorizontalLayout {
  const HNODE_W = 132
  const HNODE_H = 60
  const HTERM_W = 92
  const HTERM_H = 30
  const HGAP = 22
  const HBRANCH_DY = 86 // 旁路相对主链上下偏移
  const PAD_X = 16
  const PAD_Y = 10
  const isTerm = (id: string) => id === 'start' || id === 'end'
  const visibleMain = options.includeTerminals === false ? main.filter((id) => !isTerm(id)) : main
  // 主链顶对齐：仅当有"上方旁路"时才在主链上方留空，否则贴顶；下方旁路向下扩展高度
  const hasAbove = branches.some((b) => b.side === 'left')
  const hasBelow = branches.some((b) => b.side === 'right')
  const axisY = (hasAbove ? HBRANCH_DY : PAD_Y) + HNODE_H / 2

  const mainPos: Record<string, HPlacedPos> = {}
  let x = PAD_X
  visibleMain.forEach((id) => {
    const isT = isTerm(id)
    const w = isT ? HTERM_W : HNODE_W
    const h = isT ? HTERM_H : HNODE_H
    mainPos[id] = { left: x, top: axisY - h / 2, width: w, height: h }
    x += w + HGAP
  })
  const totalWidth = Math.max(640, x + PAD_X - HGAP)
  const totalHeight = (hasBelow ? axisY + HBRANCH_DY + HNODE_H / 2 : axisY + HNODE_H / 2) + PAD_Y

  const branchPos: Record<string, HPlacedPos> = {}
  branches.forEach((b) => {
    const anchor = mainPos[b.rowAnchor]
    if (!anchor || !configs[b.id]) return
    branchPos[b.id] = {
      left: anchor.left,
      top: b.side === 'left' ? axisY - HBRANCH_DY - HNODE_H / 2 : axisY + HBRANCH_DY - HNODE_H / 2,
      width: HNODE_W,
      height: HNODE_H,
    }
  })

  const nodes: HPlacedNode[] = []
  const terminals: HPlacedTerm[] = []
  visibleMain.forEach((id) => {
    if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
    else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false })
  })
  branches.forEach((b) => {
    if (branchPos[b.id] && configs[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true })
  })

  // 主链横向连线
  const mainEdges: HEdge[] = []
  for (let i = 0; i < visibleMain.length - 1; i++) {
    const a = mainPos[visibleMain[i]]
    const b = mainPos[visibleMain[i + 1]]
    if (!a || !b) continue
    mainEdges.push({
      d: `M${a.left + a.width} ${axisY} L${b.left} ${axisY}`,
      rule: Boolean(configs[visibleMain[i + 1]] && /规则/.test(configs[visibleMain[i + 1]].title)),
    })
  }

  // 旁路 bezier
  const branchEdges: HEdge[] = []
  branches.forEach((b) => {
    const bp = branchPos[b.id]
    const mainEnd = b.edgeFrom === b.id ? b.edgeTo : b.edgeFrom
    const mp = mainPos[mainEnd]
    if (!bp || !mp) return
    const bx = bp.left + bp.width / 2
    const by = b.side === 'left' ? bp.top + bp.height : bp.top
    const mx = mp.left + mp.width / 2
    const my = axisY
    branchEdges.push({ d: `M${mx} ${my} C${mx} ${(my + by) / 2} ${bx} ${(my + by) / 2} ${bx} ${by}`, rule: false })
  })

  // 0707 优化·Phase6：决策/分头节点的 chain 内节点平铺在 owner 节点下方一行（简化版分支列支持，
  // 跟 BranchSeed 旁路挂靠共用同一行 y=axisY+HBRANCH_DY，横向间距固定；ResultView 节点条 / CompareResultPane 随动）
  // 多个 owner 的 chain 节点共用 y 行，横向从 owner.left 顺次排列；空 chain 跳过
  const hbranchGroupByOwner: Record<string, FlowBranchGroup> = {}
  for (const g of branchGroups) hbranchGroupByOwner[g.ownerId] = g
  let chainDx = 0
  let chainHasAny = false
  // 先确定是否有 chain 节点，决定是否需要往下扩展 totalHeight
  for (const id of visibleMain) {
    const g = hbranchGroupByOwner[id]
    if (!g) continue
    for (const b of g.branches) {
      if (b.chain.length) { chainHasAny = true; break }
    }
    if (chainHasAny) break
  }
  const chainYTop = axisY + HBRANCH_DY - HNODE_H / 2
  for (const id of visibleMain) {
    const g = hbranchGroupByOwner[id]
    if (!g) continue
    let cx = mainPos[id] ? mainPos[id].left : 0
    for (const b of g.branches) {
      for (const nid of b.chain) {
        if (!configs[nid]) continue
        const existing = nodes.find((n) => n.id === nid)
        if (existing) continue
        nodes.push({ id: nid, cfg: configs[nid], pos: { left: cx, top: chainYTop, width: HNODE_W, height: HNODE_H }, branch: true })
        cx += HNODE_W + HGAP
        chainDx = Math.max(chainDx, cx)
      }
    }
  }

  return {
    nodes,
    terminals,
    mainEdges,
    branchEdges,
    totalWidth: Math.max(totalWidth, chainDx + PAD_X),
    totalHeight: chainHasAny ? chainYTop + HNODE_H + PAD_Y : totalHeight,
    axisY,
  }
}

export interface SourceSeed { main: string[]; branches: BranchSeed[]; configs: Record<string, NodeConfig> }

/** 主链上从 beforeIdx 起向前找最近一个有输出表的节点（不含 beforeIdx 自身），供输入表自动继承（0701 问题五） */
function upstreamOutputTableOf(main: string[], configs: Record<string, NodeConfig>, beforeIdx: number): string {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    const c = configs[main[i]]
    if (c) {
      const t = nodeOutputTable(c)
      if (t) return t
    }
  }
  return ''
}

/**
 * 节点有效输入表（0701 问题五）：显式设置优先；否则主链节点继承上一个有输出表的节点，
 * 旁路节点继承锚点节点；均无则空（即"无上游可继承"，通常只发生在主链首节点）。
 * 0707 优化·Phase6 补：决策/分头分支 chain 内节点继承同分支内前一个有输出表的节点；
 * chain 内均无则继承 owner 节点"流入"的表——owner 是决策/分头逻辑节点，本身不产表，
 * 递归取 owner 的 effectiveInputTable（= 流入 owner 的上游数据），而非 owner 自己的输出表（恒为空）。
 */
export function effectiveInputTable(
  main: string[],
  branches: BranchSeed[],
  configs: Record<string, NodeConfig>,
  id: string,
  branchGroups: FlowBranchGroup[] = [],
): string {
  const c = configs[id]
  if (!c) return ''
  const own = nodeInputTable(c)
  if (own) return own
  const idx = main.indexOf(id)
  if (idx >= 0) return upstreamOutputTableOf(main, configs, idx)
  const branch = branches.find((b) => b.id === id)
  if (branch) {
    const anchor = configs[branch.rowAnchor]
    return anchor ? nodeOutputTable(anchor) : ''
  }
  for (const bg of branchGroups) {
    for (const b of bg.branches) {
      const ci = b.chain.indexOf(id)
      if (ci < 0) continue
      for (let i = ci - 1; i >= 0; i--) {
        const t = configs[b.chain[i]] ? nodeOutputTable(configs[b.chain[i]]) : ''
        if (t) return t
      }
      return effectiveInputTable(main, branches, configs, bg.ownerId, branchGroups)
    }
  }
  return ''
}

/** 是否主链首个数据节点（无上游节点；0701 问题五："从第二个步骤开始有输入表"，首节点无输入表） */
export function isFirstMainNode(main: string[], configs: Record<string, NodeConfig>, id: string): boolean {
  const idx = main.indexOf(id)
  if (idx < 0) return false
  for (let i = 0; i < idx; i++) {
    if (configs[main[i]]) return false
  }
  return true
}

// ---------- 流程构造辅助（backfillOutputTables 供 seeds.ts 的 makeStandardFlow / buildFlow 使用）----------

/** 链路构造后回填（0701 问题二 Q1/Q2 口径）：非采集数据类节点的输出表默认取上游节点的表；旁路节点取锚点节点的表 */
export function backfillOutputTables(def: FlowDef): FlowDef {
  let upstream = ''
  def.main.forEach((id) => {
    const c = def.configs[id]
    if (!c) return
    const t = nodeOutputTable(c)
    if (t) {
      upstream = t
      return
    }
    if (!c.collectCfg && isDataNode(c) && upstream) c.outputTable = upstream
  })
  def.branches.forEach((b) => {
    const c = def.configs[b.id]
    if (!c || c.collectCfg || !isDataNode(c)) return
    // 此时 c.collectCfg 已 guard 为 undefined，c.outputTable 是必访问字段
    if (c.outputTable) return
    const anchor = def.configs[b.rowAnchor]
    const t = anchor ? nodeOutputTable(anchor) : ''
    if (t) c.outputTable = t
  })
  return def
}
