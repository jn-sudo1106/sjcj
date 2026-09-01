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
  name?: string
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
  if (query.name) parts.push(`名称含「${query.name}」`)
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

export type BatchLaunchResult = {
  sent: number
  failed: FailedBatch[]
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
  opts?: { batchSize?: number; onBatch?: (done: number, total: number) => void },
): Promise<BatchLaunchResult> {
  const batches = chunkIds(ids, opts?.batchSize ?? LAUNCH_BATCH_SIZE)
  const failed: FailedBatch[] = []
  let sent = 0
  for (const batch of batches) {
    try {
      await send(batch)
      sent += batch.length
    } catch (error) {
      failed.push({ ids: batch, error: error instanceof Error ? error.message : String(error) })
    }
    opts?.onBatch?.(sent + failed.reduce((n, item) => n + item.ids.length, 0), ids.length)
  }
  return { sent, failed }
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
    source.newInCount == null ? '' : String(source.newInCount),
    source.successCount == null ? '' : String(source.successCount),
    source.lastTaskAt || '',
    source.lastSuccessAt || '',
  ]
}
