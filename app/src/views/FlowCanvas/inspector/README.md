# inspector/
节点配置面板：选中节点后右侧/底部展示的配置 UI

- NodeInspector.vue: 主壳（左侧 tab 栏 + 右侧内容分发）
- tabs/CollectConfigTab.vue: 表配置
- tabs/TaskConfigTab.vue:   任务配置
- tabs/ParamsTab.vue: 任务配置内的参数绑定；输出字段统一在表配置维护
- tabs/TableTab.vue: 输入字段统一维护任务 context；输出沿用 outContext
- tabs/RuleOrchestrationTab.vue: 规则编排
- tabs/NodeAiChatTab.vue:   AI 助手
- ConditionRow.vue: 公共子组件（节点进入条件）
- CollectorSettings.vue / UrlParamEditor.vue: 节点配置子组件
- TableEditDialog.vue / NodeAiChat.vue: 弹窗
- TaskScheduleSettings.vue: 任务调度设置（仅 CollectorSettings 引用）

**依赖**：canvas/, source/, stores/flow
**被依赖**：FlowBoard 引用 NodeInspector；`views/FlowTemplate/index.vue` 直接 import（见 A.9.1）
