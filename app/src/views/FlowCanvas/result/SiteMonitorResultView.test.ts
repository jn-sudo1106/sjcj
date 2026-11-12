// @vitest-environment jsdom
// 运行概览（1111 源内监控视图底部）：最近 5 行正式运行 + 「全部记录」入口。
// 抽屉内部（列表/详情两层）由 fe-runs 的 RunsDrawer 负责，本组件不测抽屉实现。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import { listRuns } from '@/api/monitorCenter'
import SiteMonitorResultView from './SiteMonitorResultView.vue'

vi.mock('@/api/monitorCenter', () => ({ listRuns: vi.fn() }))

const listRunsMock = vi.mocked(listRuns)

function run(over: Partial<MonitorRunView> = {}): MonitorRunView {
  return {
    id: 'r-1',
    monitorId: 'm-1',
    sourceId: 'src-1',
    monitorName: '日增量监控',
    at: '2026-11-11T11:00:46.000Z',
    trigger: 'schedule',
    exec: 'succeeded',
    data: 'normal',
    notify: 'unknown',
    count: '1240',
    deliveries: [],
    legacy: false,
    ...over,
  }
}

function page(list: MonitorRunView[], total = list.length) {
  return { total, list }
}

function mountView(over: { sourceId?: string; title?: string } = {}) {
  return mount(SiteMonitorResultView, {
    props: { sourceId: over.sourceId ?? 'src-1', title: over.title ?? '源一' },
  })
}

beforeEach(() => {
  listRunsMock.mockReset()
  listRunsMock.mockResolvedValue(page([run()]))
})

describe('SiteMonitorResultView · 最近运行', () => {
  it('首次只按当前源取最近 5 行，不查全量', async () => {
    mountView()
    await flushPromises()
    expect(listRunsMock).toHaveBeenCalledWith({ sourceId: 'src-1', page: 1, size: 5 })
  })

  it('渲染 7 列，一行一次正式运行，时间只做格式整理不做时区换算', async () => {
    const wrapper = mountView()
    await flushPromises()

    const head = wrapper.get('[data-testid="site-monitor-recent-runs-table"] thead').text()
    for (const column of ['时间', '检查项', '执行', '数据结论', '实际数值', '通知', '操作']) {
      expect(head).toContain(column)
    }
    expect(wrapper.text()).toContain('最近运行 · 一行一次正式运行（测试/试跑不计入）')
    expect(wrapper.get('[data-testid="site-monitor-recent-run-row"]').text()).toContain('2026-11-11 11:00:46')
    expect(wrapper.text()).toContain('日增量监控')
    expect(wrapper.text()).toContain('成功')
    expect(wrapper.text()).toContain('1240')
  })

  it('旧日志不冒充结构化结论：标「旧日志」，通知写「未取得回执」，条数未知写「—」', async () => {
    listRunsMock.mockResolvedValue(page([run({ legacy: true, count: '', notify: 'unknown' })]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('旧日志')
    expect(wrapper.text()).toContain('未取得回执')
    expect(wrapper.text()).not.toContain('已送达')
    const countCell = wrapper.get('[data-testid="site-monitor-recent-run-row"]').findAll('td')[4]!
    expect(countCell.text()).toBe('—')
  })

  it('执行失败时数据结论显示「待判断」，不显示正常', async () => {
    listRunsMock.mockResolvedValue(page([run({ exec: 'failed', data: 'unknown' })]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('待判断')
    expect(wrapper.text()).not.toContain('数据正常')
  })

  it('无记录时给出空态和加监控引导，不渲染空表', async () => {
    listRunsMock.mockResolvedValue(page([]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.get('[data-testid="site-monitor-recent-runs-empty"]').text()).toContain('该源还没有正式运行记录')
    expect(wrapper.text()).toContain('＋ 加监控')
    expect(wrapper.find('[data-testid="site-monitor-recent-runs-table"]').exists()).toBe(false)
  })

  it('「全部记录」与行上「详情」分别把范围交给容器（sourceId / monitorId）', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.get('[data-testid="site-monitor-all-runs"]').trigger('click')
    expect(wrapper.emitted('all')).toHaveLength(1)

    await wrapper.get('[data-testid="site-monitor-recent-run-detail"]').trigger('click')
    const detail = wrapper.emitted('detail')!
    expect((detail[0]![0] as MonitorRunView).monitorId).toBe('m-1')
  })

  it('加载失败给出错误与重试，重试仍按同一个源查询', async () => {
    listRunsMock.mockRejectedValueOnce(new Error('后端 500'))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.get('[data-testid="site-monitor-recent-runs-error"]').text()).toContain('后端 500')

    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await flushPromises()
    expect(listRunsMock).toHaveBeenLastCalledWith({ sourceId: 'src-1', page: 1, size: 5 })
  })

  it('容器换源时重新查询新源', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.setProps({ sourceId: 'src-2' })
    await flushPromises()
    expect(listRunsMock).toHaveBeenLastCalledWith({ sourceId: 'src-2', page: 1, size: 5 })
  })

  it('暴露 refresh 给容器在保存/启停后刷新最近运行', async () => {
    const wrapper = mountView()
    await flushPromises()

    await (wrapper.vm as unknown as { refresh: () => Promise<void> }).refresh()
    await flushPromises()
    expect(listRunsMock).toHaveBeenCalledTimes(2)
  })
})