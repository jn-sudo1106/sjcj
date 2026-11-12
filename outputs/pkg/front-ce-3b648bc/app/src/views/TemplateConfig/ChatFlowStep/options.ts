// 提示词配置的查询区枚举（1:1 抄旧 ai-chat-view src/demo/ChatFlowStepList.vue:10-16）。
//
// 这一页只有「状态」一个筛选项，没有码值列（步骤编码/流程编码都是自由文本，不是字典码值），
// 所以不像 QuestionDic / DataIndexSync 那样有 step/type 两套字典，只保留状态。
// 旧列表对状态用 v-if 链渲染「启用/禁用」文字（没有兜底分支，别的值渲染成空白），
// 这里按 front-ce 模板配置域的约定统一成 String(status) === '0' 才算启用。

/** 状态：'0' 启用 / '1' 禁用（字符串口径照旧平台） */
export const CHAT_FLOW_STEP_STATUS_OPTIONS = [
  { label: '启用', value: '0' },
  { label: '禁用', value: '1' },
] as const

export const STATUS_ALL_OPTION_LABEL = '全部'
