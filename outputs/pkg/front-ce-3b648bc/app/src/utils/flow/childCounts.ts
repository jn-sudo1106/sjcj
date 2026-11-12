/**
 * 「下级」条数（0903 H10）：当前节点的每一行，在**后继节点的输出表**里各产出了多少条。
 *
 * 会上的原话把这件事讲得很直白：源视图里那个 `7` 表示"这个源下面有 7 条数据"，
 * 进去看到 7 行；那么这 7 行里的第一行，如果在下一个节点又processed 出 5 条，
 * 这一行上也该有个 `5`。**每一层都要能看到下一层有多少**——这是同一个模型的两层视图，
 * 不是某一页的特例。
 *
 * 实现走 `entry/summaryEntryData`（旧平台 SummaryDataModal 用的那条），按 `PARENT_ID`
 * 分组计数：一次请求拿回整页所有行的下级条数，而不是一行发一枪。
 *
 * ⚠️ **两个前提尚未实测**（0903 后端需求 H5，见 CHILD_COUNT_MODE）：
 *   a. `summaryFields` 能不能传系统列 `PARENT_ID`（现在传的都是业务列 K1/K2）
 *   b. `more`（前端叫 `sql`）里能不能写 `PARENT_ID IN (...)`，以及 `IN` 的长度上限
 * 任一条不成立就把 `CHILD_COUNT_MODE` 切成 `'perRow'`，调用方不用改。
 */
import { dataApi } from '@/api'
import {
  directSuccessorIds,
  effectiveOutputTable,
  type FlowBranchGroup,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'

/**
 * `'summary'`：一次 GROUP BY 拿回整页（默认，等 H5 实测确认）。
 * `'perRow'`：逐行查 `total`。**降级模式下不预取整页**——20 行就是 20 枪，翻页就打 20 枪，
 * 只在用户主动点开某一行的下级时才查（由调用方按 `isPerRow` 决定要不要预取）。
 */
export type ChildCountMode = 'summary' | 'perRow'
export const CHILD_COUNT_MODE = 'summary' as ChildCountMode
export const isPerRowMode = () => CHILD_COUNT_MODE === 'perRow'

/** `PARENT_ID IN (...)` 的分组大小。太长的 IN 有被后端或数据库拒绝的风险，200 是个保守值。 */
export const PARENT_ID_CHUNK = 200
/** 并发上限：分组请求并行发，但不要一次把连接池打满 */
const MAX_CONCURRENCY = 3

/** 一个后继节点及其输出表 */
export interface ChildTarget {
  nodeId: string
  /** 节点名，用于多后继时的 tooltip 拆分展示 */
  title: string
  tableId: string
}

export interface FlowShape {
  main: string[]
  configs: Record<string, NodeConfig>
  branchGroups?: FlowBranchGroup[]
}

/**
 * 当前节点的后继节点 + 它们各自的输出表。
 *
 * 走 `directSuccessorIds`（0831 X3-7 加的那个，与「下一步字段」同一套拓扑解析）——
 * 不另写一份后继判定，两套迟早漂移。分支节点会返回多张表，调用方要把它们的条数合计。
 * 没有输出表的后继直接跳过：它们不落数据，谈不上"下级几条"。
 */
export function resolveChildTargets(flow: FlowShape, nodeId: string): ChildTarget[] {
  if (!nodeId) return []
  const { main, configs, branchGroups = [] } = flow
  const seen = new Set<string>()
  const targets: ChildTarget[] = []
  for (const id of directSuccessorIds(main, configs, nodeId, branchGroups)) {
    const cfg = configs[id]
    if (!cfg) continue
    const tableId = effectiveOutputTable(cfg)
    if (!tableId || seen.has(`${id}:${tableId}`)) continue
    seen.add(`${id}:${tableId}`)
    targets.push({ nodeId: id, title: cfg.title || id, tableId })
  }
  return targets
}

/** 把 ids 切成不超过 size 的组 */
export function chunk<T>(ids: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/** `PARENT_ID IN ('a','b')`。id 里的单引号转义成 SQL 的两个单引号，与 buildLegacyMore 同法。 */
export function parentIdInClause(parentIds: string[]): string {
  const quoted = parentIds.map((id) => `'${String(id).replaceAll("'", "''")}'`)
  return `PARENT_ID IN (${quoted.join(',')})`
}

/** 有限并发地跑一批任务，保持顺序无关（结果由调用方自行合并） */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)))
  }
  return out
}

/**
 * 查一张子表里，这批父行各自有几条下级数据。
 *
 * 返回 `Map<parentId, count>`；**没有下级的父行不会出现在 Map 里**（GROUP BY 不会给出
 * 计数为 0 的组），调用方取不到就按 0 处理。
 */
export async function fetchChildCounts(tableId: string, parentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const ids = [...new Set(parentIds.map((id) => String(id)).filter((id) => id && id !== '0'))]
  if (!tableId || !ids.length) return counts
  const groups = await mapWithConcurrency(
    chunk(ids, PARENT_ID_CHUNK),
    MAX_CONCURRENCY,
    (group) => dataApi.summaryData({ tableId, sql: parentIdInClause(group) }, ['PARENT_ID']),
  )
  for (const rows of groups) {
    for (const row of rows) {
      // 分组列的键名由后端按 summaryFields 回显，大小写不保证，两种都认
      const parentId = row.PARENT_ID ?? row.parent_id
      if (parentId === undefined || parentId === null) continue
      const key = String(parentId)
      counts.set(key, (counts.get(key) ?? 0) + Number(row.CNT ?? 0))
    }
  }
  return counts
}

/** 降级模式：单行单表查一次，只要 total */
export async function fetchChildCountForRow(tableId: string, parentId: string): Promise<number> {
  if (!tableId || !parentId || parentId === '0') return 0
  const res = await dataApi.rowQueryPaged({ tableId, parentId, page: 1, size: 1 })
  return res.total ?? 0
}

/** 一行的下级明细：按后继节点拆开 + 合计 */
export interface ChildCountCell {
  total: number
  /** 多后继时拆开展示用；单后继也填，调用方自己决定要不要显示 */
  byTarget: { nodeId: string; title: string; tableId: string; count: number }[]
}

/**
 * 整页一次算完：对每个后继表各发一轮分组统计，再按行合并。
 *
 * 失败**不抛给调用方去中断表格渲染**——那会让"统计挂了"变成"数据看不了"。这里让整个
 * 调用返回 null，由调用方把该列显示成 `?`（Y1-14）。
 */
export async function fetchChildCountsForPage(
  targets: ChildTarget[],
  parentIds: string[],
): Promise<Map<string, ChildCountCell> | null> {
  const cells = new Map<string, ChildCountCell>()
  if (!targets.length || !parentIds.length) return cells
  try {
    const perTarget = await mapWithConcurrency(
      targets,
      MAX_CONCURRENCY,
      async (target) => ({ target, counts: await fetchChildCounts(target.tableId, parentIds) }),
    )
    for (const id of parentIds) {
      const key = String(id)
      const byTarget = perTarget.map(({ target, counts }) => ({
        nodeId: target.nodeId,
        title: target.title,
        tableId: target.tableId,
        count: counts.get(key) ?? 0,
      }))
      cells.set(key, { total: byTarget.reduce((sum, item) => sum + item.count, 0), byTarget })
    }
    return cells
  } catch {
    return null
  }
}
