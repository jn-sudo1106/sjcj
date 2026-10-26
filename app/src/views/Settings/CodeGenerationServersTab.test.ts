// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api, type CodeGenerationServer, type RemoteCodeFile } from '@/api/runnerManagement'
import CodeGenerationServersTab from './CodeGenerationServersTab.vue'

const server: CodeGenerationServer = { serverId: 'remote-1', name: '生成机器 A', endpoint: 'http://192.168.1.171:8093',
  workspace: 'D:\\aicode', installDirectory: 'D:\\code-server', ipAddress: '192.168.1.171', osType: 'Windows', osVersion: 'Windows 11',
  version: '2026.10.26.1', lastHeartbeat: '2026-10-26T14:00:00Z', status: 'online' }
const file: RemoteCodeFile = { path: 'client.py', name: 'client.py', isDirectory: false, size: 8, modifiedAt: server.lastHeartbeat, sha256: 'hash-1' }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.spyOn(api, 'codeServerPackageInfo').mockResolvedValue({ platform: 'http://192.168.1.36:8092' })
  vi.spyOn(api, 'downloadCodeServerPackage').mockResolvedValue(new Blob())
  vi.spyOn(api, 'codeGenerationServers').mockResolvedValue({ items: [server] })
  vi.spyOn(api, 'remoteCodeFiles').mockImplementation(async (_id, body) => {
    if (body.action === 'read') return { ...file, content: 'print(1)' } as never
    if (body.action === 'write') return { ...file, sha256: 'hash-2' } as never
    return { path: body.path || '', items: body.path ? [file] : [{ ...file, name: 'news', path: 'news', isDirectory: true }, file] } as never
  })
  vi.spyOn(api, 'codeRepositories').mockResolvedValue([{ repoId: 'repo-1', name: '默认仓库', isDefault: true } as never])
  vi.spyOn(api, 'codeRepositoryDirectories').mockResolvedValue([{ directoryId: 'default', name: '默认目录', path: 'default', isDefault: true } as never])
  vi.spyOn(api, 'importRemoteCode').mockResolvedValue({ pushed: true, gitCommit: 'commit-1234567890' } as never)
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function setup(role = 'admin') {
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = [role]
  const w = mount(CodeGenerationServersTab, { attachTo: document.body, global: { plugins: [pinia, ElementPlus] } })
  wrappers.push(w); await flushPromises(); return w
}
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
it('只读用户可查看文件，不提供编辑、上传及服务接入操作', async () => {
  const w = await setup('read')
  expect(w.text()).not.toContain('下载服务包'); expect(w.text()).not.toContain('新建文件'); expect(w.text()).not.toContain('保存到仓库')
  await w.findAll('button').find(button => button.text().includes('📄 client.py'))!.trigger('click'); await flushPromises()
  expect(document.querySelector<HTMLTextAreaElement>('.cg-editor textarea')!.readOnly).toBe(true)
})
it('下载地址使用管理服务器返回的 IP，不取浏览器 localhost', async () => {
  const w = await setup()
  await w.findAll('button').find(button => button.text() === '下载服务包')!.trigger('click'); await flushPromises()
  const input = document.querySelector<HTMLInputElement>('.el-dialog input')!
  expect(input.value).toBe('http://192.168.1.36:8092')
  expect(input.value).not.toContain('localhost')
})
