import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteApi, sourceApi, type Site, type Source } from '@/api'
import { clearSiteCardQueryCache, querySiteCards } from './siteCardQuery'

const site = (siteId: string, sourceCount = 24): Site => ({ siteId, name: `网站 ${siteId}`, category: '', owner: '', sourceCount, errorCount: 0 })
const source = (sourceId: string, siteId = 'a'): Source => ({ sourceId, name: sourceId, siteId } as Source)
const options = () => ({ isCurrent: () => true, onProgress: vi.fn() })
afterEach(() => { vi.restoreAllMocks(); clearSiteCardQueryCache() })

describe('网站视图按命中源批量汇总', () => {
  it('空源范围不向后端发送不限条件', async () => {
    const websites = vi.spyOn(siteApi, 'sitePaged')
    const sources = vi.spyOn(sourceApi, 'sourcePaged')
    expect(await querySiteCards({ sourceIds: '' }, options())).toEqual({ sites: [], unbound: 0 })
    expect(websites).not.toHaveBeenCalled()
    expect(sources).not.toHaveBeenCalled()
  })

  it('1884个候选网站只查询命中源，不逐网站探测；计数完整、每站只保留5条预览', async () => {
    const catalog = Array.from({ length: 1882 }, (_, i) => site(`other-${i}`)).concat(site('a'), site('b'))
    const rows = [...Array.from({ length: 210 }, (_, i) => source(String(i))), source('b1', 'b'), source('b2', 'b'), source('orphan', 'deleted')]
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: rows.length, list: rows })
    const query = { categorys: '900,901', name: '金融', tags: ['告警'], sourceGroupId: '8', count: 0, state: 'E', enable: '0' }
    const result = await querySiteCards(query, { ...options(), catalog })
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...query, page: 1, size: 5000, field: 'SOURCE_ID', sorted: -1 }))
    expect(fetch.mock.calls[0]?.[0]?.siteIds).toBeUndefined()
    expect(result.sites.map(s => s.siteId)).toEqual(['a', 'b'])
    expect(result.sourceScope?.matches.a?.total).toBe(210)
    expect(result.sourceScope?.matches.a?.list).toHaveLength(5)
    expect(result.sourceScope?.matches.b?.total).toBe(2)
    expect(result.unbound).toBe(1)
  })

  it('命中源超过一页时完整分页汇总，后续页面的网站不会遗漏', async () => {
    const rows = Array.from({ length: 10003 }, (_, i) => source(String(i), i < 10000 ? 'a' : 'late'))
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async p => ({ total: rows.length, list: rows.slice(((p?.page ?? 1) - 1) * (p?.size ?? 5000), (p?.page ?? 1) * (p?.size ?? 5000)) }))
    const opts = { ...options(), catalog: [site('a'), site('late')] }
    const result = await querySiteCards({ name: '公告' }, opts)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(result.sourceScope?.matches.a?.total).toBe(10000)
    expect(result.sourceScope?.matches.late?.total).toBe(3)
    expect(opts.onProgress).toHaveBeenLastCalledWith(10003, 10003)
  })

  it('后端限制每页大小时按实际页大小续查，不跳过中间源', async () => {
    const rows = Array.from({ length: 205 }, (_, i) => source(String(i)))
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async p => {
      const size = Math.min(p?.size ?? 5000, 100)
      return { total: rows.length, list: rows.slice(((p?.page ?? 1) - 1) * size, (p?.page ?? 1) * size) }
    })
    const result = await querySiteCards({ name: '公告' }, { ...options(), catalog: [site('a')] })
    expect(fetch).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2, size: 100 }))
    expect(result.sourceScope?.matches.a?.total).toBe(205)
  })

  it('保留网站限定和全部源筛选条件，不扩展查询到其他网站', async () => {
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('b1', 'b')] })
    const result = await querySiteCards({ siteIds: 'b', sourceIds: 'b1', name: '公告', count: 0 }, { ...options(), catalog: [site('a'), site('b')] })
    expect(result.sites.map(s => s.siteId)).toEqual(['b'])
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ siteIds: 'b', sourceIds: 'b1', name: '公告', count: 0, page: 1, size: 5000 }))
  })

  it('同条件短时间重开复用汇总结果，显式刷新后重新请求', async () => {
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('1')] })
    const opts = { ...options(), catalog: [site('a')] }
    await querySiteCards({ name: '公告' }, opts)
    await querySiteCards({ name: '公告' }, opts)
    expect(fetch).toHaveBeenCalledTimes(1)
    clearSiteCardQueryCache()
    await querySiteCards({ name: '公告' }, opts)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('缓存过期后重新请求，筛选条件改变也不能复用旧结果', async () => {
    let now = 100000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source('1')] })
    const opts = { ...options(), catalog: [site('a')] }
    await querySiteCards({ name: '公告' }, opts)
    now += 31000
    await querySiteCards({ name: '公告' }, opts)
    await querySiteCards({ name: '政策' }, opts)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('刷新之前启动的请求晚回来，不能重新填入已失效的缓存', async () => {
    let finish!: (result: { total: number; list: Source[] }) => void
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ total: 1, list: [source('new')] })
    const opts = { ...options(), catalog: [site('a')] }
    const pending = querySiteCards({ name: '公告' }, opts)
    clearSiteCardQueryCache()
    finish({ total: 1, list: [source('old')] })
    await pending
    const fresh = await querySiteCards({ name: '公告' }, opts)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fresh.sourceScope?.matches.a?.list[0]?.sourceId).toBe('new')
  })

  it('无源筛选时沿用网站统计，网站目录超过2000条继续分页', async () => {
    const websites = vi.spyOn(siteApi, 'sitePaged')
      .mockResolvedValueOnce({ list: [site('a'), site('empty', 0)], total: 2001 })
      .mockResolvedValueOnce({ list: [site('late')], total: 2001 })
    const sources = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: [] })
    const result = await querySiteCards({ field: 'SOURCE_ID', sorted: -1, type: 'DESC' }, options())
    expect(websites).toHaveBeenNthCalledWith(2, { page: 2, size: 2000 })
    expect(result.sites.map(s => s.siteId)).toEqual(['a', 'late'])
    expect(result.unbound).toBe(3)
    expect(result.sourceScope).toBeUndefined()
    expect(sources).toHaveBeenCalledTimes(1)
  })

  it('明确选择空网站或本次新建空网站时仍可看到网站入口', async () => {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ list: [site('empty', 0)], total: 1 })
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    expect((await querySiteCards({ siteIds: 'empty' }, options())).sites).toHaveLength(1)
    expect((await querySiteCards({}, { ...options(), includeEmptySiteIds: ['empty'] })).sites).toHaveLength(1)
  })

  it('只查未关联网站时仅查询数量，不伪造可点击网站', async () => {
    const websites = vi.spyOn(siteApi, 'sitePaged')
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 12, list: [] })
    expect(await querySiteCards({ siteIds: '-1', name: '公告' }, options())).toEqual({ sites: [], unbound: 12 })
    expect(websites).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ siteIds: '-1', name: '公告', size: 1 }))
  })

  it('旧查询失效后不再读取后续页面，也不污染缓存', async () => {
    let current = true
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async () => {
      current = false
      return { total: 1000, list: Array.from({ length: 500 }, (_, i) => source(String(i))) }
    })
    await expect(querySiteCards({ name: '旧条件' }, { ...options(), catalog: [site('a')], isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('分页失败或缺少记录时整体报错，不把部分命中当完整结果', async () => {
    const fetch = vi.spyOn(sourceApi, 'sourcePaged').mockRejectedValueOnce(new Error('后端不可达'))
    const opts = { ...options(), catalog: [site('a')] }
    await expect(querySiteCards({ name: '公告' }, opts)).rejects.toThrow('后端不可达')
    fetch.mockResolvedValue({ total: 1, list: [] })
    await expect(querySiteCards({ name: '公告' }, opts)).rejects.toThrow('分页不完整')
  })
})
