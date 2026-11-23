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
  nodeDeploymentResource: vi.fn(), saveNodeDeploymentResource: vi.fn(), instances: vi.fn(), artifacts: vi.fn(), generatedDeployments: vi.fn(),
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
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ items: [], total: 0 })
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
it('节点配置只读取成功部署回执作为资源摘要，不展示任务明细', async () => {
  const w = await setup()
  expect(w.text()).not.toContain('最近部署任务')
  expect(w.find('[data-testid^="deployment-job-"]').exists()).toBe(false)
  expect(runnerManagementApi.artifacts).toHaveBeenCalledWith(expect.objectContaining({
    sourceId: context.sourceId, flowId: context.flowId, stepId: context.stepId, configId: context.configId,
    environment: 'test', artifactType: 'deployment', status: 'success', page: 1, size: 100,
  }))
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
  expect(runnerManagementApi.generatedDeployments).not.toHaveBeenCalled()
  expect(w.findAll('a').some(item => item.text() === '查看部署任务')).toBe(false)
})
it('按机器展示最近一次成功部署的资源、目录和版本，与目标选择无关', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue(choice(['r1']))
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ total: 3, items: [
    { artifactId: 'new', serverId: 'runner1', resourceId: 'r1', serverIp: '192.168.1.201', machinePath: 'D:/new', outputFiles: [{ path: 'sites/site.py', sha256: 'f'.repeat(64) }], gitCommit: 'a'.repeat(40), updatedAt: '2026-11-22T10:00:00Z', status: 'success' },
    { artifactId: 'other', serverId: 'runner2', resourceId: 'r2', serverIp: '192.168.1.172', machinePath: 'D:/other', gitCommit: 'b'.repeat(40), updatedAt: '2026-11-21T10:00:00Z', status: 'success' },
    { artifactId: 'old', serverId: 'runner1', resourceId: 'r1', serverIp: '192.168.1.201', machinePath: 'D:/old', gitCommit: 'c'.repeat(40), updatedAt: '2026-11-20T10:00:00Z', status: 'success' },
  ] as never })
  const w = await setup()
  const rows = w.findAll('[data-testid="deployed-resource-row"]')
  expect(rows).toHaveLength(2)
  expect(rows[0].text()).toContain('201 资源')
  expect(rows[0].text()).toContain('D:/new')
  expect(rows[0].text()).toContain('sites/site.py')
  expect(rows[0].text()).not.toContain('D:/old')
  expect(rows[1].text()).toContain('172 资源')
  expect(rows[1].text()).toContain('D:/other')
  expect(w.text()).not.toContain('不在当前部署目标中')
  expect(w.find('[data-testid="node-deployed-resources"]').element.compareDocumentPosition(w.find('[data-testid="deployment-resource-select"]').element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
it('翻页读取成功回执，避免旧部署资源落在第一页之外时漏显', async () => {
  const previous = Array.from({ length: 100 }, (_, index) => ({ artifactId: `job-${index}`, serverId: 'runner1',
    resourceId: 'r1', gitCommit: 'a'.repeat(40), updatedAt: `2026-11-22T10:00:${String(index).padStart(2, '0')}Z`, status: 'success' }))
  vi.mocked(runnerManagementApi.artifacts)
    .mockResolvedValueOnce({ total: 101, items: previous as never })
    .mockResolvedValueOnce({ total: 101, items: [{ artifactId: 'older-machine', serverId: 'runner2', resourceId: 'r2',
      machinePath: 'D:/older-machine', gitCommit: 'b'.repeat(40), updatedAt: '2026-11-20T10:00:00Z', status: 'success' }] as never })
  const w = await setup()
  expect(runnerManagementApi.artifacts).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }))
  expect(w.findAll('[data-testid="deployed-resource-row"]')).toHaveLength(2)
  expect(w.get('[data-testid="node-deployed-resources"]').text()).toContain('D:/older-machine')
})
it('成功部署记录查询失败时保留部署目标配置，并单独提示读取失败', async () => {
  vi.mocked(runnerManagementApi.artifacts).mockRejectedValue(new Error('部署记录接口不可用'))
  const w = await setup()
  expect(w.get('[data-testid="node-deployed-resources"]').text()).toContain('部署记录接口不可用')
  expect(w.find('[data-testid="deploy-selected-machines"]').exists()).toBe(true)
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
  expect(panel.get('.dt-path-code').attributes('title')).toBe('D:/Runner2/instance/apps/latest')
  finishOld({ ...choice(['r1']), targets: [{ resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: 'D:/old' }] }); await flushPromises()
  expect(panel.text()).not.toContain('D:/old')
  expect(runnerManagementApi.saveNodeDeploymentResource).not.toHaveBeenCalled()
})
it('对比最新归档与已部署版本显示状态，高级配置默认折叠并支持统一刷新', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({ ...choice(['r1']), entryPoint: 'bin/newslink.exe' })
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ total: 1, items: [
    { artifactId: 'j1', serverId: 'runner1', resourceId: 'r1', serverIp: '192.168.1.201', machinePath: 'D:/Runner2/instance/links/1401218', gitCommit: 'a'.repeat(40), updatedAt: '2026-11-22T10:00:00Z', status: 'success' },
  ] as never })
  const w = await setup()
  await w.setProps({ archiveCommit: 'a'.repeat(40) }); await flushPromises()
  expect(w.text()).toContain('与已部署一致')
  await w.setProps({ archiveCommit: 'b'.repeat(40) }); await flushPromises()
  expect(w.text()).toContain('有新代码待部署')

  const collapseBtn = w.get('.dt-collapse-head')
  expect(collapseBtn.attributes('aria-expanded')).toBe('false')
  expect(w.get('.dt-collapse-summary').text()).toContain('入口 bin/newslink.exe')
  await collapseBtn.trigger('click')
  expect(collapseBtn.attributes('aria-expanded')).toBe('true')

  await w.get('.dt-toolbar-actions button').trigger('click'); await flushPromises()
  expect(w.emitted('refresh-archive')).toHaveLength(1)
})
it('同版本换目录时汇总与目标均提示目录待更新，且仍提交该目标', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({
    ...choice(['r1']), targets: [{ resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: 'D:\\Runner2\\instance\\links\\1401218\\sites' }],
  })
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ total: 1, items: [
    { artifactId: 'j1', serverId: 'runner1', resourceId: 'r1', machinePath: 'D:\\Runner2\\instance\\links\\1401218', gitCommit: 'a'.repeat(40), updatedAt: '2026-11-22T10:00:00Z', status: 'success' },
  ] as never })
  vi.mocked(runnerManagementApi.deployGeneratedArchive).mockResolvedValue({ items: [{ jobId: 'job1' }] } as never)
  const w = await setup(); await w.setProps({ archiveCommit: 'a'.repeat(40) }); await flushPromises()
  expect(w.get('.dt-pill').text()).toBe('部署目录待更新')
  const badge = w.get('[data-testid="deployment-actual-directories"] .dt-target-badge')
  expect(badge.text()).toBe('目录待更新')
  expect(badge.attributes('title')).toContain('代码版本 aaaaaaaaaaaa 相同')
  expect(badge.attributes('title')).toContain('目标目录：D:\\Runner2\\instance\\links\\1401218\\sites')
  expect(w.text()).not.toContain('与已部署一致')
  await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenCalledWith(expect.objectContaining({ resourceIds: ['r1'] }))
})
it('汇总只比较所选目标，并将 Runner 内相对目录与 Windows 绝对目录按同一路径判断', async () => {
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({
    ...choice(['r1']), targets: [{ resourceId: 'r1', runnerId: 'runner1', targetPath: 'links/1401218' }],
  })
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ total: 2, items: [
    { artifactId: 'j1', serverId: 'runner1', resourceId: 'r1', machinePath: 'd:\\RUNNER2\\instance\\links\\1401218\\', gitCommit: 'a'.repeat(40), updatedAt: '2026-11-22T10:00:00Z', status: 'success' },
    { artifactId: 'j2', serverId: 'runner2', resourceId: 'r2', machinePath: 'D:/old', gitCommit: 'b'.repeat(40), updatedAt: '2026-11-22T09:00:00Z', status: 'success' },
  ] as never })
  const w = await setup(); await w.setProps({ archiveCommit: 'a'.repeat(40) }); await flushPromises()
  expect(w.get('.dt-pill').text()).toBe('与已部署一致')
  expect(w.get('[data-testid="deployment-actual-directories"] .dt-target-badge').text()).toBe('与已部署一致')
  expect(w.findAll('[data-testid="deployed-resource-row"]')).toHaveLength(2)
})
it('切换仅部署生成文件只更新当前方案对比，保存后历史成功回执保持不变且不创建部署任务', async () => {
  const settings = { repositoryId: 'repo1', sourceDirectory: 'links/1401218/sites', deploymentDirectory: '' }
  const plan = (deploymentSettings: typeof settings) => {
    const path = deploymentSettings.repositoryId ? 'links/1401218/sites' : 'links/1401218'
    return { ...choice(['r1']), gitDirectory: 'links/1401218/sites', deploymentSettings, targetPath: path,
      targets: [{ resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: `D:/Runner2/instance/${path}` }] }
  }
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue(plan(settings))
  vi.mocked(runnerManagementApi.previewNodeDeploymentResource).mockImplementation(async (_scope, settings) => plan(settings))
  vi.mocked(runnerManagementApi.saveNodeDeploymentResource).mockImplementation(async body => ({ ...plan(body.deploymentSettings!), revision: 'rev2' }))
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ total: 1, items: [
    { artifactId: 'j1', serverId: 'runner1', resourceId: 'r1', machinePath: 'D:/Runner2/instance/links/1401218', gitCommit: 'a'.repeat(40), updatedAt: '2026-11-22T10:00:00Z', status: 'success' },
  ] as never })
  const w = await setup(); await w.setProps({ archiveCommit: 'a'.repeat(40) }); await flushPromises()
  const receipt = w.get('[data-testid="deployed-resource-row"]').text()
  expect(receipt).toContain('部署成功')
  expect(w.get('.dt-pill').text()).toBe('部署目录待更新')
  vi.useFakeTimers()
  await w.get('[data-testid="deployment-follow-generation"]').setValue(true)
  await vi.advanceTimersByTimeAsync(750); await flushPromises()
  expect(w.get('.dt-pill').text()).toBe('与已部署一致')
  expect(w.get('[data-testid="deployed-resource-row"]').text()).toBe(receipt)
  await w.get('[data-testid="deployment-follow-generation"]').setValue(false)
  await vi.advanceTimersByTimeAsync(750); await flushPromises()
  expect(w.get('.dt-pill').text()).toBe('部署目录待更新')
  expect(w.get('[data-testid="deployed-resource-row"]').text()).toBe(receipt)
  expect(runnerManagementApi.deployGeneratedArchive).not.toHaveBeenCalled()
})
it('分级部署确认：同版本重复部署弹窗并默认仅发未更新机器，测试升级不打断，生产覆盖必确认', async () => {
  vi.mocked(runnerManagementApi.deployGeneratedArchive).mockResolvedValue({ items: [{ jobId: 'job1' }] } as never)
  vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({
    ...choice(['r1', 'r2']),
    targets: [
      { resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: 'D:/Runner2/instance/links/1401218' },
      { resourceId: 'r2', runnerId: 'runner2', deploymentDirectory: 'D:/Runner/instance/links/1401218' },
    ],
  })
  vi.mocked(runnerManagementApi.artifacts).mockResolvedValue({ total: 1, items: [
    { artifactId: 'j1', serverId: 'runner1', resourceId: 'r1', serverIp: '192.168.1.201', machinePath: 'D:/Runner2/instance/links/1401218', gitCommit: 'a'.repeat(40), updatedAt: '2026-11-22T10:00:00Z', status: 'success' },
  ] as never })

  const w = await setup()
  await w.setProps({ archiveCommit: 'a'.repeat(40) }); await flushPromises()
  // 目标卡片展示每台机器的状态徽标
  const actualText = w.get('[data-testid="deployment-actual-directories"]').text()
  expect(actualText).toContain('与已部署一致')
  expect(actualText).toContain('首次部署')

  // 1) 同版本混合场景：取消不提交；确认默认跳过已是最新，仅提交未更新机器 r2
  const confirm = vi.spyOn(ElMessageBox, 'confirm')
  try {
    confirm.mockRejectedValueOnce('cancel')
    await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(runnerManagementApi.deployGeneratedArchive).not.toHaveBeenCalled()

    confirm.mockResolvedValueOnce('confirm' as never)
    await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenLastCalledWith(expect.objectContaining({ resourceIds: ['r2'] }))

    // 2) 测试环境正常升级（新 commit）：不额外弹窗，直接提交全部已选机器
    await w.setProps({ archiveCommit: 'b'.repeat(40) }); await flushPromises()
    expect(w.get('[data-testid="deployment-actual-directories"]').text()).toContain('待更新')
    await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenLastCalledWith(expect.objectContaining({ resourceIds: ['r1', 'r2'] }))

    // 3) 生产环境覆盖更新（旧 commit -> 新 commit）：弹窗确认，取消不提交
    vi.mocked(runnerManagementApi.nodeDeploymentResource).mockResolvedValue({
      ...choice(['r1']),
      environment: 'production',
      resources: [{ ...resources[0], environment: 'production' }],
      targets: [{ resourceId: 'r1', runnerId: 'runner1', deploymentDirectory: 'D:/Runner2/instance/links/1401218' }],
    })
    await w.findAll('input[type="radio"]')[1]!.setValue(true); await flushPromises()
    confirm.mockRejectedValueOnce('cancel')
    await w.get('[data-testid="deploy-selected-machines"]').trigger('click'); await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(runnerManagementApi.deployGeneratedArchive).toHaveBeenCalledTimes(2)
  } finally { confirm.mockRestore() }
})
