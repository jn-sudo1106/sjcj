// 数据索引同步的枚举字典（1:1 抄旧 ai-chat-view src/demo/DataIndexSyncList.vue:60-66、
// modal/DataIndexSyncConfigEditor.vue:32-44）。查询区、列表列、编辑弹窗三处共用。
//
// ⚠️ type 在这个域是**数字** 0/1/2（旧弹窗 :value="0" 就是数字，新增默认 2），
// 与问句改写那个域的字符串 '10'/'11'/'20' 不是一回事，别混用。
// 旧列表对匹配不上的值渲染成空白（v-if 链没有兜底分支），这里同样返回空串，不编造「未知类型」。

/** 同步类型（type）—— 旧弹窗顺序 sql同步 / 消息同步 / 分词同步 */
export const DATA_INDEX_SYNC_TYPE_OPTIONS = [
  { label: 'sql同步', value: 0 },
  { label: '消息同步', value: 1 },
  { label: '分词同步', value: 2 },
] as const

/** 旧新增弹窗的 type 初始值（DataIndexSyncConfigEditor.vue:98 `type: 2`） */
export const DATA_INDEX_SYNC_DEFAULT_TYPE = 2

export function dataIndexSyncTypeLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return DATA_INDEX_SYNC_TYPE_OPTIONS.find((option) => String(option.value) === raw)?.label ?? ''
}

/** 状态：'0' 启用 / '1' 禁用（186 实测真实响应回的是数字 0，比较一律先 String()） */
export const DATA_INDEX_SYNC_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

/** 查询区状态下拉的「全部」空值项：旧平台这里显示「全部」（问句改写的阶段/类型显示 --ALL--），1:1 保留 */
export const STATUS_ALL_OPTION_LABEL = '全部'

export function dataIndexSyncStatusLabel(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return DATA_INDEX_SYNC_STATUS_OPTIONS.find((option) => option.value === raw)?.label ?? ''
}
