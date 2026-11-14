// @vitest-environment jsdom
// 运行详情渲染：JOB_CONF 冻结快照的可读行（检查对象/表/时间口径/窗口/超期/收件人）来自 run.config。
// 这里直接挂详情组件，不经过抽屉列表，目的是把「有快照 / 没快照 / 有值才显示」三种渲染口径钉住。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import { MISSING_TEXT } from './runDetail'
import RunDetailPane from './RunDetailPane.vue'

function run(over: Partial<MonitorRunView> = {}): MonitorRunView {
  return {
    id: 'l1',
    sourceId: 's1',
    monitorName: '每日新闻完整性',
    at: '2026-11-13 01:20:00',
    trigger: 'legacy',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '1240',
    deliveries: [],
    legacy: true,
    ...over,
  }
}

const snapshotConfig: NonNullable<MonitorRunView['config']> = {
  version: 'v3',
  name: '每日新闻完整性',
  scopeType: 'source_result',
  tableName: 'sense_data.tb_jjjk',
  timeColumn: 'create_dt',
  timeType: 'C',
  window: { type: 'hours', hours: 24 },
  overduePolicy: { expectEveryMinutes: 30, graceMinutes: 10 },
  receivers: ['ops@example.com', 'data@example.com'],
}

function textOf(wrapper: ReturnType<typeof mount>, testid: string): string {
  return wrapper.get(`[data-testid="${testid}"]`).text()
}

describe('RunDetailPane · 冻结配置快照新增行', () => {
  it('按快照渲染检查对象/表/入库时间字段/时间口径/覆盖窗口/超期策略/收件人', () => {
    const wrapper = mount(RunDetailPane, { props: { run: run({ config: snapshotConfig }) } })
    expect(textOf(wrapper, 'run-snapshot-scope')).toBe('源结果检查')
    expect(textOf(wrapper, 'run-snapshot-table')).toBe('sense_data.tb_jjjk')
    expect(textOf(wrapper, 'run-snapshot-time-column')).toBe('create_dt')
    expect(textOf(wrapper, 'run-snapshot-time-type')).toBe('创建时间（create_dt）')
    expect(textOf(wrapper, 'run-snapshot-window')).toBe('最近 24 小时')
    expect(textOf(wrapper, 'run-snapshot-overdue')).toBe('每 30 分钟无新增即超期，宽限 10 分钟')
    expect(textOf(wrapper, 'run-snapshot-receivers')).toBe('ops@example.com、data@example.com')
    expect(wrapper.find('[data-testid="run-snapshot-missing"]').exists()).toBe(false)
  })

  it('检查对象缺键时写「未分类（历史记录）」，表/时间/窗口缺失写「未记录」', () => {
    const wrapper = mount(RunDetailPane, { props: { run: run({ config: { version: 'v2' } }) } })
    expect(textOf(wrapper, 'run-snapshot-scope')).toBe('未分类（历史记录）')
    expect(textOf(wrapper, 'run-snapshot-table')).toBe(MISSING_TEXT)
    expect(textOf(wrapper, 'run-snapshot-time-column')).toBe(MISSING_TEXT)
    expect(textOf(wrapper, 'run-snapshot-time-type')).toBe(MISSING_TEXT)
    expect(textOf(wrapper, 'run-snapshot-window')).toBe(MISSING_TEXT)
  })

  it('没有配置超期策略 / 收件人时不出行，避免一整行「未记录」噪音', () => {
    const wrapper = mount(RunDetailPane, { props: { run: run({ config: { version: 'v2' } }) } })
    expect(wrapper.find('[data-testid="run-snapshot-overdue"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="run-snapshot-receivers"]').exists()).toBe(false)
  })

  it('run.config 缺失时整段仍显示「未记录」空态，不出现新增行', () => {
    const wrapper = mount(RunDetailPane, { props: { run: run() } })
    expect(wrapper.find('[data-testid="run-snapshot-missing"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-snapshot-scope"]').exists()).toBe(false)
  })

  it('旧日志但有 JOB_CONF 快照时，横幅不再声称「没有冻结快照」', () => {
    const wrapper = mount(RunDetailPane, { props: { run: run({ config: snapshotConfig }) } })
    const banner = wrapper.get('[data-testid="run-legacy-note"]').text()
    expect(banner).toContain('旧日志，未取得结构化结论')
    expect(banner).toContain('JOB_CONF')
    expect(banner).not.toContain('没有逐项结果与冻结快照')
  })
})