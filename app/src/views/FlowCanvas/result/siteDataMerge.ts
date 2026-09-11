// 网站"全部源"数据归并（0812 计划 M2-5A）：旧接口 entry/entryDataPaged 的 sourceId 是
// Long 单值，不支持一次查多个源（已实测确认，见方案 §6.2.1 R1）。这里改成向每个相关源
// 分别取"当前已知最大"的一条，做标准 top-K 归并，得到"整个网站按某字段排序的前 N 条"。
//
// 正确性前提：每个源返回的分页本身必须按归并字段降序——不然"某源前 N 条"就不是真的
// 前 N 条，归并结果也就不对。旧平台参考页面 EntryList2.vue 从未真正用过 sortField/
// sortOrder（api/types/data.ts 顶部注释标注为"死分支，不迁移"），后端是否真的照办未经
// 实测（见计划 §3.2 Q9 追加项）。因此这里对每一批拿到的数据做客户端二次排序兜底，
// 保证归并算法本身是自洽、正确的，不管后端排序参数最终生效与否。
import type { DataRow } from '@/api'

export interface MergeRow {
  dataId: string
}

export interface MergeSourceState<T extends MergeRow = DataRow> {
  sourceId: string
  /** 已取到但还没展示的行，按归并键降序排列，弹出取 [0] */
  buffer: T[]
  /** 下一次要取的页码（从 1 开始） */
  nextPage: number
  /** 该源的数据已经取完（最近一页返回条数 < size） */
  exhausted: boolean
  /** 最近一次尝试补页失败；不等于 exhausted，下次 load more 会重新给机会 */
  failed: boolean
  /** 最近一次失败原因，供调用方展示可定位的部分失败提示。 */
  error: string
}

export function initMergeState<T extends MergeRow = DataRow>(sourceIds: string[]): MergeSourceState<T>[] {
  return sourceIds.map((sourceId) => ({ sourceId, buffer: [], nextPage: 1, exhausted: false, failed: false, error: '' }))
}

function mergeKey<T extends MergeRow>(row: T): number {
  const n = Number(row.dataId)
  return Number.isFinite(n) ? n : 0
}

/** 归并方向。只有这一个维度可调——归并键固定是 dataId(ENTRY_ID)，见本文件顶部说明。 */
export type MergeOrder = 'ascend' | 'descend'

function sortRows<T extends MergeRow>(rows: T[], order: MergeOrder): T[] {
  return [...rows].sort((a, b) => (order === 'ascend' ? mergeKey(a) - mergeKey(b) : mergeKey(b) - mergeKey(a)))
}

export type FetchPage<T extends MergeRow = DataRow> = (sourceId: string, page: number, size: number) => Promise<T[]>

async function refill<T extends MergeRow>(states: MergeSourceState<T>[], size: number, fetchPage: FetchPage<T>, maxParallel: number, order: MergeOrder): Promise<void> {
  // 已经标记 failed 的源本轮不重试，避免一个持续报错的源在同一次 load more 里被反复打；
  // failed 会在下一次 mergeLoadMore 调用开头统一重置，下次点"加载更多"会再给一次机会。
  const needRefill = states.filter((s) => !s.exhausted && !s.failed && s.buffer.length === 0)
  let next = 0
  const workers = Math.min(needRefill.length, Number.isFinite(maxParallel) ? Math.max(1, Math.floor(maxParallel)) : needRefill.length)
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < needRefill.length) {
      const s = needRefill[next++]
      try {
        const rows = sortRows(await fetchPage(s.sourceId, s.nextPage, size), order)
        s.buffer = rows
        s.nextPage += 1
        s.exhausted = rows.length < size
      } catch (error) {
        s.failed = true
        s.error = error instanceof Error ? error.message : String(error)
      }
    }
  }))
}

/**
 * 弹出当前所有源 buffer 里**排在最前**的一条：降序取最大、升序取最小。
 * 调用前必须先 refill，否则会漏掉刚好 buffer 空的源。
 */
function popNext<T extends MergeRow>(states: MergeSourceState<T>[], order: MergeOrder): T | null {
  let best: MergeSourceState<T> | null = null
  for (const s of states) {
    if (!s.buffer.length) continue
    if (!best) { best = s; continue }
    const ahead = order === 'ascend'
      ? mergeKey(s.buffer[0]) < mergeKey(best.buffer[0])
      : mergeKey(s.buffer[0]) > mergeKey(best.buffer[0])
    if (ahead) best = s
  }
  return best ? (best.buffer.shift() ?? null) : null
}

export interface MergeLoadMoreResult<T extends MergeRow = DataRow> {
  rows: T[]
  states: MergeSourceState<T>[]
  /** 本次调用中发生过查询失败的源 ID；不代表整体失败，部分结果仍然有效 */
  failedSourceIds: string[]
  /** 失败源及其本次请求错误；保留 failedSourceIds 兼容既有数据视图。 */
  failedSources: { sourceId: string; error: string }[]
  /** 所有源都已真正取完（不含失败），不会再有更多数据 */
  allExhausted: boolean
}

/**
 * 归并加载：在已有 states（含之前调用剩下的 buffer）基础上，继续往下取最多 count 条。
 * 每弹出一条前都先补齐空 buffer 的源，保证每一步弹出的确实是"当前已知全局最大"。
 */
export async function mergeLoadMore<T extends MergeRow>(
  states: MergeSourceState<T>[],
  count: number,
  size: number,
  fetchPage: FetchPage<T>,
  maxParallel = Number.POSITIVE_INFINITY,
  order: MergeOrder = 'descend',
): Promise<MergeLoadMoreResult<T>> {
  states.forEach((s) => { s.failed = false; s.error = '' })
  const rows: T[] = []
  const failedSourceIds = new Set<string>()
  while (rows.length < count) {
    await refill(states, size, fetchPage, maxParallel, order)
    states.forEach((s) => { if (s.failed) failedSourceIds.add(s.sourceId) })
    const picked = popNext(states, order)
    if (!picked) break
    rows.push(picked)
  }
  const failedSources = states.filter((s) => s.failed).map((s) => ({ sourceId: s.sourceId, error: s.error || '请求失败' }))
  // allExhausted 要同时满足两条：① 每个源都没有更多页可取（s.exhausted）；② 每个源 buffer 里
  // 已取回但还没弹出的行也都清空了。只看 s.exhausted 会漏 ②：一轮 mergeLoadMore 弹够 count 条
  // 就返回，各源 buffer 里常留着已经从后端取回的行；此时若报 allExhausted=true，调用方就停在
  // 半路，那些行再也不会被 append 进结果——表现为表头「共 488 条」但只加载 220 条就显示
  // 「已加载全部数据」（2026-09-10 生产实测，测试网站0907 / TB_CNEWS，源多、每源行数少时必现）。
  const allExhausted = states.every((s) => s.exhausted && s.buffer.length === 0)
  return { rows, states, failedSourceIds: [...failedSourceIds], failedSources, allExhausted }
}
