<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, ArrowRight, Coin, DArrowLeft, Folder, FolderOpened, Grid, Search } from '@element-plus/icons-vue'
import type { EntryType } from '@/api'
import { bizDirTables, loadDirChildren, type BizDirTables, type DirNode } from '@/api/sourceDirs'

const props = defineProps<{
  tables: EntryType[]
  selectedId: string
  scope: 'all' | 'favorites' | 'recent'
  loading: boolean
  error: string
}>()
const emit = defineEmits<{ select: [EntryType]; collapse: []; retry: [] }>()
const keyword = ref('')
const expanded = ref(new Set(['MYSQL']))
const matches = (table: EntryType) => [table.name, table.tableName, table.tableId]
  .some(value => value?.toLowerCase().includes(keyword.value.trim().toLowerCase()))
const matchesSearch = computed(() => props.tables.filter(matches))
const sections = computed(() => {
  return {
    db: [
      { key: 'MYSQL', label: 'MYSQL', icon: Coin, tables: props.tables.filter(table => (table.dsKind ?? 'MYSQL') === 'MYSQL'), empty: '暂无 MYSQL 表' },
      { key: 'CK', label: 'CK', icon: Coin, tables: props.tables.filter(table => table.dsKind === 'CK'), empty: '暂无 CK 表' },
    ],
  }
})
function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

// 「全部表」两个页签（10-28 孙总）：默认按业务目录，按数据库分的原样保留。
// 业务目录下的表 = 目录直属源涉及的输出表（口径和取数见 api/sourceDirs.ts bizDirTables），
// 逐级展开时才查，只列当前可选的表（props.tables 里没有的表点了也打不开）。
const tab = ref<'biz' | 'db'>('biz')
const dirChildren = ref(new Map<string, DirNode[]>())
const dirTables = ref(new Map<string, BizDirTables>())
const dirLoading = ref(new Set<string>())
const dirErrors = ref(new Map<string, string>())
const expandedDirs = ref(new Set<string>())
const ROOT = ''

function patch<T>(target: { value: Map<string, T> }, key: string, value: T | undefined) {
  const next = new Map(target.value)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  target.value = next
}
function setLoading(key: string, on: boolean) {
  const next = new Set(dirLoading.value)
  if (on) next.add(key)
  else next.delete(key)
  dirLoading.value = next
}
async function loadDir(id: string) {
  setLoading(id, true)
  patch(dirErrors, id, undefined)
  try {
    const [children, tables] = await Promise.all([loadDirChildren('biz', id), id ? bizDirTables(id) : Promise.resolve({ tableIds: [], failedFlowIds: [] })])
    patch(dirChildren, id, children)
    patch(dirTables, id, tables)
  } catch (error) {
    patch(dirErrors, id, `${id ? '读取目录下的表' : '读取业务目录'}失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    setLoading(id, false)
  }
}
function showTab(next: 'biz' | 'db') {
  tab.value = next
  if (next === 'biz' && !dirChildren.value.has(ROOT) && !dirLoading.value.has(ROOT)) void loadDir(ROOT)
}
showTab('biz')
function toggleDir(id: string) {
  const next = new Set(expandedDirs.value)
  if (next.has(id)) next.delete(id)
  else {
    next.add(id)
    if (!dirChildren.value.has(id) && !dirLoading.value.has(id)) void loadDir(id)
  }
  expandedDirs.value = next
}

type DirRow =
  | { kind: 'dir'; key: string; depth: number; node: DirNode; count?: number }
  | { kind: 'table'; key: string; depth: number; table: EntryType }
  | { kind: 'msg'; key: string; depth: number; text: string; retry?: string }
const dirRows = computed(() => {
  const byId = new Map(props.tables.map(table => [table.tableId, table]))
  const tablesOf = (id: string) => (dirTables.value.get(id)?.tableIds ?? []).flatMap(tid => byId.has(tid) ? [byId.get(tid)!] : [])
  const rows: DirRow[] = []
  const walk = (parent: string, depth: number) => {
    for (const node of dirChildren.value.get(parent) ?? []) {
      // 计数只算直属源的表；一级目录的源多挂在子目录上，0 不显示免得像没数据（10-28）
      const count = tablesOf(node.id).length
      rows.push({ kind: 'dir', key: `d${node.id}`, depth, node, count: count || undefined })
      if (!expandedDirs.value.has(node.id)) continue
      const error = dirErrors.value.get(node.id)
      if (dirLoading.value.has(node.id)) rows.push({ kind: 'msg', key: `l${node.id}`, depth: depth + 1, text: '正在读取目录下的表…' })
      else if (error) rows.push({ kind: 'msg', key: `e${node.id}`, depth: depth + 1, text: error, retry: node.id })
      else {
        const tables = tablesOf(node.id)
        walk(node.id, depth + 1)
        tables.forEach(table => rows.push({ kind: 'table', key: `t${node.id}-${table.tableId}`, depth: depth + 1, table }))
        const failed = dirTables.value.get(node.id)?.failedFlowIds ?? []
        if (failed.length) rows.push({ kind: 'msg', key: `f${node.id}`, depth: depth + 1, text: `${failed.length} 个流程的节点没读到（流程 ${failed.join('、')}），用这些流程的源没统计到表` })
        if (!tables.length && !(dirChildren.value.get(node.id) ?? []).length) rows.push({ kind: 'msg', key: `n${node.id}`, depth: depth + 1, text: '这个目录下的源还没有输出表' })
      }
    }
  }
  walk(ROOT, 0)
  return rows
})
</script>

<template>
  <aside class="dt-sidebar" aria-label="数据表导航" data-testid="data-table-sidebar">
    <header><strong>数据表</strong><button class="dt-collapse" type="button" title="收起数据表导航" aria-label="收起数据表导航" @click="emit('collapse')"><el-icon><DArrowLeft /></el-icon></button></header>
    <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜表名 / ID" aria-label="搜索表名或 ID" data-testid="data-table-search" />
    <div class="dt-navigation" v-loading="loading">
      <div v-if="error" class="dt-message" role="alert">{{ error }}<button class="rc-btn" type="button" @click="emit('retry')">重新加载</button></div>
      <template v-else-if="keyword.trim() || scope !== 'all'">
        <span class="dt-search-count">{{ keyword.trim() ? '找到' : scope === 'favorites' ? '我的收藏' : '最近查看' }} {{ matchesSearch.length }} 张表</span>
        <button v-for="table in matchesSearch" :key="table.tableId" class="dt-entry" :class="{ active: table.tableId === selectedId }" type="button" :data-table-id="table.tableId" :aria-current="table.tableId === selectedId ? 'true' : undefined" :title="`${table.name || table.tableName} · ${table.tableId} · ${table.dsKind ?? 'MYSQL'}`" @click="emit('select', table)">
          <el-icon class="dt-table-icon"><Grid /></el-icon><span class="dt-entry-name">{{ table.name || table.tableName }}</span><span class="dt-entry-id">{{ table.tableId }}</span>
        </button>
        <p v-if="!matchesSearch.length && !loading" class="dt-message">{{ keyword.trim() ? '没有匹配的数据表' : scope === 'favorites' ? '点击表名旁的星标，将常用表加入收藏' : '查看过的数据表会显示在这里' }}</p>
      </template>
      <template v-else>
        <div class="dt-all-tables"><el-icon><Coin /></el-icon>全部表 <span>{{ tables.length }}</span></div>
        <div class="dt-tabs" role="tablist" aria-label="全部表分组方式">
          <button type="button" role="tab" data-tab="biz" :aria-selected="tab === 'biz'" :class="{ active: tab === 'biz' }" @click="showTab('biz')">业务目录</button>
          <button type="button" role="tab" data-tab="db" :aria-selected="tab === 'db'" :class="{ active: tab === 'db' }" @click="showTab('db')">数据库</button>
        </div>
        <div v-if="tab === 'biz'" role="tabpanel" data-testid="data-table-biz-tree">
          <p v-if="dirLoading.has('')" class="dt-message">正在读取业务目录…</p>
          <div v-else-if="dirErrors.get('')" class="dt-message" role="alert">{{ dirErrors.get('') }}<button class="rc-btn" type="button" @click="loadDir('')">重新加载</button></div>
          <p v-else-if="!(dirChildren.get('') ?? []).length" class="dt-message">还没有业务目录，可在系统设置里维护</p>
          <template v-for="row in dirRows" :key="row.key">
            <button v-if="row.kind === 'dir'" class="dt-section dt-dir" type="button" :style="{ paddingLeft: `${4 + row.depth * 16}px` }" :data-dir-id="row.node.id" :aria-expanded="expandedDirs.has(row.node.id)" :title="row.node.name" @click="toggleDir(row.node.id)">
              <el-icon class="dt-caret" :class="{ open: expandedDirs.has(row.node.id) }"><ArrowRight /></el-icon><el-icon class="dt-folder-icon"><FolderOpened v-if="expandedDirs.has(row.node.id)" /><Folder v-else /></el-icon><span class="dt-entry-name">{{ row.node.name }}</span><span v-if="row.count !== undefined" class="dt-section-count">{{ row.count }}</span>
            </button>
            <button v-else-if="row.kind === 'table'" class="dt-entry" :class="{ active: row.table.tableId === selectedId }" type="button" :style="{ paddingLeft: `${24 + row.depth * 16}px` }" :data-table-id="row.table.tableId" :aria-current="row.table.tableId === selectedId ? 'true' : undefined" :title="`${row.table.name || row.table.tableName} · ${row.table.tableId} · ${row.table.dsKind ?? 'MYSQL'}`" @click="emit('select', row.table)">
              <el-icon class="dt-table-icon"><Grid /></el-icon><span class="dt-entry-name">{{ row.table.name || row.table.tableName }}</span><span class="dt-entry-id">{{ row.table.tableId }}</span>
            </button>
            <div v-else class="dt-message" :style="{ paddingLeft: `${24 + row.depth * 16}px` }">{{ row.text }}<button v-if="row.retry" class="rc-btn" type="button" @click="loadDir(row.retry)">重试</button></div>
          </template>
        </div>
        <div v-else role="tabpanel">
          <section v-for="section in sections.db" :key="section.key">
            <button class="dt-section" type="button" :data-group="section.key" :aria-expanded="expanded.has(section.key)" @click="toggle(section.key)">
              <el-icon><ArrowDown v-if="expanded.has(section.key)" /><ArrowRight v-else /></el-icon><el-icon><component :is="section.icon" /></el-icon><span>{{ section.label }}</span><span class="dt-section-count">{{ section.tables.length }}</span>
            </button>
            <div v-if="expanded.has(section.key)" class="dt-entries">
              <button v-for="table in section.tables" :key="table.tableId" class="dt-entry" :class="{ active: table.tableId === selectedId }" type="button" :data-table-id="table.tableId" :aria-current="table.tableId === selectedId ? 'true' : undefined" :title="`${table.name || table.tableName} · ${table.tableId} · ${table.dsKind ?? 'MYSQL'}`" @click="emit('select', table)">
                <el-icon class="dt-table-icon"><Grid /></el-icon><span class="dt-entry-name">{{ table.name || table.tableName }}</span><span class="dt-entry-id">{{ table.tableId }}</span>
              </button>
              <p v-if="!section.tables.length && !loading" class="dt-message">{{ section.empty }}</p>
            </div>
          </section>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.dt-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 12px; border: 1px solid var(--rc-border); border-radius: 12px; background: #fff; }
.dt-sidebar header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; margin-bottom: 10px; padding-left: 4px; font-size: 13px; }
.dt-sidebar :deep(.el-input__wrapper) { min-height: 30px; padding: 0 10px; border-radius: 7px; background: #fff; box-shadow: 0 0 0 1px #dbe3ee inset; }
.dt-sidebar :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px var(--rc-primary) inset; }
.dt-sidebar :deep(.el-input__inner) { font-size: 13px; }
.dt-collapse { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rc-faint); font-size: 14px; cursor: pointer; }
.dt-collapse:hover { background: #f1f5f9; color: var(--rc-text); }
.dt-collapse:focus-visible, .dt-entry:focus-visible, .dt-section:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: -2px; }
.dt-navigation { min-height: 0; overflow-y: auto; margin-top: 8px; scrollbar-width: thin; scrollbar-color: var(--rc-border) transparent; }
.dt-section { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 30px; padding: 0 4px; color: var(--rc-text-2); border: 0; border-radius: 6px; background: transparent; font: inherit; font-size: 13px; font-weight: 600; text-align: left; cursor: pointer; }
.dt-section > .el-icon { flex: none; color: var(--rc-muted); font-size: 13px; }
.dt-section > .el-icon:first-child { width: 16px; height: 16px; color: var(--rc-faint); font-size: 12px; }
.dt-section:hover, .dt-entry:hover { background: #f1f5f9; }
.dt-section-count, .dt-all-tables > span { flex: none; color: var(--rc-faint); font-size: 11px; font-weight: 400; font-variant-numeric: tabular-nums; }
.dt-section-count { margin-left: auto; }
.dt-entries { padding: 0 0 4px 16px; }
.dt-entry { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; min-height: 30px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; color: var(--rc-text); font: inherit; text-align: left; cursor: pointer; }
.dt-entry.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.dt-table-icon { flex: none; color: var(--rc-faint); font-size: 12px; }
.dt-entry.active .dt-table-icon { color: var(--rc-primary); }
.dt-entry-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dt-entry-id { flex: none; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--rc-faint); font-variant-numeric: tabular-nums; }
.dt-message { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 5px 8px; margin: 0; color: var(--rc-muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.dt-all-tables { display: flex; align-items: center; gap: 4px; padding: 10px 4px 4px; margin-top: 0; color: var(--rc-text-2); font-size: 13px; font-weight: 600; }
.dt-all-tables > .el-icon { color: var(--rc-muted); font-size: 13px; }
.dt-all-tables > span { margin-left: auto; }
.dt-tabs { display: grid; grid-template-columns: 1fr 1fr; margin: 6px 0 8px; padding: 3px; border-radius: 8px; background: #eef2f7; }
.dt-tabs button { padding: 5px 0; border: 0; border-radius: 6px; background: transparent; color: #64748b; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.dt-tabs button.active { background: #fff; color: var(--rc-text); box-shadow: 0 1px 3px rgba(0, 0, 0, .1); }
.dt-tabs button[data-tab="biz"].active { color: var(--rc-primary); }
.dt-tabs button:focus-visible, .dt-message .rc-btn:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: -2px; }
.dt-dir { min-width: 0; color: var(--rc-text); font-weight: 400; }
.dt-caret { transition: transform .15s; }
.dt-caret.open { transform: rotate(90deg); }
.dt-dir[aria-expanded="true"] .dt-folder-icon { color: var(--rc-primary); }
.dt-search-count { display: block; padding: 0 8px 6px; color: var(--rc-muted); font-size: 11px; }
</style>
