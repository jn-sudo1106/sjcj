// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api } from '@/api/runnerManagement'
import ProgramVersionsTab from './ProgramVersionsTab.vue'

vi.mock('./RunnerManagementTab.vue', () => ({ default: { props:['section'], template:'<div data-testid="runner-releases">Runner {{section}}</div>' } }))
const digest='sha256:'+'a'.repeat(64)
const currentPackage={version:'2026.11.09.abc12345',digest:'sha256:'+'b'.repeat(64),updatedAt:'2026-11-09T08:40:00Z'}
const wrappers:ReturnType<typeof mount>[]=[]
beforeEach(() => {
  vi.spyOn(api,'codeServerReleases').mockResolvedValue({items:[{digest,version:'2026.10.29.2',publishedAt:'2026-10-29T00:00:00Z'}]})
  vi.spyOn(api,'publishCodeServer').mockResolvedValue({digest,version:'2026.10.29.2',created:false})
  vi.spyOn(api,'codeServerPackageInfo').mockResolvedValue({platform:'http://192.168.1.32:8092',package:currentPackage})
  vi.spyOn(api,'downloadCodeServerPackage').mockResolvedValue(new Blob(['package']))
  vi.spyOn(api,'downloadCodeServerMigrationPackage').mockResolvedValue(new Blob(['update']))
  vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=>'blob:test'),revokeObjectURL:vi.fn()}))
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
})
afterEach(() => {wrappers.splice(0).forEach(w=>w.unmount());document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals()})
async function setup(program='runner',role='admin',codeServerOnly=false) {
  const pinia=createPinia();setActivePinia(pinia);useAuthStore().roles=[role]
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/settings',component:{template:'<div />'}}]})
  await router.push({path:'/settings',query:{tab:'releases',program}});await router.isReady()
  const w=mount(ProgramVersionsTab,{props:{codeServerOnly},attachTo:document.body,global:{plugins:[pinia,router,ElementPlus]}})
  wrappers.push(w);await flushPromises();return {w,router}
}
it('程序版本保留Runner，智能体资源嵌入安装包并支持发布',async()=>{
  const {w}=await setup()
  expect(w.get('[data-testid="runner-releases"]').text()).toBe('Runner releases')
  expect(w.findAll('nav button')).toHaveLength(1)
  const {w:packages}=await setup('runner','admin',true)
  expect(packages.find('nav').exists()).toBe(false)
  expect(packages.text()).toContain('智能体当前下载包')
  expect(packages.get('[data-testid="publish-code-server"]').text()).toBe('发布智能体服务版本')
  expect(packages.text()).not.toContain('CodeServer')
  expect(packages.text()).toContain('2026.10.29.2')
  await packages.get('[data-testid="publish-code-server"]').trigger('click');await flushPromises()
  expect(api.publishCodeServer).toHaveBeenCalledOnce()
})
it('按所选 CodeServer 版本下载包，默认平台地址来自服务端而不是 localhost',async()=>{
  const {w}=await setup('code-server')
  await w.findAll('button').find(b=>b.text()==='下载服务包')!.trigger('click');await flushPromises()
  expect(document.querySelector<HTMLInputElement>('.el-dialog input')!.value).toBe('http://192.168.1.32:8092')
  document.querySelectorAll<HTMLButtonElement>('.el-dialog button').forEach(b=>{if(b.textContent==='下载')b.click()})
  await flushPromises()
  expect(api.downloadCodeServerPackage).toHaveBeenCalledWith('http://192.168.1.32:8092',digest)
})
it('当前下载包展示真实版本和北京时间，下载弹窗使用相同版本',async()=>{
  const {w}=await setup('code-server')
  const current=w.get('[data-testid="current-code-server-package"]')
  expect(current.text()).toContain('2026.11.09.abc12345')
  expect(current.text()).toContain('2026-11-09 16:40:00')
  expect(w.text()).toContain('最新服务版本')
  await w.findAll('button').find(b=>b.text()==='下载启动器更新包')!.trigger('click');await flushPromises()
  expect(document.querySelector('[data-testid="download-code-server-package-version"]')!.textContent).toContain(currentPackage.version)
})
it('下载包信息失败时展示真实错误，服务版本仍可查看',async()=>{
  vi.mocked(api.codeServerPackageInfo).mockRejectedValue(new Error('下载包信息请求失败'))
  const {w}=await setup('code-server')
  expect(w.get('[data-testid="current-code-server-package"]').text()).toContain('下载包信息加载失败')
  expect(w.text()).toContain('下载包信息请求失败')
  expect(w.text()).toContain('2026.10.29.2')
})
it('启动器更新包独立下载，旧实例保留身份，普通账号不显示发布及下载写入口',async()=>{
  const {w}=await setup('code-server')
  await w.findAll('button').find(b=>b.text()==='下载启动器更新包')!.trigger('click');await flushPromises()
  const address=document.querySelector<HTMLInputElement>('.el-dialog input')!
  address.value='http://192.168.1.32:18092';address.dispatchEvent(new Event('input'));await flushPromises()
  expect(document.body.textContent).toContain('包含新登记码和上方填写的管理服务地址')
  document.querySelectorAll<HTMLButtonElement>('.el-dialog button').forEach(b=>{if(b.textContent==='下载')b.click()})
  await flushPromises();expect(api.downloadCodeServerMigrationPackage).toHaveBeenCalledWith('http://192.168.1.32:18092')
  const {w:readonly}=await setup('code-server','read')
  expect(readonly.find('[data-testid="publish-code-server"]').exists()).toBe(false)
  expect(readonly.text()).not.toContain('下载服务包')
})
