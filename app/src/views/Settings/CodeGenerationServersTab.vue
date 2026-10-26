<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api, type CodeGenerationServer, type RemoteCodeFile, type CodeRepository, type CodeRepositoryDirectory } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'

const canWrite = computed(() => useAuthStore().role === 'admin')
const servers = ref<CodeGenerationServer[]>([]), selectedId = ref(''), keyword = ref(''), error = ref('')
const loading = ref(false), busy = ref(false), folder = ref(''), files = ref<RemoteCodeFile[]>([]), selection = ref<RemoteCodeFile[]>([])
const selected = computed(() => servers.value.find(row => row.serverId === selectedId.value))
const rows = computed(() => servers.value.filter(row => [row.name, row.ipAddress, row.serverId, row.workspace].join(' ').toLowerCase().includes(keyword.value.toLowerCase())))
const crumbs = computed(() => folder.value.split('/').filter(Boolean))
let timer: ReturnType<typeof setInterval> | undefined, fileSequence = 0
const detail = ref(false), current = ref<RemoteCodeFile>(), content = ref(''), original = ref('')
const logsOpen = ref(false), logs = ref('')
const packageOpen = ref(false), platform = ref('')
const importOpen = ref(false), repositories = ref<CodeRepository[]>([]), directories = ref<CodeRepositoryDirectory[]>([])
const repositoryId = ref(''), directoryId = ref(''), overwrite = ref(false)
const upload = ref<HTMLInputElement>(), uploadFolder = ref<HTMLInputElement>()
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

async function refresh(silent = false) {
  if (!silent) loading.value = true
  try {
    servers.value = (await api.codeGenerationServers()).items
    if (!silent) error.value = ''
    if (!selectedId.value && servers.value[0]) await choose(servers.value[0])
  } catch (e) { error.value = message(e) }
  finally { if (!silent) loading.value = false }
}
function startPolling() { if (!timer) timer = setInterval(() => { void refresh(true) }, 5000) }
function stopPolling() { clearInterval(timer); timer = undefined }
onMounted(() => { void refresh(); startPolling() })
onActivated(startPolling); onDeactivated(stopPolling); onBeforeUnmount(stopPolling)

async function choose(row: CodeGenerationServer) {
  if (busy.value) return
  selectedId.value = row.serverId; files.value = []; folder.value = ''; selection.value = []
  if (row.status === 'online') await browse('')
}
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
    await ElMessageBox.confirm(`确认删除 ${row.path}？${row.isDirectory ? '仅可删除空目录。' : ''}`, '删除', { type: 'warning' })
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
  await run(async () => { logs.value = (await api.remoteCodeFiles<{ content: string }>(selectedId.value, { action: 'logs' })).content; logsOpen.value = true })
}
async function downloadPackage() {
  await run(async () => { saveBlob(await api.downloadCodeServerPackage(platform.value.trim()), 'code-generation-server.zip'); packageOpen.value = false })
}
async function openPackage() {
  await run(async () => { platform.value = (await api.codeServerPackageInfo()).platform; packageOpen.value = true })
}
async function copyCode() {
  await run(async () => { const result = await api.codeServerEnrollmentCode(); await copyToClipboard(result.code, '登记码'); ElMessage.info('登记码有效期 24 小时，仅可使用一次') })
}
</script>

<template>
  <section class="cg-page" v-loading="loading">
    <div class="cg-toolbar"><el-input v-model="keyword" placeholder="搜索名称、IP、实例 ID、工作空间" clearable class="cg-search" /><el-button v-if="canWrite" type="primary" :disabled="busy" @click="openPackage">下载服务包</el-button><el-button v-if="canWrite" @click="copyCode">获取登记码</el-button><el-button @click="refresh()">刷新</el-button></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-table :data="rows" highlight-current-row row-key="serverId" :current-row-key="selectedId" @row-click="choose" empty-text="暂无代码生成服务器，下载服务包并在生成机器上启动即可登记">
      <el-table-column prop="name" label="名称" min-width="130" />
      <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.status === 'online' ? 'success' : 'info'" size="small">{{ row.status === 'online' ? '在线' : '离线' }}</el-tag></template></el-table-column>
      <el-table-column prop="ipAddress" label="IP" width="130" />
      <el-table-column prop="serverId" label="实例 ID" min-width="190" show-overflow-tooltip />
      <el-table-column prop="workspace" label="工作空间" min-width="150" show-overflow-tooltip />
      <el-table-column label="系统 / 版本" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.osVersion }} · {{ row.version }}</template></el-table-column>
      <el-table-column label="心跳时间" width="165"><template #default="{ row }">{{ new Date(row.lastHeartbeat).toLocaleString('zh-CN', { hour12: false }) }}</template></el-table-column>
    </el-table>
    <template v-if="selected">
      <div class="cg-workspace-head"><b>{{ selected.name }} · {{ selected.workspace }}</b><el-button link :disabled="selected.status !== 'online' || busy" @click="showLogs">服务日志</el-button></div>
      <div class="cg-toolbar">
        <el-breadcrumb separator="/"><el-breadcrumb-item><a @click="browse('')">工作空间</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part, index) in crumbs" :key="index"><a @click="browse(crumbs.slice(0, index + 1).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
        <div class="cg-file-actions">
          <template v-if="canWrite"><el-button :disabled="busy || selected.status !== 'online'" @click="create('mkdir')">新建目录</el-button><el-button :disabled="busy || selected.status !== 'online'" @click="create('write')">新建文件</el-button>
          <el-dropdown :disabled="busy || selected.status !== 'online'" @command="(command: string) => command === 'folder' ? uploadFolder?.click() : upload?.click()"><el-button :disabled="busy || selected.status !== 'online'">上传 ▾</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="files">上传文件</el-dropdown-item><el-dropdown-item command="folder">上传文件夹</el-dropdown-item></el-dropdown-menu></template></el-dropdown>
          <el-button type="primary" :disabled="busy || !selection.length" @click="openImport">保存到仓库</el-button></template>
          <el-button :disabled="busy || !selection.length" @click="download">下载所选</el-button><el-button :disabled="busy || selected.status !== 'online'" @click="browse()">刷新</el-button>
        </div>
      </div>
      <el-table v-loading="busy" :data="files" row-key="path" @selection-change="selection = $event" @row-dblclick="openFile" empty-text="当前目录没有文件" class="cg-files">
        <el-table-column type="selection" width="45" /><el-table-column label="文件 / 目录" min-width="200"><template #default="{ row }"><el-button link type="primary" @click="openFile(row)">{{ row.isDirectory ? '📁' : '📄' }} {{ row.name }}</el-button></template></el-table-column>
        <el-table-column label="大小" width="100"><template #default="{ row }">{{ row.isDirectory ? '—' : `${(row.size / 1024).toFixed(1)} KB` }}</template></el-table-column>
        <el-table-column label="修改时间" width="175"><template #default="{ row }">{{ new Date(row.modifiedAt).toLocaleString('zh-CN', { hour12: false }) }}</template></el-table-column>
        <el-table-column prop="sha256" label="SHA-256" min-width="180" show-overflow-tooltip /><el-table-column v-if="canWrite" label="操作" width="70"><template #default="{ row }"><el-button link type="danger" :disabled="busy" @click="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
    </template>
    <input ref="upload" type="file" multiple hidden @change="uploadFiles" /><input ref="uploadFolder" type="file" webkitdirectory multiple hidden @change="uploadFiles" />
    <el-drawer v-model="detail" :title="current?.path" size="min(900px, 94vw)" :before-close="closeDetail" :close-on-click-modal="false"><div class="cg-file-meta">{{ selected?.name }} · SHA-256：{{ current?.sha256 }}</div><el-input v-model="content" type="textarea" :autosize="{ minRows: 20 }" :readonly="!canWrite" spellcheck="false" class="cg-editor" /><template #footer><el-button v-if="canWrite" type="primary" :loading="busy" :disabled="content === original" @click="saveFile">保存文件</el-button></template></el-drawer>
    <el-drawer v-model="logsOpen" :title="`${selected?.name} · 服务日志`" size="min(900px, 94vw)"><pre class="cg-logs">{{ logs || '暂无日志' }}</pre></el-drawer>
    <el-dialog v-model="packageOpen" title="下载代码生成服务器" width="min(520px, 94vw)"><el-form label-position="top"><el-form-item label="远程机器可访问的平台管理地址"><el-input v-model="platform" placeholder="http://192.168.1.36:8092" /></el-form-item></el-form><p>解压后可修改 config.json 中的工作空间，运行 start.cmd 或 python start.py。需要 Python 3.10+；登记码有效期 24 小时，每个新实例分别下载或获取登记码。</p><template #footer><el-button @click="packageOpen = false">关闭</el-button><el-button type="primary" :loading="busy" @click="downloadPackage">下载</el-button></template></el-dialog>
    <el-dialog v-model="importOpen" title="保存到代码仓库" width="min(540px, 94vw)" :close-on-click-modal="false"><el-form label-position="top"><el-form-item label="仓库"><el-select v-model="repositoryId" @change="loadDirectories"><el-option v-for="repo in repositories" :key="repo.repoId" :label="repo.name" :value="repo.repoId" /></el-select></el-form-item><el-form-item label="配置目录"><el-select v-model="directoryId"><el-option v-for="directory in directories" :key="directory.directoryId" :label="`${directory.name} · ${directory.path}`" :value="directory.directoryId" /></el-select></el-form-item><el-form-item label="同名文件"><el-switch v-model="overwrite" active-text="覆盖" inactive-text="不覆盖" /></el-form-item></el-form><p>将所选文件及目录保存到配置目录，保留工作空间相对路径，并按仓库设置自动提交、推送。</p><template #footer><el-button :disabled="busy" @click="importOpen = false">取消</el-button><el-button type="primary" :disabled="!repositoryId || !directoryId" :loading="busy" @click="importCode">保存并提交</el-button></template></el-dialog>
  </section>
</template>

<style scoped>
.cg-page { display:flex; flex-direction:column; gap:12px; min-height:0; flex:1; overflow:auto; }
.cg-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cg-search { max-width:340px; }
.cg-workspace-head { display:flex; align-items:center; justify-content:space-between; font-size:13px; }
.cg-workspace-head b { overflow-wrap:anywhere; }
.cg-file-actions { display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; }
.cg-file-actions .el-button + .el-button { margin-left:0; }
.cg-files { flex-shrink:0; }
.cg-file-meta { color:var(--el-text-color-secondary); overflow-wrap:anywhere; margin-bottom:12px; font-size:12px; }
.cg-editor :deep(textarea), .cg-logs { font-family:Consolas,monospace; font-size:13px; line-height:1.6; }
.cg-logs { white-space:pre-wrap; overflow-wrap:anywhere; }
a { cursor:pointer; }
</style>
