// @vitest-environment jsdom
// 通知回执抽屉：异常/失败事件列表 + 投递状态 + 手动重试。
// 契约见后端 runner_management/monitor_events.py：只有 status != NORMAL 才建事件。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import CheckNotificationsDrawer from './CheckNotificationsDrawer.vue'
import type { MonitorNotificationEvent } from '@/api/monitorCenter'

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  retryNotification: vi.fn(),
}))

vi.mock('@/api/monitorCenter', () => ({
  listNotifications: mocks.listNotifications,
  retryNotification: mocks.retryNotification,
}))

// Element Plus 表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

function event(over: Partial<MonitorNotificationEvent> = {}): MonitorNotificationEvent {
  return {
    eventId: 'evt-1104-20261112210408',
    monitorId: 1104,
    sourceId: 's1',
    name: '检查项A',
    runId: 'run-1104-20261112210408',
    status: 'ABNORMAL',
    checkedCount: 10,
    abnormalCount: 2,
    window: { start: '2026-11-12 00:00:00', end: '2026-11-12 23:59:59' },
    reason: '异常数超过阈值',
    createdAt: '2026-11-12 21:04:08',
    delivery: { state: 'failed', attempts: 2, error: null, reason: 'SMTP 550' },
    ...over,
  }
}

// el-drawer 会把内容 teleport 到 body，测试里换成直出容器，等价于「抽屉已打开」
const stubs = { ElDrawer: { name: 'ElDrawer', props: ['modelValue', 'title'], template: '<div class="stub-drawer"><slot /></div>' } }

function mountDrawer() {
  return mount(CheckNotificationsDrawer, { props: { sourceId: 's1' }, global: { plugins: [ElementPlus], stubs } })
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text().trim() === text)
  if (!found) throw new Error(`找不到按钮：${text}`)
  return found
}

beforeEach(() => {
  mocks.listNotifications.mockReset()
  mocks.retryNotification.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('CheckNotificationsDrawer', () => {
  it('渲染事件、结果与投递状态中文，并显示次数与失败原因', async () => {
    mocks.listNotifications.mockResolvedValue({
      count: 2,
      items: [
        event({ eventId: 'evt-1', delivery: { state: 'failed', attempts: 2, reason: 'SMTP 550' } }),
        event({
          eventId: 'evt-2',
          runId: 'run-1104-20261112211000',
          status: 'ERROR',
          reason: '脚本超时',
          delivery: { state: 'not-configured', attempts: 0 },
        }),
      ],
    })
    const wrapper = mountDrawer()
    wrapper.vm.show('s1', '1104', '检查项A')
    await flushPromises()

    expect(mocks.listNotifications).toHaveBeenCalledWith({ monitorId: '1104', limit: 50 })
    expect(wrapper.text()).toContain('异常/失败才会生成通知事件；正常跑完不发通知')

    // 结果映射：ABNORMAL→异常、ERROR→执行失败
    expect(wrapper.text()).toContain('异常')
    expect(wrapper.text()).toContain('执行失败')
    // 投递状态映射 + 第 N 次 + reason/error 副文本
    expect(wrapper.text()).toContain('投递失败')
    expect(wrapper.text()).toContain('未配置通知')
    expect(wrapper.text()).toContain('第 2 次')
    expect(wrapper.text()).toContain('SMTP 550')
    expect(wrapper.text()).toContain('脚本超时')
    expect(wrapper.text()).toContain('10 / 2')
  })

  it('点击重试投递后提示成功并刷新列表', async () => {
    mocks.listNotifications
      .mockResolvedValueOnce({ count: 1, items: [event({ eventId: 'evt-1' })] })
      .mockResolvedValueOnce({ count: 1, items: [event({ eventId: 'evt-1', delivery: { state: 'sent' } })] })
    mocks.retryNotification.mockResolvedValue(event({ eventId: 'evt-1' }))
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)

    const wrapper = mountDrawer()
    wrapper.vm.show('s1', '1104')
    await flushPromises()

    await buttonByText(wrapper, '重试投递').trigger('click')
    await flushPromises()

    expect(mocks.retryNotification).toHaveBeenCalledWith('evt-1')
    expect(success).toHaveBeenCalledWith('已重新投递')
    expect(mocks.listNotifications).toHaveBeenCalledTimes(2)
  })

  it('sent 时按钮禁用、failed 时可用', async () => {
    mocks.listNotifications.mockResolvedValue({
      count: 2,
      items: [
        event({ eventId: 'evt-sent', delivery: { state: 'sent', attempts: 1 } }),
        event({ eventId: 'evt-failed', delivery: { state: 'failed', attempts: 3, error: '连接超时' } }),
      ],
    })
    const wrapper = mountDrawer()
    wrapper.vm.show('s1', '1104')
    await flushPromises()

    const buttons = wrapper.findAll('button').filter((item) => item.text().trim() === '重试投递')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.attributes('disabled')).toBeDefined()
    expect(buttons[1]!.attributes('disabled')).toBeUndefined()
  })

  it('jobId 为空时提示无法查询且不发请求', async () => {
    const wrapper = mountDrawer()
    wrapper.vm.show('s1')
    await flushPromises()

    expect(mocks.listNotifications).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('这条检查还没有 id，无法查询通知回执')
  })

  it('没有事件时显示空态文案', async () => {
    mocks.listNotifications.mockResolvedValue({ count: 0, items: [] })
    const wrapper = mountDrawer()
    wrapper.vm.show('s1', '1104')
    await flushPromises()

    expect(wrapper.text()).toContain('还没有通知回执：只有异常或执行失败才会产生通知事件')
  })
})