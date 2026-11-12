<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Refresh, Folder, Document } from '@element-plus/icons-vue'
import { runnerManagementApi as api, type RunnerInstance, type RemoteCodeFile } from '@/api/runnerManagement'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'
const props = defineProps<{ runner: RunnerInstance; directory: string; selectFile?: boolean }>()
const emit = defineEmits<{ close: []; selected: [path: string] }>()
const selectionScope = ref('')
const path = ref(''), files = ref<RemoteCodeFile[]>([]), content = ref<string | null>(null), filePath = ref(''), loading = ref(false), error = ref(''), truncated = ref(false)
const crumbs = computed(() => path.value.split('/').filter(Boolean))
const pickerCrumbs = computed(() => path.value.slice(selectionScope.value.length).split('/').filter(Boolean))
const fullPath = computed(() => props.runner.installDirectory.replace(/[\\/]+$/, '') + (path.value ? (props.runner.installDirectory.includes('\\') ? '\\' : '/') + path.value.replaceAll('/', props.runner.installDirectory.includes('\\') ? '\\' : '/') : ''))
let sequence = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined, releaseWait: (() => void) | undefined
function cancelWait() { if (timer) clearTimeout(timer); releaseWait?.(); releaseWait = undefined }
async function pause() { await new Promise<void>(resolve => { releaseWait = resolve; timer = setTimeout(resolve, 1000) }); releaseWait = undefined }
async function request(action: 'list' | 'read', target: string) {
  cancelWait(); const seq = ++sequence
  loading.value = true; error.value = ''
  try {
    const job = await api.requestRunnerFiles(props.runner.runnerId, { action, path: target })
    for (let attempt = 0; attempt < 45 && seq === sequence && !stopped; attempt++) {
      const response = await api.runnerFileResult(job.requestId)
      if (seq !== sequence || stopped) return
      if (response.status === 'failed') throw new Error(response.error || '读取 Runner 目录失败')
      if (response.status === 'success') {
        if (!response.result) throw new Error('Runner 返回的数据不完整')
        if (action === 'list') { path.value = response.result.path; files.value = response.result.items || []; truncated.value = !!response.result.truncated; content.value = null }
        else { filePath.value = response.result.path; content.value = response.result.content ?? '' }
        return
      }
      await pause()
    }
    if (seq === sequence && !stopped) throw new Error('等待 Runner 返回文件超时，请确认实例在线后刷新')
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) loading.value = false }
}
function open(file: RemoteCodeFile) {
  if (loading.value || file.accessError) return
  if (props.selectFile && !file.isDirectory) {
    const prefix = selectionScope.value ? selectionScope.value + '/' : ''
    if (!file.path.startsWith(prefix) || !file.path.endsWith('.py')) return
    emit('selected', file.path.slice(prefix.length)); return
  }
  void request(file.isDirectory ? 'list' : 'read', file.path)
}
watch(() => [props.runner.runnerId, props.directory], () => {
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
  <el-drawer :model-value="true" :title="selectFile ? '选择入口文件' : '部署目录'" size="min(960px, 94vw)" @close="emit('close')">
    <div class="runner-files">
      <header><b>{{ runner.ipAddress }} · {{ runner.installDirectory }}</b><el-button :icon="Refresh" :loading="loading" aria-label="刷新部署目录" @click="request('list', path)" /></header>
      <el-breadcrumb v-if="selectFile" separator="/"><el-breadcrumb-item><a @click="request('list', selectionScope)">部署目录</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part, index) in pickerCrumbs" :key="index"><a @click="request('list', [selectionScope, ...pickerCrumbs.slice(0,index+1)].filter(Boolean).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
      <el-breadcrumb v-else separator="/"><el-breadcrumb-item><a @click="request('list', '')">实例目录</a></el-breadcrumb-item><el-breadcrumb-item v-for="(part, index) in crumbs" :key="index"><a @click="request('list', crumbs.slice(0,index+1).join('/'))">{{ part }}</a></el-breadcrumb-item></el-breadcrumb>
      <code class="full-path">{{ fullPath }}</code>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <p v-if="loading" class="muted">等待 Runner 返回目录或文件内容…</p>
      <el-alert v-if="truncated" title="当前目录文件较多，仅展示前 200 项或响应大小允许的范围" type="info" :closable="false" />
      <template v-if="content !== null"><div class="preview-title"><b>{{ filePath }}</b><el-button link :disabled="loading" @click="content = null">返回文件列表</el-button></div><pre class="file-content">{{ content }}</pre></template>
      <el-table v-else :data="files" row-key="path" empty-text="当前目录没有可浏览文件" @row-dblclick="open">
        <el-table-column label="文件 / 目录" min-width="180"><template #default="{ row }"><el-button link type="primary" :disabled="loading || row.accessError || (selectFile && !row.isDirectory && !row.path.endsWith('.py'))" @click="open(row)"><el-icon><Folder v-if="row.isDirectory" /><Document v-else /></el-icon>{{ row.name }}</el-button><span v-if="row.accessError">无法读取</span></template></el-table-column>
        <el-table-column label="大小" width="90"><template #default="{ row }">{{ row.isDirectory || row.size == null ? '—' : `${(row.size/1024).toFixed(1)} KB` }}</template></el-table-column>
        <el-table-column label="修改时间" width="165"><template #default="{ row }">{{ formatRunnerDateTime(row.modifiedAt) }}</template></el-table-column>
        <el-table-column prop="sha256" label="SHA-256" min-width="130" show-overflow-tooltip />
      </el-table>
    </div>
  </el-drawer>
</template>

<style scoped>
.runner-files{display:flex;flex-direction:column;gap:12px;min-width:0}header,.preview-title{display:flex;align-items:center;justify-content:space-between;gap:12px}header b,.preview-title b,.full-path{overflow-wrap:anywhere;min-width:0}.full-path,.muted{font-size:12px;color:var(--el-text-color-secondary)}a{cursor:pointer;color:var(--el-color-primary)}.file-content{margin:0;padding:12px;background:var(--el-fill-color-light);border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.el-button .el-icon{margin-right:5px}
</style>
