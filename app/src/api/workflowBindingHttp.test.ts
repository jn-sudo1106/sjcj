// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response
}

function errorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    clone: () => ({ json: async () => body }),
  } as unknown as Response
}

describe('workflow 源多流程绑定 HTTP 契约', () => {
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

  it('查询时 sourceId 走 query，并保留继承和主流程语义', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: [{
      id: 8,
      bindType: 'SOURCE_GROUP',
      bindId: 405,
      workflowId: 1400935,
      workflowCode: 'legacy-1400935',
      workflowName: '新闻采集',
      versionNo: 2,
      followsCurrentVersion: true,
      role: 'MAIN',
      primary: true,
      priority: 0,
      status: 'ACTIVE',
      inherited: true,
    }] }))
    const { workflowBindingApi } = await import('./index')
    const rows = await workflowBindingApi.list('430024641')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const parsed = new URL(url, 'http://local.test')
    expect(parsed.pathname).toBe('/api/v1/workflow/sourceBindings')
    expect(parsed.searchParams.get('sourceId')).toBe('430024641')
    expect(init.method).toBe('GET')
    expect(rows[0]).toMatchObject({ workflowId: '1400935', inherited: true, primary: true, role: 'MAIN', versionManaged: true })
  })

  it('新接口未部署时按旧 FLOW_ID 返回兼容流程，不误锁旧画布', async () => {
    fetchMock.mockResolvedValue(errorResponse(404, { message: 'Not Found' }))
    const compatibility = vi.fn()
    const { workflowBindingApi } = await import('./index')
    const rows = await workflowBindingApi.list('430024641', {
      legacySource: { sourceId: '430024641', flowId: '1400935', updatedAt: '2026-10-06 00:00:00' },
      onCompatibility: compatibility,
    })

    expect(compatibility).toHaveBeenCalledOnce()
    expect(rows).toEqual([expect.objectContaining({
      id: 'legacy:430024641:1400935',
      workflowId: '1400935',
      role: 'MAIN',
      primary: true,
      inherited: false,
      versionManaged: false,
    })])
  })

  it('绑定、设主流程和新建均使用 JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, code: '0', data: {
      id: 9, bindType: 'SOURCE', bindId: 430024641, workflowId: 1401000,
      workflowCode: 'WF-1401000', workflowName: '补数据', role: 'BACKFILL',
      primary: false, priority: 100, status: 'ACTIVE', inherited: false,
    } }))
    const { workflowBindingApi } = await import('./index')
    await workflowBindingApi.bind({ sourceId: '430024641', workflowId: '1401000', role: 'BACKFILL' })
    await workflowBindingApi.setPrimary('430024641', '1401000')
    await workflowBindingApi.createForSource({ sourceId: '430024641', name: '临时补数', role: 'BACKFILL' })

    expect(new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test').pathname).toBe('/api/v1/workflow/bindSource')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ sourceId: '430024641', workflowId: '1401000', role: 'BACKFILL' })
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ sourceId: '430024641', workflowId: '1401000' })
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body))).toEqual({ sourceId: '430024641', name: '临时补数', role: 'BACKFILL' })
  })

  it('创建草稿与发布都以稳定 workflowId 调用，并解析工作副本版本状态', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', data: {
        workflowId: 1400935, workflowName: '新闻采集', draftVersionId: 802,
        draftVersionNo: 2, draftFlowId: 1402001, publishedVersionNo: 1,
        publishedFlowId: 1400935, versionStatus: 'DRAFT', workflowStatus: 'ACTIVE',
      } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, code: '0', data: {
        workflowId: 1400935, workflowName: '新闻采集', publishedVersionId: 802,
        publishedVersionNo: 2, publishedFlowId: 1402001,
        versionStatus: 'PUBLISHED', workflowStatus: 'ACTIVE',
      } }))
    const { workflowBindingApi } = await import('./index')

    const draft = await workflowBindingApi.ensureDraft('1400935')
    const published = await workflowBindingApi.publish('1400935')

    expect(draft).toMatchObject({ workflowId: '1400935', draftVersionNo: 2, draftFlowId: '1402001', versionStatus: 'DRAFT', versionManaged: true })
    expect(published).toMatchObject({ workflowId: '1400935', publishedVersionNo: 2, publishedFlowId: '1402001', versionStatus: 'PUBLISHED' })
    expect(new URL(String(fetchMock.mock.calls[0][0]), 'http://local.test').pathname).toBe('/api/v1/workflow/ensureDraft')
    expect(new URL(String(fetchMock.mock.calls[1][0]), 'http://local.test').pathname).toBe('/api/v1/workflow/publish')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ workflowId: '1400935' })
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ workflowId: '1400935' })
  })
})
