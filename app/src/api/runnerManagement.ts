import { ACCESS_TOKEN_HEADER, readStoredToken, triggerSessionExpired } from './auth'

export interface RunnerInstance {
  runnerId: string
  name: string
  ipAddress: string
  installDirectory: string
  platform: string
  capabilities: string[]
  status: 'online' | 'offline' | 'upgrading' | 'error'
  lastHeartbeat: string | null
  desiredDigest: string | null
  actualDigest: string | null
  assignmentCount: number
  lastError?: string | null
}

export interface QueueAssignment {
  assignmentId: string
  runnerId: string
  queue: string
  processorType: string
  releaseDigest: string
  concurrency: number
  enabled: boolean
  environment: 'production' | 'test'
}

export interface ArtifactRelease {
  digest: string
  kind: 'processor' | 'script' | 'runner'
  name: string
  platform: string
  gitCommit: string
  status: 'candidate' | 'published' | 'failed'
  publishedAt: string | null
  signature: string
  usedBy: number
}

export interface EnrollmentCode {
  code: string
  expiresAt: string
}

export interface ScriptBinding {
  configId: string
  gitUrl: string
  gitCommit: string
  scriptDigest: string
  publishedAt: string
  status: string
}

export interface PublishedScript {
  gitUrl: string
  gitCommit: string
  scriptDigest: string
}

type Method = 'GET' | 'POST' | 'DELETE'

async function request<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(`/api/runner-management${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Runner 管理服务不可达')
  }
  if (response.status === 401) triggerSessionExpired()
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : `Runner 管理服务请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  return payload as T
}

function list<T>(path: string): Promise<T[]> {
  return request<unknown>(path).then((payload) => {
    if (!Array.isArray(payload)) throw new Error('Runner 管理服务返回的列表格式无效')
    return payload as T[]
  })
}

export const runnerManagementApi = {
  instances: () => list<RunnerInstance>('/runners'),
  enrollmentCode: () => request<EnrollmentCode>('/runners/enrollment-codes', 'POST', {}),
  assignments: () => list<QueueAssignment>('/assignments'),
  createAssignment: (input: Omit<QueueAssignment, 'assignmentId'>) => request<QueueAssignment>('/assignments', 'POST', input),
  removeAssignment: (assignmentId: string) => request<void>(`/assignments/${encodeURIComponent(assignmentId)}`, 'DELETE'),
  releases: () => list<ArtifactRelease>('/releases'),
  publishProcessor: (processorType: 'probe' | 'newslink_nourl') => request<{ digest: string }>('/releases/processors', 'POST', { processorType }),
  publishRunner: () => request<{ digest: string }>('/releases/runners', 'POST', {}),
  setDesiredRunner: (runnerId: string, digest: string) => request<{ runnerId: string; digest: string }>(`/runners/${encodeURIComponent(runnerId)}/desired-runner`, 'POST', { digest }),
  scriptBinding: (configId: string) => request<ScriptBinding | null>(`/configs/${encodeURIComponent(configId)}/script-release`),
  publishScript: (input: { configId: string; fileName: string; code: string; prompt: string; url: string }) => request<PublishedScript>('/site-scripts/publish', 'POST', input),
  adoptScript: (configId: string, scriptDigest: string) => request<ScriptBinding>(`/configs/${encodeURIComponent(configId)}/script-release`, 'POST', { scriptDigest }),
}
