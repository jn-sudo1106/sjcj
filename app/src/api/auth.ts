import md5 from 'md5'

// 系统用户认证客户端：1:1 迁移旧 data-view `src/api/login.js` + `src/utils/request.js` 行为。
// 契约事实与实测偏差见《登录页面迁移_开发计划_2026-07-17.md》§1/§1.5，不做协议增强。
// 注意：鉴权真实载体是 HttpOnly 会话 Cookie（§1.5.9 实测），Access-Token 头按红线保留注入；
// 开发环境必须走 Vite proxy 同源（Cookie SameSite=Lax，跨站 fetch 不会携带）。

const AUTH_BASE: string = import.meta.env.VITE_AUTH_BASE || '/api'

// 旧项目通过 vue-ls 的 `pro__` namespace 落盘，但请求头仍使用不带前缀的 Access-Token。
export const ACCESS_TOKEN_KEY = 'pro__Access-Token'
export const ACCESS_TOKEN_HEADER = 'Access-Token'
const UNPREFIXED_ACCESS_TOKEN_KEY = 'Access-Token'
export const LOGIN_USERNAME_KEY = 'loginUsername'
// 旧 Vue.ls.set(ACCESS_TOKEN, token, 7 天)：7 天只是本地键的过期时间，不代表服务端会话时长
export const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 当前登录用户名（sessionStorage）；vrule userCode 优先用它，缺省回退 admin */
export function readLoginUsername(): string {
  try {
    return (sessionStorage.getItem(LOGIN_USERNAME_KEY) || '').trim()
  } catch {
    return ''
  }
}

// 旧包裹层：业务失败是 HTTP 200 + code !== '0'，拦截器 reject(res.msg)（纯字符串）。
// 这里用 AuthError 承载同一个 msg：调用方取 e.message 即旧代码里的 err。
export class AuthError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

export interface AuthEnvelope<T> {
  success: boolean
  code: string
  msg: string
  data: T
}

export interface LoginParams {
  username?: string
  email?: string
  password: string
  code: string
}

// user-info.htm 真实形态（§1.5.9 实测）：roles 是可能含重复项的字符串数组
export interface UserInfo {
  roles: string[]
  name: string
  groups: unknown[]
  avatar: string
  id: number
  introduction: string
  group: number
}

// 旧 utils/request.js 的 401 处理由全局拦截器完成；fetch 没有拦截器，由使用方注册同语义的处理器。
// 2026-07-17 §12 扩展：会话失效改为主动弹窗要求重新登录（有意偏离旧系统的静默报错行为，
// 见开发计划 §12.1），认证客户端与业务客户端（api/client.ts）共用同一个处理器。
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn
}
export function triggerSessionExpired() {
  unauthorizedHandler?.()
}

// S1：线上旧网关会跳到 logout.htm，本地 bee-config 的 Shiro 跳到 loginProxy.htm。
// fetch 默认跟随重定向，用最终地址识别会话失效，避免把登录页面的 500 当作业务接口错误。
export function isSessionExpiredRedirect(res: Response): boolean {
  return res.redirected && (res.url.includes('logout.htm') || res.url.includes('loginProxy.htm'))
}

// vue-ls 值格式 {value, expire}；优先读取旧项目实际落盘键，并兼容本次迁移早期使用过的无前缀键
export function readStoredToken(): string {
  for (const key of [ACCESS_TOKEN_KEY, UNPREFIXED_ACCESS_TOKEN_KEY]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { value?: string; expire?: number }
      if (parsed.expire && Date.now() > parsed.expire) {
        localStorage.removeItem(key)
        continue
      }
      if (parsed.value) return parsed.value
    } catch {
      localStorage.removeItem(key)
    }
  }
  return ''
}

export function writeStoredToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, JSON.stringify({ value: token, expire: Date.now() + TOKEN_TTL_MS }))
  localStorage.removeItem(UNPREFIXED_ACCESS_TOKEN_KEY)
}

export function clearStoredToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(UNPREFIXED_ACCESS_TOKEN_KEY)
}

interface AuthRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  timeout?: number
}

async function authRequest<T>(path: string, options: AuthRequestOptions = {}): Promise<AuthEnvelope<T>> {
  // 默认 20s 对齐旧 axios.create({ timeout: 20000 })
  const { method = 'GET', body, timeout = 20000 } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const headers: Record<string, string> = { 'Content-Type': 'application/json;charset=UTF-8' }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token

  let res: Response
  try {
    res = await fetch(AUTH_BASE + path, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throw new AuthError(
      (e as Error).name === 'AbortError' ? `请求超时 [${path}]` : `网络异常 [${path}]: ${(e as Error).message}`,
    )
  } finally {
    clearTimeout(timer)
  }

  // S1 检测在解析响应体之前：该重定向落地的端点常返回空体或 500，不依赖 JSON 解析成功
  if (isSessionExpiredRedirect(res)) {
    triggerSessionExpired()
    throw new AuthError('登录失效,请重新登录', res.status)
  }

  const payload = (await res.json().catch(() => null)) as
    | (AuthEnvelope<T> & { result?: { isLogin?: boolean } })
    | null

  // 旧拦截器例外条件原样保留：401 且非 result.isLogin 才触发登录失效流程（S3）。
  // 本部署实测不返回 HTTP 401（§1.5.5），此分支按红线保留，真实失效路径是 S1（见上）。
  if (res.status === 401 && !(payload && payload.result && payload.result.isLogin)) {
    triggerSessionExpired()
    throw new AuthError('登录失效,请重新登录', 401)
  }
  if (!res.ok) throw new AuthError(`请求失败 ${res.status}`, res.status)
  if (payload && payload.code && payload.code !== '0') throw new AuthError(payload.msg)
  if (!payload) throw new AuthError(`响应异常 [${path}]`)
  return payload
}

// 双 MD5 第一步与旧 api/login.js 完全一致；第二步在登录页拼 '-' + uid 后再次调用本函数
export function encPassword(user: string, pwd: string): string {
  return md5(user + pwd)
}

export function getCodeImg() {
  return authRequest<{ uid: string; img: string }>('/captchaImage')
}

export function login(parameter: LoginParams) {
  return authRequest<{ token: string }>('/loginCheck2.htm', { method: 'POST', body: parameter, timeout: 50000 })
}

// 修改密码（计划 §11）：入参为已哈希值 md5(nickname + 明文)，nickname = user-info 的 name；
// 单层 MD5、无验证码盐，与登录的双 MD5 不同 —— 哈希在调用方（弹窗组件）完成，与旧 UserMenu.vue 一致
export function changePassword(oldPwd: string, newPwd: string) {
  return authRequest<unknown>('/user/changePassword.htm', {
    method: 'POST',
    body: { oldPwd, newPwd },
    timeout: 5000,
  })
}

export function getInfo() {
  return authRequest<UserInfo>('/user-info.htm', { timeout: 3000 })
}

export function logout() {
  return authRequest<unknown>('/logout.htm', { timeout: 3000 })
}
