// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElSelect } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type GeneratedDeploymentJob, type RuntimeConfiguration } from '@/api/runnerManagement'
import DeploymentRuntimeActions from './DeploymentRuntimeActions.vue'
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { runtimeEntry: vi.fn(), saveRuntimeEntry: vi.fn(), startRuntimeProgram: vi.fn(), stopRuntimeProgram: vi.fn() } }))
const job = { jobId: 'job1', runtimeId: 'runtime1', deploymentId: 'deployment1', deliveryId: 'delivery1', runnerId: 'runner1', status: 'success' } as GeneratedDeploymentJob
const runtime = { runtimeId: 'runtime1', deploymentId: 'deployment1', revision: 'v1', binding: { delivery: { deliveryId: 'delivery1' } }, assignment: { enabled: false } } as RuntimeConfiguration
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
async function setup(row = runtime, admin = true) {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'read']
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings', component: { template: '<div />' } }] })
  await router.push('/'); await router.isReady()
  wrapper = mount(DeploymentRuntimeActions, { props: { job, currentRuntime: row }, global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises(); return wrapper
}
it('部署记录直接启动、停止对应运行配置，日志分别定位运行与下发记录', async () => {
  const w = await setup()
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockResolvedValue({ ...runtime, revision: 'v2', assignment: { ...runtime.assignment!, enabled: true } })
  vi.mocked(runnerManagementApi.stopRuntimeProgram).mockResolvedValue(runtime)
  await w.findAll('button').find(button => button.text() === '启动程序')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.startRuntimeProgram).toHaveBeenCalledWith('runtime1', 'v1')
  expect(w.text()).toContain('已请求运行')
  await w.findAll('button').find(button => button.text() === '停止程序')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.stopRuntimeProgram).toHaveBeenCalledWith('runtime1', 'v2')
  expect(w.findAll('a').map(link => link.attributes('href')).some(href => href?.includes('runtimeId=runtime1'))).toBe(true)
  expect(w.findAll('a').map(link => link.attributes('href')).some(href => href?.includes('recordId=delivery1'))).toBe(true)
})
it('旧部署记录不提供启动，防止误启动后来部署的代码', async () => {
  const w = await setup({ ...runtime, binding: { ...runtime.binding!, delivery: { ...runtime.binding!.delivery!, deliveryId: 'new-delivery' } } })
  expect(w.text()).toContain('已有更新部署'); expect(w.findAll('button')).toHaveLength(0)
})
it('只读用户可查看日志，不能启动停止', async () => {
  const w = await setup(runtime, false)
  expect(w.findAll('button')).toHaveLength(0); expect(w.findAll('a')).toHaveLength(2)
})
it('单文件先采用入口，再使用返回的修订号启动', async () => {
  const w = await setup({ ...runtime, assignment: null })
  vi.mocked(runnerManagementApi.runtimeEntry).mockResolvedValue({ files: ['run.py'], entryPoint: 'run.py', revision: 'v1', layoutRevision: 'l1' })
  vi.mocked(runnerManagementApi.saveRuntimeEntry).mockResolvedValue({ ...runtime, revision: 'adopted' })
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockResolvedValue(runtime)
  await w.get('button').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeEntry).toHaveBeenCalledWith('runtime1', { entryPoint: 'run.py', revision: 'v1', layoutRevision: 'l1' })
  expect(runnerManagementApi.startRuntimeProgram).toHaveBeenCalledWith('runtime1', 'adopted')
})
it('多文件必须先选择入口，点击保存入口并启动后才提交', async () => {
  const w = await setup({ ...runtime, assignment: null })
  vi.mocked(runnerManagementApi.runtimeEntry).mockResolvedValue({ files: ['one.py', 'two.py'], entryPoint: '', revision: 'v1', layoutRevision: 'l1' })
  vi.mocked(runnerManagementApi.saveRuntimeEntry).mockResolvedValue(runtime)
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockResolvedValue(runtime)
  await w.get('button').trigger('click'); await flushPromises()
  expect(runnerManagementApi.startRuntimeProgram).not.toHaveBeenCalled()
  w.getComponent(ElSelect).vm.$emit('update:modelValue', 'two.py'); await flushPromises()
  await w.findAll('button').find(button => button.text() === '保存入口并启动')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeEntry).toHaveBeenCalledWith('runtime1', expect.objectContaining({ entryPoint: 'two.py' }))
  expect(runnerManagementApi.startRuntimeProgram).toHaveBeenCalledWith('runtime1', 'v1')
})
it('启动失败保留后端错误', async () => {
  const w = await setup()
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockRejectedValue(new Error('请先下发变化文件'))
  await w.get('button').trigger('click'); await flushPromises()
  expect(w.get('[role="alert"]').text()).toContain('请先下发变化文件')
})
