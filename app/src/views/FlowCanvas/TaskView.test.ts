// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import TaskView from './TaskView.vue'
import { mockSourceDetail, mockSourceSteps } from '../../api/mock/sources'
import { useFlowStore } from '../../stores/flow'

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/canvas', component: { template: '<div />' } }] })

describe('TaskView', () => {
  it('仅展示当前子源的节点任务，而非网站队列聚合（不再提供所属子源筛选）', async () => {
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
    expect(wrapper.find('[data-testid="task-node-filter"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('列表抓取')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('队列')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('总任务数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('已处理数')
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('queue_81909')
    expect(wrapper.text()).not.toContain('队列聚合')
  })

  it('网站详情页（site-wide）聚合查看全部子源任务，不展示流程节点条', async () => {
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
    expect(wrapper.get('[data-testid="source-task-table"]').text()).toContain('所属子源')
  })
})
