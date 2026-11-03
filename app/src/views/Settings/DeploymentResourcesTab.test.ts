// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElInput, ElSelect, ElSwitch } from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { configApi } from '@/api'
import { runnerManagementApi, type GeneratedDeploymentJob, type RunnerInstance } from '@/api/runnerManagement'
import DeploymentResourcesTab from './DeploymentResourcesTab.vue'

vi.mock('@/api', () => ({ configApi: { nodeTypeList: vi.fn() } }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { runtimeConfigurations: vi.fn(), deploymentResources: vi.fn(), saveDeploymentResources: vi.fn(), instances: vi.fn(), generatedDeployments: vi.fn(), generatedDeploymentAction: vi.fn() } }))
const rule = { resourceId: 'a'.repeat(32), resourceName: '网页抓取测试机', isDefault: true, configType: '90', configTypeName: '网页抓取', environment: 'test' as const, runnerId: 'r1', deploymentDirectory: 'test', enabled: true }
const job = { jobId: 'job-1', sourceId: '430024910', flowId: '21000040', stepId: '41895', configId: '1401218', environment: 'test',
  gitCommit: 'a'.repeat(40), status: 'success', taskId: 'task-1', message: '代码部署完成', createdAt: '2026-11-02T01:00:00Z', updatedAt: '2026-11-02T01:02:00Z', runnerId: 'r1', runnerIp: '192.168.1.201', targetPath: 'test/links/1401218', repositoryId: 'repo1', repositoryName: '默认仓库', gitDirectory: 'links/1401218' } as GeneratedDeploymentJob
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([])
  vi.mocked(configApi.nodeTypeList).mockResolvedValue([{ sourceType: '90', typeName: '网页抓取' }] as never)
  vi.mocked(runnerManagementApi.deploymentResources).mockResolvedValue({ items: [{ ...rule }], revision: 'rev1' })
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([
    { runnerId: 'r1', name: '服务器201', ipAddress: '192.168.1.201', installDirectory: 'D:\\Runner1\\instance', status: 'online' },
    { runnerId: 'r2', name: '服务器201', ipAddress: '192.168.1.201', installDirectory: 'D:\\Runner2\\instance', status: 'offline' },
  ] as RunnerInstance[])
  vi.mocked(runnerManagementApi.generatedDeployments).mockResolvedValue({ items: [job], total: 1 })
  vi.mocked(runnerManagementApi.saveDeploymentResources).mockImplementation(async body => ({ items: body.items, revision: 'rev2' }))
  vi.mocked(runnerManagementApi.generatedDeploymentAction).mockResolvedValue(job)
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(query: Record<string, string> = {}, admin = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'read']
  const w = mount(DeploymentResourcesTab, { global: { plugins: [pinia, router, ElementPlus], stubs: { DeploymentRuntimeActions: true } }, attachTo: document.body })
  wrappers.push(w); await flushPromises(); return w
}
it('配置链接进入部署记录，已完成记录仅提供程序与日志操作', async () => {
  const w = await setup({ configId: '1401218' })
  expect(runnerManagementApi.generatedDeployments).toHaveBeenCalledWith(expect.objectContaining({ configId: '1401218' }))
  expect(w.text()).toContain('部署成功'); expect(w.text()).toContain('2026-11-02 09:02:00')
  expect(w.text()).not.toContain('部署此版本')
  expect(w.text()).not.toContain('发布生产')
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
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, runnerId: 'r2' }] })
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
it('资源名称和目录可直接修改并沿用最新修订号', async () => {
  const w = await setup()
  await change(w, ElInput, '列表资源名称', '新闻采集资源')
  await change(w, ElInput, '列表环境部署目录', 'news')
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenLastCalledWith({ revision: 'rev2', items: [{ ...rule, resourceName: '新闻采集资源', deploymentDirectory: 'news' }] })
})
it('在列表切换默认资源时只保留一个默认', async () => {
  const alternate = { ...rule, resourceId: 'b'.repeat(32), runnerId: 'r2', isDefault: false }
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
  expect(w.text()).toContain('网页抓取测试机')
  expect(runnerManagementApi.saveDeploymentResources).not.toHaveBeenCalled()
})

it('入口文件在当前行编辑并随资源保存', async () => {
  const w = await setup()
  expect(w.text()).toContain('入口文件')
  expect(w.text()).toContain('未设置')
  await change(w, ElInput, '列表入口文件', 'worker/main.py')
  expect(runnerManagementApi.saveDeploymentResources).toHaveBeenCalledWith({ revision: 'rev1', items: [{ ...rule, entryPoint: 'worker/main.py' }] })
  expect(w.text()).toContain('worker/main.py')
})

it('未指定资源默认入口时显示实际采用的文件名', async () => {
  vi.mocked(runnerManagementApi.deploymentResources).mockResolvedValue({ items: [{ ...rule, entryPoint: '', entryPoints: ['cn.chinahdht.com.py'] }], revision: 'rev1' })
  const w = await setup()
  expect(w.text()).toContain('cn.chinahdht.com.py')
  expect(w.text()).not.toContain('自动识别')
})
