// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { runnerManagementApi } from '@/api/runnerManagement'
import TaskExecutionLinks from './TaskExecutionLinks.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { businessTaskExecutions: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it('uses the actual execution machine and exact stream/sequence, without deployment inference', async () => {
  vi.mocked(runnerManagementApi.businessTaskExecutions).mockResolvedValue({ taskId: '123', truncated: false, items: [{
    recordId: 'a'.repeat(32), runnerId: 'runner201', streamId: 'b'.repeat(32), pid: 26032, entry: 'newslink.py',
    machine: '192.168.1.201', instanceDirectory: 'D:/Runner2', status: 'completed', time: '', seq: 3, index: 1,
  }] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings', component: { template: '<div />' } }] })
  await router.push('/')
  const wrapper = mount(TaskExecutionLinks, { props: { taskId: '123', topic: 'news' }, global: { plugins: [router] } })
  await flushPromises()
  expect(wrapper.text()).toContain('192.168.1.201 · PID 26032 · 采集完成')
  const href = wrapper.get('a').attributes('href')
  expect(href).toContain('streamId=' + 'b'.repeat(32)); expect(href).toContain('logSeq=3'); expect(href).toContain('businessTaskId=123')
  vi.mocked(runnerManagementApi.businessTaskExecutions).mockResolvedValue({ taskId: '456', items: [], truncated: false })
  await wrapper.setProps({ taskId: '456' }); await flushPromises()
  expect(wrapper.find('a').exists()).toBe(false); expect(wrapper.text()).toContain('暂无匹配任务输出')
  wrapper.unmount()
})
