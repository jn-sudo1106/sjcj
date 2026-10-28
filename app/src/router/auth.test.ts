// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { router, authGuard, isChunkLoadError } from './index'
import { useAuthStore } from '../stores/auth'
import { ACCESS_TOKEN_KEY, triggerSessionExpired } from '../api/auth'
import { ElMessageBox } from 'element-plus'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const to = (path: string, fullPath = path, meta: Record<string, unknown> = {}) => ({ meta, path, fullPath })

describe('authGuard（迁移旧 permission.js）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setActivePinia(createPinia())
  })

  afterEach(() => vi.unstubAllGlobals())

  function loginAs(roles: string[] = []) {
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok', expire: Date.now() + 1000_000 }))
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.roles = roles
    return auth
  }

  it('未登录访问业务路由 → /user/login?redirect=<原地址>', async () => {
    expect(await authGuard(to('/overview'))).toEqual({ path: '/user/login', query: { redirect: '/overview' } })
  })

  it('未登录深链接的查询参数完整保留', async () => {
    const result = await authGuard(to('/data', '/data?entryTypeId=8&page=2'))
    expect(result).toEqual({ path: '/user/login', query: { redirect: '/data?entryTypeId=8&page=2' } })
  })

  it('未登录访问公开登录页放行', async () => {
    expect(await authGuard(to('/user/login', '/user/login', { public: true }))).toBe(true)
  })
  it('已有嵌套登录地址自动修正为一层业务跳转', async () => {
    expect(await authGuard(to('/user/login', '/user/login?redirect=/user/login?redirect=/settings?tab=model-interfaces', { public: true })))
      .toEqual({ path: '/user/login', query: { redirect: '/settings?tab=model-interfaces' } })
  })
  it('登录页收到迟到的 401 不再弹窗或重复包装 redirect', async () => {
    await router.push('/user/login?redirect=/settings?tab=model-interfaces')
    const original = router.currentRoute.value.fullPath
    const auth = loginAs(['admin'])
    const alert = vi.spyOn(ElMessageBox, 'alert').mockImplementation(() => new Promise<never>(() => {}))
    triggerSessionExpired()
    await Promise.resolve()
    expect(alert).not.toHaveBeenCalled()
    expect(router.currentRoute.value.fullPath).toBe(original)
    expect(auth.token).toBe('tok')
    alert.mockRestore()
  })

  it('已登录访问 /user/login → /overview', async () => {
    loginAs(['admin'])
    expect(await authGuard(to('/user/login', '/user/login', { public: true }))).toBe('/overview')
  })

  it('有 Token 且角色已加载：直接放行且不请求用户信息', async () => {
    loginAs(['admin'])
    expect(await authGuard(to('/overview'))).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('有 Token 无角色：先恢复用户信息再放行（公开登录页不触发该请求）', async () => {
    loginAs()
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, code: '0', msg: '', data: { roles: ['admin'], name: 'htqh', groups: [], avatar: '', id: 1, introduction: '', group: 1 } }),
    )
    expect(await authGuard(to('/overview'))).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/user-info.htm')
  })

  it('本地键 7 天过期后路由跳转即踢回登录页（对齐旧 permission.js 每次导航重读）', async () => {
    const auth = loginAs(['admin'])
    // 模拟跨过 7 天线：内存里还有 token，但本地存储已过期
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok', expire: Date.now() - 1 }))
    expect(await authGuard(to('/overview'))).toEqual({ path: '/user/login', query: { redirect: '/overview' } })
    expect(auth.token).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
  })

  it('无效 Token（GetInfo 业务码失败）→ 清理会话并回登录页', async () => {
    const auth = loginAs()
    // 第一次 user-info 返回「未登陆1」，随后 logout.htm 返回 500 —— 均为实测行为
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: false, code: '-1', msg: '未登陆1', data: null }))
      .mockResolvedValueOnce(jsonResponse(null, 500))
    expect(await authGuard(to('/overview'))).toEqual({ path: '/user/login', query: { redirect: '/overview' } })
    expect(auth.token).toBe('')
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
  })
})

// 0930-08：部署后旧页面文件被删，开着的标签页点新页面会报这类错，需要整页刷新
describe('isChunkLoadError', () => {
  it('认得各浏览器的「按需加载的页面文件取不到」', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/assets/Settings-abc.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
  })
  it('其他错误不算', () => {
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
    expect(isChunkLoadError('登录失效')).toBe(false)
  })
})
