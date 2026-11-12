// 问句改写的两个枚举字典（1:1 抄旧 ai-chat-view src/demo/QuestionDicList.vue:10-46、
// modal/QuestionDicEditor.vue:16-44）。查询区、列表列、编辑弹窗三处共用，避免三份文案各写各的。
//
// ⚠️ type 在这个域是**字符串** '10'/'11'/'20'（旧平台前后端都按字符串比），不是自动补全那个数字 1。
// 旧列表对匹配不上的值渲染成空白（v-if 链没有兜底分支），这里同样返回空串，不编造「未知类型」。

/** 阶段（stepCode） */
export const QUESTION_DIC_STEP_OPTIONS = [
  { label: '前置替换', value: 'pre-replace' },
  { label: '后置替换', value: 'after-replace' },
  { label: '大模型调用前替换', value: 'before-llm' },
  { label: '大模型调用后替换', value: 'after-llm' },
] as const

/** 类型（type） */
export const QUESTION_DIC_TYPE_OPTIONS = [
  { label: '简单替换', value: '10' },
  { label: '正则替换', value: '11' },
  { label: '字段替换', value: '20' },
] as const

/** 查询区下拉的「全部」空值项：旧平台阶段/类型显示 --ALL--，状态显示 全部，1:1 保留这个不一致 */
export const STEP_ALL_OPTION_LABEL = '--ALL--'
export const TYPE_ALL_OPTION_LABEL = '--ALL--'
export const STATUS_ALL_OPTION_LABEL = '全部'

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台） */
export const QUESTION_DIC_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

export function questionDicStepLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return QUESTION_DIC_STEP_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}

export function questionDicTypeLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return QUESTION_DIC_TYPE_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}
