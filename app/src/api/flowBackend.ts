/** Local development can route the whole flow work area to a separate backend. */
const FLOW_PREFIXES = ['flow/', 'workflow/']
const FLOW_CONFIG_ENDPOINTS = new Set([
  'config/configDetail', 'config/configPaged', 'config/add', 'config/copyAll',
  'config/modify/updateConfig', 'config/modify/updateConfigPolicy',
  'config/configParams', 'config/configParamAdd', 'config/configParamDel', 'config/loadParams',
])

export function isFlowWorkspace(hash: string): boolean {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  return path === '/flows' || (path === '/canvas' && new URLSearchParams(query).get('view') === 'flow')
}

export function usesFlowBackend(endpoint: string, hash: string): boolean {
  const path = endpoint.replace(/^\/api\/v1\//, '').replace(/^\//, '')
  if (FLOW_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  return isFlowWorkspace(hash) && (path.startsWith('item/next/') || FLOW_CONFIG_ENDPOINTS.has(path))
}

export type BackendScope = 'flow' | 'default'

export function flowRequestPath(path: string, endpoint: string, target: string | undefined, hash: string, scope?: BackendScope): string {
  if (scope === 'default' || !target || !path.startsWith('/api/v1/') || !usesFlowBackend(endpoint, scope === 'flow' ? '#/flows' : hash)) return path
  return path.replace(/^\/api\//, '/api/local-flow/')
}

export function endpointBackendTarget(endpoint: string, defaultTarget: string, flowTarget: string | undefined, hash: string): string {
  return flowTarget && usesFlowBackend(endpoint, hash) ? flowTarget : defaultTarget
}
