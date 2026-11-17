// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox, ElSelect } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentResourceRule } from '@/api/runnerManagement'
import NodeDeploymentTargets from './NodeDeploymentTargets.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  nodeDeploymentResource: vi.fn(), saveNodeDeploymentResource: vi.fn(), instances: vi.fn(), generatedDeployments: vi.fn(),
  runtimeConfigurations: vi.fn(), deployGeneratedArchive: vi.fn(), generatedDeploymentAction: vi.fn(),
  codeRepositories: vi.fn(), previewNodeDeploymentResource: vi.fn(),
} }))
const resources: DeploymentResourceRule[] = [
  { resourceId: 'r1', configType: '90', configTypeName: '网页抓取', resourceName: '201 资源', environment: 'test', runnerId: 'runner1', enabled: true, isDefault: true },
  { resourceId: 'r2', configType: '90', configTypeName: '网页抓取', resourceName: '172 资源', environment: 'test', runnerId: 'runner2', enabled: true, isDefault: false },
]
const context = { sourceId: '430024901', flowId: '21000040', stepId: '41895', configId: '1401218', configType: '90', environment: 'test' as const }
function choice(ids: string[] = []) {
  return { ...context, resourceId: ids[0] || '', resourceIds: ids, effectiveResourceIds: ids, useDefault: false,
    effectiveResourceId: ids[0] || '', defaultResourceId: 'r1', revision: 'rev1', resources, targetPath: 'links/1401218' }
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  setActivePinia(createPinia()); useAuthStore().roles = ['admin']
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue(choice())
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementation(async body => ({ ...choice(body.resourceIds || []), revision: 'rev2', useDefault: !!body.useDefault, deploymentSettings: body.deploymentSettings }))
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([{ repoId: 'repo1', name: '默认仓库', remoteUrl: 'https://git.example/repo', status: 'ACTIVE', branch: 'main' }] as never)
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([
    { runnerId: 'runner1', ipAddress: '192.168.1.201', status: 'online', installDirectory: 'D:/Runner2/instance' },
    { runnerId: 'runner2', ipAddress: '192.168.1.172', status: 'online', installDirectory: 'D:/Runner/instance' },
  ] as never)
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [], total: 0 })
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([])
  vi.mocked(runnerManagementApi.previewNodeDeploymentResource).mockResolvedValue(choice(['r1']))
})
afterEach(async () => { wrapper?.unmount(); await flushPromises(); vi.resetAllMocks(); vi.useRealTimers() })
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/settings', component: { template: '<div />' } }] })
  await router.push('/')
  wrapper = mount(NodeDeploymentTargets, { props: { ...context, archiveId: 'archive1' }, global: {
    plugins: [router, ElementPlus], stubs: { DeploymentRuntimeActions: true },
  } })
  await flushPromises(); return wrapper
}
it('下拉多选两台机器保存完整目标列表，并提交当前归档的独立部署任务', async () => {
  vi.mocked(runnerManagementApi.deployGeneratedArchive).mockResolvedValue({ items: [{ jobId: 'job1' }, { jobId: 'job2' }] } as never)
  const w = await setup()
  const select = w.getComponent(ElSelect)
  expect(select.props('multiple')).toBe(true)
  select.vm.$emit('change', ['r1']); await flushPromises()
  select.vm.$emit('change', ['r1', 'r2']); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenLastCalledWith(expect.objectContaining({ resourceIds: ['r1', 'r2'], useDefault: false, revision: 'rev2' }))
  expect(w.get('[data-testid="deploy-selected-machines"]').text()).toContain('2 台')
  await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenCalledWith(expect.objectContaining({ ...context, archiveId: 'archive1', resourceIds: ['r1', 'r2'], targetRevision: 'rev2' }))
})
it('节点配置不加载或展示任务明细，也不显示重复的部署任务入口', async () => {
  const w = await setup()
  expect(w.text()).not.toContain('最近部署任务')
  expect(w.find('[data-testid^="deployment-job-"]').exists()).toBe(false)
  expect(runnerManagementApi.generatedDeployments).not.toHaveBeenCalled()
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
  expect(w.findAll('a').some(item => item.text() === '查看部署任务')).toBe(false)
})
it('创建任务发现相关进程时显示确认，取消后不提交任务', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue(choice(['r1']))
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ runnerId: 'runner1', ipAddress: '192.168.1.201', status: 'online',
    installDirectory: 'D:/Runner2/instance', workerProcesses: [{ assignmentId: 'a1', pid: 123, slot: 0, queue: 'news', workingDirectory: 'D:/Runner2/instance/links/1401218' }] }] as never)
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
  try {
    const w = await setup()
    await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(runnerManagementApi.deployGeneratedArchive).not.toHaveBeenCalled()
    expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeUndefined()
  } finally { confirm.mockRestore() }
})
it('跟随生成结果展示具体文件，源目录仅作为保留相对路径的基准', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({ ...choice(['r1']), repositoryId: 'repo1',
    gitDirectory: 'links/1401218', generatedFiles: ['links/1401218/sites/www.ceyear.com.py'], entryPoint: 'bin/newslink.exe' })
  const w = await setup()
  expect(w.get('[data-testid="deployment-generated-files"]').text()).toContain('links/1401218/sites/www.ceyear.com.py')
  expect(w.text()).toContain('仅部署本次生成的文件')
  expect(w.text()).toContain('Git 文件目录：')
  expect(w.get('[data-testid="deployment-configured-entry"]').text()).toContain('bin/newslink.exe')
  await w.get('[data-testid="deployment-follow-generation"]').setValue(false)
  expect(w.find('[data-testid="deployment-generated-files"]').exists()).toBe(false)
  expect(w.text()).toContain('Git 文件目录：')
})
it('未生成代码或未选择机器时不允许提交；只读账号不能更改部署目标', async () => {
  const w = await setup()
  expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeDefined()
  await w.setProps({ archiveId: undefined }); await flushPromises()
  expect(w.text()).toContain('尚无已归档的生成代码')
  useAuthStore().roles = ['read']; await flushPromises()
  expect(w.getComponent(ElSelect).props('disabled')).toBe(true)
})
it('切换源后忽略旧源迟到的部署设置', async () => {
  const w = await setup()
  let finish!: (result: ReturnType<typeof choice>) => void
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  w.getComponent(ElSelect).vm.$emit('change', ['r1'])
  await w.setProps({ sourceId: '430024902' }); await flushPromises()
  finish(choice(['r1'])); await flushPromises()
  expect(w.getComponent(ElSelect).props('modelValue')).toEqual([])
})
it('保存失败时保留已保存的选择和接口错误', async () => {
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockRejectedValue(new Error('网络连接失败'))
  const w = await setup()
  w.getComponent(ElSelect).vm.$emit('change', ['r1']); await flushPromises()
  expect(w.getComponent(ElSelect).props('modelValue')).toEqual([])
  expect(w.get('[role="alert"]').text()).toBe('网络连接失败')
})
it('部署设置连续修改后自动保存最后输入，保存完成前不能创建任务', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({ ...choice(['r1']), repositoryId: 'repo1', gitDirectory: 'links/1401218' })
  const w = await setup()
  vi.useFakeTimers()
  expect((w.get('#node-deployment-directory').element as HTMLInputElement).value).toBe('links/1401218')
  expect(w.find('[data-testid="save-deployment-settings"]').exists()).toBe(false)
  expect(w.text()).not.toContain('取消修改')
  await vi.advanceTimersByTimeAsync(800)
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
  await w.get('[data-testid="deployment-follow-generation"]').setValue(false)
  await w.get('#node-deployment-source').setValue('links/1401218/sites')
  await w.get('#node-deployment-directory').setValue('apps/news/sites')
  expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeDefined()
  await vi.advanceTimersByTimeAsync(699)
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenLastCalledWith(expect.objectContaining({
    ...context, resourceIds: ['r1'], revision: 'rev1', deploymentSettings: {
      repositoryId: 'repo1', sourceDirectory: 'links/1401218/sites', deploymentDirectory: 'apps/news/sites',
    },
  }))
  expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeUndefined()
  expect(w.get('[data-testid="deployment-settings-status"]').text()).toBe('部署配置已自动保存')
})
it('自动保存失败保留输入，继续修改后重试，失败时禁止创建部署任务', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue(choice(['r1']))
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockRejectedValueOnce(new Error('网络连接失败'))
  const w = await setup(); vi.useFakeTimers()
  await w.get('#node-deployment-directory').setValue('apps/news')
  await vi.advanceTimersByTimeAsync(700); await flushPromises()
  expect(w.get('[data-testid="deployment-settings-status"]').text()).toContain('网络连接失败')
  expect(w.find('[role="alert"]').exists()).toBe(false)
  expect((w.get('#node-deployment-directory').element as HTMLInputElement).value).toBe('apps/news')
  expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeDefined()
  await vi.advanceTimersByTimeAsync(3000)
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledTimes(1)
  await w.get('#node-deployment-directory').setValue('apps/news/latest')
  await vi.advanceTimersByTimeAsync(700); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledTimes(2)
  expect(w.get('[data-testid="deployment-settings-status"]').text()).toBe('部署配置已自动保存')
  expect(w.find('[role="alert"]').exists()).toBe(false)
})
it('手动 Git 来源信息不完整时等待补全，不发送无效配置', async () => {
  const w = await setup(); vi.useFakeTimers()
  await w.get('[data-testid="deployment-follow-generation"]').setValue(false)
  await vi.advanceTimersByTimeAsync(700); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
  expect(w.get('[data-testid="deployment-settings-status"]').text()).toContain('请选择 Git 地址并填写源目录')
  await w.get('#node-deployment-source').setValue('links/1401218')
  await vi.advanceTimersByTimeAsync(700); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledWith(expect.objectContaining({
    deploymentSettings: { repositoryId: 'repo1', sourceDirectory: 'links/1401218', deploymentDirectory: '' },
  }))
})
it('关闭页面时立即保存尚未到延时的修改，保持原源和节点上下文', async () => {
  const w = await setup(); vi.useFakeTimers()
  await w.get('#node-deployment-directory').setValue('apps/on-close')
  w.unmount(); wrapper = undefined; await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    ...context, deploymentSettings: { repositoryId: '', sourceDirectory: '', deploymentDirectory: 'apps/on-close' },
  }))
})
it('恢复到已保存值时取消待保存请求', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({ ...choice(['r1']), deploymentSettings: {
    repositoryId: '', sourceDirectory: '', deploymentDirectory: 'apps/original',
  } })
  const w = await setup(); vi.useFakeTimers()
  await w.get('#node-deployment-directory').setValue('apps/changed')
  await w.get('#node-deployment-directory').setValue('apps/original')
  await vi.advanceTimersByTimeAsync(800)
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
  expect(w.get('[data-testid="deployment-settings-status"]').text()).toBe('部署配置已保存')
  expect(w.get('[data-testid="deploy-selected-machines"]').attributes('disabled')).toBeUndefined()
})
it('切换源时保存旧源的待写配置，旧响应不覆盖新源', async () => {
  const w = await setup(); vi.useFakeTimers()
  let finish!: (result: ReturnType<typeof choice>) => void
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await w.get('#node-deployment-directory').setValue('apps/old-source')
  await w.setProps({ sourceId: '430024902' }); await flushPromises()
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledWith(expect.objectContaining({ sourceId: context.sourceId }))
  finish(choice(['r1'])); await flushPromises()
  expect(w.getComponent(ElSelect).props('modelValue')).toEqual([])
  expect((w.get('#node-deployment-directory').element as HTMLInputElement).value).toBe('links/1401218')
  await vi.advanceTimersByTimeAsync(800)
  expect(runnerManagementApi.saveNodeDeploymentResource).toHaveBeenCalledTimes(1)
})
it('切换 Git 地址或目录后显示各机器的实际部署目录，并忽略旧预览响应', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({ ...choice(['r1']), repositoryId: 'repo1', gitDirectory: 'links/1401218' })
  const w = await setup(); vi.useFakeTimers()
  let finishOld!: (value: ReturnType<typeof choice> & { targets: { resourceId: string; runnerId: string; deploymentDirectory: string }[] }) => void
  vi.mocked(runnerManagementApi.previewNodeDeploymentResource).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
  await w.get('[data-testid="deployment-follow-generation"]').setValue(false)
  await vi.advanceTimersByTimeAsync(250)
  vi.mocked(runnerManagementApi.previewNodeDeploymentResource).mockResolvedValueOnce({ ...choice(['r1']), targets: [
    { resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: 'D:/Runner2/instance/apps/latest' },
  ] })
  w.findAllComponents(ElSelect)[1]!.vm.$emit('update:modelValue', 'repo2')
  await w.get('#node-deployment-directory').setValue('apps/latest')
  await vi.advanceTimersByTimeAsync(250); await flushPromises()
  expect(runnerManagementApi.previewNodeDeploymentResource).toHaveBeenLastCalledWith(expect.objectContaining(context), {
    repositoryId: 'repo2', sourceDirectory: 'links/1401218', deploymentDirectory: 'apps/latest',
  })
  const panel = w.get('[data-testid="deployment-actual-directories"]')
  expect(panel.text()).toContain('192.168.1.201'); expect(panel.text()).toContain('D:/Runner2/instance/apps/latest')
  finishOld({ ...choice(['r1']), targets: [{ resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: 'D:/old' }] }); await flushPromises()
  expect(panel.text()).not.toContain('D:/old')
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
})
