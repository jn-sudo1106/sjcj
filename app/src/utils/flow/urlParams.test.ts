import { describe, it, expect } from 'vitest'
import {
  extractUrlParamIds, expandParameterizedUrl, hasFragmentParams, URL_EXPANSION_LIMIT,
  joinType, countGroupedUrls, groupMismatchWarnings, firstGroupedCombos, expandGroupedParameterizedUrl,
  type ParamGroupRef,
} from './urlParams'

describe('extractUrlParamIds（0711 R9）', () => {
  it('解析数字 id 与字符串 id，去重并保留首次出现顺序', () => {
    const url = 'https://x.com?a=$PARAM$_1035&b=$PARAM$_1036&c=$PARAM$_1035&d=$PARAM$_my_param'
    expect(extractUrlParamIds(url)).toEqual(['1035', '1036', 'my_param'])
  })

  it('无占位符 / 空 URL 返回空数组', () => {
    expect(extractUrlParamIds('https://x.com?a=1')).toEqual([])
    expect(extractUrlParamIds('')).toEqual([])
  })

  it('懂车帝真实 URL 场景：fragment 里的 5 个参数全部识别', () => {
    const url = 'https://www.dongchedi.com/usedcar/x#brand=534&price=$PARAM$_1035&series_type=$PARAM$_1036&fuel_form=$PARAM$_1037&age_range=$PARAM$_1038&expanded_origin=$PARAM$_1039'
    expect(extractUrlParamIds(url)).toEqual(['1035', '1036', '1037', '1038', '1039'])
  })
})

describe('hasFragmentParams（0711 R9：普通网页抓取不支持 fragment 参数）', () => {
  it('参数在 # 之后返回 true', () => {
    expect(hasFragmentParams('https://x.com/a#price=$PARAM$_1035')).toBe(true)
  })
  it('参数在 # 之前（query string）返回 false', () => {
    expect(hasFragmentParams('https://x.com/a?price=$PARAM$_1035#section')).toBe(false)
  })
  it('无 # 或无参数返回 false', () => {
    expect(hasFragmentParams('https://x.com/a')).toBe(false)
    expect(hasFragmentParams('https://x.com/a#section')).toBe(false)
  })
  it('连续调用不因正则 /g 状态污染结果（历史踩坑点）', () => {
    const url = 'https://x.com/a#price=$PARAM$_1035'
    expect(hasFragmentParams(url)).toBe(true)
    expect(hasFragmentParams(url)).toBe(true)
    expect(hasFragmentParams(url)).toBe(true)
  })
})

describe('expandParameterizedUrl（0711 R9：笛卡尔积展开 + 上限截断）', () => {
  it('无参数的 URL 原样返回单条', () => {
    const r = expandParameterizedUrl('https://x.com/a', {})
    expect(r).toEqual({ urls: ['https://x.com/a'], total: 1, errors: [], truncated: false })
  })

  it('单参数：按候选值逐一替换', () => {
    const r = expandParameterizedUrl('https://x.com?s=$PARAM$_1036', { '1036': ['SUV', '轿车'] })
    expect(r.errors).toEqual([])
    expect(r.total).toBe(2)
    expect(r.urls).toEqual(['https://x.com?s=SUV', 'https://x.com?s=%E8%BD%BF%E8%BD%A6'])
  })

  it('多参数：笛卡尔积（2 × 3 = 6）', () => {
    const r = expandParameterizedUrl(
      'https://x.com?a=$PARAM$_p1&b=$PARAM$_p2',
      { p1: ['x', 'y'], p2: ['1', '2', '3'] },
    )
    expect(r.total).toBe(6)
    expect(r.truncated).toBe(false)
    expect(new Set(r.urls).size).toBe(6) // 6 条互不相同
  })

  it('缺少取值的参数直接报错，不生成任何 URL', () => {
    const r = expandParameterizedUrl('https://x.com?a=$PARAM$_p1&b=$PARAM$_p2', { p1: ['x'] })
    expect(r.urls).toEqual([])
    expect(r.total).toBe(0)
    expect(r.errors).toEqual(['参数 p2 缺少可用取值'])
  })

  it('组合数超过 limit 时截断且标记 truncated', () => {
    const r = expandParameterizedUrl(
      'https://x.com?a=$PARAM$_p1&b=$PARAM$_p2',
      { p1: Array.from({ length: 50 }, (_, i) => `a${i}`), p2: Array.from({ length: 50 }, (_, i) => `b${i}`) },
      100,
    )
    expect(r.total).toBe(100)
    expect(r.truncated).toBe(true)
  })

  it('默认上限是 1000', () => {
    expect(URL_EXPANSION_LIMIT).toBe(1000)
  })

  it('参数值先编码后替换（避免特殊字符破坏 URL）', () => {
    const r = expandParameterizedUrl('https://x.com?q=$PARAM$_kw', { kw: ['基金 & 白酒'] })
    expect(r.urls[0]).toBe(`https://x.com?q=${encodeURIComponent('基金 & 白酒')}`)
  })
})

describe('joinType（0721 会议·按分组推导拼接类型）', () => {
  it('全部无组 → 笛卡尔积', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }, { paramId: 'p2' }]
    expect(joinType(refs)).toBe('cartesian')
  })
  it('每组仅 1 个成员（退化）→ 等价全笛卡尔积', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'B' }]
    expect(joinType(refs)).toBe('cartesian')
  })
  it('单组覆盖全部参数 → 顺序', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }]
    expect(joinType(refs)).toBe('zip')
  })
  it('混合：一组顺序拼 + 另一无组参数 → 分组顺序+组间笛卡尔积', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }, { paramId: 'p3' }]
    expect(joinType(refs)).toBe('grouped')
  })
})

describe('countGroupedUrls（计数场景）', () => {
  it('全部无组：各参数数量相乘', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }, { paramId: 'p2' }]
    expect(countGroupedUrls(refs, { p1: 2, p2: 3 })).toBe(6)
  })
  it('单组顺序拼：取组内数量（值数一致时）', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }]
    expect(countGroupedUrls(refs, { p1: 3, p2: 3 })).toBe(3)
  })
  it('混合：组内 zip（按 max 对齐）× 组外笛卡尔积', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }, { paramId: 'p3' }]
    expect(countGroupedUrls(refs, { p1: 3, p2: 3, p3: 2 })).toBe(6)
  })
  it('同组值数不一致：按组内最大值对齐计数', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }]
    expect(countGroupedUrls(refs, { p1: 2, p2: 4 })).toBe(4)
  })
})

describe('groupMismatchWarnings', () => {
  it('同组值数一致：无警告', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }]
    expect(groupMismatchWarnings(refs, { p1: 3, p2: 3 })).toEqual([])
  })
  it('同组值数不一致：报警并列出涉及的参数', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }]
    expect(groupMismatchWarnings(refs, { p1: 2, p2: 4 })).toEqual([{ group: 'A', paramIds: ['p1', 'p2'] }])
  })
  it('无组参数不参与校验', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }, { paramId: 'p2' }]
    expect(groupMismatchWarnings(refs, { p1: 2, p2: 4 })).toEqual([])
  })
})

describe('firstGroupedCombos（示例取值顺序：第一个因子进位最快）', () => {
  it('纯笛卡尔积：p1 变化最快（1-a、2-a、3-a…）', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }, { paramId: 'p2' }]
    const combos = firstGroupedCombos(refs, { p1: ['1', '2', '3'], p2: ['a', 'b'] }, 4)
    expect(combos).toEqual([
      { p1: '1', p2: 'a' }, { p1: '2', p2: 'a' }, { p1: '3', p2: 'a' }, { p1: '1', p2: 'b' },
    ])
  })
  it('单组顺序拼：组内对齐取值（1-a、2-b…）', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1', group: 'A' }, { paramId: 'p2', group: 'A' }]
    const combos = firstGroupedCombos(refs, { p1: ['1', '2'], p2: ['a', 'b'] }, 4)
    expect(combos).toEqual([{ p1: '1', p2: 'a' }, { p1: '2', p2: 'b' }])
  })
})

describe('expandGroupedParameterizedUrl（0721 会议·分组展开）', () => {
  it('无参数：模板原样返回单条', () => {
    const r = expandGroupedParameterizedUrl('https://x.com/a', [], {})
    expect(r).toEqual({ urls: ['https://x.com/a'], total: 1, errors: [], truncated: false })
  })
  it('模板替换含 / 分隔（自定义拼接符）', () => {
    const refs: ParamGroupRef[] = [{ paramId: '913' }, { paramId: '912' }]
    const r = expandGroupedParameterizedUrl('http://base/$PARAM$_913/$PARAM$_912', refs, { 913: ['1'], 912: ['a'] })
    expect(r.urls).toEqual(['http://base/1/a'])
  })
  it('未知 id（模板里无对应参数）原样保留', () => {
    const refs: ParamGroupRef[] = [{ paramId: '913' }]
    const r = expandGroupedParameterizedUrl('http://base-$PARAM$_913-$PARAM$_999', refs, { 913: ['1'] })
    expect(r.urls).toEqual(['http://base-1-$PARAM$_999'])
  })
  it('值含 $：字面输出，不触发 JS replace 特殊替换语法', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }]
    const r = expandGroupedParameterizedUrl('http://base-$PARAM$_p1', refs, { p1: ['a$&$`$b'] })
    expect(r.urls).toEqual([`http://base-${encodeURIComponent('a$&$`$b')}`])
  })
  it('缺少取值的参数直接报错，不生成 URL', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }, { paramId: 'p2' }]
    const r = expandGroupedParameterizedUrl('http://base-$PARAM$_p1-$PARAM$_p2', refs, { p1: ['1'] })
    expect(r.urls).toEqual([])
    expect(r.errors).toEqual(['参数 p2 缺少可用取值'])
  })
  it('组合数超过 limit 时截断且标记 truncated', () => {
    const refs: ParamGroupRef[] = [{ paramId: 'p1' }, { paramId: 'p2' }]
    const r = expandGroupedParameterizedUrl(
      'http://base-$PARAM$_p1-$PARAM$_p2',
      refs,
      { p1: Array.from({ length: 20 }, (_, i) => `a${i}`), p2: Array.from({ length: 20 }, (_, i) => `b${i}`) },
      100,
    )
    expect(r.total).toBe(100)
    expect(r.truncated).toBe(true)
  })
})
