/**
 * 源视图「发任务 / 导出」的范围解析与分页收集（0831 X2）。
 *
 * 两件必须钉死的事：
 *  1. **不要把 `all=1` 当成「发全部源」**。旧 `SourceParam.vue` 那个复选框文案是「所有参数」，
 *     传 `all=1` 会触发参数全排列展开，跟"发全部源"是两件事。本文件发出去的 `all` 恒为 0。
 *  2. 没有「按查询条件批量发抓取」的后端端点（门禁 G1）。全量走前端分页收 ID，再按批
 *     调同一个 `sendSnatchWithParam`。上限 5000，超了拦下让人收窄条件，不发任何请求。
 */
import type { Source } from '@/api'

export const LAUNCH_ALL_MAX = 5000
export const COLLECT_PAGE_SIZE = 500
export const LAUNCH_BATCH_SIZE = 500

export type SourceFilter = {
  siteIds?: string
  sourceIds?: string
  /** 按流程过滤（0904 I16 / Z7-2）。`sourcePaged` 服务端认这个条件——2026-09-02 实测
   *  flowId=1400330 得 46 条、与该流程 sourceCnt 一致，传不存在的得 0 条，不是静默忽略。
   *  用它而不是把源 ID 拼进 sourceIds：一个流程最多见过 5439 个源，拼 URL 不现实。 */
  flowId?: string
  name?: string
  /** 按源 URL 子串过滤（2026-09-17）。后端 `sourcePaged` 的 `sourceUrl`，与 `name` 是两个
   *  独立条件、同时给则取交集——实测 name=盛科 4 条、sourceUrl=centec 1 条、两者同给 1 条、
   *  互斥组合 0 条。注意后端**不认** `url`（传了等于没传，1073 条原样返回）。 */
  sourceUrl?: string
  state?: string
  enable?: string
  tags?: string[]
  remark?: string
  field?: string
  sorted?: number
  type?: string
}

export type LaunchScope =
  | { mode: 'selected'; ids: string[]; hitCount: number }
  | { mode: 'query'; query: SourceFilter; hitCount: number }

export type PagedSourceResult = { total: number; list: Source[] }

export class CollectLimitError extends Error {
  total: number
  max: number
  constructor(total: number, max: number) {
    super(`符合条件的源有 ${total} 个，超过上限 ${max}，请收窄筛选后再试`)
    this.name = 'CollectLimitError'
    this.total = total
    this.max = max
  }
}

export function resolveScope(selectedIds: string[], filterTotal: number, query: SourceFilter): LaunchScope {
  if (selectedIds.length) return { mode: 'selected', ids: [...selectedIds], hitCount: selectedIds.length }
  return { mode: 'query', query, hitCount: filterTotal }
}

export function isParamSource(source: Source): boolean {
  return source.kind === 'param'
}

export function partitionLaunchTargets(sources: Source[]) {
  const sendable: Source[] = []
  const disabled: Source[] = []
  const param: Source[] = []
  for (const source of sources) {
    if (source.disabled) disabled.push(source)
    else if (isParamSource(source)) param.push(source)
    else sendable.push(source)
  }
  return { sendable, disabled, param }
}

export function chunkIds(ids: string[], size = LAUNCH_BATCH_SIZE): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/** 筛选条件的人话，给确认弹窗看，不是给后端看。 */
export function describeFilters(query: SourceFilter): string {
  const parts: string[] = []
  if (query.sourceIds) parts.push(`源 ID ${query.sourceIds}`)
  if (query.flowId) parts.push(`流程 #${query.flowId}`)
  if (query.name) parts.push(`名称含「${query.name}」`)
  if (query.sourceUrl) parts.push(`URL 含「${query.sourceUrl}」`)
  if (query.state === 'C') parts.push('状态=正常')
  else if (query.state === 'L') parts.push('状态=运行中')
  else if (query.state === 'E') parts.push('状态=异常')
  if (query.enable === '1') parts.push('已停用')
  else if (query.enable === '0') parts.push('已启用')
  if (query.tags?.length) parts.push(`标签 ${query.tags.join('、')}`)
  if (query.remark) parts.push(`备注含「${query.remark}」`)
  return parts.join('，') || '当前网站全部源'
}

export function sourceStatusLabel(source: Source): string {
  if (source.disabled) return '已停用'
  return source.state === 'E' ? '异常' : source.state === 'L' ? '运行中' : '正常'
}

export async function collectAllUnderQuery(
  query: SourceFilter,
  opts: {
    fetchPage: (p: SourceFilter & { page: number; size: number }) => Promise<PagedSourceResult>
    max?: number
    pageSize?: number
    signal?: AbortSignal
    onProgress?: (got: number, total: number) => void
  },
): Promise<Source[]> {
  const max = opts.max ?? LAUNCH_ALL_MAX
  const pageSize = opts.pageSize ?? COLLECT_PAGE_SIZE
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const first = await opts.fetchPage({ ...query, page: 1, size: pageSize })
  if (first.total > max) throw new CollectLimitError(first.total, max)
  const all = [...first.list]
  opts.onProgress?.(all.length, first.total)
  const pages = Math.ceil(first.total / pageSize)
  for (let page = 2; page <= pages; page++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const next = await opts.fetchPage({ ...query, page, size: pageSize })
    all.push(...next.list)
    opts.onProgress?.(Math.min(all.length, first.total), first.total)
  }
  return all
}

export type FailedBatch = { ids: string[]; error: string }

/**
 * 批量提交的暂停/中止信号（Y4-1）。
 *
 * ⚠️ **能力边界**：这只拦得住"还没提交的批次"。循环在前端，我们能不发下一批；
 * 已经提交出去的任务**不回滚、不撤销**——服务端一侧没有任何 stop/cancel 端点
 * （2026-09-05 查 `endpoints.ts` 确认），服务端级停止是 H3，未答复。
 * 所以调用方的文案必须是「已停止提交后续批次」，不能写「已终止」。
 *
 * 用可变对象而不是回调：`sendInBatches` 在每批**之前**读一次，调用方（作业条）
 * 随时改字段即可，不必把 store 传进来。
 */
export type BatchSignal = {
  /** 暂停：卡在当前批之前等待，不丢弃剩余批次 */
  paused: boolean
  /** 中止：剩余批次直接不发，函数返回 */
  aborted: boolean
}

export type BatchLaunchResult = {
  sent: number
  failed: FailedBatch[]
  /** 因中止而**从未提交**的 ID（Y4-6 结果条要把它和 failed 分开报：
   *  失败是发了没成，未提交是压根没发，两者的补救动作不一样） */
  skipped: string[]
}

/**
 * 分批串行提交。一批失败不整体回滚（任务已下发无法撤回），继续发后面的批，
 * 失败的那些单独列出给调用方重试。
 *
 * `send` 内部必须把 `all` 写成 0——本函数不碰那个字段，契约测试锁在调用方。
 */
export async function sendInBatches(
  ids: string[],
  send: (ids: string[]) => Promise<unknown>,
  opts?: {
    batchSize?: number
    onBatch?: (done: number, total: number) => void
    /** Y4-1：每批**之前**检查。aborted 立刻返回，paused 则等到恢复或中止 */
    signal?: BatchSignal
    /** 暂停时的轮询间隔；测试里传 0 免得空转等待 */
    pollMs?: number
  },
): Promise<BatchLaunchResult> {
  const batches = chunkIds(ids, opts?.batchSize ?? LAUNCH_BATCH_SIZE)
  const failed: FailedBatch[] = []
  const signal = opts?.signal
  let sent = 0
  let index = 0
  for (const batch of batches) {
    // 检查点在**发之前**：暂停只推迟尚未发出的批次，不打断正在飞的那一个
    // （请求已经出去了，等它回来才知道成没成，中途丢弃只会让统计对不上）。
    while (signal?.paused && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, opts?.pollMs ?? 120))
    }
    if (signal?.aborted) break
    index += 1
    try {
      await send(batch)
      sent += batch.length
    } catch (error) {
      failed.push({ ids: batch, error: error instanceof Error ? error.message : String(error) })
    }
    opts?.onBatch?.(sent + failed.reduce((n, item) => n + item.ids.length, 0), ids.length)
  }
  return { sent, failed, skipped: batches.slice(index).flat() }
}

export const SOURCE_EXPORT_HEADER = [
  '源 ID', '源名称', 'URL', '主表', '标签', '备注', '状态', '数据量', '新入', '成功', '最近任务', '最近成功',
] as const

export function sourceToExportRow(source: Source): string[] {
  return [
    source.sourceId,
    source.name,
    source.url || '',
    source.mainTable || '',
    (source.tags ?? []).join('、'),
    source.remark || '',
    sourceStatusLabel(source),
    source.dataCount == null ? '' : String(source.dataCount),
    // 「新入 / 成功」= 最近入库 / 最近成功时间（对齐旧平台；导出留精确时间戳而非「N 天前」）
    source.lastInsertAt || '',
    source.lastSuccessAt || '',
    source.lastTaskAt || '',
    source.lastSuccessAt || '',
  ]
}
