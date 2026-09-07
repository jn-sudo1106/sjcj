// 各查询入口共用，按表隔离；仅在查询成功后调用 rememberSqlCondition。
const PREFIX = 'sqlConditionHistory.v1:'
const LIMIT = 10

export function readSqlConditions(tableId?: string): string[] {
  if (!tableId) return []
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFIX + tableId) || '[]')
    if (!Array.isArray(raw)) return []
    return [...new Set(raw.filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim()).filter(Boolean))].slice(0, LIMIT)
  } catch {
    return []
  }
}

export function rememberSqlCondition(tableId: string | undefined, sql?: string) {
  const value = sql?.trim()
  if (!tableId || !value) return
  try {
    const recent = [value, ...readSqlConditions(tableId).filter((item) => item !== value)].slice(0, LIMIT)
    localStorage.setItem(PREFIX + tableId, JSON.stringify(recent))
  } catch {
    // 浏览器禁用存储或容量不足，不影响查询结果。
  }
}

export function clearSqlConditions(tableId?: string) {
  if (!tableId) return
  try {
    localStorage.removeItem(PREFIX + tableId)
  } catch {
    // 与读取、写入保持一致：本地存储不可用时不阻断编辑。
  }
}
