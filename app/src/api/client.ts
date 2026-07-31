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

export async function request<T>(
  endpoint: string,
  params?: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<T> {
  try {
    // 按端点上线判断优先看 httpEndpoint（真实路径）：data 域调用惯例是 request(逻辑键, ..., {httpEndpoint: 真实路径})，
    // 逻辑键（如 data/rowQueryPaged）从不出现在 endpoints.ts，只看 endpoint 会导致 live 标记对整个 data 域永远失效。
    const liveCheckKey = options.httpEndpoint ?? endpoint
    if (options.mode === 'mock' || (MODE === 'mock' && (DISABLE_LIVE_ENDPOINTS || !LIVE_ENDPOINTS.has(liveCheckKey)))) {
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
    const headers: Record<string, string> = {}
    const token = readStoredToken()
    if (token) headers[ACCESS_TOKEN_HEADER] = token
    const url = paramsIn === 'query' ? appendQuery(BASE_URL + httpEndpoint, httpParams) : BASE_URL + httpEndpoint
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
    return normalizeHttpPayload(httpEndpoint, await res.json()) as T
  } catch (e) {
    throw new ApiError(endpoint, e)
  }
}
