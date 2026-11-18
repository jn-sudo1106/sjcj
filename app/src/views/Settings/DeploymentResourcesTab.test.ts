// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElInput, ElSelect, ElSwitch } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { configApi, sourceApi, flowCenterApi } from '@/api'
import { runnerManagementApi, type GeneratedDeploymentJob, type RunnerInstance } from '@/api/runnerManagement'
import DeploymentResourcesTab from './DeploymentResourcesTab.vue'

vi.mock('@/api', () => ({ configApi: { nodeTypeList: vi.fn() }, sourceApi: { sourcePaged: vi.fn() }, flowCenterApi: { detail: vi.fn(), steps: vi.fn() } }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { deploymentTaskDetail: vi.fn(), runtimeConfigurations: vi.fn(), deploymentResources: vi.fn(), saveDeploymentResources: vi.fn(), instances: vi.fn(), generatedDeployments: vi.fn(), generatedDeploymentAction: vi.fn() } }))
const rule = { resourceId: 'r1', resourceName: '服务器201', isDefault: true, configType: '90', configTypeName: '网页抓取', environment: 'test' as const, runnerId: 'r1', deploymentDirectory: 'test', enabled: true }
const job = { jobId: 'job-1', deploymentId: '4667a6baf9b459dcb01b7d093671447d', sourceId: '430024910', flowId: '21000040', stepId: '41895', configId: '1401218', environment: 'test',
  gitCommit: 'a'.repeat(40), status: 'success', taskId: 'task-1', message: '代码部署完成', createdAt: '2026-11-02T01:00:00Z', updatedAt: '2026-11-02T01:02:00Z', runnerId: 'r1', runnerIp: '192.168.1.201', targetPath: 'test/links/1401218', repositoryId: 'repo1', repositoryName: '默认仓库', gitDirectory: 'links/1401218' } as GeneratedDeploymentJob
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.mocked(sourceApi.sourcePaged).mockResolvedValue({ total: 1, list: [{ sourceId: job.sourceId, name: '电科思仪-新闻中心-新闻在线-301689' }] } as never)
  vi.mocked(flowCenterApi.detail).mockResolvedValue({ name: '智能采集' } as never)
  vi.mocked(flowCenterApi.steps).mockResolvedValue([{ stepId: job.stepId, name: '智能采集' }] as never)
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([])
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockImplementation(async id => ({ ...job, jobId: id, historyAvailable: true, finishedAt: job.updatedAt, events: [] }))
  vi.mocked(configApi.nodeTypeList).mockResolvedValue([{ sourceType: '90', typeName: '网页抓取' }, { sourceType: '95', typeName: '文件下载' }] as never)
  vi.mocked(runnerManagementApi.deploymentResources).mockResolvedValue({ items: [{ ...rule }], revision: 'rev1' })
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([
    { runnerId: 'r1', name: '服务器201', ipAddress: '192.168.1.201', installDirectory: 'D:\\Runner1\\instance', status: 'online' },
    { runnerId: 'r2', name: '服务器172', ipAddress: '192.168.1.201', installDirectory: 'D:\\Runner2\\instance', status: 'offline' },
  ] as RunnerInstance[])
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [job], total: 1 })
  vi.mocked(runnerManagementApi.saveDeploymentResources).mockImplementation(async body => ({ items: body.items, revision: 'rev2' }))
  vi.mocked(runnerManagementApi.generatedDeploymentAction).mockResolvedValue(job)
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(query: Record<string, string> = {}, admin = true, tasksOnly = false, runnerId?: string, sourceScopeId?: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'read']
  const w = mount(DeploymentResourcesTab, { props: { tasksOnly, runnerId, sourceScopeId, resourcesOnly: !!runnerId }, global: { plugins: [pinia, router, ElementPlus], stubs: { DeploymentRuntimeActions: true, RunnerFilesDrawer: true, DeploymentFilesDrawer: true } }, attachTo: document.body })
  wrappers.push(w); await flushPromises(); return w
}
it('源内部署任务固定按当前源查询，不继承其他流程或配置筛选', async () => {
  await setup({ sourceId: 'old-source', flowId: 'old-flow', configId: 'old-config', stepId: 'old-node', environment: 'production' }, true, true, undefined, 'current-source')
  expect(runnerManagementApi.generatedDeployments).toHaveBeenCalledWith(expect.objectContaining({
    sourceId: 'current-source', flowId: undefined, stepId: undefined, configId: undefined, environment: undefined,
  }))
})
it('合并后按实例展示资源，保存当前资源仍保留其他实例的资源', async () => {
  const alternate = { ...rule, resourceId: 'r2', resourceName: '服务器172', runnerId: 'r2', isDefault: false }
  vi.mocked(runnerManagementApi.deploymentResources).mockResolvedValue({ items: [{ ...rule }, alternate], revision: 'rev1' })
  const w = await setup({}, true, false, 'r1')
  expect(w.find('.el-radio-group').exists()).toBe(false)
  expect(w.text()).not.toContain('其他实例资源')
  expect(runnerManagementApi.generatedDeployments).not.toHaveBeenCalled()
  await change(w, ElSelect, '列表资源环境', 'both')
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, environment: 'both' }, alternate] })
  expect(w.emitted('busy')?.at(-1)).toEqual([false])
})
it('新增资源自动关联当前实例，机器字段锁定且编辑期间阻止切换', async () => {
  const w = await setup({}, true, false, 'r2')
  await w.findAll('button').find(button => button.text() === '配置节点类型')!.trigger('click')
  await flushPromises()
  expect(w.findAllComponents(ElSelect).some(control => control.props('ariaLabel') === '默认部署服务器')).toBe(false)
  expect(w.emitted('busy')?.at(-1)).toEqual([true])
})
it('任务中心直接展示独立部署任务，保留源节点筛选和任务详情', async () => {
  const w = await setup({ sourceId: '430024910', flowId: '21000040', stepId: '41895' }, false, true)
  expect(w.find('.el-radio-group').exists()).toBe(false)
  expect(runnerManagementApi.generatedDeployments).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '430024910', flowId: '21000040', stepId: '41895' }))
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
  expect(runnerManagementApi.deploymentResources).not.toHaveBeenCalled()
  expect(configApi.nodeTypeList).not.toHaveBeenCalled()
  const link = w.findAll('button').find(button => button.text() === job.jobId)!
  await link.trigger('click'); await flushPromises()
  expect(document.body.querySelector('.dr-details')?.textContent).toContain(`部署任务 ID${job.jobId}`)
  const outputTab = w.findAll('[role="tab"]').find(tab => tab.text() === '过程输出')!
  expect(outputTab.exists()).toBe(true)
  await outputTab.trigger('click')
  expect(w.get('[data-testid="deployment-process-output"]').isVisible()).toBe(true)
  const instance = w.get('[data-testid="deployment-open-instance"]')
  expect(instance.isVisible()).toBe(true)
  const target = new URL(instance.attributes('href')!, 'http://localhost')
  expect(target.pathname).toBe('/settings')
  expect(Object.fromEntries(target.searchParams)).toEqual({ tab: 'runners', runnerId: job.runnerId, view: 'instances' })
  expect(instance.element.closest('td')?.textContent).toContain('查看详情')
  expect(w.get('[data-testid="deployment-task-detail-panel"]').find('[data-testid="deployment-open-instance"]').exists()).toBe(false)
  expect(w.get('[data-testid="deployment-machine-instance-link"]').attributes('href')).toBe(instance.attributes('href'))
  expect(w.findAll('button').some(button => button.text() === '配置节点类型')).toBe(false)
})
it('部署实例按 Runner 身份显示和跳转，同 IP 的多个实例不会混淆，未分配任务不显示实例入口', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [
    { ...job, runnerIp: '192.168.1.173', runnerName: '173 Runner2', instanceDirectory: 'D:\\Runner2\\instance' },
    { ...job, jobId: 'job-2', runnerId: 'r2', runnerIp: '192.168.1.173', runnerName: '173 Runner1', instanceDirectory: 'D:\\Runner1\\instance' },
    { ...job, jobId: 'waiting-job', status: 'waiting_resource', runnerId: '', runnerIp: '' },
  ], total: 3 })
  const w = await setup({}, false, true)
  expect(w.text()).toContain('部署实例 / 目录')
  const links = w.findAll('[data-testid="deployment-instance-link"]')
  expect(links.map(link => link.get('strong').text())).toEqual(['192.168.1.173', '192.168.1.173'])
  expect(links.map(link => link.get('.dr-instance-name').text())).toEqual(['173 Runner2', '173 Runner1'])
  expect(links.map(link => link.get('.dr-instance-directory').text())).toEqual(['D:\\Runner2\\instance', 'D:\\Runner1\\instance'])
  expect(links.map(link => link.get('.dr-instance-status').text())).toEqual(['在线', '离线'])
  expect(links.map(link => Object.fromEntries(new URL(link.attributes('href')!, 'http://localhost').searchParams))).toEqual([
    { tab: 'runners', runnerId: 'r1', view: 'runner' },
    { tab: 'runners', runnerId: 'r2', view: 'runner' },
  ])
  expect(w.findAll('[data-testid="deployment-open-instance"]')).toHaveLength(2)
})
it('执行记录未返回时仍显示任务，查看详情不会读取运行配置', async () => {
  vi.mocked(runnerManagementApi.instances).mockImplementation(() => new Promise(() => {}))
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockImplementation(() => new Promise(() => {}))
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [
    { ...job, runtimeId: 'runtime-1' }, { ...job, jobId: 'job-2', runtimeId: 'runtime-2' },
  ], total: 2 })
  const w = await setup({}, true, true)
  expect(w.text()).toContain(job.jobId)
  expect(w.text()).toContain('job-2')
  expect(w.get('[aria-label="刷新部署任务"]').classes()).not.toContain('is-loading')
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
  const buttons = w.findAll('[data-testid="deployment-view-detail"]')
  await buttons[0]!.trigger('click'); await flushPromises()
  expect(w.get('[data-testid="deployment-task-detail-panel"]').text()).toContain('正在读取执行记录')
  await buttons[1]!.trigger('click'); await flushPromises()
  expect(w.get('.dr-detail-heading').text()).toContain('job-2')
  expect(runnerManagementApi.runtimeConfigurations).not.toHaveBeenCalled()
  expect(runnerManagementApi.deploymentTaskDetail).toHaveBeenCalledTimes(2)
  expect(w.text()).toContain(job.jobId)
})
it('执行记录读取失败只影响详情，任务列表仍可查看', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [{ ...job, runtimeId: 'runtime-1' }], total: 1 })
  vi.mocked(runnerManagementApi.deploymentTaskDetail).mockRejectedValue(new Error('执行记录暂不可用'))
  const w = await setup({}, true, true)
  expect(w.text()).not.toContain('执行记录暂不可用')
  await w.get('[data-testid="deployment-view-detail"]').trigger('click'); await flushPromises()
  expect(w.get('[data-testid="deployment-task-detail-panel"]').text()).toContain('执行记录读取失败：执行记录暂不可用')
  expect(w.get('[aria-label="部署任务列表"]').text()).toContain(job.jobId)
})
it('任务中心采用左列表右详情，切换任务更新常驻详情且不打开抽屉', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [job, { ...job, jobId: 'job-2', status: 'failed', message: '目标机器离线' }], total: 2 })
  const w = await setup({}, true, true)
  const panel = w.get('[data-testid="deployment-task-detail-panel"]')
  expect(panel.text()).toContain('请选择左侧任务查看详情')
  expect(w.find('[data-testid="deployment-task-split-layout"]').exists()).toBe(true)
  const buttons = w.findAll('[data-testid="deployment-view-detail"]')
  await buttons[0]!.trigger('click'); await flushPromises()
  expect(panel.text()).toContain(job.jobId)
  expect(panel.get('.dr-detail-summary').text()).toContain('电科思仪-新闻中心-新闻在线-301689')
  await buttons[1]!.trigger('click'); await flushPromises()
  expect(panel.get('.dr-detail-heading').text()).toContain('job-2')
  expect(panel.text()).toContain('目标机器离线')
  expect(panel.text()).toContain('重试部署')
  expect(document.body.querySelector('.el-drawer')).toBeNull()
})
it('配置链接进入部署记录，已完成记录仅提供程序与日志操作', async () => {
  const w = await setup({ configId: '1401218' })
  expect(runnerManagementApi.generatedDeployments).toHaveBeenCalledWith(expect.objectContaining({ configId: '1401218' }))
  expect(w.text()).toContain('部署成功'); expect(w.text()).toContain('2026-11-02 09:02:00')
  expect(w.text()).not.toContain('部署此版本')
  expect(w.text()).not.toContain('发布生产')
})
it('源和配置跳转保留所属流程节点，配置直接打开节点部署页签', async () => {
  const w = await setup({ configId: '1401218' })
  const source = w.get('[data-testid="deployment-source-link"]')
  const config = w.get('[data-testid="deployment-config-link"]')
  expect(source.text()).toBe('电科思仪-新闻中心-新闻在线-301689')
  expect(w.get('.dr-flow-node').text()).toBe('智能采集 / 智能采集')
  expect(config.text()).toBe('配置 1401218')
  const sourceUrl = new URL(source.attributes('href')!, 'http://localhost')
  const configUrl = new URL(config.attributes('href')!, 'http://localhost')
  expect(sourceUrl.pathname).toBe('/canvas')
  expect(Object.fromEntries(sourceUrl.searchParams)).toMatchObject({ sourceId: job.sourceId, flowId: job.flowId, nodeId: job.stepId, view: 'flow' })
  expect(Object.fromEntries(configUrl.searchParams)).toMatchObject({ sourceId: job.sourceId, flowId: job.flowId, nodeId: job.stepId, tab: 'deployment' })
  await config.trigger('click'); await flushPromises()
  expect(document.body.querySelector('.dr-details')).toBeNull()
})
it('只读账号可以查看默认资源和部署历史，不能修改或发布', async () => {
  const w = await setup({}, false)
  expect(w.text()).toContain('网页抓取')
  expect(w.findAll('button').some(button => button.text() === '编辑')).toBe(false); expect(w.text()).not.toContain('新增资源')
  w.unmount(); wrappers.pop()
  const records = await setup({ configId: '1401218' }, false)
  expect(records.text()).toContain('部署成功'); expect(records.text()).not.toContain('发布生产')
})

async function change(w: VueWrapper, component: typeof ElSelect | typeof ElInput | typeof ElSwitch, label: string, value: unknown, index = 0) {
  const calls = vi.mocked(runnerManagementApi.saveDeploymentResources).mock.calls.length
  await w.findAll('button').filter(button => button.text() === '编辑')[index]!.trigger('click'); await flushPromises()
  const control = w.findAllComponents(component).find(item => item.attributes('aria-label') === label || item.props('ariaLabel') === label)!
  control.vm.$emit('update:modelValue', value); await flushPromises()
  control.vm.$emit('change', value); await flushPromises()
  expect(vi.mocked(runnerManagementApi.saveDeploymentResources).mock.calls.length).toBe(calls)
  await w.findAll('button').find(button => button.text() === '保存')!.trigger('click'); await flushPromises()
}
it('点击编辑后在当前行修改服务器并保存', async () => {
  const w = await setup()
  expect(w.findAll('button').some(button => button.text() === '编辑')).toBe(true)
  expect(w.find('input[aria-label="列表资源名称"]').exists()).toBe(false)
  await change(w, ElSelect, '列表服务器实例', 'r2')
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, resourceId: 'r2', resourceName: '服务器172', runnerId: 'r2' }] })
})
it('可将同一资源设为生产和测试，ID不变', async () => {
  const w = await setup()
  await change(w, ElSelect, '列表资源环境', 'both')
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, environment: 'both' }] })
})
it('状态在当前行切换后点击保存生效', async () => {
  const w = await setup()
  await change(w, ElSwitch, '资源启用状态', false)
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, enabled: false }] })
})
it('保存冲突显示真实错误并保留当前编辑值', async () => {
  vi.mocked(runnerManagementApi.saveDeploymentResources).mockRejectedValue(new Error('默认部署资源已修改，请刷新后再保存'))
  const w = await setup()
  await change(w, ElSelect, '列表资源环境', 'both')
  expect(w.get('[role="alert"]').text()).toContain('默认部署资源已修改')
  expect(w.findAllComponents(ElSelect).find(item => item.props('ariaLabel') === '列表资源环境')!.props('modelValue')).toBe('both')
})
it('资源使用 Runner 名称和 ID，节点类型和环境可修改且沿用最新修订号', async () => {
  const w = await setup()
  expect(w.find('input[aria-label="列表资源名称"]').exists()).toBe(false)
  expect(w.text()).not.toContain('环境部署目录')
  await change(w, ElSelect, '列表节点类型', '95')
  await change(w, ElSelect, '列表资源环境', 'both')
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenLastCalledWith({ revision: 'rev2', items: [{ ...rule, configType: '95', configTypeName: '文件下载', environment: 'both' }] })
})
it('在列表切换默认资源时只保留一个默认', async () => {
  const alternate = { ...rule, resourceId: 'r2', resourceName: '服务器172', runnerId: 'r2', isDefault: false }
  vi.mocked(runnerManagementApi.deploymentResources).mockResolvedValue({ items: [{ ...rule }, alternate], revision: 'rev1' })
  const w = await setup()
  await change(w, ElSwitch, '资源默认状态', true, 1)
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, isDefault: false }, { ...alternate, isDefault: true }] })
})

it('取消当前行编辑恢复原值，不提交接口', async () => {
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '编辑')!.trigger('click'); await flushPromises()
  const control = w.findAllComponents(ElSelect).find(item => item.props('ariaLabel') === '列表资源环境')!
  control.vm.$emit('update:modelValue', 'both'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentResources).not.toHaveBeenCalled()
  await w.findAll('button').find(button => button.text() === '取消')!.trigger('click'); await flushPromises()
  expect(w.findAllComponents(ElSelect).some(item => item.props('ariaLabel') === '列表资源环境')).toBe(false)
  expect(w.text()).toContain('服务器201')
  expect(runnerManagementApi.saveDeploymentResources).not.toHaveBeenCalled()
})

it('部署资源不再提供按机器设置入口，入口由部署配置统一管理', async () => {
  const w = await setup()
  expect(w.find('[data-testid="choose-resource-entry"]').exists()).toBe(false)
  await w.findAll('button').find(button => button.text() === '编辑')!.trigger('click'); await flushPromises()
  expect(w.find('[data-testid="choose-resource-entry"]').exists()).toBe(false)
  expect(w.findComponent({ name: 'RunnerFilesDrawer' }).exists()).toBe(false)
})

it('资源列表不把某台机器采用的入口显示成配置默认入口', async () => {
  vi.mocked(runnerManagementApi.deploymentResources).mockResolvedValue({ items: [{ ...rule, entryPoint: '', entryPoints: ['cn.chinahdht.com.py'] }], revision: 'rev1' })
  const w = await setup()
  expect(w.text()).not.toContain('cn.chinahdht.com.py')
  expect(w.text()).not.toContain('自动识别')
})

it('资源中不再重复显示环境部署目录，目录在 Runner 实例维护', async () => {
  const w = await setup()
  expect(w.find('[data-testid="browse-resource-directory"]').exists()).toBe(false)
  expect(w.text()).not.toContain('环境部署目录')
})

it('部署记录可直接查看本次文件，查看账号也可用且不打开详情', async () => {
  const w = await setup({ configId: '1401218' }, false)
  await w.get('[data-testid="open-deployment-files"]').trigger('click'); await flushPromises()
  expect(w.findComponent({ name: 'DeploymentFilesDrawer' }).props('job').jobId).toBe(job.jobId)
  expect(document.body.querySelector('.dr-details')).toBeNull()
})

it('部署记录打开实际落盘目录，点击目录不打开部署详情', async () => {
  const installedPath = 'D:\\Runner1\\instance\\test\\links\\1401218'
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [{ ...job, installedPath }], total: 1 })
  const w = await setup({ configId: '1401218' })
  await w.get('[data-testid="browse-deployment-directory"]').trigger('click'); await flushPromises()
  const browser = w.findComponent({ name: 'RunnerFilesDrawer' })
  expect(browser.props('runner').runnerId).toBe('r1')
  expect(browser.props('directory')).toBe(installedPath)
  expect(document.body.querySelector('.dr-details')).toBeNull()
})

it('部署记录没有落盘路径时使用目标相对目录', async () => {
  const w = await setup({ configId: '1401218' })
  await w.get('[data-testid="browse-deployment-directory"]').trigger('click'); await flushPromises()
  expect(w.findComponent({ name: 'RunnerFilesDrawer' }).props('directory')).toBe('test/links/1401218')
})

it('部署详情的目录也可打开，切换到文件面板时关闭详情', async () => {
  const w = await setup({ configId: '1401218' })
  expect(w.text()).toContain(job.jobId)
  await w.find('.el-table__body tr').trigger('click'); await flushPromises()
  expect(document.body.querySelector('.dr-details')?.textContent).toContain(`部署 ID${job.deploymentId}`)
  expect(document.body.querySelector('.dr-details')?.textContent).toContain(`部署任务 ID${job.jobId}`)
  const button = document.body.querySelector('[data-testid="browse-deployment-detail-directory"]') as HTMLButtonElement
  expect(button).not.toBeNull(); button.click(); await flushPromises()
  expect(w.findComponent({ name: 'RunnerFilesDrawer' }).props('directory')).toBe(job.targetPath)
  expect(document.body.querySelector('.dr-details')).toBeNull()
})

it('所属实例不存在时保留目录文字', async () => {
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([])
  const w = await setup({ configId: '1401218' })
  expect(w.find('[data-testid="browse-deployment-directory"]').exists()).toBe(false)
  expect(w.text()).toContain(job.targetPath)
})

it('部署记录Git目录链接定位仓库目录，点击不打开详情', async () => {
  const w = await setup({ configId: '1401218' })
  const link = w.get('[data-testid="browse-deployment-git-directory"]')
  const target = new URL(link.attributes('href')!, 'http://localhost')
  expect(target.searchParams.get('tab')).toBe('code-repos')
  expect(target.searchParams.get('repoId')).toBe('repo1')
  expect(target.searchParams.get('folderPath')).toBe('links/1401218')
  await link.trigger('click'); await flushPromises()
  expect(document.body.querySelector('.dr-details')).toBeNull()
})

it('部署详情也提供Git目录跳转，只读账号可以使用', async () => {
  const w = await setup({ configId: '1401218' }, false)
  await w.find('.el-table__body tr').trigger('click'); await flushPromises()
  const link = document.body.querySelector('[data-testid="browse-deployment-detail-git-directory"]') as HTMLAnchorElement
  expect(link).not.toBeNull()
  expect(new URL(link.href).searchParams.get('folderPath')).toBe(job.gitDirectory)
})

it('未记录仓库的Git目录保留文字，不提供无效跳转', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [{ ...job, repositoryId: '' }], total: 1 })
  const w = await setup({ configId: '1401218' })
  expect(w.find('[data-testid="browse-deployment-git-directory"]').exists()).toBe(false)
  expect(w.text()).toContain(job.gitDirectory)
})

it('已完成记录可同步Git代码，保留原记录并重新加载部署进度', async () => {
  vi.mocked(runnerManagementApi.generatedDeploymentAction).mockResolvedValue({ ...job, jobId: 'new-job', status: 'waiting_resource' })
  const w = await setup({ configId: '1401218' })
  await w.get('[data-testid="sync-deployment-git"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.generatedDeploymentAction).toHaveBeenCalledWith(job.jobId, 'sync-git')
  expect(runnerManagementApi.generatedDeployments).toHaveBeenCalledTimes(2)
  expect(document.body.querySelector('.dr-details')).toBeNull()
})

it('被新版替代的历史记录显示无需分配', async () => {
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [{ ...job, status: 'superseded', runnerIp: '', runnerId: '', targetPath: '', message: '已由更新的生成结果替代' }], total: 1 })
  const w = await setup({ configId: '1401218' })
  expect(w.text()).toContain('无需分配')
  expect(w.text()).not.toContain('待分配')
})
