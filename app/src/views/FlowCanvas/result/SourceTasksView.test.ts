// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useFlowStore } from '@/stores/flow'
import { mockSourceDetail } from '@/api/mock/sources'
import SourceTasksView from './SourceTasksView.vue'

describe('源任务页', () => {
  it('保留采集任务并按当前源查看智能体任务，切源后更新范围', async () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCtx = mockSourceDetail({ sourceId: '391007768' })!
    const wrapper = shallowMount(SourceTasksView)
    expect(wrapper.findComponent({ name: 'TaskView' }).props('hideHeader')).toBe(true)
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.findComponent({ name: 'CodeGenerationTasks' }).props('sourceScopeId')).toBe('391007768')
    flow.sourceCtx = { ...flow.sourceCtx!, sourceId: '430024910' }
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'CodeGenerationTasks' }).props('sourceScopeId')).toBe('430024910')
    await wrapper.findAll('button')[2]!.trigger('click')
    expect(wrapper.findComponent({ name: 'DeploymentTasks' }).props('sourceScopeId')).toBe('430024910')
    expect(wrapper.findComponent({ name: 'CodeGenerationTasks' }).exists()).toBe(false)
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.findComponent({ name: 'TaskView' }).exists()).toBe(true)
    wrapper.unmount()
  })
})
