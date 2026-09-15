import { describe, expect, it, vi } from 'vitest'
import { ckSourceApi } from '@/api'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { syncMonitorCkSource } from './monitorCkSource'

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
