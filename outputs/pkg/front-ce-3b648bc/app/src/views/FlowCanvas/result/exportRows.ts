import type { DataRow, DataTableMeta } from '@/api'
import { toCsv } from '@/utils/format/csvExport'

// 导出当前页全部字段，保留物理列名及身份列；不把缺失值写成展示占位符。
export function resultRowsCsv(rows: DataRow[], meta: DataTableMeta | null): string {
  const fields = new Map<string, string>([['ENTRY_ID', '数据 ID'], ['SOURCE_ID', '源 ID'], ['PARENT_ID', '父 ID'], ['STATE', '状态']])
  for (const field of meta?.fields ?? []) fields.set(field.columnName || field.prop, field.desc || field.prop)
  for (const row of rows) for (const key of Object.keys(row.values ?? {})) if (!fields.has(key)) fields.set(key, key)
  const columns = [...fields.keys()]
  const cell = (value: unknown): string => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    // 采集内容可能以公式字符开头，按文本交给电子表格打开。
    return /^[\s]*[=+@-]/.test(text) ? "'" + text : text
  }
  return toCsv([
    columns.map(key => fields.get(key) === key ? key : `${fields.get(key)}-${key}`),
    ...rows.map(row => {
      const values: Record<string, unknown> = { ...row.values, ENTRY_ID: row.dataId, SOURCE_ID: row.sourceId, PARENT_ID: row.parentId, STATE: row.state }
      if (row.createDt != null) values.CREATE_DT = row.createDt
      if (row.updateDt != null) values.UPDATE_DT = row.updateDt
      return columns.map(key => cell(values[key]))
    }),
  ])
}
