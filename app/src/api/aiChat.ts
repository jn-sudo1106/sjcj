// AI 智能问数（ChatBI / Agent 交互）API 封装
import { request } from './client'

export interface AiSessionItem {
  id: string
  title: string
  updatedAt: string
  group: 'today' | 'week' | 'earlier'
}

export interface AiAgentOption {
  id: string
  name: string
  desc: string
  icon: string
}

export interface ClarificationOption {
  /** cfg_entry_type 主键：回传时用它锁定，不按表名匹配 */
  entryTypeId: number
  tableName: string
  typeName?: string | null
  /** 区分点（明细/汇总、来源网站等） */
  hint?: string | null
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

/** 用户在卡片上确认后回传给智能体的结构化答案。 */
export interface ClarificationAnswer {
  sessionId: string
  round: number
  selectedEntryTypeIds: number[]
  freeText?: string
}

export interface PieSlice {
  label: string
  value: number
  displayValue?: string
  color?: string
  tone?: 'primary' | 'cyan' | 'indigo' | 'amber' | 'ok' | 'err' | 'muted' | 'orange' | 'purple'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
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
  }
  sql?: {
    code: string
    execTimeMs: number
    scanRows: number
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
}

const EP = {
  sessions: 'ai/chat/sessions',
  agents: 'ai/chat/agents',
  completion: 'ai/chat/completion',
  clarification: 'ai/chat/clarification',
} as const

export async function listAiSessions(): Promise<AiSessionItem[]> {
  try {
    return await request<AiSessionItem[]>(EP.sessions, {}, { method: 'GET' })
  } catch {
    return []
  }
}

export async function listAiAgents(): Promise<AiAgentOption[]> {
  try {
    return await request<AiAgentOption[]>(EP.agents, {}, { method: 'GET' })
  } catch {
    return []
  }
}

/** 智能体问数流式调用入参 */
export interface AgentChatParams {
  msg: string
  thread_id?: string
  signal?: AbortSignal
}

/** 智能体问数流式事件 */
export type AgentChatEvent =
  | { type: 'chunk'; text: string }
  | { type: 'reasoning'; reasoning: string }
  | { type: 'clarification'; clarification: Clarification }
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
          maxSelect: typeof data.maxSelect === 'number' ? data.maxSelect : 5,
          options: data.options.map((opt: Record<string, unknown>, idx: number) => ({
            entryTypeId: Number(opt.entryTypeId ?? opt.id ?? idx + 1),
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
        entryTypeId: idx + 1,
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
      maxSelect: Math.max(5, options.length),
      options,
    }
  }

  // 3. 匹配明确包含“待确认/请确认/请选择候选表”语境下的编号候选列表（1. xxx 2. yyy）
  const hasClarifyKeyword = /(?:待确认|请确认|请选择|候选表如下|可选表清单|需要您确认)/.test(text)
  if (hasClarifyKeyword) {
    const numberedListRegex = /^\s*\d+[\.、]\s*([^\n]+)$/gm
    const numberedMatches = [...text.matchAll(numberedListRegex)]
    if (numberedMatches.length >= 2) {
      const questionMatch = text.match(/(?:待确认|请确认|请选择|候选表)[^:\n：]*[：:]?/i)
      const question = questionMatch ? questionMatch[0] : '请勾选需要确认的项：'

      const options: ClarificationOption[] = numberedMatches.map((m, idx) => {
        const lineText = m[1].trim()
        const tableMatch = lineText.match(/`?([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+|[a-zA-Z0-9_]+_[a-zA-Z0-9_]+)`?/)
        const hintMatch = lineText.match(/[(（]([^)）]+)[)）]/)

        let cleanName = lineText
          .replace(/[(（][^)）]+[)）]/g, '')
          .replace(/[`*]/g, '')
          .trim()
        if (cleanName.includes('：')) cleanName = cleanName.split('：')[1].trim()
        if (cleanName.includes('-')) cleanName = cleanName.split('-')[1].trim()

        const tableName = tableMatch ? tableMatch[1] : (cleanName || `item_${idx + 1}`)
        const typeName = cleanName || tableName

        return {
          entryTypeId: idx + 1,
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
        maxSelect: Math.max(5, options.length),
        options,
      }
    }
  }

  return null
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

  if (!response.body) {
    const errMsg = '浏览器未提供流式响应体'
    onEvent({ type: 'error', error: errMsg })
    throw new Error(errMsg)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let completed = false

  function consumeLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return

    let dataStr = trimmed
    if (dataStr.startsWith('data:')) {
      dataStr = dataStr.slice(5).trim()
    }

    if (dataStr === '[DONE]') {
      completed = true
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

        if (
          rawClarification &&
          typeof rawClarification === 'object' &&
          (Array.isArray(rawClarification.options) || rawClarification.kind === 'free_text' || rawClarification.question)
        ) {
          const kind: ClarificationKind = rawClarification.kind || 'table_choice'
          const options: ClarificationOption[] = Array.isArray(rawClarification.options)
            ? rawClarification.options.map((opt: Record<string, unknown>, idx: number) => ({
                entryTypeId: Number(opt.entryTypeId ?? opt.id ?? idx + 1),
                tableName: String(opt.tableName || opt.name || opt.table || `table_${idx + 1}`),
                typeName: String(opt.typeName || opt.label || opt.title || opt.tableName || `候选 ${idx + 1}`),
                hint: opt.hint ? String(opt.hint) : (opt.description ? String(opt.description) : null),
              }))
            : []
          const clarificationObj: Clarification = {
            kind,
            reason: rawClarification.reason || 'AMBIGUOUS',
            question: rawClarification.question || '请确认需要分析的表或口径：',
            allowFreeText: rawClarification.allowFreeText ?? true,
            maxSelect: typeof rawClarification.maxSelect === 'number' ? rawClarification.maxSelect : 5,
            options,
          }
          onEvent({ type: 'clarification', clarification: clarificationObj })
        }

        // OpenAI 兼容 choices 结构: { choices: [{ delta: { content, reasoning_content } }] }
        if (Array.isArray(payload.choices) && payload.choices.length > 0) {
          const choice = payload.choices[0]
          const delta = choice?.delta || choice?.message
          if (delta) {
            const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thought
            if (reasoning) {
              onEvent({ type: 'reasoning', reasoning: String(reasoning) })
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
      pending += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        consumeLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
      }
      if (done) break
    }
    if (pending.trim()) {
      consumeLine(pending)
    }
    if (!completed) {
      onEvent({ type: 'done' })
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/**
 * 回传多选表/指标澄清的答案（entryTypeId 列表 + 自由补充）。
 *
 * 网关侧按 { sessionId, round, selectedEntryTypeIds, freeText } 交给智能体，
 * 由它用 submit_table_selection(selected_entry_type_ids=...) 推进同一会话。
 */
export async function submitClarificationAnswer(answer: ClarificationAnswer): Promise<void> {
  await request<unknown>(EP.clarification, { ...answer }, { method: 'POST' })
}
