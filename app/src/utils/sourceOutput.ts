/**
 * 源产出（1114 源产出监控，方案 `设计稿/设计方案/1114-源产出监控_开发计划_2026-11-16.md` §3）。
 *
 * 源列表的「数据 / 新入」只反映主表；布鲁金斯这类源的主表是源码表，每小时下载都会刷新，详情停更看不出来。
 * 「产出」列改看**详情表**（2026-11-16 用户定）：
 * - 主表不是源码表 / 附件表、且流程写了主表：只看主表（主表就是这个源的产出，旁边调试用的 copy 表再新也不能盖住主表停更）；
 * - 主表是源码表（或流程没写主表）：输出表里去掉源码表、附件表后，取最近入库最晚的一张。
 * 一期 A 只给出详情最近入库时间；结论（停更 / 正常）要等目录预期周期，见方案 §3.3 一期 B。
 */
import type { SourceOutputTable } from '@/api'

/** 不算「产出」的表：源码表、附件表。按表 ID（217）或物理表名（各环境一致）识别 */
const NON_DETAIL_ENTRY_IDS = new Set(['6200023', '6200020'])
const NON_DETAIL_TABLE_NAMES = new Set(['tb_source_code', 'tb_fjzyb'])

export function isDetailTable(table: SourceOutputTable): boolean {
  if (NON_DETAIL_ENTRY_IDS.has(table.entryTypeId)) return false
  return !NON_DETAIL_TABLE_NAMES.has(table.tableName.replace(/^.*\./, '').toLowerCase())
}

export type SourceOutputSummary =
  /** 去掉源码表、附件表后没有输出表 */
  | { kind: 'none' }
  /** 详情表都统计失败（dataCnt -1，含物理表不存在）或都没有表定义（-2） */
  | { kind: 'error'; table: SourceOutputTable; basis: SourceOutputBasis }
  /** 详情表存在但从未入库 */
  | { kind: 'never'; table: SourceOutputTable; basis: SourceOutputBasis }
  | { kind: 'ok'; table: SourceOutputTable; lastInsertAt: string; basis: SourceOutputBasis }

/** 依据：main = 源的主表；latest = 主表是源码表时，其余输出表里最近入库最晚的一张 */
export type SourceOutputBasis = 'main' | 'latest'

function timeOf(value?: string): number {
  if (!value) return Number.NaN
  return new Date(value.includes('T') ? value : value.replace(' ', 'T')).getTime()
}

function summarizeTable(table: SourceOutputTable, basis: SourceOutputBasis): SourceOutputSummary {
  if (table.dataCount < 0) return { kind: 'error', table, basis }
  if (Number.isNaN(timeOf(table.lastInsertAt))) return { kind: 'never', table, basis }
  return { kind: 'ok', table, lastInsertAt: table.lastInsertAt!, basis }
}

/**
 * 判断产出用哪张表（方案 §3.3）：
 * 1. 传了主表 ID、主表不是源码表 / 附件表、且在输出表里 → 只看主表；
 * 2. 否则详情表里有入库时间的取最晚一张（任一张有新增即视为有产出）；都没有入库时间时，有能统计的表 = 从未入库，否则 = 统计异常。
 */
export function summarizeSourceOutput(tables: SourceOutputTable[], mainTableId?: string): SourceOutputSummary {
  const main = mainTableId ? tables.find((table) => table.entryTypeId === String(mainTableId)) : undefined
  if (main && isDetailTable(main)) return summarizeTable(main, 'main')
  const details = tables.filter(isDetailTable)
  if (!details.length) return { kind: 'none' }
  let latest: SourceOutputTable | undefined
  for (const table of details) {
    if (table.dataCount < 0 || Number.isNaN(timeOf(table.lastInsertAt))) continue
    if (!latest || timeOf(table.lastInsertAt) > timeOf(latest.lastInsertAt)) latest = table
  }
  if (latest) return { kind: 'ok', table: latest, lastInsertAt: latest.lastInsertAt!, basis: 'latest' }
  const countable = details.find((table) => table.dataCount >= 0)
  return countable ? { kind: 'never', table: countable, basis: 'latest' } : { kind: 'error', table: details[0], basis: 'latest' }
}

/** 数据量的展示文字：-1 / -2 是后端哨兵，不显示负数 */
export function outputCountText(count: number): string {
  if (count === -1) return '统计异常'
  // -2 只表示没有表定义（ROOT 已在适配器里滤掉，这里是 outEntry 查不到表类型）；物理表不存在走 -1
  if (count === -2) return '表未定义'
  return count.toLocaleString()
}

/** 今年的写「11-14 04:11」，不是今年的写「2025-10-30」（停更一年的源只看月日会误读成最近） */
export function shortDateTime(value?: string, now = new Date()): string {
  const t = timeOf(value)
  if (Number.isNaN(t)) return value || '—'
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 写入步骤折叠：「列表解析」/「列表解析 等 4 个」 */
export function stepsText(steps: SourceOutputTable['steps']): string {
  if (!steps.length) return '—'
  return steps.length === 1 ? steps[0].stepName || steps[0].stepId : `${steps[0].stepName || steps[0].stepId} 等 ${steps.length} 个`
}

// ---------------- 产出结论（1114 一期 B，方案 §3.3） ----------------

/** 结论：停更 / 统计异常 / 正常 / 未配置周期 / 无详情表 */
export type OutputVerdict = 'stale' | 'error' | 'ok' | 'unconfigured' | 'none'

export const OUTPUT_VERDICT_LABEL: Record<OutputVerdict, string> = {
  stale: '详情停更',
  error: '统计异常',
  ok: '正常',
  unconfigured: '未配置周期',
  none: '无详情表',
}

/** 宽限：周期 ≤ 1 天给 6 小时，否则给周期的 25%（方案 §3.3，后续可配） */
export function graceHours(cycleHours: number): number {
  return cycleHours <= 24 ? 6 : cycleHours * 0.25
}

export interface OutputJudgement {
  verdict: OutputVerdict
  /** 停更时：距最近入库多少小时（从未入库为 undefined） */
  staleHours?: number
  cycleHours?: number
  graceHours?: number
}

/**
 * 结论按优先级判（方案 §3.3）：未配置周期 > 无详情表 > 统计异常（含接口失败）> 详情停更 > 正常。
 * `summary` 为 undefined 表示接口失败；`cycleHours` 为 undefined 表示源所在业务目录都没设周期。
 * 从未入库 = 停更（有周期却一条没有）。
 */
export function judgeSourceOutput(summary: SourceOutputSummary | undefined, cycleHours: number | undefined, now = Date.now()): OutputJudgement {
  if (!cycleHours) return { verdict: 'unconfigured' }
  const grace = graceHours(cycleHours)
  if (summary?.kind === 'none') return { verdict: 'none', cycleHours, graceHours: grace }
  if (!summary || summary.kind === 'error') return { verdict: 'error', cycleHours, graceHours: grace }
  if (summary.kind === 'never') return { verdict: 'stale', cycleHours, graceHours: grace }
  const gap = (now - timeOf(summary.lastInsertAt)) / 3_600_000
  return gap > cycleHours + grace
    ? { verdict: 'stale', staleHours: gap, cycleHours, graceHours: grace }
    : { verdict: 'ok', cycleHours, graceHours: grace }
}

/** 「3 天」「5 小时」：停更时长，按天取整，不足 1 天按小时 */
export function durationText(hours: number): string {
  if (hours >= 24) return `${Math.floor(hours / 24)} 天`
  return `${Math.max(1, Math.floor(hours))} 小时`
}
