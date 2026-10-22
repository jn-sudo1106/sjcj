// @vitest-environment jsdom
// 发抓取回执契约（2026-10-22，186 实测形状）：后端把「源不能发」放在成功回执的 failedDetails 里。
// 一个都没发出去时 sendSnatchWithParam 要抛错，否则各入口会弹「已发起抓取」却一个任务都没建。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true, code: '0', msg: '操作成功', data }) } as Response)

describe('source/sendSnatchWithParam 回执', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('VITE_API_MODE', 'http')
    vi.stubEnv('VITE_API_BASE', '')
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const payload = { ids: ['20010739'], param: {}, all: 0, include: [], skip: 0 }

  it('流程禁用后手动抓取：successCount=0 → 抛错，原因翻成人话', async () => {
    fetchMock.mockResolvedValue(ok({ failedDetails: [{ sourceId: 20010739, reason: 'Incorrect result size: expected 1, actual 0', success: false }], total: 1, failCount: 1, successCount: 0 }))
    const { sourceApi } = await import('./index')
    await expect(sourceApi.sendSnatchWithParam(payload)).rejects.toThrow('源 20010739：没有可用的流程')
  })

  it('全部发出：正常返回，不带 failed', async () => {
    fetchMock.mockResolvedValue(ok({ failedDetails: [], total: 1, failCount: 0, successCount: 1 }))
    const { sourceApi } = await import('./index')
    const ack = await sourceApi.sendSnatchWithParam(payload)
    expect(ack.failed).toBeUndefined()
  })
})
