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

const sourcePaged = vi.fn()

vi.mock('./index', () => ({
  sourceApi: { sourcePaged: (...args: unknown[]) => sourcePaged(...args) },
  siteApi: { siteSources: vi.fn() },
}))

const runnerRequest = vi.fn()
vi.mock('./runnerManagement', () => ({
  requestRunnerManagement: (...args: unknown[]) => runnerRequest(...args),
}))

const { listMonitorRows, listRuns, saveMonitor, listSourceNames, runMonitorsNow, MONITOR_PAGE_SIZE } = await import('./monitorCenter')
const { updateSourceCheck, handleRunNow } = await import('./monitor')
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

describe('listSourceNames 按 ID 批量取名', () => {
  beforeEach(() => {
    sourcePaged.mockReset()
  })

  it('只按本页出现的源 ID 取名字，去重后一次请求', async () => {
    sourcePaged.mockResolvedValueOnce({
      total: 2,
      list: [
        { sourceId: '390000019', name: '本地债券', mainTable: 'sense_data.tb_local_bond', siteName: '财经资讯站' },
        { sourceId: '390000008', name: 'Wind CFETS' },
      ],
    })
    const names = await listSourceNames(['390000019', '390000008', '390000019', ''])
    expect(sourcePaged).toHaveBeenCalledTimes(1)
    const arg = sourcePaged.mock.calls[0][0] as Record<string, unknown>
    expect(arg.ids).toBe('390000019,390000008')
    expect(arg.size).toBe(2)
    expect(names.map((item) => item.sourceId)).toEqual(['390000019', '390000008'])
    expect(names[0].tableName).toBe('sense_data.tb_local_bond')
    expect(names[0].siteName).toBe('财经资讯站')
  })

  it('没有 ID 时不发请求', async () => {
    expect(await listSourceNames([])).toEqual([])
    expect(sourcePaged).not.toHaveBeenCalled()
  })
})

describe('立即运行按检查方式分流', () => {
  beforeEach(() => {
    runnerRequest.mockReset()
    vi.mocked(handleRunNow).mockReset()
    runnerRequest.mockResolvedValue({ applied: true, count: 1, items: [] })
  })

  it('脚本检查走执行器，不碰旧 runNow', async () => {
    const result = await runMonitorsNow(['1104'], { '1104': 'ai' })
    expect(runnerRequest).toHaveBeenCalledTimes(1)
    expect(runnerRequest).toHaveBeenCalledWith('/monitor-runner/scan', 'POST', {
      apply: true,
      force: true,
      monitorIds: [1104],
    })
    expect(handleRunNow).not.toHaveBeenCalled()
    expect(result).toMatchObject({ viaRunner: 1, viaLegacy: 0 })
  })

  it('规则检查走旧 runNow；混合时两边都调', async () => {
    vi.mocked(handleRunNow).mockResolvedValue({ ok: true })
    await runMonitorsNow(['135'], { '135': 'rule' })
    expect(runnerRequest).not.toHaveBeenCalled()
    expect(handleRunNow).toHaveBeenCalledWith(['135'])

    runnerRequest.mockResolvedValue({ applied: true, count: 1, items: [] })
    const mixed = await runMonitorsNow(['135', '1104'], { '135': 'rule', '1104': 'ai' })
    expect(handleRunNow).toHaveBeenLastCalledWith(['135'])
    expect(mixed).toMatchObject({ viaRunner: 1, viaLegacy: 1 })
  })

  it('执行器跳过与 runId 分开统计（跳过不算已执行）', async () => {
    runnerRequest.mockResolvedValue({
      applied: true,
      count: 2,
      items: [
        { runId: 'run-1104-20261112210408', monitorId: 1104, status: 'ABNORMAL' },
        { monitorId: 1105, status: 'SKIPPED', skipped: true, reason: '另一实例正在执行' },
      ],
    })
    const result = await runMonitorsNow(['1104', '1105'], { '1104': 'ai', '1105': 'ai' })
    expect(result.runnerSkipped).toBe(1)
    expect(result.runnerRunIds).toEqual(['run-1104-20261112210408'])
  })

  it('没有 kind 信息时保持旧行为（不能把未知当成脚本检查）', async () => {
    vi.mocked(handleRunNow).mockResolvedValue({ ok: true })
    await runMonitorsNow(['999'])
    expect(runnerRequest).not.toHaveBeenCalled()
    expect(handleRunNow).toHaveBeenCalledWith(['999'])
  })
})
