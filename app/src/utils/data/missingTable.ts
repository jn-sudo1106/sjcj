/**
 * 1106 设计方案 §10.1 / §10.2：物理表状态只认后端**结构化字段**，不匹配数据库异常文本。
 *
 * 旧实现（1105 会议临时方案）按 /doesn't exist/、/no such table/、/\b1146\b/、/unknown table/、
 * /表xxx不存在/ 等 message 正则判定缺表。§10.2 明确否掉了这条路：网络超时、权限失败、其他
 * SQL 错误都不能用「匹配数据库异常字符串」的方式统一判缺表——文案里碰巧带 1146 的普通错误
 * 会被误判，而真实缺表错误一旦换了文案就漏判。
 *
 * 现口径（§10.1 分档）：
 * - 命中结构化缺表信号 → 物理表不存在（数量「—」、给刷新状态入口、停止必然失败的重复查询）；
 * - 没有结构化信号 → 一律「状态待检查」，界面按**真实错误**展示，不替换成「缺表」话术。
 *
 * 结构化信号来自 app/src/api/client.ts 的 ApiError（cause.body / status / gatewayDetail），
 * 候选形态（后端任一命中即可，文本消息一律不算）：
 *   { code: 1146 } / { code: 'UNKNOWN_TABLE' } / { code: 'TABLE_NOT_EXIST' }
 *   { data: { missingTable: true } } / { tableState: 'missing' } / { data: { tableState: 'missing' } }
 */

export const PHYSICAL_TABLE_MISSING_LABEL = '物理表不存在'
export const PHYSICAL_TABLE_UNKNOWN_LABEL = '状态待检查'
export const PHYSICAL_TABLE_OK_LABEL = '物理表正常'

/**
 * 结构化缺表提示：只描述状态分档，不写「暂无数据可查」。
 * 缺表是物理层缺失，和数据为空（0 条）不是一回事（§8.3：数量未知不能默认 0）。
 */
export const MISSING_TABLE_HINT =
  '表配置存在，但数据库中查不到对应的物理表；已停止会必然失败的查询，可刷新状态确认'

/** 后端可用来表达「物理表缺失」的 code：MySQL 1146 + 通用枚举（字符串形态也兼容） */
const MISSING_TABLE_CODES: readonly unknown[] = [1146, '1146', 'UNKNOWN_TABLE', 'TABLE_NOT_EXIST']

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

/** 单个响应对象是否带缺表信号（不递归） */
function isMissingSignal(record: JsonRecord): boolean {
  if (MISSING_TABLE_CODES.includes(record.code)) return true
  if (record.missingTable === true) return true
  return record.tableState === 'missing'
}

/** 在 ApiError 的 cause/body/data 链路里找结构化信号（限定 3 层，避免误扫整份响应） */
function hasMissingSignal(record: JsonRecord, depth = 0): boolean {
  if (isMissingSignal(record)) return true
  if (depth >= 3) return false
  for (const key of ['cause', 'body', 'data']) {
    const child = asRecord(record[key])
    if (child && hasMissingSignal(child, depth + 1)) return true
  }
  return false
}

/**
 * 是否命中结构化缺表信号。
 * 只读字段，不读 message——`new Error("Table 'x' doesn't exist")` 这类纯文本一律返回 false。
 */
export function isMissingTableError(error: unknown): boolean {
  const record = asRecord(error)
  return record ? hasMissingSignal(record) : false
}
