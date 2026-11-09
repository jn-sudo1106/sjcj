<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import DataQueryTab from './DataQueryTab.vue'
import EntryTab from './EntryTab.vue'

// 数据中心的两个 tab（2026-09-19）。此前这里是单页，只有数据查询；「表 ID 列表」
// 原本挂在采集资产下，这次迁过来——表结构是"数据"这条线的东西，跟查数据放一起才顺，
// 采集资产那边管的是网站与源。
//
// 结构照搬 CollectAssets/index.vue：tab 落 URL query，刷新和深链回得到同一个 tab。
// 页内 tab 的数据源改为后端菜单（sys_menu menu_type=2，/data 下 2 条），下面的常量只作兜底。
const comps: Record<string, Component> = { query: DataQueryTab, entry: EntryTab }
const { tabs } = useDynamicTabs({
  componentMap: comps,
  fallbackTabs: [
    { key: 'query', label: '数据查询', order: 1 },
    { key: 'entry', label: '表 ID 列表', order: 2 },
  ],
  path: '/data',
  autoNormalizeQuery: false,
})
const route = useRoute()
const router = useRouter()
const validTabs = computed(() => new Set(tabs.value.map((tab) => tab.key)))
const active = ref('query')
function normalizeTab(tab: unknown): string {
  const key = String(tab ?? '')
  return validTabs.value.has(key) ? key : (tabs.value[0]?.key ?? 'query')
}
watch(() => route.query.tab, (tab) => {
  active.value = normalizeTab(tab)
}, { immediate: true })
function selectTab(key: string) {
  const tab = normalizeTab(key)
  // 默认 tab（后端排序第一条）不写进 URL，保持 /data 这个地址干净（与采集资产同口径）
  const query = tab === tabs.value[0]?.key ? {} : { tab }
  void router.replace({ path: '/data', query })
}
</script>

<template>
  <div class="dc-page-wrap">
    <div class="dc-tabs-wrap">
      <div class="dc-tabs-inner">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="dc-tab-link"
          :class="{ active: active === t.key }"
          data-testid="data-center-tab"
          @click="selectTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
    </div>
    <div class="dc-content">
      <transition name="fade-slide" mode="out-in">
        <component :is="comps[active]" :key="active" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.dc-page-wrap { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.dc-tabs-wrap { display: flex; justify-content: flex-start; }
.dc-content { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.dc-tabs-inner {
  display: inline-flex;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.dc-tab-link {
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
.dc-tab-link:hover { color: #0f172a; }
.dc-tab-link.active {
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
