// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api, type CodeGenerationServer, type RemoteCodeFile } from '@/api/runnerManagement'
import CodeGenerationServersTab from './CodeGenerationServersTab.vue'
import { sourceApi } from '@/api'

const server: CodeGenerationServer = { serverId: 'remote-1', name: '生成机器 A', endpoint: 'http://192.168.1.171:8093',
  workspace: 'D:\\aicode', installDirectory: 'D:\\code-server', ipAddress: '192.168.1.171', osType: 'Windows', osVersion: 'Windows 11',
  version: '2026.10.26.1', lastHeartbeat: '2026-10-26T14:00:00Z', status: 'online' }
const file: RemoteCodeFile = { path: 'client.py', name: 'client.py', isDirectory: false, size: 8, modifiedAt: server.lastHeartbeat, sha256: 'hash-1' }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.spyOn(sourceApi,'codeConfigOptions').mockResolvedValue([{configId:'201001',name:'AI 生成派发',topic:'code_generation',entryTypeId:1}])
  vi.spyOn(api,'bindCodeServerMq').mockResolvedValue({binding:{configId:'201001',name:'AI 生成派发',queue:'code_generation'}})
  vi.spyOn(api, 'codeServerReleases').mockResolvedValue({ items: [{ digest: 'sha256:' + 'a'.repeat(64), version: '2026.10.28.2', publishedAt: '2026-10-28T00:00:00Z' }] })
  vi.spyOn(api, 'publishCodeServer').mockResolvedValue({ digest: 'sha256:' + 'a'.repeat(64), version: '2026.10.28.2', created: false })
  vi.spyOn(api, 'upgradeCodeServers').mockResolvedValue({ items: [] })
  vi.spyOn(api, 'downloadCodeServerMigrationPackage').mockResolvedValue(new Blob())
  vi.spyOn(api, 'codeServerPackageInfo').mockResolvedValue({ platform: 'http://192.168.1.36:8092' })
  vi.spyOn(api, 'downloadCodeServerPackage').mockResolvedValue(new Blob())
  vi.spyOn(api, 'codeGenerationServers').mockResolvedValue({ items: [server] })
  vi.spyOn(api, 'modelInterfaces').mockResolvedValue({ revision: 1, items: [] })
  vi.spyOn(api, 'saveCodeServerGenerationDirectory').mockImplementation(async (serverId, generationRoot) => ({ ...server, serverId, generationRoot }))
  vi.spyOn(api, 'saveGenerationGitBinding').mockImplementation(async (_id, body) => ({ items: body.repositoryId ? [{ ...body, directoryId: body.directoryId!, repoName: '默认仓库', remoteUrl: 'https://git.example.com/code.git', branch: 'main', directoryPath: 'default' }] : [] }))
  vi.spyOn(api, 'remoteCodeFiles').mockImplementation(async (_id, body) => {
    if (body.action === 'read') return { ...file, content: 'print(1)' } as never
    if (body.action === 'write') return { ...file, sha256: 'hash-2' } as never
    return { path: body.path || '', items: body.path ? [file] : [{ ...file, name: 'news', path: 'news', isDirectory: true }, file] } as never
  })
  vi.spyOn(api, 'codeRepositories').mockResolvedValue([{ repoId: 'repo-1', name: '默认仓库', isDefault: true, status: 'ACTIVE', remoteUrl: 'https://git.example.com/code.git', branch: 'main' } as never])
  vi.spyOn(api, 'codeRepositoryDirectories').mockResolvedValue([{ directoryId: 'default', name: '默认目录', path: 'default', isDefault: true, status: 'ACTIVE' } as never])
  vi.spyOn(api, 'importRemoteCode').mockResolvedValue({ pushed: true, gitCommit: 'commit-1234567890' } as never)
})

it('自动按模型领取数据库任务，不再配置消费队列',async()=>{
  const w=await setup()
  expect(w.text()).toContain('按模型自动领取数据库任务')
  expect(w.find('[data-testid="bind-code-server-mq"]').exists()).toBe(false)
  expect(api.bindCodeServerMq).not.toHaveBeenCalled()
})

it('当前目录可绑定Git仓库和路径，已绑定目录可直接编辑和解除', async () => {
  const w = await setup()
  await w.get('[data-testid="edit-generation-git-binding"]').trigger('click'); await flushPromises()
  await w.get('[aria-label="Git 绑定生成目录"]').setValue('1401218/news_list/code')
  await w.get('[data-testid="save-generation-git-binding"]').trigger('click'); await flushPromises()
  expect(api.saveGenerationGitBinding).toHaveBeenCalledWith(server.serverId, { path: '1401218/news_list/code', repositoryId: 'repo-1', directoryId: 'default' })
  expect(w.get('.cg-bindings-list').text()).toContain('1401218/news_list/code')
  await w.get('.cg-bindings-list').findAll('button').find(button => button.text() === '编辑')!.trigger('click'); await flushPromises()
  expect(w.get<HTMLInputElement>('[aria-label="Git 绑定生成目录"]').element.value).toBe('1401218/news_list/code')
  await w.get('.cg-bindings-list').findAll('button').find(button => button.text() === '解除')!.trigger('click'); await flushPromises()
  expect(api.saveGenerationGitBinding).toHaveBeenLastCalledWith(server.serverId, { path: '1401218/news_list/code', repositoryId: '' })
  const read = await setup('read')
  expect(read.find('[data-testid="edit-generation-git-binding"]').exists()).toBe(false)
})
it('工作空间在列表行内设置，刷新保留输入，编辑其他机器不切换文件列表', async () => {
  const second = { ...server, serverId: 'remote-2', name: '生成机器 B', generationRoot: 'D:\\aicode\\projects-b' }
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [server, second] })
  const w = await setup()
  expect(w.find('[data-testid="code-server-generation-directory"]').exists()).toBe(false)
  expect(w.text()).not.toContain('默认代码目录：')
  await w.get(`[data-testid="edit-code-server-workspace-${server.serverId}"]`).trigger('click')
  const input = () => w.get<HTMLInputElement>('[aria-label="工作空间"]')
  expect(input().attributes('placeholder')).toBe(server.workspace)
  expect(input().element.value).toBe(server.workspace)
  await input().setValue('D:\\aicode\\projects-a')
  await w.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
  expect(input().element.value).toBe('D:\\aicode\\projects-a')
  await w.get('[data-testid="save-code-server-workspace"]').trigger('click'); await flushPromises()
  expect(api.saveCodeServerGenerationDirectory).toHaveBeenCalledWith(server.serverId, 'D:\\aicode\\projects-a')
  expect(w.findAll('[data-testid="code-server-workspace"]')[0]!.text()).toBe('D:\\aicode\\projects-a')
  expect(w.find('[aria-label="工作空间"]').exists()).toBe(false)
  await w.get(`[data-testid="edit-code-server-workspace-${second.serverId}"]`).trigger('click')
  expect(input().element.value).toBe(second.generationRoot)
  expect(w.get('.cg-workspace-head').text()).toContain(server.name)
  await input().setValue('')
  await w.get('[data-testid="save-code-server-workspace"]').trigger('click'); await flushPromises()
  expect(api.saveCodeServerGenerationDirectory).toHaveBeenLastCalledWith(second.serverId, '')
})
it('工作空间行内保存失败保留输入和错误，只读账号没有设置入口', async () => {
  vi.mocked(api.saveCodeServerGenerationDirectory).mockRejectedValue(new Error('生成代码目录必须位于该服务器的工作空间内'))
  const w = await setup()
  await w.get(`[data-testid="edit-code-server-workspace-${server.serverId}"]`).trigger('click')
  await w.get('[aria-label="工作空间"]').setValue('D:\\outside')
  await w.get('[data-testid="save-code-server-workspace"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('生成代码目录必须位于该服务器的工作空间内')
  expect(w.get<HTMLInputElement>('[aria-label="工作空间"]').element.value).toBe('D:\\outside')
  const read = await setup('read')
  expect(read.find(`[data-testid="edit-code-server-workspace-${server.serverId}"]`).exists()).toBe(false)
  expect(read.find('[aria-label="工作空间"]').exists()).toBe(false)
  expect(read.get('[data-testid="code-server-workspace"]').text()).toBe(server.workspace)
})
it('工作空间取消编辑不保存，仍显示原路径', async () => {
  const w = await setup()
  await w.get(`[data-testid="edit-code-server-workspace-${server.serverId}"]`).trigger('click')
  await w.get('[aria-label="工作空间"]').setValue('D:\\aicode\\changed')
  await w.findAll('button').find(button => button.text() === '取消')!.trigger('click')
  expect(api.saveCodeServerGenerationDirectory).not.toHaveBeenCalled()
  expect(w.get('[data-testid="code-server-workspace"]').text()).toBe(server.workspace)
  expect(w.find('[aria-label="工作空间"]').exists()).toBe(false)
})
it('左右分栏选择服务器切换右侧工作空间，离线机器不请求文件', async () => {
  const second: CodeGenerationServer = { ...server, serverId: 'remote-2', name: '离线机器 B', workspace: 'E:\\workspace', status: 'offline' }
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [server, second] })
  const w = await setup()
  expect(w.get('[data-testid="code-server-split-layout"] .cg-sidebar').text()).toContain(server.name)
  expect(w.get('[data-testid="code-server-remote-1"]').attributes('aria-pressed')).toBe('true')
  await w.get('[data-testid="code-server-remote-2"]').trigger('click'); await flushPromises()
  expect(w.get('[data-testid="code-server-workspace-panel"] .cg-workspace-head').text()).toContain(second.name)
  expect(w.get('[data-testid="code-server-workspace-panel"]').text()).toContain('服务器离线')
  expect(w.get('[data-testid="code-server-remote-2"]').attributes('aria-pressed')).toBe('true')
  expect(api.remoteCodeFiles).not.toHaveBeenCalledWith(second.serverId, expect.anything())
  expect(w.find('.cg-files').text()).not.toContain('client.py')
  await w.get('[data-testid="code-server-remote-1"]').trigger('keydown', { key: 'Enter' }); await flushPromises()
  expect(w.get('.cg-workspace-head').text()).toContain(server.name)
  expect(api.remoteCodeFiles).toHaveBeenLastCalledWith(server.serverId, { action: 'list', path: '' })
})
it('左侧筛选同步工作空间选择，没有匹配时清空右侧文件上下文', async () => {
  const second = { ...server, serverId: 'remote-2', name: '机器 B', ipAddress: '192.168.1.172' }
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [server, second] })
  const w = await setup()
  await w.get('[aria-label="筛选代码生成服务器"]').setValue(second.ipAddress); await flushPromises()
  expect(w.find('[data-testid="code-server-remote-1"]').exists()).toBe(false)
  expect(w.get('.cg-workspace-head').text()).toContain(second.name)
  expect(api.remoteCodeFiles).toHaveBeenLastCalledWith(second.serverId, { action: 'list', path: '' })
  await w.get('[aria-label="筛选代码生成服务器"]').setValue('no-such-server'); await flushPromises()
  expect(w.get('[data-testid="code-server-workspace-panel"]').text()).toContain('没有匹配的服务器')
  expect(w.find('.cg-files').exists()).toBe(false)
  const calls = vi.mocked(api.remoteCodeFiles).mock.calls.length
  await w.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
  expect(w.find('.cg-files').exists()).toBe(false)
  expect(api.remoteCodeFiles).toHaveBeenCalledTimes(calls)
  await w.get('[aria-label="筛选代码生成服务器"]').setValue(''); await flushPromises()
  expect(w.get('.cg-workspace-head').text()).toContain(server.name)
})
it('服务器展示按接口地址识别的模型及停用状态', async () => {
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [{ ...server, supportedModels: [
    { id: 'agent', name: 'WB Agent', model: 'hy3', kind: 'agent', endpoint: 'http://192.168.1.171:6000/wb/agent', enabled: true, generationServerMode: 'auto' },
    { id: 'gemini', name: 'Gemini Chat', model: 'gemini-lite', kind: 'gemini-chat', endpoint: 'http://192.168.1.171:6000/gemini/chat', enabled: false, generationServerMode: 'manual' },
  ] }] })
  const w = await setup()
  const matches = w.findAll('[data-testid="code-server-supported-model"]')
  expect(matches).toHaveLength(2)
  expect(matches[0]!.text()).toContain('WB Agent · hy3')
  expect(matches[0]!.text()).toContain('地址匹配')
  expect(matches[1]!.text()).toContain('已停用')
})
it('服务器信息展示服务实际报告的运行账户', async () => {
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [{ ...server, runUser: 'home171\\leo' }] })
  const w = await setup()
  expect(w.get('.cg-server-summary').text()).toContain('运行账户 home171\\leo')
  expect(w.get('.cg-server-details').text()).toContain('home171\\leo')
})
it('移除批量升级，保留单实例重试与版本管理跳转', async () => {
  const capable: CodeGenerationServer = { ...server, upgradeCapable: true, actualDigest: 'source-local', upgrade: {
    digest: 'sha256:' + 'a'.repeat(64), requestId: 'request', status: 'failed', message: '新版本健康检查失败，已回滚',
  } }
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [capable] })
  const w = await setup()
  expect(w.text()).toContain('升级失败，可重试')
  expect(w.find('[data-testid="code-server-migration-package"]').exists()).toBe(false)
  expect(w.find('[data-testid="upgrade-code-servers"]').exists()).toBe(false)
  expect(w.text()).not.toContain('升级所选')
  await w.findAll('button').find(button => button.text() === '重试升级')!.trigger('click'); await flushPromises()
  expect(api.upgradeCodeServers).toHaveBeenCalledWith([server.serverId], 'sha256:' + 'a'.repeat(64))
  expect(w.find('[data-testid="publish-code-server"]').exists()).toBe(false)
  await w.get('[data-testid="manage-program-versions"]').trigger('click'); await flushPromises()
  expect(w.vm.$router.currentRoute.value.query).toMatchObject({ tab: 'releases', program: 'code-server' })
})

it('旧实例提供保留配置和身份的升级接入包，只读用户不能升级', async () => {
  const w = await setup()
  expect(w.text()).toContain('下载升级接入包')
  expect(w.find('[data-testid="upgrade-code-servers"]').exists()).toBe(false)
  const read = await setup('read')
  expect(read.find('[data-testid="publish-code-server"]').exists()).toBe(false)
  expect(read.find('[data-testid="upgrade-code-servers"]').exists()).toBe(false)
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function setup(role = 'admin', query: Record<string, string> = { tab: 'code-servers', view: 'files' }) {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [role]
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query }); await router.isReady()
  const w = mount(CodeGenerationServersTab, { attachTo: document.body, global: { plugins: [pinia, ElementPlus, router] } })
  wrappers.push(w); await flushPromises(); return w
}
it('服务器页面默认配置大模型接口，并可切换工作空间', async () => {
  const w = await setup('admin', { tab: 'code-servers' })
  expect(w.get('[data-testid="code-server-models-view"]').classes()).toContain('active')
  expect(w.find('[data-testid="model-scope"]').exists()).toBe(true)
  expect(api.remoteCodeFiles).not.toHaveBeenCalled()
  await w.get('[data-testid="code-server-files-view"]').trigger('click'); await flushPromises()
  expect(w.get('[data-testid="code-server-files-view"]').classes()).toContain('active')
  expect(api.remoteCodeFiles).toHaveBeenCalledWith(server.serverId, { action: 'list', path: '' })
})
it('从任务结果跳转时选择对应服务器及文件目录，不打开第一台机器', async () => {
  const second = { ...server, serverId: 'remote-2', name: '生成机器 B', workspace: '/data/workspace' }
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [server, second] })
  const w = await setup('admin', { tab: 'code-servers', serverId: second.serverId, serverFolder: '/data/workspace/1401218/code/lib' })
  expect(api.remoteCodeFiles).toHaveBeenCalledWith(second.serverId, { action: 'list', path: '1401218/code/lib' })
  expect(api.remoteCodeFiles).not.toHaveBeenCalledWith(server.serverId, expect.anything())
  expect(w.get('.cg-workspace-head').text()).toContain(second.name)
  await w.vm.$router.push({ path: '/settings', query: { tab: 'code-servers', serverId: second.serverId, serverFolder: '/data/workspace/1401219/code' } }); await flushPromises()
  expect(api.remoteCodeFiles).toHaveBeenLastCalledWith(second.serverId, { action: 'list', path: '1401219/code' })
})
it('模型配置链接选中指定服务器的接口视图，不加载工作空间文件', async () => {
  const second = { ...server, serverId: 'remote-model', name: '模型生成服务器', ipAddress: '192.168.1.172' }
  vi.mocked(api.codeGenerationServers).mockResolvedValue({ items: [server, second] })
  const w = await setup('admin', { tab: 'code-servers', view: 'models', serverId: second.serverId })
  expect(w.get(`[data-testid="code-server-${second.serverId}"]`).classes()).toContain('is-selected')
  expect(w.get('[data-testid="code-server-models-view"]').classes()).toContain('active')
  expect(w.get('.mi-server-context').text()).toContain(second.name)
  expect(api.remoteCodeFiles).not.toHaveBeenCalled()
})
it('已有工作空间页面收到模型视图链接时切换到接口配置', async () => {
  const w = await setup()
  expect(w.get('[data-testid="code-server-files-view"]').classes()).toContain('active')
  await w.vm.$router.push({ path: '/settings', query: { tab: 'code-servers', view: 'models' } }); await flushPromises()
  expect(w.get('[data-testid="code-server-models-view"]').classes()).toContain('active')
  expect(w.find('[data-testid="model-scope"]').exists()).toBe(true)
})
it('任务服务器不存在或目录位于当前工作空间外时显示错误，不回落到其他机器', async () => {
  const missing = await setup('admin', { tab: 'code-servers', serverId: 'deleted-server', serverFolder: '/old/code' })
  expect(missing.text()).toContain('任务对应的代码生成服务器不存在或已删除')
  expect(api.remoteCodeFiles).not.toHaveBeenCalled()
  const outside = await setup('admin', { tab: 'code-servers', serverId: server.serverId, serverFolder: 'D:/other/1401218/code' })
  expect(outside.text()).toContain('任务记录的生成路径不在该服务器当前工作空间内')
  expect(api.remoteCodeFiles).not.toHaveBeenCalled()
})
it('服务日志统一跳转运行日志并带上服务实例，不再打开独立日志抽屉', async () => {
  const w = await setup()
  const button = w.findAll('button').find(button => button.text() === '服务日志')!
  await button.trigger('click'); await flushPromises()
  expect(w.vm.$router.currentRoute.value.query).toMatchObject({ tab: 'runtime-logs', kind: 'code-server', serverId: server.serverId })
  expect(api.remoteCodeFiles).not.toHaveBeenCalledWith(server.serverId, expect.objectContaining({ action: 'logs' }))
})
it('默认选中首个服务器，可浏览目录并带文件哈希保存编辑', async () => {
  const w = await setup()
  expect(w.text()).toContain(server.serverId)
  expect(api.remoteCodeFiles).toHaveBeenCalledWith(server.serverId, { action: 'list', path: '' })
  await w.findAll('button').find(button => button.text().includes('📁 news'))!.trigger('click'); await flushPromises()
  expect(api.remoteCodeFiles).toHaveBeenLastCalledWith(server.serverId, { action: 'list', path: 'news' })
  await w.findAll('button').find(button => button.text().includes('📄 client.py'))!.trigger('click'); await flushPromises()
  const input = document.querySelector<HTMLTextAreaElement>('.cg-editor textarea')!
  input.value = 'print(2)'; input.dispatchEvent(new Event('input')); await flushPromises()
  document.querySelectorAll<HTMLButtonElement>('.el-drawer button').forEach(button => { if (button.textContent === '保存文件') button.click() })
  await flushPromises()
  expect(api.remoteCodeFiles).toHaveBeenCalledWith(server.serverId, { action: 'write', path: file.path, content: 'print(2)', expectedHash: 'hash-1' })
})
it('所选文件保存到指定仓库目录，不触发生成任务', async () => {
  const w = await setup()
  w.findAllComponents({ name: 'ElTable' }).at(-1)!.vm.$emit('selection-change', [file]); await flushPromises()
  await w.findAll('button').find(button => button.text() === '保存到仓库')!.trigger('click'); await flushPromises()
  const button = [...document.querySelectorAll<HTMLButtonElement>('.el-dialog button')].find(button => button.textContent === '保存并提交')!
  button.click(); await flushPromises()
  expect(api.importRemoteCode).toHaveBeenCalledWith(server.serverId, { repositoryId: 'repo-1', directoryId: 'default', paths: ['client.py'], overwrite: false })
})
it('删除空目录发送真实删除请求，权限错误保留原始原因', async () => {
  const folder = { ...file, name: 'tasks', path: '1401218/tasks', isDirectory: true }
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  vi.mocked(api.remoteCodeFiles).mockImplementation(async (_id, body) => {
    if (body.action === 'delete') throw new Error('无法访问 1401218/tasks：系统拒绝访问，请检查目录权限或文件占用')
    return { items: [folder] } as never
  })
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '删除')!.trigger('click'); await flushPromises()
  expect(confirm).toHaveBeenCalledWith('确认删除目录 1401218/tasks？', '删除', expect.anything())
  expect(api.remoteCodeFiles).toHaveBeenCalledWith(server.serverId, { action: 'delete', path: folder.path, expectedHash: 'hash-1' })
  expect(w.text()).toContain('系统拒绝访问，请检查目录权限或文件占用')
})
it('无法读取的残留文件仍显示名称及状态，不显示错误日期和零字节', async () => {
  vi.mocked(api.remoteCodeFiles).mockResolvedValue({ items: [{ ...file, size: null, modifiedAt: '', sha256: null, accessError: '系统拒绝访问，可能权限不足或文件被占用' }] } as never)
  const w = await setup()
  expect(w.get('[data-testid="remote-file-access-error"]').attributes('title')).toContain('系统拒绝访问')
  expect(w.get('.cg-files').text()).toContain('client.py')
  expect(w.get('.cg-files').text()).not.toContain('Invalid Date')
  expect(w.get('.cg-files').text()).not.toContain('0.0 KB')
})
it('只读用户可查看文件，不提供编辑、上传及服务接入操作', async () => {
  const w = await setup('read')
  expect(w.text()).not.toContain('下载服务包'); expect(w.text()).not.toContain('新建文件'); expect(w.text()).not.toContain('保存到仓库')
  await w.findAll('button').find(button => button.text().includes('📄 client.py'))!.trigger('click'); await flushPromises()
  expect(document.querySelector<HTMLTextAreaElement>('.cg-editor textarea')!.readOnly).toBe(true)
})
it('服务包与启动器下载入口统一跳转程序版本管理', async () => {
  const w = await setup()
  await w.get('[data-testid="manage-program-versions"]').trigger('click'); await flushPromises()
  expect(w.vm.$router.currentRoute.value.query).toMatchObject({ tab: 'releases', program: 'code-server' })
  expect(w.find('[data-testid="publish-code-server"]').exists()).toBe(false)
})
