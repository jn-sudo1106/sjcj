import { decisionOrParallelKind, isRuleNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

export type NodeInspectorTab = 'config' | 'table' | 'orchestration' | 'params' | 'task' | 'ai'
export type NodeInspectorTabItem = [NodeInspectorTab, string]

/**
 * 决策/分头节点只需要分支配置；规则处理节点用「编排配置」替换「表配置」，
 * 「任务配置」保留独立 Tab，「参数配置」去除（见 0801 方案 §6.1，最新拍板调整）——
 * 仅此一类节点变化，非规则节点的 Tab 集合原样不动。
 */
export function nodeInspectorTabs(cfg?: NodeConfig): NodeInspectorTabItem[] {
  if (cfg && decisionOrParallelKind(cfg) !== undefined) return [['config', '分支配置']]
  if (isRuleNode(cfg)) {
    return [
      ['config', '节点配置'],
      ['orchestration', '编排配置'],
      ['task', '任务配置'],
      ['ai', 'AI 对话'],
    ]
  }
  return [
    ['config', '节点配置'],
    ['table', '表配置'],
    ['params', '参数配置'],
    ['task', '任务配置'],
    ['ai', 'AI 对话'],
  ]
}
