<script setup lang="ts">
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import TaskListTab from './TaskListTab.vue'
import LogsTab from './LogsTab.vue'
import SqlTaskTab from './SqlTaskTab.vue'
import ConnectionsTab from './ConnectionsTab.vue'

// 1008-10：SQL 执行 / 建表 SQL 两个页签（10-13 用户定：不带「新」角标），插在同步日志与环境配置之间
const componentMap = {
  tasks: TaskListTab,
  logs: LogsTab,
  sql: SqlTaskTab,
  table: SqlTaskTab,
  connections: ConnectionsTab,
}

const { tabs, activeTab, selectTab, currentComponent } = useDynamicTabs({
  componentMap,
  fallbackTabs: [
    { key: 'tasks', label: '同步任务', order: 1 },
    { key: 'logs', label: '同步日志', order: 2 },
    { key: 'sql', label: 'SQL 执行', order: 3 },
    { key: 'table', label: '建表 SQL', order: 4 },
    { key: 'connections', label: '环境配置', order: 5 },
  ],
})
</script>

<template>
  <div class="sync-page">
    <div class="sync-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="sync-tab"
        :class="{ active: activeTab?.key === tab.key }"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="sync-content">
      <KeepAlive>
        <component
          :is="currentComponent"
          v-if="currentComponent"
          :key="activeTab?.key"
          :page="activeTab?.key === 'table' ? 'table' : 'sql'"
        />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.sync-page { display: flex; flex-direction: column; gap: 12px; min-height: 100%; }
.sync-tabs { display: inline-flex; align-self: flex-start; gap: 4px; padding: 4px; background: #f1f5f9; border-radius: 10px; }
.sync-tab { border: 0; background: transparent; padding: 6px 16px; color: #64748b; font-size: 13px; font-weight: 600; border-radius: 7px; cursor: pointer; }
.sync-tab.active { background: #fff; color: #0f172a; box-shadow: 0 1px 3px #0000001a; }
/* 外框令牌同监控中心、指标中心各页（1107 页面盘点：此前是 12px 圆角、16px 内边距） */
.sync-content { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); padding: 12px; min-width: 0; }
</style>
