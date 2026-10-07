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

it('代码列表显示所属仓库，并可按仓库筛选', async () => {
  const base = {
    codeId: 'code-1', configId: 'c-1', queueName: 'news_list', siteHost: 'www.realcan.cn',
    storagePath: 'code/c-1/code-1.py', deliveryPath: 'sites/www.realcan.cn.py',
    gitUrl: 'git/new.py', gitCommit: 'abcdef123456', scriptDigest: 'sha256:web',
    publishedAt: '', prompt: '', url: '', environments: [] as ('test' | 'prd')[],
    repoId: 'repo-web', repoName: '网页抓取代码', repoPath: 'E:\\ce\\code-web',
  }
  vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([
    base, { ...base, configId: 'c-2', scriptDigest: 'sha256:default', repoId: 'repo-default', repoName: '默认仓库' },
  ])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...base, code: 'def scrape(url):\n    return []\n' })
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
  const wrapper = mount(CodeManagementTab, { global: { stubs: {
    ElInput: { props: ['modelValue'], template: '<input :value="modelValue" />' },
    ElButton: { template: '<button type="button"><slot /></button>' },
    ElDrawer: { template: '<div><slot /></div>' },
    ElDialog: { template: '<div />' },
    ElSelect: { props: ['modelValue'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="" /><slot /></select>' },
    ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  } } })
  await flushPromises()
  expect(runnerManagementApi.siteCodeRepository).not.toHaveBeenCalled()
  expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td')[1].text())).toEqual(['网页抓取代码', '默认仓库'])
  const mapping = wrapper.findAll('[data-testid="site-code-file-mapping"]')[0].text()
  expect(mapping).toContain('仓库code/c-1/code-1.py')
  expect(mapping).toContain('→ 下发packages/c-1/sites/www.realcan.cn.py')
  await wrapper.get('[data-testid="site-code-repo-filter"]').setValue('repo-web')
  expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td')[0].text())).toEqual(['c-1'])
  await wrapper.findAll('button').find((button) => button.text() === '详情')!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('E:\\ce\\code-web\\code\\c-1\\code-1.py')
  expect(wrapper.text()).toContain('Runner 下发路径')
  expect(wrapper.text()).toContain('packages/c-1/version.json')
})
