<script setup lang="ts">
import { ref, type Component } from 'vue'
import SourceTab from './SourceTab.vue'
import ConfigTab from './ConfigTab.vue'
import EntryTab from './EntryTab.vue'
import ParamTab from './ParamTab.vue'
import SourceTabsBar from '../FlowCanvas/SourceTabsBar.vue'

const TABS: { key: string; label: string }[] = [
  { key: 'source', label: '源列表' },
  { key: 'config', label: '配置列表' },
  { key: 'entry', label: '表 ID 列表' },
  { key: 'param', label: '参数列表' },
]
const comps: Record<string, Component> = { source: SourceTab, config: ConfigTab, entry: EntryTab, param: ParamTab }
const active = ref('source')
</script>

<template>
  <div>
    <div class="rc-tabs ca-tabs">
      <span
        v-for="t in TABS"
        :key="t.key"
        class="rc-tab-link"
        :class="{ active: active === t.key }"
        @click="active = t.key"
      >
        {{ t.label }}
      </span>
    </div>
    <!-- 源详情工作区页签条：挂在功能页签下方、仅「源列表」页签下显示（0702 追加优化） -->
    <SourceTabsBar v-if="active === 'source'" />
    <component :is="comps[active]" :key="active" />
  </div>
</template>

<style scoped>
.ca-tabs {
  margin-bottom: 12px;
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  padding: 0 16px;
  box-shadow: var(--rc-shadow);
}
</style>
