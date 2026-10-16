// 实体改写管理的枚举字典（1:1 抄旧 ai-chat-view src/demo/EntityRewriteConfigList.vue:16-20、
// modal/EntityRewriteConfigEditor.vue:24-25、41-44）。查询区、列表列、编辑弹窗三处共用。
//
// ⚠️ 旧列表把「替换类型」直接渲染实体列 cleanType 的**原始码值**（List.vue:96-100 没有 customRender），
// 界面上看到的是 regular_replacement / simple_replacement 这两个英文码。这里按本域先例（选表规则配置的
// selectionType 同处理）改成渲染中文标签，未知/空缺码值留空 —— 列宽也从 150 压到 110。

/** 替换类型（cleanType）：旧弹窗下拉只有这两项，新增默认正则替换 */
export const ENTITY_REWRITE_CLEAN_TYPE_OPTIONS = [
  { label: '正则替换', value: 'regular_replacement' },
  { label: '简单替换', value: 'simple_replacement' },
] as const

export function entityRewriteCleanTypeLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return ENTITY_REWRITE_CLEAN_TYPE_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台） */
export const ENTITY_REWRITE_CONFIG_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

export const STATUS_ALL_OPTION_LABEL = '全部'
