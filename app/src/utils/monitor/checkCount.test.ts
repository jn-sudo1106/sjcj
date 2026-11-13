import { describe, expect, it } from 'vitest'
import { checkCountOf } from './checkCount'

describe('checkCountOf（结构化优先 + 文本过渡兜底）', () => {
  it.each([
    ['顶层 cnt', { cnt: 1240 }, '1240'],
    ['顶层 count', { count: 88 }, '88'],
    ['纯数字字符串', { dataCount: '12' }, '12'],
    ['metrics.cnt', { metrics: { cnt: 1240 } }, '1240'],
    ['metrics.recordCount', { metrics: { recordCount: 5 } }, '5'],
    ['metrics.resultCount 优先于日志', { metrics: { resultCount: 7 }, lastMsg: '正常, 数量:999' }, '7'],
    ['顶层结构化字段优先于日志', { count: 3, lastMsg: '正常, 数量:999' }, '3'],
  ])('%s → %s', (_name, row, count) => {
    expect(checkCountOf(row)).toBe(count)
  })

  it('结构化的 0 是真实值，不是未知（也不会被日志里的数字覆盖）', () => {
    expect(checkCountOf({ resultCount: 0 })).toBe('0')
    expect(checkCountOf({ metrics: { cnt: '0' } })).toBe('0')
    expect(checkCountOf({ cnt: 0, lastMsg: '正常, 数量:999' })).toBe('0')
  })

  // 过渡兜底：后端 CkSource / CkJobLog 目前没有结构化计数字段，
  // 条数只存在于 lastMsg / logMsg 文本里（2026-11-10 实测 jar）。后端补字段后这条可删。
  it('无结构化字段时按执行结果文本兜底解析', () => {
    expect(checkCountOf({ lastMsg: '2026-09-09 11:00:46---正常, 数量:5' })).toBe('5')
    expect(checkCountOf({ logMsg: '[X]:积压 1240 条, 超过阈值 1000' })).toBe('1240')
    expect(checkCountOf({ logMsg: 'check ok cnt=50' })).toBe('50')
    expect(checkCountOf({ lastMsg: '正常, 数量：88' })).toBe('88')
  })

  it('文本里没有可解析条数 → 空串（调用方显示「—」，不默认 0）', () => {
    expect(checkCountOf({ lastMsg: '2026-09-09 11:00:46---正常' })).toBe('')
    expect(checkCountOf({ logMsg: '积压超过阈值 1000' })).toBe('')
    expect(checkCountOf({ lastMsg: '' })).toBe('')
  })

  it('旧字符串入参不解析日志，返回空串', () => {
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