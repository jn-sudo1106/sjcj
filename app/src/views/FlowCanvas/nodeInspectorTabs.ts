import { decisionOrParallelKind, type NodeConfig } from './flowModel'

export type NodeInspectorTab = 'config' | 'table' | 'params' | 'task' | 'ai'
export type NodeInspectorTabItem = [NodeInspectorTab, string]

/** 决策/分头节点只需要分支配置；其余节点按固定顺序展示配置页签。 */
export function nodeInspectorTabs(cfg?: NodeConfig): NodeInspectorTabItem[] {
  if (cfg && decisionOrParallelKind(cfg) !== undefined) return [['config', '分支配置']]
  return [
    ['config', '节点配置'],
    ['table', '表配置'],
    ['params', '参数配置'],
    ['task', '任务配置'],
    ['ai', 'AI 对话'],
  ]
}
