// 监控 AI 脚本：智能体生成 + 提交 Git（1117 前端修改清单第 2 批）。
//
// 复用网页抓取「智能体配置」用的同一组 Runner 接口（智能体接口、代码仓库 / 目录、代码生成任务），
// 但不复用那个 1100+ 行的弹窗：监控只需要「智能体 + 仓库 + 目录」，文件名与子目录是固定规则
// `<仓库目录>/<sourceId>/<监控ID>.py`（目录取所选的数据监控目录，2806 上是 dataMonitor），没有网站命名、代理、发布到文件服务这些概念。
//
// ⚠️ 生成任务依赖后端「监控上下文」（契约 7）以及按节点类型区分的代码校验（现在一律要求 scrape(url)）。
// 后端未支持前，生成会被后端拒绝；编辑器把后端原因原样显示，并保留「内置接口」作为默认生成方式。
import { generateSiteScript, type SiteScriptGenerationEvent } from '@/api/siteScript'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type GeneratedCodeArchive, type ModelInterface } from '@/api/runnerManagement'
import { allAgentsOption, isAgentInterface } from '@/utils/agentPool'
import { cleanMonitorPython } from './generation'
import { MONITOR_SOURCE_TYPE } from './promptTemplate'

export interface AgentGenerationOptions {
  agents: ModelInterface[]
  repos: CodeRepository[]
  agentError: string
  repoError: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 只给能做代码生成的智能体（agent / gemini-agent）且启用的；首项是「全选 · 任意空闲智能体」 */
export async function loadAgentGenerationOptions(): Promise<AgentGenerationOptions> {
  const [agents, repos] = await Promise.allSettled([runnerManagementApi.modelInterfaces(), runnerManagementApi.codeRepositories()])
  const agentRows = agents.status === 'fulfilled' ? (agents.value.items ?? []).filter((item) => item.enabled && isAgentInterface(item)) : []
  return {
    agents: agentRows.length ? [allAgentsOption, ...agentRows] : [],
    // 通用仓库或数据监控类型仓库；停用的不给选
    repos: repos.status === 'fulfilled'
      ? repos.value.filter((repo) => repo.status === 'ACTIVE' && (!repo.configType || repo.configType === MONITOR_SOURCE_TYPE))
      : [],
    agentError: agents.status === 'rejected' ? errorText(agents.reason) : '',
    repoError: repos.status === 'rejected' ? errorText(repos.reason) : '',
  }
}

/** 默认仓库：优先数据监控类型仓库，其次默认仓库，再其次第一个 */
export function defaultMonitorRepo(repos: CodeRepository[]): string {
  return (repos.find((repo) => repo.configType === MONITOR_SOURCE_TYPE) ?? repos.find((repo) => repo.isDefault) ?? repos[0])?.repoId ?? ''
}

/** 仓库里可用于数据监控的目录：启用的、类型为 610 的目录（会上建的 `monitor`）；没有就退到通用目录 */
export async function loadMonitorDirectories(repoId: string): Promise<CodeRepositoryDirectory[]> {
  const rows = (await runnerManagementApi.codeRepositoryDirectories(repoId)).filter((row) => row.status === 'ACTIVE')
  const typed = rows.filter((row) => row.configType === MONITOR_SOURCE_TYPE)
  return typed.length ? typed : rows.filter((row) => !row.configType)
}

/** 默认目录：数据监控类型的「生成默认目录」优先 */
export function defaultMonitorDirectory(rows: CodeRepositoryDirectory[]): string {
  const marked = rows as Array<CodeRepositoryDirectory & { generationDefault?: boolean }>
  return (marked.find((row) => row.generationDefault) ?? rows[0])?.directoryId ?? ''
}

/** 仓库内路径：所选目录 + 源 ID + 监控 ID；任一缺失返回空串（界面提示缺什么，不拼半截路径） */
export function monitorScriptPath(directoryPath: string, sourceId: string, monitorId: string): string {
  const dir = directoryPath.trim().replace(/^\/+|\/+$/g, '')
  return dir && sourceId && monitorId ? `${dir}/${sourceId}/${monitorId}.py` : ''
}

export interface AgentGenerateInput {
  sourceId: string
  monitorId: string
  sourceName?: string
  monitorName?: string
  interfaceId: string
  repoId: string
  directoryId: string
  /** 所选目录在仓库里的路径，归档回执没带文件路径时用它拼预期路径 */
  directoryPath?: string
  systemPrompt: string
  userPrompt: string
  onEvent?: (event: SiteScriptGenerationEvent) => void
  signal?: AbortSignal
}

export interface AgentGenerateResult {
  script: string
  scriptPath: string
  archive: GeneratedCodeArchive | null
}

export async function generateMonitorScriptWithAgent(input: AgentGenerateInput): Promise<AgentGenerateResult> {
  const result = await generateSiteScript({
    monitorContext: { sourceId: input.sourceId, monitorId: input.monitorId, sourceName: input.sourceName, monitorName: input.monitorName },
    configType: MONITOR_SOURCE_TYPE,
    interfaceId: input.interfaceId,
    repositoryId: input.repoId,
    directoryId: input.directoryId,
    destinationMode: 'custom',
    autoCommit: true,
    // 文件名与子目录是固定规则，由前端显式给出；后端按契约也应按这条规则落盘
    fileName: `${input.monitorId}.py`,
    outputSubdirectory: input.sourceId,
    prompt: input.userPrompt,
    userPrompt: input.userPrompt,
    systemPrompt: input.systemPrompt,
    // 监控没有站点 URL；字段为接口必填，留空（后端需按 610 放开 URL 校验）
    url: '',
    sampleId: 'www.realcan.cn.py',
  }, input.signal, input.onEvent)
  const archive = result.archive ?? null
  const script = cleanMonitorPython(result.code)
  const filePath = archive?.files?.[0]?.path || monitorScriptPath(input.directoryPath ?? '', input.sourceId, input.monitorId)
  return { script, scriptPath: filePath, archive }
}

/** 归档状态一句话：已提交并推送 / 仅本地提交 / 待提交 / 提交失败 */
export function archiveStatusText(archive: GeneratedCodeArchive | null): string {
  if (!archive) return ''
  const commit = archive.gitCommit ? archive.gitCommit.slice(0, 8) : ''
  if (archive.status === 'failed') return `提交失败${archive.message ? `：${archive.message}` : ''}`
  if (archive.status === 'pending') return '已生成，待提交 Git'
  return [commit && `commit ${commit}`, archive.pushed ? '已推送到远程' : '仅本地提交（仓库未配置远程）'].filter(Boolean).join(' · ')
}
