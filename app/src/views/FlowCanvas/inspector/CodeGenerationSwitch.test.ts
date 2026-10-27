// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CodeGenerationSwitch from './CodeGenerationSwitch.vue'
import { runnerManagementApi } from '@/api/runnerManagement'
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { nodeGenerationSettings: vi.fn(), saveNodeGenerationSettings: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it('开关单独保存，保存失败保留原状态', async () => {
  vi.mocked(runnerManagementApi.nodeGenerationSettings).mockResolvedValue({ configId: '101', enabled: false, generation: null })
  vi.mocked(runnerManagementApi.saveNodeGenerationSettings).mockRejectedValue(new Error('服务不可用'))
  const w = mount(CodeGenerationSwitch, { props: { configId: '101' }, global: { plugins: [ElementPlus] } }); await flushPromises()
  await w.get('[role="switch"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith({ configId: '101', enabled: true })
  expect(w.text()).toContain('未启用')
  expect(w.text()).toContain('服务不可用')
  w.unmount()
})
it('切换配置后忽略旧配置迟到的读取结果', async () => {
  let resolve!: (value: { configId: string; enabled: boolean; generation: null }) => void
  vi.mocked(runnerManagementApi.nodeGenerationSettings).mockImplementation(id => id === '101' ? new Promise(done => { resolve = done }) : Promise.resolve({ configId: id, enabled: false, generation: null }))
  const w = mount(CodeGenerationSwitch, { props: { configId: '101' }, global: { plugins: [ElementPlus] } })
  await w.setProps({ configId: '102' }); await flushPromises()
  resolve({ configId: '101', enabled: true, generation: null }); await flushPromises()
  expect(w.text()).toContain('未启用')
  w.unmount()
})
