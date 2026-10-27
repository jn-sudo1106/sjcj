<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowRight, Clock, Coin, DArrowLeft, Search, Star } from '@element-plus/icons-vue'
import type { EntryType } from '@/api'

const props = defineProps<{
  tables: EntryType[]
  selectedId: string
  favoriteIds: string[]
  recentIds: string[]
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ select: [EntryType]; collapse: []; retry: [] }>()
const keyword = ref('')
const expanded = ref(new Set(['favorites', 'recent', 'MYSQL']))
const matches = (table: EntryType) => [table.name, table.tableName, table.tableId]
  .some(value => value?.toLowerCase().includes(keyword.value.trim().toLowerCase()))
const matchesSearch = computed(() => props.tables.filter(matches))
const sections = computed(() => {
  const byId = new Map(props.tables.map(table => [table.tableId, table]))
  const fromIds = (ids: string[]) => ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : [])
  return [
    { key: 'favorites', label: '我的收藏', icon: Star, tables: fromIds(props.favoriteIds), empty: '收藏常用表后会显示在这里' },
    { key: 'recent', label: '最近查看', icon: Clock, tables: fromIds(props.recentIds), empty: '查看过的表会显示在这里' },
    { key: 'MYSQL', label: 'MYSQL', icon: Coin, tables: props.tables.filter(table => (table.dsKind ?? 'MYSQL') === 'MYSQL'), empty: '暂无 MYSQL 表' },
    { key: 'CK', label: 'CK', icon: Coin, tables: props.tables.filter(table => table.dsKind === 'CK'), empty: '暂无 CK 表' },
  ]
})
function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
</script>

<template>
  <aside class="dt-sidebar" aria-label="数据表导航" data-testid="data-table-sidebar">
    <header><strong>数据表</strong><button class="dt-collapse" type="button" title="收起数据表导航" aria-label="收起数据表导航" @click="emit('collapse')"><el-icon><DArrowLeft /></el-icon></button></header>
    <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜表名 / ID" aria-label="搜索表名或 ID" data-testid="data-table-search" />
    <div class="dt-navigation" v-loading="loading">
      <div v-if="error" class="dt-message" role="alert">{{ error }}<button class="rc-btn" type="button" @click="emit('retry')">重新加载</button></div>
      <template v-else-if="keyword.trim()">
        <span class="dt-search-count">找到 {{ matchesSearch.length }} 张表</span>
        <button v-for="table in matchesSearch" :key="table.tableId" class="dt-entry" :class="{ active: table.tableId === selectedId }" type="button" :data-table-id="table.tableId" :aria-current="table.tableId === selectedId ? 'true' : undefined" :title="`${table.name || table.tableName} · ${table.tableId} · ${table.dsKind ?? 'MYSQL'}`" @click="emit('select', table)">
          <span class="dt-entry-name">{{ table.name || table.tableName }}</span><span class="dt-entry-id">{{ table.tableId }} · {{ table.dsKind ?? 'MYSQL' }}</span>
        </button>
        <p v-if="!matchesSearch.length && !loading" class="dt-message">没有匹配的数据表</p>
      </template>
      <template v-else>
        <section v-for="section in sections" :key="section.key">
          <div v-if="section.key === 'MYSQL'" class="dt-all-tables"><el-icon><Coin /></el-icon>全部表 <span>{{ tables.length }}</span></div>
          <button class="dt-section" type="button" :data-group="section.key" :aria-expanded="expanded.has(section.key)" @click="toggle(section.key)">
            <el-icon><ArrowDown v-if="expanded.has(section.key)" /><ArrowRight v-else /></el-icon><el-icon><component :is="section.icon" /></el-icon><span>{{ section.label }}</span><span class="dt-section-count">{{ section.tables.length }}</span>
          </button>
          <div v-if="expanded.has(section.key)" class="dt-entries">
            <button v-for="table in section.tables" :key="table.tableId" class="dt-entry" :class="{ active: table.tableId === selectedId }" type="button" :data-table-id="table.tableId" :aria-current="table.tableId === selectedId ? 'true' : undefined" :title="`${table.name || table.tableName} · ${table.tableId} · ${table.dsKind ?? 'MYSQL'}`" @click="emit('select', table)">
              <span class="dt-entry-name">{{ table.name || table.tableName }}</span><span class="dt-entry-id">{{ table.tableId }}</span>
            </button>
            <p v-if="!section.tables.length && !loading" class="dt-message">{{ section.empty }}</p>
          </div>
        </section>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.dt-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px 10px; border-right: 1px solid var(--rc-border-soft); background: var(--rc-surface, #fff); }
.dt-sidebar header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; margin-bottom: 10px; padding-left: 4px; font-size: 13px; }
.dt-collapse { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--rc-radius-sm); background: transparent; color: var(--rc-faint); font-size: 14px; cursor: pointer; }
.dt-collapse:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dt-collapse:focus-visible, .dt-entry:focus-visible, .dt-section:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: -2px; }
.dt-navigation { min-height: 0; overflow-y: auto; margin-top: 12px; scrollbar-width: thin; }
.dt-section { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px 4px; color: var(--rc-text-2); border: 0; border-radius: var(--rc-radius-sm); background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.dt-section > .el-icon { color: var(--rc-muted); }
.dt-section:hover { background: var(--rc-primary-bg); }
.dt-section-count { margin-left: auto; color: var(--rc-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.dt-entries { padding: 2px 0 8px 12px; }
.dt-entry { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; padding: 9px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--rc-text); font: inherit; text-align: left; cursor: pointer; }
.dt-entry:hover { background: var(--rc-primary-bg); }
.dt-entry.active { color: var(--rc-primary-ink); background: var(--rc-primary-bg); }
.dt-entry-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.dt-entry-id { flex: none; font-size: 11px; color: var(--rc-muted); font-variant-numeric: tabular-nums; }
.dt-message { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 6px 8px; margin: 0; color: var(--rc-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.dt-all-tables { display: flex; align-items: center; gap: 7px; padding: 13px 4px 4px; margin-top: 8px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-text-2); font-size: 12px; }
.dt-all-tables span { margin-left: auto; color: var(--rc-muted); font-size: 11px; }
.dt-search-count { display: block; padding: 0 8px 6px; color: var(--rc-muted); font-size: 11px; }
@media (max-width: 1100px) { .dt-entry { flex-wrap: wrap; gap: 2px; } .dt-entry-name { flex-basis: 100%; } }
</style>
