import { entryApi, ruleApi, sourceApi } from '@/api'
import type { EntryType } from '@/api/types/collect'
import type { Source, Step } from '@/api/types/source'
import { buildDataProcessGeneratePayload } from '@/utils/flow/dataProcess'
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
export interface GenerationContext {
  /** 'flow' = 绑定画布节点；'table' = 仅按主表生成的独立监控 */
  contextMode: 'flow' | 'table'
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
 * 主表字段清单（prop/itemCode 口径）。
 *
 * 与脚本生成共用同一条解析链（tableId → entryDetail，缺失时按「库.表」物理名精确找一次），
 * 保证「入库时间字段」下拉里出现的就是生成时能看到的真实列，不会出现两套口径。
 * 拿不到字段时返回空数组，调用方退回固定候选，不臆造列名。
 */
export async function resolveMonitorTableFields(fallback?: GenerationFallback): Promise<string[]> {
  const entry = await entryWithFields(fallback?.tableId, (fallback?.tableName ?? '').trim())
  if (!entry || !Array.isArray(entry.fields)) return []
  return entry.fields.map((field) => (field.prop || '').trim()).filter(Boolean)
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
  if (columns.length) extras.push(`该表真实字段：${columns.join(', ')}（只能用这些列名，不要臆造）`)
  const column = (timeColumn || '').trim()
  if (column) extras.push(`按 ${column} 统计入库时间`)
  const prompt = (basePrompt || '').trim()
  if (!extras.length) return prompt
  return prompt ? `${prompt}\n\n${extras.join('\n')}` : extras.join('\n')
}

/**
 * 源没有流程/监控节点时的兜底上下文：只按表单选定的主表生成。
 * configId 固定 0（独立监控，不关联画布节点）。
 */
async function resolveTableContext(fallback: GenerationFallback | undefined): Promise<GenerationContext> {
  const tableName = (fallback?.tableName ?? '').trim()
  const entry = await entryWithFields(fallback?.tableId, tableName)
  const sourceTable = physicalName(tableName) || (entry?.tableName ?? '')
  if (!sourceTable) {
    throw new MonitorGenerationContextError(
      '该源还没有绑定流程，且没有选定主表：请先选择要监控的表，再生成脚本',
    )
  }
  const inputFieldOptions = fieldOptionsOf(entry)
  if (!inputFieldOptions.length) {
    throw new MonitorGenerationContextError(
      `无法读取表 ${sourceTable} 的字段清单：请先确认该表已登记字段，或改用绑定流程的数据监控节点生成`,
    )
  }
  return {
    contextMode: 'table',
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
    return resolveTableContext(fallback)
  }
  if (!detail) return resolveTableContext(fallback)

  const seed = buildSourceSeed(detail, steps)
  const node = seed.main.map((nodeId) => seed.configs[nodeId]).find((cfg) => cfg && isMonitorNode(cfg))
  if (!node) return resolveTableContext(fallback)

  const configId = Number(node.configId ?? 0)
  if (!Number.isFinite(configId) || configId <= 0) return resolveTableContext(fallback)

  const rule = node.ruleCfg
  const inputTable = (rule?.inputTable ?? node.inputTable ?? node.collectCfg?.inputTable ?? '').trim()
  const inputTableId = (rule?.inputTableId ?? '').trim()
  const inputEntry = await entryOf(inputTableId)
  const sourceTable = physicalName(inputTable) || (inputEntry?.tableName ?? '')
  if (!sourceTable) return resolveTableContext(fallback)
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
