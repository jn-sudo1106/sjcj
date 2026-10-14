<script setup lang="ts">
// 指标列表 —— 1:1 迁移旧 data-view `src/page/config/MeasureList.vue`（路由 /config/measure-list）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   布局：a-card → a-row(gutter 2) → 左 `category-tree`（span 4）+ 右内容（span 20）
//   搜索栏：数据集ID(queryParam.datasetId) / 源ID(sourceId) / 指标编码(measureCode) /
//           状态(enable: ''|'0'|'1'|'-1') + [查询] [重置]
//   操作条：`操作..` 下拉（`v-if="!modal"`，路由页恒显示）——启用(0) / 禁用(1) / 删除 / 批量复制
//   表格：s-table，pageSize 20、rowKey=measureId、scroll.x=1500、勾选列 +
//         分页（defaultPageSize 20 / 共N条 / 20-40-100-200 / 快速跳页）
//         列 = allColumns.MEASURE.base（13 列），插槽 idSlot / jsonSlot / jsonDimSlot /
//         nameSlot / actionSlot；行内操作 = 详情 + 编辑 + 「更多」（指标副本 / 物理删除 / 操作日志）
//   弹层：base-edit-modal（编辑，cols=editCols，callback=updateCallback）/
//         base-detail-drawer（详情，cols=detailCols）/
//         base-edit-modal ×2（jsonEditDim / jsonEditVal，**不传 callback**）
//   接口：measurePaged / updateMeasure / changeMeasureEnable / deleteMeasures /
//         deleteMeasurePhy / copyMeasure（6 条全部走真实接口，见 api/measure.ts）
//
// 有意偏差（逐条列清，都是「旧版这么写但跑不起来」或「新平台口径不同」的地方）：
//   1. **左侧分类树：旧版点了没反应**。旧 `treeClick/treeCheck` 第一行就 `this.clearParam()`，
//      而 MeasureList 的 methods 里**根本没有 clearParam**（只有 SourceList / SourceRead 有），
//      所以点分类节点会抛 `TypeError: this.clearParam is not a function`、连请求都不发。
//      这里按 SourceList 同名方法的意图还原：清空全部查询条件 → 写入 `categorys` → 回第 1 页重查。
//      顺带：旧页同时监听 `@node-click` 和 `@node-check`，但旧 CategoryTree 只 emit `node-click`
//      （`treeCheck` 是空接线），所以新版只接一个事件源。
//   2. **不迁「批量复制」**。旧链路 `MeasureList.batchCopy → $refs.datasetShow(DatasetChoice)
//      → $refs.batchEdit(MeasureBatchEdit)` 整体是坏的：① 目标数据集选完传给
//      `MeasureBatchEdit.showModal(rows, ds)` 后被**完全忽略**（方法里没接第二个参数）；
//      ② 该组件模板里的 6 个 slot（tag / required / dataType / uniqueKey / operation /
//      inputColumns）在 MEASURE 列集里一个都不存在，`inputColumns` 更是 undefined，
//      弹出来是一张空表；③ 点确定时读 `this.$refs.dataset`，而它自己的模板里没有这个 ref → 抛错。
//      无法「按原样迁移」，也不该凭空发明一套批量复制语义，故只去掉这一个菜单项并在此存档。
//      另外 `MeasureList` 还 import 了 `DataSetShow`（模板里没用到）——同样是死代码。
//      「操作日志」菜单项也去掉：`showLogModal` 读 `$refs.logModal`，模板里同样没有注册。
//   3. props 不迁，改从 `$route.query` 取：旧版有 `modal / sourceId / datasetId / entryTypeId /
//      read` 五个 props（由 `MeasureShow` 弹窗与 DatasetList 内嵌使用）。新平台把「指标」做成
//      MetricCenter 的独立 tab，改成读 query 的 sourceId / entryTypeId / datasetId / configId；
//      额外支持 `add=1|new`（由 indicatorDataset 的「增加指标 / 指标-新」跳进来时自动开弹窗）。
//   4. 查询条件是**同一个对象**（旧版就是 `Object.assign(parameter, this.queryParam)`，没有
//      draft/executed 两态），所以改输入框不会自动重查，点「查询」才发请求；「重置」按旧版
//      只清条件、**不重查**（旧 `@click="() => queryParam = {}"`）。
//      旧 `queryParam = {}` 是**整对象替换**，reactive 对象不能重赋值，这里逐键置空，等价。
//   5. 表头排序是**服务端**排序：旧列只有 ID 带 `sorter`，经旧 s-table 转成 sortField/sortOrder
//      （antd 原生 'ascend'/'descend'）随 GET 发出。新版用 el-table 的 `sortable="custom"`
//      （只画箭头 + 抛 sort-change，不排当前页），onSortChange 里把 'ascending'/'descending'
//      映射回 ascend/descend 再发。
//   6. 列宽自适应：文本列（编码 / 名称 / 类型 / 5 个 JSON 列）走 `minWidth`，数值/状态/操作列
//      走固定 `width`；旧版全部写死 width，容器宽时右侧会留白（el-table 的 flex 分配只对
//      非数字 width 的列生效）。合计宽度仍贴近旧 `scroll.x: 1500`，窄容器照旧横向滚动；
//      另外把**操作列 `fixed: 'right'`**（旧版没固定）——本页列总宽 1610 > 内容区 1176，
//      要横向滚动才看得到右边，固定后「详情 / 编辑 / 更多」不用拉滚动条。
//   7. 「启用」列直接显示 `isDelete` 原值（0/1/-1）——旧列配置没有套 enableFilter 过滤器，
//      旧页表格里也确实显示原始值；**只有详情抽屉**才转成「是[1]/否[0]」
//      （见 shared/ColumnDetailDrawer.vue 的 isDelete 分支）。别顺手给表格加映射。
//   8. 旧模板里的 `freqSlot`（`text ? '月频' : '日频'`，恒为「日频」）和 `lastDateSlot`
//      两个插槽，MEASURE 的任何一列都没引用 → 死代码，不迁（详见 columns.ts 头注）。
//      同理不迁 `showRunPolicy/showParamsModal/showLogModal/handleShowEntryType`——读的
//      `$refs.policyModal/paramModal/logModal/entryTypeDetail` 在模板里都没注册；
//      以及 `resetSearchForm/handleSearch/handleReset/handleCloseCurrentTab/handleOpenTab/
//      handleTopicOpen/toggleAdvanced/topicShow/domains/openKeys/treeData`、
//      `filters.changeTime`（返回常量 '11'）、`options.alert`、`showCategory`（无开关、
//      恒为 true，所以左右分栏恒为 4/20，这里直接写死布局）。
//   9. 弹层：`base-edit-modal` → `shared/ColumnEditDialog.vue`、`base-detail-drawer` →
//      `shared/ColumnDetailDrawer.vue`（按新平台惯例改成右侧抽屉），都是列驱动的同一套组件。
//      JSON 子编辑器仍是 base-edit-modal（旧版 `ref="jsonEditDim/jsonEditVal"` 就是它，
//      不是 JsonSub——JsonSub 只被 MeasureAdd/MeasureAddNew 用），所以传的是 json_dim /
//      json_val 列集且**不传 callback**（旧版这时点确定既不关弹窗也不提示）。
//      旧 `handleEditJson` 里是裸 `JSON.parse(text)`：字段为空串时直接抛 SyntaxError、
//      弹窗打不开。这里空值按 `{}` 打开，非法 JSON 给一条可见提示后不打开（不静默吞）。
//   10. 提示形态：旧 `$message.*` → `ElMessage.*`、旧 `$notification.*({message})` →
//      `ElNotification.*`，文案原样保留（含 `batchDelete` 确认框里那句写错的「数据集」——
//      旧页是复制粘贴来的，改动它反而对不上号）。写操作**失败**统一走 confirmDanger 内置的
//      错误上报口径，不再拼旧页的「xxx失败 + err」前缀（与 indicatorDataset 同一口径）。
//   11. 左树只去掉节点前的**文件夹图标**（`.sct-node-icon`）：旧 antd `a-tree` 没开 `showIcon`，
//      而 Monitor 迁过来的 `SourceCategoryTree` 手写了一个 Folder/FolderOpened 图标。为了不动
//      共享组件（它还被 Monitor/sourceCheck 的「源记录」弹窗用着），改在页面作用域用
//      `:deep(.sct-node-icon) { display: none }` 隐藏。**复选框保留**——那是组件默认
//      `checkable: true`，旧页同样是 `:checkable="check"` + `checkedKeys`（多选），
//      点节点名则是单选下钻，两边语义一致。
import { onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElNotification, type TableInstance } from 'element-plus'
import {
  ArrowDown,
  CopyDocument,
  Edit,
  Lightning,
  Scissor,
  Search,
  Setting,
  WarningFilled,
} from '@element-plus/icons-vue'
import {
  changeMeasureEnable,
  copyMeasure,
  deleteMeasurePhy,
  deleteMeasures,
  measurePaged,
  updateMeasure,
  type MeasureRow,
} from '@/api/measure'
import { confirmDanger } from '@/utils/confirmDanger'
import SourceCategoryTree from '@/views/Monitor/sourceCheck/SourceCategoryTree.vue'
import ColumnEditDialog from '../shared/ColumnEditDialog.vue'
import ColumnDetailDrawer from '../shared/ColumnDetailDrawer.vue'
import {
  MEASURE_BASE,
  MEASURE_JSON_DIM,
  MEASURE_JSON_VAL,
  detailColumns,
  editColumns,
  type MeasureColumn,
} from './columns'
import MeasureAddDialog from './MeasureAddDialog.vue'
import MeasureAddNewDialog from './MeasureAddNewDialog.vue'

defineOptions({ name: 'IndicatorsList' })

const route = useRoute()

/** 接口回执：旧平台的字段名是 `msg`（不是 message），这里两个都收 */
type Ack = { message?: string; msg?: string }

// ---- 查询条件（草稿与请求参数是同一个对象，见文件头偏差第 4 条）----
const queryParam = reactive({
  datasetId: '' as string | number,
  sourceId: '' as string | number,
  entryTypeId: '' as string | number,
  measureCode: '' as string,
  enable: '' as string,
  /** 左侧分类树 emit 出来的 categorys（逗号分隔） */
  categorys: '' as string,
  /** 旧 `$route.query.configId` 透传键 */
  configId: '' as string,
})

/** 旧 SourceList.clearParam 的等价物（MeasureList 漏了定义，见文件头偏差第 1 条） */
function clearParam() {
  queryParam.datasetId = ''
  queryParam.sourceId = ''
  queryParam.entryTypeId = ''
  queryParam.measureCode = ''
  queryParam.enable = ''
  queryParam.categorys = ''
  queryParam.configId = ''
}

/** 表头排序（服务端口径：field = 列 dataIndex，order = 'ascend' | 'descend'） */
const sort = reactive({ field: '', order: '' })

// ---- 列表状态 ----
const rows = ref<MeasureRow[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 measureId（旧 s-table 的 rowKey 就是 record.measureId） */
const selected = ref<Array<string | number>>([])
const selectedRows = ref<MeasureRow[]>([])
const page = ref(1)
const size = ref(20) // 旧 `:pageSize="20"`
const tableRef = ref<TableInstance>()

async function load() {
  loading.value = true
  try {
    const res = await measurePaged({
      datasetId: queryParam.datasetId,
      sourceId: queryParam.sourceId,
      entryTypeId: queryParam.entryTypeId,
      measureCode: queryParam.measureCode,
      enable: queryParam.enable,
      categorys: queryParam.categorys,
      configId: queryParam.configId,
      page: page.value,
      limit: size.value,
      // 表头有排序时才带上这两个键（旧 s-table 无排序时参数里根本没有 sortField/sortOrder）
      ...(sort.field && sort.order ? { sortField: sort.field, sortOrder: sort.order } : {}),
    })
    rows.value = res.list ?? []
    total.value = Number(res.total ?? 0)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载指标列表失败')
    rows.value = []
    total.value = 0
    clearSelection()
  } finally {
    loading.value = false
  }
}

/** 旧 `handleRefresh()` → `table.refresh(false)`（保持当前页）；
 *  旧 `handleRefresh(true)`（分类树）→ 回第 1 页。 */
function handleRefresh(first = false) {
  if (first) page.value = 1
  void load()
}

function onSelectionChange(selection: MeasureRow[]) {
  selected.value = selection.map((row) => row.measureId)
  selectedRows.value = selection
}

/** 旧版每批操作后 `selectedRowKeys = []`（受控 rowSelection，表格勾选会同步清空）。
 *  el-table 的勾选由内部 store 管，光清数组会出现「按钮已置灰、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  selectedRows.value = []
  tableRef.value?.clearSelection()
}

const msgOf = (res: unknown): string => {
  const ack = res as Ack | null | undefined
  return String(ack?.msg ?? ack?.message ?? '')
}
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ---- 左侧分类树（旧 treeClick / treeCheck）----
function onCategoryFilter(ids: string[]) {
  clearParam()
  queryParam.categorys = ids.join(',')
  handleRefresh(true)
}

// ---- 批量启停（旧 batchChangeEnable：**没有**二次确认，直连接口）----
async function batchChangeEnable(enable: number) {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  try {
    await changeMeasureEnable(ids, enable)
    ElMessage.success('更新状态成功!')
    clearSelection()
    handleRefresh()
  } catch (err) {
    ElNotification.error({ message: '更新状态失败' + errText(err) })
  }
}

// ---- 批量删除（旧 batchDelete：$confirm → deleteMeasures）----
function batchDelete() {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const count = selected.value.length
  const ids = [...selected.value]
  void confirmDanger<Ack>(
    '提示',
    // 旧页这句写的是「数据集」（从 DatasetList 抄过来的），1:1 保留
    `是否确认要删除以下数据集:${count}`,
    async () => {
      const res = (await deleteMeasures(ids)) as Ack
      ElMessage.success('删除指标成功,本次删除:' + msgOf(res))
      clearSelection()
      handleRefresh()
      return res
    },
    () => {},
  )
}

// ---- 单行操作 ----
const editRef = ref<InstanceType<typeof ColumnEditDialog>>()
const detailRef = ref<InstanceType<typeof ColumnDetailDrawer>>()
const jsonDimRef = ref<InstanceType<typeof ColumnEditDialog>>()
const jsonValRef = ref<InstanceType<typeof ColumnEditDialog>>()
const addRef = ref<InstanceType<typeof MeasureAddDialog>>()
const addNewRef = ref<InstanceType<typeof MeasureAddNewDialog>>()

/** 旧 handleEdit → `$refs.measureEdit.doEdit(record)` */
function handleEdit(row: MeasureRow) {
  editRef.value?.open(row as Record<string, unknown>)
}
/** 旧 handleDetail → `$refs.measureDetail.showDrawer(record, '指标详情')` */
function handleDetail(row: MeasureRow) {
  detailRef.value?.open(row as Record<string, unknown>, '指标详情')
}
/** 旧 updateCallback：先 delete updateDt 再 updateMeasure */
function updateCallback(form: Record<string, unknown>) {
  const payload = { ...form }
  delete payload.updateDt
  return updateMeasure(payload)
}

/**
 * 旧 handleEditJson(text, date)：jsonSlot（条件/值1/值2/单位）→ json_val 列集、提示「数值类」；
 * jsonDimSlot（纬度）→ json_dim 列集、提示「日期类」。
 * 旧版是裸 JSON.parse：空串会抛 SyntaxError、弹窗打不开。这里空值当 `{}`，
 * 非法 JSON 给可见提示后不打开（见文件头偏差第 9 条）。
 */
function openJsonEdit(row: MeasureRow, col: MeasureColumn) {
  const raw = String(row[col.dataIndex] ?? '').trim()
  let parsed: unknown = {}
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      ElMessage.error(`「${col.title}」不是合法的 JSON，无法打开编辑器：${errText(err)}`)
      return
    }
  }
  const isDim = col.slot === 'jsonDim'
  const target = isDim ? jsonDimRef.value : jsonValRef.value
  target?.open((parsed ?? {}) as Record<string, unknown>, isDim ? 'json编辑-日期类' : 'json编辑-数值类')
}

/** 旧 handleCopy：$confirm → copyMeasure(record.measureId) → 清空查询条件（页面停留当前页）*/
function handleCopy(row: MeasureRow) {
  void confirmDanger<Ack>(
    '提示',
    `是否确认生成该指标新副本: [${String(row.measureName ?? '')} ]?`,
    async () => {
      const res = (await copyMeasure(row.measureId)) as Ack
      ElNotification.success({ message: '复制成功,请刷新后查询最新ID' })
      // 旧版 `this.queryParam = {}` —— 条件清空但**不清输入框里的字**（输入框也绑在 queryParam
      // 上，所以这里两者一起清，与旧版整对象替换的效果一致）
      clearParam()
      handleRefresh()
      return res
    },
    () => {},
  )
}

/** 旧 handleDeletePhy：只有 isDelete === -1（历史删除）的行才有这个入口 */
function handleDeletePhy(row: MeasureRow) {
  void confirmDanger<Ack>(
    '警告，是否从表中删除该记录',
    '是否从表中删除该指标记录:' + String(row.measureCode ?? ''),
    async () => {
      const res = (await deleteMeasurePhy(row.measureId)) as Ack
      ElMessage.success('物理删除指标成功,本次删除:' + msgOf(res))
      clearSelection()
      handleRefresh()
      return res
    },
    () => {},
  )
}

/** 行内「更多」下拉派发：command 与菜单项一一对应 */
function onRowCommand(command: string, row: MeasureRow) {
  if (command === 'copy') handleCopy(row)
  else if (command === 'deletePhy') handleDeletePhy(row)
}

/** 操作条下拉派发（旧 batchChangeEnable(0)/(1)、batchDelete） */
function onBatchCommand(command: string) {
  if (command === 'enable') void batchChangeEnable(0)
  else if (command === 'disable') void batchChangeEnable(1)
  else if (command === 'delete') batchDelete()
}

// ---- 表头排序（服务端）----
function onSortChange(payload: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  sort.field = payload.order && payload.prop ? payload.prop : ''
  sort.order = payload.order === 'ascending' ? 'ascend' : payload.order === 'descending' ? 'descend' : ''
  handleRefresh()
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

const routeSourceId = ref('')
const routeEntryTypeId = ref('')
const routeDatasetId = ref('')
const routeDatasetName = ref('')

function applyRouteQuery() {
  const sourceId = pickQuery('sourceId')
  if (sourceId) {
    routeSourceId.value = sourceId
    queryParam.sourceId = sourceId
  }
  const entryTypeId = pickQuery('entryTypeId')
  if (entryTypeId) {
    routeEntryTypeId.value = entryTypeId
    queryParam.entryTypeId = entryTypeId
  }
  const datasetId = pickQuery('datasetId')
  if (datasetId) {
    routeDatasetId.value = datasetId
    queryParam.datasetId = datasetId
  }
  routeDatasetName.value = pickQuery('datasetName')
  const configId = pickQuery('configId')
  if (configId) queryParam.configId = configId
}

/** indicatorDataset 的「增加指标 / 指标-新」跳进来时带的入参：
 *  旧 DatasetList 传的是 `(record.sourceId, record, record.entryTypeId)`，
 *  record 是整条数据集（doEdit 里 `Object.assign(form, record)` 会把 datasetId /
 *  datasetName / entryTypeId … 一并带进提交体）。这里用 query 里带过来的四个键重建这份 record。 */
function buildDatasetRecord(): Record<string, unknown> {
  return {
    sourceId: routeSourceId.value || undefined,
    datasetId: routeDatasetId.value || undefined,
    datasetName: routeDatasetName.value || undefined,
    entryTypeId: routeEntryTypeId.value || undefined,
  }
}

function openMeasureAdd() {
  if (!routeSourceId.value) {
    ElMessage.warning('请先指定源ID（从数据集页的「增加指标」进入）')
    return
  }
  addRef.value?.open(routeSourceId.value, buildDatasetRecord(), routeEntryTypeId.value)
}

function openMeasureAddNew() {
  if (!routeSourceId.value) {
    ElMessage.warning('请先指定源ID（从数据集页的「指标-新」进入）')
    return
  }
  addNewRef.value?.open(routeSourceId.value, buildDatasetRecord(), routeEntryTypeId.value)
}

function onAddSaved() {
  handleRefresh(true)
}

// 旧 `watch '$route.query.configId'` → 改条件并重查
watch(
  () => pickQuery('configId'),
  (configId) => {
    queryParam.configId = configId
    handleRefresh()
  },
)

// 旧 `created` 读 `$route.query.sourceId`；这里在挂载后统一处理 query + 自动开弹窗
onMounted(async () => {
  applyRouteQuery()
  const add = pickQuery('add')
  await load()
  if (add === '1') openMeasureAdd()
  else if (add === 'new') openMeasureAddNew()
})

const MEASURE_COLUMNS = MEASURE_BASE
const EDIT_COLUMNS = editColumns()
const DETAIL_COLUMNS = detailColumns()
</script>

<template>
  <div class="ml-shell">
    <!-- <div class="ml-head">
      <div class="ml-title">指标列表</div>
      <div class="ml-sub">
        按数据集、源、指标编码与状态筛选指标定义；支持批量启停、批量删除、单条编辑 / 详情 / JSON 子编辑与指标副本。
      </div>
    </div> -->

    <!-- gutter 用 16 而不是 0/2：左树面板与右侧搜索栏之间要有明确留白，
         否则树的右边框几乎贴在「数据集ID」标签上。16 与项目里其它左右分栏页一致
         （Monitor/taskStat、CheckEditDialog）。 -->
    <el-row :gutter="16" class="ml-body">
      <!-- 左侧分类树：旧 `showCategory` 恒为 true（没有开关），所以分栏恒为 4 / 20。
           ⚠️ 视觉面板（底色/边框/内边距）必须放在内层 .ml-tree-panel 上，不能直接写 .ml-tree-col：
           el-row 的 gutter 会往 el-col 上注入**内联** padding-left/right，优先级高于 class，
           写在 el-col 上既不生效、又会让面板边框越过卡片的内边距（左右不对称）。 -->
      <el-col :span="4" class="ml-tree-col">
        <div class="ml-tree-panel">
          <SourceCategoryTree @filter="onCategoryFilter" />
        </div>
      </el-col>

      <el-col :span="20">
        <!-- 搜索栏（旧 a-form layout="inline" + a-row，改条件不自动查，点「查询」才发请求） -->
        <el-form :inline="true" class="ml-filter-form">
          <el-row :gutter="8" class="ml-filter-row">
            <el-col :md="3" :sm="24">
              <el-form-item label="数据集ID">
                <el-input v-model="queryParam.datasetId" clearable @keyup.enter="handleRefresh()" />
              </el-form-item>
            </el-col>
            <el-col :md="3" :sm="24">
              <el-form-item label="源ID">
                <el-input v-model="queryParam.sourceId" placeholder="输出" clearable @keyup.enter="handleRefresh()" />
              </el-form-item>
            </el-col>
            <el-col :md="3" :sm="24">
              <el-form-item label="指标编码">
                <el-input
                  v-model="queryParam.measureCode"
                  placeholder="指标编码"
                  clearable
                  @keyup.enter="handleRefresh()"
                />
              </el-form-item>
            </el-col>
            <el-col :md="3" :sm="24">
              <el-form-item label="状态">
                <el-select v-model="queryParam.enable" placeholder="请选择">
                  <el-option label="全部" value="" />
                  <el-option label="在用" value="0" />
                  <el-option label="停用" value="1" />
                  <el-option label="历史删除的" value="-1" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :md="4" :sm="24">
              <el-form-item>
                <el-button type="primary" :icon="Search" @click="handleRefresh()">查询</el-button>
                <!-- 旧 `@click="() => queryParam = {}"`：只清条件、不重查 -->
                <el-button @click="clearParam()">重置</el-button>
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <!-- 操作条：旧 `.operation`（`v-if="!modal"`；路由页没有 modal 形态，恒显示）。
             下拉只剩 3 项——「批量复制」与「操作日志」是旧版的坏代码 / 死代码，见文件头偏差第 2 条。 -->
        <div class="ml-op-bar">
          <el-dropdown @command="onBatchCommand">
            <el-button :icon="Setting">
              操作
              <el-icon class="ml-more-arrow"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="enable" :icon="Lightning">启用</el-dropdown-item>
                <el-dropdown-item command="disable">禁用</el-dropdown-item>
                <el-dropdown-item command="delete" :icon="Scissor" divided>删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>

        <!-- 表格：列定义来自 allColumns.MEASURE.base（标题/顺序 1:1）。
             表头排序：只有 ID 带 sorter → sortable="custom"，排序交给后端。
             操作列来自列定义的 `fixed: 'right'`：本页列总宽超出内容区、要横向滚动，
             固定后不用拉滚动条就能点「详情 / 编辑 / 更多」。 -->
        <el-table
          ref="tableRef"
          v-loading="loading"
          :data="rows"
          border
          size="small"
          :row-key="(r: MeasureRow) => r.measureId"
          @selection-change="onSelectionChange"
          @sort-change="onSortChange"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column
            v-for="col in MEASURE_COLUMNS"
            :key="col.dataIndex"
            :label="col.title"
            :prop="col.dataIndex"
            :width="col.minWidth ? undefined : col.width"
            :min-width="col.minWidth"
            :sortable="col.sorter ? 'custom' : false"
            :fixed="col.fixed"
          >
            <template #default="{ row }">
              <!-- ID：旧 idSlot —— 在用=纯文本；停用=红标签；历史删除=感叹号 + 标签 -->
              <template v-if="col.slot === 'id'">
                <span v-if="Number(row.isDelete) === 0">{{ row.measureId }}</span>
                <el-tag v-else-if="Number(row.isDelete) === 1" type="danger" size="small">{{ row.measureId }}</el-tag>
                <span v-else class="ml-history">
                  <el-icon class="ml-warn"><WarningFilled /></el-icon>
                  <el-tag size="small">{{ row.measureId }}</el-tag>
                </span>
              </template>

              <!-- 名称 / 类型：旧 nameSlot —— 限宽省略 + popover 全文（旧 max-width 180px） -->
              <span v-else-if="col.slot === 'name'" class="ml-name">
                <el-tooltip :content="String(row[col.dataIndex] ?? '')" placement="top-start">
                  <span class="ml-ellipsis">{{ row[col.dataIndex] }}</span>
                </el-tooltip>
              </span>

              <!-- 条件 / 值1 / 值2 / 单位 / 纬度：旧 jsonSlot / jsonDimSlot
                   —— 限宽省略（旧 max-width 120px）+ popover 内「编辑」图标打开 JSON 子编辑器 -->
              <el-popover
                v-else-if="col.slot === 'json' || col.slot === 'jsonDim'"
                trigger="hover"
                :width="420"
                placement="top"
              >
                <template #reference>
                  <div class="ml-ellipsis ml-json-ref">{{ row[col.dataIndex] }}</div>
                </template>
                <div class="ml-json-pop">
                  <span class="ml-json-edit" @click="openJsonEdit(row, col)">
                    <el-icon><Edit /></el-icon>
                    <span>编辑</span>
                  </span>
                  <div class="ml-json-text">{{ row[col.dataIndex] }}</div>
                </div>
              </el-popover>

              <!-- 操作：旧 actionSlot —— 详情 | 编辑 | 更多（指标副本 / 物理删除） -->
              <span v-else-if="col.slot === 'action'" class="ml-actions">
                <span class="ml-op-link" @click="handleDetail(row)">详情</span>
                <span class="ml-op-divider">|</span>
                <span class="ml-op-link" @click="handleEdit(row)">编辑</span>
                <span class="ml-op-divider">|</span>
                <el-dropdown trigger="hover" @command="(cmd: string) => onRowCommand(cmd, row)">
                  <span class="ml-op-link ml-op-more"
                    >更多<el-icon class="ml-more-caret"><ArrowDown /></el-icon
                  ></span>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="copy" :icon="CopyDocument">指标副本</el-dropdown-item>
                      <!-- 旧版 `v-if="record.isDelete === -1"`，同一口径 -->
                      <el-dropdown-item v-if="Number(row.isDelete) === -1" command="deletePhy" :icon="Scissor" divided>
                        删除指标(物理删除)
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </span>

              <!-- 其余列（编码 / 源ID / 数据集 / 启用）：直接显示字段值。
                   「启用」= isDelete 原值，旧版表格确实没套 enableFilter（见文件头偏差第 7 条）。 -->
              <span v-else>{{ String(row[col.dataIndex] ?? '') }}</span>
            </template>
          </el-table-column>
        </el-table>

        <!-- 分页：默认 20，可选 20/40/100/200，共N条 + 快速跳页（旧 s-table pagination 口径） -->
        <div class="ml-pager">
          <el-pagination
            :current-page="page"
            :page-size="size"
            :total="total"
            :page-sizes="[20, 40, 100, 200]"
            layout="total, sizes, prev, pager, next, jumper"
            background
            small
            @current-change="onPageChange"
            @size-change="onSizeChange"
          />
        </div>
      </el-col>
    </el-row>

    <!-- 弹层（旧 refs：measureEdit / measureDetail / jsonEditDim / jsonEditVal） -->
    <ColumnEditDialog ref="editRef" :cols="EDIT_COLUMNS" :callback="updateCallback" @refresh="handleRefresh()" />
    <ColumnDetailDrawer ref="detailRef" :cols="DETAIL_COLUMNS" />
    <!-- 两个 JSON 子编辑器旧版都不传 callback（点确定不关弹窗、不提示），这里保持同一形态 -->
    <ColumnEditDialog ref="jsonDimRef" :cols="MEASURE_JSON_DIM" />
    <ColumnEditDialog ref="jsonValRef" :cols="MEASURE_JSON_VAL" />

    <!-- 指标三件套里的两个新增入口（旧 MeasureAdd / MeasureAddNew，由数据集页跳转触发） -->
    <MeasureAddDialog ref="addRef" @saved="onAddSaved" />
    <MeasureAddNewDialog ref="addNewRef" @saved="onAddSaved" />
  </div>
</template>

<style scoped>
.ml-shell {
  display: flex;
  flex-direction: column;
  height: fit-content;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
  overflow: hidden;
}
.ml-head {
  margin-bottom: 2px;
}
.ml-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.ml-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.ml-body {
  /* stretch：左树面板跟随右侧「搜索栏 + 表格 + 分页」的实际高度，不再靠固定 min-height 撑着 */
  align-items: stretch;
}
/* 左侧分类树面板。
   旧页 `.custom-tree` 是 1px 边框 + min-height 800px，机械照搬会在表格只有几行时
   拖出一大片空白（左低右高、页面显得不齐）。这里改成：面板自身留白 + 极浅底色做「侧栏」区隔，
   高度交给上面的 stretch，只留一个下限兜住空表的情况（筛选无结果时表格很矮）。 */
.ml-tree-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  height: 100%;
  min-height: 420px;
  padding: 12px 10px 10px;
  background: var(--rc-bg, #f8fafc);
  border: 1px solid var(--rc-border-soft, #eef2f7);
  border-radius: var(--rc-radius, 8px);
}
.ml-tree-panel :deep(.sct-root) {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}
/* 去掉节点前的文件夹图标（本页定制，只在这一页生效）。
   `.sct-node-icon` 是共享组件 `SourceCategoryTree` 里 `sct-node` 的首个子项，
   `display: none` 后名称自然顶到最左；el-tree 自己的展开箭头是另一个元素
   （`.el-tree-node__expand-icon`，由 `expand-on-click-node` 接管），不受影响。
   之所以走页面作用域的 `:deep()` 而不是改组件：该组件还被 `Monitor/sourceCheck`
   的「源记录」弹窗用着，直接动它会把那一页也一起改掉。 */
.ml-tree-panel :deep(.sct-node-icon) {
  display: none;
}
/* 树内部留白：面板已有 12/10，这里只补工具条、搜索框、树之间的纵向节奏 */
.ml-tree-panel :deep(.sct-toolbar) {
  margin-bottom: 10px;
  /* 窄屏（≈1280 及以下，侧栏 184px 仍在）时「退出编辑 + 新增 + 刷新」三件放不进一行，
     默认会被压成「退出编/辑」这种断词。改成允许换行 + 按钮自身 nowrap，宁可图标掉到第二行。 */
  flex-wrap: wrap;
  row-gap: 6px;
}
.ml-tree-panel :deep(.sct-toolbar-left) {
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;
}
.ml-tree-panel :deep(.sct-edit-toggle) {
  white-space: nowrap;
}
.ml-tree-panel :deep(.sct-search) {
  margin-bottom: 10px;
}
.ml-tree-panel :deep(.sct-tree-wrap) {
  padding-right: 4px;
}
.ml-tree-panel :deep(.sct-all) {
  margin-bottom: 4px;
}
/* 节点行高 32 → 34、行间距 1 → 3：分类多的时候不至于挤成一片。
   注意选择器要带上 `.sct-tree` 提高权重——组件自身的 `.sct-tree :deep(.el-tree-node__content)`
   与页面的 `.ml-tree-panel :deep(...)` 权重相同，只靠选择器顺序定胜负并不可靠。 */
.ml-tree-panel :deep(.sct-tree .el-tree-node__content) {
  height: 34px;
  margin: 3px 0;
}
.ml-tree-panel :deep(.sct-tree > .el-tree-node) {
  padding-left: 2px;
}
.ml-filter-form {
  /* 表单自身的 el-form-item 已有 8px 下边距，这里再补 4px，让搜索栏与「操作..」条之间有 12px */
  margin-bottom: 4px;
}
.ml-filter-row {
  width: 100%;
}
.ml-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.ml-filter-form :deep(.el-select),
.ml-filter-form :deep(.el-input) {
  width: 100%;
}
.ml-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
.ml-filter-form .el-col:last-child :deep(.el-form-item) {
  width: auto;
}
.ml-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 10：操作条与上方搜索栏、下方表格各留一口气 */
  margin-bottom: 10px;
}
.ml-more-arrow {
  margin-left: 4px;
  vertical-align: -0.15em;
}
.ml-name,
.ml-json-ref {
  display: block;
  max-width: 100%;
  overflow: hidden;
}
.ml-ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.ml-json-ref {
  cursor: pointer;
}
.ml-json-pop {
  max-height: 260px;
  overflow: auto;
}
.ml-json-edit {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 6px;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.ml-json-edit:hover {
  text-decoration: underline;
}
.ml-json-text {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
  line-height: 1.5;
  color: var(--rc-text-2, #334155);
}
.ml-history {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ml-warn {
  color: var(--rc-error, #dc2626);
}
.ml-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ml-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.ml-op-link:hover {
  text-decoration: underline;
}
.ml-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.ml-op-more {
  display: inline-flex;
  align-items: center;
}
.ml-more-caret {
  margin-left: 2px;
  vertical-align: -0.15em;
}
.ml-pager {
  display: flex;
  justify-content: flex-end;
  padding: 10px 2px 2px;
}
</style>
