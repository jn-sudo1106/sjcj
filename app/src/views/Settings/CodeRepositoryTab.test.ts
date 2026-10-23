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
  ElDropdown: { template: '<div><slot /><slot name="dropdown" /></div>' },
  ElDropdownMenu: { template: '<div><slot /></div>' },
  ElDropdownItem: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
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
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith('repo-web', '', 1, undefined, '')
  await wrapper.setProps({ repositoryId: 'repo-default' }); await flushPromises()
  expect(wrapper.get('[data-testid="code-repo-workspace"]').text()).toContain('默认仓库')
  wrapper.unmount()
})
it('从编排配置跳转到仓库文件时自动选择配置目录、展开子目录并查看内容', async () => {
  const directory = { directoryId: 'dir-web', repoId: web.repoId, name: '网页抓取代码', configType: '90', configTypeName: '网页抓取', path: '网页抓取', status: 'ACTIVE' as const, isDefault: false, revision: 'v1' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([directory])
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockImplementation(async (repoId, path) => ({ repoId, path, content: '# ' + path, size: 10, gitCommit: 'abc123' }))
  const wrapper = mount(CodeRepositoryTab, { props: { repositoryId: web.repoId, repositoryDirectoryId: directory.directoryId, repositoryFilePath: '网页抓取/新闻/www.example.com.py' }, global: { stubs, directives: { loading: {} } } })
  await flushPromises()
  expect(wrapper.get('.rd-row.selected').text()).toContain('网页抓取代码')
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(web.repoId, '', 1, directory.directoryId, '新闻')
  expect(runnerManagementApi.codeRepositoryFileContent).toHaveBeenLastCalledWith(web.repoId, '网页抓取/新闻/www.example.com.py')
  expect(wrapper.get('[data-testid="code-repo-preview"]').text()).toContain('# 网页抓取/新闻/www.example.com.py')
  await wrapper.setProps({ repositoryFilePath: '网页抓取/second.py' }); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(web.repoId, '', 1, directory.directoryId, '')
  expect(wrapper.get('[data-testid="code-repo-preview"]').text()).toContain('# 网页抓取/second.py')
  wrapper.unmount()
})
it('文件已删除或仓库不存在时显示错误，不打开其他仓库的同名文件', async () => {
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockRejectedValue(new Error('文件不存在'))
  const wrapper = mount(CodeRepositoryTab, { props: { repositoryId: web.repoId, repositoryFilePath: '旧目录/missing.py', repositoryDirectoryId: 'deleted-directory' }, global: { stubs, directives: { loading: {} } } })
  await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(web.repoId, '', 1, undefined, '旧目录')
  expect(wrapper.get('[data-testid="code-repo-preview"]').text()).toContain('文件不存在')
  wrapper.unmount()
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockClear()
  const missing = mount(CodeRepositoryTab, { props: { repositoryId: 'deleted-repo', repositoryFilePath: 'missing.py' }, global: { stubs, directives: { loading: {} } } })
  await flushPromises()
  expect(missing.text()).toContain('指定的代码仓库不存在或已删除')
  expect(runnerManagementApi.codeRepositoryFileContent).not.toHaveBeenCalled()
  missing.unmount()
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
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith('repo-web', '', 1, undefined, '')
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
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId, '')
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
  expect(wrapper.get('[data-testid="code-repo-upload"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="code-repo-upload-selected"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="code-repo-upload-folder"]').attributes('disabled')).toBeDefined()
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

it('文件夹上传保留根目录与不同子目录同名文件，跳过 Git 内部文件并允许超过 20 个文件', async () => {
  vi.mocked(runnerManagementApi.uploadCodeRepositoryFiles).mockResolvedValue({ repoId: generic.repoId, gitCommit: 'folder-commit', pushed: false, changed: true, files: [] })
  const directory = { directoryId: 'dir-shared', repoId: generic.repoId, name: '公共模块', configType: '', configTypeName: '', path: 'shared/python', status: 'ACTIVE' as const, isDefault: false, revision: 'dir-v1', codeCount: 0 }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([directory])
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="repo-directory-dir-shared"] button').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="code-repo-upload-folder"]').trigger('click')
  expect(wrapper.get('[data-testid="code-repo-upload-directory"]').text()).toBe('shared/python/')
  const picker = wrapper.get('[data-testid="code-repo-upload-folder-files"]')
  expect(picker.attributes('webkitdirectory')).toBeDefined()
  const paths = ['browser_process/a/main.py', 'browser_process/b/main.py', ...Array.from({ length: 21 }, (_, i) => `browser_process/util${i}.py`), 'browser_process/.git/config']
  const files = paths.map(path => {
    const file = new File(['x'], path.split('/').at(-1)!)
    Object.defineProperty(file, 'webkitRelativePath', { value: path })
    return file
  })
  Object.defineProperty(picker.element, 'files', { configurable: true, value: files })
  await picker.trigger('change')
  expect(wrapper.text()).toContain('browser_process/a/main.py')
  expect(wrapper.text()).toContain('已跳过 1 个 Git 仓库内部文件')
  await wrapper.get('[data-testid="code-repo-upload-submit"]').trigger('click')
  await vi.waitFor(() => expect(runnerManagementApi.uploadCodeRepositoryFiles).toHaveBeenCalled())
  expect(runnerManagementApi.uploadCodeRepositoryFiles).toHaveBeenCalledWith(generic.repoId, {
    uploadType: 'folder', directoryId: 'dir-shared', overwrite: false,
    files: paths.slice(0, -1).map(relativePath => ({ name: relativePath.split('/').at(-1), data: 'eA==', relativePath })),
  })
  await flushPromises()
  expect(wrapper.get('[role="status"]').text()).toContain('仅提交到服务器本地仓库')
  wrapper.unmount()
})

it('文件夹路径缺失和上传失败显示明确错误，切回文件上传后清空之前的选择', async () => {
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-upload-folder"]').trigger('click')
  const picker = wrapper.get('[data-testid="code-repo-upload-folder-files"]')
  Object.defineProperty(picker.element, 'files', { configurable: true, value: [new File(['x'], 'main.py')] })
  await picker.trigger('change')
  await wrapper.get('[data-testid="code-repo-upload-submit"]').trigger('click')
  expect(wrapper.text()).toContain('未读取到文件夹路径')
  expect(runnerManagementApi.uploadCodeRepositoryFiles).not.toHaveBeenCalled()
  const file = new File(['x'], 'main.py')
  Object.defineProperty(file, 'webkitRelativePath', { value: 'processor/main.py' })
  Object.defineProperty(picker.element, 'files', { configurable: true, value: [file] })
  vi.mocked(runnerManagementApi.uploadCodeRepositoryFiles).mockRejectedValue(new Error('远程推送失败'))
  await picker.trigger('change'); await wrapper.get('[data-testid="code-repo-upload-submit"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('远程推送失败'))
  await wrapper.get('[data-testid="code-repo-upload-dialog"]').findAll('button').find(button => button.text() === '取消')!.trigger('click')
  await wrapper.get('[data-testid="code-repo-upload-selected"]').trigger('click')
  expect(wrapper.find('[data-testid="code-repo-upload-folder-files"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="code-repo-upload-files"]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('processor/main.py')
  wrapper.unmount()
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
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith('repo-web', '', 1, undefined, '')
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
it('默认目录视图打开文件夹、预览子文件并返回，路径列表保留完整路径', async () => {
  const directory = { directoryId: 'dir-list', repoId: generic.repoId, name: '列表代码', configType: '', configTypeName: '', path: 'shared/python', status: 'ACTIVE' as const, isDefault: false, revision: 'v1' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([directory])
  const folder = { path: 'shared/python/处理程序', kind: 'directory' as const, size: null, managed: false, canDelete: false, gitUrl: '' }
  const file = { path: 'shared/python/处理程序/main.py', kind: 'file' as const, size: 4, managed: false, canDelete: true, gitUrl: '' }
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockImplementation(async (repoId, _keyword, _page, directoryId, folderPath) => ({ repoId, uploadDirectory: 'default', total: 1, page: 1, pageSize: 50, items: directoryId === directory.directoryId && folderPath === '' ? [folder] : [file] }))
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockResolvedValue({ repoId: generic.repoId, path: file.path, size: 4, content: 'pass', gitCommit: 'abc' })
  const wrapper = await mountTab()
  expect(wrapper.get('[data-testid="code-repo-directory-view"]').attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('.rd-all').attributes('aria-pressed')).toBe('true')
  await wrapper.get('[data-testid="repo-directory-dir-list"] .rd-title').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="repo-directory-dir-list"] .rd-title').attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('[data-testid="repo-directory-dir-list"] .rd-selected-mark').text()).toBe('已选')
  expect(wrapper.get('.rd-all').attributes('aria-pressed')).toBe('false')
  expect(wrapper.get('[data-testid="code-repo-preview-shared/python/处理程序"]').text()).toBe('处理程序')
  expect(wrapper.get('[data-testid="code-repo-file-shared/python/处理程序"]').text()).toContain('文件夹')
  await wrapper.get('[data-testid="code-repo-file-shared/python/处理程序"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId, '处理程序')
  expect(runnerManagementApi.codeRepositoryFileContent).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="code-repo-preview-shared/python/处理程序/main.py"]').text()).toBe('main.py')
  await wrapper.get('[data-testid="code-repo-file-shared/python/处理程序/main.py"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFileContent).toHaveBeenLastCalledWith(generic.repoId, file.path)
  await wrapper.get('[aria-label="当前仓库目录"] button').trigger('click'); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId, '')
  await wrapper.get('[data-testid="code-repo-paths-view"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId)
  expect(wrapper.get('[data-testid="code-repo-preview-shared/python/处理程序/main.py"]').text()).toBe(file.path)
  expect(wrapper.find('[aria-label="当前仓库目录"]').exists()).toBe(false)
  wrapper.unmount()
})
it('从全部仓库文件打开配置目录时同步左侧选择，子目录沿用此配置范围', async () => {
  const directory = { directoryId: 'dir-web', repoId: generic.repoId, name: '网页代码', configType: '', configTypeName: '', path: 'websnatch', status: 'ACTIVE' as const, isDefault: false, revision: 'v1' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([directory])
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockImplementation(async (repoId, _keyword, _page, directoryId, folderPath) => ({ repoId, uploadDirectory: 'default', total: 1, page: 1, pageSize: 50, items: [
    { path: !directoryId ? 'websnatch' : folderPath ? 'websnatch/utils/helper.py' : 'websnatch/utils', kind: directoryId && folderPath ? 'file' : 'directory', size: null, managed: false, canDelete: false, gitUrl: '' },
  ] }))
  const wrapper = await mountTab()
  await wrapper.get('[data-testid="code-repo-preview-websnatch"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="repo-directory-dir-web"] .rd-title').attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('.rd-all').attributes('aria-pressed')).toBe('false')
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId, '')
  await wrapper.get('[data-testid="code-repo-preview-websnatch/utils"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, directory.directoryId, 'utils')
  expect(wrapper.get('[data-testid="repo-directory-dir-web"] .rd-title').attributes('aria-pressed')).toBe('true')
  await wrapper.get('.rd-all').trigger('click'); await flushPromises()
  expect(wrapper.get('.rd-all').attributes('aria-pressed')).toBe('true')
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenLastCalledWith(generic.repoId, '', 1, undefined, '')
  wrapper.unmount()
})
