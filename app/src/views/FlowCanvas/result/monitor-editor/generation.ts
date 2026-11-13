import { entryApi, ruleApi, sourceApi } from '@/api'
import type { EntryType } from '@/api/types/collect'
import type { Source, Step } from '@/api/types/source'
import { buildDataProcessGeneratePayload } from '@/utils/flow/dataProcess'
import type { FlowBranchGroup } from '@/views/FlowCanvas/canvas/flowModel'
import { buildSourceSeed, isMonitorNode } from '@/views/FlowCanvas/canvas/flowModel'

/**
 * 生成脚本的输入上下文。
 *
 * 两种来源（2026-11-11 补）：
 * - `flow`：源流程里有已保存的数据监控节点，用节点的 configId 与输入表字段（原路径）；
 * - `table`：源没有绑定流程 / 没有监控节点时，用表单里选定的主表独立生成（configId=0）。
 *   data-engine 不校验 configId 是否存在（186/2806 实测 configId=0 可正常生成），
 *   此时脚本属于「独立监控」，不关联画布节点——不能用别源的 configId 顶替。
 */
/**
 * 退回「按主表独立生成」的真实原因。
 *
 * 为什么不用一句话概括：这四种情况的处理方式完全不同（无流程只能独立定时；有节点没保存
 * 该去保存节点；节点没绑表该去选表），一律说成「没有绑定流程」会把人引到错误的排查方向。
 */
export type GenerationFallbackReason =
  /** 读不到源流程：接口失败或后端报「源未绑定有效流程」 */
  | 'flow-unavailable'
  /** 流程读到了，但整张流程里没有数据监控节点 */
  | 'no-monitor-node'
  /** 有监控节点，但节点没有保存出 configId（画布上还没落库） */
  | 'node-not-saved'
  /** 有监控节点，但节点没有绑定输入表，取不到被检表 */
  | 'node-no-input-table'

export interface GenerationContext {
  /** 'flow' = 绑定画布节点；'table' = 仅按主表生成的独立监控 */
  contextMode: 'flow' | 'table'
  /** 仅 table 模式：为什么没走流程上下文，供提示文案照实说明 */
  fallbackReason?: GenerationFallbackReason
  configId: number
  sourceTable: string
  targetTable: string
  inputFields: string[]
  outputFields: string[]
  inputFieldOptions: Array<{ itemCode: string; itemName: string }>
  outputFieldOptions: Array<{ itemCode: string; itemName: string }>
}

/** 表单侧可提供的兜底上下文：源没有流程/节点时用它按主表生成 */
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

/**
 * 从脚本执行器所在环境读取主表物理字段。接口缺失或读取失败时明确报错，
 * 不用登记字段冒充物理列；登记字段可能是 K1 等存储列对应的业务别名。
 */
export async function resolveMonitorTableFields(fallback?: GenerationFallback): Promise<string[]> {
  const response = await fetch('/api/runner-management/monitor-runner/table-fields', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableName: fallback?.tableName ?? '' }),
  })
  const payload = await response.json().catch(() => null)
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
  extras.push('执行参数契约：数据库连接只读取 DQ_DB_HOST、DQ_DB_PORT、DQ_DB_USER、DQ_DB_PASSWORD、DQ_DB_NAME 环境变量；不得写死连接地址或凭据。表名读取 DQ_TABLE_NAME，入库时间字段读取 DQ_TIME_COLUMN，源 ID 读取 DQ_SOURCE_ID（物理表有 SOURCE_ID 时必须参数化过滤当前源），检查窗口读取 DQ_START_DATE / DQ_END_DATE；不得把表名、时间字段或窗口写死在 SQL。环境变量缺失时返回 status=ERROR 和 reason，不使用猜测的默认字段。动态标识符必须校验并使用反引号引用。兼容执行器传入的 --format json、--table、--time-column 参数。')
  if (columns.length) extras.push(`该表真实字段：${columns.join(', ')}（只能用这些列名，不要臆造）`)
  const column = (timeColumn || '').trim()
  if (column) extras.push(`按 ${column} 统计入库时间`)
  const prompt = (basePrompt || '').trim()
  return prompt ? `${prompt}\n\n${extras.join('\n')}` : extras.join('\n')
}

/**
 * 源没有流程/监控节点时的兜底上下文：只按表单选定的主表生成。
 * configId 固定 0（独立监控，不关联画布节点）。
 */
async function resolveTableContext(
  fallback: GenerationFallback | undefined,
  reason: GenerationFallbackReason,
): Promise<GenerationContext> {
  const tableName = (fallback?.tableName ?? '').trim()
  const entry = await entryWithFields(fallback?.tableId, tableName)
  const sourceTable = physicalName(tableName) || (entry?.tableName ?? '')
  if (!sourceTable) {
    throw new MonitorGenerationContextError(
      '当前没有可用的数据监控节点，且没有选定主表：请先选择要监控的表，再生成脚本',
    )
  }
  const inputFieldOptions = fieldOptionsOf(entry)
  if (!inputFieldOptions.length) {
    throw new MonitorGenerationContextError(
      `无法读取表 ${sourceTable} 的字段清单：请先确认该表已登记字段，或先在流程里添加并保存数据监控节点后重新生成`,
    )
  }
  return {
    contextMode: 'table',
    fallbackReason: reason,
    configId: 0,
    sourceTable,
    targetTable: sourceTable,
    inputFields: [],
    outputFields: [],
    inputFieldOptions,
    outputFieldOptions: inputFieldOptions,
  }
}

/**
 * 画布节点顺序：主链在前，分支组按渲染顺序在后（含嵌套子分支）。
 *
 * 为什么不直接遍历 `seed.configs`：对象键顺序不等于画布阅读顺序，同一个源有多个监控
 * 节点时「取第一个」必须是用户视觉上的第一个。为什么不能只看 `seed.main`：主链在分叉处
 * 就中断（flowTopology.ts），分叉下游和分支上的监控节点会全被漏掉——这正是此前
 * 「节点明明存在却提示没有绑定流程」的根因（2026-11-13 修）。
 */
function orderedNodeIds(seed: ReturnType<typeof buildSourceSeed>): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  seed.main.forEach(push)
  const walk = (groups: readonly FlowBranchGroup[] | undefined) => {
    for (const group of groups ?? []) {
      for (const branch of group.branches) {
        branch.chain.forEach(push)
        walk(branch.subGroups)
      }
    }
  }
  walk(seed.branchGroups)
  return ids
}

/**
 * table 模式的提示文案：按真实原因区分，并说明「这条检查怎么才会自动跑」。
 *
 * 产品规则（1111 方案 §3）：有流程没有监控节点也可以独立配置，只是不会随流程触发；
 * 想入库后自动检查，需要回画布加节点并关联本条检查。
 */
export function describeTableFallback(context: GenerationContext): string {
  const table = context.sourceTable || '当前主表'
  switch (context.fallbackReason) {
    case 'no-monitor-node':
      return `该源流程里没有数据监控节点，本次按主表 ${table} 生成独立监控脚本；如需采集入库后自动检查，请在流程里添加数据监控节点并关联本条检查`
    case 'node-not-saved':
      return `流程里的数据监控节点还没有保存（缺少节点配置 ID），本次按主表 ${table} 生成独立监控脚本；保存节点后重新生成即可关联`
    case 'node-no-input-table':
      return `流程里的数据监控节点还没有绑定输入表，本次按主表 ${table} 生成独立监控脚本；请在节点里选择输入表后重新生成`
    case 'flow-unavailable':
    default:
      return `没有读到该源的可用流程，本次按主表 ${table} 生成独立监控脚本（不关联画布节点，按自己的执行计划运行）`
  }
}

/**
 * 从源流程里解析数据监控节点的生成上下文。
 *
 * 为什么优先读画布节点：记录里只冻结了定义（脚本路径/方法），
 * 生成接口需要的是节点绑定的 configId 与输入表字段，这些只存在于流程里。
 * 源没有绑定流程/没有节点时退回「按主表生成」，不再直接失败（2026-11-11）。
 */
export async function resolveMonitorGenerationContext(
  sourceId: string,
  fallback?: GenerationFallback,
): Promise<GenerationContext> {
  const id = (sourceId ?? '').trim()
  if (!id) throw new MonitorGenerationContextError('请先选择被监控源，再生成脚本')

  let detail: Source | null = null
  let steps: Step[] = []
  try {
    const [loadedDetail, loadedSteps] = await Promise.all([sourceApi.sourceDetail(id), sourceApi.sourceSteps(id)])
    detail = loadedDetail as Source | null
    steps = (loadedSteps ?? []) as Step[]
  } catch {
    // 源未绑定有效流程（后端「运行时异常：源未绑定有效流程」）等：能按主表生成就不阻断
    return resolveTableContext(fallback, 'flow-unavailable')
  }
  if (!detail) return resolveTableContext(fallback, 'flow-unavailable')

  const seed = buildSourceSeed(detail, steps)
  const node = orderedNodeIds(seed)
    .map((nodeId) => seed.configs[nodeId])
    .find((cfg) => cfg && isMonitorNode(cfg))
  if (!node) return resolveTableContext(fallback, 'no-monitor-node')

  const configId = Number(node.configId ?? 0)
  if (!Number.isFinite(configId) || configId <= 0) return resolveTableContext(fallback, 'node-not-saved')

  const rule = node.ruleCfg
  const inputTable = (rule?.inputTable ?? node.inputTable ?? node.collectCfg?.inputTable ?? '').trim()
  const inputTableId = (rule?.inputTableId ?? '').trim()
  const inputEntry = await entryOf(inputTableId)
  const sourceTable = physicalName(inputTable) || (inputEntry?.tableName ?? '')
  if (!sourceTable) return resolveTableContext(fallback, 'node-no-input-table')
  const outputName = physicalName(rule?.outputTable ?? node.outputTable ?? node.collectCfg?.outputTable ?? '')
  const outputEntry = await entryOf((rule?.outputTableId ?? '').trim())

  return {
    contextMode: 'flow',
    configId,
    sourceTable,
    targetTable: outputName || (outputEntry?.tableName ?? inputTable) || sourceTable,
    inputFields: Array.isArray(rule?.inputFields) ? rule.inputFields : (node.inputFields ?? []),
    outputFields: Array.isArray(rule?.outputFields) ? rule.outputFields : (node.outFields ?? []),
    inputFieldOptions: fieldOptionsOf(inputEntry),
    outputFieldOptions: fieldOptionsOf(outputEntry ?? inputEntry),
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
 * 目标：能拿出一个像 Python 脚本的正文就接受；实在拿不到才报错，并把收到的内容写进错误里便于定位。
 */
export function cleanMonitorPython(raw: string): string {
  const text = (raw || '').trim()
  if (!text) throw new Error('生成结果为空：模型没有返回任何内容，未保存候选文件')

  // 没有围栏：沿用旧行为，直接当正文（老模型/兜底纯文本流就是这样）
  if (!text.includes('```')) return text

  const blocks = [...text.matchAll(/```(?:python|py)?[ \t]*\r?\n([\s\S]*?)```/gi)]
    .map((m) => (m[1] || '').trim())
    .filter(Boolean)

  if (!blocks.length) {
    // 只有开围栏没有闭围栏 —— 通常是生成被截断
    const hint = describeIncompleteReply(text)
    throw new Error(`生成结果不完整：代码围栏没有闭合，可能被截断了，未保存候选文件（${hint}）`)
  }
  if (blocks.length === 1) return blocks[0]!

  // 多个代码块：只在「恰好一个带 def main」时才敢取，否则不猜
  const withMain = blocks.filter((code) => /def\s+main\s*\(/.test(code))
  if (withMain.length === 1) return withMain[0]!
  const hint = describeIncompleteReply(text)
  throw new Error(`生成结果包含多个代码块，无法确定哪个是正式脚本：未保存候选文件（${hint}）`)
}

/** 把「收到的内容大概长什么样」压成一句，便于用户/我们判断是模型跑偏还是被截断 */
function describeIncompleteReply(text: string): string {
  const fences = (text.match(/```/g) || []).length
  const head = text.replace(/\s+/g, ' ').slice(0, 60)
  const tail = text.replace(/\s+/g, ' ').slice(-60)
  const flags = [
    fences ? `围栏 ${fences} 个` : '没有代码围栏',
    /def\s+main\s*\(/.test(text) ? '含 def main(' : '没有 def main(',
    `共 ${text.length} 字`,
  ].join('、')
  return `${flags}。开头：${head}… 结尾：…${tail}`
}

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
      headers: { 'Content-Type': 'application/json' },
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
