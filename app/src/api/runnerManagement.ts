import { ACCESS_TOKEN_HEADER, getInfo, readStoredToken } from './auth'
import { streamModelInterfaceTest } from './modelInterfaceStream'
import { taskInstFromLegacy } from './legacyAdapters'

export interface GenerationModelCall {
  interfaceId: string; name: string; kind: string; model: string; endpoint: string; method: string
  timeoutSeconds: number; serverId?: string; serverName?: string; serverAddress?: string; capturedAt?: string
}
export interface MqCodeJob {
  taskId: string
  serverId: string
  configId: string
  queue: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  createdAt: string
  startedAt?: string
  finishedAt?: string
  deletedAt?: string
  message: string
  callbackSent: boolean
  stages: string[]
  output: string
  request?: import('./siteScript').SiteScriptModelRequest
  modelCall?: GenerationModelCall
  params?: Record<string, unknown>
  result?: import('./siteScript').SiteScriptGenerateResult | null
}
export type GenerationRepositoryResult = Pick<GeneratedCodeArchive, 'repoId' | 'directoryId' | 'directoryPath'> & {
  files: Pick<GeneratedCodeArchive['files'][number], 'path'>[]
}

export interface NodeGenerationSettings {
  configId: string
  enabled: boolean
  generation: null | { interfaceId: string; repositoryId: string; directoryId: string; configType: string; queueName: string; systemPrompt: string; userPrompt: string; url: string; fileNameMode: 'website' | 'queue'; workspaceMode?: 'config-queue' | 'config' | 'queue' | 'custom'; workspacePath?: string; codeDirectory?: string; destinationMode?: 'type' | 'custom' }
}
export interface GenerationDestination {
  repositoryId: string; directoryId: string; directoryPath: string; repoName: string
  remoteUrl: string; branch: string; configType: string; matchedBy: 'type' | 'default'
}
export interface SourceCodeTask {
  taskId: string; sourceId: string; sourceName: string; flowId: string; configId: string; nodeName: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'; createdAt: string; startedAt: string; finishedAt: string; message: string; archiveId: string; gitCommit: string
}
export interface SourceGenerationSnapshot {
  sourceId: string; name: string; url: string; flowId: string
  nodes: { stepId?: string; configId?: string; name: string; isRoot?: boolean; enabled: boolean }[]
}

export interface RunnerWorkerProcess {
  assignmentId: string
  queue: string
  /** 从 0 开始的并发进程序号。 */
  slot: number
  pid: number
  entry?: string
  workingDirectory?: string
}

export interface RunnerInstance {
  launcherVersion?: string | null
  runnerId: string
  name: string
  ipAddress: string
  installDirectory: string
  platform: string
  /** Runner 上报的实际操作系统；旧实例尚未上报时为空。 */
  osType?: string | null
  osVersion?: string | null
  capabilities: string[]
  status: 'online' | 'offline' | 'upgrading' | 'error'
  lastHeartbeat: string | null
  /** Runner 自身的升级目标摘要，与队列处理程序/业务代码版本独立。 */
  desiredDigest: string | null
  /** Runner 心跳上报的自身版本；直接运行源码时为 source-local。 */
  actualDigest: string | null
  assignmentCount: number
  lastError?: string | null
  /** 最近心跳上报的 Runner 主进程，旧版本未上报时为空。 */
  runnerPid?: number | null
  /** 最近心跳仍存活的任务进程；空数组为无进程，null 为尚未上报。 */
  workerProcesses?: RunnerWorkerProcess[] | null
}
export interface ProcessorProcess extends RunnerWorkerProcess {
  /** 与当前 Runner、分配、并发序号和 PID 匹配的运行日志。 */
  runId?: string
  runnerId: string
  runtimeId: string
  generation: string
  stopStatus: '' | 'pending' | 'applied' | 'failed'
  stopError: string
}
export interface ProcessStopRequest {
  requestId: string
  status: 'pending' | 'applied' | 'failed'
  pid: number
  slot: number
  error: string
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
  codeId?: string
  configId?: string
  scriptDigest?: string
  deliveryPath?: string
  siteHost?: string
  repoName?: string
  gitCommit?: string
  directoryTemplate?: string
}

export interface NodeCodeAssignmentInput {
  runnerId: string
  scriptDigest: string
  concurrency: number
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
export interface RunnerPackageInfo {
  server: string
  platform: 'windows-x64'
  pythonVersion: string
  releases: ArtifactRelease[]
  enrollmentMinutes: number
  ready: boolean
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
  promptTemplateId?: number
  /** 节点代码发布返回稳定代码 ID 和网站信息；旧发布接口不返回。 */
  codeId?: string
  siteHost?: string
  /** 仓库内按节点类型管理的保存目录，旧代码为空。 */
  directoryId?: string
  gitUrl: string
  gitCommit: string
  scriptDigest: string
  /** 站点代码所在仓库；遗留脚本发布接口不返回。 */
  repoId?: string | null
  repoName?: string | null
  /** 节点代码发布返回仓库保存位置；遗留脚本发布接口不返回。 */
  storagePath?: string
  deliveryPath?: string
  repoPath?: string | null
}

export interface SiteCodeVersion extends PublishedScript {
  associationDetached?: boolean
  codeId: string
  configId: string
  queueName: string
  siteHost: string
  storagePath: string
  deliveryPath: string
  publishedAt: string
  prompt: string
  systemPrompt?: string
  userPrompt?: string
  url: string
  /** 节点抓取类型（configType）；生成代码时筛选可选仓库。 */
  configType?: string
  repoPath?: string | null
  sourceRepoPath?: string
  sourceGitCommit?: string
  environment?: 'test' | 'prd'
  directoryLayout?: DirectoryLayout | null
}

export interface DirectoryMappingNode {
  id: string
  parentId: string
  name: string
  kind: 'folder' | 'file'
  repoId?: string
  sourcePath?: string
  sourceType?: 'file' | 'directory'
  gitCommit?: string
}

export type DirectoryBindingType = 'config' | 'queue' | 'website' | 'custom'
export interface DirectoryLayoutOwner { bindingType: 'website' | 'custom'; ownerId: string }
export interface DirectoryDelivery {
  unchanged?: boolean
  transferredFileCount?: number
  unchangedFileCount?: number
  deliveryId: string
  bindingType: DirectoryBindingType | 'deployment'
  ownerId: string
  runnerId: string
  status: 'pending' | 'running' | 'success' | 'failed'
  layoutRevision: string
  artifactDigest: string
  targetPath: string
  installedPath: string
  requestedAt: string
  startedAt: string | null
  finishedAt: string | null
  error: string
}
export interface DirectoryRunnerBinding {
  bindingType: DirectoryBindingType | 'deployment'
  ownerId: string
  runnerId: string
  directoryTemplate: string
  entryPoint: string
  createdAt: string
  layoutRevision?: string
  delivery?: DirectoryDelivery | null
}
export type DirectoryRunnerBindingInput = Pick<DirectoryRunnerBinding, 'bindingType' | 'ownerId' | 'runnerId'>
export interface DirectoryDeliveryItem {
  path: string
  kind: 'file' | 'folder'
  size: number
  status: 'added' | 'modified' | 'unchanged'
  sha256?: string
  previousSha256?: string | null
}
export interface DirectoryDeliveryPreview {
  revision: string
  targetPath: string
  baselineDigest: string | null
  items: DirectoryDeliveryItem[]
}
export interface DirectoryDeliveryInput extends DirectoryRunnerBindingInput {
  revision: string
  scope?: 'all' | 'selected'
  paths?: string[]
  baselineDigest?: string | null
}
export interface DirectoryLayout {
  /** 旧配置视图未提供此字段时，按 config 处理。 */
  bindingType?: DirectoryBindingType
  ownerId?: string
  /** 新目录首次保存前的编辑状态，不参与修订号计算。 */
  isNew?: boolean
  /** 初始执行入口的代码项信息，不作为目录视图的所属标识。 */
  codeId: string
  configId: string
  queueName: string
  siteHost: string
  directoryTemplate: string
  entryPoint: string
  nodes: DirectoryMappingNode[]
  revision: string
}

export interface DeploymentSourceNode {
  flowId: string
  flowName: string
  stepId: string
  nodeName: string
  configId: string
}
export interface DeploymentConfiguration extends DirectoryLayout {
  deploymentId: string
  name: string
  pathStyle: DirectoryBindingType
  sourceNode?: DeploymentSourceNode
  /** 按配置 ID 反查的流程节点；不替代已保存的来源绑定。 */
  relatedSourceNodes?: (DeploymentSourceNode & { isDraft?: boolean })[]
  updatedAt?: string
  legacyType?: DirectoryBindingType
  legacyOwner?: string
}
export interface RunnerRetryPolicy {
  enabled: boolean
  maxAttempts: number
  windowSeconds: number
  delaysSeconds: number[]
}
export interface RuntimeConfiguration {
  /** 已确认手工关闭的并发序号，成功手动启动后清空。 */
  stoppedProcessSlots?: number[]
  runtimeId: string
  deploymentId: string
  name: string
  runnerId: string
  assignmentId: string
  appliedRevision: string
  layoutRevision: string
  deliveredCodeMatches?: boolean
  latestCodeMatchesDelivery?: boolean
  revision: string
  directoryTemplate: string
  entryPoint: string
  binding: DirectoryRunnerBinding | null
  assignment: QueueAssignment | null
  retryPolicy?: RunnerRetryPolicy
}
export interface RuntimeConfigurationInput {
  runtimeId?: string
  revision?: string
  deploymentId: string
  layoutRevision: string
  runnerId: string
  codeId?: string
  environment: 'test' | 'production'
  concurrency: number
  retryPolicy?: RunnerRetryPolicy
}

export interface RuntimeLogRecord {
  recordId: string
  runnerId: string
  runtimeId: string
  deploymentId: string
  assignmentId: string
  parentId: string
  kind: 'delivery' | 'start' | 'stop' | 'run' | 'runner'
  status: string
  requestedAt: string
  updatedAt: string
  finishedAt: string | null
  error: string
  lastHeartbeat?: string | null
  snapshot: {
    name?: string; runnerName?: string; ipAddress?: string; installDirectory?: string
    configId?: string; queue?: string; entryPoint?: string; directoryTemplate?: string
    revision?: string; releaseDigest?: string; runnerVersion?: string
    sourceNode?: { flowName?: string; nodeName?: string }; scope?: string; selectedPaths?: string[]
    sources?: { repoId?: string; sourcePath?: string; gitCommit?: string; name?: string; targetPath?: string }[]
  }
}
export interface RuntimeLogDetail extends RuntimeLogRecord {
  events: { eventId: string; time: string; stage: string; level: string; message: string; detail: string }[]
  streams: { streamId: string; lastSeq: number; byteCount: number; updatedAt: string }[]
  runs: RuntimeLogRecord[]
  run: {
    slot: number; pid: number | null; entry: string; working_directory: string; interpreter: string
    started_at: string | null; ended_at: string | null; exit_code: number | null; reason: string
  } | null
  logAvailable?: boolean
}
export interface RuntimeLogFilters {
  assignmentId?: string; processPid?: number; processSlot?: number
  runnerId?: string; runtimeId?: string; keyword?: string; kind?: string; status?: string
  since?: string; until?: string; page?: number; pageSize?: number
}
export interface RuntimeLogLine { seq: number; index: number; text: string; time: string; source: string }
export interface RuntimeLogEntries { entries: RuntimeLogLine[]; cursor: number; firstCursor: number; lastSeq: number; hasEarlier: boolean; earliestSeq?: number; expired?: boolean }
export interface RuntimeLogPolicy { directory: string; retentionDays: number; quotaMb: number; hasLogs: boolean }

export interface RepositoryTree {
  repoId: string
  gitCommit: string
  items: { path: string; kind: 'file' | 'directory'; size: number | null; selectable: boolean }[]
}

export interface SiteCodeRepositorySetting {
  path: string
  defaultPath: string
  remoteUrl: string
  branch: string
}

/** 服务器代码仓库。配置类型为空表示通用仓库。 */
export interface CodeRepository {
  repoId: string
  name: string
  path: string
  remoteUrl: string
  branch: string
  isDefault: boolean
  status: 'ACTIVE' | 'DISABLED'
  configType: string
  configTypeName: string
  uploadDirectory: string
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
  configType: string
  configTypeName: string
}

export interface CodeRepositoryDirectory {
  directoryId: string
  repoId: string
  name: string
  configType: string
  configTypeName: string
  path: string
  status: 'ACTIVE' | 'DISABLED'
  isDefault: boolean
  revision: string
  codeCount?: number
  generationDefault?: boolean
}
export type CodeRepositoryDirectoryInput = Pick<CodeRepositoryDirectory, 'name' | 'configType' | 'configTypeName' | 'path'> & Partial<Pick<CodeRepositoryDirectory, 'status' | 'revision'>>

export interface CodeRepositoryFile {
  deleteReason?: string
  path: string
  kind?: 'file' | 'directory'
  size: number | null
  managed: boolean
  canDelete: boolean
  gitUrl: string
  /** 最后一次 Git 提交时间；目录为其下文件最近的提交时间。 */
  updatedAt?: string | null
}

export interface CodeRepositoryFilePage {
  repoId: string
  uploadDirectory: string
  total: number
  page: number
  pageSize: number
  items: CodeRepositoryFile[]
}

export interface CodeRepositoryFileContent {
  repoId: string
  path: string
  size: number
  content: string
  gitCommit: string
}

export interface CodeRepositoryFileMetadata {
  repoId: string
  path: string
  /** 查看目录时的仓库快照，关联到部署配置时继续使用此提交。 */
  gitCommit: string
  /** 该快照中最后一次修改此文件的提交。 */
  fileCommit: string
  /** 跟随重命名后的首次 Git 提交时间。 */
  createdAt: string
  updatedAt: string
}

export interface CodeRepositoryVerification {
  repoId: string
  status: 'ok' | 'warning' | 'error'
  checks: { name: string; status: 'ok' | 'warning' | 'error' | 'skipped'; message: string }[]
  checkedAt: string
}

export interface CodeRepositoryUploadResult {
  repoId: string
  gitCommit: string
  pushed: boolean
  changed: boolean
  files: { path: string; size: number; gitUrl: string }[]
}

type Method = 'GET' | 'POST' | 'DELETE'

async function checkBusinessSession(response: Response): Promise<void> {
  if (response.status !== 401) return
  // Runner 独立部署，认证目标可能与当前业务环境不同；仅业务身份接口确认失效才全局登出。
  // getInfo 沿用原有的 401 / 登录重定向处理；其他异常保留当前登录，随后报告 Runner 的错误。
  await getInfo().catch(() => { })
}

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
  await checkBusinessSession(response)
  const payload = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : `Runner 管理服务请求失败（HTTP ${response.status}）`
    throw new Error(response.status === 401 ? `Runner 管理服务认证失败：${message}` : message)
  }
  return payload as T
}

function list<T>(path: string): Promise<T[]> {
  return request<unknown>(path).then((payload) => {
    if (!Array.isArray(payload)) throw new Error('Runner 管理服务返回的列表格式无效')
    return payload as T[]
  })
}

export interface ModelInterface {
  generationServerId?: string
  generationServerMode?: 'auto' | 'manual' | 'direct'
  generationServerMatch?: 'matched' | 'offline' | 'ambiguous' | 'unmatched' | 'local' | 'manual' | 'missing' | 'direct'
  id: string
  name: string
  kind: 'agent' | 'gemini-agent' | 'gemini-chat' | 'chat' | 'site-script'
  title?: string
  endpoint: string
  model: string
  enabled: boolean
  isDefault: boolean
  timeoutSeconds: number
  inputFileDir: string
  prjDir?: string
  cdpPort?: number
  testSystemPrompt?: string
  testUserPrompt?: string
  codeDir: string
  outputFileDir: string
  stream: boolean
}
export interface RepositoryFileReference {
  kind: 'node' | 'version' | 'deployment' | 'generation'; scope: 'current' | 'history'
  configId: string; codeId?: string; queueName: string; deploymentId?: string; name?: string
  gitCommit?: string; digest?: string; publishedAt?: string; isLatest?: boolean; environments?: string[]; machineBindingCount?: number
  targetPaths?: string[]; sourceNodes: DeploymentSourceNode[]
  archiveId?: string; archiveStatus?: 'pending' | 'failed' | 'committed'
}
export interface GeneratedCodeArchive {
  serverCodeDirectory?: string
  archiveId: string; status: 'pending' | 'failed' | 'committed'; message: string
  configId: string; repoId: string; directoryId: string; directoryPath: string; taskId: string; serverId: string
  createdAt: string; gitCommit: string; pushed: boolean
  files: { path: string; relativePath: string; sha256: string; size: number; serverPath?: string }[]
}
export interface RepositoryFileReferences {
  repoId: string; repoName: string; path: string; protectionReasons: string[]; items: RepositoryFileReference[]
}
export interface ModelInterfaceSettings { items: ModelInterface[]; revision: number }
export interface GenerationGitBinding {
  path: string; repositoryId: string; directoryId: string
  repoName?: string; remoteUrl?: string; branch?: string; directoryPath?: string; error?: string
}
export interface CodeGenerationServer {
  generationGitBindings?: GenerationGitBinding[]
  supportedModels?: Pick<ModelInterface, 'id' | 'name' | 'model' | 'kind' | 'endpoint' | 'enabled' | 'generationServerMode'>[]
  mqCapable?: boolean
  mqGeneration?: { configId: string; queue: string; name: string } | null
  launcherVersion?: string
  serverId: string; name: string; endpoint: string; workspace: string; installDirectory: string
  generationRoot?: string; runUser?: string
  ipAddress: string; osType: string; osVersion: string; version: string; pid?: number
  lastHeartbeat: string; status: 'online' | 'offline'
  upgradeCapable?: boolean; actualDigest?: string
  upgrade?: { digest: string; requestId: string; status: 'pending' | 'waiting' | 'upgrading' | 'succeeded' | 'failed'; message: string } | null
}
export interface CodeServerRelease { digest: string; version: string; publishedAt: string }
export interface RemoteCodeFile {
  name: string; path: string; isDirectory: boolean; size: number | null; modifiedAt: string; sha256?: string | null
  content?: string; data?: string; accessError?: string
}
export interface ModelInterfaceTestInput {
  taskId?: string
  cdpPort?: number
  interfaceId: string; prompt: string; model?: string; stream?: boolean
  title?: string; prjDir?: string; inputFileDir?: string; codeDir?: string; outputFileDir?: string; url?: string; systemPrompt?: string
}
export interface ModelInterfaceTestResult {
  ok: boolean; status: number; contentType: string; responseText: string; durationMs: number
}

export const runnerManagementApi = {
  codeGenerationTasks: async (query: { configId?: string; sourceId?: string; taskId?: string; state?: string; page: number; size: number }) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))
    const result = await request<{ list: unknown[]; total: number }>('/code-generation/tasks?' + params)
    return { list: result.list.map(taskInstFromLegacy), total: result.total }
  },
  createCodeGenerationTask: (body: { sourceId: string; flowId: string; stepId: string; configId: string; sourceName?: string; nodeName?: string; flowVersionId?: string; entryIds?: string[]; generation?: Record<string, unknown> }) => request<{ job: MqCodeJob }>('/code-generation/tasks', 'POST', body),
  deleteCodeGenerationTask: (taskId: string, configId: string) => request<{ ok: true; message: string }>('/code-generation/tasks/delete', 'POST', { taskId, configId }),
  deleteCodeGenerationTasks: (taskIds: string[], configId: string) => request<{ items: { taskId: string; ok: boolean; message: string }[]; deletedCount: number; failedCount: number }>('/code-generation/tasks/delete-batch', 'POST', { taskIds, configId }),
  mqCodeJobSummaries: (taskIds: string[]) => request<{ items: (Pick<MqCodeJob, 'taskId' | 'serverId' | 'configId' | 'queue' | 'status' | 'callbackSent' | 'message'> & { finishedAt?: string; modelCall?: GenerationModelCall; archive?: GenerationRepositoryResult })[] }>(`/code-generation/tasks/summaries?taskIds=${encodeURIComponent(taskIds.join(','))}`),
  mqCodeJob: (taskId: string) => request<{ job: MqCodeJob | null }>(`/code-generation/tasks/detail?taskId=${encodeURIComponent(taskId)}`),
  generatedCodeState: (configId: string) => request<{ autoCommit: boolean; archive: GeneratedCodeArchive | null }>(`/site-scripts/generation-state?configId=${encodeURIComponent(configId)}`),
  nodeGenerationSettings: (configId: string) => request<NodeGenerationSettings>(`/site-scripts/task-config?configId=${encodeURIComponent(configId)}`),
  resolveGenerationDestination: (body: { configId?: string; queueName?: string; configType?: string }) => request<GenerationDestination>('/site-scripts/generation-destination?' + new URLSearchParams(Object.entries(body).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
  setGenerationTypeDefault: (repoId: string, directoryId: string) => request<{ ok: true }>(`/settings/code-repos/${encodeURIComponent(repoId)}/directories/${encodeURIComponent(directoryId)}/generation-default`, 'POST', {}),
  saveNodeGenerationSettings: (body: Pick<NodeGenerationSettings, 'configId'> & Partial<Omit<NodeGenerationSettings, 'configId'>>) => request<NodeGenerationSettings>('/site-scripts/task-config', 'POST', body),
  sourceCodeTasks: () => request<SourceCodeTask[]>('/source-code-tasks'),
  createSourceCodeTasks: (sources: SourceGenerationSnapshot[]) => request<{ created: SourceCodeTask[]; skipped: { sourceId: string; name: string; reason: string }[] }>('/source-code-tasks', 'POST', { sources }),
  saveGenerationPreference: (configId: string, autoCommit: boolean) => request<{ autoCommit: boolean }>('/site-scripts/generation-settings', 'POST', { configId, autoCommit }),
  commitGeneratedCode: (archiveId: string) => request<GeneratedCodeArchive>(`/site-scripts/generated-results/${encodeURIComponent(archiveId)}/commit`, 'POST', {}),
  codeGenerationServers: () => request<{ items: CodeGenerationServer[] }>('/code-servers'),
  saveCodeServerGenerationDirectory: (serverId: string, generationRoot: string) => request<CodeGenerationServer>(`/code-servers/${encodeURIComponent(serverId)}/generation-directory`, 'POST', { generationRoot }),
  saveGenerationGitBinding: (serverId: string, binding: Pick<GenerationGitBinding, 'path' | 'repositoryId'> & { directoryId?: string }) => request<{ items: GenerationGitBinding[] }>(`/code-servers/${encodeURIComponent(serverId)}/generation-git-binding`, 'POST', binding),
  bindCodeServerMq: (serverId: string, configId: string) => request<{ binding: CodeGenerationServer['mqGeneration'] }>(`/code-servers/${encodeURIComponent(serverId)}/mq-binding`, 'POST', { configId }),
  codeServerReleases: () => request<{ items: CodeServerRelease[] }>('/code-servers/releases'),
  publishCodeServer: () => request<{ digest: string; version: string; created: boolean }>('/code-servers/releases', 'POST', {}),
  upgradeCodeServers: (serverIds: string[], digest: string) => request<{ items: NonNullable<CodeGenerationServer['upgrade']>[] }>('/code-servers/upgrades', 'POST', { serverIds, digest }),
  downloadCodeServerMigrationPackage: async (platform: string) => {
    const token = readStoredToken()
    const response = await fetch('/api/runner-management/code-servers/migration-package', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { [ACCESS_TOKEN_HEADER]: token } : {}) }, body: JSON.stringify({ platform })
    })
    await checkBusinessSession(response)
    if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.message || '升级接入包下载失败') }
    return response.blob()
  },
  codeServerEnrollmentCode: () => request<{ code: string; expiresAt: string }>('/code-servers/enrollment-code', 'POST', {}),
  codeServerPackageInfo: () => request<{ platform: string }>('/code-servers/package'),
  remoteCodeFiles: <T = { items: RemoteCodeFile[]; path: string }>(serverId: string, input: Record<string, unknown>) => request<T>(`/code-servers/${encodeURIComponent(serverId)}/files`, 'POST', input),
  importRemoteCode: (serverId: string, input: { repositoryId: string; directoryId: string; paths: string[]; overwrite: boolean }) => request<CodeRepositoryUploadResult>(`/code-servers/${encodeURIComponent(serverId)}/import`, 'POST', input),
  downloadCodeServerPackage: async (platform: string, digest?: string) => {
    const token = readStoredToken()
    const response = await fetch('/api/runner-management/code-servers/package', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { [ACCESS_TOKEN_HEADER]: token } : {}) }, body: JSON.stringify({ platform, digest })
    })
    await checkBusinessSession(response)
    if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.message || '服务包下载失败') }
    return response.blob()
  },
  streamModelInterfaceTest,
  modelInterfaces: () => request<ModelInterfaceSettings>('/settings/model-interfaces'),
  saveModelInterfaces: (input: ModelInterfaceSettings) => request<ModelInterfaceSettings>('/settings/model-interfaces', 'POST', input),
  saveModelTestPrompts: (input: { interfaceId: string; systemPrompt: string; userPrompt: string; revision: number }) => request<ModelInterfaceSettings>('/settings/model-interfaces/test-prompts', 'POST', input),
  testModelInterface: (input: ModelInterfaceTestInput) => request<ModelInterfaceTestResult>('/model-interfaces/test', 'POST', input),
  processorProcesses: () => request<{ runners: RunnerInstance[]; items: ProcessorProcess[] }>('/processes'),
  stopProcessorProcess: (process: Pick<ProcessorProcess, 'runnerId' | 'assignmentId' | 'slot' | 'pid' | 'generation'>) =>
    request<ProcessStopRequest>(`/runners/${encodeURIComponent(process.runnerId)}/processes/stop`, 'POST', { assignmentId: process.assignmentId, slot: process.slot, pid: process.pid, generation: process.generation }),
  runtimeLogPolicy: () => request<RuntimeLogPolicy>('/log-settings'),
  saveRuntimeLogPolicy: (input: RuntimeLogPolicy) => request<RuntimeLogPolicy>('/log-settings', 'POST', input),
  runtimeLogs: (filters: RuntimeLogFilters = {}) => request<{ items: RuntimeLogRecord[]; total: number; page: number; pageSize: number }>(`/runtime-operations?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))}`),
  runtimeLogDetail: (id: string) => request<RuntimeLogDetail>(`/runtime-operations/${encodeURIComponent(id)}`),
  runtimeLogEntries: (id: string, cursor = 0, before = 0) => request<RuntimeLogEntries>(`/log-streams/${encodeURIComponent(id)}/entries?cursor=${cursor}&before=${before}`),
  downloadRuntimeLog: (id: string) => request<{ name: string; content: string }>(`/log-streams/${encodeURIComponent(id)}/download`),
  deploymentConfigurations: (keyword = '') => list<DeploymentConfiguration>(`/deployment-configurations?keyword=${encodeURIComponent(keyword)}`),
  deploymentConfiguration: (id: string) => request<DeploymentConfiguration>(`/deployment-configurations/${encodeURIComponent(id)}`),
  saveDeploymentConfiguration: (layout: DeploymentConfiguration) => request<DeploymentConfiguration>(layout.deploymentId ? `/deployment-configurations/${encodeURIComponent(layout.deploymentId)}` : '/deployment-configurations', 'POST', layout),
  ensureNodeDeployment: (input: { sourceNode: DeploymentSourceNode; queueName: string; scriptDigest?: string }) => request<DeploymentConfiguration>('/deployment-configurations/from-node', 'POST', input),
  runtimeConfigurations: () => list<RuntimeConfiguration>('/runtime-configurations'),
  saveRuntimeConfiguration: (input: RuntimeConfigurationInput) => request<RuntimeConfiguration>('/runtime-configurations', 'POST', input),
  startRuntimeProgram: (id: string, revision: string) => request<RuntimeConfiguration>(`/runtime-configurations/${encodeURIComponent(id)}/start`, 'POST', { revision }),
  stopRuntimeProgram: (id: string, revision: string) => request<RuntimeConfiguration>(`/runtime-configurations/${encodeURIComponent(id)}/stop`, 'POST', { revision }),
  removeRuntimeConfiguration: (id: string, revision: string) => request<{ ok: true }>(`/runtime-configurations/${encodeURIComponent(id)}/remove`, 'POST', { revision }),
  directoryLayout: (configId: string) => request<DirectoryLayout>(`/directory-layouts/configs/${encodeURIComponent(configId)}`),
  queueDirectoryLayout: (queue: string) => request<DirectoryLayout>(`/directory-layouts/queues/${encodeURIComponent(queue)}`),
  namedDirectoryOwners: () => list<DirectoryLayoutOwner>('/directory-layouts/owners'),
  websiteDirectoryLayout: (website: string) => request<DirectoryLayout>(`/directory-layouts/website?owner=${encodeURIComponent(website)}`),
  customDirectoryLayout: (directory: string) => request<DirectoryLayout>(`/directory-layouts/custom?owner=${encodeURIComponent(directory)}`),
  directoryBindings: () => request<DirectoryRunnerBinding[]>('/directory-bindings'),
  createDirectoryBinding: (input: DirectoryRunnerBindingInput) => request<DirectoryRunnerBinding>('/directory-bindings', 'POST', input),
  removeDirectoryBinding: (input: DirectoryRunnerBindingInput) => request<{ ok: true }>(`/directory-bindings/${input.bindingType}/${encodeURIComponent(input.ownerId)}/${encodeURIComponent(input.runnerId)}`, 'DELETE'),
  directoryDeliveryPreview: (input: DirectoryRunnerBindingInput) => request<DirectoryDeliveryPreview>(`/directory-bindings/${input.bindingType}/${encodeURIComponent(input.ownerId)}/${encodeURIComponent(input.runnerId)}/delivery-preview`),
  deliverDirectoryBinding: (input: DirectoryDeliveryInput) => {
    const { bindingType, ownerId, runnerId, ...payload } = input
    return request<DirectoryDelivery>(`/directory-bindings/${bindingType}/${encodeURIComponent(ownerId)}/${encodeURIComponent(runnerId)}/deliver`, 'POST', payload)
  },
  saveDirectoryLayout: (layout: DirectoryLayout) => request<DirectoryLayout>(layout.bindingType === 'website' || layout.bindingType === 'custom'
    ? `/directory-layouts/${layout.bindingType}?owner=${encodeURIComponent(layout.ownerId || '')}`
    : layout.bindingType === 'queue'
      ? `/directory-layouts/queues/${encodeURIComponent(layout.queueName)}`
      : `/directory-layouts/configs/${encodeURIComponent(layout.configId)}`, 'POST', layout),
  codeRepositoryTree: (repoId: string, commit?: string) => request<RepositoryTree>(`/settings/code-repos/${encodeURIComponent(repoId)}/tree${commit ? '?commit=' + encodeURIComponent(commit) : ''}`),
  siteCodeRepository: () => request<SiteCodeRepositorySetting>('/settings/site-code-repo'),
  updateSiteCodeRepository: (path: string) => request<SiteCodeRepositorySetting>('/settings/site-code-repo', 'POST', { path }),
  updateSiteCodeGit: (remoteUrl: string, branch: string) => request<SiteCodeRepositorySetting>('/settings/site-code-git', 'POST', { remoteUrl, branch }),
  codeRepositories: () => list<CodeRepository>('/settings/code-repos'),
  createCodeRepository: (input: CodeRepositoryInput) => request<CodeRepository>('/settings/code-repos', 'POST', input),
  updateCodeRepository: (repoId: string, input: Partial<Omit<CodeRepositoryInput, 'path'>> & { status?: CodeRepository['status'] }) => request<CodeRepository>(`/settings/code-repos/${encodeURIComponent(repoId)}`, 'POST', input),
  moveCodeRepository: (repoId: string, path: string) => request<CodeRepository>(`/settings/code-repos/${encodeURIComponent(repoId)}/path`, 'POST', { path }),
  setDefaultCodeRepository: (repoId: string) => request<CodeRepository>(`/settings/code-repos/${encodeURIComponent(repoId)}/default`, 'POST', {}),
  verifyCodeRepository: (repoId: string) => request<CodeRepositoryVerification>(`/settings/code-repos/${encodeURIComponent(repoId)}/verify`, 'POST', {}),
  codeRepositoryDirectories: (repoId: string) => list<CodeRepositoryDirectory>(`/settings/code-repos/${encodeURIComponent(repoId)}/directories`),
  saveCodeRepositoryDirectory: (repoId: string, input: CodeRepositoryDirectoryInput, directoryId?: string) => request<CodeRepositoryDirectory>(`/settings/code-repos/${encodeURIComponent(repoId)}/directories${directoryId ? '/' + encodeURIComponent(directoryId) : ''}`, 'POST', input),
  removeCodeRepositoryDirectory: (repoId: string, directoryId: string, revision: string) => request<{ ok: true }>(`/settings/code-repos/${encodeURIComponent(repoId)}/directories/${encodeURIComponent(directoryId)}?revision=${encodeURIComponent(revision)}`, 'DELETE'),
  uploadCodeRepositoryFiles: (repoId: string, input: { overwrite: boolean; directoryId?: string; uploadType?: 'files' | 'folder'; files: { name: string; data: string; relativePath?: string }[] }) =>
    request<CodeRepositoryUploadResult>(`/settings/code-repos/${encodeURIComponent(repoId)}/files`, 'POST', input),
  codeRepositoryFiles: (repoId: string, keyword = '', page = 1, directoryId?: string, folder?: string) =>
    request<CodeRepositoryFilePage>(`/settings/code-repos/${encodeURIComponent(repoId)}/files?keyword=${encodeURIComponent(keyword)}&page=${page}${directoryId ? '&directoryId=' + encodeURIComponent(directoryId) : ''}${folder !== undefined ? '&view=directory&folder=' + encodeURIComponent(folder) : ''}`),
  codeRepositoryFileContent: (repoId: string, path: string) =>
    request<CodeRepositoryFileContent>(`/settings/code-repos/${encodeURIComponent(repoId)}/files/content?path=${encodeURIComponent(path)}`),
  codeRepositoryFileReferences: (repoId: string, path: string) => request<RepositoryFileReferences>(`/settings/code-repos/${encodeURIComponent(repoId)}/files/references?path=${encodeURIComponent(path)}`),
  codeRepositoryFileMetadata: (repoId: string, path: string, commit?: string) =>
    request<CodeRepositoryFileMetadata>(`/settings/code-repos/${encodeURIComponent(repoId)}/files/metadata?path=${encodeURIComponent(path)}${commit ? '&commit=' + encodeURIComponent(commit) : ''}`),
  deleteCodeRepositoryFile: (repoId: string, path: string) =>
    request<{ repoId: string; path: string; gitCommit: string; pushed: boolean }>(`/settings/code-repos/${encodeURIComponent(repoId)}/files?path=${encodeURIComponent(path)}`, 'DELETE'),
  codeRepoRules: () => list<CodeRepoRule>('/settings/code-repo-rules'),
  saveCodeRepoRules: (rules: CodeRepoRule[]) => request<CodeRepoRule[]>('/settings/code-repo-rules', 'POST', { rules }),
  instances: () => list<RunnerInstance>('/runners'),
  enrollmentCode: () => request<EnrollmentCode>('/runners/enrollment-codes', 'POST', {}),
  assignments: () => list<QueueAssignment>('/assignments'),
  createAssignment: (input: NodeCodeAssignmentInput | Omit<QueueAssignment, 'assignmentId'>) => request<QueueAssignment>('/assignments', 'POST', input),
  removeAssignment: (assignmentId: string) => request<void>(`/assignments/${encodeURIComponent(assignmentId)}`, 'DELETE'),
  releases: () => list<ArtifactRelease>('/releases'),
  publishProcessor: (processorType: 'probe' | 'newslink_nourl') => request<{ digest: string }>('/releases/processors', 'POST', { processorType }),
  publishRunner: () => request<{ digest: string; created: boolean }>('/releases/runners', 'POST', {}),
  runnerPackageInfo: () => request<RunnerPackageInfo>('/runner-package'),
  downloadRunnerPackage: async (input: { server: string; digest: string }) => {
    const token = readStoredToken()
    let response: Response
    try {
      response = await fetch('/api/runner-management/runner-package', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { [ACCESS_TOKEN_HEADER]: token } : {}) }, body: JSON.stringify(input)
      })
    } catch { throw new Error('Runner 管理服务不可达') }
    await checkBusinessSession(response)
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null
      throw new Error(error?.message || `Runner 包下载失败（HTTP ${response.status}）`)
    }
    if (!response.headers.get('Content-Type')?.includes('application/zip')) throw new Error('Runner 包格式不正确，请重试')
    const name = response.headers.get('Content-Disposition')?.match(/filename="(Runner-[A-Za-z0-9-]+\.zip)"/)?.[1] || 'Runner-windows-x64.zip'
    return { name, blob: await response.blob() }
  },
  setDesiredRunner: (runnerId: string, digest: string) => request<{ runnerId: string; digest: string }>(`/runners/${encodeURIComponent(runnerId)}/desired-runner`, 'POST', { digest }),
  scriptBinding: (configId: string) => request<ScriptBinding | null>(`/configs/${encodeURIComponent(configId)}/script-release`),
  publishScript: (input: { configId: string; fileName: string; code: string; prompt: string; systemPrompt?: string; userPrompt?: string; promptTemplateId?: number; url: string; queueName?: string; fileNameMode?: 'website' | 'queue'; codeId?: string; codeType?: 'site' | 'default'; siteHost?: string; configType?: string; repositoryId?: string; directoryId?: string; sourceFilePath?: string; sourceGitCommit?: string; includeConfigId?: boolean }) => request<PublishedScript>('/site-scripts/publish', 'POST', input),
  adoptScript: (configId: string, scriptDigest: string) => request<ScriptBinding>(`/configs/${encodeURIComponent(configId)}/script-release`, 'POST', { scriptDigest }),
  siteCodeVersions: (configId: string, queueName: string) => list<SiteCodeVersion>(`/site-scripts/versions?configId=${encodeURIComponent(configId)}&queueName=${encodeURIComponent(queueName)}`),
  siteCodeCatalog: () => list<SiteCodeVersion & { environments: ('test' | 'prd')[] }>('/site-scripts/catalog'),
  siteCodeContent: (digest: string) => request<SiteCodeVersion & { code: string }>(`/site-scripts/code?digest=${encodeURIComponent(digest)}`),
  previewScriptFile: (digest: string, target: 'saved' | 'source') => request<{ repoId: string; path: string; gitCommit: string; content: string; size: number }>(`/site-scripts/file-association/preview?digest=${encodeURIComponent(digest)}&target=${target}`),
  changeScriptFileAssociation: (input: { digest: string; configId: string; queueName: string; target: 'saved' | 'source'; action: 'unlink' | 'delete' }) => request<{ ok: true; message: string }>('/site-scripts/file-association', 'POST', input),
  siteCodeBindings: (configId: string, queueName: string, environment: 'test' | 'prd') => list<SiteCodeVersion>(`/site-scripts/bindings?configId=${encodeURIComponent(configId)}&queueName=${encodeURIComponent(queueName)}&environment=${environment}`),
  bindSiteCode: (input: { configId: string; queueName: string; environment: 'test' | 'prd'; scriptDigest: string }) => request<SiteCodeVersion>('/site-scripts/bind', 'POST', input),
}
