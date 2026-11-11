/**
 * 条数取值（1106 设计方案 §7.5 / §8.6）：**结构化字段优先**，文本解析只作过渡兜底。
 *
 * §7.5 要求「不通过解析『正常/异常』中文日志作为唯一业务依据」：日志是给人看的可读文本，
 * 改一个措辞就取不到数，取不到时又容易被当成 0（§8.3 数量未知不能默认 0）。
 *
 * 现口径（按优先级）：
 * 1. 顶层 cnt / count / recordCount / dataCount / resultCount；
 * 2. metrics 里的同名字段（§7.5 标准运行输出把 metrics 作为结构化指标容器）；
 * 3. **过渡兜底**：结构化字段都没有时，按旧口径从 lastMsg / logMsg 文本里解析
 *    「数量:1240」「cnt=50」「积压 1240 条」。
 *
 * 为什么保留兜底（2026-11-10 实测）：后端 `CkSource` / `CkJobLog` 实体目前没有上述任何
 * 计数字段（只有 runCnt / successCnt，语义是运行次数，不是查出多少条），条数只存在于
 * lastMsg / logMsg 文本里。若只认结构化字段，「条数」列会在后端补字段前整列显示「—」，
 * 属于可见退步。因此保留文本解析作为降级路径：结构化字段一到位就自动优先使用，
 * 届时应删除下面 LEGACY_TEXT_PATTERNS + textCount（TODO 后端加字段后清理）。
 *
 * 其他约定：数字或纯数字字符串才算结构化值，0 是真实值（显示「0」，不是未知）；
 * 全部取不到返回空串，调用方显示「—」。
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
 * 过渡兜底用的旧文本口径（与 1105 版一致）。后端补结构化字段后整段删除。
 * 只从执行结果文本里取数字，绝不把「解析不到」当成 0。
 */
const LEGACY_TEXT_PATTERNS = [
  /数量\s*[:：]\s*(\d+)/,
  /\b(?:cnt|count)\s*[=:：]\s*(\d+)/i,
  /积压\s*(\d+)\s*条/,
]
const TEXT_FIELDS = ['lastMsg', 'logMsg'] as const

function textCount(row: JsonRecord): number | null {
  for (const field of TEXT_FIELDS) {
    const text = row[field]
    if (typeof text !== 'string' || !text) continue
    for (const pattern of LEGACY_TEXT_PATTERNS) {
      const match = pattern.exec(text)
      if (match) return Number(match[1])
    }
  }
  return null
}

/**
 * 取一条运行记录（SourceCheck / SourceCheckLog 行或任意 unknown 形态）的条数。
 * 结构化字段优先，取不到时按执行结果文本兜底；都取不到返回空串，调用方显示「—」。
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
  const legacy = textCount(row)
  if (legacy !== null) return String(legacy)
  return ''
}