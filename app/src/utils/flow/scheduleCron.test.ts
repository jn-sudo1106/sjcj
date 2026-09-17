import { describe, expect, it } from 'vitest'
import { cronForSchedule, mergeScheduleSettings, nodeScheduleCron, scheduleCronOf } from './scheduleCron'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

// 这一份口径同时决定两件事，所以单独锁一遍（组件侧行为由 TaskScheduleSettings.test.ts 覆盖）：
// ① 节点配置 Tab「cron 表达式」框里显示什么；② 保存时落 ck_source.SCHEDULE 的值。
describe('scheduleCron', () => {
  it('按策略推导 Quartz cron（策略缺省当每天、时间缺省当 0:0）', () => {
    expect(cronForSchedule({ scheduleType: '每天', scheduleTime: '08:00' })).toBe('0 0 8 * * ?')
    expect(cronForSchedule({ scheduleType: '每小时', scheduleTime: '08:30' })).toBe('0 30 * * * ?')
    expect(cronForSchedule({ scheduleType: '每5分钟一次', scheduleTime: '08:30' })).toBe('0 */5 * * * ?')
    expect(cronForSchedule({ scheduleType: '每周', scheduleTime: '10:05', weekdays: [1, 3] })).toBe('0 5 10 ? * 1,3')
    expect(cronForSchedule({ scheduleType: '交易日定时', scheduleTime: '08:30' })).toBe('0 30 8 ? * 1-5')
    expect(cronForSchedule({ scheduleTime: '08:00' })).toBe('0 0 8 * * ?')
    expect(cronForSchedule({ scheduleType: '每天', scheduleTime: '25:99' })).toBe('0 0 0 * * ?') // 越界时间回落到 0:0
  })

  it('自定义 cron 原样返回用户手填表达式', () => {
    expect(cronForSchedule({ scheduleType: '自定义 cron', cron: '0 0 6-22 * * ?' })).toBe('0 0 6-22 * * ?')
    expect(scheduleCronOf({ scheduleType: '自定义 cron', cron: '0 0 6-22 * * ?' })).toBe('0 0 6-22 * * ?')
  })

  it('非自定义策略以推导值为准（界面就是显示这个推导值）', () => {
    // 存着旧 cron、时间改过但 cron 没跟上：以界面显示的推导值为准，避免"显示的和落库的不是一个"
    expect(scheduleCronOf({ scheduleType: '每天', scheduleTime: '09:00', cron: '0 0 8 * * ?' })).toBe('0 0 9 * * ?')
    // 只有策略/时间、cron 为空：推导出值（原来直接读 cron 会拿到空串）
    expect(scheduleCronOf({ scheduleType: '每天', scheduleTime: '08:00', cron: '' })).toBe('0 0 8 * * ?')
  })

  it('没选过策略时保留老数据里的 cron，不用「每天 0:0」覆盖它', () => {
    expect(scheduleCronOf({ cron: '0 0 12 * * *' })).toBe('0 0 12 * * *')
  })

  // 一点定时都没配时，界面上那个框显示的是「每天 0:0」的兜底推导值，保存照写——
  // 调度侧要求 SCHEDULE 非空（写空串这条监控不会被排期），界面上看到的就该落库。
  it('一点定时都没配时取界面兜底值 0 0 0 * * ?，不再留空', () => {
    expect(scheduleCronOf(undefined)).toBe('0 0 0 * * ?')
    expect(scheduleCronOf({})).toBe('0 0 0 * * ?')
    expect(scheduleCronOf({ scheduleType: '', scheduleTime: '', cron: '' })).toBe('0 0 0 * * ?')
  })
})

function node(patch: Partial<NodeConfig> = {}): NodeConfig {
  return { title: 'n', sub: '', status: '', planned: false, template: 'monitor', kind: 'node', base: [], fields: [], inmap: [], params: [], output: [], ...patch }
}

describe('mergeScheduleSettings / nodeScheduleCron', () => {
  it('节点 → collectCfg → 源 逐字段取第一个有值的', () => {
    const merged = mergeScheduleSettings(
      node({
        schedule: { scheduleType: '每天' },
        collectCfg: { scheduleTime: '09:30' } as NodeConfig['collectCfg'],
      }),
      { scheduleType: '交易日定时', scheduleTime: '08:30', weekdays: [1, 2, 3, 4, 5], cron: '0 30 8 ? * 1-5' },
    )

    expect(merged).toEqual({
      scheduleType: '每天',
      scheduleTime: '09:30',
      weekdays: [1, 2, 3, 4, 5],
      cron: '0 30 8 ? * 1-5',
    })
  })

  it('节点没配定时时用源上的定时（节点配置 Tab 显示的就是源的值）', () => {
    expect(nodeScheduleCron(node(), { scheduleType: '每天', scheduleTime: '07:00' })).toBe('0 0 7 * * ?')
  })

  it('节点与源都没配时用界面兜底值', () => {
    expect(nodeScheduleCron(node(), null)).toBe('0 0 0 * * ?')
    expect(nodeScheduleCron(undefined, undefined)).toBe('0 0 0 * * ?')
  })
})
