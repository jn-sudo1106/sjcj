<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Folder, List } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useDictStore } from '@/stores/dict'
import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type CodeRepositoryFile, type CodeRepositoryInput, type CodeRepositoryVerification } from '@/api/runnerManagement'
import RepositoryDirectoriesPanel from './RepositoryDirectoriesPanel.vue'

const props = defineProps<{ repositoryId?: string }>()

const canWrite = computed(() => useAuthStore().role === 'admin')
const dict = useDictStore()
const repos = ref<CodeRepository[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const busyId = ref('')
const verifyingId = ref('')
const verification = reactive<Record<string, CodeRepositoryVerification>>({})
const uploadOpen = ref(false)
const uploadRepo = ref<CodeRepository | null>(null)
const uploadType = ref<'files' | 'folder'>('files')
const uploadOverwrite = ref(false)
const uploadFiles = ref<File[]>([])
const uploadSkipped = ref(0)
const uploading = ref(false)
const uploadError = ref('')
const selectedRepoId = ref('')
const filesRepo = computed(() => repos.value.find((repo) => repo.repoId === selectedRepoId.value) ?? null)
const selectedDirectory = ref<CodeRepositoryDirectory | null>(null)
const repositoryDirectories = ref<CodeRepositoryDirectory[]>([])
const fileRows = ref<CodeRepositoryFile[]>([])
const fileView = ref<'directory' | 'paths'>('directory')
const folderPath = ref('')
const folderCrumbs = computed(() => folderPath.value.split('/').filter(Boolean).map((name, index, parts) => ({ name, path: parts.slice(0, index + 1).join('/') })))
const fileKeyword = ref('')
const filePage = ref(1)
const fileTotal = ref(0)
const fileLoading = ref(false)
const fileError = ref('')
let fileRequestId = 0
const deletingPath = ref('')
const previewPath = ref('')
const previewContent = ref('')
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewError = ref('')
let previewRequestId = 0
const uploadNotice = ref('')
const filter = ref('')
const editingId = ref<string | null>(null)
const form = reactive<CodeRepositoryInput>({ name: '', configType: '', configTypeName: '', path: '', remoteUrl: '', branch: 'main' })
const types = computed(() => {
  const known = dict.snatchTypes.flatMap((value) => {
    const match = value.match(/^\[([^\]]+)\]\s*-\s*(.+)$/)
    return match ? [{ code: match[1], name: match[2].trim() }] : []
  })
  const missing = [...new Set(repos.value.map((repo) => repo.configType).filter(Boolean))]
    .filter((code) => !known.some((item) => item.code === code))
    .map((code) => ({ code, name: '字典中已不存在' }))
  return [...known, ...missing]
})
const typeNames = computed(() => new Map(types.value.map((type) => [type.code, type.name])))
const visible = computed(() => {
  const keyword = filter.value.trim().toLowerCase()
  if (!keyword) return repos.value
  return repos.value.filter((repo) => [repo.name, repo.configType, repo.configTypeName, typeNames.value.get(repo.configType) ?? '',
    repo.configType ? '' : '通用', repo.isDefault ? '默认' : '', repo.path, repo.remoteUrl, repo.branch,
    repo.status === 'ACTIVE' ? '启用' : '停用', String(repo.codeCount)]
    .some((value) => value.toLowerCase().includes(keyword)))
})
const message = (e: unknown) => e instanceof Error ? e.message : String(e)

async function load() {
  loading.value = true
  error.value = ''
  for (const repoId of Object.keys(verification)) delete verification[repoId]
  try {
    repos.value = await runnerManagementApi.codeRepositories()
    if (props.repositoryId && repos.value.some(repo => repo.repoId === props.repositoryId) && props.repositoryId !== selectedRepoId.value) await selectRepo(props.repositoryId)
    if (!visible.value.some((repo) => repo.repoId === selectedRepoId.value)) await selectRepo(visible.value[0]?.repoId ?? '')
    else if (selectedRepoId.value) await loadFiles(1)
  }
  catch (e) { error.value = message(e) }
  finally { loading.value = false }
}
function create() {
  editingId.value = 'new'
  Object.assign(form, { name: '', configType: '',
    configTypeName: '', path: '', remoteUrl: '', branch: 'main' })
  formError.value = ''
}
function edit(repo: CodeRepository) {
  selectRepo(repo.repoId)
  editingId.value = repo.repoId
  Object.assign(form, { name: repo.name, configType: repo.configType, configTypeName: repo.configTypeName,
    path: repo.path, remoteUrl: repo.remoteUrl, branch: repo.branch })
  formError.value = ''
}
async function save() {
  const selectedTypeName = typeNames.value.get(form.configType)
  const input = { name: form.name.trim(), configType: form.configType,
    configTypeName: form.configType ? (selectedTypeName && selectedTypeName !== '字典中已不存在' ? selectedTypeName : form.configTypeName || form.configType) : '',
    path: form.path.trim(),
    remoteUrl: form.remoteUrl.trim(), branch: form.branch.trim() }
  if (!input.name || !input.path || !input.branch) { formError.value = '请填写仓库名称、服务器路径和分支'; return }
  saving.value = true
  formError.value = ''
  try {
    const old = repos.value.find((repo) => repo.repoId === editingId.value)
    if (!old) {
      const created = await runnerManagementApi.createCodeRepository(input)
      selectedRepoId.value = created.repoId
    } else {
      if (input.path !== old.path) await runnerManagementApi.moveCodeRepository(old.repoId, input.path)
      const changes: Partial<Omit<CodeRepositoryInput, 'path'>> = {}
      for (const field of ['name', 'configType', 'configTypeName', 'remoteUrl', 'branch'] as const) {
        if (input[field] !== old[field]) changes[field] = input[field]
      }
      if (changes.configTypeName !== undefined) changes.configType = input.configType
      if (Object.keys(changes).length) await runnerManagementApi.updateCodeRepository(old.repoId, changes)
    }
    editingId.value = null
    ElMessage.success('代码仓库已保存')
    await load()
  } catch (e) {
    formError.value = message(e)
    if (editingId.value !== 'new') await load()
  } finally { saving.value = false }
}
async function status(repo: CodeRepository, enabled: boolean) {
  busyId.value = repo.repoId
  try { await runnerManagementApi.updateCodeRepository(repo.repoId, { status: enabled ? 'ACTIVE' : 'DISABLED' }); await load() }
  catch (e) { ElMessage.error(message(e)) }
  finally { busyId.value = '' }
}
async function makeDefault(repo: CodeRepository) {
  busyId.value = repo.repoId
  try { await runnerManagementApi.setDefaultCodeRepository(repo.repoId); await load() }
  catch (e) { ElMessage.error(message(e)) }
  finally { busyId.value = '' }
}
async function verify(repo: CodeRepository) {
  verifyingId.value = repo.repoId
  try { verification[repo.repoId] = await runnerManagementApi.verifyCodeRepository(repo.repoId) }
  catch (e) {
    verification[repo.repoId] = { repoId: repo.repoId, status: 'error', checkedAt: new Date().toISOString(),
      checks: [{ name: 'service', status: 'error', message: message(e) }] }
  } finally { verifyingId.value = '' }
}
function openUpload(repo: CodeRepository, type: 'files' | 'folder' = 'files') {
  uploadRepo.value = repo
  uploadType.value = type
  uploadOverwrite.value = false
  uploadFiles.value = []
  uploadSkipped.value = 0
  uploadError.value = ''
  uploadOpen.value = true
}
function selectUploadFiles(event: Event) {
  const selected = Array.from((event.target as HTMLInputElement).files ?? [])
  uploadFiles.value = selected.filter(file => uploadType.value !== 'folder' || !(file.webkitRelativePath || '').split('/').some(part => part.toLowerCase() === '.git'))
  uploadSkipped.value = selected.length - uploadFiles.value.length
  uploadError.value = ''
}
function uploadPath(file: File) {
  return uploadType.value === 'folder' ? file.webkitRelativePath || file.name : file.name
}
function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.includes(',')) reject(new Error(`读取 ${file.name} 失败`))
      else resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}
async function submitUpload() {
  const repo = uploadRepo.value
  if (!repo || !uploadFiles.value.length) { uploadError.value = uploadType.value === 'folder' ? '请选择包含文件的文件夹' : '请选择要上传的文件'; return }
  if (uploadType.value === 'folder' && uploadFiles.value.some(file => !file.webkitRelativePath?.includes('/'))) {
    uploadError.value = '未读取到文件夹路径，请重新选择文件夹'
    return
  }
  const maxFiles = uploadType.value === 'folder' ? 2000 : 20
  if (uploadFiles.value.length > maxFiles || uploadFiles.value.some((file) => file.size > 5 * 1024 * 1024)
      || uploadFiles.value.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) {
    uploadError.value = `最多 ${maxFiles} 个文件，单文件不超过 5 MB，总量不超过 10 MB`
    return
  }
  uploading.value = true
  uploadError.value = ''
  try {
    const files = await Promise.all(uploadFiles.value.map(async (file) => ({ name: file.name, data: await encodeFile(file),
      ...(uploadType.value === 'folder' ? { relativePath: file.webkitRelativePath } : {}),
    })))
    const result = await runnerManagementApi.uploadCodeRepositoryFiles(repo.repoId, {
      overwrite: uploadOverwrite.value, files, ...(selectedDirectory.value ? { directoryId: selectedDirectory.value.directoryId } : {}),
      ...(uploadType.value === 'folder' ? { uploadType: 'folder' as const } : {}),
    })
    uploadOpen.value = false
    uploadNotice.value = result.pushed
      ? `已提交并推送到 origin/${repo.branch} · ${result.gitCommit.slice(0, 10)}`
      : `仅提交到服务器本地仓库 · ${result.gitCommit.slice(0, 10)}。请配置 Git 远程地址以自动推送。`
    ElMessage.success(result.pushed ? '文件已推送到远程仓库' : '文件已提交到本地仓库')
    await load()
  } catch (e) { uploadError.value = message(e) }
  finally { uploading.value = false }
}
async function loadFiles(page = filePage.value) {
  const repo = filesRepo.value
  if (!repo) return
  const requestId = ++fileRequestId
  fileLoading.value = true
  fileError.value = ''
  try {
    const result = await (fileView.value === 'directory'
      ? runnerManagementApi.codeRepositoryFiles(repo.repoId, fileKeyword.value.trim(), page, selectedDirectory.value?.directoryId, folderPath.value)
      : selectedDirectory.value
      ? runnerManagementApi.codeRepositoryFiles(repo.repoId, fileKeyword.value.trim(), page, selectedDirectory.value.directoryId)
      : runnerManagementApi.codeRepositoryFiles(repo.repoId, fileKeyword.value.trim(), page))
    if (requestId !== fileRequestId || selectedRepoId.value !== repo.repoId) return
    fileRows.value = result.items
    fileTotal.value = result.total
    filePage.value = result.page
  } catch (e) { if (requestId === fileRequestId) fileError.value = message(e) }
  finally { if (requestId === fileRequestId) fileLoading.value = false }
}
async function selectRepo(repoId: string) {
  if (selectedRepoId.value === repoId) return
  previewRequestId++
  fileRequestId++
  selectedRepoId.value = repoId
  selectedDirectory.value = null
  repositoryDirectories.value = []
  folderPath.value = ''
  fileRows.value = []
  fileKeyword.value = ''
  filePage.value = 1
  fileTotal.value = 0
  previewPath.value = ''
  previewContent.value = ''
  previewOpen.value = false
  previewError.value = ''
  uploadNotice.value = ''
  if (repoId) await loadFiles(1)
  else fileLoading.value = false
}
watch(filter, () => {
  if (!visible.value.some((repo) => repo.repoId === selectedRepoId.value)) void selectRepo(visible.value[0]?.repoId ?? '')
})
function selectDirectory(row: CodeRepositoryDirectory | null) {
  const changed = selectedDirectory.value?.directoryId !== row?.directoryId
  selectedDirectory.value = row
  if (changed) { fileRequestId++; folderPath.value = ''; fileKeyword.value = ''; fileRows.value = []; fileTotal.value = 0; void loadFiles(1) }
}
function switchFileView(view: 'directory' | 'paths') {
  if (fileView.value === view) return
  fileView.value = view; folderPath.value = ''; fileRows.value = []; fileTotal.value = 0; void loadFiles(1)
}
function openFolder(path: string) {
  if (!selectedDirectory.value) {
    const configured = repositoryDirectories.value.find(directory => directory.path === path)
    if (configured) { selectDirectory(configured); return }
  }
  folderPath.value = path; fileRows.value = []; fileTotal.value = 0; void loadFiles(1)
}
function directoriesLoaded(rows: CodeRepositoryDirectory[]) {
  repositoryDirectories.value = rows
  if (!selectedDirectory.value && folderPath.value) {
    const configured = rows.find(directory => directory.path === folderPath.value)
    if (configured) selectDirectory(configured)
  }
}
function openFileRow(row: CodeRepositoryFile) {
  if (row.kind !== 'directory') { void previewFile(row); return }
  const prefix = selectedDirectory.value ? selectedDirectory.value.path + '/' : ''
  openFolder(row.path.slice(prefix.length))
}
watch(() => props.repositoryId, value => { if (value && repos.value.some(repo => repo.repoId === value)) { filter.value = ''; void selectRepo(value) } })
async function previewFile(row: CodeRepositoryFile) {
  const repo = filesRepo.value
  if (!repo) return
  previewPath.value = row.path
  previewContent.value = ''
  previewError.value = ''
  previewLoading.value = true
  previewOpen.value = true
  const requestId = ++previewRequestId
  try {
    const result = await runnerManagementApi.codeRepositoryFileContent(repo.repoId, row.path)
    if (requestId === previewRequestId && filesRepo.value?.repoId === result.repoId && previewPath.value === result.path) previewContent.value = result.content
  } catch (e) { if (requestId === previewRequestId) previewError.value = message(e) }
  finally { if (requestId === previewRequestId) previewLoading.value = false }
}
async function deleteFile(row: CodeRepositoryFile) {
  const repo = filesRepo.value
  if (!repo || !row.canDelete) return
  try { await ElMessageBox.confirm(`确定从仓库删除「${row.path}」并提交到 Git 吗？`, '删除仓库文件', { type: 'warning' }) }
  catch { return }
  deletingPath.value = row.path
  try {
    await runnerManagementApi.deleteCodeRepositoryFile(repo.repoId, row.path)
    if (previewPath.value === row.path) { previewPath.value = ''; previewContent.value = '' }
    uploadNotice.value = repo.remoteUrl ? `文件已删除并推送到 origin/${repo.branch}` : '文件已从本地仓库删除；尚未配置 Git 远程地址'
    ElMessage.success('文件已从仓库删除并提交')
    const nextPage = fileRows.value.length === 1 && filePage.value > 1 ? filePage.value - 1 : filePage.value
    await loadFiles(nextPage)
  } catch (e) { ElMessage.error(message(e)) }
  finally { deletingPath.value = '' }
}
onMounted(() => { void load() })
</script>

<template>
  <div class="rc-card crp-main" data-testid="settings-code-repos">
    <div class="crp-head">
      <b>仓库配置</b>
      <el-input v-model="filter" clearable placeholder="搜索名称、配置类型、路径、Git 地址、分支或状态" class="crp-filter" data-testid="code-repo-query" />
      <span class="crp-count">共 {{ visible.length }} 个仓库</span>
      <span class="crp-head-spacer" />
      <el-button :loading="loading" data-testid="code-repo-refresh" @click="load">刷新</el-button>
      <el-button v-if="canWrite" type="primary" size="small" data-testid="code-repo-create" @click="create">新建仓库</el-button>
    </div>
    <div v-if="error" class="crp-error" role="alert">代码仓库加载失败：{{ error }}</div>
    <div v-loading="loading" class="rc-table-scroll crp-scroll" data-testid="code-repo-list">
      <table class="rc-data-table crp-table">
        <thead><tr><th>名称</th><th>配置类型</th><th>服务器路径</th><th>Git 地址</th><th>分支</th><th title="已关联流程配置的代码项数量">关联代码数</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="editingId === 'new'" data-testid="code-repo-new-row">
            <td><input v-model="form.name" class="crp-input" placeholder="仓库名称" data-testid="code-repo-name" /></td>
            <td><el-select v-model="form.configType" class="crp-type" data-testid="code-repo-type"><el-option label="通用" value="" /><el-option v-for="type in types" :key="type.code" :label="`[${type.code}] ${type.name}`" :value="type.code" /></el-select></td>
            <td><input v-model="form.path" class="crp-input crp-path" placeholder="服务器绝对路径" data-testid="code-repo-path" /></td>
            <td><input v-model="form.remoteUrl" class="crp-input crp-path" placeholder="Git 地址（可选）" data-testid="code-repo-remote" /></td>
            <td><input v-model="form.branch" class="crp-input crp-branch" data-testid="code-repo-branch" /></td>
            <td>—</td><td>—</td>
            <td><el-button link type="primary" :loading="saving" data-testid="code-repo-submit" @click="save">保存</el-button><el-button link @click="editingId = null">取消</el-button></td>
          </tr>
          <template v-for="repo in visible" :key="repo.repoId">
          <tr :class="{ 'crp-repo-selected': selectedRepoId === repo.repoId }" :data-testid="`code-repo-${repo.repoId}`" @click="editingId !== repo.repoId && selectRepo(repo.repoId)">
            <template v-if="editingId === repo.repoId">
              <td><input v-model="form.name" class="crp-input" data-testid="code-repo-name" /></td>
              <td><el-select v-model="form.configType" class="crp-type" :disabled="repo.isDefault" data-testid="code-repo-type"><el-option label="通用" value="" /><el-option v-for="type in types" :key="type.code" :label="`[${type.code}] ${type.name}`" :value="type.code" /></el-select></td>
              <td><input v-model="form.path" class="crp-input crp-path" data-testid="code-repo-path" /></td>
              <td><input v-model="form.remoteUrl" class="crp-input crp-path" data-testid="code-repo-remote" /></td>
              <td><input v-model="form.branch" class="crp-input crp-branch" data-testid="code-repo-branch" /></td>
              <td>{{ repo.codeCount }}</td><td>—</td>
              <td><el-button link type="primary" :loading="saving" data-testid="code-repo-submit" @click="save">保存</el-button><el-button link @click="editingId = null">取消</el-button></td>
            </template>
            <template v-else>
              <td><button type="button" class="crp-file-link" @click.stop="selectRepo(repo.repoId)">{{ repo.name }}</button><span v-if="repo.isDefault" class="crp-tag">默认</span></td>
              <td>{{ repo.configType ? `[${repo.configType}] ${typeNames.get(repo.configType) ?? ''}` : '通用' }}</td>
              <td class="crp-ellipsis" :title="repo.path">{{ repo.path }}</td>
              <td class="crp-ellipsis" :title="repo.remoteUrl">{{ repo.remoteUrl || '仅本地' }}</td>
              <td>{{ repo.branch }}</td><td>{{ repo.codeCount }}</td>
              <td><span class="crp-status" @click.stop><el-switch size="small" :model-value="repo.status === 'ACTIVE'" :disabled="!canWrite || repo.isDefault || busyId === repo.repoId" @change="(value: string | number | boolean) => status(repo, Boolean(value))" /><span :class="repo.status === 'ACTIVE' ? 'crp-on' : 'crp-off'">{{ repo.status === 'ACTIVE' ? '启用' : '停用' }}</span></span></td>
              <td><el-button v-if="canWrite" link type="primary" :loading="verifyingId === repo.repoId" :disabled="!!verifyingId" :data-testid="`code-repo-verify-${repo.repoId}`" @click.stop="verify(repo)">验证</el-button><el-button v-if="canWrite" link type="primary" @click.stop="edit(repo)">编辑</el-button><el-button v-if="canWrite && !repo.isDefault && !repo.configType && repo.status === 'ACTIVE'" link type="primary" @click.stop="makeDefault(repo)">设为默认</el-button></td>
            </template>
          </tr>
          <tr v-if="verification[repo.repoId]" class="crp-verification" :data-testid="`code-repo-verification-${repo.repoId}`">
            <td colspan="8">
              <b :class="`crp-check-${verification[repo.repoId].status}`">{{ verification[repo.repoId].status === 'ok' ? '验证正常' : verification[repo.repoId].status === 'warning' ? '需注意' : '验证异常' }}</b>
              <span v-for="check in verification[repo.repoId].checks" :key="check.name" :class="`crp-check-${check.status}`">{{ check.message }}</span>
            </td>
          </tr>
          </template>
          <tr v-if="!loading && !visible.length && editingId !== 'new'"><td colspan="8">{{ error ? '服务不可用' : filter.trim() ? '没有匹配的仓库' : '暂无代码仓库' }}</td></tr>
        </tbody>
      </table>
    </div>
    <p v-if="formError" class="crp-error" role="alert">{{ formError }}</p>
    <div v-if="filesRepo" class="crp-workspace" data-testid="code-repo-workspace">
      <div class="crp-code-head" data-testid="code-repo-summary">
        <b>仓库代码</b>
        <div class="crp-repo-meta">
          <b class="crp-repo-name" :title="filesRepo.name">{{ filesRepo.name }}</b>
          <span class="crp-repo-type" :title="filesRepo.configType ? `[${filesRepo.configType}] ${typeNames.get(filesRepo.configType) || filesRepo.configTypeName}` : '通用仓库'">{{ filesRepo.configType ? `[${filesRepo.configType}] ${typeNames.get(filesRepo.configType) || filesRepo.configTypeName}` : '通用仓库' }}</span>
          <span class="crp-repo-path" :title="`服务器目录：${filesRepo.path}`">服务器：{{ filesRepo.path }}</span>
          <span class="crp-repo-push" :class="filesRepo.remoteUrl ? 'crp-on' : 'crp-off'" :title="filesRepo.remoteUrl ? `上传后自动推送到 origin/${filesRepo.branch}` : '仅保存在本地，未配置远程 Git 地址'">{{ filesRepo.remoteUrl ? `自动推送 origin/${filesRepo.branch}` : '仅保存在本地' }}</span>
          <span class="crp-repo-upload" :title="`上传目录：${selectedDirectory?.path || filesRepo.uploadDirectory}/`">上传：{{ selectedDirectory?.path || filesRepo.uploadDirectory }}/</span>
        </div>
        <div class="crp-code-actions">
          <el-button size="small" :loading="fileLoading" data-testid="code-repo-files-refresh" @click="loadFiles(1)">刷新文件</el-button>
          <el-dropdown v-if="canWrite && filesRepo.status === 'ACTIVE'" trigger="click" :disabled="selectedDirectory?.status === 'DISABLED'">
            <el-button type="primary" size="small" :disabled="selectedDirectory?.status === 'DISABLED'" data-testid="code-repo-upload">上传 ▾</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :disabled="selectedDirectory?.status === 'DISABLED'" data-testid="code-repo-upload-selected" @click="openUpload(filesRepo)">上传文件</el-dropdown-item>
                <el-dropdown-item :disabled="selectedDirectory?.status === 'DISABLED'" data-testid="code-repo-upload-folder" @click="openUpload(filesRepo, 'folder')">上传文件夹</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <p v-if="uploadNotice" class="crp-upload-notice" role="status">{{ uploadNotice }}</p>
      <div class="crp-file-layout">
        <RepositoryDirectoriesPanel :repo="filesRepo" :types="types" :selected-id="selectedDirectory?.directoryId || ''" :can-write="canWrite" @select="selectDirectory" @loaded="directoriesLoaded" />
        <div class="crp-files">
          <div class="crp-files-toolbar">
            <b>{{ selectedDirectory?.name || '仓库文件' }}</b>
            <div class="crp-view-switch" role="group" aria-label="仓库文件视图"><button type="button" :aria-pressed="fileView === 'directory'" data-testid="code-repo-directory-view" @click="switchFileView('directory')"><el-icon><Folder /></el-icon>目录</button><button type="button" :aria-pressed="fileView === 'paths'" data-testid="code-repo-paths-view" @click="switchFileView('paths')"><el-icon><List /></el-icon>路径列表</button></div>
            <el-input v-model="fileKeyword" clearable placeholder="按文件路径搜索" class="crp-file-search" data-testid="code-repo-files-keyword" @keyup.enter="loadFiles(1)" />
            <el-button :loading="fileLoading" data-testid="code-repo-files-search" @click="loadFiles(1)">查询</el-button>
          </div>
          <nav v-if="fileView === 'directory'" class="crp-breadcrumb" aria-label="当前仓库目录"><button type="button" @click="openFolder('')">{{ selectedDirectory?.name || '仓库根目录' }}</button><template v-for="crumb in folderCrumbs" :key="crumb.path"><span>/</span><button type="button" @click="openFolder(crumb.path)">{{ crumb.name }}</button></template></nav>
          <p v-if="fileError" class="crp-error" role="alert">{{ fileError }}</p>
          <div class="crp-file-scroll">
            <table class="rc-data-table crp-files-table">
              <thead><tr><th>{{ fileView === 'directory' ? '名称' : '文件路径' }}</th><th>大小</th><th>类型</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="row in fileRows" :key="row.path" class="crp-file-row" :class="{ 'crp-file-selected': previewPath === row.path }" :data-testid="`code-repo-file-${row.path}`" @click="openFileRow(row)">
                  <td class="crp-file-path" :title="row.path"><button type="button" class="crp-file-link" :data-testid="`code-repo-preview-${row.path}`" @click.stop="openFileRow(row)"><el-icon v-if="fileView === 'directory'" :class="{ 'crp-folder-icon': row.kind === 'directory' }"><Folder v-if="row.kind === 'directory'" /><Document v-else /></el-icon>{{ fileView === 'directory' ? row.path.split('/').at(-1) : row.path }}</button></td>
                  <td>{{ row.size === null ? '—' : `${row.size} B` }}</td>
                  <td>{{ row.kind === 'directory' ? '文件夹' : row.managed ? '流程代码' : '普通文件' }}</td>
                  <td><el-button v-if="row.kind === 'directory'" link type="primary" @click.stop="openFileRow(row)">打开</el-button><el-button v-else-if="canWrite && row.canDelete" link type="danger" :loading="deletingPath === row.path" :data-testid="`code-repo-delete-${row.path}`" @click.stop="deleteFile(row)">删除</el-button><span v-else class="crp-muted">{{ row.managed ? '受保护' : '不可删除' }}</span></td>
                </tr>
                <tr v-if="!fileLoading && !fileRows.length"><td colspan="4">暂无匹配文件</td></tr>
              </tbody>
            </table>
          </div>
          <div class="crp-files-pager"><span>共 {{ fileTotal }} {{ fileView === 'directory' ? '项' : '个文件' }} · 第 {{ filePage }} 页</span><el-button size="small" :disabled="filePage <= 1 || fileLoading" @click="loadFiles(filePage - 1)">上一页</el-button><el-button size="small" :disabled="filePage * 50 >= fileTotal || fileLoading" @click="loadFiles(filePage + 1)">下一页</el-button></div>
        </div>
      </div>
    </div>
    <p v-else-if="!loading && !error" class="crp-preview-empty">{{ filter.trim() ? '没有匹配的仓库' : '暂无代码仓库，请先新建仓库。' }}</p>
    <el-dialog v-model="uploadOpen" :title="`${uploadType === 'folder' ? '上传文件夹' : '上传文件'}${uploadRepo ? ` · ${uploadRepo.name}` : ''}`" width="min(620px, 94vw)" append-to-body :close-on-click-modal="!uploading" :close-on-press-escape="!uploading" :show-close="!uploading" data-testid="code-repo-upload-dialog">
      <div class="crp-upload-form">
        <p class="crp-upload-destination">上传目录：<b data-testid="code-repo-upload-directory">{{ selectedDirectory?.path || uploadRepo?.uploadDirectory || 'default' }}/</b></p>
        <label v-if="uploadType === 'folder'">选择文件夹<input type="file" webkitdirectory multiple :disabled="uploading" data-testid="code-repo-upload-folder-files" @change="selectUploadFiles" /></label>
        <label v-else>选择文件<input type="file" multiple :disabled="uploading" data-testid="code-repo-upload-files" @change="selectUploadFiles" /></label>
        <div v-if="uploadFiles.length" class="crp-upload-list"><b>已选 {{ uploadFiles.length }} 个文件</b><ul><li v-for="file in uploadFiles.slice(0, 50)" :key="uploadPath(file)">{{ uploadPath(file) }}</li></ul><span v-if="uploadFiles.length > 50">另有 {{ uploadFiles.length - 50 }} 个文件</span></div>
        <p v-if="uploadSkipped" class="crp-hint">已跳过 {{ uploadSkipped }} 个 Git 仓库内部文件。</p>
        <label class="crp-upload-check"><input v-model="uploadOverwrite" type="checkbox" data-testid="code-repo-upload-overwrite" /> 覆盖仓库中同名文件</label>
        <p v-if="uploadType === 'folder'" class="crp-hint">保留所选文件夹及子目录结构，.git 目录不上传；空文件夹不会上传。</p>
        <p class="crp-hint">最多 {{ uploadType === 'folder' ? 2000 : 20 }} 个文件，单文件 5 MB、总计 10 MB。{{ uploadRepo?.remoteUrl ? `保存后自动推送到 origin/${uploadRepo.branch}；请在远程仓库切换到该分支查看。` : '此仓库未配置远程 Git 地址，只能保存到服务器本地仓库。' }}</p>
        <p v-if="uploadError" class="crp-error" role="alert">{{ uploadError }}</p>
      </div>
      <template #footer><el-button :disabled="uploading" @click="uploadOpen = false">取消</el-button><el-button type="primary" :loading="uploading" data-testid="code-repo-upload-submit" @click="submitUpload">上传并提交</el-button></template>
    </el-dialog>
    <el-drawer v-model="previewOpen" :title="previewPath || '文件内容'" size="min(820px, 94vw)" data-testid="code-repo-preview">
      <div class="crp-preview-detail">
        <p v-if="previewLoading" class="crp-muted">正在读取文件…</p>
        <p v-else-if="previewError" class="crp-error" role="alert">{{ previewError }}</p>
        <pre v-else class="crp-preview-code">{{ previewContent }}</pre>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.crp-main { display: flex; flex: 1; min-height: 0; flex-direction: column; gap: 10px; padding: 14px 16px; }
.crp-head { display: flex; align-items: center; gap: 8px; }
.crp-head b { font-size: 13px; white-space: nowrap; }
.crp-filter { width: min(390px, 44vw); }.crp-count { color: var(--rc-muted); font-size: 12px; white-space: nowrap; }.crp-head-spacer { flex: 1; }
.crp-code-head { display: flex; align-items: center; flex-wrap: nowrap; gap: 8px; min-width: 0; padding: 7px 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-card); font-size: 12px; }
.crp-code-head > b { flex-shrink: 0; font-size: 13px; white-space: nowrap; }
.crp-repo-meta { display: flex; align-items: center; flex: 1; min-width: 0; gap: 10px; color: var(--rc-muted); }
.crp-repo-meta > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crp-repo-name { max-width: 140px; color: var(--rc-text); }.crp-repo-type { max-width: 140px; }
.crp-repo-path { flex: 1 1 160px; }.crp-repo-push { max-width: 200px; }.crp-repo-upload { max-width: 170px; }
.crp-code-actions { display: flex; flex-shrink: 0; align-items: center; gap: 6px; }.crp-code-actions .el-button + .el-button { margin-left: 0; }
.crp-workspace { display: flex; flex: 1; min-height: 260px; flex-direction: column; gap: 10px; }
.crp-upload-notice { margin: 0; padding: 8px 10px; border-radius: 6px; background: var(--rc-primary-bg); color: var(--rc-primary); font-size: 12px; }
.crp-file-layout { display: flex; flex: 1; min-height: 0; gap:10px; }
.crp-files { min-width: 0; min-height: 0; width: 100%; border: 1px solid var(--rc-border); border-radius: 6px; background: var(--rc-card); }
.crp-files { display: flex; flex-direction: column; padding: 10px; gap: 8px; }.crp-file-scroll { flex: 1; min-height: 0; overflow: auto; }
.crp-view-switch { display:flex; flex-shrink:0; border:1px solid var(--rc-border); border-radius:6px; overflow:hidden; }.crp-view-switch button { display:flex; align-items:center; gap:4px; border:0; padding:5px 8px; background:transparent; color:var(--rc-muted); cursor:pointer; font-size:12px; }.crp-view-switch button[aria-pressed="true"] { background:var(--rc-primary-bg); color:var(--rc-primary); }.crp-view-switch button:focus-visible,.crp-breadcrumb button:focus-visible { outline:2px solid var(--rc-primary); outline-offset:-2px; }
.crp-breadcrumb { display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:12px; color:var(--rc-muted); }.crp-breadcrumb button { border:0; background:transparent; color:var(--rc-primary); cursor:pointer; padding:2px; }.crp-file-link { display:inline-flex; align-items:center; gap:6px; }.crp-folder-icon { color:var(--el-color-warning); }
.crp-file-search { width: min(230px, 45%); }.crp-file-link { padding: 0; border: 0; background: none; color: var(--rc-primary); font: inherit; text-align: left; cursor: pointer; }
.crp-files-table td { padding-top:7px; padding-bottom:7px; }
.crp-file-link:hover { text-decoration: underline; }.crp-file-row { cursor: pointer; }.crp-file-row:hover, .crp-file-selected { background: var(--rc-primary-bg); }
.crp-preview-detail { height: 100%; overflow: auto; }.crp-preview-code { margin: 0; padding: 12px; overflow: auto; font-size: 12px; line-height: 1.6; white-space: pre; }.crp-preview-empty { margin: auto; color: var(--rc-muted); font-size: 12px; }
.crp-scroll { max-height: 34vh; min-height: 0; overflow: auto; }.crp-table td { white-space: nowrap; }.crp-table tbody tr:not(.crp-verification) { cursor: pointer; }.crp-repo-selected { background: var(--rc-primary-bg); }
.crp-ellipsis { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.crp-input { box-sizing: border-box; width: 120px; padding: 5px 7px; border: 1px solid var(--rc-border); border-radius: 5px; background: var(--rc-card); color: var(--rc-text); font-size: 12px; }
.crp-path { width: 180px; }.crp-branch { width: 75px; }.crp-type { width: 135px; }
.crp-tag { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: var(--rc-primary-bg); color: var(--rc-primary); font-size: 11px; }
.crp-status { display: inline-flex; align-items: center; gap: 6px; }.crp-on { color: var(--rc-primary); font-size: 12px; }.crp-off { color: var(--rc-muted); font-size: 12px; }
.crp-hint { margin: 8px 0 0; color: var(--rc-muted); font-size: 12px; }
.crp-error { margin: 8px 0; padding: 10px; border-radius: 6px; background: var(--rc-error-bg); color: var(--rc-error); font-size: 12px; }
.crp-verification td { white-space: normal; background: var(--rc-primary-bg); font-size: 12px; }
.crp-verification td > * { margin-right: 14px; }
.crp-check-ok { color: var(--rc-primary); }.crp-check-warning { color: #b45309; }.crp-check-error { color: var(--rc-error); }.crp-check-skipped { color: var(--rc-muted); }
.crp-upload-form { display: grid; gap: 12px; font-size: 12px; }.crp-upload-form > label:not(.crp-upload-check) { display: grid; gap: 6px; font-weight: 600; }
.crp-upload-destination { margin: 0; }.crp-upload-list { color: var(--rc-muted); overflow-wrap: anywhere; }.crp-upload-check { display: flex; align-items: center; gap: 6px; }
.crp-upload-list ul { max-height: 190px; overflow: auto; margin: 6px 0 0; padding-left: 20px; line-height: 1.7; }
.crp-files-toolbar, .crp-files-pager { display: flex; align-items: center; gap: 8px; }.crp-files-toolbar b { margin-right: auto; font-size: 12px; }.crp-files-pager span, .crp-muted { color: var(--rc-muted); font-size: 12px; }.crp-files-pager span { margin-right: auto; }
.crp-files-table { width: 100%; }.crp-file-path { max-width: 460px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 1100px) { .crp-head { flex-wrap: wrap; }.crp-head-spacer { display: none; } }
</style>
