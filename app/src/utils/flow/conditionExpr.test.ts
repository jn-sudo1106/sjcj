import { describe, expect, it } from 'vitest'
import { conditionsToExpr, parseConditionExpr } from './conditionExpr'

// 下面这批 expr 全部是 2026-08-26 从生产扫出来的真实 Step.cond（扫了 200 个源 / 300 条带条件的步骤，
// 去重后就这几种），不是构造的样例。
describe('parseConditionExpr · 真实生产表达式', () => {
  it('K17==nil（无空格）→ 为空', () => {
    expect(parseConditionExpr('K17==nil')).toEqual({ logic: 'AND', items: [{ field: 'K17', op: 'isEmpty', value: '' }] })
  })

  it('K5 == nil（带空格）→ 同样解析，空格写法不影响', () => {
    expect(parseConditionExpr('K5 == nil')).toEqual({ logic: 'AND', items: [{ field: 'K5', op: 'isEmpty', value: '' }] })
  })

  it('NEXT_FLAG == nil → 非 K 列的运行时标记也能解析，标识符原样保留', () => {
    expect(parseConditionExpr('NEXT_FLAG == nil')).toEqual({
      logic: 'AND', items: [{ field: 'NEXT_FLAG', op: 'isEmpty', value: '' }],
    })
  })

  it('K19 == nil && K5==nil → AND，两项空格写法不一致也能解析', () => {
    expect(parseConditionExpr('K19 == nil && K5==nil')).toEqual({
      logic: 'AND',
      items: [{ field: 'K19', op: 'isEmpty', value: '' }, { field: 'K5', op: 'isEmpty', value: '' }],
    })
  })

  it('K12==nil || K15 ==nil → OR', () => {
    expect(parseConditionExpr('K12==nil || K15 ==nil')).toEqual({
      logic: 'OR',
      items: [{ field: 'K12', op: 'isEmpty', value: '' }, { field: 'K15', op: 'isEmpty', value: '' }],
    })
  })

  it('K2 !=nil && K18==nil → != 解析为非空', () => {
    expect(parseConditionExpr('K2 !=nil && K18==nil')).toEqual({
      logic: 'AND',
      items: [{ field: 'K2', op: 'notEmpty', value: '' }, { field: 'K18', op: 'isEmpty', value: '' }],
    })
  })

  it("K17 != nil && !string.contains(K2,'weixin.qq') → 非空 + 不包含（函数调用取反）", () => {
    expect(parseConditionExpr("K17 != nil && !string.contains(K2,'weixin.qq')")).toEqual({
      logic: 'AND',
      items: [
        { field: 'K17', op: 'notEmpty', value: '' },
        { field: 'K2', op: 'notContains', value: 'weixin.qq' },
      ],
    })
  })

  it('NEXT_FLAG == 40597 → 裸数字比较也能解析（运行时标记 / 任务规格 ID）', () => {
    expect(parseConditionExpr('NEXT_FLAG == 40597')).toEqual({
      logic: 'AND', items: [{ field: 'NEXT_FLAG', op: 'eq', value: '40597' }],
    })
  })

  it("_from == 'api' && K17 != nil && string.contains(K17,'qinlong') && !string.contains(K2,'pdf') && NEXT_FLAG == 40597 → 混字符串/函数/裸数字五项全解析（生产真实 cond）", () => {
    expect(parseConditionExpr("_from == 'api' && K17 != nil && string.contains(K17,'qinlong') && !string.contains(K2,'pdf') && NEXT_FLAG == 40597")).toEqual({
      logic: 'AND',
      items: [
        { field: '_from', op: 'eq', value: 'api' },
        { field: 'K17', op: 'notEmpty', value: '' },
        { field: 'K17', op: 'contains', value: 'qinlong' },
        { field: 'K2', op: 'notContains', value: 'pdf' },
        { field: 'NEXT_FLAG', op: 'eq', value: '40597' },
      ],
    })
  })
})

describe('parseConditionExpr · 解析不了的一律返回 null（宁可只读也不要解析错）', () => {
  it('&& 和 || 混用：当前数据模型只有一个 logic，表达不了混合优先级', () => {
    expect(parseConditionExpr("K1==nil && K2==nil || K3==nil")).toBeNull()
  })

  it('不认识的函数调用', () => {
    expect(parseConditionExpr("string.startswith(K2,'http')")).toBeNull()
  })

  it('引号不闭合', () => {
    expect(parseConditionExpr("string.contains(K2,'abc)")).toBeNull()
  })

  it('空字符串 / undefined', () => {
    expect(parseConditionExpr('')).toBeNull()
    expect(parseConditionExpr(undefined)).toBeNull()
  })

  it('旧前端曾生成的 SQL 风格语法不认——真实执行侧也不认，不能当成有效条件解析', () => {
    expect(parseConditionExpr('title CONTAINS "证券"')).toBeNull()
    expect(parseConditionExpr('K6 IS NOT EMPTY')).toBeNull()
  })
})

describe('conditionsToExpr · 生成真实语法', () => {
  it('为空 / 非空不带值', () => {
    expect(conditionsToExpr([{ field: 'K17', op: 'isEmpty', value: '' }], 'AND')).toBe('K17 == nil')
    expect(conditionsToExpr([{ field: 'K17', op: 'notEmpty', value: '' }], 'AND')).toBe('K17 != nil')
  })

  it('包含 / 不包含生成 string.contains，值用单引号', () => {
    expect(conditionsToExpr([{ field: 'K2', op: 'contains', value: 'weixin.qq' }], 'AND'))
      .toBe("string.contains(K2,'weixin.qq')")
    expect(conditionsToExpr([{ field: 'K2', op: 'notContains', value: 'weixin.qq' }], 'AND'))
      .toBe("!string.contains(K2,'weixin.qq')")
  })

  it('多项用 && / || 连接', () => {
    const items = [{ field: 'K19', op: 'isEmpty' as const, value: '' }, { field: 'K5', op: 'isEmpty' as const, value: '' }]
    expect(conditionsToExpr(items, 'AND')).toBe('K19 == nil && K5 == nil')
    expect(conditionsToExpr(items, 'OR')).toBe('K19 == nil || K5 == nil')
  })

  it('没选字段的空行跳过，不生成半截表达式', () => {
    expect(conditionsToExpr([{ field: '', op: 'contains', value: 'x' }, { field: 'K2', op: 'isEmpty', value: '' }], 'AND'))
      .toBe('K2 == nil')
  })

  it('值里的单引号转义，不会截断表达式', () => {
    expect(conditionsToExpr([{ field: 'K2', op: 'eq', value: "it's" }], 'AND')).toBe("K2 == 'it\\'s'")
  })

  it('纯数字值不加引号（NEXT_FLAG == 40597，加引号执行侧就不生效）；非数字仍加引号', () => {
    expect(conditionsToExpr([{ field: 'NEXT_FLAG', op: 'eq', value: '40597' }], 'AND')).toBe('NEXT_FLAG == 40597')
    expect(conditionsToExpr([{ field: 'K5', op: 'gt', value: '100' }], 'AND')).toBe('K5 > 100')
    expect(conditionsToExpr([{ field: '_from', op: 'eq', value: 'api' }], 'AND')).toBe("_from == 'api'")
  })
})

describe('round-trip：解析→生成 语义不变', () => {
  const samples = [
    'K17==nil',
    'K5 == nil',
    'NEXT_FLAG == nil',
    'K19 == nil && K5==nil',
    'K12==nil || K15 ==nil',
    'K2 !=nil && K18==nil',
    "K17 != nil && !string.contains(K2,'weixin.qq')",
    'NEXT_FLAG == 40597',
    "_from == 'api' && K17 != nil && string.contains(K17,'qinlong') && !string.contains(K2,'pdf') && NEXT_FLAG == 40597",
  ]
  it.each(samples)('%s 解析后重新生成，再解析结果一致', (expr) => {
    const parsed = parseConditionExpr(expr)!
    expect(parsed).not.toBeNull()
    const regenerated = conditionsToExpr(parsed.items, parsed.logic)
    expect(parseConditionExpr(regenerated)).toEqual(parsed)
  })
})
