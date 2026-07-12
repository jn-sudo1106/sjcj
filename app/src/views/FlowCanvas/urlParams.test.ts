import { describe, it, expect } from 'vitest'
import { extractUrlParamIds, expandParameterizedUrl, hasFragmentParams, URL_EXPANSION_LIMIT } from './urlParams'

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
