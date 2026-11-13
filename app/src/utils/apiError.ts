// 接口错误 → 用户能看懂的提示。
//
// 背景（1109）：后端把 MyBatis/JPA 的整段异常原样拼进 message，前端直接渲染就成了
// 「### Error querying database. Cause: ... ### SQL: SELECT FLOW_ID FROM cs_flow WHERE FLOW_ID = ? FOR UPDATE NOWAIT」，
// 一屏几十条 SQL + mapper 类名。这里只做三件事：
//   1. 去掉前端自己加的前缀（请求异常 [endpoint]: / 请求失败 500: / 错误信息:运行时异常:）；
//   2. 从第一个 `###` 或 `; nested exception is` 处截断，把 JPA 诊断段整块扔掉；
//   3. 如果截断后仍残留实现细节（com./java./SELECT/Exception…），退回兜底文案，不让内部实现漏到界面上。

/** 后端返回「操作冲突：流程正在被其他人操作」时的统一提示——多半是本批次自己并发写同一流程引起的锁等待。 */
const LOCK_CONFLICT = /操作冲突|Lock wait timeout|锁等待超时|正在被其他人操作|FOR UPDATE NOWAIT|Deadlock found|死锁/i
const LOCK_CONFLICT_TEXT = '流程正被并发操作占用（锁等待超时），请稍后重试'

const ENDPOINT_PREFIX = /^请求异常 \[[^\]]+\]:\s*/
const STATUS_PREFIX = /^请求失败 \d+[:：]?\s*/
const WRAP_PREFIX = /^错误信息:运行时异常[:：]\s*/
const NESTED_EXCEPTION = /;?\s*nested exception is/i
const IMPL_LEAK = /(^|[\s(（:：])(com\.[a-z]|java\.|javax\.|org\.springframework|java\.sql|select\s|insert\s|delete\s|for update|nowait|mapper|\.java\b|Exception\b)/i
const MAX_LENGTH = 160

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '')
}

/** 判断是否锁冲突/并发写同一行导致的瞬时失败——这类失败重试即可，值得自动重试一次。 */
export function isLockConflictError(error: unknown): boolean {
  return LOCK_CONFLICT.test(rawMessage(error))
}

/**
 * 把后端原始异常转成一句可展示的提示。
 * @param error 捕获到的错误
 * @param fallback 完全看不清原因时的兜底文案
 */
export function readableApiError(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const raw = rawMessage(error).replace(ENDPOINT_PREFIX, '').replace(STATUS_PREFIX, '').replace(WRAP_PREFIX, '')

  // 截掉 JPA/MyBatis 的诊断尾巴（取两个标记里更靠前的那个）
  const marks: number[] = []
  const hash = raw.indexOf('###')
  if (hash >= 0) marks.push(hash)
  const nested = raw.search(NESTED_EXCEPTION)
  if (nested >= 0) marks.push(nested)
  const head = marks.length ? raw.slice(0, Math.min(...marks)) : raw

  const text = head
    .replace(/\s+/g, ' ')
    .replace(/[\s：:，,、。;；]+$/, '')
    .trim()

  if (!text) return fallback
  // 先判实现细节：整段就是 SQL/类名时不该被下面的锁冲突文案掩盖
  if (IMPL_LEAK.test(text)) return fallback
  if (LOCK_CONFLICT.test(text)) return LOCK_CONFLICT_TEXT
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text
}