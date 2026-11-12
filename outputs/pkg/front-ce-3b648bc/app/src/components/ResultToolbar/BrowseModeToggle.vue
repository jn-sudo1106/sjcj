<script setup lang="ts">
// 「按数据表 / 按步骤」查看方式切换（1008-07 从 ResultView 抽出）：两个图标按钮，当前项 aria-pressed。
import { Connection, Grid } from '@element-plus/icons-vue'

export type BrowseMode = 'table' | 'step'
defineProps<{ modelValue: BrowseMode }>()
const emit = defineEmits<{ 'update:modelValue': [BrowseMode] }>()
</script>

<template>
  <div class="browse-mode-toggle" role="group" aria-label="数据查看方式">
    <button type="button" title="按数据表查看" aria-label="按数据表查看" :aria-pressed="modelValue === 'table'" @click="emit('update:modelValue', 'table')"><el-icon><Grid /></el-icon></button>
    <button type="button" title="按步骤查看" aria-label="按步骤查看" :aria-pressed="modelValue === 'step'" @click="emit('update:modelValue', 'step')"><el-icon><Connection /></el-icon></button>
  </div>
</template>

<style scoped>
.browse-mode-toggle { display: inline-flex; flex: none; gap: 2px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); padding: 2px; }
.browse-mode-toggle button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px; background: var(--rc-surface); color: var(--rc-text-2); font-size: 14px; cursor: pointer; }
.browse-mode-toggle button:hover { background: #f1f5f9; color: var(--rc-primary-ink); }
.browse-mode-toggle button[aria-pressed="true"] { background: var(--rc-primary-bg); color: var(--rc-primary); }
</style>
