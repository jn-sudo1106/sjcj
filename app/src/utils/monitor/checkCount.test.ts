import { describe, expect, it } from 'vitest'
import { checkCountOf } from './checkCount'

describe('checkCountOf', () => {
  it.each([
    ['2026-09-09 11:00:12---正常, 数量:1240', '1240'],
    ['2026-09-09 11:00:46---[X]:日增量-异常, 数量:0', '0'],
    ['正常，数量： 88', '88'],
    ['[X]:积压 1240 条, 超过阈值 1000', '1240'],
    ['check ok cnt=50', '50'],
  ])('%s → %s', (msg, count) => {
    expect(checkCountOf(msg)).toBe(count)
  })

  it('没有条数时返回空串', () => {
    expect(checkCountOf('校验正常')).toBe('')
    expect(checkCountOf('')).toBe('')
    expect(checkCountOf(undefined)).toBe('')
  })
})
