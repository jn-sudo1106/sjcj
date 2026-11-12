# canvas/
画布核心：FlowBoard 渲染、布局算法、流程模型

- FlowBoard.vue: 画布主组件（节点 + 连线 + 操作）
- flowModel.ts: 类型定义 + applyParamSourceUrlToFirstCollectNode
- flowModel.seeds.ts: NODE_CONFIGS 种子 + makeXxx 工厂
- flowModel.layout.ts: buildHorizontalLayout / normalizeNodeConfig
- AddNodePopover.vue: 加节点浮层（仅 FlowBoard 引用）
- FlowXmlDialog.vue: 导出 XML 弹窗（仅 FlowBoard 引用）

**依赖**：utils/flow/*, shared/CanvasHeader
**被依赖**：inspector/ source/ 通过 stores/flow 间接引用；`views/FlowTemplate/index.vue` 直接 import（见 A.9.1）
