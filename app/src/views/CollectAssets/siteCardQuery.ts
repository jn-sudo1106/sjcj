import { siteApi, sourceApi, type Site, type Source } from '@/api'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'

export interface SiteCardSourceScope {
  query: SourceFilter
  matches: Record<string, { total: number; list: Source[] }>
}
export interface SiteCardResult {
  sites: Site[]
  sourceScope?: SiteCardSourceScope
  unbound: number
}

// 只保留最近一次完整汇总，避免来回切换视图重复查询；刷新和源变更时主动失效。
let scopeCache: { key: string; expiresAt: number; matches: SiteCardSourceScope['matches']; unbound: number } | undefined
let cacheVersion = 0
export function clearSiteCardQueryCache(): void {
  scopeCache = undefined
  cacheVersion++
}

/** 排序和网站范围不改变单个网站内的源范围；其余条件须交给 sourcePaged，不能拿当前源页去重。 */
function needsSourceQuery(query: SourceFilter): boolean {
  return Object.entries(query).some(([key, value]) => !['siteIds', 'field', 'sorted', 'type', 'dirLabel'].includes(key)
    && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0))
}

export async function querySiteCards(
  query: SourceFilter,
  options: { isCurrent: () => boolean; catalog?: Site[]; includeEmptySiteIds?: string[]; onProgress: (done: number, total: number) => void },
): Promise<SiteCardResult> {
  const checkCurrent = () => {
    if (!options.isCurrent()) throw new DOMException('查询已取消', 'AbortError')
  }
  const version = cacheVersion
  checkCurrent()
  if (query.sourceIds === '') return { sites: [], unbound: 0 }
  const selected = query.siteIds ? new Set(query.siteIds.split(',').filter(Boolean)) : undefined
  if (selected?.size === 1 && selected.has('-1')) {
    const result = await sourceApi.sourcePaged({ ...query, page: 1, size: 1 })
    checkCurrent()
    return { sites: [], unbound: result.total }
  }

  const catalog = new Map<string, Site>()
  if (options.catalog) options.catalog.forEach(site => catalog.set(site.siteId, site))
  else {
    const first = await siteApi.sitePaged({ page: 1, size: 2000 })
    first.list.forEach(site => catalog.set(site.siteId, site))
    for (let page = 2; page <= Math.ceil(first.total / 2000); page++) {
      checkCurrent()
      const result = await siteApi.sitePaged({ page, size: 2000 })
      if (!result.list.length) throw new Error('网站列表分页不完整，请刷新后重试')
      result.list.forEach(site => catalog.set(site.siteId, site))
    }
  }
  checkCurrent()
  const candidates = [...catalog.values()].filter(site => !selected || selected.has(site.siteId))
  if (!needsSourceQuery(query)) {
    const unbound = !selected || selected.has('-1')
      ? (await sourceApi.sourcePaged({ ...query, siteIds: '-1', page: 1, size: 1 })).total : 0
    checkCurrent()
    const included = new Set(options.includeEmptySiteIds)
    return { sites: candidates.filter(site => site.sourceCount > 0 || selected?.has(site.siteId) || included.has(site.siteId)), unbound }
  }

  // 网站汇总按唯一源 ID 稳定翻页；不改变源列表自身保留的排序状态。
  const scopeQuery = { ...query, field: 'SOURCE_ID', sorted: -1, type: 'DESC' }
  const key = JSON.stringify(Object.entries(scopeQuery).filter(([name, value]) => name !== 'dirLabel' && value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
  let matches: SiteCardSourceScope['matches']
  let unbound: number
  if (scopeCache?.key === key && scopeCache.expiresAt > Date.now()) {
    matches = scopeCache.matches
    unbound = scopeCache.unbound
  } else {
    matches = {}
    unbound = 0
    const seen = new Set<string>()
    const consume = (sources: Source[]) => {
      for (const source of sources) {
        if (seen.has(source.sourceId)) continue
        seen.add(source.sourceId)
        const id = String(source.siteId || '')
        if (!id || id === '0' || id === '-1') { unbound++; continue }
        const match = matches[id] ??= { total: 0, list: [] }
        match.total++
        if (match.list.length < 5) match.list.push(source)
      }
    }
    // 按命中源分页读取，一批最多 4 页；只累计数量及每站前 5 条，不保留整份源列表。
    const first = await sourceApi.sourcePaged({ ...scopeQuery, page: 1, size: 500 })
    checkCurrent()
    if (first.total && !first.list.length) throw new Error('源列表分页不完整，请刷新后重试')
    consume(first.list)
    options.onProgress(seen.size, first.total)
    // 兼容后端限制单页条数：后续按首批实际条数续查，避免跳页漏掉记录。
    const pageSize = Math.min(500, first.list.length) || 500
    const pages = Math.ceil(first.total / pageSize)
    for (let start = 2; start <= pages; start += 4) {
      checkCurrent()
      const batch = await Promise.all(Array.from({ length: Math.min(4, pages - start + 1) }, async (_, offset) => {
        checkCurrent()
        const result = await sourceApi.sourcePaged({ ...scopeQuery, page: start + offset, size: pageSize })
        checkCurrent()
        if (!result.list.length) throw new Error('源列表分页不完整，请刷新后重试')
        return result.list
      }))
      batch.forEach(consume)
      options.onProgress(seen.size, first.total)
    }
    checkCurrent()
    if (seen.size !== first.total) throw new Error('源列表发生变化或分页不完整，请刷新后重试')
    if (version === cacheVersion) scopeCache = { key, matches, unbound, expiresAt: Date.now() + 30000 }
  }
  // 已删除/不可见网站的源也没有可进入的网站卡片，计入未关联提示。
  unbound += Object.entries(matches).reduce((sum, [id, match]) => sum + (catalog.has(id) ? 0 : match.total), 0)
  return { sites: candidates.filter(site => matches[site.siteId]), sourceScope: { query: scopeQuery, matches }, unbound }
}
