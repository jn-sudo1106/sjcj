// 数据字典配置的查询/导出码值口径（1:1 抄旧 ai-chat-view src/demo/DataIndexList.vue:48-56、28-33）。
// 查询区、列表列、导出三处共用，避免三份文案各写各的。
//
// ⚠️ 本域的 type 是**字符串**（后端存的就是 'ORG' / 'DATE' 这类字面量，旧列表直接展示、
// 「编码」下拉把它拼在 code 后面显示），既不是问句改写的 '10'/'11'/'20'，也不是自动补全的数字 1，
// 所以这里没有 type 的枚举表 —— 旧页面「类型」就是一个自由文本输入框。

import type { DataIndexCodeOption } from '@/api/types/template'

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台） */
export const DATA_INDEX_CONFIG_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

/** 查询区「状态」下拉的空值项：旧平台显示 全部 */
export const STATUS_ALL_OPTION_LABEL = '全部'

export function dataIndexConfigStatusLabel(value: unknown): string {
  return String(value) === '0' ? '启用' : '禁用'
}

/** 「编码」下拉的选项文案：旧页面就是 `编码 类型` 两段拼接（type 为空时不显示 "null"） */
export function dataIndexCodeOptionLabel(option: DataIndexCodeOption): string {
  return `${String(option.code ?? '')} ${String(option.type ?? '')}`.trim()
}
