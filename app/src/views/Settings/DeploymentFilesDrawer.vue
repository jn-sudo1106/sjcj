<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { runnerManagementApi as api, type DeploymentFileContent, type DeploymentFileSnapshot, type GeneratedDeploymentJob } from '@/api/runnerManagement'

const props = defineProps<{ job: GeneratedDeploymentJob }>()
const emit = defineEmits<{ close: [] }>()
const snapshot = ref<DeploymentFileSnapshot | null>(null), content = ref<DeploymentFileContent | null>(null)
const allFiles = ref(false), path = ref(''), loading = ref(false), reading = ref(false), error = ref('')
let listSequence = 0, fileSequence = 0
const visibleFiles = computed(() => snapshot.value?.files.filter(file => allFiles.value || file.taskFile) || [])
async function readFile() {
  const request = ++fileSequence
  content.value = null; error.value = ''; reading.value = false
  if (!path.value) return
  reading.value = true
  try { const result = await api.deploymentFileContent(props.job.jobId, path.value); if (request === fileSequence) content.value = result }
  catch (e) { if (request === fileSequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === fileSequence) reading.value = false }
}
function selectScope() {
  if (!visibleFiles.value.some(file => file.path === path.value)) path.value = visibleFiles.value[0]?.path || ''
  void readFile()
}
async function load() {
  const request = ++listSequence; fileSequence++
  loading.value = true; error.value = ''; snapshot.value = null; content.value = null; path.value = ''; reading.value = false
  try {
    const result = await api.deploymentFiles(props.job.jobId)
    if (request !== listSequence) return
    snapshot.value = result; allFiles.value = !result.files.some(file => file.taskFile)
    path.value = visibleFiles.value[0]?.path || ''
    await readFile()
  } catch (e) { if (request === listSequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === listSequence) loading.value = false }
}
watch(() => props.job.jobId, () => void load(), { immediate: true })
onBeforeUnmount(() => { listSequence++; fileSequence++ })
</script>

<template>
  <el-drawer :model-value="true" title="部署文件" size="min(1050px, 96vw)" @close="emit('close')">
    <section class="deployment-files">
      <div class="deployment-files-meta"><span>配置 {{ job.configId }} · {{ job.environment === 'test' ? '测试' : '生产' }}</span><code>Git {{ job.gitCommit.slice(0, 12) }}</code><el-button :disabled="loading || reading" @click="load">刷新</el-button></div>
      <small>查看这条记录已确认部署的签名版本；服务器上的实时文件仍可从部署目录打开。</small>
      <code v-if="snapshot" class="deployment-files-path">{{ snapshot.directory }}</code>
      <div class="deployment-files-toolbar"><el-checkbox v-model="allFiles" :disabled="loading" @change="selectScope">显示完整部署目录</el-checkbox><el-select v-model="path" aria-label="部署文件" placeholder="选择部署文件" :disabled="loading || !visibleFiles.length" filterable data-testid="deployment-file-select" @change="readFile"><el-option v-for="file in visibleFiles" :key="file.path" :value="file.path" :label="file.path" /></el-select><span>{{ visibleFiles.length }} 个文件</span></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <p v-if="loading || reading" role="status">正在读取部署版本文件…</p>
      <template v-else-if="content"><div class="deployment-file-summary"><b>{{ content.path }}</b><span>{{ (content.size / 1024).toFixed(1) }} KB</span><code :title="content.sha256">SHA-256 {{ content.sha256.slice(0, 16) }}</code></div><pre class="deployment-file-code" data-testid="deployment-file-content">{{ content.content }}</pre></template>
      <el-empty v-else-if="!error && !loading" description="该部署记录没有可查看的文件" />
    </section>
  </el-drawer>
</template>

<style scoped>
.deployment-files { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.deployment-files-meta, .deployment-files-toolbar, .deployment-file-summary { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.deployment-files-meta > span { flex: 1; }
.deployment-files small, .deployment-file-summary { color: var(--el-text-color-secondary); font-size: 12px; }
.deployment-files-toolbar .el-select { flex: 1; min-width: 220px; }
.deployment-files-path { overflow-wrap: anywhere; }
.deployment-file-code { margin: 0; padding: 14px; border-radius: 6px; background: var(--el-fill-color-light); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
</style>
