// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import TaskView from './TaskView.vue'
import { mockSourceDetail, mockSourceSteps } from '@/api/mock/sources'
import { sourceApi, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })

describe('TaskView', () => {
  afterEach(() => vi.restoreAllMocks())

  it('仅展示当前源的节点任务，而非网站队列聚合（不再提供所属源筛选）', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(wrapper.find('[data-testid="task-source-filter"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('列表抓取')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('队列')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('总任务数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('已处理数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('queue_81909')
    expect(wrapper.text()).not.toContain('队列聚合')
    wrapper.unmount()
  })

  it('列表里有「运行中」任务时每 10s 自动刷新，全部完成后停；「刷新」按钮手动重拉', async () => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const running: TaskInst[] = [
      { taskId: 't1', state: 'L', typeName: '浏览器抓取', taskName: '进行中', sourceId: source.sourceId, updatedAt: '2026-09-08 09:54' },
    ]
    const done: TaskInst[] = [{ ...running[0], state: 'C' }]
    const paged = vi.spyOn(sourceApi, 'sourceTaskPaged').mockResolvedValue({ total: 1, list: running })

    const wrapper = shallowMount(TaskView, {
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await vi.advanceTimersByTimeAsync(200)
    await flushPromises()
    const initialCalls = paged.mock.calls.length
    expect(wrapper.find('[data-testid="task-auto-refresh"]').exists()).toBe(true)

    // 10s 后自动重拉；这次返回全部完成
    paged.mockResolvedValue({ total: 1, list: done })
    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 1)
    expect(wrapper.find('[data-testid="task-auto-refresh"]').exists()).toBe(false)

    // 全部完成后不再自动拉
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 1)

    // 「刷新」按钮仍可手动重拉
    await wrapper.get('[data-testid="task-refresh"]').trigger('click')
    await flushPromises()
    expect(paged.mock.calls.length).toBe(initialCalls + 2)

    wrapper.unmount()
    vi.useRealTimers()
  })

  it('网站详情页（site-wide）聚合查看全部源任务，不展示流程节点条', async () => {
    setActivePinia(createPinia())
    await router.push('/canvas')
    const source = mockSourceDetail({ sourceId: '391007768' })!
    useFlowStore().loadFromSource(source, mockSourceSteps({ sourceId: source.sourceId }))

    const wrapper = shallowMount(TaskView, {
      props: { siteWide: true },
      global: { plugins: [router], directives: { loading: {} }, stubs: { CanvasHeader: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()

    expect(wrapper.find('[data-testid="task-process-rail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('所属源')
    wrapper.unmount()
  })
})
