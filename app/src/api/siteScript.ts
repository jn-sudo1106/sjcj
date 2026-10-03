export interface SiteScriptGenerateInput {
  prompt: string
  url: string
  sampleId: 'www.realcan.cn.py'
}

export interface SiteScriptGenerateResult {
  fileName: string
  code: string
  warnings: string[]
}

/** 独立站点脚本服务只生成代码文本，不调用旧 XML 配置/规则脚本保存接口。 */
export async function generateSiteScript(input: SiteScriptGenerateInput, signal?: AbortSignal): Promise<SiteScriptGenerateResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const response = await fetch('/api/ai/site-script/generate', {
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
  if (typeof payload.code !== 'string' || !payload.code.trim() || typeof payload.fileName !== 'string' || !/^[a-z0-9.-]+\.py$/i.test(payload.fileName)) {
    throw new Error('代码生成服务返回的数据无效')
  }
  return {
    fileName: payload.fileName,
    code: payload.code,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
  }
}
import { ACCESS_TOKEN_HEADER, readStoredToken } from './auth'
