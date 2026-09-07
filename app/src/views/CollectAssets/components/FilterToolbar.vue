<script setup lang="ts">
import { Search, Grid, List, Refresh } from '@element-plus/icons-vue'
import { sourceApi, type SourceCategory } from '@/api'

const props = defineProps<{
  keyword: string
  categoryFilter: string[]
  tagFilter: string
  stateFilter: string
  sortBy: 'updated' | 'name'
  categories: SourceCategory[]
  allTags: string[]
  total: number
  stats: { total: number; error: number; notify: number }
  view: 'card' | 'table'
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:categoryFilter': [value: string[]]
  'update:tagFilter': [value: string]
  'update:stateFilter': [value: string]
  'update:sortBy': [value: 'updated' | 'name']
  'setView': [value: 'card' | 'table']
  'filterChange': []
  'refresh': []
}>()

function onKeywordInput(value: string) {
  emit('update:keyword', value)
}

// 分类筛选是树形多选（旧平台目录树勾选语义；选中值是目录 ID 数组，空数组 = 全部）。
// 清空/异常值回传 []，与旧筛选值口径一致。
function onCategoryChange(value: unknown) {
  const ids = Array.isArray(value) ? value.map((v) => String(v)) : []
  emit('update:categoryFilter', ids)
  emit('filterChange')
}

// 旧分类接口首屏只返回根节点；树节点展开时按 parentId 懒加载子级。
// 与 MoreSourcesDialog 的分类树同一加载口径：children 已在数据里时直接用，避免重复请求。
async function loadCategoryChildren(
  node: { level: number; data: SourceCategory },
  resolve: (nodes: SourceCategory[]) => void,
) {
  if (node.level === 0) {
    resolve(props.categories)
    return
  }
  if (node.data.children?.length) {
    resolve(node.data.children)
    return
  }
  try {
    resolve(await sourceApi.sourceCategories(node.data.id))
  } catch {
    resolve([])
  }
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
    <!-- 分类树：多级目录按需展开（首屏根节点 + 一层子级由列表页预取，更深层级展开时懒加载）。
         多选复选框用 Element Plus 标准样式（与表格选择列等全站 checkbox 一致，主题色由全局
         tokens 统一）；check-strictly 让父子独立勾选——子级是懒加载的，级联勾选会把未加载的
         孙级 ID 漏出 categoryIds，后端 IN 匹配会漏数据。 -->
    <el-tree-select
      :model-value="categoryFilter"
      placeholder="全部分类"
      class="ca-category"
      popper-class="ca-category-popper"
      clearable
      multiple
      collapse-tags
      collapse-tags-tooltip
      :max-collapse-tags="1"
      check-strictly
      :data="categories"
      :props="{ label: 'name', children: 'children' }"
      node-key="id"
      lazy
      :load="loadCategoryChildren"
      @update:model-value="onCategoryChange"
    >
      <template #default="{ data }">
        <span class="ca-category-node">
          <span>{{ data.name }}</span>
          <span v-if="data.count != null" class="ca-category-count">{{ data.count }}</span>
        </span>
      </template>
    </el-tree-select>
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
.ca-category { width: 150px; flex: 0 0 150px; }
.ca-category-node { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.ca-category-count { color: var(--rc-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
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

<style>
/* 分类树下拉面板 teleport 到 body，无法 scoped；输入框 150px 放不下多级缩进，
   面板单独放宽（13.6 寸基准，不覆盖页面）。 */
.ca-category-popper { min-width: 248px; }
</style>
