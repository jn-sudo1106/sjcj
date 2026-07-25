<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DataTableMeta, DataRow } from '@/api'

const props = defineProps<{
  meta: DataTableMeta | null
  rows: DataRow[]
  loading?: boolean
  selectedId?: string
  compact?: boolean
  hideActions?: boolean
  /** 网站粒度数据视图「所属源」列（0707 优化·Phase5）：传入才渲染，id → 名称映射 */
  sourceNames?: Record<string, string>
}>()
const showActions = computed(() => !props.compact && !props.hideActions)
const showSourceCol = computed(() => !!props.sourceNames)
function sourceLabel(row: DataRow): string {
  return props.sourceNames?.[row.sourceId] ?? row.sourceId
}
const emit = defineEmits<{
  (e: 'row-click', row: DataRow): void
  (e: 'row-action', row: DataRow, cmd: string): void
}>()

const cols = computed(() => props.meta?.fields ?? [])

// 列可见性控制（Phase 4.3）：切换表时重置，避免残留跟别的表同名字段冲突的隐藏状态
const hiddenCols = ref<Set<string>>(new Set())
watch(() => props.meta?.tableId, () => { hiddenCols.value = new Set() })
const visibleCols = computed(() => cols.value.filter((f) => !hiddenCols.value.has(f.prop)))
function toggleCol(prop: string) {
  const next = new Set(hiddenCols.value)
  if (next.has(prop)) next.delete(prop)
  else next.add(prop)
  hiddenCols.value = next
}
const colsMenuOpen = ref(false)
function onWindowClick() {
  colsMenuOpen.value = false
}
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))
function cellText(row: DataRow, prop: string): string {
  const v = row.values?.[prop]
  if (v === undefined || v === null) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
function stateMeta(s?: string) {
  if (s === 'C') return { cls: 'ok', text: 'C' }
  if (s === 'E') return { cls: 'err', text: 'E' }
  if (s === 'L') return { cls: 'run', text: 'L' }
  return { cls: 'muted', text: '—' }
}
</script>

<template>
  <div class="dg-wrap" :class="{ compact }">
    <div v-if="!compact && cols.length > 1" class="dg-toolbar">
      <div class="dg-cols-menu" @click.stop>
        <button class="dg-col-btn" type="button" @click="colsMenuOpen = !colsMenuOpen">列 ▾</button>
        <div v-if="colsMenuOpen" class="dg-cols-panel">
          <label v-for="f in cols" :key="f.prop" class="dg-col-item">
            <input type="checkbox" :checked="!hiddenCols.has(f.prop)" @change="toggleCol(f.prop)" />
            {{ f.prop }} · {{ f.desc }}
          </label>
        </div>
      </div>
    </div>
    <div v-if="!cols.length && !loading" class="dg-empty">该节点暂无输出表 schema</div>
    <div v-else class="dg-scroll" v-loading="loading">
      <table class="dg-table">
        <thead>
          <tr>
            <th v-if="showSourceCol" style="width:140px">所属子源</th>
            <th v-for="f in visibleCols" :key="f.prop" :style="{ minWidth: compact ? '96px' : '110px' }">{{ f.prop }}</th>
            <th v-if="!compact" style="width:64px">状态</th>
            <th v-if="showActions" style="width:80px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.dataId" :class="{ active: selectedId === r.dataId }" @click="emit('row-click', r)">
            <td v-if="showSourceCol" :title="sourceLabel(r)">{{ sourceLabel(r) }}</td>
            <td v-for="f in visibleCols" :key="f.prop" :title="cellText(r, f.prop)">{{ cellText(r, f.prop) }}</td>
            <td v-if="!compact"><span class="rc-status" :class="stateMeta(r.state).cls">{{ stateMeta(r.state).text }}</span></td>
            <td v-if="showActions" class="dg-actions" @click.stop>
              <el-dropdown trigger="click" @command="(c: string) => emit('row-action', r, c)">
                <span class="dg-act-btn">操作 ▾</span>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="detail">详情</el-dropdown-item>
                    <el-dropdown-item command="tasks">查后续任务实例</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading">
            <td :colspan="visibleCols.length + (compact ? 0 : 1) + (showActions ? 1 : 0) + (showSourceCol ? 1 : 0)" class="dg-empty-cell">无符合条件的数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dg-wrap { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.dg-toolbar { display: flex; justify-content: flex-end; padding: 4px 6px; border-bottom: 1px solid var(--rc-border-soft); background: #fbfdff; }
.dg-cols-menu { position: relative; }
.dg-col-btn { height: 24px; padding: 0 9px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.dg-col-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dg-cols-panel { position: absolute; right: 0; top: 28px; z-index: 30; min-width: 180px; max-height: 220px; overflow: auto; background: #fff; border: 1px solid var(--rc-border); border-radius: 8px; box-shadow: 0 16px 34px -16px rgba(15, 23, 42, 0.36); padding: 6px; }
.dg-col-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; font-size: 11px; color: var(--rc-text-2); cursor: pointer; border-radius: 5px; white-space: nowrap; }
.dg-col-item:hover { background: var(--rc-primary-bg); }
.dg-scroll { flex: 1; overflow: auto; }
.dg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.dg-table th { position: sticky; top: 0; background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--rc-border); font-family: var(--rc-mono, monospace); }
.dg-table td { padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dg-table tbody tr { cursor: pointer; }
.dg-table tbody tr:hover { background: #f8fbff; }
.dg-table tbody tr.active { background: #eff6ff; }
.dg-actions { color: var(--rc-primary); }
.dg-act-btn { font-size: 12px; cursor: pointer; }
.dg-empty, .dg-empty-cell { padding: 24px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.compact .dg-table th { font-size: 11px; padding: 6px 8px; }
.compact .dg-table td { font-size: 11px; padding: 6px 8px; max-width: 160px; }
</style>
