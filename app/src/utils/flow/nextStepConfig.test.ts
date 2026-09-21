import { describe, expect, it, vi } from 'vitest'
import { resolveNextStepConfigFromSteps, fetchNextStepConfig, collectDownstreamSteps } from './nextStepConfig'
import { sourceApi, type Step } from '@/api'

describe('nextStepConfig · 根据当前节点与 nextConfigPaged 解析下一个节点配置', () => {
  const sampleSteps: Step[] = [
    {
      stepId: '0',
      sourceId: '430006252',
      name: '起点列表',
      isRoot: true,
      outputTable: '900',
      enabled: true,
    },
    {
      stepId: '40597',
      sourceId: '430006252',
      name: '详情解析1',
      configId: '1400974',
      inputTable: '900',
      outputTable: '901',
      dependsOn: ['0'],
      enabled: true,
    },
    {
      stepId: '40598',
      sourceId: '430006252',
      name: '规则提取2',
      configId: '1400975',
      inputTable: '901',
      outputTable: '902',
      dependsOn: ['40597'],
      enabled: true,
    },
    {
      stepId: '40600',
      sourceId: '430006252',
      name: '停用节点',
      configId: '1400980',
      inputTable: '902',
      dependsOn: ['40598'],
      enabled: false,
    },
  ]

  it('当前节点为起点时：正确解析到下一个节点（40597 详情解析1，输入表 900）', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '0')
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40597')
    expect(res.targetNodeName).toBe('详情解析1')
    expect(res.targetTableId).toBe('900')
    expect(res.targetConfigId).toBe('1400974')
  })

  it('当前节点为中间节点 40597 时：发后续任务必须定位到它的下一个节点 40598（输入表 901，非当前表 900）', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '40597')
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40598')
    expect(res.targetNodeName).toBe('规则提取2')
    expect(res.targetTableId).toBe('901')
    expect(res.targetConfigId).toBe('1400975')
  })

  it('当前节点为 40598 时：后续节点已停用，返回无法发送原因', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '40598')
    expect(res.hasNext).toBe(false)
    expect(res.allDisabled).toBe(true)
    expect(res.disabledTitles).toContain('停用节点')
  })

  it('末端节点无后继时：返回 hasNext=false', () => {
    const res = resolveNextStepConfigFromSteps(sampleSteps, '40600')
    expect(res.hasNext).toBe(false)
    expect(res.reason).toContain('没有后续节点配置')
  })

  it('多分支后继：返回所有后继步骤并拼出分支说明', () => {
    const branchSteps: Step[] = [
      { stepId: '10', sourceId: '1', name: '父步骤', outputTable: '900', enabled: true },
      { stepId: '11', sourceId: '1', name: '分支A', inputTable: '900', dependsOn: ['10'], condition: 'K1==1', enabled: true },
      { stepId: '12', sourceId: '1', name: '分支B', inputTable: '900', dependsOn: ['10'], condition: 'K1==2', enabled: true },
    ]
    const res = resolveNextStepConfigFromSteps(branchSteps, '10')
    expect(res.hasNext).toBe(true)
    expect(res.nextSteps).toHaveLength(2)
    expect(res.targetNodeName).toBe('分支A、分支B')
    expect(res.branchHint).toContain('K1==1')
    expect(res.branchHint).toContain('K1==2')
  })

  it('fetchNextStepConfig 真实请求 sourceSteps (nextConfigPaged)', async () => {
    const spy = vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue(sampleSteps)
    const res = await fetchNextStepConfig('430006252', '40597')
    expect(spy).toHaveBeenCalledWith('430006252', { withConfigDetails: false })
    expect(res.targetStepId).toBe('40598')
    expect(res.targetTableId).toBe('901')
  })

  it('真实生产场景：选择html网页下载节点（dev_web_snatch_html_download）发后续，定位到html解析（news_cont）', () => {
    const prodSteps: Step[] = [
      {
        stepId: '0',
        sourceId: '430016821',
        name: '上市公司-配置',
        configId: '1400935',
        topic: 'news_snt',
        isRoot: true,
        outputTable: '900',
        enabled: true,
      },
      {
        stepId: '40597',
        sourceId: '430016821',
        name: '1400935-详情',
        configId: '1400974',
        topic: 'dev_web_snatch_html_download',
        inputTable: '900',
        outputTable: '900',
        dependsOn: ['0'],
        enabled: true,
      },
      {
        stepId: '40598',
        sourceId: '430016821',
        name: '1400935-详情',
        configId: '1400975',
        topic: 'news_cont',
        inputTable: '900',
        outputTable: '900',
        dependsOn: ['40597'],
        enabled: true,
      },
    ]

    const res = resolveNextStepConfigFromSteps(prodSteps, '40597')
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40598')
    expect(res.targetConfigId).toBe('1400975')
    expect(res.nextStep?.topic).toBe('news_cont')
    expect(res.nextStep?.topic).not.toBe('dev_web_snatch_html_download')
  })

  it('节点 ID 即使是非数字别名，只要携带 currentConfig 也能精准定位到后继 news_cont', () => {
    const prodSteps: Step[] = [
      { stepId: '0', sourceId: '1', name: '列表', configId: '100', topic: 'news_snt', isRoot: true, outputTable: '900', enabled: true },
      { stepId: '40597', sourceId: '1', name: '下载', configId: '1400974', topic: 'dev_web_snatch_html_download', inputTable: '900', outputTable: '900', dependsOn: ['0'], enabled: true },
      { stepId: '40598', sourceId: '1', name: '解析', configId: '1400975', topic: 'news_cont', inputTable: '900', outputTable: '900', dependsOn: ['40597'], enabled: true },
    ]

    const res = resolveNextStepConfigFromSteps(prodSteps, 'web-download-node', {
      configId: '1400974',
      queue: 'dev_web_snatch_html_download',
    })
    expect(res.hasNext).toBe(true)
    expect(res.targetStepId).toBe('40598')
    expect(res.targetConfigId).toBe('1400975')
    expect(res.nextStep?.topic).toBe('news_cont')
  })
})

// 2026-09-17 定的口径：发后续 = 发**当前节点之后的整条下游**，不是只发直接后继。
// 依据是同日生产实测：source/nextStep 传单个 stepId 时后端只发那一个、不会沿链路带下游
// （发 40598 后 41685 数据监控纹丝不动）；传逗号串则按步骤分别派发，回执自己分组
// （`本次发送:1 条, 结果:,ok_40598: [1条],ok_41685: [1条]`）。
describe('collectDownstreamSteps · 收集整条下游', () => {
  // 与生产源 430006252 同构：起点 → 40597 下载 → 40598 解析 → 41685 数据监控
  const chain: Step[] = [
    { stepId: '0', sourceId: '1', name: '起点', isRoot: true, outputTable: '900', enabled: true },
    { stepId: '40597', sourceId: '1', name: 'html网页下载', configId: '1400974', inputTable: '900', outputTable: '900', dependsOn: ['0'], enabled: true },
    { stepId: '40598', sourceId: '1', name: 'html解析', configId: '1400975', inputTable: '900', outputTable: '900', dependsOn: ['40597'], enabled: true },
    { stepId: '41685', sourceId: '1', name: '数据监控', configId: '1401006', inputTable: '900', outputTable: '900', dependsOn: ['40598'], enabled: true },
  ]

  it('站在起点发全部三个；站在中间只发它之后的，不含自己', () => {
    expect(resolveNextStepConfigFromSteps(chain, '0').downstreamSteps.map((s) => s.stepId))
      .toEqual(['40597', '40598', '41685'])
    // 不含 40597 自己——把当前节点再跑一遍正是 9/12 那个 bug 的表现
    expect(resolveNextStepConfigFromSteps(chain, '40597').downstreamSteps.map((s) => s.stepId))
      .toEqual(['40598', '41685'])
    expect(resolveNextStepConfigFromSteps(chain, '40598').downstreamSteps.map((s) => s.stepId))
      .toEqual(['41685'])
  })

  it('末节点没有下游，照旧给不可发的原因', () => {
    const res = resolveNextStepConfigFromSteps(chain, '41685')
    expect(res.hasNext).toBe(false)
    expect(res.downstreamSteps).toEqual([])
  })

  it('直接后继被停用时整条发不出去，照旧给「已停用」的原因', () => {
    const withDisabled = chain.map((s) => (s.stepId === '40598' ? { ...s, enabled: false } : s))
    const res = resolveNextStepConfigFromSteps(withDisabled, '40597')
    expect(res.hasNext).toBe(false)
    expect(res.allDisabled).toBe(true)
    expect(res.downstreamSteps).toEqual([])
  })

  it('链路中间停用会截断该分支：它不跑就没有输出，它下游发过去只是空转', () => {
    // 40598 启用、41685 停用、41685 后面还挂一个 X
    const withTail: Step[] = [
      ...chain.map((s) => (s.stepId === '41685' ? { ...s, enabled: false } : s)),
      { stepId: 'x', sourceId: '1', name: '监控之后', dependsOn: ['41685'], enabled: true },
    ]
    const ids = resolveNextStepConfigFromSteps(withTail, '40597').downstreamSteps.map((s) => s.stepId)
    expect(ids).toEqual(['40598'])
    expect(ids).not.toContain('41685')
    expect(ids).not.toContain('x')
  })

  // 0917-06（2026-09-21）：「本次不发」与「停用」**故意相反**——
  // 停用截断该分支（它不跑没输出，下游空转），本次不发只剔自己、下游照发。
  // 用户明确选了"C 还发"，并知道 B 不跑时 C 这次多半空跑。
  it('标了「本次不发」的节点只剔自己，它的下游照发（过滤，不截断）', () => {
    const ids = collectDownstreamSteps(chain, ['40597'], ['40598']).map((s) => s.stepId)
    expect(ids).toEqual(['40597', '41685'])
    expect(ids).not.toContain('40598')
  })

  it('跳过多个、以及跳过链尾', () => {
    expect(collectDownstreamSteps(chain, ['0'], ['40597', '41685']).map((s) => s.stepId))
      .toEqual(['0', '40598'])
    expect(collectDownstreamSteps(chain, ['0'], ['41685']).map((s) => s.stepId))
      .toEqual(['0', '40597', '40598'])
  })

  it('跳过集合为空 / 未传时行为不变', () => {
    const full = ['0', '40597', '40598', '41685']
    expect(collectDownstreamSteps(chain, ['0']).map((s) => s.stepId)).toEqual(full)
    expect(collectDownstreamSteps(chain, ['0'], []).map((s) => s.stepId)).toEqual(full)
  })

  // 停用与本次不发同时在场：停用仍然截断，本次不发仍然只剔自己
  it('停用与「本次不发」同时存在时各按各的语义', () => {
    const withDisabled = chain.map((s) => (s.stepId === '41685' ? { ...s, enabled: false } : s))
    expect(collectDownstreamSteps(withDisabled, ['0'], ['40597']).map((s) => s.stepId))
      .toEqual(['0', '40598'])
  })

  it('多分支时两条支路的下游都收进来', () => {
    const forked: Step[] = [
      ...chain.slice(0, 2),
      { stepId: 'b1', sourceId: '1', name: '分支一', dependsOn: ['40597'], enabled: true },
      { stepId: 'b1x', sourceId: '1', name: '分支一的下游', dependsOn: ['b1'], enabled: true },
      { stepId: 'b2', sourceId: '1', name: '分支二', dependsOn: ['40597'], enabled: true },
    ]
    const ids = resolveNextStepConfigFromSteps(forked, '40597').downstreamSteps.map((s) => s.stepId)
    expect(ids).toEqual(expect.arrayContaining(['b1', 'b2', 'b1x']))
  })

  it('父子关系成环时不死循环', () => {
    const cyclic: Step[] = [
      { stepId: 'a', sourceId: '1', name: 'A', dependsOn: ['0'], enabled: true },
      { stepId: 'b', sourceId: '1', name: 'B', dependsOn: ['a'], enabled: true },
      { stepId: 'a2', sourceId: '1', name: '回指 A', dependsOn: ['b'], enabled: true },
    ]
    // b 的下游 a2 又指回 b 所在的链路，seen 兜住不重复入队
    const cyclic2 = cyclic.map((s) => (s.stepId === 'a2' ? { ...s, dependsOn: ['b'], stepId: 'a' } : s))
    const ids = resolveNextStepConfigFromSteps(cyclic2, '0').downstreamSteps.map((s) => s.stepId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
