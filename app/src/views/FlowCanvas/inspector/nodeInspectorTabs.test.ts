import { describe, expect, it } from 'vitest'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'

const ordinaryNode = { kind: 'node' } as NodeConfig
const decisionNode = { kind: 'decision' } as NodeConfig
// isRuleNode 口径是"带不带 ruleCfg"（0805 修正，见 flowModel.test.ts），不是标题里含不含"规则"——
// 未保存的规则节点也必须带一个 ruleCfg，否则它在插入瞬间就会被判定成非规则节点。
const ruleNodeUnsaved = { title: '规则处理', kind: 'node', ruleCfg: { mode: 'new', describe: '' } } as unknown as NodeConfig
const ruleNodeBound = {
  title: '规则处理', kind: 'node',
  ruleCfg: {
    mode: 'new', describe: '',
    inputTableId: '2102154', inputFields: ['sku_id'], outputFields: ['sku_name'],
  },
} as unknown as NodeConfig
const ruleNodeSaved = {
  title: '规则处理', kind: 'node',
  configId: '1400998',
  ruleCfg: { mode: 'ref', describe: '', inputTableId: '2102154', inputFields: ['sku_id'], outputFields: ['sku_name'] },
} as unknown as NodeConfig

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

  // S2-2 门禁：规则节点未绑完表字段时，编排配置 Tab 禁用并带提示文案；
  // 绑完输入表 + 入参/出参字段后解锁（不依赖 ruleId）。表字段被清掉会重新锁上。
  it('unbound rule node: orchestration tab disabled; bound without ruleId: enabled', () => {
    const unsaved = nodeInspectorTabs(ruleNodeUnsaved).find(([key]) => key === 'orchestration')!
    expect(unsaved[2]).toBe('请先在「表配置」完成输入/输出表与字段选择')

    const bound = nodeInspectorTabs(ruleNodeBound).find(([key]) => key === 'orchestration')!
    expect(bound[2]).toBeUndefined()

    const saved = nodeInspectorTabs(ruleNodeSaved).find(([key]) => key === 'orchestration')!
    expect(saved[2]).toBeUndefined()
  })

  it('旧步骤规则ID选择占位 -1 且未绑表：编排配置仍禁用', () => {
    const node = { title: '规则处理', kind: 'node', ruleCfg: { mode: 'new', describe: '', ruleId: '-1' } } as unknown as NodeConfig
    const orchestration = nodeInspectorTabs(node).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeTruthy()
  })

  it('旧步骤规则ID选择占位 -1 但已绑表字段：编排配置可用', () => {
    const node = {
      title: '规则处理', kind: 'node',
      ruleCfg: {
        mode: 'new', describe: '', ruleId: '-1',
        inputTableId: '6200026', inputFields: ['code'], outputFields: ['url'],
      },
    } as unknown as NodeConfig
    const orchestration = nodeInspectorTabs(node).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })

  it('有 configId 但表字段被清掉：编排配置重新禁用', () => {
    const node = {
      title: '规则处理', kind: 'node', configId: '1400998',
      ruleCfg: { mode: 'ref', describe: '' },
    } as unknown as NodeConfig
    const orchestration = nodeInspectorTabs(node).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeTruthy()
  })

  it('ordinary node never gets the orchestration gate (its content is not built yet, see S3)', () => {
    const orchestration = nodeInspectorTabs(ordinaryNode).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })

  it('数据监控节点（template=monitor）不出参：编排 Tab 不因缺出参字段而禁用', () => {
    const monitorBound = {
      title: '数据监控', kind: 'node', template: 'monitor',
      ruleCfg: { mode: 'new', describe: '', inputTableId: '2102154', inputFields: ['sku_id'], outputFields: [] },
    } as unknown as NodeConfig
    const orchestration = nodeInspectorTabs(monitorBound).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })

  it('数据监控节点未绑输入表/入参：编排 Tab 仍禁用', () => {
    const monitorUnsaved = {
      title: '数据监控', kind: 'node', template: 'monitor',
      ruleCfg: { mode: 'new', describe: '' },
    } as unknown as NodeConfig
    const orchestration = nodeInspectorTabs(monitorUnsaved).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBe('请先在「表配置」完成输入/输出表与字段选择')
  })

  it('数据校验节点未绑输入表/入参：编排 Tab 仍禁用，但不要求出参字段', () => {
    const validation = {
      title: '数据校验', kind: 'node', template: 'data-validation',
      ruleCfg: { mode: 'new', describe: '', inputTableId: '2102154', inputFields: ['sku_id'], outputFields: [] },
    } as unknown as NodeConfig
    const orchestration = nodeInspectorTabs(validation).find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })

  // 2026-09-18：翻译助手与规则处理同一套 tab 结构（无「参数配置」），
  // 但编排配置不设表绑定门禁（翻译助手无脚本工作区，门禁没有拦截对象）。
  it('翻译助手节点：与规则处理同 tab 结构（无参数配置），编排 Tab 不因未绑表禁用', () => {
    const translate = {
      title: '翻译助手', kind: 'node', template: 'translate', sub: '[800] 翻译助手 · 文本翻译',
    } as unknown as NodeConfig
    const tabs = nodeInspectorTabs(translate)
    expect(tabs.map(([key]) => key)).toEqual(['config', 'table', 'orchestration', 'task', 'ai'])
    const orchestration = tabs.find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })

  // 2026-09-18：文章打标签与翻译助手同一待遇——与规则处理同 tab 结构，编排不设表绑定门禁。
  it('文章打标签节点：与规则处理同 tab 结构（无参数配置），编排 Tab 不因未绑表禁用', () => {
    const tag = {
      title: '文章打标签', kind: 'node', template: 'article-tag', sub: '[730] 文章打标签 · 舆情多维标注',
    } as unknown as NodeConfig
    const tabs = nodeInspectorTabs(tag)
    expect(tabs.map(([key]) => key)).toEqual(['config', 'table', 'orchestration', 'task', 'ai'])
    const orchestration = tabs.find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })

  // 2026-09-18：摘要 / 音频转文字 / 视频转音频同待遇——与规则处理同 tab 结构，编排不设门禁。
  it.each([
    ['video-audio', '[700] 视频提取音频 · 视频抽音轨'],
    ['audio-text', '[710] 音频提取文字 · 语音转写'],
    ['article-summary', '[720] 文章生成摘要 · 文本生成'],
  ])('%s 节点：与规则处理同 tab 结构（无参数配置），编排 Tab 不因未绑表禁用', (template, sub) => {
    const node = { title: template, kind: 'node', template, sub } as unknown as NodeConfig
    const tabs = nodeInspectorTabs(node)
    expect(tabs.map(([key]) => key)).toEqual(['config', 'table', 'orchestration', 'task', 'ai'])
    const orchestration = tabs.find(([key]) => key === 'orchestration')!
    expect(orchestration[2]).toBeUndefined()
  })
})
