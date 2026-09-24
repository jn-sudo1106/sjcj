import type { DataRow, DataTableMeta, EntryDetailItem } from '@/api'
import { extFromName, previewKindOf } from '@/utils/ossFile'

/** 数据行详情字段：画布数据视图 / 网站数据视图共用。 */
export interface RowDetailField {
  key: string
  name: string
  code: string
  prop: string
  /** 物理列名（K1/K2…）。写 SQL 条件、配规则用的是它，不是 prop——详情里单独摆出来
   *  （2026-09-09）。表格列头一直是「中文名-K1」，详情此前只有 prop，两处对不上。
   *  固定列（ENTRY_ID/SOURCE_ID 等）与旧 showItems 路径可能没有，故可选。 */
  columnName?: string
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

/** 与 DataGrid 路径格同一套判据：值以 / 开头，自带已知扩展名或字段名/编码含路径/文件/正文等特征。 */
export function isOssFilePath(field: { prop?: string; desc?: string }, value: string): boolean {
  if (!value.startsWith('/')) return false
  const ext = extFromName(value)
  if (ext && previewKindOf(ext) !== 'none') return true
  const code = String(field.prop || '').toLowerCase()
  const label = String(field.desc || '')
  return code.includes('path') || code.includes('minio')
    || code.includes('file') || code.includes('text') || code.includes('txt')
    || label.includes('地址') || label.includes('路径') || label.includes('图片')
    || label.includes('正文') || label.includes('文本') || label.includes('快照')
    || label.includes('文件') || label.includes('附件')
}

export function fieldsFromTableMeta(
  fields: DataTableMeta['fields'] | undefined,
  values: Record<string, unknown> | undefined,
  row?: Partial<DataRow> | null,
): RowDetailField[] {
  const mergedValues: Record<string, unknown> = { ...(values ?? {}) }
  if (row) {
    if (row.dataId !== undefined) mergedValues.ENTRY_ID = row.dataId
    if (row.parentId !== undefined) mergedValues.PARENT_ID = row.parentId
    if (row.sourceId !== undefined) mergedValues.SOURCE_ID = row.sourceId
    if (row.updateDt !== undefined) mergedValues.UPDATE_DT = row.updateDt
    if (row.createDt !== undefined) mergedValues.CREATE_DT = row.createDt
  }

  const rawFields = fields ?? []
  const hasEntryId = rawFields.some(
    (f) => f.prop.toUpperCase() === 'ENTRY_ID' || f.columnName?.toUpperCase() === 'ENTRY_ID',
  )

  const effectiveFields = [...rawFields]
  const entryIdVal = mergedValues.ENTRY_ID ?? mergedValues.entry_id ?? row?.dataId ?? values?.ENTRY_ID ?? values?.entry_id ?? values?.dataId
  if (!hasEntryId && entryIdVal !== undefined) {
    effectiveFields.unshift({
      prop: 'ENTRY_ID',
      columnName: 'ENTRY_ID',
      desc: 'ENTRY_ID',
      type: 'string',
    })
  }

  if (!effectiveFields.length) return []
  return effectiveFields.map((field) => {
    const raw = mergedValues[field.columnName ?? field.prop] ?? mergedValues[field.prop]
    const value = formatDetailValue(raw)
    const empty = isBlankDetailValue(raw)
    const href = safeHttpUrl(raw)
    const filePath = !href && !empty && isOssFilePath(field, value) ? value : undefined
    return {
      key: field.prop,
      name: field.desc || field.prop,
      code: field.prop,
      prop: field.prop,
      columnName: (field.columnName && field.columnName !== field.prop) ? field.columnName : undefined,
      value,
      empty,
      href: href || undefined,
      filePath,
    }
  })
}

export function fieldsFromShowItems(
  items: EntryDetailItem[] | undefined,
  row?: Partial<DataRow> | null,
): RowDetailField[] {
  const list = items ?? []
  const hasEntryId = list.some(
    (item) => item.columnName?.toUpperCase() === 'ENTRY_ID' || item.itemId?.toUpperCase() === 'ENTRY_ID',
  )
  const result: RowDetailField[] = []

  if (!hasEntryId && row?.dataId !== undefined) {
    result.push({
      key: 'ENTRY_ID',
      name: 'ENTRY_ID',
      code: 'ENTRY_ID',
      prop: 'ENTRY_ID',
      value: formatDetailValue(row.dataId),
      empty: isBlankDetailValue(row.dataId),
    })
  }

  for (const item of list) {
    const raw = item.value
    const value = formatDetailValue(raw)
    const empty = isBlankDetailValue(raw)
    const href = safeHttpUrl(raw)
    const filePath = !href && !empty && isOssFilePath({ prop: item.columnName, desc: item.itemName }, value) ? value : undefined
    // 这条路径（旧 entryDetail 的 showItems）本来就只给得出 columnName，code 即 K 名；
    // 不再重复塞 columnName，否则详情里会渲染成「K1 · K1」。
    result.push({
      key: item.itemId ?? item.columnName,
      name: item.itemName || item.columnName,
      code: item.columnName,
      prop: item.columnName,
      value,
      empty,
      href: href || undefined,
      filePath,
    })
  }
  return result
}
