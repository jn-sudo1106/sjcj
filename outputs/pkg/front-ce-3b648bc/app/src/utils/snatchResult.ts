/**
 * 发抓取（`source/sendSnatchWithParam`）的回执整理（2026-10-22）。
 *
 * 后端对「源不能发」不是返回错误，而是 HTTP 成功、回执里 `failCount > 0` + `failedDetails[{ sourceId, reason }]`
 *（10-22 186 实测：流程禁用后手动抓取、指定流程运行都这样回）。前端原来只认抛错，这种回执被当成功，
 * 弹「已发起抓取」但一个任务都没建。这里统一整理：
 * - 一个都没发出去 → 抛错（各调用处原有的「发起抓取失败：…」接住）；
 * - 部分发出去 → 正常返回，`failed` 带上没发出去的源，批量发送只把这些记成失败（重试不会把已发的再发一遍）。
 *
 * 失败原因有一条是 Spring 内部异常原文（`Incorrect result size: expected 1, actual 0`，查默认流程查到 0 条），
 * 用户看不懂，这里翻成人话；后端改成可读文案之前先这样兜着（已反馈后端）。
 */
import type { Ack } from '@/api/types/common'

export interface SnatchFailure {
  sourceId: string
  reason: string
}
export type SnatchAck = Ack & {
  /** 发出去的源数（后端 successCount；旧回执没有时按全部发出） */
  sent?: number
  /** 没发出去的源 */
  failed?: SnatchFailure[]
}

const REASON_TEXT: [RegExp, string][] = [
  [/Incorrect result size: expected 1, actual 0/i, '没有可用的流程（关联的流程可能已禁用，或还没有关联流程）'],
  [/指定流程不在当前可用关联中/, '指定的流程不在这个源当前可用的流程里（可能已禁用或已解绑）'],
]

export function snatchFailReasonText(reason: string): string {
  const raw = reason.trim()
  for (const [pattern, text] of REASON_TEXT) if (pattern.test(raw)) return text
  return raw || '原因未知'
}

/** 失败明细 → 一句话：同一原因的源归在一起，最多列 5 个源 ID */
export function snatchFailureSummary(failed: SnatchFailure[]): string {
  const byReason = new Map<string, string[]>()
  for (const f of failed) {
    const text = snatchFailReasonText(f.reason)
    byReason.set(text, [...(byReason.get(text) ?? []), f.sourceId])
  }
  return [...byReason].map(([text, ids]) => {
    const head = ids.slice(0, 5).join('、')
    const who = ids.length === 1 ? `源 ${head}` : `${ids.length} 个源（${head}${ids.length > 5 ? ' 等' : ''}）`
    return `${who}：${text}`
  }).join('；')
}

/** 整理 sendSnatchWithParam 的回执；一个都没发出去时抛错 */
export function snatchAckFrom(raw: unknown): SnatchAck {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const details = Array.isArray(record.failedDetails) ? record.failedDetails as Record<string, unknown>[] : []
  const failed: SnatchFailure[] = details
    .filter((d) => d && d.success !== true)
    .map((d) => ({ sourceId: String(d.sourceId ?? ''), reason: String(d.reason ?? '') }))
  const base = record as unknown as Ack
  if (!failed.length) return base
  const sent = typeof record.successCount === 'number' ? record.successCount : 0
  const summary = snatchFailureSummary(failed)
  if (sent <= 0) throw Object.assign(new Error(summary), { failed })
  return { ...base, ok: true, sent, failed, message: `已发起 ${sent} 个源，${failed.length} 个未发起：${summary}` }
}
