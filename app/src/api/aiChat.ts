// AI 智能问数（ChatBI / Agent 交互）API 封装
import { request } from './client'
import { POC_API_PREFIX } from '@/constants/backend'

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
  interrupted?: boolean
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
    const tableColIdx = headerCells.findIndex((h) => /(?:表名|表|table|候选|数据表|物理表)/i.test(h))
    const descColIdx = headerCells.findIndex((h) => /(?:说明|描述|含义|备注|注释|desc|comment|业务)/i.test(h))

    const effTableCol = tableColIdx !== -1 ? tableColIdx : (headerCells.length > 2 ? 1 : 0)
    const effDescCol = descColIdx !== -1 ? descColIdx : (headerCells.length > 2 ? 2 : 1)
    const effIdCol = idColIdx !== -1 ? idColIdx : (tableColIdx > 0 ? 0 : -1)

    const tableOptions: ClarificationOption[] = []
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
        const entryTypeId = !isNaN(numId) && numId > 0 ? numId : tableOptions.length + 1

        if (cleanTable) {
          tableOptions.push({
            entryTypeId,
            tableName: cleanTable,
            typeName: cleanDesc || cleanTable,
            hint: cleanDesc && cleanDesc !== cleanTable ? `编号: ${entryTypeId}` : null,
          })
        }
      }
      j++
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
        maxSelect: Math.max(5, tableOptions.length),
        options: tableOptions,
      }
    }
  }

  // 4. 匹配明确包含“待确认/请确认/请选择候选表”语境下的编号候选列表（1. xxx 2. yyy）
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
  let score = 1
  if (/(价格|均价|单价|总价|金额|销售额|收入|利润|成本|price|amount|revenue|cost)/i.test(header)) {
    score += 10
  }
  if (/(数量|套数|人数|次数|任务数|失败数|成功数|总量|总数|count|cnt|total|num)/i.test(header)) {
    score += 8
  }
  if (/(面积|耗时|时长|延时|时间|area|duration|time)/i.test(header)) {
    score += 6
  }
  if (/(率|占比|比例|百分比|rate|ratio|percent|pct)/i.test(header)) {
    score += 4
  }
  return score
}

/**
 * 权重评估：维度标签列（分类/实体列优先级）
 */
function scoreLabelColumn(header: string): number {
  let score = 1
  if (/(小区|网站|名称|项目|机构|客户|商品|产品|人员|姓名|城市|省份|地区|区域|板块|site|name|title|product|item|city|region)/i.test(header)) {
    score += 10
  }
  if (/(类型|类别|户型|分类|渠道|来源|状态|维度|type|category|status|channel)/i.test(header)) {
    score += 6
  }
  if (/(日期|月份|年份|时间|季度|周|date|month|year|day)/i.test(header)) {
    score += 4
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

  // 判定是否为候选表澄清引导
  const isCandidateTable =
    hasChoiceIntent &&
    headers.some((h) => /(表名|物理表|候选表)/.test(h)) &&
    headers.some((h) => /(编号|序号|id)/i.test(h))
  if (isCandidateTable) return null

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
 * 回传多选表/指标澄清的答案（entryTypeId 列表 + 自由补充）。
 *
 * 网关侧按 { sessionId, round, selectedEntryTypeIds, freeText } 交给智能体，
 * 由它用 submit_table_selection(selected_entry_type_ids=...) 推进同一会话。
 */
export async function submitClarificationAnswer(answer: ClarificationAnswer): Promise<void> {
  await request<unknown>(EP.clarification, { ...answer }, { method: 'POST' })
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
