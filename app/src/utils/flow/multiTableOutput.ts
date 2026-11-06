export interface OutputColumnMapping {
  colId: string
  fromId: string
  [key: string]: unknown
}

export interface OutputTableDefinition {
  entryTypeId: number
  keys: string[]
  colMap: OutputColumnMapping[]
  ignored?: string[]
  pCol?: string
  subs?: OutputTableDefinition[]
  [key: string]: unknown
}

export interface OutputTableConfig {
  table?: OutputTableDefinition
  [key: string]: unknown
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function tableDefinition(value: unknown): value is OutputTableDefinition {
  if (!record(value) || !Number.isSafeInteger(value.entryTypeId) || Number(value.entryTypeId) <= 0) return false
  if (!Array.isArray(value.keys) || !value.keys.every((key) => typeof key === 'string')) return false
  if (!Array.isArray(value.colMap) || !value.colMap.every((item) => record(item) && typeof item.colId === 'string' && typeof item.fromId === 'string')) return false
  if (value.ignored !== undefined && (!Array.isArray(value.ignored) || !value.ignored.every((key) => typeof key === 'string'))) return false
  if (value.pCol !== undefined && typeof value.pCol !== 'string') return false
  return value.subs === undefined || (Array.isArray(value.subs) && value.subs.every(tableDefinition))
}

/** 不改写无法识别的历史配置；高级属性及更深的 subs 在可视化编辑时原样保留。 */
export function readOutputTableConfig(text: string): { config?: OutputTableConfig; error?: string } {
  if (!text.trim()) return { config: {} }
  try {
    const value: unknown = JSON.parse(text)
    if (!record(value) || (value.table !== undefined && !tableDefinition(value.table))) {
      return { error: '当前结构化配置不适合可视化编辑，请通过高级配置维护；原内容已保留。' }
    }
    return { config: value as OutputTableConfig }
  } catch {
    return { error: '当前结构化配置不是可识别的 JSON，请通过高级配置维护；原内容已保留。' }
  }
}

export function writeOutputTableConfig(config: OutputTableConfig, table: OutputTableDefinition): string {
  return JSON.stringify({ globals: [], checkIds: [], ...config, table })
}
