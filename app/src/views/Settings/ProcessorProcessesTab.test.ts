// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type ProcessorProcess, type RunnerInstance } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import ProcessorProcessesTab from './ProcessorProcessesTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { processorProcesses: vi.fn(), stopProcessorProcess: vi.fn() } }))
const machines: RunnerInstance[] = ['one', 'two'].map((id, index) => ({ runnerId: id, name: '同一台机器', ipAddress: '10.0.0.8', installDirectory: `E:\\runner${index}`, platform: 'win32', status: 'online', capabilities: ['process-control'], desiredDigest: null, actualDigest: 'source-local', lastHeartbeat: '2026-10-12T20:00:00+08:00', assignmentCount: 1, workerProcesses: [] }))
const processes: ProcessorProcess[] = machines.map((row, index) => ({ runnerId: row.runnerId, assignmentId: `a${index}`, slot: 0, pid: 100 + index, queue: 'news', entry: `E:\\runner${index}\\main.py`, workingDirectory: `E:\\runner${index}`, generation: 'v1:start1', runtimeId: 'binding1', runId: `run${index}`, stopStatus: '', stopError: '' }))
beforeEach(() => {
  vi.mocked(runnerManagementApi.processorProcesses).mockResolvedValue({ runners: structuredClone(machines), items: structuredClone(processes) })
  vi.mocked(runnerManagementApi.stopProcessorProcess).mockResolvedValue({ requestId: 'request1', status: 'pending', pid: 100, slot: 0, error: '' })
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks() })
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push('/settings?tab=processors'); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = ['admin']
  const wrapper = mount(ProcessorProcessesTab, { global: { plugins: [ElementPlus, pinia, router] } }); await flushPromises()
  return { wrapper, router }
}
it('同 IP 的独立目录实例可筛选，进程搜索与日志跳转对应当前进程', async () => {
  const { wrapper, router } = await setup()
  expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'two'); await flushPromises()
  expect(wrapper.findAll('tbody tr')).toHaveLength(1)
  expect(wrapper.get('tbody').text()).toContain('101')
  await wrapper.get('[aria-label="搜索处理进程"]').setValue('missing')
  expect(wrapper.text()).toContain('当前筛选范围没有已上报的处理进程')
  await wrapper.get('[aria-label="搜索处理进程"]').setValue('main.py')
  await wrapper.get('[data-testid="processor-101"] button').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'runtime-logs', runtimeId: 'binding1', runnerId: 'two', assignmentId: 'a1', processPid: '101', processSlot: '0', recordId: 'run1' })
  wrapper.unmount()
})
it('单进程关闭带原 PID 和启动代次，等待心跳确认且其他进程仍显示', async () => {
  const { wrapper } = await setup()
  vi.mocked(runnerManagementApi.processorProcesses).mockResolvedValue({ runners: machines, items: [{ ...processes[0]!, stopStatus: 'pending' }, processes[1]!] })
  await wrapper.get('[data-testid="processor-stop-100"]').trigger('click'); await flushPromises()
  expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('PID 100'), '关闭处理进程', expect.any(Object))
  expect(runnerManagementApi.stopProcessorProcess).toHaveBeenCalledWith(expect.objectContaining({ pid: 100, slot: 0, generation: 'v1:start1' }))
  expect(wrapper.get('[data-testid="processor-100"]').text()).toContain('等待关闭确认')
  expect(wrapper.get('[data-testid="processor-stop-100"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('[data-testid="processor-101"]').exists()).toBe(true)
  wrapper.unmount()
})
it('旧版 Runner、离线或非管理员不能关闭进程，取消确认不发指令', async () => {
  vi.mocked(runnerManagementApi.processorProcesses).mockResolvedValue({ runners: [{ ...machines[0]!, capabilities: [] }, { ...machines[1]!, status: 'offline' }], items: processes })
  const { wrapper } = await setup()
  expect(wrapper.text()).toContain('需要升级 Runner')
  expect(wrapper.get('[data-testid="processor-stop-100"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="processor-stop-101"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="processor-100"]').text()).toContain('此 Runner 版本不支持单进程关闭，请先升级 Runner')
  expect(wrapper.get('[data-testid="processor-101"]').text()).toContain('实例已离线')
  vi.mocked(runnerManagementApi.processorProcesses).mockResolvedValue({ runners: machines, items: processes })
  await wrapper.get('[aria-label="刷新处理进程"]').trigger('click'); await flushPromises()
  vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
  await wrapper.get('[data-testid="processor-stop-100"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.stopProcessorProcess).not.toHaveBeenCalled()
  useAuthStore().roles = ['user']; await flushPromises()
  expect(wrapper.find('[data-testid="processor-stop-100"]').exists()).toBe(false)
  wrapper.unmount()
})
it('关闭失败保留进程和错误，轮询在卸载后停止', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const { wrapper } = await setup()
  vi.mocked(runnerManagementApi.stopProcessorProcess).mockRejectedValueOnce(new Error('PID 已变化'))
  await wrapper.get('[data-testid="processor-stop-100"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('PID 已变化')
  expect(wrapper.find('[data-testid="processor-100"]').exists()).toBe(true)
  const calls = vi.mocked(runnerManagementApi.processorProcesses).mock.calls.length
  wrapper.unmount(); await vi.advanceTimersByTimeAsync(5000)
  expect(runnerManagementApi.processorProcesses).toHaveBeenCalledTimes(calls)
})
