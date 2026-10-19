// @vitest-environment jsdom
// 通用埋点 · 业务事件（CLICK / EDIT / CREATE / DELETE）。
// 这里只验两条铁律：① 事件类型与字段如实上报；② 埋点永远不能影响业务。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { logReportApi } from '@/api'
import { trackClick, trackCreate, trackDelete, trackEdit } from './logEvents'

const META = { eventCode: 'x_action', eventName: '某动作', firstModule: '采集资产', pageName: '某页面' }

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('logEvents', () => {
  it('四种动作各自上报正确的 action 与字段', () => {
    const spy = vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: 'ok', data: {} })

    trackClick('SOURCE', 's1', '源一', META)
    trackEdit('SOURCE', 's1', '源一', META)
    trackCreate('SITE', 'w1', '站点一', META)
    trackDelete('FLOW', 'f1', '流程一', META)

    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      { action: 'CLICK', contentType: 'SOURCE', contentId: 's1', contentTitle: '源一', ...META },
      { action: 'EDIT', contentType: 'SOURCE', contentId: 's1', contentTitle: '源一', ...META },
      { action: 'CREATE', contentType: 'SITE', contentId: 'w1', contentTitle: '站点一', ...META },
      { action: 'DELETE', contentType: 'FLOW', contentId: 'f1', contentTitle: '流程一', ...META },
    ])
  })

  it('没有 contentId 就不上报（后端会存一行空内容的脏数据）', () => {
    const spy = vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: 'ok', data: {} })
    trackClick('SOURCE', '', '空', META)
    trackDelete('SITE', undefined, undefined, META)
    expect(spy).not.toHaveBeenCalled()
  })

  it('contentId 统一转字符串：数字 ID 不会把 JSON 类型带歪', () => {
    const spy = vi.spyOn(logReportApi, 'report').mockResolvedValue({ success: true, code: '0', msg: 'ok', data: {} })
    trackClick('SOURCE', 12 as unknown as string, '源', META)
    expect(spy.mock.calls[0][0].contentId).toBe('12')
  })

  it('上报失败不抛：接口 reject 时调用方照常往下走', async () => {
    vi.spyOn(logReportApi, 'report').mockRejectedValue(new Error('500'))
    expect(() => trackCreate('FLOW', 'f1', '流程一', META)).not.toThrow()
    // reject 已被内部 catch 掉，浮到外面会变成 unhandled rejection，这里等一轮事件循环确认干净
    await Promise.resolve()
  })

  it('上报抛同步异常也不抛（比如 client 里端点未登记）', () => {
    vi.spyOn(logReportApi, 'report').mockImplementation(() => {
      throw new Error('端点不在契约清单')
    })
    expect(() => trackDelete('FLOW', 'f1', '流程一', META)).not.toThrow()
  })
})
