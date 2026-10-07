<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryFile, type PublishedScript, type SiteCodeVersion } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'

const DEFAULT_PROMPT = `参考 www.realcan.cn.py 样例，为配置的列表 URL 编写完整的 Python 新闻抓取代码。
提供 scrape(url) 函数，返回新闻字典列表，字段包含 title、date、url、summary、content。
提取列表中的新闻标题、发布日期和详情页链接；需要时访问详情页补充摘要和正文。
将相对链接转换为完整 URL，过滤无效链接和重复新闻，合理处理超时及页面解析异常。
保持样例的函数接口和返回结构，根据目标网站调整页面选择器，不照搬样例站点的域名。
只生成抓取代码，不包含 MQ、数据库、流程调度逻辑；导入模块时不要发起网络请求。`

const props = defineProps<{ initialUrl: string; initialPrompt: string; configId?: string; queueName?: string; configType?: string }>()
const open = defineModel<boolean>('open', { required: true })
const url = ref('')
const prompt = ref('')
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
const codeType = ref<'site' | 'default'>('site')
const versions = ref<SiteCodeVersion[]>([])
const versionsError = ref('')
const repositories = ref<CodeRepository[]>([])
const repositoryId = ref('')
const repositoriesError = ref('')
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
const hostname = computed(() => { try { return new URL(url.value.trim()).hostname.toLowerCase() } catch { return '' } })
const fileName = computed(() => codeType.value === 'site' ? `${hostname.value || 'site'}.py` : `${props.queueName || 'queue'}.py`)
const deliveryPath = computed(() => codeType.value === 'site' ? `sites/${fileName.value}` : fileName.value)
const contextVersions = computed(() => versions.value.filter((version) => !version.siteHost || version.siteHost === hostname.value))
const storagePath = computed(() => {
  if (published.value?.repoId === repositoryId.value && published.value.deliveryPath === deliveryPath.value && published.value.storagePath) return published.value.storagePath
  const version = loadedVersion.value
  if (version && (!repositoryId.value || version.repoId === repositoryId.value) && version.deliveryPath === deliveryPath.value) return version.storagePath
  return ''
})
const absoluteStoragePath = computed(() => {
  const root = selectedRepository.value?.path || loadedVersion.value?.repoPath || ''
  if (!storagePath.value) return root
  const separator = root.includes('\\') ? '\\' : '/'
  return root ? `${root.replace(/[\\/]$/, '')}${separator}${storagePath.value.replaceAll('/', separator)}` : storagePath.value
})
const draftKey = computed(() => JSON.stringify({ code: code.value, prompt: prompt.value.trim(), url: url.value.trim(),
  repositoryId: repositoryId.value, codeType: codeType.value, sourceFilePath: sourceFilePath.value, sourceGitCommit: sourceGitCommit.value }))
const isSaved = computed(() => !!code.value && savedDraftKey.value === draftKey.value)
const busy = computed(() => loading.value || codeLoading.value || generating.value || publishing.value)
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
let controller: AbortController | null = null
let openedFor = ''
let sessionId = 0
let versionRequestId = 0
let fileRequestId = 0

function clearDraft() {
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
  error.value = ''
  warnings.value = []
}

async function initialize() {
  const session = ++sessionId
  const context = `${props.configId || ''}\n${props.queueName || ''}\n${props.initialUrl}\n${props.configType || ''}`
  if (openedFor !== context) {
    clearDraft()
    repositoryId.value = ''
    codeType.value = 'site'
    prompt.value = props.initialPrompt.trim() || DEFAULT_PROMPT
  }
  openedFor = context
  url.value = props.initialUrl
  loading.value = true
  repositoriesError.value = ''
  versionsError.value = ''
  const [repoResult, versionResult] = await Promise.allSettled([
    runnerManagementApi.codeRepositories(),
    props.configId && props.queueName ? runnerManagementApi.siteCodeVersions(props.configId, props.queueName) : Promise.resolve([] as SiteCodeVersion[]),
  ])
  if (session !== sessionId || !open.value) return
  if (repoResult.status === 'fulfilled') {
    repositories.value = repoResult.value
    if (!availableRepositories.value.some((repo) => repo.repoId === repositoryId.value)) {
      repositoryId.value = availableRepositories.value.find((repo) => repo.isDefault)?.repoId
        || availableRepositories.value[0]?.repoId || ''
    }
  } else {
    repositories.value = []
    repositoryId.value = ''
    repositoriesError.value = message(repoResult.reason)
  }
  if (versionResult.status === 'fulfilled') {
    versions.value = versionResult.value
    if (!code.value && !candidate.value) {
      const latest = contextVersions.value.find((version) => version.siteHost === hostname.value)
        || contextVersions.value.find((version) => !version.siteHost)
      if (latest) await loadVersion(latest)
    }
  } else {
    versions.value = []
    versionsError.value = message(versionResult.reason)
  }
  if (session === sessionId) loading.value = false
}

watch(() => [open.value, props.configId, props.queueName, props.initialUrl, props.configType] as const, ([visible]) => {
  cancelGenerate()
  if (!visible) {
    sessionId++
    versionRequestId++
    fileRequestId++
    loading.value = false
    codeLoading.value = false
    fileChooserOpen.value = false
    return
  }
  void initialize()
}, { immediate: true })

watch(url, (next, previous) => {
  if (previous && next !== previous) {
    cancelGenerate()
    clearDraft()
  }
})
watch(repositoryId, () => {
  fileRequestId++
  sourceFilePath.value = ''
  sourceGitCommit.value = ''
  repositoryFiles.value = []
  if (fileChooserOpen.value) void loadRepositoryFiles(1)
}, { flush: 'sync' })
onBeforeUnmount(() => { controller?.abort(); sessionId++; versionRequestId++; fileRequestId++ })

async function loadVersion(version: SiteCodeVersion) {
  const requestId = ++versionRequestId
  const session = sessionId
  codeLoading.value = true
  error.value = ''
  try {
    const result = await runnerManagementApi.siteCodeContent(version.scriptDigest)
    if (requestId !== versionRequestId || session !== sessionId || !open.value) return
    if (availableRepositories.value.some((repo) => repo.repoId === result.repoId)) repositoryId.value = result.repoId!
    code.value = result.code
    prompt.value = result.prompt.trim() || props.initialPrompt.trim() || DEFAULT_PROMPT
    codeType.value = result.siteHost ? 'site' : 'default'
    loadedVersion.value = result
    selectedVersionDigest.value = result.scriptDigest
    published.value = null
    candidate.value = ''
    showCandidate.value = false
    sourceFilePath.value = result.sourceRepoPath || ''
    sourceGitCommit.value = result.sourceGitCommit || ''
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
function restorePrompt() { prompt.value = DEFAULT_PROMPT }
function cancelGenerate() { controller?.abort(); controller = null; generating.value = false }

async function generate() {
  if (busy.value) return
  if (!prompt.value.trim()) { error.value = '请填写抓取提示词'; return }
  try {
    const parsed = new URL(url.value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error()
  } catch { error.value = '请输入有效的 http(s) 列表 URL'; return }
  controller?.abort()
  const active = new AbortController()
  controller = active
  generating.value = true
  error.value = ''
  warnings.value = []
  try {
    const result = await generateSiteScript({ prompt: prompt.value.trim(), url: url.value.trim(), sampleId: 'www.realcan.cn.py' }, active.signal)
    if (active.signal.aborted) return
    if (code.value.trim()) {
      candidate.value = result.code
      showCandidate.value = true
    } else {
      code.value = result.code
      sourceFilePath.value = ''
      sourceGitCommit.value = ''
    }
    warnings.value = result.warnings
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
  const repoId = repositoryId.value
  if (!repoId) return
  const requestId = ++fileRequestId
  repositoryFilesLoading.value = true
  repositoryFileError.value = ''
  try {
    const result = await runnerManagementApi.codeRepositoryFiles(repoId, repositoryFileKeyword.value.trim(), page)
    if (requestId !== fileRequestId || repositoryId.value !== repoId) return
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
  if (file.size !== null && file.size > 200_000) { repositoryFileError.value = '节点代码不能超过 200 KB'; return }
  const session = sessionId
  const requestId = ++fileRequestId
  repositoryFilesLoading.value = true
  try {
    const result = await runnerManagementApi.codeRepositoryFileContent(repoId, file.path)
    if (session !== sessionId || requestId !== fileRequestId || repositoryId.value !== repoId) return
    clearDraft()
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
  if (loadedVersion.value?.directoryLayout) { error.value = '当前版本包含目录映射，请在「系统设置 → 下发目录」调整仓库关联后发布，避免覆盖公共代码配置'; return }
  const configId = props.configId?.trim()
  if (!configId) { error.value = '请先保存节点配置，再保存代码'; return }
  if (!code.value.trim()) return
  if (!props.queueName?.trim()) { error.value = '请先在任务配置中保存队列名称'; return }
  if (!repositoryId.value) { error.value = '请先在系统设置中配置可用的代码仓库'; return }
  publishing.value = true
  error.value = ''
  const session = sessionId
  const submittedKey = draftKey.value
  try {
    const result = await runnerManagementApi.publishScript({
      configId, fileName: fileName.value, code: code.value, prompt: prompt.value.trim(), url: url.value.trim(),
      queueName: props.queueName.trim(), codeType: codeType.value, configType: props.configType || undefined,
      repositoryId: repositoryId.value,
      sourceFilePath: sourceFilePath.value || undefined, sourceGitCommit: sourceGitCommit.value || undefined,
      siteHost: codeType.value === 'site' ? new URL(url.value.trim()).hostname.toLowerCase() : undefined,
    })
    if (session !== sessionId || !open.value) return
    published.value = result
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
  <el-dialog v-model="open" title="AI 代码工作区" width="min(1160px, 96vw)" top="4vh" append-to-body data-testid="site-script-dialog">
    <div class="site-script-context"><span>节点 #{{ configId || '未保存' }}</span><span>队列 {{ queueName || '未配置' }}</span><span v-if="configType">配置类型 {{ configType }}</span></div>
    <div v-loading="loading" class="site-script-workspace">
      <section class="site-script-settings" data-testid="site-script-prompt-panel">
        <div class="site-script-panel-head"><b>生成设置</b><span>参考样例：www.realcan.cn.py</span></div>
        <label class="site-script-field">保存仓库
          <el-select v-model="repositoryId" :disabled="busy" data-testid="site-script-repository" placeholder="请选择仓库">
            <el-option v-for="repo in availableRepositories" :key="repo.repoId" :label="`${repo.name}${repo.isDefault ? '（默认）' : ''}`" :value="repo.repoId" />
          </el-select>
        </label>
        <p class="site-script-hint">已按节点配置类型筛选可用仓库，包含通用仓库。</p>
        <p v-if="repositoriesError" class="site-script-error" role="alert">仓库加载失败：{{ repositoriesError }}</p>
        <label class="site-script-field">列表 URL<input v-model="url" :disabled="busy" class="site-script-input" data-testid="site-script-url" placeholder="https://www.realcan.cn/newscenter" /></label>
        <div class="site-script-prompt-field">
          <div class="site-script-prompt-head"><label for="site-script-prompt">抓取提示词</label><el-button link type="primary" :disabled="busy" data-testid="site-script-reset-prompt" @click="restorePrompt">恢复默认</el-button></div>
          <textarea id="site-script-prompt" v-model="prompt" :disabled="busy" class="site-script-prompt" data-testid="site-script-prompt" placeholder="说明列表页结构、提取字段及详情页要求" />
        </div>
        <div class="site-script-generation"><el-button type="primary" :loading="generating" :disabled="loading || codeLoading || publishing" data-testid="site-script-generate" @click="generate">{{ code ? '重新生成' : '生成代码' }}</el-button><el-button v-if="generating" @click="cancelGenerate">取消生成</el-button><span v-else>生成后可在右侧编辑、保存</span></div>
      </section>
      <section v-loading="codeLoading" class="site-script-editor-panel" data-testid="site-script-code-panel">
        <div class="site-script-panel-head">
          <b>代码编辑</b>
          <el-select v-if="contextVersions.length" v-model="selectedVersionDigest" :disabled="busy" class="site-script-version-select" data-testid="site-code-versions" placeholder="历史版本" @change="selectVersion">
            <el-option v-for="version in contextVersions" :key="version.scriptDigest" :value="version.scriptDigest" :label="`${version.siteHost || '队列通用'} · ${version.gitCommit.slice(0, 10)}`" />
          </el-select>
          <span v-else>Python · scrape(url)</span>
        </div>
        <div class="site-script-paths">
          <div><span>仓库文件</span><code :title="absoluteStoragePath" data-testid="site-script-storage-path">{{ storagePath ? absoluteStoragePath : `${absoluteStoragePath || '请先选择仓库'}${absoluteStoragePath ? ' / 保存后自动分配文件路径' : ''}` }}</code></div>
          <div><span>→ 下发</span><code data-testid="site-script-delivery-path">{{ deliveryPath }}</code></div>
          <div v-if="sourceFilePath"><span>来源文件</span><code :title="sourceFilePath" data-testid="site-script-source-file">{{ sourceFilePath }} · {{ sourceGitCommit.slice(0, 10) }}</code></div>
        </div>
        <div class="site-script-editor-toolbar">
          <el-select v-model="codeType" :disabled="busy" class="site-script-type-select" data-testid="site-script-code-type"><el-option label="网站专用" value="site" /><el-option label="队列通用" value="default" /></el-select>
          <el-button size="small" :disabled="busy || !repositoryId" data-testid="site-script-choose-repo-file" @click="toggleFileChooser">选择仓库文件</el-button>
          <span class="site-script-toolbar-spacer" />
          <el-button v-if="code" size="small" :disabled="showCandidate" @click="copyToClipboard(code, 'Python 代码')">复制</el-button>
          <el-button v-if="code" size="small" :disabled="showCandidate" data-testid="site-script-download" @click="download">下载</el-button>
        </div>
        <p v-if="versionsError" class="site-script-error" role="alert">版本列表加载失败：{{ versionsError }}</p>
        <p v-if="error" class="site-script-error" data-testid="site-script-error" role="alert">{{ error }}</p>
        <p v-for="warning in warnings" :key="warning" class="site-script-warning">{{ warning }}</p>
        <div v-if="candidate" class="site-script-result-tabs"><button type="button" :class="{ active: !showCandidate }" data-testid="site-script-current-tab" @click="showCandidate = false">当前代码</button><button type="button" :class="{ active: showCandidate }" data-testid="site-script-candidate-tab" @click="showCandidate = true">新生成结果</button><el-button v-if="showCandidate" link type="primary" data-testid="site-script-adopt" @click="adopt">采用新结果</el-button></div>
        <div v-if="showCandidate && candidate" class="site-script-editor" data-testid="site-script-candidate"><textarea :value="candidate" class="site-script-code" readonly aria-label="生成结果预览" spellcheck="false" /></div>
        <div v-else-if="code" class="site-script-editor" data-testid="site-script-editor"><textarea v-model="code" :disabled="loading || codeLoading || publishing" class="site-script-code" aria-label="可编辑 Python 代码" spellcheck="false" /></div>
        <div v-else class="site-script-empty"><b>{{ loading || codeLoading ? '正在读取已有代码…' : '当前节点还没有代码' }}</b><p>在左侧调整提示词并生成，或选择仓库中的 Python 文件。</p><el-button :disabled="busy" data-testid="site-script-manual" @click="editManually">手动编写</el-button></div>
        <div v-if="code" class="site-script-code-status"><span :class="{ 'site-script-saved': isSaved }">{{ isSaved ? '已保存并提交 Git' : '有修改待保存' }}</span><span v-if="published" :title="published.scriptDigest" data-testid="site-script-saved">Git {{ published.gitCommit.slice(0, 10) }} · {{ published.scriptDigest.slice(0, 20) }}</span><span v-else-if="loadedVersion" :title="loadedVersion.scriptDigest">Git {{ loadedVersion.gitCommit.slice(0, 10) }}</span></div>
      </section>
    </div>
    <template #footer><div class="site-script-footer"><p v-if="loadedVersion?.directoryLayout">此版本包含公共代码和目录映射，请在「系统设置 → 下发目录」编辑并发布。</p><p v-else>{{ selectedRepository?.remoteUrl ? '保存后自动提交 Git 并推送到远程仓库。' : '保存后自动提交到本地 Git 仓库。' }}运行配置在「节点代码」中发布。</p><el-button :disabled="publishing" @click="open = false">关闭</el-button><el-button type="primary" :loading="publishing" :disabled="busy || !code.trim() || showCandidate || isSaved || !configId || !repositoryId || !!loadedVersion?.directoryLayout" data-testid="site-script-publish" @click="publish">保存并提交</el-button></div></template>
  </el-dialog>
  <el-dialog v-model="fileChooserOpen" title="选择仓库 Python 文件" width="min(760px, 94vw)" append-to-body data-testid="site-script-file-browser">
    <div class="site-script-file-search"><input v-model="repositoryFileKeyword" class="site-script-input" placeholder="按路径搜索仓库文件" data-testid="site-script-file-keyword" @keyup.enter="loadRepositoryFiles(1)" /><el-button :loading="repositoryFilesLoading" @click="loadRepositoryFiles(1)">查询</el-button></div>
    <p v-if="repositoryFileError" class="site-script-error" role="alert">{{ repositoryFileError }}</p>
    <div v-loading="repositoryFilesLoading" class="site-script-file-list"><button v-for="file in selectableFiles" :key="file.path" type="button" class="site-script-file-option" :disabled="repositoryFilesLoading" :data-testid="`site-script-file-${file.path}`" @click="chooseRepositoryFile(file)">{{ file.path }}<small>{{ file.size ?? '—' }} B</small></button><p v-if="!repositoryFilesLoading && !selectableFiles.length" class="site-script-hint">当前页没有 .py 文件，可搜索路径或翻页。</p></div>
    <template #footer><div class="site-script-file-pager"><span>共 {{ repositoryFileTotal }} 个文件 · 第 {{ repositoryFilePage }} 页</span><el-button size="small" :disabled="repositoryFilePage <= 1 || repositoryFilesLoading" @click="loadRepositoryFiles(repositoryFilePage - 1)">上一页</el-button><el-button size="small" :disabled="repositoryFilePage * 50 >= repositoryFileTotal || repositoryFilesLoading" @click="loadRepositoryFiles(repositoryFilePage + 1)">下一页</el-button></div></template>
  </el-dialog>
</template>

<style scoped>
.site-script-context { display: flex; gap: 16px; margin-bottom: 12px; color: var(--rc-muted); font-size: 12px; }
.site-script-workspace { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(0, 1.85fr); gap: 16px; height: min(600px, calc(100dvh - 220px)); min-height: 360px; }
.site-script-settings, .site-script-editor-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 12px; padding: 16px; border: 1px solid var(--rc-border); border-radius: 10px; }
.site-script-settings { background: var(--rc-primary-bg); }.site-script-editor-panel { background: var(--rc-card); }
.site-script-panel-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }.site-script-panel-head b { flex-shrink: 0; font-size: 13px; }.site-script-panel-head > span { margin-left: auto; color: var(--rc-muted); font-size: 11px; }
.site-script-field { display: grid; gap: 6px; color: var(--rc-text); font-size: 12px; font-weight: 600; }
.site-script-hint { margin: 0; color: var(--rc-muted); font-size: 11px; line-height: 1.5; }
.site-script-input, .site-script-prompt, .site-script-code { box-sizing: border-box; width: 100%; border: 1px solid var(--rc-border); border-radius: 6px; padding: 9px 10px; background: var(--rc-card); color: var(--rc-text); font-size: 12px; outline: none; }
.site-script-input:focus, .site-script-prompt:focus, .site-script-code:focus { border-color: var(--rc-primary); }
.site-script-prompt-field { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 6px; }.site-script-prompt-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; }.site-script-prompt { flex: 1; min-height: 100px; line-height: 1.7; resize: none; }
.site-script-generation { display: flex; align-items: center; gap: 10px; }.site-script-generation span { color: var(--rc-muted); font-size: 11px; }
.site-script-version-select { flex: 1; min-width: 0; margin-left: 12px; }
.site-script-paths { display: grid; gap: 5px; padding: 10px 12px; border-radius: 6px; background: var(--rc-primary-bg); }.site-script-paths div { display: flex; gap: 8px; min-width: 0; font-size: 11px; }.site-script-paths span { flex: 0 0 56px; color: var(--rc-muted); }.site-script-paths code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: inherit; }
.site-script-editor-toolbar { display: flex; align-items: center; gap: 8px; }.site-script-type-select { flex: 0 0 125px; }.site-script-toolbar-spacer { flex: 1; }.site-script-editor-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.site-script-result-tabs { display: flex; align-items: center; gap: 8px; }.site-script-result-tabs button:not(.el-button) { border: 0; padding: 5px 9px; border-radius: 5px; background: transparent; color: var(--rc-muted); cursor: pointer; font-size: 12px; }.site-script-result-tabs button.active { background: var(--rc-primary-bg); color: var(--rc-primary); }.site-script-result-tabs .el-button { margin-left: auto; }
.site-script-editor { flex: 1; min-height: 0; display: flex; }.site-script-code { height: 100%; resize: none; tab-size: 4; white-space: pre; font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; }
.site-script-empty { display: flex; flex: 1; min-height: 0; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border: 1px dashed var(--rc-border); border-radius: 6px; padding: 16px; color: var(--rc-muted); text-align: center; }.site-script-empty b { font-size: 13px; color: var(--rc-text); }.site-script-empty p { margin: 0; font-size: 12px; line-height: 1.6; }
.site-script-code-status { display: flex; justify-content: space-between; gap: 8px; color: var(--rc-muted); font-size: 11px; }.site-script-saved { color: var(--rc-primary); }
.site-script-error { margin: 0; color: var(--rc-error); font-size: 12px; line-height: 1.5; }.site-script-warning { margin: 0; color: #b45309; font-size: 12px; }
.site-script-footer { display: flex; align-items: center; gap: 8px; }.site-script-footer p { flex: 1; margin: 0; color: var(--rc-muted); font-size: 11px; text-align: left; line-height: 1.5; }.site-script-footer :deep(.el-button + .el-button) { margin-left: 0; }
.site-script-file-search, .site-script-file-pager { display: flex; align-items: center; gap: 8px; }.site-script-file-search input { flex: 1; }.site-script-file-pager span { flex: 1; color: var(--rc-muted); font-size: 12px; }.site-script-file-list { display: grid; gap: 6px; max-height: 48vh; overflow: auto; margin-top: 12px; }.site-script-file-option { display: flex; justify-content: space-between; gap: 10px; padding: 10px; border: 0; border-radius: 5px; background: var(--rc-primary-bg); color: var(--rc-primary); text-align: left; overflow-wrap: anywhere; cursor: pointer; }.site-script-file-option:hover { filter: brightness(.97); }.site-script-file-option small { flex-shrink: 0; color: var(--rc-muted); }
@media (max-width: 760px) { .site-script-workspace { grid-template-columns: 1fr; height: auto; max-height: calc(100dvh - 180px); overflow: auto; min-height: 0; }.site-script-settings { min-height: 400px; }.site-script-editor-panel { min-height: 440px; }.site-script-context { flex-wrap: wrap; gap: 5px 12px; }.site-script-footer { flex-wrap: wrap; }.site-script-footer p { flex-basis: 100%; }.site-script-editor-toolbar { flex-wrap: wrap; } }
</style>
