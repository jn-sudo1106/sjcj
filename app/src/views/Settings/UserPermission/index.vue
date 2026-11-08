<script setup lang="ts">
// 用户权限设置（1030）：侧栏「系统设置」组下的第二个二级入口，页内两个 tab —— 数据权限设置、用户管理。
// 动态 Tab 架构改造：使用 useDynamicTabs 接入后端动态资源配置与权限过滤，保留本地 USER_PERMISSION_TABS 兜底。
import type { Component } from 'vue'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import { USER_PERMISSION_TABS } from '@/router/tabs'
import DataPermissionTab from '../DataPermissionTab.vue'
import UserManagementTab from '../UserManagementTab.vue'
import RolePermissionTab from './RolePermissionTab.vue'

const componentMap: Record<string, Component> = {
  users: UserManagementTab,
  roles: RolePermissionTab,
  'data-permission': DataPermissionTab,
}

const { tabs, activeTab, currentComponent, selectTab } = useDynamicTabs({
  componentMap,
  fallbackTabs: USER_PERMISSION_TABS.map((t, idx) => ({ ...t, order: idx + 1 })),
})

// 这几个页签根元素自己就是白底卡片（rc-card），容器不再套卡片，免得卡片套卡片
const SELF_FRAMED_TABS = new Set(['users'])
</script>

<template>
  <div class="up-page">
    <div class="up-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="up-tab-link"
        :class="{ active: activeTab?.key === t.key }"
        type="button"
        data-testid="user-permission-tab"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="up-content" :class="{ 'is-framed': activeTab && !SELF_FRAMED_TABS.has(activeTab.key) }">
      <KeepAlive>
        <component :is="currentComponent" v-if="currentComponent" :key="activeTab?.key" />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.up-page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.up-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 页签内容统一白底卡片，令牌同监控中心各页（.sc-shell 等）；自带卡片的页签不再套一层 */
.up-content.is-framed { padding: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: auto; }
.up-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
/* 页签与监控中心、规则资产等模块同一套样式（1107 页面盘点：此前选中文字是天蓝色） */
.up-tab-link {
  border: 0;
  background: transparent;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.up-tab-link:hover { color: #0f172a; }
.up-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
</style>
