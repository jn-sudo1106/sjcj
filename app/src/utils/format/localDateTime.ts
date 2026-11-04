const pad = (value: number) => String(value).padStart(2, '0')

// 后端（源管理口径）直接给 `yyyy-MM-dd HH:mm:ss`，不带时区标记。
const SERVER_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 展示时间。服务端 `yyyy-MM-dd HH:mm:ss` 原样展示，不做时区换算（换算会让同一页面里
 * 源管理和问题台账的时间对不上）；带时区的 ISO 串才按浏览器本地时间格式化。
 */
export function localDateTime(value?: string | null): string {
  if (!value) return '—'
  const text = value.trim()
  const serverTime = SERVER_DATE_TIME.exec(text)
  if (serverTime) return `${serverTime[1]} ${serverTime[2]}`
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return value
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function businessDate(date = new Date()): string {
  const parts = shanghaiDate.formatToParts(date)
  const value = (type: string) => parts.find(part => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

/** `yyyy-MM-dd` 加减天数；用于把页面选的「结束日（含）」换成后端口径的「次日零点（排他）」。 */
export function addDays(value: string, days: number): string {
  const matched = DATE_ONLY.exec(value.trim())
  if (!matched) return value
  const date = new Date(0)
  date.setUTCFullYear(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]) + days)
  return date.toISOString().split('T')[0]!
}
