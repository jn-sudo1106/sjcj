// 分页参数口径回归：旧 paged / paged-logs 只认 page/limit。
//
// 2026-11-11 踩过的坑：这里曾传 `size`，adaptPage 只映射 pageNo/pageSize，
// `size` 落进未知字段被原样带上、`limit` 仍是 undefined，真实后端按默认 10 条返回——
// mock 忽略分页所以测试全绿，线上却会少数据并误抛「超过 20 页」。
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { SourceCheck, SourceCheckRunItem } from './types/monitor'

const pagedSourceCheck = vi.fn()
const pagedCheckJobLogs = vi.fn()
const pagedCheckRuns = vi.fn()
const getSourceCheckDetail = vi.fn()
const getCheckRun = vi.fn()
const runChecksNow = vi.fn()

vi.mock('./monitor', () => ({
  pagedSourceCheck: (...args: unknown[]) => pagedSourceCheck(...args),
  pagedCheckJobLogs: (...args: unknown[]) => pagedCheckJobLogs(...args),
  pagedCheckRuns: (...args: unknown[]) => pagedCheckRuns(...args),
  getSourceCheckDetail: (...args: unknown[]) => getSourceCheckDetail(...args),
  getCheckRun: (...args: unknown[]) => getCheckRun(...args),
  runChecksNow: (...args: unknown[]) => runChecksNow(...args),
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

const {
  listMonitorRows,
  listRuns,
  listNotifications,
  retryNotification,
  saveMonitor,
  listSourceNames,
  runMonitorsNow,
  loadMonitorDetail,
  loadMonitorRecord,
  getRunDetail,
  MONITOR_PAGE_SIZE,
  MonitorRunUncertainError,
} = await import('./monitorCenter')
const { updateSourceCheck, addSourceCheck, handleRunNow } = await import('./monitor')
const { toMonitorRecord } = await import('../utils/monitor/record')

describe('monitorCenter 分页参数', () => {
  beforeEach(() => {
    pagedSourceCheck.mockReset()
    pagedCheckJobLogs.mockReset()
    // 新 /runs 默认不可用（返回 undefined）→ 走降级，保证下面的旧口径用例仍然覆盖 paged-logs
    pagedCheckRuns.mockReset()
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

describe('checkConf 检查对象归属（1113）', () => {
  beforeEach(() => {
    vi.mocked(updateSourceCheck).mockReset()
    vi.mocked(addSourceCheck).mockReset()
  })

  it('编辑已有记录时写入 source_result', async () => {
    const record = toMonitorRecord({
      id: 'm1', sourceId: 's1', name: '原名', state: 'C', isDelete: 0,
      lastMsg: '', tableName: 'old_table', schedule: '0 8 * * * *', nextRun: '', lastRun: '',
      checkConf: '{}',
    })
    await saveMonitor({ record, sourceId: 's1', name: '原名', kind: 'ai', conf: {} })
    const payload = vi.mocked(updateSourceCheck).mock.calls.at(-1)![0] as Record<string, unknown>
    expect(JSON.parse(String(payload.checkConf)).scopeType).toBe('source_result')
  })

  it('新建记录时写入 source_result', async () => {
    await saveMonitor({ sourceId: 's1', name: '新监控', kind: 'ai', conf: { methods: ['notNull'] } })
    const payload = vi.mocked(addSourceCheck).mock.calls.at(-1)![0] as Record<string, unknown>
    const conf = JSON.parse(String(payload.checkConf))
    expect(conf.scopeType).toBe('source_result')
    // 其余配置不能因为这个字段被丢掉
    expect(conf.methods).toEqual(['notNull'])
  })

  it('显式传入的 scopeType 不被覆盖（节点环节记录原样保存）', async () => {
    await saveMonitor({ sourceId: 's1', name: '节点检查', kind: 'ai', conf: { scopeType: 'node_input' } })
    const payload = vi.mocked(addSourceCheck).mock.calls.at(-1)![0] as Record<string, unknown>
    expect(JSON.parse(String(payload.checkConf)).scopeType).toBe('node_input')
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

describe('通知回执接口', () => {
  beforeEach(() => {
    runnerRequest.mockReset()
  })

  it('monitorId 为空时只拼 limit，不把空串带给后端', async () => {
    runnerRequest.mockResolvedValueOnce({ count: 0, items: [] })
    await listNotifications({ monitorId: '  ', limit: 50 })
    expect(runnerRequest).toHaveBeenCalledWith('/monitor-runner/notifications?limit=50')
  })

  it('monitorId / runId / limit 按 query string 拼', async () => {
    runnerRequest.mockResolvedValueOnce({ count: 1, items: [{ eventId: 'e1' }] })
    const result = await listNotifications({ monitorId: '1104', runId: 'run-1104-2026', limit: 20 })
    expect(runnerRequest).toHaveBeenCalledWith(
      '/monitor-runner/notifications?monitorId=1104&runId=run-1104-2026&limit=20',
    )
    expect(result).toEqual({ count: 1, items: [{ eventId: 'e1' }] })
  })

  it('count 缺失时按 items 长度兜底，items 非数组时给空列表', async () => {
    runnerRequest.mockResolvedValueOnce({ items: [{ eventId: 'e1' }, { eventId: 'e2' }] })
    expect((await listNotifications({ monitorId: '1104' })).count).toBe(2)
    runnerRequest.mockResolvedValueOnce({})
    expect(await listNotifications({ monitorId: '1104' })).toEqual({ count: 0, items: [] })
  })

  it('重试走 POST（无 body），eventId 做 URL 编码', async () => {
    runnerRequest.mockResolvedValueOnce({ event: { eventId: 'evt 1' } })
    const event = await retryNotification('evt 1')
    expect(runnerRequest).toHaveBeenCalledWith('/monitor-runner/notifications/evt%201/retry', 'POST')
    expect(event.eventId).toBe('evt 1')
  })

  it('服务端 404 的「事件不存在」原样抛出，不会伪装成功', async () => {
    runnerRequest.mockRejectedValueOnce(new Error('事件不存在'))
    await expect(retryNotification('evt-x')).rejects.toThrow('事件不存在')
  })
})

describe('立即运行按检查方式分流', () => {
  beforeEach(() => {
    runnerRequest.mockReset()
    vi.mocked(handleRunNow).mockReset()
    // 新 /run 默认不可用 → 覆盖旧的分流降级路径
    runChecksNow.mockReset()
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

// ---------------------------------------------------------------- C06 运行记录新接口

function runItem(over: Partial<SourceCheckRunItem> = {}): SourceCheckRunItem {
  return {
    logId: 9001,
    monitorId: 1109,
    sourceId: 's1',
    name: '字段完整性',
    tableName: 'sense_data.tb_jjjk',
    state: 'C',
    logDt: '2026-11-13 06:00:00',
    createDt: '2026-11-13 06:00:05',
    message: '正常',
    legacy: false,
    runId: 'run-1',
    status: 'NORMAL',
    checkedCount: 120,
    abnormalCount: 2,
    durationMs: 1500,
    window: { start: '2026-11-13 00:00:00', end: '2026-11-13 01:00:00', timezone: 'Asia/Shanghai' },
    reason: null,
    scriptPath: null,
    overdue: false,
    configSnapshot: null,
    ...over,
  }
}

function monitorRow(over: Partial<SourceCheck> = {}): SourceCheck {
  return {
    id: '1109',
    isDelete: 0,
    state: 'C',
    lastMsg: '',
    name: '字段完整性',
    tableName: 'sense_data.tb_jjjk',
    schedule: '0 0 6 * * *',
    nextRun: '2026-11-14 06:00:00',
    lastRun: '2026-11-13 06:00:00',
    sourceId: '390000019',
    checkConf: '{"kind":"ai","methods":["notNull"]}',
    ...over,
  }
}

/** client 把非 2xx 包成带 status 的错误 */
function notFoundError(status = 404) {
  return Object.assign(new Error(`请求失败 ${status}`), { status })
}

/** 断网/超时：根因 TypeError 或 message 命中网络关键词，不能静默当成「记录不存在」 */
function offlineError() {
  return Object.assign(new Error('请求异常 [source/check/detail]: Failed to fetch'), {
    cause: new TypeError('Failed to fetch'),
  })
}

describe('运行记录优先走 C06 /runs（旧后端降级 paged-logs）', () => {
  beforeEach(() => {
    pagedCheckRuns.mockReset()
    pagedCheckJobLogs.mockReset()
  })

  it('RunItem 映射成运行视图：结构化字段/窗口/耗时/快照都来自服务端', async () => {
    pagedCheckRuns.mockResolvedValueOnce({
      page: 1,
      limit: 20,
      total: 1,
      items: [
        runItem({
          configSnapshot: { name: '每日检查', plan: { cron: '0 0 6 * * *' }, methods: ['notNull'] },
        }),
      ],
    })

    const res = await listRuns({ monitorId: '1109', page: 1, size: 20 })

    expect(pagedCheckRuns).toHaveBeenCalledWith({
      monitorId: '1109',
      sourceId: undefined,
      state: undefined,
      page: 1,
      limit: 20,
    })
    expect(pagedCheckJobLogs).not.toHaveBeenCalled()
    expect(res.total).toBe(1)

    const run = res.list[0]
    expect(run).toMatchObject({
      id: '9001',
      monitorId: '1109',
      runId: 'run-1',
      monitorName: '字段完整性',
      legacy: false,
      count: '120',
      checkedCount: 120,
      abnormalCount: 2,
      durationMs: 1500,
      exec: 'succeeded',
      data: 'normal',
    })
    expect(run.window).toEqual({
      start: '2026-11-13 00:00:00',
      end: '2026-11-13 01:00:00',
      timezone: 'Asia/Shanghai',
    })
    expect(run.config?.plan?.cron).toBe('0 0 6 * * *')
    expect(run.config?.name).toBe('每日检查')
  })

  it('legacy 行不补默认值：runId/条数/耗时为空，旧日志条数单独放 legacyCount', async () => {
    pagedCheckRuns.mockResolvedValueOnce({
      total: 1,
      limit: 20,
      page: 1,
      items: [
        runItem({
          logId: '77213',
          legacy: true,
          runId: null,
          status: null,
          checkedCount: null,
          abnormalCount: null,
          durationMs: null,
          window: null,
          configSnapshot: null,
          state: 'E',
          message: '2026-11-12 10:00:00---正常, 数量:1240',
        }),
      ],
    })

    const res = await listRuns({ sourceId: 's1' })
    const run = res.list[0]
    expect(run).toMatchObject({ id: '77213', legacy: true, trigger: 'legacy', count: '' })
    expect(run.runId).toBeUndefined()
    expect(run.checkedCount).toBeUndefined()
    expect(run.abnormalCount).toBeUndefined()
    expect(run.durationMs).toBeUndefined()
    expect(run.window).toBeUndefined()
    expect(run.config).toBeUndefined()
    expect(run.data).toBe('abnormal')
    // 条数只用于展示，不参与结构化判定
    expect(run.legacyCount).toBe('1240')
  })

  it('/runs 404 时降级到 paged-logs，两个分支返回同样的 { total, list }', async () => {
    pagedCheckRuns.mockRejectedValueOnce(notFoundError())
    pagedCheckJobLogs.mockResolvedValueOnce({
      total: 1,
      list: [
        {
          logId: '77213',
          createDt: '2026-11-12 10:00:00',
          logMsg: '2026-11-12 10:00:00---正常, 数量:1240',
          name: '字段完整性',
          state: 'C',
          logType: '1',
          tableName: 'sense_data.tb_jjjk',
          sourceId: 's1',
        },
      ],
    })

    const res = await listRuns({ monitorId: '1109', page: 2, size: 20 })

    expect(pagedCheckRuns).toHaveBeenCalledTimes(1)
    expect(pagedCheckJobLogs).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: '1109', page: 2, limit: 20 }),
    )
    expect(res.total).toBe(1)
    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toMatchObject({ id: '77213', legacy: true, count: '1240' })
  })

  it('/runs 信封 success=false（无状态码）和形状不对时同样降级，不当成「没有运行记录」', async () => {
    pagedCheckRuns.mockRejectedValueOnce(new Error('记录不存在'))
    pagedCheckJobLogs.mockResolvedValueOnce({ total: 0, list: [] })
    expect(await listRuns({ monitorId: '1109' })).toEqual({ total: 0, list: [] })
    expect(pagedCheckJobLogs).toHaveBeenCalledTimes(1)

    pagedCheckRuns.mockResolvedValueOnce({ page: 1, limit: 20, total: 0 })
    pagedCheckJobLogs.mockResolvedValueOnce({ total: 0, list: [] })
    await listRuns({ monitorId: '1109' })
    expect(pagedCheckJobLogs).toHaveBeenCalledTimes(2)
  })
})

describe('单次运行详情 getRunDetail（C06 /run/{runId}）', () => {
  beforeEach(() => {
    getCheckRun.mockReset()
  })

  it('按 runId 取详情并映射；旧日志带上 logId 让服务端按日志定位', async () => {
    getCheckRun.mockResolvedValueOnce(runItem())
    const view = await getRunDetail('run-1', { monitorId: '1109' })
    expect(getCheckRun).toHaveBeenCalledWith('run-1', { monitorId: '1109', logId: undefined })
    expect(view).toMatchObject({ id: '9001', runId: 'run-1', checkedCount: 120, durationMs: 1500 })

    getCheckRun.mockResolvedValueOnce(
      runItem({ logId: '77213', legacy: true, runId: null, status: null, checkedCount: null, durationMs: null }),
    )
    const legacy = await getRunDetail('77213', { monitorId: '1109', logId: '77213' })
    expect(getCheckRun).toHaveBeenLastCalledWith('77213', { monitorId: '1109', logId: '77213' })
    expect(legacy?.legacy).toBe(true)
    expect(legacy?.runId).toBeUndefined()
  })

  it('runId 为空不发请求', async () => {
    expect(await getRunDetail('   ')).toBeUndefined()
    expect(getCheckRun).not.toHaveBeenCalled()
  })

  it('404 / 信封失败返回 undefined；非 404 的真实错误与网络异常都向上抛', async () => {
    getCheckRun.mockRejectedValueOnce(notFoundError())
    expect(await getRunDetail('run-x')).toBeUndefined()

    getCheckRun.mockRejectedValueOnce(new Error('记录不存在'))
    expect(await getRunDetail('run-x')).toBeUndefined()

    getCheckRun.mockRejectedValueOnce(notFoundError(500))
    await expect(getRunDetail('run-x')).rejects.toThrow('请求失败 500')

    getCheckRun.mockRejectedValueOnce(offlineError())
    await expect(getRunDetail('run-x')).rejects.toThrow('Failed to fetch')
  })
})

describe('C01 单条读 loadMonitorDetail / loadMonitorRecord', () => {
  beforeEach(() => {
    getSourceCheckDetail.mockReset()
  })

  it('服务端 checkConf 为 null 时回退解析 monitor.checkConf，不回退成空对象', async () => {
    getSourceCheckDetail.mockResolvedValueOnce({
      monitor: monitorRow({ checkConf: '{"kind":"ai","methods":["notNull"],"scopeType":"node_input"}' }),
      checkConf: null,
      scopeType: null,
      revision: 7,
    })

    const detail = await loadMonitorDetail('1109')
    expect(getSourceCheckDetail).toHaveBeenCalledWith('1109')
    expect(detail?.monitor.id).toBe('1109')
    expect(detail?.checkConf).toMatchObject({ kind: 'ai', methods: ['notNull'], scopeType: 'node_input' })
    // 服务端没给 scopeType 时用解析出的 checkConf 兜底，不置 undefined
    expect(detail?.scopeType).toBe('node_input')
    expect(detail?.revision).toBe(7)
  })

  it('服务端已解析 checkConf / scopeType / revision 时原样采用', async () => {
    getSourceCheckDetail.mockResolvedValueOnce({
      monitor: monitorRow(),
      checkConf: { kind: 'rule', cron: '0 0 6 * * *' },
      scopeType: 'source_result',
      revision: 3,
    })
    const detail = await loadMonitorDetail('1109')
    expect(detail?.checkConf).toMatchObject({ kind: 'rule', cron: '0 0 6 * * *' })
    expect(detail?.scopeType).toBe('source_result')
    expect(detail?.revision).toBe(3)
  })

  it('记录不存在返回 undefined（不抛），网络异常抛出', async () => {
    getSourceCheckDetail.mockRejectedValueOnce(notFoundError())
    expect(await loadMonitorDetail('1109')).toBeUndefined()

    getSourceCheckDetail.mockRejectedValueOnce(new Error('记录不存在'))
    expect(await loadMonitorDetail('1109')).toBeUndefined()

    getSourceCheckDetail.mockRejectedValueOnce(offlineError())
    await expect(loadMonitorDetail('1109')).rejects.toThrow('Failed to fetch')

    // client 超时是中文文案 + name=TimeoutError，不能被当成「记录不存在」
    getSourceCheckDetail.mockRejectedValueOnce(
      Object.assign(new Error('请求异常 [source/check/detail]: 请求超时（20 秒）'), {
        cause: Object.assign(new Error('请求超时（20 秒）'), { name: 'TimeoutError' }),
      }),
    )
    await expect(loadMonitorDetail('1109')).rejects.toThrow('请求超时')
  })

  it('loadMonitorRecord 用 detail.monitor 映射规范化记录视图，找不到返回 undefined', async () => {
    getSourceCheckDetail.mockResolvedValueOnce({
      monitor: monitorRow(),
      checkConf: null,
      scopeType: null,
      revision: 1,
    })
    const record = await loadMonitorRecord('1109')
    expect(record?.id).toBe('1109')
    expect(record?.name).toBe('字段完整性')
    expect(record?.kind).toBe('ai')
    expect(record?.conf.methods).toEqual(['notNull'])

    getSourceCheckDetail.mockRejectedValueOnce(notFoundError())
    expect(await loadMonitorRecord('1109')).toBeUndefined()
  })
})

describe('立即运行优先走 C05 POST /run（失败降级按 kind 分流）', () => {
  beforeEach(() => {
    runChecksNow.mockReset()
    runnerRequest.mockReset()
    vi.mocked(handleRunNow).mockReset()
  })

  it('一次带上全部 ids，按 kind/ok 映射执行器/旧调度计数与 runId', async () => {
    runChecksNow.mockResolvedValueOnce({
      accepted: 2,
      failed: 1,
      acceptedAt: '2026-11-13 10:00:00',
      results: [
        { id: 1109, kind: 'ai', ok: true, runId: 'run-1109-1', status: 'QUEUED', message: '已受理' },
        { id: 1110, kind: 'ai', ok: false, runId: null, status: 'SKIPPED', message: '另一实例正在执行' },
        { id: 135, kind: 'rule', ok: true, message: '已提交' },
        { id: 999, kind: 'missing', ok: false, message: '记录不存在' },
      ],
    })

    const result = await runMonitorsNow(['1109', '1110', '135', '999'], { '135': 'rule' })

    expect(runChecksNow).toHaveBeenCalledWith(['1109', '1110', '135', '999'])
    expect(runnerRequest).not.toHaveBeenCalled()
    expect(handleRunNow).not.toHaveBeenCalled()
    expect(result).toEqual({
      viaRunner: 1,
      viaLegacy: 1,
      runnerSkipped: 1,
      runnerRunIds: ['run-1109-1'],
    })
  })

  it('/run 404 时降级回执行器 + 旧 runNow 分流，行为与历史一致', async () => {
    runChecksNow.mockRejectedValueOnce(notFoundError())
    runnerRequest.mockResolvedValue({
      applied: true,
      count: 1,
      items: [{ runId: 'run-1104-x', monitorId: 1104, status: 'NORMAL' }],
    })
    vi.mocked(handleRunNow).mockResolvedValue({ ok: true })

    const result = await runMonitorsNow(['1104', '135'], { '1104': 'ai', '135': 'rule' })

    expect(runChecksNow).toHaveBeenCalledTimes(1)
    expect(runnerRequest).toHaveBeenCalledWith('/monitor-runner/scan', 'POST', {
      apply: true,
      force: true,
      monitorIds: [1104],
    })
    expect(handleRunNow).toHaveBeenCalledWith(['135'])
    expect(result).toMatchObject({ viaRunner: 1, viaLegacy: 1, runnerRunIds: ['run-1104-x'] })
  })

  it.each([405, 501])('/run %i（端点不可用）同样降级', async (status) => {
    runChecksNow.mockRejectedValueOnce(notFoundError(status))
    vi.mocked(handleRunNow).mockResolvedValue({ ok: true })
    const result = await runMonitorsNow(['135'], { '135': 'rule' })
    expect(handleRunNow).toHaveBeenCalledWith(['135'])
    expect(result).toMatchObject({ viaLegacy: 1 })
  })

  it('信封 success:false（无状态码，服务端明确拒绝）降级，保持 217 兼容', async () => {
    runChecksNow.mockRejectedValueOnce(new Error('接口不存在'))
    vi.mocked(handleRunNow).mockResolvedValue({ ok: true })
    await runMonitorsNow(['135'], { '135': 'rule' })
    expect(handleRunNow).toHaveBeenCalledWith(['135'])
  })

  it.each([
    ['断网', () => offlineError()],
    [
      '超时',
      () =>
        Object.assign(new Error('请求异常 [source/check/run]: 请求超时（20 秒）'), {
          cause: Object.assign(new Error('请求超时（20 秒），后端未及时响应，请稍后重试'), { name: 'TimeoutError' }),
        }),
    ],
    ['500', () => notFoundError(500)],
    ['504', () => notFoundError(504)],
  ])('/run %s 时结果未确认：不降级、不重复提交，抛 MonitorRunUncertainError', async (_label, makeError) => {
    const cause = makeError()
    runChecksNow.mockRejectedValueOnce(cause)

    const error = await runMonitorsNow(['1104', '135'], { '1104': 'ai', '135': 'rule' }).catch((err) => err)

    expect(error).toBeInstanceOf(MonitorRunUncertainError)
    expect(error.message).toContain('请先查看运行记录')
    expect(error.cause).toBe(cause)
    expect(runnerRequest).not.toHaveBeenCalled()
    expect(handleRunNow).not.toHaveBeenCalled()
  })

  it.each([401, 403, 400])('/run %i 照原错误抛出，不降级', async (status) => {
    const cause = notFoundError(status)
    runChecksNow.mockRejectedValueOnce(cause)
    await expect(runMonitorsNow(['135'], { '135': 'rule' })).rejects.toBe(cause)
    expect(runnerRequest).not.toHaveBeenCalled()
    expect(handleRunNow).not.toHaveBeenCalled()
  })

  it('回执形状不对（信封被抹平/空 data）也降级，不把「未知」当成全部失败', async () => {
    runChecksNow.mockResolvedValueOnce({ ok: true })
    vi.mocked(handleRunNow).mockResolvedValue({ ok: true })

    const result = await runMonitorsNow(['999'])
    expect(handleRunNow).toHaveBeenCalledWith(['999'])
    expect(result).toMatchObject({ viaRunner: 0, viaLegacy: 1 })
  })
})
