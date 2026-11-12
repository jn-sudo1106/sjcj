// 发抓取回执整理（2026-10-22）：后端把「源不能发」放在成功回执的 failedDetails 里，前端要认出来
import { describe, expect, it } from 'vitest'
import { snatchAckFrom, snatchFailReasonText, snatchFailureSummary } from './snatchResult'

describe('snatchResult', () => {
  it('Spring 内部异常原文翻成人话；可读原因原样保留', () => {
    expect(snatchFailReasonText('Incorrect result size: expected 1, actual 0')).toBe('没有可用的流程（关联的流程可能已禁用，或还没有关联流程）')
    expect(snatchFailReasonText('指定流程不在当前可用关联中：sourceId=20010739, sourceGroupId=null, flowId=402330')).toBe('指定的流程不在这个源当前可用的流程里（可能已禁用或已解绑）')
    expect(snatchFailReasonText('源已停用')).toBe('源已停用')
    expect(snatchFailReasonText('')).toBe('原因未知')
  })

  it('一个都没发出去（186 实测：流程禁用后的手动抓取）：抛错，信息是翻译后的原因', () => {
    const raw = { failedDetails: [{ sourceId: 20010739, reason: 'Incorrect result size: expected 1, actual 0', success: false }], total: 1, failCount: 1, successCount: 0 }
    expect(() => snatchAckFrom(raw)).toThrow('源 20010739：没有可用的流程（关联的流程可能已禁用，或还没有关联流程）')
  })

  it('部分发出去：正常返回，带上没发出去的源和说明', () => {
    const ack = snatchAckFrom({
      failedDetails: [{ sourceId: 2, reason: 'Incorrect result size: expected 1, actual 0', success: false }],
      total: 3, failCount: 1, successCount: 2,
    })
    expect(ack.sent).toBe(2)
    expect(ack.failed).toEqual([{ sourceId: '2', reason: 'Incorrect result size: expected 1, actual 0' }])
    expect(ack.message).toBe('已发起 2 个源，1 个未发起：源 2：没有可用的流程（关联的流程可能已禁用，或还没有关联流程）')
  })

  it('全部成功 / 旧格式回执：原样返回，不带 failed', () => {
    const ok = { failedDetails: [], total: 1, failCount: 0, successCount: 1 }
    expect(snatchAckFrom(ok)).toBe(ok)
    expect(snatchAckFrom({ ok: true, message: '处理成功' })).toEqual({ ok: true, message: '处理成功' })
    expect(snatchAckFrom(null)).toEqual({})
  })

  it('同一原因的源归在一起，超过 5 个只列前 5 个', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ sourceId: String(i + 1), reason: 'Incorrect result size: expected 1, actual 0' }))
    expect(snatchFailureSummary([...many, { sourceId: '9', reason: '源已停用' }])).toBe(
      '7 个源（1、2、3、4、5 等）：没有可用的流程（关联的流程可能已禁用，或还没有关联流程）；源 9：源已停用',
    )
  })
})
