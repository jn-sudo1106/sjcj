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
  /** 该列表头文案，默认"所属源"；具体源·节点筛选场景下每行都是同一个源，改叫"所属节点"
   *  避免看着像跨源归并（那是全部源模式的语义），跟真正的具体源数据视图混淆。 */
  sourceColLabel?: string
  /** 行勾选（0812 计划 M2-12：具体源"输入数据"页签勾行发后续任务）；不传时不渲染勾选列，
   *  不影响其余用法（全部源归并视图、输出数据页签都不需要勾选）。 */
  selectable?: boolean
  selectedIds?: string[]
}>()
const showActions = computed(() => !props.compact && !props.hideActions)
const showSourceCol = computed(() => !!props.sourceNames)
function sourceLabel(row: DataRow): string {
  return props.sourceNames?.[row.sourceId] ?? row.sourceId
}
const emit = defineEmits<{
  (e: 'row-click', row: DataRow): void
  (e: 'row-action', row: DataRow, cmd: string): void
  (e: 'update:selectedIds', ids: string[]): void
}>()

const selectedSet = computed(() => new Set(props.selectedIds ?? []))
const allChecked = computed(() => props.rows.length > 0 && props.rows.every((r) => selectedSet.value.has(r.dataId)))
const someChecked = computed(() => !allChecked.value && props.rows.some((r) => selectedSet.value.has(r.dataId)))
function toggleRow(dataId: string) {
  const next = new Set(selectedSet.value)
  if (next.has(dataId)) next.delete(dataId)
  else next.add(dataId)
  emit('update:selectedIds', [...next])
}
function toggleAll() {
  emit('update:selectedIds', allChecked.value ? [] : props.rows.map((r) => r.dataId))
}

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
// row.values 的键是旧平台的物理列名（K1/K2...），不是 tableMeta 给的逻辑字段名 f.prop
// （比如 "title"）——这两个只在 f.columnName 里对得上，直接用 f.prop 去取永远是 undefined。
// 真实 bug，2026-08-14 生产环境实测发现：详情弹层和表格本体所有字段都显示"—"，
// 不是接口没数据，是取错了 key。
function cellText(row: DataRow, field: { prop: string; columnName?: string }): string {
  const v = row.values?.[field.columnName ?? field.prop]
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
    <!-- 表头工具行：调用方可以用 #head 插槽把自己的表头内容（表名/行数/执行按钮/分页等）
         塞进来，跟「列 ▾」共用同一条横条。原来「列 ▾」自己独占一条 33px、调用方的表头又
         是另一条 47px、分页再一条 45px——三条横条摞起来把数据区挤没了
         （2026-08-15：数据视图一屏只看得到 6.2/20 行）。 -->
    <div v-if="!compact && (cols.length > 1 || $slots.head)" class="dg-toolbar">
      <div class="dg-head"><slot name="head" /></div>
      <div v-if="cols.length > 1" class="dg-cols-menu" @click.stop>
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
            <th v-if="selectable" style="width:36px" @click.stop>
              <input type="checkbox" :checked="allChecked" :indeterminate="someChecked" @change="toggleAll" />
            </th>
            <th v-if="showSourceCol" style="width:140px">{{ sourceColLabel || '所属源' }}</th>
            <th v-for="f in visibleCols" :key="f.prop" :style="{ minWidth: compact ? '96px' : '110px' }">{{ f.prop }}</th>
            <th v-if="!compact" style="width:64px">状态</th>
            <th v-if="showActions" style="width:80px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.dataId" :class="{ active: selectedId === r.dataId }" @click="emit('row-click', r)">
            <td v-if="selectable" class="dg-select" @click.stop>
              <input type="checkbox" :checked="selectedSet.has(r.dataId)" @change="toggleRow(r.dataId)" />
            </td>
            <td v-if="showSourceCol" :title="sourceLabel(r)">{{ sourceLabel(r) }}</td>
            <td v-for="f in visibleCols" :key="f.prop" :title="cellText(r, f)">{{ cellText(r, f) }}</td>
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
            <td :colspan="visibleCols.length + (compact ? 0 : 1) + (showActions ? 1 : 0) + (showSourceCol ? 1 : 0) + (selectable ? 1 : 0)" class="dg-empty-cell">无符合条件的数据</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dg-wrap { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.dg-toolbar { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fbfdff; }
/* 插槽内容不换行、放不下横向滚动：换行会让这条横条随窗口变窄一路长高，又把数据区挤回去。 */
.dg-head { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px 10px; flex-wrap: nowrap; overflow-x: auto; }
.dg-head > * { flex-shrink: 0; }
.dg-cols-menu { position: relative; flex: none; }
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
.dg-actions, .dg-select { color: var(--rc-primary); }
.dg-select input, .dg-table th input[type="checkbox"] { cursor: pointer; }
.dg-act-btn { font-size: 12px; cursor: pointer; }
.dg-empty, .dg-empty-cell { padding: 24px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.compact .dg-table th { font-size: 11px; padding: 6px 8px; }
.compact .dg-table td { font-size: 11px; padding: 6px 8px; max-width: 160px; }
</style>
