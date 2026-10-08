import { describe, expect, it } from 'vitest'
import { scopedSourceIds } from './sourceScope'
describe('固定源分组范围', () => {
  it('无范围不影响原查询', () => { expect(scopedSourceIds(undefined, '10')).toBe('10') })
  it('空分组和空交集必须保留空值，不能回退不限', () => {
    expect(scopedSourceIds([], undefined)).toBe('')
    expect(scopedSourceIds(['10'], '20')).toBe('')
  })
  it('查询取交集，清空筛选仍锁定分组', () => {
    expect(scopedSourceIds(['10', '20'], '20,30')).toBe('20')
    expect(scopedSourceIds(['10', '20'])).toBe('10,20')
  })
})
