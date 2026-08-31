import { describe, expect, it } from 'vitest'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'

const ordinaryNode = { kind: 'node' } as NodeConfig
const decisionNode = { kind: 'decision' } as NodeConfig
// isRuleNode 口径是"带不带 ruleCfg"（0805 修正，见 flowModel.test.ts），不是标题里含不含"规则"——
// 未保存的规则节点也必须带一个（空 ruleId 的）ruleCfg，否则它在插入瞬间就会被判定成非规则节点。
const ruleNodeUnsaved = { title: '规则处理', kind: 'node', ruleCfg: { mode: 'new', describe: '' } } as unknown as NodeConfig
const ruleNodeSaved = { title: '规则处理', kind: 'node', ruleCfg: { mode: 'ref', describe: '', ruleId: 'orch-1' } } as unknown as NodeConfig

// 0804 拍板（决议 D5+D8）：规则节点与采集节点收敛成同一套 Tab；
// 0805 改判（推翻 D17）：「参数配置」对非规则节点恢复，规则节点仍然没有（见 nodeInspectorTabs.ts 顶部注释）。
describe('nodeInspectorTabs', () => {
  it('ordinary node gets the unified tab set: config/table/orchestration/params/task/ai, nothing disabled', () => {
    expect(nodeInspectorTabs(ordinaryNode)).toEqual([
      ['config', '节点配置'],
      ['table', '表配置'],
      ['orchestration', '编排配置'],
      ['params', '参数配置'],
      ['task', '任务配置'],
      ['ai', 'AI 对话'],
    ])
  })

  it('can hide AI for the flow-center workspace', () => {
    expect(nodeInspectorTabs(ordinaryNode, { includeAi: false }).map(([key]) => key)).toEqual([
      'config', 'table', 'orchestration', 'params', 'task',
    ])
  })

  it('only exposes branch configuration for decision nodes', () => {
    expect(nodeInspectorTabs(decisionNode)).toEqual([['config', '分支配置']])
  })

  it('rule node gets the same tab keys/labels as an ordinary node, minus 参数配置', () => {
    const ruleTabs = nodeInspectorTabs(ruleNodeSaved).map(([key, label]) => [key, label])
    const ordinaryTabs = nodeInspectorTabs(ordinaryNode)
      .filter(([key]) => key !== 'params')
      .map(([key, label]) => [key, label])
    expect(ruleTabs).toEqual(ordinaryTabs)
  })

  // S2-2 门禁（开发方案 §2.2）：规则节点没保存过业务规则（无 ruleId）时，编排配置 Tab 禁用并带提示文案；
  // 拿到 ruleId 后（保存过一次）解锁，之后即使表字段又被改动也不会重新锁上（见 S2-2 说明，避免抖动）。
  it('unsaved rule node: orchestration tab disabled with a hint; saved rule node: enabled', () => {
    const unsaved = nodeInspectorTabs(ruleNodeUnsaved).find(([key]) => key === 'orchestration')!
    expect(unsaved[2]).toBeTruthy()

    const saved = nodeInspectorTabs(ruleNodeSaved).find(([key]) => key === 'orchestration')!
    expect(saved[2]).toBeUndefined()
  })

  it('ordinary node never gets the orchestration gate (its content is not built yet, see S3)', () => {
    const orchestration = nodeInspectorTabs(ordinaryNode).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })
})
