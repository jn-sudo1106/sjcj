// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteScopePageFromLegacy } from './siteSourceScope'
const card = (siteDataCount: number | null) => ({ siteId: 42, siteName: '金融站', siteSourceCount: 24, matchedSourceCount: 8, siteDataCount, sourcePreview: [{ sourceId: 99, sourceName: '公告', sourceUrl: 'https://example.com' }], favorited: true })
const page = (siteDataCount: number | null) => ({ total: 1884, matchedSourceTotal: 180000, unboundSourceTotal: 12, list: [card(siteDataCount)] })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })
describe('网站聚合 HTTP 契约', () => {
  it('明确映射完整总数、命中/全站、预览和可信的 0/未知数据量', () => {
    const zero = siteScopePageFromLegacy(page(0))
    expect(zero).toMatchObject({ total: 1884, matchedSourceTotal: 180000, unboundSourceTotal: 12, list: [{ site: { siteId: '42', name: '金融站', sourceCount: 24, dataCount: 0 }, matchedSourceCount: 8, sourcePreview: [{ sourceId: '99', name: '公告', url: 'https://example.com' }] }] })
    expect(siteScopePageFromLegacy(page(null)).list[0]!.site.dataCount).toBeUndefined()
    expect(() => siteScopePageFromLegacy({ total: 0, list: [] })).toThrow('统计字段')
  })
  it('真实 POST 使用 JSON body，不沿用旧 sitePaged 的 query 参数承载', async () => {
    vi.stubEnv('VITE_API_MODE', 'http')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: '0', success: true, data: page(0) }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { siteApi } = await import('./index')
    const body = { page: 2, limit: 20, sort: 'sourceCountDesc' as const, sourceFilter: { count: 0, sourceIds: '', sourceUrl: 'example', flowId: '8', defaultFlowId: '9' }, directory: { kind: 'biz' as const, mode: 'selected' as const, selections: [{ id: '900', includeDescendants: true }] } }
    await siteApi.sourceScopePaged(body)
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/site/sourceScopePaged')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  })
  it('源列表也直传 directory，保留原有筛选和源排序', async () => {
    vi.stubEnv('VITE_API_MODE', 'http')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, count: 0, data: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { sourceApi } = await import('./index')
    const directory = { kind: 'biz', mode: 'all', selections: [] }
    await sourceApi.sourcePaged({ directory, name: '公告', count: 0, size: 50, field: 'SOURCE_ID', sorted: -1, type: 'DESC' })
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ directory, name: '公告', count: 0, limit: 50, field: 'SOURCE_ID', type: 'DESC' })
  })
  it('按范围调整来源组保留目录结构，query 参数不丢目录或变成 object 字符串', async () => {
    vi.stubEnv('VITE_API_MODE', 'http')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: {total:0} }), { status: 200 }))
    vi.stubGlobal('fetch',fetch)
    const { sourceGroupApi } = await import('./index')
    await sourceGroupApi.changeMembersByRange({targetSourceGroupId:'3',filter:{directory:{kind:'biz',mode:'selected',selections:[{id:'900',includeDescendants:true}]}}})
    const query=new URL(fetch.mock.calls[0]![0],location.origin).searchParams
    expect(query.get('directory.kind')).toBe('biz');expect(query.get('directory.mode')).toBe('selected')
    expect(query.get('directory.selections[0].id')).toBe('900');expect(query.get('directory.selections[0].includeDescendants')).toBe('true')
    expect(query.has('directory')).toBe(false)
  })
  it('真实失败不回退 mock 或扫描旧接口', async () => {
    vi.stubEnv('VITE_API_MODE', 'http')
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: '500', msg: '目录查询失败', data: '无权限' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const { siteApi } = await import('./index')
    await expect(siteApi.sourceScopePaged({ page: 1, limit: 20, sort: 'editedDesc', sourceFilter: {} })).rejects.toThrow('无权限')
    expect(fetch).toHaveBeenCalledOnce()
  })
})
