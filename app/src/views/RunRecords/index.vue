<script setup lang="ts">
import TaskView from '@/views/FlowCanvas/result/TaskView.vue'
import CodeGenerationTasks from './CodeGenerationTasks.vue'
import { useRoute } from 'vue-router'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
const route = useRoute()

// 任务类型页签由后端菜单下发（sys_menu menu_type=2：collection / code-generation），
// 本地这份兜底只在菜单接口没下发时生效。
const { tabs, activeTab, selectTab } = useDynamicTabs({
  fallbackTabs: [
    { key: 'collection', label: '采集任务', order: 1 },
    { key: 'code-generation', label: '代码生成', order: 2 },
  ],
})

// AppShell 的 KeepAlive 按这个名字缓存任务中心：从任务点进源再返回，不用再等一次十几秒的查询
defineOptions({ name: 'TaskCenter' })
</script>

<template>
  <div class="task-center">
    <nav class="task-tabs" aria-label="任务类型">
      <button
        v-for="t in tabs"
        :key="t.key"
        :class="{ active: activeTab?.key === t.key }"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </nav>
    <CodeGenerationTasks
      v-if="activeTab?.key === 'code-generation'"
      :initial-config-id="typeof route.query.codeConfigId === 'string' ? route.query.codeConfigId : ''"
      :initial-task-id="typeof route.query.codeTaskId === 'string' ? route.query.codeTaskId : ''"
      class="task-content"
    />
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
