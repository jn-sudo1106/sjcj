export interface ModelProviderOption {
  providerCode: string
  providerName: string
}

export interface ModelOption {
  modelCode: string
  modelName: string
}

// 与 data-process 服务同源（同机 8080 端口），通过 Vite 代理 + Nginx 反代转发；切换目标用 VITE_DATA_PROCESS_PROXY_TARGET
const MODEL_API_BASE = '/api/model'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function unwrapList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  const record = asRecord(input)
  const payload = record.data ?? record.list ?? record.records ?? record.items
  return Array.isArray(payload) ? payload : []
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return ''
}

function normalizeProvider(item: unknown): ModelProviderOption | null {
  if (typeof item === 'string') {
    const text = item.trim()
    return text ? { providerCode: text, providerName: text } : null
  }
  const record = asRecord(item)
  const providerCode = firstString(record, ['providerCode', 'code', 'id', 'value', 'provider'])
  if (!providerCode) return null
  return {
    providerCode,
    providerName: firstString(record, ['providerName', 'name', 'label', 'title']) || providerCode,
  }
}

function normalizeModel(item: unknown): ModelOption | null {
  if (typeof item === 'string') {
    const text = item.trim()
    return text ? { modelCode: text, modelName: text } : null
  }
  const record = asRecord(item)
  const modelCode = firstString(record, ['modelCode', 'code', 'id', 'value', 'model'])
  if (!modelCode) return null
  return {
    modelCode,
    modelName: firstString(record, ['modelName', 'name', 'label', 'title']) || modelCode,
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${MODEL_API_BASE}${path}`, { method: 'GET', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    window.clearTimeout(timer)
  }
}

export async function fetchModelProviders(): Promise<ModelProviderOption[]> {
  const data = await fetchJson('/providers')
  return unwrapList(data).map(normalizeProvider).filter((item): item is ModelProviderOption => !!item)
}

export async function fetchDefaultModels(providerCode: string): Promise<ModelOption[]> {
  const code = providerCode.trim()
  if (!code) return []
  const data = await fetchJson(`/default-models?providerCode=${encodeURIComponent(code)}`)
  return unwrapList(data).map(normalizeModel).filter((item): item is ModelOption => !!item)
}
