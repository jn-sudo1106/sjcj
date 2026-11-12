// @vitest-environment jsdom
// 1111 全源体检 §0.2：队列缺失/指标不可取得必须显式显示为「未知」，不能当成正常。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import MonitorWatchDrawer from './MonitorWatchDrawer.vue'
import { monitorWatchApi, type MonitorWatchSnapshot } from '../../../api/monitorWatch'

const stubs = { ElDrawer: { name: 'ElDrawer', props: ['modelValue', 'title'], template: '<div class="stub-drawer"><slot /></div>' } }

function snapshot(over: Partial<MonitorWatchSnapshot> = {}): MonitorWatchSnapshot {
  return {
    at: '2026-11-12T06:00:00+00:00',
    graceMinutes: 15,
    queue: {
      reachable: true,
      error: null,
      items: [
        { name: 'q_ok', status: 'ok', reason: '消息 0、消费者 1', messages: 0, unacked: 0, consumers: 1, consumeRate: 0 },
        { name: 'q_missing', status: 'missing', reason: '配置了该队列，但 RabbitMQ 里找不到', messages: 0, unacked: 0, consumers: 0, consumeRate: 0 },
      ],
      summary: { total: 2, problems: 1 },
    },
    monitors: { available: true, graceMinutes: 15, count: 0, items: [] },
    summary: { queueProblems: 1, queueUnobservable: 0, overdueMonitors: 0, healthy: false },
    ...over,
  }
}

function mountDrawer() {
  return mount(MonitorWatchDrawer, { props: { open: true }, global: { plugins: [ElementPlus], stubs } })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MonitorWatchDrawer', () => {
  it('打开时读取最近一次巡检，队列缺失单独标出', async () => {
    vi.spyOn(monitorWatchApi, 'status').mockResolvedValue({
      latest: snapshot(),
      configured: { mq: true, db: true, notify: false },
    })
    const wrapper = mountDrawer()
    await flushPromises()
    expect(wrapper.text()).toContain('队列缺失')
    expect(wrapper.text()).toContain('有异常')
    expect(wrapper.text()).not.toContain('正常 · ')
  })

  it('指标不可取得时显示未知，不显示正常', async () => {
    vi.spyOn(monitorWatchApi, 'status').mockResolvedValue({
      latest: snapshot({
        queue: { reachable: false, error: '连接被拒绝', items: [], summary: { total: 0, problems: 0 } },
        monitors: { available: false, error: '未配置业务数据库', graceMinutes: 15, count: 0, items: [] },
        summary: { queueProblems: 0, queueUnobservable: 1, overdueMonitors: 0, healthy: false },
      }),
      configured: { mq: true, db: false, notify: false },
    })
    const wrapper = mountDrawer()
    await flushPromises()
    expect(wrapper.text()).toContain('未知')
    expect(wrapper.text()).toContain('连接被拒绝')
    expect(wrapper.text()).toContain('未配置业务数据库')
    expect(wrapper.text()).not.toContain('启用的队列都在阈值内')
  })

  it('重新巡检走 scan 并用新结果覆盖', async () => {
    vi.spyOn(monitorWatchApi, 'status').mockResolvedValue({ latest: snapshot(), configured: { mq: true, db: true, notify: false } })
    const scan = vi.spyOn(monitorWatchApi, 'scan').mockResolvedValue(snapshot({
      queue: { reachable: true, error: null, items: [], summary: { total: 0, problems: 0 } },
      summary: { queueProblems: 0, queueUnobservable: 0, overdueMonitors: 0, healthy: true },
    }))
    const wrapper = mountDrawer()
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('重新巡检'))!.trigger('click')
    await flushPromises()
    expect(scan).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('启用的队列都在阈值内')
  })

  it('漏跑不可取得时不允许显示「没有漏跑」', async () => {
    vi.spyOn(monitorWatchApi, 'status').mockResolvedValue({
      latest: snapshot({ monitors: { available: false, error: '漏跑核对失败：超时', graceMinutes: 15, count: 0, items: [] } }),
      configured: { mq: true, db: true, notify: false },
    })
    const wrapper = mountDrawer()
    await flushPromises()
    expect(wrapper.text()).toContain('漏跑核对失败')
    expect(wrapper.text()).not.toContain('没有超过宽限期仍未执行的检查项')
  })
})