<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceStore } from '../../stores/workspace'
import CompareResultPane from './CompareResultPane.vue'

// 分屏对比容器（0701 问题三 · 方案 C）：左栏固定为当前活动页签，右栏可从其余已开页签中切换。
// 两栏各自独立（CompareResultPane 不共享状态），不影响正常单栏视图的既有实现。
const ws = useWorkspaceStore()

const leftId = computed(() => ws.activeSourceId)
const leftName = computed(() => ws.tabs.find((t) => t.sourceId === leftId.value)?.name ?? leftId.value)
const rightId = computed(() => ws.compareSourceId)
const rightName = computed(() => ws.tabs.find((t) => t.sourceId === rightId.value)?.name ?? rightId.value)
// 网站伪页签（`site:xxx`，0707 优化·Phase4）不参与对比：CompareResultPane 按真实 sourceId 查详情/子步骤，
// 传网站伪 id 会命中 mockSourceDetail 的 SOURCES[0] 兜底、加载成不相关的源（与 SourceTabsBar 的排除口径一致）。
const otherTabs = computed(() => ws.tabs.filter((t) => t.sourceId !== leftId.value && !t.sourceId.startsWith('site:')))

function onSwitchRight(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (v) ws.enterCompare(v)
}
</script>

<template>
  <div class="cs-shell">
    <div class="cs-toolbar">
      <span class="cs-title">并排对比</span>
      <span class="cs-hint">左栏跟随当前活动页签；右栏可切换为其余已打开的源</span>
      <span class="cs-spacer" />
      <select class="cs-select" :value="rightId" @change="onSwitchRight">
        <option value="" disabled>选择要对比的源</option>
        <option v-for="t in otherTabs" :key="t.sourceId" :value="t.sourceId">{{ t.name }}</option>
      </select>
      <button class="rc-btn" type="button" @click="ws.exitCompare()">退出对比</button>
    </div>
    <div class="cs-body">
      <CompareResultPane v-if="leftId" :key="leftId" :source-id="leftId" :label="leftName" />
      <div class="cs-divider" aria-hidden="true" />
      <CompareResultPane v-if="rightId" :key="rightId" :source-id="rightId" :label="rightName" />
      <div v-else class="cs-empty">当前只有一个已打开的源，请先在其他页签打开另一个源再对比</div>
    </div>
  </div>
</template>

<style scoped>
.cs-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cs-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--rc-border); border-bottom: 0; border-radius: var(--rc-radius) var(--rc-radius) 0 0; background: #fff; }
.cs-title { font-size: 13px; font-weight: 700; color: var(--rc-text); }
.cs-hint { font-size: 11px; color: var(--rc-faint); }
.cs-spacer { flex: 1; }
.cs-select { height: 30px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; max-width: 200px; }
.cs-body { flex: 1; min-height: 0; display: flex; gap: 0; border: 1px solid var(--rc-border); border-top: 0; border-radius: 0 0 var(--rc-radius) var(--rc-radius); overflow: hidden; background: var(--rc-border-soft); }
.cs-body > * { flex: 1 1 50%; min-width: 0; }
.cs-divider { flex: none !important; width: 1px; background: var(--rc-border); }
.cs-empty { display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; background: #fff; }
</style>
