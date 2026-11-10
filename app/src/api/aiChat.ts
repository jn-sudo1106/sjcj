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
    bars: Array<{ label: string; value: number; displayValue: string; color?: string }>
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
    // 降级兜底预置会话
    return [
      { id: 's1', title: '排查近期异常任务与成功率', updatedAt: '刚刚', group: 'today' },
      { id: 's2', title: '昨日异常抓取任务TOP10分析', updatedAt: '2小时前', group: 'today' },
      { id: 's3', title: '各网站抓取平均耗时与并发量', updatedAt: '3天前', group: 'week' },
      { id: 's4', title: '字段清洗规则命中率统计报表', updatedAt: '5天前', group: 'week' },
    ]
  }
}

export async function listAiAgents(): Promise<AiAgentOption[]> {
  try {
    return await request<AiAgentOption[]>(EP.agents, {}, { method: 'GET' })
  } catch {
    return [
      { id: 'data-analyst', name: '数据分析智能体 (ChatBI)', desc: '意图拆解、SQL取数与可视化图表生成', icon: 'Histogram' },
      { id: 'sql-expert', name: 'Text-to-SQL 专家', desc: '精准只读 SQL 生成与优化建议', icon: 'Document' },
      { id: 'monitor-advisor', name: '采集监控与诊断助手', desc: '抓取异常诊断与反爬建议', icon: 'Monitor' },
    ]
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
