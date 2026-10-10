import { isDataValidationNode, isRuleNode, rendersAsRuleNode, isMonitorNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { validateTableBinding } from '@/utils/flow/ruleOrchestration'

export type NodeInspectorTab = 'config' | 'table' | 'orchestration' | 'task' | 'ai'
/** 第三个元素是禁用原因（悬浮提示文案）；不存在 = 可用 */
export type NodeInspectorTabItem = [NodeInspectorTab, string, string?]

/**
 * 0804 拍板（决议 D5+D8）：规则节点与采集节点收敛成同一套 Tab——表配置/编排配置对所有节点一致，
 * 「编排配置」内部按节点类型分发内容（规则处理=脚本，列表/详情=抓取配置，登录=登录配置，见 S3）。
 *
 * 参数绑定和出参列属于任务配置，采集类节点在任务 Tab 内配置，不再单列参数 Tab。
 *
 * S2-2 门禁：规则节点在「表配置」绑完输入表与入参/出参字段之前，「编排配置」Tab 禁用。
 * 生成脚本使用节点已保存的 configId，不再要求先点中间保存按钮。
 * 非规则节点暂不设门禁：抓取配置内容本身还没建（S3），提前拦反而挡住占位内容。
 */
export function nodeInspectorTabs(cfg?: NodeConfig, options: { includeAi?: boolean } = {}): NodeInspectorTabItem[] {
  const isRule = !!cfg && isRuleNode(cfg)
  const ruleStyled = rendersAsRuleNode(cfg)
  const tabs: NodeInspectorTabItem[] = [
    ['config', '节点配置'],
    ['table', '表配置'],
    ['orchestration', '编排配置'],
    ['task', '任务配置'],
    ...(options.includeAi === false ? [] : [['ai', 'AI 对话'] as NodeInspectorTabItem]),
  ]
  // S2-2 门禁：规则式节点（含 PDF）在「表配置」绑完输入表与入参/出参字段之前，「编排配置」Tab 禁用。
  // PDF 的绑定内容在 execCfg，规则节点在 ruleCfg——按存储位取校验对象。
  if (ruleStyled) {
    const binding = isRule ? cfg?.ruleCfg : cfg?.execCfg
    if (validateTableBinding(binding ?? { inputTableId: '', inputFields: [], outputFields: [] }, { requireOutput: !isMonitorNode(cfg) && !isDataValidationNode(cfg) })) {
      const orchestration = tabs.find((t) => t[0] === 'orchestration')!
      orchestration[2] = '请先在「表配置」完成输入/输出表与字段选择'
    }
  }
  return tabs
}
