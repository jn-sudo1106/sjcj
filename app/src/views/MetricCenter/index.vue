<script setup lang="ts">
// 指标中心三个页签的容器：指标数据集 / 指标列表 / 指标结果。
//
// 页签状态放在 query 的 `tab` 上（旧平台是三张独立路由 + $multiTab，新平台收敛成一个入口）。
// 除了 `tab`，还有一组**跨页签共享的上下文键**要在切页签时保留：
//   sourceId / entryTypeId / entryType / datasetId / datasetName / configId
// 这些键由页面消费：indicatorDataset 用 sourceId / entryTypeId 决定「增加数据集」是否出现，
// indicatorsList 用 sourceId / entryTypeId / datasetId / configId 预置筛选条件。
// 1014 起页面内**没有**再往 query 写这些键的入口了（指标三件套已改成原地弹层，见
// indicatorDataset 文件头偏差第 1 条），保留这组键是为了「手工拼 URL / 外部深链」进来的场景：
// 带着上下文的链接切一下页签还能把条件留住，不至于一点就丢。
//
// ⚠️ 动作类键（`add`）**不保留**：它是「进页就自动打开新增弹窗」的一次性指令，跟着页签跑会变成
// 「每次点回指标列表都弹一次新增」。（该机制本身已在 1014 随跳页一起删除，这条留着是防回潮。）
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
const TABS: { key: string; label: string }[] = [
  { key: 'indicatorDataset', label: '指标数据集' },
  { key: 'indicatorsList', label: '指标列表' },
  { key: 'indicatorsResult', label: '指标结果' },
]
/** 切页签时保留的上下文键（与 indicatorDataset/index.vue 的 openMeasureList 写进去的键同一套） */
const CARRY_KEYS = ['sourceId', 'entryTypeId', 'entryType', 'datasetId', 'datasetName', 'configId'] as const
import IndicatorDataset from './indicatorDataset/index.vue'
import IndicatorsList from './indicatorsList/index.vue'
import IndicatorsResult from './indicatorsResult/index.vue'

// key → 组件映射：改用具名组件 + <component :is>，好让内容区像「模板配置 / 监控」一样带过渡切换
const comps: Record<string, Component> = {
  indicatorDataset: IndicatorDataset,
  indicatorsList: IndicatorsList,
  indicatorsResult: IndicatorsResult,
}

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
  const query: Record<string, string> = {}
  CARRY_KEYS.forEach((k) => {
    const raw = route.query[k]
    const text = (Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')).trim()
    if (text) query[k] = text
  })
  // 默认页签（指标数据集）不带 tab 键，URL 更干净；旧版这一行为保留
  const isDefault = key === 'indicatorDataset'
  void router.replace({
    path: '/metrics',
    query: isDefault ? query : { tab: key, ...query },
  })
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

/* 内容区切换过渡：与 TemplateConfig / Monitor 保持同一套 fade-slide 效果 */
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
