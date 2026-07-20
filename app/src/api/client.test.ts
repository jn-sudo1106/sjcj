// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_TOKEN_HEADER, writeStoredToken } from './auth'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, redirected: false, url: '', json: async () => body } as Response
}

// S1（计划 §12.2）：会话失效 302 → /apiapi/logout.htm，与认证客户端共用同一检测逻辑
function redirectedToLogout() {
  return {
    ok: false,
    status: 500,
    redirected: true,
    url: 'http://115.227.21.133:9999/apiapi/logout.htm',
    json: async (): Promise<unknown> => {
      throw new Error('no body')
    },
  } as Response
}

describe('业务 API 真实请求鉴权', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
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

  it('默认走同源 /api/v1/，携带 Cookie 与 Access-Token', async () => {
    writeStoredToken('tok-business')
    fetchMock.mockResolvedValue(jsonResponse({ total: 0, list: [] }))
    const { request } = await import('./client')

    await request('source/sourcePaged', { page: 1 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/source/sourcePaged')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)[ACCESS_TOKEN_HEADER]).toBe('tok-business')
  })

  it('可为未迁移业务域强制走 Mock，不影响全局真实接口模式', async () => {
    const { request } = await import('./client')

    const result = await request<{ total: number; list: unknown[] }>(
      'site/sitePaged',
      { page: 1, size: 10 },
      { mode: 'mock' },
    )

    expect(result.total).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('兼容旧平台 GET 查询参数与业务响应包裹', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: { paramId: '1035' } }))
    const { request } = await import('./client')

    const result = await request<{ paramId: string }>(
      'config/paramDetail',
      { paramId: '1035', empty: undefined },
      { method: 'GET' },
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/config/paramDetail?paramId=1035')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(result).toEqual({ paramId: '1035' })
  })

  it('把真实后端分页响应（count 字段）转换为新平台分页结构', async () => {
    // 实测修正（2026-07-17 T3）：真实后端返回 count，不是脚手架注释写的 totalCount
    // （旧 s-table 组件 components/table/index.js:160 读的也是 r.count）
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: null, count: 2, data: [{ paramId: '1' }], exts: null }))
    const { request } = await import('./client')

    const result = await request<{ total: number; list: { paramId: string }[] }>(
      'config/paramPaged',
      { page: 2, limit: 10 },
      { method: 'GET' },
    )

    expect(result).toEqual({ total: 2, list: [{ paramId: '1' }] })
  })

  it('totalCount 字段兜底：若某分页端点确实返回 totalCount 仍可正确转换', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', data: [{ paramId: '1' }], totalCount: 17 }))
    const { request } = await import('./client')

    const result = await request<{ total: number; list: { paramId: string }[] }>(
      'config/paramPaged',
      { page: 2, limit: 10 },
      { method: 'GET' },
    )

    expect(result).toEqual({ total: 17, list: [{ paramId: '1' }] })
  })

  it('旧平台业务错误沿用后端消息', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: '-1', msg: '参数不存在', data: null }))
    const { request } = await import('./client')

    await expect(request('config/paramDetail', { paramId: 'missing' }, { method: 'GET' })).rejects.toThrow(
      '参数不存在',
    )
  })

  it('S1：业务接口 302 落地 logout.htm 触发与认证客户端相同的会话失效处理器', async () => {
    fetchMock.mockResolvedValue(redirectedToLogout())
    const { setUnauthorizedHandler } = await import('./auth')
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    const { request } = await import('./client')

    await expect(request('source/sourcePaged', { page: 1 })).rejects.toThrow('登录失效,请重新登录')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })
})

// 按端点逐个上线机制（2026-07-20）：全局默认 mock，endpoints.ts 标 live:true 的端点自动逃逸走真实，
// 其余端点（尚未联调验证的功能）继续走 mock——避免像 VITE_API_MODE=http 那样一刀切影响未接入的页面。
describe('按端点上线：全局仍 mock 时，live 端点照样走真实 HTTP', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'mock')
    vi.stubEnv('VITE_API_BASE', '')
    // vitest.config.ts 默认关掉这套机制（避免撞上其它未打 fetch mock 的既有测试），这里专门测它本身要重新打开
    vi.stubEnv('VITE_API_DISABLE_LIVE_ENDPOINTS', '')
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('已标 live 的参数端点（config/paramPaged）绕过全局 mock，真的发 fetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 0, msg: null, count: 0, data: [], exts: null }))
    const { request } = await import('./client')

    await request('config/paramPaged', { page: 1, limit: 10 }, { method: 'GET' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/config/paramPaged')
  })

  it('未标 live 的端点（source/sourcePaged）在全局 mock 下继续走 mock，不发 fetch', async () => {
    const { request } = await import('./client')

    await request('source/sourcePaged', { page: 1 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('options.mode==="mock" 的强制 mock 优先级高于 live 标记（未迁移业务域即便误标也不会被打真实）', async () => {
    const { request } = await import('./client')

    await request('config/paramPaged', { page: 1 }, { mode: 'mock' })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
