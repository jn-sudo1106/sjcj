// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type DeploymentConfiguration, type RuntimeConfiguration } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import { configApi, flowCenterApi } from '@/api'
import DirectoryLayoutTab from './DirectoryLayoutTab.vue'
import DeploymentNodePicker from './DeploymentNodePicker.vue'

vi.mock('@/api', () => ({ configApi: { configDetail: vi.fn(), configDetailRaw: vi.fn() }, sourceApi: { sourcePaged: vi.fn() }, flowCenterApi: { paged: vi.fn(), steps: vi.fn() } }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { siteCodeCatalog: vi.fn(), codeRepositories: vi.fn(), deploymentConfigurations: vi.fn(), deploymentConfiguration: vi.fn(), saveDeploymentConfiguration: vi.fn(), deleteDeploymentConfiguration: vi.fn(), codeRepositoryTree: vi.fn(), codeRepositoryFileMetadata: vi.fn(), browseCodeRepository: vi.fn(), instances: vi.fn(), directoryLayout: vi.fn(), saveRuntimeConfiguration: vi.fn(), runtimeConfigurations: vi.fn() } }))
vi.mock('./RunnerFilesDrawer.vue', () => ({ default: { name: 'RunnerFilesDrawer', props: { runner: Object, directory: String, embedded: Boolean }, template: '<div data-testid="actual-runner-browser" />' } }))
const origin = { flowId: 'flow1', flowName: '新闻流程', stepId: 'step1', nodeName: '列表抓取', configId: '123' }
const base: DeploymentConfiguration = { deploymentId: 'a'.repeat(32), name: '新闻生产配置', pathStyle: 'config', legacyType: 'config', legacyOwner: '123', codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: '', revision: 'v1', directoryTemplate: '{configId}/prod', entryPoint: 'main.py', nodes: [{ id: 'main', parentId: '', name: 'main.py', kind: 'file', repoId: 'repo1', sourcePath: 'src/main.py', sourceType: 'file', gitCommit: 'a'.repeat(40) }] }
const second = { ...base, deploymentId: 'b'.repeat(32), name: '公共模块', pathStyle: 'custom' as const, configId: '', directoryTemplate: 'shared/python', entryPoint: '' }
beforeEach(() => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([])
  vi.mocked(runnerManagementApi.saveRuntimeConfiguration).mockResolvedValue({ runtimeId: 'manual-runtime', runnerId: 'runner-1', deploymentId: 'c'.repeat(32) } as RuntimeConfiguration)
  vi.mocked(runnerManagementApi.deleteDeploymentConfiguration).mockResolvedValue({ ok: true })
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

it('目标目录支持文件名和完整路径搜索，保留父目录，清空恢复且不修改配置', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...structuredClone(base), directoryTemplate: 'links/1401218', nodes: [
    { id: 'bin', parentId: '', kind: 'folder', name: 'bin' },
    { id: 'parser', parentId: 'bin', kind: 'file', name: 'Parser.py', repoId: 'repo1', sourcePath: 'helpers/parser.py', gitCommit: 'a'.repeat(40) },
    { id: 'other', parentId: '', kind: 'file', name: 'other.py', repoId: 'repo1', sourcePath: 'other.py', gitCommit: 'a'.repeat(40) },
  ] }])
  const w = await setup()
  const search = w.get('input[aria-label="搜索目标目录"]')
  const visibleIds = () => w.get('[data-testid="layout-target-tree"]').findAll('.el-tree-node').filter(node => node.isVisible()).map(node => node.attributes('data-key'))
  await search.setValue('PARSER.PY'); await flushPromises()
  expect(visibleIds()).toEqual(['bin', 'parser'])
  expect(w.get('.dl-system-file').isVisible()).toBe(false)
  await search.setValue('links\\1401218\\bin'); await flushPromises()
  expect(visibleIds()).toEqual(['bin', 'parser'])
  await search.setValue('不存在.py'); await flushPromises()
  expect(visibleIds()).toEqual([])
  expect(w.get('[data-testid="layout-target-tree"]').text()).toContain('没有匹配的文件或目录')
  await search.setValue(''); await flushPromises()
  expect(visibleIds()).toEqual(['bin', 'parser', 'other'])
  expect(w.get('.dl-system-file').isVisible()).toBe(true)
  expect(runnerManagementApi.saveDeploymentConfiguration).not.toHaveBeenCalled()
  expect(w.get('[data-testid="layout-save"]').attributes('disabled')).toBeDefined()
  w.unmount()
})
it('编辑目录自动选中映射仓库，展开对应的源目录并定位到该目录', async () => {
  const current = { ...base, nodes: [{ ...base.nodes[0]!, sourcePath: 'links/1401218/main.py' }] }
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([current])
  vi.mocked(runnerManagementApi.codeRepositoryTree).mockResolvedValue({ repoId: 'repo1', gitCommit: 'b'.repeat(40), items: [
    { path: 'links', kind: 'directory', size: null, selectable: true },
    { path: 'links/1401218', kind: 'directory', size: null, selectable: true },
    { path: 'links/1401218/main.py', kind: 'file', size: 20, selectable: true },
  ] })
  const w = await setup()
  const tree = w.find('.dl-source').findComponent({ name: 'ElTree' })
  expect(tree.props('defaultExpandedKeys')).toEqual(['links', 'links/1401218'])
  expect(tree.props('currentNodeKey')).toBe('links/1401218')
  expect(tree.find('.el-tree-node.is-current')?.attributes('data-key')).toBe('links/1401218')
  w.unmount()
})
it('在同一编辑页面查看选定机器的实际目录，未保存的目录修改不会改变浏览目标', async () => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ runtimeId: 'actual-runtime', deploymentId: base.deploymentId, runnerId: 'runner-1', directoryTemplate: 'saved/path',
    binding: { delivery: { installedPath: 'D:\\runner-one\\saved\\path' } } } as RuntimeConfiguration])
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ runnerId: 'runner-1', status: 'online', installDirectory: 'D:\\runner-one', ipAddress: '10.0.0.1' }] as never)
  const w = await setup({ deploymentId: base.deploymentId, returnTab: 'runners', runnerId: 'runner-1', runtimeId: 'actual-runtime' })
  expect(runnerManagementApi.instances).not.toHaveBeenCalled()
  await w.get('[data-testid="layout-root"]').setValue('unsaved/new-path')
  await w.get('[data-testid="layout-view-machine"]').trigger('click'); await flushPromises()
  const browser = w.getComponent({ name: 'RunnerFilesDrawer' })
  expect(browser.props('runner').runnerId).toBe('runner-1')
  expect(browser.props('directory')).toBe('D:\\runner-one\\saved\\path')
  expect(browser.props('embedded')).toBe(true)
  expect(w.find('[data-testid="layout-target-tree"]').exists()).toBe(false)
  await w.get('[data-testid="layout-view-mapping"]').trigger('click'); await flushPromises()
  expect(w.get('[data-testid="layout-root"]').element).toHaveProperty('value', 'unsaved/new-path')
  expect(runnerManagementApi.saveDeploymentConfiguration).not.toHaveBeenCalled()
  w.unmount()
})
it('机器离线明确提示，不将配置映射伪装成机器文件，也不发起文件请求', async () => {
  vi.mocked(runnerManagementApi.runtimeConfigurations).mockResolvedValue([{ runtimeId: 'actual-runtime', deploymentId: base.deploymentId, runnerId: 'runner-1' } as RuntimeConfiguration])
  vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ runnerId: 'runner-1', status: 'offline', installDirectory: 'D:\\runner-one' }] as never)
  const w = await setup({ deploymentId: base.deploymentId, returnTab: 'runners', runnerId: 'runner-1' }, false)
  await w.get('[data-testid="layout-view-machine"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('Runner 实例离线，暂时无法浏览机器真实文件')
  expect(w.findComponent({ name: 'RunnerFilesDrawer' }).exists()).toBe(false)
  expect(w.find('[data-testid="layout-save"]').exists()).toBe(false)
  w.unmount()
})
it('Git 文件在同页抽屉预览，使用选中文件的实际提交，空文件也正常展示', async () => {
  vi.mocked(runnerManagementApi.browseCodeRepository).mockResolvedValue({ path: 'helpers/parser.py', gitCommit: 'b'.repeat(40), content: '', size: 0 })
  const w = await setup()
  w.find('.dl-source').getComponent({ name: 'ElTree' }).vm.$emit('node-click', { id: 'helpers/parser.py', name: 'parser.py', path: 'helpers/parser.py', kind: 'file', selectable: true })
  await flushPromises()
  await w.get('[data-testid="layout-preview-source-file"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.browseCodeRepository).toHaveBeenCalledWith('repo1', 'b'.repeat(40), 'helpers/parser.py', 'read')
  expect(document.body.querySelector('[data-testid="layout-file-content"]')?.textContent).toBe('')
  expect(runnerManagementApi.saveDeploymentConfiguration).not.toHaveBeenCalled()
  w.unmount()
})
it('整目录映射内的 Git 文件仍可设为共享入口，不需要额外创建文件映射', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([{ ...base, nodes: [{ id: 'folder', parentId: '', name: 'app', kind: 'folder', repoId: 'repo1', sourcePath: 'helpers', sourceType: 'directory', gitCommit: 'b'.repeat(40) }] }])
  const w = await setup()
  w.find('.dl-source').getComponent({ name: 'ElTree' }).vm.$emit('node-click', { id: 'helpers/parser.py', name: 'parser.py', path: 'helpers/parser.py', kind: 'file', selectable: true })
  await flushPromises()
  await w.get('[data-testid="layout-source-set-entry"]').trigger('click'); await flushPromises()
  expect(w.get('[data-testid="layout-current-entry"]').text()).toContain('app/parser.py')
  await w.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'app/parser.py', nodes: [expect.objectContaining({ sourceType: 'directory' })] }))
  expect(runnerManagementApi.saveRuntimeConfiguration).not.toHaveBeenCalled()
  w.unmount()
})
it('从机器部署配置打开目录详情后返回原机器，不进入手工部署列表', async () => {
  const w = await setup({ deploymentId: base.deploymentId, returnTab: 'runners', runnerId: 'runner-1' })
  await w.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  expect(w.vm.$router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'runner-1' })
  w.unmount()
})
it('手工新建直接打开表单，保存后关联当前机器', async () => {
  vi.mocked(runnerManagementApi.deploymentConfigurations).mockResolvedValue([base, { ...second, managedBy: 'generated-code' }])
  const w = await setup({ create: '1', returnTab: 'runners', runnerId: 'runner-1' })
  expect(w.get('[data-testid="deployment-name"]').element).toHaveProperty('value', '新建部署')
  await w.get('[data-testid="deployment-import-node"]').trigger('click'); await flushPromises()
  w.getComponent(DeploymentNodePicker).vm.$emit('select', origin); await flushPromises()
  await w.get('[data-testid="layout-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveRuntimeConfiguration).toHaveBeenCalledWith(expect.objectContaining({
    deploymentId: 'c'.repeat(32), layoutRevision: 'v2', runnerId: 'runner-1', concurrency: 1,
  }))
  await w.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  expect(w.vm.$router.currentRoute.value.query).toEqual({ tab: 'runners', runnerId: 'runner-1' })
  w.unmount()
})
it('旧节点配置链接仍能定位，返回统一部署配置页面', async () => {
  const w = await setup({ configId: '123' })
  expect(w.text()).toContain(base.deploymentId)
  await w.get('[data-testid="deployment-back"]').trigger('click'); await flushPromises()
  expect(w.vm.$router.currentRoute.value.query.tab).toBe('runners')
  w.unmount()
})
it('旧部署配置列表地址重定向到统一部署配置，不再展示独立列表', async () => {
  const w = await setup({})
  expect(w.vm.$router.currentRoute.value.query.tab).toBe('runners')
  expect(w.find('[data-testid="deployment-new"]').exists()).toBe(false)
  expect(runnerManagementApi.deploymentConfigurations).not.toHaveBeenCalled()
  w.unmount()
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
  const wrapper = await setup({ create: '1' })
  await wrapper.get('[data-testid="deployment-import-node"]').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-testid="deployment-name"]').exists()).toBe(true)
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
  expect(wrapper.vm.$router.currentRoute.value.query.tab).toBe('runners')
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
  expect(empty.vm.$router.currentRoute.value.query.tab).toBe('runners')
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
