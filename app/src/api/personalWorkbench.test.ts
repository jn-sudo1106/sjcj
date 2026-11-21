// 「我的工作台」数据层单测：钉住这几件事——
// 1. 收藏/最近访问只用既有 live 端点，名称与权限都从资源列表接口实时解析（不用埋点旧标题）；
// 2. 请求有界：触到上限时 `truncated: true` 且 **不给 total**，绝不把已知下限当总数；
// 3. 信封格式异常要报错，不能把"接口返回不认识的结构"渲染成"暂无数据"；
// 4. 最近访问按类型+ID 去重保留最近一次，表的埋点同时取 ENTER/CLICK；
// 5. 我负责的源 / 我的告警调用 workbench/my-sources 与 my-alarms，绝不回退成全平台数据；
// 6. 取消收藏只在后端回执成功后同步本地收藏集合。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
const sitePaged = vi.hoisted(() => vi.fn())
const sourcePaged = vi.hoisted(() => vi.fn())
const entryPaged = vi.hoisted(() => vi.fn())
const favoriteRemove = vi.hoisted(() => vi.fn())
const siteFavoriteIds = vi.hoisted(() => ({ value: new Set<string>() }))
const sourceFavoriteIds = vi.hoisted(() => ({ value: new Set<string>() }))
const entryFavoriteIds = vi.hoisted(() => ({ value: new Set<string>() }))

vi.mock('./client', () => ({ request: requestMock }))
vi.mock('./index', () => ({
  siteApi: { sitePaged },
  sourceApi: { sourcePaged },
  entryApi: { entryPaged },
  favoriteApi: { remove: favoriteRemove },
}))
// 收藏集合是 UI 侧单例（带 ElMessage），这里只提供 removeFavorite 需要的 ref 形状
vi.mock('../utils/siteFavorites', () => ({ favoriteSiteIds: siteFavoriteIds }))
vi.mock('../utils/sourceFavorites', () => ({ favoriteSourceIds: sourceFavoriteIds }))
vi.mock('../utils/entryFavorites', () => ({ favoriteEntryIds: entryFavoriteIds }))

import {
  loadAlarms,
  loadCollections,
  loadRecents,
  loadResources,
  personalWorkbenchApi,
  removeFavorite,
  WORKBENCH_CAPABILITIES,
  WorkbenchUnavailableError,
} from './personalWorkbench'
import type { EntryType } from './types/collect'
import type { Site, Source } from './types/source'

function site(id: string, name: string, extra: Partial<Site> = {}): Site {
  return { siteId: id, name, category: '财经资讯', owner: '', sourceCount: 0, errorCount: 0, ...extra }
}

function source(id: string, name: string, extra: Partial<Source> = {}): Source {
  return { sourceId: id, name, url: '', configId: '0', mainTable: `TB_${id}`, owner: '', state: 'C', ...extra }
}

function entry(id: string, name: string): EntryType {
  return { tableId: id, tableName: `sense_data.${name}`, name, fields: [] }
}

/** 假后端：只认 favorite/list，按 itemType 返回带 createDt 的收藏行（模拟后端真实 SQL 字段）。 */
function stubFavorites(rows: Record<string, { itemId: number; createDt?: string }[]>): void {
  requestMock.mockImplementation(async (endpoint: string, params?: Record<string, unknown>) => {
    if (endpoint !== 'favorite/list') throw new Error(`unexpected endpoint: ${endpoint}`)
    const list = rows[String(params?.itemType ?? '')] ?? []
    return { list, total: list.length }
  })
}

beforeEach(() => {
  requestMock.mockReset()
  sitePaged.mockReset()
  sourcePaged.mockReset()
  entryPaged.mockReset()
  favoriteRemove.mockReset()
  siteFavoriteIds.value = new Set()
  sourceFavoriteIds.value = new Set()
  entryFavoriteIds.value = new Set()
})

describe('loadCollections', () => {
  it('按收藏时间倒序，名称/副标题取实时资源；反查不到（无权限或已删）的收藏被丢弃', async () => {
    stubFavorites({
      SITE: [
        { itemId: 11, createDt: '2026-11-10 10:00:00' },
        { itemId: 99, createDt: '2026-11-09 08:00:00' }, // 已移出权限：列表里查不到
      ],
      SOURCE: [{ itemId: 501, createDt: '2026-11-08 18:30:00' }],
      ENTRY_TYPE: [{ itemId: 9001, createDt: '2026-11-07 12:00:00' }],
    })
    sitePaged.mockResolvedValue({
      total: 2,
      list: [site('11', '国家统计局', { categoryPath: '财经资讯 / 宏观' }), site('12', '东方财富网')],
    })
    sourcePaged.mockResolvedValue({
      total: 1,
      list: [source('501', '沪深行情快照', { siteId: '12', siteName: '东方财富网' })],
    })
    entryPaged.mockResolvedValue({ total: 1, list: [entry('9001', '资产负债表主表')] })

    const page = await loadCollections()

    expect(page.truncated).toBe(false)
    expect(page.total).toBe(3)
    expect(page.list.map((item) => `${item.kind}:${item.id}`)).toEqual(['SITE:11', 'SOURCE:501', 'ENTRY_TYPE:9001'])
    expect(page.list[0]).toMatchObject({
      id: '11',
      kind: 'SITE',
      name: '国家统计局',
      subtitle: '财经资讯 / 宏观',
      at: '2026-11-10 10:00:00',
      siteId: '11',
    })
    expect(page.list[1]).toMatchObject({ name: '沪深行情快照', subtitle: '东方财富网', at: '2026-11-08 18:30:00', siteId: '12' })
    expect(page.list[2]).toMatchObject({ name: '资产负债表主表', subtitle: 'sense_data.资产负债表主表', at: '2026-11-07 12:00:00' })
    // 收藏行直接读 favorite/list 以保留 createDt（listIds 会丢收藏时间）
    expect(requestMock).toHaveBeenCalledWith(
      'favorite/list',
      { itemType: 'SITE', page: 1 },
      { method: 'GET', httpParams: { itemType: 'SITE', page: 1, limit: 500 } },
    )
    // 反查走既有 live 口径：源=sourceIds（后端读 ids），表=entryTypeId 精确（cond 实测不过滤）
    expect(sourcePaged).toHaveBeenCalledWith({ sourceIds: ['501'], page: 1, size: 1 })
    expect(entryPaged).toHaveBeenCalledWith({ entryTypeId: '9001', page: 1, size: 5 })
  })

  it('网站反查按页有界翻（200/页），命中后立即停止', async () => {
    stubFavorites({ SITE: [{ itemId: 701, createDt: '2026-11-01 00:00:00' }] })
    const filler = Array.from({ length: 200 }, (_, index) => site(String(10_000 + index), `站${index}`))
    sitePaged
      .mockResolvedValueOnce({ total: 401, list: filler })
      .mockResolvedValueOnce({ total: 401, list: [site('701', '目标站')] })

    const page = await loadCollections()

    expect(page.truncated).toBe(false)
    expect(sitePaged).toHaveBeenCalledTimes(2)
    expect(sitePaged).toHaveBeenNthCalledWith(1, { page: 1, size: 200 })
    expect(page.total).toBe(1)
    expect(page.list[0]).toMatchObject({ name: '目标站', at: '2026-11-01 00:00:00' })
  })

  it('收藏行触到 1000 条上限：truncated=true，不给精确 total', async () => {
    const ids = Array.from({ length: 1000 }, (_, index) => String(1000 + index))
    requestMock.mockImplementation(async (endpoint: string, params?: Record<string, unknown>) => {
      expect(endpoint).toBe('favorite/list')
      const itemType = String(params?.itemType ?? '')
      const page = Number(params?.page ?? 1)
      const slice = itemType === 'SITE' ? ids.slice((page - 1) * 500, page * 500) : []
      return {
        list: slice.map((itemId) => ({ itemId: Number(itemId), createDt: '2026-11-10 10:00:00' })),
        total: itemType === 'SITE' ? 1500 : 0, // 后端说还有更多
      }
    })
    sitePaged.mockImplementation(async (p: { page?: number; size?: number }) => {
      const size = p.size ?? 200
      const start = ((p.page ?? 1) - 1) * size
      return { total: ids.length, list: ids.slice(start, start + size).map((id) => site(id, `站${id}`)) }
    })
    sourcePaged.mockResolvedValue({ total: 0, list: [] })
    entryPaged.mockResolvedValue({ total: 0, list: [] })

    const page = await loadCollections()

    expect(page.list).toHaveLength(1000)
    expect(page.truncated).toBe(true)
    expect(page.total).toBeUndefined()
  })

  it('源反查只在 200 个 ID 内查一批：超出即截断', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => String(2000 + index))
    stubFavorites({ SOURCE: ids.map((itemId) => ({ itemId: Number(itemId), createDt: '2026-11-09 10:00:00' })) })
    sourcePaged.mockResolvedValue({ total: 200, list: ids.slice(0, 200).map((id) => source(id, `源${id}`)) })

    const page = await loadCollections()

    expect(sourcePaged).toHaveBeenCalledTimes(1)
    expect(sourcePaged).toHaveBeenCalledWith({ sourceIds: ids.slice(0, 200), page: 1, size: 200 })
    expect(page.list).toHaveLength(200)
    expect(page.truncated).toBe(true)
    expect(page.total).toBeUndefined()
  })

  it('网站只翻 5 页：没命中完也停，并标记截断', async () => {
    const ids = Array.from({ length: 1001 }, (_, index) => String(3000 + index))
    stubFavorites({ SITE: ids.map((itemId) => ({ itemId: Number(itemId), createDt: '2026-11-09 10:00:00' })) })
    sitePaged.mockImplementation(async (p: { page?: number }) => ({
      total: 4000,
      list: Array.from({ length: 200 }, (_, index) => site(`9${(p.page ?? 1) * 100 + index}`, `无关站${index}`)),
    }))

    const page = await loadCollections()

    expect(sitePaged).toHaveBeenCalledTimes(5)
    expect(page.list).toHaveLength(0)
    expect(page.truncated).toBe(true)
    expect(page.total).toBeUndefined()
  })

  it('表反查最多 60 个：第 61 个不查，标记截断', async () => {
    const ids = Array.from({ length: 61 }, (_, index) => String(9000 + index))
    stubFavorites({ ENTRY_TYPE: ids.map((itemId) => ({ itemId: Number(itemId), createDt: '2026-11-09 10:00:00' })) })
    entryPaged.mockImplementation(async (p: { entryTypeId?: string }) => ({
      total: 1,
      list: p.entryTypeId ? [entry(String(p.entryTypeId), `表${p.entryTypeId}`)] : [],
    }))

    const page = await loadCollections()

    expect(entryPaged).toHaveBeenCalledTimes(60)
    expect(page.list).toHaveLength(60)
    expect(page.truncated).toBe(true)
    expect(page.total).toBeUndefined()
  })

  it('收藏信封不是数组时报错，不当成"没有收藏"', async () => {
    requestMock.mockResolvedValue({})
    await expect(loadCollections()).rejects.toThrow('收藏列表返回格式异常')
  })

  it('网站列表信封异常时报错', async () => {
    stubFavorites({ SITE: [{ itemId: 11, createDt: '2026-11-10 10:00:00' }] })
    sitePaged.mockResolvedValue(null)
    await expect(loadCollections()).rejects.toThrow('网站列表返回格式异常')
  })

  it('优先使用 workbench/resolve-items 批量解析端点，不触发单独反查', async () => {
    requestMock.mockImplementation(async (endpoint: string, params?: Record<string, unknown>) => {
      if (endpoint === 'favorite/list') {
        const list = (params?.itemType === 'SITE') ? [{ itemId: 11, createDt: '2026-11-10 10:00:00' }]
          : (params?.itemType === 'SOURCE') ? [{ itemId: 501, createDt: '2026-11-08 18:30:00' }] : []
        return { list, total: list.length }
      }
      if (endpoint === 'workbench/resolve-items') {
        return [
          { kind: 'SITE', id: 11, exists: true, name: '国家统计局', subtitle: '财经资讯' },
          { kind: 'SOURCE', id: 501, exists: true, name: '沪深行情快照', subtitle: '东方财富网', siteId: 12 },
        ]
      }
      throw new Error(`unexpected endpoint: ${endpoint}`)
    })

    const page = await loadCollections()
    expect(page.list).toHaveLength(2)
    expect(page.list[0].name).toBe('国家统计局')
    expect(page.list[1].name).toBe('沪深行情快照')
    expect(sitePaged).not.toHaveBeenCalled()
    expect(sourcePaged).not.toHaveBeenCalled()
  })
})

describe('loadRecents', () => {
  it('用资源列表重解析真实名称与权限，不展示埋点旧 contentTitle；源与表都取 ENTER/CLICK', async () => {
    requestMock.mockImplementation(async (endpoint: string, params?: Record<string, unknown>) => {
      if (endpoint !== 'log-report/recent') throw new Error(`unexpected endpoint: ${endpoint}`)
      const byType: Record<string, { contentId: string; contentTitle: string; createDt: string }[]> = {
        SITE: [{ contentId: '11', contentTitle: '旧网站名', createDt: '2026-11-11 09:00:00' }],
        SOURCE: [{ contentId: '501', contentTitle: '旧源名', createDt: '2026-11-11 09:05:00' }],
        ENTRY_TYPE: [
          { contentId: '9001', contentTitle: '旧表名', createDt: '2026-11-11 08:00:00' },
          { contentId: '9999', contentTitle: '已无权限的表', createDt: '2026-11-11 10:00:00' },
        ],
      }
      return { success: true, code: '0', msg: '', data: byType[String(params?.contentType ?? '')] ?? [] }
    })
    sitePaged.mockResolvedValue({ total: 1, list: [site('11', '国家统计局（新名）')] })
    sourcePaged.mockResolvedValue({ total: 1, list: [source('501', '财务主表（新名）', { siteName: '国家统计局' })] })
    entryPaged.mockImplementation(async (p: { entryTypeId?: string }) => ({
      total: 1,
      list: p?.entryTypeId === '9001' ? [entry('9001', '资产负债表主表')] : [],
    }))

    const page = await loadRecents(5)

    expect(page.truncated).toBe(false)
    expect(page.total).toBe(3)
    // 09:05 > 09:00 > 08:00；9999 无权限被丢弃
    expect(page.list.map((item) => item.id)).toEqual(['501', '11', '9001'])
    expect(page.list.map((item) => item.name)).toEqual(['财务主表（新名）', '国家统计局（新名）', '资产负债表主表'])
    expect(page.list.some((item) => item.name.includes('旧'))).toBe(false)
    expect(requestMock).toHaveBeenCalledWith(
      'log-report/recent',
      { contentType: 'SITE', action: 'ENTER', limit: 5 },
      { method: 'GET', keepEnvelope: true },
    )
    // 源在 186 的埋点记的是 CLICK（2026-11-20 实测），因此要 ENTER,CLICK 一起取
    expect(requestMock).toHaveBeenCalledWith(
      'log-report/recent',
      { contentType: 'SOURCE', action: 'ENTER,CLICK', limit: 5 },
      { method: 'GET', keepEnvelope: true },
    )
    expect(requestMock).toHaveBeenCalledWith(
      'log-report/recent',
      { contentType: 'ENTRY_TYPE', action: 'ENTER,CLICK', limit: 5 },
      { method: 'GET', keepEnvelope: true },
    )
  })

  it('同类型同 ID 多次访问只保留最近一次', async () => {
    requestMock.mockImplementation(async (endpoint: string, params?: Record<string, unknown>) => {
      if (endpoint !== 'log-report/recent') throw new Error(`unexpected endpoint: ${endpoint}`)
      const byType: Record<string, { contentId: string; createDt: string }[]> = {
        SITE: [
          { contentId: '11', createDt: '2026-11-11 09:00:00' },
          { contentId: '11', createDt: '2026-11-11 07:00:00' },
          { contentId: '12', createDt: '2026-11-11 07:30:00' },
        ],
        SOURCE: [],
        ENTRY_TYPE: [],
      }
      return { success: true, code: '0', msg: '', data: byType[String(params?.contentType ?? '')] ?? [] }
    })
    sitePaged.mockResolvedValue({ total: 2, list: [site('11', '国家统计局'), site('12', '东方财富网')] })

    const page = await loadRecents()

    expect(page.list.map((item) => `${item.id}@${item.at ?? ''}`)).toEqual(['11@2026-11-11 09:00:00', '12@2026-11-11 07:30:00'])
  })

  it('单类取满一页说明还有更早记录：truncated=true，不给 total', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => String(100 + index))
    requestMock.mockImplementation(async (endpoint: string, params?: Record<string, unknown>) => {
      if (endpoint !== 'log-report/recent') throw new Error(`unexpected endpoint: ${endpoint}`)
      const rows = ids.map((contentId, index) => ({ contentId, createDt: `2026-11-11 0${index}:00:00` }))
      return { success: true, code: '0', msg: '', data: String(params?.contentType) === 'SITE' ? rows : [] }
    })
    sitePaged.mockResolvedValue({ total: 8, list: ids.map((id) => site(id, `站${id}`)) })

    const page = await loadRecents()

    expect(page.list).toHaveLength(8)
    expect(page.truncated).toBe(true)
    expect(page.total).toBeUndefined()
  })

  it('埋点读取失败显式抛错，不伪装成空列表', async () => {
    requestMock.mockResolvedValue({ success: false, code: '-1', msg: '会话失效', data: [] })

    await expect(loadRecents()).rejects.toThrow('最近访问读取失败：会话失效')
  })

  it('埋点 data 结构异常时报错', async () => {
    requestMock.mockResolvedValue({ success: true, code: '0', msg: '', data: null })

    await expect(loadRecents()).rejects.toThrow('最近访问返回格式异常')
  })
})

describe('loadResources', () => {
  it('请求 workbench/my-sources 并映射为源列表', async () => {
    requestMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'workbench/my-sources') {
        return {
          list: [
            { sourceId: 101, sourceName: '源1', state: 'C', alarmLevel: null, siteId: 2, siteName: '网站A', updateDt: '2026-11-19 12:00:00' },
            { sourceId: 102, sourceName: '源2', state: 'E', alarmLevel: 'fail', siteId: 2, entryTypeName: '表B', updateDt: '2026-11-19 13:00:00' },
          ],
          total: 2,
        }
      }
      throw new Error(`unexpected endpoint: ${endpoint}`)
    })

    const result = await loadResources({ page: 1, limit: 20 })
    expect(result.truncated).toBe(false)
    expect(result.total).toBe(2)
    expect(result.list).toHaveLength(2)
    expect(result.list[0]).toEqual({
      id: '101',
      kind: 'SOURCE',
      name: '源1',
      subtitle: '网站A',
      at: '2026-11-19 12:00:00',
      siteId: '2',
      state: 'ok',
      alarmLevel: null,
    })
    expect(result.list[1]).toEqual({
      id: '102',
      kind: 'SOURCE',
      name: '源2',
      subtitle: '表B',
      at: '2026-11-19 13:00:00',
      siteId: '2',
      state: 'error',
      alarmLevel: 'fail',
    })
    expect(requestMock).toHaveBeenCalledWith('workbench/my-sources', { page: 1, limit: 20 }, {
      method: 'GET',
      httpParams: { page: 1, limit: 20, state: undefined, keyword: undefined },
    })
  })

  it('列表非数组时报错', async () => {
    requestMock.mockResolvedValue({})
    await expect(loadResources()).rejects.toThrow('我负责的源列表返回格式异常')
  })
})

describe('loadAlarms', () => {
  it('请求 workbench/my-alarms 并映射为告警列表', async () => {
    requestMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === 'workbench/my-alarms') {
        return {
          list: [
            { alarmId: '1', targetId: '101', targetName: '源1', title: '采集失败', level: 'fail', occurDt: '2026-11-19 12:00:00' },
            { alarmId: '2', targetId: '102', targetName: '源2', title: '恢复采集', level: 'recover', occurDt: '2026-11-19 12:10:00' },
          ],
          total: 2,
        }
      }
      throw new Error(`unexpected endpoint: ${endpoint}`)
    })

    const result = await loadAlarms('all', 10)
    expect(result.truncated).toBe(false)
    expect(result.total).toBe(2)
    expect(result.list).toHaveLength(2)
    expect(result.list[0]).toEqual({
      id: '1',
      sourceId: '101',
      name: '源1',
      description: '采集失败',
      level: 'fail',
      at: '2026-11-19 12:00:00',
      resolved: false,
    })
    expect(result.list[1]).toEqual({
      id: '2',
      sourceId: '102',
      name: '源2',
      description: '恢复采集',
      level: 'recover',
      at: '2026-11-19 12:10:00',
      resolved: true,
    })
    expect(requestMock).toHaveBeenCalledWith('workbench/my-alarms', { scope: 'all', limit: 10, page: 1 }, {
      method: 'GET',
      httpParams: { scope: 'all', page: 1, limit: 10 },
    })
  })

  it('默认只取未恢复；total 只来自服务端 count，不拿当前页长度冒充', async () => {
    requestMock.mockResolvedValue({
      list: [{ alarmId: '1', targetId: '101', targetName: '源1', title: '采集失败', level: 'fail' }],
      total: 37,
    })

    const result = await loadAlarms()
    expect(result.total).toBe(37)
    expect(result.truncated).toBe(true)
    expect(requestMock).toHaveBeenCalledWith('workbench/my-alarms', { scope: 'open', limit: 20, page: 1 }, {
      method: 'GET',
      httpParams: { scope: 'open', page: 1, limit: 20 },
    })
  })

  it('翻到最后一页时不再标记 truncated', async () => {
    requestMock.mockResolvedValue({ list: [{ alarmId: '21', targetId: '101', targetName: '源1', level: 'fail' }], total: 21 })
    const result = await loadAlarms('all', 20, 2)
    expect(result.truncated).toBe(false)
  })

  it('端点 404 时转成「接口未就绪」而不是加载失败', async () => {
    requestMock.mockRejectedValue(Object.assign(new Error('请求失败 404'), { status: 404 }))
    await expect(loadAlarms()).rejects.toBeInstanceOf(WorkbenchUnavailableError)
    await expect(loadResources()).rejects.toThrow('我负责的源接口未就绪')
  })

  it('列表非数组时报错', async () => {
    requestMock.mockResolvedValue({})
    await expect(loadAlarms()).rejects.toThrow('我的相关告警返回格式异常')
  })
})

describe('WORKBENCH_CAPABILITIES', () => {
  it('四大能力均已就绪', () => {
    expect(WORKBENCH_CAPABILITIES).toEqual({ collections: true, recents: true, resources: true, alarms: true })
  })
})

describe('removeFavorite', () => {
  it('正数 ID 走后端，回执成功后再同步本地收藏集合', async () => {
    siteFavoriteIds.value = new Set(['501', '502'])
    favoriteRemove.mockResolvedValue({ ok: true })

    await removeFavorite({ id: '501', kind: 'SITE' })

    expect(favoriteRemove).toHaveBeenCalledWith('SITE', '501')
    expect([...siteFavoriteIds.value]).toEqual(['502'])
    expect(sourceFavoriteIds.value.size).toBe(0)
  })

  it('非法 ID 不发请求', async () => {
    await expect(removeFavorite({ id: 'abc', kind: 'SOURCE' })).rejects.toThrow('收藏 ID 无效')
    expect(favoriteRemove).not.toHaveBeenCalled()
  })

  it('后端回执失败：抛真实错误，且不动本地集合', async () => {
    siteFavoriteIds.value = new Set(['501'])
    favoriteRemove.mockResolvedValue({ ok: false, message: '无权限' })

    await expect(removeFavorite({ id: '501', kind: 'SITE' })).rejects.toThrow('无权限')
    expect([...siteFavoriteIds.value]).toEqual(['501'])
  })
})

describe('personalWorkbenchApi', () => {
  it('对象形态与具名导出一致', () => {
    expect(personalWorkbenchApi.collections).toBe(loadCollections)
    expect(personalWorkbenchApi.recents).toBe(loadRecents)
    expect(personalWorkbenchApi.resources).toBe(loadResources)
    expect(personalWorkbenchApi.alarms).toBe(loadAlarms)
    expect(personalWorkbenchApi.removeFavorite).toBe(removeFavorite)
  })
})