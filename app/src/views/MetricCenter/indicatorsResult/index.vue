<script setup lang="ts">
// 指标结果 —— 1:1 迁移旧 data-view `src/page/inst/MeasureData.vue`（路由 /inst/measure-data）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   布局：a-card → 搜索栏（源选择器 + 指标编码 + 指标名称 + 指标日期 + 起始ID + 终止ID + 查询）
//         → 工具条（当前源 tag / 当前表名 tag + SQL / API / 导入数据 / 导出EXCEL 四个图标
//                    + `数据操作` 下拉：删除选中的数据 / 按时间删除[该源当日 · 该源所有 · 填入IDs]
//                                          / 表操作[设为正式表 · 清空当日 · 清空全量]）
//         → SQL 提示条（点 SQL 图标后展开）
//         → u-table（虚拟滚动；勾选列 + 动态列 + 系统列 + 操作下拉）+ 分页 20/40/100/200
//   动态列：按当前表的**必填字段**生成（`名称-列名`），只有前 12 个进表格（旧 `if (i >= 12) break`），
//           编辑弹窗用全量（旧 `allColumns()`）。宽度规则与 url 判定见 columns.ts。
//   系统列：ENTRY_ID（点开详情）/ SOURCE_ID（点开源详情）/ STATE / UPDATE_DT / CREATE_DT
//           / DETAIL_ID（点开任务实例）/ NEXT_FLAG / PARENT_ID（父表可点时点开父数据）
//           / K0（非空时点开 readJson）/ 操作（详情 · 查后续任务实例 · 删除单条 · 手动修改 · 重新保存原始JSON）
//   ⚠️ 列名沿用旧模板的 `prop="STATE"` 等大写名（照抄旧 s-table 的列定义），但行数据是新适配层的
//      camelCase（`dataRowFromLegacy`：STATE→state / UPDATE_DT→updateDt / ENTRY_ID→dataId …），
//      所以**每一列都必须给插槽**，否则 el-table 按 prop 取值会渲染成空。
//      时间列用共享的 `timeAgo`：旧页 更新/生成 走 MeasureData 的**局部**过滤器 `dt`
//      （`moment(t,'YYYY-MM-DD hh:mm:ss').fromNow()`），与全局 `timeago` 只差「未来时间把『内』
//      换成『后』」这一处；这两列是过去时间，实际口径一致。
//   接口（全部走新平台适配层）：dataApi.tableMeta / rowQueryPaged / rowDetail / rowUpdate /
//         rowDelete / rowDeleteBatch / reSave / exportUrl、entryApi.markEntryType、sourceApi.sourceDetail
//
// ⚠️ 表 ID 的默认值：旧 `created` 里有一句 `if ($route.path.indexOf('measure-data') !== -1)
//    this.queryParam.entryType = 999`——**999 是旧部署里「指标」这张表的物理 ID**（同一句在
//    EntryList2 / EntryListView 里也有）。新平台的「指标结果」是 MetricCenter 的一个 tab，
//    所以这里照旧保留这个默认值（`DEFAULT_MEASURE_TABLE_ID`），并允许 `?entryType=` /
//    `?entryTypeId=` 覆盖；真要换表的时候改这一个常量即可。
//
// 有意偏差（逐条列清，都是「旧版这么写但跑不起来」或「新平台口径不同」的地方）：
//   1. **不迁 props，全部改从 `$route.query` 取**。旧版有 `sourceId / entryTypeId / read` 三个 props
//      （由别的页面内嵌使用）。新平台把它做成 MetricCenter 的独立 tab、不传 props，所以读 query 的
//      `sourceId` 与 `entryType|entryTypeId`；旧 `read` prop 默认 false（可编辑），新平台没有这个
//      内嵌场景，写入口一律保留（与同批次的 indicatorsList / indicatorDataset 同一口径）。
//   2. **不迁这批死代码**（旧模板里没有入口或 ref 没注册，逐个核对过）：
//      `a-auto-complete`（「SQL条件片断」，旧模板里整段注释掉）+ `autoArray/autoAll/loadAuto1/
//        saveAuto1/onChangeAuto/onSearchAuto`；`showBatch` 批量发后续卡片 + `sendNextBatch`/`sendNext`
//        /`sendNextAll`/`sendNextCurPage`/`showSendMore`/`nextUrl`（唯一能打开它的 `showSendMore` 没有任何
//        调用点）；`nextSelect` 三个 handler；`handleShowInTab`（模板里被注释掉）；
//        `showSteps`+`DStepShow`（stepList 从未被打开）与 `changeEntryType`；`showGenSource`+`ImportSource`；
//        `handleShowDataset`+`DataSetShow`；`handleClearParent`；`entryTypeDetail`+`handleShowEntryType`
//        /`showEntryTypeDetail`；`distinctSourceIds`+`showSourceIds` 弹窗；`handleShowSource`；`sendNext`；
//        `advanced`/`toggleAdvanced`；`options.alert`/`tableOption`；`labelCol`/`noLabelCol`/`maxWidth`/
//        `openKeys`/`treeData`/`mdl`/`searchText`/`searchInput`/`entryTypes1~3`（写了从不读）。
//   3. **不迁 `renderHeader`**：旧版把它挂给勾选列的 `:render-header`，返回的是一段调试用的
//      HTML 字符串 `'<a>aaa</a>'`（会在表头上渲染出一个「aaa」链接）。这是明显的调试残留，不复制。
//   4. **不迁 `headerContextmenu`**：旧版在表头右键时把 `column.property LIKE '%%'` 拼进
//      `queryParam.more`，但 `handleRefresh` 每次都会**重算并覆盖** `more`（只由编码/名称/日期拼成），
//      所以这个追加的条件在下一次查询就被丢掉——对查询结果零影响（只影响随后点「SQL / API」时看到的串）。
//      复刻一个「加了就丢」的空转逻辑没有意义，故不迁。`el-table` 本身有 `header-contextmenu` 事件，
//      将来要真做表头筛选再接。
//   5. **虚拟滚动不迁**：旧版用 u-table 的 `use-virtual` + `row-height=40` + `height=900` 抗大数据量。
//      Element Plus 的 `el-table` 没有虚拟滚动（那是 `el-table-v2`，且要求固定行高与列定义走 JSX），
//      换过去会改变整页 DOM 结构。这里用普通 `el-table`，靠分页控制单页数据量。
//   6. **「数据操作」下拉拍平**：旧版是两个 `a-sub-menu`（按时间删除.. / 表操作）套 6 个菜单项。
//      `el-dropdown-menu` 不支持嵌套子菜单，所以拍平成 7 项，文案**原样保留**，只在「设为正式表」前
//      加一条分割线示意分组边界。
//   7. **搜索一律回第 1 页**：旧版 6 个输入框都是 `@pressEnter="handleRefresh"`（把 KeyboardEvent 当
//      `first` 传进去，恒为真值）、日期是 `@change="handleRefresh"`（把值当 `first`）、查询按钮是
//      `handleRefresh(true)`——即**每个搜索动作实际都会回到第 1 页**。这里统一成 `handleRefresh(true)`。
//      `handleRefresh()`（不带参数、保持当前页）只用于写操作后的重查。
//   8. **`state` 查询键不发**：旧 `handleRefresh`/`loadData` 里有 `if (stateArray.length > 0) state = …`，
//      但 `stateArray` 在本页从未被写入（没有状态筛选 UI），恒为空。新平台 `RowQuery` 支持 state，
//      这里不无中生有一个筛选条件。
//   9. **详情抽屉 / 编辑弹窗换成共享层**：`base-detail-drawer` → `shared/ColumnDetailDrawer.vue`、
//      `base-edit-modal` → `shared/ColumnEditDialog.vue`（列驱动的同一套）。旧 `EntryDetail.vue` 内部
//      固定用 `ENTRY_DETAIL.base`（16 个系统列）+ `ENTRY_DETAIL.data`（5 列）作为主列表/子表列；
//      新平台的 `dataApi.rowDetail` 返回 `{row, showItems, subs[], subsCnt}`，`subs` 每条自带
//      `showItems` 与 `tableId/tableName`（旧平台是 `entryTypeId/entryTypeName`），所以这里在
//      `buildDetailRecord()` 里把 `subs` 归一化成共享抽屉认识的形状（子表标题仍显示
//      `子表类型-子表名 - 子表ID`），共享组件不动。
//   10. **旧 `:cols="detailCols"` 是死 prop**：旧模板把它传给 `<entry-detail>`，而 EntryDetail.vue 的
//       props 是空的 —— 该参数从来没被接过（它只用自己写死的 ENTRY_DETAIL 列集）。故 `detailCols`
//       计算结果在本页没有任何消费者，不迁（`columns.ts` 里保留 `buildOtherColumns` 供其它页面复用）。
//   11. 提示形态：旧 `$message.*` → `ElMessage.*`、`$notification.*({message})` → `ElNotification.*`，
//       文案原样保留（含「[实验性]」「注意删除后无法恢复」这些旧原文）。写操作**失败**统一走
//       confirmDanger 内置的错误上报口径（与 indicatorsList / indicatorDataset 同一口径）。
//   12. **父ID 可点的条件少了一半**：旧版是 `(row.P_TABLE > 0 || curEntryType.parentEntry > 0)`，
//       新平台适配层没有 `parentEntry` / `P_TABLE` 这两个字段（`DataRow.categoryId` 即旧 `P_TABLE`，
//       注释里写明「缺失时父 ID 列不可点」），所以条件退化成「`categoryId > 0 && parentId > 0`」。
//   13. 旧 `handleEdit` 成功后提示「修改成功,请手动刷新后确认」、失败提示「修改失败:」。共享的
//       ColumnEditDialog 自己有一套统一口径（成功「修改成功!」+ 关弹窗 + 抛 refresh，失败统一报错），
//       indicatorsList 已经按这套走，这里沿用，不再叠第二条 toast。
//   14. **导出的 URL 由 `dataApi.exportUrl` 拼**（同 `entry/entryExportAll` 路径，同源 Cookie 鉴权，
//       与 DataView 的数据查询页共用）。与旧 `handleExport` 的两点差异：
//       ① 旧版把 `&more=` 那行**注释掉了**，导出的其实是「整表 / 整源」而不是当前筛选结果；
//          新平台 `exportUrl` 的既定语义是把查询条件（含 sql→more）带上，这里按既定语义调用，
//          筛选后导出与页面所见一致（这是修正，不是回归）。
//       ② 旧版 `window.open(url, '_target')` 开的是一个**具名窗口**（会复用同一个），这里用 '_blank'。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElNotification, type TableInstance } from 'element-plus'
import {
  ArrowDown, Connection, Delete, Download, Minus, Search, Select, Setting, Tickets, Upload, Warning,
} from '@element-plus/icons-vue'
import {
  dataApi, entryApi,
  type DataRow, type DataTableMeta, type EntryDetail, type RowQuery,
} from '@/api'
import { confirmDanger } from '@/utils/confirmDanger'
import { timeAgo } from '@/utils/format/relativeTime'
import ColumnEditDialog from '../shared/ColumnEditDialog.vue'
import ColumnDetailDrawer from '../shared/ColumnDetailDrawer.vue'
import {
  ENTRY_DETAIL_BASE, ENTRY_DETAIL_DATA,
  buildDynamicColumns, buildEditColumns, fieldsToEntryItems,
  type EntryDataColumn,
} from './columns'
import EntrySourceSelect from './EntrySourceSelect.vue'
import ApiDescDialog from './ApiDescDialog.vue'
import SourceDetailDialog from './SourceDetailDialog.vue'
import TaskInstDialog from './TaskInstDialog.vue'
import UploadDataDialog from './UploadDataDialog.vue'

defineOptions({ name: 'IndicatorsResult' })

/** 旧 `created` 里写死的「指标」表 ID（见文件头说明） */
const DEFAULT_MEASURE_TABLE_ID = '999'

const route = useRoute()
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// ---- 查询条件 ----
const queryForm = reactive({
  sourceId: '' as string,
  code: '' as string,
  name: '' as string,
  /** 指标日期（旧 `queryParam.date` 是 moment，新平台用 YYYY-MM-DD 字符串） */
  date: '' as string,
  min: '' as string,
  max: '' as string,
})

// ---- 当前表 ----
const tableId = ref('')
const tableMeta = ref<DataTableMeta | null>(null)

// ---- 列表状态 ----
const rows = ref<DataRow[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 ENTRY_ID（旧 selectedRowKeys 就是 ENTRY_ID） */
const selected = ref<string[]>([])
const page = ref(1)
const size = ref(20)
const tableRef = ref<TableInstance>()

/** 表头排序（旧 `handleSortChange(column)` 的 field / type，映射成新平台的 sortField / sortOrder） */
const sort = reactive({ field: '', order: '' as '' | 'ascend' | 'descend' })

/** 点「SQL」图标后展开的提示条 */
const showTip = ref(false)
const tipText = ref('')
/** 上一次实际发出的 SQL 条件（旧 `queryParam.more`；`handleShowSql` / `handleShowApi` 读它） */
const lastMore = ref('')

/** 「填入IDs-删除」弹窗 */
const showIds = ref(false)
const batchDeleteIds = ref('')

// ---- 列（全部由当前表的字段驱动，见 columns.ts）----
const entryItems = computed(() => fieldsToEntryItems(tableMeta.value?.fields))
/** 表格动态列：必填字段的前 12 个 */
const dynamicCols = computed<EntryDataColumn[]>(() => buildDynamicColumns(entryItems.value, 12))
/** 编辑弹窗列：全量必填字段 + 非必填字段 + 7 个固定表信息列（剔除 noEdit） */
const editCols = computed(() => buildEditColumns(entryItems.value))
/** 旧 `allSort`：总量 > 50 万时关掉动态列的排序（旧 `watch 'pageForm.total'`） */
const allSort = computed(() => total.value <= 500000)

/** 旧 `handleRefresh` 里拼 `more` 的那段（K2=编码 / K4=日期 / K3 LIKE 名称） */
function buildMore(): string {
  let more = ' 1 = 1 '
  if (queryForm.code) more += " and K2 = '" + queryForm.code + "'"
  if (queryForm.date) more += " and K4 = '" + queryForm.date + "'"
  if (queryForm.name) more += " and K3 LIKE '%" + queryForm.name + "%'"
  return more
}

async function load() {
  if (!tableId.value) return
  const more = buildMore()
  lastMore.value = more
  loading.value = true
  const query: RowQuery = {
    tableId: tableId.value,
    page: page.value,
    size: size.value,
    // 旧后端的字段名是 more（新适配层把 sql 映射到 more），见 api/index.ts 的 buildLegacyRowQuery
    sql: more,
    sourceId: queryForm.sourceId || undefined,
    min: queryForm.min || undefined,
    max: queryForm.max || undefined,
    ...(sort.field && sort.order ? { sortField: sort.field, sortOrder: sort.order } : {}),
  }
  try {
    const res = await dataApi.rowQueryPaged(query)
    rows.value = res.list ?? []
    total.value = Number(res.total ?? 0)
  } catch (err) {
    // 旧 `$notification.error({message: '查询失败:' + err.substr(0, 100)})`
    ElNotification.error({ message: '查询失败:' + errText(err).slice(0, 100) })
    rows.value = []
    total.value = 0
    clearSelection()
  } finally {
    loading.value = false
    showTip.value = false
  }
}

/** 旧 `handleRefresh(first)`：`first` 为真回到第 1 页；写操作后的重查传空、保持当前页 */
function handleRefresh(first = false) {
  if (first) page.value = 1
  void load()
}

/** 旧 `loadEntryTypeDetail(entryTypeId)`：拉表详情后再查数据 */
async function loadTable() {
  if (!tableId.value) return
  loading.value = true
  try {
    tableMeta.value = await dataApi.tableMeta(tableId.value)
  } catch (err) {
    ElNotification.error({ message: '加载失败' + errText(err) })
    tableMeta.value = null
  } finally {
    loading.value = false
  }
  await load()
}

function onSelectionChange(selection: DataRow[]) {
  selected.value = selection.map((row) => row.dataId)
}

/** 旧版每批操作后 `selectedRowKeys = []`；el-table 的勾选由内部 store 管，光清数组会出现
 *  「按钮已置灰、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  tableRef.value?.clearSelection()
}

/** 旧 `handleSourceChange(source)`：记下当前源并回第 1 页重查 */
function handleSourceChange() {
  handleRefresh(true)
}

/* ------------------------------------------------------------------ *
 * 工具条                                                              *
 * ------------------------------------------------------------------ */

/** 旧 `handleShowSql`：把当前条件拼成一条 select 语句展示 */
function handleShowSql() {
  let curSql = 'select * from ' + (tableMeta.value?.tableName ?? '')
  curSql += ' where 1 = 1 '
  if (selected.value.length > 0) {
    curSql += ' and entry_id in (' + selected.value.join(',') + ')'
  }
  if (queryForm.sourceId) {
    curSql += ' and source_id = ' + queryForm.sourceId
  }
  if (lastMore.value) {
    curSql += ' and ' + lastMore.value
  }
  showTip.value = !showTip.value
  tipText.value = curSql
}

/**
 * 旧 `handleShowApi`：拼三个 URL（SQL取数 / ID取数 / 发后续任务）交给 ApiDesc 弹窗。
 * 旧版 `Math.min(...ids)` 在本页无数据时是 `Infinity`（会拼出 `startId=Infinity`），这里退化成 0。
 */
function handleShowApi() {
  let api = location.origin + '/rest/api/v1/data/entry?appId=dev&appKey=dev1'
  let nextUrl = location.origin + '/api/v1/source/nextStep2?size=10'
  let qsApi = location.origin + '/rest/api/v1/data/qs?appId=dev&appKey=dev1'
  const ids = rows.value.map((item) => Number(item.dataId)).filter((n) => Number.isFinite(n))
  const minEntryId = ids.length ? Math.min(...ids) : 0
  if (tableId.value) {
    api += '&type=' + tableId.value
    qsApi += '&type=' + tableId.value
    nextUrl += '&entryTypeId=' + tableId.value
  }
  if (queryForm.sourceId) {
    api += '&sourceId=' + queryForm.sourceId
    qsApi += '&sourceId=' + queryForm.sourceId
    nextUrl += '&sourceId=' + queryForm.sourceId
  }
  if (queryForm.min) {
    api += '&startId=' + queryForm.min
    nextUrl += '&start=' + queryForm.min
  } else {
    api += '&startId=' + minEntryId
  }
  if (queryForm.max) {
    api += '&endId=' + queryForm.max
  }
  api += '&size=' + 10
  if (lastMore.value) {
    qsApi += '&more=' + encodeURI(lastMore.value || '')
  }
  qsApi += '&page=1'
  apiRef.value?.open(api, nextUrl, qsApi)
}

/**
 * 旧 `handleUploadData`：表 ID + 源 ID + 配置 ID。
 * ⚠️ 旧版配置 ID 的最后一级兜底是 `this.source.configId`（源选择器 change 回来的那条记录），
 * 新平台 `sourceApi.sourceSame` 只返回 `{sourceId, name}`，候选项上没有 configId，所以那一级
 * 兜底取不到值；取不到时留空、由用户在弹窗里填（旧版弹窗本来就允许手填，且没填会拦下）。
 */
function handleUploadData() {
  const entryTypeId = tableId.value
  let sourceId = queryForm.sourceId
  const first = rows.value[0]
  if (first) {
    if (!sourceId) sourceId = first.sourceId
  }
  uploadRef.value?.open(entryTypeId, sourceId, String(first?.configId ?? ''))
}

/** 旧 `handleExport`：纯 URL 直开，同源 Cookie 完成鉴权 */
function handleExport() {
  window.open(dataApi.exportUrl({
    tableId: tableId.value,
    sourceId: queryForm.sourceId || undefined,
    sql: buildMore(),
    min: queryForm.min || undefined,
    max: queryForm.max || undefined,
  }), '_blank')
}

/* ------------------------------------------------------------------ *
 * 删除 / 状态（全部为 danger 端点，走 confirmDanger + 二次确认）        *
 * ------------------------------------------------------------------ */

/**
 * `confirmDanger` 要求 `run()` 的返回值带可选 `message`，而删除类接口的回执是
 * `{success, all, not_found}`（没有 message）。统一补一个空串占位——所有调用点都传了空的
 * `onSuccess`，所以这个占位文案不会被弹出来（真正的回执文案由 `reportDelete` 负责）。
 */
function withMessage<T extends object>(res: T): T & { message: string } {
  return { ...res, message: '' }
}

/** 旧版删除回执的三套文案（`success === 0` 时按入口给不同原因） */
function reportDelete(
  res: { success?: number; all?: number; not_found?: number } | undefined,
  kind: 'ids' | 'source' | 'date',
) {
  const success = Number(res?.success ?? 0)
  if (success === 0) {
    ElNotification.warning({
      message: kind === 'ids'
        ? '未能改变数据, 可能原因:\n【未找到对应ID】'
        : '未能改变数据, 可能原因:\n【数据超过14天或未找到对应ID】',
    })
    return
  }
  if (kind === 'ids') {
    ElNotification.success({ message: `成功，删:${success}, 共:${res?.all}, 未找到:${res?.not_found}` })
  } else if (kind === 'source') {
    ElNotification.success({ message: '清除当前源[所有]成功，清除条数:' + success })
  } else {
    ElNotification.success({ message: '删除当天数据成功,本次清除条数:' + JSON.stringify(res) })
  }
}

/** 旧 `deleteEntrySelected`（工具条 → 删除选中的数据） */
function deleteEntrySelected() {
  const ids = [...selected.value]
  void confirmDanger('警告', '[实验性]，批量删除选中的数据,共[' + ids.length + ' ] 条记录?', async () => {
    try {
      const res = await dataApi.rowDeleteBatch(tableId.value, ids)
      reportDelete(res, 'ids')
      return withMessage(res)
    } finally {
      // 旧版成功/失败都会 handleRefresh() + 清空勾选
      handleRefresh()
      clearSelection()
    }
  }, () => {})
}

/** 旧 `batchDeleteReturn`（「填入IDs-删除」弹窗的确定） */
function batchDeleteReturn() {
  const ids = batchDeleteIds.value.trim().split('\n').map((s) => s.trim()).filter(Boolean)
  void confirmDanger('警告', '[实验性]，批量删除该表中数据,共[' + ids.length + ' ] 条记录?', async () => {
    try {
      const res = await dataApi.rowDeleteBatch(tableId.value, ids)
      reportDelete(res, 'ids')
      if (Number(res?.success ?? 0) !== 0) showIds.value = false
      return withMessage(res)
    } finally {
      handleRefresh()
      clearSelection()
    }
  }, () => {})
}

/** 旧 `deleteEntryCurDate(needSource)`：needSource=true 删该源当日、false 清空整表当日 */
function deleteEntryCurDate(needSource: boolean) {
  const sourceName = needSource ? queryForm.sourceId : '不限'
  void confirmDanger(
    '确认删除当天，源:[' + sourceName + ']',
    '确认删除[当天]数据，源:[' + sourceName + '], 表:' + (tableMeta.value?.tableName ?? '') + '，注意删除后无法恢复',
    async () => {
      try {
        const res = await dataApi.rowDelete(tableId.value, {
          sourceId: needSource ? queryForm.sourceId : undefined,
          all: 0,
        })
        reportDelete(res, 'date')
        return withMessage(res)
      } finally {
        handleRefresh()
        clearSelection()
      }
    },
    () => {},
  )
}

/** 旧 `handleDeleteThisSource(needSource)`：needSource=true 删该源所有、false 清空整表全量 */
function handleDeleteThisSource(needSource: boolean) {
  const sourceName = needSource ? queryForm.sourceId : '不限'
  void confirmDanger(
    '确认删除,源:[' + sourceName + ']',
    '确认删除【所有】数据，源[' + sourceName + '], 数据表:' + (tableMeta.value?.tableName ?? '') + '，注意删除后无法恢复',
    async () => {
      try {
        const res = await dataApi.rowDelete(tableId.value, {
          sourceId: needSource ? queryForm.sourceId : undefined,
          all: 1,
        })
        reportDelete(res, 'source')
        return withMessage(res)
      } finally {
        handleRefresh()
        clearSelection()
      }
    },
    () => {},
  )
}

/** 旧 `handleDeleteOne(row)`：行内「删除单条【无法恢复】」 */
function handleDeleteOne(row: DataRow) {
  void confirmDanger(
    '确认删除一条:' + row.dataId,
    '是否确认删除数据？ 【删除后无法恢复】',
    async () => {
      try {
        const res = await dataApi.rowDelete(String(row.entryTypeId ?? tableId.value), {
          sourceId: row.sourceId,
          all: 1,
          entryId: row.dataId,
        })
        reportDelete(res, 'source')
        return withMessage(res)
      } finally {
        handleRefresh()
        clearSelection()
      }
    },
    () => {},
  )
}

/** 旧 `handleState(record)`：设为正式表（AC）—— 之后再从页面删该表数据就不可用了 */
function handleState() {
  void confirmDanger(
    '正式态确认',
    '如确认设置为正式态，将不再支持从页面删除该表数据',
    async () => {
      const res = await entryApi.markEntryType(tableId.value, 'AC')
      if (tableMeta.value) tableMeta.value = { ...tableMeta.value, state: 'AC' }
      handleRefresh()
      return res
    },
    () => { ElMessage.success('设置成功') },
  )
}

/* ------------------------------------------------------------------ *
 * 弹层：编辑 / 详情 / 任务实例 / 源详情 / API / 导入 / 填入IDs          *
 * ------------------------------------------------------------------ */
const editRef = ref<InstanceType<typeof ColumnEditDialog>>()
const detailRef = ref<InstanceType<typeof ColumnDetailDrawer>>()
const taskRef = ref<InstanceType<typeof TaskInstDialog>>()
const sourceDetailRef = ref<InstanceType<typeof SourceDetailDialog>>()
const apiRef = ref<InstanceType<typeof ApiDescDialog>>()
const uploadRef = ref<InstanceType<typeof UploadDataDialog>>()

/**
 * 旧 `EntryDetail.vue` 的列集：详情抽屉吃 `ENTRY_DETAIL.base` 的 16 个系统列，
 * 主列表（`listKey="showItems"`）与子表（`subKey="subs"`）都吃 `ENTRY_DETAIL.data` 的 5 列。
 */
const DETAIL_COLUMNS = ENTRY_DETAIL_BASE
const DETAIL_LIST_COLUMNS = ENTRY_DETAIL_DATA

/**
 * `dataApi.rowDetail` 的 `{row, showItems, subs}` → 共享 ColumnDetailDrawer 认识的扁平记录。
 * `subs` 每条自带 `showItems` 与 `tableId/tableName`（旧平台是 entryTypeId/entryTypeName），
 * 归一化后子表标题仍显示「子表类型-子表名 - 子表ID」。
 */
function buildDetailRecord(detail: EntryDetail): Record<string, unknown> {
  return {
    ...detail.row,
    showItems: detail.showItems,
    subs: (detail.subs ?? []).map((sub) => ({
      ...sub.row,
      entryTypeId: sub.tableId,
      entryTypeName: sub.tableName,
      entryId: sub.row.dataId,
      showItems: sub.showItems,
    })),
    subsCnt: detail.subsCnt,
  }
}

/** 旧 `EntryDetail.loadInfo(typeId, entryId)` */
async function openEntryDetail(typeId: string, dataId: string) {
  try {
    const detail = await dataApi.rowDetail(typeId, dataId)
    if (!detail) {
      ElNotification.error({ message: '获取数据表详情失败' })
      return
    }
    detailRef.value?.open(buildDetailRecord(detail), '数据表详情')
  } catch (err) {
    ElNotification.error({ message: '获取数据表详情失败' + errText(err) })
  }
}

/** 旧 `handleDetail(record)` → entryDetail.showModal(ENTRY_TYPE_ID, ENTRY_ID) */
function handleDetail(row: DataRow) {
  void openEntryDetail(String(row.entryTypeId ?? tableId.value), row.dataId)
}

/** 旧 `handleParentDetail(record)`：父表可点时才打开父数据（见文件头偏差第 12 条） */
function handleParentDetail(row: DataRow) {
  const pTable = Number(row.categoryId ?? 0) > 0 ? String(row.categoryId) : ''
  if (!pTable || Number(row.parentId ?? 0) <= 0) return
  void openEntryDetail(pTable, String(row.parentId))
}

/** 旧 `handleShowTask(record)` */
function handleShowTask(row: DataRow) {
  taskRef.value?.open({
    sourceId: row.sourceId,
    parentId: null,
    taskId: Number(row.detailId ?? 0) || row.detailId,
  })
}

/** 旧 `handleShowSubTask(tab)`：查这条数据的后续任务实例（以本行 ENTRY_ID 作 parentId） */
function handleShowSubTask(row: DataRow) {
  taskRef.value?.open({
    sourceId: row.sourceId,
    configId: null,
    taskId: '',
    parentId: row.dataId,
  })
}

/** 旧 `showSourceDetail(sourceId)` */
function showSourceDetail(sourceId: string) {
  sourceDetailRef.value?.open(sourceId)
}

/** 旧 `handleShowJSON(row)`：原始 JSON 新开标签 */
function handleShowJSON(row: DataRow) {
  if (!row.k0) return
  const params = new URLSearchParams({ sourceId: row.sourceId, id: String(row.k0) })
  window.open(`/api/v1/readJson?${params}`, '_blank')
}

/** 旧 `handleEdit(record)`：先拉详情把动态列反填进表单，再打开「数据修改」弹窗 */
async function handleEdit(row: DataRow) {
  const typeId = String(row.entryTypeId ?? tableId.value)
  try {
    const detail = await dataApi.rowDetail(typeId, row.dataId)
    if (!detail) {
      ElNotification.error({ message: '获取数据表详情失败' })
      return
    }
    const data: Record<string, unknown> = { ENTRY_ID: row.dataId, ENTRY_TYPE_ID: typeId }
    detail.showItems.forEach((item) => { data[item.columnName] = item.value })
    editRef.value?.open(data, '去重列:' + String(tableMeta.value?.keyField ?? ''))
  } catch (err) {
    ElNotification.error({ message: '获取数据表详情失败' + errText(err) })
  }
}

/** 旧 `updateCallback(obj)` → `entryUpdate(obj)`（整条记录平铺提交，含 ENTRY_ID / ENTRY_TYPE_ID） */
function updateCallback(form: Record<string, unknown>) {
  const entryId = String(form.ENTRY_ID ?? '')
  const values: Record<string, unknown> = { ...form }
  delete values.ENTRY_ID
  delete values.ENTRY_TYPE_ID
  return dataApi.rowUpdate(tableId.value, entryId, values)
}

/** 旧 `handleReSave(row)`：重新保存该行原始 JSON（可能更新 1 条或多条数据） */
function handleReSave(row: DataRow) {
  if (!row.k0) return
  void confirmDanger(
    '是否确认重新保存该原始json :' + String(row.k0),
    '本次保存可能更新1条或多条数据',
    async () => {
      try {
        const res = await dataApi.reSave(row.sourceId, String(row.k0))
        ElNotification.success({ message: '重新保存成功,请检查数据' })
        return res
      } finally {
        // 旧版成功与失败都会 handleRefresh()
        handleRefresh()
        clearSelection()
      }
    },
    () => {},
  )
}

/** 行内操作下拉派发（旧 actionSlot 的 5 个入口） */
function onRowCommand(command: string, row: DataRow) {
  if (command === 'detail') handleDetail(row)
  else if (command === 'subTask') handleShowSubTask(row)
  else if (command === 'deleteOne') handleDeleteOne(row)
  else if (command === 'edit') void handleEdit(row)
  else if (command === 'reSave') handleReSave(row)
}

/** 工具条「数据操作」下拉派发（元素顺序与旧 a-menu 一致） */
function onBatchCommand(command: string) {
  if (command === 'deleteSelected') deleteEntrySelected()
  else if (command === 'deleteSourceDate') deleteEntryCurDate(true)
  else if (command === 'deleteSourceAll') handleDeleteThisSource(true)
  else if (command === 'deleteByIds') { showIds.value = true }
  else if (command === 'markFormal') handleState()
  else if (command === 'clearDate') deleteEntryCurDate(false)
  else if (command === 'clearAll') handleDeleteThisSource(false)
}

/* ------------------------------------------------------------------ *
 * 排序 / 分页                                                         *
 * ------------------------------------------------------------------ */
function onSortChange(payload: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  sort.field = payload.order && payload.prop ? payload.prop : ''
  sort.order = payload.order === 'ascending' ? 'ascend' : payload.order === 'descending' ? 'descend' : ''
  // 旧 handleSortChange 末尾就是 handleRefresh(true)
  handleRefresh(true)
}

function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

/* ------------------------------------------------------------------ *
 * 路由 query（旧 props + created 的等价物）                            *
 * ------------------------------------------------------------------ */
function pickQuery(key: string): string {
  const value = route.query[key]
  const text = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
  return text.trim()
}

/** 源选择器的初始值（旧 `:sid="sid"`） */
const routeSid = ref('')

function applyRouteQuery() {
  routeSid.value = pickQuery('sourceId')
  queryForm.sourceId = routeSid.value
  // 旧 `if ($route.query.entryType) queryParam.entryType = …` + 那句写死的 999
  tableId.value = pickQuery('entryType') || pickQuery('entryTypeId') || DEFAULT_MEASURE_TABLE_ID
}

onMounted(async () => {
  applyRouteQuery()
  await loadTable()
})

// 同一 tab 内再次带 query 跳进来时（MetricCenter 用 router.replace 切页签，组件不会重新挂载），
// 跟随 sourceId / entryType 变化重查——旧 `watch '$route.query'` 的等价物
watch(
  () => [pickQuery('sourceId'), pickQuery('entryType'), pickQuery('entryTypeId')] as const,
  ([sourceId, entryType, entryTypeId]) => {
    queryForm.sourceId = sourceId
    const next = entryType || entryTypeId || DEFAULT_MEASURE_TABLE_ID
    if (next !== tableId.value) {
      tableId.value = next
      void loadTable()
      return
    }
    handleRefresh(true)
  },
)
</script>

<template>
  <div class="ir-shell">
    <div class="ir-head">
      <div class="ir-title">指标结果</div>
      <div class="ir-sub">
        查看某个数据表（默认「指标」表）下的数据行：按源 / 指标编码 / 名称 / 日期 / ID 区间检索，
        支持动态列、SQL 与取数 API 预览、导入导出，以及按行 / 按源 / 按时间删除与改为正式表。
      </div>
    </div>

    <!-- 搜索栏（旧 a-form layout="inline"）：改条件不自动查，点「查询」或回车才发请求 -->
    <el-form :inline="true" class="ir-filter-form">
      <el-row :gutter="8" class="ir-filter-row">
        <el-col :md="4" :sm="24">
          <el-form-item class="ir-source-item">
            <EntrySourceSelect
              v-model="queryForm.sourceId"
              :sid="routeSid || undefined"
              @change="handleSourceChange"
            />
          </el-form-item>
        </el-col>
        <!-- 旧模板里紧跟其后的「SQL条件片断」a-auto-complete 整段被注释掉，不迁（见文件头偏差第 2 条） -->
        <el-col :md="3" :sm="24">
          <el-form-item>
            <el-input v-model="queryForm.code" placeholder="指标编码" clearable @keyup.enter="handleRefresh(true)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item>
            <el-input v-model="queryForm.name" placeholder="指标名称" clearable @keyup.enter="handleRefresh(true)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item>
            <el-date-picker
              v-model="queryForm.date"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="指标日期"
              class="ir-date"
              @change="handleRefresh(true)"
            />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item>
            <el-input v-model="queryForm.min" placeholder="起始ID" clearable @keyup.enter="handleRefresh(true)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item>
            <el-input v-model="queryForm.max" placeholder="终止ID" clearable @keyup.enter="handleRefresh(true)" />
          </el-form-item>
        </el-col>
        <el-col :md="2" :sm="24">
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="handleRefresh(true)">查询</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <!-- 工具条：左边「数据操作」下拉（仅测试态 C 的表显示），右边当前源 / 当前表 + 4 个图标 -->
    <div class="ir-op-bar">
      <el-dropdown v-if="tableMeta?.state === 'C'" @command="onBatchCommand">
        <el-button :icon="Setting">
          数据操作
          <el-icon class="ir-more-arrow"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <!-- el-dropdown-menu 不支持嵌套子菜单，旧的「按时间删除.. / 表操作」两个 a-sub-menu 拍平成 7 项 -->
            <el-dropdown-item command="deleteSelected" :icon="Delete">删除选中的数据</el-dropdown-item>
            <el-dropdown-item command="deleteSourceDate" :icon="Delete" divided>删除该源-当日数据</el-dropdown-item>
            <el-dropdown-item command="deleteSourceAll" :icon="Warning">删除该源-所有数据</el-dropdown-item>
            <el-dropdown-item command="deleteByIds" :icon="Minus">填入IDs-删除</el-dropdown-item>
            <el-dropdown-item command="markFormal" :icon="Select" divided>设为正式表</el-dropdown-item>
            <el-dropdown-item command="clearDate" :icon="Delete">清空表数据【当日】</el-dropdown-item>
            <el-dropdown-item command="clearAll" :icon="Warning">清空表数据【全量】</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="ir-spacer" />
      <div class="ir-tags">
        <el-tag v-if="queryForm.sourceId" type="success" size="small">{{ queryForm.sourceId }}</el-tag>
        <el-tag v-if="tableMeta?.tableName" type="success" size="small">{{ tableMeta.tableName }}</el-tag>
        <el-divider direction="vertical" />
        <el-tooltip content="展示SQL" placement="top-start">
          <el-button link :icon="Tickets" title="SQL" @click="handleShowSql" />
        </el-tooltip>
        <el-divider direction="vertical" />
        <el-tooltip content="取数API" placement="top-start">
          <el-button link :icon="Connection" title="API" @click="handleShowApi" />
        </el-tooltip>
        <el-divider direction="vertical" />
        <el-tooltip content="导入数据" placement="top-start">
          <el-button link :icon="Upload" title="导入数据" @click="handleUploadData" />
        </el-tooltip>
        <el-divider direction="vertical" />
        <el-tooltip content="导出EXCEL" placement="top-start">
          <el-button link :icon="Download" title="导出EXCEL" @click="handleExport" />
        </el-tooltip>
        <el-divider direction="vertical" />
      </div>
    </div>

    <el-alert v-if="showTip" type="info" :closable="false" class="ir-tip">
      <template #title><span class="ir-tip-text">{{ tipText }}</span></template>
    </el-alert>

    <!-- 表格：勾选列 + 动态列（前 12 个必填字段）+ 系统列 + 操作列 -->
    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="rows"
      border
      size="small"
      :row-key="(r: DataRow) => r.dataId"
      @selection-change="onSelectionChange"
      @sort-change="onSortChange"
    >
      <el-table-column type="selection" width="50" fixed="left" />

      <el-table-column prop="ENTRY_ID" label="ENTRY_ID" width="105" fixed="left" sortable="custom">
        <template #default="{ row }">
          <span class="ir-link" @click="handleDetail(row)">{{ row.dataId }}</span>
        </template>
      </el-table-column>

      <!-- 旧列标题是「源」（prop=SOURCE_ID），不是「源ID」 -->
      <el-table-column prop="SOURCE_ID" label="源" width="100" sortable="custom">
        <template #default="{ row }">
          <span class="ir-link" @click="showSourceDetail(row.sourceId)">{{ row.sourceId }}</span>
        </template>
      </el-table-column>

      <!-- 动态列：必填字段的前 12 个；值取 row.values[物理列名]；url 列渲染成外链 -->
      <el-table-column
        v-for="col in dynamicCols"
        :key="col.dataIndex"
        :label="col.title"
        :prop="col.dataIndex"
        :width="col.width"
        show-overflow-tooltip
        :sortable="allSort ? 'custom' : false"
      >
        <template #default="{ row }">
          <a
            v-if="col.url && row.values?.[col.dataIndex]"
            :href="String(row.values[col.dataIndex])"
            target="_blank"
            rel="noreferrer noopener nofollow"
            class="ir-link"
          >{{ row.values[col.dataIndex] }}</a>
          <span v-else>{{ String((row.values?.[col.dataIndex] ?? (row as unknown as Record<string, unknown>)[col.dataIndex]) ?? '') }}</span>
        </template>
      </el-table-column>

      <!-- ⚠️ 必须自己渲染 `row.state`：列名沿用旧模板的 prop="STATE"（照抄旧 s-table 的列），
           但新适配层的 `DataRow` 是 camelCase（`dataRowFromLegacy` 把 STATE → state），
           不给插槽的话这一列会渲染成空 -->
      <el-table-column prop="STATE" label="状态" width="70" sortable="custom">
        <template #default="{ row }">{{ String(row.state ?? '') }}</template>
      </el-table-column>
      <el-table-column prop="UPDATE_DT" label="更新" width="80" sortable="custom">
        <template #default="{ row }">
          <el-tooltip :content="String(row.updateDt ?? '—')" placement="top-start">
            <span class="ir-time">{{ timeAgo(row.updateDt) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="CREATE_DT" label="生成" width="80" sortable="custom">
        <template #default="{ row }">
          <el-tooltip :content="String(row.createDt ?? '—')" placement="top-start">
            <span class="ir-time">{{ timeAgo(row.createDt) }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="DETAIL_ID" label="任务" width="100" sortable="custom">
        <template #default="{ row }">
          <span class="ir-link" @click="handleShowTask(row)">{{ row.detailId }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="NEXT_FLAG" label="后续" width="70">
        <template #default="{ row }">{{ String(row.nextFlag ?? '') }}</template>
      </el-table-column>
      <el-table-column prop="PARENT_ID" label="父ID" width="80">
        <template #default="{ row }">
          <!-- 父表可点时才做成链接（旧 `(row.P_TABLE > 0 || curEntryType.parentEntry > 0) && row.PARENT_ID > 0`） -->
          <span
            v-if="Number(row.categoryId ?? 0) > 0 && Number(row.parentId ?? 0) > 0"
            class="ir-link"
            @click="handleParentDetail(row)"
          >{{ row.parentId }}</span>
          <span v-else>{{ String(row.parentId ?? '') }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="K0" label="原始" width="80">
        <template #default="{ row }">
          <span v-if="row.k0" class="ir-link" @click="handleShowJSON(row)">{{ row.k0 }}</span>
          <span v-else>-</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="80" fixed="right">
        <template #default="{ row }">
          <el-dropdown trigger="hover" @command="(cmd: string) => onRowCommand(cmd, row)">
            <span class="ir-link ir-op-more">操作<el-icon class="ir-more-caret"><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="detail">详情</el-dropdown-item>
                <el-dropdown-item command="subTask">查后续任务实例</el-dropdown-item>
                <!-- 下面两项只在测试表（state=C）出现，与旧 `v-if="curEntryType.state == 'C'"` 同口径 -->
                <el-dropdown-item v-if="tableMeta?.state === 'C'" command="deleteOne" divided>
                  删除单条【无法恢复】
                </el-dropdown-item>
                <el-dropdown-item v-if="tableMeta?.state === 'C'" command="edit">手动修改</el-dropdown-item>
                <el-dropdown-item v-if="row.k0" command="reSave">重新保存原始JSON</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：默认 20，可选 20/40/100/200（旧 u-table page-sizes） -->
    <div class="ir-pager">
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

    <!-- 弹层（旧 refs：editModal / taskList / sourceDetail / entryDetail / apiDesc / dataUpload） -->
    <ColumnEditDialog
      ref="editRef"
      title="数据修改"
      :cols="editCols"
      :callback="updateCallback"
      @refresh="handleRefresh()"
    />
    <ColumnDetailDrawer
      ref="detailRef"
      :cols="DETAIL_COLUMNS"
      list-key="showItems"
      list-title="数据列表"
      list-row-key="itemId"
      :list-cols="DETAIL_LIST_COLUMNS"
      sub-key="subs"
      :sub-cols="DETAIL_LIST_COLUMNS"
    />
    <TaskInstDialog ref="taskRef" />
    <SourceDetailDialog ref="sourceDetailRef" />
    <ApiDescDialog ref="apiRef" />
    <UploadDataDialog ref="uploadRef" @refresh="handleRefresh()" />

    <!-- 「填入IDs-删除」（旧 a-modal width 900 + a-textarea rows 20） -->
    <el-dialog v-model="showIds" width="900px" title="填入IDs-删除" class-name="rc-dialog">
      <el-input
        v-model="batchDeleteIds"
        type="textarea"
        :rows="20"
        clearable
        placeholder="批量删除数据表数据，每条一行"
      />
      <template #footer>
        <el-button @click="showIds = false">取消</el-button>
        <el-button type="primary" @click="batchDeleteReturn()">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ir-shell {
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
.ir-head {
  margin-bottom: 2px;
}
.ir-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.ir-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.ir-filter-form {
  margin-bottom: 0;
}
.ir-filter-row {
  width: 100%;
}
.ir-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.ir-filter-form :deep(.el-input),
.ir-filter-form :deep(.el-date-editor) {
  width: 100%;
}
.ir-source-item :deep(.el-form-item__content) {
  width: 100%;
}
/* 工具条：旧版把「当前源 / 当前表 + 4 个图标」float: right 到同一行 */
.ir-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ir-spacer {
  flex: 1;
}
.ir-tags {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ir-more-arrow {
  margin-left: 4px;
  vertical-align: -0.15em;
}
.ir-more-caret {
  margin-left: 2px;
  vertical-align: -0.15em;
}
.ir-tip {
  margin-bottom: 4px;
}
.ir-tip-text {
  white-space: pre-wrap;
  word-break: break-all;
  font-size: 12px;
}
.ir-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  text-decoration: underline;
}
.ir-time {
  white-space: nowrap;
}
.ir-op-more {
  display: inline-flex;
  align-items: center;
}
.ir-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
