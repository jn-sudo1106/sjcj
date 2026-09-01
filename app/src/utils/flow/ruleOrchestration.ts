// 规则编排：测试取数行映射（0801 方案 §8.6）+ 表/字段绑定校验（0804 S2-2）+ 字段模型转换（0805 改判）。
// 0803 起表列表/字段列表曾改走 vrule 搜索（news-getTableList/news-getTableFields），0805 用户指出
// 采集中心自己的 entryType 和 vrule 那边其实是同一份底层表注册表（entryTypeId/itemCode 编号空间共享，
// 真机核对过 TB_NEWS_TAGS 两边 tableId 都是 2101991），规则节点没必要单独走一套查询——改回统一用
// entryApi（跟其他节点的表配置同源），这里补回 EntryField → RuleFieldOption 的转换。
import type { EntryField, RuleFieldOption, RuleOrchestration } from '@/api/types'

/** 系统固定字段（ID/SOURCE_ID/UPDATE_DT/CREATE_DT），seq 为负；UI 默认折叠不展示在入参/出参可选项里 */
export function isSystemField(field: Pick<RuleFieldOption, 'seq'>): boolean {
  return (field.seq ?? 0) < 0
}

/** EntryType.fields[] → RuleFieldOption[]，字段名对照见 entryFieldFromLegacy（prop ≙ itemCode，desc ≙ itemName） */
export function ruleFieldOptionFromEntryField(field: EntryField): RuleFieldOption {
  return {
    itemCode: field.prop,
    itemName: field.desc,
    columnName: field.columnName,
    dataType: field.type,
    seq: field.seq,
  }
}

/**
 * 表/字段绑定校验（0804 S2-2 从 RuleOrchestrationTab#validateMeta 抽成纯函数）：
 * 编排配置 Tab 门禁用这份判断；换数字 ruleId 在第一次生成脚本时 orchestrationSaveMeta。
 * 节点名称（= 规则名称）是否填写不在这里判断——那是节点配置的事，调用方另行检查。
 */
export function validateTableBinding(
  cfg: Pick<RuleOrchestration, 'inputTableId' | 'inputFields' | 'outputFields'>,
): string | undefined {
  if (!cfg.inputTableId) return '请选择输入表'
  if (!cfg.inputFields?.length) return '请至少选择 1 个入参字段'
  if (!cfg.outputFields?.length) return '请至少选择 1 个出参字段'
  return undefined
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
