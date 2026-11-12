<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api, type CodeGenerationServer, type CodeServerRelease, type RemoteCodeFile, type CodeRepository, type CodeRepositoryDirectory, type GenerationGitBinding } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'
import { matchingGenerationGitBinding } from '@/utils/generationWorkspace'
import ModelInterfacesTab from './ModelInterfacesTab.vue'

const canWrite = computed(() => useAuthStore().role === 'admin')
const router = useRouter()
const route = useRoute()
const requestedTarget = computed(() => route.path === '/settings' && route.query.tab === 'code-servers' && typeof route.query.serverId === 'string'
  ? { id: route.query.serverId, folder: typeof route.query.serverFolder === 'string' ? route.query.serverFolder : '',
    view: route.query.view === 'models' ? 'models' as const : typeof route.query.serverFolder === 'string' || route.query.view === 'files' ? 'files' as const : 'models' as const,
    key: JSON.stringify([route.query.serverId, route.query.serverFolder, route.query.view]) } : null)
let linkedTargetKey = ''
const detailView = ref<'models' | 'files'>(route.query.view === 'files' || typeof route.query.serverFolder === 'string' ? 'files' : 'models')
const modelPanel = ref<InstanceType<typeof ModelInterfacesTab>>()
const navigating = ref(false)
async function beforeServerNavigation() {
  if (navigating.value) return false
  navigating.value = true
  try { return (await modelPanel.value?.beforeLeave()) !== false }
  finally { navigating.value = false }
}
async function selectDetailView(view: 'models' | 'files') {
  if (view === detailView.value || busy.value || !await beforeServerNavigation()) return
  detailView.value = view
  if (view === 'files' && selected.value?.status === 'online') await browse()
}
watch(() => route.path === '/settings' && route.query.tab === 'code-servers' && !route.query.serverId ? route.query.view : undefined, view => {
  if (view === 'models' || view === 'files') void selectDetailView(view)
})
const servers = ref<CodeGenerationServer[]>([]), selectedId = ref(''), keyword = ref(''), error = ref('')
const releases = ref<CodeServerRelease[]>([])
const latestRelease = computed(() => releases.value[0])
const upgradeLabels = { pending: '等待检查', waiting: '等待空闲', upgrading: '升级中', succeeded: '升级成功', failed: '升级失败，可重试' }
function canUpgrade(row: CodeGenerationServer) {
  return !!latestRelease.value && !['pending', 'waiting', 'upgrading'].includes(row.upgrade?.status || '')
    && (row.actualDigest !== latestRelease.value.digest || row.upgrade?.status === 'failed')
}
const loading = ref(false), busy = ref(false), folder = ref(''), files = ref<RemoteCodeFile[]>([]), selection = ref<RemoteCodeFile[]>([])
const selected = computed(() => servers.value.find(row => row.serverId === selectedId.value))
const workspaceEditingId = ref(''), workspaceDraft = ref('')
function editWorkspace(row: CodeGenerationServer) {
  workspaceEditingId.value = row.serverId
  workspaceDraft.value = row.generationRoot || row.workspace
}
async function saveWorkspace(row: CodeGenerationServer) {
  if (!canWrite.value) return
  const id = row.serverId, draft = workspaceDraft.value.trim()
  const value = draft === row.workspace ? '' : draft
  await run(async () => {
    const result = await api.saveCodeServerGenerationDirectory(id, value)
    servers.value = servers.value.map(item => item.serverId === id ? { ...item, ...result } : item)
    workspaceEditingId.value = ''
    ElMessage.success('工作空间已保存，下次生成时生效')
  })
}
const rows = computed(() => servers.value.filter(row => [row.name, row.ipAddress, row.serverId, row.workspace, row.generationRoot].join(' ').toLowerCase().includes(keyword.value.toLowerCase())))
watch([rows, busy], () => {
  if (!busy.value && requestedTarget.value && linkedTargetKey !== requestedTarget.value.key) { void openLinkedTarget(); return }
  if (busy.value || rows.value.some(row => row.serverId === selectedId.value)) return
  if (rows.value[0]) void choose(rows.value[0])
  else { selectedId.value = ''; files.value = []; folder.value = ''; selection.value = []; bindingOpen.value = false; ++fileSequence }
})
const crumbs = computed(() => folder.value.split('/').filter(Boolean))
let timer: ReturnType<typeof setInterval> | undefined, fileSequence = 0
const detail = ref(false), current = ref<RemoteCodeFile>(), content = ref(''), original = ref('')
const importOpen = ref(false), repositories = ref<CodeRepository[]>([]), directories = ref<CodeRepositoryDirectory[]>([])
const repositoryId = ref(''), directoryId = ref(''), overwrite = ref(false)
const bindingOpen = ref(false), bindingPath = ref(''), bindingRepoId = ref(''), bindingDirectoryId = ref('')
const bindingRepositories = ref<CodeRepository[]>([]), bindingDirectories = ref<CodeRepositoryDirectory[]>([])
const currentGitBinding = computed(() => matchingGenerationGitBinding(selected.value, folder.value))
const bindingRepository = computed(() => bindingRepositories.value.find(row => row.repoId === bindingRepoId.value))
let bindingSequence = 0
async function loadBindingDirectories() {
  const sequence = ++bindingSequence, id = bindingRepoId.value
  bindingDirectories.value = []; bindingDirectoryId.value = ''
  if (!id) return
  try {
    const items = await api.codeRepositoryDirectories(id)
    if (sequence !== bindingSequence) return
    bindingDirectories.value = items.filter(item => item.status === 'ACTIVE')
    bindingDirectoryId.value = bindingDirectories.value[0]?.directoryId || ''
  } catch (e) { if (sequence === bindingSequence) error.value = message(e) }
}
async function editGitBinding(item?: GenerationGitBinding) {
  await run(async () => {
    const existing = item || currentGitBinding.value
    bindingRepositories.value = (await api.codeRepositories()).filter(item => item.status === 'ACTIVE')
    bindingPath.value = item?.path ?? folder.value
    bindingRepoId.value = existing?.repositoryId || bindingRepositories.value.find(item => item.isDefault)?.repoId || bindingRepositories.value[0]?.repoId || ''
    await loadBindingDirectories()
    if (bindingDirectories.value.some(item => item.directoryId === existing?.directoryId)) bindingDirectoryId.value = existing!.directoryId
    bindingOpen.value = true
  })
}
async function saveGitBinding(remove = false, path = currentGitBinding.value?.path || '') {
  if (!selected.value || !canWrite.value) return
  const id = selectedId.value
  await run(async () => {
    const result = await api.saveGenerationGitBinding(id, remove ? { path, repositoryId: '' }
      : { path: bindingPath.value, repositoryId: bindingRepoId.value, directoryId: bindingDirectoryId.value })
    servers.value = servers.value.map(item => item.serverId === id ? { ...item, generationGitBindings: result.items } : item)
    bindingOpen.value = false; ElMessage.success(remove ? '已解除目录 Git 绑定' : '目录 Git 绑定已保存，生成完成后自动提交')
  })
}
const upload = ref<HTMLInputElement>(), uploadFolder = ref<HTMLInputElement>()
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

async function refresh(silent = false) {
  if (!silent) loading.value = true
  try {
    const result = await Promise.all([api.codeGenerationServers(), api.codeServerReleases()])
    servers.value = result[0].items; releases.value = result[1].items
    if (!silent) error.value = ''
    if (requestedTarget.value && linkedTargetKey !== requestedTarget.value.key) await openLinkedTarget()
    else if (!selectedId.value && rows.value[0]) await choose(rows.value[0])
  } catch (e) { error.value = message(e) }
  finally { if (!silent) loading.value = false }
}
function startPolling() { if (!timer) timer = setInterval(() => { void refresh(true) }, 5000) }
function stopPolling() { clearInterval(timer); timer = undefined }
onMounted(() => { void refresh(); startPolling() })
onActivated(startPolling); onDeactivated(stopPolling); onBeforeUnmount(stopPolling)

async function choose(row: CodeGenerationServer) {
  if (busy.value || !await beforeServerNavigation()) return
  if (requestedTarget.value) linkedTargetKey = requestedTarget.value.key
  selectedId.value = row.serverId; files.value = []; folder.value = ''; selection.value = []
  bindingOpen.value = false; ++bindingSequence
  if (detailView.value === 'files' && row.status === 'online') await browse('')
}
async function openLinkedTarget() {
  const target = requestedTarget.value
  if (!target || busy.value || linkedTargetKey === target.key) return
  if (detailView.value === 'models' && !await beforeServerNavigation()) { linkedTargetKey = target.key; return }
  if (detail.value && content.value !== original.value) { error.value = '请先保存或关闭当前文件，再打开任务的生成目录'; return }
  const server = servers.value.find(row => row.serverId === target.id)
  if (!server) { selectedId.value = target.id; error.value = '任务对应的代码生成服务器不存在或已删除'; return }
  linkedTargetKey = target.key
  detailView.value = target.view
  keyword.value = ''; selectedId.value = server.serverId; files.value = []; selection.value = []; detail.value = false
  bindingOpen.value = false; ++bindingSequence; ++fileSequence
  if (target.view === 'models') { error.value = ''; return }
  const raw = target.folder.replaceAll('\\', '/')
  const path = raw.replace(/\/+$/, ''), root = server.workspace.replaceAll('\\', '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:/.test(root) || server.workspace.includes('\\')
  const compare = (value: string) => windows ? value.toLowerCase() : value
  const absolute = /^(?:[A-Za-z]:\/|\/)/.test(raw)
  let relative = path
  if (absolute) {
    if (compare(path) === compare(root)) relative = ''
    else if (compare(path).startsWith(compare(root + '/'))) relative = path.slice(root.length + 1)
    else { error.value = '任务记录的生成路径不在该服务器当前工作空间内，请核对服务器工作空间设置'; return }
  }
  if (relative && relative.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    error.value = '任务记录的生成目录无效'; return
  }
  folder.value = relative
  if (server.status !== 'online') { error.value = '任务对应的代码生成服务器当前离线，恢复在线后可刷新目录'; return }
  await browse(relative)
}
watch(requestedTarget, () => {
  linkedTargetKey = ''
  if (requestedTarget.value && servers.value.length && !busy.value) void openLinkedTarget()
})
async function browse(path = folder.value) {
  const id = selectedId.value, sequence = ++fileSequence
  busy.value = true; error.value = ''; selection.value = []
  try {
    const result = await api.remoteCodeFiles(id, { action: 'list', path })
    if (sequence !== fileSequence || id !== selectedId.value) return
    files.value = result.items; folder.value = path
  } catch (e) { if (sequence === fileSequence) { files.value = []; error.value = message(e) } }
  finally { if (sequence === fileSequence) busy.value = false }
}
async function run(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await work() } catch (e) { if (e !== 'cancel' && e !== 'close') error.value = message(e) }
  finally { busy.value = false }
}
async function openFile(row: RemoteCodeFile) {
  if (row.isDirectory) return browse(row.path)
  await run(async () => {
    current.value = await api.remoteCodeFiles<RemoteCodeFile>(selectedId.value, { action: 'read', path: row.path })
    content.value = current.value.content || ''; original.value = content.value; detail.value = true
  })
}
async function saveFile() {
  if (!current.value) return
  await run(async () => {
    current.value = await api.remoteCodeFiles<RemoteCodeFile>(selectedId.value, { action: 'write', path: current.value!.path, content: content.value, expectedHash: current.value!.sha256 })
    original.value = content.value; ElMessage.success('文件已保存到生成服务器')
  })
}
async function closeDetail(done: () => void) {
  if (content.value !== original.value) {
    try { await ElMessageBox.confirm('文件修改尚未保存，确认关闭？', '关闭文件', { type: 'warning' }) } catch { return }
  }
  done()
}
async function create(kind: 'mkdir' | 'write') {
  await run(async () => {
    const result = await ElMessageBox.prompt('请输入名称，也可填写相对目录路径', kind === 'mkdir' ? '新建目录' : '新建文件', { inputValidator: value => !!value?.trim() || '请填写名称' })
    const path = [folder.value, result.value.trim()].filter(Boolean).join('/')
    await api.remoteCodeFiles(selectedId.value, { action: kind, path, ...(kind === 'write' ? { content: '' } : {}) })
    await browse(); ElMessage.success('已创建')
  })
}
async function remove(row: RemoteCodeFile) {
  await run(async () => {
    await ElMessageBox.confirm(`确认删除${row.isDirectory ? '目录' : '文件'} ${row.path}？`, '删除', { type: 'warning' })
    await api.remoteCodeFiles(selectedId.value, { action: 'delete', path: row.path, expectedHash: row.sha256 })
    await browse()
  })
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function download() {
  await run(async () => {
    const result = await api.remoteCodeFiles<{ name: string; data: string }>(selectedId.value, { action: 'download', paths: selection.value.map(x => x.path) })
    const bytes = Uint8Array.from(atob(result.data), char => char.charCodeAt(0))
    saveBlob(new Blob([bytes], { type: 'application/zip' }), result.name)
  })
}
async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement, incoming = [...(input.files || [])]; input.value = ''
  if (!incoming.length) return
  await run(async () => {
    if (incoming.length > 2000 || incoming.some(file => file.size > 5 * 1024 * 1024) || incoming.reduce((size, file) => size + file.size, 0) > 10 * 1024 * 1024) throw new Error('单文件最多 5 MB，单次最多 2000 个文件、合计 10 MB')
    const entries = await Promise.all(incoming.map(async file => {
      const bytes = new Uint8Array(await file.arrayBuffer()); let raw = ''
      for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192))
      return { path: [folder.value, file.webkitRelativePath || file.name].filter(Boolean).join('/'), data: btoa(raw) }
    }))
    await api.remoteCodeFiles(selectedId.value, { action: 'upload', overwrite: false, files: entries })
    await browse(); ElMessage.success('上传完成')
  })
}
async function openImport() {
  await run(async () => {
    repositories.value = await api.codeRepositories()
    repositoryId.value = repositories.value.find(row => row.isDefault)?.repoId || repositories.value[0]?.repoId || ''
    await loadDirectories(); importOpen.value = true; overwrite.value = false
  })
}
async function loadDirectories() {
  directories.value = []; directoryId.value = ''
  if (repositoryId.value) {
    directories.value = await api.codeRepositoryDirectories(repositoryId.value)
    directoryId.value = directories.value.find(row => row.isDefault)?.directoryId || directories.value[0]?.directoryId || ''
  }
}
async function importCode() {
  await run(async () => {
    const result = await api.importRemoteCode(selectedId.value, { repositoryId: repositoryId.value, directoryId: directoryId.value, paths: selection.value.map(row => row.path), overwrite: overwrite.value })
    importOpen.value = false
    ElMessage.success(result.pushed ? `已保存并推送：${result.gitCommit.slice(0, 12)}` : '已保存到仓库，请检查仓库远程推送状态')
  })
}
async function showLogs() {
  await router.push({ path: '/settings', query: { tab: 'runtime-logs', kind: 'code-server', serverId: selectedId.value } })
}
function manageVersions() { void router.push({ path: '/settings', query: { tab: 'releases', program: 'code-server' } }) }
async function copyCode() {
  await run(async () => { const result = await api.codeServerEnrollmentCode(); await copyToClipboard(result.code, '登记码'); ElMessage.info('登记码有效期 24 小时，仅可使用一次') })
}
async function upgradeInstances(instances: CodeGenerationServer[]) {
  if (!latestRelease.value || !instances.length || !canWrite.value) return
  await run(async () => {
    await api.upgradeCodeServers(instances.map(row => row.serverId), latestRelease.value!.digest)
    await refresh(true)
    ElMessage.success('升级指令已下发，实例将在空闲时自动升级')
  })
}
</script>

<template>
  <section class="cg-page" v-loading="loading">
    <div class="cg-toolbar cg-page-actions"><el-button v-if="canWrite" :disabled="busy" data-testid="manage-program-versions" @click="manageVersions">程序版本</el-button><el-button v-if="canWrite" @click="copyCode">获取登记码</el-button><el-button @click="refresh()">刷新</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div class="cg-layout" data-testid="code-server-split-layout">
      <aside class="cg-sidebar" aria-label="代码生成服务器">
        <div class="cg-sidebar-head"><b>服务器</b><span>{{ rows.length }}</span></div>
        <el-input v-model="keyword" placeholder="搜索名称、IP、实例 ID、工作空间" clearable class="cg-search" aria-label="筛选代码生成服务器" />
        <div class="cg-server-list">
          <div v-for="row in rows" :key="row.serverId" class="cg-server-card" :class="{ 'is-selected': selectedId === row.serverId }" role="button" :tabindex="busy ? -1 : 0" :aria-pressed="selectedId === row.serverId" :data-testid="`code-server-${row.serverId}`" @click="choose(row)" @keydown.enter.self="choose(row)" @keydown.space.self.prevent="choose(row)">
            <div class="cg-server-heading"><b :title="row.name">{{ row.name }}</b><el-tag :type="row.status === 'online' ? 'success' : 'info'" size="small">{{ row.status === 'online' ? '在线' : '离线' }}</el-tag></div>
            <div class="cg-server-address">{{ row.ipAddress }}</div>
            <div class="cg-server-id" :title="row.serverId">{{ row.serverId }}</div>
        <div class="cg-workspace-cell" @click.stop>
          <template v-if="workspaceEditingId === row.serverId">
            <el-input v-model="workspaceDraft" size="small" :placeholder="row.workspace" :disabled="busy" clearable aria-label="工作空间" @keydown.enter="saveWorkspace(row)" @keydown.esc="workspaceEditingId = ''" />
            <el-button link type="primary" :disabled="busy" data-testid="save-code-server-workspace" @click="saveWorkspace(row)">保存</el-button>
            <el-button link :disabled="busy" @click="workspaceEditingId = ''">取消</el-button>
          </template>
          <template v-else>
            <span class="cg-workspace-path" :title="row.generationRoot || row.workspace" data-testid="code-server-workspace">{{ row.generationRoot || row.workspace }}</span>
            <el-button v-if="canWrite" link type="primary" :disabled="busy" :data-testid="`edit-code-server-workspace-${row.serverId}`" @click="editWorkspace(row)">设置</el-button>
          </template>
        </div>
          </div>
          <el-empty v-if="!rows.length" :image-size="52" :description="keyword ? '没有匹配的服务器' : '暂无代码生成服务器'" />
        </div>
      </aside>
      <section class="cg-main" aria-label="服务器配置与工作空间" data-testid="code-server-workspace-panel">
        <nav class="cg-detail-tabs" aria-label="服务器配置视图"><button type="button" :class="{active:detailView==='models'}" :disabled="busy || navigating" data-testid="code-server-models-view" @click="selectDetailView('models')">大模型接口</button><button type="button" :class="{active:detailView==='files'}" :disabled="busy || navigating" data-testid="code-server-files-view" @click="selectDetailView('files')">工作空间</button></nav>
        <ModelInterfacesTab v-if="detailView === 'models'" ref="modelPanel" :server="selected" embedded @changed="refresh(true)" />
    <template v-else-if="selected">
      <div class="cg-workspace-head"><b :title="`${selected.name} · ${selected.workspace}`">{{ selected.name }} · {{ selected.workspace }}</b><el-button link :disabled="busy" @click="showLogs">服务日志</el-button></div>
      <div class="cg-server-summary">
        <span>{{ selected.ipAddress }}</span><span :title="selected.osVersion">{{ selected.osType }} · {{ selected.version }}</span>
        <span v-if="selected.runUser">运行账户 {{ selected.runUser }}</span>
        <span>心跳 {{ new Date(selected.lastHeartbeat).toLocaleString('zh-CN', { hour12: false }) }}</span>
        <el-tag v-if="selected.upgrade" :type="selected.upgrade.status === 'failed' ? 'danger' : selected.upgrade.status === 'succeeded' ? 'success' : 'info'" size="small" :title="selected.upgrade.message">{{ upgradeLabels[selected.upgrade.status as keyof typeof upgradeLabels] }}</el-tag>
        <template v-if="canWrite"><el-button v-if="selected.upgradeCapable" link type="primary" :disabled="busy || !canUpgrade(selected)" @click="upgradeInstances([selected])">{{ selected.upgrade?.status === 'failed' ? '重试升级' : '升级到最新' }}</el-button><el-button v-else link type="warning" :disabled="busy" title="此旧版本需要一次性接入，之后支持自动升级" data-testid="code-server-migration-package" @click="manageVersions">下载升级接入包</el-button></template>
      </div>
      <details class="cg-server-details"><summary>服务器信息</summary>
        <dl><div><dt>实例 ID</dt><dd>{{ selected.serverId }}</dd></div><div><dt>实例目录</dt><dd>{{ selected.installDirectory }}</dd></div><div><dt>运行账户</dt><dd>{{ selected.runUser || '未上报' }}</dd></div><div><dt>系统</dt><dd>{{ selected.osVersion || selected.osType }}</dd></div><div><dt>服务地址</dt><dd>{{ selected.endpoint }}</dd></div><div><dt>启动器版本</dt><dd>{{ selected.launcherVersion || '未上报' }}</dd></div><div><dt>服务版本 ID</dt><dd>{{ selected.actualDigest || '历史版本' }}</dd></div></dl>
      </details>
      <div class="cg-server-config">
        <div class="cg-models"><span class="cg-label">关联模型</span><span v-for="model in selected.supportedModels || []" :key="model.id" :title="`${model.endpoint} · ${model.generationServerMode === 'auto' ? '地址匹配' : '手工关联'}`" data-testid="code-server-supported-model">{{ model.name }}{{ model.model ? ` · ${model.model}` : '' }}<small>{{ model.generationServerMode === 'auto' ? '地址匹配' : '手工关联' }}{{ model.enabled ? '' : ' · 已停用' }}</small></span><span v-if="!selected.supportedModels?.length">暂无匹配模型</span></div>
        <div class="cg-queue"><span class="cg-label">任务领取</span><span>按模型自动领取数据库任务</span><small v-if="!selected.mqCapable">更新服务后支持任务领取</small></div>
      </div>
      <el-alert v-if="selected.status !== 'online'" title="服务器离线，暂时无法浏览工作空间" type="info" :closable="false" />
      <div class="cg-toolbar">
        <el-breadcrumb separator="/"><el-breadcrumb-item><a @click="browse('')">工作空间</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part, index) in crumbs" :key="index"><a @click="browse(crumbs.slice(0, index + 1).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
        <div class="cg-file-actions">
          <template v-if="canWrite"><el-button :disabled="busy || selected.status !== 'online'" @click="create('mkdir')">新建目录</el-button><el-button :disabled="busy || selected.status !== 'online'" @click="create('write')">新建文件</el-button>
          <el-dropdown :disabled="busy || selected.status !== 'online'" @command="(command: string) => command === 'folder' ? uploadFolder?.click() : upload?.click()"><el-button :disabled="busy || selected.status !== 'online'">上传 ▾</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="files">上传文件</el-dropdown-item><el-dropdown-item command="folder">上传文件夹</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
          <el-button type="primary" :disabled="busy || !selection.length" @click="openImport">保存到仓库</el-button></template>
          <el-button :disabled="busy || !selection.length" @click="download">下载所选</el-button><el-button :disabled="busy || selected.status !== 'online'" @click="browse()">刷新</el-button>
        </div>
      </div>
      <div class="cg-git-binding" data-testid="generation-git-binding">
        <span>目录 Git 绑定：{{ currentGitBinding ? `${currentGitBinding.repoName || currentGitBinding.repositoryId} / ${currentGitBinding.directoryPath || currentGitBinding.directoryId}` : '按配置类型自动提交，可在节点中自定义仓库目录' }}</span>
        <small v-if="currentGitBinding">{{ currentGitBinding.remoteUrl || '未配置远程地址，仅本地提交' }} · {{ currentGitBinding.branch }} · 绑定目录：{{ currentGitBinding.path || '工作空间根目录' }}</small>
        <span v-if="currentGitBinding?.error" class="cg-binding-error">{{ currentGitBinding.error }}</span>
        <el-button v-if="canWrite" link :disabled="busy" data-testid="edit-generation-git-binding" @click="editGitBinding()">绑定当前目录</el-button>
        <el-button v-if="canWrite && currentGitBinding && currentGitBinding.path === folder" link type="danger" :disabled="busy" @click="saveGitBinding(true)">解除绑定</el-button>
      </div>
      <details v-if="selected.generationGitBindings?.length" class="cg-bindings-list"><summary>已绑定目录（{{ selected.generationGitBindings.length }}）</summary><div v-for="binding in selected.generationGitBindings" :key="binding.path"><code>{{ binding.path || '工作空间根目录' }}</code><span>→ {{ binding.repoName || binding.repositoryId }} / {{ binding.directoryPath || binding.directoryId }}</span><small v-if="binding.error" class="cg-binding-error">{{ binding.error }}</small><template v-if="canWrite"><el-button link :disabled="busy" @click="editGitBinding(binding)">编辑</el-button><el-button link type="danger" :disabled="busy" @click="saveGitBinding(true,binding.path)">解除</el-button></template></div></details>
      <div v-if="bindingOpen" class="cg-git-editor">
        <label>生成目录<el-input v-model="bindingPath" :disabled="busy" placeholder="留空绑定工作空间根目录" aria-label="Git 绑定生成目录" /></label>
        <label>Git 仓库<el-select v-model="bindingRepoId" :disabled="busy" aria-label="绑定 Git 仓库" @change="loadBindingDirectories"><el-option v-for="repo in bindingRepositories" :key="repo.repoId" :label="repo.name" :value="repo.repoId" /></el-select></label>
        <label>仓库内路径<el-select v-model="bindingDirectoryId" :disabled="busy || !bindingDirectories.length" aria-label="绑定仓库内路径"><el-option v-for="directory in bindingDirectories" :key="directory.directoryId" :label="`${directory.name} · ${directory.path}/`" :value="directory.directoryId" /></el-select></label>
        <el-button type="primary" :disabled="busy || !bindingRepoId || !bindingDirectoryId" data-testid="save-generation-git-binding" @click="saveGitBinding()">保存绑定</el-button><el-button :disabled="busy" @click="bindingOpen=false">取消</el-button>
        <small>{{ bindingRepository?.remoteUrl || '请在代码仓库中配置 Git 远程地址' }} · {{ bindingRepository?.branch }}。子目录优先采用最近的目录绑定，生成代码的内部结构会保留。</small>
      </div>
      <el-table v-loading="busy" :data="files" row-key="path" @selection-change="selection = $event" @row-dblclick="openFile" empty-text="当前目录没有文件" class="cg-files">
        <el-table-column type="selection" width="45" /><el-table-column label="文件 / 目录" min-width="200"><template #default="{ row }"><el-button link type="primary" @click="openFile(row)">{{ row.isDirectory ? '📁' : '📄' }} {{ row.name }}</el-button><span v-if="row.accessError" :title="row.accessError" class="cg-binding-error" data-testid="remote-file-access-error"> · 无法读取</span></template></el-table-column>
        <el-table-column label="大小" width="80"><template #default="{ row }">{{ row.isDirectory || row.size == null ? '—' : `${(row.size / 1024).toFixed(1)} KB` }}</template></el-table-column>
        <el-table-column label="修改时间" width="160"><template #default="{ row }">{{ row.modifiedAt ? new Date(row.modifiedAt).toLocaleString('zh-CN', { hour12: false }) : '—' }}</template></el-table-column>
        <el-table-column prop="sha256" label="SHA-256" min-width="100" show-overflow-tooltip /><el-table-column v-if="canWrite" label="操作" width="70"><template #default="{ row }"><el-button link type="danger" :disabled="busy" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </template>
        <el-empty v-else :description="keyword ? '没有匹配的服务器，请调整左侧筛选' : '选择左侧服务器，查看工作空间'" class="cg-workspace-empty" />
      </section>
    </div>
    <input ref="upload" type="file" multiple hidden @change="uploadFiles" /><input ref="uploadFolder" type="file" webkitdirectory multiple hidden @change="uploadFiles" />
    <el-drawer v-model="detail" :title="current?.path" size="min(900px, 94vw)" :before-close="closeDetail" :close-on-click-modal="false"><div class="cg-file-meta">{{ selected?.name }} · SHA-256：{{ current?.sha256 }}</div><el-input v-model="content" type="textarea" :autosize="{ minRows: 20 }" :readonly="!canWrite" spellcheck="false" class="cg-editor" /><template #footer><el-button v-if="canWrite" type="primary" :loading="busy" :disabled="content === original" @click="saveFile">保存文件</el-button></template></el-drawer>
    <el-dialog v-model="importOpen" title="保存到代码仓库" width="min(540px, 94vw)" :close-on-click-modal="false"><el-form label-position="top"><el-form-item label="仓库"><el-select v-model="repositoryId" @change="loadDirectories"><el-option v-for="repo in repositories" :key="repo.repoId" :label="repo.name" :value="repo.repoId" /></el-select></el-form-item><el-form-item label="配置目录"><el-select v-model="directoryId"><el-option v-for="directory in directories" :key="directory.directoryId" :label="`${directory.name} · ${directory.path}`" :value="directory.directoryId" /></el-select></el-form-item><el-form-item label="同名文件"><el-switch v-model="overwrite" active-text="覆盖" inactive-text="不覆盖" /></el-form-item></el-form><p>将所选文件及目录保存到配置目录，保留工作空间相对路径，并按仓库设置自动提交、推送。</p><template #footer><el-button :disabled="busy" @click="importOpen = false">取消</el-button><el-button type="primary" :disabled="!repositoryId || !directoryId" :loading="busy" @click="importCode">保存并提交</el-button></template></el-dialog>

  </section>
</template>

<style scoped>
.cg-page { display:flex; flex-direction:column; gap:12px; min-width:0; min-height:0; flex:1; overflow:hidden; }
.cg-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cg-page-actions { flex-shrink:0; justify-content:flex-end; }
.cg-layout { display:grid; grid-template-columns:300px minmax(0,1fr); gap:12px; flex:1; min-height:0; min-width:0; }
.cg-sidebar { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--el-border-color-lighter); border-radius:6px; min-height:0; min-width:0; overflow:hidden; }
.cg-sidebar-head { display:flex; align-items:center; justify-content:space-between; font-size:13px; }.cg-sidebar-head span { color:var(--el-text-color-secondary); font-size:12px; }
.cg-server-list { overflow-y:auto; min-height:0; flex:1; }.cg-server-card { border:1px solid var(--el-border-color-lighter); border-radius:6px; padding:10px; margin-bottom:8px; cursor:pointer; }.cg-server-card:hover { border-color:var(--el-color-primary-light-5); }.cg-server-card.is-selected { border-color:var(--el-color-primary); background:var(--el-color-primary-light-9); }.cg-server-card:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:-2px; }
.cg-server-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; }.cg-server-heading b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.cg-server-address { margin-top:5px; font-size:12px; }.cg-server-id { margin:4px 0 8px; color:var(--el-text-color-secondary); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cg-search { flex-shrink:0; }.cg-main { display:flex; flex-direction:column; gap:10px; padding:12px; border:1px solid var(--el-border-color-lighter); border-radius:6px; min-height:0; min-width:0; overflow-y:auto; }.cg-main > * { flex-shrink:0; }
.cg-server-summary,.cg-models,.cg-queue { display:flex; align-items:center; flex-wrap:wrap; gap:4px 10px; font-size:12px; color:var(--el-text-color-secondary); }.cg-server-summary .el-button,.cg-queue .el-button { margin-left:0; }.cg-server-config { display:flex; flex-direction:column; gap:6px; }.cg-label { color:var(--el-text-color-regular); }.cg-models small { margin-left:5px; color:var(--el-text-color-secondary); font-size:11px; }
.cg-server-details { font-size:12px; }.cg-server-details summary { color:var(--el-text-color-secondary); cursor:pointer; }.cg-server-details dl { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 16px; margin:10px 0 0; }.cg-server-details dt { color:var(--el-text-color-secondary); }.cg-server-details dd { margin:3px 0 0; overflow-wrap:anywhere; }.cg-workspace-empty { flex:1; }
.cg-workspace-head { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:13px; }
.cg-detail-tabs { display:flex; gap:4px; border-bottom:1px solid var(--el-border-color-light); padding-bottom:6px; }.cg-detail-tabs button { border:0; border-radius:5px; padding:6px 14px; color:var(--el-text-color-secondary); background:transparent; cursor:pointer; font-size:13px; }.cg-detail-tabs button.active { color:var(--el-color-primary); background:var(--el-color-primary-light-9); }.cg-detail-tabs button:disabled { cursor:default; opacity:.6; }
.cg-workspace-head b { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.cg-workspace-head .el-button { flex-shrink:0; }
.cg-workspace-cell { display:flex; align-items:center; gap:6px; min-width:0; }.cg-workspace-cell .el-input { flex:1; min-width:100px; }.cg-workspace-cell .el-button { flex-shrink:0; margin-left:0; }
.cg-workspace-path { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cg-file-actions { display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; }
.cg-file-actions .el-button + .el-button { margin-left:0; }
.cg-files { flex-shrink:0; }
.cg-git-binding { display:flex; gap:6px 12px; align-items:center; flex-wrap:wrap; font-size:12px; }.cg-git-binding small,.cg-git-editor small { color:var(--el-text-color-secondary); overflow-wrap:anywhere; }.cg-binding-error { color:var(--el-color-danger); }
.cg-git-editor { display:flex; align-items:end; gap:8px; flex-wrap:wrap; padding:12px; border:1px solid var(--el-border-color-lighter); border-radius:6px; }.cg-git-editor label { display:flex; flex-direction:column; gap:6px; flex:1; min-width:180px; font-size:12px; }.cg-git-editor small { flex-basis:100%; line-height:1.5; }
.cg-bindings-list { font-size:12px; }.cg-bindings-list summary { cursor:pointer; color:var(--el-text-color-secondary); }.cg-bindings-list > div { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:5px 0; }.cg-bindings-list code { overflow-wrap:anywhere; }
.cg-file-meta { color:var(--el-text-color-secondary); overflow-wrap:anywhere; margin-bottom:12px; font-size:12px; }
.cg-editor :deep(textarea) { font-family:Consolas,monospace; font-size:13px; line-height:1.6; }
a { cursor:pointer; }
@media (max-width:1100px) { .cg-layout { grid-template-columns:260px minmax(0,1fr); gap:10px; }.cg-sidebar,.cg-main { padding:10px; }.cg-file-actions { margin-left:0; } }
@media (max-width:760px) { .cg-page { overflow:auto; }.cg-layout { grid-template-columns:1fr; grid-template-rows:260px minmax(360px,1fr); flex:none; }.cg-main { overflow:visible; }.cg-server-details dl { grid-template-columns:1fr; } }
</style>
