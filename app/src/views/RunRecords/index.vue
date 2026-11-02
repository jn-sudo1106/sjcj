<script setup lang="ts">
import TaskView from '@/views/FlowCanvas/result/TaskView.vue'
import CodeGenerationTasks from './CodeGenerationTasks.vue'
import { useRoute, useRouter } from 'vue-router'
const route = useRoute()
const router = useRouter()
function selectTab(tab: string) {
  void router.replace({ query: { ...route.query, tab: tab === 'code-generation' ? tab : undefined } })
}

// AppShell 的 KeepAlive 按这个名字缓存任务中心：从任务点进源再返回，不用再等一次十几秒的查询
defineOptions({ name: 'TaskCenter' })
</script>

<template>
  <div class="task-center">
    <nav class="task-tabs" aria-label="任务类型">
      <button :class="{ active: route.query.tab !== 'code-generation' }" @click="selectTab('collection')">采集任务</button>
      <button :class="{ active: route.query.tab === 'code-generation' }" @click="selectTab('code-generation')">代码生成</button>
    </nav>
    <CodeGenerationTasks v-if="route.query.tab === 'code-generation'" :initial-config-id="typeof route.query.codeConfigId === 'string' ? route.query.codeConfigId : ''" :initial-task-id="typeof route.query.codeTaskId === 'string' ? route.query.codeTaskId : ''" class="task-content" />
    <TaskView v-else global class="task-content" />
  </div>
</template>

<style scoped>
.task-center { min-height: 0; height: 100%; display: flex; flex-direction: column; }
.task-content { flex: 1; min-height: 0; }
.task-tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--el-border-color); padding: 0 20px; }
.task-tabs button { cursor: pointer; background: none; border: none; padding: 12px 0; color: var(--el-text-color-regular); border-bottom: 2px solid transparent; }
.task-tabs button.active { color: var(--el-color-primary); border-bottom-color: var(--el-color-primary); }
</style>
