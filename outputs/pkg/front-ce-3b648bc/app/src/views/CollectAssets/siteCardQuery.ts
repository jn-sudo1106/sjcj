import { applySiteFavoriteStates } from '@/utils/siteFavorites'
import { siteApi, type Site, type Source } from '@/api'
import type { SiteScopeSort } from '@/api/sourceDirectoryScope'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'

export interface SiteCardSourceScope {
  query: SourceFilter
  matches: Record<string, { total: number; list: Source[] }>
  /** The server has already supplied every card's preview and authoritative site total. */
  serverPaged?: boolean
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
    unbound: result.unboundSourceTotal, sourceScope: { query, matches, serverPaged: true } }
}
