// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { runnerManagementApi as api, type RunnerInstance } from '@/api/runnerManagement'
import RunnerFilesDrawer from './RunnerFilesDrawer.vue'
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { requestRunnerFiles: vi.fn(), runnerFileResult: vi.fn() } }))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.resetAllMocks(); document.body.innerHTML = '' })
const runner = { runnerId:'runner1',ipAddress:'192.168.1.201',installDirectory:'D:\\Runner2\\instance' } as RunnerInstance
async function managementSetup(editable = true) {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'manage' })
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links', items: [
    { name: 'main.py', path: 'links/main.py', isDirectory: false, size: 10, sha256: 'a'.repeat(64), modifiedAt: '2026-11-15T00:00:00Z' },
  ] } })
  wrapper = mount(RunnerFilesDrawer, { props: { runner: { ...runner, status: 'online', capabilities: ['file-browser', 'file-management'] }, directory: 'links', embedded: true, workspace: true, editable }, global: { plugins: [ElementPlus] } })
  await flushPromises(); return wrapper
}
async function setup() {
  wrapper = mount(RunnerFilesDrawer,{ props:{runner,directory:'D:\\Runner2\\instance\\links\\1401218'},global:{plugins:[ElementPlus]},attachTo:document.body })
  await flushPromises(); return wrapper
}
it('部署空间支持搜索文件和文件夹及类型筛选，不额外下发 Runner 命令', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'search' })
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links', items: [
    { name: 'Sites', path: 'links/Sites', isDirectory: true, size: 0, modifiedAt: '' },
    { name: 'site.py', path: 'links/site.py', isDirectory: false, size: 10, modifiedAt: '' },
    { name: 'newslink.exe', path: 'links/newslink.exe', isDirectory: false, size: 20, modifiedAt: '' },
  ] } })
  wrapper = mount(RunnerFilesDrawer, { props: { runner, directory: 'links', embedded: true, workspace: true }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  await wrapper.get('[aria-label="搜索部署文件或文件夹"]').setValue('  SITE  '); await flushPromises()
  const table = () => wrapper!.findComponent({ name: 'ElTable' })
  expect(table().props('data').map((file: { name: string }) => file.name)).toEqual(['Sites', 'site.py'])
  const type = wrapper.getComponent({ name: 'ElSelect' })
  type.vm.$emit('update:modelValue', 'files'); await flushPromises()
  expect(table().props('data').map((file: { name: string }) => file.name)).toEqual(['site.py'])
  type.vm.$emit('update:modelValue', 'folders'); await flushPromises()
  expect(table().props('data').map((file: { name: string }) => file.name)).toEqual(['Sites'])
  await wrapper.get('[aria-label="搜索部署文件或文件夹"]').setValue('not-found'); await flushPromises()
  expect(wrapper.text()).toContain('当前目录没有匹配的文件或文件夹')
  expect(wrapper.get('[data-testid="deployment-file-search"]').text()).toContain('0 / 3 项')
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(1)
})
it('刷新和心跳保留部署搜索，打开文件后可返回结果，切换实例清空旧搜索', async () => {
  const w = await managementSetup(false)
  const search = () => w.get<HTMLInputElement>('[aria-label="搜索部署文件或文件夹"]')
  await search().setValue('MAIN'); await flushPromises()
  await w.get('[aria-label="刷新部署目录"]').trigger('click'); await flushPromises()
  expect(search().element.value).toBe('MAIN')
  await w.setProps({ runner: { ...runner, status: 'online', lastHeartbeat: '2026-11-18T01:00:00Z' } }); await flushPromises()
  expect(search().element.value).toBe('MAIN')
  vi.mocked(api.runnerFileResult).mockResolvedValueOnce({ status: 'success', result: { path: 'links/main.py', content: 'print(1)' } })
  await w.findAll('button').find(button => button.text().includes('main.py'))!.trigger('click'); await flushPromises()
  expect(w.find('[data-testid="deployment-file-search"]').exists()).toBe(false)
  await w.findAll('button').find(button => button.text() === '返回文件列表')!.trigger('click'); await flushPromises()
  expect(search().element.value).toBe('MAIN')
  await w.setProps({ runner: { ...runner, runnerId: 'runner2' } }); await flushPromises()
  expect(search().element.value).toBe('')
  expect(api.requestRunnerFiles).toHaveBeenLastCalledWith('runner2', { action: 'list', path: 'links' })
})
it('打开实际部署目录，点击文件查看内容，目录使用实例内相对路径', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({requestId:'r1'})
  vi.mocked(api.runnerFileResult).mockResolvedValueOnce({status:'success',result:{path:'links/1401218',items:[{name:'main.py',path:'links/1401218/main.py',isDirectory:false,size:10,modifiedAt:'2026-11-03T00:00:00Z',sha256:'hash'}]}})
  const w = await setup()
  expect(api.requestRunnerFiles).toHaveBeenCalledWith('runner1',{action:'list',path:'links/1401218'})
  expect(document.body.textContent).toContain('main.py')
  vi.mocked(api.runnerFileResult).mockResolvedValue({status:'success',result:{path:'links/1401218/main.py',content:'print("hello")'}})
  const link = [...document.body.querySelectorAll('button')].find(button => button.textContent?.includes('main.py'))!
  link.click(); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenLastCalledWith('runner1',{action:'read',path:'links/1401218/main.py'})
  expect(document.body.querySelector('pre')?.textContent).toContain('print("hello")')
  w.unmount()
})
it('原样展示旧Runner升级提示，不显示虚假文件列表', async () => {
  vi.mocked(api.requestRunnerFiles).mockRejectedValue(new Error('此 Runner 尚不支持目录浏览，请先升级 Runner'))
  await setup()
  expect(document.body.textContent).toContain('请先升级 Runner')
  expect(api.runnerFileResult).not.toHaveBeenCalled()
})
it('选择入口只浏览部署目录并返回相对路径，不读取文件正文', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({requestId:'r1'})
  vi.mocked(api.runnerFileResult).mockResolvedValue({status:'success',result:{path:'links/1401218',items:[
    {name:'newslink.py',path:'links/1401218/newslink.py',isDirectory:false,size:10,modifiedAt:''},
    {name:'requirements.txt',path:'links/1401218/requirements.txt',isDirectory:false,size:10,modifiedAt:''},
  ]}})
  wrapper = mount(RunnerFilesDrawer,{props:{runner,directory:'D:\\Runner2\\instance\\links\\1401218',selectFile:true},global:{plugins:[ElementPlus]},attachTo:document.body})
  await flushPromises()
  const buttons = [...document.body.querySelectorAll('button')]
  expect(buttons.find(button=>button.textContent?.includes('requirements.txt'))!.disabled).toBe(true)
  buttons.find(button=>button.textContent?.includes('newslink.py'))!.click();await flushPromises()
  expect(wrapper.emitted('selected')).toEqual([['newslink.py']])
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).not.toContain('实例目录')
})
it('Runner无法读取文件时展示真实错误', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({requestId:'r1'})
  vi.mocked(api.runnerFileResult).mockResolvedValue({status:'failed',error:'目录不存在',result:{path:''}})
  await setup(); expect(document.body.textContent).toContain('目录不存在')
})
it('部署空间新建文件夹和确认删除后刷新当前目录', async () => {
  vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: 'uploads', action: 'confirm' } as never)
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const w = await managementSetup()
  await w.get('[data-testid="deployment-create-folder"]').trigger('click'); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenCalledWith('runner1', { action: 'mkdir', path: 'links/uploads' })
  await w.get('[data-testid="deployment-delete-file"]').trigger('click'); await flushPromises()
  expect(confirm).toHaveBeenCalled()
  expect(api.requestRunnerFiles).toHaveBeenCalledWith('runner1', { action: 'delete', path: 'links/main.py', expectedHash: 'a'.repeat(64), expectedSize: 10, expectedModifiedAt: '2026-11-15T00:00:00Z' })
  expect(api.requestRunnerFiles).toHaveBeenLastCalledWith('runner1', { action: 'list', path: 'links' })
})
it('部署空间上传选择的文件到当前目录，保留二进制内容', async () => {
  const w = await managementSetup()
  const file = new File(['binary'], 'sample.bin')
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([0, 255, 42]).buffer })
  const input = w.get('[data-testid="deployment-upload-input"]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change'); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenCalledWith('runner1', { action: 'upload', path: 'links', files: [{ path: 'links/sample.bin', data: 'AP8q' }] })
  expect(api.requestRunnerFiles).toHaveBeenLastCalledWith('runner1', { action: 'list', path: 'links' })
})
it('取消删除不下发命令，只读账号不展示文件管理操作', async () => {
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  const w = await managementSetup()
  await w.get('[data-testid="deployment-delete-file"]').trigger('click'); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(1)
  await w.setProps({ editable: false })
  expect(w.find('[data-testid="deployment-create-folder"]').exists()).toBe(false)
  expect(w.find('[data-testid="deployment-upload"]').exists()).toBe(false)
  expect(w.find('[data-testid="deployment-delete-file"]').exists()).toBe(false)
})
it('机器心跳刷新不重发目录请求，不清空文件或重置已进入的子目录', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'root' })
  vi.mocked(api.runnerFileResult).mockResolvedValueOnce({ status: 'success', result: { path: '', items: [
    { name: 'links', path: 'links', isDirectory: true, size: 0, modifiedAt: '' },
  ] } })
  wrapper = mount(RunnerFilesDrawer, { props: { runner, directory: '', embedded: true }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links', items: [
    { name: '1401218', path: 'links/1401218', isDirectory: true, size: 0, modifiedAt: '' },
  ] } })
  await wrapper.findAll('button').find(item => item.text().includes('links'))!.trigger('click'); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(2)
  for (let index = 0; index < 3; index++) {
    await wrapper.setProps({ runner: { ...runner, status: 'online', lastHeartbeat: `2026-11-15T05:40:0${index}Z` } })
    await flushPromises()
  }
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('1401218')
  expect(wrapper.get('.full-path').text()).toBe('D:\\Runner2\\instance\\links')
  expect(wrapper.text()).not.toContain('等待 Runner 返回')
})
it('目录仍在等待时不把空表格显示为没有文件，切换真实实例后重新查询', async () => {
  let resolve!: (value: { requestId: string }) => void
  vi.mocked(api.requestRunnerFiles).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  wrapper = mount(RunnerFilesDrawer, { props: { runner, directory: '', embedded: true }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(wrapper.text()).toContain('等待 Runner 返回')
  expect(wrapper.text()).not.toContain('当前目录没有可浏览文件')
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'new-root' })
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: '', items: [
    { name: 'new-machine', path: 'new-machine', isDirectory: true, size: 0, modifiedAt: '' },
  ] } })
  await wrapper.setProps({ runner: { ...runner, runnerId: 'runner2' } }); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenLastCalledWith('runner2', { action: 'list', path: '' })
  resolve({ requestId: 'old-root' }); await flushPromises()
  expect(wrapper.text()).toContain('new-machine')
  expect(api.runnerFileResult).not.toHaveBeenCalledWith('old-root')
})
it('在目录对照中直接展示目标机器文件，导航停留在实际部署目录内', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'r1' })
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links/1401218', items: [{ name: 'newslink.py', path: 'links/1401218/newslink.py', isDirectory: false, size: 10, modifiedAt: '' }] } })
  wrapper = mount(RunnerFilesDrawer, { props: { runner, directory: 'D:\\Runner2\\instance\\links\\1401218', embedded: true }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(wrapper.text()).toContain('newslink.py')
  expect(wrapper.text()).not.toContain('实例目录')
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links/1401218/newslink.py', content: 'live machine code' } })
  await wrapper.findAll('button').find(item => item.text().includes('newslink.py'))!.trigger('click'); await flushPromises()
  expect(api.requestRunnerFiles).toHaveBeenLastCalledWith(runner.runnerId, { action: 'read', path: 'links/1401218/newslink.py' })
  expect(wrapper.text()).toContain('live machine code')
})
it('文件仍可浏览，设为入口仅返回部署根内符合映射的 Python 文件', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'r1' })
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links/1401218', items: ['run.py', '__init__.py', 'untracked.py', 'requirements.txt'].map(name => ({ name, path: 'links/1401218/' + name, isDirectory: false, size: 10, modifiedAt: '' })) } })
  wrapper = mount(RunnerFilesDrawer, { props: { runner, directory: 'D:\\Runner2\\instance\\links\\1401218', embedded: true, allowSetEntry: true, entryFilter: path => path === 'run.py' }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  expect(wrapper.findAll('[data-testid="runner-set-entry"]')).toHaveLength(1)
  await wrapper.get('[data-testid="runner-set-entry"]').trigger('click')
  expect(wrapper.emitted('setEntry')).toEqual([['run.py']])
  expect(wrapper.emitted('selected')).toBeUndefined()
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(1)
})
it('目标机器上的 EXE 支持设为入口，并保留完整的部署内相对路径', async () => {
  vi.mocked(api.requestRunnerFiles).mockResolvedValue({ requestId: 'r1' })
  vi.mocked(api.runnerFileResult).mockResolvedValue({ status: 'success', result: { path: 'links/1401218/bin', items: [{ name: 'newslink.EXE', path: 'links/1401218/bin/newslink.EXE', isDirectory: false, size: 25000000, modifiedAt: '' }] } })
  wrapper = mount(RunnerFilesDrawer, { props: { runner, directory: 'D:\\Runner2\\instance\\links\\1401218', embedded: true, allowSetEntry: true }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  await wrapper.get('[data-testid="runner-set-entry"]').trigger('click')
  expect(wrapper.emitted('setEntry')).toEqual([['bin/newslink.EXE']])
  expect(api.requestRunnerFiles).toHaveBeenCalledTimes(1)
})
