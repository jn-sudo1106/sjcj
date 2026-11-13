<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { runnerManagementApi, type BusinessTaskExecution } from '@/api/runnerManagement'

const props = defineProps<{ taskId: string; topic?: string; configId?: string }>()
const items = ref<BusinessTaskExecution[]>([]), loading = ref(false), error = ref(''), truncated = ref(false)
let request = 0
onBeforeUnmount(() => { request++ })
async function load() {
  const seq = ++request
  items.value = []; error.value = ''; truncated.value = false
  if (!props.taskId) return
  loading.value = true
  try {
    const result = await runnerManagementApi.businessTaskExecutions(props.taskId, props.topic || '', props.configId || '')
    if (seq === request) { items.value = result.items; truncated.value = result.truncated }
  } catch (e) { if (seq === request) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === request) loading.value = false }
}
watch(() => [props.taskId, props.topic, props.configId], load, { immediate: true })
const labels: Record<string, string> = { completed: '采集完成', failed: '采集失败', observed: '已收到任务输出' }
function target(item: BusinessTaskExecution) {
  return { path: '/settings', query: { tab: 'runtime-logs', recordId: item.recordId, runnerId: item.runnerId,
    streamId: item.streamId, logView: 'output', logSeq: String(item.seq), businessTaskId: props.taskId } }
}
</script>

<template>
  <section class="task-execution" aria-label="任务执行机器">
    <header><strong>程序执行</strong><button type="button" :disabled="loading" @click="load">刷新</button></header>
    <p v-if="loading">正在查找任务程序输出…</p>
    <p v-else-if="error" role="alert">执行日志查询失败：{{ error }}</p>
    <template v-else>
      <article v-for="item in items" :key="`${item.recordId}:${item.streamId}`">
        <div>{{ item.machine }} · PID {{ item.pid || '未上报' }} · {{ labels[item.status] || item.status }}</div>
        <small>{{ item.instanceDirectory }} · 实例 {{ item.runnerId }}</small>
        <RouterLink :to="target(item)" target="_blank" rel="noopener">查看程序输出</RouterLink>
      </article>
      <p v-if="!items.length">暂无匹配任务输出，可能尚未执行或日志尚未上传。</p>
      <p v-if="truncated">仅检索了近期保留的日志，较早记录请在运行日志中查看。</p>
    </template>
  </section>
</template>

<style scoped>
.task-execution { margin:12px 0; padding:10px 12px; border:1px solid var(--el-border-color-light); border-radius:8px; font-size:12px; }
header { display:flex; justify-content:space-between; align-items:center; }
button { border:0; background:transparent; color:var(--el-color-primary); cursor:pointer; }
button:disabled { color:var(--el-text-color-disabled); cursor:default; }
article { margin-top:8px; overflow-wrap:anywhere; }
small { display:block; color:var(--el-text-color-secondary); margin:4px 0; }
a { color:var(--el-color-primary); }
p { color:var(--el-text-color-secondary); margin:8px 0 0; }
[role=alert] { color:var(--el-color-danger); }
</style>
