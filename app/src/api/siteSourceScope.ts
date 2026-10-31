import { request } from './client'
import { siteFromLegacy, sourceFromLegacy } from './legacyAdapters'
import type { Site, Source } from './types'
import type { SourceDirectoryScope, SiteScopeSort } from './sourceDirectoryScope'

export interface SiteScopeRequest {
  page: number
  limit: number
  sort: SiteScopeSort
  sourceFilter: Record<string, unknown>
  directory?: SourceDirectoryScope
  includeEmptySiteIds?: string[]
}
export interface SiteScopePage {
  total: number
  matchedSourceTotal: number
  unboundSourceTotal: number
  list: { site: Site; matchedSourceCount: number; sourcePreview: Source[]; favorited: boolean }[]
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('网站聚合接口返回格式不完整')
  return value as Record<string, unknown>
}
function count(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('网站聚合接口缺少统计字段')
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('网站聚合接口统计字段无效')
  return n
}
/** Explicitly map each scope; unknown siteDataCount must stay unknown, confirmed 0 stays 0. */
export function siteScopePageFromLegacy(value: unknown): SiteScopePage {
  const raw = record(value)
  if (!Array.isArray(raw.list)) throw new Error('网站聚合接口缺少当前页列表')
  return {
    total: count(raw.total), matchedSourceTotal: count(raw.matchedSourceTotal), unboundSourceTotal: count(raw.unboundSourceTotal),
    list: raw.list.map(value => {
      const row = record(value)
      if (row.siteId == null || !Array.isArray(row.sourcePreview) || !('siteDataCount' in row)) throw new Error('网站聚合卡片字段不完整')
      const site = siteFromLegacy({ ...row, sourceCount: count(row.siteSourceCount), sourceCnt: count(row.siteSourceCount) })
      site.dataCount = row.siteDataCount == null ? undefined : count(row.siteDataCount)
      return { site, matchedSourceCount: count(row.matchedSourceCount), sourcePreview: row.sourcePreview.map(value => ({ ...sourceFromLegacy(value), siteName: site.name })), favorited: row.favorited === true || row.favorited === 1 }
    }),
  }
}
export async function sourceScopePaged(body: SiteScopeRequest, signal?: AbortSignal): Promise<SiteScopePage> {
  const value = await request<unknown>('site/sourceScopePaged', { ...body }, { method: 'POST', paramsIn: 'body', signal })
  return siteScopePageFromLegacy(value)
}
