// 进入条件表达式（Step.cond）的解析与生成。
//
// 2026-08-26 生产实测：扫了 200 个源 / 300 条带条件的步骤，真实 cond 只有这几种写法——
//   K17==nil                                        字段为空
//   K5 == nil / K2 !=nil / K15 ==nil                空格随意
//   K19 == nil && K5==nil                           && 连接
//   K12==nil || K15 ==nil                           || 连接
//   K17 != nil && !string.contains(K2,'weixin.qq')  函数调用 + 取反
//   NEXT_FLAG == nil                                标识符不一定是 K 列（运行时标记）
// 全部是这套 Lua 风格语法：== / != / && / || / nil / string.contains / 单引号字符串。
// 300 条样本里没有一条用 AND / OR / CONTAINS / IS NOT EMPTY / 双引号——旧前端曾按后者生成，
// 那套语法执行侧根本不认，等于写出去的条件不生效，故本模块统一按真实语法读写。
//
// 标识符用物理列名（K1/K2/...），不是字段的业务标识 itemCode——两者不是一套命名空间，
// 映射在调用方（ConditionRow）做，本模块只认列名。

import type { ConditionOp } from '@/views/FlowCanvas/canvas/flowModel'

/** 解析结果的单个条件项；field 是物理列名 */
export interface ParsedCondition {
  field: string
  op: ConditionOp
  value: string
}

export interface ParsedConditionExpr {
  logic: 'AND' | 'OR'
  items: ParsedCondition[]
}

function quoteValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function unquoteValue(raw: string): string {
  const body = raw.slice(1, -1)
  return body.replace(/\\(['\\])/g, '$1')
}

/** 单个条件项 → 真实语法片段 */
export function conditionTermToExpr(field: string, op: ConditionOp, value: string): string {
  switch (op) {
    case 'isEmpty': return `${field} == nil`
    case 'notEmpty': return `${field} != nil`
    case 'contains': return `string.contains(${field},${quoteValue(value)})`
    case 'notContains': return `!string.contains(${field},${quoteValue(value)})`
    case 'eq': return `${field} == ${quoteValue(value)}`
    case 'ne': return `${field} != ${quoteValue(value)}`
    case 'gt': return `${field} > ${quoteValue(value)}`
    case 'lt': return `${field} < ${quoteValue(value)}`
  }
}

/** 条件项列表 → 完整表达式；field 传物理列名，空 field 的行跳过 */
export function conditionsToExpr(items: ParsedCondition[], logic: 'AND' | 'OR'): string {
  const joiner = logic === 'OR' ? ' || ' : ' && '
  return items
    .filter((item) => item.field)
    .map((item) => conditionTermToExpr(item.field, item.op, item.value))
    .join(joiner)
}

/** 按顶层 && / || 切分：引号内和括号内的分隔符不算（string.contains(K2,'a&&b') 不会被切开） */
function splitTopLevel(expr: string): { parts: string[]; joiners: string[] } | null {
  const parts: string[] = []
  const joiners: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; continue }
    if (ch === '(') { depth++; continue }
    if (ch === ')') { depth--; continue }
    if (depth !== 0) continue
    const pair = expr.slice(i, i + 2)
    if (pair === '&&' || pair === '||') {
      parts.push(expr.slice(start, i))
      joiners.push(pair === '&&' ? 'AND' : 'OR')
      i++
      start = i + 1
    }
  }
  if (quote || depth !== 0) return null // 引号/括号不闭合，不猜
  parts.push(expr.slice(start))
  return { parts, joiners }
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*"
const STR = "'(?:[^'\\\\]|\\\\.)*'"
const TERM_PATTERNS: { re: RegExp; op: ConditionOp; hasValue: boolean }[] = [
  { re: new RegExp(`^(${IDENT})\\s*==\\s*nil$`), op: 'isEmpty', hasValue: false },
  // != 与 Lua 的 ~= 都收：真实数据用 !=，~= 是 Lua 原生写法，读进来不报错更稳
  { re: new RegExp(`^(${IDENT})\\s*(?:!=|~=)\\s*nil$`), op: 'notEmpty', hasValue: false },
  { re: new RegExp(`^!\\s*string\\.contains\\(\\s*(${IDENT})\\s*,\\s*(${STR})\\s*\\)$`), op: 'notContains', hasValue: true },
  { re: new RegExp(`^string\\.contains\\(\\s*(${IDENT})\\s*,\\s*(${STR})\\s*\\)$`), op: 'contains', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*==\\s*(${STR})$`), op: 'eq', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*(?:!=|~=)\\s*(${STR})$`), op: 'ne', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*>\\s*(${STR})$`), op: 'gt', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*<\\s*(${STR})$`), op: 'lt', hasValue: true },
]

function parseTerm(raw: string): ParsedCondition | null {
  const term = raw.trim()
  for (const { re, op, hasValue } of TERM_PATTERNS) {
    const m = re.exec(term)
    if (m) return { field: m[1], op, value: hasValue ? unquoteValue(m[2]) : '' }
  }
  return null
}

/**
 * 表达式 → 结构化条件项。任何一项解析不了、或 && 和 || 混用（当前数据模型只有一个 logic，
 * 表达不了混合优先级）就整体返回 null——宁可退回原始文本只读，也不要解析出一个和原意不同的条件。
 */
export function parseConditionExpr(expr: string | undefined): ParsedConditionExpr | null {
  const trimmed = expr?.trim()
  if (!trimmed) return null
  const split = splitTopLevel(trimmed)
  if (!split) return null
  const { parts, joiners } = split
  if (new Set(joiners).size > 1) return null
  const items: ParsedCondition[] = []
  for (const part of parts) {
    const item = parseTerm(part)
    if (!item) return null
    items.push(item)
  }
  if (!items.length) return null
  return { logic: joiners[0] === 'OR' ? 'OR' : 'AND', items }
}
