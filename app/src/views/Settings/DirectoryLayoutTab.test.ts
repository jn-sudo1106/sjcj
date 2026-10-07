// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import { runnerManagementApi, type DirectoryLayout } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import DirectoryLayoutTab from './DirectoryLayoutTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  siteCodeCatalog: vi.fn(), codeRepositories: vi.fn(), directoryLayout: vi.fn(), codeRepositoryTree: vi.fn(),
  saveDirectoryLayout: vi.fn(), publishDirectoryLayout: vi.fn(),
} }))
afterEach(() => { vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup() {
  const layout: DirectoryLayout = { codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: '', revision: 'v1', directoryTemplate: 'packages/{configId}', entryPoint: 'main.py', nodes: [{ id: 'main', parentId: '', name: 'main.py', kind: 'file', repoId: 'repo1', sourcePath: 'src/main.py', sourceType: 'file', gitCommit: 'a'.repeat(40) }] }
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([{ codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: '', storagePath: 'src/main.py', deliveryPath: 'main.py', gitUrl: '', gitCommit: 'a'.repeat(40), scriptDigest: 'sha256:original', publishedAt: '', prompt: '', url: '', environments: [] }])
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([{ repoId: 'repo1', name: '默认仓库', path: '', remoteUrl: '', branch: 'main', isDefault: true, status: 'ACTIVE', configType: '', configTypeName: '', uploadDirectory: 'default', codeCount: 1, createdAt: '', updatedAt: '' }])
  vi.mocked(runnerManagementApi.directoryLayout).mockResolvedValue(structuredClone(layout))
  vi.mocked(runnerManagementApi.codeRepositoryTree).mockResolvedValue({ repoId: 'repo1', gitCommit: 'b'.repeat(40), items: [{ path: 'helpers', kind: 'directory', size: null, selectable: true }, { path: 'helpers/parser.py', kind: 'file', size: 20, selectable: true }] })
  vi.mocked(runnerManagementApi.saveDirectoryLayout).mockImplementation(async (value) => ({ ...JSON.parse(JSON.stringify(value)), revision: 'v2' }))
  vi.mocked(runnerManagementApi.publishDirectoryLayout).mockResolvedValue({ codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: '', storagePath: '', deliveryPath: 'main.py', gitUrl: '', gitCommit: '', scriptDigest: 'sha256:published', publishedAt: '', prompt: '', url: '' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push('/settings?tab=directory-layout'); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = ['admin']
  const wrapper = mount(DirectoryLayoutTab, { global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}
it('从右侧添加整个仓库文件夹，固定提交并保存为草稿，不自动发布', async () => {
  const wrapper = await setup()
  expect(wrapper.get('.dl-system-file').text()).toContain('version.json')
  expect(wrapper.text()).not.toContain('[版本目录]')
  const source = wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'helpers')!
  await source.trigger('click')
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.findAll('button').find(button => button.text() === '保存草稿')!.trigger('click')
  await flushPromises()
  expect(runnerManagementApi.saveDirectoryLayout).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ kind: 'folder', sourceType: 'directory', sourcePath: 'helpers', gitCommit: 'b'.repeat(40) })]) }))
  expect(runnerManagementApi.publishDirectoryLayout).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('发布前先保存改动，使用返回的新草稿版本发布到所选环境', async () => {
  const wrapper = await setup()
  await wrapper.get('input[data-testid="layout-root"]').setValue('{environment}/{queue}/{configId}')
  await wrapper.get('[data-testid="layout-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.saveDirectoryLayout).toHaveBeenCalled()
  expect(runnerManagementApi.publishDirectoryLayout).toHaveBeenCalledWith('code1', 'v2', 'test')
  expect(wrapper.text()).toContain('sha256:published')
  wrapper.unmount()
})
it('整目录可以展开为固定提交的独立文件，并同步入口重命名', async () => {
  const wrapper = await setup()
  await wrapper.find('.dl-source').findAll('.el-tree-node__content').find(node => node.text() === 'helpers')!.trigger('click')
  await wrapper.get('[data-testid="layout-add-source"]').trigger('click')
  await wrapper.get('[data-testid="layout-expand-mapping"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.codeRepositoryTree).toHaveBeenLastCalledWith('repo1', 'b'.repeat(40))
  await wrapper.find('.dl-target').findAll('.el-tree-node__content').find(node => node.text() === 'parser.py')!.trigger('click')
  await wrapper.get('input[data-testid="layout-node-name"]').setValue('extract.py')
  await wrapper.findAll('button').find(button => button.text() === '设为执行入口')!.trigger('click')
  await wrapper.findAll('button').find(button => button.text() === '保存草稿')!.trigger('click')
  await flushPromises()
  expect(runnerManagementApi.saveDirectoryLayout).toHaveBeenCalledWith(expect.objectContaining({ entryPoint: 'helpers/extract.py', nodes: expect.arrayContaining([expect.objectContaining({ name: 'extract.py', sourcePath: 'helpers/parser.py', sourceType: 'file', gitCommit: 'b'.repeat(40) })]) }))
  wrapper.unmount()
})
it('保存失败保留编辑内容，并停止发布', async () => {
  const wrapper = await setup()
  vi.mocked(runnerManagementApi.saveDirectoryLayout).mockRejectedValue(new Error('配置冲突，请刷新'))
  await wrapper.get('input[data-testid="layout-entry"]').setValue('src/main.py')
  await wrapper.get('[data-testid="layout-publish"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('配置冲突，请刷新')
  expect((wrapper.get('input[data-testid="layout-entry"]').element as HTMLInputElement).value).toBe('src/main.py')
  expect(runnerManagementApi.publishDirectoryLayout).not.toHaveBeenCalled()
  wrapper.unmount()
})
