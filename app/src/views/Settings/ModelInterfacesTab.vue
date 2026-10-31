<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type ModelInterface, type ModelInterfaceSettings, type CodeGenerationServer } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'
import { DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT } from '@/api/siteScript'
import { formatModelTestOutput } from '@/api/modelInterfaceStream'
import MarkdownOutput from '@/components/MarkdownOutput.vue'
import { createGenerationTaskId, generationWorkspace } from '@/utils/generationWorkspace'

const props = defineProps<{ server?: CodeGenerationServer; embedded?: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const scope = ref<'server' | 'all' | 'unassigned'>(props.server ? 'server' : 'all')
watch(() => props.server?.serverId, id => { scope.value = id ? 'server' : 'all' })
const auth = useAuthStore(), canWrite = computed(() => auth.role === 'admin')
const settings = ref<ModelInterfaceSettings>({ items: [], revision: 0 })
const generationServers = ref<CodeGenerationServer[]>([])
const serverLoadError = ref('')
async function loadServers() {
  try { generationServers.value = (await runnerManagementApi.codeGenerationServers()).items; serverLoadError.value = '' }
  catch { serverLoadError.value = '代码生成服务器列表加载失败，可点击刷新重试' }
}
const loading = ref(false), saving = ref(false), error = ref(''), keyword = ref(''), drawer = ref(false)
const statusSavingId = ref('')
async function toggleEnabled(row: ModelInterface): Promise<boolean> {
  if (!canWrite.value || statusSavingId.value || loading.value || saving.value || testing.value || promptSaving.value) return false
  if (row.isDefault && row.enabled) { ElMessage.warning('请先将其他启用的接口设为默认，再停用此接口'); return false }
  statusSavingId.value = row.id; error.value = ''
  try {
    const items = settings.value.items.map(item => item.id === row.id ? { ...item, enabled: !item.enabled } : { ...item })
    settings.value = await runnerManagementApi.saveModelInterfaces({ items, revision: settings.value.revision })
    emit('changed')
    ElMessage.success(row.enabled ? '接口已停用' : '接口已启用')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { statusSavingId.value = '' }
  // The saved response updates model-value; do not also flip the switch locally.
  return false
}
const kinds = { agent: 'Agent 代码生成', 'gemini-agent': 'Gemini Agent', 'gemini-chat': 'Gemini Chat', chat: 'Chat 对话生成', 'site-script': '现有代码生成服务' }
const isAgent = (kind: ModelInterface['kind']) => kind === 'agent' || kind === 'gemini-agent'
const needsModel = (kind: ModelInterface['kind']) => kind === 'agent' || kind === 'chat' || kind === 'gemini-chat'
const empty = (): ModelInterface => ({ id: '', name: '', kind: 'chat', endpoint: 'http://192.168.1.171:6000/workbuudy/chat',
  model: 'hy3', enabled: true, isDefault: false, timeoutSeconds: 300, prjDir: 'D:\\aicode', cdpPort: 9223, inputFileDir: '',
  codeDir: 'D:\\aicode\\code', outputFileDir: 'D:\\aicode\\output', stream: true,
  title: '', generationServerId: '', testSystemPrompt: undefined, testUserPrompt: undefined })
const form = reactive<ModelInterface>(empty()), testForm = reactive<ModelInterface>(empty())
const formBaseline = ref('')
const formServer = computed(() => (props.server?.serverId === form.generationServerId ? props.server : undefined)
  || generationServers.value.find(server => server.serverId === form.generationServerId))
const serverWorkspace = (server: CodeGenerationServer) => server.generationRoot || server.workspace
function modelWorkspace(row: ModelInterface) {
  const server = (props.server?.serverId === row.generationServerId ? props.server : undefined)
    || generationServers.value.find(server => server.serverId === row.generationServerId)
  return props.embedded && server ? serverWorkspace(server) : row.prjDir ?? 'D:\\aicode'
}
watch(() => form.generationServerId, () => {
  if (props.embedded && formServer.value) form.prjDir = serverWorkspace(formServer.value)
})
const generationServerChoice = computed({
  get: () => (form.generationServerMode || (form.generationServerId ? 'manual' : 'auto')) === 'manual' ? form.generationServerId || '' : `@${form.generationServerMode || 'auto'}`,
  set: (value: string) => {
    form.generationServerMode = value === '@auto' ? 'auto' : value === '@direct' ? 'direct' : 'manual'
    form.generationServerId = form.generationServerMode === 'manual' ? value : ''
  },
})
function generationServerText(row: ModelInterface) {
  const name = generationServers.value.find(server => server.serverId === row.generationServerId)?.name || row.generationServerId
  if (name) return `${row.generationServerMode === 'auto' ? '地址匹配' : '手工关联'}：${name}`
  return ({ ambiguous: '同一地址有多个实例，请手工选择', local: '本机地址需手工关联远程实例', unmatched: '等待匹配地址的生成服务器上线', direct: '直接连接模型接口' } as Record<string, string>)[row.generationServerMatch || ''] || '按接口地址自动匹配'
}
const testTaskId = ref(createGenerationTaskId())
let testTaskUsed = false
const formDirectories = computed(() => generationWorkspace(form, '{任务ID}'))
const testDirectories = computed(() => generationWorkspace(testForm, testTaskId.value))
const testOpen = ref(false), testing = ref(false), testError = ref('')
const promptSaving = ref(false)
const testResult = ref<Awaited<ReturnType<typeof runnerManagementApi.testModelInterface>> | null>(null)
const displayedOutput = computed(() => formatModelTestOutput(testResult.value?.responseText || '', testing.value))
const testPhase = ref(''), testBody = ref<HTMLElement>()
let testController: AbortController | null = null, elapsedTimer: ReturnType<typeof setInterval> | undefined
function stopTest() { testController?.abort() }
onBeforeUnmount(() => { clearTimeout(promptSaveTimer); void saveTestPrompts(); stopTest(); clearInterval(elapsedTimer) })
const samplePrompt = ref('')
const sampleUrl = 'https://cn.chinahdht.com/news/company-news/'
const testUrl = ref(sampleUrl), testSystemPrompt = ref('')
const promptBaseline = ref('')
const promptKey = () => JSON.stringify([testSystemPrompt.value, samplePrompt.value])
const promptsDirty = computed(() => promptKey() !== promptBaseline.value)
const promptSaveError = ref('')
let promptSaveTimer: ReturnType<typeof setTimeout> | undefined, promptSavePromise: Promise<boolean> | null = null
watch([testSystemPrompt, samplePrompt], () => {
  clearTimeout(promptSaveTimer)
  if (testOpen.value && canWrite.value && promptsDirty.value) {
    promptSaveError.value = ''
    promptSaveTimer = setTimeout(() => { void saveTestPrompts() }, 700)
  }
})
async function closeTest(done?: () => void) {
  if (testing.value || !await saveTestPrompts()) return
  if (done) done(); else testOpen.value = false
}
function defaultSamplePrompt(kind: ModelInterface['kind']) {
  return kind === 'chat' || kind === 'gemini-chat' ? '南京到上海的距离' : `帮我采集这个网站的新闻的代码，不要写翻页的代码，网址是${sampleUrl}。请返回完整 Python 代码。`
}
function buildSampleRequest(config: ModelInterface, prompt: string, url = sampleUrl, systemPrompt = config.kind === 'site-script' ? DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT : '', taskId = testTaskId.value) {
  try {
    const target = new URL(config.endpoint.trim())
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || !prompt.trim()) return ''
    if (config.kind === 'site-script') {
      return `POST ${target.href}\nContent-Type: application/json\n\n${JSON.stringify({
        prompt: prompt.trim(), userPrompt: prompt.trim(),
        systemPrompt, url, sampleId: 'www.realcan.cn.py',
      }, null, 2)}`
    }
    if (needsModel(config.kind) && !config.model.trim()) return ''
    const combinedPrompt = systemPrompt.trim() ? `系统要求：\n${systemPrompt.trim()}\n\n用户要求：\n${prompt.trim()}` : prompt.trim()
    if (config.kind === 'gemini-chat') {
      return `POST ${target.href}\nContent-Type: application/json\n\n${JSON.stringify({ prompt: combinedPrompt, model: config.model.trim() }, null, 2)}`
    }
    if (isAgent(config.kind)) {
      const paths = generationWorkspace(config, taskId)
      return `POST ${target.href}\nContent-Type: application/json; charset=utf-8\n\n${JSON.stringify({
        prj_dir: paths.prjDir, input_file_dir: paths.inputFileDir,
        ...(config.kind === 'gemini-agent' ? { title: config.title?.trim() || '' } : { model: config.model.trim() }),
        prompt: combinedPrompt, code_dir: paths.codeDir, output_file_dir: paths.outputFileDir,
        ...(config.kind === 'agent' ? { cdp_port: config.cdpPort ?? 9223 } : {}),
      }, null, 2)}`
    }
    target.searchParams.set('model', config.model.trim())
    target.searchParams.set('prompt', combinedPrompt)
    target.searchParams.set('stream', config.stream ? '1' : '0')
    // Keep Chinese and Windows paths readable; escape only query separators
    // that would otherwise change the parameter values when pasted in a browser.
    const query = [...target.searchParams].map(([key, value]) =>
      `${key}=${value.replace(/[%&+#\r\n\t]/g, character => encodeURIComponent(character))}`).join('&')
    target.search = ''
    return `${target.href}?${query}`
  } catch { return '' }
}
const sampleRequest = computed(() => buildSampleRequest(testForm, samplePrompt.value, testUrl.value, testSystemPrompt.value))
function copySample(row: ModelInterface) {
  void copyToClipboard(buildSampleRequest({ ...row, prjDir: modelWorkspace(row) }, row.testUserPrompt ?? defaultSamplePrompt(row.kind), sampleUrl,
    row.testSystemPrompt ?? (row.kind === 'site-script' ? DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT : ''), createGenerationTaskId()), row.kind === 'chat' ? '请求地址' : 'HTTP 请求')
}
function openTest(row: ModelInterface) {
  testTaskId.value = createGenerationTaskId(); testTaskUsed = false
  Object.assign(testForm, empty(), row, { prjDir: modelWorkspace(row) }); samplePrompt.value = row.testUserPrompt ?? defaultSamplePrompt(row.kind)
  testUrl.value = sampleUrl; testSystemPrompt.value = row.testSystemPrompt ?? (row.kind === 'site-script' ? DEFAULT_SITE_SCRIPT_SYSTEM_PROMPT : '')
  promptBaseline.value = promptKey()
  promptSaveError.value = ''
  testResult.value = null; testError.value = ''; testOpen.value = true
}
async function saveTestPrompts(): Promise<boolean> {
  clearTimeout(promptSaveTimer)
  if (promptSavePromise) { if (!await promptSavePromise) return false; return saveTestPrompts() }
  if (!canWrite.value || !testForm.id || !promptsDirty.value) return true
  promptSaving.value = true; promptSaveError.value = ''
  const system = testSystemPrompt.value, user = samplePrompt.value, id = testForm.id
  promptSavePromise = (async () => {
    try {
      settings.value = await runnerManagementApi.saveModelTestPrompts({ interfaceId: id,
        systemPrompt: system, userPrompt: user, revision: settings.value.revision })
      const saved = settings.value.items.find(item => item.id === id)
      if (!saved || saved.testSystemPrompt !== system || saved.testUserPrompt !== user) throw new Error('后台返回的提示词与保存内容不一致，请重试')
      testForm.testSystemPrompt = system; testForm.testUserPrompt = user
      promptBaseline.value = JSON.stringify([system, user])
      return true
    } catch (e) { promptSaveError.value = e instanceof Error ? e.message : String(e); return false }
    finally { promptSaving.value = false }
  })()
  const success = await promptSavePromise
  promptSavePromise = null
  return success && promptsDirty.value ? saveTestPrompts() : success
}
async function runTest() {
  if (testing.value || !sampleRequest.value) return
  if (!await saveTestPrompts() || testing.value) return
  if (testTaskUsed) testTaskId.value = createGenerationTaskId()
  testTaskUsed = true
  testing.value = true; testResult.value = null; testError.value = ''
  const active = new AbortController(), started = Date.now()
  testController = active
  testPhase.value = '正在连接模型服务'
  testResult.value = { ok: false, status: 0, contentType: '', responseText: '', durationMs: 0 }
  elapsedTimer = setInterval(() => { if (testResult.value) testResult.value.durationMs = Date.now() - started }, 250)
  void nextTick(() => { if (testBody.value) testBody.value.scrollTop = testBody.value.scrollHeight })
  try {
    await runnerManagementApi.streamModelInterfaceTest({ interfaceId: testForm.id,
      ...(isAgent(testForm.kind) ? { taskId: testTaskId.value } : {}),
      prompt: samplePrompt.value.trim(), model: testForm.model.trim(), stream: testForm.stream,
      title: testForm.title?.trim(), prjDir: testForm.prjDir?.trim(),
      inputFileDir: isAgent(testForm.kind) ? testDirectories.value.inputFileDir : testForm.inputFileDir.trim(),
      codeDir: isAgent(testForm.kind) ? testDirectories.value.codeDir : testForm.codeDir.trim(),
      outputFileDir: isAgent(testForm.kind) ? testDirectories.value.outputFileDir : testForm.outputFileDir.trim(),
      ...(testForm.kind === 'agent' ? { cdpPort: testForm.cdpPort ?? 9223 } : {}),
      url: testUrl.value.trim(), systemPrompt: testSystemPrompt.value.trim() }, event => {
      if (active.signal.aborted || !testResult.value) return
      const follow = !testBody.value || testBody.value.scrollHeight - testBody.value.scrollTop - testBody.value.clientHeight < 60
      if (event.type === 'headers') {
        Object.assign(testResult.value, { status: event.status, ok: event.ok, contentType: event.contentType })
        testPhase.value = '已连接，等待模型输出'
      } else if (event.type === 'chunk') {
        testResult.value.responseText += event.text; testPhase.value = '正在接收响应'
      } else if (event.type === 'done') testPhase.value = testResult.value.ok ? '测试完成' : '测试失败'
      if (follow) void nextTick(() => { if (testBody.value) testBody.value.scrollTop = testBody.value.scrollHeight })
    }, active.signal)
  } catch (e) {
    if (active.signal.aborted) testPhase.value = '已停止等待'
    else { testPhase.value = '测试失败'; testError.value = e instanceof Error ? e.message : String(e) }
  } finally {
    clearInterval(elapsedTimer)
    if (testResult.value) testResult.value.durationMs = Date.now() - started
    testing.value = false; testController = null
  }
}
const rows = computed(() => settings.value.items.filter(row =>
  (!props.embedded || scope.value === 'all' || (scope.value === 'server' ? row.generationServerId === props.server?.serverId
    : !row.generationServerId || !generationServers.value.some(server => server.serverId === row.generationServerId)))
  && [row.name, row.model, row.endpoint, kinds[row.kind]].join(' ').toLowerCase().includes(keyword.value.trim().toLowerCase())))
async function load() {
  if (statusSavingId.value) return
  loading.value = true; error.value = ''
  void loadServers()
  try { settings.value = await runnerManagementApi.modelInterfaces() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { loading.value = false }
}
function edit(row?: ModelInterface) {
  if (statusSavingId.value) return
  Object.assign(form, empty(), row ? { ...row, prjDir: modelWorkspace(row) } : {})
  if (props.embedded && props.server && !row?.id) {
    form.generationServerMode = 'manual'; form.generationServerId = props.server.serverId
    form.prjDir = serverWorkspace(props.server)
    if (!row) {
      try { const address = new URL(form.endpoint); address.hostname = props.server.ipAddress; form.endpoint = address.toString() } catch { /* 地址可在表单中手工配置。 */ }
    }
  }
  formBaseline.value = JSON.stringify(form); error.value = ''; drawer.value = true
}
function duplicate(row: ModelInterface) {
  if (!canWrite.value || statusSavingId.value || saving.value) return
  const names = new Set(settings.value.items.map(item => item.name))
  let index = 1, name = ''
  do {
    const suffix = index === 1 ? ' - 副本' : ` - 副本${index}`
    name = row.name.slice(0, 100 - suffix.length) + suffix; index++
  } while (names.has(name))
  edit({ ...row, id: '', name, isDefault: false })
}
function changeKind() {
  if (form.kind === 'gemini-chat') {
    form.endpoint = 'http://127.0.0.1:6000/gemini/chat'; form.model = 'gemini-3.5-flash-lite'
  } else if (form.kind === 'gemini-agent') {
    form.endpoint = 'http://127.0.0.1:6000/gemini/agent'; form.model = ''; form.title ||= '代码优化测试'
  } else if (form.kind !== 'site-script') {
    form.endpoint = `http://192.168.1.171:6000/${form.kind === 'agent' ? 'wb' : 'workbuudy'}/${form.kind}`
    form.model ||= 'hy3'
  } else {
    form.endpoint = 'http://127.0.0.1:8091/api/ai/site-script/generate'
    form.model = ''
  }
  if (props.embedded && formServer.value?.ipAddress) {
    try { const address = new URL(form.endpoint); address.hostname = formServer.value.ipAddress; form.endpoint = address.toString() } catch { /* 保留表单校验。 */ }
  }
}
async function save() {
  if (!form.name.trim() || !form.endpoint.trim() || (needsModel(form.kind) && !form.model.trim())) {
    error.value = '请填写接口名称、地址和模型标识'; return
  }
  if (form.isDefault && !form.enabled) { error.value = '默认接口必须启用'; return }
  if (isAgent(form.kind) && !form.prjDir?.trim()) { error.value = '请填写 Agent 工作空间'; return }
  saving.value = true; error.value = ''
  const item = { ...form }, items = settings.value.items.map(row => ({ ...row }))
  const index = items.findIndex(row => row.id === item.id)
  if (item.isDefault) items.forEach(row => { row.isDefault = false })
  if (index < 0) items.push(item); else items[index] = item
  try {
    settings.value = await runnerManagementApi.saveModelInterfaces({ items, revision: settings.value.revision })
    emit('changed')
    drawer.value = false; ElMessage.success('大模型接口已保存')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { saving.value = false }
}
onMounted(load)
async function beforeLeave(): Promise<boolean> {
  if (saving.value || statusSavingId.value || testing.value || promptSaving.value) { ElMessage.warning('请先完成接口保存或停止测试，再切换服务器'); return false }
  if (testOpen.value && !await saveTestPrompts()) return false
  if (drawer.value && canWrite.value && JSON.stringify(form) !== formBaseline.value) {
    try { await ElMessageBox.confirm('模型接口有未保存的修改，放弃修改并切换？', '未保存的接口配置', { type: 'warning', confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }) }
    catch { return false }
  }
  drawer.value = false; testOpen.value = false
  return true
}
defineExpose({ beforeLeave })
</script>

<template>
  <section class="mi-page" :class="{ 'mi-embedded': embedded }" v-loading="loading">
    <div v-if="embedded" class="mi-server-context"><b>{{ server ? `${server.name} · ${server.ipAddress}` : '大模型接口' }}</b><span v-if="server" :title="serverWorkspace(server)">工作空间：{{ serverWorkspace(server) }}</span></div>
    <div class="mi-toolbar"><el-select v-if="embedded" v-model="scope" aria-label="模型接口范围" class="mi-scope" data-testid="model-scope"><el-option v-if="server" value="server" label="当前服务器" /><el-option value="all" label="全部接口" /><el-option value="unassigned" label="未关联接口" /></el-select><el-input v-model="keyword" placeholder="搜索名称、模型或接口地址" clearable class="mi-search" /><el-button v-if="canWrite" type="primary" :disabled="loading" data-testid="model-add" @click="edit()">新增接口</el-button><el-button :disabled="loading" @click="load">刷新</el-button></div>
    <p v-if="error && !drawer" class="mi-error" role="alert">{{ error }}</p>
    <el-table :data="rows" class="mi-table" empty-text="暂无匹配的模型接口">
      <el-table-column label="名称" :min-width="embedded ? 130 : 160"><template #default="{ row }"><el-button link type="primary" @click="edit(row)">{{ row.name }}</el-button><el-tag v-if="row.isDefault" size="small">默认</el-tag><small v-if="embedded" class="mi-row-model">{{ kinds[row.kind as keyof typeof kinds] }} · {{ row.model || '服务端配置' }}</small></template></el-table-column>
      <el-table-column v-if="!embedded" label="类型" width="150"><template #default="{ row }">{{ kinds[row.kind as keyof typeof kinds] }}</template></el-table-column>
      <el-table-column v-if="!embedded" prop="model" label="模型" width="110"><template #default="{ row }">{{ row.model || '服务端配置' }}</template></el-table-column>
      <el-table-column label="接口地址 / 生成机器" :min-width="embedded ? 170 : 240"><template #default="{row}"><div class="mi-endpoint" :title="row.endpoint">{{ row.endpoint }}</div><small>{{ generationServerText(row) }}</small></template></el-table-column>
      <el-table-column label="状态" :width="embedded ? 95 : 125"><template #default="{ row }"><div class="mi-status"><el-switch :model-value="row.enabled" :loading="statusSavingId === row.id" :disabled="!canWrite || loading || !!statusSavingId || saving || promptSaving || testing" :before-change="() => toggleEnabled(row)" :aria-label="`${row.name}启用状态`" :data-testid="`model-toggle-${row.id}`" /><span>{{ row.enabled ? '启用' : '停用' }}</span></div></template></el-table-column>
      <el-table-column label="操作" :width="embedded ? 180 : 280"><template #default="{ row }"><div class="mi-actions"><el-button link type="primary" @click="copySample(row)">{{ row.kind === 'chat' ? '复制地址' : '复制请求' }}</el-button><el-button link type="primary" :disabled="testing" @click="openTest(row)">测试</el-button><el-button v-if="canWrite" link type="primary" :disabled="!!statusSavingId || saving" :data-testid="`model-duplicate-${row.id}`" @click="duplicate(row)">复制配置</el-button><el-button link type="primary" @click="edit(row)">{{ canWrite ? '编辑' : '查看' }}</el-button></div></template></el-table-column>
    </el-table>
    <el-drawer v-model="drawer" :title="form.id ? '模型接口配置' : '新增模型接口'" size="min(620px, 94vw)" :close-on-click-modal="false">
      <el-form label-position="top" :disabled="saving || !canWrite" class="mi-form">
        <el-form-item label="接口名称" required><el-input v-model="form.name" maxlength="100" data-testid="model-name" /></el-form-item>
        <el-form-item label="代码生成服务器"><el-select v-model="generationServerChoice" data-testid="model-generation-server"><el-option value="@auto" label="按接口地址自动匹配" /><el-option value="@direct" label="直接连接模型接口" /><el-option v-for="server in generationServers" :key="server.serverId" :value="server.serverId" :label="`${server.name} · ${server.ipAddress} · ${server.status === 'online' ? '在线' : '离线'}`" /></el-select><span v-if="serverLoadError" class="mi-error">{{ serverLoadError }}</span></el-form-item>
        <div class="mi-pair"><el-form-item label="接口类型"><el-select v-model="form.kind" @change="changeKind"><el-option v-for="(label, key) in kinds" :key="key" :value="key" :label="label" /></el-select></el-form-item><el-form-item label="模型标识" :required="needsModel(form.kind)"><el-input v-model="form.model" :disabled="!needsModel(form.kind)" :placeholder="needsModel(form.kind) ? '例如 hy3' : '由服务端配置'" /></el-form-item></div>
        <el-form-item label="接口地址" required><el-input v-model="form.endpoint" placeholder="http://主机:端口/workbuudy/chat" /></el-form-item>
        <el-form-item v-if="form.kind === 'gemini-agent'" label="任务标题（title）"><el-input v-model="form.title" maxlength="200" placeholder="代码优化测试" /></el-form-item>
        <template v-if="isAgent(form.kind)">
          <p class="mi-note">以下路径均为大模型服务所在机器的目录。</p>
          <el-form-item :label="embedded && formServer ? '工作空间（来自服务器）' : '工作空间（prj_dir）'" required><el-input v-model="form.prjDir" :readonly="embedded && !!formServer" placeholder="D:\aicode" data-testid="model-prj-dir" /></el-form-item>
          <el-form-item label="输入目录（自动生成）"><el-input :model-value="formDirectories.inputFileDir" readonly /></el-form-item>
          <el-form-item label="代码目录（自动生成）"><el-input :model-value="formDirectories.codeDir" readonly /></el-form-item>
          <el-form-item label="输出目录（自动生成）"><el-input :model-value="formDirectories.outputFileDir" readonly /></el-form-item>
          <p class="mi-note">接口测试的输入、代码和输出目录位于工作空间下。节点生成的工作目录由代码生成服务器设置统一管理。</p>
        </template>
        <el-form-item label="超时（秒）"><el-input-number v-model="form.timeoutSeconds" :min="10" :max="1800" :step="10" /></el-form-item>
        <el-form-item v-if="form.kind === 'agent'" label="浏览器调试端口（cdp_port）"><el-input-number v-model="form.cdpPort" :min="1" :max="65535" :precision="0" controls-position="right" data-testid="model-cdp-port" /></el-form-item>
        <div class="mi-switches"><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" /><el-switch v-model="form.isDefault" active-text="默认接口" /><el-switch v-if="form.kind === 'chat'" v-model="form.stream" active-text="流式响应" /></div>
      </el-form>
      <p v-if="error" class="mi-error" role="alert">{{ error }}</p>
      <template #footer><el-button :disabled="saving" @click="drawer = false">关闭</el-button><el-button v-if="canWrite" type="primary" :loading="saving" data-testid="model-save" @click="save">保存</el-button></template>
    </el-drawer>
    <el-dialog v-model="testOpen" :title="`测试接口 · ${testForm.name}`" width="min(1160px, 96vw)" top="4vh" :close-on-click-modal="false" :close-on-press-escape="!testing" :show-close="!testing" :before-close="closeTest" class="mi-test-dialog" data-testid="model-test-dialog">
      <div class="mi-test-body">
        <div class="mi-test-params">
        <el-form label-position="top" :disabled="testing" class="mi-form">
          <el-form-item label="接口地址"><el-input :model-value="testForm.endpoint" readonly /></el-form-item>
          <el-form-item v-if="testForm.generationServerId" label="代码生成服务器"><span>{{ generationServers.find(server => server.serverId === testForm.generationServerId)?.name || testForm.generationServerId }}</span></el-form-item>
          <div class="mi-pair"><el-form-item label="模型标识"><el-input v-model="testForm.model" :disabled="!needsModel(testForm.kind)" :placeholder="needsModel(testForm.kind) ? '例如 hy3' : '由服务端配置'" data-testid="model-test-model" /></el-form-item><el-form-item label="超时"><span>{{ testForm.timeoutSeconds }} 秒</span></el-form-item></div>
          <el-form-item v-if="testForm.kind === 'gemini-agent'" label="任务标题（title）"><el-input v-model="testForm.title" maxlength="200" data-testid="model-test-title" /></el-form-item>
          <template v-if="isAgent(testForm.kind)">
            <el-form-item label="工作空间（prj_dir）" required><el-input v-model="testForm.prjDir" data-testid="model-test-prj-dir" /></el-form-item>
            <el-form-item label="输入目录（自动生成）"><el-input :model-value="testDirectories.inputFileDir" readonly /></el-form-item>
            <div class="mi-pair"><el-form-item label="代码目录（自动生成）"><el-input :model-value="testDirectories.codeDir" readonly /></el-form-item><el-form-item label="输出目录（自动生成）"><el-input :model-value="testDirectories.outputFileDir" readonly /></el-form-item></div>
            <p class="mi-note">目录位于模型服务器；发送测试可能在这些目录生成文件。</p>
          </template>
          <el-form-item v-if="testForm.kind === 'chat'" label="响应方式"><el-switch v-model="testForm.stream" active-text="流式响应" /></el-form-item>
          <el-form-item v-if="testForm.kind === 'agent'" label="浏览器调试端口（cdp_port）"><el-input-number v-model="testForm.cdpPort" :min="1" :max="65535" :precision="0" controls-position="right" data-testid="model-test-cdp-port" /></el-form-item>
          <el-form-item v-if="testForm.kind === 'site-script'" label="目标网站 URL"><el-input v-model="testUrl" /></el-form-item>
          <div class="mi-prompt-toolbar"><b>提示词</b><span class="mi-prompt-state" :class="{ dirty: promptsDirty }" data-testid="model-prompt-save-state">{{ promptSaveError ? '保存失败' : promptSaving ? '保存中…' : promptsDirty && canWrite ? '等待自动保存…' : testForm.testUserPrompt !== undefined ? '已保存' : '默认内容' }}</span></div>
          <p v-if="promptSaveError" class="mi-error" role="alert">自动保存失败：{{ promptSaveError }}。内容已保留，请继续编辑后重试。</p>
          <el-form-item label="系统提示词"><el-input v-model="testSystemPrompt" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" maxlength="12000" placeholder="定义模型角色、执行规则和输出要求" data-testid="model-test-system-prompt" /></el-form-item>
          <p v-if="testForm.kind !== 'site-script'" class="mi-note">此接口使用 prompt 参数，系统提示词会与用户提示词组合后发送。</p>
          <el-form-item label="用户提示词"><el-input v-model="samplePrompt" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" maxlength="12000" data-testid="model-sample-prompt" /></el-form-item>
        </el-form>
        <section class="mi-preview" aria-label="样例 HTTP 请求">
          <div class="mi-preview-head"><b>{{ testForm.kind === 'chat' ? '最终请求地址' : '最终 HTTP 请求' }}</b><el-button link type="primary" :disabled="!sampleRequest" data-testid="model-copy-request" @click="copyToClipboard(sampleRequest, testForm.kind === 'chat' ? '请求地址' : 'HTTP 请求')">{{ testForm.kind === 'chat' ? '复制地址' : '复制请求' }}</el-button></div>
          <pre v-if="sampleRequest" class="mi-request" data-testid="model-sample-request">{{ sampleRequest }}</pre>
        </section>
        <p class="mi-note">提示词停止输入后自动保存；其他测试参数仅本次生效。</p>
        </div>
        <section class="mi-test-output" aria-label="输出结果">
          <div class="mi-preview-head"><b>输出结果</b><el-button link :disabled="!testResult?.responseText" @click="copyToClipboard(displayedOutput, '响应内容')">复制结果</el-button></div>
          <p v-if="testResult" class="mi-output-status" :class="{ 'mi-error': testPhase === '测试失败' }" role="status">{{ testPhase }}<template v-if="testResult.status"> · HTTP {{ testResult.status }}</template> · {{ (testResult.durationMs / 1000).toFixed(1) }} 秒</p>
          <p v-if="testError" class="mi-error" role="alert">{{ testError }}</p>
          <div ref="testBody" class="mi-output-scroll"><MarkdownOutput v-if="testResult" :content="displayedOutput || (testing ? '等待模型输出…' : '（响应为空）')" data-testid="model-test-response" aria-live="polite" /><div v-else class="mi-output-empty">点击“发送测试”，在这里实时查看输出</div></div>
        </section>
      </div>
      <template #footer><span v-if="testing" class="mi-note">{{ testPhase }}</span><el-button v-if="testing" data-testid="model-stop-test" @click="stopTest">停止等待</el-button><el-button :disabled="testing" @click="closeTest()">关闭</el-button><el-button v-if="canWrite" type="primary" :loading="testing" :disabled="promptSaving || !sampleRequest || !testForm.enabled" data-testid="model-send-test" @click="runTest">发送测试</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.mi-endpoint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mi-page { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.mi-toolbar { display: flex; align-items: center; gap: 10px; }.mi-search { max-width: 340px; }
.mi-scope { width:130px; flex-shrink:0; }.mi-embedded .mi-toolbar { flex-wrap:wrap; gap:8px; }.mi-embedded .mi-search { flex:1; min-width:150px; max-width:none; }.mi-embedded .mi-actions { flex-wrap:wrap; gap:4px 10px; white-space:normal; }.mi-server-context { display:flex; gap:8px 16px; align-items:center; flex-wrap:wrap; font-size:13px; }.mi-server-context span,.mi-row-model { font-size:11px; color:var(--el-text-color-secondary); overflow-wrap:anywhere; }.mi-row-model { display:block; }.mi-embedded { min-width:0; }
.mi-error { color: var(--el-color-danger); margin: 0; }.mi-note { color: var(--el-text-color-secondary); font-size: 12px; }
.mi-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }.mi-switches { display: flex; flex-wrap: wrap; gap: 20px; }
.mi-form :deep(.el-select) { width: 100%; }.mi-table :deep(.el-tag) { margin-left: 8px; }
.mi-preview { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--el-border-color-light); }
.mi-preview-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.mi-sample-label { display: block; font-size: 13px; margin-bottom: 8px; }
.mi-request { margin: 0; padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color-light); font: 12px/1.65 monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.mi-actions { display: flex; align-items: center; gap: 10px; white-space: nowrap; }.mi-actions :deep(.el-button + .el-button) { margin-left: 0; }
.mi-status { display: flex; align-items: center; gap: 8px; font-size: 12px; white-space: nowrap; }
.mi-prompt-toolbar { display: flex; align-items: center; gap: 10px; margin: 16px 0 12px; }.mi-prompt-toolbar :deep(.el-button) { margin-left: auto; }.mi-prompt-state { font-size: 12px; color: var(--el-text-color-secondary); }.mi-prompt-state.dirty { color: var(--el-color-warning); }
.mi-test-body { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr); gap: 20px; height: min(680px, calc(92vh - 145px)); min-height: 0; }
.mi-test-params { min-height: 0; overflow-y: auto; padding-right: 8px; }
.mi-test-output { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
.mi-test-output .mi-preview-head { margin-bottom: 0; }.mi-output-status { font-size: 12px; color: var(--el-text-color-secondary); margin: 0; }
.mi-output-scroll { flex: 1; min-height: 0; overflow-y: auto; border: 1px solid var(--el-border-color-light); border-radius: 6px; background: var(--el-fill-color-light); }
.mi-output-scroll .mi-request { border: 0; background: transparent; }.mi-output-empty { display: grid; place-items: center; min-height: 100%; padding: 20px; box-sizing: border-box; color: var(--el-text-color-secondary); font-size: 13px; text-align: center; }
@media (max-width: 600px) { .mi-pair { grid-template-columns: 1fr; gap: 0; } }
</style>
