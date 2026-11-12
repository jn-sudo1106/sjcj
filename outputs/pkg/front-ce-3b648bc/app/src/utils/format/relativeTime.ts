/**
 * 时间戳转「N 天前」相对描述，对齐旧平台源列表「新入 / 成功」列的展示口径。
 * 入参兼容后端的「2026-08-31 10:22:31」（空格分隔）和 ISO 串。
 * 解析失败原样返回；未来时间也原样返回（不写「-1 天前」）。
 */
export function timeAgo(value?: string | null): string {
  if (!value) return '—'
  const raw = String(value)
  const t = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')).getTime()
  if (Number.isNaN(t)) return raw

  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 0) return raw
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month} 个月前`
  return `${Math.floor(month / 12)} 年前`
}
