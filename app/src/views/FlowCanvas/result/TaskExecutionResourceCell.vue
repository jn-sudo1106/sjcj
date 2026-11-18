<script setup lang="ts">
import type { BusinessTaskExecution } from '@/api/runnerManagement'
defineProps<{ taskId: string; state: string; items?: BusinessTaskExecution[]; loading?: boolean; error?: string }>()
const statuses: Record<string, string> = { completed: '采集完成', failed: '采集失败', observed: '已接收任务' }
function instance(item: BusinessTaskExecution) {
  return { path: '/settings', query: { tab: 'runners', runnerId: item.runnerId, view: 'instances' } }
}
function output(item: BusinessTaskExecution, taskId: string) {
  return { path: '/settings', query: { tab: 'runtime-logs', recordId: item.recordId, runnerId: item.runnerId,
    streamId: item.streamId, logView: 'output', logSeq: String(item.seq), businessTaskId: taskId } }
}
</script>

<template>
  <div class="task-execution-resource" data-testid="task-execution-resource" @click.stop @keydown.enter.stop>
    <template v-if="items?.length">
      <RouterLink :to="instance(items[0]!)" class="resource-machine" target="_blank" rel="noopener">{{ items[0]!.machine }}</RouterLink>
      <small v-if="items[0]!.runnerName">{{ items[0]!.runnerName }}</small>
      <small :title="items[0]!.instanceDirectory">{{ items[0]!.instanceDirectory || items[0]!.runnerId }}</small>
      <RouterLink :to="output(items[0]!, taskId)" class="resource-output" target="_blank" rel="noopener">查看程序输出</RouterLink>
      <details v-if="items.length > 1"><summary>共 {{ items.length }} 次执行</summary><article v-for="item in items" :key="`${item.recordId}:${item.streamId}`">
        <RouterLink :to="instance(item)" target="_blank" rel="noopener">{{ item.machine }} · {{ item.runnerName || item.runnerId }}</RouterLink>
        <small :title="item.instanceDirectory">{{ item.instanceDirectory }}</small>
        <small>{{ statuses[item.status] || item.status }} · PID {{ item.pid || '未上报' }}</small>
        <RouterLink :to="output(item, taskId)" target="_blank" rel="noopener">查看程序输出</RouterLink>
      </article></details>
    </template>
    <span v-else-if="loading" class="muted">读取执行资源…</span>
    <span v-else-if="error" class="resource-error" :title="error">资源查询失败</span>
    <span v-else class="muted">{{ state === 'L' ? '等待执行资源上报' : '未记录执行资源' }}</span>
  </div>
</template>

<style scoped>
.task-execution-resource{min-width:0;font-size:12px;line-height:1.6}.task-execution-resource a{color:var(--el-color-primary);text-decoration:none}.task-execution-resource a:hover{text-decoration:underline}.resource-machine{font-weight:500}.task-execution-resource small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--el-text-color-secondary)}.resource-output{font-size:11px}.task-execution-resource summary{cursor:pointer;color:var(--el-color-primary);font-size:11px}.task-execution-resource article{margin-top:6px;border-top:1px solid var(--el-border-color-lighter);padding-top:4px;overflow-wrap:anywhere}.resource-error{color:var(--el-color-danger)}.muted{color:var(--el-text-color-secondary);font-size:11px}
</style>
