// 节点类型（0924-04，系统设置 → 节点类型）旧平台 HTTP 契约。
// 响应形状取自 2026-09-24 生产实测：读接口 {success:true, code:null, data}，写接口 {success:true, code:"0", msg}。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

const ROW = { downType: 'source-config-mail', notes: null, params: null, procType: '700', seq: -1, sourceType: 160, topic: null, typeName: 'Mail抓取' }

describe('节点类型 API 旧平台 HTTP 契约', () => {
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

  it('列表：GET、typeName 模糊、不带分页参数；code:null 视为成功，字段转成字符串 / 数字', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: null, msg: null, data: [ROW] }))
    const { configApi } = await import('./index')

    const list = await configApi.nodeTypeList(' 抓取 ')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/sourceType/list?')
    expect(url).toContain(`typeName=${encodeURIComponent('抓取')}`)
    expect(url).not.toMatch(/page=|limit=/)
    expect(init.method).toBe('GET')
    expect(list).toEqual([{
      sourceType: '160', typeName: 'Mail抓取', typeGroup: '', downType: 'source-config-mail', topic: '', seq: -1, notes: '', procType: '700', params: '',
    }])
  })

  it('列表不传名称时不带 typeName', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: null, data: [] }))
    const { configApi } = await import('./index')
    await configApi.nodeTypeList()
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('typeName')
    expect(url).not.toContain('typeGroup')
  })

  it('读取分组选项：GET独立只读接口，不读取管理员配置列表', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: null, data: ['采集类', '规则类'] }))
    const { configApi } = await import('./index')
    expect(await configApi.nodeTypeGroups()).toEqual(['采集类', '规则类'])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/sourceType\/typeGroups$/)
    expect(init.method).toBe('GET')
  })

  it('分组配置未维护时返回空列表，格式错误时明确失败', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, code: null, data: [] }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, code: null, data: [1] }))
    const { configApi } = await import('./index')
    expect(await configApi.nodeTypeGroups()).toEqual([])
    await expect(configApi.nodeTypeGroups()).rejects.toThrow('分组类型配置格式错误')
  })

  it('分组精确筛选与响应分组字段透传', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: null, data: [{ ...ROW, typeGroup: '采集类' }] }))
    const { configApi } = await import('./index')
    const rows = await configApi.nodeTypeList('抓取', ' 采集类 ')
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://localhost').searchParams.get('typeGroup')).toBe('采集类')
    expect(rows[0]?.typeGroup).toBe('采集类')
  })

  it('修改分组只传该字段，清除分组保留显式空串', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '更新成功' }))
    const { configApi } = await import('./index')
    await configApi.nodeTypeUpdate('160', { typeGroup: '采集类' })
    await configApi.nodeTypeUpdate('160', { typeGroup: '' })
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ sourceType: 160, typeGroup: '采集类' })
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({ sourceType: 160, typeGroup: '' })
  })

  it('详情：GET ?sourceType=；不存在时（code:"-1"）抛出后端原文', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, code: null, data: ROW }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, code: '-1', msg: '源类型不存在: 99901', data: null }))
    const { configApi } = await import('./index')

    expect((await configApi.nodeTypeDetail('160'))?.typeName).toBe('Mail抓取')
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/v1/sourceType/detail?sourceType=160')
    await expect(configApi.nodeTypeDetail('99901')).rejects.toThrow('源类型不存在: 99901')
  })

  it('新增：POST JSON body；不填 sourceType 时不带该字段（后端取 max+1）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '新增成功, sourceType=801', data: 801 }))
    const { configApi } = await import('./index')

    const ack = await configApi.nodeTypeAdd({ sourceType: '', typeName: '新类型', downType: 'source-config', seq: 10, notes: '' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/sourceType\/add$/)
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual({ typeName: '新类型', downType: 'source-config', seq: 10, notes: '' })
    expect(ack).toMatchObject({ ok: true, message: '新增成功, sourceType=801' })
  })

  it('修改：POST JSON body，只带改动字段 + 数字主键（后端增量更新）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', msg: '更新成功', data: null }))
    const { configApi } = await import('./index')

    await configApi.nodeTypeUpdate('160', { typeName: 'Mail 抓取' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/sourceType\/update$/)
    expect(JSON.parse(String(init.body))).toEqual({ typeName: 'Mail 抓取', sourceType: 160 })
  })

  it('写失败时抛出后端 msg', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '类型名称已存在', data: null }))
    const { configApi } = await import('./index')
    await expect(configApi.nodeTypeAdd({ typeName: '网页抓取' })).rejects.toThrow('类型名称已存在')
  })
})
