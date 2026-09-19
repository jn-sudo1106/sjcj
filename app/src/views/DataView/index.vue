<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DataQueryTab from './DataQueryTab.vue'
import EntryTab from './EntryTab.vue'

// 数据中心的两个 tab（2026-09-19）。此前这里是单页，只有数据查询；「表 ID 列表」
// 原本挂在采集资产下，这次迁过来——表结构是"数据"这条线的东西，跟查数据放一起才顺，
// 采集资产那边管的是网站与源。采集资产的 tab 条保留（当前只剩「网站列表」一项）。
//
// 结构照搬 CollectAssets/index.vue：tab 落 URL query，刷新和深链回得到同一个 tab。
const TABS: { key: string; label: string }[] = [
  { key: 'query', label: '数据查询' },
  { key: 'entry', label: '表 ID 列表' },
]
const comps: Record<string, Component> = { query: DataQueryTab, entry: EntryTab }
const route = useRoute()
const router = useRouter()
const validTabs = new Set(TABS.map((tab) => tab.key))
const active = ref('query')
function normalizeTab(tab: unknown): string {
  const key = String(tab ?? '')
  return validTabs.has(key) ? key : 'query'
}
watch(() => route.query.tab, (tab) => {
  active.value = normalizeTab(tab)
}, { immediate: true })
function selectTab(key: string) {
  const tab = normalizeTab(key)
  // 默认 tab 不写进 URL，保持 /data 这个地址干净（与采集资产同口径）
  const query = tab === 'query' ? {} : { tab }
  void router.replace({ path: '/data', query })
}
</script>

<template>
  <div class="dc-page-wrap">
    <div class="dc-tabs-wrap">
      <div class="dc-tabs-inner">
        <button
          v-for="t in TABS"
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
