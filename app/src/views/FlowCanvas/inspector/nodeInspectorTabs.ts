import { isDataValidationNode, isRuleNode, rendersAsRuleNode, isMonitorNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { validateTableBinding } from '@/utils/flow/ruleOrchestration'

export type NodeInspectorTab = 'config' | 'table' | 'orchestration' | 'deployment' | 'task' | 'ai'
/** 第三个元素是禁用原因（悬浮提示文案）；不存在 = 可用 */
export type NodeInspectorTabItem = [NodeInspectorTab, string, string?]

/**
 * 0804 拍板（决议 D5+D8）：规则节点与采集节点收敛成同一套 Tab——表配置/编排配置对所有节点一致，
 * 「编排配置」内部按节点类型分发内容（规则处理=脚本，列表/详情=抓取配置，登录=登录配置，见 S3）。
 *
 * 参数绑定和出参列属于任务配置，采集类节点在任务 Tab 内配置，不再单列参数 Tab。
 *
 * 规则处理与采集节点均可直接打开智能体配置，按当前节点 configId 读取生成参数。
 * 表字段校验放在实际执行操作中；监控、数据校验、PDF 保留各自的表绑定要求。
 */
export function nodeInspectorTabs(cfg?: NodeConfig, options: { includeAi?: boolean } = {}): NodeInspectorTabItem[] {
  const isRule = !!cfg && isRuleNode(cfg)
  const ruleStyled = rendersAsRuleNode(cfg)
  const tabs: NodeInspectorTabItem[] = [
    ['config', '节点配置'],
    ['table', '表配置'],
    ['orchestration', '智能体配置'],
    ['deployment', '部署配置'],
    ['task', '任务配置'],
    ...(options.includeAi === false ? [] : [['ai', 'AI 对话'] as NodeInspectorTabItem]),
  ]
  // 普通规则节点已复用采集节点的智能体工作区，配置入口不再被旧脚本的字段校验挡住。
  // 其他规则式节点仍按自己的绑定内容校验（PDF 在 execCfg，监控/校验在 ruleCfg）。
  const agentRule = isRule && !isMonitorNode(cfg) && !isDataValidationNode(cfg)
  if (ruleStyled && !agentRule) {
    const binding = isRule ? cfg?.ruleCfg : cfg?.execCfg
    if (validateTableBinding(binding ?? { inputTableId: '', inputFields: [], outputFields: [] }, { requireOutput: !isMonitorNode(cfg) && !isDataValidationNode(cfg) })) {
      const orchestration = tabs.find((t) => t[0] === 'orchestration')!
      orchestration[2] = '请先在「表配置」完成输入/输出表与字段选择'
    }
  }
  return tabs
}
