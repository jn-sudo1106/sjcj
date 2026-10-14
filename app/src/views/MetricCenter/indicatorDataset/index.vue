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
//   1. **指标相关入口暂不可用**：增加指标 / 指标-新 / 行内「指标」依赖旧项目的
//      MeasureAdd（349 行）/ MeasureAddNew（286 行）/ MeasureShow → MeasureList（585 行，自带 dataSource
//      与一堆级联选择器），这三套在新平台**尚未迁移**（MetricCenter 的 indicatorsList 还是占位）。
//      本次保留入口与 1:1 布局，点击给明确提示，等指标页迁完再接回去。
//      接线时的入参：旧 `handleAddMeasure/New` 传 `(record.sourceId, record, record.entryTypeId)`，
//      `handleShowMeasure` 传 `(record.sourceId, record.entryTypeId, record.datasetId)`。
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
//      （清空查询条件但**不清输入框里的字**）也照抄了——同样是旧版行为。
//   8. 提示形态：旧 `$message.*` → `ElMessage.*`、旧 `$notification.*({message})` → `ElNotification.*`，
//      文案原样保留；写操作**失败**时统一走平台默认的 `err.message`，不再拼旧页的「xxx失败 + err」前缀
//      （confirmDanger 内置的错误上报口径，见 utils/confirmDanger.ts）。
//   9. 旧页 `filters.changeTime`（返回常量 '11' 的废 filter）与 `options.alert`（旧 s-table 的已选条数
//      提示条，页面从没传 alert，故从未渲染）——不迁。
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElNotification, type TableInstance } from 'element-plus'
import { ArrowDown, Plus, Scissor, Search, Setting, WarningFilled } from '@element-plus/icons-vue'
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

defineOptions({ name: 'IndicatorDataset' })

const route = useRoute()

// ---- 查询条件（草稿 → 执行 两态：筛选项变化不自动查，点「查询」才发请求）----
const form = reactive({
  datasetId: '', // ID
  sourceId: '', // 源ID
  entryTypeId: '', // 表ID
  enable: '', // '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的
})
/** 已「执行」的筛选条件。分页单独管——旧 datasetPaged 只发筛选字段 + page/limit。 */
const filters = reactive({
  datasetId: '',
  sourceId: '',
  entryTypeId: '',
  enable: '',
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

async function load() {
  loading.value = true
  try {
    const res = await datasetPaged({
      datasetId: filters.datasetId,
      sourceId: filters.sourceId,
      entryTypeId: filters.entryTypeId,
      enable: filters.enable,
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

/** 旧 `queryParam = {}`（清筛选条件；输入框里的字保留），`reload` 控制是否顺带重查 */
function resetFilters(reload = true) {
  filters.datasetId = ''
  filters.sourceId = ''
  filters.entryTypeId = ''
  filters.enable = ''
  filters.entryType = ''
  filters.configId = ''
  page.value = 1
  if (reload) void load()
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
      // 旧版复制成功后会 `this.queryParam = {}` —— 清条件但不清输入框（见文件头偏差第 7 条）
      resetFilters(false)
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

// ---- 指标模块未迁移的占位入口（见文件头偏差第 1 条）----
const MEASURE_PENDING = '指标模块（MeasureList / MeasureAdd / MeasureAddNew）尚未迁移，该入口暂未接通'
function pendingMeasure(kind: string) {
  ElMessage.warning(`${MEASURE_PENDING}（${kind}）`)
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
    <div class="ids-head">
      <div class="ids-title">指标数据集</div>
      <div class="ids-sub">
        按 ID、源、表与状态筛选数据集；支持编辑、批量启停、制作副本、由源快速生成与立即执行指标。
      </div>
    </div>

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
              <el-option label="全部" value="" />
              <el-option label="在用" value="0" />
              <el-option label="停用" value="1" />
              <el-option label="历史删除的" value="-1" />
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
      <el-button type="primary" :icon="Plus" @click="pendingMeasure('增加指标')">增加指标</el-button>
      <el-button type="primary" :icon="Plus" @click="pendingMeasure('指标-新')">指标-新</el-button>
      <el-button @click="handleRunNow(null)">立即运行(从上次ID)</el-button>
      <el-button @click="handleRunNowWithId">立即执行(手工设ID)</el-button>
      <el-button @click="batchChangeEnable(0)">启用</el-button>
      <el-button @click="batchChangeEnable(1)">禁用</el-button>
      <!-- 批量操作下拉：旧版 `v-if="selectedRowKeys.length > 0"`（勾选后才出现），
           这里按同域页面（queueCheck / commJob）的既有做法常显、未勾选时置灰，避免按钮忽隐忽现。
           菜单里只有「删除」——「操作日志」是死代码，见文件头偏差第 2 条。 -->
      <el-dropdown class="ids-more" :disabled="!selected.length" @command="onBatchCommand">
        <el-button :icon="Setting" :disabled="!selected.length">
          更多..
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

          <!-- 指标数：旧 measureCntSlot —— 有值是可点的粉色标签（点开该数据集的指标列表） -->
          <span v-else-if="col.slot === 'measureCnt'" class="ids-measure-cnt">
            <el-tag
              v-if="row.measureCnt"
              class="ids-measure-tag"
              size="small"
              @click="pendingMeasure('指标')"
            >
              {{ row.measureCnt }}
            </el-tag>
            <span v-else>-</span>
          </span>

          <!-- 上次运行 / 下次运行：旧 lastDateSlot —— timeago 相对时间 -->
          <span v-else-if="col.slot === 'lastDate'">{{ timeAgo(row[col.dataIndex] as string) }}</span>

          <!-- 操作：旧 actionSlot —— 指标 | 详情 | 编辑 | 更多（制作副本） -->
          <span v-else-if="col.slot === 'action'" class="ids-actions">
            <span class="ids-op-link" @click="pendingMeasure('指标')">指标</span>
            <span class="ids-op-divider">|</span>
            <span class="ids-op-link" @click="openDetail(row)">详情</span>
            <span class="ids-op-divider">|</span>
            <span class="ids-op-link" @click="openEdit(row)">编辑</span>
            <span class="ids-op-divider">|</span>
            <el-dropdown trigger="hover" @command="(cmd: string) => onRowCommand(cmd, row)">
              <span class="ids-op-link ids-op-more">更多<el-icon class="ids-more-caret"><ArrowDown /></el-icon></span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="copy">制作副本</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
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
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <DatasetEditDialog ref="editRef" @saved="onSaved" />
    <DatasetDetailDrawer v-model="detailVisible" :record="detailRecord" />
    <PromptDialog ref="promptRef" @confirm="onPromptConfirm" />
  </div>
</template>

<style scoped>
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
.ids-link,
.ids-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.ids-link:hover,
.ids-op-link:hover {
  text-decoration: underline;
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
  gap: 4px;
}
.ids-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.ids-op-more {
  display: inline-flex;
  align-items: center;
}
.ids-more-caret {
  margin-left: 2px;
  vertical-align: -0.15em;
}
.ids-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
