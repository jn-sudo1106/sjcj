import { describe, expect, it } from 'vitest'
import { checkCountOf } from './checkCount'

describe('checkCountOf（§7.5 结构化口径，不解析中文日志）', () => {
  it.each([
    ['顶层 cnt', { cnt: 1240 }, '1240'],
    ['顶层 count', { count: 88 }, '88'],
    ['纯数字字符串', { dataCount: '12' }, '12'],
    ['metrics.cnt', { metrics: { cnt: 1240 } }, '1240'],
    ['metrics.recordCount', { metrics: { recordCount: 5 } }, '5'],
    ['metrics.resultCount 优先于日志', { metrics: { resultCount: 7 }, lastMsg: '正常, 数量:999' }, '7'],
  ])('%s → %s', (_name, row, count) => {
    expect(checkCountOf(row)).toBe(count)
  })

  it('结构化的 0 是真实值，不是未知', () => {
    expect(checkCountOf({ resultCount: 0 })).toBe('0')
    expect(checkCountOf({ metrics: { cnt: '0' } })).toBe('0')
  })

  it('日志里有「数量:5」但没有结构化字段 → 空串（调用方显示「—」）', () => {
    expect(checkCountOf({ lastMsg: '2026-09-09 11:00:46---正常, 数量:5' })).toBe('')
    expect(checkCountOf({ logMsg: '[X]:积压 1240 条, 超过阈值 1000' })).toBe('')
  })

  it('旧字符串入参不再解析日志，返回空串', () => {
    expect(checkCountOf('check ok cnt=50')).toBe('')
    expect(checkCountOf('2026-09-09 11:00:12---正常, 数量:1240')).toBe('')
  })

  it('取不到/非法值返回空串', () => {
    expect(checkCountOf(null)).toBe('')
    expect(checkCountOf(undefined)).toBe('')
    expect(checkCountOf({ cnt: null })).toBe('')
    expect(checkCountOf({ cnt: 'abc' })).toBe('')
    expect(checkCountOf({ metrics: null })).toBe('')
  })
})