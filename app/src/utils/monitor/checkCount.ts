// 监控执行结果目前只有一行文字（logMsg / lastMsg），条数埋在里面，例如
// 「2026-09-09 11:00:46---正常, 数量:1240」「[X]:积压 1240 条, 超过阈值 1000」。
// 1105 会议要求一眼看到查出了多少条；后端把条数作为独立字段返回之前，先从文字里取。
const COUNT_PATTERNS = [
  /数量\s*[:：]\s*(\d+)/,
  /\b(?:cnt|count)\s*[=:：]\s*(\d+)/i,
  /积压\s*(\d+)\s*条/,
]

/** 取不到时返回空串，调用方显示「—」 */
export function checkCountOf(msg: string | null | undefined): string {
  if (!msg) return ''
  for (const pattern of COUNT_PATTERNS) {
    const match = pattern.exec(msg)
    if (match) return match[1]!
  }
  return ''
}
