<script setup lang="ts">
import { Search, Grid, List, Refresh } from '@element-plus/icons-vue'
import type { SourceCategory } from '@/api'

defineProps<{
  keyword: string
  categoryFilter: string
  tagFilter: string
  stateFilter: string
  sortBy: 'updated' | 'name'
  categories: SourceCategory[]
  allTags: string[]
  total: number
  stats: { total: number; error: number; notify: number }
  view: 'card' | 'table'
  hasFilter: boolean
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:categoryFilter': [value: string]
  'update:tagFilter': [value: string]
  'update:stateFilter': [value: string]
  'update:sortBy': [value: 'updated' | 'name']
  'setView': [value: 'card' | 'table']
  'filterChange': []
  'clearFilters': []
  'refresh': []
}>()

function onKeywordInput(value: string) {
  emit('update:keyword', value)
}

function categoryLabel(category: SourceCategory, child = false) {
  const prefix = child ? ' └ ' : ''
  return `${prefix}${category.name}${category.count == null ? '' : `（${category.count}）`}`
}
</script>

<template>
  <div class="ca-toolbar">
    <el-input
      :model-value="keyword"
      :prefix-icon="Search"
      clearable
      placeholder="搜索网站名 / 源名"
      class="ca-search"
      @input="onKeywordInput"
    />
    <el-select :model-value="categoryFilter" placeholder="全部分类" style="width: 150px" clearable @update:model-value="(v: string) => { emit('update:categoryFilter', v); emit('filterChange') }">
      <el-option label="全部分类" value="" />
      <template v-for="g in categories" :key="g.id">
        <el-option :label="categoryLabel(g)" :value="g.id" />
        <el-option v-for="c in g.children" :key="c.id" :label="categoryLabel(c, true)" :value="c.id" />
      </template>
    </el-select>
    <el-select :model-value="tagFilter" placeholder="全部标签" style="width: 130px" clearable @update:model-value="(v: string) => { emit('update:tagFilter', v); emit('filterChange') }">
      <el-option label="全部标签" value="" />
      <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
    </el-select>
    <el-select :model-value="stateFilter" placeholder="全部状态" style="width: 130px" clearable @update:model-value="(v: string) => { emit('update:stateFilter', v); emit('filterChange') }">
      <el-option label="全部状态" value="all" />
      <el-option label="有异常源" value="error" />
    </el-select>
    <el-select :model-value="sortBy" style="width: 120px" @update:model-value="(v: 'updated' | 'name') => emit('update:sortBy', v)">
      <el-option label="最近修改" value="updated" />
      <el-option label="名称" value="name" />
    </el-select>
    <el-button v-if="hasFilter" text class="ca-clear-filter" @click="emit('clearFilters')">清空</el-button>
    <div class="ca-stats">
      <el-tag type="info" effect="plain" class="stat-tag">网站 <b>{{ total }}</b></el-tag>
      <el-tag type="info" effect="plain" class="stat-tag">源 <b>{{ stats.total }}</b></el-tag>
      <el-tag v-if="stats.error > 0" type="danger" class="stat-tag">出错源 <b>{{ stats.error }}</b></el-tag>
      <el-tag v-if="stats.notify > 0" type="warning" class="stat-tag">告警网站 <b>{{ stats.notify }}</b></el-tag>
    </div>
    <span class="ca-spacer" />
    <div class="ca-view-toggle">
      <button class="ca-view-btn" :class="{ active: view === 'card' }" type="button" title="卡片视图" @click="emit('setView', 'card')"><el-icon :size="14"><Grid /></el-icon>卡片</button>
      <button class="ca-view-btn" :class="{ active: view === 'table' }" type="button" title="表格视图" @click="emit('setView', 'table')"><el-icon :size="14"><List /></el-icon>表格</button>
    </div>
    <button class="ca-refresh" type="button" title="刷新" @click="emit('refresh')"><el-icon :size="14"><Refresh /></el-icon></button>
  </div>
</template>

<style scoped>
.ca-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}
.ca-search { width: 250px; flex: 0 0 250px; }
.ca-search :deep(.el-input__wrapper) { border-radius: 6px; min-height: 34px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
.ca-search :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px #bfdbfe inset; }
.ca-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  white-space: nowrap;
}
.stat-tag { font-size: 12px; }
.stat-tag b { font-weight: 800; font-size: 13px; margin-left: 3px; }
.ca-spacer { flex: 1; min-width: 12px; }

.ca-clear-filter { flex: none; padding: 0 4px; height: 30px; font-size: 12px; }
.ca-view-toggle {
  display: inline-flex;
  gap: 0;
  padding: 2px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #f8fafc;
}
.ca-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.ca-view-btn:hover { color: var(--rc-primary-ink); }
.ca-view-btn.active { color: var(--rc-primary); font-weight: 700; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
.ca-refresh {
  width: 34px;
  height: 34px;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ca-refresh:hover { border-color: #bfdbfe; color: var(--rc-primary); }

@media (max-width: 1240px) {
  .ca-toolbar { flex-wrap: wrap; }
  .ca-search { flex: 1 1 260px; width: auto; }
  .ca-stats { order: 2; flex: 1 1 100%; }
  .ca-stats span:first-child { padding-left: 0; }
}
</style>
