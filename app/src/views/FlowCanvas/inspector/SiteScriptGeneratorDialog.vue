<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { RouterLink } from 'vue-router'
import { DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT, generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type CodeRepositoryFile, type PublishedScript, type SiteCodeVersion, type ModelInterface, type GeneratedCodeArchive } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'
import { nodePromptApi, defaultNodePrompt, fillNodePrompt, type NodePromptTemplate } from '@/api/nodePrompts'
import { nodePromptsAvailable } from '@/constants/deployGates'
import PromptTemplatePicker from './PromptTemplatePicker.vue'
import { createGenerationTaskId } from '@/utils/generationWorkspace'

const DEFAULT_PROMPT = `参考 www.realcan.cn.py 样例，为配置的列表 URL 编写完整的 Python 新闻抓取代码。
提供 scrape(url) 函数，返回新闻字典列表，字段包含 title、date、url、summary、content。
提取列表中的新闻标题、发布日期和详情页链接；需要时访问详情页补充摘要和正文。
将相对链接转换为完整 URL，过滤无效链接和重复新闻，合理处理超时及页面解析异常。
保持样例的函数接口和返回结构，根据目标网站调整页面选择器，不照搬样例站点的域名。
只生成抓取代码，不包含 MQ、数据库、流程调度逻辑；导入模块时不要发起网络请求。`

const props = defineProps<{ initialUrl: string; initialPrompt: string; configId?: string; queueName?: string; configType?: string; templateVariables?: Record<string, string> }>()
const emit = defineEmits<{ saved: [version: PublishedScript, configId: string, queueName: string] }>()
const open = defineModel<boolean>('open', { required: true })
const url = ref('')
const prompt = ref('')
const systemPrompt = ref(DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT)
const defaultSystemPrompt = ref(DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT), defaultUserPrompt = ref(DEFAULT_PROMPT)
const templateError = ref('')
const promptTemplates = ref<NodePromptTemplate[]>([]), selectedPromptId = ref(0), promptSnapshot = ref('')
const modelInterfaces = ref<ModelInterface[]>([]), modelInterfaceId = ref(''), modelError = ref(''), modelsLoading = ref(false)
let modelsRequest = 0
const selectedModel = computed(() => modelInterfaces.value.find(row => row.id === modelInterfaceId.value && row.enabled))
const remoteGeneration = computed(() => !!selectedModel.value?.generationServerId && ['agent', 'gemini-agent'].includes(selectedModel.value.kind))
const autoCommit = ref(true), preferenceSaving = ref(false), archiveError = ref('')
const taskConfigError = ref(''), savingTaskConfig = ref(false)
const taskConfigStatus = ref('修改后自动保存')
let taskConfigReady = false, taskConfigContext = '', taskConfigTimer: ReturnType<typeof setTimeout> | undefined
let taskConfigWrites = Promise.resolve()
type TaskConfigWrite = Parameters<typeof runnerManagementApi.saveNodeGenerationSettings>[0]
let pendingTaskConfig: { body: TaskConfigWrite; session: number } | null = null
function flushTaskConfig() {
  if (taskConfigTimer) clearTimeout(taskConfigTimer)
  const pending = pendingTaskConfig
  pendingTaskConfig = null
  if (!pending) return
  taskConfigWrites = taskConfigWrites.then(async () => {
    if (pending.session === sessionId) { savingTaskConfig.value = true; taskConfigStatus.value = '正在自动保存…' }
    try {
      await runnerManagementApi.saveNodeGenerationSettings(pending.body)
      if (pending.session === sessionId) { taskConfigError.value = ''; taskConfigStatus.value = pendingTaskConfig ? '等待自动保存…' : '生成配置已自动保存' }
    } catch (e) {
      if (pending.session === sessionId) { taskConfigError.value = `自动保存失败：${message(e)}；修改后会重新保存`; taskConfigStatus.value = '' }
    } finally { if (pending.session === sessionId) savingTaskConfig.value = false }
  })
}
const archive = ref<GeneratedCodeArchive | null>(null), archivePreview = ref(''), archivePreviewPath = ref(''), archiveSavedKey = ref('')
const archiveTarget = computed(() => {
  const saved = archive.value, file = saved?.files.find(item => item.relativePath.endsWith('.py')) || saved?.files[0]
  return saved && file ? { path: '/settings', query: { tab: 'code-repos', repoId: saved.repoId, directoryId: saved.directoryId, filePath: file.path } } : null
})
async function toggleAutoCommit(): Promise<boolean> {
  if (!props.configId || preferenceSaving.value) return false
  const configId = props.configId
  preferenceSaving.value = true
  try { const result = await runnerManagementApi.saveGenerationPreference(configId, !autoCommit.value); if (configId === props.configId) { autoCommit.value = result.autoCommit; archiveError.value = '' } }
  catch (e) { if (configId === props.configId) archiveError.value = message(e) }
  finally { preferenceSaving.value = false }
  return false
}
async function commitArchive() {
  if (!archive.value || publishing.value || archive.value.status === 'committed') return
  const id = archive.value.archiveId, session = sessionId
  publishing.value = true
  try {
    const result = await runnerManagementApi.commitGeneratedCode(id)
    if (session !== sessionId || archive.value?.archiveId !== id) return
    archive.value = result
    if (result.status === 'committed') {
      if (code.value === archivePreview.value && !showCandidate.value) {
        sourceFilePath.value = archivePreviewPath.value; sourceGitCommit.value = result.gitCommit
        archiveSavedKey.value = draftKey.value
      }
      ElMessage.success(result.pushed ? '生成文件已提交并推送到 Git' : '生成文件已提交到本地仓库，仓库未配置远程地址')
    }
  } catch (e) { if (session === sessionId) error.value = `生成文件提交失败：${message(e)}` }
  finally { publishing.value = false }
}
async function loadModels() {
  const request = ++modelsRequest
  modelsLoading.value = true; modelError.value = ''
  try {
    const result = await runnerManagementApi.modelInterfaces()
    if (request !== modelsRequest) return
    modelInterfaces.value = result.items.filter(row => row.enabled)
    if (!modelInterfaceId.value) modelInterfaceId.value = (modelInterfaces.value.find(row => row.isDefault) || modelInterfaces.value[0])?.id || ''
    if (!selectedModel.value) modelError.value = '所选模型接口已停用或不可用，请选择可用接口'
  } catch (e) { if (request === modelsRequest) modelError.value = `模型接口加载失败：${e instanceof Error ? e.message : String(e)}` }
  finally { if (request === modelsRequest) modelsLoading.value = false }
}
const promptTextKey = () => JSON.stringify([systemPrompt.value, prompt.value])
const code = ref('')
const candidate = ref('')
const showCandidate = ref(false)
const error = ref('')
const warnings = ref<string[]>([])
const generating = ref(false)
const publishing = ref(false)
const loading = ref(false)
const codeLoading = ref(false)
const published = ref<PublishedScript | null>(null)
const loadedVersion = ref<SiteCodeVersion | null>(null)
const selectedVersionDigest = ref('')
const savedDraftKey = ref('')
const fileNameMode = ref<'website' | 'queue'>('website')
const savedFileName = ref('')
const versions = ref<SiteCodeVersion[]>([])
const versionsError = ref('')
const repositories = ref<CodeRepository[]>([])
const repositoryId = ref('')
const repositoriesError = ref('')
const repositoryDirectories = ref<Record<string, CodeRepositoryDirectory[]>>({})
const repositoryDirectoryErrors = ref<Record<string, string>>({})
const directoryId = ref(''), directoriesLoading = ref(false)
const directories = computed(() => repositoryDirectories.value[repositoryId.value] || [])
const directoriesError = computed(() => repositoryDirectoryErrors.value[repositoryId.value] || '')
const availableDirectories = computed(() => directories.value.filter(row => row.status === 'ACTIVE' && (!row.configType || row.configType === (props.configType || ''))))
const selectedDirectory = computed(() => availableDirectories.value.find(row => row.directoryId === directoryId.value))
const fileChooserOpen = ref(false)
const repositoryFiles = ref<CodeRepositoryFile[]>([])
const repositoryFileTotal = ref(0)
const repositoryFilePage = ref(1)
const repositoryFileKeyword = ref('')
const repositoryFilesLoading = ref(false)
const repositoryFileError = ref('')
const sourceFilePath = ref('')
const sourceGitCommit = ref('')
const selectableFiles = computed(() => repositoryFiles.value.filter((file) => file.path.toLowerCase().endsWith('.py')))
const availableRepositories = computed(() => repositories.value.filter((repo) =>
  repo.status === 'ACTIVE' && (!repo.configType || repo.configType === (props.configType || ''))))
const selectedRepository = computed(() => availableRepositories.value.find((repo) => repo.repoId === repositoryId.value))
const nodeTypeName = computed(() => Object.values(repositoryDirectories.value).flat().find(row =>
  row.configType === props.configType && row.configTypeName)?.configTypeName
  || availableRepositories.value.find(repo => repo.configType === props.configType)?.configTypeName || '')
const hostname = computed(() => { try { const parsed = new URL(url.value.trim()); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase() : '' } catch { return '' } })
const fileName = computed(() => savedFileName.value || (fileNameMode.value === 'website' ? `${hostname.value || 'site'}.py` : `${props.queueName || 'queue'}.py`))
const contextVersions = computed(() => versions.value)
const latestVersion = computed(() => contextVersions.value.find(version => version.siteHost === hostname.value)
  || contextVersions.value.find(version => !version.siteHost) || contextVersions.value[0])
const storagePath = computed(() => selectedDirectory.value ? `${selectedDirectory.value.path}/${fileName.value}` : '')
const absoluteStoragePath = computed(() => {
  const root = selectedRepository.value?.path || loadedVersion.value?.repoPath || ''
  if (!storagePath.value) return root
  const separator = root.includes('\\') ? '\\' : '/'
  return root ? `${root.replace(/[\\/]$/, '')}${separator}${storagePath.value.replaceAll('/', separator)}` : storagePath.value
})
const draftKey = computed(() => JSON.stringify({ code: code.value, prompt: prompt.value.trim(), systemPrompt: systemPrompt.value.trim(), url: url.value.trim(),
  promptTemplateId: selectedPromptId.value,
  repositoryId: repositoryId.value, directoryId: directoryId.value, storagePath: storagePath.value, fileNameMode: fileNameMode.value, fileName: fileName.value, sourceFilePath: sourceFilePath.value, sourceGitCommit: sourceGitCommit.value }))
const isSaved = computed(() => {
  if (archive.value?.status === 'committed' && archiveSavedKey.value === draftKey.value && archive.value.repoId === repositoryId.value && archive.value.directoryId === directoryId.value) return true
  const saved = published.value || loadedVersion.value
  return !!code.value && savedDraftKey.value === draftKey.value && saved?.repoId === repositoryId.value && saved.storagePath === storagePath.value
})
const repositoryFileTarget = computed(() => {
  const saved = published.value || loadedVersion.value
  if (!saved?.repoId || !saved.storagePath || saved.repoId !== repositoryId.value || saved.storagePath !== storagePath.value) return null
  return { path: '/settings', query: { tab: 'code-repos', repoId: saved.repoId, filePath: saved.storagePath, ...(saved.directoryId ? { directoryId: saved.directoryId } : {}) } }
})
const busy = computed(() => loading.value || codeLoading.value || generating.value || publishing.value || directoriesLoading.value || preferenceSaving.value)
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
let controller: AbortController | null = null
let openedFor = ''
let sessionId = 0
let versionRequestId = 0
let fileRequestId = 0
let directoryRequestId = 0

function matchingDirectory(repoId: string) {
  if (!props.configType) return undefined
  const matching = (repositoryDirectories.value[repoId] || []).filter(row => row.status === 'ACTIVE' && row.configType === props.configType)
  return matching.find(row => !row.isDefault) || matching[0]
}
function selectDefaultDirectory() {
  directoryId.value = matchingDirectory(repositoryId.value)?.directoryId
    || availableDirectories.value.find(row => row.isDefault)?.directoryId || availableDirectories.value[0]?.directoryId || ''
}
function repositoryLabel(repo: CodeRepository) {
  const suffix = repositoryDirectoryErrors.value[repo.repoId] ? ' · 目录加载失败'
    : matchingDirectory(repo.repoId) ? ' · 已配置当前节点类型' : ' · 通用目录'
  return `${repo.name}${repo.isDefault ? '（默认）' : ''}${suffix}`
}
async function loadDirectories() {
  const session = sessionId, seq = ++directoryRequestId
  const repos = [...availableRepositories.value]
  directoriesLoading.value = true
  const results = await Promise.allSettled(repos.map(repo => runnerManagementApi.codeRepositoryDirectories(repo.repoId)))
  if (seq !== directoryRequestId || session !== sessionId) return
  const catalog: Record<string, CodeRepositoryDirectory[]> = {}, failures: Record<string, string> = {}
  results.forEach((result, index) => {
    const repoId = repos[index]!.repoId
    if (result.status === 'fulfilled') catalog[repoId] = result.value.filter(row => row.repoId === repoId)
    else failures[repoId] = message(result.reason)
  })
  repositoryDirectories.value = catalog
  repositoryDirectoryErrors.value = failures
  if (!repositoryId.value) {
    const matching = repos.filter(repo => matchingDirectory(repo.repoId))
    repositoryId.value = matching.find(repo => repo.isDefault)?.repoId || matching[0]?.repoId
      || repos.find(repo => repo.isDefault)?.repoId || repos[0]?.repoId || ''
  }
  const keepSavedDestination = loadedVersion.value?.repoId === repositoryId.value && loadedVersion.value.directoryId === directoryId.value
  if (!keepSavedDestination && !selectedDirectory.value) selectDefaultDirectory()
  directoriesLoading.value = false
}

function clearDraft() {
  selectedPromptId.value = 0
  promptTemplates.value = []
  versionRequestId++
  codeLoading.value = false
  code.value = ''
  candidate.value = ''
  showCandidate.value = false
  published.value = null
  loadedVersion.value = null
  selectedVersionDigest.value = ''
  savedDraftKey.value = ''
  sourceFilePath.value = ''
  sourceGitCommit.value = ''
  savedFileName.value = ''
  error.value = ''
  warnings.value = []
}

function syncPromptDefaults(template?: NodePromptTemplate) {
  const variables = { ...props.templateVariables, url: props.initialUrl, describe: props.initialPrompt, config_id: props.configId || '', queue_name: props.queueName || '' }
  defaultSystemPrompt.value = template ? fillNodePrompt(template.systemPrompt, variables) : DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT
  defaultUserPrompt.value = template ? fillNodePrompt(template.userPromptTemplate || DEFAULT_PROMPT, variables) : DEFAULT_PROMPT
}

async function initialize() {
  flushTaskConfig()
  taskConfigReady = false
  savingTaskConfig.value = false
  const session = ++sessionId
  const context = `${props.configId || ''}\n${props.queueName || ''}\n${props.initialUrl}\n${props.configType || ''}`
  const newContext = openedFor !== context
  if (newContext) {
    clearDraft()
    archive.value = null; archivePreview.value = ''; archivePreviewPath.value = ''; archiveSavedKey.value = ''; archiveError.value = ''
    repositoryId.value = ''
    fileNameMode.value = 'website'
    prompt.value = props.initialPrompt.trim() || DEFAULT_PROMPT
    systemPrompt.value = DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT
    defaultSystemPrompt.value = DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT
    defaultUserPrompt.value = DEFAULT_PROMPT
  }
  openedFor = context
  url.value = props.initialUrl
  loading.value = true
  repositoriesError.value = ''
  versionsError.value = ''
  templateError.value = ''
  const [repoResult, versionResult, templateResult, , archiveResult, taskConfigResult] = await Promise.allSettled([
    runnerManagementApi.codeRepositories(),
    props.configId && props.queueName ? runnerManagementApi.siteCodeVersions(props.configId, props.queueName) : Promise.resolve([] as SiteCodeVersion[]),
    props.configType && nodePromptsAvailable() ? nodePromptApi.list({ sourceType: props.configType, templateUse: 'script' }) : Promise.resolve([]),
    loadModels(),
    props.configId ? runnerManagementApi.generatedCodeState(props.configId) : Promise.resolve({ autoCommit: true, archive: null }),
    props.configId ? runnerManagementApi.nodeGenerationSettings(props.configId) : Promise.resolve(null),
  ])
  if (session !== sessionId) return
  if (archiveResult.status === 'fulfilled') { autoCommit.value = archiveResult.value.autoCommit; archive.value = archiveResult.value.archive; archiveError.value = '' }
  else archiveError.value = `生成归档配置加载失败：${message(archiveResult.reason)}`
  if (templateResult.status === 'fulfilled') {
    promptTemplates.value = templateResult.value.filter(item => item.isActive === 1)
    const template = defaultNodePrompt(templateResult.value, true)
    if (template) {
      syncPromptDefaults(template)
      if (newContext) {
        selectedPromptId.value = template.promptId
        systemPrompt.value = defaultSystemPrompt.value
        prompt.value = defaultUserPrompt.value
      }
    }
  } else templateError.value = `公共提示词模板加载失败，当前使用已有提示词或内置默认：${message(templateResult.reason)}`
  promptSnapshot.value = promptTextKey()
  if (repoResult.status === 'fulfilled') {
    repositories.value = repoResult.value
    await loadDirectories()
  } else {
    repositories.value = []
    repositoryId.value = ''
    repositoryDirectories.value = {}
    repositoryDirectoryErrors.value = {}
    repositoriesError.value = message(repoResult.reason)
  }
  if (session !== sessionId) return
  if (versionResult.status === 'fulfilled') {
    versions.value = versionResult.value
    if (!code.value && !candidate.value) {
      const latest = latestVersion.value
      if (latest) {
        restoreVersionDestination(latest)
        loadedVersion.value = latest
        if (open.value) await loadVersion(latest, false)
      }
    }
  } else {
    versions.value = []
    versionsError.value = message(versionResult.reason)
  }
  if (session === sessionId && newContext && archive.value && availableRepositories.value.some(repo => repo.repoId === archive.value!.repoId)) {
    repositoryId.value = archive.value.repoId
    if (availableDirectories.value.some(directory => directory.directoryId === archive.value!.directoryId)) directoryId.value = archive.value.directoryId
  }
  if (session === sessionId && newContext && taskConfigResult.status === 'fulfilled' && taskConfigResult.value?.generation) {
    const saved = taskConfigResult.value.generation
    modelInterfaceId.value = saved.interfaceId
    repositoryId.value = saved.repositoryId
    directoryId.value = saved.directoryId
    fileNameMode.value = saved.fileNameMode
    systemPrompt.value = saved.systemPrompt
    prompt.value = saved.userPrompt
    if (saved.url && saved.url !== url.value) { systemPrompt.value = systemPrompt.value.replaceAll(saved.url, url.value); prompt.value = prompt.value.replaceAll(saved.url, url.value) }
    promptSnapshot.value = promptTextKey()
  }
  if (session === sessionId) {
    taskConfigError.value = taskConfigResult.status === 'rejected' ? `生成配置读取失败：${message(taskConfigResult.reason)}` : ''
    loading.value = false
    taskConfigContext = context
    taskConfigStatus.value = taskConfigResult.status === 'fulfilled' && taskConfigResult.value?.generation ? '生成配置已自动保存' : '修改后自动保存'
    taskConfigReady = taskConfigResult.status === 'fulfilled'
  }
}

watch(() => [props.configId, props.queueName, props.initialUrl, props.configType] as const, () => {
  cancelGenerate()
  void initialize()
}, { immediate: true })
watch(open, visible => {
  cancelGenerate()
  if (!visible) {
    flushTaskConfig()
    versionRequestId++
    fileRequestId++
    codeLoading.value = false
    fileChooserOpen.value = false
    return
  }
  if (!loading.value && !code.value && !candidate.value && latestVersion.value) void loadVersion(latestVersion.value, false)
}, { immediate: true })

watch(url, (next, previous) => {
  if (previous && next !== previous) {
    cancelGenerate()
    clearDraft()
  }
})
watch(fileNameMode, () => { savedFileName.value = '' }, { flush: 'sync' })
watch(repositoryId, () => {
  fileRequestId++
  sourceFilePath.value = ''
  sourceGitCommit.value = ''
  repositoryFiles.value = []
  directoryId.value = ''
  selectDefaultDirectory()
}, { flush: 'sync' })
watch(directoryId, () => {
  fileRequestId++
  repositoryFiles.value = []
  repositoryFilesLoading.value = false
  repositoryFileError.value = ''
  if (fileChooserOpen.value && selectedDirectory.value && !directoriesLoading.value) void loadRepositoryFiles(1)
}, { flush: 'sync' })
watch(() => JSON.stringify([props.configId, modelInterfaceId.value, repositoryId.value, directoryId.value, props.configType, props.queueName, systemPrompt.value, prompt.value, url.value, fileNameMode.value]), () => {
  const context = `${props.configId || ''}\n${props.queueName || ''}\n${props.initialUrl}\n${props.configType || ''}`
  if (!taskConfigReady || loading.value || taskConfigContext !== context) return
  if (taskConfigTimer) clearTimeout(taskConfigTimer)
  pendingTaskConfig = null
  if (!props.configId || !selectedModel.value || !selectedRepository.value || !selectedDirectory.value || directoriesLoading.value || directoriesError.value || !systemPrompt.value.trim() || !prompt.value.trim()) {
    taskConfigStatus.value = '请完善生成配置后自动保存'
    return
  }
  pendingTaskConfig = { session: sessionId, body: { configId: props.configId, generation: {
    interfaceId: modelInterfaceId.value, repositoryId: repositoryId.value, directoryId: directoryId.value,
    configType: props.configType || '', queueName: props.queueName || '', systemPrompt: systemPrompt.value,
    userPrompt: prompt.value, url: url.value, fileNameMode: fileNameMode.value,
  } } }
  taskConfigStatus.value = '等待自动保存…'
  taskConfigTimer = setTimeout(flushTaskConfig, 700)
}, { flush: 'sync' })
onBeforeUnmount(() => { flushTaskConfig(); controller?.abort(); sessionId++; versionRequestId++; fileRequestId++; directoryRequestId++ })

function restoreVersionDestination(version: SiteCodeVersion) {
  // 已有代码始终恢复原仓库；原仓库不可用时由用户明确选择新位置。
  if (version.repoId) repositoryId.value = version.repoId
  directoryId.value = version.directoryId || availableDirectories.value.find(row => row.isDefault)?.directoryId || availableDirectories.value[0]?.directoryId || ''
  fileNameMode.value = version.deliveryPath.split('/').pop() === `${props.queueName}.py` ? 'queue' : 'website'
  savedFileName.value = version.deliveryPath.split('/').pop() || ''
}

async function loadVersion(version: SiteCodeVersion, restoreDestination = true) {
  const requestId = ++versionRequestId
  const session = sessionId
  codeLoading.value = true
  error.value = ''
  try {
    const result = await runnerManagementApi.siteCodeContent(version.scriptDigest)
    if (requestId !== versionRequestId || session !== sessionId || !open.value) return
    if (restoreDestination) restoreVersionDestination(result)
    selectedPromptId.value = result.promptTemplateId || 0
    syncPromptDefaults(promptTemplates.value.find(item => item.promptId === selectedPromptId.value))
    code.value = result.code
    prompt.value = (result.userPrompt ?? result.prompt).trim() || props.initialPrompt.trim() || defaultUserPrompt.value
    systemPrompt.value = result.systemPrompt?.trim() || defaultSystemPrompt.value
    promptSnapshot.value = promptTextKey()
    loadedVersion.value = result
    selectedVersionDigest.value = result.scriptDigest
    published.value = null
    candidate.value = ''
    showCandidate.value = false
    sourceFilePath.value = result.repoId === repositoryId.value ? result.sourceRepoPath || '' : ''
    sourceGitCommit.value = sourceFilePath.value ? result.sourceGitCommit || '' : ''
    savedDraftKey.value = draftKey.value
  } catch (e) {
    if (requestId === versionRequestId && session === sessionId) {
      selectedVersionDigest.value = loadedVersion.value?.scriptDigest || ''
      error.value = `已有代码读取失败：${message(e)}`
    }
  } finally { if (requestId === versionRequestId) codeLoading.value = false }
}

function selectVersion(digest: string) {
  const version = versions.value.find((item) => item.scriptDigest === digest)
  if (version) void loadVersion(version)
}
function restorePrompt() { prompt.value = defaultUserPrompt.value }
function restoreSystemPrompt() { systemPrompt.value = defaultSystemPrompt.value }
async function selectPromptTemplate(id: number) {
  if (id === selectedPromptId.value || busy.value) return
  if (id && promptSnapshot.value && promptTextKey() !== promptSnapshot.value) {
    try { await ElMessageBox.confirm('切换提示词将替换当前系统和用户提示词，是否继续？', '切换提示词', { confirmButtonText: '切换', cancelButtonText: '保留当前内容', type: 'warning' }) } catch { return }
  }
  const selected = promptTemplates.value.find(item => item.promptId === id)
  if (id && !selected) return
  selectedPromptId.value = id
  syncPromptDefaults(selected)
  if (selected) {
    systemPrompt.value = defaultSystemPrompt.value; prompt.value = defaultUserPrompt.value
  }
  promptSnapshot.value = promptTextKey()
}
function cancelGenerate() { controller?.abort(); controller = null; generating.value = false }

async function generate() {
  if (busy.value) return
  if (modelsLoading.value || modelError.value || !selectedModel.value) { error.value = '请先选择可用的大模型接口'; return }
  if (remoteGeneration.value && (!props.configId || !selectedRepository.value || !selectedDirectory.value || directoriesError.value || archiveError.value)) { error.value = archiveError.value || '请先保存节点并选择有效的仓库和配置目录'; return }
  if (!systemPrompt.value.trim()) { error.value = '请填写系统提示词'; return }
  if (!prompt.value.trim()) { error.value = '请填写用户提示词'; return }
  if (systemPrompt.value.length > 12000 || prompt.value.length > 12000) { error.value = '每份提示词不能超过 12000 字'; return }
  try {
    const parsed = new URL(url.value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error()
  } catch { error.value = '当前源 URL 无效，请先在源详情中配置有效的 http(s) 地址'; return }
  controller?.abort()
  const active = new AbortController()
  controller = active
  generating.value = true
  error.value = ''
  warnings.value = []
  try {
    const result = await generateSiteScript({ taskId: createGenerationTaskId(), interfaceId: modelInterfaceId.value, prompt: prompt.value.trim(), userPrompt: prompt.value.trim(), systemPrompt: systemPrompt.value.trim(), url: url.value.trim(), sampleId: 'www.realcan.cn.py',
      ...(remoteGeneration.value ? { configId: props.configId, configType: props.configType || '', queueName: props.queueName || '', repositoryId: repositoryId.value,
        directoryId: directoryId.value, autoCommit: autoCommit.value, deferCommit: true, fileName: fileName.value } : {}) }, active.signal)
    if (active.signal.aborted) return
    if (code.value.trim() && result.code.trim()) {
      candidate.value = result.code
      showCandidate.value = true
    } else if (result.code.trim()) {
      code.value = result.code
      sourceFilePath.value = ''
      sourceGitCommit.value = ''
    }
    warnings.value = result.warnings
    if (result.archive) {
      archive.value = result.archive; archivePreview.value = result.code; archivePreviewPath.value = result.previewPath || ''; archiveSavedKey.value = ''; archiveError.value = ''
      if (autoCommit.value && result.archive.status !== 'committed') await commitArchive()
    }
  } catch (e) { if (!active.signal.aborted) error.value = message(e) || '生成失败' }
  finally { if (controller === active) { generating.value = false; controller = null } }
}

function adopt() {
  if (!candidate.value) return
  code.value = candidate.value
  sourceFilePath.value = ''
  sourceGitCommit.value = ''
  candidate.value = ''
  showCandidate.value = false
  ElMessage.success('新结果已载入编辑区，可修改后保存')
}

async function loadRepositoryFiles(page = 1) {
  const repoId = repositoryId.value, selectedId = selectedDirectory.value?.directoryId
  if (!repoId || !selectedId) return
  const requestId = ++fileRequestId
  repositoryFilesLoading.value = true
  repositoryFileError.value = ''
  try {
    const result = await runnerManagementApi.codeRepositoryFiles(repoId, repositoryFileKeyword.value.trim(), page, selectedId)
    if (requestId !== fileRequestId || repositoryId.value !== repoId || directoryId.value !== selectedId) return
    repositoryFiles.value = result.items
    repositoryFileTotal.value = result.total
    repositoryFilePage.value = result.page
  } catch (e) { if (requestId === fileRequestId) repositoryFileError.value = message(e) }
  finally { if (requestId === fileRequestId) repositoryFilesLoading.value = false }
}
function toggleFileChooser() {
  fileChooserOpen.value = true
  void loadRepositoryFiles(1)
}
async function chooseRepositoryFile(file: CodeRepositoryFile) {
  const repoId = repositoryId.value
  if (!repoId) return
  if (file.size !== null && file.size > 200_000) { repositoryFileError.value = '代码文件不能超过 200 KB'; return }
  const session = sessionId
  const requestId = ++fileRequestId
  repositoryFilesLoading.value = true
  try {
    const result = await runnerManagementApi.codeRepositoryFileContent(repoId, file.path)
    if (session !== sessionId || requestId !== fileRequestId || repositoryId.value !== repoId) return
    const editingVersion = loadedVersion.value, lastPublished = published.value, previousName = savedFileName.value
    clearDraft()
    loadedVersion.value = editingVersion
    published.value = lastPublished
    savedFileName.value = previousName
    code.value = result.content
    sourceFilePath.value = result.path
    sourceGitCommit.value = result.gitCommit
    repositoryFileError.value = ''
    fileChooserOpen.value = false
    ElMessage.success('仓库文件已载入编辑区')
  } catch (e) { if (requestId === fileRequestId) repositoryFileError.value = message(e) }
  finally { if (requestId === fileRequestId) repositoryFilesLoading.value = false }
}
function editManually() {
  if (!code.value) code.value = 'def scrape(url):\n    # 返回包含 title/date/url/summary/content 的字典列表\n    return []\n'
  showCandidate.value = false
  error.value = ''
}

async function publish() {
  if (busy.value || showCandidate.value) return
  if (loadedVersion.value?.directoryLayout) { error.value = '当前版本包含目录映射，请在「系统设置 → 部署配置」调整仓库关联后发布，避免覆盖公共代码配置'; return }
  const configId = props.configId?.trim()
  if (!configId) { error.value = '请先保存节点配置，再保存代码'; return }
  if (!code.value.trim()) return
  if (!props.queueName?.trim()) { error.value = '请先在任务配置中保存队列名称'; return }
  if (fileNameMode.value === 'website' && !hostname.value) { error.value = '按网站命名需要有效的源 URL，请先在源详情中修改'; return }
  if (!repositoryId.value) { error.value = '请先在系统设置中配置可用的代码仓库'; return }
  if (directoriesError.value || !selectedDirectory.value) { error.value = '请先选择可用的仓库配置目录'; return }
  publishing.value = true
  error.value = ''
  const session = sessionId
  const submittedKey = draftKey.value
  try {
    const result = await runnerManagementApi.publishScript({
      configId, fileName: fileName.value, code: code.value, prompt: prompt.value.trim(), userPrompt: prompt.value.trim(), systemPrompt: systemPrompt.value.trim(), promptTemplateId: selectedPromptId.value, url: url.value.trim(),
      queueName: props.queueName.trim(), fileNameMode: fileNameMode.value, configType: props.configType || undefined,
      codeId: published.value?.codeId || loadedVersion.value?.codeId || undefined,
      repositoryId: repositoryId.value,
      directoryId: directoryId.value || undefined,
      sourceFilePath: sourceFilePath.value || undefined, sourceGitCommit: sourceGitCommit.value || undefined,
    })
    if (session !== sessionId || !open.value) return
    published.value = result
    emit('saved', result, configId, props.queueName.trim())
    savedDraftKey.value = submittedKey
    selectedVersionDigest.value = result.scriptDigest
    try {
      const refreshed = await runnerManagementApi.siteCodeVersions(configId, props.queueName.trim())
      if (session !== sessionId || !open.value) return
      versions.value = refreshed
      loadedVersion.value = refreshed.find((version) => version.scriptDigest === result.scriptDigest) || loadedVersion.value
    } catch (e) { if (session === sessionId) versionsError.value = message(e) }
    ElMessage.success('代码已保存并自动提交 Git')
  } catch (e) { if (session === sessionId) error.value = message(e) }
  finally { publishing.value = false }
}

function download() {
  if (!code.value.trim()) return
  const objectUrl = URL.createObjectURL(new Blob([code.value], { type: 'text/x-python;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName.value
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
</script>

<template>
  <section v-loading="loading" class="site-script-configuration" data-testid="site-script-configuration">
    <div class="site-script-task-config" role="status" data-testid="generation-config-status">{{ taskConfigStatus }}</div>
    <p v-if="taskConfigError" class="site-script-error" role="alert">{{ taskConfigError }}</p>
    <div class="site-script-context"><span v-if="configType" data-testid="site-script-node-type">节点类型 [{{ configType }}] {{ nodeTypeName }}</span><span :title="queueName">队列 {{ queueName || '未配置' }}</span></div>
    <div class="site-script-destination-fields">
      <label class="site-script-field">保存仓库
        <el-select v-model="repositoryId" size="small" :disabled="busy" data-testid="site-script-repository" placeholder="请选择仓库">
          <template #label="{ label }"><span class="site-script-select-label" :title="label">{{ selectedRepository?.name || label }}</span></template>
          <el-option v-if="loadedVersion?.repoId && !availableRepositories.some(repo => repo.repoId === loadedVersion?.repoId)" :value="loadedVersion.repoId" :label="`${loadedVersion.repoName || '原仓库'}（已停用或类型不匹配，请重新选择）`" disabled />
          <el-option v-for="repo in availableRepositories" :key="repo.repoId" :label="repositoryLabel(repo)" :value="repo.repoId" />
        </el-select>
      </label>
      <div class="site-script-field"><div class="site-script-directory-label"><span>节点类型目录</span><el-button link type="primary" :disabled="busy" data-testid="site-script-refresh-directories" @click="loadDirectories">刷新</el-button></div>
        <el-select v-model="directoryId" size="small" :disabled="busy" data-testid="site-script-directory" aria-label="节点类型目录" placeholder="选择仓库目录">
          <template #label="{ label }"><span class="site-script-select-label" :title="label">{{ selectedDirectory?.name || label }}</span></template>
          <el-option v-if="loadedVersion?.directoryId && loadedVersion.repoId === repositoryId && !availableDirectories.some(row => row.directoryId === loadedVersion?.directoryId)" :value="loadedVersion.directoryId" label="原目录已停用或不可用，请重新选择" disabled />
          <el-option v-for="directory in availableDirectories" :key="directory.directoryId" :value="directory.directoryId" :label="`${directory.name} · ${directory.configTypeName || '通用'} · ${directory.path}/`" />
        </el-select>
      </div>
    </div>
    <p v-if="loadedVersion?.repoId && !selectedRepository" class="site-script-error" role="alert">原仓库已停用或与节点类型不匹配，请重新选择保存位置。</p>
    <p v-if="directoriesError" class="site-script-error" role="alert">目录加载失败：{{ directoriesError }}</p>
    <p v-if="archiveError" class="site-script-error" role="alert">{{ archiveError }}</p>
    <p v-if="repositoriesError" class="site-script-error" role="alert">仓库加载失败：{{ repositoriesError }}</p>
    <p v-if="templateError" class="site-script-error" role="alert">{{ templateError }}</p>
    <div class="site-script-naming"><span>文件命名方式</span><el-select v-model="fileNameMode" size="small" :disabled="busy" class="site-script-type-select" data-testid="site-script-name-mode" aria-label="文件命名方式"><el-option label="按网站命名" value="website" /><el-option label="按队列命名" value="queue" /></el-select><code :title="fileName" data-testid="site-script-file-name">{{ fileName }}</code></div>
    <div class="site-script-paths">
      <div v-if="selectedRepository && selectedDirectory"><span>保存关联</span><code :title="`${selectedRepository.name} / ${selectedDirectory.name}`" data-testid="site-script-destination">{{ selectedRepository.name }} / {{ selectedDirectory.name }}</code></div>
      <div><span>仓库文件</span><RouterLink v-if="repositoryFileTarget" :to="repositoryFileTarget" target="_blank" rel="noopener" class="site-script-repository-link" title="在新标签页查看仓库代码" data-testid="site-script-open-repository"><code :title="absoluteStoragePath" data-testid="site-script-storage-path">{{ absoluteStoragePath }}</code></RouterLink><code v-else :title="absoluteStoragePath" data-testid="site-script-storage-path">{{ storagePath ? absoluteStoragePath : `${absoluteStoragePath || '请先选择仓库'}${absoluteStoragePath ? ' / 请选择保存目录' : ''}` }}</code></div>
      <div v-if="sourceFilePath"><span>来源文件</span><code :title="sourceFilePath" data-testid="site-script-source-file">{{ sourceFilePath }} · {{ sourceGitCommit.slice(0, 10) }}</code></div>
    </div>
    <el-button type="primary" class="site-script-open-button" :disabled="busy" data-testid="open-site-script-generator" @click="open = true">AI 生成代码</el-button>
  </section>
  <el-dialog v-model="open" title="AI 代码工作区" width="min(1160px, 96vw)" top="4vh" append-to-body data-testid="site-script-dialog">
    <div v-loading="loading" class="site-script-workspace">
      <section class="site-script-settings" data-testid="site-script-prompt-panel">
        <PromptTemplatePicker :items="promptTemplates" :model-value="selectedPromptId" :disabled="busy" test-id="script-prompt-template" @select="selectPromptTemplate" />
        <div class="site-script-model"><label>大模型</label><el-select v-model="modelInterfaceId" :disabled="busy || modelsLoading" placeholder="选择大模型接口" data-testid="site-script-model" @change="modelError = ''"><el-option v-for="item in modelInterfaces" :key="item.id" :value="item.id" :label="`${item.name}${item.model ? ` · ${item.model}` : ''}`" /></el-select><el-button link :disabled="busy || modelsLoading" @click="loadModels">刷新</el-button><RouterLink to="/settings?tab=model-interfaces" target="_blank" rel="noopener">配置</RouterLink></div>
        <p v-if="modelError" class="site-script-error" role="alert">{{ modelError }}</p>
        <div v-if="remoteGeneration" class="site-script-auto-commit"><el-switch :model-value="autoCommit" :loading="preferenceSaving" :disabled="busy || !configId" :before-change="toggleAutoCommit" active-text="生成成功后自动提交" data-testid="site-script-auto-commit" /><small>保存到节点已选择的仓库目录，仅归档 code/ 内的文件。</small></div>
        <section class="site-script-prompt-group">
          <div class="site-script-panel-head"><label for="site-script-system-prompt"><b>系统提示词</b></label><el-button link type="primary" :disabled="busy" data-testid="site-script-reset-system-prompt" @click="restoreSystemPrompt">恢复默认</el-button></div>
          <div class="site-script-prompt-field"><textarea id="site-script-system-prompt" v-model="systemPrompt" :disabled="busy" maxlength="12000" class="site-script-prompt" data-testid="site-script-system-prompt" placeholder="定义模型角色、代码规范和输出要求" /></div>
        </section>
        <section class="site-script-prompt-group">
          <div class="site-script-panel-head"><label for="site-script-prompt"><b>用户提示词</b></label><el-button link type="primary" :disabled="busy" data-testid="site-script-reset-prompt" @click="restorePrompt">恢复默认</el-button></div>
          <div class="site-script-prompt-field"><textarea id="site-script-prompt" v-model="prompt" :disabled="busy" maxlength="12000" class="site-script-prompt" data-testid="site-script-prompt" placeholder="说明本次抓取需求、列表页结构、提取字段及详情页要求" /></div>
        </section>
        <div class="site-script-generation"><el-button type="primary" :loading="generating" :disabled="loading || codeLoading || publishing || directoriesLoading || preferenceSaving || modelsLoading || !!modelError || !selectedModel" data-testid="site-script-generate" @click="generate">{{ code ? '重新生成' : '生成代码' }}</el-button><el-button v-if="generating && !publishing" @click="cancelGenerate">取消生成</el-button><span v-else>{{ publishing ? '正在提交 Git…' : '生成后可在右侧编辑、保存' }}</span></div>
      </section>
      <section v-loading="codeLoading" class="site-script-editor-panel" data-testid="site-script-code-panel">
        <div class="site-script-panel-head">
          <b>代码编辑</b>
          <el-select v-if="contextVersions.length" v-model="selectedVersionDigest" :disabled="busy" class="site-script-version-select" data-testid="site-code-versions" placeholder="历史版本" @change="selectVersion">
            <el-option v-for="version in contextVersions" :key="version.scriptDigest" :value="version.scriptDigest" :label="`${version.deliveryPath.split('/').pop()} · ${version.gitCommit.slice(0, 10)}`" />
          </el-select>
          <span v-else>Python · scrape(url)</span>
        </div>
        <div class="site-script-editor-toolbar">
          <el-button size="small" :disabled="busy || !selectedDirectory || !!directoriesError" data-testid="site-script-choose-repo-file" @click="toggleFileChooser">选择仓库文件</el-button>
          <RouterLink v-if="repositoryFileTarget" :to="repositoryFileTarget" target="_blank" rel="noopener" class="site-script-repository-link" data-testid="site-script-workspace-repository">查看仓库</RouterLink>
          <span class="site-script-toolbar-spacer" />
          <el-button v-if="code" size="small" :disabled="showCandidate" @click="copyToClipboard(code, 'Python 代码')">复制</el-button>
          <el-button v-if="code" size="small" :disabled="showCandidate" data-testid="site-script-download" @click="download">下载</el-button>
        </div>
        <p v-if="loadedVersion?.directoryLayout" class="site-script-error" role="alert">此版本包含公共代码和目录映射，请在「部署配置」中编辑。</p>
        <p v-if="versionsError" class="site-script-error" role="alert">版本列表加载失败：{{ versionsError }}</p>
        <p v-if="error" class="site-script-error" data-testid="site-script-error" role="alert">{{ error }}</p>
        <p v-for="warning in warnings" :key="warning" class="site-script-warning">{{ warning }}</p>
        <section v-if="archive" class="site-script-archive" data-testid="site-script-archive"><b>{{ archive.status === 'committed' ? archive.pushed ? '生成文件已提交并推送 Git' : '生成文件已提交本地 Git（未配置远程地址）' : archive.status === 'failed' ? '生成结果已保留，归档失败' : '生成结果已保留，待提交' }}</b><span>{{ archive.files.length }} 个文件 · {{ archive.directoryPath }}/ <template v-if="archive.gitCommit"> · Git {{ archive.gitCommit.slice(0, 12) }}</template></span><small v-if="archive.message" class="site-script-error">{{ archive.message }}</small><div><RouterLink v-if="archive.status === 'committed' && archiveTarget" :to="archiveTarget" target="_blank" rel="noopener" data-testid="site-script-archive-link">查看归档文件</RouterLink><el-button v-if="archive.status !== 'committed'" link type="primary" :disabled="busy" :loading="publishing" data-testid="site-script-retry-archive" @click="commitArchive">{{ archive.status === 'failed' ? '重试提交原生成文件' : '提交本次生成文件' }}</el-button></div></section>
        <div v-if="candidate" class="site-script-result-tabs"><button type="button" :class="{ active: !showCandidate }" data-testid="site-script-current-tab" @click="showCandidate = false">当前代码</button><button type="button" :class="{ active: showCandidate }" data-testid="site-script-candidate-tab" @click="showCandidate = true">新生成结果</button><el-button v-if="showCandidate" link type="primary" data-testid="site-script-adopt" @click="adopt">采用新结果</el-button></div>
        <div v-if="showCandidate && candidate" class="site-script-editor" data-testid="site-script-candidate"><textarea :value="candidate" class="site-script-code" readonly aria-label="生成结果预览" spellcheck="false" /></div>
        <div v-else-if="code" class="site-script-editor" data-testid="site-script-editor"><textarea v-model="code" :disabled="loading || codeLoading || publishing" class="site-script-code" aria-label="可编辑 Python 代码" spellcheck="false" /></div>
        <div v-else class="site-script-empty"><b>{{ loading || codeLoading ? '正在读取已有代码…' : '当前节点还没有代码' }}</b><p>在左侧调整提示词并生成，或选择仓库中的 Python 文件。</p><el-button :disabled="busy" data-testid="site-script-manual" @click="editManually">手动编写</el-button></div>
        <div v-if="code" class="site-script-code-status"><span :class="{ 'site-script-saved': isSaved }">{{ isSaved ? '已保存并提交 Git' : '有修改待保存' }}</span><span v-if="published" :title="published.scriptDigest" data-testid="site-script-saved">Git {{ published.gitCommit.slice(0, 10) }} · {{ published.scriptDigest.slice(0, 20) }}</span><span v-else-if="loadedVersion" :title="loadedVersion.scriptDigest">Git {{ loadedVersion.gitCommit.slice(0, 10) }}</span></div>
      </section>
    </div>
    <template #footer><div class="site-script-footer"><el-button :disabled="publishing" @click="open = false">关闭</el-button><el-button type="primary" :loading="publishing" :disabled="busy || !code.trim() || showCandidate || isSaved || !configId || !repositoryId || !!directoriesError || !selectedDirectory || !!loadedVersion?.directoryLayout" data-testid="site-script-publish" @click="publish">保存并提交</el-button></div></template>
  </el-dialog>
  <el-dialog v-model="fileChooserOpen" title="选择仓库 Python 文件" width="min(760px, 94vw)" append-to-body data-testid="site-script-file-browser">
    <p class="site-script-hint">{{ selectedRepository?.name }} / {{ selectedDirectory?.name }} · {{ selectedDirectory?.path }}/</p>
    <div class="site-script-file-search"><input v-model="repositoryFileKeyword" class="site-script-input" placeholder="按路径搜索仓库文件" data-testid="site-script-file-keyword" @keyup.enter="loadRepositoryFiles(1)" /><el-button :loading="repositoryFilesLoading" @click="loadRepositoryFiles(1)">查询</el-button></div>
    <p v-if="repositoryFileError" class="site-script-error" role="alert">{{ repositoryFileError }}</p>
    <div v-loading="repositoryFilesLoading" class="site-script-file-list"><button v-for="file in selectableFiles" :key="file.path" type="button" class="site-script-file-option" :disabled="repositoryFilesLoading" :data-testid="`site-script-file-${file.path}`" @click="chooseRepositoryFile(file)">{{ file.path }}<small>{{ file.size ?? '—' }} B</small></button><p v-if="!repositoryFilesLoading && !selectableFiles.length" class="site-script-hint">当前页没有 .py 文件，可搜索路径或翻页。</p></div>
    <template #footer><div class="site-script-file-pager"><span>共 {{ repositoryFileTotal }} 个文件 · 第 {{ repositoryFilePage }} 页</span><el-button size="small" :disabled="repositoryFilePage <= 1 || repositoryFilesLoading" @click="loadRepositoryFiles(repositoryFilePage - 1)">上一页</el-button><el-button size="small" :disabled="repositoryFilePage * 50 >= repositoryFileTotal || repositoryFilesLoading" @click="loadRepositoryFiles(repositoryFilePage + 1)">下一页</el-button></div></template>
  </el-dialog>
</template>

<style scoped>
.site-script-task-config { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; font-size: 12px; color: var(--rc-muted); }
.site-script-model { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.site-script-model > label { flex: 0 0 42px; }
.site-script-model :deep(.el-select) { flex: 1; min-width: 0; }
.site-script-model > a { color: var(--el-color-primary); text-decoration: none; }
.site-script-configuration { display: grid; min-width: 0; gap: 10px; background: var(--rc-card); }
.site-script-repository-link { min-width: 0; color: var(--rc-primary); font-size: 12px; text-decoration: none; }
.site-script-repository-link:hover { text-decoration: underline; }
.site-script-paths .site-script-repository-link { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.site-script-open-button { width: 100%; margin: 0; }
.site-script-context { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--rc-muted); font-size: 11px; }.site-script-context span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.site-script-destination-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: end; gap: 10px; }
.site-script-select-label { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.site-script-naming { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 11px; color: var(--rc-muted); }.site-script-naming > span { flex: 0 0 auto; white-space: nowrap; }.site-script-naming code { min-width: 0; color: var(--rc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: inherit; }
.site-script-workspace { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(0, 1.85fr); gap: 16px; height: min(650px, calc(100dvh - 180px)); min-height: 360px; }
.site-script-auto-commit,.site-script-archive { display:flex; flex-direction:column; gap:6px; font-size:12px; }.site-script-auto-commit small { color:var(--el-text-color-secondary); }.site-script-archive { padding:10px; border:1px solid var(--el-border-color); border-radius:6px; overflow-wrap:anywhere; }.site-script-archive a { color:var(--el-color-primary); }
.site-script-settings, .site-script-editor-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 12px; padding: 16px; border: 1px solid var(--rc-border); border-radius: 10px; }
.site-script-settings { background: var(--rc-primary-bg); }.site-script-editor-panel { background: var(--rc-card); }
.site-script-panel-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }.site-script-panel-head b { flex-shrink: 0; font-size: 13px; }.site-script-panel-head > span { margin-left: auto; color: var(--rc-muted); font-size: 11px; }.site-script-panel-head > .el-button { margin-left: auto; }
.site-script-field { display: grid; gap: 6px; color: var(--rc-text); font-size: 12px; font-weight: 600; }
.site-script-directory-label { display: flex; align-items: center; justify-content: space-between; }.site-script-directory-label :deep(.el-button) { padding: 0; font-size: 11px; }
.site-script-hint { margin: 0; color: var(--rc-muted); font-size: 11px; line-height: 1.5; }
.site-script-input, .site-script-prompt, .site-script-code { box-sizing: border-box; width: 100%; border: 1px solid var(--rc-border); border-radius: 6px; padding: 9px 10px; background: var(--rc-card); color: var(--rc-text); font-size: 12px; outline: none; }
.site-script-input:focus, .site-script-prompt:focus, .site-script-code:focus { border-color: var(--rc-primary); }
.site-script-prompt-field { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 6px; }.site-script-prompt { flex: 1; min-height: 100px; line-height: 1.7; resize: none; }
.site-script-prompt-group { display:flex; flex:1; min-height:0; flex-direction:column; gap:6px; }
.site-script-generation { display: flex; align-items: center; gap: 10px; }.site-script-generation span { color: var(--rc-muted); font-size: 11px; }
.site-script-version-select { flex: 1; min-width: 0; margin-left: 12px; }
.site-script-paths { display: grid; gap: 5px; padding: 10px 12px; border-radius: 6px; background: var(--rc-primary-bg); }.site-script-paths div { display: flex; gap: 8px; min-width: 0; font-size: 11px; }.site-script-paths span { flex: 0 0 56px; color: var(--rc-muted); }.site-script-paths code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: inherit; }
.site-script-editor-toolbar { display: flex; align-items: center; gap: 8px; }.site-script-type-select { flex: 0 0 125px; }.site-script-toolbar-spacer { flex: 1; }.site-script-editor-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.site-script-result-tabs { display: flex; align-items: center; gap: 8px; }.site-script-result-tabs button:not(.el-button) { border: 0; padding: 5px 9px; border-radius: 5px; background: transparent; color: var(--rc-muted); cursor: pointer; font-size: 12px; }.site-script-result-tabs button.active { background: var(--rc-primary-bg); color: var(--rc-primary); }.site-script-result-tabs .el-button { margin-left: auto; }
.site-script-editor { flex: 1; min-height: 0; display: flex; }.site-script-code { height: 100%; resize: none; tab-size: 4; white-space: pre; font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; }
.site-script-empty { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border: 1px dashed var(--rc-border); border-radius: 6px; padding: 16px; color: var(--rc-muted); text-align: center; }.site-script-empty b { font-size: 13px; color: var(--rc-text); }.site-script-empty p { margin: 0; font-size: 12px; line-height: 1.6; }
.site-script-code-status { display: flex; justify-content: space-between; gap: 8px; color: var(--rc-muted); font-size: 11px; }.site-script-saved { color: var(--rc-primary); }
.site-script-error { margin: 0; color: var(--rc-error); font-size: 12px; line-height: 1.5; }.site-script-warning { margin: 0; color: #b45309; font-size: 12px; }
.site-script-footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }.site-script-footer :deep(.el-button + .el-button) { margin-left: 0; }
.site-script-file-search, .site-script-file-pager { display: flex; align-items: center; gap: 8px; }.site-script-file-search input { flex: 1; }.site-script-file-pager span { flex: 1; color: var(--rc-muted); font-size: 12px; }.site-script-file-list { display: grid; gap: 6px; max-height: 48vh; overflow: auto; margin-top: 12px; }.site-script-file-option { display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 0; border-radius: 5px; background: var(--rc-primary-bg); color: var(--rc-primary); text-align: left; overflow-wrap: anywhere; cursor: pointer; }.site-script-file-option:hover { filter: brightness(.97); }.site-script-file-option small { flex-shrink: 0; color: var(--rc-muted); }
@media (max-width: 760px) { .site-script-workspace { grid-template-columns: 1fr; height: auto; max-height: calc(100dvh - 180px); overflow: auto; min-height: 0; }.site-script-settings { min-height: 400px; }.site-script-editor-panel { min-height: 440px; }.site-script-editor-toolbar { flex-wrap: wrap; } }
</style>
