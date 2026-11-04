<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const TABS: { key: string; label: string }[] = [
  { key: 'sourceCheck', label: '数据源告警' },
  { key: 'sourceIssues', label: '源问题' },
  { key: 'queueCheck', label: '队列告警' },
  { key: 'commJob', label: '自定义告警' },
  { key: 'taskList', label: '任务实例' },
  { key: 'taskStat', label: '任务统计' },
]
import SourceCheck from './sourceCheck/index.vue'
import SourceIssuesView from './sourceIssues/SourceIssuesView.vue'
import QueueCheck from './queueCheck/index.vue'
import CommJob from './commJob/index.vue'
import TaskList from './taskList/index.vue'
import TaskStat from './taskStat/index.vue'

// key → 组件映射：改用具名组件 + <component :is>，好让内容区像「模板配置」一样带过渡切换
const comps: Record<string, Component> = {
  sourceCheck: SourceCheck,
  sourceIssues: SourceIssuesView,
  queueCheck: QueueCheck,
  commJob: CommJob,
  taskList: TaskList,
  taskStat: TaskStat,
}

const route = useRoute()
const router = useRouter()
const activeTab = ref('sourceCheck')
watch(
  () => route.query.tab,
  (tab) => {
    const key = String(tab ?? '')
    activeTab.value = TABS.some((t) => t.key === key) ? key : 'sourceCheck'
  },
  { immediate: true },
)
function selectTab(key: string) {
  void router.replace({ path: '/monitor', query: key === 'sourceCheck' ? {} : { tab: key } })
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
  transition: opacity 0.2s ease, transform 0.2s ease;
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
