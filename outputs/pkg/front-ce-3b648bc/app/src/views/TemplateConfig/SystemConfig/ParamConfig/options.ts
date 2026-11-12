// 参数设置的「是否内置参数」码值（旧 ai-chat-view src/system/config/modules/ConfigEditForm.vue）。
//
// ⚠️ 旧页面这里有一处缺陷：弹窗的单选框渲染的是父组件传进来的 typeOptions 字典数组，
// 而父组件 ConfigIndex.vue 把它初始化成 [] 且从未加载过字典（created 是空的），所以旧弹窗实际渲染不出任何选项。
// 按旧字段语义（'Y' 内置 / 'N' 非内置，旧表单默认值 'Y'）补齐两个选项，其余口径不变（见弹窗偏差说明 1）。

/** 是否内置参数：'Y' / 'N'（字符串口径照旧平台） */
export const SYSTEM_CONFIG_TYPE_OPTIONS = [
  { label: '是', value: 'Y' },
  { label: '否', value: 'N' },
] as const
