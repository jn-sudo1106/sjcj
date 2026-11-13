// @vitest-environment jsdom
// 数据索引同步接口契约（1013 从旧 ai-chat-view 迁入，端点域 /poc/data-index-sync）。
// 这个模块有三条容易被"顺手统一"掉的旧口径，全部钉死：
// ① 新增与修改是两个端点（POST /poc/data-index-sync 与 POST /poc/data-index-sync/update）；
// ② 同步动作 POST /poc/data-index-sync/sync 的 body 是 **id 数组**（旧页面单行同步发 [row.id]）；
// ③ 本模块没有启停与复制 —— 旧列表/旧弹窗都没有这两个入口（对比 question-dic 有 status）。
// 分页契约已在 186 POC 服务实测（2026-10-13）：信封 {code,msg,count,data}，name 模糊匹配 comment。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 46,
  data: [
    {
      id: 56,
      type: 0,
      tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
      columnName: 'BRANCH_NAME',
      comment: '机构指标数据表-机构名称',
      syncSql: 'select distinct BRANCH_NAME,BRANCH_NO as CODE from ADS_HFBI_ZQFXS_JGZBMX',
      status: 0,
      lastSync: '2025-06-13 18:23:56',
      createTime: '2025-04-22 18:56:48',
      updateTime: '2025-04-22 18:56:48',
      delFlag: '0',
    },
  ],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('数据索引同步 · /api/poc HTTP 契约', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('page：POST /api/poc/data-index-sync/page，name/status 与分页全在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { dataIndexSyncApi } = await import('./templateConfig')

    const res = await dataIndexSyncApi.page({ pageNo: 2, pageSize: 20, name: '机构', status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-sync/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: '机构', status: '0' })
    expect(res).toEqual({ total: 46, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/data-index-sync，type 数字与 status="0" 原样进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dataIndexSyncApi } = await import('./templateConfig')

    await dataIndexSyncApi.save({
      comment: '机构指标数据表-机构名称',
      tableName: 'ADS_HFBI_ZQFXS_JGZBMX',
      type: 0,
      columnName: 'BRANCH_NAME',
      syncSql: 'select distinct BRANCH_NAME from ADS_HFBI_ZQFXS_JGZBMX',
      beforeSql: '',
      afterSql: '',
      status: '0',
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-sync')
    expect(JSON.parse(String(init.body))).toMatchObject({ comment: '机构指标数据表-机构名称', type: 0, status: '0' })
  })

  it('save（修改，带 id）：POST /api/poc/data-index-sync/update —— 与新增不是一个端点', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dataIndexSyncApi } = await import('./templateConfig')

    await dataIndexSyncApi.save({ id: 56, columnName: 'BRANCH_NO', syncSql: 'select distinct BRANCH_NO from ADS_HFBI_ZQFXS_JGZBMX' })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-sync/update')
  })

  it('sync：POST /api/poc/data-index-sync/sync，body 是裸 **id 数组**（不是 {ids:[...]}）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dataIndexSyncApi } = await import('./templateConfig')

    await dataIndexSyncApi.sync([56])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/data-index-sync/sync')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual([56])
  })

  it('不提供启停与复制（旧后端没有 /poc/data-index-sync/status、/copy）', async () => {
    const { dataIndexSyncApi } = await import('./templateConfig')
    expect(dataIndexSyncApi.changeStatus).toBeUndefined()
    expect(dataIndexSyncApi.copy).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '同步配置不存在' }))
    const { dataIndexSyncApi } = await import('./templateConfig')

    await expect(dataIndexSyncApi.sync([999])).rejects.toThrow('同步配置不存在')
  })
})

describe('数据索引同步 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页支持 name（匹配同步名称 comment）与 status 两个条件，空串按全部处理', async () => {
    const { dataIndexSyncApi } = await import('./templateConfig')

    const all = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20, name: '', status: '' })
    expect(all.total).toBeGreaterThan(0)

    const byName = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20, name: '机构' })
    expect(byName.list.length).toBeGreaterThan(0)
    expect(byName.list.every((row) => String(row.comment).includes('机构'))).toBe(true)

    const byStatus = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20, status: '1' })
    expect(byStatus.list).toHaveLength(0)
  })

  it('新增/修改真落内存表，且修改不会新增行', async () => {
    const { dataIndexSyncApi } = await import('./templateConfig')

    const before = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20 })

    await dataIndexSyncApi.save({ comment: '新增的同步配置', tableName: 'T_NEW', type: 0, columnName: 'C', syncSql: 'select 1', status: '0' })
    const afterAdd = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(before.total + 1)

    const added = afterAdd.list.find((row) => row.comment === '新增的同步配置')!
    await dataIndexSyncApi.save({ id: added.id, comment: '改过的同步配置', syncSql: 'select 2' })
    const afterUpdate = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(before.total + 1)
    const updated = afterUpdate.list.find((row) => row.id === added.id)!
    expect(updated.comment).toBe('改过的同步配置')
    expect(updated.syncSql).toBe('select 2')
    // 旧新增弹窗固定提交 status '0'，新增行落地就该是启用态
    expect(String(updated.status)).toBe('0')
    expect(updated.lastSync).toBeNull()
  })

  it('sync 按 id 数组回写最近同步时间，未知 id 不改任何行', async () => {
    const { dataIndexSyncApi } = await import('./templateConfig')

    const first = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20 })
    const target = first.list[0]!

    await dataIndexSyncApi.sync([Number(target.id)])
    const afterSync = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterSync.list.find((row) => row.id === target.id)?.lastSync).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    await dataIndexSyncApi.sync([999999])
    const afterMiss = await dataIndexSyncApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterMiss.total).toBe(afterSync.total)
  })
})
