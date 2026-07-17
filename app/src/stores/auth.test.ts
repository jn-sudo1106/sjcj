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
})
