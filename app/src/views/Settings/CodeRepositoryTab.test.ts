// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type CodeRepository } from '@/api/runnerManagement'
import CodeRepositoryTab from './CodeRepositoryTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  codeRepositories: vi.fn(), createCodeRepository: vi.fn(), updateCodeRepository: vi.fn(),
  moveCodeRepository: vi.fn(), setDefaultCodeRepository: vi.fn(), verifyCodeRepository: vi.fn(), uploadCodeRepositoryFiles: vi.fn(),
  codeRepositoryFiles: vi.fn(), codeRepositoryFileContent: vi.fn(), deleteCodeRepositoryFile: vi.fn(),
  codeRepositoryDirectories: vi.fn(), saveCodeRepositoryDirectory: vi.fn(), removeCodeRepositoryDirectory: vi.fn(),
} }))
const generic: CodeRepository = {
  repoId: 'repo-default', name: '默认仓库', configType: '', configTypeName: '', uploadDirectory: 'default', path: 'E:\\ce\\site-scripts',
  remoteUrl: '', branch: 'main', isDefault: true, status: 'ACTIVE', codeCount: 3, createdAt: '', updatedAt: '',
}
const web: CodeRepository = {
  ...generic, repoId: 'repo-web', name: '网页抓取代码', configType: '90', configTypeName: '网页抓取', uploadDirectory: '网页抓取', path: 'E:\\ce\\code-web',
  remoteUrl: 'https://git.example.com/code-web.git', isDefault: false, codeCount: 1,
}
const stubs = {
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElSelect: { props: ['modelValue'], emits: ['update:modelValue', 'change'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  ElSwitch: { props: ['modelValue', 'disabled', 'size'], emits: ['change'], template: '<input type="checkbox" class="switch" :checked="modelValue" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" />' },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
  ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
}
beforeEach(() => {
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([])
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([generic, web])
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockResolvedValue({ repoId: 'repo-default', uploadDirectory: 'default',
    total: 0, page: 1, pageSize: 50, items: [] })
  setActivePinia(createPinia())
  useAuthStore().roles = ['admin']
})
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks() })
async function mountTab() {
  const wrapper = mount(CodeRepositoryTab, { global: { stubs, directives: { loading: {} } } })
  await flushPromises()
  return wrapper
}
it('从运行版本跳转时直接选择指定仓库，并可再次切换目标仓库', async () => {
  const wrapper = mount(CodeRepositoryTab, { props: { repositoryId: 'repo-web' }, global: { stubs, directives: { loading: {} } } })
  await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('网页抓取代码')
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith('repo-web', '', 1)
  await wrapper.setProps({ repositoryId: 'repo-default' }); await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('默认仓库')
  wrapper.unmount()
})
it('仓库配置列表在代码列表上方，默认选中第一条且按列表字段查询', async () => {
  const wrapper = await mountTab()
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('默认仓库')
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('仅保存在本地')
  expect(wrapper.html().indexOf('data-testid="code-repo-list"')).toBeLessThan(wrapper.html().indexOf('data-testid="code-repo-workspace"'))
  expect(wrapper.get('[data-testid="code-repo-repo-default"]').classes()).toContain('crp-repo-selected')
  expect(wrapper.get('[data-testid="code-repo-repo-web"]').text()).toContain('[90] 网页抓取')
  expect(wrapper.get('[data-testid="code-repo-repo-default"]').text()).toContain('通用')
  await wrapper.get('[data-testid="code-repo-query"]').setValue('git.example.com')
  expect(wrapper.find('[data-testid="code-repo-repo-default"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="code-repo-repo-web"]').exists()).toBe(true)
  await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('网页抓取代码')
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith('repo-web', '', 1)
  await wrapper.get('[data-testid="code-repo-query"]').setValue('没有匹配')
  expect(wrapper.find('[data-testid="code-repo-repo-web"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="code-repo-workspace"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('没有匹配的仓库')
})
it('新建仓库在列表内填写，并保存配置类型', async () => {
  vi.mocked(runnerManagementApi.createCodeRepository).mockResolvedValue(web)
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-create"]').trigger('click')
  expect(wrapper.find('[data-testid="code-repo-new-row"]').exists()).toBe(true)
  expect(wrapper.find('.el-dialog').exists()).toBe(false)
  await wrapper.get('[data-testid="code-repo-name"]').setValue(' 第二个网页仓库 ')
  await wrapper.get('[data-testid="code-repo-type"]').setValue('90')
  await wrapper.get('[data-testid="code-repo-path"]').setValue('E:\\ce\\code-web-2')
  await wrapper.get('[data-testid="code-repo-submit"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.createCodeRepository).toHaveBeenCalledWith({
    name: '第二个网页仓库', configType: '90', configTypeName: '网页抓取', path: 'E:\\ce\\code-web-2', remoteUrl: '', branch: 'main',
  })
})
it('在仓库下按节点类型新建目录，选择目录浏览并上传到该目录', async () => {
  const directory = { directoryId: 'dir-web', repoId: generic.repoId, name: '网页抓取代码', configType: '90', configTypeName: '网页抓取', path: '网页抓取', status: 'ACTIVE' as const, isDefault: false, revision: 'dir-v1', codeCount: 0 }
  vi.mocked(runnerManagementApi.saveCodeRepositoryDirectory).mockResolvedValue(directory)
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="repo-directory-create"]').trigger('click')
  await wrapper.get('[data-testid="repo-directory-type"]').setValue('90')
  expect((wrapper.get('[data-testid="repo-directory-path"]').element as HTMLInputElement).value).toBe('网页抓取')
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([directory])
  await wrapper.get('[data-testid="repo-directory-save"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.saveCodeRepositoryDirectory).toHaveBeenCalledWith(generic.repoId, expect.objectContaining({ name: '网页抓取代码', configType: '90', path: '网页抓取' }), undefined)
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId)
  await wrapper.get('[data-testid="code-repo-upload-selected"]').trigger('click')
  expect(wrapper.get('[data-testid="code-repo-upload-directory"]').text()).toBe('网页抓取/')
  wrapper.unmount()
})
it('目录查询按节点类型过滤，停用后禁止上传，目录加载失败明确显示', async () => {
  const base = { repoId: generic.repoId, configTypeName: '网页抓取', path: 'web', status: 'DISABLED' as const, isDefault: false, revision: 'v1' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([{ ...base, directoryId: 'web-dir', name: '网页专用', configType: '90' }, { ...base, directoryId: 'ocr-dir', name: 'OCR 专用', configType: '150', path: 'ocr' }])
  const wrapper = await mountTab()
  await wrapper.get('[aria-label="筛选目录节点类型"]').setValue('90')
  expect(wrapper.text()).not.toContain('OCR 专用')
  await wrapper.get('[data-testid="repo-directory-web-dir"] button').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-upload-selected"]').attributes('disabled')).toBeDefined()
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockRejectedValue(new Error('目录服务失败'))
  await wrapper.get('[aria-label="刷新配置目录"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('目录服务失败')
  wrapper.unmount()
})
it('编辑仓库按字段提交，路径单独走迁移接口', async () => {
  vi.mocked(runnerManagementApi.moveCodeRepository).mockResolvedValue(web)
  vi.mocked(runnerManagementApi.updateCodeRepository).mockResolvedValue(web)
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-repo-web"]').findAll('button').find((button) => button.text() === '编辑')!.trigger('click')
  await wrapper.get('[data-testid="code-repo-path"]').setValue('E:\\ce\\code-web-2')
  await wrapper.get('[data-testid="code-repo-branch"]').setValue('release')
  await wrapper.get('[data-testid="code-repo-submit"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.moveCodeRepository).toHaveBeenCalledWith('repo-web', 'E:\\ce\\code-web-2')
  expect(runnerManagementApi.updateCodeRepository).toHaveBeenCalledWith('repo-web', { branch: 'release' })
})

it('验证仓库后在对应行显示本地和远程检查结果', async () => {
  vi.mocked(runnerManagementApi.verifyCodeRepository).mockResolvedValue({ repoId: 'repo-web', status: 'warning',
    checkedAt: '2026-10-07T00:00:00Z', checks: [
      { name: 'git', status: 'ok', message: '本地 Git 仓库正常' },
      { name: 'remote', status: 'warning', message: '远程仓库可连接，但 main 分支尚不存在' },
    ] })
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-verify-repo-web"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.verifyCodeRepository).toHaveBeenCalledWith('repo-web')
  const result = wrapper.get('[data-testid="code-repo-verification-repo-web"]')
  expect(result.text()).toContain('需注意')
  expect(result.text()).toContain('分支尚不存在')
})

it('上传文件时展示类型名称目录并提交内容和覆盖选项', async () => {
  vi.mocked(runnerManagementApi.uploadCodeRepositoryFiles).mockResolvedValue({ repoId: 'repo-web', gitCommit: 'abc',
    pushed: true, changed: true, files: [{ path: '网页抓取/README.txt', size: 5, gitUrl: 'git#abc:网页抓取/README.txt' }] })
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-repo-web"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('origin/main')
  await wrapper.get('[data-testid="code-repo-upload-selected"]').trigger('click')
  expect(wrapper.get('[data-testid="code-repo-upload-directory"]').text()).toBe('网页抓取/')
  const picker = wrapper.get('[data-testid="code-repo-upload-files"]')
  Object.defineProperty(picker.element, 'files', { configurable: true, value: [new File(['hello'], 'README.txt')] })
  await picker.trigger('change')
  await wrapper.get('[data-testid="code-repo-upload-overwrite"]').setValue(true)
  await wrapper.get('[data-testid="code-repo-upload-submit"]').trigger('click')
  await vi.waitFor(() => expect(runnerManagementApi.uploadCodeRepositoryFiles).toHaveBeenCalled())
  expect(runnerManagementApi.uploadCodeRepositoryFiles).toHaveBeenCalledWith('repo-web', {
    overwrite: true, files: [{ name: 'README.txt', data: 'aGVsbG8=' }],
  })
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('origin/main')
})

it('查看仓库文件并删除非系统文件', async () => {
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockResolvedValue({ repoId: 'repo-web', uploadDirectory: '网页抓取',
    total: 2, page: 1, pageSize: 50, items: [
      { path: '网页抓取/sample.py', size: 8, managed: false, canDelete: true, gitUrl: 'git#x' },
      { path: 'code/c-1/a.py', size: 20, managed: true, canDelete: false, gitUrl: 'git#y' },
    ] })
  vi.mocked(runnerManagementApi.deleteCodeRepositoryFile).mockResolvedValue({ repoId: 'repo-web', path: '网页抓取/sample.py', gitCommit: 'abc', pushed: true })
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockResolvedValue({ repoId: 'repo-web', path: '网页抓取/sample.py', size: 8, content: 'print(1)', gitCommit: 'abc' })
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as Awaited<ReturnType<typeof ElMessageBox.confirm>>)
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-repo-web"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith('repo-web', '', 1)
  expect(wrapper.get('[data-testid="code-repo-file-code/c-1/a.py"]').text()).toContain('受保护')
  await wrapper.get('[data-testid="code-repo-file-网页抓取/sample.py"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.codeRepositoryFileContent).toHaveBeenCalledWith('repo-web', '网页抓取/sample.py')
  expect(wrapper.get('[data-testid="code-repo-preview"]').text()).toContain('print(1)')
  await wrapper.get('[data-testid="code-repo-delete-网页抓取/sample.py"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.deleteCodeRepositoryFile).toHaveBeenCalledWith('repo-web', '网页抓取/sample.py')
})

it('文件读取失败时在内容抽屉显示错误', async () => {
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockResolvedValue({ repoId: 'repo-default', uploadDirectory: 'default',
    total: 1, page: 1, pageSize: 50, items: [{ path: 'default/binary.bin', size: 4, managed: false, canDelete: true, gitUrl: '' }] })
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockRejectedValue(new Error('二进制文件暂不支持在线预览'))
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-file-default/binary.bin"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-preview"]').text()).toContain('二进制文件暂不支持在线预览')
})
