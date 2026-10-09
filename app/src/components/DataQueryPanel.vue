<script setup lang="ts">
// 可复用的「筛选 + 结果表格」面板（S5-1，方案 §5.2）：从 DataView/index.vue 抽出查询条件区 + 结果表格，
// 给 RuleTestDialog（S5-2）复用，避免两边各自维护一套 rowQueryPaged 查询逻辑。
//
// 范围边界（0805 拍板，"只抽筛选+表格+插槽"）：
// - 选表/选源不在本组件职责内：tableId/sourceId 由调用方管理，作为 prop 传入，本组件不渲染选表/选源下拉。
// - 「数据ID/父ID/时间范围」是数据查看页的基础条件；额外带上 DataView 原有的「后续标识/ID区间/条件表达式」
//   完整筛选一并抽出（两边都用得上，不算扩大范围）。
// - 不带任何批量操作的业务逻辑（发后续任务/批量删除等）——那些仍然是调用方的关注点。本组件只提供一个
//   可选的勾选列（selectable，纯选中状态，不含批量操作菜单），调用方基于 v-model:selected-keys 自己接批量操作。
// - ENTRY_ID/源/任务/父ID/原始/操作 这些 DataView 特有、带自定义点击行为的列，通过 #columns-before/
//   #columns-after 插槽由调用方自己塞，不是"筛选+表格"的通用能力。
//
// 查询节奏：本组件不监听 tableId/sourceId 变化自动重查（避免跟调用方自己的时序产生重复请求/竞态），
// 调用方在恰当时机（挂载完成/切表/切源/路由深链）显式调用 expose 出去的 search()/refresh()。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type DataRow, type RowQuery } from '@/api'
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import { readSqlConditions, rememberSqlCondition } from '@/utils/sqlConditionHistory'
import ColumnPickerDialog from '@/components/ColumnPickerDialog.vue'
import { useColumnPicker } from '@/utils/table/useColumnPicker'
import { isOssFilePath } from '@/views/FlowCanvas/result/rowDetailFields'

export interface DataQueryColumn {
  /** 物理列名：对应 row.values[prop] 取值，也是排序时上报给后端的 sortField */
  prop: string
  /** 表头文案；也用于文件路径识别（isOssFilePath）的中文描述来源 */
  label: string
  width?: number
  sortable?: boolean
  /** 业务字段名，仅用于文件路径识别；缺省退化用 prop 本身（见 cellKind） */
  hintProp?: string
}
export interface DataQueryFilterPatch {
  dataId?: string
  parentId?: string
  state?: string
  sql?: string
  nextFlag?: string
  min?: string
  max?: string
  startTime?: string
  endTime?: string
}
export interface DataQueryFilter {
  dataId?: string
  parentId?: string
  /** 多状态查询按英文逗号拼接，透传旧接口的 state 参数。 */
  state?: string
  sql?: string
  nextFlag?: string
  min?: string
  max?: string
  startTime?: string
  endTime?: string
  sortField?: string
  sortOrder?: 'ascend' | 'descend'
  page: number
  size: number
}

const STATE_OPTIONS = [
  { value: 'C', label: '初始（C）' },
  { value: 'AC', label: '已审核（AC）' },
  { value: 'NF', label: '404（NF）' },
  { value: 'E', label: '异常（E）' },
]

const props = withDefaults(
  defineProps<{
    tableId: string
    sourceId?: string
    columns: DataQueryColumn[]
    /** 数据查看页专属的业务状态筛选；规则试跑等复用场景不展示。 */
    showState?: boolean
    selectable?: boolean
    selectedKeys?: string[]
    pageSize?: number
    defaultSortField?: string
    defaultSortOrder?: 'ascend' | 'descend' | ''
    /**
     * 单行模式（1008-07，数据中心用）：筛选与操作按钮合成一行，放不下横向滚动，
     * 表 / 源挪到状态筛选之后，查询 / 清空 / 高级筛选钉在右侧，列选择器并入同一行。
     * 操作按钮走 #actions 插槽；#toolbar 只留给批量条、SQL 提示这类整行内容。默认关，其他复用方不受影响。
     */
    oneRow?: boolean
  }>(),
  {
    defaultSortField: '',
    defaultSortOrder: '',
    oneRow: false,
  },
)
const emit = defineEmits<{
  'row-click': [row: DataRow]
  'update:selectedKeys': [string[]]
  'query-change': [DataQueryFilter]
  loaded: [{ rows: DataRow[]; total: number }]
  /** 点了文件路径格（OSS 上的 .json / .txt / 图片等）：交给调用方开预览，形状与 DataGrid 的同名事件一致 */
  'file-click': [path: string, field: { prop: string; columnName: string; desc: string }]
}>()

// ---- 筛选字段 ----
const dataId = ref('')
const parentId = ref('')
const states = ref<string[]>([])
const timeRange = ref<[string, string]>()
const nextFlag = ref('')
const minId = ref('')
const maxId = ref('')
const sql = ref('')
const sortField = ref(props.defaultSortField)
const sortOrder = ref<'ascend' | 'descend' | ''>(props.defaultSortOrder)
const defaultTableSort = computed(() => {
  if (!props.defaultSortField || !props.defaultSortOrder) return undefined
  return {
    prop: props.defaultSortField,
    order: props.defaultSortOrder === 'ascend' ? 'ascending' : 'descending',
  }
})
const advancedOpen = ref(false)

function querySqlHistory(queryString: string, cb: (results: { value: string }[]) => void) {
  cb(readSqlConditions(props.tableId).filter((v) => v.includes(queryString)).map((v) => ({ value: v })))
}

// ---- 结果 / 分页 ----
const rows = ref<DataRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(props.pageSize ?? 20)
const loading = ref(false)
// 动态列排序仅当 total ≤ 500000 时开放（方案 §1.5-5，跟 DataView 原逻辑一致）
const allSort = computed(() => total.value <= 500000)

const {
  hidden: hiddenCols,
  order: colOrder,
  open: colPickerOpen,
  visibleCount: colVisibleCount,
  apply: applyColumnPrefs,
} = useColumnPicker(
  () => props.tableId,
  () => props.columns.map((c) => c.prop),
  { scope: 'dataquery' },
)
const visibleColumns = computed(() => {
  const byProp = new Map(props.columns.map((c) => [c.prop, c]))
  return colOrder.value
    .map((prop) => byProp.get(prop))
    .filter((c): c is DataQueryColumn => !!c && !hiddenCols.value.has(c.prop))
})
const pickerColumns = computed(() => props.columns.map((c) => ({ prop: c.prop, label: c.label })))
const showColPicker = computed(() => props.columns.length > 0)

function currentFilter(): Omit<DataQueryFilter, 'page' | 'size'> {
  const [startTime, endTime] = timeRange.value ?? []
  return {
    dataId: dataId.value.trim() || undefined,
    parentId: parentId.value.trim() || undefined,
    state: states.value.join(',') || undefined,
    sql: sql.value.trim() || undefined,
    nextFlag: nextFlag.value || undefined,
    min: minId.value.trim() || undefined,
    max: maxId.value.trim() || undefined,
    startTime: startTime || undefined,
    endTime: endTime || undefined,
    sortField: sortField.value || undefined,
    sortOrder: sortOrder.value || undefined,
  }
}

async function loadRows(preserveSelection = false) {
  if (!props.tableId) return
  loading.value = true
  try {
    const filter = currentFilter()
    emit('query-change', { ...filter, page: page.value, size: size.value })
    const query: RowQuery = { tableId: props.tableId, sourceId: props.sourceId || undefined, ...filter, page: page.value, size: size.value }
    const result = await dataApi.rowQueryPaged(query)
    rememberSqlCondition(query.tableId, query.sql)
    rows.value = result.list
    total.value = result.total
    const nextSelection = preserveSelection
      ? (props.selectedKeys ?? []).filter((key) => result.list.some((row) => row.dataId === key))
      : []
    emit('update:selectedKeys', nextSelection)
    emit('loaded', { rows: result.list, total: result.total })
  } catch (error) {
    ElMessage.error(`查询失败:${String(error instanceof Error ? error.message : error).slice(0, 100)}`)
  } finally {
    loading.value = false
  }
}

function applyPatch(patch?: DataQueryFilterPatch) {
  if (!patch) return
  if (patch.dataId !== undefined) dataId.value = patch.dataId
  if (patch.parentId !== undefined) parentId.value = patch.parentId
  if (patch.state !== undefined) states.value = patch.state.split(',').map((item) => item.trim()).filter(Boolean)
  if (patch.sql !== undefined) sql.value = patch.sql
  if (patch.nextFlag !== undefined) nextFlag.value = patch.nextFlag
  if (patch.min !== undefined) minId.value = patch.min
  if (patch.max !== undefined) maxId.value = patch.max
  if (patch.startTime !== undefined || patch.endTime !== undefined) {
    timeRange.value = patch.startTime && patch.endTime ? [patch.startTime, patch.endTime] : undefined
  }
}
/** 调用方（含内部按钮/输入框）触发一次查询：可选先合并一份筛选 patch，再重置到第 1 页查询 */
function search(patch?: DataQueryFilterPatch) {
  applyPatch(patch)
  page.value = 1
  void loadRows()
}
/** 清空全部筛选条件并回到第一页；表/源由调用方保留。 */
function clearFilters() {
  dataId.value = ''
  parentId.value = ''
  states.value = []
  timeRange.value = undefined
  sql.value = ''
  nextFlag.value = ''
  minId.value = ''
  maxId.value = ''
  sortField.value = props.defaultSortField
  sortOrder.value = props.defaultSortOrder
  search()
}
/** 不改筛选条件/页码，原样重查一次（如外部数据变了但筛选条件没变） */
function refresh(options?: { preserveSelection?: boolean }) {
  void loadRows(options?.preserveSelection !== false)
}

function onPageChange(p: number) {
  page.value = p
  void loadRows()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void loadRows()
}
/** 特例：批量发本页任务成功后翻到下一页，不重置回第 1 页、不改筛选条件（对齐 DataView 原 onNextStepPage 行为） */
function advancePage() {
  page.value += 1
  void loadRows()
}
defineExpose({ search, refresh, advancePage, clearFilters })

function clearNextFlag() { nextFlag.value = ''; search() }
function clearRange() { minId.value = ''; maxId.value = ''; search() }
function clearState() { states.value = []; search() }

const chips = computed(() => {
  const list: { key: string; label: string; clear: () => void }[] = []
  if (states.value.length) list.push({ key: 'state', label: `状态：${states.value.join('、')}`, clear: clearState })
  if (nextFlag.value) list.push({ key: 'nextFlag', label: `后续标识：${nextFlag.value}`, clear: clearNextFlag })
  if (minId.value || maxId.value) {
    list.push({ key: 'range', label: `ID区间：${minId.value || '不限'}－${maxId.value || '不限'}`, clear: clearRange })
  }
  return list
})

function onSortChange({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) {
  if (!order) {
    sortField.value = ''
    sortOrder.value = ''
  } else {
    sortField.value = prop
    sortOrder.value = order === 'descending' ? 'descend' : 'ascend'
  }
  search()
}

// ---- 可选勾选列：纯选中状态，不含任何批量操作菜单（那是调用方的事） ----
const allChecked = computed(() => rows.value.length > 0 && (props.selectedKeys ?? []).length === rows.value.length)
const pageIndeterminate = computed(() => {
  const n = (props.selectedKeys ?? []).length
  return n > 0 && n < rows.value.length
})
function togglePage(val: boolean) {
  emit('update:selectedKeys', val ? rows.value.map((r) => r.dataId) : [])
}
function toggleSelected(id: string, val: boolean) {
  const cur = props.selectedKeys ?? []
  emit('update:selectedKeys', val ? [...cur, id] : cur.filter((k) => k !== id))
}

// 文件路径识别与源数据视图（DataGrid）同一套判据（2026-09-28）：原来这里只认字段名带 path/minio、
// 表头带「地址/路径/图片」的，且只是新开标签页直连下载——TB_KAIPANLA「详情json」（result / K3，
// 值是 /xtdb/kaipan/…/386.json）一条都命中不了，数据中心里看不了这类文件。
function cellKind(column: DataQueryColumn, value: unknown): 'link' | 'file' | 'text' {
  const v = String(value ?? '')
  if (!v) return 'text'
  if (/^https?:/.test(v)) return 'link'
  if (isOssFilePath({ prop: column.hintProp ?? column.prop, desc: column.label }, v)) return 'file'
  return 'text'
}
function onFileCell(column: DataQueryColumn, value: unknown) {
  emit('file-click', String(value), { prop: column.hintProp ?? column.prop, columnName: column.prop, desc: column.label })
}

function onRowClick(row: DataRow) {
  emit('row-click', row)
}
</script>

<template>
  <div class="dqp">
    <div class="rc-toolbar wrap dqp-primary-row" :class="{ 'is-one-row': oneRow }" data-testid="data-query-primary">
      <div v-if="$slots.context && !oneRow" class="dqp-context"><slot name="context" /></div>
      <el-input v-model="dataId" class="dqp-data-id" clearable placeholder="请输入数据 ID" style="width: 160px" />
      <el-input v-model="parentId" class="dqp-parent-id" clearable placeholder="父 ID" style="width: 120px" />
      <el-select
        v-if="showState"
        v-model="states"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        class="dqp-state"
        placeholder="状态（全部）"
        style="width: 180px"
        data-testid="data-query-state"
      >
        <el-option v-for="option in STATE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>
      <!-- 单行模式下表 / 源放在状态筛选之后（会上：表选项多，放最前面显示不全） -->
      <div v-if="$slots.context && oneRow" class="dqp-context"><slot name="context" /></div>
      <el-date-picker
        v-model="timeRange"
        type="datetimerange"
        value-format="YYYY-MM-DD HH:mm:ss"
        range-separator="至"
        start-placeholder="开始时间"
        end-placeholder="结束时间"
        class="dqp-time-range"
        style="width: 280px"
      />
      <span class="dqp-query-actions">
        <button class="rc-btn primary" type="button" @click="search()">查询</button>
        <button class="rc-btn" type="button" @click="clearFilters">清空</button>
        <button
          class="rc-btn dqp-advanced-toggle"
          type="button"
          :aria-expanded="advancedOpen"
          aria-controls="data-query-advanced"
          @click="advancedOpen = !advancedOpen"
        >
          高级筛选 <span aria-hidden="true">{{ advancedOpen ? '⌃' : '⌄' }}</span>
        </button>
      </span>
      <span class="dqp-spacer" />
      <span class="dqp-quick-slot"><slot name="quick" /></span>
      <template v-if="oneRow">
        <slot name="actions" :total="total" :rows="rows" />
        <button
          v-if="showColPicker"
          class="rc-btn dqp-col-btn"
          type="button"
          data-testid="column-picker-btn"
          :title="`列显示与顺序（已显 ${colVisibleCount}/${columns.length}）`"
          @click="colPickerOpen = true"
        >列 {{ colVisibleCount }}/{{ columns.length }}</button>
      </template>
    </div>

    <div v-if="chips.length" class="rc-toolbar wrap dqp-chips-row">
      <el-tag v-for="c in chips" :key="c.key" closable size="small" effect="plain" @close="c.clear">{{ c.label }}</el-tag>
    </div>

    <div v-if="advancedOpen" id="data-query-advanced" class="rc-toolbar wrap dqp-query-row" data-testid="data-query-filters">
      <el-input v-model="nextFlag" clearable placeholder="后续标识（如 -1）" style="width: 150px" />
      <span class="dqp-range">
        <el-input v-model="minId" placeholder="起始 ID" style="width: 100px" />
        <span class="dqp-range-sep">－</span>
        <el-input v-model="maxId" placeholder="终止 ID" style="width: 100px" />
      </span>
      <SqlConditionEditor v-model="sql" v-slot="{ value, update }" :table-id="tableId" :fields="columns" style="width: 320px">
        <el-autocomplete
          :model-value="value"
          @update:model-value="update"
          :fetch-suggestions="querySqlHistory"
          clearable
          placeholder="条件表达式，如 CREATE_DT > CURDATE()"
        />
      </SqlConditionEditor>
    </div>

    <div class="dqp-table-tools">
      <div class="dqp-table-tools-main"><slot name="toolbar" :total="total" :rows="rows" /></div>
      <button
        v-if="showColPicker && !oneRow"
        class="rc-btn dqp-col-btn"
        type="button"
        data-testid="column-picker-btn"
        :title="`列显示与顺序（已显 ${colVisibleCount}/${columns.length}）`"
        @click="colPickerOpen = true"
      >列 {{ colVisibleCount }}/{{ columns.length }}</button>
    </div>

    <div v-loading="loading" class="rc-table-scroll dqp-table">
      <el-table
        :data="rows"
        :default-sort="defaultTableSort"
        style="width: 100%"
        show-overflow-tooltip
        empty-text="没有查询到符合条件的记录"
        :header-cell-style="{ height: '42px', background: '#f8fafc', color: 'var(--rc-text-2)', fontWeight: '700', fontSize: '12px', borderBottom: '1px solid #e8eef6' }"
        @sort-change="onSortChange"
        @row-click="onRowClick"
      >
        <el-table-column v-if="selectable" width="42" fixed="left">
          <template #header>
            <el-checkbox :model-value="allChecked" :indeterminate="pageIndeterminate" aria-label="选择本页" @change="togglePage" @click.stop />
          </template>
          <template #default="{ row }">
            <el-checkbox
              :model-value="(selectedKeys ?? []).includes(row.dataId)"
              :aria-label="`选择 ${row.dataId}`"
              @change="(val: boolean) => toggleSelected(row.dataId, val)"
              @click.stop
            />
          </template>
        </el-table-column>

        <slot name="columns-before" :all-sort="allSort" />

        <el-table-column
          v-for="col in visibleColumns"
          :key="col.prop"
          :prop="col.prop"
          :label="col.label"
          :width="col.width"
          :sortable="col.sortable && allSort ? 'custom' : false"
        >
          <template #default="{ row }">
            <slot name="cell" :row="row" :column="col">
              <template v-if="cellKind(col, row.values?.[col.prop]) === 'link'">
                <a class="dqp-a" :href="String(row.values?.[col.prop])" target="_blank" rel="noopener" @click.stop>{{ row.values?.[col.prop] }}</a>
              </template>
              <template v-else-if="cellKind(col, row.values?.[col.prop]) === 'file'">
                <button
                  type="button"
                  class="dqp-file"
                  :title="`预览 ${row.values?.[col.prop]}`"
                  data-testid="data-cell-file"
                  @click.stop="onFileCell(col, row.values?.[col.prop])"
                >📄 {{ row.values?.[col.prop] }}</button>
              </template>
              <span v-else>{{ row.values?.[col.prop] ?? '—' }}</span>
            </slot>
          </template>
        </el-table-column>

        <slot name="columns-after" :all-sort="allSort" />
      </el-table>
    </div>
    <div class="dqp-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>
    <ColumnPickerDialog
      :open="colPickerOpen"
      :columns="pickerColumns"
      :hidden="[...hiddenCols]"
      :order="colOrder"
      :identity-props="[]"
      :min-visible="0"
      @update:open="colPickerOpen = $event"
      @confirm="applyColumnPrefs"
    />
  </div>
</template>

<style scoped>
.dqp { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.dqp-primary-row { align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.dqp-context { display: inline-flex; align-items: center; gap: 6px; padding-right: 10px; margin-right: 2px; border-right: 1px solid var(--rc-border-soft); }
.dqp-chips-row { min-height: 0; padding-top: 8px; padding-bottom: 8px; }
.dqp-query-row { align-items: center; gap: 8px; padding-top: 4px; padding-bottom: 8px; }
.dqp-advanced-toggle { white-space: nowrap; }
.dqp-spacer { flex: 1; min-width: 8px; }
/* 默认模式下这层只是个分组，不参与布局，三个按钮仍是 .dqp-primary-row 的直接 flex 子项 */
.dqp-query-actions { display: contents; }
/* 单行模式（1008-07）：放不下就整行横向滚动，不换行，数据区拿到最多的纵向空间。
   查询 / 清空 / 高级筛选 sticky 钉在右端：行放得下时在原位，放不下时始终点得到。 */
.dqp-primary-row.is-one-row { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
.dqp-primary-row.is-one-row::-webkit-scrollbar { height: 5px; }
.dqp-primary-row.is-one-row::-webkit-scrollbar-thumb { border-radius: 999px; background: #cbd5e1; }
.dqp-primary-row.is-one-row > * { flex-shrink: 0; }
.dqp-primary-row.is-one-row > .dqp-spacer { flex-shrink: 1; }
.dqp-primary-row.is-one-row > .dqp-query-actions { display: inline-flex; align-items: center; gap: 8px; position: sticky; right: 0; z-index: 2; padding-left: 14px; background: linear-gradient(90deg, #fff0, #fff 12px); }
/* 13.6 寸（约 1090px 可用）下尽量让「筛选 + 查询」一屏装下，右边的操作按钮靠横向滚动 */
.dqp-primary-row.is-one-row :deep(.dqp-data-id) { width: 104px !important; }
.dqp-primary-row.is-one-row :deep(.dqp-parent-id) { width: 80px !important; }
.dqp-primary-row.is-one-row :deep(.dqp-state) { width: 116px !important; }
.dqp-primary-row.is-one-row :deep(.dqp-time-range) { width: 232px !important; min-width: 232px; }
.dqp-table-tools { display: flex; align-items: center; gap: 8px; }
.dqp-table-tools-main { flex: 1; min-width: 0; }
.dqp-col-btn { flex: none; }
.dqp-quick-slot { display: inline-flex; flex: none; }
.dqp-range { display: inline-flex; align-items: center; gap: 6px; }
.dqp-range-sep { color: var(--rc-faint); }
.dqp-table { flex: 1; min-height: 0; background: #fff; }
.dqp-table :deep(.el-table .cell) { white-space: nowrap; }
.dqp-table :deep(.el-table td.el-table__cell), .dqp-table :deep(.el-table th.el-table__cell) { padding: 8px 0; font-size: 12px; }
.dqp-table :deep(.el-table td.el-table__cell) { color: #334155; }
.dqp-table :deep(.el-table__body tr:hover > td) { background: #f8fbff; }
.dqp-a { color: var(--rc-primary-ink); cursor: pointer; }
.dqp-a:hover { text-decoration: underline; }
/* 文件路径格：同 DataGrid 的路径格，按钮外观像链接，文字过长省略（悬停 title 看全路径） */
.dqp-file { max-width: 100%; padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font: inherit; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dqp-file:hover { text-decoration: underline; }
.dqp-pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
@media (max-width: 900px) {
  .dqp-context { flex-wrap: wrap; border-right: 0; padding-right: 0; }
  .dqp-query-row > :deep(.el-input), .dqp-query-row > :deep(.el-autocomplete) { width: 100% !important; max-width: 320px; }
  .dqp-range { width: 100%; }
  .dqp-range :deep(.el-input) { flex: 1; width: auto !important; }
}
@media (min-width: 901px) and (max-width: 1200px) {
  .dqp-primary-row.rc-toolbar.wrap {
    flex-wrap: nowrap;
    gap: 8px;
    overflow-x: auto;
  }
  .dqp-primary-row :deep(.dqp-data-id) { width: 130px !important; }
  .dqp-primary-row :deep(.dqp-parent-id) { width: 96px !important; }
  .dqp-primary-row :deep(.dqp-state) { width: 140px !important; }
  .dqp-primary-row :deep(.dqp-time-range) { width: 240px !important; min-width: 240px; }
  .dqp-primary-row .rc-btn { padding: 0 9px; }
}
</style>
