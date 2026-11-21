// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type DeploymentConfiguration, type DirectoryDelivery, type RuntimeConfiguration, type RuntimeGitVersions } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import { flowCenterApi, sourceApi } from '@/api'
import RunnerBindingTab from './RunnerBindingTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { codeRepositories: vi.fn(), runtimeGitVersions: vi.fn(), runtimeEntry: vi.fn(), saveRuntimeEntry: vi.fn(), runtimeConfigurations: vi.fn(), deploymentConfigurations: vi.fn(), instances: vi.fn(), deleteDeploymentConfiguration: vi.fn(), saveRuntimeConfiguration: vi.fn(), startRuntimeProgram: vi.fn(), stopRuntimeProgram: vi.fn(), removeRuntimeConfiguration: vi.fn(), requestRunnerFiles: vi.fn(), runnerFileResult: vi.fn(), browseCodeRepository: vi.fn(), directoryDeliveryPreview: vi.fn(), deliverDirectoryBinding: vi.fn() } }))
const configuration: DeploymentConfiguration = { deploymentId: 'a'.repeat(32), name: '新闻生产配置', pathStyle: 'config', codeId: '', configId: '123', queueName: 'news_list', siteHost: '', directoryTemplate: '{configId}/prod', entryPoint: 'main.py', nodes: [], revision: 'layout-v1',
  sourceNode: { flowId: 'flow-88', flowName: '财经新闻采集流程', stepId: 'step-7', nodeName: '网页列表抓取', configId: '123' } }
const existing: RuntimeConfiguration = { runtimeId: 'runtime-1', deploymentId: configuration.deploymentId, name: configuration.name, runnerId: 'r-1', assignmentId: 'assignment-1', appliedRevision: 'layout-v1', layoutRevision: 'layout-v1', revision: 'runtime-v1', directoryTemplate: configuration.directoryTemplate, entryPoint: 'main.py',
  binding: { bindingType: 'deployment', ownerId: configuration.deploymentId, runnerId: 'r-1', directoryTemplate: configuration.directoryTemplate, entryPoint: 'main.py', createdAt: '', layoutRevision: 'layout-v1' },
  assignment: { assignmentId: 'assignment-1', runnerId: 'r-1', queue: 'news_list', codeId: 'code1', configId: '123', concurrency: 2, environment: 'production', enabled: true, processorType: 'newslink_nourl', releaseDigest: 'sha256:p' } }
beforeEach(() => {
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockResolvedValue({ items: [] })
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ list: [], total: 0 } as never)
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([{ repoId: 'repo1', name: '默认仓库', remoteUrl: 'http://192.168.1.105/root/aigencode.git', branch: 'main', status: 'ACTIVE' }] as never)
  vi.spyOn(flowCenterApi, 'detail').mockResolvedValue({ name: '智能采集' } as never)
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([structuredClone(existing)])
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([structuredClone(configuration)])
  const runner = { runnerId: 'r-1', name: '一号处理机', ipAddress: '10.0.0.8', installDirectory: 'E:\\runner-one', platform: 'win32', capabilities: [], status: 'online' as const, lastHeartbeat: null, desiredDigest: null, actualDigest: null, assignmentCount: 1 }
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([runner, { ...runner, runnerId: 'r-2', installDirectory: 'E:\\runner-two' }])
  vi.mocked(runnerManagementApi.saveRuntimeConfiguration).mockResolvedValue({ ...structuredClone(existing), runtimeId: 'runtime-2', runnerId: 'r-2' })
  vi.mocked(runnerManagementApi.removeRuntimeConfiguration).mockResolvedValue({ ok: true })
  vi.mocked(runnerManagementApi.directoryDeliveryPreview).mockResolvedValue({ revision: 'layout-v1', targetPath: '123/prod', baselineDigest: null, items: [{ path: 'main.py', kind: 'file', size: 32, status: 'added' }] })
})
it('列表仅展示源目录，省略 Git 仓库地址、分支和固定版本', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, nodes: [
    { id: 'root', parentId: '', name: 'sites', kind: 'folder' },
    { id: 'main', parentId: '', name: 'newslink.py', kind: 'file', repoId: 'repo1', sourcePath: 'links/1401218/newslink.py', gitCommit: 'a'.repeat(40) },
    { id: 'site', parentId: 'root', name: 'site.py', kind: 'file', repoId: 'repo1', sourcePath: 'links/1401218/sites/site.py', gitCommit: 'a'.repeat(40) },
  ] }])
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.find('[data-testid="binding-git-address"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="binding-git-repository"]').exists()).toBe(false)
  const panel = wrapper.get('[data-testid="binding-git-sources"]')
  expect(panel.text()).not.toContain('分支：main'); expect(panel.text()).not.toContain('固定版本')
  expect(wrapper.findAll('[data-testid="binding-git-directory"]')).toHaveLength(1)
  const link = wrapper.get('[data-testid="binding-git-directory"]')
  expect(link.text()).toBe('Git 目录：links/1401218')
  const url = new URL(link.attributes('href')!, 'http://localhost')
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ tab: 'code-repos', repoId: 'repo1', folderPath: 'links/1401218' })
  expect(url.searchParams.get('returnTo')).toContain('/settings?')
  const back = new URL(url.searchParams.get('returnTo')!, 'http://localhost')
  expect(Object.fromEntries(back.searchParams)).toMatchObject({ tab: 'runners', runnerId: 'r-1' })
  await wrapper.get('[aria-label="搜索机器配置"]').setValue('aigencode.git')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  wrapper.unmount()
})
it('Git 地址读取失败时提示错误并保留实例配置', async () => {
  vi.mocked(runnerManagementApi.codeRepositories).mockRejectedValue(new Error('仓库接口不可用'))
  const { wrapper } = await setup()
  expect(wrapper.text()).toContain('Git 仓库信息加载失败：仓库接口不可用')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  wrapper.unmount()
})
it('自动部署仅保存流程ID时补查真实名称，并明确展示流程ID', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, sourceNode: { ...configuration.sourceNode!, flowId: '21000040', flowName: '21000040' } }])
  const { wrapper } = await setup()
  expect(flowCenterApi.detail).toHaveBeenCalledWith('21000040')
  expect(wrapper.get('[data-testid="binding-flow"]').text()).toBe('智能采集')
  expect(wrapper.get('[data-testid="binding-flow-id"]').text()).toBe('流程 ID：21000040')
  wrapper.unmount()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(admin = true, runnerId?: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }, { path: '/canvas', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query: { tab: 'assignments', mode: 'versions' } }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'viewer']
  const wrapper = mount(RunnerBindingTab, { props: { runnerId }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body }); await flushPromises()
  return { wrapper, router }
}
it('选择服务器后仅显示该实例配置，新增绑定自动固定该实例', async () => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([existing, { ...existing, runtimeId: 'runtime-other', runnerId: 'r-2', name: '其他目录的配置' }])
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.text()).not.toContain('其他目录的配置')
  expect(wrapper.text()).toContain('1 项配置 · 1 个实例')
  expect(wrapper.findAll('th').map(item => item.text())).not.toContain('运行机器')
  await wrapper.get('[data-testid="binding-create"]').trigger('click'); await flushPromises()
  const picker = wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === 'binding-runner')!
  expect(picker.props('modelValue')).toBe('r-1')
  expect(picker.props('disabled')).toBe(true)
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([true])
  vi.mocked(runnerManagementApi.saveRuntimeConfiguration).mockResolvedValue({ ...existing, runtimeId: 'new-for-r-1' })
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ runnerId: 'r-1' }))
  expect(wrapper.emitted('busy')?.at(-1)).toEqual([false])
  wrapper.unmount()
})
it('没有配置的实例不回退显示其他机器的配置', async () => {
  const { wrapper } = await setup(false, 'missing-runner')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(0)
  expect(wrapper.text()).toContain('当前实例暂无机器配置')
  expect(wrapper.find('[data-testid="binding-create"]').exists()).toBe(false)
  wrapper.unmount()
})
it('查看机器全部配置时清除旧配置ID筛选，保留当前机器范围', async () => {
  const another = { ...configuration, deploymentId: 'b'.repeat(32), configId: '456', name: '另一份部署配置', sourceNode: { ...configuration.sourceNode!, configId: '456' } }
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([configuration, another])
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([existing, { ...existing, runtimeId: 'runtime-2', deploymentId: another.deploymentId, name: another.name }, { ...existing, runtimeId: 'other-machine', runnerId: 'r-2' }])
  const { wrapper, router } = await setup(true, 'r-1')
  await router.replace({ path: '/settings', query: { tab: 'runners', runnerId: 'r-1', configId: '123' } }); await flushPromises()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  wrapper.vm.resetFilters(); await flushPromises()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(2)
  expect(wrapper.text()).toContain('另一份部署配置')
  wrapper.unmount()
})
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
  expect(wrapper.get('[data-testid="binding-row"]').text()).toContain('运行入口：app/run.py')
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('实例：2/2 · PID：1230、1231')
  expect(wrapper.get('[data-testid="binding-row"]').text()).not.toContain('@deployment:abc')
  wrapper.unmount()
})

it('机器配置显示所属流程、节点和 MQ，可按来源信息及运行目录搜索', async () => {
  const { wrapper } = await setup()
  expect(wrapper.find('[data-testid="binding-mode"]').exists()).toBe(false)
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.text()).toContain(configuration.name)
  expect(wrapper.findAll('th').map(item => item.text())).toEqual(['运行机器', '流程 / 配置节点', '运行目录', '程序与下发', '操作'])
  expect(wrapper.get('[data-testid="binding-flow"]').text()).toBe('财经新闻采集流程')
  expect(wrapper.get('[data-testid="binding-node"]').text()).toBe('节点：网页列表抓取')
  expect(wrapper.get('[data-testid="binding-directory"]').text()).toBe('123/prod')
  expect(wrapper.find('[data-testid="binding-full-path"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('在线')
  expect(wrapper.text()).toContain('已采用')
  for (const keyword of ['财经新闻采集流程', 'flow-88', '网页列表抓取', 'step-7', 'news_list', '123', 'E:\\runner-one\\123']) {
    await wrapper.get('[aria-label="搜索机器配置"]').setValue(keyword)
    expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  }
  await wrapper.get('[aria-label="搜索机器配置"]').setValue('其他流程')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(0)
  await wrapper.get('[aria-label="搜索机器配置"]').setValue('')
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, sourceNode: undefined }])
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-flow-node"]').text()).toContain('历史配置 · 未记录来源节点')
  expect(wrapper.find('[data-testid="binding-flow"]').exists()).toBe(false)
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
it('手工关闭一个进程后可恢复，已有存活进程不要求先全部停止', async () => {
  const machines = await runnerManagementApi.instances()
  machines[0]!.workerProcesses = [{ assignmentId: existing.assignmentId, queue: 'news_list', slot: 1, pid: 1234 }]
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, stoppedProcessSlots: [0] }])
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockResolvedValue({ ...existing, stoppedProcessSlots: [] })
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-start"]').text()).toBe('恢复进程')
  expect(wrapper.get('[data-testid="binding-start"]').attributes('disabled')).toBeUndefined()
  await wrapper.get('[data-testid="binding-start"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.startRuntimeProgram).toHaveBeenCalledWith(existing.runtimeId, existing.revision)
  expect(runnerManagementApi.stopRuntimeProgram).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="binding-start"]').attributes('disabled')).toBeDefined()
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
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toContain('待启动')
  expect(wrapper.find('[data-testid="binding-start"]').exists()).toBe(true)
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
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('财经新闻采集流程')
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('配置节点：网页列表抓取')
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('启动文件：main.py')
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).toContain('直接启动所选文件')
  expect(wrapper.find('[data-testid="binding-environment"]').exists()).toBe(false)
  expect(wrapper.get('[data-testid="binding-new-row"]').text()).not.toContain('任务环境')
  await flushPromises()
  expect(wrapper.get('[data-testid="binding-target-preview"]').text()).toBe('E:\\runner-two\\123\\prod')
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: configuration.deploymentId, layoutRevision: 'layout-v1', runnerId: 'r-2', environment: 'test', concurrency: 1 }))
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ retryPolicy: { enabled: true, maxAttempts: 5, windowSeconds: 300, delaysSeconds: [5, 15, 30, 60] } }))
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.not.objectContaining({ codeId: expect.anything() }))
  expect(wrapper.find('[data-testid="binding-new-row"]').exists()).toBe(false)
  expect(runnerManagementApi.deliverDirectoryBinding).not.toHaveBeenCalled()
  expect(runnerManagementApi.startRuntimeProgram).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('编辑重试策略回显保存窗口、上限和等待间隔，不触发启动或下发', async () => {
  const retryPolicy = { enabled: true, maxAttempts: 3, windowSeconds: 600, delaysSeconds: [10, 20] }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, retryPolicy }])
  const { wrapper } = await setup()
  await wrapper.findAll('button').find(item => item.text() === '编辑')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[aria-label="失败统计窗口（分钟）"]').element).toHaveProperty('value', '10')
  expect(wrapper.get('[aria-label="窗口内尝试上限（含首次）"]').element).toHaveProperty('value', '3')
  expect(wrapper.get('[aria-label="重试间隔（秒）"]').element).toHaveProperty('value', '10, 20')
  await wrapper.get('[aria-label="重试间隔（秒）"]').setValue('2，8，30')
  await wrapper.get('[aria-label="窗口内尝试上限（含首次）"]').setValue(4)
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ retryPolicy: { ...retryPolicy, maxAttempts: 4, delaysSeconds: [2, 8, 30] } }))
  expect(runnerManagementApi.startRuntimeProgram).not.toHaveBeenCalled()
  expect(runnerManagementApi.deliverDirectoryBinding).not.toHaveBeenCalled()
  expect(existing.retryPolicy).toBeUndefined()
  wrapper.unmount()
})
it('重试间隔无效时保留表单，关闭自动重试可以保存', async () => {
  const { wrapper } = await setup()
  await wrapper.findAll('button').find(item => item.text() === '编辑')!.trigger('click'); await flushPromises()
  await wrapper.get('[aria-label="重试间隔（秒）"]').setValue('5, 0')
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="binding-form-error"]').text()).toContain('重试间隔')
  await wrapper.get('[aria-label="自动重试"]').trigger('click'); await flushPromises()
  expect(wrapper.find('[aria-label="重试间隔（秒）"]').exists()).toBe(false)
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ retryPolicy: { enabled: false, maxAttempts: 5, windowSeconds: 300, delaysSeconds: [5, 15, 30, 60] } }))
  wrapper.unmount()
})
it('公共配置不选择队列也能绑定，失败保留当前表单', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, sourceNode: undefined, configId: '', queueName: 'directory_queue', entryPoint: '', directoryTemplate: 'shared/python', pathStyle: 'custom' }])
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, assignment: null, assignmentId: '', entryPoint: '' }])
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-flow-node"]').text()).toContain('公共目录 · 未绑定流程节点')
  await wrapper.get('[data-testid="binding-create"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-execution-summary"]').text()).not.toContain('节点 MQ')
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
it('编辑采用配置时携带两种修订号，保留原有机器与后台兼容环境', async () => {
  const { wrapper } = await setup()
  await wrapper.findAll('button').find(item => item.text() === '编辑')!.trigger('click'); await flushPromises()
  expect(wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === 'binding-runner')!.props('disabled')).toBe(true)
  expect(wrapper.find('[data-testid="binding-environment"]').exists()).toBe(false)
  expect(wrapper.get('[data-testid="binding-new-row"]').text()).not.toContain('任务环境')
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: existing.runtimeId, revision: existing.revision, layoutRevision: existing.layoutRevision, concurrency: 2, environment: 'production' }))
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.not.objectContaining({ codeId: expect.anything() }))
  await wrapper.get('[data-testid="binding-create"]').trigger('click'); await flushPromises()
  wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === 'binding-runner')!.vm.$emit('update:modelValue', 'r-2')
  await flushPromises()
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenLastCalledWith(expect.objectContaining({ runnerId: 'r-2', environment: 'test', concurrency: 1 }))
  wrapper.unmount()
})
it('目录跳转按部署 ID 定位，下发仍可选择范围', async () => {
  const { wrapper, router } = await setup()
  await wrapper.get('[data-testid="binding-logs"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'runtime-logs', runtimeId: existing.runtimeId })
  expect(wrapper.findAll('button').some(item => item.text() === '目录详情')).toBe(false)
  await wrapper.get('[data-testid="binding-edit-directory"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'directory-layout', deploymentId: configuration.deploymentId, runnerId: 'r-1', runtimeId: existing.runtimeId, returnTab: 'runners' })
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
  expect(wrapper.find('[data-testid="binding-full-path"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="binding-installed-path"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('配置有更新')
  expect(wrapper.text()).toContain('目录有更新，待重新下发')
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, queueName: '', directoryTemplate: 'shared/python' }])
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  wrapper.unmount()
})

it('下发成功但版本不一致时明确提示采用或重新下发，匹配采用版本时显示已下发', async () => {
  const delivery: DirectoryDelivery = { deliveryId: 'd1', bindingType: 'deployment', ownerId: configuration.deploymentId,
    runnerId: existing.runnerId, status: 'success', layoutRevision: 'layout-v1', artifactDigest: '', targetPath: '123/prod',
    installedPath: '', requestedAt: '', startedAt: null, finishedAt: '', error: '' }
  const binding = { ...existing, appliedRevision: 'old', assignment: { ...existing.assignment!, processorType: 'deployment-entry' },
    binding: { ...existing.binding!, delivery } }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([binding])
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-delivery-status"]').text()).toBe('版本不一致')
  expect(wrapper.get('[data-testid="binding-delivery-advice"]').text()).toContain('代码已下发，编辑保存采用该版本后再启动')
  binding.appliedRevision = 'layout-v1'; delivery.layoutRevision = 'old'
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-delivery-status"]').text()).toBe('版本不一致')
  expect(wrapper.get('[data-testid="binding-delivery-advice"]').text()).toContain('采用的配置尚未下发，请重新下发代码')
  binding.appliedRevision = 'another-version'
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-delivery-advice"]').text()).toContain('下发版本与采用版本不一致')
  delivery.layoutRevision = binding.appliedRevision
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-delivery-status"]').text()).toBe('已下发')
  wrapper.unmount()
})

it('启动校验失败展示完整原因及操作步骤，并保留停止状态', async () => {
  const binding = { ...existing, assignment: { ...existing.assignment!, enabled: false, processorType: 'deployment-entry' } }
  const message = '机器配置尚未采用启动文件「newslink.py」。请点击「编辑 → 保存配置」采用入口；已下发且代码未变化时可直接启动。'
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([binding])
  vi.mocked(runnerManagementApi.startRuntimeProgram).mockRejectedValue(new Error(message))
  const machines = await runnerManagementApi.instances()
  machines[0]!.workerProcesses = []
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  const { wrapper } = await setup()
  await wrapper.get('[data-testid="binding-start"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-program-error"]').text()).toBe(message)
  expect(wrapper.get('[data-testid="binding-program-error"]').classes()).toContain('rb-program-error')
  expect(wrapper.get('[data-testid="binding-program-status"]').text()).toBe('已停止')
  expect(runnerManagementApi.deliverDirectoryBinding).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('仅修改入口时显示配置待采用，采用后代码相同无需重新下发', async () => {
  const delivery: DirectoryDelivery = { deliveryId: 'd1', bindingType: 'deployment', ownerId: configuration.deploymentId,
    runnerId: existing.runnerId, status: 'success', layoutRevision: 'old-delivery', artifactDigest: '', targetPath: '123/prod',
    installedPath: '', requestedAt: '', startedAt: null, finishedAt: '', error: '' }
  const binding = { ...existing, appliedRevision: 'old-config', deliveredCodeMatches: false, latestCodeMatchesDelivery: true,
    assignment: { ...existing.assignment!, processorType: 'deployment-entry' }, binding: { ...existing.binding!, delivery } }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([binding])
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-delivery-status"]').text()).toBe('配置待采用')
  expect(wrapper.get('[data-testid="binding-delivery-advice"]').text()).toContain('无需重新下发')
  binding.appliedRevision = binding.layoutRevision; binding.deliveredCodeMatches = true
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="binding-delivery-status"]').text()).toBe('已下发')
  expect(wrapper.find('[data-testid="binding-delivery-advice"]').exists()).toBe(false)
  expect(runnerManagementApi.deliverDirectoryBinding).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('自定义目录支持 Linux 路径，缺失变量不展示伪造的实际目录', async () => {
  const machines = await runnerManagementApi.instances()
  machines[0] = { ...machines[0]!, installDirectory: '/opt/runner/', platform: 'linux' }
  vi.mocked(runnerManagementApi.instances).mockResolvedValue(machines)
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, directoryTemplate: 'shared/python', pathStyle: 'custom' }])
  const { wrapper } = await setup()
  expect(wrapper.find('[data-testid="binding-full-path"]').exists()).toBe(false)
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

it('设置入口进入统一编辑目录，保留当前机器和配置，不自动生成入口或启动程序', async () => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, assignment: null, assignmentId: '', entryPoint: '' }])
  const { wrapper, router } = await setup()
  await wrapper.get('[data-testid="binding-entry"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'directory-layout', deploymentId: configuration.deploymentId, runnerId: 'r-1', runtimeId: existing.runtimeId, returnTab: 'runners' })
  expect(wrapper.findComponent({ name: 'DeploymentDirectoryDrawer' }).exists()).toBe(false)
  expect(runnerManagementApi.runtimeEntry).not.toHaveBeenCalled()
  expect(runnerManagementApi.saveRuntimeEntry).not.toHaveBeenCalled()
  expect(wrapper.findAllComponents({ name: 'ElSelect' }).some(item => item.props('ariaLabel') === '选择启动文件')).toBe(false)
  expect(runnerManagementApi.startRuntimeProgram).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('未绑定的旧方案合并到部署配置，同一流程节点的历史重复定义不再次列出', async () => {
  const pending = { ...configuration, deploymentId: 'b'.repeat(32), configId: '456', name: '待部署的公共方案', sourceNode: undefined }
  const duplicate = { ...configuration, deploymentId: 'c'.repeat(32), name: '旧节点部署定义' }
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([configuration, pending, duplicate])
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(2)
  expect(wrapper.text()).toContain('待部署的公共方案')
  expect(wrapper.text()).not.toContain('旧节点部署定义')
  expect(wrapper.text()).toContain('未绑定实例')
  await wrapper.get('[data-testid="binding-unbound"]').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="binding-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: pending.deploymentId, runnerId: 'r-1' }))
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.not.objectContaining({ runtimeId: expect.any(String) }))
  wrapper.unmount()
})
it('手工新建直达新建表单而非旧列表，列表不执行代码核验也不误报必须重新下发', async () => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, codeVerificationPending: true,
    assignment: { ...existing.assignment!, processorType: 'deployment-entry' },
    binding: { ...existing.binding!, delivery: { status: 'success', layoutRevision: 'older' } as DirectoryDelivery } }])
  const { wrapper, router } = await setup(true, 'r-1')
  expect(wrapper.text()).toContain('配置版本有变化，启动时将校验代码与入口')
  expect(wrapper.text()).not.toContain('版本不一致')
  await wrapper.get('[data-testid="binding-manual-deployment"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'directory-layout', create: '1', returnTab: 'runners', runnerId: 'r-1' })
  wrapper.unmount()
})

it('合并的历史方案保留全部关联流程，并在确认后按修订号删除未绑定配置', async () => {
  const pending = { ...configuration, deploymentId: 'b'.repeat(32), configId: '456', name: '旧公共方案', sourceNode: undefined,
    relatedSourceNodes: [{ flowId: 'f1', flowName: '季度报告流程', stepId: 's1', nodeName: '报告节点', configId: '456' }, { flowId: 'f2', flowName: '季度报告草稿', stepId: 's2', nodeName: '草稿节点', configId: '456' }] }
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([configuration, pending])
  vi.mocked(runnerManagementApi.deleteDeploymentConfiguration).mockResolvedValue({ ok: true })
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.text()).toContain('季度报告流程')
  expect(wrapper.get('[data-testid="binding-related-node"]').text()).toContain('季度报告草稿')
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValue('confirm' as never)
  await wrapper.get('[data-testid="binding-delete-configuration"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deleteDeploymentConfiguration).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="binding-delete-configuration"]').trigger('click'); await flushPromises()
  expect(confirm).toHaveBeenCalledTimes(2)
  expect(runnerManagementApi.deleteDeploymentConfiguration).toHaveBeenCalledWith(pending.deploymentId, pending.revision)
  expect(wrapper.text()).not.toContain('旧公共方案')
  wrapper.unmount()
})

it('只显示创建部署配置时的源，直接跳转并带上原始流程节点，不展示关联源列表', async () => {
  const sourceContext = { sourceId: '430024901', flowId: '21000040', stepId: '41895', configId: '123', deploymentJobId: 'original-job' }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, sourceContext }])
  vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ list: [{ sourceId: '430024901', name: '电科思仪新闻源' }, { sourceId: 'other-source', name: '共享配置的其他源' }], total: 2 } as never)
  const { wrapper, router } = await setup(true, 'r-1')
  expect(sourceApi.sourcePaged).toHaveBeenCalledWith({ sourceIds: ['430024901'], size: 100 })
  const link = wrapper.get('[data-testid="binding-original-source"]')
  expect(link.text()).toBe('电科思仪新闻源')
  const target = new URL(link.attributes('href')!, 'http://localhost')
  expect(Object.fromEntries(target.searchParams)).toEqual({ sourceId: '430024901', view: 'flow', flowId: '21000040', nodeId: '41895' })
  expect(wrapper.text()).not.toContain('共享配置的其他源')
  expect(wrapper.find('[data-testid="deployment-view-sources"]').exists()).toBe(false)
  await link.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.sourceId).toBe('430024901')
  wrapper.unmount()
})
it('名称查询失败仍以保存的源 ID 直接跳转；未记录来源的旧配置不会猜测源', async () => {
  const sourceContext = { sourceId: '430024901', flowId: '21000040', stepId: '41895', configId: '123', deploymentJobId: 'original-job' }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, sourceContext }])
  vi.mocked(sourceApi.sourcePaged).mockRejectedValue(new Error('unavailable'))
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.get('[data-testid="binding-original-source"]').text()).toBe('源 430024901')
  wrapper.unmount()
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([existing])
  vi.mocked(sourceApi.sourcePaged).mockClear()
  const previous = await setup(true, 'r-1')
  expect(previous.wrapper.find('[data-testid="binding-original-source"]').exists()).toBe(false)
  expect(sourceApi.sourcePaged).not.toHaveBeenCalled()
  previous.wrapper.unmount()
})

it('列表只显示相对目录，点击后打开该行服务器的实际目录和完整路径', async () => {
  const delivered: DirectoryDelivery = { deliveryId: 'd1', bindingType: 'deployment', ownerId: configuration.deploymentId,
    runnerId: 'r-2', status: 'success', layoutRevision: 'older', artifactDigest: '', targetPath: 'old/landing',
    installedPath: 'E:\\runner-two\\old\\landing', requestedAt: '', startedAt: null, finishedAt: '', error: '' }
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ ...existing, runnerId: 'r-2', binding: { ...existing.binding!, runnerId: 'r-2', delivery: delivered } }])
  vi.mocked(runnerManagementApi.requestRunnerFiles).mockImplementation(async (_id, body) => ({ requestId: body.path }))
  vi.mocked(runnerManagementApi.runnerFileResult).mockImplementation(async path => ({ status: 'success', result: { path, items: [] } }))
  const { wrapper } = await setup(true, 'r-2')
  for (const [selector, directory, relative] of [
    ['binding-directory', 'E:\\runner-two\\123\\prod', '123/prod'],
  ]) {
    await wrapper.get(`[data-testid="${selector}"]`).trigger('click'); await flushPromises()
    const browser = wrapper.getComponent({ name: 'RunnerFilesDrawer' })
    expect(browser.props('runner').runnerId).toBe('r-2')
    expect(browser.props('directory')).toBe(directory)
    expect(document.body.textContent).toContain(directory)
    expect(runnerManagementApi.requestRunnerFiles).toHaveBeenLastCalledWith('r-2', { action: 'list', path: relative })
    browser.vm.$emit('close'); await flushPromises()
  }
  expect(runnerManagementApi.browseCodeRepository).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('运行目录无法解析时禁用浏览，不向 Runner 请求占位目录', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, directoryTemplate: '{missing}/program' }])
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.get('[data-testid="binding-directory"]').attributes('disabled')).toBeDefined()
  expect(wrapper.find('[data-testid="binding-browse-target"]').exists()).toBe(false)
  expect(runnerManagementApi.requestRunnerFiles).not.toHaveBeenCalled()
  wrapper.unmount()
})

function mappedGitConfiguration() {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...configuration, nodes: [
    { id: 'main', parentId: '', name: 'main.py', kind: 'file', repoId: 'repo1', sourcePath: 'links/123/main.py', gitCommit: 'c'.repeat(40) },
  ] }])
}
function gitVersions(runtimeId = 'runtime-1'): RuntimeGitVersions {
  return { runtimeId, deployedStatus: 'ok', deployedError: '', deliveryId: 'last-success', sources: [{
    repoId: 'repo1', directory: 'links/123', deployedCommits: ['a'.repeat(40)], remoteCommit: 'b'.repeat(40),
    remoteStatus: 'ok', remoteError: '', checkedAt: '2026-11-20T00:00:00Z', branch: 'main',
  }] }
}
it('显示该机器成功下发的 Git 版本和远程最新版本，不使用当前映射的提交冒充已下发版本', async () => {
  mappedGitConfiguration()
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockResolvedValue({ items: [gitVersions()] })
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.get('[data-testid="binding-delivered-git-version"]').text()).toContain('aaaaaaaaaaaa')
  expect(wrapper.get('[data-testid="binding-remote-git-version"]').text()).toContain('bbbbbbbbbbbb（来源提交不同）')
  expect(wrapper.get('[data-testid="binding-delivered-git-version"]').attributes('title')).toBe('a'.repeat(40))
  expect(wrapper.get('[data-testid="binding-git-sources"]').text()).not.toContain('cccccccccccc')
  wrapper.unmount()
})
it('版本查询未完成时列表和操作先展示，独立显示查询状态', async () => {
  mappedGitConfiguration()
  let resolve!: (value: { items: RuntimeGitVersions[] }) => void
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockReturnValue(new Promise(done => { resolve = done }))
  const { wrapper } = await setup(true, 'r-1')
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.get('[aria-label="刷新机器配置"]').attributes('disabled')).toBeUndefined()
  expect(wrapper.get('[data-testid="binding-remote-git-version"]').text()).toContain('查询中')
  resolve({ items: [gitVersions()] }); await flushPromises()
  expect(wrapper.get('[data-testid="binding-delivered-git-version"]').text()).toContain('aaaaaaaaaaaa')
  wrapper.unmount()
})
it('同一部署配置在不同 Runner 上展示各自下发版本', async () => {
  mappedGitConfiguration()
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([existing, { ...existing, runtimeId: 'runtime-2', runnerId: 'r-2' }])
  const other = gitVersions('runtime-2'); other.sources[0]!.deployedCommits = ['d'.repeat(40)]
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockResolvedValue({ items: [gitVersions(), other] })
  const { wrapper } = await setup()
  expect(wrapper.findAll('[data-testid="binding-delivered-git-version"]').map(item => item.text())).toEqual([
    '已下发版本：aaaaaaaaaaaa', '已下发版本：dddddddddddd',
  ])
  wrapper.unmount()
})
it('增量下发来自多个 Git 提交时展示混合版本', async () => {
  mappedGitConfiguration()
  const value = gitVersions(); value.sources[0]!.deployedCommits.push('e'.repeat(40))
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockResolvedValue({ items: [value] })
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-delivered-git-version"]').text()).toContain('aaaaaaaaaaaa、eeeeeeeeeeee（混合版本）')
  wrapper.unmount()
})
it('混合来源的文件内容与远程一致时不提示版本不同', async () => {
  mappedGitConfiguration()
  const value = gitVersions(); value.sources[0]!.deployedCommits.push('b'.repeat(40)); value.sources[0]!.contentStatus = 'same'
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockResolvedValue({ items: [value] })
  const { wrapper } = await setup()
  expect(wrapper.get('[data-testid="binding-remote-git-version"]').text()).toBe('远程最新：bbbbbbbbbbbb（已下发文件一致）')
  expect(wrapper.get('[data-testid="binding-git-sources"]').text()).not.toContain('版本不同')
  wrapper.unmount()
})
it('版本接口失败保留部署列表，手工刷新会请求刷新远程版本', async () => {
  mappedGitConfiguration()
  vi.mocked(runnerManagementApi.runtimeGitVersions).mockRejectedValueOnce(new Error('版本查询不可用')).mockResolvedValue({ items: [gitVersions()] })
  const { wrapper } = await setup()
  expect(wrapper.findAll('[data-testid="binding-row"]')).toHaveLength(1)
  expect(wrapper.get('[data-testid="binding-remote-git-version"]').text()).toContain('查询失败')
  await wrapper.get('[aria-label="刷新机器配置"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.runtimeGitVersions).toHaveBeenLastCalledWith(['runtime-1'], true)
  expect(wrapper.get('[data-testid="binding-delivered-git-version"]').text()).toContain('aaaaaaaaaaaa')
  wrapper.unmount()
})
