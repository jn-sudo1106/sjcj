// @vitest-environment jsdom
// MQ 队列页（旧 page/inst/MqList.vue → mqList/index.vue）接线回归。
// 与 Monitor/queueCheck 的测试同一套思路：只验「每个操作调到了哪条接口、带了什么参数」——
// 这一屏的坑全在接线上：查询参数名（flag/cond/state）、获取多条与删除一条的 requeue 真假、
// 清空的 key 是不是当前小时数。样式和布局不在测试范围内。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import MqListPage from './index.vue'
import type { MqQueue } from '../../../api/mq'

// Element Plus 的表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

// hoisted：vi.mock 的工厂会在 import 阶段执行，普通 const 那时还在 TDZ 里
const api = vi.hoisted(() => ({
  listQueues: vi.fn(),
  purgeQueue: vi.fn(),
  fetchMessage: vi.fn(),
  queueConsumers: vi.fn(),
}))
vi.mock('@/api/mq', () => api)

// 三个弹窗只验「打开时传了什么」，内部实现另有归属，这里全部打成桩。
// ⚠️ 桩必须 expose open()：页面里是 `ref.value?.open(...)`，可选链只兜 value 为空，
// 兜不住「value 在、open 不在」——那样会直接 TypeError。
const dialogOpen = vi.hoisted(() => ({ message: vi.fn(), consumer: vi.fn(), check: vi.fn() }))
vi.mock('./MessageDialog.vue', () => ({
  default: {
    name: 'MessageDialog',
    setup(_props: unknown, { expose }: { expose: (v: Record<string, unknown>) => void }) {
      expose({ open: dialogOpen.message })
      return () => null
    },
  },
}))
vi.mock('./ConsumerDialog.vue', () => ({
  default: {
    name: 'ConsumerDialog',
    setup(_props: unknown, { expose }: { expose: (v: Record<string, unknown>) => void }) {
      expose({ open: dialogOpen.consumer })
      return () => null
    },
  },
}))
vi.mock('./QueueCheckDialog.vue', () => ({
  default: {
    name: 'QueueCheckDialog',
    setup(_props: unknown, { expose }: { expose: (v: Record<string, unknown>) => void }) {
      expose({ open: dialogOpen.check })
      return () => null
    },
  },
}))

const ROWS: MqQueue[] = [
  {
    vhost: '/',
    name: 'source-config-dispatch',
    messages_ready: 12,
    messages_unacknowledged: 1,
    messages: 13,
    consumers: 3,
    notifyState: 'E',
    notifyCount: 2,
    message_stats: { publish_details: { rate: 1.5 } },
  },
  { vhost: '/', name: 'ocr-task', messages_ready: 0, messages: 0, consumers: 1, notifyState: 'C', notifyCount: 0 },
]

function mountPage() {
  return mount(MqListPage, { global: { plugins: [ElementPlus] } })
}

beforeEach(() => {
  api.listQueues.mockReset().mockResolvedValue(ROWS)
  api.purgeQueue.mockReset().mockResolvedValue({ ok: true, message: '操作成功' })
  dialogOpen.message.mockReset()
  dialogOpen.consumer.mockReset()
  dialogOpen.check.mockReset()
})

describe('MQ 队列页', () => {
  it('首屏按旧口径拉队列：flag=on / cond 空 / state 空', async () => {
    const wrapper = mountPage()
    await flushPromises()
    expect(api.listQueues).toHaveBeenCalledTimes(1)
    expect(api.listQueues).toHaveBeenCalledWith({ flag: 'on', cond: '', state: '' })
    expect(wrapper.text()).toContain('source-config-dispatch')
    expect(wrapper.text()).toContain('共 2 条')
  })

  it('「不限」哨兵在发请求前还原成空串', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const selects = wrapper.findAllComponents({ name: 'ElSelect' })
    // 第一个下拉 = 队列范围（不限 / 非0队列），第二个 = 告警状态
    selects[0]?.vm.$emit('update:modelValue', 'all')
    selects[1]?.vm.$emit('update:modelValue', 'E')
    const inputs = wrapper.findAll('input')
    await inputs[1]?.setValue(' ocr ')
    await wrapper.find('button.el-button--primary').trigger('click')
    await flushPromises()
    expect(api.listQueues).toHaveBeenLastCalledWith({ flag: '', cond: 'ocr', state: 'E' })
  })

  it('行内「获取多条 / 删除一条」按 requeue 真假打开消息弹窗', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const links = wrapper.findAll('a.mq-link')
    // 每行三个链接：获取多条 / 删除一条 / 清空
    await links[0]!.trigger('click')
    expect(dialogOpen.message).toHaveBeenLastCalledWith({
      queue: 'source-config-dispatch',
      count: 1,
      requeue: true,
    })
    await links[1]!.trigger('click')
    expect(dialogOpen.message).toHaveBeenLastCalledWith({
      queue: 'source-config-dispatch',
      count: 1,
      requeue: false,
    })
  })

  it('消费者 / 告警规则点开对应弹窗，带上当前队列名', async () => {
    const wrapper = mountPage()
    await flushPromises()
    const tags = wrapper.findAll('.mq-tag-click')
    await tags[0]!.trigger('click') // 第一行「消费者」tag
    expect(dialogOpen.consumer).toHaveBeenLastCalledWith('source-config-dispatch')
    await tags[1]!.trigger('click') // 第一行「告警规则」tag
    expect(dialogOpen.check).toHaveBeenLastCalledWith('source-config-dispatch')
  })

  it('清空队列：确认后按 key=当前小时数提交', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mountPage()
    await flushPromises()
    await wrapper.findAll('a.mq-link')[2]!.trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(api.purgeQueue).toHaveBeenCalledWith({
      queue: 'source-config-dispatch',
      key: new Date().getHours(),
    })
    confirm.mockRestore()
  })
})
