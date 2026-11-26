/**
 * 旧平台取数 API（/rest/api/v1/data/*）的地址拼装，源数据视图与数据中心共用。
 *
 * appId/appKey 是旧接口的应用凭据，不使用当前登录 token 替代；部署时可通过
 * VITE_LEGACY_API_APP_ID / VITE_LEGACY_API_APP_KEY / VITE_LEGACY_REST_BASE 覆盖。
 */
export interface LegacyFetchApiEnv {
  restBase?: string
  appId?: string
  appKey?: string
}

function resolveEnv(env: LegacyFetchApiEnv = {}) {
  const restBase = env.restBase || import.meta.env.VITE_LEGACY_REST_BASE || `${window.location.origin}/rest`
  return {
    restBase: restBase.replace(/\/$/, ''),
    appId: env.appId || import.meta.env.VITE_LEGACY_API_APP_ID || 'dev',
    appKey: env.appKey || import.meta.env.VITE_LEGACY_API_APP_KEY || 'dev1',
  }
}

/**
 * 「按条件分页查询」地址（`/rest/api/v1/data/qs`）。没有条件时返回空串——
 * 条件为空时 ID 分批取数已经够用，不再多摆一个入口。
 * `more` 由 api 层 buildQueryServiceMore 按页面查询口径生成。
 */
export function buildQueryServiceUrl(
  q: { tableId?: string; sourceId?: string; more?: string; size?: number },
  env?: LegacyFetchApiEnv,
): string {
  if (!q.more) return ''
  const { restBase, appId, appKey } = resolveEnv(env)
  const params = [
    `appId=${encodeURIComponent(appId)}`,
    `appKey=${encodeURIComponent(appKey)}`,
    `type=${encodeURIComponent(q.tableId || '<tableId>')}`,
  ]
  if (q.sourceId) params.push(`sourceId=${encodeURIComponent(q.sourceId)}`)
  params.push(`more=${encodeURIComponent(q.more)}`, 'page=1', `size=${q.size ?? 20}`)
  return `${restBase}/api/v1/data/qs?${params.join('&')}`
}

