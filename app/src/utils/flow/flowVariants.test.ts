import { describe, expect, it } from 'vitest'
import type { Step } from '@/api'
import { compareFlows, flowShape, groupVariants, orderSteps, recommendTemplate, shapeLabels, shapeSimilarity, templateCodes } from './flowVariants'

function step(stepId: string, configType: string, dependsOn: string[] = [], over: Partial<Step> = {}): Step {
  return { stepId, sourceId: '-1', name: `节点${stepId}`, configType, dependsOn, ...over } as Step
}
/** 列表 → 详情 → 规则 的标准链 */
function chain(prefix: string, types = ['90', '90', '600']): Step[] {
  return types.map((type, i) => step(`${prefix}${i}`, type, i ? [`${prefix}${i - 1}`] : []))
}

describe('flowShape / orderSteps', () => {
  it('按上下游拓扑排序，接口返回顺序打乱也一样', () => {
    const steps = chain('s')
    expect(orderSteps([steps[2]!, steps[0]!, steps[1]!]).map((s) => s.stepId)).toEqual(['s0', 's1', 's2'])
  })

  it('结构相同的流程指纹相同，步骤 ID 不影响', () => {
    expect(flowShape(chain('a')).key).toBe(flowShape(chain('b')).key)
  })

  it('同样的节点类型、上下游不同（分支）指纹不同，并标出接在第几个后面', () => {
    const branched = [step('b0', '90'), step('b1', '90', ['b0']), step('b2', '600', ['b0'])]
    expect(flowShape(branched).key).not.toBe(flowShape(chain('a')).key)
    expect(shapeLabels(flowShape(branched))).toEqual(['网页抓取', '网页抓取', '规则处理（接第 1 个）'])
  })

  it('名字带「数据监控」的规则节点按数据监控认', () => {
    expect(flowShape([step('m', '600', [], { name: '数据监控' })]).codes).toEqual(['610'])
  })

  it('有环时不丢节点', () => {
    expect(orderSteps([step('x', '90', ['y']), step('y', '90', ['x'])])).toHaveLength(2)
  })
})

describe('groupVariants', () => {
  it('按结构分组，流程多的变体排前面并编号 A、B', () => {
    const flows = [
      { id: '1', steps: chain('a') },
      { id: '2', steps: chain('b', ['90', '90', '600', '720']) },
      { id: '3', steps: chain('c') },
    ]
    const variants = groupVariants(flows, (flow) => flowShape(flow.steps))
    expect(variants.map((v) => [v.letter, v.items.map((f) => f.id)])).toEqual([['A', ['1', '3']], ['B', ['2']]])
  })
})

describe('相似度与模板推荐', () => {
  it('完全一致是 1，多一个节点按公共节点比例算', () => {
    expect(shapeSimilarity(['90', '90'], ['90', '90'])).toBe(1)
    expect(shapeSimilarity(['90', '90', '600'], ['90', '90'])).toBeCloseTo(0.8)
  })

  it('推荐最相似的模板；801 按网页抓取比', () => {
    const templates = [
      { id: 't1', name: '列表详情', codes: ['90', '90'] },
      { id: 't2', name: '下载 OCR', codes: ['95', '150'] },
    ]
    expect(recommendTemplate(['801', '90'], templates)).toEqual({ id: 't1', name: '列表详情', score: 1 })
  })

  it('都不够像时不推荐', () => {
    expect(recommendTemplate(['720', '730', '800'], [{ id: 't1', name: '列表详情', codes: ['90', '90'] }])).toBeUndefined()
  })

  it('模板类型序列去掉开始 / 结束端点', () => {
    expect(templateCodes({ main: ['start', 'n1', 'n2', 'end'], branches: [], configs: { n1: { configType: '90' }, n2: { configType: '150' } } } as never)).toEqual(['90', '150'])
  })
})

describe('compareFlows', () => {
  it('对齐步骤后只列有差异的字段，多出 / 缺少的步骤单独标出', () => {
    const a = chain('a')
    a[1] = { ...a[1]!, outputTable: 'TB_DETAIL', topic: 'detail_q' }
    const b = chain('b', ['90', '90', '600', '720'])
    b[1] = { ...b[1]!, outputTable: 'TB_DETAIL_V2', topic: 'detail_q' }

    const rows = compareFlows(a, b)
    expect(rows.map((r) => r.op)).toEqual(['same', 'same', 'same', 'added'])
    expect(rows[1]!.diffs).toContainEqual({ label: '输出表', a: 'TB_DETAIL', b: 'TB_DETAIL_V2' })
    expect(rows[1]!.diffs.find((d) => d.label === '队列')).toBeUndefined()
    expect(rows[3]!.typeLabel).toBe('文章生成摘要')
  })
})
