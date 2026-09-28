// 节点表联动（0928，设计稿/设计方案/0928-首节点新增与节点表联动_开发设计方案_2026-09-28.md §3）。
//
// 口径：输入表默认取上游节点的输出表；非采集节点的输出表默认 = 自己的输入表；采集节点输出表必填、不跟随。
//
// 加载后每个节点的表都是显式值（步骤 entryTypeId / outEntry 原样回填），画布的继承规则
// （effectiveInputTable）对已有节点不生效——插入 / 删除 / 改表时下游不会跟着变。这里不清空显式值
// （规则类节点的字段勾选与列名映射读 ruleCfg/execCfg.inputTableId，清掉会弄坏），而是在变动时
// **按值推断谁在跟随**，主动改写下游：
//   - 下游 S 的输入表 == 上游变动前的有效输出表 → S 跟随上游，改成新值；
//   - 非采集 S 的输出表 == 它自己变动前的输入表 → 输出表跟随输入表，一起改；
//   - 不相等 = 用户自己指定，保留不动，传播到此为止。
import {
  directSuccessorIdsIncludingDisabled,
  effectiveInputTable,
  nodeInputTable,
  nodeOutputTable,
  type BranchSeed,
  type FlowBranchGroup,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'

export interface TableTopology {
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  branchGroups: FlowBranchGroup[]
}

/** 写节点输入表：采集类存 collectCfg，其余存顶层；规则类同步 ruleCfg / execCfg（表配置与列名映射读它们）。 */
export function writeNodeInputTable(cfg: NodeConfig, tableId: string): void {
  if (cfg.collectCfg) cfg.collectCfg.inputTable = tableId
  else cfg.inputTable = tableId
  if (cfg.ruleCfg) cfg.ruleCfg.inputTableId = tableId
  if (cfg.execCfg) cfg.execCfg.inputTableId = tableId
}

/** 写非采集节点输出表（采集节点输出表必填、不跟随，这里不碰）。 */
export function writeNodeOutputTable(cfg: NodeConfig, tableId: string): void {
  if (cfg.collectCfg) return
  cfg.outputTable = tableId
  if (cfg.ruleCfg) cfg.ruleCfg.outputTableId = tableId
  if (cfg.execCfg) cfg.execCfg.outputTableId = tableId
}

/**
 * 下游实际从本节点读到的表：有输出表就是输出表，没有（采集节点还没选 / 非采集默认 = 输入表）就是
 * 它自己拿到的输入表——与画布继承规则一致（upstreamOutputTableOf 跳过没输出表的节点继续往上找）。
 * 不能用 effectiveOutputTable：采集节点缺输出表时它返回空（保存口径），传播旧值就对不上下游了。
 */
export function tableForDownstream(cfg: NodeConfig): string {
  return nodeOutputTable(cfg) || nodeInputTable(cfg)
}

/** 节点当前的表（变动前留底，给 withTableSync 判断「输出表是否原本跟着输入表」与传播旧值）。 */
export function nodeTablesSnapshot(cfg: NodeConfig): { input: string; output: string; effectiveOutput: string } {
  return { input: nodeInputTable(cfg), output: nodeOutputTable(cfg), effectiveOutput: tableForDownstream(cfg) }
}

/** 上游给到本节点的表（忽略本节点自己设的输入表）；首节点 / 无上游返回空串。 */
export function upstreamTableFor(topo: TableTopology, id: string): string {
  const cfg = topo.configs[id]
  if (!cfg) return ''
  const bare: NodeConfig = {
    ...cfg,
    inputTable: '',
    ...(cfg.collectCfg ? { collectCfg: { ...cfg.collectCfg, inputTable: '' } } : {}),
  }
  return effectiveInputTable(topo.main, topo.branches, { ...topo.configs, [id]: bare }, id, topo.branchGroups)
}

/** 新增节点：没设输入表时显式写成上游的有效输出表（保存时 entryTypeId 才不为空）。 */
export function inheritInputTable(topo: TableTopology, id: string): void {
  const cfg = topo.configs[id]
  if (!cfg || nodeInputTable(cfg)) return
  const upstream = upstreamTableFor(topo, id)
  if (upstream) writeNodeInputTable(cfg, upstream)
}

/**
 * 把一批下游节点从旧表改挂到新表（只改跟随旧表的那些），并继续向下传播。
 * @returns 被改写的节点 id
 */
export function retargetFollowers(
  topo: TableTopology,
  ids: string[],
  oldTable: string,
  newTable: string,
  visited: Set<string> = new Set(),
): string[] {
  if (oldTable === newTable) return []
  const changed: string[] = []
  for (const sid of ids) {
    const cfg = topo.configs[sid]
    if (!cfg || visited.has(sid)) continue
    if (nodeInputTable(cfg) !== oldTable) continue
    const prevOut = tableForDownstream(cfg)
    writeNodeInputTable(cfg, newTable)
    if (!cfg.collectCfg && nodeOutputTable(cfg) === oldTable) writeNodeOutputTable(cfg, newTable)
    changed.push(sid, ...propagateOutputChange(topo, sid, prevOut, visited))
  }
  return changed
}

/**
 * 节点有效输出表变了（改表 / 更换配置 / 被上游联动）：跟随它的直接下游改成新值，递归向下。
 * @param oldOutput 变动前下游读到的表（tableForDownstream）
 * @returns 被改写的下游节点 id（不含本节点）
 */
export function propagateOutputChange(
  topo: TableTopology,
  id: string,
  oldOutput: string,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(id)) return []
  visited.add(id)
  const cfg = topo.configs[id]
  if (!cfg) return []
  const next = tableForDownstream(cfg)
  // 新值为空也照样传播：上游清空输出表 = 链路断了，跟随的下游一起清空，校验才能报出「缺少输入表」
  if (next === oldOutput) return []
  const successors = directSuccessorIdsIncludingDisabled(topo.main, topo.configs, id, topo.branchGroups)
  return retargetFollowers(topo, successors, oldOutput, next, visited)
}

/** 用户自己指定的输入表与上游输出表不一致（上游变动时不会自动跟随）。无上游 / 未设置返回 null。 */
export function inputTableMismatch(topo: TableTopology, id: string): { own: string; upstream: string } | null {
  const cfg = topo.configs[id]
  if (!cfg) return null
  const own = nodeInputTable(cfg)
  if (!own) return null
  const upstream = upstreamTableFor(topo, id)
  return upstream && upstream !== own ? { own, upstream } : null
}
