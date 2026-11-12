// 真实后端 config/loadParams 返回形态不固定，统一归一成 { [configId]: 参数[] }。
// 供 SourceParamModal（展示）与发抓取流程（判断是否弹框）共用，避免逻辑分歧。

function asParamArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  if (v && typeof v === 'object' && Array.isArray((v as { list?: unknown }).list)) {
    return (v as { list: Record<string, unknown>[] }).list
  }
  if (v && typeof v === 'object') return [v as Record<string, unknown>]
  return []
}

export function normalizeLoadParams(raw: unknown): Record<string, Record<string, unknown>[]> {
  if (!raw) return {}
  if (Array.isArray(raw)) {
    const out: Record<string, Record<string, unknown>[]> = {}
    for (const item of raw as Record<string, unknown>[]) {
      const key = String(item.configId ?? item.cfgId ?? item.cfg ?? item.config_id ?? 'default')
      ;(out[key] ||= []).push(item)
    }
    return out
  }
  if (typeof raw === 'object') {
    const out: Record<string, Record<string, unknown>[]> = {}
    for (const k of Object.keys(raw as Record<string, unknown>)) {
      out[k] = asParamArray((raw as Record<string, unknown>)[k])
    }
    return out
  }
  return {}
}

// 是否有「实际参数」（分组存在但组内为空也算无参数，不应弹框）。
export function hasLoadParams(raw: unknown): boolean {
  const norm = normalizeLoadParams(raw)
  return Object.values(norm).some((arr) => arr.length > 0)
}
