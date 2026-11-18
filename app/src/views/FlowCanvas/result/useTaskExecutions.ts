import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { TaskInst } from '@/api'
import { runnerManagementApi, type BusinessTaskExecution } from '@/api/runnerManagement'

export function useTaskExecutions(rows: Ref<TaskInst[]>) {
  const executions = ref<Record<string, BusinessTaskExecution[]>>({})
  const loading = ref(false), error = ref('')
  let sequence = 0
  watch(rows, async tasks => {
    const request = ++sequence
    executions.value = {}; error.value = ''; loading.value = tasks.length > 0
    if (!tasks.length) return
    try {
      const result = await runnerManagementApi.businessTaskExecutionBatch(tasks.map(task => ({ taskId: task.taskId, topic: task.topic || '' })))
      if (sequence === request) executions.value = result.items
    } catch (e) {
      if (sequence === request) error.value = e instanceof Error ? e.message : String(e)
    } finally {
      if (sequence === request) loading.value = false
    }
  }, { immediate: true })
  onScopeDispose(() => { sequence++ })
  return { executions, loading, error }
}
