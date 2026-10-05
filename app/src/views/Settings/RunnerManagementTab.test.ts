// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { runnerManagementApi, type RunnerInstance } from '@/api/runnerManagement'
import RunnerManagementTab from './RunnerManagementTab.vue'

const instances: RunnerInstance[] = [
  { runnerId: 'r-1', name: '正式', ipAddress: '10.0.0.8', installDirectory: 'D:\\runner-prod', platform: 'windows', capabilities: [], status: 'online', lastHeartbeat: '2026-10-04 12:00', desiredDigest: 'abc', actualDigest: 'abc', assignmentCount: 1 },
  { runnerId: 'r-2', name: '测试', ipAddress: '10.0.0.8', installDirectory: 'D:\\runner-test', platform: 'windows', capabilities: [], status: 'offline', lastHeartbeat: null, desiredDigest: 'def', actualDigest: null, assignmentCount: 0 },
]

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
})

function render() {
  return mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus] } })
}

describe('Runner 实例页面', () => {
  it('同 IP 不同目录分别展示，不把实例按 IP 合并', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = render()
    await flushPromises()
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('runner-prod')
    expect(rows[1]!.text()).toContain('runner-test')
  })

  it('接口不可用时显示真实错误，不使用演示实例', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockRejectedValue(new Error('服务未部署'))
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('服务未部署')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('runner-prod')
  })
})
