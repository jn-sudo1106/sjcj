import type { FlowBranchGroup } from './flowModel'

/**
 * 父子关系 → 画布的「主链 + 分支组」（1008-BR-02，从 buildSourceSeed 抽出，行为不变）。
 *
 * 旧平台每个步骤只有一个 lastStep，树在任意深度都可能分叉，没有汇合点：
 *   - 主链从第一个根位节点沿**单后继**走，遇到分叉就停；分叉点以下全部进分支组（ownerId = 分叉点本身，
 *     不合成决策节点，0903 YB-B）；
 *   - 分支链里再遇分叉，整棵子树交给嵌套 subGroups（0925 完整还原）。
 *
 * 画布还原（buildSourceSeed）和画布编辑（新建分支 / 插入 / 删除，1008-BR-03）共用这一个函数，
 * 保证编辑后看到的拓扑与「保存 → 刷新」重建出来的一致。
 */
export interface TopologyInput {
  /** 全部节点 id，按同级展示顺序排（还原时 = 接口顺序，即步骤 ID 升序） */
  order: string[]
  /** 画布连线用的上级；没有（或上级不在 order 里）= 根位节点 */
  parentOf: ReadonlyMap<string, string | undefined>
  /**
   * 根位节点里带显式 lastStep / 根标记的那些：第一个根之外，只有它们按「挂在根上」并到入口根下方
   * 作为附加分支链；其余（mock / 演示源没有 lastStep 的行）平铺进主链尾，不编造拓扑（0925）。
   */
  anchored: ReadonlySet<string>
  /** 分支标签（旧平台没有分支标签，取目标节点名最接近事实） */
  labelOf: (id: string) => string | undefined
}

export function topologyFromParents(input: TopologyInput): { main: string[]; branchGroups: FlowBranchGroup[] } {
  const { order, parentOf, anchored, labelOf } = input
  const known = new Set(order)
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const id of order) {
    const parent = parentOf.get(id)
    if (parent && known.has(parent)) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id])
    else roots.push(id)
  }

  const placed = new Set<string>()
  const branchOf = (ownerId: string, kid: string, i: number) => {
    const seed = branchTreeOf(kid, childrenOf, placed, labelOf)
    return {
      id: `${ownerId}-b${i + 1}`,
      label: labelOf(kid) || `分支 ${i + 1}`,
      // condition 刻意**不填**：条件属于目标步骤自己（entryCondition），复制一份到分支上就有了
      // 两个真值来源。连线上的条件文案由渲染侧从目标节点读。
      chain: seed.chain,
      ...(seed.subGroups.length ? { subGroups: seed.subGroups } : {}),
    }
  }

  const main: string[] = ['start']
  const branchGroups: FlowBranchGroup[] = []
  let cursor: string | undefined = roots[0]
  while (cursor && !placed.has(cursor)) {
    placed.add(cursor)
    main.push(cursor)
    const owner: string = cursor
    const kids: string[] = childrenOf.get(owner) ?? []
    if (kids.length <= 1) {
      cursor = kids[0]
      continue
    }
    branchGroups.push({ ownerId: owner, branches: kids.map((kid, i) => branchOf(owner, kid, i)) })
    cursor = undefined
  }

  // 多根兜底（0925）：第一个根之外仍有「挂根」步骤（响应里没有 itemConfig=0 那行时 lastStep='0'
  // 落到这里；lastStep 指向集合外的孤儿；重复的 isRoot 起点）——按「挂在根上」都是入口根的直接
  // 子步骤，并到入口根下方作为附加分支链，子树一起归位（2026-09-25 源 430024432）。
  if (roots.length > 1) {
    const extra = roots.slice(1).filter((id) => !placed.has(id) && anchored.has(id))
    if (extra.length) {
      const entry = roots[0]
      const existing = branchGroups.find((g) => g.ownerId === entry)
      const branches = existing?.branches ?? []
      for (const root of extra) branches.push(branchOf(entry, root, branches.length))
      if (existing) existing.branches = branches
      else branchGroups.push({ ownerId: entry, branches })
    }
  }
  // 兜底：成环走不到的节点、未标记的根位节点，一个都不能丢——画得不准可以接受，节点凭空消失不行。
  for (const id of order) {
    if (!placed.has(id)) {
      placed.add(id)
      main.push(id)
    }
  }
  main.push('end')
  return { main, branchGroups }
}

/** 从某个节点起递归编成分支链：沿单后继串 chain，遇到分叉（≥2 后继）把整棵子树交给嵌套 subGroups，
 *  chain 到此为止（模型无汇合概念）。 */
function branchTreeOf(
  startId: string,
  childrenOf: Map<string, string[]>,
  placed: Set<string>,
  labelOf: (id: string) => string | undefined,
): { chain: string[]; subGroups: FlowBranchGroup[] } {
  const chain: string[] = []
  const subGroups: FlowBranchGroup[] = []
  let cur: string | undefined = startId
  while (cur && !placed.has(cur)) {
    placed.add(cur)
    chain.push(cur)
    const kids: string[] = childrenOf.get(cur) ?? []
    if (kids.length > 1) {
      const owner: string = cur
      subGroups.push({
        ownerId: owner,
        branches: kids.map((kid, i) => {
          const seed = branchTreeOf(kid, childrenOf, placed, labelOf)
          return {
            id: `${owner}-b${i + 1}`,
            label: labelOf(kid) || `分支 ${i + 1}`,
            chain: seed.chain,
            ...(seed.subGroups.length ? { subGroups: seed.subGroups } : {}),
          }
        }),
      })
      break
    }
    cur = kids[0]
  }
  return { chain, subGroups }
}
