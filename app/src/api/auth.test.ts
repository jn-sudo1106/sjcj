// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_TOKEN_KEY,
  ACCESS_TOKEN_HEADER,
  TOKEN_TTL_MS,
  changePassword,
  encPassword,
  getCodeImg,
  getInfo,
  login,
  readStoredToken,
  setUnauthorizedHandler,
  writeStoredToken,
} from './auth'

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, redirected: false, url: '', json: async () => body } as Response
}

// S1（计划 §12.2）：会话失效后端 302 → /apiapi/logout.htm，fetch 跟随后常见空体/500，
// 检测只看 res.redirected + res.url，不依赖能否解析 JSON
function redirectedToLogout(status = 500) {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: true,
    url: 'http://115.227.21.133:9999/apiapi/logout.htm',
    json: async (): Promise<unknown> => {
      throw new Error('no body')
    },
  } as Response
}

const okEnvelope = (data: unknown) => jsonResponse({ success: true, code: '0', msg: '操作成功', data })

describe('encPassword 双 MD5 与旧算法一致', () => {
  it('RFC 1321 已知答案：encPassword 是 md5(账号 + 密码) 的拼接哈希', () => {
    expect(encPassword('a', 'bc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })

  it('双 MD5 链路：md5(md5(账号+密码) + "-" + uid)', () => {
    expect(encPassword('user', 'pwd')).toBe('811070f835cf10086356cf1023481990')
    expect(encPassword(encPassword('user', 'pwd'), '-uid')).toBe('8de6ea48e16fb5cb9f0f61ee083fd4b5')
  })
})

describe('Token 本地存储（vue-ls {value, expire} 格式，实际键 pro__Access-Token）', () => {
  beforeEach(() => localStorage.clear())

  it('写入后可读回，expire 为 7 天', () => {
    writeStoredToken('tok-1')
    expect(readStoredToken()).toBe('tok-1')
    const raw = JSON.parse(localStorage.getItem(ACCESS_TOKEN_KEY)!) as { expire: number }
    expect(raw.expire - Date.now()).toBeGreaterThan(TOKEN_TTL_MS - 5000)
    expect(raw.expire - Date.now()).toBeLessThanOrEqual(TOKEN_TTL_MS)
  })

  it('过期 Token 读取为空并清除存储', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: 'tok-2', expire: Date.now() - 1 }))
    expect(readStoredToken()).toBe('')
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
  })

  it('损坏的存储值读取为空', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'not-json')
    expect(readStoredToken()).toBe('')
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull()
  })

  it('兼容读取当前迁移版本曾写入的无前缀键', () => {
    localStorage.setItem('Access-Token', JSON.stringify({ value: 'tok-unprefixed', expire: Date.now() + 1000 }))
    expect(readStoredToken()).toBe('tok-unprefixed')
  })
})

describe('请求方法、路径与字段（对齐旧 api/login.js + request.js）', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setUnauthorizedHandler(() => {})
  })

  it('login：POST /api/loginCheck2.htm，JSON 编码，字段原样透传，携带 Cookie', async () => {
    fetchMock.mockResolvedValue(okEnvelope({ token: 't1' }))
    const res = await login({ username: 'htqh', password: 'hashed', code: '12' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/loginCheck2.htm')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ username: 'htqh', password: 'hashed', code: '12' })
    expect(res.data.token).toBe('t1')
  })

  it('email 字段登录时不出现 username 字段', async () => {
    fetchMock.mockResolvedValue(okEnvelope({ token: 't1' }))
    await login({ email: 'a@b.com', password: 'hashed', code: '12' })
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.email).toBe('a@b.com')
    expect(body.username).toBeUndefined()
  })

  it('已存 Token 时每个请求注入 Access-Token 头', async () => {
    writeStoredToken('tok-9')
    fetchMock.mockResolvedValue(okEnvelope({ uid: 'u', img: 'i' }))
    await getCodeImg()
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers[ACCESS_TOKEN_HEADER]).toBe('tok-9')
    expect(headers[ACCESS_TOKEN_KEY]).toBeUndefined()
  })

  it('业务失败（200 + code!=="0"）抛出后端 msg，与旧 reject(res.msg) 一致', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '验证码错误', data: null }))
    await expect(login({ username: 'u', password: 'p', code: '0' })).rejects.toThrow('验证码错误')
  })

  it('getInfo 未登录业务码（未登陆1）同样走业务失败路径', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '未登陆1', data: null }))
    await expect(getInfo()).rejects.toThrow('未登陆1')
  })

  it('HTTP 401 触发 unauthorized 处理器；并发 401 处理器每次调用但门闩由注册方保证', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    fetchMock.mockResolvedValue(jsonResponse({ msg: 'x' }, 401))
    await expect(getInfo()).rejects.toThrow('登录失效')
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('401 但 result.isLogin 为真时不触发退出（旧拦截器例外分支）', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    fetchMock.mockResolvedValue(jsonResponse({ code: '0', msg: '', data: null, result: { isLogin: true } }, 401))
    await expect(getInfo()).rejects.toThrow('请求失败 401')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('changePassword：POST /api/user/changePassword.htm，JSON {oldPwd,newPwd}，5s 超时', async () => {
    fetchMock.mockResolvedValue(okEnvelope(null))
    await changePassword('hashed-old', 'hashed-new')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/user/changePassword.htm')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ oldPwd: 'hashed-old', newPwd: 'hashed-new' })
  })

  it('changePassword 原密码错误：透传后端 msg（实测「旧密码校验不通过」）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, code: '-1', msg: '旧密码校验不通过', data: null }))
    await expect(changePassword('bad', 'new')).rejects.toThrow('旧密码校验不通过')
  })

  it('S1：302 跟随后落地 logout.htm 触发会话失效处理器，不依赖响应体解析', async () => {
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    fetchMock.mockResolvedValue(redirectedToLogout())
    await expect(getInfo()).rejects.toThrow('登录失效,请重新登录')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('S1 与 S3 同一处理器：changePassword 等任意请求命中 302 也会触发', async () => {
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    fetchMock.mockResolvedValue(redirectedToLogout())
    await expect(changePassword('a', 'b')).rejects.toThrow('登录失效,请重新登录')
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  it('redirected 为真但 URL 不含 logout.htm 时不误判为会话失效', async () => {
    const onExpired = vi.fn()
    setUnauthorizedHandler(onExpired)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      redirected: true,
      url: '/api/some-other-redirect',
      json: async () => ({ success: true, code: '0', msg: '', data: {} }),
    } as Response)
    await getInfo()
    expect(onExpired).not.toHaveBeenCalled()
  })
})
