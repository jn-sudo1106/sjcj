/**
 * 数据视图条件构造器（0831 X5）。
 * 旧平台就是裸 SQL（cond / more）。会上开发人员问"K1 like 金融吗"、产品反问"要加引号吧"——
 * 说明那个框对使用者不可用。这里用字段/运算符/值拼出合法表达式，高级模式仍可手改 SQL。
 *
 * 不承诺 SQL 注入意义上的安全：这个框本来就是拼 WHERE，值里的单引号转义，其余交给后端。
 */
export type CondOp = '=' | '!=' | 'LIKE' | 'NOT LIKE' | '>' | '>=' | '<' | '<=' | 'IS NULL' | 'IS NOT NULL'

export interface CondField {
  prop: string
  columnName?: string
  desc?: string
  type?: string
}

export interface CondRow {
  field: string
  op: CondOp
  value: string
}

export const COND_OPS: { value: CondOp; label: string; needsValue: boolean }[] = [
  { value: '=', label: '=', needsValue: true },
  { value: '!=', label: '!=', needsValue: true },
  { value: 'LIKE', label: 'LIKE', needsValue: true },
  { value: 'NOT LIKE', label: 'NOT LIKE', needsValue: true },
  { value: '>', label: '>', needsValue: true },
  { value: '>=', label: '>=', needsValue: true },
  { value: '<', label: '<', needsValue: true },
  { value: '<=', label: '<=', needsValue: true },
  { value: 'IS NULL', label: '为空', needsValue: false },
  { value: 'IS NOT NULL', label: '非空', needsValue: false },
]

export function fieldLabel(field: CondField): string {
  const name = field.desc || field.prop
  const col = field.columnName || field.prop
  return name === col ? col : `${name}-${col}`
}

export function physicalColumn(fields: CondField[], token: string): string {
  const hit = fields.find((f) => f.prop === token || f.columnName === token)
  return hit?.columnName || hit?.prop || token
}

function isNumericField(fields: CondField[], token: string): boolean {
  const hit = fields.find((f) => f.prop === token || f.columnName === token)
  return hit?.type === 'number' || hit?.type === 'int' || hit?.type === 'long' || hit?.type === 'float'
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

function quoted(fields: CondField[], field: string, raw: string): string {
  if (isNumericField(fields, field) && /^-?\d+(\.\d+)?$/.test(raw.trim())) return raw.trim()
  return `'${escapeSqlString(raw)}'`
}

export function compileCond(rows: CondRow[], joiner: 'AND' | 'OR', fields: CondField[]): string {
  const parts: string[] = []
  for (const row of rows) {
    if (!row.field) continue
    const col = physicalColumn(fields, row.field)
    const op = COND_OPS.find((item) => item.value === row.op) ?? COND_OPS[0]
    if (!op.needsValue) {
      parts.push(`${col} ${row.op}`)
      continue
    }
    const raw = row.value.trim()
    if (!raw) continue
    if (row.op === 'LIKE' || row.op === 'NOT LIKE') {
      const needle = raw.includes('%') ? raw : `%${raw}%`
      parts.push(`${col} ${row.op} ${quoted(fields, row.field, needle)}`)
      continue
    }
    parts.push(`${col} ${row.op} ${quoted(fields, row.field, raw)}`)
  }
  return parts.join(` ${joiner} `)
}

/** SQL → 构造器：只能认完全由本构造器生成的形状，认不出就返回 null，调用方停在高级模式。 */
export function parseCond(sql: string, fields: CondField[]): { rows: CondRow[]; joiner: 'AND' | 'OR' } | null {
  const text = sql.trim()
  if (!text) return { rows: [{ field: '', op: '=', value: '' }], joiner: 'AND' }
  const joiner: 'AND' | 'OR' = /\sOR\s/i.test(text) && !/\sAND\s/i.test(text) ? 'OR' : 'AND'
  const chunks = text.split(joiner === 'OR' ? /\sOR\s/i : /\sAND\s/i).map((s) => s.trim()).filter(Boolean)
  const rows: CondRow[] = []
  const colSet = new Set(fields.flatMap((f) => [f.columnName, f.prop].filter(Boolean) as string[]))
  for (const chunk of chunks) {
    const nullHit = chunk.match(/^(\S+)\s+(IS(?:\s+NOT)?\s+NULL)$/i)
    if (nullHit) {
      if (colSet.size && !colSet.has(nullHit[1])) return null
      rows.push({ field: nullHit[1], op: nullHit[2].toUpperCase().includes('NOT') ? 'IS NOT NULL' : 'IS NULL', value: '' })
      continue
    }
    const hit = chunk.match(/^(\S+)\s+(NOT\s+LIKE|LIKE|!=|>=|<=|=|>|<)\s+(.+)$/i)
    if (!hit) return null
    const col = hit[1]
    if (colSet.size && !colSet.has(col)) return null
    let value = hit[3].trim()
    const quoted = (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))
    if (quoted) value = value.slice(1, -1).replace(/''/g, "'")
    else if (!/^-?\d+(\.\d+)?$/.test(value)) return null
    const op = hit[2].toUpperCase().replace(/\s+/, ' ') as CondOp
    if (op === 'LIKE' || op === 'NOT LIKE') value = value.replace(/^%/, '').replace(/%$/, '')
    rows.push({ field: col, op, value })
  }
  return rows.length ? { rows, joiner } : null
}
