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
  joinWith?: 'AND' | 'OR'
}

export interface ParsedConditionExpr {
  logic: 'AND' | 'OR'
  items: ParsedCondition[]
}

function quoteValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** 纯数字值不加引号（NEXT_FLAG == 40597 这类运行时标记/任务规格 ID 比较是裸数字，
 *  加引号后执行侧 '40597' != 40597 就不生效了）。代价：`K2 == '12345'` 这种"看着像数字的
 *  字符串"往返后会变成裸数字——真实条件里没见过这种写法（值都是 'api'/'pdf' 之类文本）。 */
function isNumericLiteral(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value)
}
function emitValue(value: string): string {
  return isNumericLiteral(value) ? value : quoteValue(value)
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
    case 'eq': return `${field} == ${emitValue(value)}`
    case 'ne': return `${field} != ${emitValue(value)}`
    case 'gt': return `${field} > ${emitValue(value)}`
    case 'lt': return `${field} < ${emitValue(value)}`
  }
}

/** 条件项列表 → 完整表达式；field 传物理列名，空 field 的行跳过 */
export function conditionsToExpr(items: ParsedCondition[], logic: 'AND' | 'OR'): string {
  return items.filter((item) => item.field).reduce((expr, item) => {
    const term = conditionTermToExpr(item.field, item.op, item.value)
    return expr ? `${expr}${(item.joinWith ?? logic) === 'OR' ? ' || ' : ' && '}${term}` : term
  }, '')
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
// 值可以是单引号字符串或裸数字（NEXT_FLAG == 40597）
const VAL = `(?:${STR}|-?\\d+(?:\\.\\d+)?)`
const TERM_PATTERNS: { re: RegExp; op: ConditionOp; hasValue: boolean }[] = [
  { re: new RegExp(`^(${IDENT})\\s*==\\s*nil$`), op: 'isEmpty', hasValue: false },
  // != 与 Lua 的 ~= 都收：真实数据用 !=，~= 是 Lua 原生写法，读进来不报错更稳
  { re: new RegExp(`^(${IDENT})\\s*(?:!=|~=)\\s*nil$`), op: 'notEmpty', hasValue: false },
  { re: new RegExp(`^!\\s*string\\.contains\\(\\s*(${IDENT})\\s*,\\s*(${STR})\\s*\\)$`), op: 'notContains', hasValue: true },
  { re: new RegExp(`^string\\.contains\\(\\s*(${IDENT})\\s*,\\s*(${STR})\\s*\\)$`), op: 'contains', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*==\\s*(${VAL})$`), op: 'eq', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*(?:!=|~=)\\s*(${VAL})$`), op: 'ne', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*>\\s*(${VAL})$`), op: 'gt', hasValue: true },
  { re: new RegExp(`^(${IDENT})\\s*<\\s*(${VAL})$`), op: 'lt', hasValue: true },
]

function parseTerm(raw: string): ParsedCondition | null {
  const term = raw.trim()
  for (const { re, op, hasValue } of TERM_PATTERNS) {
    const m = re.exec(term)
    if (!m) continue
    if (!hasValue) return { field: m[1], op, value: '' }
    // 裸数字原样、带引号的去引号
    return { field: m[1], op, value: m[2].startsWith("'") ? unquoteValue(m[2]) : m[2] }
  }
  return null
}

/**
 * 表达式 → 结构化条件项。每个连接符归到后一项；复杂嵌套或无法识别的项仍退回原文。
 */
export function parseConditionExpr(expr: string | undefined): ParsedConditionExpr | null {
  const trimmed = expr?.trim()
  if (!trimmed) return null
  const split = splitTopLevel(trimmed)
  if (!split) return null
  const { parts, joiners } = split
  const mixed = new Set(joiners).size > 1
  const items: ParsedCondition[] = []
  for (const [index, part] of parts.entries()) {
    const item = parseTerm(part)
    if (!item) return null
    items.push(index && mixed ? { ...item, joinWith: joiners[index - 1] as 'AND' | 'OR' } : item)
  }
  if (!items.length) return null
  return { logic: joiners[0] === 'OR' ? 'OR' : 'AND', items }
}
