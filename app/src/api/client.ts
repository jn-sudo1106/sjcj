import { mockRegistry } from './mock'
import { ENDPOINT_PATHS, DANGER_ENDPOINTS, LIVE_ENDPOINTS } from './endpoints'
import { ACCESS_TOKEN_HEADER, isSessionExpiredRedirect, readStoredToken, triggerSessionExpired } from './auth'

// 数据适配层：默认 mock。两种切真实后端的方式：
// ①按端点：endpoints.ts 把某端点标 live:true 后自动切真实，其余仍走 mock —— 功能一个个上线用这个。
// ②全局：VITE_API_MODE=http 强制全部端点走真实（仍受 options.mode==='mock' 的按调用强制项优先），
//   仅用于本地联调验证一整批接口，不用于生产（生产靠①逐项上线，见 endpoints.ts 的 live 标记）。
type AdapterMode = 'mock' | 'http'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface RequestOptions {
  mode?: AdapterMode
  method?: HttpMethod
  paramsIn?: 'query' | 'body'
  timeoutMs?: number
  httpParams?: Record<string, unknown>
  httpEndpoint?: string
  /** 额外的 URL query 参数；用于 POST 也需要 query 的场景（如旧 /v1 端点把 ids/all/skip/include/queue 放 query、body 仅放 param）。 */
  query?: Record<string, unknown>
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
  override readonly cause?: unknown

  constructor(endpoint: string, cause?: unknown) {
    super(`请求异常 [${endpoint}]: ${(cause as Error)?.message ?? String(cause)}`)
    this.endpoint = endpoint
    this.name = 'ApiError'
    this.cause = cause
  }
}

// 危险端点集合从契约清单 endpoints.ts 派生（单一事实源）；UI 统一灰显或二次确认。
export { DANGER_ENDPOINTS }
export function isDanger(endpoint: string): boolean {
  return DANGER_ENDPOINTS.has(endpoint)
}

// 生产写守卫（0812 计划 M0-4，2026-08-25 放宽为「可新建、禁改删」）：
// 本地/联调会话可能把 VITE_API_PROXY_TARGET 指向生产（118.25.96.217）。
// 允许：新建网站、新建源（含随源新建配置）、把新建源关联网站、创建编排元数据。
// 禁止：改、删、启停、发抓取、换绑已有源、覆盖流程等。
// 判定读当前实际连接的后端主机：VITE_API_PROXY_TARGET 与 vite.config.ts 的 proxy target 同源。
const PRODUCTION_BACKEND_HOSTS = ['118.25.96.217']

function currentBackendTarget(): string {
  const env = import.meta.env as Record<string, string | undefined>
  return env.VITE_API_PROXY_TARGET || env.VITE_AUTH_PROXY_TARGET || ''
}

export function isProductionBackend(): boolean {
  const target = currentBackendTarget()
  return PRODUCTION_BACKEND_HOSTS.some((host) => target.includes(host))
}

/**
 * 生产新建通道：代理已指向生产，且显式允许新建。
 * 日常联调保持 VITE_API_MODE=mock（已迁移 live 端点走正式接口，未迁移继续 mock），
 * 不要用 VITE_API_MODE=http 一刀切打生产。
 */
export function isProductionCreateEnabled(): boolean {
  return isProductionBackend() && import.meta.env.VITE_SITE_CREATE_TARGET === 'production'
}

// 按真实请求目的地（httpEndpoint）判断，与 usesMockAdapter 的 liveCheckKey 口径一致。
const PRODUCTION_CREATE_ENDPOINTS = new Set([
  'site/add',
  'site/createSite',
  'snatch/snatchSave',
  'source/bindSite',
  '/vrule/api/custom-compose/save',
  // 2026-08-26 拍板放开：配置的参数绑定/解绑。这两个是本清单里**第一次**出现的真删改
  // （configParamDel 直接删掉配置与参数的绑定记录，不可撤销），放开原因是画布上的「解绑」
  // 此前只改内存、刷新就回来，等于界面骗人；旧平台同一个按钮本来就是即时写库的。
  'config/configParamAdd',
  'config/configParamDel',
  'source/sendSnatchWithParam',
  // 2026-08-27 拍板放开：源换网站 / 删除源 / 网站重命名（侧栏右键菜单）。
  // source/delete 是**永久删除源**，本清单里破坏性最强的一条，UI 侧必须保留二次确认。
  'source/delete',
  'site/update',
  // 2026-08-28 拍板放开：源重命名（source/updateSource，team_six bfbbcf7 已切真实请求，
  // 但漏加本白名单，导致打生产时被写保护拦下）。
  'source/updateSource',
  // 2026-08-28 拍板放开：节点配置的新建与保存（config/modify/updateConfig）。
  // 这个端点**新增和修改是同一个**（不带 configId = 新增，带 = 更新，见 config_api.md §二），
  // 放开它等于同时放开"改已有配置"，而配置可被多个节点/流程/源复用，一次保存会影响到所有引用方。
  // UI 侧的防线是「保存配置」前的影响范围确认（SaveSharedConfigDialog）：按**源**计，
  // 数据来自 source/sourcePaged 的 configId 反查（穿透流程，首节点配置与子步骤引用都命中）。
  // 新建（还没有 configId）没有影响面，不拦。
  'config/modify/updateConfig',
])

function isProductionWriteAllowed(httpEndpoint: string): boolean {
  return PRODUCTION_CREATE_ENDPOINTS.has(httpEndpoint)
}

export class ProductionWriteBlockedError extends Error {
  httpEndpoint: string

  constructor(httpEndpoint: string) {
    super(`生产环境写保护：端点 [${httpEndpoint}] 不在允许清单（仅允许新建网站/源/配置及编排元数据，禁止改删），已阻止发送，未联网`)
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
    // M3-0K（2026-08-18 实测）：业务失败时 envelope.data 有时带着比 msg 更具体的诊断（例如
    // nextStep 的 cond 语法错误，msg 只有"错误信息:运行时异常"，data 却是真实的解释器报错
    // "<Long, 1> can't be a left value for assignment."）。此前只取 msg，data 被静默丢弃。
    const detail = typeof envelope.data === 'string' && envelope.data.trim() ? `：${envelope.data}` : ''
    const err = new Error(String(envelope.msg || envelope.message || `业务请求失败 [${endpoint}]`) + detail) as Error & {
      payload?: Record<string, unknown>
    }
    err.payload = envelope
    throw err
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
  // data 有时只是个诊断用的标量，不是调用方要的载荷——2026-08-19 真实联调 nextStep2 实测撞见：
  // 后端回 {msg:"操作成功，请等待处理，本次发送:0 条任务", data:0}，"0 !== null" 成立，旧逻辑把
  // 标量 0 当整个响应体返回，调用方按 {message} 取值时 msg 被静默丢弃，UI 只能落到兜底文案。
  // 只有 data 是对象/数组（详情、列表）时才是调用方真正要用的载荷，可以直接透传；标量场景下
  // envelope.msg 才是要展示给用户的真实文案。
  if (data !== undefined && data !== null && typeof data === 'object') return data
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
  // 按调用覆盖优先：强制 mock 用于未迁移域；强制 http 用于少数已迁移写路径（如生产新建）。
  if (options.mode === 'mock') return true
  if (options.mode === 'http') return false
  // live 判定键：
  // - data 域：httpEndpoint 为相对真实路径（如 entry/entryDataPaged），优先用它（逻辑键不在清单里）
  // - vrule：httpEndpoint 为根相对绝对路径（/vrule/...），不在清单里，改用逻辑键（rule/orchestration*）
  const httpKey = options.httpEndpoint
  const liveCheckKey = httpKey && !httpKey.startsWith('/') ? httpKey : endpoint
  return MODE === 'mock' && (DISABLE_LIVE_ENDPOINTS || !LIVE_ENDPOINTS.has(liveCheckKey))
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
    const requestUrl = options.query ? appendQuery(url, options.query) : url
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
    if (paramsIn === 'body') headers['Content-Type'] = 'application/json'
    let res: Response
    try {
      res = await fetch(requestUrl, {
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
      let body: Record<string, unknown> | undefined
      try {
        body = await res.clone().json() as Record<string, unknown>
        if (body && typeof body === 'object') {
          if (body.msg) detail = `: ${String(body.msg)}`
          else if (body.message) detail = `: ${String(body.message)}`
        }
      } catch { /* 无 body 或非 JSON */ }
      const err = new Error(`请求失败 ${res.status}${detail}`) as Error & {
        body?: Record<string, unknown>
        status?: number
      }
      err.body = body
      err.status = res.status
      throw err
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
