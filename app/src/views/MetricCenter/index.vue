<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const TABS: { key: string; label: string }[] = [
  { key: 'indicatorDataset', label: '指标数据集' },
  { key: 'indicatorsList', label: '指标列表' },
  { key: 'indicatorsResult', label: '指标结果' },
]
import IndicatorDataset from './indicatorDataset/index.vue'
import IndicatorsList from './indicatorsList/index.vue'
import IndicatorsResult from './indicatorsResult/index.vue'

const route = useRoute()
const router = useRouter()
const activeTab = ref('indicatorDataset')
watch(
  () => route.query.tab,
  (tab) => {
    const key = String(tab ?? '')
    activeTab.value = TABS.some((t) => t.key === key) ? key : 'indicatorDataset'
  },
  { immediate: true },
)
function selectTab(key: string) {
  void router.replace({ path: '/metrics', query: key === 'indicatorDataset' ? {} : { tab: key } })
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

  <IndicatorDataset v-if="activeTab === 'indicatorDataset'" />
  <IndicatorsList v-else-if="activeTab === 'indicatorsList'" />
  <IndicatorsResult v-else />
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
</style>
