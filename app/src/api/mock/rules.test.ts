import { describe, expect, it } from 'vitest'
import {
  mockEvaluate,
  mockRuleOrchestrationGenerate,
  mockRuleOrchestrationPaged,
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
      rows: [{ content: '某地产公司发布重大事项公告' }],
    })
    expect(tested).toMatchObject({
      success: true,
      outputs: [{ tags: ['房地产'] }],
    })

  })

  // 走 RuleTableFieldBinder 选定字段的路径（0801 方案）：不能永远吐旧「地产」演示脚本/tags 出参，
  // 否则任何自定义规则测出来的结果都是一坨看不懂的 {tags: []}（浏览器验证中实测发现的问题）。
  it('按 inputFields/outputFields 生成骨架与出参，不再固定回退地产演示', () => {
    const generated = mockRuleOrchestrationGenerate({
      ruleCfg: { describe: '根据商品ID生成商品名称', inputFields: ['sku_id'], outputFields: ['sku_name'] },
    })
    expect(generated.script).toContain('def main(sku_id)')
    expect(generated.script).toContain('"sku_name"')

    const tested = mockRuleOrchestrationTest({
      script: generated.script,
      inputFields: ['sku_id'],
      outputFields: ['sku_name'],
      rows: [{ sku_id: 'SKU-A' }],
    })
    expect(tested.success).toBe(true)
    // sku_name 不在入参里，透传不到，回退占位值而不是空对象/undefined
    expect(tested.outputs).toEqual([{ sku_name: 'demo-sku_name' }])
  })

  it('出参字段与入参字段同名时直接透传该值', () => {
    const tested = mockRuleOrchestrationTest({
      script: 'def main(sku_id):\n    return {"sku_id": sku_id}',
      inputFields: ['sku_id'],
      outputFields: ['sku_id'],
      rows: [{ sku_id: 'SKU-A' }],
    })
    expect(tested.outputs).toEqual([{ sku_id: 'SKU-A' }])
  })

  // S3-2：cfg.format === 'xml' 时产出 XML 抓取配置骨架而不是 Python 脚本，scriptPath 后缀跟着换；
  // 缺省（无 format 或 'python'）行为不变，规则节点零回归。
  it('format 为 xml 时生成 XML 产物骨架，scriptPath 用 .xml 后缀', () => {
    const generated = mockRuleOrchestrationGenerate({
      ruleCfg: { describe: '列表抓取', format: 'xml' },
    })
    expect(generated.script).toContain('<Config>')
    expect(generated.script).toContain('</Config>')
    expect(generated.scriptPath).toMatch(/\.xml$/)
  })
})
