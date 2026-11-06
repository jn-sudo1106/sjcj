<script setup lang="ts">
import type { Component } from 'vue'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import MqList from './mqList/index.vue'
import FunctionBuild from './functionBuild/index.vue'
import UrlBuild from './urlBuild/index.vue'
import ScheduleConfig from './scheduleConfig/index.vue'
import UrlBuildStatic from './urlBuildStatic/index.vue'
import OssUpload from './ossUpload/index.vue'

// 页内 tab 由后端菜单下发（sys_menu menu_type=2，/auxiliary-tool 下 6 条），本地这份只作兜底。
// ⚠️ tab 的 key 必须与 componentMap 的 key **逐字一致**，否则 key 查不到组件，
//    `<component :is="undefined">` 不报错、只是什么都不渲染 —— 页面就成了「tab 栏在、内容区空白」
//    这种最难查的形态。1020 就踩过：TABS 写 'mqList'（首字母小写），comps 里写 'MqList'（组件名）。
//    现在用 TabKey 联合类型 + Record<TabKey, Component> 把这件事交给编译器。
const FALLBACK_TABS = [
  { key: 'mqList', label: 'MQ队列' },
  { key: 'functionBuild', label: '函数工具' },
  { key: 'urlBuild', label: 'URL生成工具' },
  { key: 'scheduleConfig', label: '调度整体配置' },
  { key: 'urlBuildStatic', label: 'URL生成静态[备]' },
  { key: 'ossUpload', label: 'OSS上传' },
] as const
type TabKey = (typeof FALLBACK_TABS)[number]['key']

// key → 组件映射：改用具名组件 + <component :is>，好让内容区像「模板配置」一样带过渡切换
const componentMap: Record<TabKey, Component> = {
  mqList: MqList,
  functionBuild: FunctionBuild,
  urlBuild: UrlBuild,
  scheduleConfig: ScheduleConfig,
  urlBuildStatic: UrlBuildStatic,
  ossUpload: OssUpload,
}

const { tabs, activeTab, currentComponent, selectTab } = useDynamicTabs({
  componentMap,
  fallbackTabs: FALLBACK_TABS.map((t, idx) => ({ ...t, order: idx + 1 })),
  path: '/auxiliary-tool',
})
</script>

<template>
  <div class="ra-tabs-wrap">
    <div class="ra-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="ra-tab-link"
        :class="{ active: activeTab?.key === t.key }"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
  </div>

  <transition name="fade-slide" mode="out-in">
    <component :is="currentComponent" v-if="currentComponent" :key="activeTab?.key" />
  </transition>
</template>

<style scoped>
.ra-tabs-wrap {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 12px;
}
.ra-tabs-inner {
  display: inline-flex;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.ra-tab-link {
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
.ra-tab-link:hover {
  color: #0f172a;
}
.ra-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

/* 内容区切换过渡：与 TemplateConfig 保持同一套 fade-slide 效果 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
