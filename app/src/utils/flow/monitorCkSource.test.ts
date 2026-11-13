import { afterEach, describe, expect, it, vi } from 'vitest'
import { ckSourceApi, entryApi } from '@/api'
import * as monitorApi from '@/api/monitor'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { describeCkSourceConflictRows, MultipleCkSourceRowsError, syncMonitorAlertConfig, syncMonitorCkSource } from './monitorCkSource'

function makeMonitorNode(patch: Partial<NodeConfig> = {}): NodeConfig {
  const node: NodeConfig = {
    title: '库存监控',
    sub: '',
    status: '待配置',
    planned: false,
    template: 'monitor',
    kind: 'node',
    base: [],
    fields: [],
    inmap: [],
    params: [],
    output: [],
    ruleCfg: {
      mode: 'ref',
      scriptPath: '/code01/184.py',
      inputTable: 'sense_data.TB_JD_SKU_BASE',
      describe: '监控库存',
    },
    schedule: { scheduleType: 'daily', scheduleTime: '08:00', weekdays: [], cron: '0 0 8 * * ?' },
    monitorMethods: ['数据延迟监控'],
    alertConfig: {
      enabled: true,
      policies: [{
        name: '数据延迟超过阈值',
        metric: 'delay_minutes',
        operator: 'gt',
        threshold: '30',
        consecutiveCount: 3,
        repeatMinutes: 30,
        recoveryNotify: true,
        enabled: true,
        channelTypes: ['email'],
      }],
      channels: [{ type: 'email', enabled: true, target: 'ops@example.com' }],
    },
  }
  return Object.assign(node, patch)
}

// 每条用例都 spy 同一批 ckSourceApi 方法：不还原的话 mock.calls 会跨用例累积，
// "第 N 次调用"的断言就会读到上一条用例的调用记录。
afterEach(() => vi.restoreAllMocks())

describe('syncMonitorCkSource', () => {
  it('已有记录 update 时保留旧 checkConf 字段，并合入告警配置字段', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      name: '旧监控',
      checkConf: JSON.stringify({
        customKeep: 'keep-me',
        minSize: '1',
        startDt: 'DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
        cond: 'old cond',
        notifyOn: 'success',
        notifyType: 'dingtalk',
      }),
    }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const insert = vi.spyOn(ckSourceApi, 'insert')

    await syncMonitorCkSource('430016501', makeMonitorNode())

    expect(insert).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0]
    expect(payload).toMatchObject({
      sourceId: 430016501,
      name: '库存监控',
      schedule: '0 0 8 * * ?',
      tableName: 'sense_data.TB_JD_SKU_BASE',
    })
    // 2026-11-12 最小保护：update 不再写生命周期字段，画布保存不能重新启用已停用的检查项，
    // 也不能改创建时间/版本号（这几个字段属于监控记录自身，只由监控中心或调度侧维护）。
    expect(payload).not.toHaveProperty('state')
    expect(payload).not.toHaveProperty('isDelete')
    expect(payload).not.toHaveProperty('createDt')
    // 更新走 C01 按主键：带上 id 与当前 ver（乐观锁基线），不再按 sourceId 整包覆盖。
    expect(payload).toMatchObject({ id: 7, ver: 9001 })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.customKeep).toBe('keep-me')
    expect(conf.minSize).toBe('30')
    expect(conf.startDt).toBe('DATE_SUB(CURDATE(), INTERVAL 7 DAY)')
    expect(conf.cond).toContain('数据延迟超过阈值')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
    expect(conf.monitorMethods).toEqual(['数据延迟监控'])
    expect(conf.orchestration).toMatchObject({ scriptPath: '/code01/184.py' })
  })

  it('同源已有多个检查项时拒绝覆盖，不再按 sourceId 整包更新', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, sourceId: 430016501, name: '检查项A', checkConf: '{}' },
      { id: 8, sourceId: 430016501, name: '检查项B', checkConf: '{}' },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck')
    const insert = vi.spyOn(ckSourceApi, 'insert')

    const error = await syncMonitorCkSource('430016501', makeMonitorNode()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MultipleCkSourceRowsError)
    // message 保持旧文案（既有调用方/测试都按这句断言），同时把冲突行带出来给 UI 列清单。
    expect((error as Error).message).toMatch(/已有 2 条检查项/)
    expect((error as MultipleCkSourceRowsError).count).toBe(2)
    expect((error as MultipleCkSourceRowsError).rows.map((row) => row.id)).toEqual([7, 8])
    expect(update).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('无记录 insert 时写入默认 startDt 与告警配置字段', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)

    await syncMonitorCkSource('430016501', makeMonitorNode())

    const payload = insert.mock.calls[0][0]
    expect(payload).toMatchObject({ state: 'E', isDelete: 0, ver: 12 })
    // ISO-8601（后端 LocalDateTime 只认这个；带空格的旧写法会被 400 拒掉）
    expect(String(payload.createDt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.minSize).toBe('30')
    expect(conf.startDt).toBe('DATE_SUB(CURDATE(), INTERVAL 1 DAY)')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
  })

  // 节点配置 Tab 的 cron 框对非「自定义 cron」的策略显示的是**推导值**，store 里不一定有 cron。
  // 保存必须落这个推导值，否则出现「界面显示 0 0 8 * * ?、ck_source.SCHEDULE 是空」。
  it('schedule 按节点配置 Tab 的定时策略推导，不依赖 store 里已存的 cron', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)

    await syncMonitorCkSource('430016501', makeMonitorNode({
      schedule: { scheduleType: '每天', scheduleTime: '08:00', weekdays: [], cron: '' },
    }))

    expect(insert.mock.calls[0][0]).toMatchObject({ schedule: '0 0 8 * * ?' })
  })

  // 节点没配过定时 → 节点配置 Tab 显示的是源上的定时，落库要用同一个值。
  it('节点没配定时时用画布当前源的定时设置', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)

    await syncMonitorCkSource('430016501', makeMonitorNode({ schedule: undefined }), {
      scheduleType: '交易日定时', scheduleTime: '08:30', weekdays: [1, 2, 3, 4, 5], cron: '',
    })

    expect(insert.mock.calls[0][0]).toMatchObject({ schedule: '0 30 8 ? * 1-5' })
  })

  // 一点定时都没配时，节点配置 Tab 那个 cron 框显示的是「每天 0:0」的兜底推导值——
  // 保存按界面口径照写，不再留空（空串等于这条监控不会被排期）。
  it('定时一点没配时 schedule 取节点配置 Tab 的兜底显示值', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)

    await syncMonitorCkSource('430016501', makeMonitorNode({ schedule: undefined, collectCfg: undefined }))

    expect(insert.mock.calls[0][0]).toMatchObject({ schedule: '0 0 0 * * ?' })
  })

  // 流程重新加载后只剩输入表 ID（物理表名不落步骤），表配置 Tab 显示的是那张表，
  // 落库也要拿到它的物理表名，而不是把 ID 写进 TABLE_NAME 或者写空。
  it('只有输入表 ID 时回查表详情取物理表名', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)
    const detail = vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({
      tableId: '2102154', tableName: 'sense_data.TB_JD_SKU_BASE', name: '酒价基础表', fields: [],
    })

    await syncMonitorCkSource('430016501', makeMonitorNode({
      ruleCfg: { mode: 'ref', scriptPath: '/code01/184.py', describe: '', inputTable: '', inputTableId: '2102154' },
    }))

    expect(detail).toHaveBeenCalledWith('2102154')
    expect(insert.mock.calls[0][0]).toMatchObject({ tableName: 'sense_data.TB_JD_SKU_BASE' })
  })

  it('回查表详情失败时 tableName 留空，不抛出去打断保存', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)
    vi.spyOn(entryApi, 'entryDetail').mockRejectedValue(new Error('表详情不可用'))

    await syncMonitorCkSource('430016501', makeMonitorNode({
      ruleCfg: { mode: 'ref', scriptPath: '/code01/184.py', describe: '', inputTable: '', inputTableId: '2102154' },
    }))

    expect(insert.mock.calls[0][0]).toMatchObject({ tableName: '' })
  })
})

// 监控视图「监控配置」Tab 专用通路（2026-09-16）：只有告警面板，节点是从步骤种子拼的骨架，
// 不能用它整包重建 checkConf——监控方法、脚本路径、输入表都是线上真实值，被默认值盖掉就是事故。
describe('syncMonitorAlertConfig', () => {
  it('已有记录只改告警字段，监控方法与编排原样保留', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      name: '库存监控',
      checkConf: JSON.stringify({
        customKeep: 'keep-me',
        minSize: '1',
        startDt: 'DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
        cond: 'old cond',
        notifyOn: 'success',
        notifyType: 'dingtalk',
        monitorMethods: ['当日数据是否正常入库'],
        orchestration: { inputTable: 'sense_data.TB_JD_SKU_BASE', scriptPath: '/code01/real.py' },
      }),
    }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const insert = vi.spyOn(ckSourceApi, 'insert')

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, node.alertConfig)

    expect(insert).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0]
    // 只带 checkConf：name/schedule/tableName 交给节点保存那条通路，这里不碰
    expect(payload).toEqual({
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      checkConf: expect.any(String),
    })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.customKeep).toBe('keep-me')
    expect(conf.minSize).toBe('30')
    expect(conf.cond).toContain('数据延迟超过阈值')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
    // 关键：种子节点里 monitorMethods=['数据延迟监控']、scriptPath='/code01/184.py' 都不许写回去
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库'])
    expect(conf.orchestration.scriptPath).toBe('/code01/real.py')
  })

  it('告警总开关关掉时写 notifyOn=disabled', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 7, ver: 9001, sourceId: 430016501, checkConf: '{}' }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, { ...node.alertConfig!, enabled: false })

    expect(JSON.parse(String(update.mock.calls[0][0].checkConf ?? '{}')).notifyOn).toBe('disabled')
  })

  it('该源还没有 ck_source 行时按节点建行，不静默失败', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, node.alertConfig)

    expect(insert.mock.calls[0][0]).toMatchObject({ sourceId: 430016501, name: '库存监控', state: 'E' })
  })

  it('缺少源 ID 时报错，不写出一条无源记录', async () => {
    const list = vi.spyOn(ckSourceApi, 'list')
    const insert = vi.spyOn(ckSourceApi, 'insert')

    await expect(syncMonitorAlertConfig('  ', makeMonitorNode(), undefined)).rejects.toThrow('缺少源 ID')
    expect(list).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})

// 冲突清单给保存失败提示直接用：用户在画布上要知道「到底是哪几条」，才能去监控中心处理。
describe('describeCkSourceConflictRows', () => {
  const base = { sourceId: 430016501 }

  it('逐条列出名称｜id｜表｜启停｜更新时间', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', tableName: 'sense_data.TB_X', state: 'E', updateDt: '2026-09-18T10:00:00' },
      { ...base, id: 8, name: '检查项B', tableName: 'sense_data.TB_Y', state: 'D', updateDt: '2026-09-19T03:05:09' },
    ])).toEqual([
      '检查项A｜id=7｜表=sense_data.TB_X｜已启用｜更新 2026-09-18 10:00',
      '检查项B｜id=8｜表=sense_data.TB_Y｜已停用｜更新 2026-09-19 03:05',
    ])
  })

  it('name 为空时写「未命名检查项」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '   ', tableName: 'sense_data.TB_X', state: 'E' },
    ])).toEqual(['未命名检查项｜id=7｜表=sense_data.TB_X｜已启用'])
  })

  it('tableName 为空时省略「表=…」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', tableName: '', state: 'E' },
    ])).toEqual(['检查项A｜id=7｜已启用'])
  })

  it('state 非 E（含空值）一律记「已停用」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', state: 'D' },
      { ...base, id: 8, name: '检查项B' },
    ])).toEqual(['检查项A｜id=7｜已停用', '检查项B｜id=8｜已停用'])
  })

  it('updateDt 缺省时省略「更新 …」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', state: 'E', updateDt: '  ' },
    ])).toEqual(['检查项A｜id=7｜已启用'])
  })
})
