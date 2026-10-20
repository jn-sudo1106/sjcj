<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const TABS: { key: string; label: string }[] = [
  { key: 'mqList', label: 'MQ队列' },
  { key: 'functionBuild', label: '函数工具' },
  { key: 'urlBuild', label: 'URL生成工具' },
  { key: 'scheduleConfig', label: '调度整体配置' },
  { key: 'urlBuildStatic', label: 'URL生成静态[备]' },
  { key: 'ossUpload', label: 'OSS上传' },
]
import MqList from './mqList/index.vue'
import FunctionBuild from './functionBuild/index.vue'
import UrlBuild from './urlBuild/index.vue'
import ScheduleConfig from './scheduleConfig/index.vue'
import UrlBuildStatic from './urlBuildStatic/index.vue'
import OssUpload from './ossUpload/index.vue'

// key → 组件映射：改用具名组件 + <component :is>，好让内容区像「模板配置」一样带过渡切换
const comps: Record<string, Component> = {
  MqList: MqList,
  FunctionBuild: FunctionBuild,
  UrlBuild: UrlBuild,
  ScheduleConfig: ScheduleConfig,
  UrlBuildStatic: UrlBuildStatic,
  OssUpload: OssUpload,
}

const route = useRoute()
const router = useRouter()
const activeTab = ref('mqList')
watch(
  () => route.query.tab,
  (tab) => {
    const key = String(tab ?? '')
    activeTab.value = TABS.some((t) => t.key === key) ? key : 'mqList'
  },
  { immediate: true },
)
function selectTab(key: string) {
  void router.replace({ path: '/auxiliary-tool', query: key === 'mqList' ? {} : { tab: key } })
}
</script>

<template>
  <div class="ra-tabs-wrap">
    <div class="ra-tabs-inner">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="ra-tab-link"
        :class="{ active: activeTab === t.key }"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
  </div>

  <transition name="fade-slide" mode="out-in">
    <component :is="comps[activeTab]" :key="activeTab" />
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
