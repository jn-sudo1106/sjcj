/**
 * 把一个**外部来源**的地址收敛成「可以安全放进 href 的外链」，不合格一律返回空串。
 *
 * 这些地址来自采集源配置、抓取结果这类我们不生成的数据，所以只放行 http/https，
 * `javascript:` / `data:` 之类挡在外面。返回的是 `URL.href`（规范化后的形式）。
 *
 * 用在「悬浮看全文的长 URL 要能点开」这类展示位（CanvasHeader 摘要行、侧栏源信息）。
 * FileView / FileDetailDrawer 里各有一份同样逻辑的 `safeExternalUrl`，是这个函数之前的
 * 副本——它们没坏，本次不动，新的调用点用这里这份。
 */
export function toExternalHref(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
  } catch {
    return ''
  }
}
