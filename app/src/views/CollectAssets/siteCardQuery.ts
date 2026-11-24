import { applySiteFavoriteStates } from '@/utils/siteFavorites'
import { siteApi, type Site, type Source } from '@/api'
import type { SiteScopeSort } from '@/api/sourceDirectoryScope'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'

export interface SiteCardSourceScope {
  query: SourceFilter
  matches: Record<string, { total: number; list: Source[] }>
  /** The server has already supplied every card's preview and authoritative site total. */
  serverPaged?: boolean
  /**
   * 是否真的带了源筛选 / 目录范围（1123 A4）。没有条件时命中数 = 全站数，卡片底部只写「N 个源」，
   * 不显示「命中 N / 共 N」；缺省按有筛选处理（兼容其它调用方）。
   */
  filtered?: boolean
}

/** 查询里是否有实际生效的条件：非空值，或目录范围不是 none */
export function hasSourceFilter(query: SourceFilter): boolean {
  if (query.directory && query.directory.mode !== 'none') return true
  // 排序与目录文案不是筛选条件
  const ignored = new Set(['directory', 'field', 'sorted', 'type', 'dirLabel'])
  return Object.entries(query).some(([key, value]) => !ignored.has(key)
    && (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== ''))
}
export interface SiteCardResult {
  sites: Site[]
  total: number
  matchedSourceTotal: number
  sourceScope?: SiteCardSourceScope
  unbound: number
}
// Retained for old refresh callers; the new read model deliberately has no browser result cache.
export function clearSiteCardQueryCache(): void {}

export async function querySiteCards(
  query: SourceFilter,
  options: { page: number; size: number; sort: SiteScopeSort; isCurrent: () => boolean; includeEmptySiteIds?: string[]; signal?: AbortSignal },
): Promise<SiteCardResult> {
  const checkCurrent = () => { if (!options.isCurrent()) throw new DOMException('查询已取消', 'AbortError') }
  checkCurrent()
  // Source ordering is UI state of the source list, never a website ordering instruction.
  const { directory, ...sourceFilter } = query
  delete sourceFilter.field
  delete sourceFilter.sorted
  delete sourceFilter.type
  delete sourceFilter.dirLabel
  const result = await siteApi.sourceScopePaged({ page: options.page, limit: options.size, sort: options.sort, sourceFilter, directory, includeEmptySiteIds: options.includeEmptySiteIds }, options.signal)
  checkCurrent()
  applySiteFavoriteStates(result.list.map(row => ({ siteId: row.site.siteId, favorited: row.favorited })))
  const matches: SiteCardSourceScope['matches'] = {}
  result.list.forEach(row => { matches[row.site.siteId] = { total: row.matchedSourceCount, list: row.sourcePreview } })
  return { sites: result.list.map(row => row.site), total: result.total, matchedSourceTotal: result.matchedSourceTotal,
    unbound: result.unboundSourceTotal, sourceScope: { query, matches, serverPaged: true, filtered: hasSourceFilter(query) } }
}
