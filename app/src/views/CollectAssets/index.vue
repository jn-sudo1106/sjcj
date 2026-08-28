<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SourceTab from './SourceTab.vue'
import ConfigTab from './ConfigTab.vue'
import EntryTab from './EntryTab.vue'

// 旧「配置列表」入口保持隐藏。最新口径把流程与节点配置拆开管理，旧 configPaged 只覆盖
// 节点配置的一部分，不能直接作为新的配置中心。ConfigTab 组件暂不删，留作旧数据只读排查。
const TABS: { key: string; label: string }[] = [
  { key: 'source', label: '网站列表' },
  { key: 'entry', label: '表 ID 列表' },
]
const comps: Record<string, Component> = { source: SourceTab, config: ConfigTab, entry: EntryTab }
const route = useRoute()
const router = useRouter()
const validTabs = new Set(TABS.map((tab) => tab.key))
const active = ref('source')
function normalizeTab(tab: unknown): string {
  const key = String(tab ?? '')
  return validTabs.has(key) ? key : 'source'
}
// 参数模块、流程模板都迁到规则资产（0721 会议 §六-1；流程模板见 0812 计划 M4-9）：
// 旧链接 /collect?tab=param / tab=template 重定向到新位置，保留一个迭代周期
watch(() => route.query.tab, (tab) => {
  if (tab === 'param' || tab === 'template') {
    void router.replace(`/rules?tab=${tab}`)
    return
  }
  active.value = normalizeTab(tab)
}, { immediate: true })
function selectTab(key: string) {
  const tab = normalizeTab(key)
  const query = tab === 'source' ? {} : { tab }
  void router.replace({ path: '/collect', query })
}
</script>

<template>
  <div class="ca-page-wrap">
    <div class="ca-tabs-wrap">
      <div class="ca-tabs-inner">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="ca-tab-link"
          :class="{ active: active === t.key }"
          @click="selectTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
    </div>
    <div class="ca-content">
      <transition name="fade-slide" mode="out-in">
        <component :is="comps[active]" :key="active" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.ca-page-wrap { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.ca-tabs-wrap { display: flex; justify-content: flex-start; }
.ca-content { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.ca-tabs-inner {
  display: inline-flex;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.ca-tab-link {
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
.ca-tab-link:hover { color: #0f172a; }
.ca-tab-link.active {
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
