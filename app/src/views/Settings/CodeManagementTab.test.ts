// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type SiteCodeVersion } from '@/api/runnerManagement'
import CodeManagementTab from './CodeManagementTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  siteCodeCatalog: vi.fn(), bindSiteCode: vi.fn(), siteCodeContent: vi.fn(),
} }))
const latest: SiteCodeVersion & { environments: ('test' | 'prd')[] } = {
  codeId: 'code-1', configId: 'c-1', queueName: 'news_list', siteHost: 'www.realcan.cn',
  storagePath: 'sites/main.py', deliveryPath: 'sites/www.realcan.cn.py', repoId: 'repo-web', repoName: '网页代码',
  gitUrl: '', gitCommit: 'a'.repeat(40), scriptDigest: 'sha256:new', publishedAt: '2026-10-09T06:00:00Z',
  prompt: '', url: '', environments: [],
}
const old = { ...latest, scriptDigest: 'sha256:old', gitCommit: 'b'.repeat(40), publishedAt: '2026-10-08T06:00:00Z', environments: ['test' as const] }
const stubs = {
  ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElSelect: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="" /><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  ElAlert: { props: ['title'], template: '<div role="alert">{{ title }}</div>' },
  ElTag: { template: '<span><slot /></span>' },
}
beforeEach(() => {
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([latest, old])
  vi.mocked(runnerManagementApi.bindSiteCode).mockResolvedValue({ ...latest, environment: 'test' })
})
afterEach(() => vi.resetAllMocks())
async function setup(admin = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })
  await router.push({ path: '/settings', query: { tab: 'assignments', mode: 'versions' } }); await router.isReady()
  const pinia = createPinia(); setActivePinia(pinia); useAuthStore().roles = admin ? ['admin'] : ['viewer']
  const wrapper = mount(CodeManagementTab, { global: { plugins: [pinia, router], stubs, directives: { loading: {} } } })
  await flushPromises()
  return { wrapper, router }
}
it('按配置队列网站归并历史版本，分别显示测试和生产实际采用版本', async () => {
  const { wrapper } = await setup()
  expect(wrapper.findAll('[data-testid="runtime-code-row"]')).toHaveLength(1)
  expect((wrapper.get('[data-testid="runtime-code-code-1-test"] select').element as HTMLSelectElement).value).toBe(old.scriptDigest)
  expect((wrapper.get('[data-testid="runtime-code-code-1-prd"] select').element as HTMLSelectElement).value).toBe('')
  expect(wrapper.text()).toContain('当前采用')
  expect(wrapper.text()).not.toContain('发布配置')
  expect(runnerManagementApi.siteCodeContent).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('选择版本只修改草稿，应用后更新目标环境，保留另一环境的采用关系', async () => {
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([{ ...latest, environments: ['prd'] }, old])
  const { wrapper } = await setup()
  const test = wrapper.get('[data-testid="runtime-code-code-1-test"]')
  await test.get('select').setValue(latest.scriptDigest)
  expect(test.text()).toContain('待应用')
  expect(runnerManagementApi.bindSiteCode).not.toHaveBeenCalled()
  await test.get('[data-testid="runtime-code-apply-test"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.bindSiteCode).toHaveBeenCalledExactlyOnceWith({ configId: 'c-1', queueName: 'news_list', environment: 'test', scriptDigest: latest.scriptDigest })
  expect(test.text()).not.toContain('待应用')
  expect((wrapper.get('[data-testid="runtime-code-code-1-prd"] select').element as HTMLSelectElement).value).toBe(latest.scriptDigest)
  expect(wrapper.get('[data-testid="runtime-code-code-1-prd"]').text()).toContain('当前采用')
  wrapper.unmount()
})
it('应用失败保留选择和旧采用值，取消草稿恢复当前版本', async () => {
  vi.mocked(runnerManagementApi.bindSiteCode).mockRejectedValue(new Error('运行配置已变化'))
  const { wrapper } = await setup()
  const test = wrapper.get('[data-testid="runtime-code-code-1-test"]')
  await test.get('select').setValue(latest.scriptDigest)
  await test.get('[data-testid="runtime-code-apply-test"]').trigger('click'); await flushPromises()
  expect(test.get('[role="alert"]').text()).toContain('运行配置已变化')
  expect((test.get('select').element as HTMLSelectElement).value).toBe(latest.scriptDigest)
  await test.findAll('button').find(button => button.text() === '取消')!.trigger('click')
  expect((test.get('select').element as HTMLSelectElement).value).toBe(old.scriptDigest)
  expect(test.find('[role="alert"]').exists()).toBe(false)
  wrapper.unmount()
})
it('按仓库筛选运行配置，查看代码跳转到指定仓库，部署目录保留配置 ID', async () => {
  const second = { ...latest, codeId: 'code-2', configId: 'c-2', scriptDigest: 'sha256:second', repoId: 'repo-other', repoName: '其他仓库' }
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([latest, old, second])
  const { wrapper, router } = await setup()
  await wrapper.get('[data-testid="runtime-code-repo-filter"]').setValue('repo-web')
  expect(wrapper.findAll('[data-testid="runtime-code-row"]')).toHaveLength(1)
  await wrapper.findAll('button').find(button => button.text() === '查看仓库')!.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'code-repos', repoId: 'repo-web' })
  await wrapper.findAll('button').find(button => button.text() === '部署目录')!.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ tab: 'directory-layout', configId: 'c-1' })
  wrapper.unmount()
})
it('只读用户能看当前版本，不能选择或应用；接口失败不展示虚假配置', async () => {
  const { wrapper } = await setup(false)
  expect(wrapper.get('[data-testid="runtime-code-code-1-test"] select').attributes('disabled')).toBeDefined()
  expect(wrapper.find('[data-testid="runtime-code-apply-test"]').exists()).toBe(false)
  wrapper.unmount()
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockRejectedValue(new Error('服务不可达'))
  const failed = await setup()
  expect(failed.wrapper.get('[role="alert"]').text()).toContain('服务不可达')
  expect(failed.wrapper.find('[data-testid="runtime-code-row"]').exists()).toBe(false)
  failed.wrapper.unmount()
})
