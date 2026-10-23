import { describe, expect, it } from 'vitest'
import {
  applyParamSourceUrlToFirstCollectNode, buildHorizontalLayout, directPredecessorIds, firstRunnableNodeId, hasDirectSuccessor, iconFor, isFirstRunnableNode, isPdfMdNode, isRuleLikeNode, isRuleNode, isScriptlessNode,
  makeDefaultExecConfig, NODE_CONFIGS, normalizeNodeConfig, type FlowBranchGroup, type NodeConfig,
} from './flowModel'
import type { Source } from '@/api'

function cfg(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return { title: '', sub: '', status: '', planned: false, base: [], fields: [], inmap: [], params: [], output: [], ...overrides }
}

describe('isFirstRunnableNode（0812 计划 M2-10）', () => {
  it('主链第一个真实节点是首节点', () => {
    const main = ['start', 'n1', 'n2', 'end']
    const configs = { n1: cfg({ title: '抓取列表页' }), n2: cfg({ title: '解析详情页' }) }
    expect(isFirstRunnableNode(main, configs, 'n1')).toBe(true)
    expect(isFirstRunnableNode(main, configs, 'n2')).toBe(false)
  })

  it('跳过停用节点，让下一个真实节点顶上首节点位置', () => {
    const main = ['start', 'n1', 'n2', 'end']
    const configs = { n1: cfg({ disabled: true }), n2: cfg() }
    expect(isFirstRunnableNode(main, configs, 'n1')).toBe(false)
    expect(isFirstRunnableNode(main, configs, 'n2')).toBe(true)
  })

  it('跳过规划中节点', () => {
    const main = ['start', 'n1', 'n2', 'end']
    const configs = { n1: cfg({ planned: true }), n2: cfg() }
    expect(isFirstRunnableNode(main, configs, 'n2')).toBe(true)
  })

  it('主链没有真实节点时，任何 id 都不是首节点', () => {
    expect(isFirstRunnableNode(['start', 'end'], {}, 'start')).toBe(false)
    expect(firstRunnableNodeId(['start', 'end'], {})).toBe('')
  })

  it('firstRunnableNodeId 跳过停用节点', () => {
    const main = ['start', 'n1', 'n2', 'end']
    const configs = { n1: cfg({ disabled: true }), n2: cfg({ title: '详情' }) }
    expect(firstRunnableNodeId(main, configs)).toBe('n2')
  })
})

describe('hasDirectSuccessor（0824：末节点无发后续）', () => {
  it('线性 start-n1-n2-end：n1 有后继，n2 没有', () => {
    const main = ['start', 'n1', 'n2', 'end']
    const configs = { n1: cfg({ title: '抓取列表页' }), n2: cfg({ title: '解析详情页' }) }
    expect(hasDirectSuccessor(main, configs, 'n1')).toBe(true)
    expect(hasDirectSuccessor(main, configs, 'n2')).toBe(false)
  })

  it('跳过中间的停用 / 规划中节点，看到更后面的真实节点', () => {
    const main = ['start', 'n1', 'skip', 'n2', 'end']
    const disabled = { n1: cfg(), skip: cfg({ disabled: true }), n2: cfg() }
    expect(hasDirectSuccessor(main, disabled, 'n1')).toBe(true)
    expect(hasDirectSuccessor(main, disabled, 'n2')).toBe(false)
    const planned = { n1: cfg(), skip: cfg({ planned: true }), n2: cfg() }
    expect(hasDirectSuccessor(main, planned, 'n1')).toBe(true)
  })

  it('主链只有一个真实节点时没有后继', () => {
    const main = ['start', 'n1', 'end']
    expect(hasDirectSuccessor(main, { n1: cfg() }, 'n1')).toBe(false)
  })

  it('分叉点挂了可跑的分支 chain：上游和 owner 都有后继；分支叶子无汇合则没有', () => {
    const main = ['start', 'n1', 'dec', 'end']
    const configs = { n1: cfg(), dec: cfg(), b1: cfg({ title: '分支处理' }) }
    const groups: FlowBranchGroup[] = [{ ownerId: 'dec', branches: [{ id: 'br1', label: 'IF', chain: ['b1'] }] }]
    expect(hasDirectSuccessor(main, configs, 'n1', groups)).toBe(true)
    expect(hasDirectSuccessor(main, configs, 'dec', groups)).toBe(true)
    expect(hasDirectSuccessor(main, configs, 'b1', groups)).toBe(false)
  })

  it('分支 chain 内后一个节点、以及汇合点（owner 后的主链节点）都算后继', () => {
    const main = ['start', 'dec', 'join', 'end']
    const configs = { dec: cfg(), a: cfg(), b: cfg(), join: cfg() }
    const groups: FlowBranchGroup[] = [{ ownerId: 'dec', branches: [{ id: 'br1', label: 'IF', chain: ['a', 'b'] }] }]
    expect(hasDirectSuccessor(main, configs, 'a', groups)).toBe(true)
    expect(hasDirectSuccessor(main, configs, 'b', groups)).toBe(true)
    expect(hasDirectSuccessor(main, configs, 'join', groups)).toBe(false)
  })
})

describe('directPredecessorIds（0831 X7-B）', () => {
  it('是 directSuccessorIds 的反函数：n2 的前驱是 n1', () => {
    const main = ['start', 'n1', 'n2', 'end']
    const configs = { n1: cfg(), n2: cfg() }
    expect(directPredecessorIds(main, configs, 'n2')).toEqual(['n1'])
    expect(directPredecessorIds(main, configs, 'n1')).toEqual([])
  })
})

// 2026-09-23：OCR 抓取曾是 planned: true，isRunnableFlowNode 会整个跳过它——上游算不出后继，
// 数据视图 execMode 停在 'fetch'，勾选列连同「发后续任务」一起消失（用户在源 430000933 实测）。
describe('OCR 抓取节点参与前后继解析', () => {
  it('OCR 种子不再是规划中节点', () => {
    expect(NODE_CONFIGS.ocr.planned).toBe(false)
    expect(NODE_CONFIGS.ocr.status).not.toContain('规划中')
  })

  it('采集节点 → OCR：两侧都能看到对方', () => {
    const main = ['start', 'collect', 'ocr1', 'end']
    const configs = { collect: cfg({ title: '图片采集' }), ocr1: { ...NODE_CONFIGS.ocr } }
    expect(hasDirectSuccessor(main, configs, 'collect')).toBe(true)
    expect(directPredecessorIds(main, configs, 'ocr1')).toEqual(['collect'])
    expect(hasDirectSuccessor(main, configs, 'ocr1')).toBe(false)
  })

  it('历史存档里残留的 planned / 规划中状态在加载时清掉', () => {
    const legacy = normalizeNodeConfig({
      ...NODE_CONFIGS.ocr, planned: true, status: '规划中（待执行器）',
    })
    expect(legacy.planned).toBe(false)
    expect(legacy.status).toBe('待配置')
    const main = ['start', 'collect', 'ocr1', 'end']
    const configs = { collect: cfg({ title: '图片采集' }), ocr1: legacy }
    expect(hasDirectSuccessor(main, configs, 'collect')).toBe(true)
  })

  it('其它规划中节点不受影响（AI 提取 / 发邮件仍按规划中跳过）', () => {
    expect(NODE_CONFIGS['ai-extract'].planned).toBe(true)
    expect(NODE_CONFIGS.mail.planned).toBe(true)
  })
})


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

  it('旧登录字段加载时迁移为一条完整的默认登录配置', () => {
    const cfg = normalizeNodeConfig({
      ...NODE_CONFIGS['login-collect'],
      collectCfg: {
        ...NODE_CONFIGS['login-collect'].collectCfg!,
        account: 'research_***',
      },
    })

    expect(cfg.collectCfg?.loginConfigs).toEqual([{
      id: 'legacy-default', loginUrl: 'https://example.com/login', loginName: 'research_***', loginPwd: '', newLoginConfig: '1', authConfig: '', enabled: true,
    }])
    expect(cfg.collectCfg?.defaultLoginConfigId).toBe('legacy-default')
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
// 0805 修正（真机验证发现）：判定口径从标题正则改成"带不带 ruleCfg"这个结构信号——
// 0804 拍板"规则名称 = 节点名称"后标题变成自由文本，用户随手一改就可能不含"规则"两字，
// 旧的 /规则/.test(title) 会把它误判成非规则节点，UI 整个错位（RuleTableFieldBinder 消失等）。
describe('isRuleNode', () => {
  it('带 ruleCfg 判定为规则节点，跟标题内容无关', () => {
    expect(isRuleNode({ title: '规则处理', ruleCfg: { mode: 'new', describe: '' } } as NodeConfig)).toBe(true)
  })
  it('标题改成不含"规则"两字，只要还带着 ruleCfg 仍判定为规则节点', () => {
    expect(isRuleNode({ title: 'CLAUDE测试_S3验证_勿用', ruleCfg: { mode: 'new', describe: '' } } as NodeConfig)).toBe(true)
  })
  it('标题含"规则"但没有 ruleCfg：判定为非规则节点', () => {
    expect(isRuleNode({ title: '规则处理' } as NodeConfig)).toBe(false)
  })
  it('没有 ruleCfg 的普通节点判定为非规则节点', () => {
    expect(isRuleNode({ title: '网页抓取' } as NodeConfig)).toBe(false)
  })
  it('cfg 为 undefined 时判定为非规则节点', () => {
    expect(isRuleNode(undefined)).toBe(false)
  })
})

// 0804 S3-3：execCfg 与 ruleCfg 同构复用 RuleOrchestration，只是默认 format 恒为 'xml'
describe('makeDefaultExecConfig（0804 S3-3）', () => {
  it('format 恒为 xml，describe 留空（不像 ruleCfg 带演示文案，避免误导抓取需求描述）', () => {
    const cfg = makeDefaultExecConfig()
    expect(cfg.format).toBe('xml')
    expect(cfg.describe).toBe('')
    expect(cfg.systemPrompt).toBeTruthy()
  })
})

describe('PDF转MD（911）通用处理节点', () => {
  it('种子：处理型无脚本节点，队列 source-config，输出 markdown', () => {
    const seed = NODE_CONFIGS['pdf-md']
    expect(seed.title).toBe('PDF转MD')
    expect(seed.sub).toContain('[911]')
    expect(seed.collectCfg).toBeUndefined()
    expect(seed.taskCfg?.queue).toBe('source-config')
    expect(seed.output.map((field) => field.name)).toEqual(['markdown'])
    expect(isPdfMdNode(seed)).toBe(true)
    expect(isRuleLikeNode(seed)).toBe(true)
    expect(isScriptlessNode(seed)).toBe(true)
  })

  it('按类型号 911 也能识别（回读时只有 sub / configType）', () => {
    expect(isPdfMdNode(cfg({ sub: '[911] PDF转MD · 文档转 Markdown' }))).toBe(true)
    expect(isScriptlessNode(cfg({ sub: '[911] PDF转MD' }))).toBe(true)
    expect(isPdfMdNode(cfg({ sub: '[130] PDF抓取' }))).toBe(false)
  })
})
