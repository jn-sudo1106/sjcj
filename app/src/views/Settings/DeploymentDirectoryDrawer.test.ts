// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { runnerManagementApi as api, type DeploymentConfiguration, type RunnerInstance, type RuntimeConfiguration } from '@/api/runnerManagement'
import DeploymentDirectoryDrawer from './DeploymentDirectoryDrawer.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { browseCodeRepository: vi.fn(), saveDeploymentEntry: vi.fn() } }))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); document.body.innerHTML = '' })
const commit = 'a'.repeat(40)
async function setup(canSetEntry = false) {
  wrapper = mount(DeploymentDirectoryDrawer, { props: {
    layout: { deploymentId: 'd', revision: 'layout-v1', nodes: [{ id: 'main', parentId: '', kind: 'file', name: 'run.py', repoId: 'repo', sourcePath: 'links/1401218/newslink.py', gitCommit: commit }, { id: 'site', parentId: '', kind: 'file', name: 'site.py', repoId: 'repo', sourcePath: 'links/1401218/sites/site.py', gitCommit: commit }] } as DeploymentConfiguration,
    runtime: { runtimeId: 'runtime-1', revision: 'runtime-v1', entryPoint: '', assignment: null } as RuntimeConfiguration, canSetEntry,
    runner: { runnerId: 'r172', ipAddress: '192.168.1.172' } as RunnerInstance,
    directory: 'D:\\Runner2\\instance\\links\\1401218', repositories: [],
  }, global: { plugins: [ElementPlus], stubs: { RunnerFilesDrawer: { name: 'RunnerFilesDrawer', props: { runner: Object, directory: String, embedded: Boolean }, template: '<div data-testid="live-files" />' } } }, attachTo: document.body })
  await flushPromises()
  return wrapper
}
it('按配置固定提交查看 Git 文件，并将实际部署目录交给 Runner 实时读取', async () => {
  vi.mocked(api.browseCodeRepository).mockResolvedValue({ path: 'links/1401218', gitCommit: commit, items: [{ path: 'links/1401218/newslink.py', name: 'newslink.py', isDirectory: false, size: 20 }] })
  const w = await setup()
  expect(api.browseCodeRepository).toHaveBeenCalledWith('repo', commit, 'links/1401218', 'list')
  const live = w.getComponent({ name: 'RunnerFilesDrawer' })
  expect(live.props()).toMatchObject({ runner: { runnerId: 'r172' }, directory: 'D:\\Runner2\\instance\\links\\1401218', embedded: true })
  vi.mocked(api.browseCodeRepository).mockResolvedValue({ path: 'links/1401218/newslink.py', gitCommit: commit, content: 'print("pinned code")' })
  ;[...document.body.querySelectorAll('button')].find(item => item.textContent?.includes('newslink.py'))!.click()
  await flushPromises()
  expect(document.body.querySelector('[data-testid="git-file-content"]')?.textContent).toContain('pinned code')
})
it('错误结构和读取失败明确显示原因，不把旧 Git 树响应显示成空目录', async () => {
  vi.mocked(api.browseCodeRepository).mockResolvedValue({ gitCommit: commit, files: [] } as never)
  await setup()
  expect(document.body.textContent).toContain('Git 目录响应不完整')
  vi.mocked(api.browseCodeRepository).mockRejectedValue(new Error('配置中的 Git 版本或路径不存在'))
  document.body.querySelector<HTMLButtonElement>('[aria-label="刷新 Git 目录"]')!.click(); await flushPromises()
  expect(document.body.textContent).toContain('配置中的 Git 版本或路径不存在')
})
it('从目录文件设置入口使用目标映射路径，成功后返回采用的运行配置', async () => {
  vi.mocked(api.browseCodeRepository).mockResolvedValue({ path: 'links/1401218', gitCommit: commit, items: [{ path: 'links/1401218/newslink.py', name: 'newslink.py', isDirectory: false, size: 20 }] })
  const adopted = { deploymentId: 'd', revision: 'layout-v2', entryPoint: 'run.py' } as DeploymentConfiguration
  vi.mocked(api.saveDeploymentEntry).mockResolvedValue({ items: [adopted] })
  const w = await setup(true)
  expect(api.saveDeploymentEntry).not.toHaveBeenCalled()
  document.body.querySelector<HTMLButtonElement>('[data-testid="git-set-entry"]')!.click(); await flushPromises()
  expect(api.saveDeploymentEntry).toHaveBeenCalledWith('d', { entryPoint: 'run.py', revision: 'layout-v1' })
  expect(w.emitted('entrySaved')).toEqual([[[adopted]]])
})
it('目标机器只浏览文件，入口只在 Git 配置中保存，失败时保留原配置', async () => {
  vi.mocked(api.browseCodeRepository).mockResolvedValue({ path: 'links/1401218', gitCommit: commit, items: [{ path: 'links/1401218/newslink.py', name: 'newslink.py', isDirectory: false, size: 20 }] })
  vi.mocked(api.saveDeploymentEntry).mockRejectedValue(new Error('配置已更新，请刷新后重新选择启动文件'))
  const w = await setup(true)
  expect(w.getComponent({ name: 'RunnerFilesDrawer' }).attributes('allow-set-entry')).toBeUndefined()
  w.getComponent({ name: 'RunnerFilesDrawer' }).vm.$emit('setEntry', 'run.py'); await flushPromises()
  expect(api.saveDeploymentEntry).not.toHaveBeenCalled()
  document.body.querySelector<HTMLButtonElement>('[data-testid="git-set-entry"]')!.click(); await flushPromises()
  expect(document.body.textContent).toContain('配置已更新，请刷新后重新选择启动文件')
  expect(w.emitted('entrySaved')).toBeUndefined()
})
it('Git 中的 EXE 可直接设为入口，操作不尝试读取二进制文件预览', async () => {
  vi.mocked(api.browseCodeRepository).mockResolvedValue({ path: 'links/1401218', gitCommit: commit, items: [{ path: 'links/1401218/newslink.exe', name: 'newslink.exe', isDirectory: false, size: 25000000 }] })
  vi.mocked(api.saveDeploymentEntry).mockResolvedValue({ items: [{ deploymentId: 'd', entryPoint: 'newslink.exe' } as DeploymentConfiguration] })
  const w = await setup(true)
  await w.setProps({ layout: { deploymentId: 'd', revision: 'layout-v1', nodes: [{ id: 'exe', parentId: '', kind: 'file', name: 'newslink.exe', repoId: 'repo', sourcePath: 'links/1401218/newslink.exe', gitCommit: commit }] } as DeploymentConfiguration })
  await flushPromises()
  document.body.querySelector<HTMLButtonElement>('[data-testid="git-set-entry"]')!.click(); await flushPromises()
  expect(api.saveDeploymentEntry).toHaveBeenCalledWith('d', { entryPoint: 'newslink.exe', revision: 'layout-v1' })
  expect(vi.mocked(api.browseCodeRepository).mock.calls.every(call => call[3] === 'list')).toBe(true)
})
