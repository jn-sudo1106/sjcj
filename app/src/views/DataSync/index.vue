<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TaskListTab from './TaskListTab.vue'
import LogsTab from './LogsTab.vue'
import ConnectionsTab from './ConnectionsTab.vue'

const route = useRoute()
const router = useRouter()
const tabs = [{ key: 'tasks', label: '同步任务' }, { key: 'logs', label: '同步日志' }, { key: 'connections', label: '环境配置' }]
const active = computed(() => tabs.some((tab) => tab.key === route.query.tab) ? String(route.query.tab) : 'tasks')
function select(key: string) { void router.replace({ path: '/sync', query: key === 'tasks' ? {} : { tab: key } }) }
</script>

<template>
  <div class="sync-page">
    <div class="sync-tabs">
      <button v-for="tab in tabs" :key="tab.key" type="button" class="sync-tab" :class="{ active: active === tab.key }" @click="select(tab.key)">{{ tab.label }}</button>
    </div>
    <div class="sync-content"><TaskListTab v-if="active === 'tasks'" /><LogsTab v-else-if="active === 'logs'" /><ConnectionsTab v-else /></div>
  </div>
</template>

<style scoped>
.sync-page { display: flex; flex-direction: column; gap: 12px; min-height: 100%; }.sync-tabs { display: inline-flex; align-self: flex-start; gap: 4px; padding: 4px; background: #f1f5f9; border-radius: 10px; }.sync-tab { border: 0; background: transparent; padding: 6px 16px; color: #64748b; font-size: 13px; font-weight: 600; border-radius: 7px; cursor: pointer; }.sync-tab.active { background: #fff; color: #0f172a; box-shadow: 0 1px 3px #0000001a; }.sync-content { background: #fff; border: 1px solid #e5eaf2; border-radius: 12px; padding: 16px; min-width: 0; }
</style>
