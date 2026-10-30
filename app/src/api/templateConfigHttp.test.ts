// @vitest-environment jsdom
// SQL 模板配置接口契约（1013 从旧 ai-chat-view 迁入）。
// http 分支钉住真实 URL / 方法 / 参数落位（旧契约：分页与保存走 body，启停与复制走 query），
// mock 分支钉住内存表写操作真落库，两条口径都不能被"顺手重构"掉。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 响应也要给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ENVELOPE_PAGE = {
  code: 0,
  msg: '请求成功',
  count: 10,
  data: [{ id: 36, name: '不校验', status: '1', createTime: '2025-04-11 11:34:39' }],
}
const ENVELOPE_ACK = { code: 0, msg: '请求成功', count: null, data: null }

describe('SQL 模板配置 · /api/poc HTTP 契约', () => {
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

  it('page：POST /api/poc/sql-temp/page，筛选与分页在 body，响应 {count,data} 归一成 {list,total}', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_PAGE))
    const { sqlTemplateApi } = await import('./templateConfig')

    const res = await sqlTemplateApi.page({ pageNo: 2, pageSize: 20, name: '不校验' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/sql-temp/page')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ pageNo: 2, pageSize: 20, name: '不校验' })
    expect(res).toEqual({ total: 10, list: ENVELOPE_PAGE.data })
  })

  it('save：新增与编辑同一个端点 POST /api/poc/sql-temp，带 id 即更新', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { sqlTemplateApi } = await import('./templateConfig')

    await sqlTemplateApi.save({ id: 36, name: '不校验', status: '1' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/sql-temp')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init.body))).toEqual({ id: 36, name: '不校验', status: '1' })
  })

  it('changeStatus：POST /api/poc/sql-temp/status，id 与 status 在 **query**、无 body（旧契约）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { sqlTemplateApi } = await import('./templateConfig')

    await sqlTemplateApi.changeStatus?.(36, '0')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/sql-temp/status?id=36&status=0')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('copy：POST /api/poc/sql-temp/copy?id=，参数在 query', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { sqlTemplateApi } = await import('./templateConfig')

    await sqlTemplateApi.copy?.(36)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/sql-temp/copy?id=36')
  })

  it('remove：POST /api/poc/sql-temp/delete?id=，id 在 query、无 body（与 status/copy 同形态）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { sqlTemplateApi } = await import('./templateConfig')

    await sqlTemplateApi.remove(36)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/poc/sql-temp/delete?id=36')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('没补删除端点的模块不给 remove（表模板后端没有 /delete，按钮也就不会出现）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { tableTemplateApi, replaceTableConfigApi } = await import('./templateConfig')

    expect('remove' in tableTemplateApi).toBe(false)
    expect('remove' in replaceTableConfigApi).toBe(false)
  })

  it('业务失败（code ≠ 0）抛出后端 msg，不静默成功', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 500, msg: '模板名称已存在' }))
    const { sqlTemplateApi } = await import('./templateConfig')

    await expect(sqlTemplateApi.save({ name: '重复' })).rejects.toThrow('模板名称已存在')
  })

  it('POC 请求的目的地按 /api/poc 自己的代理目标算，不被业务后端的生产写守卫拦', async () => {
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    fetchMock.mockResolvedValue(jsonResponse(ENVELOPE_ACK))
    const { sqlTemplateApi } = await import('./templateConfig')

    // save 是 danger 端点：若目的地算成 217，会在发请求前被 ProductionWriteBlockedError 拦下
    await expect(sqlTemplateApi.save({ id: 36, name: '不校验' })).resolves.toMatchObject({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('SQL 模板配置 · mock 内存表（演示 / 单测口径）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('分页支持名称模糊筛，保存/启停/复制真落内存表', async () => {
    const { sqlTemplateApi } = await import('./templateConfig')

    const first = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(first.total).toBeGreaterThan(0)

    const filtered = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20, name: '单指标' })
    expect(filtered.list.every((row) => String(row.name).includes('单指标'))).toBe(true)

    const target = first.list[0]
    await sqlTemplateApi.save({ ...target, name: '改过的名字' })
    const afterSave = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20, name: '改过的名字' })
    expect(afterSave.list.map((row) => row.id)).toContain(target.id)

    await sqlTemplateApi.changeStatus?.(Number(target.id), '0')
    const afterStatus = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterStatus.list.find((row) => row.id === target.id)?.status).toBe('0')

    const before = afterStatus.total
    await sqlTemplateApi.copy?.(Number(target.id))
    const afterCopy = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(afterCopy.total).toBe(before + 1)
  })

  it('删除是软删口径：行从分页里消失，别的行不受影响', async () => {
    const { sqlTemplateApi } = await import('./templateConfig')

    const before = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20 })
    const victim = before.list[0]
    await sqlTemplateApi.remove(Number(victim.id))

    const after = await sqlTemplateApi.page({ pageNo: 1, pageSize: 20 })
    expect(after.total).toBe(before.total - 1)
    expect(after.list.some((row) => Number(row.id) === Number(victim.id))).toBe(false)
    // 其余行还在（不是把整张表清了）
    expect(after.list.map((row) => Number(row.id))).toEqual(before.list.slice(1).map((row) => Number(row.id)))
  })
})
