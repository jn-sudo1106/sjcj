import { entryApi, ruleApi } from '@/api'
import { ACCESS_TOKEN_HEADER, readStoredToken } from '@/api/auth'
import type { EntryType } from '@/api/types/collect'
import { buildDataProcessGeneratePayload } from '@/utils/flow/dataProcess'
import { cleanGeneratedPython } from '@/utils/flow/generatedScript'

/**
 * 生成脚本的输入上下文（2026-11-13 按「源级结果检查 / 节点环节检查」修订）。
 *
 * 这里只服务**源结果检查**：检查哪张表由本条检查自己选定，与源有没有流程、流程里有没有
 * 数据监控节点无关。节点环节检查是另一类检查对象（读节点的上游输入），不能因为同源就
 * 复用本条的范围，也不能被这里的解析「顺手认领」。
 *
 * configId 固定 0 是旧生成协议的兼容值（data-engine 不校验它是否存在，186/2806 实测可生成），
 * 不代表已绑定画布节点，也不能当作「独立生成接口已交付」的证据。
 */
export interface GenerationContext {
  /** 旧协议兼容值：源结果检查固定 0 */
  configId: number
  /** 本条检查实际读取的表（物理名） */
  sourceTable: string
  targetTable: string
  inputFields: string[]
  outputFields: string[]
  inputFieldOptions: Array<{ itemCode: string; itemName: string }>
  outputFieldOptions: Array<{ itemCode: string; itemName: string }>
}

/** 表单侧提供的数据范围：本条检查选定的表 */
export interface GenerationFallback {
  /** 「库.表」物理名；表单里也可能直接存物理名 */
  tableName?: string
  /** 表 ID（cfg_entry_type.ID），用来取字段清单；缺失时无法给出字段 */
  tableId?: string
}

export class MonitorGenerationContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonitorGenerationContextError'
  }
}

function fieldOptionsOf(entry: EntryType | null): Array<{ itemCode: string; itemName: string }> {
  if (!entry || !Array.isArray(entry.fields)) return []
  return entry.fields
    .filter((field) => !!field.prop)
    .map((field) => ({ itemCode: field.prop, itemName: field.desc || field.columnName || field.prop }))
}

function physicalName(table: string): string {
  const text = (table ?? '').trim()
  // 关联表既能存 tableId 也能存「库.表」物理名；只有后者能直接交给生成接口
  return text.includes('.') ? text : ''
}

async function entryOf(tableId: string | undefined): Promise<EntryType | null> {
  const id = (tableId ?? '').trim()
  if (!id) return null
  return (await entryApi.entryDetail(id).catch(() => null)) as EntryType | null
}

/**
 * 按表 ID 取字段清单；拿不到时用「库.表」物理名精确找一次。
 * 表单里的主表可能只存了物理名（历史记录回填），没有 tableId。
 */
async function entryWithFields(tableId: string | undefined, tableName: string): Promise<EntryType | null> {
  const direct = await entryOf(tableId)
  if (direct?.fields?.length) return direct
  const name = (tableName ?? '').trim()
  if (!name || !name.includes('.')) return direct
  const found = await entryApi.searchTables(name, 20).catch(() => [] as EntryType[])
  const exact = found.find((table) => table.tableName === name)
  if (!exact) return direct
  if (exact.fields?.length) return exact
  return (await entryOf(exact.tableId)) ?? exact
}

/** 执行器接口的请求头：本系统登录是 token 制（Access-Token 头），只带 Cookie 会在会话过期后 401。 */
function runnerHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const token = readStoredToken()
    if (token) headers[ACCESS_TOKEN_HEADER] = token
  } catch {
    // 非浏览器环境（单元测试）没有 localStorage：请求头退化为只带 Content-Type
  }
  return headers
}

/**
 * 从脚本执行器所在环境读取主表物理字段。接口缺失或读取失败时明确报错，
 * 不用登记字段冒充物理列；登记字段可能是 K1 等存储列对应的业务别名。
 */
export async function resolveMonitorTableFields(fallback?: GenerationFallback): Promise<string[]> {
  const response = await fetch('/api/runner-management/monitor-runner/table-fields', {
    method: 'POST', credentials: 'include', headers: runnerHeaders(),
    body: JSON.stringify({ tableName: fallback?.tableName ?? '' }),
  })
  const payload = await response.json().catch(() => null)
  if (response.status === 401) throw new Error('登录状态已过期，请重新登录后再试（执行器字段查询被拒）')
  if (!response.ok) throw new Error(payload?.error || '读取实际表结构失败，请确认当前环境已部署字段查询接口')
  if (!Array.isArray(payload?.fields) || !payload.fields.length) throw new Error('实际表字段清单为空')
  return payload.fields
}

/** 提示词里最多列多少个真实字段（够模型写脚本，又不至于把上下文撑爆） */
export const MAX_PROMPT_COLUMNS = 40

/**
 * 生成脚本用的系统提示词：追加主表真实字段清单与入库时间列。
 *
 * 实测跑失败的原因之一是模型自己发明列名（表里没有 inst_time 却写 inst_time），
 * 所以把主表真实列（前 40 个）明确写进提示词；拿不到字段清单就跳过这段，不编造。
 * 共享层的 defaultSystemPrompt() 不动，只在调用点做拼接。
 */
export function augmentMonitorSystemPrompt(
  basePrompt: string,
  fields: readonly string[] = [],
  timeColumn = '',
): string {
  const columns = [...new Set(fields.map((field) => (field || '').trim()).filter(Boolean))].slice(0, MAX_PROMPT_COLUMNS)
  const extras: string[] = []
  extras.push('执行参数契约：数据库连接只读取 DQ_DB_HOST、DQ_DB_PORT、DQ_DB_USER、DQ_DB_PASSWORD、DQ_DB_NAME 环境变量；不得写死连接地址或凭据。表名读取 DQ_TABLE_NAME，入库时间字段读取 DQ_TIME_COLUMN，源 ID 读取 DQ_SOURCE_ID（物理表有 SOURCE_ID 时必须参数化过滤当前源），检查窗口读取 DQ_START_DATE / DQ_END_DATE；不得把表名、时间字段或窗口写死在 SQL。环境变量缺失时返回 status=ERROR 和 reason，不使用猜测的默认字段。动态标识符必须校验并使用反引号引用；所有 SELECT 列别名同样必须反引号包裹，不得使用 delayed、status、key、rank、groups、window、system 等保留字。兼容执行器传入的 --format json、--table、--time-column 参数。')
  if (columns.length) extras.push(`该表真实字段：${columns.join(', ')}（只能用这些列名，不要臆造）`)
  const column = (timeColumn || '').trim()
  if (column) extras.push(`按 ${column} 统计入库时间`)
  const prompt = (basePrompt || '').trim()
  return prompt ? `${prompt}\n\n${extras.join('\n')}` : extras.join('\n')
}

/**
 * 源结果检查的生成上下文：只用本条检查选定的表。
 *
 * 不读源流程、不找监控节点（2026-11-13 修订 §4.1）。旧实现在这里扫流程、取「第一个
 * 数据监控节点」的输入表，结果是：用户选了最终表，生成却读中间节点的表；节点在分支上
 * 或节点没保存时又退回主表，并误报「没有绑定流程」。两类检查分开后，这段依赖不再需要。
 */
export async function resolveSourceResultContext(fallback?: GenerationFallback): Promise<GenerationContext> {
  const tableName = (fallback?.tableName ?? '').trim()
  const entry = await entryWithFields(fallback?.tableId, tableName)
  const sourceTable = physicalName(tableName) || (entry?.tableName ?? '')
  if (!sourceTable) {
    throw new MonitorGenerationContextError('请先选择要检查的表，再生成脚本；源结果检查只读本条检查选定的表')
  }
  const inputFieldOptions = fieldOptionsOf(entry)
  if (!inputFieldOptions.length) {
    throw new MonitorGenerationContextError(`无法读取表 ${sourceTable} 的字段清单：请先确认该表已登记字段后重新生成`)
  }
  return {
    configId: 0,
    sourceTable,
    targetTable: sourceTable,
    inputFields: [],
    outputFields: [],
    inputFieldOptions,
    outputFieldOptions: inputFieldOptions,
  }
}

export interface GenerateScriptInput {
  context: GenerationContext
  description: string
  methods: string[]
  systemPrompt: string
  providerCode: string
  modelCode: string
  /** 流式正文回调，参数是「到目前为止的完整正文」，供页面实时展示 */
  onContent?: (scriptSoFar: string) => void
  onThinking?: (text: string) => void
}

export interface GenerateScriptResult {
  script: string
  scriptPath: string
  message: string
}

const SCRIPT_PATH_PATTERN = /保存到\s*([^\s]+)/

export function extractScriptPathFromMessage(message: string): string {
  const matched = SCRIPT_PATH_PATTERN.exec(message ?? '')
  return matched ? matched[1].trim() : ''
}

/**
 * 生成候选脚本：只返回正文与落盘路径，不写任何监控记录（不自动保存）。
 * 失败由调用方还原之前的正文，避免模型/网络问题把页面上的旧脚本清空。
 */
export async function generateMonitorScript(input: GenerateScriptInput): Promise<GenerateScriptResult> {
  const payload = buildDataProcessGeneratePayload({
    // 占位符/「业务约定」这类空话会让模型只给说明和片段，发出前先清掉
    description: stripDescriptionPlaceholders(input.description),
    configId: input.context.configId,
    providerCode: input.providerCode,
    model: input.modelCode,
    sourceTable: input.context.sourceTable,
    targetTable: input.context.targetTable,
    inputFields: input.context.inputFields,
    outputFields: input.context.outputFields,
    inputFieldOptions: input.context.inputFieldOptions,
    outputFieldOptions: input.context.outputFieldOptions,
    systemPrompt: input.systemPrompt,
    checkRule: input.methods.length ? input.methods.join(',') : undefined,
  })

  let streamed = ''
  let donePayload: { message?: string; scriptPath?: string; script?: string } | null = null
  const result = await ruleApi.dataProcessGenerate(payload, {
    onContent: (delta) => {
      streamed += delta
      input.onContent?.(streamed)
    },
    onThinking: (delta) => input.onThinking?.(delta),
    onDone: (payloadDone) => {
      donePayload = payloadDone
    },
  })

  const done = donePayload as { message?: string; scriptPath?: string; script?: string } | null
  const originalPath = (result?.scriptPath || done?.scriptPath || extractScriptPathFromMessage(done?.message ?? '')).trim()
  if (!originalPath || !originalPath.endsWith('.py')) throw new Error('生成结果缺少有效的 Python 文件路径')
  const raw = (result?.script || done?.script || streamed || '').trim() || await ruleApi.fileDownloadScript(originalPath)
  const script = cleanMonitorPython(raw)
  // Generation services may persist the whole model reply. Keep that original
  // artifact and publish a separate code-only candidate before exposing its path.
  const scriptPath = originalPath.replace(/\.py$/, '.monitor.py')
  await ruleApi.fileUploadScript(scriptPath, script)
  if ((await ruleApi.fileDownloadScript(scriptPath)).trim() !== script) throw new Error('脚本保存后回读不一致，未启用候选脚本')
  return { script, scriptPath, message: done?.message ?? '' }
}

/**
 * 模型回复里可能夹着说明文字、多个围栏、甚至只有片段。
 * 清理口径与规则处理节点共用，实现在 utils/flow/generatedScript.ts。
 */
export const cleanMonitorPython = cleanGeneratedPython

/**
 * 业务描述里的【】占位符会让模型改写成「说明 + 片段」而不是完整脚本。
 * 已有记录里的旧描述可能还带占位符，这里统一去掉括号并替换空话。
 */
export function stripDescriptionPlaceholders(text: string): string {
  return (text || '')
    .replace(/【([^】]{0,60})】/g, '$1')
    .replace(/业务约定/g, '常规业务标准')
    .replace(/空值政策/g, '既定空值口径')
    .replace(/生效起点/g, '监控生效时间')
    .trim()
}

export interface MonitorTestOutcome {
  ok: boolean
  summary: string
  raw: unknown
}

function truncate(text: string, max = 240): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned
}

/** 把脚本执行回执压成一句人话；不猜成功与否（没有 ok 字段就不盖章） */
export function summarizeExecutionResult(raw: unknown): string {
  if (raw === null || raw === undefined) return '执行完成，未返回结构化结果'
  if (typeof raw === 'string') return truncate(raw) || '执行完成，未返回结构化结果'
  if (typeof raw === 'boolean') return raw ? '执行完成（返回 true）' : '执行完成（返回 false）'
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    const parts: string[] = []
    const success = record.success ?? record.ok
    if (typeof success === 'boolean') parts.push(success ? '执行成功' : '执行失败')
    const message = record.message ?? record.msg ?? record.lastMsg
    if (typeof message === 'string' && message.trim()) parts.push(truncate(message))
    const rows = record.rows ?? record.data ?? record.result
    if (Array.isArray(rows)) parts.push(`返回 ${rows.length} 条`)
    if (!parts.length) parts.push(truncate(JSON.stringify(raw)))
    return parts.join('；')
  }
  return truncate(String(raw))
}

/** 试跑候选脚本用的入参（编辑器「测试脚本」）。 */
export interface MonitorScriptTestInput {
  script: string
  sourceId?: string
  tableName?: string
  timeColumn?: string
  window?: Record<string, unknown>
}

/**
 * 用数据监控执行器试跑脚本（186 等没有 vrule 执行器的环境）。
 * 返回 null 表示执行器端点不存在（404/501），调用方应回退到旧执行端点。
 */
export async function testMonitorScriptWithRunner(
  input: MonitorScriptTestInput,
): Promise<MonitorTestOutcome | null> {
  const script = (input.script ?? '').trim()
  if (!script) throw new Error('还没有脚本正文：先生成脚本再测试')
  let response: Response
  try {
    response = await fetch('/api/runner-management/monitor-runner/test-script', {
      method: 'POST',
      credentials: 'include',
      headers: runnerHeaders(),
      body: JSON.stringify({
        script,
        sourceId: input.sourceId ?? '',
        tableName: input.tableName ?? '',
        timeColumn: input.timeColumn ?? '',
        window: input.window ?? { type: 'today' },
      }),
    })
  } catch {
    throw new Error('执行器不可达：请确认 monitor-runner 服务已启动')
  }
  if (response.status === 404 || response.status === 501) return null
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String(payload.error)
      : `执行器请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  const ok = payload?.success === true
  const parts: string[] = []
  parts.push(ok ? '执行成功' : '执行失败')
  const status = typeof payload?.status === 'string' ? payload.status : ''
  if (status) parts.push(status === 'ABNORMAL' ? '数据异常' : status === 'NORMAL' ? '数据正常' : status === 'NO_DATA' ? '无待检数据' : status)
  if (typeof payload?.checkedCount === 'number') parts.push(`检查 ${payload.checkedCount} 条`)
  if (typeof payload?.abnormalCount === 'number') parts.push(`异常 ${payload.abnormalCount} 条`)
  const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : ''
  if (reason) parts.push(truncate(reason))
  if (typeof payload?.durationMs === 'number') parts.push(`${payload.durationMs}ms`)
  return { ok, summary: parts.join('；'), raw: payload }
}

/**
 * 测试候选/生效脚本：走脚本执行端点（ruleApi.executeCode），不是旧规则 check-one。
 * 只回显执行回执，不写正式最近结果、不改启停、不计入调度覆盖。
 */
export async function testMonitorScript(scriptPath: string, timeout = 60): Promise<MonitorTestOutcome> {
  const path = (scriptPath ?? '').trim()
  if (!path) throw new Error('缺少脚本文件路径：无法执行测试')
  const raw = await ruleApi.executeCode({ codePath: path, timeout })
  if (raw === null || typeof raw !== 'object') throw new Error('执行器未返回可确认的执行回执')
  const receipt = raw as Record<string, unknown>
  if (receipt.success !== true && receipt.ok !== true) throw new Error(summarizeExecutionResult(raw))
  if (receipt.success === false || receipt.ok === false) throw new Error(summarizeExecutionResult(raw))
  return { ok: true, summary: summarizeExecutionResult(raw), raw }
}
