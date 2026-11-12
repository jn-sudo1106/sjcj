// 分页参数口径回归：旧 paged / paged-logs 只认 page/limit。
//
// 2026-11-11 踩过的坑：这里曾传 `size`，adaptPage 只映射 pageNo/pageSize，
// `size` 落进未知字段被原样带上、`limit` 仍是 undefined，真实后端按默认 10 条返回——
// mock 忽略分页所以测试全绿，线上却会少数据并误抛「超过 20 页」。
import { describe, expect, it, vi, beforeEach } from 'vitest'

const pagedSourceCheck = vi.fn()
const pagedCheckJobLogs = vi.fn()

vi.mock('./monitor', () => ({
  pagedSourceCheck: (...args: unknown[]) => pagedSourceCheck(...args),
  pagedCheckJobLogs: (...args: unknown[]) => pagedCheckJobLogs(...args),
  addSourceCheck: vi.fn(),
  updateSourceCheck: vi.fn(),
  changeSourceCheckEnable: vi.fn(),
  handleRunNow: vi.fn(),
}))

const { listMonitorRows, listRuns, saveMonitor, MONITOR_PAGE_SIZE } = await import('./monitorCenter')
const { updateSourceCheck } = await import('./monitor')
const { toMonitorRecord } = await import('../utils/monitor/record')

describe('monitorCenter 分页参数', () => {
  beforeEach(() => {
    pagedSourceCheck.mockReset()
    pagedCheckJobLogs.mockReset()
  })

  it('listMonitorRows 传 limit 而不是 size', async () => {
    pagedSourceCheck.mockResolvedValueOnce({ total: 1, list: [{ id: 1 }] })
    await listMonitorRows({ sourceId: '1001' })
    expect(pagedSourceCheck).toHaveBeenCalledTimes(1)
    const arg = pagedSourceCheck.mock.calls[0][0] as Record<string, unknown>
    expect(arg.limit).toBe(MONITOR_PAGE_SIZE)
    expect(arg).not.toHaveProperty('size')
  })

  it('listMonitorRows 按 total 翻页直到取满', async () => {
    pagedSourceCheck
      .mockResolvedValueOnce({ total: 3, list: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ total: 3, list: [{ id: 3 }] })
    const rows = await listMonitorRows()
    expect(rows).toHaveLength(3)
    expect(pagedSourceCheck).toHaveBeenCalledTimes(2)
  })

  it('listRuns 传 limit 而不是 size', async () => {
    pagedCheckJobLogs.mockResolvedValueOnce({ total: 0, list: [] })
    await listRuns({ monitorId: 'mon-1', size: 50 })
    const arg = pagedCheckJobLogs.mock.calls[0][0] as Record<string, unknown>
    expect(arg.limit).toBe(50)
    expect(arg).not.toHaveProperty('size')
    expect(arg.jobId).toBe('mon-1')
  })

  it('显式清空调度保留空串，同时保留原记录启停与运行状态', async () => {
    const record = toMonitorRecord({
      id: 'm1', sourceId: 's1', name: '原名', state: 'E', isDelete: 1,
      lastMsg: '', nextRun: '', lastRun: '',
      tableName: 'old_table', schedule: '0 30 8 * * ?', checkConf: '{}',
    })
    await saveMonitor({ record, sourceId: 's1', name: '新名', kind: 'rule', conf: { cron: 'old' }, schedule: '', tableName: '' })
    const payload = vi.mocked(updateSourceCheck).mock.calls.at(-1)![0] as Record<string, unknown>
    expect(payload).toMatchObject({ id: 'm1', isDelete: 1, state: 'E', schedule: '', tableName: '' })
    expect(JSON.parse(String(payload.checkConf)).cron).toBe('')
  })
})
