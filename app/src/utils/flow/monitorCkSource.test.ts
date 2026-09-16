import { afterEach, describe, expect, it, vi } from 'vitest'
import { ckSourceApi } from '@/api'
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
    })
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
    expect(payload.state).toBe('E')
    const conf = JSON.parse(payload.checkConf ?? '{}')
    expect(conf.minSize).toBe('30')
    expect(conf.startDt).toBe('DATE_SUB(CURDATE(), INTERVAL 1 DAY)')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
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
