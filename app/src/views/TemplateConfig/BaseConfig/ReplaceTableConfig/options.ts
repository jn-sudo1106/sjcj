// 表改写管理的枚举字典（1:1 抄旧 ai-chat-view src/demo/ReplaceTableConfigList.vue:84-128、
// modal/ReplaceTableConfigEditor.vue:28-40）。列表列与编辑弹窗共用，避免两份文案各写各的。
//
// 与选表规则配置（MatchTableConfig/options.ts）不同的一点：旧列表的「类型」列就是 `dataIndex: 'replaceType'`，
// **没有任何码值映射**（旧 ReplaceTableConfigList.vue:97-102），所以这里列表原样渲染码值，不做中英文转换。
// 真实行取值只有 unionall（2026-10-15 在 186 抓样，全库 2 条都是 unionall）。

/** 替换类型（replaceType）：旧弹窗下拉只有这一项，新增即默认 unionall */
export const REPLACE_TABLE_TYPE_OPTIONS = [
  { label: 'unionall', value: 'unionall' },
] as const

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台；真实响应回的是数字，比较一律走 String(row.status)） */
export const REPLACE_TABLE_CONFIG_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

export const STATUS_ALL_OPTION_LABEL = '全部'
