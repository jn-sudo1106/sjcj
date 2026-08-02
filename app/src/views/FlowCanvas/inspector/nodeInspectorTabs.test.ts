import { describe, expect, it } from 'vitest'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'

const ordinaryNode = { kind: 'node' } as NodeConfig
const decisionNode = { kind: 'decision' } as NodeConfig
const ruleNode = { title: '规则处理', kind: 'node' } as NodeConfig

describe('nodeInspectorTabs', () => {
  it('keeps parameter configuration as an independent tab after table configuration', () => {
    expect(nodeInspectorTabs(ordinaryNode)).toEqual([
      ['config', '节点配置'],
      ['table', '表配置'],
      ['params', '参数配置'],
      ['task', '任务配置'],
      ['ai', 'AI 对话'],
    ])
  })

  it('only exposes branch configuration for decision nodes', () => {
    expect(nodeInspectorTabs(decisionNode)).toEqual([['config', '分支配置']])
  })

  // 0801 方案 §6.1（最新拍板调整）：规则处理节点用「编排配置」替换「表配置」，
  // 「任务配置」保留独立 Tab，「参数配置」去除。
  it('replaces table config with orchestration config for rule nodes, keeps task tab, drops params tab', () => {
    expect(nodeInspectorTabs(ruleNode)).toEqual([
      ['config', '节点配置'],
      ['orchestration', '编排配置'],
      ['task', '任务配置'],
      ['ai', 'AI 对话'],
    ])
  })
})
