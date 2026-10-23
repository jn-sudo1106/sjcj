// 时间序列生成 —— 旧「URL生成工具」用 moment 算（`m.diff(end, type)` + `m.startOf/endOf/add`），
// 新项目没有 moment 也没有 dayjs，这里手写一份等价实现，零依赖。
//
// 为什么不用 `new Date(str)` 直接 parse：'2026-01-01' 这种纯日期串会被当成 UTC 零点，
// 在东八区再 format 回来就变成 12-31 08:00，月初/月末全错位。所以解析和格式化都走**本地时间**
// 的 y / m / d 三个数字，绕开时区。
//
// 月份加减按 moment 的口径做「月末收敛」：1 月 31 日加一个月 = 2 月 28（不是 3 月 3 日）。

export type SeqUnit = 'days' | 'months'

/** 月初 / 月末 / 每月固定日[同起始时间] / 月初 ~ 月末 —— 对齐旧 form2.flag 的 1/2/3/4 */
export type MonthMode = 1 | 2 | 3 | 4

export interface TimeSeqOptions {
  /** 起始时间，'YYYY-MM-DD' */
  start: string
  /** 结束时间，'YYYY-MM-DD' */
  end: string
  /** 间隔（旧 form2.step，默认 1） */
  step: number
  /** 按日还是按月推进（旧 form2.type） */
  unit: SeqUnit
  /** 仅按月时有意义（旧 form2.flag） */
  mode?: MonthMode
  /** 输出格式，支持 YYYY/YY/MM/M/DD/D/HH/mm/ss（旧 form2.format，默认 YYYY-MM-DD） */
  format?: string
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss' → 本地时间 Date；解析不出来给 Invalid Date */
export function parseDate(text: string | null | undefined): Date {
  if (!text) return new Date(Number.NaN)
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text).trim())
  if (!matched) {
    // 兜底交给原生解析（容忍后端偶尔返回的其它格式），但纯日期串不会走到这里
    return new Date(String(text))
  }
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

/** 按 moment 的 token 子集格式化（年/月/日/时/分/秒足够本工具用） */
export function formatDate(date: Date, format = 'YYYY-MM-DD'): string {
  if (!isValidDate(date)) return ''
  const map: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: pad(date.getFullYear() % 100),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
  }
  // 长 token 优先，避免 YYYY 被 YY 先吃掉
  return format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (token) => map[token] ?? token)
}

/** 当天零点 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 当月 1 日零点 */
function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

/** 目标月份的天数（第 0 天 = 上个月最后一天，这是 Date 的既有语义） */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/** 月末 23:59:59.999（旧代码只取日期部分，时分秒不影响结果） */
function endOfMonth(date: Date): Date {
  const last = daysInMonth(date.getFullYear(), date.getMonth())
  return new Date(date.getFullYear(), date.getMonth(), last, 23, 59, 59, 999)
}

/** moment 口径的加减：按月时对月末做收敛（1-31 + 1 月 = 2-28） */
export function addUnit(date: Date, amount: number, unit: SeqUnit): Date {
  if (unit === 'days') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, date.getHours(), date.getMinutes(), date.getSeconds())
  }
  const targetYear = date.getFullYear()
  const targetMonth = date.getMonth() + amount
  const day = Math.min(date.getDate(), daysInMonth(targetYear, targetMonth))
  const normalized = new Date(targetYear, targetMonth, 1)
  return new Date(normalized.getFullYear(), normalized.getMonth(), day, date.getHours(), date.getMinutes(), date.getSeconds())
}

/** `date - end` 的整数差（天数 / 整月数），对齐 moment.diff(end, unit) 的符号与截断方式 */
export function diffUnit(date: Date, end: Date, unit: SeqUnit): number {
  if (unit === 'days') {
    const ms = startOfDay(date).getTime() - startOfDay(end).getTime()
    return Math.round(ms / 86_400_000)
  }
  let months = (date.getFullYear() - end.getFullYear()) * 12 + (date.getMonth() - end.getMonth())
  // moment 的月差是「完整的月」：日没走满就少算一个月
  if (months > 0 && date.getDate() < end.getDate()) months -= 1
  if (months < 0 && date.getDate() > end.getDate()) months += 1
  return months
}

/**
 * 生成时间序列（旧 buildTimeSeq）。
 * 循环条件与旧代码一致：`start.diff(end, unit) <= 0` 时继续，直到越过结束时间。
 */
export function buildTimeSeq(options: TimeSeqOptions): string[] {
  const start = parseDate(options.start)
  const end = parseDate(options.end)
  const step = Number(options.step) || 1
  const format = options.format || 'YYYY-MM-DD'
  const unit: SeqUnit = options.unit === 'months' ? 'months' : 'days'
  const mode = (options.mode ?? 1) as MonthMode
  if (!isValidDate(start) || !isValidDate(end)) return []

  const list: string[] = []
  // 上限兜底：格式填错 / step 为非正数时别把浏览器转死（旧版这里会真死循环）
  const MAX_ROWS = 5000
  for (let cursor = start; diffUnit(cursor, end, unit) <= 0 && list.length < MAX_ROWS; cursor = addUnit(cursor, step, unit)) {
    if (unit === 'days') {
      // 按日推进时 flag 不参与（旧版也只有按月才看 flag）
      list.push(formatDate(cursor, format))
      continue
    }
    if (mode === 1) list.push(formatDate(startOfMonth(cursor), format))
    else if (mode === 2) list.push(formatDate(endOfMonth(cursor), format))
    else if (mode === 3) list.push(formatDate(cursor, format))
    else {
      list.push(`${formatDate(startOfMonth(cursor), format)} , ${formatDate(endOfMonth(cursor), format)}`)
    }
  }
  return list
}

/** 整数区间（旧 buildSeq）：`for (i = start; i <= end; i += step)`，参数是字符串手输的 */
export function buildIntSeq(start: string | number, end: string | number, step: string | number): number[] {
  const from = Number(start)
  const to = Number(end)
  // 空串按 1（旧表单默认就是 '1'）；0 / 负数 / 非数字直接判非法 —— 旧版这种输入会拼成字符串死循环
  const raw = String(step ?? '').trim()
  const gap = raw === '' ? 1 : Number(raw)
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(gap) || gap <= 0) return []
  const list: number[] = []
  for (let cursor = from; cursor <= to && list.length < 5000; cursor += gap) {
    // 浮点步长（0.1）会累出 0.30000000000000004，按 6 位小数收一下
    list.push(Math.round(cursor * 1e6) / 1e6)
  }
  return list
}
