/**
 * 1106 设计方案 §7.5 / §8.6：条数只读运行记录里的**结构化数值字段**，不解析中文日志。
 *
 * 旧实现从 logMsg / lastMsg 里正则抠「数量:1240」「cnt=50」「积压 1240 条」。§7.5 明确
 * 「不通过解析『正常/异常』中文日志作为唯一业务依据」：日志是给人看的可读文本，改一个字、
 * 换一种措辞就取不到数；而取不到时又容易被当成 0（§8.3 数量未知不能默认 0）。
 *
 * 现口径：
 * - 依次读顶层 cnt / count / recordCount / dataCount / resultCount，再读 metrics 里的同名
 *   字段（§7.5 标准运行输出把 metrics 作为结构化指标容器）；
 * - 数字或纯数字字符串才算结构化值，0 是真实值（显示「0」，不是未知）；
 * - 取不到返回空串，调用方显示「—」；logMsg / lastMsg 只进 tooltip，不进数值。
 */

const COUNT_FIELDS = ['cnt', 'count', 'recordCount', 'dataCount', 'resultCount'] as const

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonRecord
}

/** 结构化数值：number 或纯数字字符串；其余（含 null/undefined/布尔）都算取不到 */
function asCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const text = value.trim()
    if (/^\d+$/.test(text)) return Number(text)
  }
  return null
}

function pickCount(record: JsonRecord): number | null {
  for (const field of COUNT_FIELDS) {
    const count = asCount(record[field])
    if (count !== null) return count
  }
  return null
}

/**
 * 取一条运行记录（SourceCheck / SourceCheckLog 行或任意 unknown 形态）的结构化条数。
 * 取不到时返回空串，调用方显示「—」；不会退化为解析 logMsg/lastMsg。
 */
export function checkCountOf(record: unknown): string {
  const row = asRecord(record)
  if (!row) return ''
  const direct = pickCount(row)
  if (direct !== null) return String(direct)
  const metrics = asRecord(row.metrics)
  if (metrics) {
    const nested = pickCount(metrics)
    if (nested !== null) return String(nested)
  }
  return ''
}
