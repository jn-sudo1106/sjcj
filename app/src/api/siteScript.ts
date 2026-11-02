export const DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT = '你是 Python 网站采集脚本开发者。参考给定样例的接口和代码风格，为目标列表页编写完整、可独立保存的 Python 代码。只返回代码，不要 Markdown 围栏或解释。必须提供 scrape(url) 函数并返回 list[dict]；每条尽量包含 title/date/url/summary/content。不要生成 MQ、数据库、文件上传或流程调度代码。导入模块时不能发起网站请求。不要照搬样例站点的域名、页面选择器和专用解析逻辑。'

export interface SiteScriptGenerateInput {
  taskContext?: { sourceId: string; flowId: string; stepId: string }
  /** 兼容旧调用参数；实际创建数据库任务，不再发送 MQ。 */
  mqContext?: { sourceId: string; flowId: string; stepId: string; dispatchConfigId?: string }
  configId?: string; configType?: string; queueName?: string; repositoryId?: string; directoryId?: string; autoCommit?: boolean; fileName?: string; deferCommit?: boolean
  taskId?: string
  workspaceMode?: 'config-queue' | 'config' | 'queue' | 'custom'
  workspacePath?: string
  codeDirectory?: string
  destinationMode?: 'type' | 'custom'
  interfaceId?: string
  modelCall?: import('./runnerManagement').GenerationModelCall
  prompt: string
  systemPrompt?: string
  userPrompt?: string
  url: string
  sampleId: 'www.realcan.cn.py'
}

export interface SiteScriptGenerateResult {
  workspace?: { codeDir?: string; prjDir?: string }
  archive?: import('./runnerManagement').GeneratedCodeArchive
  previewPath?: string
  fileName: string
  code: string
  warnings: string[]
}

export interface SiteScriptModelRequest { method: string; url: string; headers: Record<string, string>; body: unknown }
export type SiteScriptGenerationEvent = { type: 'progress'; message: string } | { type: 'chunk'; text: string } | { type: 'request'; request: SiteScriptModelRequest } | { type: 'task'; taskId: string; queue: string; status: 'waiting' | 'running' | 'succeeded' | 'failed' }

/** 独立站点脚本服务只生成代码文本，不调用旧 XML 配置/规则脚本保存接口。 */
export async function generateSiteScript(input: SiteScriptGenerateInput, signal?: AbortSignal, onEvent?: (event: SiteScriptGenerationEvent) => void): Promise<SiteScriptGenerateResult> {
  if (input.taskContext || input.mqContext) return generateThroughTask(input, signal, onEvent)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const response = await fetch(input.interfaceId ? '/api/runner-management/model-interfaces/generate' : '/api/ai/site-script/generate', {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(onEvent && input.interfaceId ? { ...input, responseStream: true } : input),
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    throw new Error(String(payload.message || `代码生成失败（HTTP ${response.status}）`))
  }
  let payload: Record<string, unknown>
  if (response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    if (!response.body) throw new Error('浏览器未提供流式响应')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let pending = '', result: Record<string, unknown> | undefined
    const consume = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as Record<string, unknown>
      if (event.type === 'error') throw new Error(String(event.message || '代码生成失败'))
      if (event.type === 'progress' && typeof event.message === 'string') onEvent?.({ type: 'progress', message: event.message })
      if (event.type === 'chunk' && typeof event.text === 'string') onEvent?.({ type: 'chunk', text: event.text })
      if (event.type === 'request' && event.request && typeof event.request === 'object') {
        const request = event.request as SiteScriptModelRequest
        if (typeof request.method !== 'string' || typeof request.url !== 'string' || !request.headers || typeof request.headers !== 'object') throw new Error('生成服务返回的请求详情无效')
        onEvent?.({ type: 'request', request })
      }
      if (event.type === 'result' && event.result && typeof event.result === 'object') result = event.result as Record<string, unknown>
    }
    try {
      while (true) {
        const { value, done } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          consume(pending.slice(0, newline)); pending = pending.slice(newline + 1)
        }
        if (done) break
      }
      if (pending.trim()) consume(pending)
      if (!result) throw new Error('生成响应中断，已收到的过程输出保留')
      payload = result
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  } else payload = await response.json().catch(() => ({})) as Record<string, unknown>
  return validateGenerationResult(payload)
}

function validateGenerationResult(payload: Record<string, unknown>): SiteScriptGenerateResult {
  if (!payload || typeof payload !== 'object') throw new Error('代码生成服务返回的数据无效')
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

export async function submitSiteScriptTask(input: SiteScriptGenerateInput, signal?: AbortSignal): Promise<{ taskId: string; queue: string }> {
  signal?.throwIfAborted()
  const { runnerManagementApi } = await import('./runnerManagement')
  const context=input.taskContext || input.mqContext
  if (!context || !input.configId || ![context.sourceId,context.flowId,context.stepId,input.configId].every(value => /^[1-9]\d*$/.test(value))) throw new Error('请先保存源、流程、步骤和配置，再提交代码生成任务')
  const snapshot={...input};delete snapshot.mqContext;delete snapshot.taskContext
  signal?.throwIfAborted()
  const receipt=await runnerManagementApi.createCodeGenerationTask({...context,configId:input.configId,generation:snapshot})
  return { taskId: receipt.job.taskId, queue: '' }
}

async function generateThroughTask(input: SiteScriptGenerateInput, signal?: AbortSignal, onEvent?: (event: SiteScriptGenerationEvent) => void): Promise<SiteScriptGenerateResult> {
  const receipt = await submitSiteScriptTask(input, signal)
  const taskId=receipt.taskId;onEvent?.({type:'progress',message:`任务已保存到数据库，等待服务领取；任务 ${taskId}`})
  onEvent?.({type:'task',taskId,queue:receipt.queue,status:'waiting'})
  const headers:Record<string,string>={Accept:'application/json'}
  const token=readStoredToken();if(token) headers[ACCESS_TOKEN_HEADER]=token
  let output='',stages=0,requestSeen=false
  let taskStatus = 'waiting'
  const until=Date.now()+3600000
  while(Date.now()<until) {
    signal?.throwIfAborted()
    const response=await fetch('/api/runner-management/code-generation/tasks/detail?taskId='+encodeURIComponent(taskId),{credentials:'include',headers,signal})
    const data=await response.json()
    if(!response.ok)throw new Error(data.message || '代码生成任务状态查询失败')
    const job=data.job
    if(job) {
      const status = ['running','succeeded','failed'].includes(job.status) ? job.status : 'waiting'
      if (status !== taskStatus) { onEvent?.({type:'task',taskId,queue:receipt.queue,status}); taskStatus = status }
      if(job.request && !requestSeen){onEvent?.({type:'request',request:job.request});requestSeen=true}
      for(const message of (job.stages || []).slice(stages))onEvent?.({type:'progress',message})
      stages=(job.stages || []).length
      if(typeof job.output==='string' && job.output!==output) {
        onEvent?.({type:'chunk',text:job.output.startsWith(output)?job.output.slice(output.length):'\n[较早输出已截断]\n'+job.output});output=job.output
      }
      if(job.status==='failed')throw new Error(job.message || '代码生成失败')
      if(job.status==='succeeded')return validateGenerationResult(job.result)
    }
    await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason || new DOMException('已取消','AbortError'))}
      const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},1000)
      signal?.addEventListener('abort',abort,{once:true})
      if(signal?.aborted)abort()
    })
  }
  throw new Error(`等待代码生成结果超时，任务 ${taskId} 仍可在任务中心查看`)
}
import { ACCESS_TOKEN_HEADER, readStoredToken } from './auth'
