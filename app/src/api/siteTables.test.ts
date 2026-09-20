// @vitest-environment jsdom
// 网站表选择的表目录。2026-09-20 起**只发一个无参请求**：实测 `config/queryEntryTypesGroup`
// 的 sourceId 只决定分组，对 list1+list2+list3 的并集毫无影响，所以按源分片查纯属白跑
// （详见 api/index.ts 里 loadSiteTables 的说明）。本文件相应改为断言"不碰源列表、只发一次"。
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

  it('加载全局表目录并按 tableId 去重', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([
      { tableId: 't1', tableName: 'T1' },
      { tableId: 't1', tableName: 'T1' },
      { tableId: 't3', tableName: 'T3', name: '表三' },
    ]))

    const result = await siteApi.siteTables('site-x', { force: true })

    const byId = Object.fromEntries(result.tables.map((t) => [t.tableId, t]))
    expect(result.tables).toHaveLength(2)
    expect(byId.t1).toMatchObject({ tableName: 'T1' })
    expect(byId.t3).toMatchObject({ tableName: 'T3', name: '表三' })
  })

  it('三个分组一起合并——并集才是完整目录，单看 list1 会漏', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue({
      list1: [{ tableId: 't1', tableName: 'T1', fields: [] }],
      list2: [{ tableId: 't2', tableName: 'T2', fields: [] }],
      list3: [{ tableId: 't3', tableName: 'T3', fields: [] }],
    })

    const result = await siteApi.siteTables('site-groups', { force: true })

    expect(result.tables.map((t) => t.tableId).sort()).toEqual(['t1', 't2', 't3'])
  })

  // 这是本次改动的核心：旧实现要先拉 siteSourcePreview(120) 和 siteSources(5439 条、4s+)
  // 去凑源 ID，再分 19 片、6 路并发打出去。那 6 路正好占满浏览器对单域名的 6 个连接，
  // 把同期的表结构查询和逐源数据查询挤在队列里超时（20s 从入队开始算）。现在一个都不用拉。
  it('不再为了凑源 ID 去拉源列表', async () => {
    const preview = vi.spyOn(siteApi, 'siteSourcePreview')
    const full = vi.spyOn(siteApi, 'siteSources')
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await siteApi.siteTables('site-no-sources', { force: true })

    expect(preview).not.toHaveBeenCalled()
    expect(full).not.toHaveBeenCalled()
  })

  it('只发一次请求，且不带 sourceId——带了也只影响分组，不影响并集', async () => {
    const entryTypesGroup = vi.spyOn(dataApi, 'entryTypesGroup')
      .mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await siteApi.siteTables('site-once', { force: true })

    expect(entryTypesGroup).toHaveBeenCalledTimes(1)
    expect(entryTypesGroup).toHaveBeenCalledWith()
  })

  it('目录请求失败时整体失败，不伪造部分成功', async () => {
    vi.spyOn(dataApi, 'entryTypesGroup').mockRejectedValue(new Error('boom'))

    await expect(siteApi.siteTables('site-catalog-fail', { force: true })).rejects.toThrow('boom')
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

  it('onProgress 仍然回调一次最终目录（调用方靠它结束 loading）', async () => {
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
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(group([{ tableId: 't1', tableName: 'T1' }]))

    await expect(siteApi.siteTables('site-retry', { force: true })).rejects.toThrow('boom')
    const result = await siteApi.siteTables('site-retry')

    expect(result.tables.map((t) => t.tableId)).toEqual(['t1'])
    expect(entryTypesGroup).toHaveBeenCalledTimes(2)
  })
})
