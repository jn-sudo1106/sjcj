export interface PromptTemplateItem {
  promptId: number
  nodeType: string
  nodeTypeName: string
  category: string
  systemPrompt: string
  userPromptTemplate?: string
  outputSchema?: unknown
  parameters?: unknown
  exampleInput?: unknown
  exampleOutput?: unknown
  version?: number
  isActive?: number
  isDefault?: number
  createdAt?: string
  updatedAt?: string
  createdBy?: string | null
  updatedBy?: string | null
}

// 与 data-process 服务同源（同机 8080 端口），通过 Vite 代理 + Nginx 反代转发；切换目标用 VITE_DATA_PROCESS_PROXY_TARGET
const PROMPT_API_BASE = '/api/prompt'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function unwrapList(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  const record = asRecord(input)
  const payload = record.data ?? record.list ?? record.records ?? record.items
  return Array.isArray(payload) ? payload : []
}

function toString(value: unknown): string {
  return value == null ? '' : String(value)
}

function normalizePrompt(item: unknown): PromptTemplateItem | null {
  const record = asRecord(item)
  const systemPrompt = toString(record.systemPrompt).trim()
  const nodeTypeName = toString(record.nodeTypeName).trim()
  const category = toString(record.category).trim()
  if (!systemPrompt || !nodeTypeName || !category) return null
  const promptId = Number(record.promptId ?? record.id ?? 0)
  return {
    promptId: Number.isFinite(promptId) ? promptId : 0,
    nodeType: toString(record.nodeType).trim(),
    nodeTypeName,
    category,
    systemPrompt,
    userPromptTemplate: toString(record.userPromptTemplate).trim() || undefined,
    outputSchema: record.outputSchema,
    parameters: record.parameters,
    exampleInput: record.exampleInput,
    exampleOutput: record.exampleOutput,
    version: record.version == null ? undefined : Number(record.version),
    isActive: record.isActive == null ? undefined : Number(record.isActive),
    isDefault: record.isDefault == null ? undefined : Number(record.isDefault),
    createdAt: record.createdAt == null ? undefined : String(record.createdAt),
    updatedAt: record.updatedAt == null ? undefined : String(record.updatedAt),
    createdBy: record.createdBy == null ? undefined : String(record.createdBy),
    updatedBy: record.updatedBy == null ? undefined : String(record.updatedBy),
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${PROMPT_API_BASE}${path}`, { method: 'GET', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    window.clearTimeout(timer)
  }
}

export async function fetchPromptList(category: string, nodeTypeName: string): Promise<PromptTemplateItem[]> {
  const params = new URLSearchParams()
  if (category.trim()) params.set('category', category.trim())
  if (nodeTypeName.trim()) params.set('node_type_name', nodeTypeName.trim())
  const query = params.toString()
  const data = await fetchJson(`/list${query ? `?${query}` : ''}`)
  return unwrapList(data).map(normalizePrompt).filter((item): item is PromptTemplateItem => !!item)
}
