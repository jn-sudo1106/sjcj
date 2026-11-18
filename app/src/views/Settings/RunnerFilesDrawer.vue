<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { runnerManagementApi as api, type RunnerInstance, type RemoteCodeFile } from '@/api/runnerManagement'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'
import { isProgramEntry } from '@/utils/programEntry'
const props = defineProps<{ runner: RunnerInstance; directory: string; selectFile?: boolean; embedded?: boolean; workspace?: boolean; editable?: boolean; allowSetEntry?: boolean; entryPoint?: string; entrySaving?: boolean; entryFilter?: (path: string) => boolean }>()
const emit = defineEmits<{ close: []; selected: [path: string]; setEntry: [path: string] }>()
const mutating = ref(false), upload = ref<HTMLInputElement>()
const canManage = computed(() => props.workspace && props.editable)
const managementReady = computed(() => props.runner.status === 'online' && props.runner.capabilities?.includes('file-management'))
const selectionScope = ref('')
const path = ref(''), files = ref<RemoteCodeFile[]>([]), content = ref<string | null>(null), filePath = ref(''), loading = ref(false), error = ref(''), truncated = ref(false)
const fileKeyword = ref(''), fileType = ref<'all' | 'files' | 'folders'>('all')
const visibleFiles = computed(() => {
  const query = fileKeyword.value.trim().toLocaleLowerCase()
  return files.value.filter(file => (!query || file.name.toLocaleLowerCase().includes(query))
    && (fileType.value === 'all' || (fileType.value === 'folders' ? file.isDirectory : !file.isDirectory)))
})
function resetFileSearch() { fileKeyword.value = ''; fileType.value = 'all' }
const crumbs = computed(() => path.value.split('/').filter(Boolean))
const pickerCrumbs = computed(() => path.value.slice(selectionScope.value.length).split('/').filter(Boolean))
const fullPath = computed(() => props.runner.installDirectory.replace(/[\\/]+$/, '') + (path.value ? (props.runner.installDirectory.includes('\\') ? '\\' : '/') + path.value.replaceAll('/', props.runner.installDirectory.includes('\\') ? '\\' : '/') : ''))
let sequence = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined, releaseWait: (() => void) | undefined
function cancelWait() { if (timer) clearTimeout(timer); releaseWait?.(); releaseWait = undefined }
async function pause() { await new Promise<void>(resolve => { releaseWait = resolve; timer = setTimeout(resolve, 1000) }); releaseWait = undefined }
type FileRequest = Parameters<typeof api.requestRunnerFiles>[1]
async function perform(body: FileRequest, runnerId: string, seq: number) {
  const job = await api.requestRunnerFiles(runnerId, body)
  for (let attempt = 0; attempt < 45 && seq === sequence && !stopped; attempt++) {
    const response = await api.runnerFileResult(job.requestId)
    if (seq !== sequence || stopped) return
    if (response.status === 'failed') throw new Error(response.error || 'Runner 文件操作失败')
    if (response.status === 'success') {
      if (!response.result) throw new Error('Runner 返回的数据不完整')
      return response.result
    }
    await pause()
  }
  if (seq === sequence && !stopped) throw new Error('等待 Runner 返回文件超时，请确认实例在线后刷新')
}
async function request(action: 'list' | 'read', target: string) {
  if (mutating.value) return
  cancelWait(); const seq = ++sequence
  loading.value = true; error.value = ''
  try {
    const response = await perform({ action, path: target }, props.runner.runnerId, seq)
    if (!response || seq !== sequence || stopped) return
    if (action === 'list') {
      if (response.path !== path.value) resetFileSearch()
      path.value = response.path; files.value = response.items || []; truncated.value = !!response.truncated; content.value = null
    }
    else { filePath.value = response.path; content.value = response.content ?? '' }
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) loading.value = false }
}
async function mutation(makeBody: () => Promise<FileRequest | undefined>) {
  if (!canManage.value || !managementReady.value || loading.value || mutating.value) return
  cancelWait(); const seq = ++sequence, runnerId = props.runner.runnerId, current = path.value
  mutating.value = true; error.value = ''
  try {
    const body = await makeBody()
    if (!body || seq !== sequence || stopped) return
    const response = await perform(body, runnerId, seq)
    if (!response || seq !== sequence || stopped) return
    ElMessage.success(body.action === 'upload' ? '上传完成' : body.action === 'mkdir' ? '文件夹已创建' : '已删除')
    mutating.value = false
    await request('list', current)
  } catch (e) {
    if (seq === sequence && !stopped && e !== 'cancel' && e !== 'close') error.value = e instanceof Error ? e.message : String(e)
  } finally { if (seq === sequence) mutating.value = false }
}
async function createFolder() {
  await mutation(async () => {
    const response = await ElMessageBox.prompt('请输入文件夹名称', '新建文件夹', { inputValidator: value => !!value?.trim() && !/[\\/:*?"<>|]/.test(value) && !['.', '..'].includes(value.trim()) || '请输入有效的文件夹名称' })
    return { action: 'mkdir', path: [path.value, response.value.trim()].filter(Boolean).join('/') }
  })
}
async function remove(file: RemoteCodeFile) {
  await mutation(async () => {
    await ElMessageBox.confirm(`确认删除${file.isDirectory ? '文件夹' : '文件'} ${file.path}？`, '删除', { type: 'warning' })
    return { action: 'delete', path: file.path, expectedHash: file.sha256 || '', expectedSize: file.size, expectedModifiedAt: file.modifiedAt }
  })
}
async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement, incoming = [...(input.files || [])]; input.value = ''
  if (!incoming.length) return
  await mutation(async () => {
    if (incoming.length > 2000 || incoming.some(file => file.size > 5 * 1024 * 1024) || incoming.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) throw new Error('单文件最多 5 MB，单次最多 2000 个文件、合计 10 MB')
    const entries = await Promise.all(incoming.map(async file => {
      const bytes = new Uint8Array(await file.arrayBuffer()); let raw = ''
      for (let index = 0; index < bytes.length; index += 8192) raw += String.fromCharCode(...bytes.subarray(index, index + 8192))
      return { path: [path.value, file.name].filter(Boolean).join('/'), data: btoa(raw) }
    }))
    return { action: 'upload', path: path.value, files: entries }
  })
}
function open(file: RemoteCodeFile) {
  if (loading.value || mutating.value || file.accessError) return
  if (props.selectFile && !file.isDirectory) {
    const prefix = selectionScope.value ? selectionScope.value + '/' : ''
    if (!file.path.startsWith(prefix) || !isProgramEntry(file.path)) return
    emit('selected', file.path.slice(prefix.length)); return
  }
  void request(file.isDirectory ? 'list' : 'read', file.path)
}
function entryRelative(target: string) {
  const prefix = selectionScope.value ? selectionScope.value + '/' : ''
  if (!target.startsWith(prefix)) return ''
  const relative = target.slice(prefix.length)
  return isProgramEntry(relative) && (!props.entryFilter || props.entryFilter(relative)) ? relative : ''
}
watch([() => props.runner.runnerId, () => props.runner.installDirectory, () => props.directory], () => {
  mutating.value = false
  resetFileSearch()
  content.value = null; files.value = []; path.value = ''
  const root = props.runner.installDirectory.replaceAll('\\', '/').replace(/\/+$/, ''), directory = props.directory.replaceAll('\\', '/').replace(/\/+$/, '')
  const windows = /^[A-Za-z]:/.test(root), comparable = windows ? directory.toLowerCase() : directory, prefix = windows ? root.toLowerCase() : root
  const relative = comparable === prefix ? '' : comparable.startsWith(prefix + '/') ? directory.slice(root.length + 1) : directory
  selectionScope.value = relative
  void request('list', relative)
}, { immediate: true })
onBeforeUnmount(() => { stopped = true; sequence++; cancelWait() })
</script>

<template>
  <component :is="embedded ? 'section' : 'el-drawer'" v-bind="embedded ? {} : { modelValue: true, title: selectFile ? '选择入口文件' : '部署目录', size: 'min(960px, 94vw)' }" @close="emit('close')">
    <div class="runner-files" :class="{ 'is-workspace': workspace }">
      <header v-if="!workspace"><b>{{ runner.ipAddress }} · {{ runner.installDirectory }}</b><el-button :icon="Refresh" :loading="loading" aria-label="刷新部署目录" @click="request('list', path)" /></header>
      <div v-if="selectFile || embedded" class="runner-files-toolbar">
        <el-breadcrumb separator="/"><el-breadcrumb-item><a :title="runner.installDirectory" @click="request('list', selectionScope)">{{ workspace ? '部署空间' : '部署目录' }}</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part, index) in pickerCrumbs" :key="index"><a @click="request('list', [selectionScope, ...pickerCrumbs.slice(0,index+1)].filter(Boolean).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
        <div v-if="workspace" class="runner-files-actions">
          <template v-if="canManage"><el-button :disabled="loading || mutating || !managementReady" data-testid="deployment-create-folder" @click="createFolder">新建文件夹</el-button><el-button :disabled="loading || mutating || !managementReady" data-testid="deployment-upload" @click="upload?.click()">上传文件</el-button></template>
          <el-button :loading="loading" :disabled="mutating" aria-label="刷新部署目录" @click="request('list', path)">刷新</el-button>
        </div>
      </div>
      <el-breadcrumb v-else separator="/"><el-breadcrumb-item><a @click="request('list', '')">实例目录</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part, index) in crumbs" :key="index"><a @click="request('list', crumbs.slice(0,index+1).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
      <small v-if="canManage && !managementReady" class="muted">当前 Runner 尚未就绪或需要升级，文件管理就绪后可上传、新建和删除。</small>
      <code v-if="!workspace" class="full-path">{{ fullPath }}</code>
      <div v-if="content === null" class="runner-file-search" data-testid="deployment-file-search">
        <el-input v-model="fileKeyword" clearable :disabled="loading || mutating" placeholder="搜索当前目录的文件或文件夹" aria-label="搜索部署文件或文件夹" data-testid="deployment-file-keyword" />
        <el-select v-model="fileType" :disabled="loading || mutating" aria-label="部署文件搜索类型" data-testid="deployment-file-type"><el-option value="all" label="文件和文件夹" /><el-option value="folders" label="仅文件夹" /><el-option value="files" label="仅文件" /></el-select>
        <span>{{ visibleFiles.length }} / {{ files.length }} 项</span>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <p v-if="loading" class="muted">等待 Runner 返回目录或文件内容…</p>
      <p v-if="mutating" class="muted">正在执行文件操作，请稍候…</p>
      <el-alert v-if="truncated" title="当前目录文件较多，仅展示前 200 项或响应大小允许的范围；搜索仅匹配已加载的项目" type="info" :closable="false" />
      <template v-if="content !== null"><div class="preview-title"><b>{{ filePath }}</b><el-button v-if="allowSetEntry && entryRelative(filePath)" link type="primary" :disabled="entrySaving || entryPoint === entryRelative(filePath)" @click="emit('setEntry', entryRelative(filePath))">{{ entryPoint === entryRelative(filePath) ? '当前入口' : '设为入口' }}</el-button><el-button link :disabled="loading" @click="content = null">返回文件列表</el-button></div><pre class="file-content">{{ content }}</pre></template>
      <el-table v-else-if="!loading || files.length" :data="visibleFiles" row-key="path" :empty-text="error ? '目录读取失败' : fileKeyword.trim() || fileType !== 'all' ? '当前目录没有匹配的文件或文件夹' : '当前目录没有可浏览文件'" @row-dblclick="open">
        <el-table-column label="文件 / 目录" :min-width="workspace ? 200 : 180"><template #default="{ row }"><el-button link type="primary" :disabled="loading || mutating || row.accessError || (selectFile && !row.isDirectory && !isProgramEntry(row.path))" @click="open(row)"><span class="runner-file-icon" aria-hidden="true">{{ row.isDirectory ? '📁' : '📄' }}</span>{{ row.name }}</el-button><span v-if="row.accessError" class="runner-file-error"> · 无法读取</span></template></el-table-column>
        <el-table-column label="大小" :width="workspace ? 80 : 90"><template #default="{ row }">{{ row.isDirectory || row.size == null ? '—' : `${(row.size/1024).toFixed(1)} KB` }}</template></el-table-column>
        <el-table-column v-if="allowSetEntry" label="入口程序" width="105"><template #default="{ row }"><el-button v-if="!row.isDirectory && !row.accessError && entryRelative(row.path)" link type="primary" :disabled="entrySaving || entryPoint === entryRelative(row.path)" data-testid="runner-set-entry" @click.stop="emit('setEntry', entryRelative(row.path))">{{ entryPoint === entryRelative(row.path) ? '当前入口' : '设为入口' }}</el-button></template></el-table-column>
        <el-table-column v-if="!embedded || workspace" label="修改时间" :width="workspace ? 160 : 165"><template #default="{ row }">{{ workspace ? formatRunnerDateTime(row.modifiedAt, '—').replaceAll('-', '/') : formatRunnerDateTime(row.modifiedAt) }}</template></el-table-column>
        <el-table-column v-if="!embedded || workspace" prop="sha256" label="SHA-256" :min-width="workspace ? 100 : 130" show-overflow-tooltip />
        <el-table-column v-if="canManage" label="操作" width="70"><template #default="{ row }"><el-button link type="danger" :disabled="loading || mutating || !managementReady || row.accessError" data-testid="deployment-delete-file" @click.stop="remove(row)">删除</el-button></template></el-table-column>
      </el-table>
      <input v-if="canManage" ref="upload" type="file" multiple hidden data-testid="deployment-upload-input" @change="uploadFiles" />
    </div>
  </component>
</template>

<style scoped>
.runner-files{display:flex;flex-direction:column;gap:12px;min-width:0}header,.preview-title{display:flex;align-items:center;justify-content:space-between;gap:12px}header b,.preview-title b,.full-path{overflow-wrap:anywhere;min-width:0}.full-path,.muted{font-size:12px;color:var(--el-text-color-secondary)}a{cursor:pointer;color:var(--el-color-primary)}.file-content{margin:0;padding:12px;background:var(--el-fill-color-light);border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.runner-file-icon{margin-right:5px}.runner-file-error{color:var(--el-color-danger)}.runner-files-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.runner-files-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}.runner-files-actions .el-button+.el-button{margin-left:0}.is-workspace{gap:10px}
.runner-file-search{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.runner-file-search .el-input{width:320px;max-width:100%}.runner-file-search .el-select{width:150px}.runner-file-search>span{color:var(--el-text-color-secondary);font-size:12px}
</style>
