// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi } from '@/api/runnerManagement'
import CodeManagementTab from './CodeManagementTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  siteCodeCatalog: vi.fn(), bindSiteCode: vi.fn(), siteCodeContent: vi.fn(),
  siteCodeRepository: vi.fn(), updateSiteCodeRepository: vi.fn(), updateSiteCodeGit: vi.fn(),
} }))
afterEach(() => vi.resetAllMocks())

it('发布配置时才选择运行环境，并绑定所选代码版本', async () => {
  const row = {
    codeId: 'code-1', configId: 'c-1', queueName: 'news_list', siteHost: 'www.realcan.cn',
    storagePath: 'code/c-1/code-1.py', deliveryPath: 'sites/www.realcan.cn.py',
    gitUrl: 'git/new.py', gitCommit: 'abcdef123456', scriptDigest: 'sha256:new',
    publishedAt: '', prompt: '', url: '', environments: [] as ('test' | 'prd')[],
  }
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([row])
  vi.mocked(runnerManagementApi.siteCodeRepository).mockResolvedValue({ path: 'E:\\ce\\site-scripts', defaultPath: 'E:\\ce\\site-scripts', remoteUrl: '', branch: 'main' })
  vi.mocked(runnerManagementApi.bindSiteCode).mockResolvedValue({ ...row, environment: 'prd' })
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
  const wrapper = mount(CodeManagementTab, { global: { stubs: {
    ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
    ElButton: { template: '<button type="button"><slot /></button>' },
    ElDrawer: { template: '<div><slot /></div>' },
    ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
    ElForm: { template: '<form><slot /></form>' },
    ElFormItem: { template: '<div><slot /></div>' },
    ElSelect: { props: ['modelValue'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>' },
    ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  } } })
  await flushPromises()
  expect(wrapper.find('[data-testid="code-publish-environment"]').exists()).toBe(false)
  await wrapper.findAll('button').find((button) => button.text() === '发布配置')!.trigger('click')
  await wrapper.get('[data-testid="code-publish-environment"]').setValue('prd')
  await wrapper.get('[data-testid="code-publish-confirm"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.bindSiteCode).toHaveBeenCalledWith({
    configId: 'c-1', queueName: 'news_list', environment: 'prd', scriptDigest: 'sha256:new',
  })
})

it('系统设置可修改服务器代码仓库路径', async () => {
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([])
  vi.mocked(runnerManagementApi.siteCodeRepository).mockResolvedValue({ path: 'E:\\ce\\site-scripts', defaultPath: 'E:\\ce\\site-scripts', remoteUrl: '', branch: 'main' })
  vi.mocked(runnerManagementApi.updateSiteCodeRepository).mockResolvedValue({ path: 'E:\\ce\\generated-sites', defaultPath: 'E:\\ce\\site-scripts', remoteUrl: '', branch: 'main' })
  vi.mocked(runnerManagementApi.updateSiteCodeGit).mockResolvedValue({ path: 'E:\\ce\\generated-sites', defaultPath: 'E:\\ce\\site-scripts', remoteUrl: 'https://git.example.com/site-scripts.git', branch: 'main' })
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
  const wrapper = mount(CodeManagementTab, { global: { stubs: {
    ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
    ElButton: { template: '<button type="button"><slot /></button>' },
    ElDrawer: { template: '<div><slot /></div>' },
    ElDialog: { template: '<div><slot /></div>' },
  } } })
  await flushPromises()
  expect((wrapper.get('[data-testid="site-code-repository-path"]').element as HTMLInputElement).value).toBe('E:\\ce\\site-scripts')
  await wrapper.get('[data-testid="site-code-repository-path"]').setValue('E:\\ce\\generated-sites')
  await wrapper.get('[data-testid="site-code-repository-save"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.updateSiteCodeRepository).toHaveBeenCalledWith('E:\\ce\\generated-sites')
  expect((wrapper.get('[data-testid="site-code-repository-path"]').element as HTMLInputElement).value).toBe('E:\\ce\\generated-sites')
  await wrapper.get('[data-testid="site-code-git-url"]').setValue('https://git.example.com/site-scripts.git')
  await wrapper.get('[data-testid="site-code-git-save"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.updateSiteCodeGit).toHaveBeenCalledWith('https://git.example.com/site-scripts.git', 'main')
})
