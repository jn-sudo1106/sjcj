// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type DeploymentConfiguration } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import { configApi, flowCenterApi } from '@/api'
import DirectoryLayoutTab from './DirectoryLayoutTab.vue'
import DeploymentNodePicker from './DeploymentNodePicker.vue'
import DeploymentConfigurationList from './DeploymentConfigurationList.vue'

vi.mock('@/api', () => ({ configApi: { configDetail: vi.fn() }, flowCenterApi: { paged: vi.fn(), steps: vi.fn() } }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { siteCodeCatalog: vi.fn(), codeRepositories: vi.fn(), deploymentConfigurations: vi.fn(), deploymentConfiguration: vi.fn(), saveDeploymentConfiguration: vi.fn(), codeRepositoryTree: vi.fn(), codeRepositoryFileMetadata: vi.fn(), directoryLayout: vi.fn(), runtimeConfigurations: vi.fn() } }))
const origin = { flowId: 'flow1', flowName: '新闻流程', stepId: 'step1', nodeName: '列表抓取', configId: '123' }
const base: DeploymentConfiguration = { deploymentId: 'a'.repeat(32), name: '新闻生产配置', pathStyle: 'config', legacyType: 'config', legacyOwner: '123', codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: '', revision: 'v1', directoryTemplate: '{configId}/prod', entryPoint: 'main.py', nodes: [{ id: 'main', parentId: '', name: 'main.py', kind: 'file', repoId: 'repo1', sourcePath: 'src/main.py', sourceType: 'file', gitCommit: 'a'.repeat(40) }] }
const second = { ...base, deploymentId: 'b'.repeat(32), name: '公共模块', pathStyle: 'custom' as const, configId: '', directoryTemplate: 'shared/python', entryPoint: '' }
beforeEach(() => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([])
  vi.mocked(flowCenterApi.paged).mockResolvedValue({ list: [], total: 0 })
  vi.mocked(configApi.configDetail).mockResolvedValue({ configId: '123', name: '列表配置', topic: 'news_list', enabled: true })
  vi.mocked(runnerManagementApi.directoryLayout).mockResolvedValue(structuredClone(base))
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([{ codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: 'www.example.com', storagePath: 'main.py', deliveryPath: 'main.py', scriptDigest: 'sha256:a', gitUrl: '', gitCommit: 'a'.repeat(40), publishedAt: '', prompt: '', url: '', environments: [] }])
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([{ repoId: 'repo1', name: '默认仓库', path: '', remoteUrl: '', branch: 'main', isDefault: true, status: 'ACTIVE', configType: '', configTypeName: '', uploadDirectory: 'default', codeCount: 1, createdAt: '', updatedAt: '' }])
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([structuredClone(base), structuredClone(second)])
  vi.mocked(runnerManagementApi.deploymentConfiguration).mockImplementation(async id => structuredClone(id === second.deploymentId ? second : base))
  vi.mocked(runnerManagementApi.codeRepositoryTree).mockResolvedValue({ repoId: 'repo1', gitCommit: 'b'.repeat(40), items: [{ path: 'helpers', kind: 'directory', size: null, selectable: true }, { path: 'helpers/parser.py', kind: 'file', size: 20, selectable: true }] })
  vi.mocked(runnerManagementApi.codeRepositoryFileMetadata).mockResolvedValue({ repoId: 'repo1', path: 'helpers/parser.py', gitCommit: 'b'.repeat(40), fileCommit: 'a'.repeat(40), createdAt: '2026-10-01T09:00:00+08:00', updatedAt: '2026-10-05T10:00:00+08:00' })
  vi.mocked(runnerManagementApi.saveDeploymentConfiguration).mockImplementation(async value => ({ ...JSON.parse(JSON.stringify(value)), deploymentId: value.deploymentId || 'c'.repeat(32), revision: 'v2' }))
})
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup(query: Record<string, string> = { deploymentId: base.deploymentId }, admin = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query: { tab: 'directory-layout', ...query } }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [admin ? 'admin' : 'viewer']
  const wrapper = mount(DirectoryLayoutTab, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body }); await flushPromises(); return wrapper
}
it('旧节点配置链接仍能定位，返回列表后点击名称打开另一部署', async () => {
  const wrapper = await setup({ configId: '123' })
  expect(wrapper.text()).toContain(base.deploymentId)
  expect(wrapper.find('[data-testid="deployment-select"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="layout-binding-type"]').exists()).toBe(false)
  await wrapper.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  await wrapper.get(`[data-testid="deployment-open-${second.deploymentId}"]`).trigger('click'); await flushPromises()
  expect(runnerManagementApi.deploymentConfiguration).toHaveBeenCalledWith(second.deploymentId)
  expect(wrapper.get('[data-testid="deployment-name"]').element).toHaveProperty('value', second.name)
  wrapper.unmount()
})
it('默认进入列表，组合查询与分页在编辑返回后保留，查询失败不会误显示机器数为零', async () => {
  const wrapper = await setup({})
  expect(wrapper.find('[data-testid="layout-settings"]').exists()).toBe(false)
  expect(runnerManagementApi.siteCodeCatalog).not.toHaveBeenCalled()
  await wrapper.get('input[aria-label="查询部署名称"]').setValue('新闻')
  await wrapper.get('[data-testid="deployment-search"]').trigger('click')
  await wrapper.get(`[data-testid="deployment-open-${base.deploymentId}"]`).trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="layout-settings"]').isVisible()).toBe(true)
  await wrapper.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  expect(wrapper.get('input[aria-label="查询部署名称"]').element).toHaveProperty('value', '新闻')
  expect(wrapper.find(`[data-testid="deployment-open-${second.deploymentId}"]`).exists()).toBe(false)
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockRejectedValue(new Error('offline'))
  await wrapper.get('button[aria-label="刷新部署列表"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('绑定机器数加载失败')
  expect(wrapper.getComponent(DeploymentConfigurationList).props('runtimes')).toBeNull()
  expect(wrapper.find(`[data-testid="deployment-open-${base.deploymentId}"]`).exists()).toBe(true)
  wrapper.unmount()
})
it('配置改名保留部署 ID，保存使用独立配置接口', async () => {
  const wrapper = await setup()
  await wrapper.get('[data-testid="deployment-name"]').setValue('改名的抓取配置')
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: base.deploymentId, name: '改名的抓取配置', configId: '123' }))
  expect(wrapper.text()).toContain(base.deploymentId)
  wrapper.unmount()
})
it('从流程节点创建时带入本地节点配置和已有目录映射，保存保留来源', async () => {
  const wrapper = await setup({})
  await wrapper.get('[data-testid="deployment-new"]').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-testid="deployment-name"]').exists()).toBe(false)
  wrapper.getComponent(DeploymentNodePicker).vm.$emit('select', origin); await flushPromises()
  expect(configApi.configDetail).toHaveBeenCalledWith('123', { backendScope: 'flow' })
  expect(runnerManagementApi.directoryLayout).toHaveBeenCalledWith('123')
  expect(wrapper.get('[data-testid="deployment-origin"]').text()).toContain('新闻流程 / 列表抓取')
  expect(wrapper.text()).toContain('保存后生成')
  await wrapper.get('[data-testid="deployment-style"] input[value="queue"]').setValue(true)
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: '', name: '列表配置', sourceNode: origin, configId: '123', queueName: 'news_list', codeId: 'code1', nodes: base.nodes, entryPoint: 'main.py', directoryTemplate: '{queue}' }))
  expect(wrapper.text()).toContain('c'.repeat(32))
  await wrapper.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  expect(wrapper.get(`[data-testid="deployment-open-${'c'.repeat(32)}"]`).text()).toBe('列表配置')
  wrapper.unmount()
})
it('节点尚无代码时创建来源明确的空目录，不使用其他节点的队列或映射', async () => {
  const wrapper = await setup()
  vi.mocked(configApi.configDetail).mockResolvedValue({ configId: '456', name: '无代码节点', enabled: true })
  wrapper.getComponent(DeploymentNodePicker).vm.$emit('select', { ...origin, configId: '456' }); await flushPromises()
  expect(runnerManagementApi.directoryLayout).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="deployment-style"] input[value="queue"]').setValue(true)
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ configId: '456', queueName: '', codeId: '', nodes: [], sourceNode: { ...origin, configId: '456' } }))
  wrapper.unmount()
})
it('来源读取失败保留原配置，空列表不自动产生无来源草稿', async () => {
  const wrapper = await setup()
  vi.mocked(runnerManagementApi.directoryLayout).mockRejectedValue(new Error('目录读取失败'))
  wrapper.getComponent(DeploymentNodePicker).vm.$emit('select', origin); await flushPromises()
  expect(wrapper.get('[data-testid="deployment-name"]').element).toHaveProperty('value', base.name)
  expect(wrapper.getComponent(DeploymentNodePicker).props('error')).toBe('目录读取失败')
  wrapper.unmount()
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([])
  const empty = await setup({})
  expect(empty.find('[data-testid="layout-save"]').exists()).toBe(false)
  expect(empty.text()).toContain('暂无部署配置')
  empty.unmount()
})
it('快捷格式和目录类型只修改根路径，不改变部署配置 ID', async () => {
  const wrapper = await setup()
  const select = (id: string) => wrapper.findAllComponents({ name: 'ElSelect' }).find(item => item.attributes('data-testid') === id)!
  await wrapper.get('[data-testid="deployment-style"] input[value="queue"]').setValue(true); await flushPromises()
  select('layout-environment').vm.$emit('update:modelValue', 'test'); await flushPromises()
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ deploymentId: base.deploymentId, pathStyle: 'queue', directoryTemplate: '{queue}/test' }))
  wrapper.unmount()
})
it('完整文件夹映射保留仓库和固定提交，使用 version.json 维护版本', async () => {
  const wrapper = await setup()
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'helpers')!.trigger('click')
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ sourcePath: 'helpers', sourceType: 'directory', gitCommit: 'b'.repeat(40) })]) }))
  expect(wrapper.get('.dl-system-file').text()).toContain('version.json')
  expect(wrapper.find('[data-testid="layout-publish"]').exists()).toBe(false)
  wrapper.unmount()
})
it('新增文件和文件夹后保留原执行入口，选择其他映射仍展示当前启动文件', async () => {
  const wrapper = await setup()
  expect(wrapper.get('[data-testid="layout-current-entry"]').text()).toBe('启动文件：main.py')
  await wrapper.get('input[aria-label="查找仓库代码"]').setValue('parser'); await flushPromises()
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'parser.py')!.trigger('click')
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  expect(wrapper.get('[data-testid="layout-current-entry"]').text()).toBe('启动文件：main.py')
  await wrapper.get('[data-testid="layout-add-folder"]').trigger('click')
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'main.py', nodes: expect.arrayContaining([
    expect.objectContaining({ name: 'main.py' }), expect.objectContaining({ name: 'parser.py' }), expect.objectContaining({ kind: 'folder', name: '新建文件夹' }),
  ]) }))
  expect(wrapper.get('[data-testid="layout-current-entry"]').text()).toBe('启动文件：main.py')
  wrapper.unmount()
})
it('移除其他映射保留入口，确认移除入口文件才清除启动文件', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const wrapper = await setup()
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'helpers')!.trigger('click')
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.findAll('button').find(button => button.text() === '移除映射')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="layout-current-entry"]').text()).toBe('启动文件：main.py')
  await wrapper.find('.dl-target').findAll('.el-tree-node__content').find(node => node.text().includes('main.py'))!.trigger('click')
  await wrapper.findAll('button').find(button => button.text() === '移除映射')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="layout-current-entry"]').text()).toBe('启动文件：未设置')
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: '', nodes: [] }))
  wrapper.unmount()
})
it('点击仓库文件显示创建时间和文件版本，关联仍固定在当前仓库快照', async () => {
  const wrapper = await setup()
  await wrapper.get('input[aria-label="查找仓库代码"]').setValue('parser'); await flushPromises()
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'parser.py')!.trigger('click'); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFileMetadata).toHaveBeenCalledWith('repo1', 'helpers/parser.py', 'b'.repeat(40))
  expect(wrapper.get('[data-testid="layout-file-created-at"]').attributes('datetime')).toBe('2026-10-01T09:00:00+08:00')
  expect(wrapper.get('[data-testid="layout-file-version"]').text()).toBe('a'.repeat(12))
  expect(wrapper.get('[data-testid="layout-file-version"]').attributes('title')).toContain('a'.repeat(40))
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ sourcePath: 'helpers/parser.py', gitCommit: 'b'.repeat(40) })]) }))
  wrapper.unmount()
})
it('切换文件忽略上一个文件迟到的版本信息，选择文件夹后不展示文件时间', async () => {
  vi.mocked(runnerManagementApi.codeRepositoryTree).mockResolvedValue({ repoId: 'repo1', gitCommit: 'b'.repeat(40), items: [
    { path: 'helpers', kind: 'directory', size: null, selectable: true },
    { path: 'helpers/parser.py', kind: 'file', size: 20, selectable: true },
    { path: 'helpers/worker.py', kind: 'file', size: 20, selectable: true },
  ] })
  let resolveOld!: (value: Awaited<ReturnType<typeof runnerManagementApi.codeRepositoryFileMetadata>>) => void
  const metadata = { repoId: 'repo1', path: 'helpers/worker.py', gitCommit: 'b'.repeat(40), fileCommit: 'c'.repeat(40), createdAt: '2026-10-02T09:00:00+08:00', updatedAt: '2026-10-05T10:00:00+08:00' }
  vi.mocked(runnerManagementApi.codeRepositoryFileMetadata).mockImplementation(async (_repo, path) => path.endsWith('parser.py') ? new Promise(resolve => { resolveOld = resolve }) : metadata)
  const wrapper = await setup()
  await wrapper.get('input[aria-label="查找仓库代码"]').setValue('py'); await flushPromises()
  const node = (name: string) => wrapper.find('.dl-source').findAll('.el-tree-node__content').find(item => item.text() === name)!
  await node('parser.py').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="layout-file-metadata"]').text()).toContain('正在读取')
  await node('worker.py').trigger('click'); await flushPromises()
  resolveOld({ ...metadata, path: 'helpers/parser.py', fileCommit: 'a'.repeat(40) }); await flushPromises()
  expect(wrapper.get('[data-testid="layout-file-version"]').text()).toBe('c'.repeat(12))
  await node('helpers').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-testid="layout-file-metadata"]').exists()).toBe(false)
  wrapper.unmount()
})
it('文件信息加载失败可重试，不阻止关联代码', async () => {
  vi.mocked(runnerManagementApi.codeRepositoryFileMetadata).mockRejectedValueOnce(new Error('网络异常'))
  const wrapper = await setup()
  await wrapper.get('input[aria-label="查找仓库代码"]').setValue('parser'); await flushPromises()
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'parser.py')!.trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="layout-file-metadata"]').text()).toContain('网络异常')
  expect(wrapper.get('[data-testid="layout-add-source"]').attributes('disabled')).toBeUndefined()
  await wrapper.get('[data-testid="layout-file-metadata-retry"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="layout-file-version"]').text()).toBe('a'.repeat(12))
  wrapper.unmount()
})
it('选择目标目录显示关联位置，返回根目录后代码关联到根目录并保留入口重命名', async () => {
  const wrapper = await setup()
  await wrapper.find('.dl-target').findAll('.el-tree-node__content').find(node => node.text().includes('main.py'))!.trigger('click')
  await wrapper.get('[data-testid="layout-node-name"]').setValue('worker.py')
  await wrapper.get('[data-testid="layout-add-folder"]').trigger('click')
  await wrapper.get('[data-testid="layout-node-name"]').setValue('tools')
  expect(wrapper.get('[data-testid="layout-add-destination"]').text()).toContain('tools')
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'helpers')!.trigger('click')
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.get('[data-testid="layout-select-root"]').trigger('click')
  expect(wrapper.get('[data-testid="layout-add-destination"]').text()).toContain('根目录')
  expect(wrapper.find('[data-testid="layout-node-settings"]').exists()).toBe(false)
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  const saved = vi.mocked(runnerManagementApi.saveDeploymentConfiguration).mock.calls[0]![0]
  const folder = saved.nodes.find(node => node.name === 'tools')!
  expect(saved.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'helpers', parentId: folder.id, sourcePath: 'helpers' }),
    expect.objectContaining({ name: 'helpers', parentId: '', sourcePath: 'helpers' }),
  ]))
  expect(saved.entryPoint).toBe('worker.py')
  wrapper.unmount()
})
it('切换时取消放弃操作保留未保存名称，服务失败保留草稿', async () => {
  const wrapper = await setup()
  await wrapper.get('[data-testid="deployment-name"]').setValue('未保存名称')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  await wrapper.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deploymentConfiguration).not.toHaveBeenCalled()
  vi.mocked(runnerManagementApi.saveDeploymentConfiguration).mockRejectedValue(new Error('配置已被修改'))
  await wrapper.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('配置已被修改')
  expect(wrapper.get('[data-testid="deployment-name"]').element).toHaveProperty('value', '未保存名称')
  wrapper.unmount()
})
it('只读用户可查看部署配置，不能新建和保存', async () => {
  const wrapper = await setup({ deploymentId: second.deploymentId }, false)
  expect(wrapper.text()).toContain(second.deploymentId)
  expect(wrapper.find('[data-testid="deployment-new"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="layout-save"]').exists()).toBe(false)
  expect(wrapper.get('[data-testid="deployment-name"]').attributes('readonly')).toBeDefined()
  wrapper.unmount()
})
