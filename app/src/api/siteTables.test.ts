// @vitest-environment jsdom
// 网站表目录：旧平台的 queryEntryTypesGroup 返回可选表目录，不按网站源重复请求，
// 也不把同一张表重复计为源引用。网站范围在选表后通过真实数据查询判断。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteApi, dataApi } from './index'
import type { EntryTypeGroup } from './types'
function group(entries: { tableId: string; tableName: string; name?: string }[]): EntryTypeGroup {
  return {
    list1: entries.map((e) => ({ ...e, fields: [] })),
    list2: [],
    list3: [],
  }
}

describe('siteApi.siteTables', () => {
  afterEach(() => vi.restoreAllMocks())

  it('加载全局表目录并去重，不伪造源引用数', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([
      { tableId: 't1', tableName: 'T1' },
      { tableId: 't1', tableName: 'T1' },
      { tableId: 't3', tableName: 'T3', name: '表三' },
    ]))

    const result = await siteApi.siteTables('site-x', { force: true })

    expect(result.overThreshold).toBe(false)
    expect(result.sourceCount).toBe(0)
    expect(result.failedSourceIds).toEqual([])
    const byId = Object.fromEntries(result.tables.map((t) => [t.tableId, t]))
    expect(result.tables).toHaveLength(2)
    expect(byId.t1).toMatchObject({ tableName: 'T1' })
    expect(byId.t3).toMatchObject({ tableName: 'T3', name: '表三' })
  })

  it('目录请求失败时整体失败，不伪造部分源失败提示', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockRejectedValue(new Error('boom'))

    await expect(siteApi.siteTables('site-catalog-fail', { force: true })).rejects.toThrow('boom')
  })

  it('不读取网站源列表，也不因源数量触发表目录阈值', async () => {
    const siteSources = vi.spyOn(siteApi, 'siteSources')
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    const result = await siteApi.siteTables('site-huge', { force: true })

    expect(result.overThreshold).toBe(false)
    expect(result.tables).toHaveLength(1)
    expect(siteSources).not.toHaveBeenCalled()
  })

  it('同一 siteId 重复调用命中缓存，不重复发起查询', async () => {
    const entryTypesGroup = vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await siteApi.siteTables('site-cache', { force: true })
    await siteApi.siteTables('site-cache')
    await siteApi.siteTables('site-cache')

    expect(entryTypesGroup).toHaveBeenCalledTimes(1)
  })

  it('refreshSiteTables 清缓存后下一次调用会重新查询', async () => {
    const entryTypesGroup = vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await siteApi.siteTables('site-refresh', { force: true })
    siteApi.refreshSiteTables('site-refresh')
    await siteApi.siteTables('site-refresh')

    expect(entryTypesGroup).toHaveBeenCalledTimes(2)
  })

  it('onProgress 收到最终目录', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([
      { tableId: 't1', tableName: 'T1' },
      { tableId: 't2', tableName: 'T2' },
    ]))

    const snapshots: number[] = []
    const result = await siteApi.siteTables('site-progress', { force: true, onProgress: (tables) => snapshots.push(tables.length) })

    expect(result.tables.map((t) => t.tableId).sort()).toEqual(['t1', 't2'])
    expect(snapshots).toEqual([2])
  })

  it('查询失败时不缓存失败结果，允许下次重新尝试', async () => {
    const entryTypesGroup = vi.spyOn(dataApi, 'entryTypesGroup')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(group([{ tableId: 't1', tableName: 'T1' }]))

    await expect(siteApi.siteTables('site-retry', { force: true })).rejects.toThrow('network down')
    const result = await siteApi.siteTables('site-retry')

    expect(result.tables).toEqual([{ tableId: 't1', tableName: 'T1', name: undefined }])
    expect(entryTypesGroup).toHaveBeenCalledTimes(2)
  })
})
