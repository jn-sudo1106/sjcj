// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

// workflow/* 在 217 上还没有（endpoints.ts 标 live:false）。线上构建是 mock 模式：未上线时界面只读、调用直接报错，
// 不落 mock（mock 下写接口会返回假的「成功」）。本地开发配了流程专用后端（VITE_FLOW_PROXY_TARGET）时照常可用。
describe('多流程接口开关', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('mock 模式、未标 live、没有本地流程后端：不可用，调用直接报错且不发请求', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { workflowBindingApi } = await import('@/api')
    expect(workflowBindingApi.available()).toBe(false)
    await expect(workflowBindingApi.publish('wf-1')).rejects.toThrow('多流程接口尚未在当前后端上线')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('配了本地流程后端：可用，请求转到 /api/local-flow', async () => {
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_BASE', '')
    vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8080')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: '0', data: [] }) } as Response)
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { workflowBindingApi } = await import('@/api')
    expect(workflowBindingApi.available()).toBe(true)
    await workflowBindingApi.list('430024431')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/local-flow/v1/workflow/sourceBindings')
  })
})
