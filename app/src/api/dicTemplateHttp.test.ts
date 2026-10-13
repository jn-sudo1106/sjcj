// @vitest-environment jsdom
// 自动补全配置接口契约（1013 从旧 ai-chat-view 迁入）。
// 这个模块最容易踩的旧口径：**新增与修改是两个端点**（POST /poc/dic 与 POST /poc/dic/update），
// 与其他模板模块「同一根端点带 id 即更新」不同；且没有 /status、/copy。两条分支都钉死。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 3,
  data: [{ id: 3, content: '查询某机构某日期的客户指标结果', keyWords: '机构 日期', type: 1, createTime: '2025-04-15 09:52:07' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('自动补全配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/dic/page，筛选参数按旧口径叫 name、分页在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { dicTemplateApi } = await import('./templateConfig')

    const res = await dicTemplateApi.page({ pageNo: 1, pageSize: 20, name: '指标' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/dic/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 1, pageSize: 20, name: '指标' })
    expect(res).toEqual({ total: 3, list: ENVELOPE_PAGE.data })
  })

  it('save（新增，不带 id）：POST /api/poc/dic，type=1/status="0" 原样进 body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dicTemplateApi } = await import('./templateConfig')

    await dicTemplateApi.save({ content: '新词条', keyWords: '新 词条', type: 1, status: '0' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/dic')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ content: '新词条', keyWords: '新 词条', type: 1, status: '0' })
  })

  it('save（修改，带 id）：POST /api/poc/dic/update —— 与新增不是一个端点', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { dicTemplateApi } = await import('./templateConfig')

    await dicTemplateApi.save({ id: 3, content: '改过的内容', keyWords: '改过' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/dic/update')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ id: 3, content: '改过的内容', keyWords: '改过' })
  })

  it('不提供启停与复制（旧后端没有 /poc/dic/status、/poc/dic/copy）', async () => {
    const { dicTemplateApi } = await import('./templateConfig')
    expect(dicTemplateApi.changeStatus).toBeUndefined()
    expect(dicTemplateApi.copy).toBeUndefined()
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '词条已存在' }))
    const { dicTemplateApi } = await import('./templateConfig')

    await expect(dicTemplateApi.save({ content: '重复' })).rejects.toThrow('词条已存在')
  })
})

describe('自动补全配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页按 name 模糊筛「内容」，新增/修改真落内存表', async () => {
    const { dicTemplateApi } = await import('./templateConfig')

    const first = await dicTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(first.total).toBeGreaterThan(0)

    const filtered = await dicTemplateApi.page({ pageNo: 1, pageSize: 20, name: '同比' })
    expect(filtered.list.every((row) => String(row.content).includes('同比'))).toBe(true)

    // 新增（不带 id）落表
    const before = first.total
    await dicTemplateApi.save({ content: '新增的词条', keyWords: '新增', type: 1, status: '0' })
    const afterAdd = await dicTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterAdd.total).toBe(before + 1)

    // 修改（带 id）更新原行，不新增
    const added = afterAdd.list.find((row) => row.content === '新增的词条')!
    await dicTemplateApi.save({ id: added.id, content: '改过的词条', keyWords: '改过' })
    const afterUpdate = await dicTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterUpdate.total).toBe(before + 1)
    expect(afterUpdate.list.find((row) => row.id === added.id)?.content).toBe('改过的词条')
  })
})
