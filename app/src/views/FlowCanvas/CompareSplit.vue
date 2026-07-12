<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '../../stores/workspace'
import { sourceApi } from '../../api'
import CompareResultPane from './CompareResultPane.vue'

// 分屏对比容器（0701 问题三 · 方案 C；0710 会议 B4 与页签解耦）：左右栏都是真实 sourceId，
// 由子源侧栏（行内 ⇔ / 全局选择器）写入 workspace 的 compareLeftId/compareSourceId，不要求已打开页签。
// 两栏各自独立（CompareResultPane 不共享状态），不影响正常单栏视图的既有实现。
const ws = useWorkspaceStore()

const leftId = computed(() => ws.compareLeftId)
const rightId = computed(() => ws.compareSourceId)
// 栏头名称按 id 取详情（对比对象未必有页签，名称不再来自页签条）
const leftName = ref('')
const rightName = ref('')
async function nameOf(id: string): Promise<string> {
  if (!id) return ''
  const s = await sourceApi.sourceDetail(id)
  return s?.name ?? id
}
watch(leftId, async (id) => { leftName.value = await nameOf(id) }, { immediate: true })
watch(rightId, async (id) => { rightName.value = await nameOf(id) }, { immediate: true })
</script>

<template>
  <div class="cs-shell">
    <div class="cs-toolbar">
      <span class="cs-title">并排对比</span>
      <span class="cs-hint">左栏为发起对比时的当前子源；换右栏对象请在左侧子源侧栏点 ⇔</span>
      <span class="cs-spacer" />
      <button class="rc-btn" type="button" @click="ws.exitCompare()">退出对比</button>
    </div>
    <div class="cs-body">
      <CompareResultPane v-if="leftId" :key="leftId" :source-id="leftId" :label="leftName" />
      <div class="cs-divider" aria-hidden="true" />
      <CompareResultPane v-if="rightId" :key="rightId" :source-id="rightId" :label="rightName" />
      <div v-else class="cs-empty">请在左侧子源侧栏选择要对比的子源（行内 ⇔ 或底部「⇔ 对比」）</div>
    </div>
  </div>
</template>

<style scoped>
.cs-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.cs-toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--rc-border); border-bottom: 0; border-radius: var(--rc-radius) var(--rc-radius) 0 0; background: #fff; }
.cs-title { font-size: 13px; font-weight: 700; color: var(--rc-text); }
.cs-hint { font-size: 11px; color: var(--rc-faint); }
.cs-spacer { flex: 1; }
.cs-body { flex: 1; min-height: 0; display: flex; gap: 0; border: 1px solid var(--rc-border); border-top: 0; border-radius: 0 0 var(--rc-radius) var(--rc-radius); overflow: hidden; background: var(--rc-border-soft); }
.cs-body > * { flex: 1 1 50%; min-width: 0; }
.cs-divider { flex: none !important; width: 1px; background: var(--rc-border); }
.cs-empty { display: flex; align-items: center; justify-content: center; color: var(--rc-faint); font-size: 12px; background: #fff; }
</style>
