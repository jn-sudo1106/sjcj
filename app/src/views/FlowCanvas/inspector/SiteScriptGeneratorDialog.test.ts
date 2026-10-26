// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import SiteScriptGeneratorDialog from './SiteScriptGeneratorDialog.vue'
import { DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT, generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type SiteCodeVersion } from '@/api/runnerManagement'
import { nodePromptApi } from '@/api/nodePrompts'
import PromptTemplatePicker from './PromptTemplatePicker.vue'
vi.mock('@/api/nodePrompts', async importOriginal => ({ ...await importOriginal<typeof import('@/api/nodePrompts')>(), nodePromptApi: { list: vi.fn() } }))

vi.mock('@/api/siteScript', async importOriginal => ({ ...await importOriginal<typeof import('@/api/siteScript')>(), generateSiteScript: vi.fn() }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  publishScript: vi.fn(), siteCodeVersions: vi.fn(), siteCodeContent: vi.fn(), bindSiteCode: vi.fn(),
  codeRepositories: vi.fn(), codeRepositoryDirectories: vi.fn(), codeRepositoryFiles: vi.fn(), codeRepositoryFileContent: vi.fn(),
  modelInterfaces: vi.fn(),
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
const defaultDirectory = (repoId: string): CodeRepositoryDirectory => ({ directoryId: 'default', repoId,
  name: '默认目录', configType: '', configTypeName: '', path: 'default', status: 'ACTIVE', isDefault: true, revision: 'v1' })
const webDirectory: CodeRepositoryDirectory = { ...defaultDirectory(webRepo.repoId), directoryId: 'web-dir',
  name: '网页列表代码', configType: '90', configTypeName: '网页抓取', path: '网页/列表', isDefault: false }
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
  global: { stubs, directives: { loading: {} }, plugins: [createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })] },
})

beforeEach(() => {
  vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 0, items: [{ id: 'legacy', name: '现有服务', kind: 'site-script', model: '', endpoint: 'http://127.0.0.1:8091/api/ai/site-script/generate', enabled: true, isDefault: true, timeoutSeconds: 120, inputFileDir: '', codeDir: '', outputFileDir: '', stream: true }] })
  vi.mocked(nodePromptApi.list).mockResolvedValue([])
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => [defaultDirectory(repoId)])
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([webRepo, defaultRepo])
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([])
})
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })
it('选择大模型后按所选接口生成，停用的模型不出现在选项中', async () => {
  const legacy = (await runnerManagementApi.modelInterfaces()).items[0]!
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 1, items: [legacy,
    { ...legacy, id: 'chat-hy3', name: 'Chat', kind: 'chat', model: 'hy3', isDefault: false },
    { ...legacy, id: 'disabled', name: '停用接口', enabled: false, isDefault: false }] })
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [] })
  const w = mountDialog(); await flushPromises()
  expect(w.get('[data-testid="site-script-model"]').text()).not.toContain('停用接口')
  await w.get('[data-testid="site-script-model"]').setValue('chat-hy3')
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'chat-hy3' }), expect.any(AbortSignal))
  w.unmount()
})
it('模型配置查询失败时保留编辑区并阻止调用其他默认服务', async () => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockRejectedValue(new Error('配置服务不可用'))
  const w = mountDialog(); await flushPromises()
  expect(w.text()).toContain('模型接口加载失败：配置服务不可用')
  expect((w.get('[data-testid="site-script-generate"]').element as HTMLButtonElement).disabled).toBe(true)
  expect(w.find('[data-testid="site-script-prompt"]').exists()).toBe(true)
  expect(generateSiteScript).not.toHaveBeenCalled()
  w.unmount()
})
it('选择其他命名提示词并保存选择，已有代码恢复原选择和内容', async () => {
  const template = { promptId: 8, promptName: '新闻代码提示词', nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', templateUse: 'script' as const, revision: 'r1', isActive: 1, isDefault: 1, systemPrompt: '新闻系统', userPromptTemplate: '新闻需求' }
  const alternate = { ...template, promptId: 9, promptName: '公告代码提示词', isDefault: 0, systemPrompt: '公告系统 {{url}}', userPromptTemplate: '公告需求 {{describe}}' }
  vi.mocked(nodePromptApi.list).mockResolvedValue([template, alternate])
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...oldVersion, promptTemplateId: 9 })
  const w = mountDialog({ configType: '90', initialPrompt: '抓取公告' }); await flushPromises()
  expect(w.getComponent(PromptTemplatePicker).props('modelValue')).toBe(8)
  w.getComponent(PromptTemplatePicker).vm.$emit('select', 9); await flushPromises()
  expect((w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe('公告需求 抓取公告')
  await w.get('[data-testid="site-script-manual"]').trigger('click')
  await w.get('[aria-label="可编辑 Python 代码"]').setValue(sampleCode)
  await w.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ promptTemplateId: 9, userPrompt: '公告需求 抓取公告' }))
  w.unmount()
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([{ ...oldVersion, promptTemplateId: 9 }])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...oldVersion, promptTemplateId: 9, systemPrompt: '已保存系统提示词', code: sampleCode })
  const existing = mountDialog({ configType: '90' }); await flushPromises()
  expect(existing.getComponent(PromptTemplatePicker).props('modelValue')).toBe(9)
  expect((existing.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe('已保存系统提示词')
  existing.unmount()
})
it('按节点类型读取默认代码模板，替换变量；已有版本的提示词保持独立', async () => {
  vi.mocked(nodePromptApi.list).mockResolvedValue([{ promptId: 8, promptName: '网页默认提示词', nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', templateUse: 'script', revision: 'r1', isActive: 1, isDefault: 1,
    systemPrompt: '抓取 {{url}}，字段 {{output_fields}}', userPromptTemplate: '业务 {{describe}}，队列 {{queue_name}}' }])
  const wrapper = mountDialog({ configType: '90', initialPrompt: '提取新闻', templateVariables: { output_fields: 'title,date' } })
  await flushPromises()
  expect(nodePromptApi.list).toHaveBeenCalledWith({ sourceType: '90', templateUse: 'script' })
  expect((wrapper.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toContain('字段 title,date')
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toContain('业务 提取新闻')
  wrapper.unmount()
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([oldVersion])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...oldVersion, code: sampleCode, systemPrompt: '已保存系统提示词' })
  const existing = mountDialog({ configType: '90' }); await flushPromises()
  expect((existing.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe('已保存系统提示词')
  expect((existing.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(oldVersion.prompt)
  existing.unmount()
})
it('已保存代码路径在新标签页打开对应仓库文件，未保存的位置不提供链接', async () => {
  const linked = { ...oldVersion, directoryId: 'default', storagePath: 'default/www.realcan.cn.py' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  const wrapper = mountDialog({ open: false }); await flushPromises()
  const link = wrapper.get('[data-testid="site-script-open-repository"]')
  const target = new URL(link.attributes('href')!, 'http://localhost')
  expect(target.pathname).toBe('/settings')
  expect(Object.fromEntries(target.searchParams)).toEqual({ tab: 'code-repos', repoId: webRepo.repoId, filePath: linked.storagePath, directoryId: 'default' })
  expect(link.attributes('target')).toBe('_blank')
  await wrapper.setProps({ open: true }); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-workspace-repository"]').attributes('href')).toBe(link.attributes('href'))
  await wrapper.get('[aria-label="可编辑 Python 代码"]').setValue(sampleCode + '# 未保存的编辑\n')
  expect(wrapper.find('[data-testid="site-script-open-repository"]').exists()).toBe(true)
  await wrapper.get('[data-testid="site-script-name-mode"]').setValue('queue')
  expect(wrapper.find('[data-testid="site-script-open-repository"]').exists()).toBe(false)
  wrapper.unmount()
})
it('新生成代码保存成功后才显示仓库文件链接', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ code: sampleCode, warnings: [], fileName: 'www.realcan.cn.py' })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...oldVersion, repoId: defaultRepo.repoId, directoryId: 'default', storagePath: 'default/www.realcan.cn.py' })
  const wrapper = mountDialog(); await flushPromises()
  expect(wrapper.find('[data-testid="site-script-open-repository"]').exists()).toBe(false)
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-testid="site-script-open-repository"]').exists()).toBe(false)
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-open-repository"]').attributes('href')).toContain('repoId=repo-default')
  expect(wrapper.emitted('saved')?.[0]).toEqual([expect.objectContaining({ scriptDigest: oldVersion.scriptDigest }), 'c-1', 'news_list'])
  wrapper.unmount()
})
it('编排页先展示仓库与节点类型，工作区只显示提示词和代码编辑', async () => {
  const wrapper = mountDialog({ open: false }); await flushPromises()
  const configuration = wrapper.get('[data-testid="site-script-configuration"]')
  expect(configuration.find('[data-testid="site-script-repository"]').exists()).toBe(true)
  expect(configuration.find('[data-testid="site-script-directory"]').exists()).toBe(true)
  expect(configuration.find('[data-testid="site-script-node-type"]').exists()).toBe(true)
  expect(configuration.find('[data-testid="site-script-storage-path"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="site-script-url"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="site-script-dialog"]').exists()).toBe(false)
  await wrapper.setProps({ open: true }); await flushPromises()
  const workspace = wrapper.get('[data-testid="site-script-dialog"]')
  expect(workspace.find('[data-testid="site-script-prompt"]').exists()).toBe(true)
  expect(workspace.find('[data-testid="site-script-code-panel"]').exists()).toBe(true)
  for (const field of ['repository', 'directory', 'node-type', 'url', 'name-mode', 'storage-path']) {
    expect(workspace.find(`[data-testid="site-script-${field}"]`).exists()).toBe(false)
  }
  wrapper.unmount()
})
it('打开工作区前恢复已有代码位置，手选的仓库与命名方式不会被读取代码覆盖', async () => {
  const linked = { ...oldVersion, directoryId: 'default', storagePath: 'default/www.realcan.cn.py', sourceRepoPath: 'default/source.py', sourceGitCommit: 'c'.repeat(40) }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...linked, repoId: defaultRepo.repoId, storagePath: 'default/news_list.py' })
  const wrapper = mountDialog({ open: false }); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect(runnerManagementApi.siteCodeContent).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="site-script-repository"]').setValue(defaultRepo.repoId)
  await wrapper.get('[data-testid="site-script-name-mode"]').setValue('queue')
  await wrapper.setProps({ open: true }); await flushPromises()
  expect(runnerManagementApi.siteCodeContent).toHaveBeenCalledWith(linked.scriptDigest)
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/site-scripts/default/news_list.py')
  expect(wrapper.find('[data-testid="site-script-source-file"]').exists()).toBe(false)
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toBe(sampleCode)
  await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises()
  expect(runnerManagementApi.siteCodeContent).toHaveBeenCalledTimes(1)
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({
    codeId: linked.codeId, repositoryId: defaultRepo.repoId, directoryId: 'default', fileNameMode: 'queue', fileName: 'news_list.py',
  }))
  expect(vi.mocked(runnerManagementApi.publishScript).mock.calls[0]![0].sourceFilePath).toBeUndefined()
  wrapper.unmount()
})
it('关闭代码工作区不会中断外部配置区的目录加载', async () => {
  let resolveDirectories!: (value: CodeRepositoryDirectory[]) => void
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(repoId => repoId === webRepo.repoId
    ? new Promise(resolve => { resolveDirectories = resolve }) : Promise.resolve([defaultDirectory(repoId)]))
  const wrapper = mountDialog(); await flushPromises()
  await wrapper.setProps({ open: false })
  resolveDirectories([webDirectory]); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect((wrapper.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe(webDirectory.directoryId)
  expect((wrapper.get('[data-testid="open-site-script-generator"]').element as HTMLButtonElement).disabled).toBe(false)
  wrapper.unmount()
})
it('命名方式只提交文件名，不传网站运行范围或预设下发目录', async () => {
  const wrapper = mountDialog(); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-name-mode"]').text()).toContain('按网站命名')
  expect(wrapper.get('[data-testid="site-script-file-name"]').text()).toBe('www.realcan.cn.py')
  expect(wrapper.text()).not.toContain('网站专用')
  expect(wrapper.get('[data-testid="site-script-dialog"]').find('[data-testid="site-script-name-mode"]').exists()).toBe(false)
  await wrapper.get('[data-testid="site-script-name-mode"]').setValue('queue')
  expect(wrapper.get('[data-testid="site-script-file-name"]').text()).toBe('news_list.py')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/site-scripts/default/news_list.py')
  await wrapper.get('[data-testid="site-script-manual"]').trigger('click')
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...oldVersion, siteHost: '', deliveryPath: 'news_list.py' })
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  const payload = vi.mocked(runnerManagementApi.publishScript).mock.calls[0]![0]
  expect(payload).toMatchObject({ fileNameMode: 'queue', fileName: 'news_list.py' })
  expect(payload).not.toHaveProperty('siteHost')
  expect(payload).not.toHaveProperty('codeType')
  expect(runnerManagementApi.bindSiteCode).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('已有代码切换命名继续传原代码 ID，历史文件名不由当前 URL 重算', async () => {
  const historical = { ...oldVersion, siteHost: 'another.example.com', deliveryPath: 'sites/another.example.com.py' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([historical])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...historical, code: sampleCode })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...historical, deliveryPath: 'news_list.py' })
  const wrapper = mountDialog(); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-file-name"]').text()).toBe('another.example.com.py')
  await wrapper.get('[data-testid="site-script-name-mode"]').setValue('queue')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ codeId: oldVersion.codeId, fileName: 'news_list.py', fileNameMode: 'queue' }))
  wrapper.unmount()
})
it('按节点类型选择已配置目录，预览保存位置并随代码提交目录 ID', async () => {
  const base = { repoId: defaultRepo.repoId, status: 'ACTIVE' as const, isDefault: false, revision: 'v1' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockResolvedValue([
    { ...base, directoryId: 'default', name: '默认目录', path: 'default', configType: '', configTypeName: '', isDefault: true },
    { ...base, directoryId: 'web-dir', name: '网页列表目录', path: '网页/列表', configType: '90', configTypeName: '网页抓取' },
    { ...base, directoryId: 'ocr-dir', name: 'OCR 目录', path: 'ocr', configType: '150', configTypeName: 'OCR' },
    { ...base, directoryId: 'off-dir', name: '停用目录', path: 'old', configType: '90', configTypeName: '网页抓取', status: 'DISABLED' },
  ])
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [] })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...oldVersion, repoId: defaultRepo.repoId, directoryId: 'web-dir', storagePath: '网页/列表/www.realcan.cn.py' })
  const wrapper = mountDialog(); await flushPromises()
  const selector = wrapper.get('[data-testid="site-script-directory"]')
  expect((selector.element as HTMLSelectElement).value).toBe('web-dir')
  expect(selector.text()).toContain('网页列表目录')
  expect(selector.text()).not.toContain('OCR 目录')
  expect(selector.text()).not.toContain('停用目录')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/site-scripts/网页/列表/www.realcan.cn.py')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ directoryId: 'web-dir', repositoryId: defaultRepo.repoId }))
  wrapper.unmount()
})
it('跨仓库匹配当前节点类型目录，多个匹配仓库可选择并保存节点关联', async () => {
  const alternate = { ...webRepo, repoId: 'repo-alternate', name: '第二网页仓库', path: 'E:/ce/alternate' }
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([webRepo, alternate, defaultRepo])
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => repoId === defaultRepo.repoId
    ? [defaultDirectory(repoId)] : [{ ...webDirectory, repoId }])
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [] })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...oldVersion, repoId: alternate.repoId,
    directoryId: webDirectory.directoryId, storagePath: '网页/列表/www.realcan.cn.py' })
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect(wrapper.get('[data-testid="site-script-node-type"]').text()).toContain('[90] 网页抓取')
  expect(wrapper.get('[data-testid="site-script-destination"]').text()).toBe('网页抓取代码 / 网页列表代码')
  expect(wrapper.get('[data-testid="site-script-repository"]').text()).toContain('第二网页仓库 · 已配置当前节点类型')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  await wrapper.get('[data-testid="site-script-repository"]').setValue(alternate.repoId)
  expect((wrapper.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe(webDirectory.directoryId)
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/alternate/网页/列表/www.realcan.cn.py')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({
    configId: 'c-1', queueName: 'news_list', configType: '90', repositoryId: alternate.repoId, directoryId: webDirectory.directoryId, code: sampleCode,
  }))
  wrapper.unmount()
})
it('已有代码优先恢复原来的通用目录，不被其他仓库的类型匹配改写', async () => {
  const linked = { ...oldVersion, repoId: defaultRepo.repoId, directoryId: 'default', storagePath: 'default/www.realcan.cn.py' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => repoId === webRepo.repoId
    ? [webDirectory] : [defaultDirectory(repoId)])
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(defaultRepo.repoId)
  expect((wrapper.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe('default')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})
it('部分仓库目录加载失败不影响其他仓库，失败位置禁止提交且可刷新恢复', async () => {
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => {
    if (repoId === defaultRepo.repoId) throw new Error('仓库不可达')
    return [webDirectory]
  })
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  await wrapper.get('[data-testid="site-script-manual"]').trigger('click')
  await wrapper.get('[data-testid="site-script-repository"]').setValue(defaultRepo.repoId)
  expect(wrapper.text()).toContain('目录加载失败：仓库不可达')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => [defaultDirectory(repoId)])
  await wrapper.get('[data-testid="site-script-refresh-directories"]').trigger('click'); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(defaultRepo.repoId)
  expect((wrapper.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe('default')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(false)
  wrapper.unmount()
})
it('原仓库停用时保留原关联，必须手工选择新仓库后才能保存', async () => {
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([{ ...webRepo, status: 'DISABLED' }, defaultRepo])
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([oldVersion])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...oldVersion, code: sampleCode })
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect(wrapper.text()).toContain('原仓库已停用或与节点类型不匹配')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  expect(runnerManagementApi.codeRepositoryDirectories).not.toHaveBeenCalledWith(webRepo.repoId)
  await wrapper.get('[data-testid="site-script-repository"]').setValue(defaultRepo.repoId)
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(false)
  wrapper.unmount()
})
it('已有代码恢复保存目录，切换目录即可重新保存，读取失败禁止提交', async () => {
  const linked = { ...oldVersion, directoryId: 'web-dir', storagePath: 'web/www.realcan.cn.py' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => [
    { directoryId: 'web-dir', repoId, name: '已有目录', path: 'web', configType: '90', configTypeName: '网页', status: 'ACTIVE', isDefault: false, revision: 'v1' },
    { directoryId: 'next-dir', repoId, name: '其他目录', path: 'next', configType: '90', configTypeName: '网页', status: 'ACTIVE', isDefault: false, revision: 'v1' },
  ])
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe('web-dir')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  await wrapper.get('[data-testid="site-script-directory"]').setValue('next-dir')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(false)
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/web-code/next/www.realcan.cn.py')
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toBe(sampleCode)
  wrapper.unmount()
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([])
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockRejectedValue(new Error('目录加载失败'))
  const failed = mountDialog(); await flushPromises()
  expect(failed.text()).toContain('目录加载失败')
  expect((failed.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  failed.unmount()
})

it('原配置和队列子目录的代码可直接保存到所选目录，无代码修改也可迁移', async () => {
  const nested = { ...oldVersion, directoryId: 'web-dir', storagePath: 'web/c-1/news_list/www.realcan.cn.py' }
  const flat = { ...nested, storagePath: 'web/www.realcan.cn.py', scriptDigest: 'sha256:flat' }
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => [{ directoryId: 'web-dir', repoId, name: '网页代码', path: 'web', configType: '90', configTypeName: '网页', status: 'ACTIVE', isDefault: false, revision: 'v1' }])
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValueOnce([nested]).mockResolvedValueOnce([flat])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...nested, code: sampleCode })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue(flat)
  const wrapper = mountDialog(); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/web-code/web/www.realcan.cn.py')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(false)
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ codeId: nested.codeId, directoryId: 'web-dir', fileName: 'www.realcan.cn.py' }))
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})

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
  expect(wrapper.get('[data-testid="site-script-file-name"]').text()).toBe('www.realcan.cn.py')
  wrapper.unmount()
})

it('系统和用户提示词独立编辑，生成及保存均提交两份内容，恢复默认互不覆盖', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [] })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ ...oldVersion, repoId: defaultRepo.repoId, storagePath: 'default/www.realcan.cn.py' })
  const wrapper = mountDialog(); await flushPromises()
  await wrapper.get('[data-testid="site-script-system-prompt"]').setValue('系统：保留指定函数接口')
  await wrapper.get('[data-testid="site-script-prompt"]').setValue('用户：抓取标题和发布日期')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: '系统：保留指定函数接口', userPrompt: '用户：抓取标题和发布日期', prompt: '用户：抓取标题和发布日期' }), expect.any(AbortSignal))
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: '系统：保留指定函数接口', userPrompt: '用户：抓取标题和发布日期' }))
  await wrapper.get('[data-testid="site-script-reset-system-prompt"]').trigger('click')
  expect((wrapper.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe(DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT)
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe('用户：抓取标题和发布日期')
  wrapper.unmount()
})
it('已有版本恢复各自提示词，修改系统提示词后标记待保存，空提示词阻止生成', async () => {
  const saved = { ...oldVersion, directoryId: 'default', storagePath: 'default/www.realcan.cn.py', systemPrompt: '历史系统提示词', userPrompt: '历史用户提示词' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([saved])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...saved, code: sampleCode })
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe(saved.systemPrompt)
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(saved.userPrompt)
  expect(wrapper.text()).toContain('已保存并提交 Git')
  await wrapper.get('[data-testid="site-script-system-prompt"]').setValue('修改后的系统规则')
  expect(wrapper.text()).toContain('有修改待保存')
  await wrapper.get('[data-testid="site-script-system-prompt"]').setValue('')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(generateSiteScript).not.toHaveBeenCalled()
  expect(wrapper.get('[data-testid="site-script-error"]').text()).toContain('请填写系统提示词')
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
  expect(generateSiteScript).toHaveBeenCalledWith({ taskId: expect.any(String), interfaceId: 'legacy', prompt: '抓取新闻列表', userPrompt: '抓取新闻列表', systemPrompt: DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT, url: 'https://www.realcan.cn/newscenter', sampleId: 'www.realcan.cn.py' }, expect.any(AbortSignal))
  expect(vi.mocked(generateSiteScript).mock.calls[0]![0].taskId).not.toBe(vi.mocked(generateSiteScript).mock.calls[1]![0].taskId)
  wrapper.unmount()
})

it('已有代码读取原仓库及代码，预览按目录保存的位置', async () => {
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([
    { ...oldVersion, siteHost: 'other.example.com', scriptDigest: 'sha256:other' }, oldVersion,
  ])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...oldVersion, code: sampleCode })
  const wrapper = mountDialog()
  await flushPromises()
  expect(runnerManagementApi.siteCodeContent).toHaveBeenCalledWith(oldVersion.scriptDigest)
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/web-code/default/www.realcan.cn.py')
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toBe(sampleCode)
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(oldVersion.prompt)
  expect((wrapper.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe(DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT)
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(false)
  expect(wrapper.get('[data-testid="site-code-versions"]').text()).not.toContain('队列通用')
  wrapper.unmount()
})

it('自动载入按队列命名的代码，可切换历史版本', async () => {
  const generic = { ...oldVersion, siteHost: '', deliveryPath: 'news_list.py', scriptDigest: 'sha256:generic' }
  const older = { ...generic, scriptDigest: 'sha256:older', gitCommit: 'b'.repeat(40) }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([generic, older])
  vi.mocked(runnerManagementApi.siteCodeContent)
    .mockResolvedValueOnce({ ...generic, code: sampleCode })
    .mockResolvedValueOnce({ ...older, code: 'def scrape(url):\n    return ["old"]\n' })
  const wrapper = mountDialog()
  await flushPromises()
  expect(wrapper.get('[data-testid="site-script-file-name"]').text()).toBe('news_list.py')
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
  const saved = { ...oldVersion, repoId: defaultRepo.repoId, repoName: defaultRepo.name, repoPath: defaultRepo.path, storagePath: 'default/www.realcan.cn.py', directoryId: 'default', scriptDigest: 'sha256:new' }
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
    configId: 'c-1', queueName: 'news_list', fileName: 'www.realcan.cn.py', fileNameMode: 'website', configType: '90', repositoryId: defaultRepo.repoId, code: sampleCode,
  }))
  expect(runnerManagementApi.bindSiteCode).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('运行环境')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/site-scripts/default/www.realcan.cn.py')
  expect(wrapper.get('[data-testid="site-script-saved"]').text()).toContain('sha256:new')
  expect((wrapper.get('[data-testid="site-script-publish"]').element as HTMLButtonElement).disabled).toBe(true)
  wrapper.unmount()
})

it('从仓库选择 Python 文件后保存来源文件与 Git 提交', async () => {
  const sourceCode = 'def scrape(url):\n    return [{"url": url}]\n'
  const sourceCommit = 'c'.repeat(40)
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => repoId === webRepo.repoId
    ? [{ ...webDirectory, path: '网页抓取' }] : [defaultDirectory(repoId)])
  vi.mocked(runnerManagementApi.codeRepositoryFiles).mockResolvedValue({ repoId: webRepo.repoId, uploadDirectory: '网页抓取', total: 1, page: 1, pageSize: 50,
    items: [{ path: '网页抓取/scraper.py', size: sourceCode.length, managed: false, canDelete: true, gitUrl: '' }] })
  vi.mocked(runnerManagementApi.codeRepositoryFileContent).mockResolvedValue({ repoId: webRepo.repoId, path: '网页抓取/scraper.py', size: sourceCode.length, content: sourceCode, gitCommit: sourceCommit })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue(oldVersion)
  const wrapper = mountDialog()
  await flushPromises()
  await wrapper.get('[data-testid="site-script-repository"]').setValue(webRepo.repoId)
  await wrapper.get('[data-testid="site-script-choose-repo-file"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.codeRepositoryFiles).toHaveBeenCalledWith(webRepo.repoId, '', 1, webDirectory.directoryId)
  await wrapper.get('[data-testid="site-script-file-网页抓取/scraper.py"]').trigger('click')
  await flushPromises()
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toBe(sourceCode)
  expect(wrapper.get('[data-testid="site-script-source-file"]').text()).toContain('网页抓取/scraper.py')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({
    repositoryId: webRepo.repoId, directoryId: webDirectory.directoryId, code: sourceCode, sourceFilePath: '网页抓取/scraper.py', sourceGitCommit: sourceCommit,
  }))
  wrapper.unmount()
})

it('源 URL 改变后清除旧代码，生成自动使用最新地址', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'latest.example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog()
  await flushPromises()
  await wrapper.get('[data-testid="site-script-manual"]').trigger('click')
  await wrapper.setProps({ initialUrl: 'https://new.example.com/list' })
  await flushPromises()
  expect(wrapper.find('[data-testid="site-script-editor"]').exists()).toBe(false)
  await wrapper.setProps({ open: false, initialUrl: 'https://latest.example.com/list' })
  await wrapper.setProps({ open: true })
  await flushPromises()
  expect(wrapper.get('[data-testid="site-script-file-name"]').text()).toBe('latest.example.com.py')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://latest.example.com/list' }), expect.any(AbortSignal))
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
it('切换节点类型后忽略之前仓库目录的迟到响应', async () => {
  const ocrRepo = { ...webRepo, repoId: 'repo-ocr', configType: '150', configTypeName: 'OCR', name: 'OCR 仓库' }
  let resolveOld!: (value: CodeRepositoryDirectory[]) => void
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValueOnce([defaultRepo, webRepo]).mockResolvedValueOnce([defaultRepo, ocrRepo])
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(repoId => {
    if (repoId === webRepo.repoId) return new Promise(resolve => { resolveOld = resolve })
    return Promise.resolve(repoId === ocrRepo.repoId
      ? [{ ...webDirectory, repoId, directoryId: 'ocr-dir', configType: '150', configTypeName: 'OCR', name: 'OCR 目录', path: 'ocr' }]
      : [defaultDirectory(repoId)])
  })
  const wrapper = mountDialog(); await flushPromises()
  await wrapper.setProps({ configId: 'c-2', configType: '150', initialUrl: 'https://new.example.com/list' }); await flushPromises()
  resolveOld([webDirectory]); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(ocrRepo.repoId)
  expect((wrapper.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe('ocr-dir')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).toBe('E:/ce/web-code/ocr/new.example.com.py')
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
