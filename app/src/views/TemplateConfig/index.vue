<script setup lang="ts">
// 模板配置（1015）：侧栏入口收成「问数配置」下的一个菜单，原先 8 个侧栏子项改在这里以 tab 呈现，
// 结构与口径照「全局数据 → 数据中心」（views/DataView/index.vue）：tab 落 URL query，刷新/深链回得到同一个 tab。
// tab 元数据（标题、说明、权限码）统一在 router/tabs.ts 的 TEMPLATE_CONFIG_TABS，
// key 就是旧侧栏的 TAB key；8 个子模块不再有独立地址，只能通过 /template-config?tab= 访问。
import type { Component } from 'vue'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import { TEMPLATE_CONFIG_TABS } from '@/router/tabs'
import SqlTemplatePage from './SqlTemplatePage.vue'
import TableTemplatePage from './TableTemplate/index.vue'
import DicTemplatePage from './DicTemplate/index.vue'
import QuestionDicPage from './QuestionDic/index.vue'
import DataIndexSyncPage from './DataIndexSync/index.vue'
import DataIndexConfigPage from './DataIndexConfig/index.vue'
import ChatFlowStepPage from './ChatFlowStep/index.vue'
import WordSegmentConfigPage from './WordSegmentConfig/index.vue'

defineOptions({ name: 'TemplateConfigPage' })

const comps: Record<string, Component> = {
  'sql-template': SqlTemplatePage,
  'table-template': TableTemplatePage,
  'dic-template': DicTemplatePage,
  'question-dic': QuestionDicPage,
  'data-index-sync': DataIndexSyncPage,
  'data-index-config': DataIndexConfigPage,
  'chat-flow-step': ChatFlowStepPage,
  'word-segment-config': WordSegmentConfigPage,
}

// 页内 tab 由后端菜单下发（sys_menu menu_type=2，/template-config 下 8 条），
// 文案 / 顺序 / 权限码都以 route.meta.tabs 为准；本地常量只作接口没下发时的兜底。
const { tabs, activeTab, currentComponent, selectTab } = useDynamicTabs({
  componentMap: comps,
  fallbackTabs: TEMPLATE_CONFIG_TABS.map((t, idx) => ({ ...t, order: idx + 1 })),
  path: '/template-config',
})
</script>

<template>
  <div class="tc-page">
    <div class="tc-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tc-tab-link"
        :class="{ active: activeTab?.key === t.key }"
        type="button"
        :title="String(t.remark || t.desc || '')"
        data-testid="template-config-tab"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="tc-content">
      <transition name="fade-slide" mode="out-in">
        <component :is="currentComponent" v-if="currentComponent" :key="activeTab?.key" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.tc-page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.tc-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.tc-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.tc-tab-link {
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
.tc-tab-link:hover { color: #0f172a; }
.tc-tab-link.active {
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
