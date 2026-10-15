// 页面配置的查询/导出码值口径（1:1 抄旧 ai-chat-view src/system/config/SysPageConfigList.vue:30-34、64-69）。
// 查询区、列表列、导出三处共用，避免三份文案各写各自的。
// ⚠️ 本域实体虽有 type 字段，但旧页面的类型列与搜索框全部注释掉了，这里没有 type 的枚举表。

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台） */
export const PAGE_CONFIG_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

/** 查询区「状态」下拉的空值项：旧平台显示 全部 */
export const STATUS_ALL_OPTION_LABEL = '全部'

/**
 * 旧列表用的是 `v-if status==0 启用 / v-else-if status==1 禁用`，匹配不上的值渲染成空白，
 * 这里同样返回空串，不编造第三种状态。（真实响应可能回数字 0，比较前先 String()。）
 */
export function pageConfigStatusLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return PAGE_CONFIG_STATUS_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}
