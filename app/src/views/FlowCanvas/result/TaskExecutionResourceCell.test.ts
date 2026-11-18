// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { BusinessTaskExecution } from '@/api/runnerManagement'
import TaskExecutionResourceCell from './TaskExecutionResourceCell.vue'

const execution: BusinessTaskExecution = { recordId: 'record173', runnerId: 'runner173', streamId: 'stream173', pid: 20528,
  entry: 'newslink.exe', machine: '192.168.1.173', runnerName: 'DESKTOP-TEST', instanceDirectory: 'D:/Runner2/instance', status: 'completed', time: '', seq: 13, index: 2 }
it('显示实际机器及实例目录，机器链接与日志链接属于同一执行记录，多次执行可展开', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/settings', component: { template: '<div/>' } }] })
  await router.push('/')
  const wrapper = mount(TaskExecutionResourceCell, { props: { taskId: '73864132', state: 'C', items: [execution, { ...execution, recordId: 'record201', runnerId: 'runner201', machine: '192.168.1.201', status: 'failed' }] }, global: { plugins: [router] } })
  expect(wrapper.get('.resource-machine').text()).toBe('192.168.1.173')
  expect(wrapper.get('.resource-machine').attributes('href')).toContain('runnerId=runner173')
  expect(wrapper.text()).toContain('DESKTOP-TEST')
  expect(wrapper.text()).toContain('D:/Runner2/instance')
  const href = wrapper.get('.resource-output').attributes('href')!
  for (const part of ['recordId=record173', 'runnerId=runner173', 'streamId=stream173', 'logSeq=13', 'businessTaskId=73864132']) expect(href).toContain(part)
  expect(wrapper.get('summary').text()).toBe('共 2 次执行')
  expect(wrapper.findAll('article')).toHaveLength(2)
  await wrapper.setProps({ items: [], loading: true })
  expect(wrapper.text()).toBe('读取执行资源…')
  await wrapper.setProps({ loading: false, error: '网络失败' })
  expect(wrapper.text()).toBe('资源查询失败')
  await wrapper.setProps({ error: '' })
  expect(wrapper.text()).toBe('未记录执行资源')
  expect(wrapper.find('a').exists()).toBe(false)
  await wrapper.setProps({ state: 'L' })
  expect(wrapper.text()).toBe('等待执行资源上报')
  wrapper.unmount()
})
