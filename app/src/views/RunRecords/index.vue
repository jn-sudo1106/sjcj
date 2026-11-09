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
    <!-- 页签样式与监控中心、规则资产、指标中心一致（1105 会议：任务中心样式与其他页面对齐） -->
    <nav class="ra-tabs-inner" aria-label="任务类型">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="ra-tab-link"
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
.task-center { min-height: 0; height: 100%; display: flex; flex-direction: column; gap: 12px; }
.task-content { flex: 1; min-height: 0; }
.ra-tabs-inner { align-self: flex-start; display: inline-flex; padding: 4px; background: #f1f5f9; border-radius: 10px; gap: 4px; }
.ra-tab-link { border: 0; background: transparent; padding: 6px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-radius: 7px; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
.ra-tab-link:hover { color: #0f172a; }
.ra-tab-link.active { background: #ffffff; color: #0f172a; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); }
</style>
