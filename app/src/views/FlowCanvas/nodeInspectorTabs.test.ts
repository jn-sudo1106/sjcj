import { describe, expect, it } from 'vitest'
import type { NodeConfig } from './flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'

const ordinaryNode = { kind: 'node' } as NodeConfig
const decisionNode = { kind: 'decision' } as NodeConfig

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
})
