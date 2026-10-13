// 任务统计的**纯计算**部分（旧 page/inst/TaskStat.vue 的 computed / methods 里与 UI 无关的那些）。
// 单独成文件是为了能直接单测：合并两路响应、分组标签、占比、错误率配色、环图与柱状图的数据整形、
// 时间范围的组装与 30 天截断，全都是纯函数。

/** 统计明细行（旧页 rows 的元素形态：合并「总数」与「ERROR」两路之后的形态） */
export interface StatRow {
  sourceId: string | number | null
  configId: string | number | null
  cnt: number
  errorCnt: number
  errorRate: number
}

/** 原始响应行（后端字段名，不做改名） */
export interface RawStatRow {
  sourceId?: string | number | null
  configId?: string | number | null
  cnt?: number | string | null
  state?: string
}

export type StatGroup = 'source' | 'config' | 'both'

/** 状态构成图单列的关键状态（其余归「其他」），顺序与旧页 PIE_STATES 一致 */
export const PIE_STATES = ['E', 'C', 'AC', 'W1', 'W', 'L'] as const

/** 环图图例用的中文短名（旧页 PIE_LABEL） */
export const PIE_LABEL: Record<string, string> = {
  E: 'ERROR',
  C: 'COMPLETE',
  AC: '自动完成',
  W1: '待派发',
  W: '待处理',
  L: '处理中',
}

export const GROUP_TITLE: Record<StatGroup, string> = {
  source: '按来源',
  config: '按配置',
  both: '来源+配置',
}

/** 时间范围最大跨度（含首尾共 30 天，超出自动截断） */
export const MAX_RANGE_DAYS = 30

export function toNum(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v)
}

/** 分组键：来源 + 配置（缺哪一维用 s- / c- 占位，与旧页 keyOf 完全一致） */
export function keyOf(item: { sourceId?: unknown; configId?: unknown }): string {
  const s = item.sourceId === null || item.sourceId === undefined ? 's-' : `s${item.sourceId}`
  const c = item.configId === null || item.configId === undefined ? 'c-' : `c${item.configId}`
  return `${s}_${c}`
}

/**
 * 合并「总数」与「ERROR」两路响应（旧页 mergeRows）。
 * - 以总数为准逐行取值，ERROR 通过 Map 索引 O(n) 命中
 * - 兜底：只出现在 ERROR 里的分组（两路口径不一致时）也要出现，此时 cnt = errorCnt
 * - 排序：cnt 降序，其次 errorCnt 降序（旧页就是这两级）
 */
export function mergeRows(all: RawStatRow[], err: RawStatRow[]): StatRow[] {
  const allKeys = new Set<string>()
  const errMap = new Map<string, number>()
  err.forEach((item) => {
    errMap.set(keyOf(item), toNum(item.cnt))
  })
  const rows: StatRow[] = all.map((item) => {
    const key = keyOf(item)
    allKeys.add(key)
    const cnt = toNum(item.cnt)
    const errorCnt = errMap.get(key) ?? 0
    return {
      sourceId: item.sourceId === undefined ? null : item.sourceId ?? null,
      configId: item.configId === undefined ? null : item.configId ?? null,
      cnt,
      errorCnt,
      errorRate: cnt > 0 ? Number(((errorCnt / cnt) * 100).toFixed(2)) : 0,
    }
  })
  err.forEach((item) => {
    const key = keyOf(item)
    if (allKeys.has(key)) return
    const cnt = toNum(item.cnt)
    rows.push({
      sourceId: item.sourceId === undefined ? null : item.sourceId ?? null,
      configId: item.configId === undefined ? null : item.configId ?? null,
      cnt,
      errorCnt: cnt,
      errorRate: cnt > 0 ? 100 : 0,
    })
  })
  return rows.sort((a, b) => b.cnt - a.cnt || b.errorCnt - a.errorCnt)
}

/** 分组显示标签（旧页 groupLabel）：按配置 → 「配置#x」；来源+配置 → 「源x/配置y」；否则「源#x」 */
export function groupLabel(item: Pick<StatRow, 'sourceId' | 'configId'>, group: StatGroup): string {
  if (group === 'config') return `配置#${item.configId}`
  if (group === 'both') {
    const s = item.sourceId !== null && item.sourceId !== undefined ? item.sourceId : '-'
    const c = item.configId !== null && item.configId !== undefined ? item.configId : '-'
    return `源${s}/配置${c}`
  }
  return `源#${item.sourceId}`
}

/** 行内任务占比 = 该组任务数 / 总任务数（保留 2 位，旧页 percentOf） */
export function percentOf(cnt: number, total: number): number {
  if (!total) return 0
  return Number(((cnt / total) * 100).toFixed(2))
}

/** 错误率三档配色：>20% 红、>5% 黄、否则绿（旧页 errorColor，原样保留 antd 的色值） */
export function errorColor(rate: number): string {
  if (rate > 20) return '#f5222d'
  if (rate > 5) return '#faad14'
  return '#52c41a'
}

/** 错误率阈值：未填/非法按 100，否则取 0~100 的整数（旧页 thresholdRate） */
export function thresholdOf(errThreshold: number | string): number {
  if (errThreshold === '' || errThreshold === null || errThreshold === undefined) return 100
  const v = Number(errThreshold)
  if (Number.isNaN(v)) return 100
  return Math.min(100, Math.max(0, Math.floor(v)))
}

/** 阈值筛选是否开启（旧页 rateActive） */
export function rateActiveOf(errThreshold: number | string): boolean {
  return errThreshold !== '' && errThreshold !== null && errThreshold !== undefined
}

/** ERROR 占比高、需要重点关注的分组（旧页 alertRows） */
export function alertRowsOf(rows: StatRow[], threshold: number): StatRow[] {
  return rows.filter((r) => r.errorCnt > 0 && r.errorRate >= threshold)
}

/** 明细表数据源：开启阈值筛选时只留重点关注分组，并按错误率降序（旧页 filteredRows） */
export function filteredRowsOf(rows: StatRow[], errThreshold: number | string): StatRow[] {
  if (!rateActiveOf(errThreshold)) return rows
  return alertRowsOf(rows, thresholdOf(errThreshold))
    .slice()
    .sort((a, b) => b.errorRate - a.errorRate || b.cnt - a.cnt)
}

export interface PieSlice {
  label: string
  value: number
  /** 0~1 的小数（旧页 percent，保留 4 位），环图与图例共用 */
  percent: number
}

/**
 * 状态构成（环图）切片（旧页 statePieData）：
 * 关键状态取 stateCounts，其余用「总任务数 - 关键状态合计」作为「其他」；
 * 分母用**切片实际总和**（两路查询口径有差异时，保证各切片占比相加 = 100%）；
 * 过滤掉 0 值切片后按数量降序。
 */
export function pieSlices(stateCounts: Record<string, number>, totalCnt: number): PieSlice[] {
  const known = PIE_STATES.map((s) => ({
    label: `${s} ${PIE_LABEL[s]}`,
    value: stateCounts[s] ?? 0,
  }))
  const knownSum = known.reduce((sum, i) => sum + i.value, 0)
  const other = Math.max(totalCnt - knownSum, 0)
  if (other > 0) known.push({ label: '其他', value: other })
  const total = knownSum + other || 1
  return known
    .filter((i) => i.value > 0)
    .map((i) => ({ ...i, percent: Number((i.value / total).toFixed(4)) }))
    .sort((a, b) => b.value - a.value)
}

export interface BarItem {
  label: string
  value: number
}

/** 总任务分布 TOP10（旧页 totalBarData：不排序，直接取前 10） */
export function topBarData(rows: StatRow[], group: StatGroup, limit = 10): BarItem[] {
  return rows.slice(0, limit).map((item) => ({ label: groupLabel(item, group), value: item.cnt }))
}

/** ERROR 分布 TOP10（旧页 errorBarData：先按 errorCnt 降序再取前 10，0 的不进图） */
export function errorBarData(rows: StatRow[], group: StatGroup, limit = 10): BarItem[] {
  return rows
    .filter((item) => item.errorCnt > 0)
    .slice()
    .sort((a, b) => b.errorCnt - a.errorCnt)
    .slice(0, limit)
    .map((item) => ({ label: groupLabel(item, group), value: item.errorCnt }))
}

// ───────────────────────── 时间（旧页用 moment，这里用原生 Date 复刻同款口径）─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** `2026-10-13` */
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `2026-10-13 08:05:00`（旧页 range-picker 的 format: YYYY-MM-DD HH:mm:ss） */
export function fmtDateTime(d: Date): string {
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** `10-13`（旧页 timeDesc 用 MM-DD） */
export function fmtMonthDay(d: Date): string {
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `20261013`（旧页导出文件名用 YYYYMMDD） */
export function fmtDateTag(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

/** `080500`（旧页导出文件名带 HHmmss） */
export function fmtTimeTag(d: Date): string {
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function dayStart(d = new Date()): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

export function dayEnd(d = new Date()): Date {
  const c = new Date(d)
  c.setHours(23, 59, 59, 0)
  return c
}

/** 解析后端/UI 两种格式（yyyy-MM-dd 与 yyyy-MM-dd HH:mm:ss），解不出返回 null */
export function parseTime(v?: string | null): Date | null {
  if (!v) return null
  const t = Date.parse(v.includes(' ') ? v.replace(' ', 'T') : `${v}T00:00:00`)
  return Number.isNaN(t) ? null : new Date(t)
}

export interface RangeResult {
  /** 截断后的 [start, end]（ISO 字符串，与入参同格式） */
  range: [string, string]
  /** 是否发生了截断（调用方据此决定要不要弹提示） */
  clamped: boolean
}

/**
 * 时间范围最多 30 天：超出时把结束时间截断为「开始日 + 29 天 23:59:59」（旧页 clampRange）。
 * 入参是 Element Plus date-picker 的 `YYYY-MM-DD HH:mm:ss` 字符串，解不出时原样返回、不截断。
 */
export function clampRange30(start: string, end: string): RangeResult {
  const s = parseTime(start)
  const e = parseTime(end)
  if (!s || !e) return { range: [start, end], clamped: false }
  const maxEnd = dayEnd(new Date(dayStart(s).getTime() + (MAX_RANGE_DAYS - 1) * 86_400_000))
  if (e.getTime() > maxEnd.getTime()) {
    return { range: [fmtDateTime(s), fmtDateTime(maxEnd)], clamped: true }
  }
  return { range: [fmtDateTime(s), fmtDateTime(e)], clamped: false }
}

/** 「今天」「昨天」「近 7 天」「近 30 天」四种快捷区间（旧页 onTimeModeChange） */
export function quickRange(mode: 'today' | 'yesterday' | '7d' | '30d'): { date?: string; range?: [string, string] } {
  const today = dayStart()
  if (mode === 'today') return { date: fmtDate(today) }
  if (mode === 'yesterday') return { date: fmtDate(new Date(today.getTime() - 86_400_000)) }
  const days = mode === '7d' ? 7 : 30
  const start = new Date(today.getTime() - (days - 1) * 86_400_000)
  return { range: [fmtDateTime(dayStart(start)), fmtDateTime(dayEnd(today))] }
}
