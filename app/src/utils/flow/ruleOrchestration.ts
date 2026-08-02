// 规则编排：表/字段模型转换 + 测试取数行映射（0801 方案 §4.3/§4.6/§8.6）。
// 表列表与字段列表本期直接复用采集中心 entryApi/dataApi，不走 vrule 的
// news-getTableList/news-getTableFields——两边 tableId 同源同编号空间，但 tableName 含义相反
// （vrule.tableName=中文名，EntryType.tableName=物理表名），本文件负责把这层差异抹平。
import type { EntryField, EntryType, RuleFieldOption, RuleTableOption } from '@/api/types'

export function ruleTableOptionFromEntryType(entry: Pick<EntryType, 'tableId' | 'tableName' | 'name' | 'keyField'>): RuleTableOption {
  return {
    tableId: entry.tableId,
    // EntryType 无中文名时退回物理表名，保证下拉始终有文案可显示
    tableName: entry.name || entry.tableName,
    dbTableName: entry.tableName,
    keyField: entry.keyField,
  }
}

export function ruleFieldOptionFromEntryField(field: EntryField): RuleFieldOption {
  return {
    itemCode: field.prop,
    itemName: field.desc,
    columnName: field.columnName,
    dataType: field.type,
    seq: field.seq,
  }
}

/** 系统固定字段（ID/SOURCE_ID/UPDATE_DT/CREATE_DT），seq 为负；UI 默认折叠不展示在入参/出参可选项里 */
export function isSystemField(field: Pick<RuleFieldOption, 'seq'>): boolean {
  return (field.seq ?? 0) < 0
}

/**
 * 测试取数返回的行只含物理列（如 { ENTRY_ID, K1:"2025年", K7:"49.7" }），不含 itemCode 这层 key
 * （实测确认，见 0801 方案 §8.6）。回填入参表单只能靠 columnName 一条路；旧字段缺失（如某行没有
 * K5 列）时填空串，交由调用方决定是否提示「该行没有可填充的 xx 字段」。
 */
export function mapRowToInputFields(
  row: Record<string, unknown>,
  inputFields: string[],
  allFields: Pick<RuleFieldOption, 'itemCode' | 'columnName'>[],
): Record<string, string> {
  const byItemCode = new Map(allFields.map((f) => [f.itemCode, f.columnName]))
  const result: Record<string, string> = {}
  for (const itemCode of inputFields) {
    const columnName = byItemCode.get(itemCode)
    const value = columnName ? row[columnName] : undefined
    result[itemCode] = value == null ? '' : String(value)
  }
  return result
}
