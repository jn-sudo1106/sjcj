<script setup lang="ts">
// 问数系统配置（1015）：旧 ai-chat-view「系统配置」组的两个侧栏子页（/config 参数设置、/page-config 页面配置）
// 收成侧栏「问数配置」组下的一个菜单，子模块在这里以 tab 呈现，结构与口径照本域「模板配置」页
// （views/TemplateConfig/index.vue）：tab 落 URL query，刷新/深链回得到同一个 tab。
// tab 元数据在 router/tabs.ts 的 SYSTEM_CONFIG_TABS —— SYSTEM_CONFIG_TABS[0]（参数设置）是无 ?tab= 时的默认。
// 页面代码放在 TemplateConfig 目录下（与模板配置同属问数配置域），不改 components/ 下的通用组件。
import type { Component } from 'vue'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import { SYSTEM_CONFIG_TABS } from '@/router/tabs'
import ParamConfigPage from './ParamConfig/index.vue'
import PageConfigPage from './PageConfig/index.vue'

defineOptions({ name: 'SystemConfigPage' })

const comps: Record<string, Component> = {
  'param-config': ParamConfigPage,
  'page-config': PageConfigPage,
}

// 页内 tab 由后端菜单下发（sys_menu menu_type=2，/system-config 下 2 条），
// 文案 / 顺序 / 权限码都以 route.meta.tabs 为准；本地常量只作接口没下发时的兜底。
// 默认 tab 仍是后端排序第一的那条（参数设置）。
const { tabs, activeTab, currentComponent, selectTab } = useDynamicTabs({
  componentMap: comps,
  fallbackTabs: SYSTEM_CONFIG_TABS.map((t, idx) => ({ ...t, order: idx + 1 })),
  path: '/system-config',
})
</script>

<template>
  <div class="sc-page">
    <div class="sc-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="sc-tab-link"
        :class="{ active: activeTab?.key === t.key }"
        type="button"
        :title="String(t.remark || t.desc || '')"
        data-testid="system-config-tab"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="sc-content">
      <transition name="fade-slide" mode="out-in">
        <component :is="currentComponent" v-if="currentComponent" :key="activeTab?.key" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.sc-page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.sc-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.sc-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.sc-tab-link {
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
.sc-tab-link:hover { color: #0f172a; }
.sc-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-slide-enter-from { opacity: 0; transform: translateY(8px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
