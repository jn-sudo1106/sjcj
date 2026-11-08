// 「验证」（source/check/check-one）返回的上下文 JSON 结构没有固定契约，cnt / maxId 可能在顶层，
// 也可能包在 data / env / context 里。1105 会议上数据专员要求直接看到查出了多少条，
// 所以这里在浅层里找这两个值，找不到就返回空串，调用方照旧只显示原始 JSON。

const CNT_KEYS = new Set(['cnt', 'count'])
const MAX_ID_KEYS = new Set(['maxid', 'max_id'])
const MAX_DEPTH = 3

function findValue(value: unknown, keys: Set<string>, depth: number): unknown {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    if (keys.has(key.toLowerCase()) && (typeof child === 'number' || typeof child === 'string')) return child
  }
  for (const child of Object.values(record)) {
    const found = findValue(child, keys, depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

export function summarizeCheckOne(detail: unknown): string {
  const cnt = findValue(detail, CNT_KEYS, 0)
  const maxId = findValue(detail, MAX_ID_KEYS, 0)
  const parts: string[] = []
  if (cnt !== undefined) parts.push(`查出 ${cnt} 条（cnt）`)
  if (maxId !== undefined) parts.push(`maxId=${maxId}`)
  return parts.join('，')
}
