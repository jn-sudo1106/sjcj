// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ACCESS_TOKEN_KEY, LOGIN_USERNAME_KEY } from '../api/auth'
import { useAuthStore } from './auth'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const okEnvelope = (data: unknown) => jsonResponse({ success: true, code: '0', msg: '操作成功', data })

const userInfo = (roles: string[]) => ({
  roles,
  name: 'htqh',
  groups: [],
  avatar: 'a.gif',
  id: 402,
  introduction: 'hello',
  group: 402,
})

describe('auth store（迁移旧 Vuex user 模块）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setActivePinia(createPinia())
  })

  afterEach(() => vi.unstubAllGlobals())

  it('login：写 Token（{value,expire}）+ sessionStorage.loginUsername', async () => {
    fetchMock.mockResolvedValue(okEnvelope({ token: 'tok-login' }))
    const auth = useAuthStore()
    await auth.login({ username: 'htqh', password: 'hashed', code: '12' })
    expect(auth.token).toBe('tok-login')
    expect(JSON.parse(localStorage.getItem(ACCESS_TOKEN_KEY)!).value).toBe('tok-login')
    expect(sessionStorage.getItem(LOGIN_USERNAME_KEY)).toBe('htqh')
  })

  it('login 用 email 字段时 loginUsername 取 email（旧 username || email 逻辑）', async () => {
    fetchMock.mockResolvedValue(okEnvelope({ token: 't' }))
    const auth = useAuthStore()
    await auth.login({ email: 'a@b.com', password: 'p', code: '1' })
    expect(sessionStorage.getItem(LOGIN_USERNAME_KEY)).toBe('a@b.com')
  })

  it('fetchInfo：roles 为空视为异常会话（旧 GetInfo reject）', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo([])))
    const auth = useAuthStore()
    await expect(auth.fetchInfo()).rejects.toThrow('roles must be a non-null array')
  })

  it('角色标准化：含 admin（重复项容忍）→ admin，其余 → read', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo(['admin', 'admin'])))
    const auth = useAuthStore()
    await auth.fetchInfo()
    expect(auth.role).toBe('admin')
    expect(auth.name).toBe('htqh')

    fetchMock.mockResolvedValue(okEnvelope(userInfo(['operator'])))
    setActivePinia(createPinia())
    const auth2 = useAuthStore()
    await auth2.fetchInfo()
    expect(auth2.role).toBe('read')
  })

  // 2026-11-06 需求：root（超级管理员）什么都不校验。
  // 老系统里 root 账号的 roles 有时只有普通角色，所以登录名兜底也要算超级管理员。
  it('root 超级管理员：roles 含 root / 登录名是 root 都按 admin 暴露', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo(['root'])))
    const auth = useAuthStore()
    await auth.fetchInfo()
    expect(auth.isSuperAdmin).toBe(true)
    expect(auth.role).toBe('admin')

    // roles 只给了 read，但登录名是 root
    setActivePinia(createPinia())
    fetchMock
      .mockResolvedValueOnce(okEnvelope({ token: 'tok-root' }))
      .mockResolvedValueOnce(okEnvelope(userInfo(['read'])))
    const auth2 = useAuthStore()
    await auth2.login({ username: 'root', password: 'p', code: '1' })
    expect(auth2.isSuperAdmin).toBe(true)
    await auth2.fetchInfo()
    expect(auth2.role).toBe('admin')
  })

  it('非 root 普通用户不算超级管理员（roles 为空时 role 仍是空）', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo(['read'])))
    const auth = useAuthStore()
    await auth.fetchInfo()
    expect(auth.isSuperAdmin).toBe(false)
    expect(auth.role).toBe('read')

    setActivePinia(createPinia())
    expect(useAuthStore().role).toBe('')
  })

  it('logout：接口 500 也必须清空会话（logout.htm 无会话实测 500）', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok', expire: Date.now() + 1000_000 }))
    sessionStorage.setItem(LOGIN_USERNAME_KEY, 'htqh')
    setActivePinia(createPinia())
    const auth = useAuthStore()
    expect(auth.isLoggedIn).toBe(true)
    fetchMock.mockResolvedValue(jsonResponse(null, 500))
    await auth.logout()
    expect(auth.token).toBe('')
    expect(auth.roles).toEqual([])
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
    expect(sessionStorage.getItem(LOGIN_USERNAME_KEY)).toBeNull()
  })

  // 1106 首次点击卡顿优化：会话恢复由「getInfo → 串行 user-nav」改成一次并发，
  // 且并发调用（登录预热 + 导航守卫）走单飞，不会重复打接口。
  it('fetchInfo：用户信息与菜单并发恢复，菜单落库（不再串行等两个 RTT）', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo(['admin'])))
    const auth = useAuthStore()
    await auth.fetchInfo()
    // getInfo 走真实 fetch；菜单接口在测试里走 mock 适配器，不发 fetch
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/user-info.htm')
    expect(auth.isMenusLoaded).toBe(true)
    expect(auth.menusLoadFailed).toBe(false)
    // mock 适配器下发的菜单：权限码/菜单组都要落到 store（曾经的 bug 是失败也置 loaded 但留空）
    expect(auth.menuGroups.length).toBeGreaterThan(0)
    expect(auth.permissions).toContain('settings')
  })

  it('fetchInfo / prefetchSession 单飞：并发调用只请求一次 user-info', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo(['admin'])))
    const auth = useAuthStore()
    await Promise.all([auth.fetchInfo(), auth.prefetchSession(), auth.fetchInfo()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth.roles).toEqual(['admin'])
  })

  it('prefetchSession：未登录状态下的失败不抛出（登录跳转不能被预热挡住）', async () => {
    fetchMock.mockRejectedValue(new Error('网络错误'))
    const auth = useAuthStore()
    await expect(auth.prefetchSession()).resolves.toBeUndefined()
  })

  // KeepAlive 的 :key 用 cacheKey：以前用 auth.info?.id，首次拿到用户信息就变 key，页面被重建
  it('cacheKey：登录生成新分区、刷新后稳定、clear 复位', async () => {
    fetchMock.mockResolvedValue(okEnvelope({ token: 'tok-login' }))
    const auth = useAuthStore()
    expect(auth.cacheKey).toBe('anonymous')

    await auth.login({ username: 'u', password: 'p', code: '1' })
    const loggedIn = auth.cacheKey
    expect(loggedIn).not.toBe('anonymous')
    // 同一会话内反复读稳定 —— 用户信息晚到也不会让 AppShell 重建页面
    expect(auth.cacheKey).toBe(loggedIn)

    auth.clear()
    expect(auth.cacheKey).toBe('anonymous')

    // 刷新页面：token 从本地恢复、sessionKey 为空 → 稳定的分区值
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok', expire: Date.now() + 1000_000 }))
    setActivePinia(createPinia())
    expect(useAuthStore().cacheKey).toBe('session')
  })

  // 1106：`/user-info.htm` 实测要 ~10s，刷新后不能干等 —— 上次会话存快照，刷新先按快照渲染。
  it('会话快照：刷新后角色/菜单立即可用，守卫不必再等接口；clear 时删除', async () => {
    fetchMock.mockResolvedValue(okEnvelope(userInfo(['admin'])))
    // 已登录（有 token）才会写快照：没会话的匿名调用不该缓存
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok', expire: Date.now() + 1000_000 }))
    setActivePinia(createPinia())
    const auth = useAuthStore()
    expect(auth.isMenusLoaded).toBe(false)
    await auth.fetchInfo()
    expect(sessionStorage.getItem('front-ce:auth-snapshot')).toBeTruthy()

    // 模拟刷新：新的 pinia / 新 store（内存态清空，只剩 sessionStorage 快照）
    setActivePinia(createPinia())
    const reloaded = useAuthStore()
    expect(reloaded.roles).toEqual(['admin'])
    expect(reloaded.isMenusLoaded).toBe(true)
    expect(reloaded.permissions).toContain('settings')
    expect(reloaded.menuGroups.length).toBeGreaterThan(0)

    // 登出/清会话必须连带清快照，否则换账号会看到上一个人的菜单
    reloaded.clear()
    expect(sessionStorage.getItem('front-ce:auth-snapshot')).toBeNull()
  })

  it('过期快照不采用（避免用旧权限渲染）', () => {
    sessionStorage.setItem(
      'front-ce:auth-snapshot',
      JSON.stringify({ at: Date.now() - 13 * 60 * 60 * 1000, roles: ['admin'], name: 'old', avatar: '', info: null, permissions: [], menuGroups: [] }),
    )
    const auth = useAuthStore()
    expect(auth.roles).toEqual([])
    expect(auth.isMenusLoaded).toBe(false)
  })
})
