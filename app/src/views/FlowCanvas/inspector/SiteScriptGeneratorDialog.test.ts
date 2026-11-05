// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import SiteScriptGeneratorDialog from './SiteScriptGeneratorDialog.vue'
import { DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT, generateSiteScript, submitSiteScriptTask } from '@/api/siteScript'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type SiteCodeVersion } from '@/api/runnerManagement'
import { nodePromptApi } from '@/api/nodePrompts'
import PromptTemplatePicker from './PromptTemplatePicker.vue'
import { sourceApi } from '@/api'
vi.mock('@/api/nodePrompts', async importOriginal => ({ ...await importOriginal<typeof import('@/api/nodePrompts')>(), nodePromptApi: { list: vi.fn() } }))

vi.mock('@/api/siteScript', async importOriginal => ({ ...await importOriginal<typeof import('@/api/siteScript')>(), generateSiteScript: vi.fn(), submitSiteScriptTask: vi.fn() }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  publishScript: vi.fn(), siteCodeVersions: vi.fn(), siteCodeContent: vi.fn(), bindSiteCode: vi.fn(),
  previewScriptFile: vi.fn(), changeScriptFileAssociation: vi.fn(),
  codeRepositories: vi.fn(), codeRepositoryDirectories: vi.fn(), codeRepositoryFiles: vi.fn(), codeRepositoryFileContent: vi.fn(),
  modelInterfaces: vi.fn(),
  generatedCodeState: vi.fn(), saveGenerationPreference: vi.fn(), commitGeneratedCode: vi.fn(),
  nodeGenerationSettings: vi.fn(), saveNodeGenerationSettings: vi.fn(),
  codeGenerationServers: vi.fn(),
  resolveGenerationDestination: vi.fn(),
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
const promptWithQueue = (text: string) => `${text}\n\n【当前节点 MQ 主题】\nMQ 主题：news_list\n【MQ 主题结束】`
const defaultDirectory = (repoId: string): CodeRepositoryDirectory => ({ directoryId: 'default', repoId,
  name: '默认目录', configType: '', configTypeName: '', path: 'default', status: 'ACTIVE', isDefault: true, revision: 'v1' })
const webDirectory: CodeRepositoryDirectory = { ...defaultDirectory(webRepo.repoId), directoryId: 'web-dir',
  name: '网页列表代码', configType: '90', configTypeName: '网页抓取', path: '网页/列表', isDefault: false }
const stubs = {
  ElRadioGroup: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<div><slot /></div>' },
  ElRadioButton: { props: ['value'], template: '<span><slot /></span>' },
  ElInput: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ElSwitch: { props: ['modelValue', 'disabled', 'beforeChange'], template: '<button type="button" :disabled="disabled" @click="beforeChange()">{{ modelValue ? "开启" : "关闭" }}</button>' },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElSelect: { props: ['modelValue', 'disabled'], emits: ['update:modelValue', 'change'],
    template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)"><option value="" /><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
}
const mountDialog = (props: Partial<InstanceType<typeof SiteScriptGeneratorDialog>['$props']> = {}) => mount(SiteScriptGeneratorDialog, {
  props: { open: true, initialUrl: 'https://www.realcan.cn/newscenter', initialPrompt: '',
    configId: 'c-1', queueName: 'news_list', configType: '90', ...props },
  global: { stubs: { ...stubs, NodeDeploymentPanel: true }, directives: { loading: {} }, plugins: [createRouter({ history: createMemoryHistory(), routes: [{ path: '/settings', component: { template: '<div />' } }] })] },
})

beforeEach(() => {
  vi.mocked(runnerManagementApi.resolveGenerationDestination).mockResolvedValue({ repositoryId: defaultRepo.repoId, directoryId: 'default', directoryPath: 'default', repoName: defaultRepo.name, remoteUrl: '', branch: 'main', configType: '90', matchedBy: 'default' })
  vi.mocked(submitSiteScriptTask).mockResolvedValue({ taskId: '501', queue: 'code_mq' })
  vi.spyOn(sourceApi, 'codeConfigOptions').mockResolvedValue([{ configId: '201001', name: '代码生成', topic: 'code_mq', entryTypeId: null }])
  vi.mocked(runnerManagementApi.codeGenerationServers).mockResolvedValue({ items: [] })
  vi.mocked(runnerManagementApi.nodeGenerationSettings).mockResolvedValue({ configId: 'c-1', enabled: false, generation: null })
  vi.mocked(runnerManagementApi.saveNodeGenerationSettings).mockImplementation(async body => ({ configId: body.configId, enabled: false, generation: body.generation || null }))
  vi.mocked(runnerManagementApi.generatedCodeState).mockResolvedValue({ autoCommit: true, archive: null })
  vi.mocked(runnerManagementApi.saveGenerationPreference).mockImplementation(async (_id, autoCommit) => ({ autoCommit }))
  vi.stubEnv('VITE_FLOW_PROXY_TARGET', 'http://127.0.0.1:8090')
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 0, items: [{ id: 'legacy', name: '现有服务', kind: 'site-script', model: '', endpoint: 'http://127.0.0.1:8091/api/ai/site-script/generate', enabled: true, isDefault: true, timeoutSeconds: 120, inputFileDir: '', codeDir: '', outputFileDir: '', stream: true }] })
  vi.mocked(nodePromptApi.list).mockResolvedValue([])
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => [defaultDirectory(repoId)])
  vi.mocked(runnerManagementApi.codeRepositories).mockResolvedValue([webRepo, defaultRepo])
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([])
})
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs() })

it.each(['task', 'direct'] as const)('%s 生成的用户提示词包含输出字段名称和 ID，保留手工需求', async mode => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const outputFields = [{ prop: 'news_title', desc: '新闻标题', itemId: '12001', columnName: 'K1' }]
  const w = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', outputFields, outputTable: 'sense_data.TB_NEWS' })
  await flushPromises()
  expect((w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toContain('字段名：新闻标题；字段 ID：12001')
  await w.get('[data-testid="site-script-prompt"]').setValue('仅采集当前页，不要翻页')
  if (mode === 'direct') await w.get('[data-testid="generation-mode-direct"]').trigger('click')
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  const input = vi.mocked(mode === 'task' ? submitSiteScriptTask : generateSiteScript).mock.calls[0]![0]
  expect(input.userPrompt).toContain('仅采集当前页，不要翻页')
  expect(input.userPrompt).toContain('MQ 主题：news_list')
  expect(input.userPrompt?.match(/【当前节点 MQ 主题】/g)).toHaveLength(1)
  expect(input.userPrompt).toContain('字段名：新闻标题；字段 ID：12001；字段标识：news_title；物理列：K1')
  expect(input.prompt).toBe(input.userPrompt)
  expect(input.userPrompt?.match(/【当前节点输出字段】/g)).toHaveLength(1)
  w.unmount()
})

it('字段异步加载和重新选择时更新提示词字段段落，不覆盖用户输入', async () => {
  const w = mountDialog()
  await flushPromises()
  await w.get('[data-testid="site-script-prompt"]').setValue('保留的采集要求')
  await w.setProps({ outputFields: [{ prop: 'title', desc: '标题', itemId: '100' }] })
  expect((w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toContain('字段 ID：100')
  await w.setProps({ outputFields: [{ prop: 'url', desc: '链接', itemId: '101' }] })
  const prompt = (w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value
  expect(prompt).toContain('保留的采集要求')
  expect(prompt).toContain('字段名：链接；字段 ID：101')
  expect(prompt).not.toContain('字段 ID：100')
  w.unmount()
})

it('旧生成配置回读后补齐输出字段并自动保存，批量生成也使用更新后的用户提示词', async () => {
  vi.mocked(runnerManagementApi.nodeGenerationSettings).mockResolvedValue({ configId: 'c-1', enabled: true, generation: {
    interfaceId: 'legacy', repositoryId: defaultRepo.repoId, directoryId: 'default', configType: '90', queueName: 'news_list',
    systemPrompt: '保留系统要求', userPrompt: '已保存的采集要求', url: 'https://www.realcan.cn/newscenter', fileNameMode: 'website', destinationMode: 'custom',
  } })
  const w = mountDialog({ outputFields: [{ prop: 'title', desc: '标题', itemId: '2001' }] })
  await flushPromises()
  const prompt = (w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value
  expect(prompt).toContain('已保存的采集要求')
  expect(prompt).toContain('字段名：标题；字段 ID：2001')
  expect((w.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe('保留系统要求')
  w.unmount(); await flushPromises()
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ configId: 'c-1', generation: expect.objectContaining({ userPrompt: prompt }) }))
})

it('模型配置入口跳转到合并后的服务器模型页并携带关联实例', async () => {
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 1, items: [{
    id: 'agent-home', name: 'home171 模型', kind: 'agent', model: 'hy3', endpoint: 'http://192.168.1.171:6000/wb/agent',
    enabled: true, isDefault: true, timeoutSeconds: 300, inputFileDir: '', codeDir: '', outputFileDir: '', stream: true,
    generationServerId: 'home171-instance', generationServerMode: 'manual',
  }] })
  const wrapper = mountDialog()
  await flushPromises()
  const link = wrapper.findAllComponents({ name: 'RouterLink' }).find(item => item.text() === '配置')!
  expect(link.props('to')).toEqual({ path: '/settings', query: { tab: 'code-servers', view: 'models', serverId: 'home171-instance' } })
  wrapper.unmount()
})

it('默认任务方式只提交任务，扩大提示词区域且隐藏代码编辑和过程', async () => {
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' })
  await flushPromises()
  expect(wrapper.get('[data-testid="generation-machine"]').text()).toContain('等待匹配的机器上线')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenCalledWith(expect.objectContaining({ taskContext: { sourceId: '1', flowId: '2', stepId: '3' } }), expect.any(AbortSignal))
  expect(generateSiteScript).not.toHaveBeenCalled()
  expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ configId: '1401081' }))
  wrapper.unmount(); await flushPromises()
})

it('切换调用接口时展示代码编辑区且不发送任务上下文', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3' }); await flushPromises()
  await wrapper.get('[data-testid="generation-mode-direct"]').trigger('click')
  expect(wrapper.get('[data-testid="generation-mode-direct"]').text()).toBe('调用接口')
  expect(wrapper.find('[data-testid="site-script-code-panel"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="generation-dispatch-config"]').exists()).toBe(false)
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(vi.mocked(generateSiteScript).mock.calls[0]?.[0].taskContext).toBeUndefined()
  expect(vi.mocked(generateSiteScript).mock.calls[0]?.[0].sourceContext).toEqual({ sourceId: '1', flowId: '2', stepId: '3' })
  expect(submitSiteScriptTask).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('任务提交携带所选模型配置快照，接口查询凭据不进入任务参数', async () => {
  const settings = await runnerManagementApi.modelInterfaces()
  const chosen = settings.items[0]!
  chosen.endpoint = 'http://model.example/wb/agent?api_key=secret-test-value'
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ ...settings, items: [chosen] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  const snapshot = vi.mocked(submitSiteScriptTask).mock.calls[0]![0].modelCall
  expect(snapshot).toMatchObject({ interfaceId: chosen.id, name: chosen.name, model: chosen.model, endpoint: 'http://model.example/wb/agent', timeoutSeconds: chosen.timeoutSeconds })
  expect(JSON.stringify(snapshot)).not.toContain('secret-test-value')
  wrapper.unmount()
})

it('切换方式保留提示词和已有代码，重新打开默认任务方式', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  await wrapper.get('[data-testid="site-script-prompt"]').setValue('保留这份用户提示词')
  await wrapper.get('[data-testid="generation-mode-direct"]').trigger('click')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[aria-label="可编辑 Python 代码"]').element).toHaveProperty('value', sampleCode)
  await wrapper.get('[data-testid="generation-mode-task"]').trigger('click')
  expect(wrapper.find('[data-testid="site-script-code-panel"]').exists()).toBe(false)
  await wrapper.get('[data-testid="generation-mode-direct"]').trigger('click')
  expect(wrapper.get('[aria-label="可编辑 Python 代码"]').element).toHaveProperty('value', sampleCode)
  expect(wrapper.get('[data-testid="site-script-prompt"]').element).toHaveProperty('value', promptWithQueue('保留这份用户提示词'))
  await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises()
  expect(wrapper.get('[data-testid="generation-mode-task"]').classes()).toContain('active')
  expect(wrapper.find('[data-testid="site-script-code-panel"]').exists()).toBe(false)
  wrapper.unmount()
})

it('任务提交失败时在提示词区域展示错误，不需要打开生成过程', async () => {
  vi.mocked(submitSiteScriptTask).mockRejectedValue(new Error('任务接口暂不可用'))
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-error"]').text()).toBe('任务接口暂不可用')
  expect(wrapper.find('[data-testid="site-script-code-panel"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="generation-task-status"]').exists()).toBe(false)
  expect(wrapper.emitted('update:open')).toBeUndefined()
  wrapper.unmount()
})

it('模型机器不存在时仍允许创建等待任务', async () => {
  vi.mocked(runnerManagementApi.codeGenerationServers).mockResolvedValue({ items: [{ serverId: 'other-server', name: '其他机器', ipAddress: '192.168.1.172', status: 'online', endpoint: '', workspace: '', installDirectory: '', osType: '', osVersion: '', version: '', lastHeartbeat: '', mqCapable: true, mqGeneration: { configId: '201001', queue: 'code_mq', name: '代码生成' } }] })
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenCalledWith(expect.objectContaining({ taskContext: expect.objectContaining({ sourceId: '1', flowId: '2', stepId: '3' }) }), expect.any(AbortSignal))
  expect(wrapper.text()).not.toContain('该派发队列属于其他模型')
  wrapper.unmount()
})

it('机器列表暂时读取失败也不阻止任务创建', async () => {
  vi.mocked(runnerManagementApi.codeGenerationServers).mockRejectedValue(new Error('HTTP 502'))
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  expect(wrapper.get('[data-testid="generation-machine"]').text()).toContain('任务仍可提交')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenCalled()
  wrapper.unmount()
})

it('所选模型关联离线机器时不阻止任务提交', async () => {
  const model = (await runnerManagementApi.modelInterfaces()).items[0]!
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 0, items: [{ ...model, kind: 'agent', generationServerId: 'server-1' }] })
  vi.mocked(runnerManagementApi.codeGenerationServers).mockResolvedValue({ items: [{ serverId: 'server-1', name: 'home171', ipAddress: '192.168.1.171', status: 'offline', endpoint: '', workspace: '', installDirectory: '', osType: '', osVersion: '', version: '', lastHeartbeat: '', mqCapable: true, mqGeneration: { configId: '201001', queue: 'code_mq', name: '代码生成' } }] })
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  expect(wrapper.get('[data-testid="generation-machine"]').text()).toContain('home171 · 192.168.1.171 · 离线')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenCalledWith(expect.objectContaining({ taskContext: expect.objectContaining({ sourceId: '1', flowId: '2', stepId: '3' }) }), expect.any(AbortSignal))
  wrapper.unmount()
})

it('切换模型后任务快照采用所选模型', async () => {
  const model = (await runnerManagementApi.modelInterfaces()).items[0]!
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 0, items: [
    { ...model, id: 'agent-1', kind: 'agent', generationServerId: 'server-1' },
    { ...model, id: 'agent-2', kind: 'agent', generationServerId: 'server-2', isDefault: false },
  ] })
  vi.mocked(sourceApi.codeConfigOptions).mockResolvedValue([
    { configId: '201001', name: '机器一', topic: 'code_mq_1', entryTypeId: null },
    { configId: '201002', name: '机器二', topic: 'code_mq_2', entryTypeId: null },
  ])
  vi.mocked(runnerManagementApi.codeGenerationServers).mockResolvedValue({ items: [1, 2].map(index => ({
    serverId: `server-${index}`, name: `生成机器${index}`, ipAddress: `192.168.1.${index}`, status: 'online', endpoint: '', workspace: '', installDirectory: '', osType: '', osVersion: '', version: '', lastHeartbeat: '', mqCapable: true,
    mqGeneration: { configId: `20100${index}`, queue: `code_mq_${index}`, name: `机器${index}` },
  })) })
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'example.com.py', code: sampleCode, warnings: [] })
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '1401081' }); await flushPromises()
  await wrapper.get('[data-testid="site-script-model"]').setValue('agent-2'); await flushPromises()
  expect(wrapper.get('[data-testid="generation-machine"]').text()).toContain('生成机器2')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'agent-2', taskContext: expect.objectContaining({ sourceId: '1', flowId: '2', stepId: '3' }) }), expect.any(AbortSignal))
  wrapper.unmount()
})
it('生成时展示实际过程，失败后保留输出且按文本显示', async () => {
  let reject!: (error: Error) => void
  vi.mocked(generateSiteScript).mockImplementation((_input, _signal, onEvent) => {
    onEvent?.({ type: 'request', request: { method: 'POST', url: 'http://192.168.1.171:6000/wb/agent', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: { prj_dir: 'D:\\aicode', prompt: '最终系统要求与用户要求', cdp_port: 9223 } } })
    onEvent?.({ type: 'progress', message: '正在连接模型' })
    onEvent?.({ type: 'chunk', text: 'event: output\ndata: ' + JSON.stringify({ message: '正在分析网页 <script>literal</script>' }) + '\n\n' })
    return new Promise((_resolve, failure) => { reject = failure })
  })
  const w = mountDialog(); await flushPromises()
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(w.get('[data-testid="site-script-process"]').text()).toContain('正在连接模型')
  expect(w.get('[data-testid="site-script-process-output"]').text()).toContain('<script>literal</script>')
  expect(w.get('[data-testid="site-script-process-output"]').text()).not.toContain('data:')
  expect(w.find('[data-testid="site-script-process-output"] script').exists()).toBe(false)
  await w.get('[data-testid="site-script-request-tab"]').trigger('click')
  expect(w.get('[data-testid="site-script-model-request"]').text()).toContain('POST http://192.168.1.171:6000/wb/agent')
  expect(w.get('[data-testid="site-script-model-request"]').text()).toContain('最终系统要求与用户要求')
  expect(w.get('[data-testid="site-script-model-request"]').text()).toContain('"cdp_port": 9223')
  await w.findAll('button').find(button => button.text() === '过程输出')!.trigger('click')
  reject(new Error('模型失败')); await flushPromises()
  expect(w.get('[data-testid="site-script-process"]').text()).toContain('模型失败')
  expect(w.get('[data-testid="site-script-process-output"]').text()).toContain('正在分析网页')
  w.unmount()
})
const generatedArchive = { archiveId: 'a'.repeat(32), status: 'pending' as const, message: '', configId: 'c-1', repoId: webRepo.repoId,
  directoryId: 'default', directoryPath: 'default', taskId: 'task', serverId: 'server', createdAt: '', gitCommit: '', pushed: false,
  files: [{ path: 'default/www.realcan.cn.py', relativePath: 'www.realcan.cn.py', sha256: 'hash', size: 10 }] }
it('生成子目录自动保存并随生成请求传递，目录预览包含 sites', async () => {
  const w = mountDialog({ sourceId: '1', flowId: '2', stepId: '3', configId: '4' }); await flushPromises()
  await w.get('[data-testid="site-script-output-subdirectory"]').setValue('sites')
  expect(w.get('[data-testid="site-script-output-directory"]').text()).toContain('/code/sites')
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenCalledWith(expect.objectContaining({ outputSubdirectory: 'sites' }), expect.any(AbortSignal))
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ generation: expect.objectContaining({ outputSubdirectory: 'sites' }) }))
  w.unmount()
})
it('修改生成配置后自动保存，关闭工作区立即提交待保存内容，不调用模型或发布代码', async () => {
  const w = mountDialog(); await flushPromises()
  expect(w.find('[data-testid="save-generation-config"]').exists()).toBe(false)
  expect(runnerManagementApi.saveNodeGenerationSettings).not.toHaveBeenCalled()
  await w.get('[data-testid="site-script-prompt"]').setValue('新的抓取提示词')
  expect(runnerManagementApi.saveNodeGenerationSettings).not.toHaveBeenCalled()
  w.unmount(); await flushPromises()
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ configId: 'c-1', generation: expect.objectContaining({ interfaceId: 'legacy', userPrompt: expect.any(String), systemPrompt: DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT, repositoryId: defaultRepo.repoId, directoryId: 'default' }) }))
  expect(generateSiteScript).not.toHaveBeenCalled()
  expect(runnerManagementApi.publishScript).not.toHaveBeenCalled()
})
it('重新进入 AI 工作区恢复节点保存的模型和提示词', async () => {
  vi.mocked(runnerManagementApi.nodeGenerationSettings).mockResolvedValue({ configId: 'c-1', enabled: true, generation: {
    interfaceId: 'legacy', repositoryId: defaultRepo.repoId, directoryId: 'default', configType: '90', queueName: 'news_list',
    systemPrompt: '批量系统提示词', userPrompt: '采集 https://old.example.com/news', url: 'https://old.example.com/news', fileNameMode: 'queue', workspaceMode: 'custom', workspacePath: 'news/cninfo', codeDirectory: 'manual/code',
  } })
  const w = mountDialog(); await flushPromises()
  expect((w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(promptWithQueue('采集 https://www.realcan.cn/newscenter'))
  expect(runnerManagementApi.saveNodeGenerationSettings).not.toHaveBeenCalled()
  await w.get('[data-testid="site-script-system-prompt"]').setValue('更新后的系统提示词')
  w.unmount(); await flushPromises()
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ generation: expect.objectContaining({ repositoryId: defaultRepo.repoId, systemPrompt: '更新后的系统提示词', userPrompt: promptWithQueue('采集 https://www.realcan.cn/newscenter'), fileNameMode: 'queue' }) }))
  const saved = vi.mocked(runnerManagementApi.saveNodeGenerationSettings).mock.calls.at(-1)![0].generation!
  expect(saved).not.toHaveProperty('workspaceMode'); expect(saved).not.toHaveProperty('workspacePath'); expect(saved).not.toHaveProperty('codeDirectory')
})
it('连续编辑提示词合并为一次自动保存，保存失败明确显示', async () => {
  vi.mocked(runnerManagementApi.saveNodeGenerationSettings).mockRejectedValue(new Error('网络断开'))
  const w = mountDialog(); await flushPromises()
  await w.get('[data-testid="site-script-prompt"]').setValue('第一次修改')
  await w.get('[data-testid="site-script-prompt"]').setValue('最终修改')
  await new Promise(resolve => setTimeout(resolve, 750)); await flushPromises()
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledOnce()
  expect(runnerManagementApi.saveNodeGenerationSettings).toHaveBeenCalledWith(expect.objectContaining({ generation: expect.objectContaining({ userPrompt: promptWithQueue('最终修改') }) }))
  expect(w.text()).toContain('自动保存失败：网络断开')
  expect(w.get('[data-testid="site-script-prompt"]').attributes('disabled')).toBeUndefined()
  w.unmount()
})
async function remoteModel() {
  const legacy = (await runnerManagementApi.modelInterfaces()).items[0]!
  vi.mocked(runnerManagementApi.modelInterfaces).mockResolvedValue({ revision: 1, items: [{ ...legacy, kind: 'agent', generationServerId: 'server', model: 'hy3' }] })
}
it('按配置类型默认提交links，可切到自定义且任务请求保存选中的提交方式', async () => {
  await remoteModel()
  vi.mocked(runnerManagementApi.resolveGenerationDestination).mockResolvedValue({ repositoryId: webRepo.repoId, directoryId: webDirectory.directoryId,
    directoryPath: 'links', repoName: webRepo.name, remoteUrl: webRepo.remoteUrl, branch: 'main', configType: '90', matchedBy: 'type' })
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => repoId === webRepo.repoId ? [{ ...webDirectory, path: 'links' }] : [defaultDirectory(repoId)])
  const w = mountDialog({ sourceId: '1', flowId: '2', stepId: '3' }); await flushPromises()
  expect(w.get('[data-testid="generation-destination-mode"]').text()).toContain('按配置类型')
  expect((w.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect(w.get('[data-testid="site-script-storage-path"]').text()).toContain('links/c-1/')
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenLastCalledWith(expect.objectContaining({ destinationMode: 'type', repositoryId: webRepo.repoId, directoryId: webDirectory.directoryId }), expect.any(AbortSignal))
  await w.setProps({ open: false }); await w.setProps({ open: true }); await flushPromises()
  const modeControl = w.getComponent('[data-testid="generation-destination-mode"]') as VueWrapper
  modeControl.vm.$emit('update:modelValue', 'custom'); await flushPromises()
  await w.get('[data-testid="site-script-repository"]').setValue(defaultRepo.repoId); await flushPromises()
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(submitSiteScriptTask).toHaveBeenLastCalledWith(expect.objectContaining({ destinationMode: 'custom', repositoryId: defaultRepo.repoId, directoryId: 'default' }), expect.any(AbortSignal))
  w.unmount(); await flushPromises()
})
it('生成目录绑定Git时同步实际仓库与路径并锁定选择，改到未绑定目录后可自由选择', async () => {
  await remoteModel()
  vi.mocked(runnerManagementApi.codeRepositoryDirectories).mockImplementation(async repoId => repoId === webRepo.repoId ? [webDirectory] : [defaultDirectory(repoId)])
  const historical = { ...oldVersion, repoId: defaultRepo.repoId, directoryId: 'default', code: sampleCode }
  const older = { ...historical, scriptDigest: 'sha256:older' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([historical, older])
  vi.mocked(runnerManagementApi.siteCodeContent).mockImplementation(async digest => ({ ...historical, scriptDigest: digest }))
  vi.mocked(runnerManagementApi.codeGenerationServers).mockResolvedValue({ items: [{ serverId: 'server', name: '生成机',
    workspace: 'D:\\workspace', generationGitBindings: [{ path: 'c-1/code', repositoryId: webRepo.repoId, directoryId: webDirectory.directoryId,
      repoName: webRepo.name, remoteUrl: webRepo.remoteUrl, branch: 'main', directoryPath: webDirectory.path }],
  } as never] })
  const w = mountDialog(); await flushPromises()
  expect(w.get('[data-testid="generation-directory-git-target"]').text()).toContain(webRepo.remoteUrl)
  expect((w.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect((w.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe(webDirectory.directoryId)
  expect(w.get('[data-testid="site-script-repository"]').attributes('disabled')).toBeDefined()
  await w.get('[data-testid="site-code-versions"]').setValue(older.scriptDigest); await flushPromises()
  expect((w.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value).toBe(webRepo.repoId)
  expect((w.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value).toBe(webDirectory.directoryId)
  const modeControl = w.getComponent('[data-testid="generation-destination-mode"]') as VueWrapper
  modeControl.vm.$emit('update:modelValue', 'custom'); await flushPromises()
  expect(w.find('[data-testid="generation-directory-git-target"]').exists()).toBe(false)
  expect(w.get('[data-testid="site-script-repository"]').attributes('disabled')).toBeUndefined()
  w.unmount()
})
it('节点只配置仓库目录，不展示或提交服务器工作路径覆盖', async () => {
  await remoteModel()
  const w = mountDialog(); await flushPromises()
  expect(w.find('[data-testid="generation-workspace-settings"]').exists()).toBe(false)
  expect(w.find('[data-testid="generation-code-directory"]').exists()).toBe(false)
  expect(w.find('[aria-label="仓库目录"]').exists()).toBe(true)
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  const input = vi.mocked(generateSiteScript).mock.calls[0]![0]
  expect(input).not.toHaveProperty('workspaceMode'); expect(input).not.toHaveProperty('workspacePath'); expect(input).not.toHaveProperty('codeDirectory')
  w.unmount(); await flushPromises()
})
it('远程生成沿用节点目标目录，成功后自动提交全部生成文件', async () => {
  await remoteModel()
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [], previewPath: generatedArchive.files[0]!.path, archive: { ...generatedArchive, status: 'committed', gitCommit: 'c'.repeat(40), pushed: true } })
  vi.mocked(runnerManagementApi.commitGeneratedCode).mockResolvedValue({ ...generatedArchive, status: 'committed', gitCommit: 'c'.repeat(40), pushed: true })
  const w = mountDialog(); await flushPromises()
  const repoId = (w.get('[data-testid="site-script-repository"]').element as HTMLSelectElement).value
  const directoryId = (w.get('[data-testid="site-script-directory"]').element as HTMLSelectElement).value
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [], previewPath: generatedArchive.files[0]!.path,
    archive: { ...generatedArchive, repoId, directoryId, status: 'committed', gitCommit: 'c'.repeat(40), pushed: true } })
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ configId: 'c-1', repositoryId: repoId, directoryId, autoCommit: true, deferCommit: false }), expect.any(AbortSignal), expect.any(Function))
  expect(runnerManagementApi.commitGeneratedCode).not.toHaveBeenCalled()
  expect(w.get('[data-testid="site-script-archive"]').text()).toContain('已提交并推送 Git')
  expect(w.get('[data-testid="site-script-publish"]').attributes('disabled')).toBeDefined()
  expect(w.get('[data-testid="site-script-archive-link"]').attributes('href')).toContain('filePath=default')
  w.unmount()
})
it('生成由后端自动提交，失败后重试不会再次调用模型', async () => {
  await remoteModel()
  vi.mocked(runnerManagementApi.generatedCodeState).mockResolvedValue({ autoCommit: false, archive: null })
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [], archive: generatedArchive })
  vi.mocked(runnerManagementApi.commitGeneratedCode).mockResolvedValueOnce({ ...generatedArchive, status: 'failed', message: '推送失败' })
    .mockResolvedValueOnce({ ...generatedArchive, status: 'committed', gitCommit: 'c'.repeat(40), pushed: true })
  const w = mountDialog(); await flushPromises()
  expect(w.find('[data-testid="site-script-auto-commit"]').exists()).toBe(false)
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.commitGeneratedCode).not.toHaveBeenCalled()
  await w.get('[data-testid="site-script-retry-archive"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('推送失败')
  await w.get('[data-testid="site-script-retry-archive"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('已提交并推送 Git')
  expect(generateSiteScript).toHaveBeenCalledTimes(1)
  w.unmount()
})
it('取消等待后不会自动提交迟到的生成结果', async () => {
  await remoteModel()
  let complete!: (result: { fileName: string; code: string; warnings: string[]; archive: typeof generatedArchive }) => void
  vi.mocked(generateSiteScript).mockImplementation(() => new Promise(resolve => { complete = resolve }))
  const w = mountDialog(); await flushPromises()
  await w.get('[data-testid="site-script-generate"]').trigger('click'); await flushPromises()
  await w.findAll('button').find(button => button.text() === '取消生成')!.trigger('click')
  complete({ fileName: 'www.realcan.cn.py', code: sampleCode, warnings: [], archive: generatedArchive }); await flushPromises()
  expect(runnerManagementApi.commitGeneratedCode).not.toHaveBeenCalled()
  w.unmount()
})
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
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ interfaceId: 'chat-hy3' }), expect.any(AbortSignal), expect.any(Function))
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
  expect((w.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(promptWithQueue('公告需求 抓取公告'))
  await w.get('[data-testid="site-script-manual"]').trigger('click')
  await w.get('[aria-label="可编辑 Python 代码"]').setValue(sampleCode)
  await w.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ promptTemplateId: 9, userPrompt: promptWithQueue('公告需求 抓取公告') }))
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
  expect((existing.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(promptWithQueue(oldVersion.prompt))
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
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: '系统：保留指定函数接口', userPrompt: promptWithQueue('用户：抓取标题和发布日期'), prompt: promptWithQueue('用户：抓取标题和发布日期') }), expect.any(AbortSignal), expect.any(Function))
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: '系统：保留指定函数接口', userPrompt: promptWithQueue('用户：抓取标题和发布日期') }))
  await wrapper.get('[data-testid="site-script-reset-system-prompt"]').trigger('click')
  expect((wrapper.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe(DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT)
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(promptWithQueue('用户：抓取标题和发布日期'))
  wrapper.unmount()
})
it('已有版本恢复各自提示词，修改系统提示词后标记待保存，空提示词阻止生成', async () => {
  const saved = { ...oldVersion, directoryId: 'default', storagePath: 'default/www.realcan.cn.py', systemPrompt: '历史系统提示词', userPrompt: '历史用户提示词' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([saved])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...saved, code: sampleCode })
  const wrapper = mountDialog(); await flushPromises()
  expect((wrapper.get('[data-testid="site-script-system-prompt"]').element as HTMLTextAreaElement).value).toBe(saved.systemPrompt)
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(promptWithQueue(saved.userPrompt))
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
  expect(generateSiteScript).toHaveBeenCalledWith({ taskId: expect.any(String), interfaceId: 'legacy', prompt: promptWithQueue('抓取新闻列表'), userPrompt: promptWithQueue('抓取新闻列表'), systemPrompt: DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT, url: 'https://www.realcan.cn/newscenter', sampleId: 'www.realcan.cn.py' }, expect.any(AbortSignal), expect.any(Function))
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
  expect((wrapper.get('[data-testid="site-script-prompt"]').element as HTMLTextAreaElement).value).toBe(promptWithQueue(oldVersion.prompt))
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

it('来源文件按记录的提交在右侧查看，取消关联立即保存且保留未保存代码', async () => {
  const linked = { ...oldVersion, sourceRepoPath: 'code/c-1/source.py', sourceGitCommit: 'c'.repeat(40) }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  vi.mocked(runnerManagementApi.previewScriptFile).mockResolvedValue({ repoId: webRepo.repoId, path: linked.sourceRepoPath, gitCommit: linked.sourceGitCommit, content: '# historical source', size: 19 })
  vi.mocked(runnerManagementApi.changeScriptFileAssociation).mockResolvedValue({ ok: true, message: '已取消关联，仓库文件保留' })
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const wrapper = mountDialog(); await flushPromises()
  await wrapper.get('[data-testid="site-script-source-file"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.previewScriptFile).toHaveBeenCalledWith(linked.scriptDigest, 'source')
  expect(wrapper.get('[data-testid="site-script-file-preview"]').text()).toContain('# historical source')
  await wrapper.get('[aria-label="可编辑 Python 代码"]').setValue(sampleCode + '# unsaved')
  await wrapper.get('[data-testid="site-script-preview-unlink"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.changeScriptFileAssociation).toHaveBeenCalledWith({ digest: linked.scriptDigest, configId: 'c-1', queueName: 'news_list', target: 'source', action: 'unlink' })
  expect(wrapper.find('[data-testid="site-script-source-file"]').exists()).toBe(false)
  expect((wrapper.get('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toContain('# unsaved')
  expect(wrapper.get('.site-script-code-status').text()).toContain('有修改待保存')
  expect(runnerManagementApi.publishScript).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('已关联文件和生成目标分开展示，取消代码关联后不再显示旧关联', async () => {
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([oldVersion])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...oldVersion, code: sampleCode })
  vi.mocked(runnerManagementApi.changeScriptFileAssociation).mockResolvedValue({ ok: true, message: '已取消关联' })
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const wrapper = mountDialog({ sourceId: '1', flowId: '2', stepId: '3' }); await flushPromises()
  expect(wrapper.get('[data-testid="site-script-associated-file"]').text()).toContain('code/c-1/code-1.py')
  expect(wrapper.get('[data-testid="site-script-storage-path"]').text()).not.toContain('code/c-1')
  await wrapper.get('[data-testid="site-script-unlink-saved"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.changeScriptFileAssociation).toHaveBeenCalledWith(expect.objectContaining({ target: 'saved', action: 'unlink' }))
  expect(wrapper.find('[data-testid="site-script-associated-file"]').exists()).toBe(false)
  expect(wrapper.find('[data-testid="site-script-unlink-saved"]').exists()).toBe(false)
  wrapper.unmount()
})
it('删除文件需要确认，接口失败保留关联并显示真实错误', async () => {
  const linked = { ...oldVersion, sourceRepoPath: 'default/source.py', sourceGitCommit: 'c'.repeat(40) }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([linked])
  vi.mocked(runnerManagementApi.siteCodeContent).mockResolvedValue({ ...linked, code: sampleCode })
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel').mockResolvedValue('confirm' as never)
  vi.mocked(runnerManagementApi.changeScriptFileAssociation).mockRejectedValue(new Error('当前仓库文件与关联快照不同'))
  const wrapper = mountDialog(); await flushPromises()
  await wrapper.get('[data-testid="site-script-delete-source"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.changeScriptFileAssociation).not.toHaveBeenCalled()
  await wrapper.get('[data-testid="site-script-delete-source"]').trigger('click'); await flushPromises()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('历史提交及已下发的代码包保留'), '删除仓库文件', expect.anything())
  expect(runnerManagementApi.changeScriptFileAssociation).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', target: 'source' }))
  expect(wrapper.get('[data-testid="site-script-source-file"]').text()).toContain(linked.sourceRepoPath)
  expect(wrapper.text()).toContain('当前仓库文件与关联快照不同')
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
  expect(generateSiteScript).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://latest.example.com/list' }), expect.any(AbortSignal), expect.any(Function))
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
