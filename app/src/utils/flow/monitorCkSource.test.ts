import { afterEach, describe, expect, it, vi } from 'vitest'
import { ckSourceApi, entryApi } from '@/api'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { syncMonitorAlertConfig, syncMonitorCkSource } from './monitorCkSource'

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
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)
    const insert = vi.spyOn(ckSourceApi, 'insert')

    await syncMonitorCkSource('430016501', makeMonitorNode())

    expect(insert).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0]
    expect(payload).toMatchObject({
      sourceId: 430016501,
      name: '库存监控',
      schedule: '0 0 8 * * ?',
      tableName: 'sense_data.TB_JD_SKU_BASE',
      // 2026-09-16 口径：update 也要带这几个固定值（不是只有 insert 才带 state）
      state: 'E',
      isDelete: 1,
      ver: 12,
    })
    // ISO-8601（后端 LocalDateTime 只认这个；带空格的旧写法会被 400 拒掉）
    expect(String(payload.createDt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    const conf = JSON.parse(payload.checkConf ?? '{}')
    expect(conf.customKeep).toBe('keep-me')
    expect(conf.minSize).toBe('30')
    expect(conf.startDt).toBe('DATE_SUB(CURDATE(), INTERVAL 7 DAY)')
    expect(conf.cond).toContain('数据延迟超过阈值')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
    expect(conf.monitorMethods).toEqual(['数据延迟监控'])
    expect(conf.orchestration).toMatchObject({ scriptPath: '/code01/184.py' })
  })

  it('无记录 insert 时写入默认 startDt 与告警配置字段', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const insert = vi.spyOn(ckSourceApi, 'insert').mockResolvedValue(1)

    await syncMonitorCkSource('430016501', makeMonitorNode())

    const payload = insert.mock.calls[0][0]
    expect(payload).toMatchObject({ state: 'E', isDelete: 1, ver: 12 })
    // ISO-8601（后端 LocalDateTime 只认这个；带空格的旧写法会被 400 拒掉）
    expect(String(payload.createDt)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    const conf = JSON.parse(payload.checkConf ?? '{}')
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
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)
    const insert = vi.spyOn(ckSourceApi, 'insert')

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, node.alertConfig)

    expect(insert).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0]
    // 只带 checkConf：name/schedule/tableName 交给节点保存那条通路，这里不碰
    expect(payload).toEqual({ sourceId: 430016501, checkConf: expect.any(String) })
    const conf = JSON.parse(payload.checkConf ?? '{}')
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
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 7, sourceId: 430016501, checkConf: '{}' }])
    const update = vi.spyOn(ckSourceApi, 'update').mockResolvedValue(true)

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, { ...node.alertConfig!, enabled: false })

    expect(JSON.parse(update.mock.calls[0][0].checkConf ?? '{}').notifyOn).toBe('disabled')
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
