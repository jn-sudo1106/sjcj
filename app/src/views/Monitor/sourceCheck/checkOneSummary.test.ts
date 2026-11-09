import { describe, expect, it } from 'vitest'
import { summarizeCheckOne } from './checkOneSummary'

describe('summarizeCheckOne', () => {
  it('顶层带 cnt / maxId 时给出摘要', () => {
    expect(summarizeCheckOne({ cnt: 50, maxId: '88123' })).toBe('查出 50 条（cnt），maxId=88123')
  })

  it('包在 data.env 里、键名大小写不同也能找到', () => {
    expect(summarizeCheckOne({ data: { env: { CNT: 0, max_id: 7 } } })).toBe('查出 0 条（cnt），maxId=7')
  })

  it('找不到时返回空串', () => {
    expect(summarizeCheckOne({ message: 'ok' })).toBe('')
    expect(summarizeCheckOne(null)).toBe('')
  })
})
