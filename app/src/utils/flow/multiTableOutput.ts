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

/** 输出表写入方式：单表（不写 subs）/ 多表（1 张副表）/ 超限（历史 ≥2 张或更深嵌套，只读）。 */
export type OutputMode = 'single' | 'multi' | 'overflow'

export function outputModeOfConfig(config: OutputTableConfig | undefined): OutputMode {
  const subs = config?.table?.subs ?? []
  if (!subs.length) return 'single'
  if (subs.length > 1 || subs.some((sub) => (sub.subs ?? []).length > 0)) return 'overflow'
  return 'multi'
}

export function outputModeOf(text: string): OutputMode {
  return outputModeOfConfig(readOutputTableConfig(text).config)
}

/** 仅「多表」且恰好 1 张副表时返回该副表定义；单表 / 超限返回 undefined。 */
export function subTableOf(config: OutputTableConfig | undefined): OutputTableDefinition | undefined {
  if (outputModeOfConfig(config) !== 'multi') return undefined
  return config?.table?.subs?.[0]
}

/** 只改 table.subs，其余属性（globals / checkIds / 未知字段 / 主表定义）原样回写。 */
export function withSubTable(config: OutputTableConfig, sub: OutputTableDefinition | undefined): string {
  const table = config.table
  if (!table) return JSON.stringify(config)
  const next: OutputTableDefinition = { ...table }
  if (sub) next.subs = [sub]
  else delete next.subs
  return writeOutputTableConfig(config, next)
}

/** 字段 code：优先 columnName（K1），否则取 prop 的 -K<n> 后缀，用于主表/副表同名自动对应。 */
export function columnCodeOf(field: { columnName?: string; prop?: string }): string {
  if (field.columnName) return String(field.columnName)
  const matched = /(?:^|-)([A-Za-z]+\d+)$/.exec(String(field.prop ?? ''))
  return matched ? matched[1] : ''
}
