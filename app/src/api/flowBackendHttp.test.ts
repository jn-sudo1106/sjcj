// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('流程分流实际 HTTP 请求', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ code: '0', success: true, data: [], count: 0 }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.stubEnv('VITE_API_PROXY_TARGET', 'http://118.25.96.217:9999')
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
    window.location.hash = '#/flows'
    vi.resetModules()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.location.hash = '' })

  it('流程和节点保存走本地，保留请求体和同源 Cookie', async () => {
    const { request } = await import('./client')
    await request('flow/saveFlow', { flowName: '草稿' })
    await request('config/modify/updateConfig', { configId: 123 })
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/local-flow/v1/flow/saveFlow', '/api/local-flow/v1/config/modify/updateConfig',
    ])
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ configId: 123 })
  })

  it('源、任务和数据接口保留原路径，切换到数据视图时步骤查询也保留原路径', async () => {
    const { request } = await import('./client')
    for (const endpoint of ['site/sources', 'source/sourceDetail', 'task/topTaskPaged', 'entry/entryDataPaged']) await request(endpoint)
    window.location.hash = '#/canvas?view=data&sourceId=1'
    await request('item/next/nextConfigPaged')
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/site/sources', '/api/v1/source/sourceDetail', '/api/v1/task/topTaskPaged',
      '/api/v1/entry/entryDataPaged', '/api/v1/item/next/nextConfigPaged',
    ])
  })

  it('流程反查关联源使用本地关系，普通选源列表仍请求原后台', async () => {
    const { sourceApi } = await import('./index')
    await sourceApi.sourcePaged({ flowId: '123', page: 2, size: 10 })
    await sourceApi.sourcePaged({ page: 1, size: 20 })
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['/api/local-flow/v1/flow/flowSources', '/api/v1/source/sourcePaged'])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ flowId: '123', page: 2, limit: 10 })
  })

  it('流程步骤和配置补查显式保留本地来源，运行视图可明确选择原后台', async () => {
    window.location.hash = '#/canvas?view=overview'
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: [{ itemConfig: 99, configId: 88, name: '入口', isRoot: 1 }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ code: 0, data: { configId: 88, configName: '配置' } }) })
    const { flowCenterApi } = await import('./index')
    await flowCenterApi.steps('456')
    expect(fetchMock.mock.calls.map((call) => String(call[0]).split('?')[0])).toEqual([
      '/api/local-flow/v1/item/next/nextConfigPaged', '/api/local-flow/v1/config/configDetail',
    ])
    window.location.hash = '#/canvas?view=flow'
    await flowCenterApi.steps('123', { withConfigDetails: false, backendScope: 'default' })
    expect(String(fetchMock.mock.calls[2][0]).split('?')[0]).toBe('/api/v1/item/next/nextConfigPaged')
  })

  it('本地流程故障直接报错，不退回原后台发起同样的写请求', async () => {
    fetchMock.mockRejectedValue(new Error('local backend unavailable'))
    const { request } = await import('./client')
    await expect(request('flow/saveFlow', { flowName: '草稿' })).rejects.toThrow('local backend unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/local-flow/v1/flow/saveFlow')
  })

  it('其他功能仍受原生产写保护，自定义 API 地址也按实际目的地保护', async () => {
    const { request } = await import('./client')
    await expect(request('source/updateSourceSimple', { sourceId: 1 })).rejects.toThrow('生产环境写保护')
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('VITE_API_BASE', 'http://118.25.96.217:9999/api/v1/')
    vi.resetModules()
    const custom = await import('./client')
    await expect(custom.request('config/delete', { id: 1 })).rejects.toThrow('生产环境写保护')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
