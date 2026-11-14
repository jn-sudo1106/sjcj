import { describe, expect, it } from 'vitest'
import {
  dataStatusOf,
  execStatusOf,
  parseCheckConf,
  parseRunConfig,
  parseRunRemarks,
  serializeCheckConf,
  toMonitorRecord,
  toMonitorRun,
  toMonitorRunItem,
} from './record'
import type { SourceCheck, SourceCheckLog, SourceCheckRunItem } from '../../api/types/monitor'

function row(over: Partial<SourceCheck> = {}): SourceCheck {
  return {
    id: '9',
    isDelete: 0,
    state: 'C',
    lastMsg: '2026-11-10 08:30:00---正常, 数量: 60',
    name: '每日新闻完整性',
    tableName: 'news_main',
    schedule: '0 30 8 * * *',
    nextRun: '2026-11-11 08:30:00',
    lastRun: '2026-11-10 08:30:00',
    sourceId: 'src-1001',
    checkConf: '{}',
    ...over,
  } as SourceCheck
}

describe('parseCheckConf（非法 JSON 不抛、未知键保留）', () => {
  it('正常 JSON 解析', () => {
    expect(parseCheckConf('{"minSize":0,"checkRule":"x>1"}')).toEqual({ minSize: 0, checkRule: 'x>1' })
  })

  it('非法 JSON / 空值 / 非对象 → 空对象（不能当成「清空配置」再写回去）', () => {
    expect(parseCheckConf('{bad json')).toEqual({})
    expect(parseCheckConf('')).toEqual({})
    expect(parseCheckConf(null)).toEqual({})
    expect(parseCheckConf('[1,2]')).toEqual({})
    expect(parseCheckConf(123)).toEqual({})
  })

  it('未知键原样保留，序列化后能带回去', () => {
    const conf = parseCheckConf('{"minSize":1,"legacyExtra":{"a":1}}')
    expect(conf.legacyExtra).toEqual({ a: 1 })
    expect(JSON.parse(serializeCheckConf(conf))).toMatchObject({ minSize: 1, legacyExtra: { a: 1 } })
  })
})

describe('执行 / 数据状态（执行失败时不给数据结论）', () => {
  it('先判文本里的失败/超时，再判有没有跑过', () => {
    expect(execStatusOf({ lastMsg: '执行失败：连接超时', lastRun: '2026-11-10 08:30:00' })).toBe('timeout')
    expect(execStatusOf({ lastMsg: '执行失败：SQL 报错', lastRun: '2026-11-10 08:30:00' })).toBe('failed')
    expect(execStatusOf({ lastMsg: '', lastRun: '' })).toBe('none')
    expect(execStatusOf({ lastMsg: '正常', lastRun: '2026-11-10 08:30:00' })).toBe('succeeded')
  })

  it('执行没成功 → 数据结论 unknown（不能把 E 直接当数据异常）', () => {
    expect(dataStatusOf('failed', 'E')).toBe('unknown')
    expect(dataStatusOf('timeout', 'C')).toBe('unknown')
    expect(dataStatusOf('succeeded', 'E')).toBe('abnormal')
    expect(dataStatusOf('succeeded', 'C')).toBe('normal')
    expect(dataStatusOf('succeeded', 'X')).toBe('unknown')
  })
})

describe('toMonitorRecord', () => {
  it('isDelete 语义是反的：0 才是在用', () => {
    expect(toMonitorRecord(row({ isDelete: 0 })).enabled).toBe(true)
    expect(toMonitorRecord(row({ isDelete: 1 })).enabled).toBe(false)
  })

  it('旧记录默认规则检查、已生效；AI 只有描述没有脚本 = 草稿', () => {
    expect(toMonitorRecord(row()).kind).toBe('rule')
    expect(toMonitorRecord(row()).publishStatus).toBe('ready')
    const aiDraft = toMonitorRecord(row({ checkConf: '{"kind":"ai","desc":"检查标题"}' }))
    expect(aiDraft.kind).toBe('ai')
    expect(aiDraft.publishStatus).toBe('draft')
    const aiReady = toMonitorRecord(row({ checkConf: '{"kind":"ai","script":"print(1)","version":"v3"}' }))
    expect(aiReady.publishStatus).toBe('ready')
    expect(aiReady.effectiveVersion).toBe('v3')
  })

  it('停用的记录不给数据结论（避免「已停用」和「数据正常」同时出现）', () => {
    const view = toMonitorRecord(row({ isDelete: 1, state: 'C' }))
    expect(view.data).toBe('unknown')
  })

  it('条数未知是空串，不是 0', () => {
    expect(toMonitorRecord(row({ lastMsg: '正常' })).count).toBe('')
    expect(toMonitorRecord(row({ lastMsg: '正常, 数量: 0' })).count).toBe('0')
  })

  it('旧接口没有投递回执 → notify=unknown', () => {
    expect(toMonitorRecord(row()).notify).toBe('unknown')
  })

  it('未执行不能凭默认 C 状态展示数据正常', () => {
    expect(toMonitorRecord(row({ lastRun: '', lastMsg: '' })).data).toBe('unknown')
  })

  it('仅返回脚本路径的 AI 记录与旧编排路径保持可执行状态', () => {
    for (const conf of [
      { kind: 'ai', scriptPath: '/code/check.py' },
      { orchestration: { scriptPath: '/code/legacy.py' } },
    ]) {
      const record = toMonitorRecord(row({ checkConf: JSON.stringify(conf) }))
      expect(record.kind).toBe('ai')
      expect(record.publishStatus).toBe('ready')
    }
    expect(toMonitorRecord(row({ checkConf: '{"kind":"ai","script":"  "}' })).publishStatus).toBe('draft')
  })
})

describe('toMonitorRun', () => {
  const log: SourceCheckLog = {
    logId: '1001',
    createDt: '2026-11-10 08:30:00',
    logMsg: '执行失败：脚本异常',
    name: '每日新闻完整性',
    state: 'E',
    logType: 'check',
    tableName: 'news_main',
    sourceId: 'src-1001',
  }

  it('旧日志标 legacy，执行失败不产出数据异常结论', () => {
    const run = toMonitorRun(log)
    expect(run.legacy).toBe(true)
    expect(run.exec).toBe('failed')
    expect(run.data).toBe('unknown')
    expect(run.notify).toBe('unknown')
  })

  it('带结构化 REMARKS 时读检查数/异常数/runId/窗口，不再从中文里抠数字', () => {
    const remarks = JSON.stringify({
      runId: 'run-1104-20261112164840',
      status: 'ABNORMAL',
      checkedCount: 7,
      abnormalCount: 2,
      durationMs: 311,
      window: { start: '2026-11-12 00:00:00', end: '2026-11-12 16:48:40' },
      reason: '异常数超过阈值',
      scriptPath: '/code01/x.py',
    })
    const run = toMonitorRun({ ...log, remarks })
    expect(run.legacy).toBe(false)
    expect(run.checkedCount).toBe(7)
    expect(run.abnormalCount).toBe(2)
    expect(run.runId).toBe('run-1104-20261112164840')
    expect(run.count).toBe('7')
    expect(run.window).toEqual({ start: '2026-11-12 00:00:00', end: '2026-11-12 16:48:40' })
    expect(run.summary).toBe('异常数超过阈值')
    // 运行记录抽屉的「耗时」「原因」列直接读这两个字段，不能只留在 summary 里
    expect(run.durationMs).toBe(311)
    expect(run.reason).toBe('异常数超过阈值')
  })

  it('REMARKS 非法或只有部分字段时按未知处理，不补 0', () => {
    expect(parseRunRemarks('not json')).toEqual({})
    expect(parseRunRemarks('[]')).toEqual({})
    expect(parseRunRemarks('{"checkedCount":"abc"}').checkedCount).toBeUndefined()
    const run = toMonitorRun({ ...log, remarks: '{"runId":"run-1"}' })
    expect(run.legacy).toBe(true)
    expect(run.checkedCount).toBeUndefined()
  })
})

describe('parseRunConfig（JOB_CONF 冻结快照）', () => {
  const conf = {
    kind: 'ai',
    version: 'v3',
    digest: 'sha256:abc',
    name: '每日新闻完整性',
    desc: '检查标题字段完整',
    methods: ['null', 'dup'],
    plan: { cron: '0 30 8 * * *', text: '每天 08:30' },
    notifyOn: 'error',
    channels: ['mail', 'webhook'],
    receivers: ['a@example.com', ' b@example.com '],
    nullPolicy: 'abnormal',
    noDataPolicy: 'no_data',
    script: 'print(1)',
    scopeType: 'node_input',
    tableName: 'news_main',
    timeColumn: 'create_dt',
    timeType: 'C',
    window: { type: 'hours', hours: 24 },
    overduePolicy: { expectEveryMinutes: 30, graceMinutes: 10 },
    // 执行器回写的计划状态不属于配置快照，不映射
    schedule: { last: '2026-11-13 01:00:00', next: '2026-11-13 01:30:00' },
  }

  it('把快照映射成 MonitorRunConfig，未知键与执行器回写状态不混进来', () => {
    expect(parseRunConfig(JSON.stringify(conf))).toEqual({
      version: 'v3',
      digest: 'sha256:abc',
      name: '每日新闻完整性',
      desc: '检查标题字段完整',
      methods: ['null', 'dup'],
      plan: { cron: '0 30 8 * * *', text: '每天 08:30' },
      notifyOn: 'error',
      channels: ['mail', 'webhook'],
      receivers: ['a@example.com', 'b@example.com'],
      nullPolicy: 'abnormal',
      noDataPolicy: 'no_data',
      script: 'print(1)',
      scopeType: 'node_input',
      tableName: 'news_main',
      timeColumn: 'create_dt',
      timeType: 'C',
      window: { type: 'hours', hours: 24 },
      overduePolicy: { expectEveryMinutes: 30, graceMinutes: 10 },
    })
  })

  it('顶层 cron（保存时写进 conf）也能还原成执行计划', () => {
    const config = parseRunConfig(JSON.stringify({ version: 'v2', cron: '0 0 8 * * *' }))
    expect(config?.plan?.cron).toBe('0 0 8 * * *')
    expect(config?.version).toBe('v2')
  })

  it('历史超期写法（overdue / 顶层周期）同样能读，宽限 0 是有效值', () => {
    expect(parseRunConfig(JSON.stringify({ overdue: { expectEveryMinutes: 15, graceMinutes: 0 } }))?.overduePolicy).toEqual({
      expectEveryMinutes: 15,
      graceMinutes: 0,
    })
    expect(parseRunConfig(JSON.stringify({ expectEveryMinutes: '60' }))?.overduePolicy).toEqual({
      expectEveryMinutes: 60,
      graceMinutes: undefined,
    })
  })

  it('scopeType 只认两个合法值；未知值不猜测', () => {
    expect(parseRunConfig(JSON.stringify({ scopeType: 'source_result' }))?.scopeType).toBe('source_result')
    expect(parseRunConfig(JSON.stringify({ scopeType: 'other' }))).toBeUndefined()
  })

  it('坏 JSON / 空串 / 非对象 / 空对象 → undefined，绝不 throw', () => {
    expect(parseRunConfig('')).toBeUndefined()
    expect(parseRunConfig('   ')).toBeUndefined()
    expect(parseRunConfig('not json')).toBeUndefined()
    // Java saveLog 会在 999 字符处截断，快照可能是半截 JSON
    expect(parseRunConfig('{"version":"v3","desc":"检查')).toBeUndefined()
    expect(parseRunConfig('[]')).toBeUndefined()
    expect(parseRunConfig('123')).toBeUndefined()
    expect(parseRunConfig('null')).toBeUndefined()
    expect(parseRunConfig('{}')).toBeUndefined()
    expect(parseRunConfig(null)).toBeUndefined()
    expect(parseRunConfig(undefined)).toBeUndefined()
  })

  it('新接口 configSnapshot 已是对象：对象输入同样可解析（不要求 JSON 串）', () => {
    expect(parseRunConfig({ version: 'v3', plan: { cron: '0 0 6 * * *' } })).toEqual({
      version: 'v3',
      plan: { cron: '0 0 6 * * *' },
    })
    // 对象也可以是坏形状：数组 / 空对象 / 非对象标量仍然 undefined
    expect(parseRunConfig({})).toBeUndefined()
    expect(parseRunConfig([])).toBeUndefined()
    expect(parseRunConfig(123)).toBeUndefined()
    expect(parseRunConfig({ window: { type: 'hours', hours: 2 } })).toEqual({ window: { type: 'hours', hours: 2 } })
  })

  it('字段类型不对时跳过该字段，但同快照里的其它字段仍然可用', () => {
    const config = parseRunConfig(
      JSON.stringify({
        version: 3,
        methods: ['null', 123, ''],
        receivers: 'a@example.com',
        window: { type: 'hours', hours: -1 },
        tableName: 'news_main',
      }),
    )
    expect(config).toEqual({ methods: ['null'], tableName: 'news_main', window: { type: 'hours' } })
  })
})

describe('toMonitorRun 读取 jobConf 快照', () => {
  const log: SourceCheckLog = {
    logId: '1001',
    createDt: '2026-11-10 08:30:00',
    logMsg: '检查完成',
    name: '每日新闻完整性',
    state: 'C',
    logType: 'check',
    tableName: 'news_main',
    sourceId: 'src-1001',
  }

  it('有 jobConf 时填 config（规则检查的旧日志也能展示冻结快照）', () => {
    const run = toMonitorRun({ ...log, jobConf: '{"version":"v3","tableName":"news_main"}' })
    expect(run.config).toEqual({ version: 'v3', tableName: 'news_main' })
  })

  it('没有 jobConf 或快照不可解析时 config 缺失，页面继续「未记录」', () => {
    expect(toMonitorRun(log).config).toBeUndefined()
    expect(toMonitorRun({ ...log, jobConf: '' }).config).toBeUndefined()
    expect(toMonitorRun({ ...log, jobConf: '{"version":' }).config).toBeUndefined()
  })
})

describe('toMonitorRunItem（C06 /runs 结构化运行行）', () => {
  function item(over: Partial<SourceCheckRunItem> = {}): SourceCheckRunItem {
    return {
      logId: 77213,
      monitorId: 1109,
      sourceId: '390000019',
      name: '字段完整性',
      tableName: 'sense_data.tb_jjjk',
      state: 'C',
      logDt: '2026-11-13 06:00:00',
      createDt: '2026-11-13 06:00:05',
      message: '正常, 数量:120',
      legacy: false,
      runId: 'run-1109-20261113060000',
      status: 'NORMAL',
      checkedCount: 120,
      abnormalCount: 0,
      durationMs: 1500,
      window: { start: '2026-11-13 00:00:00', end: '2026-11-13 01:00:00', timezone: 'Asia/Shanghai' },
      reason: null,
      scriptPath: null,
      overdue: false,
      configSnapshot: { version: 'v3', plan: { cron: '0 0 6 * * *' } },
      ...over,
    }
  }

  it('结构化行：条数/耗时/窗口/快照/runId 直接取服务端字段，count 只放 checkedCount', () => {
    const run = toMonitorRunItem(item())
    expect(run).toMatchObject({
      id: '77213',
      runId: 'run-1109-20261113060000',
      monitorName: '字段完整性',
      trigger: 'unknown',
      exec: 'succeeded',
      data: 'normal',
      count: '120',
      checkedCount: 120,
      abnormalCount: 0,
      durationMs: 1500,
      legacy: false,
    })
    expect(run.window).toEqual({
      start: '2026-11-13 00:00:00',
      end: '2026-11-13 01:00:00',
      timezone: 'Asia/Shanghai',
    })
    expect(run.config).toEqual({ version: 'v3', plan: { cron: '0 0 6 * * *' } })
    expect(run.legacyCount).toBeUndefined()
  })

  it('legacy 行不补默认值：runId/条数/耗时/窗口/快照全部缺省，旧日志条数只放 legacyCount', () => {
    const run = toMonitorRunItem(
      item({
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
    )
    expect(run.legacy).toBe(true)
    expect(run.trigger).toBe('legacy')
    expect(run.runId).toBeUndefined()
    expect(run.checkedCount).toBeUndefined()
    expect(run.abnormalCount).toBeUndefined()
    expect(run.durationMs).toBeUndefined()
    expect(run.window).toBeUndefined()
    expect(run.config).toBeUndefined()
    expect(run.count).toBe('')
    expect(run.legacyCount).toBe('1240')
    // state=E 是「查出异常」，执行本身成功（与旧日志口径一致）
    expect(run.exec).toBe('succeeded')
    expect(run.data).toBe('abnormal')
  })

  it('状态映射：ERROR→失败、TIMEOUT→超时、SKIPPED→unknown、未知状态不猜成功', () => {
    expect(toMonitorRunItem(item({ status: 'ERROR', state: 'E' })).exec).toBe('failed')
    expect(toMonitorRunItem(item({ status: 'TIMEOUT' })).exec).toBe('timeout')
    expect(toMonitorRunItem(item({ status: 'CANCELLED' })).exec).toBe('cancelled')
    expect(toMonitorRunItem(item({ status: 'SKIPPED' })).exec).toBe('unknown')
    // 未知 status 但 ck_source.state=C 表示「已经跑过」，按完成处理（不猜数据结论）
    expect(toMonitorRunItem(item({ status: 'WHATEVER' })).exec).toBe('succeeded')
    expect(toMonitorRunItem(item({ status: null, state: null, message: '' })).exec).toBe('unknown')
    // 执行失败时不给数据结论（沿用 dataStatusOf 口径）
    expect(toMonitorRunItem(item({ status: 'ERROR', state: 'C' })).data).toBe('unknown')
  })

  it('窗口/快照形状不完整时缺省，不用空对象伪装「已记录」', () => {
    expect(toMonitorRunItem(item({ window: {} })).window).toBeUndefined()
    expect(toMonitorRunItem(item({ window: null })).window).toBeUndefined()
    expect(toMonitorRunItem(item({ configSnapshot: {} })).config).toBeUndefined()
    // logId 为 null 时用 runId 当行主键，不丢行
    expect(toMonitorRunItem(item({ logId: null })).id).toBe('run-1109-20261113060000')
  })
})
