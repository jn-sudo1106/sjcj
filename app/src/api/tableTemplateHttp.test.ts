// @vitest-environment jsdom
// 表模板配置接口契约（1013 从旧 ai-chat-view「模板配置 → 表模板配置」迁入）。
// 旧契约见 src/demoApi/EntityApi.js:323-345：分页与保存走 body，启停走 **query**，
// 且端点域是 question-temp（菜单标题才叫「表模板」）。mock 分支钉住内存表写操作真落库。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const TABLE_ROW = {
  id: 12,
  name: '查询某机构某日期的指标值',
  rule: "string.contains(msg,'指标')",
  tableArr: '["KHFA_KHZBJG_JG"]',
  sqlTempConfigIds: '[9]',
  status: '0',
}
const ENVELOPE_PAGE = { code: 0, msg: '请求成功', count: 3, data: [TABLE_ROW] }
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }
const ENVELOPE_LIST = { code: 0, msg: '请求成功', data: [{ tableName: 'KHFA_KHZBJG_JG', typeName: '客户指标结果' }] }

describe('表模板配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/question-temp/page，问句样例名称与分页在 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { tableTemplateApi } = await import('./templateConfig')

    const res = await tableTemplateApi.page({ pageNo: 1, pageSize: 20, name: '指标' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-temp/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 1, pageSize: 20, name: '指标' })
    expect(res).toEqual({ total: 3, list: ENVELOPE_PAGE.data })
  })

  it('save：新增与编辑同一个端点，tableArr / sqlTempConfigIds 按 JSON 字符串提交', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { tableTemplateApi } = await import('./templateConfig')

    await tableTemplateApi.save({ id: 12, name: '问句', rule: 'x', tableArr: '["A","B"]', sqlTempConfigIds: '[9,8]', status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-temp')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ id: 12, name: '问句', rule: 'x', tableArr: '["A","B"]', sqlTempConfigIds: '[9,8]', status: '0' })
  })

  it('changeStatus：POST /api/poc/question-temp/status?id=&status=，无 body（旧契约）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { tableTemplateApi } = await import('./templateConfig')

    await tableTemplateApi.changeStatus?.(12, '1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/question-temp/status?id=12&status=1')
    expect(init.body).toBeUndefined()
  })

  it('不提供 copy：旧平台没有 /poc/question-temp/copy 端点（旧页面的「复制」链接是坏的）', async () => {
    const { tableTemplateApi } = await import('./templateConfig')
    expect(tableTemplateApi.copy).toBeUndefined()
  })

  it('entry-list：GET /api/poc/database/entry-list?name=，响应 data 数组直接透传（无 count 不当分页处理）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_LIST))
    const { pocTableEntryList } = await import('./templateConfig')

    const list = await pocTableEntryList('KHFA')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/database/entry-list?name=KHFA')
    expect(init.method).toBe('GET')
    expect(list).toEqual(ENVELOPE_LIST.data)
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '问句样例已存在' }))
    const { tableTemplateApi } = await import('./templateConfig')

    await expect(tableTemplateApi.save({ name: '重复' })).rejects.toThrow('问句样例已存在')
  })
})

describe('表模板配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页支持问句样例名称模糊筛，保存与启停真落内存表', async () => {
    const { tableTemplateApi } = await import('./templateConfig')

    const first = await tableTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(first.total).toBeGreaterThan(0)

    const filtered = await tableTemplateApi.page({ pageNo: 1, pageSize: 20, name: '同比' })
    expect(filtered.list.every((row) => String(row.name).includes('同比'))).toBe(true)

    const target = first.list[0]
    await tableTemplateApi.save({ ...target, name: '改过的问句', tableArr: '["KHFA_ZB_DEF"]' })
    const afterSave = await tableTemplateApi.page({ pageNo: 1, pageSize: 20, name: '改过的问句' })
    expect(afterSave.list[0]?.tableArr).toBe('["KHFA_ZB_DEF"]')

    const before = (await tableTemplateApi.page({ pageNo: 1, pageSize: 20 })).total
    await tableTemplateApi.save({ name: '新增的问句', rule: '', tableArr: '[]', sqlTempConfigIds: '[]', status: '0' })
    expect((await tableTemplateApi.page({ pageNo: 1, pageSize: 20 })).total).toBe(before + 1)

    await tableTemplateApi.changeStatus?.(Number(target.id), '1')
    const afterStatus = await tableTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterStatus.list.find((row) => row.id === target.id)?.status).toBe('1')
  })

  it('数据表选项按表名模糊筛；sql 模板分页带 ids 时只回已选项（表模板弹窗回显用）', async () => {
    const { pocTableEntryList, sqlTemplateApi } = await import('./templateConfig')

    const all = await pocTableEntryList('')
    expect(all.length).toBeGreaterThan(0)
    const picked = await pocTableEntryList('ZB_DEF')
    expect(picked.map((entry) => entry.tableName)).toContain('KHFA_ZB_DEF')

    const byIds = await sqlTemplateApi.page({ pageNo: 1, pageSize: 10, name: '', ids: [9] })
    expect(byIds.list.map((row) => row.id)).toEqual([9])
  })
})
