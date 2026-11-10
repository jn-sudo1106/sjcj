<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFlowStore } from '@/stores/flow'
import CanvasHeader from '../shared/CanvasHeader.vue'
import TaskView from './TaskView.vue'
import CodeGenerationTasks from '@/views/RunRecords/CodeGenerationTasks.vue'

const flow = useFlowStore()
const sourceId = computed(() => flow.sourceCtx?.sourceId || '')
const tab = ref('collection')
</script>

<template>
  <section class="source-tasks">
    <CanvasHeader />
    <nav class="source-task-tabs" aria-label="源任务类型">
      <button type="button" :class="{ active: tab === 'collection' }" @click="tab = 'collection'">采集任务</button>
      <button type="button" :class="{ active: tab === 'code-generation' }" @click="tab = 'code-generation'">智能体任务</button>
    </nav>
    <CodeGenerationTasks v-if="tab === 'code-generation' && sourceId" :key="sourceId" :source-scope-id="sourceId" class="source-task-content" />
    <TaskView v-else hide-header class="source-task-content" />
  </section>
</template>

<style scoped>
.source-tasks { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.source-task-tabs { display: flex; gap: 4px; padding: 8px 12px; }
.source-task-tabs button { border: 0; border-radius: 6px; padding: 6px 12px; background: transparent; color: var(--rc-muted); cursor: pointer; }
.source-task-tabs button.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.source-task-content { flex: 1; min-height: 0; }
</style>
