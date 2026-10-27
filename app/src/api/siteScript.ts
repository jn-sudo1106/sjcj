export const DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT = '你是 Python 网站采集脚本开发者。参考给定样例的接口和代码风格，为目标列表页编写完整、可独立保存的 Python 代码。只返回代码，不要 Markdown 围栏或解释。必须提供 scrape(url) 函数并返回 list[dict]；每条尽量包含 title/date/url/summary/content。不要生成 MQ、数据库、文件上传或流程调度代码。导入模块时不能发起网站请求。不要照搬样例站点的域名、页面选择器和专用解析逻辑。'

export interface SiteScriptGenerateInput {
  configId?: string; configType?: string; queueName?: string; repositoryId?: string; directoryId?: string; autoCommit?: boolean; fileName?: string; deferCommit?: boolean
  taskId?: string
  workspaceMode?: 'config' | 'queue' | 'custom'
  workspacePath?: string
  interfaceId?: string
  prompt: string
  systemPrompt?: string
  userPrompt?: string
  url: string
  sampleId: 'www.realcan.cn.py'
}

export interface SiteScriptGenerateResult {
  archive?: import('./runnerManagement').GeneratedCodeArchive
  previewPath?: string
  fileName: string
  code: string
  warnings: string[]
}

/** 独立站点脚本服务只生成代码文本，不调用旧 XML 配置/规则脚本保存接口。 */
export async function generateSiteScript(input: SiteScriptGenerateInput, signal?: AbortSignal): Promise<SiteScriptGenerateResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const response = await fetch(input.interfaceId ? '/api/runner-management/model-interfaces/generate' : '/api/ai/site-script/generate', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(input),
    signal,
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(String(payload.message || `代码生成失败（HTTP ${response.status}）`))
  }
  const archive = payload.archive as import('./runnerManagement').GeneratedCodeArchive | undefined
  if (archive !== undefined && (!archive || typeof archive !== 'object' || typeof archive.archiveId !== 'string'
    || !/^[a-f0-9]{32}$/.test(archive.archiveId) || !['pending', 'failed', 'committed'].includes(archive.status) || !Array.isArray(archive.files))) {
    throw new Error('代码归档服务返回的数据无效')
  }
  if (typeof payload.code !== 'string' || (!payload.code.trim() && !archive) || typeof payload.fileName !== 'string' || !/^[a-z0-9_.-]+\.py$/i.test(payload.fileName)) {
    throw new Error('代码生成服务返回的数据无效')
  }
  return {
    fileName: payload.fileName,
    code: payload.code,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
    ...(archive ? { archive, previewPath: String(payload.previewPath || '') } : {}),
  }
}
import { ACCESS_TOKEN_HEADER, readStoredToken } from './auth'
