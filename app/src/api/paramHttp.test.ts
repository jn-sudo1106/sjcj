// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  // request() 现在先 res.text() 再 JSON.parse（client.ts 空响应体兜底），mock 也要跟着给 text()
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

describe('参数 API 旧平台 HTTP 契约', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('列表使用 GET、page/limit 和旧字段名，并转换返回字段', async () => {
    // 真实分页总数字段是 count，不是 totalCount（2026-07-17 T3 真实联调实测修正，见 client.ts normalizeHttpPayload）
    fetchMock.mockResolvedValue(jsonResponse({
      code: 0,
      msg: null,
      count: 1,
      data: [{ paramId: 8, paramName: '页码', paramType: 'seq', valueDef: '{"start":1,"end":3,"step":1}',
        createDt: '2026-10-26 10:00:00', updateDt: '2026-10-26 11:00:00' }],
      exts: null,
    }))
    const { paramApi } = await import('./index')

    const result = await paramApi.paramPaged({ page: 2, size: 30, paramId: '8', paramName: '页码' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/config/paramPaged?')
    expect(url).toContain('page=2')
    expect(url).toContain('limit=30')
    expect(url).toContain('paramId=8')
    expect(url).toContain(encodeURIComponent('页码'))
    expect(url).not.toContain('size=')
    // D1：固定带 enable=0（旧 ParamList 初始查询口径，不随重置清除）
    expect(url).toContain('enable=0')
    expect(init.method).toBe('GET')
    expect(result).toEqual({
      total: 1,
      list: [expect.objectContaining({ paramId: '8', name: '页码', kind: 'sequence', createdAt: '2026-10-26 10:00:00', updatedAt: '2026-10-26 11:00:00' })],
    })
  })

  it('按类型查询将页面类型映射为旧接口 paramType，并保持分页', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, count: 1, data: [{ paramId: 9, paramName: '页码', paramType: 'seq' }] }))
    const { paramApi } = await import('./index')
    const result = await paramApi.paramPaged({ page: 2, size: 30, kind: 'sequence' })
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('paramType=seq')
    expect(url).toContain('page=2')
    expect(url).toContain('limit=30')
    expect(url).not.toContain('kind=')
    expect(result.total).toBe(1)
  })

  it('新增使用 POST JSON 和旧字段名', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '操作成功', data: null }))
    const { paramApi } = await import('./index')

    const result = await paramApi.paramCreate({ name: '页码', kind: 'sequence', seq: { start: 1, end: 3, step: 1 } })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({
      paramName: '页码',
      paramType: 'seq',
      valueDef: '{"start":1,"end":3,"step":1}',
    })
    expect(result.ok).toBe(true)
  })

  it('修改沿用旧接口的 POST 查询参数', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: null }))
    const { paramApi } = await import('./index')

    const result = await paramApi.paramUpdate({ paramId: '8', name: '新页码', kind: 'list', values: ['1', '2'] })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(url).toContain('paramId=8')
    expect(url).toContain(encodeURIComponent('新页码'))
    expect(url).toContain('paramType=list')
    // 真实 updateParam 常见返回是 data:null 的 Ack；UI 仍需取得当前参数用于收口编辑态。
    expect(result).toMatchObject({ ok: true, param: { paramId: '8', name: '新页码' } })
  })

  it('详情使用 GET 和旧字段名 paramId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { paramId: 8, paramName: '页码', paramType: 'list' } }))
    const { paramApi } = await import('./index')

    await paramApi.paramDetail('8')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/paramDetail?')
    expect(url).toContain('paramId=8')
  })

  it('生成值预览使用 GET 和旧字段名 paramId', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: ['a', 'b'] }))
    const { paramApi } = await import('./index')

    await paramApi.genValues('8')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/genValues?')
    expect(url).toContain('paramId=8')
  })

  it('新增参数值使用 POST JSON，旧字段名 paramId/paramValues', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '增加成功', data: null }))
    const { paramApi } = await import('./index')

    await paramApi.addParamValues('8', '上海\n深圳')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/v1/config/addParamValues')
    expect(url).not.toContain('?')
    expect(JSON.parse(String(init.body))).toEqual({ paramId: '8', paramValues: '上海\n深圳' })
  })

  it('删除参数值使用 GET 和旧字段名 id（非 valueId）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '删除成功', data: null }))
    const { paramApi } = await import('./index')

    await paramApi.deleteParamValue('7')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/paramValueDel?')
    expect(url).toContain('id=7')
    expect(url).not.toContain('valueId=')
  })

  it('制作副本使用 POST 查询参数，body 为空', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '复制成功,请刷新后查询最新ID', data: null }))
    const { paramApi } = await import('./index')

    await paramApi.paramCopy('8')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(url).toContain('/api/v1/config/param-copy?')
    expect(url).toContain('paramId=8')
    expect(init.body).toBeUndefined()
  })

  it('批量删除和清缓存使用 GET，ids 用逗号连接', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '删除成功', data: null }))
    const { paramApi } = await import('./index')

    await paramApi.deleteParams(['1', '2', '3'])
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/deleteParam?')
    expect(url).toContain('ids=1%2C2%2C3')

    fetchMock.mockClear()
    await paramApi.clearParams(['4', '5'])
    ;[url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('GET')
    expect(url).toContain('/api/v1/config/clear?')
    expect(url).toContain('ids=4%2C5')
  })
})
