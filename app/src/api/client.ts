import { mockRegistry } from './mock'
import { ENDPOINT_PATHS, DANGER_ENDPOINTS, LIVE_ENDPOINTS } from './endpoints'
import { ACCESS_TOKEN_HEADER, isSessionExpiredRedirect, readStoredToken, triggerSessionExpired } from './auth'

// 数据适配层：默认 mock。两种切真实后端的方式：
// ①按端点：endpoints.ts 把某端点标 live:true 后自动切真实，其余仍走 mock —— 功能一个个上线用这个。
// ②全局：VITE_API_MODE=http 强制全部端点走真实（仍受 options.mode==='mock' 的按调用强制项优先），
//   仅用于本地联调验证一整批接口，不用于生产（生产靠①逐项上线，见 endpoints.ts 的 live 标记）。
type AdapterMode = 'mock' | 'http'
type HttpMethod = 'GET' | 'POST'

export interface RequestOptions {
  mode?: AdapterMode
  method?: HttpMethod
  paramsIn?: 'query' | 'body'
  timeoutMs?: number
  httpParams?: Record<string, unknown>
  httpEndpoint?: string
}

const MODE: AdapterMode = (import.meta.env.VITE_API_MODE as AdapterMode) || 'mock'
export const BASE_URL: string = import.meta.env.VITE_API_BASE || '/api/v1/'
const FAIL_RATE = Number(import.meta.env.VITE_API_FAIL_RATE) || 0
// 测试环境固定关闭（vitest.config.ts 的 test.env），避免既有测试意外撞上真实发起的 fetch
const DISABLE_LIVE_ENDPOINTS = import.meta.env.VITE_API_DISABLE_LIVE_ENDPOINTS === '1'

/** 当前构建是否以 Mock 为默认数据源；用于真实端点失败时仅在演示模式做本地回退。 */
export function isMockMode(): boolean {
  return MODE === 'mock'
}

export class ApiError extends Error {
  endpoint: string

  constructor(endpoint: string, cause?: unknown) {
    super(`请求异常 [${endpoint}]: ${(cause as Error)?.message ?? String(cause)}`)
    this.endpoint = endpoint
    this.name = 'ApiError'
  }
}

// 危险端点集合从契约清单 endpoints.ts 派生（单一事实源）；UI 统一灰显或二次确认。
export { DANGER_ENDPOINTS }
export function isDanger(endpoint: string): boolean {
  return DANGER_ENDPOINTS.has(endpoint)
}

// 生产写守卫（0812 计划 M0-4）：本地/联调会话可能把 VITE_API_PROXY_TARGET 指向生产环境
// （118.25.96.217）做只读核实；此时除"网站与源关系"外的所有 danger 端点必须被拦截，
// 不能只靠开发者自觉——这是唯一允许在生产写入的范围，其余源本身的增删改、发抓取、
// 发后续任务、任务重跑等一律禁止（方案 §0.1 环境矩阵）。
// 判定读当前实际连接的后端主机：VITE_API_PROXY_TARGET 是 shell 环境变量，Vite 按
// VITE_ 前缀规则会同时把它注入 import.meta.env，与 vite.config.ts 的 dev proxy target 一致
// （两者读的是同一个变量，不会出现"代理连了生产但客户端判断成测试"的不一致）。
const PRODUCTION_BACKEND_HOSTS = ['118.25.96.217']

function currentBackendTarget(): string {
  const env = import.meta.env as Record<string, string | undefined>
  return env.VITE_API_PROXY_TARGET || env.VITE_AUTH_PROXY_TARGET || ''
}

export function isProductionBackend(): boolean {
  const target = currentBackendTarget()
  return PRODUCTION_BACKEND_HOSTS.some((host) => target.includes(host))
}

// 生产环境下唯一放行的写入范围：网站关系（site/* 全部）与源—网站关系（changeSite/bindSite）。
// 按"真实请求目的地"（httpEndpoint，未显式指定时回退到逻辑 endpoint）判断，与 usesMockAdapter
// 的 liveCheckKey 口径一致，避免逻辑键与真实路径不同名时误放行或误拦截。
function isProductionWriteAllowed(httpEndpoint: string): boolean {
  return httpEndpoint.startsWith('site/') || httpEndpoint === 'source/bindSite' || httpEndpoint === 'source/changeSite'
}

export class ProductionWriteBlockedError extends Error {
  httpEndpoint: string

  constructor(httpEndpoint: string) {
    super(`生产环境写保护：端点 [${httpEndpoint}] 不在允许清单（仅网站/源关系写操作可用），已阻止发送，未联网`)
    this.httpEndpoint = httpEndpoint
    this.name = 'ProductionWriteBlockedError'
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function appendQuery(url: string, params?: Record<string, unknown>): string {
  if (!params) return url
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      query.set(key, value.join(','))
      return
    }
    query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
  })
  const text = query.toString()
  return text ? `${url}?${text}` : url
}

function normalizeHttpPayload(endpoint: string, payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const envelope = payload as Record<string, unknown>
  if (!('code' in envelope)) return payload

  const code = String(envelope.code ?? '')
  if (code && code !== '0') {
    throw new Error(String(envelope.msg || `业务请求失败 [${endpoint}]`))
  }

  const data = envelope.data
  // 实测修正（2026-07-17 T3 真实联调）：旧平台文档/脚手架注释写的是 totalCount，
  // 但实际 s-table 组件读的是 r.count（components/table/index.js:160），真实后端分页响应也是 count，
  // 不是 totalCount；totalCount 保留作兜底，避免其他未逐一验证的分页端点确实用了这个名字。
  if (Array.isArray(data) && ('count' in envelope || 'totalCount' in envelope || 'total' in envelope)) {
    return {
      list: data,
      total: Number(envelope.count ?? envelope.totalCount ?? envelope.total ?? data.length),
    }
  }
  if (data !== undefined && data !== null) return data
  return { ok: true, message: String(envelope.msg || '操作成功') }
}

// 未实现专属 mock 的契约端点 → 通用占位，保证 142 端点全部可调用、切 http 零改动。
function fallback(endpoint: string): unknown {
  if (/paged/i.test(endpoint)) return { total: 0, list: [] }
  if (
    DANGER_ENDPOINTS.has(endpoint) ||
    /add|update|delete|save|copy|enable|clear|run|gen|modify|rebuild|send|reset|purge|create|process|reply|recommend|chat/i.test(endpoint)
  ) {
    return { ok: true, demo: true, message: '演示环境：契约占位端点，mock 未实现具体数据' }
  }
  return null
}

/** 是否走 mock（与 request 内判定一致，供流式等非 JSON 客户端复用） */
export function usesMockAdapter(endpoint: string, options: RequestOptions = {}): boolean {
  // live 判定键：
  // - data 域：httpEndpoint 为相对真实路径（如 entry/entryDataPaged），优先用它（逻辑键不在清单里）
  // - vrule：httpEndpoint 为根相对绝对路径（/vrule/...），不在清单里，改用逻辑键（rule/orchestration*）
  const httpKey = options.httpEndpoint
  const liveCheckKey = httpKey && !httpKey.startsWith('/') ? httpKey : endpoint
  return options.mode === 'mock' || (MODE === 'mock' && (DISABLE_LIVE_ENDPOINTS || !LIVE_ENDPOINTS.has(liveCheckKey)))
}

export async function request<T>(
  endpoint: string,
  params?: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<T> {
  try {
    if (usesMockAdapter(endpoint, options)) {
      await delay(120)
      if (FAIL_RATE > 0 && Math.random() < FAIL_RATE) {
        throw new Error(`mock 随机失败注入: ${endpoint}`)
      }
      if (new URLSearchParams(location.search).get('fail') === endpoint) {
        throw new Error(`mock URL 参数失败注入: ${endpoint}`)
      }
      const handler = mockRegistry[endpoint]
      if (handler) return handler(params) as T
      if (ENDPOINT_PATHS.has(endpoint)) return fallback(endpoint) as T
      throw new Error(`[mock] 端点不在契约清单: ${endpoint}`)
    }
    const method = options.method ?? 'POST'
    const paramsIn = options.paramsIn ?? (method === 'GET' ? 'query' : 'body')
    const httpParams = options.httpParams ?? params
    const httpEndpoint = options.httpEndpoint ?? endpoint
    if (isDanger(endpoint) && isProductionBackend() && !isProductionWriteAllowed(httpEndpoint)) {
      throw new ProductionWriteBlockedError(httpEndpoint)
    }
    const headers: Record<string, string> = {}
    const token = readStoredToken()
    if (token) headers[ACCESS_TOKEN_HEADER] = token
    // 以 `/` 开头的 httpEndpoint 视为站点根相对路径（如 /vrule/...），不再拼 BASE_URL（/api/v1/）。
    // 规则编排 Sprint 4 直连旧 vrule 网关时用这个口径；采集中心同域端点仍走相对 path。
    const resolvedPath = httpEndpoint.startsWith('/') ? httpEndpoint : BASE_URL + httpEndpoint
    const url = paramsIn === 'query' ? appendQuery(resolvedPath, httpParams) : resolvedPath
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
    if (paramsIn === 'body') headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(url, {
        method,
        credentials: 'include',
        headers,
        body: paramsIn === 'body' ? JSON.stringify(httpParams ?? {}) : undefined,
        signal: controller.signal,
      })
    } finally {
      window.clearTimeout(timeout)
    }
    // S1（计划 §12.2）：会话失效以 302→logout.htm 落地，与 auth.ts authRequest 共用同一检测与处理器
    if (isSessionExpiredRedirect(res)) {
      triggerSessionExpired()
      throw new Error('登录失效,请重新登录')
    }
    if (!res.ok) {
      // 尝试解出后端业务 message（4xx/5xx 通常仍带 code/msg envelope）
      let detail = ''
      try {
        const body = await res.clone().json() as Record<string, unknown>
        if (body && typeof body === 'object' && body.msg) detail = `: ${String(body.msg)}`
      } catch { /* 无 body 或非 JSON */ }
      throw new Error(`请求失败 ${res.status}${detail}`)
    }
    // 2xx 但响应体为空是部分真实后端网关的合法成功态（实测撞见 vrule AI 编辑网关），
    // 不能直接 res.json() 空字符串——那会抛 "Unexpected end of JSON input"。
    // 只在正文真为空时按 null 处理（走各 xxxFromLegacy 适配器的空输入兜底分支）；
    // 非空但解析失败仍然是真实错误，照样往外抛，不吞掉。
    const bodyText = await res.text()
    const body = bodyText.trim() ? JSON.parse(bodyText) : null
    return normalizeHttpPayload(httpEndpoint, body) as T
  } catch (e) {
    throw new ApiError(endpoint, e)
  }
}
