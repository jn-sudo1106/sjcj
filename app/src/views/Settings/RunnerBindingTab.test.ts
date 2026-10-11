// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type DeploymentConfiguration, type DirectoryDelivery, type RuntimeConfiguration } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import RunnerBindingTab from './RunnerBindingTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { runtimeConfigurations: vi.fn(), deploymentConfigurations: vi.fn(), instances: vi.fn(), saveRuntimeConfiguration: vi.fn(), startRuntimeProgram: vi.fn(), stopRuntimeProgram: vi.fn(), removeRuntimeConfiguration: vi.fn(), directoryDeliveryPreview: vi.fn(), deliverDirectoryBinding: vi.fn() } }))
const configuration: DeploymentConfiguration = { deploymentId: 'a'.repeat(32), name: '新闻生产配置', pathStyle: 'config', codeId: '', configId: '123', queueName: 'news_list', siteHost: '', directoryTemplate: '{configId}/prod', entryPoint: 'main.py', nodes: [], revision: 'layout-v1' }
const existing: RuntimeConfiguration = { runtimeId: 'runtime-1', deploymentId: configuration.deploymentId, name: configuration.name, runnerId: 'r-1', assignmentId: 'assignment-1', appliedRevision: 'layout-v1', layoutRevision: 'layout-v1', revision: 'runtime-v1', directoryTemplate: configuration.directoryTemplate, entryPoint: 'main.py',
  binding: { bindingType: 'deployment', ownerId: configuration.deploymentId, runnerId: 'r-1', directoryTemplate: configuration.directoryTemplate, entryPoint: 'main.py', createdAt: '', layoutRevision: 'layout-v1' },
  assignment: { assignmentId: 'assignment-1', runnerId: 'r-1', queue: 'news_list', codeId: 'code1', configId: '123', concurrency: 2, environment: 'production', enabled: true, processorType: 'newslink_nourl', releaseDigest: 'sha256:p' } }
beforeEach(() => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([structuredClone(existing)])
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([structuredClone(configuration)])
  const runner = { runnerId: 'r-1', name: '一号处理机', ipAddress: '10.0.0.8', installDirectory: 'E:\\runner-one', platform: 'win32', capabilities: [], status: 'online' as const, lastHeartbeat: null, desiredDigest: null, actualDigest: null, assignmentCount: 1 }
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([runner, { ...runner, runnerId: 'r-2', installDirectory: 'E:\\runner-two' }])
  vi.mocked(runnerManagementApi.saveRuntimeConfiguration).mockResolvedValue({ ...structuredClone(existing), runtimeId: 'runtime-2', runnerId: 'r-2' })
  vi.mocked(runnerManagementApi.removeRuntimeConfiguration).mockResolvedValue({ ok: true })
  vi.mocked(runnerManagementApi.directoryDeliveryPreview).mockResolvedValue({ revision: 'layout-v1', targetPath: '123/prod', baselineDigest: null, items: [{ path: 'main.py', kind: 'file', size: 32, status: 'added' }] })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(admin = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query: { tab: 'assignments', mode: 'versions' } }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'viewer']
  const wrapper = mount(RunnerBindingTab, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body }); await flushPromises()
  return { wrapper, router }
}
it('直接启动使用机器已采用的目录和入口，显示实例数量及 PID', async () => {
  const direct = { ...existing, directoryTemplate: 'adopted/program', entryPoint: 'app/run.py',
    assignment: { ...existing.assignment!, processorType: 'deployment-entry', queue: '@deployment:abc' } }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([direct])
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, directoryTemplate: 'edited/program', entryPoint: 'other.py' }])
  const machines = await runnerManagementApi.instances()
  machines[0] = { ...machines[0]!, workerProcesses: [
    { assignmentId: 'assignment-1', queue: '@deployment:abc', slot: 0, pid: 1230, entry: 'E:\\runner-one\\adopted\\program\\app\\run.py' },
    { assignmentId: 'assignment-1', queue: '@deployment:abc', slot: 1, pid: 1231, entry: 'E:\\runner-one\\adopted\\program\\app\\run.py' },
  ] }
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-directory"]').text()).toBe('adopted/program')
  expect(wrapper.get('[data-testid="binding-row"]').text()).toContain('启动文件：app/run.py')
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('实例：2/2 · PID：1230、1231')
  expect(wrapper.get('[data-testid="binding-row"]').text()).not.toContain('@deployment:abc')
  wrapper.unmount()
})

it('机器配置以实例和运行目录为主，展示解析后的目标路径', async () => {
  const { wrapper } = await setup()
  expect(wrapper.find('[data-testid="binding-mode"]').exists()).toBe(false)
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.text()).toContain(configuration.name)
  expect(wrapper.text()).toContain('news_list')
  expect(wrapper.findAll('th').map(item => item.text())).toEqual(['运行机器', '部署配置', '运行目录', '程序与下发', '操作'])
  expect(wrapper.get('[data-testid="binding-directory"]').text()).toBe('123/prod')
  expect(wrapper.get('[data-testid="binding-full-path"]').text()).toBe('目标：E:\\runner-one\\123\\prod')
  expect(wrapper.text()).toContain('在线')
  expect(wrapper.text()).toContain('已采用')
  await wrapper.get('[aria-label="搜索机器配置"]').setValue('E:\\runner-one\\123')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  wrapper.unmount()
})
it('启动指令提交后等待心跳，只有对应子进程上报才显示运行中', async () => {
  const paused = { ...existing, assignment: { ...existing.assignment!, enabled: false } }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([paused])
  const machines = await runnerManagementApi.instances()
  machines[0]!.workerProcesses = []
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockResolvedValue({ ...existing, revision: 'started-v2' })
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toBe('已停止')
  await wrapper.get('[data-testid="binding-start"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.startRuntimeProgram).toHaveBeenCalledWith(existing.runtimeId, existing.revision)
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('等待启动')
  expect(wrapper.get('[data-testid="binding-start"]').attributes('disabled')).toBeDefined()
  machines[0]!.workerProcesses = [0, 1].map(slot => ({ assignmentId: existing.assignmentId, queue: 'news_list', slot, pid: 1230 + slot }))
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, revision: 'started-v2' }])
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('运行中')
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('PID：1230、1231')
  wrapper.unmount()
})
it('停止保留绑定和下发入口，等待对应进程消失才确认停止', async () => {
  const machines = await runnerManagementApi.instances()
  machines[0]!.workerProcesses = [{ assignmentId: existing.assignmentId, queue: 'news_list', slot: 0, pid: 1234 }]
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  const stopped = { ...existing, revision: 'stopped-v2', assignment: { ...existing.assignment!, enabled: false } }
  vi.mocked(runnerManagementApi.stopRuntimeProgram).mockResolvedValue(stopped)
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('部分运行 1/2')
  await wrapper.get('[data-testid="binding-stop"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.stopRuntimeProgram).toHaveBeenCalledWith(existing.runtimeId, existing.revision)
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('停止中')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.find('[data-testid="binding-deliver"]').exists()).toBe(true)
  machines[0]!.workerProcesses = [{ assignmentId: 'another', queue: 'other_queue', slot: 0, pid: 9999 }]
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([stopped])
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toBe('已停止')
  expect(runnerManagementApi.removeRuntimeConfiguration).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('启停失败保留原状态，离线和旧 Runner 不推测进程状态，公共目录没有启停操作', async () => {
  vi.mocked(runnerManagementApi.stopRuntimeProgram).mockRejectedValue(new Error('配置已更新，请刷新'))
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('进程未上报')
  await wrapper.get('[data-testid="binding-stop"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-program-error"]').text()).toContain('配置已更新')
  expect(wrapper.get('[data-testid="binding-stop"]').attributes('disabled')).toBeUndefined()
  const machines = await runnerManagementApi.instances()
  machines[0]!.status = 'offline'; machines[0]!.workerProcesses = [{ assignmentId: existing.assignmentId, queue: 'news_list', slot: 0, pid: 1234 }]
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('运行状态未知')
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, assignment: null, assignmentId: '' }])
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toBe('仅下发目录')
  expect(wrapper.find('[data-testid="binding-start"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="binding-stop"]').exists()).toBe(false)
  wrapper.unmount()
})
it('新增绑定在列表内展开，选择机器和运行目录并预览完整路径', async () => {
  const { wrapper } = await setup()
  await wrapper.get('[data-testid="binding-create"]').trigger('click'); await flushPromises()
  const select = (id: string) => wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === id)!
  expect(select('binding-deployment').props('filterable')).toBe(true)
  select('binding-runner').vm.$emit('update:modelValue', 'r-2')
  expect(wrapper.find('[data-testid="binding-code"]').exists()).toBe(false)
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('队列：news_list')
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('启动文件：main.py')
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('直接启动所选文件')
  select('binding-environment').vm.$emit('update:modelValue', 'production'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-target-preview"]').text()).toBe('E:\\runner-two\\123\\prod')
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: configuration.deploymentId, layoutRevision: 'layout-v1', runnerId: 'r-2', environment: 'production', concurrency: 1 }))
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.not.objectContaining({ codeId: expect.anything() }))
  expect(wrapper.find('[data-testid="binding-new-row"]').exists()).toBe(false)
  expect(runnerManagementApi.deliverDirectoryBinding).not.toHaveBeenCalled()
  expect(runnerManagementApi.startRuntimeProgram).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('公共配置不选择队列也能绑定，失败保留当前表单', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, configId: '', queueName: '', entryPoint: '', directoryTemplate: 'shared/python', pathStyle: 'custom' }])
  const { wrapper } = await setup()
  await wrapper.get('[data-testid="binding-create"]').trigger('click'); await flushPromises()
  const select = wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === 'binding-runner')!
  select.vm.$emit('update:modelValue', 'r-2'); await flushPromises()
  vi.mocked(runnerManagementApi.saveRuntimeConfiguration).mockRejectedValue(new Error('部署配置已更新'))
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.not.objectContaining({ codeId: expect.anything() }))
  expect(wrapper.find('[data-testid="binding-environment"]').exists()).toBe(false)
  expect(wrapper.get('[data-testid="binding-form-error"]').text()).toContain('部署配置已更新')
  expect(wrapper.find('[data-testid="binding-new-row"]').exists()).toBe(true)
  wrapper.unmount()
})
it('编辑采用配置时携带两种修订号，并保留原有机器', async () => {
  const { wrapper } = await setup()
  await wrapper.findAll('button').find(item => item.text() === '编辑')!.trigger('click'); await flushPromises()
  expect(wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === 'binding-runner')!.props('disabled')).toBe(true)
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: existing.runtimeId, revision: existing.revision, layoutRevision: existing.layoutRevision, concurrency: 2, environment: 'production' }))
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.not.objectContaining({ codeId: expect.anything() }))
  wrapper.unmount()
})
it('目录跳转按部署 ID 定位，下发仍可选择范围', async () => {
  const { wrapper, router } = await setup()
  await wrapper.findAll('button').find(item => item.text() === '部署目录')!.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'directory-layout', deploymentId: configuration.deploymentId })
  await wrapper.get('[data-testid="binding-deliver"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.directoryDeliveryPreview).toHaveBeenCalledWith({ bindingType: 'deployment', ownerId: configuration.deploymentId, runnerId: 'r-1' })
  expect(document.body.textContent).toContain('选择下发范围')
  wrapper.unmount()
})
it('移除使用运行配置修订号，只读用户不能修改和下发', async () => {
  const { wrapper } = await setup()
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  await wrapper.findAll('button').find(item => item.text() === '移除')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.removeRuntimeConfiguration).toHaveBeenCalledWith(existing.runtimeId, existing.revision)
  wrapper.unmount()
  const readonly = await setup(false)
  expect(readonly.wrapper.find('[data-testid="binding-create"]').exists()).toBe(false)
  expect(readonly.wrapper.find('[data-testid="binding-deliver"]').exists()).toBe(false)
  expect(readonly.wrapper.find('[data-testid="binding-start"]').exists()).toBe(false)
  expect(readonly.wrapper.find('[data-testid="binding-stop"]').exists()).toBe(false)
  readonly.wrapper.unmount()
})
it('服务异常显示错误，禁止新建不完整绑定', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockRejectedValue(new Error('HTTP 502'))
  const { wrapper } = await setup()
  expect(wrapper.text()).toContain('HTTP 502')
  expect(wrapper.get('[data-testid="binding-create"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('同 IP 的不同目录按独立实例统计，可按状态和下发结果组合筛选', async () => {
  const machines = await runnerManagementApi.instances()
  machines[1]!.status = 'offline'
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  const failed: DirectoryDelivery = { deliveryId: 'd1', bindingType: 'deployment', ownerId: configuration.deploymentId, runnerId: 'r-2', status: 'failed', layoutRevision: 'layout-v1', artifactDigest: '', targetPath: '123/prod', installedPath: '', requestedAt: '2026-10-10T00:00:00Z', startedAt: null, finishedAt: '2026-10-10T00:01:00Z', error: '文件被占用' }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([existing, { ...existing, runtimeId: 'r2', runnerId: 'r-2', binding: { ...existing.binding!, runnerId: 'r-2', delivery: failed } }])
  const { wrapper } = await setup()
  expect(wrapper.text()).toContain('2 项配置 · 2 个实例 · 1 个在线')
  const select = (id: string) => wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === id)!
  select('binding-machine-filter').vm.$emit('update:modelValue', 'offline'); await flushPromises()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.get('[data-testid="binding-row"]').text()).toContain('E:\\runner-two')
  expect(wrapper.get('[data-testid="binding-row"]').text()).toContain('文件被占用')
  expect(wrapper.get('[data-testid="binding-row"]').text()).toContain('完成于')
  select('binding-delivery-filter').vm.$emit('update:modelValue', 'success'); await flushPromises()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(0)
  select('binding-delivery-filter').vm.$emit('update:modelValue', 'failed'); await flushPromises()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  wrapper.unmount()
})

it('目录取部署配置变量，区分当前目标与上次落盘位置，不拿任务配置或旧回执代替', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, directoryTemplate: '{configId}/{queue}/{website}', siteHost: 'example.com' }])
  const delivered: DirectoryDelivery = { deliveryId: 'd1', bindingType: 'deployment', ownerId: configuration.deploymentId, runnerId: 'r-1', status: 'success', layoutRevision: 'old', artifactDigest: '', targetPath: 'old/path', installedPath: 'E:\\runner-one\\old\\path', requestedAt: '2026-10-10T00:00:00Z', startedAt: null, finishedAt: '2026-10-10T00:01:00Z', error: '' }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, appliedRevision: 'old', assignment: { ...existing.assignment!, configId: '999', queue: 'another_queue' }, binding: { ...existing.binding!, delivery: delivered } }])
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-directory"]').text()).toBe('123/news_list/example.com')
  expect(wrapper.get('[data-testid="binding-full-path"]').text()).toBe('目标：E:\\runner-one\\123\\news_list\\example.com')
  expect(wrapper.get('[data-testid="binding-installed-path"]').text()).toContain('E:\\runner-one\\old\\path')
  expect(wrapper.text()).toContain('配置有更新')
  expect(wrapper.text()).toContain('目录有更新，待重新下发')
  wrapper.unmount()
})

it('自定义目录支持 Linux 路径，缺失变量不展示伪造的实际目录', async () => {
  const machines = await runnerManagementApi.instances()
  machines[0] = { ...machines[0]!, installDirectory: '/opt/runner/', platform: 'linux' }
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, directoryTemplate: 'shared/python', pathStyle: 'custom' }])
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-full-path"]').text()).toBe('目标：/opt/runner/shared/python')
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, directoryTemplate: '{website}/test', siteHost: '' }])
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-directory"]').text()).toBe('待完善目录模板')
  expect(wrapper.find('[data-testid="binding-full-path"]').exists()).toBe(false)
  wrapper.unmount()
})

it('自动刷新机器心跳状态，编辑期间暂停刷新，分页后查询回到第一页', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ ...existing, runtimeId: `runtime-${index}` })))
  const { wrapper } = await setup()
  const pagination = wrapper.findComponent({ name: 'ElPagination' })
  pagination.vm.$emit('update:current-page', 2); await flushPromises()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  await wrapper.get('[aria-label="搜索机器配置"]').setValue('新闻')
  expect(pagination.props('currentPage')).toBe(1)
  const machines = structuredClone(await runnerManagementApi.instances())
  machines[0]!.status = 'offline'
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  await vi.advanceTimersByTimeAsync(15000); await flushPromises()
  expect(wrapper.get('[data-testid="binding-row"]').text()).toContain('离线')
  await wrapper.get('[data-testid="binding-create"]').trigger('click'); await flushPromises()
  const calls = vi.mocked(runnerManagementApi.runtimeConfigurations).mock.calls.length
  await vi.advanceTimersByTimeAsync(16000)
  expect(runnerManagementApi.runtimeConfigurations).toHaveBeenCalledTimes(calls)
  wrapper.unmount()
})
