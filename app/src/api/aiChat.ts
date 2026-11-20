// AI 智能问数（ChatBI / Agent 交互）API 封装
import { request } from './client'
import { POC_API_PREFIX } from '@/constants/backend'
import {
  extractTableDraftFromText,
  hasTableDraftBlock,
  isTableDraftPrompt,
  parseTableCreatedMessage,
  stripTableDraftPrompt,
  tableDraftFromPayload,
  type TableDraft,
  type TableDraftState,
} from '@/utils/aiChat/tableDraft'
import {
  extractSourceDraftFromText,
  hasSourceDraftBlock,
  isSourceCreatedMessage,
  isSourceDraftPrompt,
  stripSourceDraftPrompt,
  type SourceDraftState,
} from '@/utils/aiChat/sourceDraft'

export interface AiSessionItem {
  id: string
  title: string
  updatedAt: string
  group: 'today' | 'week' | 'earlier'
  uuid?: string
}

export interface BackendChatSession {
  id: number | string
  uuid?: string
  name?: string
  userId?: number | string | null
  createTime?: string
  updateTime?: string
  delFlag?: string
}

export interface BackendChatLog {
  id: number | string
  sessionId: number | string
  userId?: number | string | null
  msg: string
  modelMsg?: string
  result?: string
  status?: string
  data?: string
  createTime?: string
  updateTime?: string
}

export interface ClarificationOption {
  /**
   * cfg_entry_type 主键：仅结构化澄清事件/显式 JSON 载荷才携带真实主键。
   * 从 Markdown 文本提取的候选拿不到主键，置 null，只允许按表名文本回传，
   * 不得伪造序号冒充主键（否则结构化回传接通后会锁错表）。
   */
  entryTypeId: number | null
  /** 展示/文本回传用的序号（候选列表编号或行序），不是数据库主键 */
  ordinal?: number
  tableName: string
  typeName?: string | null
  /** 区分点（明细/汇总、来源网站等） */
  hint?: string | null
}

/** 卡片内选项的本地选择键：真实主键优先，文本提取候选退回展示序号 */
export function clarificationOptionKey(option: ClarificationOption, index: number): number {
  return option.entryTypeId ?? option.ordinal ?? index + 1
}

/**
 * 统一归一化澄清载荷：SSE 顶层 clarification、chat_log.data.clarification、
 * 以及 reasoning 里 MCP 工具结果中的 clarification 走同一个映射，
 * 只有结构化载荷才携带真实 entryTypeId（文本提取的候选始终为 null）。
 */
export function normalizeClarificationPayload(raw: unknown): Clarification | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const rawOptions = Array.isArray(source.options) ? source.options : []
  const kind = (source.kind as ClarificationKind) || 'table_choice'
  if (!rawOptions.length && kind !== 'free_text' && !source.question) return null

  const options: ClarificationOption[] = rawOptions.map((item, idx) => {
    const opt = (item ?? {}) as Record<string, unknown>
    const rawId = opt.entryTypeId ?? opt.id
    const numericId = rawId != null && rawId !== '' ? Number(rawId) : null
    const ordinal = Number(opt.ordinal)
    return {
      entryTypeId: numericId != null && Number.isFinite(numericId) ? numericId : null,
      ordinal: Number.isFinite(ordinal) && ordinal > 0 ? ordinal : idx + 1,
      tableName: String(opt.tableName || opt.name || opt.table || `table_${idx + 1}`),
      typeName: String(opt.typeName || opt.label || opt.title || opt.tableName || `候选 ${idx + 1}`),
      hint: opt.hint ? String(opt.hint) : (opt.description ? String(opt.description) : null),
    }
  })

  return {
    kind,
    reason: (source.reason as Clarification['reason']) || 'AMBIGUOUS',
    question: source.question ? String(source.question) : '请确认需要分析的表或口径：',
    allowFreeText: typeof source.allowFreeText === 'boolean' ? source.allowFreeText : true,
    maxSelect:
      typeof source.maxSelect === 'number' && source.maxSelect > 0
        ? source.maxSelect
        : Math.min(5, Math.max(1, options.length)),
    options,
  }
}

/** 从 start 处的开括号起做括号配平（跳过字符串与转义），返回完整 JSON 文本；未闭合返回 null。 */
export function sliceBalancedJson(
  text: string,
  start: number,
  open: '{' | '[',
  close: '}' | ']',
): string | null {
  if (text[start] !== open) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 取 `"key": [ ... ]` 的数组 JSON（容忍数组之后的内容被截断）。 */
function sliceArrayAfterKey(text: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text)
  if (!match) return null
  return sliceBalancedJson(text, match.index + match[0].length - 1, '[', ']')
}

/** 取 `"key": "字符串"` 的值（字符串未闭合时返回 null），并做 JSON 反转义。 */
function readJsonStringField(text: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)
  if (!match) return null
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

const TOOL_RESULT_MARKER = /\[工具结果\]\s*([^\s:：]+)\s*[:：]\s*(?=\{)/g

/**
 * 从思考链（reasoning_content）里恢复 MCP 结构化澄清。
 *
 * 外部智能体把每次工具调用写成 reasoning 文本：`[工具结果] <tool>: {json}`。
 * `submit_table_selection` 命中多候选时，这段 JSON 里的 `clarification` / `candidates` 是
 * **唯一带真实 entryTypeId 的选项来源**（正文 Markdown 表格/列表只有中文名，且模型经常
 * 只回一句「命中两张同名表，请确认查哪一张」而根本不列候选 → 页面上没有任何可选项）。
 *
 * 注意：实测上游会把 reasoning 里的工具结果**截断**（约 2KB 后以 `...` 结尾），
 * 完整 JSON 常常解析不到，此时退回按 `candidates` 数组恢复（数组在截断点之前且完整）。
 */
export function extractClarificationFromReasoning(reasoning: string): Clarification | null {
  if (!reasoning || typeof reasoning !== 'string') return null

  let found: Clarification | null = null
  let foundAt = -1
  TOOL_RESULT_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOOL_RESULT_MARKER.exec(reasoning)) !== null) {
    const toolName = match[1]
    const objStart = match.index + match[0].length
    const segment = reasoning.slice(objStart)
    const fullJson = sliceBalancedJson(reasoning, objStart, '{', '}')
    if (fullJson) {
      try {
        const payload = JSON.parse(fullJson) as Record<string, unknown>
        const normalized = normalizeClarificationPayload(payload?.clarification)
        // 多轮追问时以最后一轮的澄清为准
        if (normalized && normalized.options.length > 0) {
          found = normalized
          foundAt = match.index
        }
      } catch {
        // 不是 JSON：跳过
      }
      continue
    }

    // 截断兜底：只认选表提交工具，且必须是「需要澄清」的裁决
    if (!/submit_table_selection/i.test(toolName)) continue
    const status =
      readJsonStringField(segment, 'status') ?? readJsonStringField(segment, 'outcome') ?? ''
    const hasClarificationField = /"clarification"\s*:\s*\{/.test(segment)
    if (!hasClarificationField && !/needs_clarification/i.test(status)) continue

    const candidatesJson = sliceArrayAfterKey(segment, 'candidates')
    if (!candidatesJson) continue
    let rawCandidates: unknown
    try {
      rawCandidates = JSON.parse(candidatesJson)
    } catch {
      continue
    }
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) continue

    const normalized = normalizeClarificationPayload({
      kind: 'table_choice',
      reason: /"reason"\s*:\s*"([A-Z_]+)"/.exec(segment)?.[1]
        ?? (/"truncated"\s*:\s*true/.test(segment) ? 'TOO_MANY' : 'AMBIGUOUS'),
      question: readJsonStringField(segment, 'question')
        ?? readJsonStringField(segment, 'tip')
        ?? '',
      allowFreeText: true,
      options: rawCandidates,
    })
    if (!normalized || normalized.options.length === 0) continue
    // tip 往往很长（含候选枚举），只留一句能放在卡片头部的追问
    if (!normalized.question || normalized.question.length > 160) {
      normalized.question = `命中 ${normalized.options.length} 张候选表，请选择要分析的表（可多选）：`
    }
    found = normalized
    foundAt = match.index
  }

  // 纯文本的 ask_clarification 结果（编号选项）：多轮时以最后出现的为准
  const textual = extractTextClarificationFromReasoning(reasoning)
  if (textual && textual.at > foundAt) found = textual.clarification
  return found
}

const ASK_CLARIFICATION_TEXT_MARKER = /\[工具结果\]\s*ask_clarification\s*[:：]\s*(?!\{)/g
const NUMBERED_OPTION = /^\s*(\d{1,2})[.、)）]\s*(.+?)\s*$/
const OTHER_OPTION = /^其他|^其它|请说明|自定义/
/** 选项末尾括号里的物理表名：`贝壳二手房成交价（tb_ke_com_chengjiao_esf_detail）` */
const OPTION_TABLE = /^(.*?)\s*[（(]\s*((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z][A-Za-z0-9_]*)\s*[)）]\s*$/

/**
 * 智能体 ask_clarification 工具的结果是给人看的纯文本（2026-11-19 186 实测）：
 * `[工具结果] ask_clarification: 🤔 系统中有多张…\n\n您想查询哪种…？\n\n1. 贝壳二手房成交价（tb_ke_…）\n…\n4. 其他（请说明）`。
 * 正文往往只剩一句「需要先确认您要查哪一类」，不解析的话页面上没有可选项。
 * 选项带物理表名时按选表卡片处理（回传「中文名（表名）」）；「其他（请说明）」并入补充说明输入框。
 */
function extractTextClarificationFromReasoning(reasoning: string): { at: number; clarification: Clarification } | null {
  let result: { at: number; clarification: Clarification } | null = null
  ASK_CLARIFICATION_TEXT_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ASK_CLARIFICATION_TEXT_MARKER.exec(reasoning)) !== null) {
    const start = match.index + match[0].length
    const rest = reasoning.slice(start)
    const end = rest.search(/\[工具(?:调用|结果)\]/)
    const segment = end >= 0 ? rest.slice(0, end) : rest

    const questionLines: string[] = []
    const options: ClarificationOption[] = []
    for (const line of segment.split(/\r?\n/)) {
      const numbered = NUMBERED_OPTION.exec(line)
      if (numbered) {
        const label = numbered[2].replace(/\*\*/g, '').trim()
        if (OTHER_OPTION.test(label)) continue
        const table = OPTION_TABLE.exec(label)
        const typeName = (table ? table[1] : label).trim() || label
        options.push({
          entryTypeId: null,
          ordinal: Number(numbered[1]),
          tableName: table ? table[2] : typeName,
          typeName,
          hint: null,
        })
      } else if (!options.length && line.trim()) {
        questionLines.push(line.trim())
      }
    }
    if (!options.length) continue

    // 追问取最后一句问句，太长时退回通用文案；去掉行首表情
    const questionCandidate = [...questionLines].reverse().find((l) => /[？?：:]$/.test(l)) ?? questionLines[questionLines.length - 1] ?? ''
    const question = questionCandidate.replace(/^[^\p{L}\p{N}"“「(（]+/u, '').trim()
    const hasTables = options.some((o) => o.tableName !== o.typeName)
    result = {
      at: match.index,
      clarification: {
        kind: hasTables ? 'table_choice' : 'metric_choice',
        reason: 'AMBIGUOUS',
        question: question && question.length <= 160 ? question : '请确认需要分析的表或口径：',
        allowFreeText: true,
        maxSelect: Math.min(5, options.length),
        options,
      },
    }
  }
  return result
}

export type ClarificationKind = 'table_choice' | 'metric_choice' | 'free_text'

/** 选表/指标不确定时的结构化澄清载荷，与 MCP 的 clarification 字段一一对应。 */
export interface Clarification {
  kind: ClarificationKind
  reason?: 'TOO_MANY' | 'NO_MATCH' | 'AMBIGUOUS' | (string & {})
  question?: string
  allowFreeText: boolean
  maxSelect: number
  options: ClarificationOption[]
}

export interface PieSlice {
  label: string
  value: number
  displayValue?: string
  color?: string
  tone?: 'primary' | 'cyan' | 'indigo' | 'amber' | 'ok' | 'err' | 'muted' | 'orange' | 'purple'
}

/** 问数失败分类：前端据此给出不同的可操作入口（重试/补充条件/重新提问） */
export type AskErrorCode =
  | 'NETWORK'
  | 'UPSTREAM_ERROR'
  | 'PARAM_MISSING'
  | 'TOOL_FAILED'
  | 'EMPTY_RESULT'
  | 'PERMISSION_DENIED'
  | 'CONTEXT_LOST'
  | 'UNKNOWN'

export interface AskErrorInfo {
  code: AskErrorCode
  message: string
  retryable: boolean
}

/**
 * 把原始错误（fetch 异常 / SSE error 文本 / HTTP 状态）归一化为分类 + 友好文案。
 * 不向用户暴露堆栈与连接串；技术原文只保留摘要。
 */
export function normalizeAskError(raw: unknown): AskErrorInfo {
  const text =
    raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : String(raw ?? '')
  const lower = text.toLowerCase()

  if (/abort/i.test((raw as { name?: string })?.name || '') || /aborted/i.test(text)) {
    return { code: 'NETWORK', message: '连接已中断', retryable: true }
  }
  if (/failed to fetch|networkerror|network error|load failed|err_connection|err_network|err_internet/i.test(text)) {
    return { code: 'NETWORK', message: '网络连接中断，已保留你的问题，可重试', retryable: true }
  }
  if (/参数不合法|参数缺失|缺少必要|missing required|invalid param|param_invalid/i.test(text)) {
    return { code: 'PARAM_MISSING', message: '缺少必要的查询条件，请补充时间范围或指标口径后重试', retryable: true }
  }
  if (/上下文不成立|上下文已过期|context_lost|会话上下文|选表会话/i.test(text)) {
    return { code: 'CONTEXT_LOST', message: '会话上下文已过期，请重新提问', retryable: true }
  }
  if (/权限|无权|permission|denied|forbidden|403/i.test(text)) {
    return { code: 'PERMISSION_DENIED', message: '无权访问该数据范围，请联系管理员', retryable: false }
  }
  if (/上游失败|upstream|工具执行|tool_failed|execute_sql|sql.*失败/i.test(text)) {
    return { code: 'TOOL_FAILED', message: '数据查询工具执行失败，可重试或换个问法', retryable: true }
  }
  if (/http\s*(4\d\d|5\d\d)|智能体服务请求失败/i.test(text)) {
    const statusMatch = text.match(/HTTP\s*(\d{3})/i)
    return {
      code: 'UPSTREAM_ERROR',
      message: `智能体服务暂时不可用${statusMatch ? `（HTTP ${statusMatch[1]}）` : ''}，请稍后重试`,
      retryable: true,
    }
  }
  if (/timeout|超时|timed out/i.test(lower)) {
    return { code: 'UPSTREAM_ERROR', message: '智能体响应超时，可重试或缩小查询范围', retryable: true }
  }
  return { code: 'UNKNOWN', message: '本次问数未能完成，可重试或换个问法', retryable: true }
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  interrupted?: boolean
  /** 消息生命周期状态（流式/完成/失败/中断/空回答），失败与中断态驱动操作条 */
  status?: 'streaming' | 'done' | 'failed' | 'interrupted' | 'empty'
  errorInfo?: AskErrorInfo
  /** assistant 消息冗余存原始问题：重试/重新生成时原问原会话重发 */
  question?: string
  /** 导出/图表切换等本地操作回执，与 AI 回答区分，不伪造思考过程 */
  localAction?: boolean
  // 智能体交互与富文本卡片扩展
  clarification?: Clarification & {
    confirmed?: boolean
    selectedEntryTypeIds?: number[]
  }
  thinking?: {
    completed: boolean
    durationMs: number
    steps: string[]
    text?: string
    interrupted?: boolean
  }
  sql?: {
    code: string
    /** 真实执行耗时/扫描行数：拿不到就不写，绝不造假 */
    execTimeMs?: number
    scanRows?: number
    estimated?: boolean
  }
  kpis?: Array<{
    label: string
    value: string
    subtext: string
    type?: 'normal' | 'danger' | 'success'
  }>
  chartData?: {
    title: string
    pieTitle?: string
    bars?: Array<{ label: string; value: number; displayValue: string; color?: string }>
    slices?: PieSlice[]
    tableColumns: Array<{ prop: string; label: string }>
    tableRows: Array<Record<string, unknown>>
  }
  insights?: string[]
  suggestions?: string[]
  /** 追问胶囊类型：table_switch = 零行回答里的「改查」建议，标签显示「可以改查」 */
  suggestionsKind?: 'followup' | 'table_switch'
  /** 智能体对话建表草稿（确认后走 entrySave 落库），见 utils/aiChat/tableDraft */
  tableDraft?: TableDraftState
  /** 智能体对话建源草稿（确认后按新建采集 / 新增源链路落库），见 utils/aiChat/sourceDraft */
  sourceDraft?: SourceDraftState
  /** 本条回答是在建表 / 建源意图下提问的：发给智能体时追加了对应草稿格式要求 */
  draftMode?: 'table' | 'source'
}

export function formatSessionGroupAndDate(dateStr?: string | Date): {
  group: 'today' | 'week' | 'earlier'
  updatedAt: string
} {
  if (!dateStr) {
    return { group: 'today', updatedAt: '刚刚' }
  }
  const date = typeof dateStr === 'string' ? new Date(dateStr.replace(/-/g, '/')) : dateStr
  if (isNaN(date.getTime())) {
    return { group: 'today', updatedAt: '刚刚' }
  }
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const weekStart = todayStart - 6 * 24 * 3600 * 1000
  const time = date.getTime()

  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  if (time >= todayStart) {
    return { group: 'today', updatedAt: `${hh}:${mm}` }
  } else if (time >= weekStart) {
    return { group: 'week', updatedAt: `${month}-${day}` }
  } else {
    return { group: 'earlier', updatedAt: `${date.getFullYear()}-${month}-${day}` }
  }
}

export function formatMessageTime(dateStr?: string | Date): string {
  if (!dateStr) return '刚刚'
  const date = typeof dateStr === 'string' ? new Date(dateStr.replace(/-/g, '/')) : dateStr
  if (isNaN(date.getTime())) return '刚刚'
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  if (date.getTime() >= todayStart) {
    return `今天 ${hh}:${mm}`
  }
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${hh}:${mm}`
}

export function convertChatLogsToMessages(logs: BackendChatLog[]): ChatMessage[] {
  const result: ChatMessage[] = []
  if (!Array.isArray(logs)) return result

  for (const log of logs) {
    if (!log) continue
    const createdAt = formatMessageTime(log.createTime)

    // 用户提问消息
    result.push({
      id: `m-${log.id}-u`,
      role: 'user',
      content: stripSourceDraftPrompt(stripTableDraftPrompt(log.msg || '')),
      createdAt,
    })

    // 智能体回复消息
    const assistantMsg: ChatMessage = {
      id: `m-${log.id}-a`,
      role: 'assistant',
      content: log.modelMsg || '',
      createdAt,
      interrupted: log.status === 'INTERRUPTED',
      question: stripSourceDraftPrompt(stripTableDraftPrompt(log.msg || '')),
      status:
        log.status === 'INTERRUPTED'
          ? 'interrupted'
          : log.status === 'ERROR'
            ? 'failed'
            : 'done',
    }

    // 解析结构化扩展载荷 (data)
    if (log.data) {
      try {
        const dataObj = typeof log.data === 'string' ? JSON.parse(log.data) : log.data
        if (dataObj && typeof dataObj === 'object') {
          if (dataObj.interrupted) {
            assistantMsg.interrupted = true
          }
          if (dataObj.thinking) {
            const th = dataObj.thinking
            const text = th.text || ''
            assistantMsg.thinking = {
              completed: th.completed ?? (log.status === 'SUCCESS'),
              durationMs: typeof th.durationMs === 'number' ? th.durationMs : 0,
              text,
              interrupted: th.interrupted ?? (log.status === 'INTERRUPTED'),
              steps: text
                ? text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
                : [],
            }
          }
          if (dataObj.clarification) {
            assistantMsg.clarification = dataObj.clarification
          }
          if (dataObj.sql) {
            assistantMsg.sql = dataObj.sql
          }
          // schemaVersion>=2：富卡片直接回放，不再从文本正则重猜
          if (dataObj.schemaVersion >= 2) {
            if (dataObj.chartData) assistantMsg.chartData = dataObj.chartData
            if (Array.isArray(dataObj.kpis)) assistantMsg.kpis = dataObj.kpis
          }
          if (dataObj.error && assistantMsg.status === 'failed') {
            assistantMsg.errorInfo = normalizeAskError(
              typeof dataObj.error === 'object' ? dataObj.error.message : dataObj.error,
            )
          }
        }
      } catch (err) {
        console.warn('[convertChatLogsToMessages] 解析 log.data 失败:', err)
      }
    }

    if (assistantMsg.status === 'failed' && !assistantMsg.errorInfo) {
      assistantMsg.errorInfo = normalizeAskError(log.result || '上游服务异常')
    }

    // 若未预置 SQL，尝试从 log.result 或 modelMsg 提取（仅能拿到语句本身，指标未知 → 标注待执行口径）
    if (!assistantMsg.sql) {
      const sqlCandidate = log.result || log.modelMsg || ''
      const sqlMatch = sqlCandidate.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i)
      const cleanSql = (sqlMatch ? sqlMatch[1] : sqlCandidate).trim()
      if (/^(?:SELECT|WITH|SHOW|DESC|EXPLAIN)\b/i.test(cleanSql)) {
        assistantMsg.sql = {
          code: cleanSql,
          estimated: true,
        }
      }
    }

    // 若未有澄清选项，先从思考链里的 MCP 工具结果恢复结构化候选（带真实主键），
    // 再退回回答文本提取（模型没把候选写进正文时这条兜底会落空，只能靠前者）
    if (!assistantMsg.clarification && assistantMsg.thinking?.text) {
      const parsedFromReasoning = extractClarificationFromReasoning(assistantMsg.thinking.text)
      if (parsedFromReasoning) {
        assistantMsg.clarification = parsedFromReasoning
      }
    }

    // 若未有澄清选项，尝试从回答文本提取
    if (!assistantMsg.clarification && assistantMsg.content) {
      const parsedClarification = extractClarificationFromText(assistantMsg.content)
      if (parsedClarification) {
        assistantMsg.clarification = parsedClarification
      }
    }

    // 建表草稿：正文 ```table-draft 代码块；后续某条用户消息是「建表结果」回传且物理表名一致即视为已建，
    // 避免刷新后草稿卡又变成可确认、被重复建表（见下方回放循环之后的标记）
    if (isTableDraftPrompt(log.msg || '')) assistantMsg.draftMode = 'table'
    if (assistantMsg.content && (assistantMsg.draftMode || hasTableDraftBlock(assistantMsg.content))) {
      const draft = extractTableDraftFromText(assistantMsg.content)
      if (draft) {
        assistantMsg.tableDraft = { draft, status: 'pending' }
        // 建表回答里出现的表名不是选表候选：不要被当成澄清卡片
        assistantMsg.clarification = undefined
      }
    }

    // 建源草稿：正文 ```source-draft 代码块；其后的「建源结果」回传视为已建（见 markCreatedSourceDrafts）
    if (isSourceDraftPrompt(log.msg || '')) assistantMsg.draftMode = 'source'
    if (!assistantMsg.tableDraft && assistantMsg.content && (assistantMsg.draftMode === 'source' || hasSourceDraftBlock(assistantMsg.content))) {
      const draft = extractSourceDraftFromText(assistantMsg.content)
      if (draft) {
        assistantMsg.sourceDraft = { draft, status: 'pending' }
        assistantMsg.clarification = undefined
      }
    }

    // 若未有图表数据，尝试从回答文本表格提取
    if (!assistantMsg.chartData && !assistantMsg.tableDraft && !assistantMsg.sourceDraft && assistantMsg.content && !parseTableCreatedMessage(log.msg || '') && !isSourceCreatedMessage(log.msg || '')) {
      const parsedChartData = extractChartDataFromText(assistantMsg.content)
      if (parsedChartData) {
        assistantMsg.chartData = parsedChartData
      }
    }

    // 零行回答里的「建议换表」：恢复成可点击的改查胶囊（没有澄清卡片/业务数据/建表草稿时才认）
    if (
      !assistantMsg.clarification &&
      !assistantMsg.chartData &&
      !assistantMsg.tableDraft &&
      !assistantMsg.suggestions?.length &&
      assistantMsg.content
    ) {
      const tableSwitch = extractTableSwitchSuggestions(assistantMsg.content)
      if (tableSwitch) {
        assistantMsg.suggestions = tableSwitch.actions
        assistantMsg.suggestionsKind = 'table_switch'
      }
    }

    result.push(assistantMsg)
  }

  markCreatedTableDrafts(result)
  markCreatedSourceDrafts(result)
  return result
}

/**
 * 历史回放：建源草稿之后、下一份建源草稿之前若有「建源结果」回传，视为已确认过（成功或部分失败），
 * 卡片只展示回传结果、不再可确认，避免刷新后重复建源。
 */
export function markCreatedSourceDrafts(messages: ChatMessage[]): void {
  messages.forEach((msg, index) => {
    if (msg.role !== 'assistant' || !msg.sourceDraft || msg.sourceDraft.status !== 'pending') return
    for (let i = index + 1; i < messages.length; i++) {
      const next = messages[i]
      if (next.role === 'assistant' && next.sourceDraft) return
      if (next.role === 'user' && isSourceCreatedMessage(next.content)) {
        const failed = next.content.includes('未全部完成')
        msg.sourceDraft = { ...msg.sourceDraft, status: failed ? 'failed' : 'created', resultText: next.content.trim() }
        return
      }
    }
  })
}

/** 历史回放：按「建表结果」回传消息把对应草稿标成已建（按物理表名匹配，取其后最近的一条） */
export function markCreatedTableDrafts(messages: ChatMessage[]): void {
  messages.forEach((msg, index) => {
    if (msg.role !== 'assistant' || !msg.tableDraft || msg.tableDraft.status !== 'pending') return
    // 智能体没给物理表名时由卡片按名称生成、用户还可能改过，正文草稿里没有可比对的表名：
    // 认它之后、下一份草稿之前的第一条建表结果
    const draftTableName = msg.tableDraft.draft.tableName.trim().toLowerCase()
    for (let i = index + 1; i < messages.length; i++) {
      if (!draftTableName && messages[i].role === 'assistant' && messages[i].tableDraft) return
      const created = messages[i].role === 'user' ? parseTableCreatedMessage(messages[i].content) : null
      if (created && (!draftTableName || created.tableName.toLowerCase() === draftTableName)) {
        // 卡片显示真实落库的名称、物理表名与存储类型（用户可能在卡片里改过，正文草稿是改之前的）
        const draft = {
          ...msg.tableDraft.draft,
          tableName: created.tableName,
          ...(created.name ? { name: created.name } : {}),
          ...(created.dsKind ? { dsKind: created.dsKind } : {}),
        }
        msg.tableDraft = { ...msg.tableDraft, draft, status: 'created', tableId: created.tableId }
        return
      }
    }
  })
}

/**
 * 列表载荷兼容：后端信封带 count（哪怕是 null）时 client 会归一成 `{ list, total }`，
 * 否则直接是数组或 `{ data / records }`。2026-11-19 186 后端会话列表开始带 `count: null`，
 * 只认 data/records 时会话列表整页为空。
 */
function pickListPayload<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[]
  const obj = res as Record<string, unknown> | null | undefined
  for (const key of ['list', 'data', 'records'] as const) {
    if (Array.isArray(obj?.[key])) return obj![key] as T[]
  }
  return []
}

export async function listAiSessions(userId?: number): Promise<AiSessionItem[]> {
  try {
    const res = await request<
      BackendChatSession[] | { data?: BackendChatSession[]; records?: BackendChatSession[]; list?: BackendChatSession[] }
    >(
      'poc/session/list',
      userId ? { userId } : undefined,
      {
        method: 'GET',
        httpEndpoint: `${POC_API_PREFIX}/session/list`,
      },
    )
    const list = pickListPayload<BackendChatSession>(res)
    return list.map((item) => {
      const { group, updatedAt } = formatSessionGroupAndDate(item.updateTime || item.createTime)
      return {
        id: String(item.id),
        uuid: item.uuid,
        title: item.name || '问数会话',
        updatedAt,
        group,
      }
    })
  } catch (err) {
    console.warn('[listAiSessions] 获取后端会话列表失败:', err)
    return []
  }
}

export async function deleteAiSession(sessionId: string | number): Promise<boolean> {
  try {
    await request<unknown>(
      'poc/session/stop',
      undefined,
      {
        method: 'POST',
        httpEndpoint: `${POC_API_PREFIX}/session/stop`,
        query: { id: String(sessionId) },
      },
    )
    return true
  } catch (err) {
    console.warn('[deleteAiSession] 删除会话失败:', err)
    return false
  }
}

export interface AiChatHistoryPage {
  messages: ChatMessage[]
  /** 后端日志总条数（一条日志=一轮问答）；响应未带 count 时退化为当页条数 */
  total: number
  pageNo: number
  pageSize: number
}

/**
 * 分页拉取会话历史（后端 /chat-log/history 按 id 升序分页并回 count）。
 * pageNo=1 是最早的一页；向上翻页 = pageNo 递减。
 */
export async function getAiChatHistoryPage(
  sessionId: string | number,
  pageNo = 1,
  pageSize = 100,
): Promise<AiChatHistoryPage> {
  try {
    const res = await request<
      BackendChatLog[] | { data?: BackendChatLog[]; records?: BackendChatLog[]; list?: BackendChatLog[]; count?: number; total?: number }
    >(
      'poc/chat-log/history',
      {
        sessionId: String(sessionId),
        pageNo,
        pageSize,
      },
      {
        method: 'POST',
        httpEndpoint: `${POC_API_PREFIX}/chat-log/history`,
      },
    )
    const list = pickListPayload<BackendChatLog>(res)
    const rawTotal = Array.isArray(res) ? undefined : ((res as any)?.count ?? (res as any)?.total)
    const count = typeof rawTotal === 'number' && rawTotal > 0 ? rawTotal : list.length
    return {
      messages: convertChatLogsToMessages(list),
      total: count,
      pageNo,
      pageSize,
    }
  } catch (err) {
    console.warn('[getAiChatHistoryPage] 获取会话历史记录失败:', err)
    return { messages: [], total: 0, pageNo, pageSize }
  }
}

/** 拉取会话最近的历史消息（超过一页时取最新一页，更早的由页面按需向上翻页） */
export async function getAiChatHistory(sessionId: string | number): Promise<ChatMessage[]> {
  const first = await getAiChatHistoryPage(sessionId, 1, 100)
  if (first.total > first.pageSize) {
    const lastPageNo = Math.ceil(first.total / first.pageSize)
    const last = await getAiChatHistoryPage(sessionId, lastPageNo, first.pageSize)
    return last.messages
  }
  return first.messages
}

/** 智能体问数流式调用入参 */
export interface AgentChatParams {
  msg: string
  thread_id?: string
  session_id?: string | number
  user_id?: string | number
  signal?: AbortSignal
}

/** 智能体问数流式事件 */
export type AgentChatEvent =
  | { type: 'chunk'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'clarification'; clarification: Clarification }
  | { type: 'table_draft'; draft: TableDraft }
  | { type: 'session_assigned'; sessionId: string; threadId: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

/**
 * 从文本或 Markdown 回答中提取待确认项与候选（支持 Markdown Task List 复选框与 JSON 块）。
 */
export function extractClarificationFromText(text: string): Clarification | null {
  if (!text || typeof text !== 'string') return null

  // 1. 尝试匹配代码块中的 JSON clarification
  const jsonBlockRegex = /```(?:json|clarification)?\s*([\s\S]*?\{[\s\S]*?"(?:options|clarification)"[\s\S]*?\})\s*```/i
  const jsonMatch = text.match(jsonBlockRegex)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      const data = parsed.clarification || parsed
      if (Array.isArray(data.options) && data.options.length > 0) {
        return {
          kind: data.kind || 'table_choice',
          reason: data.reason || 'AMBIGUOUS',
          question: data.question || '请确认需要分析的表或口径：',
          allowFreeText: data.allowFreeText ?? true,
          maxSelect: typeof data.maxSelect === 'number'
            ? Math.min(data.maxSelect, data.options.length)
            : Math.min(5, data.options.length),
          options: data.options.map((opt: Record<string, unknown>, idx: number) => ({
            entryTypeId:
              opt.entryTypeId != null || opt.id != null ? Number(opt.entryTypeId ?? opt.id) : null,
            ordinal: idx + 1,
            tableName: String(opt.tableName || opt.name || opt.table || `table_${idx + 1}`),
            typeName: String(opt.typeName || opt.label || opt.title || opt.tableName || `候选 ${idx + 1}`),
            hint: opt.hint ? String(opt.hint) : (opt.description ? String(opt.description) : null),
          })),
        }
      }
    } catch {}
  }

  // 2. 匹配 Markdown Task List 复选框列表：- [ ] 或 * [ ] 或 - [x]
  const taskListRegex = /^\s*[-*]\s*\[([ xX])\]\s*(.+)$/gm
  const taskMatches = [...text.matchAll(taskListRegex)]
  if (taskMatches.length > 0) {
    const questionMatch = text.match(/(?:请确认|待确认|请勾选|请选择|候选|可选范围)[^:\n：]*[：:]?/i)
    const question = questionMatch ? questionMatch[0] : '请勾选需要确认的项：'

    const options: ClarificationOption[] = taskMatches.map((m, idx) => {
      const lineText = m[2].trim()
      const tableMatch = lineText.match(/`?([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+_[a-zA-Z0-9_]+)`?/)
      const hintMatch = lineText.match(/[(（]([^)）]+)[)）]/)

      let cleanName = lineText
        .replace(/[(（][^)）]+[)）]/g, '')
        .replace(/^\d+[\.、\s]*/, '')
        .replace(/[`*]/g, '')
        .trim()
      if (cleanName.includes('：')) cleanName = cleanName.split('：')[1].trim()
      if (cleanName.includes(':')) cleanName = cleanName.split(':')[1].trim()

      const tableName = tableMatch ? tableMatch[1] : (cleanName || `item_${idx + 1}`)
      const typeName = cleanName || tableName

      return {
        entryTypeId: null,
        ordinal: idx + 1,
        tableName,
        typeName,
        hint: hintMatch ? hintMatch[1].trim() : null,
      }
    })

    return {
      kind: 'table_choice',
      reason: 'AMBIGUOUS',
      question,
      allowFreeText: true,
      maxSelect: Math.min(5, options.length),
      options,
    }
  }

  // 3. 匹配 Markdown 表格形式的待确认候选表清单（如 | 编号 | 表名 | 说明 |）
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 2; i++) {
    const headerLine = lines[i].trim()
    if (!headerLine.includes('|')) continue
    const sepLine = lines[i + 1]?.trim() || ''
    if (!/^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/.test(sepLine)) {
      continue
    }

    const headerCells = headerLine
      .split('|')
      .map((c) => c.trim())
      .filter((c, idx, arr) => {
        if (idx === 0 && headerLine.startsWith('|') && c === '') return false
        if (idx === arr.length - 1 && headerLine.endsWith('|') && c === '') return false
        return true
      })

    if (headerCells.length < 2) continue

    const idColIdx = headerCells.findIndex((h) => /(?:编号|序号|id|index|no)/i.test(h))
    const tableColIdx = headerCells.findIndex((h) => {
      const clean = h.replace(/[`*]/g, '').trim()
      // 坚决排除常规业务报表列名（如“价格表”、“数据列表”、“明细表”、“统计表”）
      if (/(?:列表|统计表|价格表|明细表|报表|对比表|数据表查询)/.test(clean)) return false
      return (
        /^(?:表名|物理表(?:名)?|候选表(?:名)?|table_name|待选表)$/i.test(clean) ||
        /(?:物理表|候选表|table_name)/i.test(clean)
      )
    })
    const descColIdx = headerCells.findIndex((h) => /(?:说明|描述|含义|备注|注释|desc|comment|业务)/i.test(h))

    // 必须有明确的待确认候选表意图（例如“请问你希望用哪张表”、“存在多种数据源候选”），坚决避免将常规业务数据表格误识别为澄清选项
    const hasTableChoiceIntent =
      /(?:请问你?希望用哪张表|用哪张表|用哪个来源|用哪个数据源|需要您确认用哪个|请确认.*表|请选择要(?:分析|使用)的(?:表|数据源)|候选表[：:]|回复["“]?\d+["”]?.*(?:表|销售价格|成交信息))/i.test(text)

    const isCandidateTable =
      hasTableChoiceIntent &&
      (tableColIdx !== -1 || (idColIdx !== -1 && descColIdx !== -1))
    if (!isCandidateTable) continue

    const effTableCol = tableColIdx !== -1 ? tableColIdx : (headerCells.length > 2 ? 1 : 0)
    const effDescCol = descColIdx !== -1 ? descColIdx : (headerCells.length > 2 ? 2 : 1)
    const effIdCol = idColIdx !== -1 ? idColIdx : (tableColIdx > 0 ? 0 : -1)

    const tableOptions: ClarificationOption[] = []
    let containsBusinessData = false
    let j = i + 2
    while (j < lines.length) {
      const rowLine = lines[j].trim()
      if (!rowLine.includes('|')) break
      const cells = rowLine
        .split('|')
        .map((c) => c.trim())
        .filter((c, idx, arr) => {
          if (idx === 0 && rowLine.startsWith('|') && c === '') return false
          if (idx === arr.length - 1 && rowLine.endsWith('|') && c === '') return false
          return true
        })

      if (cells.length >= 2) {
        const rawTable = cells[effTableCol] || cells[0] || ''
        const rawDesc = effDescCol !== -1 && cells[effDescCol] ? cells[effDescCol] : ''
        const rawId = effIdCol !== -1 && cells[effIdCol] ? cells[effIdCol] : String(tableOptions.length + 1)

        const cleanTable = rawTable.replace(/[`*]/g, '').trim()
        const cleanDesc = rawDesc.replace(/[`*]/g, '').trim()
        const numId = parseInt(rawId.replace(/\D/g, ''), 10)
        // 表格里的「编号」只是展示序号，不是 cfg_entry_type 主键
        const ordinal = !isNaN(numId) && numId > 0 ? numId : tableOptions.length + 1

        // 强校验：如果候选项列值是日期（如 2026-10-18）或纯数值（如 5,557），或者包含户型面积等度量，直接判定为业务数据结果，一票否决
        const isDateLike = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(cleanTable)
        const isNumLike = /^-?[\d,]+(?:\.\d+)?$/.test(cleanTable)
        const isDescNumeric = /^-?[\d,]+(?:\.\d+)?$/.test(cleanDesc)
        const isPropertyUnit = /(?:m²|㎡|室|厅|套|元)/.test(cleanTable) || /(?:m²|㎡|室|厅)/.test(cleanDesc)

        if (isDateLike || isNumLike || isPropertyUnit || (isDateLike && isDescNumeric)) {
          containsBusinessData = true
          break
        }

        if (cleanTable) {
          tableOptions.push({
            entryTypeId: null,
            ordinal,
            tableName: cleanTable,
            typeName: cleanDesc || cleanTable,
            hint: cleanDesc && cleanDesc !== cleanTable ? `编号: ${ordinal}` : null,
          })
        }
      }
      j++
    }

    // 若检测到属于业务数据（如各日期的房屋价格、成交套数），绝不作为澄清选项
    if (containsBusinessData) {
      continue
    }

    if (tableOptions.length >= 2) {
      const remainingText = lines.slice(j).join('\n') + '\n' + lines.slice(0, i).join('\n')
      const questionMatch = remainingText.match(/(?:请问|请确认|待确认|请选择|您希望)[^\n]*(?:[?？]|：|:|\n|$)/)
      const question = questionMatch ? questionMatch[0].trim() : '请选择要使用的表（可直接点击「直接使用」，或勾选多项）：'

      return {
        kind: 'table_choice',
        reason: 'TOO_MANY',
        question,
        allowFreeText: true,
        maxSelect: Math.min(5, tableOptions.length),
        options: tableOptions,
      }
    }
  }

  // 4. 匹配明确包含待确认语境下的有序/无序候选列表（* xxx、1. yyy、- zzz）
  const hasClarifyKeyword =
    /(?:待确认|请确认|请选择|候选表|可选表|数据源候选|需要您确认|需要确认|希望用哪个|用哪个来源|用哪张表|选择哪个|选择哪项|选择范围|哪个数据源|哪张表|回复.*编号|选择.*数据源)/i.test(text)
  if (hasClarifyKeyword) {
    const listLineRegex = /^\s*(?:[-*+•]|\d+[\.、]|\(\d+\)|\d+\))\s+([^\n]+)$/gm
    const listMatches = [...text.matchAll(listLineRegex)]
    if (listMatches.length >= 2) {
      // 提取提问语（优先匹配“请问您希望用哪个...？”或“待确认...：”）
      const trailingQuestionMatch = text.match(/(?:请问|您希望|另外)[^\n]*(?:用哪个|哪张|哪个来源|成交均价|还是|？|\?)[^\n]*/i)
      const leadingQuestionMatch = text.match(/(?:存在多种[^\n]*候选[^\n]*：|需要您确认[^\n]*：|待确认[^\n]*：|请确认[^\n]*：|请选择[^\n]*：)/i)
      const question = trailingQuestionMatch
        ? trailingQuestionMatch[0].trim()
        : (leadingQuestionMatch ? leadingQuestionMatch[0].trim() : '请勾选需要分析的数据源或表（支持多选，勾选后点击下方确认即可发送）：')

      const options: ClarificationOption[] = listMatches.map((m, idx) => {
        const lineText = m[1].trim()
        // 查找物理表名特征（如 sense_data.xxx 或 tb_xxx 或 TB_xxx）
        const tableMatch = lineText.match(/`?([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+_[a-zA-Z0-9_]+)`?/)
        const rawTable = tableMatch ? tableMatch[1].replace(/[`*]/g, '').trim() : ''

        // 提取说明/备注 (在 ——、—、--、:、：之后)
        let hint = ''
        const dashSplit = lineText.split(/(?:——|—|--|：|:\s+)/)
        if (dashSplit.length > 1) {
          hint = dashSplit.slice(1).join('——').replace(/[`*]/g, '').trim()
        }

        // 提取业务名称 (在括注或破折号之前)
        const cleanName = dashSplit[0]
          .replace(/[(（][^)）]*[)）]/g, '')
          .replace(/[`*]/g, '')
          .trim()

        // 如果没有从破折号拿到 hint，尝试从括号中拿说明
        if (!hint) {
          const parenMatch = lineText.match(/[(（]([^)）]+)[)）]/)
          if (parenMatch) {
            const parenContent = parenMatch[1].replace(/[`*]/g, '').trim()
            if (parenContent !== rawTable) {
              hint = parenContent
            }
          }
        }

        const typeName = cleanName || rawTable || `数据源 ${idx + 1}`
        const tableName = rawTable || cleanName || `table_${idx + 1}`

        return {
          entryTypeId: null,
          ordinal: idx + 1,
          tableName,
          typeName,
          hint: hint && hint !== typeName ? hint : null,
        }
      })

      return {
        kind: 'table_choice',
        reason: 'AMBIGUOUS',
        question,
        allowFreeText: true,
        maxSelect: Math.min(5, options.length),
        options,
      }
    }
  }

  return null
}

/**
 * 表里没数据、回答里建议「换一张表」时的动作胶囊。
 *
 * 与澄清卡片的分工：同名表二选一仍走澄清卡片（要真实 entryTypeId 才能锁定）；
 * 表已锁定但零行、模型列出一批可改查的表时，本质是让用户发起新一轮提问，
 * 用追问胶囊更贴合，也不承担「文本猜表名」导致锁错表的风险。
 * 胶囊文案只是把一句话填进输入框发送，因此这里只取展示名，不造主键。
 */
export interface TableSwitchSuggestion {
  actions: string[]
}

/** 换表意图：没有这类说法时一律不认，避免把「本次用到的表」误判成建议 */
const TABLE_SWITCH_INTENT_RE =
  /(?:建议(?:您)?(?:换|改)|换一?张(?:有数据的)?表|换张表|换表|改查|改用|改换|另一张表|其他(?:的)?表|换个?(?:数据源|来源)|可以(?:换|改)查)/

/** 物理表名特征：schema.table 或带下划线的表名；日期/金额/户型等业务值不会命中 */
const PHYSICAL_TABLE_TOKEN_RE = /^(?:[A-Za-z0-9_]+\.[A-Za-z0-9_]+|[A-Za-z0-9_]{2,}_[A-Za-z0-9_]+)$/

export function extractTableSwitchSuggestions(text: string): TableSwitchSuggestion | null {
  if (!text || typeof text !== 'string') return null
  if (!TABLE_SWITCH_INTENT_RE.test(text)) return null

  const actions: string[] = []
  const seen = new Set<string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const listMatch = /^\s*(?:[-*+•]|\d+[\.、]|\(\d+\)|\d+\))\s+(.+)$/.exec(rawLine)
    if (!listMatch) continue
    const lineText = listMatch[1].trim()

    // 只认括注/反引号里的物理表名：展示名保持原样，绝不臆造表名
    const tokenSource = lineText.replace(/`/g, '')
    const tokenMatch = /[（(]\s*([A-Za-z0-9_./]+)\s*[)）]/.exec(tokenSource)
    const token = tokenMatch ? tokenMatch[1].replace(/\/.*$/, '') : ''
    if (!token || !PHYSICAL_TABLE_TOKEN_RE.test(token)) continue

    const display = lineText
      .replace(/[（(][^)）]*[)）]/g, '')
      .replace(/[`*]/g, '')
      .trim()
      .replace(/[：:。；;，,\s]+$/, '')
    if (!display) continue

    const action = `改用「${display}」继续查询`
    if (seen.has(action)) continue
    seen.add(action)
    actions.push(action)
    if (actions.length >= 4) break
  }

  if (actions.length < 2) return null
  return { actions }
}

/**
 * 辅助方法：解析单元格中的数字与指标值
 */
function parseNumericCell(val: string): { isNum: boolean; numVal: number; display: string } {
  const clean = val.replace(/[*`]/g, '').trim()
  if (!clean) return { isNum: false, numVal: 0, display: clean }

  // 排除纯日期格式 (如 2026-10-18, 2026/10/18)
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(clean)) {
    return { isNum: false, numVal: 0, display: clean }
  }

  // 纯数字 (支持千分位与小数，如 100.7, 1,234.5, -50)
  if (/^-?[\d,]+(?:\.\d+)?$/.test(clean)) {
    const stripped = clean.replace(/,/g, '')
    if (stripped.length > 1 && stripped.startsWith('0') && !stripped.includes('.')) {
      return { isNum: false, numVal: 0, display: clean }
    }
    const n = parseFloat(stripped)
    if (!isNaN(n)) return { isNum: true, numVal: n, display: clean }
  }

  // 百分比格式 (如 97.45%, 31.79%)
  const pctMatch = clean.match(/^(-?[\d,]+(?:\.\d+)?)\s*%$/)
  if (pctMatch) {
    const n = parseFloat(pctMatch[1].replace(/,/g, ''))
    if (!isNaN(n)) return { isNum: true, numVal: n, display: clean }
  }

  // 数字带单位 (如 100.7m², 5000元, 412套, 88.5万)
  const unitMatch = clean.match(/^(-?[\d,]+(?:\.\d+)?)\s*([^\d\s]+)$/)
  if (unitMatch) {
    const n = parseFloat(unitMatch[1].replace(/,/g, ''))
    if (!isNaN(n)) return { isNum: true, numVal: n, display: clean }
  }

  return { isNum: false, numVal: 0, display: clean }
}

/**
 * 权重评估：度量指标列（数值列优先级）
 */
function scoreMetricColumn(header: string): number {
  const norm = header.replace(/[`*]/g, '').trim()
  // 序号/编号列绝不作为数值度量
  if (/^(?:编号|序号|id|index|no)$/i.test(norm)) {
    return -100
  }
  let score = 1
  if (/(价格|均价|单价|总价|金额|销售额|收入|利润|成本|price|amount|revenue|cost)/i.test(norm)) {
    score += 10
  }
  if (/(数量|套数|人数|次数|任务数|失败数|成功数|总量|总数|count|cnt|total|num)/i.test(norm)) {
    score += 8
  }
  if (/(面积|耗时|时长|延时|时间|area|duration|time)/i.test(norm)) {
    score += 6
  }
  if (/(率|占比|比例|百分比|rate|ratio|percent|pct)/i.test(norm)) {
    score += 4
  }
  return score
}

/**
 * 权重评估：维度标签列（分类/实体列优先级）
 */
function scoreLabelColumn(header: string): number {
  const norm = header.replace(/[`*]/g, '').trim()
  if (/^(?:编号|序号|id|index|no)$/i.test(norm)) {
    return -50
  }
  let score = 1
  if (/(小区|网站|名称|项目|机构|客户|商品|产品|人员|姓名|城市|省份|地区|区域|板块|site|name|title|product|item|city|region)/i.test(norm)) {
    score += 10
  }
  if (/(日期|月份|年份|时间|季度|周|date|month|year|day)/i.test(norm)) {
    score += 8
  }
  if (/(类型|类别|户型|分类|渠道|来源|状态|维度|type|category|status|channel)/i.test(norm)) {
    score += 6
  }
  return score
}

const BAR_COLORS = ['orange', 'cyan', 'indigo', 'green', 'primary', 'purple', 'red'] as const
const PALETTE_COLORS = [
  '#2563eb', // 科技蓝
  '#06b6d4', // 青蓝
  '#f59e0b', // 琥珀黄
  '#ea580c', // 橙红
  '#16a34a', // 翠绿
  '#8b5cf6', // 丁香紫
  '#dc2626', // 警示红
  '#64748b', // 沉着灰
]
const PALETTE_TONES = ['primary', 'cyan', 'amber', 'orange', 'ok', 'purple', 'err', 'muted'] as const

/**
 * 从智能体文本中自动解析业务数据 Markdown 表格并转换为 chartData 结构
 * 支持生成趋势柱状图、占比饼图与明细数据表，支持导出为 Excel/CSV
 */
export function extractChartDataFromText(text: string): NonNullable<ChatMessage['chartData']> | null {
  if (!text || typeof text !== 'string') return null

  // 1. 若文本已被判定为待确认选项表格（如选表引导），不应解析为业务数据图表
  const hasChoiceIntent =
    /请问你希望用哪张表|例如回复.*3.*或.*6|请确认.*表|请选择.*表|你希望用哪张表|回复编号/i.test(text)

  const lines = text.split('\n')
  let headerIndex = -1
  let separatorIndex = -1

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    const nextLine = lines[i + 1].trim()

    // 识别 Markdown 表头与分隔行: | --- | --- |
    if (
      line.includes('|') &&
      /^\|?(?:\s*:?-+:?\s*\|)+\s*(:?-+:?)?\s*\|?$/.test(nextLine)
    ) {
      headerIndex = i
      separatorIndex = i + 1
      break
    }
  }

  if (headerIndex === -1 || separatorIndex === -1) return null

  function parseCells(line: string): string[] {
    let trimmed = line.trim()
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
    return trimmed.split('|').map((c) => c.replace(/[*`]/g, '').trim())
  }

  const rawHeaders = parseCells(lines[headerIndex])
  const headers = rawHeaders.filter((h) => h.length > 0)
  if (headers.length < 2) return null

  // 判定是否为真正的候选表澄清引导（仅当明确为选表提问且内容为表名元数据而非业务数据行时才跳过）
  if (
    hasChoiceIntent &&
    headers.some((h) => /^(?:表名|物理表(?:名)?|候选表(?:名)?|table_name)$/i.test(h.replace(/[`*]/g, '').trim())) &&
    headers.some((h) => /(?:编号|序号|id)/i.test(h.replace(/[`*]/g, '').trim()))
  ) {
    let looksLikeData = false
    for (let r = separatorIndex + 1; r < Math.min(lines.length, separatorIndex + 5); r++) {
      const rowLine = lines[r].trim()
      if (!rowLine.includes('|')) break
      const cells = parseCells(rowLine)
      if (cells.some((c) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(c) || /(?:m²|㎡|室|厅)/.test(c))) {
        looksLikeData = true
        break
      }
    }
    if (!looksLikeData) return null
  }

  // 提取数据行
  const rows: string[][] = []
  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.includes('|')) break
    if (/^\|?(?:\s*:?-+:?\s*\|)+\s*(:?-+:?)?\s*\|?$/.test(line)) continue
    const cells = parseCells(line)
    if (cells.length > 0 && cells.some((c) => c.length > 0)) {
      rows.push(cells)
    }
  }

  if (rows.length === 0) return null

  // 2. 组装 tableColumns 与 tableRows
  const tableColumns = headers.map((header, idx) => ({
    prop: `col_${idx}`,
    label: header,
  }))

  const tableRows: Array<Record<string, unknown>> = rows.map((rowCells) => {
    const rowObj: Record<string, unknown> = {}
    headers.forEach((_, idx) => {
      const rawVal = rowCells[idx] ?? ''
      const numInfo = parseNumericCell(rawVal)
      // 纯数字转换为 number 类型，便于 Excel 正确导出数值单元格
      if (numInfo.isNum && /^-?[\d,]+(?:\.\d+)?$/.test(rawVal)) {
        rowObj[`col_${idx}`] = numInfo.numVal
      } else {
        rowObj[`col_${idx}`] = rawVal
      }
    })
    return rowObj
  })

  // 3. 列属性分析（度量指标 vs 分类维度）
  const colAnalysis = headers.map((header, idx) => {
    let numCount = 0
    rows.forEach((r) => {
      const cell = r[idx] ?? ''
      if (parseNumericCell(cell).isNum) numCount++
    })
    const isNumeric = rows.length > 0 && numCount / rows.length >= 0.5
    return {
      idx,
      prop: `col_${idx}`,
      label: header,
      isNumeric,
      metricScore: scoreMetricColumn(header),
      labelScore: scoreLabelColumn(header),
    }
  })

  const numericCols = colAnalysis.filter((c) => c.isNumeric)
  const categoryCols = colAnalysis.filter((c) => !c.isNumeric)

  let bars: NonNullable<ChatMessage['chartData']>['bars'] = []
  let slices: PieSlice[] = []
  let title = '📊 问数查询结果明细与趋势分析'
  let pieTitle = '🥧 数据占比分布'

  if (numericCols.length > 0) {
    // 挑选最佳数值度量列
    numericCols.sort((a, b) => b.metricScore - a.metricScore)
    const metricCol = numericCols[0]

    // 挑选最佳分类标签列
    categoryCols.sort((a, b) => b.labelScore - a.labelScore)
    const labelCol = categoryCols.length > 0 ? categoryCols[0] : null

    title = `📊 ${metricCol.label}趋势对比与明细`
    pieTitle = labelCol ? `🥧 ${labelCol.label}占比分布` : `🥧 ${metricCol.label}分布`

    // 生成柱状图数据 (取前 10 条)
    const topBarRows = rows.slice(0, 10)
    const numericVals = topBarRows.map((r) => parseNumericCell(r[metricCol.idx] ?? '').numVal)
    const maxVal = Math.max(...numericVals, 0)

    bars = topBarRows.map((r, idx) => {
      const labelText = labelCol ? (r[labelCol.idx] ?? `项 ${idx + 1}`) : `项 ${idx + 1}`
      const rawDisplay = r[metricCol.idx] ?? ''
      const numVal = parseNumericCell(rawDisplay).numVal
      const pct = maxVal > 0 ? Math.min(100, Math.round((numVal / maxVal) * 1000) / 10) : 0
      return {
        label: `${idx + 1}. ${labelText}`,
        value: pct,
        displayValue: rawDisplay || `${numVal}`,
        color: BAR_COLORS[idx % BAR_COLORS.length],
      }
    })

    // 生成饼图切片 (取前 7 条，剩余汇总为其他)
    const topSliceRows = rows.slice(0, 7)
    slices = topSliceRows.map((r, idx) => {
      const labelText = labelCol ? (r[labelCol.idx] ?? `项 ${idx + 1}`) : `项 ${idx + 1}`
      const rawDisplay = r[metricCol.idx] ?? ''
      const numVal = Math.max(0, parseNumericCell(rawDisplay).numVal)
      return {
        label: labelText,
        value: Math.round(numVal * 100) / 100,
        displayValue: rawDisplay || `${numVal}`,
        color: PALETTE_COLORS[idx % PALETTE_COLORS.length],
        tone: PALETTE_TONES[idx % PALETTE_TONES.length],
      }
    })

    if (rows.length > 7) {
      let otherSum = 0
      for (let i = 7; i < rows.length; i++) {
        const n = parseNumericCell(rows[i][metricCol.idx] ?? '').numVal
        if (n > 0) otherSum += n
      }
      if (otherSum > 0) {
        slices.push({
          label: '其他',
          value: Math.round(otherSum * 100) / 100,
          displayValue: `${Math.round(otherSum * 100) / 100}`,
          color: '#64748b',
          tone: 'muted',
        })
      }
    }
  } else if (categoryCols.length > 0) {
    // 无数值列时按分类列统计频次；优先挑选有重复分类（基数 < 行数）的分类列
    const groupableCols = categoryCols.filter((c) => {
      const distinctVals = new Set(rows.map((r) => r[c.idx])).size
      return distinctVals < rows.length
    })
    groupableCols.sort((a, b) => b.labelScore - a.labelScore)
    categoryCols.sort((a, b) => b.labelScore - a.labelScore)
    const catCol = groupableCols.length > 0 ? groupableCols[0] : categoryCols[0]

    title = `📊 ${catCol.label}分布统计与明细`
    pieTitle = `🥧 ${catCol.label}分布占比`

    const counts: Record<string, number> = {}
    rows.forEach((r) => {
      const val = r[catCol.idx] || '未分类'
      counts[val] = (counts[val] || 0) + 1
    })

    const sortedCats = Object.entries(counts).sort((a, b) => b[1] - a[1])
    const maxCount = sortedCats.length > 0 ? sortedCats[0][1] : 1

    bars = sortedCats.slice(0, 10).map(([cat, count], idx) => ({
      label: `${idx + 1}. ${cat}`,
      value: Math.round((count / maxCount) * 1000) / 10,
      displayValue: `${count} 条`,
      color: BAR_COLORS[idx % BAR_COLORS.length],
    }))

    slices = sortedCats.slice(0, 7).map(([cat, count], idx) => ({
      label: cat,
      value: count,
      displayValue: `${count} 条`,
      color: PALETTE_COLORS[idx % PALETTE_COLORS.length],
      tone: PALETTE_TONES[idx % PALETTE_TONES.length],
    }))

    if (sortedCats.length > 7) {
      const otherCount = sortedCats.slice(7).reduce((acc, [, c]) => acc + c, 0)
      slices.push({
        label: '其他',
        value: otherCount,
        displayValue: `${otherCount} 条`,
        color: '#64748b',
        tone: 'muted',
      })
    }
  }

  return {
    title,
    pieTitle,
    tableColumns,
    tableRows,
    bars,
    slices,
  }
}

/**
 * 智能体问数：对接后端 POST /api/poc/chat/agent
 * 后端 AgentService 接收 { msg, thread_id } 并以 SSE (text/event-stream) 格式原样透传智能体流式响应。
 */
export async function streamAgentChat(
  params: AgentChatParams,
  onEvent: (event: AgentChatEvent) => void,
): Promise<void> {
  const payload: Record<string, unknown> = { msg: params.msg }
  if (params.thread_id) {
    payload.thread_id = params.thread_id
  }
  if (params.session_id !== undefined && params.session_id !== null && params.session_id !== 'new') {
    payload.session_id = params.session_id
  }
  if (params.user_id !== undefined && params.user_id !== null) {
    payload.user_id = params.user_id
  }
  const response = await fetch('/api/poc/chat/agent', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal: params.signal,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const errJson = await response.json()
      detail = errJson.message || errJson.msg || ''
    } catch {
      detail = await response.text().catch(() => '')
    }
    const errMsg = `智能体服务请求失败(HTTP ${response.status})${detail ? ': ' + detail : ''}`
    onEvent({ type: 'error', error: errMsg })
    throw new Error(errMsg)
  }

  const headerSessionId = response.headers?.get ? response.headers.get('X-Session-Id') : null
  const headerThreadId = response.headers?.get ? response.headers.get('X-Thread-Id') : null
  if (headerSessionId || headerThreadId) {
    onEvent({
      type: 'session_assigned',
      sessionId: headerSessionId || '',
      threadId: headerThreadId || '',
    })
  }

  if (!response.body) {
    const errMsg = '浏览器未提供流式响应体'
    onEvent({ type: 'error', error: errMsg })
    throw new Error(errMsg)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let completed = false

  const abortListener = () => {
    reader.cancel().catch(() => {})
  }
  if (params.signal) {
    if (params.signal.aborted) {
      await reader.cancel().catch(() => {})
      throw new DOMException('The user aborted a request.', 'AbortError')
    }
    params.signal.addEventListener('abort', abortListener, { once: true })
  }

  // 思考链累积 + 结构化澄清下发：外部智能体把 MCP 工具结果写进 reasoning，
  // 选表命中多候选时只有这段 JSON 带真实 entryTypeId（正文可能一个字都没列）。
  let reasoningBuffer = ''
  let emittedClarificationSignature = ''

  function emitStructuredClarification(clarification: Clarification) {
    const signature = JSON.stringify(clarification)
    if (signature === emittedClarificationSignature) return
    emittedClarificationSignature = signature
    onEvent({ type: 'clarification', clarification })
  }

  function tryEmitClarificationFromReasoning() {
    const fromReasoning = extractClarificationFromReasoning(reasoningBuffer)
    if (fromReasoning) emitStructuredClarification(fromReasoning)
  }

  /** 追加思考链；只有出现 `}`/`]`（可能收全一段工具结果 JSON）时才重新扫描，避免逐 token 全量重解析 */
  function appendReasoning(text: string) {
    reasoningBuffer = (reasoningBuffer + text).slice(-400_000)
    if (!reasoningBuffer.includes('[工具结果]')) return
    if (!/[}\]]/.test(text)) return
    tryEmitClarificationFromReasoning()
  }

  function consumeLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return

    let dataStr = trimmed
    if (dataStr.startsWith('data:')) {
      dataStr = dataStr.slice(5).trim()
    }

    if (dataStr === '[DONE]') {
      completed = true
      tryEmitClarificationFromReasoning()
      onEvent({ type: 'done' })
      return
    }

    try {
      const payload = JSON.parse(dataStr)
      if (payload && typeof payload === 'object') {
        if (payload.error) {
          const errText =
            typeof payload.error === 'object'
              ? payload.error.message || JSON.stringify(payload.error)
              : String(payload.error)
          onEvent({ type: 'error', error: errText })
          return
        }

        // 检查是否有待确认/澄清载荷 (Clarification)
        const choice = Array.isArray(payload.choices) && payload.choices.length > 0 ? payload.choices[0] : null
        const delta = choice?.delta || choice?.message
        const rawClarification =
          payload.clarification ||
          payload.data?.clarification ||
          delta?.clarification ||
          (payload.type === 'clarification' ? (payload.data || payload) : null)

        const structuredDraft = tableDraftFromPayload(payload) ?? tableDraftFromPayload(payload.data)
        if (structuredDraft) onEvent({ type: 'table_draft', draft: structuredDraft })

        if (
          rawClarification &&
          typeof rawClarification === 'object' &&
          (Array.isArray(rawClarification.options) || rawClarification.kind === 'free_text' || rawClarification.question)
        ) {
          const clarificationObj = normalizeClarificationPayload(rawClarification)
          if (clarificationObj) emitStructuredClarification(clarificationObj)
        }

        // OpenAI 兼容 choices 结构: { choices: [{ delta: { content, reasoning_content } }] }
        if (Array.isArray(payload.choices) && payload.choices.length > 0) {
          const choice = payload.choices[0]
          const delta = choice?.delta || choice?.message
          if (delta) {
            const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thought
            if (reasoning) {
              const reasoningText = String(reasoning)
              onEvent({ type: 'reasoning', reasoning: reasoningText })
              appendReasoning(reasoningText)
            }
            let text = ''
            if (typeof delta.content === 'string') {
              text = delta.content
            } else if (Array.isArray(delta.content)) {
              text = delta.content
                .map((item: unknown) =>
                  typeof item === 'string'
                    ? item
                    : (item as { text?: string })?.text || ''
                )
                .join('')
            } else if (typeof delta.text === 'string') {
              text = delta.text
            }
            if (text) {
              onEvent({ type: 'chunk', text })
            }
          }
          return
        }

        const topReasoning = payload.reasoning_content ?? payload.reasoning
        if (typeof topReasoning === 'string') {
          onEvent({ type: 'reasoning', reasoning: topReasoning })
          appendReasoning(topReasoning)
          return
        }

        if (typeof payload.content === 'string') {
          onEvent({ type: 'chunk', text: payload.content })
          return
        }
        if (typeof payload.reply === 'string') {
          onEvent({ type: 'chunk', text: payload.reply })
          return
        }
        if (typeof payload.text === 'string') {
          onEvent({ type: 'chunk', text: payload.text })
          return
        }
      }
    } catch {
      onEvent({ type: 'chunk', text: dataStr })
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (params.signal?.aborted) {
        throw new DOMException('The user aborted a request.', 'AbortError')
      }
      pending += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        consumeLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
      if (done) break
    }
    if (params.signal?.aborted) {
      throw new DOMException('The user aborted a request.', 'AbortError')
    }
    if (pending.trim()) {
      consumeLine(pending)
    }
    if (!completed) {
      tryEmitClarificationFromReasoning()
      onEvent({ type: 'done' })
    }
  } finally {
    if (params.signal) {
      params.signal.removeEventListener('abort', abortListener)
    }
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/**
 * 获取推荐问数场景（配置于页面配置 sys_page_config，对应后端 GET /api/poc/chat/help/question）。
 * 返回问句文本列表，若未配置或异常时返回空数组由前端回退到默认卡片。
 */
export async function listRecommendedQuestions(): Promise<string[]> {
  try {
    const res = await request<string[] | { data?: string[] } | null>(
      'poc/chat/help/question',
      undefined,
      {
        method: 'GET',
        httpEndpoint: `${POC_API_PREFIX}/chat/help/question`,
      },
    )
    if (Array.isArray(res)) {
      return res.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
    if (res && Array.isArray((res as { data?: unknown[] }).data)) {
      return (res as { data: unknown[] }).data.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    }
    return []
  } catch (error) {
    console.warn('[listRecommendedQuestions] 获取推荐问句失败，使用默认卡片:', error)
    return []
  }
}
