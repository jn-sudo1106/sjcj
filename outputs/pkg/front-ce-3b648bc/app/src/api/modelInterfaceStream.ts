import { ACCESS_TOKEN_HEADER, readStoredToken, triggerSessionExpired } from './auth'
import type { ModelInterfaceTestInput } from './runnerManagement'

export type ModelTestEvent =
  | { type: 'connecting'; durationMs: number }
  | { type: 'headers'; durationMs: number; status: number; ok: boolean; contentType: string }
  | { type: 'chunk'; durationMs: number; text: string }
  | { type: 'done'; durationMs: number }

/** Decode the JSON envelope, preserving literal escapes inside the model's text. */
export function formatModelTestOutput(raw: string, receiving = false): string {
  const trimmed = raw.trim()
  if (!trimmed || !['{', '[', '"'].includes(trimmed[0]!)) return raw
  try {
    const value: unknown = JSON.parse(trimmed)
    function reply(item: unknown): string | undefined {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
      const record = item as Record<string, unknown>
      for (const key of ['reply', 'code', 'content', 'text', 'answer', 'response', 'result', 'data']) {
        const found = reply(record[key])
        if (found !== undefined) return found
      }
      const choices = record.choices
      if (Array.isArray(choices) && choices.length) return reply(choices[0])
      return reply(record.message) ?? reply(record.delta)
    }
    return reply(value) ?? JSON.stringify(value, null, 2)
  } catch {
    return receiving && /^\{\s*(?:"|$)/.test(trimmed) ? '正在接收完整 JSON 响应…' : raw
  }
}

export async function streamModelInterfaceTest(input: ModelInterfaceTestInput, onEvent: (event: ModelTestEvent) => void, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }
  const token = readStoredToken()
  if (token) headers[ACCESS_TOKEN_HEADER] = token
  const response = await fetch('/api/runner-management/model-interfaces/test', {
    method: 'POST', credentials: 'include', headers, body: JSON.stringify({ ...input, responseStream: true }), signal,
  })
  if (response.status === 401) triggerSessionExpired()
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || `接口测试失败（HTTP ${response.status}）`)
  }
  if (!response.body) throw new Error('浏览器未提供流式响应')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', completed = false
  function consume(line: string) {
    if (!line.trim()) return
    const event = JSON.parse(line)
    if (event.type === 'error') throw new Error(String(event.message || '模型响应中断'))
    if (!['connecting', 'headers', 'chunk', 'done'].includes(event.type)
      || (event.type === 'chunk' && typeof event.text !== 'string')) throw new Error('测试响应格式无效')
    if (event.type === 'done') completed = true
    onEvent(event)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let newline: number
      while ((newline = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, newline)); pending = pending.slice(newline + 1)
      }
      if (done) break
    }
    if (pending.trim()) consume(pending)
    if (!completed) throw new Error('模型响应中断，已收到的内容保留')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
