// 源视图问题标记：颜色/标签的展示口径与旧 usedFlag 对齐。
// 交互来自 0824-source-marking 原型；旧颜色是 usedFlag 1-based 下标，不是业务含义。

export const SOURCE_MARK_COLORS = [
  { key: 'red', label: '红色', value: '#ef4444', flag: 1 },
  { key: 'orange', label: '橙色', value: '#f97316', flag: 2 },
  { key: 'yellow', label: '黄色', value: '#fbbf24', flag: 3 },
  { key: 'green', label: '绿色', value: '#22c55e', flag: 4 },
  { key: 'cyan', label: '青色', value: '#06b6d4', flag: 5 },
  { key: 'blue', label: '蓝色', value: '#3b82f6', flag: 6 },
  { key: 'purple', label: '紫色', value: '#8b5cf6', flag: 7 },
  { key: 'gray', label: '灰色', value: '#94a3b8', flag: 8 },
] as const

export type SourceMarkColorKey = (typeof SOURCE_MARK_COLORS)[number]['key']

export const DEFAULT_ISSUE_TAGS = ['日期错误待重跑', '正文缺失', '内容重复', '标题不规范']

const RECENT_TAGS_KEY = 'sjcj.source.issueTags.recent'

export function normalizeIssueTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim()
}

/**
 * 分隔符除中英文逗号外补上中英文分号（0831 X0）：入库的标签串不只我们在写——
 * 程序打标（会上「标签一般是程序来打的」）和旧平台历史数据都可能用 `;` 分隔，
 * 只认逗号会把 `#a;#b` 整个当成一个标签名，之后无论怎么筛都对不上。
 *
 * **刻意不拆空白**：标签名里带空格是合法的（`日期错误 待重跑`），按空白拆会把它
 * 劈成两个标签，而且只在"从后端读回来"这一侧劈——写出去时走的是数组分支不拆，
 * 于是同一个标签存进去和读出来长得不一样。等 G6 实测确认了后端真实的分隔口径再动。
 */
export function parseIssueTags(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[，,;；]/)
      : []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of parts) {
    const tag = normalizeIssueTag(part)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

/** 旧 markBatch 要求标签以 # 开头、多个逗号分隔。展示层去掉 #，写回时再补上。 */
export function issueTagForWrite(raw: string): string {
  const name = normalizeIssueTag(raw)
  return name ? `#${name}` : ''
}

export function issueTagsForWrite(tags: string[] | string): string {
  return parseIssueTags(tags).map((tag) => `#${tag}`).join(',')
}

export function mergeIssueTags(current: string[] | undefined, incoming: string[]): string[] {
  return parseIssueTags([...(current ?? []), ...incoming])
}

export function visibleIssueTags(tags: string[] | undefined): { shown: string[]; extra: number } {
  const list = tags ?? []
  return { shown: list.slice(0, 2), extra: Math.max(0, list.length - 2) }
}

export function colorFromFlag(flag: unknown): SourceMarkColorKey | undefined {
  const number = Number(flag)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return SOURCE_MARK_COLORS.find((item) => item.flag === number)?.key
}

export function flagFromColor(color: string | undefined | null): number | undefined {
  if (!color) return undefined
  return SOURCE_MARK_COLORS.find((item) => item.key === color)?.flag
}

export function colorValue(color: string | undefined | null): string | undefined {
  if (!color) return undefined
  const named = SOURCE_MARK_COLORS.find((item) => item.key === color)
  if (named) return named.value
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) return color
  return undefined
}

export function colorFromLegacy(record: Record<string, unknown>): string | undefined {
  if (typeof record.color === 'string' && record.color.trim()) {
    const key = record.color.trim()
    if (SOURCE_MARK_COLORS.some((item) => item.key === key)) return key
    if (colorValue(key)) return key
  }
  return colorFromFlag(record.usedFlag ?? record.flag)
}

export function readRecentIssueTags(): string[] {
  try {
    const stored = parseIssueTags(JSON.parse(localStorage.getItem(RECENT_TAGS_KEY) || '[]'))
    return parseIssueTags([...stored, ...DEFAULT_ISSUE_TAGS]).slice(0, 8)
  } catch {
    return [...DEFAULT_ISSUE_TAGS]
  }
}

export function rememberIssueTags(tags: string[]): string[] {
  const next = parseIssueTags([...tags, ...readRecentIssueTags()]).slice(0, 8)
  localStorage.setItem(RECENT_TAGS_KEY, JSON.stringify(next))
  return next
}
