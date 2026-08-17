// @vitest-environment jsdom
// 网站表聚合（0812 计划 M2-1）：旧平台没有"网站下所有表"接口，siteApi.siteTables
// 按 site/sources + 逐源 config/queryEntryTypesGroup 现拼、去重、计数。这里只测
// 聚合逻辑本身（去重/计数/阈值/单源失败/缓存），不重复验证 siteSources/entryTypesGroup
// 各自的 HTTP 契约（那两个已有专门的契约测试）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { siteApi, dataApi } from './index'
import type { Source, EntryTypeGroup } from './types'

function source(id: string): Source {
  return { sourceId: id, name: `源-${id}`, url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
}
function group(entries: { tableId: string; tableName: string; name?: string }[]): EntryTypeGroup {
  return {
    list1: entries.map((e) => ({ ...e, fields: [] })),
    list2: [],
    list3: [],
  }
}

describe('siteApi.siteTables', () => {
  afterEach(() => vi.restoreAllMocks())

  it('跨源去重并统计引用源数', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1'), source('s2'), source('s3')])
    vi.spyOn(dataApi, 'entryTypesGroup').mockImplementation(async (sourceId) => {
      if (sourceId === 's1') return group([{ tableId: 't1', tableName: 'T1' }, { tableId: 't2', tableName: 'T2' }])
      if (sourceId === 's2') return group([{ tableId: 't1', tableName: 'T1' }])
      return group([{ tableId: 't3', tableName: 'T3', name: '表三' }])
    })

    const result = await siteApi.siteTables('site-x', { force: true })

    expect(result.overThreshold).toBe(false)
    expect(result.sourceCount).toBe(3)
    expect(result.failedSourceIds).toEqual([])
    const byId = Object.fromEntries(result.tables.map((t) => [t.tableId, t]))
    expect(byId.t1.sourceCount).toBe(2)
    expect(byId.t2.sourceCount).toBe(1)
    expect(byId.t3).toMatchObject({ tableName: 'T3', name: '表三', sourceCount: 1 })
  })

  it('单源查表失败不清空其他源已聚合的结果，记进 failedSourceIds', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('ok'), source('bad')])
    vi.spyOn(dataApi, 'entryTypesGroup').mockImplementation(async (sourceId) => {
      if (sourceId === 'bad') throw new Error('boom')
      return group([{ tableId: 't1', tableName: 'T1' }])
    })

    const result = await siteApi.siteTables('site-partial-fail', { force: true })

    expect(result.tables).toEqual([{ tableId: 't1', tableName: 'T1', name: undefined, sourceCount: 1 }])
    expect(result.failedSourceIds).toEqual(['bad'])
  })

  it('源数量超过阈值时不逐源查表，直接标记 overThreshold', async () => {
    const many = Array.from({ length: 201 }, (_, i) => source(`s${i}`))
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue(many)
    const entryTypesGroup = vi.spyOn(dataApi, 'entryTypesGroup')

    const result = await siteApi.siteTables('site-huge', { force: true })

    expect(result.overThreshold).toBe(true)
    expect(result.sourceCount).toBe(201)
    expect(result.tables).toEqual([])
    expect(entryTypesGroup).not.toHaveBeenCalled()
  })

  it('同一 siteId 重复调用命中缓存，不重复发起查询', async () => {
    const siteSources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1')])
    const entryTypesGroup = vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await siteApi.siteTables('site-cache', { force: true })
    await siteApi.siteTables('site-cache')
    await siteApi.siteTables('site-cache')

    expect(siteSources).toHaveBeenCalledTimes(1)
    expect(entryTypesGroup).toHaveBeenCalledTimes(1)
  })

  it('refreshSiteTables 清缓存后下一次调用会重新查询', async () => {
    const siteSources = vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1')])
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await siteApi.siteTables('site-refresh', { force: true })
    siteApi.refreshSiteTables('site-refresh')
    await siteApi.siteTables('site-refresh')

    expect(siteSources).toHaveBeenCalledTimes(2)
  })

  it('onProgress 在聚合过程中收到中间结果，最终包含全部表', async () => {
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([source('s1'), source('s2')])
    vi.spyOn(dataApi, 'entryTypesGroup').mockImplementation(async (sourceId) =>
      sourceId === 's1' ? group([{ tableId: 't1', tableName: 'T1' }]) : group([{ tableId: 't2', tableName: 'T2' }]))

    const snapshots: number[] = []
    const result = await siteApi.siteTables('site-progress', { force: true, onProgress: (tables) => snapshots.push(tables.length) })

    expect(result.tables.map((t) => t.tableId).sort()).toEqual(['t1', 't2'])
    expect(snapshots.length).toBeGreaterThanOrEqual(1)
    expect(snapshots.at(-1)).toBe(2)
  })

  it('查询失败时不缓存失败结果，允许下次重新尝试', async () => {
    const siteSources = vi.spyOn(siteApi, 'siteSources')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([source('s1')])
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await expect(siteApi.siteTables('site-retry', { force: true })).rejects.toThrow('network down')
    const result = await siteApi.siteTables('site-retry')

    expect(result.tables).toEqual([{ tableId: 't1', tableName: 'T1', name: undefined, sourceCount: 1 }])
    expect(siteSources).toHaveBeenCalledTimes(2)
  })
})
