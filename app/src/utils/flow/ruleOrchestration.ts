// 规则编排：测试取数行映射（0801 方案 §8.6）。
// 0803 起表列表/字段列表改走 vrule 跨租户搜索（news-getTableList/news-getTableFields），
// 不再需要采集中心 EntryType/EntryField → RuleTableOption/RuleFieldOption 的转换，
// 这里只保留跟表来源无关的纯字段处理工具。
import type { RuleFieldOption } from '@/api/types'

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
