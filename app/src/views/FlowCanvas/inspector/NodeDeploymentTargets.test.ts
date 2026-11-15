// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentResourceRule, type GeneratedDeploymentJob } from '@/api/runnerManagement'
import NodeDeploymentTargets from './NodeDeploymentTargets.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  nodeDeploymentResource: vi.fn(), saveNodeDeploymentResource: vi.fn(), instances: vi.fn(), generatedDeployments: vi.fn(),
  runtimeConfigurations: vi.fn(), deployGeneratedArchive: vi.fn(), generatedDeploymentAction: vi.fn(),
} }))
const resources: DeploymentResourceRule[] = [
  { resourceId: 'r1', configType: '90', configTypeName: '网页抓取', resourceName: '201 资源', environment: 'test', runnerId: 'runner1', enabled: true, isDefault: true },
  { resourceId: 'r2', configType: '90', configTypeName: '网页抓取', resourceName: '172 资源', environment: 'test', runnerId: 'runner2', enabled: true, isDefault: false },
]
const context = { sourceId: '430024901', flowId: '21000040', stepId: '41895', configId: '1401218', configType: '90', environment: 'test' as const }
function choice(ids: string[] = []) {
  return { ...context, resourceId: ids[0] || '', resourceIds: ids, effectiveResourceIds: ids, useDefault: false,
    effectiveResourceId: ids[0] || '', defaultResourceId: 'r1', revision: 'rev1', resources }
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  setActivePinia(createPinia()); useAuthStore().roles = ['admin']
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue(choice())
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementation(async body => ({ ...choice(body.resourceIds || []), revision: 'rev2', useDefault: !!body.useDefault }))
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([
    { runnerId: 'runner1', ipAddress: '192.168.1.201', status: 'online', installDirectory: 'D:/Runner2/instance' },
    { runnerId: 'runner2', ipAddress: '192.168.1.172', status: 'online', installDirectory: 'D:/Runner/instance' },
  ] as never)
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([])
})
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings', component: { template: '<div />' } }] })
  await router.push('/')
  wrapper = mount(NodeDeploymentTargets, { props: { ...context, archiveId: 'archive1' }, global: {
    plugins: [router, ElementPlus], stubs: { DeploymentRuntimeActions: true },
  } })
  await flushPromises(); return wrapper
}
it('勾选两台机器保存完整目标列表，并提交当前归档的独立部署任务', async () => {
  vi.mocked(runnerManagementApi.deployGeneratedArchive).mockResolvedValue({ items: [{ jobId: 'job1' }, { jobId: 'job2' }] } as never)
  const w = await setup()
  await w.get('[data-testid="deployment-target-r1"]').setValue(true); await flushPromises()
  await w.get('[data-testid="deployment-target-r2"]').setValue(true); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenLastCalledWith(expect.objectContaining({ resourceIds: ['r1', 'r2'], useDefault: false, revision: 'rev2' }))
  expect(w.get('[data-testid="deploy-selected-machines"]').text()).toContain('2 台')
  await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenCalledWith(expect.objectContaining({ ...context, archiveId: 'archive1', resourceIds: ['r1', 'r2'], targetRevision: 'rev2' }))
})
it('每台机器分别展示任务 ID、状态及重试，不重试成功机器', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [
    { jobId: 'job1', environment: 'test', runnerIp: '192.168.1.201', status: 'success', message: '部署完成' },
    { jobId: 'job2', environment: 'test', runnerIp: '192.168.1.172', status: 'failed', message: '磁盘不足' },
  ] as GeneratedDeploymentJob[], total: 2 })
  const w = await setup()
  expect(w.get('[data-testid="deployment-job-job1"]').text()).toContain('部署成功')
  expect(w.get('[data-testid="deployment-job-job1"]').text()).toContain('部署任务 ID：job1')
  const failed = w.get('[data-testid="deployment-job-job2"]')
  expect(failed.text()).toContain('192.168.1.172'); expect(failed.text()).toContain('磁盘不足')
  await failed.get('button').trigger('click'); await flushPromises()
  expect(runnerManagementApi.generatedDeploymentAction).toHaveBeenCalledExactlyOnceWith('job2', 'retry')
})
it('未生成代码或未选择机器时不允许提交；只读账号不能更改部署目标', async () => {
  const w = await setup()
  expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeDefined()
  await w.setProps({ archiveId: undefined }); await flushPromises()
  expect(w.text()).toContain('尚无已归档的生成代码')
  useAuthStore().roles = ['read']; await flushPromises()
  expect(w.get('[data-testid="deployment-target-r1"]').attributes('disabled')).toBeDefined()
})
it('切换源后忽略旧源迟到的部署设置', async () => {
  const w = await setup()
  let finish!: (result: ReturnType<typeof choice>) => void
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await w.get('[data-testid="deployment-target-r1"]').setValue(true)
  await w.setProps({ sourceId: '430024902' }); await flushPromises()
  finish(choice(['r1'])); await flushPromises()
  expect((w.get('[data-testid="deployment-target-r1"]').element as HTMLInputElement).checked).toBe(false)
})
it('保存失败时恢复真实勾选状态并保留接口错误', async () => {
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockRejectedValue(new Error('网络连接失败'))
  const w = await setup()
  await w.get('[data-testid="deployment-target-r1"]').setValue(true); await flushPromises()
  expect((w.get('[data-testid="deployment-target-r1"]').element as HTMLInputElement).checked).toBe(false)
  expect(w.get('[role="alert"]').text()).toBe('网络连接失败')
})
