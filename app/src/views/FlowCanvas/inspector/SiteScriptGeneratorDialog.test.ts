// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteScriptGeneratorDialog from './SiteScriptGeneratorDialog.vue'
import { generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi, type CodeRepository, type SiteCodeVersion } from '@/api/runnerManagement'

vi.mock('@/api/siteScript', () => ({ generateSiteScript: vi.fn() }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  publishScript: vi.fn(), siteCodeVersions: vi.fn(), siteCodeContent: vi.fn(), bindSiteCode: vi.fn(),
  codeRepositories: vi.fn(), codeRepositoryFiles: vi.fn(), codeRepositoryFileContent: vi.fn(),
} }))

const defaultRepo: CodeRepository = { repoId: 'repo-default', name: '默认仓库', configType: '', configTypeName: '',
  uploadDirectory: 'default', path: 'E:/ce/site-scripts', remoteUrl: '', branch: 'main',
  isDefault: true, status: 'ACTIVE', codeCount: 0, createdAt: '', updatedAt: '' }
const webRepo: CodeRepository = { ...defaultRepo, repoId: 'repo-web', name: '网页抓取代码', configType: '90',
  configTypeName: '网页抓取', uploadDirectory: '网页抓取', path: 'E:/ce/web-code',
  remoteUrl: 'https://git.example.com/web.git', isDefault: false }
const oldVersion: SiteCodeVersion = { codeId: 'code-1', configId: 'c-1', queueName: 'news_list',
  siteHost: 'www.realcan.cn', storagePath: 'code/c-1/code-1.py', deliveryPath: 'sites/www.realcan.cn.py',
  gitUrl: 'git/old.py', gitCommit: 'a'.repeat(40), scriptDigest: 'sha256:old', publishedAt: '',
  prompt: '原版本提示词', url: 'https://www.realcan.cn/newscenter', repoId: webRepo.repoId,
  repoName: webRepo.name, repoPath: webRepo.path }
const sampleCode = 'def scrape(url):\n    return []\n'
const stubs = {
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElSelect: { props: ['modelValue', 'disabled'], emits: ['update:modelValue', 'change'],
    template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><option value="" /><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
}
const mountDialog = (props: Partial<InstanceType<typeof SiteScriptGeneratorDialog>['$props']> = {}) => mount(SiteScriptGeneratorDialog, {
  props: { open: true, initialUrl: 'https://www.realcan.cn/newscenter', initialPrompt: '',
    configId: 'c-1', queueName: 'news_list', configType: '90', ...props },
  global: { stubs, directives: { loading: {} } },
})

beforeEach(() => {
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([webRepo, defaultRepo])
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([])
})
afterEach(() => vi.resetAllMocks())

it('按类型筛选仓库并默认选中默认仓库，提供可恢复的默认提示词', async () => {
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([
    webRepo, { ...webRepo, repoId: 'repo-ocr', configType: '150', name: 'OCR 代码' },
    { ...webRepo, repoId: 'repo-off', status: 'DISABLED' }, defaultRepo,
  ])
  const wrapper = mountDialog()
  await flushPromises()
  const selector = wrapper.get('[data-testid="site-script-repository"]')
  expect((selector.element as HTMLSelectElement).value).toBe(defaultRepo.repoId)
  expect(selector.text()).toContain('网页抓取代码')
  expect(selector.text()).not.toContain('OCR 代码')
  expect(selector.findAll('option').map((option) => option.attributes('value'))).not.toContain('repo-off')
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toContain('scrape(url)')
  await wrapper.get('[data-testid="site-script-prompt"]').setValue('自定义要求')
  await wrapper.get('[data-testid="site-script-reset-prompt"]').trigger('click')
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toContain('title、date、url、summary、content')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toContain(defaultRepo.path)
  expect(wrapper.get('[data-testid="site-script-delivery-path"]').text()).toBe('sites/www.realcan.cn.py')
  wrapper.unmount()
})

it('首次生成直接进入编辑区，重新生成可切换预览且保留手工修改', async () => {
  vi.mocked(generateSiteScript)
    .mockResolvedValueOnce({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [] })
    .mockResolvedValueOnce({ fileName: 'www.realcan.cn.py', code: 'def scrape(url):\n    return [1]\n', warnings: [] })
  const wrapper = mountDialog({ initialPrompt: '抓取新闻列表' })
  await flushPromises()
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-testid="site-script-candidate"]').exists()).toBe(false)
  await wrapper.get('[aria-label="可编辑 Python 代码"]').setValue('def scrape(url):\n    return ["edited"]\n')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  expect((wrapper.get('[aria-label="生成结果预览"]').element as HTMLTextAreaElement).value).toContain('return [1]')
  expect(wrapper.find('[aria-label="可编辑 Python 代码"]').exists()).toBe(false)
  await wrapper.get('[data-testid="site-script-current-tab"]').trigger('click')
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toContain('edited')
  await wrapper.get('[data-testid="site-script-candidate-tab"]').trigger('click')
  await wrapper.get('[data-testid="site-script-adopt"]').trigger('click')
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toContain('return [1]')
  expect(generateSiteScript).toHaveBeenCalledWith({ prompt: '抓取新闻列表', url: 'https://www.realcan.cn/newscenter', sampleId: 'www.realcan.cn.py' }, expect.any(AbortSignal))
  wrapper.unmount()
})

it('已有代码自动显示实际仓库、文件路径、代码与保存的提示词', async () => {
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([
    { ...oldVersion, siteHost: 'other.example.com', scriptDigest: 'sha256:other' }, oldVersion,
  ])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...oldVersion, code: sampleCode })
  const wrapper = mountDialog()
  await flushPromises()
  expect(runnerManagementApi.siteCodeContent).toHaveBeenCalledWith(oldVersion.scriptDigest)
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/web-code/code/c-1/code-1.py')
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toBe(sampleCode)
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(oldVersion.prompt)
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  expect(wrapper.get('[data-testid="site-code-versions"]').text()).not.toContain('other.example.com')
  wrapper.unmount()
})

it('没有网站专用版本时自动载入队列通用代码，可切换历史版本', async () => {
  const generic = { ...oldVersion, siteHost: '', deliveryPath: 'news_list.py', scriptDigest: 'sha256:generic' }
  const older = { ...generic, scriptDigest: 'sha256:older', gitCommit: 'b'.repeat(40) }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([generic, older])
  vi.mocked(runnerManagementApi.siteCodeContent)
    .mockResolvedValueOnce({ ...generic, code: sampleCode })
    .mockResolvedValueOnce({ ...older, code: 'def scrape(url):\n    return ["old"]\n' })
  const wrapper = mountDialog()
  await flushPromises()
  expect(wrapper.get('[data-testid="site-script-delivery-path"]').text()).toBe('news_list.py')
  await wrapper.get('[data-testid="site-code-versions"]').setValue(older.scriptDigest)
  await flushPromises()
  expect(runnerManagementApi.siteCodeContent).toHaveBeenLastCalledWith(older.scriptDigest)
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toContain('old')
  wrapper.unmount()
})

it('编辑已有代码时继续保存到原仓库，并保留来源文件关联', async () => {
  const linked = { ...oldVersion, sourceRepoPath: '网页抓取/scraper.py', sourceGitCommit: 'c'.repeat(40) }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...linked, scriptDigest: 'sha256:edited' })
  const wrapper = mountDialog()
  await flushPromises()
  expect(wrapper.get('[data-testid="site-script-source-file"]').text()).toContain(linked.sourceRepoPath)
  await wrapper.get('[aria-label="可编辑 Python 代码"]').setValue('def scrape(url):\n    return ["changed"]\n')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({
    repositoryId: webRepo.repoId, sourceFilePath: linked.sourceRepoPath, sourceGitCommit: linked.sourceGitCommit,
  }))
  wrapper.unmount()
})

it('保存生成代码自动走 Git 发布接口并显示返回路径，不选择测试或生产', async () => {
  const saved = { ...oldVersion, repoId: defaultRepo.repoId, repoName: defaultRepo.name, repoPath: defaultRepo.path, scriptDigest: 'sha256:new' }
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [] })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue(saved)
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValueOnce([]).mockResolvedValueOnce([saved])
  const wrapper = mountDialog()
  await flushPromises()
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({
    configId: 'c-1', queueName: 'news_list', codeType: 'site', siteHost: 'www.realcan.cn', configType: '90', repositoryId: defaultRepo.repoId, code: sampleCode,
  }))
  expect(runnerManagementApi.bindSiteCode).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('运行环境')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/site-scripts/code/c-1/code-1.py')
  expect(wrapper.get('[data-testid="site-script-saved"]').text()).toContain('sha256:new')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})

it('从仓库选择 Python 文件后保存来源文件与 Git 提交', async () => {
  const sourceCode = 'def scrape(url):\n    return [{"url": url}]\n'
  const sourceCommit = 'c'.repeat(40)
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockResolvedValue({ repoId: webRepo.repoId, uploadDirectory: '网页抓取', total: 1, page: 1, pageSize: 50,
    items: [{ path: '网页抓取/scraper.py', size: sourceCode.length, managed: false, canDelete: true, gitUrl: '' }] })
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockResolvedValue({ repoId: webRepo.repoId, path: '网页抓取/scraper.py', size: sourceCode.length, content: sourceCode, gitCommit: sourceCommit })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue(oldVersion)
  const wrapper = mountDialog()
  await flushPromises()
  await wrapper.get('[data-testid="site-script-repository"]').setValue(webRepo.repoId)
  await wrapper.get('[data-testid="site-script-choose-repo-file"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="site-script-file-网页抓取/scraper.py"]').trigger('click')
  await flushPromises()
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toBe(sourceCode)
  expect(wrapper.get('[data-testid="site-script-source-file"]').text()).toContain('网页抓取/scraper.py')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({
    repositoryId: webRepo.repoId, code: sourceCode, sourceFilePath: '网页抓取/scraper.py', sourceGitCommit: sourceCommit,
  }))
  wrapper.unmount()
})

it('列表 URL 改变后清除旧代码，重新打开使用最新地址', async () => {
  const wrapper = mountDialog()
  await flushPromises()
  await wrapper.get('[data-testid="site-script-manual"]').trigger('click')
  await wrapper.setProps({ initialUrl: 'https://new.example.com/list' })
  await flushPromises()
  expect(wrapper.find('[data-testid="site-script-editor"]').exists()).toBe(false)
  await wrapper.setProps({ open: false, initialUrl: 'https://latest.example.com/list' })
  await wrapper.setProps({ open: true })
  await flushPromises()
  expect((wrapper.get('[data-testid="site-script-url"]').element as HTMLInputElement).value).toBe('https://latest.example.com/list')
  wrapper.unmount()
})

it('切换节点后忽略前一个节点迟到的代码响应', async () => {
  let resolveOld!: (value: SiteCodeVersion & { code: string }) => void
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValueOnce([oldVersion]).mockResolvedValueOnce([])
  vi.mocked(runnerManagementApi.siteCodeContent).mockReturnValue(new Promise((resolve) => { resolveOld = resolve }))
  const wrapper = mountDialog()
  await flushPromises()
  await wrapper.setProps({ configId: 'c-2', initialUrl: 'https://new.example.com/list' })
  await flushPromises()
  resolveOld({ ...oldVersion, code: sampleCode })
  await flushPromises()
  expect(wrapper.find('[data-testid="site-script-editor"]').exists()).toBe(false)
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).not.toContain('code/c-1')
  expect((wrapper.get('[data-testid="site-script-generate"]').element as HTMLButtonElement).disabled).toBe(false)
  wrapper.unmount()
})

it('已有版本读取失败时显示错误并允许重新生成', async () => {
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([oldVersion])
  vi.mocked(runnerManagementApi.siteCodeContent).mockRejectedValue(new Error('制品不存在'))
  const wrapper = mountDialog()
  await flushPromises()
  expect(wrapper.get('[data-testid="site-script-error"]').text()).toContain('已有代码读取失败：制品不存在')
  expect((wrapper.get('[data-testid="site-script-generate"]').element as HTMLButtonElement).disabled).toBe(false)
  wrapper.unmount()
})
