<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SourceTab from './SourceTab.vue'
import ConfigTab from './ConfigTab.vue'
import EntryTab from './EntryTab.vue'

// 旧「配置列表」入口保持隐藏。注意 0721 会议 §五 Phase D 的"配置列表根本没用"已被 0824 复议推翻
//（0824-00 §3.1 与复议 4：配置管理入口恢复，但载体改为配置中心的「配置包」，走 /configs）。
// 这里仍不放出旧入口，理由不是"配置管理没用"，而是粒度对不上：一条旧 config ≈ 包内一个节点，
// 而配置包 = 整条节点链 + 各节点右侧共享配置（0824-09 R1），旧 configPaged 撑不起配置包列表。
// ConfigTab 组件本体和路由暂不删，留作旧数据只读排查。
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
