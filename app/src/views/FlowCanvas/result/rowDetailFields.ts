import type { DataTableMeta, EntryDetailItem } from '@/api'

/** 数据行详情字段：画布数据视图 / 网站数据视图共用。 */
export interface RowDetailField {
  key: string
  name: string
  code: string
  prop: string
  value: string
  empty: boolean
  href?: string
  filePath?: string
}

export function isBlankDetailValue(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

export function formatDetailValue(value: unknown): string {
  if (isBlankDetailValue(value)) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function safeHttpUrl(value: unknown): string {
  const url = String(value ?? '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
  } catch {
    return ''
  }
}

/** 与 DataGrid 路径格同一套旧平台判据：path/minio/地址/路径/图片，且值以 / 开头。 */
export function isOssFilePath(field: { prop?: string; desc?: string }, value: string): boolean {
  if (!value.startsWith('/')) return false
  const code = String(field.prop || '').toLowerCase()
  const label = String(field.desc || '')
  return code.includes('path') || code.includes('minio')
    || label.includes('地址') || label.includes('路径') || label.includes('图片')
}

export function fieldsFromTableMeta(
  fields: DataTableMeta['fields'] | undefined,
  values: Record<string, unknown> | undefined,
): RowDetailField[] {
  if (!fields?.length) return []
  return fields.map((field) => {
    const raw = values?.[field.columnName ?? field.prop]
    const value = formatDetailValue(raw)
    const empty = isBlankDetailValue(raw)
    const href = safeHttpUrl(raw)
    const filePath = !href && !empty && isOssFilePath(field, value) ? value : undefined
    return {
      key: field.prop,
      name: field.desc || field.prop,
      code: field.prop,
      prop: field.prop,
      value,
      empty,
      href: href || undefined,
      filePath,
    }
  })
}

export function fieldsFromShowItems(items: EntryDetailItem[] | undefined): RowDetailField[] {
  return (items ?? []).map((item) => {
    const raw = item.value
    const value = formatDetailValue(raw)
    const empty = isBlankDetailValue(raw)
    const href = safeHttpUrl(raw)
    return {
      key: item.itemId ?? item.columnName,
      name: item.itemName || item.columnName,
      code: item.columnName,
      prop: item.columnName,
      value,
      empty,
      href: href || undefined,
    }
  })
}
