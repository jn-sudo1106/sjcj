// 任务「执行结果」(taskResult) 解析。
//
// 1117 会议：任务列表的「执行结果」列不再直接展示原始文本，拆成「结果状态」+「错误消息」两项。
// taskResult 是执行端回写的长文本。186 实测（2026-11-18，抽样 E/C 各 1000+ 条）只有一种契约：
//   · {"IsSuccess":"true"|"false"|true, "StrTaskId":"…", "ErrorMessage":""|"-"|"…"}，另有带 "Params" 的变体；
//     失败任务的 ErrorMessage 目前全是空串，成功任务用 "-" 占位。
// 其余形态作兼容：
//   · JSON 对象：{"status":"fail","error":"timeout"} / {"error":"目标站点 502"}
//   · JSON 数组：多条结果，取第一条（会上约定「拿第一个」）
//   · 纯文本：success / 超时 / 异常堆栈
// 解析不出状态时返回 unknown，不猜成功；原文始终保留给详情抽屉。

export type TaskResultStatus = 'success' | 'failed' | 'unknown'

export interface TaskResultSummary {
  status: TaskResultStatus
  /** 错误消息；成功或取不到时为空串 */
  message: string
  /** 原文（去首尾空白），给悬停/详情用 */
  raw: string
}

const SUCCESS_WORDS = new Set(['success', 'succeeded', 'succeed', 'ok', 'true', 'done', 'completed', 'complete', 'normal', 'c', '成功', '完成', '正常'])
const FAIL_WORDS = new Set(['fail', 'failed', 'failure', 'error', 'err', 'false', 'exception', 'timeout', 'e', '失败', '异常', '错误', '超时'])

// 键名一律按小写比较（执行端用的是 IsSuccess / ErrorMessage 这种 Pascal 写法）
const STATUS_KEYS = ['issuccess', 'success', 'status', 'state', 'result', 'code', 'ok'] as const
const MESSAGE_KEYS = ['errormessage', 'errormsg', 'errmsg', 'error', 'err', 'exception', 'reason', 'message', 'msg'] as const
/** 这些键出现非空值即视为失败（error 类键，不含 message/msg） */
const ERROR_KEYS = new Set<string>(['errormessage', 'errormsg', 'errmsg', 'error', 'err', 'exception'])
/** 执行端的空消息占位 */
const EMPTY_MESSAGES = new Set(['-', '—', 'null', 'none', 'undefined'])

function lowerKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase()
    if (!(lower in out)) out[lower] = value
  }
  return out
}

function statusOfValue(key: string, value: unknown): TaskResultStatus {
  if (typeof value === 'boolean') return value ? 'success' : 'failed'
  if (typeof value === 'number') {
    if (key === 'code') return value === 0 || value === 200 ? 'success' : 'failed'
    if (key === 'success' || key === 'ok' || key === 'issuccess') return value > 0 ? 'success' : 'failed'
    return 'unknown'
  }
  if (typeof value !== 'string') return 'unknown'
  const word = value.trim().toLowerCase()
  if (!word) return 'unknown'
  if (key === 'code' && /^\d+$/.test(word)) return word === '0' || word === '200' ? 'success' : 'failed'
  if (SUCCESS_WORDS.has(word)) return 'success'
  if (FAIL_WORDS.has(word)) return 'failed'
  return 'unknown'
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    return EMPTY_MESSAGES.has(text.toLowerCase()) ? '' : text
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const nested = lowerKeys(value as Record<string, unknown>)
    for (const key of MESSAGE_KEYS) {
      const text = textOf(nested[key])
      if (text) return text
    }
    try { return JSON.stringify(value) } catch { return '' }
  }
  return ''
}

function summarizeObject(input: Record<string, unknown>, raw: string): TaskResultSummary {
  const obj = lowerKeys(input)
  let status: TaskResultStatus = 'unknown'
  for (const key of STATUS_KEYS) {
    if (!(key in obj)) continue
    status = statusOfValue(key, obj[key])
    if (status !== 'unknown') break
  }
  let message = ''
  let errorKeyHit = false
  for (const key of MESSAGE_KEYS) {
    const text = textOf(obj[key])
    if (!text) continue
    message = text
    errorKeyHit = ERROR_KEYS.has(key)
    break
  }
  if (status === 'unknown' && errorKeyHit) status = 'failed'
  // 没有任何状态/错误键（如 {"count":120}）：保持 unknown，不猜成功
  return { status, message: status === 'success' && !errorKeyHit ? '' : message, raw }
}

export function parseTaskResult(input?: string | null): TaskResultSummary {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return { status: 'unknown', message: '', raw: '' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const word = raw.toLowerCase()
    if (SUCCESS_WORDS.has(word)) return { status: 'success', message: '', raw }
    if (FAIL_WORDS.has(word)) return { status: 'failed', message: raw, raw }
    if (/(error|exception|traceback|失败|异常|超时|timeout)/i.test(raw)) return { status: 'failed', message: raw, raw }
    return { status: 'unknown', message: raw, raw }
  }
  if (Array.isArray(parsed)) parsed = parsed.find((item) => item !== null && item !== undefined)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return summarizeObject(parsed as Record<string, unknown>, raw)
  if (typeof parsed === 'boolean') return { status: parsed ? 'success' : 'failed', message: '', raw }
  if (typeof parsed === 'string') {
    const status = statusOfValue('status', parsed)
    return { status, message: status === 'success' ? '' : parsed.trim(), raw }
  }
  return { status: 'unknown', message: '', raw }
}

export const TASK_RESULT_STATUS_TEXT: Record<TaskResultStatus, string> = {
  success: '成功',
  failed: '失败',
  unknown: '—',
}
