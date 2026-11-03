<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type GeneratedDeploymentJob, type RuntimeConfiguration } from '@/api/runnerManagement'

const props = defineProps<{ job: GeneratedDeploymentJob; currentRuntime: RuntimeConfiguration | null }>()
const auth = useAuthStore(), runtime = ref<RuntimeConfiguration | null>(null), busy = ref(false), error = ref('')
const files = ref<string[]>([]), entry = ref(''), entryRevision = ref(''), layoutRevision = ref('')
const current = computed(() => runtime.value?.deploymentId === props.job.deploymentId && runtime.value?.binding?.delivery?.deliveryId === props.job.deliveryId)
const canControl = computed(() => auth.role === 'admin' && props.job.status === 'success' && current.value)
const desiredRunning = computed(() => !!runtime.value?.assignment?.enabled)
async function control(start: boolean) {
  if (!canControl.value || !runtime.value || busy.value) return
  const jobId = props.job.jobId
  busy.value = true; error.value = ''
  try {
    let row = runtime.value
    if (start && !row.assignment) {
      if (!files.value.length) {
        const options = await runnerManagementApi.runtimeEntry(row.runtimeId)
        if (jobId !== props.job.jobId) return
        files.value = options.files; entry.value = options.entryPoint
        entryRevision.value = options.revision; layoutRevision.value = options.layoutRevision
        if (!files.value.length) throw new Error('没有可启动的 Python 文件')
        if (files.value.length > 1) return
      }
      if (!entry.value) return
      row = await runnerManagementApi.saveRuntimeEntry(row.runtimeId, { entryPoint: entry.value, revision: entryRevision.value, layoutRevision: layoutRevision.value })
      if (jobId !== props.job.jobId) return
      runtime.value = row; files.value = []
    }
    const result = await (start ? runnerManagementApi.startRuntimeProgram : runnerManagementApi.stopRuntimeProgram)(row.runtimeId, row.revision)
    if (jobId !== props.job.jobId) return
    runtime.value = result
    ElMessage.success(start ? '启动指令已提交，等待 Runner 上报进程' : '停止指令已提交，等待 Runner 停止进程')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
watch(() => [props.job.jobId, props.currentRuntime] as const, ([id, row], previous) => {
  if (previous && id !== previous[0]) { files.value = []; error.value = '' }
  if (!busy.value) runtime.value = row
}, { immediate: true })
</script>

<template>
  <div class="deployment-runtime-actions" @click.stop>
    <el-button v-if="canControl" link :type="desiredRunning ? 'danger' : 'primary'" :loading="busy" :disabled="busy || (!!files.length && !entry)" @click="control(!desiredRunning)">{{ desiredRunning ? '停止程序' : files.length ? '保存入口并启动' : '启动程序' }}</el-button>
    <span v-if="canControl" class="desired-state">{{ desiredRunning ? '已请求运行' : '未请求运行' }}</span>
    <span v-else-if="runtime && !current" class="desired-state">已有更新部署</span>
    <RouterLink v-if="job.runtimeId" :to="{path:'/settings',query:{tab:'runtime-logs',runtimeId:job.runtimeId,runnerId:job.runnerId}}">运行日志</RouterLink>
    <RouterLink v-if="job.deliveryId" :to="{path:'/settings',query:{tab:'runtime-logs',recordId:job.deliveryId,runnerId:job.runnerId}}">部署日志</RouterLink>
    <div v-if="files.length > 1" class="entry-picker"><el-select v-model="entry" placeholder="选择启动文件" aria-label="部署记录启动文件" :disabled="busy" filterable><el-option v-for="file in files" :key="file" :value="file" :label="file" /></el-select><el-button link :disabled="busy" @click="files = []">取消</el-button></div>
    <span v-if="error" role="alert" class="runtime-error">{{ error }}</span>
  </div>
</template>

<style scoped>
.deployment-runtime-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.desired-state{font-size:11px;color:var(--el-text-color-secondary)}a{white-space:nowrap;color:var(--el-color-primary);font-size:12px}.entry-picker{display:flex;gap:8px;flex-basis:100%;min-width:0}.entry-picker .el-select{width:210px;max-width:100%}.runtime-error{flex-basis:100%;font-size:12px;color:var(--el-color-danger);overflow-wrap:anywhere}
</style>
