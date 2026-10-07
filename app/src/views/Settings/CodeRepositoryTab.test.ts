// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type CodeRepository } from '@/api/runnerManagement'
import CodeRepositoryTab from './CodeRepositoryTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  codeRepositories: vi.fn(), codeRepoRules: vi.fn(), createCodeRepository: vi.fn(),
  updateCodeRepository: vi.fn(), moveCodeRepository: vi.fn(), setDefaultCodeRepository: vi.fn(),
  saveCodeRepoRules: vi.fn(),
} }))

const defaultRepo: CodeRepository = {
  repoId: 'repo-default', name: '默认仓库', path: 'E:\\ce\\site-scripts', remoteUrl: '', branch: 'main',
  isDefault: true, status: 'ACTIVE', configTypes: [], codeCount: 3, createdAt: '', updatedAt: '',
}
const webRepo: CodeRepository = {
  ...defaultRepo, repoId: 'repo-web', name: '网页抓取代码', path: 'E:\\ce\\code-web',
  remoteUrl: 'https://git.example.com/code-web.git', isDefault: false, configTypes: ['90'], codeCount: 1,
}

const stubs = {
  ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElForm: { template: '<form><slot /></form>' },
  ElFormItem: { template: '<div><slot /></div>' },
  ElSelect: { props: ['modelValue'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  ElSwitch: { props: ['modelValue', 'disabled'], emits: ['change'], template: '<input type="checkbox" class="switch" :checked="modelValue" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" />' },
}

beforeEach(() => {
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([defaultRepo, webRepo])
  vi.mocked(runnerManagementApi.codeRepoRules).mockResolvedValue([{ configType: '90', repoId: 'repo-web' }])
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
})
afterEach(() => vi.resetAllMocks())

async function mountTab() {
  const wrapper = mount(CodeRepositoryTab, { global: { stubs, directives: { loading: {} } } })
  await flushPromises()
  return wrapper
}

it('列出仓库及其配置类型，默认仓库不能停用', async () => {
  const wrapper = await mountTab()
  const web = wrapper.get('[data-testid="code-repo-repo-web"]')
  expect(web.text()).toContain('[90] 网页抓取')
  expect(web.text()).toContain('https://git.example.com/code-web.git')
  const fallback = wrapper.get('[data-testid="code-repo-repo-default"]')
  expect(fallback.text()).toContain('默认')
  expect(fallback.text()).toContain('仅本地')
  expect((fallback.get('.switch').element as HTMLInputElement).disabled).toBe(true)

  vi.mocked(runnerManagementApi.updateCodeRepository).mockResolvedValue({ ...webRepo, status: 'DISABLED' })
  await web.get('.switch').setValue(false)
  await flushPromises()
  expect(runnerManagementApi.updateCodeRepository).toHaveBeenCalledWith('repo-web', { status: 'DISABLED' })
})

it('新建仓库只提交服务器路径和可选的远程地址', async () => {
  vi.mocked(runnerManagementApi.createCodeRepository).mockResolvedValue({ ...webRepo, repoId: 'repo-ocr', name: 'OCR 代码' })
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-create"]').trigger('click')
  await wrapper.get('[data-testid="code-repo-name"]').setValue(' OCR 代码 ')
  await wrapper.get('[data-testid="code-repo-path"]').setValue('E:\\ce\\code-ocr')
  await wrapper.get('[data-testid="code-repo-submit"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.createCodeRepository).toHaveBeenCalledWith({
    name: 'OCR 代码', path: 'E:\\ce\\code-ocr', remoteUrl: '', branch: 'main',
  })
  expect(runnerManagementApi.codeRepositories).toHaveBeenCalledTimes(2)
})

it('编辑仓库时路径变化走迁移接口，其余字段只提交改动项', async () => {
  vi.mocked(runnerManagementApi.moveCodeRepository).mockResolvedValue(webRepo)
  vi.mocked(runnerManagementApi.updateCodeRepository).mockResolvedValue(webRepo)
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-repo-web"]').findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
  await wrapper.get('[data-testid="code-repo-path"]').setValue('E:\\ce\\code-web-2')
  await wrapper.get('[data-testid="code-repo-branch"]').setValue('release')
  await wrapper.get('[data-testid="code-repo-submit"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.moveCodeRepository).toHaveBeenCalledWith('repo-web', 'E:\\ce\\code-web-2')
  expect(runnerManagementApi.updateCodeRepository).toHaveBeenCalledWith('repo-web', { branch: 'release' })
})

it('配置类型分类只提交变化的类型，空值表示回到默认仓库', async () => {
  vi.mocked(runnerManagementApi.saveCodeRepoRules).mockResolvedValue([])
  const wrapper = await mountTab()
  const save = wrapper.get('[data-testid="code-repo-rules-save"]')
  expect((save.element as HTMLButtonElement).disabled).toBe(true)
  await wrapper.get('[data-testid="code-repo-rule-90"] select').setValue('')
  await wrapper.get('[data-testid="code-repo-rule-150"] select').setValue('repo-web')
  await save.trigger('click')
  await flushPromises()
  expect(runnerManagementApi.saveCodeRepoRules).toHaveBeenCalledWith([
    { configType: '90', repoId: '' },
    { configType: '150', repoId: 'repo-web' },
  ])
})
