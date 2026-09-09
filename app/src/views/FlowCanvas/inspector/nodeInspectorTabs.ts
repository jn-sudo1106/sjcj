import { decisionOrParallelKind, isRuleNode, isMonitorNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { validateTableBinding } from '@/utils/flow/ruleOrchestration'

export type NodeInspectorTab = 'config' | 'table' | 'params' | 'orchestration' | 'task' | 'ai'
/** 第三个元素是禁用原因（悬浮提示文案）；不存在 = 可用 */
export type NodeInspectorTabItem = [NodeInspectorTab, string, string?]

/**
 * 0804 拍板（决议 D5+D8）：规则节点与采集节点收敛成同一套 Tab——表配置/编排配置对所有节点一致，
 * 「编排配置」内部按节点类型分发内容（规则处理=脚本，列表/详情=抓取配置，登录=登录配置，见 S3）。
 * 决策/分头节点不产表也不需要编排/任务，仍只有「分支配置」一个 Tab。
 *
 * 「参数配置」（0805 改判，推翻 D17）：D17 当时判断"参数资源不需要单独入口，挂节点上就行"，
 * 但采集节点的 URL 参数绑定（urlParamRefs/urlParamValues，管 $PARAM$_id 占位符取值）真的需要这个入口，
 * 手动拼 URL 没法替代——恢复入口，规则节点仍然没有（规则节点从没有过这个 Tab，不在本次改判范围）。
 *
 * S2-2 门禁：规则节点在「表配置」绑完输入表与入参/出参字段之前，「编排配置」Tab 禁用。
 * 生成脚本使用节点已保存的 configId，不再要求先点中间保存按钮。
 * 非规则节点暂不设门禁：抓取配置内容本身还没建（S3），提前拦反而挡住占位内容。
 */
export function nodeInspectorTabs(cfg?: NodeConfig, options: { includeAi?: boolean } = {}): NodeInspectorTabItem[] {
  if (cfg && decisionOrParallelKind(cfg) !== undefined) return [['config', '分支配置']]
  const isRule = !!cfg && isRuleNode(cfg)
  const tabs: NodeInspectorTabItem[] = [
    ['config', '节点配置'],
    ['table', '表配置'],
    ['orchestration', '编排配置'],
    ...(isRule ? [] : [['params', '参数配置'] as NodeInspectorTabItem]),
    ['task', '任务配置'],
    ...(options.includeAi === false ? [] : [['ai', 'AI 对话'] as NodeInspectorTabItem]),
  ]
  if (isRule && validateTableBinding(cfg?.ruleCfg ?? { inputTableId: '', inputFields: [], outputFields: [] }, { requireOutput: !isMonitorNode(cfg) })) {
    const orchestration = tabs.find((t) => t[0] === 'orchestration')!
    orchestration[2] = '请先在「表配置」完成输入/输出表与字段选择'
  }
  return tabs
}
