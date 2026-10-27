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
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Coin, Filter, Warning } from '@element-plus/icons-vue'
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
    /** 数据中心工作区：上下文在前，低频条件与结果操作分行。 */
    workspaceLayout?: boolean
    contextError?: string
    /** 行可点击（调用方监听 row-click 开详情等）：鼠标移上去显示手型 */
    rowClickable?: boolean
    /** 「开始时间 / 结束时间」条件（CREATE_DT 区间）。数据中心 → 数据查询页 1021-05 去掉（Q6），其他复用方保留 */
    showTimeRange?: boolean
  }>(),
  {
    showTimeRange: true,
    defaultSortField: '',
    defaultSortOrder: '',
    oneRow: false,
    workspaceLayout: false,
    contextError: '',
    rowClickable: false,
  },
)
const emit = defineEmits<{
  /** 第二个参数是原始点击事件：调用方据此判断点的是不是单元格里自带动作的元素（链接、按钮、勾选框…） */
  'row-click': [row: DataRow, event: Event]
  'update:selectedKeys': [string[]]
  'query-change': [DataQueryFilter]
  loaded: [{ rows: DataRow[]; total: number }]
  'clear-context': []
  'retry-context': []
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
const queryError = ref('')
const hasQueried = ref(false)
const appliedFilter = ref<DataQueryFilter | null>(null)
const appliedSource = ref('')
let rowRequest = 0
watch([() => props.tableId, () => props.sourceId], () => {
  ++rowRequest
  rows.value = []
  total.value = 0
  loading.value = false
  hasQueried.value = false
  queryError.value = ''
  appliedFilter.value = null
  appliedSource.value = ''
  emit('update:selectedKeys', [])
  emit('loaded', { rows: [], total: 0 })
})
onUnmounted(() => { ++rowRequest })
const appliedConditions = computed(() => {
  const filter = appliedFilter.value
  if (!filter) return []
  const conditions: string[] = []
  if (appliedSource.value) conditions.push(`源：${appliedSource.value}`)
  if (filter.dataId) conditions.push(`数据 ID：${filter.dataId}`)
  if (filter.parentId) conditions.push(`父 ID：${filter.parentId}`)
  if (filter.state) conditions.push(`状态：${filter.state}`)
  if (filter.sql) conditions.push(`条件表达式：${filter.sql}`)
  if (filter.nextFlag) conditions.push(`后续标识：${filter.nextFlag}`)
  if (filter.min || filter.max) conditions.push(`ID 区间：${filter.min || '不限'}－${filter.max || '不限'}`)
  if (filter.startTime || filter.endTime) conditions.push(`时间：${filter.startTime || '不限'} 至 ${filter.endTime || '不限'}`)
  return conditions
})
const emptyTitle = computed(() => {
  if (props.contextError) return '数据表暂不可用'
  if (!props.tableId) return '请从左侧选择数据表'
  if (queryError.value) return '查询失败，请重试'
  if (!hasQueried.value) return '选择条件后点击查询'
  return appliedConditions.value.length ? '没有符合筛选条件的数据' : '这张表暂无数据'
})
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
  if (!props.tableId || props.contextError) return
  const requestId = ++rowRequest
  loading.value = true
  queryError.value = ''
  try {
    const filter = currentFilter()
    const submitted = { ...filter, page: page.value, size: size.value }
    emit('query-change', submitted)
    const query: RowQuery = { tableId: props.tableId, sourceId: props.sourceId || undefined, ...submitted }
    const result = await dataApi.rowQueryPaged(query)
    rememberSqlCondition(query.tableId, query.sql)
    if (requestId !== rowRequest) return
    rows.value = result.list
    total.value = result.total
    hasQueried.value = true
    appliedFilter.value = submitted
    appliedSource.value = query.sourceId ?? ''
    const nextSelection = preserveSelection
      ? (props.selectedKeys ?? []).filter((key) => result.list.some((row) => row.dataId === key))
      : []
    emit('update:selectedKeys', nextSelection)
    emit('loaded', { rows: result.list, total: result.total })
  } catch (error) {
    if (requestId !== rowRequest) return
    queryError.value = String(error instanceof Error ? error.message : error).slice(0, 100)
    rows.value = []
    total.value = 0
    emit('update:selectedKeys', [])
    emit('loaded', { rows: [], total: 0 })
    ElMessage.error(`查询失败:${queryError.value}`)
  } finally {
    if (requestId === rowRequest) loading.value = false
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
/** 清空筛选并回到第一页；工作区通知调用方同步清空源范围，始终保留当前表。 */
async function clearFilters() {
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
  if (props.workspaceLayout) {
    emit('clear-context')
    await nextTick()
  }
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

function onRowClick(row: DataRow, _column: unknown, event: Event) {
  emit('row-click', row, event)
}
</script>

<template>
  <div class="dqp" :class="{ 'is-workspace': workspaceLayout }">
    <div class="rc-toolbar wrap dqp-primary-row" :class="{ 'is-one-row': oneRow }" data-testid="data-query-primary">
      <div v-if="$slots.context && !oneRow" class="dqp-context"><slot name="context" /></div>
      <el-input v-model="dataId" class="dqp-data-id" clearable placeholder="请输入数据 ID" style="width: 160px" />
      <el-input v-if="!workspaceLayout" v-model="parentId" class="dqp-parent-id" clearable placeholder="父 ID" style="width: 120px" />
      <el-select
        v-if="showState && !workspaceLayout"
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
        v-if="showTimeRange"
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
      <el-input v-if="workspaceLayout" v-model="parentId" class="dqp-parent-id" clearable placeholder="父 ID" style="width: 120px" />
      <el-select v-if="workspaceLayout && showState" v-model="states" multiple collapse-tags collapse-tags-tooltip clearable class="dqp-state" placeholder="状态（全部）" style="width: 180px" data-testid="data-query-state"><el-option v-for="option in STATE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" /></el-select>
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

    <div v-if="workspaceLayout" class="dqp-result-heading" aria-live="polite"><strong>查询结果</strong><span>{{ loading ? '查询中…' : `共 ${total} 条` }}</span></div>
    <div class="dqp-table-tools" :data-testid="workspaceLayout ? 'data-result-toolbar' : undefined">
      <div v-if="workspaceLayout" class="dqp-result-actions"><slot name="actions" :total="total" :rows="rows" /></div>
      <div v-else class="dqp-table-tools-main"><slot name="toolbar" :total="total" :rows="rows" /></div>
      <button
        v-if="showColPicker && !oneRow"
        class="rc-btn dqp-col-btn"
        type="button"
        data-testid="column-picker-btn"
        :title="`列显示与顺序（已显 ${colVisibleCount}/${columns.length}）`"
        @click="colPickerOpen = true"
      >列 {{ colVisibleCount }}/{{ columns.length }}</button>
    </div>

    <div v-if="workspaceLayout"><slot name="toolbar" :total="total" :rows="rows" /></div>

    <div v-loading="loading" class="rc-table-scroll dqp-table" :class="{ 'is-row-clickable': rowClickable }">
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
        <template v-if="workspaceLayout" #empty>
          <div class="dqp-empty" data-testid="data-query-empty">
            <el-icon :size="30"><Warning v-if="queryError || contextError" /><Filter v-else-if="appliedConditions.length" /><Coin v-else /></el-icon>
            <strong>{{ emptyTitle }}</strong>
            <span v-if="queryError">{{ queryError }}</span>
            <span v-else-if="!contextError && appliedConditions.length" class="dqp-empty-conditions">当前条件：{{ appliedConditions.join('；') }}</span>
            <button v-if="contextError" class="rc-btn" type="button" @click="emit('retry-context')">重新加载数据表</button>
            <button v-else-if="queryError" class="rc-btn" type="button" @click="search()">重新查询</button>
            <button v-else-if="appliedConditions.length" class="rc-btn" type="button" @click="clearFilters">清空筛选</button>
          </div>
        </template>
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
.dqp-primary-row.is-one-row > .dqp-query-actions { display: inline-flex; align-items: center; gap: 4px; position: sticky; right: 0; z-index: 2; margin-left: 4px; padding-left: 12px; background: #fff; border-left: 1px solid var(--rc-border-soft); }
/* 全局主按钮带向下发散的蓝色阴影和上浮动效，被横向滚动容器裁掉后是一块脏边：单行模式下压平。
   清空 / 高级筛选降为轻量的次要按钮，让「查询」一个按钮说话。 */
.dqp-primary-row.is-one-row .dqp-query-actions .rc-btn.primary { min-width: 58px; box-shadow: none; transform: none; }
.dqp-primary-row.is-one-row .dqp-query-actions .rc-btn.primary:hover { box-shadow: none; transform: none; background: var(--rc-primary-ink, #1d4ed8); border-color: var(--rc-primary-ink, #1d4ed8); color: #fff; }
.dqp-primary-row.is-one-row .dqp-query-actions .rc-btn:not(.primary) { border-color: transparent; background: transparent; color: var(--rc-text-2); }
.dqp-primary-row.is-one-row .dqp-query-actions .rc-btn:not(.primary):hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
/* 13.6 寸（约 1090px 可用）下尽量让「筛选 + 查询」一屏装下，右边的操作按钮靠横向滚动 */
.dqp-primary-row.is-one-row :deep(.dqp-data-id) { width: 132px !important; }
.dqp-primary-row.is-one-row :deep(.dqp-parent-id) { width: 80px !important; }
.dqp-primary-row.is-one-row :deep(.dqp-state) { width: 136px !important; }
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
.dqp-table.is-row-clickable :deep(.el-table__body tr) { cursor: pointer; }
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

<style scoped>
.dqp.is-workspace { min-width: 0; }
.is-workspace .dqp-primary-row.rc-toolbar.wrap { flex-wrap: wrap; overflow: visible; gap: 10px; align-items: center; }
.is-workspace .dqp-context { display: flex; flex-wrap: wrap; flex: 0 1 auto; gap: 8px; min-width: 0; max-width: 100%; border: 0; padding: 0; margin: 0; }
.is-workspace .dqp-query-actions { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.is-workspace .dqp-spacer { display: none; }
.is-workspace .dqp-quick-slot { margin-left: auto; }
.is-workspace .dqp-data-id { width: 160px !important; max-width: 100%; }
.is-workspace .dqp-query-row { padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.dqp-result-heading { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; font-size: 12px; }
.dqp-result-heading span { color: var(--rc-muted); }
.is-workspace .dqp-table-tools { flex-wrap: wrap; padding: 10px 12px; }
.dqp-result-actions { display: flex; align-items: center; gap: 6px; flex: 1; flex-wrap: wrap; min-width: 0; }
.dqp-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 260px; padding: 28px 20px; line-height: 1.5; }
.dqp-empty strong { color: var(--rc-text); font-size: 14px; }
.dqp-empty-conditions { max-width: 600px; overflow-wrap: anywhere; white-space: normal; color: var(--rc-muted); }
.is-workspace .dqp-table :deep(.el-table__empty-text) { width: 100%; line-height: 1.5; }
.is-workspace .dqp-pager { flex-wrap: wrap; padding: 10px 12px; }
.is-workspace .dqp-pager :deep(.el-pagination) { flex-wrap: wrap; justify-content: flex-end; row-gap: 8px; }
</style>
