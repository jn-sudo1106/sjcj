<script setup lang="ts">
// 指标数据集 —— 1:1 迁移旧 data-view `src/page/config/DatasetList.vue`（路由 /config/dataset-list）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   搜索栏：ID(query.datasetId) / 源ID(query.sourceId) / 表ID(query.entryTypeId) /
//           状态(query.enable: ''|'0'|'1'|'-1') + [查询] [+ 增加数据集（仅当有源+表ID 时出现）]
//   操作条：增加指标 / 指标-新 / 立即运行(从上次ID) / 立即执行(手工设ID) / 启用 / 禁用 /
//           「更多..」下拉（勾选后出现，菜单只有「删除」）
//   表格：DATASET.base 12 列（数据集ID / 数据集名称 / 指标数 / 表ID / 上次ID / 定时 / 上次运行 /
//         下次运行 / 执行 / 成功 / 状态 / 操作），5 个插槽 idSlot / nameSlot / measureCntSlot /
//         lastDateSlot / actionSlot；行内操作 = 指标 + 详情 + 编辑 +「更多」（制作副本 / 操作日志）
//   分页：默认 10（旧 `:pageSize="10"`，它覆盖了 pagination.defaultPageSize:20），
//         可选 10/20/40/100/200，共N条 + 快速跳页
//   弹窗：base-edit-modal（编辑）/ base-detail-drawer（详情）/ prompt（手工设 FROM_ID）/
//         measure-show、measure-add、measure-add-new（指标三件套）
//   接口：datasetPaged / genDatasetFromSource / runMeasureNow / changeDatasetEnable / deleteDataSets /
//         copyDataset / updateDataSet（7 条全部走真实接口，见 api/dataset.ts）
//
// 有意偏差（都在交付说明里单列）：
//   1. **指标三件套入口全部原地弹层**（1014 修正）：上一版这里是本页最大的偏差 —— 新平台当时
//      没有「弹窗里嵌一个整页」这套形态，于是把「增加指标 / 指标-新 / 行内「指标」」三个入口都
//      改成 `router.replace` 跳「指标列表」页签。现在按旧版形态改回**原地开弹层**，不再跳页：
//        · 表格「指标数」标签 / 操作列「指标」 → `MeasureShowDialog`
//          （旧 `MeasureShow`：a-modal 包住整页 MeasureList）→
//          `showModal(record.sourceId, record.entryTypeId, record.datasetId)`
//        · 操作条「增加指标」 → `MeasureAddDialog`（旧 `MeasureAdd` 抽屉）→
//          `doEdit(record.sourceId, record, record.entryTypeId)`
//        · 操作条「指标-新」 → `MeasureAddNewDialog`（旧 `MeasureAddNew` 抽屉）→ 同上
//      后两个组件的实现在 `../indicatorsList/` 下（本页只负责接线）。关掉弹层后仍停在数据集列表上
//      —— 这才是旧版行为。跳页签那套（`tab=indicatorsList` + `add=1|new`）随之整体删除，
//      indicatorsList 里对应的自动开弹窗机制也一并去掉（见该文件文件头偏差第 12 条）。
//      「增加指标 / 指标-新」照旧要求**恰好选中 1 行**（旧版选了 0 行或 >1 行都给「请选择要一行
//      操作的数据集」，第二句尾部那个多出来的「2」是旧版原文）。入参一一对应：旧 `doEdit` 里
//      `Object.assign(form, record)` 会把**整条数据集记录**（datasetId / datasetName / entryTypeId /
//      measureCnt …）合进提交体，所以第二参直接传选中的那一行。
//      旧 `addMeasureCallback` 只 `console.log`、不刷新列表 —— 照抄（新增/取消后「指标数」要等下次
//      点「查询」才更新）；旧 `MeasureShow` 关闭时 `$emit('refresh')` 在旧 DatasetList 上也没挂监听，
//      同样不刷新。别顺手补刷新。
//   2. 不迁死代码：「操作日志」菜单项（`showLogModal` 里的 `$refs.logModal` 在模板里根本没注册，
//      且传的是 `record.configId`——数据集记录上没有这个字段，双重失效）；旧 `resetSearchForm` /
//      `handleSearch` / `handleReset` / `handleCloseCurrentTab` / `handleOpenTab` / `handleShowEntryType`
//      / `doInit` 同样从未接线；`Ellipsis` / `TagSelect` / `StandardFormRow` / `DetailList` 只有 import
//      没用上。以上全部不迁。
//      「更多..」下拉因此只剩「制作副本」一项，行内仍按旧版 hover 展开。
//   3. props 不迁，改从 `$route.query` 取：旧版是 `modal / sourceId / entryTypeId / read` 四个 props
//      （`handleGenDataset` 依赖 props 的 sourceId/entryTypeId），路由页没有 props → 改为读
//      query 的 `sourceId` / `entryTypeId`（「增加数据集」按钮的出现条件随之改为这两个键存在）。
//      旧 `created` 里的 `$route.query.entryType` 透传、`watch $route.query.configId → handleRefresh`
//      一并保留（旧 queryParam 里这两个键会随请求发出去）。
//   4. 表头排序是**服务端**排序：旧列上的 `sorter: true` / 比较函数经旧 s-table（components/Table/
//      index.js 的 `onChange={this.loadData}`）转成 sortField / sortOrder 随 GET 发出去，值用 antd
//      原生的 'ascend' / 'descend'。新版用 el-table 的 `sortable="custom"`——它只渲染表头箭头 +
//      抛 sort-change，**不排当前页**，排序仍由后端做（'ascending'/'descending' 在 onSortChange 里
//      映射回 ascend/descend）。7 个可排序列：datasetId / measureCnt / entryTypeId / lastId /
//      lastRun / nextRun / sourceId。
//   5. 首屏**保留**旧版「自动选中第一行」：旧 loadData 里 `selectedRowKeys = [oriData[0].datasetId]`
//      在数据集页是**真的生效**的（datasetId 存在，不像队列告警页那样是个错字段）。每次 load
//      （含翻页、批量操作后刷新）都会重新选中响应第一行——这是旧版行为，不是新加的。
//   6. 列宽自适应：文本列（数据集名称 / 定时）走 `minWidth`，数值/状态/操作列走固定 `width`；
//      旧版全部写死 width，容器宽时右侧会留白（el-table 的 flex 分配只对非数字 width 的列生效）。
//   7. 弹层：`base-edit-modal` → `DatasetEditDialog`、`base-detail-drawer` → `DatasetDetailDrawer`
//      （按新平台惯例改右侧抽屉）、`prompt` → `PromptDialog`。旧 `handleCopy` 成功后 `queryParam = {}`
//      （清空查询条件但**不清输入框里的字**）**不再照抄**（1019 修正）：制作副本后保留当前筛选条件
//      与页码、只刷新列表，不再把条件清空。
//   8. 提示形态：旧 `$message.*` → `ElMessage.*`、旧 `$notification.*({message})` → `ElNotification.*`，
//      文案原样保留；写操作**失败**时统一走平台默认的 `err.message`，不再拼旧页的「xxx失败 + err」前缀
//      （confirmDanger 内置的错误上报口径，见 utils/confirmDanger.ts）。
//   9. 旧页 `filters.changeTime`（返回常量 '11' 的废 filter）与 `options.alert`（旧 s-table 的已选条数
//      提示条，页面从没传 alert，故从未渲染）——不迁。
//  10. 状态筛选的「全部」：旧 a-select 用 `value=""` 表示全部，el-select 把空串当「未选中」
//      （选完输入框只剩 placeholder），故下拉里改用哨兵——全部 = -1、历史删除的 = -2，
//      调 `datasetPaged` 时由 `toApiEnable()` 还原成 '' / '-1'，后端 enable 口径不变。
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElNotification, type TableInstance } from 'element-plus'
import {
  ArrowDown,
  Plus,
  Scissor,
  Search,
  Setting,
  WarningFilled,
  DataAnalysis,
  View,
  DocumentCopy,
  Edit
} from '@element-plus/icons-vue'
import {
  changeDatasetEnable,
  copyDataset,
  datasetPaged,
  deleteDataSets,
  genDatasetFromSource,
  runMeasureNow,
  type DatasetRow,
} from '@/api/dataset'
import { timeAgo } from '@/utils/format/relativeTime'
import { confirmDanger } from '@/utils/confirmDanger'
import { DATASET_BASE } from './columns'
import DatasetEditDialog from './DatasetEditDialog.vue'
import DatasetDetailDrawer from './DatasetDetailDrawer.vue'
import PromptDialog from './PromptDialog.vue'
// 指标三件套（旧 MeasureShow / MeasureAdd / MeasureAddNew）。后两个的实现在 indicatorsList 下，
// 是「指标列表」页与数据集页共用的同一套组件（旧平台也是这么复用的：DatasetList 直接 import
// `@/page/base/measure/MeasureAdd`）。见文件头偏差第 1 条。
import MeasureShowDialog from './MeasureShowDialog.vue'
import MeasureAddDialog from '../indicatorsList/MeasureAddDialog.vue'
import MeasureAddNewDialog from '../indicatorsList/MeasureAddNewDialog.vue'

defineOptions({ name: 'IndicatorDataset' })

const route = useRoute()

// ---- 查询条件（草稿 → 执行 两态：筛选项变化不自动查，点「查询」才发请求）----
/**
 * 「状态」下拉的两个哨兵值。下拉内部**不能**用空串：Element Plus 的 `hasModelValue` 用
 * `isEmptyValue(modelValue)` 判定，'' 会被当成「没选」，选完「全部」输入框里只剩 placeholder。
 * 所以下拉里用哨兵，到接口那层（`load()` 的 `toApiEnable`）再还原成后端口径：
 *   全部(-1)   → ''（datasetPaged 空串 = 不限状态）
 *   历史删除(-2)→ '-1'（后端 enable 与 isDelete 同向，-1 才是「历史删除的」）
 * 两个哨兵不能都用 -1，否则两个选项同值，el-select 只会显示第一个「全部」。
 */
const ENABLE_ALL = '-1'
const ENABLE_DELETED = '-2'

const form = reactive({
  datasetId: '', // ID
  sourceId: '', // 源ID
  entryTypeId: '', // 表ID
  enable: ENABLE_ALL, // 全部 / '0' 在用 / '1' 停用 / 历史删除的（见上面哨兵说明）
})
/** 已「执行」的筛选条件。分页单独管——旧 datasetPaged 只发筛选字段 + page/limit。 */
const filters = reactive({
  datasetId: '',
  sourceId: '',
  entryTypeId: '',
  enable: ENABLE_ALL,
  /** 旧 `$route.query.entryType` 透传键 */
  entryType: '',
  /** 旧 `$route.query.configId` / watch 透传键 */
  configId: '',
})

/** 表头排序（服务端口径，与旧 s-table 一致：field = 列 dataIndex，order = 'ascend' | 'descend'）。 */
const sort = reactive({ field: '', order: '' })

// ---- 列表状态 ----
const rows = ref<DatasetRow[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 datasetId（旧 s-table 的 rowKey 就是 record.datasetId） */
const selected = ref<Array<string | number>>([])
const selectedRows = ref<DatasetRow[]>([])
const page = ref(1)
const size = ref(10) // 旧 `:pageSize="10"`（覆盖了 pagination.defaultPageSize:20）
const tableRef = ref<TableInstance>()

/** 旧 props 的 sourceId / entryTypeId（「增加数据集」的出现条件），路由页从 query 取 */
const routeSourceId = ref('')
const routeEntryTypeId = ref('')

const showGenDataset = computed(() => !!routeSourceId.value && !!routeEntryTypeId.value)

/** 下拉哨兵 → 接口 enable 口径（'' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的） */
function toApiEnable(value: string): string {
  if (value === ENABLE_ALL) return ''
  if (value === ENABLE_DELETED) return '-1'
  return value
}

async function load() {
  loading.value = true
  try {
    const res = await datasetPaged({
      datasetId: filters.datasetId,
      sourceId: filters.sourceId,
      entryTypeId: filters.entryTypeId,
      // 选「全部」时接口仍按旧口径传空串（不是 -1），历史删除的还原成后端的 -1
      enable: toApiEnable(filters.enable),
      entryType: filters.entryType,
      configId: filters.configId,
      page: page.value,
      limit: size.value,
      // 表头有排序时才带上这两个键（旧 s-table 无排序时参数里根本没有 sortField/sortOrder）
      ...(sort.field && sort.order ? { sortField: sort.field, sortOrder: sort.order } : {}),
    })
    rows.value = res.list ?? []
    total.value = Number(res.total ?? 0)
    await nextTick()
    // 旧 loadData：响应非空时自动选中第一行（见文件头偏差第 5 条）
    syncFirstRow()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据集列表失败')
    rows.value = []
    total.value = 0
    selected.value = []
    selectedRows.value = []
  } finally {
    loading.value = false
  }
}

/** 旧 `selectedRowKeys = [oriData[0].datasetId]` 的等价实现。
 *  el-table 的勾选由内部 store 管，光改数组不会勾上，所以走 clearSelection + toggleRowSelection。 */
function syncFirstRow() {
  const table = tableRef.value
  table?.clearSelection()
  const first = rows.value[0]
  if (!first) {
    selected.value = []
    selectedRows.value = []
    return
  }
  table?.toggleRowSelection(first, true)
}

function runQuery() {
  filters.datasetId = form.datasetId.trim()
  filters.sourceId = form.sourceId.trim()
  filters.entryTypeId = form.entryTypeId.trim()
  filters.enable = form.enable
  page.value = 1
  void load()
}

function onSelectionChange(selection: DatasetRow[]) {
  selected.value = selection.map((row) => row.datasetId)
  selectedRows.value = selection
}

/** 旧版每批操作后 `selectedRowKeys = []`（受控 rowSelection，表格勾选会同步清空）。
 *  el-table 的勾选由内部 store 管，光清数组会出现「按钮已置灰、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  selectedRows.value = []
  tableRef.value?.clearSelection()
}

const msgOf = (res: unknown): string => String((res as { message?: unknown } | null)?.message ?? '')
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ---- 增加数据集（旧 handleGenDataset：由源 + 表ID 快速生成）----
function handleGenDataset() {
  if (!routeSourceId.value) {
    ElMessage.error('必须有源，请从实例表数据进入')
    return
  }
  if (!routeEntryTypeId.value) {
    ElMessage.error('必须有表ID，请从实例表数据进入')
    return
  }
  // 旧版判据是 `oriData.length > 0`（就是「本页有数据」），只影响提示语，不拦确认
  const has = rows.value.length > 0
  if (has) ElMessage.info('该源下已有数据集')
  void confirmDanger(
    has ? '建议用已有数据集！点确认新增一个数据集' : '新生成数据集',
    `是否快速生成数据集，源:${routeSourceId.value},表ID:${routeEntryTypeId.value}`,
    async () => {
      const res = (await genDatasetFromSource(routeSourceId.value, routeEntryTypeId.value)) as {
        message?: string
      }
      ElMessage.success('快速生成数据集成功!返回值:' + msgOf(res))
      void load()
      return res
    },
    // 成功提示已在 run 里按旧页文案弹过，这里不要再让 confirmDanger 弹一遍默认 toast
    () => {},
  )
}

// ---- 立即执行指标（旧 handleRunNow / handleRunNowWithId）----
async function handleRunNow(lastId?: number | string | null) {
  if (!selectedRows.value.length) {
    ElNotification.error({ message: '请选择要执行指标' })
    return
  }
  try {
    const res = await runMeasureNow(selected.value, lastId)
    ElNotification.success({ message: '提交成功:' + msgOf(res) })
    void load()
  } catch (err) {
    ElNotification.error({ message: '失败原因:' + errText(err) })
  }
}

const promptRef = ref<InstanceType<typeof PromptDialog>>()

function handleRunNowWithId() {
  if (!selectedRows.value.length) {
    ElNotification.error({ message: '请选择要执行指标' })
    return
  }
  // 旧 config：width 500 / title 同文案 / 单个 FROM_ID 字段，defaultValue 0
  promptRef.value?.show({
    width: 500,
    title: '请输入从以下数据ID开始执行指标',
    cols: [{ title: 'FROM_ID', span: 4, defaultValue: 0, dataIndex: 'lastId' }],
  })
}

function onPromptConfirm(payload: Record<string, unknown>) {
  void handleRunNow(payload.lastId as number | string)
}

// ---- 批量启停（旧 batchChangeEnable：**没有**二次确认，直连接口）----
async function batchChangeEnable(enable: number) {
  if (!selectedRows.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  try {
    await changeDatasetEnable(ids, enable)
    ElMessage.success('更新状态成功!')
    clearSelection()
    void load()
  } catch (err) {
    ElNotification.error({ message: '更新状态失败' + errText(err) })
  }
}

// ---- 批量删除（旧 batchDelete：$confirm → deleteDataSets）----
function batchDelete() {
  if (!selectedRows.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  void confirmDanger(
    '提示',
    `是否确认要删除以下数据集:${ids.length}`,
    async () => {
      const res = (await deleteDataSets(ids)) as { message?: string }
      ElMessage.success('删除指标成功,本次删除:' + msgOf(res))
      clearSelection()
      void load()
      return res
    },
    () => {},
  )
}

/** 「更多..」下拉派发：command 与菜单项一一对应（旧 batchChangeEnable(0)/(1)、batchDelete） */
function onBatchCommand(command: string) {
  if (command === 'enable') void batchChangeEnable(0)
  else if (command === 'disable') void batchChangeEnable(1)
  else if (command === 'delete') batchDelete()
}

// ---- 单行操作 ----
const editRef = ref<InstanceType<typeof DatasetEditDialog>>()
const detailVisible = ref(false)
const detailRecord = ref<DatasetRow | null>(null)

function openEdit(row: DatasetRow) {
  editRef.value?.openDialog(row)
}
function openDetail(row: DatasetRow) {
  detailRecord.value = row
  detailVisible.value = true
}
function onSaved() {
  void load()
}
/** 旧 handleCopy：$confirm → copyDataset(record.datasetId) */
function handleCopy(row: DatasetRow) {
  void confirmDanger(
    '提示',
    `是否确认生成该数据集的新副本: [${String(row.datasetName ?? '')} ]?`,
    async () => {
      const res = (await copyDataset(row.datasetId)) as { message?: string }
      // 1019 修正：复制成功后**保留**当前筛选条件与页码，只刷新列表（旧版这里 `queryParam = {}`，
      // 清条件 + 翻回第 1 页：刚复制的副本还没看到，条件先没了，用户还得重新填一遍才能继续操作）
      ElNotification.success({ message: '复制成功,请刷新后查询最新ID' })
      void load()
      return res
    },
    () => {},
  )
}
/** 行内「更多」下拉派发 */
function onRowCommand(command: string, row: DatasetRow) {
  if (command === 'copy') handleCopy(row)
}

// ---- 指标三件套接线（旧 MeasureShow / MeasureAdd / MeasureAddNew，见文件头偏差第 1 条）----
// 三个入口全部**原地**开弹层，关掉后仍停在数据集列表上（旧版行为）。上一版这里是
// `router.replace` 跳「指标列表」页签，已删除（连带 indicatorsList 里的 add=1|new 机制）。
const measureShowRef = ref<InstanceType<typeof MeasureShowDialog>>()
const addMeasureRef = ref<InstanceType<typeof MeasureAddDialog>>()
const addMeasureNewRef = ref<InstanceType<typeof MeasureAddNewDialog>>()

/** 旧 `handleAddMeasure()`：必须恰好选中 1 行，否则「请选择要一行操作的数据集」。
 *  → `$refs.addMeasure.doEdit(curRecord.sourceId, curRecord, curRecord.entryTypeId)`
 *  （第二参传**整行**：旧 doEdit 里 `Object.assign(form, record)` 会把 datasetId / datasetName /
 *    entryTypeId / measureCnt … 一并带进提交体）。 */
function handleAddMeasure() {
  if (selected.value.length !== 1) {
    ElMessage.error('请选择要一行操作的数据集')
    return
  }
  const record = selectedRows.value[0]
  addMeasureRef.value?.open(record.sourceId, record, record.entryTypeId)
}

/** 旧 `handleAddMeasureNew()`：同上，文案尾部多一个「2」（旧版原文，保留） */
function handleAddMeasureNew() {
  if (selected.value.length !== 1) {
    ElMessage.error('请选择要一行操作的数据集2')
    return
  }
  const record = selectedRows.value[0]
  addMeasureNewRef.value?.open(record.sourceId, record, record.entryTypeId)
}

/** 旧 `handleShowMeasure(record)`：表格「指标数」标签 / 操作列「指标」
 *  → `$refs.showMeasure.showModal(record.sourceId, record.entryTypeId, record.datasetId)` */
function handleShowMeasure(row: DatasetRow) {
  measureShowRef.value?.open(row.sourceId, row.entryTypeId, row.datasetId)
}

// ---- 表头排序（服务端）----
function onSortChange(payload: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  sort.field = payload.order && payload.prop ? payload.prop : ''
  sort.order = payload.order === 'ascending' ? 'ascend' : payload.order === 'descending' ? 'descend' : ''
  void load()
}

// ---- 分页（旧 s-table：共N条 + 快速跳页）----
function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

// ---- 路由 query（旧 props + created + watch 的等价物）----
function pickQuery(key: string): string {
  const value = route.query[key]
  const text = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
  return text.trim()
}

function applyRouteQuery() {
  const sourceId = pickQuery('sourceId')
  if (sourceId) {
    routeSourceId.value = sourceId
    form.sourceId = sourceId
    filters.sourceId = sourceId
  }
  const entryTypeId = pickQuery('entryTypeId')
  if (entryTypeId) {
    routeEntryTypeId.value = entryTypeId
    form.entryTypeId = entryTypeId
    filters.entryTypeId = entryTypeId
  }
  // 旧 created：`$route.query.entryType` → queryParam.entryType（不是 entryTypeId），随请求透传
  const entryType = pickQuery('entryType')
  if (entryType) filters.entryType = entryType
  const configId = pickQuery('configId')
  if (configId) filters.configId = configId
}

// 旧 `watch '$route.query.configId'` → 改条件并重查
watch(
  () => pickQuery('configId'),
  (configId) => {
    filters.configId = configId
    void load()
  },
)

onMounted(() => {
  applyRouteQuery()
  void load()
})
</script>

<template>
  <div class="ids-shell">
    <!-- <div class="ids-head">
      <div class="ids-title">指标数据集</div>
      <div class="ids-sub">
        按 ID、源、表与状态筛选数据集；支持编辑、批量启停、制作副本、由源快速生成与立即执行指标。
      </div>
    </div> -->

    <!-- 筛选表单（对齐旧 a-form layout="inline" + a-row 栅格；改条件不自动查，点「查询」才发请求） -->
    <el-form :inline="true" class="ids-filter-form">
      <el-row :gutter="8" class="ids-filter-row">
        <el-col :md="4" :sm="24">
          <el-form-item label="ID">
            <el-input v-model="form.datasetId" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="源ID">
            <el-input v-model="form.sourceId" placeholder="数据源" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="表ID">
            <el-input v-model="form.entryTypeId" placeholder="数据表" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="状态">
            <el-select v-model="form.enable" placeholder="请选择">
              <!-- 「全部」用 -1 哨兵：空串会被 el-select 当成「没选」，选完只显示 placeholder（见文件上方哨兵说明） -->
              <el-option label="全部" :value="ENABLE_ALL" />
              <el-option label="在用" value="0" />
              <el-option label="停用" value="1" />
              <el-option label="历史删除的" :value="ENABLE_DELETED" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="6" :sm="24">
          <el-form-item>
            <el-button :icon="Search" @click="runQuery">查询</el-button>
            <!-- 旧版 v-if="this.sourceId && this.entryTypeId"（props）→ 路由 query 的两个键 -->
            <el-button v-if="showGenDataset" type="primary" @click="handleGenDataset">增加数据集</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <!-- 操作条：旧版 .operation（`v-if="!modal"`；路由页没有 modal 形态，恒显示） -->
    <div class="ids-op-bar">
      <el-button type="primary" :icon="Plus" @click="handleAddMeasure">增加指标</el-button>
      <el-button type="primary" :icon="Plus" @click="handleAddMeasureNew">指标-新</el-button>
      <el-button @click="handleRunNow(null)">立即运行(从上次ID)</el-button>
      <el-button @click="handleRunNowWithId">立即执行(手工设ID)</el-button>
      <el-button @click="batchChangeEnable(0)">启用</el-button>
      <el-button @click="batchChangeEnable(1)">禁用</el-button>
      <!-- 批量操作下拉：旧版 `v-if="selectedRowKeys.length > 0"`（勾选后才出现），
           这里按同域页面（queueCheck / commJob）的既有做法常显、未勾选时置灰，避免按钮忽隐忽现。
           菜单里只有「删除」——「操作日志」是死代码，见文件头偏差第 2 条。 -->
      <el-dropdown class="ids-more" :disabled="!selected.length" @command="onBatchCommand">
        <el-button :icon="Setting" :disabled="!selected.length">
          更多
          <el-icon class="ids-more-arrow"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="delete" :icon="Scissor">删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 表格：列定义来自 allColumns.DATASET.base（标题/对齐/顺序 1:1）。
         列宽自适应：文本列走 min-width（吃满剩余空间），数值/状态/操作列走固定 width。
         表头排序：col.sorter 的列挂 sortable="custom"（= 旧 sorter），箭头由 el-table 画，
         排序交给后端（@sort-change → sortField/sortOrder），所以不传 default-sort。 -->
    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="rows"
      border
      size="small"
      max-height="550"
      :row-key="(r: DatasetRow) => r.datasetId"
      @selection-change="onSelectionChange"
      @sort-change="onSortChange"
    >
      <el-table-column type="selection" width="40" />
      <el-table-column
        v-for="col in DATASET_BASE"
        :key="col.dataIndex"
        :label="col.title"
        :prop="col.dataIndex"
        :width="col.minWidth ? undefined : col.width"
        :min-width="col.minWidth"
        :align="col.align ?? 'left'"
        :sortable="col.sorter ? 'custom' : false"
        :show-overflow-tooltip="col.slot === 'name'"
      >
        <template #default="{ row }">
          <!-- 数据集ID：旧 idSlot —— 在用=纯文本；停用=红标签；历史删除=? + 标签 -->
          <template v-if="col.slot === 'id'">
            <span v-if="Number(row.isDelete) === 0">{{ row.datasetId }}</span>
            <el-tag v-else-if="Number(row.isDelete) === 1" type="danger" size="small">{{ row.datasetId }}</el-tag>
            <span v-else class="ids-history">
              <el-icon class="ids-warn"><WarningFilled /></el-icon>
              <el-tag size="small">{{ row.datasetId }}</el-tag>
            </span>
          </template>

          <!-- 数据集名称：旧 nameSlot —— 限宽省略 + popover 全文，点击进详情 -->
          <span v-else-if="col.slot === 'name'" class="ids-name">
            <el-tooltip :content="String(row.datasetName ?? '')" placement="top-start">
              <a class="ids-link" @click="openDetail(row)">{{ row.datasetName }}</a>
            </el-tooltip>
          </span>

          <!-- 指标数：旧 measureCntSlot —— 有值是可点的粉色标签（点开该数据集的指标弹窗） -->
          <span v-else-if="col.slot === 'measureCnt'" class="ids-measure-cnt">
            <el-tag
              v-if="row.measureCnt"
              class="ids-measure-tag"
              size="small"
              @click="handleShowMeasure(row)"
            >
              {{ row.measureCnt }}
            </el-tag>
            <span v-else>-</span>
          </span>

          <!-- 上次运行 / 下次运行：旧 lastDateSlot —— timeago 相对时间 -->
          <span v-else-if="col.slot === 'lastDate'">{{ timeAgo(row[col.dataIndex] as string) }}</span>

          <!-- 操作：旧 actionSlot —— 指标 / 详情 / 编辑 / 制作副本（图标化，原行内「更多」平铺） -->
          <span v-else-if="col.slot === 'action'" class="ids-actions">
            <el-tooltip content="指标" placement="top">
              <span class="ids-op-icon" @click="handleShowMeasure(row)"><el-icon :size="15"><DataAnalysis /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="详情" placement="top">
              <span class="ids-op-icon" @click="openDetail(row)"><el-icon :size="15"><View /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="编辑" placement="top">
              <span class="ids-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="制作副本" placement="top">
              <span class="ids-op-icon" @click="onRowCommand('copy', row)"><el-icon :size="15"><DocumentCopy /></el-icon></span>
            </el-tooltip>
          </span>

          <!-- 其余列（上次ID / 定时 / 执行 / 成功 / 状态）：直接显示字段值，不做映射（旧列配置就是裸字段） -->
          <span v-else>{{ String(row[col.dataIndex] ?? '') }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：默认 10，可选 10/20/40/100/200，共N条 + 快速跳页（旧 s-table pagination 口径） -->
    <div class="ids-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        size="small"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <DatasetEditDialog ref="editRef" @saved="onSaved" />
    <DatasetDetailDrawer v-model="detailVisible" :record="detailRecord" />
    <PromptDialog ref="promptRef" @confirm="onPromptConfirm" />

    <!-- 指标三件套（旧 MeasureShow / MeasureAdd / MeasureAddNew）—— 见文件头偏差第 1 条。
         三个入口都是**原地**开弹层。旧版新增 / 取消后不刷新数据集列表
         （`addMeasureCallback` 只 `console.log`），所以这里不挂 @saved 监听。 -->
    <MeasureShowDialog ref="measureShowRef" />
    <MeasureAddDialog ref="addMeasureRef" />
    <MeasureAddNewDialog ref="addMeasureNewRef" />
  </div>
</template>

<style scoped>
/* 表头文字颜色统一 */
.ids-shell :deep(.el-table__header th) {
  color: var(--rc-text-2);
}
.ids-shell {
  display: flex;
  flex-direction: column;
  height: fit-content;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
  overflow: hidden;
}
.ids-head {
  margin-bottom: 2px;
}
.ids-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.ids-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
/* 筛选表单：对齐旧 a-form layout="inline" 的栅格宽度比例 */
.ids-filter-form {
  margin-bottom: 0;
}
.ids-filter-row {
  width: 100%;
}
.ids-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.ids-filter-form :deep(.el-select),
.ids-filter-form :deep(.el-input) {
  width: 100%;
}
.ids-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
/* 按钮组不撑满 col */
.ids-filter-form .el-col:last-child :deep(.el-form-item) {
  width: auto;
}
.ids-op-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.ids-more-arrow {
  margin-left: 4px;
  vertical-align: -0.15em;
}
/* 数据集名称：旧版是 div max-width:180px + 省略 + popover 全文；列宽自适应后内容区跟着列宽走，
   故改为 100% 免得右侧留白（同 queueCheck 的处理） */
.ids-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
}
.ids-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.ids-link:hover {
  text-decoration: underline;
}
.ids-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  /* color: var(--rc-primary, #2563eb); */
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.ids-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.ids-history {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ids-warn {
  color: var(--rc-error, #dc2626);
}
.ids-measure-cnt {
  display: flex;
  justify-content: center;
}
.ids-measure-tag {
  /* 旧 a-tag color: #c41d7f 的等价物：浅底 + 粉字 + 可点 */
  --el-tag-bg-color: #fafafa;
  --el-tag-border-color: var(--rc-border, #e2e8f0);
  --el-tag-text-color: #c41d7f;
  min-width: 55px;
  justify-content: center;
  cursor: pointer;
}
.ids-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.ids-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>

