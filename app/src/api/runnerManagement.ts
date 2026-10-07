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
  /** 站点代码所在仓库；遗留脚本发布接口不返回。 */
  repoId?: string | null
  repoName?: string | null
}

export interface SiteCodeVersion extends PublishedScript {
  codeId: string
  configId: string
  queueName: string
  siteHost: string
  storagePath: string
  deliveryPath: string
  publishedAt: string
  prompt: string
  url: string
  /** 首次发布时的节点抓取类型（configType）；决定代码进哪个仓库。 */
  configType?: string
  repoPath?: string | null
  environment?: 'test' | 'prd'
}

export interface SiteCodeRepositorySetting {
  path: string
  defaultPath: string
  remoteUrl: string
  branch: string
}

/** 服务器代码仓库。新代码按配置类型分类进仓库，未分类进默认仓库；已有代码不随分类变化搬动。 */
export interface CodeRepository {
  repoId: string
  name: string
  path: string
  remoteUrl: string
  branch: string
  isDefault: boolean
  status: 'ACTIVE' | 'DISABLED'
  /** 分到本仓库的节点抓取类型编号，如 ['90', '150']。 */
  configTypes: string[]
  codeCount: number
  createdAt: string
  updatedAt: string
}

export interface CodeRepoRule {
  configType: string
  /** 空串表示删除该类型的分类，回到默认仓库。 */
  repoId: string
}

export interface CodeRepositoryInput {
  name: string
  path: string
  remoteUrl: string
  branch: string
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
  siteCodeRepository: () => request<SiteCodeRepositorySetting>('/settings/site-code-repo'),
  updateSiteCodeRepository: (path: string) => request<SiteCodeRepositorySetting>('/settings/site-code-repo', 'POST', { path }),
  updateSiteCodeGit: (remoteUrl: string, branch: string) => request<SiteCodeRepositorySetting>('/settings/site-code-git', 'POST', { remoteUrl, branch }),
  codeRepositories: () => list<CodeRepository>('/settings/code-repos'),
  createCodeRepository: (input: CodeRepositoryInput) => request<CodeRepository>('/settings/code-repos', 'POST', input),
  updateCodeRepository: (repoId: string, input: Partial<Omit<CodeRepositoryInput, 'path'>> & { status?: CodeRepository['status'] }) => request<CodeRepository>(`/settings/code-repos/${encodeURIComponent(repoId)}`, 'POST', input),
  moveCodeRepository: (repoId: string, path: string) => request<CodeRepository>(`/settings/code-repos/${encodeURIComponent(repoId)}/path`, 'POST', { path }),
  setDefaultCodeRepository: (repoId: string) => request<CodeRepository>(`/settings/code-repos/${encodeURIComponent(repoId)}/default`, 'POST', {}),
  codeRepoRules: () => list<CodeRepoRule>('/settings/code-repo-rules'),
  saveCodeRepoRules: (rules: CodeRepoRule[]) => request<CodeRepoRule[]>('/settings/code-repo-rules', 'POST', { rules }),
  instances: () => list<RunnerInstance>('/runners'),
  enrollmentCode: () => request<EnrollmentCode>('/runners/enrollment-codes', 'POST', {}),
  assignments: () => list<QueueAssignment>('/assignments'),
  createAssignment: (input: Omit<QueueAssignment, 'assignmentId'>) => request<QueueAssignment>('/assignments', 'POST', input),
  removeAssignment: (assignmentId: string) => request<void>(`/assignments/${encodeURIComponent(assignmentId)}`, 'DELETE'),
  releases: () => list<ArtifactRelease>('/releases'),
  publishProcessor: (processorType: 'probe' | 'newslink_nourl') => request<{ digest: string }>('/releases/processors', 'POST', { processorType }),
  publishRunner: () => request<{ digest: string; created: boolean }>('/releases/runners', 'POST', {}),
  setDesiredRunner: (runnerId: string, digest: string) => request<{ runnerId: string; digest: string }>(`/runners/${encodeURIComponent(runnerId)}/desired-runner`, 'POST', { digest }),
  scriptBinding: (configId: string) => request<ScriptBinding | null>(`/configs/${encodeURIComponent(configId)}/script-release`),
  publishScript: (input: { configId: string; fileName: string; code: string; prompt: string; url: string; queueName?: string; codeType?: 'site' | 'default'; siteHost?: string; configType?: string }) => request<PublishedScript>('/site-scripts/publish', 'POST', input),
  adoptScript: (configId: string, scriptDigest: string) => request<ScriptBinding>(`/configs/${encodeURIComponent(configId)}/script-release`, 'POST', { scriptDigest }),
  siteCodeVersions: (configId: string, queueName: string) => list<SiteCodeVersion>(`/site-scripts/versions?configId=${encodeURIComponent(configId)}&queueName=${encodeURIComponent(queueName)}`),
  siteCodeCatalog: () => list<SiteCodeVersion & { environments: ('test' | 'prd')[] }>('/site-scripts/catalog'),
  siteCodeContent: (digest: string) => request<SiteCodeVersion & { code: string }>(`/site-scripts/code?digest=${encodeURIComponent(digest)}`),
  siteCodeBindings: (configId: string, queueName: string, environment: 'test' | 'prd') => list<SiteCodeVersion>(`/site-scripts/bindings?configId=${encodeURIComponent(configId)}&queueName=${encodeURIComponent(queueName)}&environment=${environment}`),
  bindSiteCode: (input: { configId: string; queueName: string; environment: 'test' | 'prd'; scriptDigest: string }) => request<SiteCodeVersion>('/site-scripts/bind', 'POST', input),
}
