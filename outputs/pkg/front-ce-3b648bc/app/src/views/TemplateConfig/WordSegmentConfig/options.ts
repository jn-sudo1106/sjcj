// 分词配置的查询/导出码值口径（1:1 抄旧 ai-chat-view src/demo/WordSegmentConfigList.vue:38-44、72-77）。
// 查询区、列表列、导出三处共用，避免三份文案各写各自的。
//
// ⚠️ 本域的 type / token 都是**字符串字面量**（186 实测真实行：ORGANIZATION / indicatorname / PERSON，
// token 为 base），旧页面三个字段一律是自由文本输入框，所以这里没有 type / token 的枚举表，
// 别照着数据索引同步（数字 0/1/2）或问句改写（'10'/'11'/'20'）在这里加枚举。

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台） */
export const WORD_SEGMENT_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

/** 查询区「状态」下拉的空值项：旧平台显示 全部 */
export const STATUS_ALL_OPTION_LABEL = '全部'

/**
 * 旧列表用的是 `v-if status==0 启用 / v-else-if status==1 禁用`，匹配不上的值渲染成空白，
 * 这里同样返回空串，不编造第三种状态。（186 实测真实响应回的是**数字** 0，比较前先 String()。）
 */
export function wordSegmentStatusLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return WORD_SEGMENT_STATUS_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}
