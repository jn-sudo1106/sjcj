// 选表规则配置的枚举字典（1:1 抄旧 ai-chat-view src/demo/MatchTableConfigList.vue:104-106、
// modal/MatchTableConfigEditor.vue:24-45）。列表的选表类型列与编辑弹窗下拉共用，避免两份文案各写各的。
//
// ⚠️ 旧列表对 selectionType 的渲染是 `text === 'text_selection' ? '问句选表' : '向量选表'`
// （MatchTableConfigList.vue:104-106），即**除问句选表外一律显示成向量选表**：后端哪天回一个新码值，
// 或者行里这个字段为空，界面上都会被静默标成「向量选表」。这里按本域先例（见 QuestionDic/options.ts）
// 改成查不到就留空，不替旧的那个兜底分支编造含义。

/** 选表类型（selectionType）：旧弹窗下拉只有这两项，新增默认问句选表 */
export const MATCH_TABLE_SELECTION_TYPE_OPTIONS = [
  { label: '问句选表', value: 'text_selection' },
  { label: '向量选表', value: 'vector_selection' },
] as const

export function matchTableSelectionTypeLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return MATCH_TABLE_SELECTION_TYPE_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}
