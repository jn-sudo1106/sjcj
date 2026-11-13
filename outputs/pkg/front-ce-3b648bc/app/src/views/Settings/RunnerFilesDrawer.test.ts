// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { runnerManagementApi as api, type RunnerInstance } from '@/api/runnerManagement'
import RunnerFilesDrawer from './RunnerFilesDrawer.vue'
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { requestRunnerFiles: vi.fn(), runnerFileResult: vi.fn() } }))
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks(); document.body.innerHTML = '' })
const runner = { runnerId:'runner1',ipAddress:'192.168.1.201',installDirectory:'D:\\Runner2\\instance' } as RunnerInstance
async function setup() {
  wrapper = mount(RunnerFilesDrawer,{ props:{runner,directory:'D:\\Runner2\\instance\\links\\1401218'},global:{plugins:[ElementPlus]},attachTo:document.body })
  await flushPromises(); return wrapper
}
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
