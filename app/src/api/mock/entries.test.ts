import { beforeEach, describe, expect, it } from 'vitest'
import { mockEntryDetail, mockGenerateAiCommont, mockBatchGenerateAiCommont } from './entries'

describe('实体表 AI 描述 mock', () => {
  beforeEach(() => {
    // ENTRIES 是模块级内存表，用例会互相写脏，先清掉上一次生成的描述
    const entry = mockEntryDetail({ tableId: '2102157' })
    delete entry.aiCommont
  })

  it('单表生成给出非空描述文本并写回表（缺 data 会让表单填进 "undefined"）', () => {
    const res = mockGenerateAiCommont({ tableId: '2102157' })

    expect(res.code).toBe(0)
    expect(res.data).toContain('sense_data.TB_ZFB_COMMENT')
    expect(mockEntryDetail({ tableId: '2102157' }).aiCommont).toBe(res.data)
  })

  it('表不存在时不编造描述，回非 0 码', () => {
    const res = mockGenerateAiCommont({ tableId: 'not-a-table' })

    expect(res.code).not.toBe(0)
    expect(res.data).toBe('')
    expect(res.msg).toContain('not-a-table')
  })

  it('批量：勾了算勾选的表，没勾按缺描述的表算（后端异步，这里不同步生成）', () => {
    expect(mockBatchGenerateAiCommont(['2102157', '2101001']).data).toEqual({ total: 2 })
    // 前条用例已把 2102157 的描述清掉，全量至少要覆盖它
    expect(mockBatchGenerateAiCommont().data.total).toBeGreaterThan(0)
  })
})
