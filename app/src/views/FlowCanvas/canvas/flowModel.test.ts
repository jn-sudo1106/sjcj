import { describe, expect, it } from 'vitest'
import { applyParamSourceUrlToFirstCollectNode, buildHorizontalLayout, iconFor, isRuleNode, NODE_CONFIGS, normalizeNodeConfig, type NodeConfig } from './flowModel'
import type { Source } from '@/api'

describe('流程参数配置迁移', () => {
  it('旧流程加载时从 URL token 初始化节点参数绑定', () => {
    const cfg = normalizeNodeConfig({
      ...NODE_CONFIGS['web-list'],
      collectCfg: {
        ...NODE_CONFIGS['web-list'].collectCfg!,
        url: 'https://example.com/list?price=$PARAM$_1035&type=$PARAM$_1036',
      },
    })

    expect(cfg.collectCfg?.urlParamRefs).toEqual(['1035', '1036'])
  })

  it('旧任务参数多选迁为当前节点参数的取值行，并清掉跨节点参数', () => {
    const cfg = normalizeNodeConfig({
      ...NODE_CONFIGS['web-detail'],
      collectCfg: {
        ...NODE_CONFIGS['web-detail'].collectCfg!,
        urlParamRefs: ['p-fundcode'],
      },
      taskCfg: { queue: '', urlRule: '', paramRefs: ['p-page', 'p-fundcode'] },
    })

    expect(cfg.taskCfg?.paramValues).toEqual([{ paramId: 'p-fundcode', fieldId: '', valueExpr: '' }])
    expect(cfg.taskCfg?.paramRefs).toBeUndefined()
  })
})

describe('横向节点布局', () => {
  it('隐藏终端时只布局实际节点，连线不保留开始或结束空箭头', () => {
    const layout = buildHorizontalLayout(
      ['start', 'web-list', 'web-detail', 'end'], [], NODE_CONFIGS, [], { includeTerminals: false },
    )
    expect(layout.terminals).toEqual([])
    expect(layout.nodes.map((node) => node.id)).toEqual(['web-list', 'web-detail'])
    expect(layout.mainEdges).toHaveLength(1)
  })
})

describe('画布节点图标', () => {
  it('浏览器与公众号抓取使用中文编号，不展示内部英文类型码', () => {
    expect(iconFor(NODE_CONFIGS['browser-html-collect'])).toBe('180')
    expect(iconFor(NODE_CONFIGS['wechat-html-collect'])).toBe('185')
  })
})

describe('applyParamSourceUrlToFirstCollectNode（0721 会议 T5）', () => {
  function makeCollect(url = '', urlParamRefs: string[] = []): NodeConfig {
    return {
      title: '采集节点', sub: '', status: '', planned: false, collect: true,
      base: [], fields: [], inmap: [], params: [], output: [],
      collectCfg: { snatchType: '', webKind: 'list', url, outputTable: '', inputTable: '', inputParams: [], isDetail: false, urlParamRefs },
    } as never
  }
  function makeNonCollect(): NodeConfig {
    return { title: '规则节点', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [] } as never
  }
  function makeSource(overrides: Partial<Source>): Source {
    return { sourceId: 's-1', name: '源', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C', ...overrides }
  }

  it('参数源 + 空 main：不抛错、不改 configs', () => {
    const configs: Record<string, NodeConfig> = {}
    expect(() => applyParamSourceUrlToFirstCollectNode([], configs, makeSource({ kind: 'param', urlTemplate: 'x' }))).not.toThrow()
    expect(configs).toEqual({})
  })

  it('参数源 + 多个采集节点：只改第一个的 url / urlParamRefs', () => {
    const c1 = makeCollect()
    const c2 = makeCollect()
    const configs = { c1, c2 }
    const source = makeSource({
      kind: 'param', urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
      paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
    })
    applyParamSourceUrlToFirstCollectNode(['c1', 'c2'], configs, source)
    expect(c1.collectCfg?.url).toBe('http://base-$PARAM$_913-$PARAM$_912')
    expect(c1.collectCfg?.urlParamRefs).toEqual(['913', '912'])
    expect(c2.collectCfg?.url).toBe('')              // 第二个不动
    expect(c2.collectCfg?.urlParamRefs).toEqual([])  // 第二个不动
  })

  it('main 首个是非采集节点：跳过它，定位到第一个采集节点', () => {
    const rule = makeNonCollect()
    const c1 = makeCollect()
    const configs = { 'rule-1': rule, c1 }
    applyParamSourceUrlToFirstCollectNode(['rule-1', 'c1'], configs, makeSource({
      kind: 'param', urlTemplate: 'http://x', paramRefs: [{ paramId: 'p1', group: null }],
    }))
    expect(rule.collectCfg).toBeUndefined()           // 规则节点不被改
    expect(c1.collectCfg?.url).toBe('http://x')
  })

  it('普通源（kind 为空或 normal）：不动任何 url', () => {
    const c1 = makeCollect('https://original.com')
    const configs = { c1 }
    applyParamSourceUrlToFirstCollectNode(['c1'], configs, makeSource({ url: 'https://original.com' }))
    expect(c1.collectCfg?.url).toBe('https://original.com')
  })

  it('urlTemplate 为空：跳过，不动 url（不清空）', () => {
    const c1 = makeCollect('https://original.com')
    const configs = { c1 }
    applyParamSourceUrlToFirstCollectNode(['c1'], configs, makeSource({ kind: 'param' }))
    expect(c1.collectCfg?.url).toBe('https://original.com')
  })

  it('paramRefs 为空：urlParamRefs 清空为 []', () => {
    const c1 = makeCollect('', ['913', '912'])
    const configs = { c1 }
    applyParamSourceUrlToFirstCollectNode(['c1'], configs, makeSource({
      kind: 'param', urlTemplate: 'http://x', paramRefs: [],
    }))
    expect(c1.collectCfg?.urlParamRefs).toEqual([])
  })
})

// 0801 方案 §6.1：共享给 nodeInspectorTabs（Tab 分流）与 ConfigTab（渲染分支）的规则节点判定
describe('isRuleNode', () => {
  it('标题含「规则」判定为规则节点', () => {
    expect(isRuleNode({ title: '规则处理' } as NodeConfig)).toBe(true)
  })
  it('标题不含「规则」判定为非规则节点', () => {
    expect(isRuleNode({ title: '网页抓取' } as NodeConfig)).toBe(false)
  })
  it('cfg 为 undefined 时判定为非规则节点', () => {
    expect(isRuleNode(undefined)).toBe(false)
  })
})
