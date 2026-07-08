import { describe, expect, it } from 'vitest'
import {
  mockEvaluate,
  mockRuleOrchestrationGenerate,
  mockRuleOrchestrationPaged,
  mockRuleOrchestrationSave,
  mockRuleOrchestrationTest,
} from './rules'

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

describe('规则编排 mock（0707 Phase 9）', () => {
  it('支持列表、生成、测试、保存闭环', () => {
    const list = mockRuleOrchestrationPaged({ size: 10 })
    expect(list.list.length).toBeGreaterThan(0)
    expect(list.list[0]).toHaveProperty('ruleId')

    const generated = mockRuleOrchestrationGenerate({
      describe: '正文 content 包含地产时加标签房地产',
      systemPrompt: '返回 JSON',
    })
    expect(generated.script).toContain('def main')
    expect(generated.scriptPath).toContain('/rules/generated/')

    const tested = mockRuleOrchestrationTest({
      script: generated.script,
      params: { content: '某地产公司发布重大事项公告' },
    })
    expect(tested).toMatchObject({
      success: true,
      result: { tags: ['房地产'] },
    })

    const saved = mockRuleOrchestrationSave({
      mode: 'new',
      describe: '正文 content 包含地产时加标签房地产',
      script: generated.script,
      scriptPath: generated.scriptPath,
    })
    expect(saved.ruleId).toMatch(/^orch-/)
    expect(saved.scriptPath).toBe(generated.scriptPath)
  })
})
