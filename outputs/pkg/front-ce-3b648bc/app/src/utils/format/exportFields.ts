/**
 * 导出表字段定义（对齐旧平台 EntryTypeDetail.handleExcel）。
 *
 * 列：序号 / 内部ID / 数据库列 / 字段编码 / 字段名称 / 数据类型
 * 类型规则：string → varchar(列宽)，列宽缺省或 <=0 按 128；其他类型原样。
 * 文件名：表字段_{物理表名去 schema 前缀}_{yyyyMMdd}；sheet 标题：表:{物理表名去前缀}。
 *
 * 数据中心「表结构详情」（? 按钮）和「数据详情抽屉」（点一行）共用这一份，
 * 避免两份导出逻辑各自漂移（对齐旧平台，见 1008-会议功能调整 详情对齐）。
 */
import type { DataTableMeta } from '@/api'
import { downloadXlsx } from './xlsxExport'

/** string → varchar(列宽)，列宽缺省或 <=0 按 128（老平台口径） */
export function fieldColumnType(field: DataTableMeta['fields'][number]): string {
  if (field.type === 'string') {
    const width = field.width && field.width > 0 ? field.width : 128
    return `varchar(${width})`
  }
  return field.type || ''
}

/** 物理表名去 schema 前缀（sense_data.TB_GNBK → TB_GNBK） */
export function physicalTableName(tableName?: string): string {
  return tableName?.split('.').pop() ?? ''
}

/** 导出字段定义 xlsx；无表元信息时不动作（调用方负责提示） */
export function exportTableFields(tableMeta: DataTableMeta | null): void {
  if (!tableMeta) return
  const rows: string[][] = [['序号', '内部ID', '数据库列', '字段编码', '字段名称', '数据类型']]
  for (const field of tableMeta.fields) {
    rows.push([
      String(field.seq ?? ''),
      field.itemId ?? '',
      field.columnName ?? '',
      field.prop ?? '',
      field.desc ?? '',
      fieldColumnType(field),
    ])
  }
  const table = physicalTableName(tableMeta.tableName)
  const date = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/[-/]/g, '')
  downloadXlsx(`表字段_${table}_${date}`, rows, `表:${table}`)
}
