import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteApi, sourceApi, type Site } from '@/api'
import { querySiteCards } from './siteCardQuery'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'

const options = () => ({ page: 2, size: 20, sort: 'sourceCountDesc' as const, isCurrent: () => true })
const response = () => ({ total: 1884, matchedSourceTotal: 180000, unboundSourceTotal: 12,
  list: [{ site: { siteId: '42', name: '金融站', sourceCount: 24, dataCount: 0 } as Site, matchedSourceCount: 8, sourcePreview: [], favorited: false }] })
afterEach(() => vi.restoreAllMocks())

describe('服务端网站聚合分页', () => {
  it('一次聚合请求，保留目录与 count=0，网站排序独立于源排序，不预取全库', async () => {
    const fetch = vi.spyOn(siteApi, 'sourceScopePaged').mockResolvedValue(response())
    const oldSites = vi.spyOn(siteApi, 'sitePaged')
    const oldSources = vi.spyOn(sourceApi, 'sourcePaged')
    const directory = { kind: 'biz' as const, mode: 'selected' as const, selections: [{ id: '900', includeDescendants: true }] }
    const result = await querySiteCards({ directory, name: '金融', sourceUrl: 'example', count: 0, flowId: '8', defaultFlowId: '9', field: 'DATA_CNT', sorted: -1, type: 'DESC', dirLabel: '目录文案' }, { ...options(), includeEmptySiteIds: ['43'] })
    expect(fetch).toHaveBeenCalledExactlyOnceWith({ page: 2, limit: 20, sort: 'sourceCountDesc', directory,
      sourceFilter: { name: '金融', sourceUrl: 'example', count: 0, flowId: '8', defaultFlowId: '9' }, includeEmptySiteIds: ['43'] }, undefined)
    expect(result).toMatchObject({ total: 1884, matchedSourceTotal: 180000, unbound: 12, sourceScope: { serverPaged: true, matches: { '42': { total: 8, list: [] } } } })
    expect(oldSites).not.toHaveBeenCalled(); expect(oldSources).not.toHaveBeenCalled()
  })
  it.each([{ sourceIds: '' }, { siteIds: '-1' }, { directory: { kind: 'biz', mode: 'selected', selections: [] } }])('空范围与未关联范围保持服务端契约，不退回旧源扫描 %j', async query => {
    const fetch = vi.spyOn(siteApi, 'sourceScopePaged').mockResolvedValue({ ...response(), total: 0, list: [] })
    await querySiteCards(query as SourceFilter, options())
    expect(fetch.mock.calls[0]![0].sourceFilter).toMatchObject('directory' in query ? {} : query)
  })
  it('保留真实错误，不回退全量扫描', async () => {
    vi.spyOn(siteApi, 'sourceScopePaged').mockRejectedValue(new Error('目录无访问权限'))
    const old = vi.spyOn(sourceApi, 'sourcePaged')
    await expect(querySiteCards({}, options())).rejects.toThrow('目录无访问权限')
    expect(old).not.toHaveBeenCalled()
  })
  it('过期响应不能污染当前页面或收藏状态', async () => {
    let current = true
    vi.spyOn(siteApi, 'sourceScopePaged').mockImplementation(async () => { current = false; return response() })
    await expect(querySiteCards({}, { ...options(), isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
