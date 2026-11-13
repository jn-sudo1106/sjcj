// URL 生成（表达式版）纯计算回归：参数拆分、等长校验、笛卡尔集、上下文构造。
// 重点是 buildEnv 里那个「转义」的写法 —— 它同时往 p1 和 pp1 两个键里塞值，是旧版的原样行为。
import { describe, expect, it } from 'vitest'
import { buildEnv, buildRule, cartesianRows, lengthMismatch, parseToList } from './urlGen'

describe('parseToList', () => {
  it('按行拆并丢掉空行（旧 utils/util.js 口径）', () => {
    expect(parseToList('a\n\n  \nb\n')).toEqual(['a', 'b'])
    expect(parseToList('')).toEqual([])
    expect(parseToList(undefined)).toEqual([])
  })
})

describe('lengthMismatch', () => {
  it('长度一致返回 null，不一致给出旧版同款文案', () => {
    expect(lengthMismatch([['a', 'b'], ['1', '2']])).toBeNull()
    expect(lengthMismatch([['a', 'b'], ['1']])).toBe('多个参数数量不匹配: 1, vs , 2')
  })
})

describe('cartesianRows', () => {
  it('两个参数做全组合', () => {
    expect(cartesianRows([['a', 'b'], ['1', '2']])).toEqual([
      ['a', '1'],
      ['a', '2'],
      ['b', '1'],
      ['b', '2'],
    ])
  })

  it('单参数 = 原样，空参数 = 空结果（旧版在这里 reduce 会抛错）', () => {
    expect(cartesianRows([['a', 'b']])).toEqual([['a'], ['b']])
    expect(cartesianRows([['a'], []])).toEqual([])
    expect(cartesianRows([])).toEqual([])
  })

  it('值里自带 $$$ 也不会串位（旧版拼串再 split 的坑）', () => {
    expect(cartesianRows([['a$$$b'], ['1']])).toEqual([['a$$$b', '1']])
  })
})

describe('buildEnv', () => {
  it('不开转义：p{n} = 原值', () => {
    expect(buildEnv(['a b', 'c'], [false, false])).toEqual({ p1: 'a b', p2: 'c' })
  })

  it('开转义：p{n} 变 encodeURI，原值另存到 pp{n}（旧版就是 `p` + `p1`）', () => {
    expect(buildEnv(['a b'], [true])).toEqual({ p1: 'a%20b', pp1: 'a b' })
  })
})

describe('buildRule', () => {
  it('名称表达式 + 分隔符 + URL 表达式', () => {
    expect(buildRule("p1 + '-' + p2", "'http://' + p1")).toBe("p1 + '-' + p2 + ' ; ' + 'http://' + p1")
  })
})
