/** Runner 心跳统一显示北京时间，避免原始 UTC 串及浏览器地区格式差异。 */
const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export function formatRunnerDateTime(value?: string | null, empty = '时间未记录'): string {
  if (!value) return empty
  const raw = value.trim()
  // 兼容旧接口未带时区的本地时间；现代接口保留其明确的 UTC/偏移信息。
  const local = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
  const date = new Date(local ? raw.replace(' ', 'T') + '+08:00' : raw)
  if (Number.isNaN(date.getTime())) return empty
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export function formatRunnerHeartbeat(value?: string | null): string {
  return formatRunnerDateTime(value, '未收到心跳')
}
