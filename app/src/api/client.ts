import { mockRegistry } from './mock'
import { ENDPOINT_PATHS, DANGER_ENDPOINTS } from './endpoints'

// 数据适配层：默认 mock；进入第二阶段真接入时设 VITE_API_MODE=http 即切到真实后端，界面零改动。
type AdapterMode = 'mock' | 'http'

const MODE: AdapterMode = (import.meta.env.VITE_API_MODE as AdapterMode) || 'mock'
const BASE_URL: string = import.meta.env.VITE_API_BASE || 'http://115.227.21.133:9999/api/v1/'
const FAIL_RATE = Number(import.meta.env.VITE_API_FAIL_RATE) || 0

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

export async function request<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
  try {
    if (MODE === 'mock') {
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
    const res = await fetch(BASE_URL + endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params ?? {}),
    })
    if (!res.ok) throw new Error(`请求失败 ${res.status}`)
    return (await res.json()) as T
  } catch (e) {
    throw new ApiError(endpoint, e)
  }
}
