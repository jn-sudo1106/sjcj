export interface PromptEditReply { reply: string; userPrompt: string | null }

export function promptEditReply(raw: string): PromptEditReply {
  function decode(value: unknown, depth = 0): PromptEditReply | undefined {
    if (depth > 8) return
    if (typeof value === 'string') {
      const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      try { return decode(JSON.parse(text), depth + 1) } catch { return }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const row = value as Record<string, unknown>
    if (typeof row.reply === 'string' && (typeof row.userPrompt === 'string' || row.userPrompt === null)) {
      return { reply: row.reply, userPrompt: row.userPrompt }
    }
    for (const key of ['reply', 'content', 'text', 'response', 'result', 'data', 'message']) {
      const found = decode(row[key], depth + 1)
      if (found) return found
    }
    if (Array.isArray(row.choices)) return decode(row.choices[0], depth + 1)
  }
  return decode(raw) || { reply: raw.trim(), userPrompt: null }
}

export function validatePromptEdit(base: string, candidate: string): string {
  if (!candidate.trim() || candidate.length > 12000) return 'AI 返回的完整用户提示词须为 1–12000 字，请继续对话调整'
  const missing = [...new Set(base.match(/\{\{[^{}]+\}\}/g) || [])].filter(variable => !candidate.includes(variable))
  return missing.length ? `AI 修改遗漏了变量 ${missing.join('、')}，请继续对话保留这些变量` : ''
}
