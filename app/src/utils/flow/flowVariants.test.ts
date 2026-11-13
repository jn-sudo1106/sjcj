import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Step } from '@/api'
import {
  VARIANT_ALGORITHM_VERSION, VARIANT_CACHE_MAX, VARIANT_CACHE_TTL_MS, clearVariantCache, compareFlows, configSignature,
  flowFingerprint, flowShape, groupVariants, invalidateVariantCache, orderSteps, readVariantCache, recommendTemplate,
  shapeLabels, shapeSimilarity, templateCodes, variantCacheKey, writeVariantCache,
} from './flowVariants'

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

// ---- 1106 §4.2 配置组 / §4.3 算法版本与缓存 ----

function withConfig(prefix: string, types: string[], over: Partial<Step> = {}): Step[] {
  return chain(prefix, types).map((s) => ({ ...s, ...over }))
}

describe('configSignature / 配置组', () => {
  it('结构相同、配置等价（含同样缺失的字段）时归到同一个配置组', () => {
    const flows = [
      { id: '1', steps: chain('a') },
      { id: '2', steps: chain('b') },
    ]
    const variants = groupVariants(flows, (flow) => flowShape(flow.steps), { stepsOf: (flow) => flow.steps })
    expect(variants).toHaveLength(1)
    expect(variants[0]!.configGroups).toHaveLength(1)
    expect(variants[0]!.configGroups[0]!.flows.map((flow) => flow.id)).toEqual(['1', '2'])
    expect(variants[0]!.configGroups[0]!.differences).toEqual([])
  })

  it('结构相同但输出表不同时拆组，并给出「输出表不同」摘要', () => {
    const flows = [
      { id: '1', steps: withConfig('a', ['90', '600'], { outputTable: 'TB_A' }) },
      { id: '2', steps: withConfig('b', ['90', '600'], { outputTable: 'TB_A' }) },
      { id: '3', steps: withConfig('c', ['90', '600'], { outputTable: 'TB_B' }) },
    ]
    const [variant] = groupVariants(flows, (flow) => flowShape(flow.steps), { stepsOf: (flow) => flow.steps })
    expect(variant!.configGroups).toHaveLength(2)
    expect(variant!.configGroups.map((group) => [group.id, group.flows.length])).toEqual([['A1', 2], ['A2', 1]])
    expect(variant!.configGroups[0]!.outputTables).toEqual(['TB_A'])
    expect(variant!.configGroups[1]!.outputTables).toEqual(['TB_B'])
    expect(variant!.configGroups[1]!.differences).toContainEqual({ kind: 'outputTable', label: '输出表不同', detail: 'TB_A / TB_B' })
  })

  it('表相同但脚本类字段不同时也拆组，摘要带节点和具体字段值', () => {
    const flows = [
      { id: '1', steps: withConfig('a', ['90'], { outputTable: 'TB_A', codeRule: 'rule_a' }) },
      { id: '2', steps: withConfig('b', ['90'], { outputTable: 'TB_A', codeRule: 'rule_b' }) },
    ]
    const [variant] = groupVariants(flows, (flow) => flowShape(flow.steps), { stepsOf: (flow) => flow.steps })
    expect(variant!.configGroups).toHaveLength(2)
    const diff = variant!.configGroups[1]!.differences.find((item) => item.kind === 'script')
    expect(diff?.label).toContain('脚本字段不同')
    expect(diff?.detail).toContain('代码规则：rule_a / rule_b')
  })

  it('输入表不同也拆组（不只看输出表）', () => {
    const flows = [
      { id: '1', steps: withConfig('a', ['90'], { inputTable: 'TB_IN_A', outputTable: 'TB_OUT' }) },
      { id: '2', steps: withConfig('b', ['90'], { inputTable: 'TB_IN_B', outputTable: 'TB_OUT' }) },
    ]
    const [variant] = groupVariants(flows, (flow) => flowShape(flow.steps), { stepsOf: (flow) => flow.steps })
    expect(variant!.configGroups).toHaveLength(2)
    expect(variant!.configGroups[1]!.differences).toContainEqual({ kind: 'inputTable', label: '输入表不同', detail: 'TB_IN_A / TB_IN_B' })
  })

  it('字段不存在、null、空串是三种不同配置，不能一律合并（§4.3 规范化）', () => {
    const absent = configSignature([step('s0', '90')])
    const nulled = configSignature([step('s0', '90', [], { outputTable: null })])
    const empty = configSignature([step('s0', '90', [], { outputTable: '' })])
    expect(new Set([absent, nulled, empty]).size).toBe(3)
    // 同样缺失两次算相同
    expect(configSignature([step('s0', '90')])).toBe(configSignature([step('x0', '90', [], { name: '别的名字' })]))
  })

  it('不传 stepsOf 时不算配置组（保持旧调用方轻量）', () => {
    const flows = [{ id: '1', steps: chain('a') }, { id: '2', steps: chain('b') }]
    expect(groupVariants(flows, (flow) => flowShape(flow.steps))[0]!.configGroups).toEqual([])
  })
})

describe('算法版本 / 流程指纹 / 缓存失效', () => {
  afterEach(() => {
    vi.useRealTimers()
    clearVariantCache()
  })

  it('缓存 key 带算法版本和流程集合指纹，流程更新时间或版本变化后 key 变化', () => {
    const key = variantCacheKey('t1', [{ id: '1', updatedAt: '2026-11-06T10:00:00Z', version: 3 }])
    expect(key).toContain('t1::')
    expect(key).toContain(`v${VARIANT_ALGORITHM_VERSION}`)
    expect(variantCacheKey('t1', [{ id: '1', updatedAt: '2026-11-06T10:00:00Z', version: 3 }])).toBe(key)
    expect(variantCacheKey('t1', [{ id: '1', updatedAt: '2026-11-07T10:00:00Z', version: 3 }])).not.toBe(key)
    expect(variantCacheKey('t1', [{ id: '1', updatedAt: '2026-11-06T10:00:00Z', version: 4 }])).not.toBe(key)
    // 换一个组、或流程集合不同，key 也不同
    expect(variantCacheKey('t2', [{ id: '1', updatedAt: '2026-11-06T10:00:00Z', version: 3 }])).not.toBe(key)
    expect(variantCacheKey('t1', [{ id: '1', updatedAt: '2026-11-06T10:00:00Z', version: 3 }, { id: '2' }])).not.toBe(key)

    // 算法版本变化 → key 变化 → 旧版本缓存读不到，发布新口径后必然重算
    writeVariantCache(key, '旧口径结果')
    const bumpedKey = key.replace(`v${VARIANT_ALGORITHM_VERSION}`, `v${VARIANT_ALGORITHM_VERSION + 1}`)
    expect(readVariantCache(bumpedKey)).toBeUndefined()
    expect(readVariantCache(key)).toBe('旧口径结果')
  })

  it('后端返回 fingerprint 时优先用它；字段缺失时退回更新时间 / 版本', () => {
    // §4.3 后端依赖：同 fingerprint 时即便 updatedAt 变了也认为内容没变
    const fp = flowFingerprint([{ id: '1', fingerprint: 'abc', updatedAt: '2026-11-06T10:00:00Z' }])
    expect(fp).toBe('1:fp:abc')
    expect(flowFingerprint([{ id: '1', fingerprint: 'abc', updatedAt: '2026-11-09T00:00:00Z' }])).toBe(fp)
    expect(flowFingerprint([{ id: '1', fingerprint: 'def', updatedAt: '2026-11-06T10:00:00Z' }])).not.toBe(fp)
    // 没有后端指纹时，updateDt 优先于 updatedAt，再带版本号
    expect(flowFingerprint([{ id: '1', updateDt: 'dt', updatedAt: 'at', version: 2 }])).toBe('1:dt:2')
    expect(flowFingerprint([{ id: '1', updatedAt: 'at', version: 2 }])).toBe('1:at:2')
  })

  it('写入后能读到，TTL 过期或归类失效后读不到，且最多缓存固定条数', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'))
    writeVariantCache('t1::v2::a', { steps: 1 })
    expect(readVariantCache('t1::v2::a')).toEqual({ steps: 1 })

    // TTL 到期自动失效，不是无限缓存
    vi.advanceTimersByTime(VARIANT_CACHE_TTL_MS + 1)
    expect(readVariantCache('t1::v2::a')).toBeUndefined()

    // 归类成功后主动失效该组（其它组保留）
    writeVariantCache('t1::v2::b', 1)
    writeVariantCache('t2::v2::b', 2)
    invalidateVariantCache('t1')
    expect(readVariantCache('t1::v2::b')).toBeUndefined()
    expect(readVariantCache('t2::v2::b')).toBe(2)

    // 条数上限：最久未写入的淘汰
    for (let i = 0; i < VARIANT_CACHE_MAX + 3; i++) writeVariantCache(`t9::v2::${i}`, i)
    expect(readVariantCache('t9::v2::0')).toBeUndefined()
    expect(readVariantCache(`t9::v2::${VARIANT_CACHE_MAX + 2}`)).toBe(VARIANT_CACHE_MAX + 2)
  })
})
