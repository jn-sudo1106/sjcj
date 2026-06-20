import { describe, it, expect } from 'vitest'
import { mockEvaluate } from './rules'

describe('mockEvaluate 函数求值器', () => {
  it('IF 比较命中 THEN', () => {
    const r = mockEvaluate({ expr: 'IF(score >= 60, "合格", "不合格")', context: { score: 75 } })
    expect(r.ok).toBe(true)
    expect(r.value).toBe('合格')
    expect(r.branch).toBe('THEN')
  })
  it('IF 比较命中 ELSE', () => {
    const r = mockEvaluate({ expr: 'IF(score >= 60, "合格", "不合格")', context: { score: 40 } })
    expect(r.value).toBe('不合格')
    expect(r.branch).toBe('ELSE')
  })
  it('CONTAINS', () => {
    const r = mockEvaluate({ expr: 'IF(CONTAINS(title, "公告"), "是", "否")', context: { title: '重大事项公告' } })
    expect(r.value).toBe('是')
  })
  it('AND 组合条件', () => {
    const r = mockEvaluate({ expr: 'IF(amount > 100 AND level == "vip", "高", "普通")', context: { amount: 200, level: 'vip' } })
    expect(r.value).toBe('高')
  })
  it('context 接受 JSON 字符串', () => {
    const r = mockEvaluate({ expr: 'IF(n > 0, "正", "负")', context: '{ "n": 5 }' })
    expect(r.value).toBe('正')
  })
  it('未知变量返回错误', () => {
    const r = mockEvaluate({ expr: 'IF(x > 1, "a", "b")', context: {} })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
  it('非法 JSON context 返回错误', () => {
    const r = mockEvaluate({ expr: 'IF(n > 0, "a", "b")', context: '{ bad json' })
    expect(r.ok).toBe(false)
  })
})
