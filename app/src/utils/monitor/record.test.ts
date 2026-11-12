import { describe, expect, it } from 'vitest'
import { dataStatusOf, execStatusOf, parseCheckConf, serializeCheckConf, toMonitorRecord, toMonitorRun } from './record'
import type { SourceCheck, SourceCheckLog } from '../../api/types/monitor'

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
})
