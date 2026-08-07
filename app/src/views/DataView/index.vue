<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, QuestionFilled, Plus, Refresh } from '@element-plus/icons-vue'
import {
  dataApi, sourceApi, entryApi,
  type DataRow, type DataTableMeta, type EntryTypeGroup, type EntryDetail, type RowQuery, type SourceOption,
  type EntryType, type Source,
} from '../../api'
import { useAuthStore } from '../../stores/auth'
import DataQueryPanel, { type DataQueryColumn, type DataQueryFilter } from '@/components/DataQueryPanel.vue'
import RowEditDialog from './RowEditDialog.vue'
import SummaryDrawer from './SummaryDrawer.vue'
import TaskInstDialog from './TaskInstDialog.vue'
import StepDrawer from './StepDrawer.vue'
import TableDetailDialog from './TableDetailDialog.vue'
import SourceDetailDrawer from './SourceDetailDrawer.vue'
import MoreTablesDialog from './MoreTablesDialog.vue'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import { unsupportedNextStepBatchFilters } from './batchGuards'
import DataMaintenanceDrawer from './DataMaintenanceDrawer.vue'

// 单表数据查看迁移方案（E 包）+ 数据表页_UI重写设计_2026-07-30：
// 本文件覆盖数据范围/快捷查询/结果工具条/批量条/动态列表格/分页/数据详情抽屉/手动添加/手动修改/统计/
// 步骤展示（简化列表，无 DAG 图，见方案 §4.1 偏离决定）/任务实例弹窗/
// 表结构详情·源详情（? 按钮）/加载更多数据表·更多源（方案 §1.3 补齐）。
// S5-1（0805 拍板，方案 §5.2）：筛选表单（数据ID/父ID/时间/后续标识/ID区间/条件表达式）+ 结果表格本体
// （动态列渲染/排序/分页/可选勾选列）已抽到 @/components/DataQueryPanel.vue，跟 RuleTestDialog（S5-2）
// 共用；本文件只保留选表/选源/快捷查询/结果工具条/批量操作业务逻辑/各弹窗，通过 query-change/loaded 事件
// 镜像面板的筛选状态和查询结果，供 buildQuery()/统计/导出/批量发送等既有功能读取。
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const route = useRoute()
const router = useRouter()

interface CommonQuery { label: string; sql?: string; kind?: 'all-source' }
const COMMON_QUERIES: CommonQuery[] = [
  { label: '所有源', kind: 'all-source' },
  { label: '日新增', sql: 'CREATE_DT > CURDATE()' },
  { label: '日更新', sql: 'UPDATE_DT > CURDATE()' },
  { label: '近2日新增', sql: 'CREATE_DT > DATE_SUB(CURDATE(), INTERVAL 1 DAY)' },
  { label: '近2日更新', sql: 'UPDATE_DT > DATE_SUB(CURDATE(), INTERVAL 1 DAY)' },
]

// ---- 选表 / 选源 ----
const group = ref<EntryTypeGroup>({ list1: [], list2: [], list3: [] })
const tableId = ref('')
const tableMeta = ref<DataTableMeta | null>(null)
const sourceOptions = ref<SourceOption[]>([])
const sourceId = ref('')

async function loadGroup() {
  group.value = await dataApi.entryTypesGroup(sourceId.value || undefined)
  if (!tableId.value) {
    tableId.value = group.value.main || group.value.list3[0]?.tableId || group.value.list1[0]?.tableId || ''
  }
}

// ---- 表结构详情 / 源详情（? 按钮，方案 §1.3-1/§1.3-2） ----
const tableDetailOpen = ref(false)
function openTableDetail() {
  if (!tableMeta.value) {
    ElMessage.error('请先选择数据表')
    return
  }
  tableDetailOpen.value = true
}
const sourceDetailOpen = ref(false)
const sourceDetailTargetId = ref('')
function openSourceDetail() {
  if (!sourceId.value) {
    ElMessage.error('请先选择源ID')
    return
  }
  sourceDetailTargetId.value = sourceId.value
  sourceDetailOpen.value = true
}
// 行内源列点击：以行 sourceId 打开源详情（不影响检索栏的 sourceId）
function openSourceDetailForRow(sid: string) {
  sourceDetailTargetId.value = sid
  sourceDetailOpen.value = true
}

// ---- 加载更多数据表 / 更多源（方案 §1.3-1/§1.3-2） ----
const moreTablesOpen = ref(false)
async function onTablePicked(entry: EntryType) {
  if (!group.value.list3.some((t) => t.tableId === entry.tableId)) {
    group.value = { ...group.value, list3: [entry, ...group.value.list3] }
  }
  tableId.value = entry.tableId
  await onTableChange()
}
const moreSourcesOpen = ref(false)
async function onSourcePicked(source: Source) {
  if (!sourceOptions.value.some((s) => s.sourceId === source.sourceId)) {
    sourceOptions.value = [{ sourceId: source.sourceId, name: source.name }, ...sourceOptions.value]
  }
  sourceId.value = source.sourceId
  await onSourceChange()
}
async function loadSources() {
  sourceOptions.value = await sourceApi.sourceSame(sourceId.value || undefined)
}
async function loadTableMeta() {
  tableMeta.value = tableId.value ? await dataApi.tableMeta(tableId.value) : null
}

// ---- 查询面板桥接（S5-1）：面板自己管筛选字段/结果/分页，这里只镜像它的输出，
// 供 buildQuery()/统计/导出/批量发送/canSendAll 这些既有功能继续读 ----
const panelRef = ref<InstanceType<typeof DataQueryPanel>>()
const panelFilter = ref<DataQueryFilter>({ page: 1, size: 20 })
const panelRows = ref<DataRow[]>([])
const panelTotal = ref(0)
// 动态列排序上限（total ≤ 500000 才开放，方案 §1.5-5）交给 DataQueryPanel 内部处理；ENTRY_ID/源/
// 更新/生成这几个固定列原本就不受这个限制（旧代码里 sortable="custom" 写死，没跟这条挂钩），
// 所以这里不需要再算一份 allSort。

const lastSignature = ref('')
function querySignature() {
  return JSON.stringify([
    sourceId.value,
    panelFilter.value.dataId ?? '',
    panelFilter.value.parentId ?? '',
    panelFilter.value.startTime ?? '',
    panelFilter.value.endTime ?? '',
    panelFilter.value.sql ?? '',
    panelFilter.value.nextFlag ?? '',
    panelFilter.value.min ?? '',
    panelFilter.value.max ?? '',
  ])
}
function onPanelQueryChange(f: DataQueryFilter) {
  panelFilter.value = f
  lastSignature.value = querySignature()
}
function onPanelLoaded(payload: { rows: DataRow[]; total: number }) {
  panelRows.value = payload.rows
  panelTotal.value = payload.total
}
// canSendAll（方案 §1.4-2）：total ≤ 500000 且源/全部查询条件自上次查询未变动
const unsupportedBatchFilters = computed(() => unsupportedNextStepBatchFilters(panelFilter.value))
const canSendAll = computed(() => panelTotal.value <= 500000
  && querySignature() === lastSignature.value
  && unsupportedBatchFilters.value.length === 0)

function buildQuery(): RowQuery {
  return { tableId: tableId.value, sourceId: sourceId.value || undefined, ...panelFilter.value }
}

const selectedRowKeys = ref<string[]>([])

async function onTableChange() {
  await loadTableMeta()
  panelRef.value?.search()
}
async function onSourceChange() {
  await loadGroup()
  panelRef.value?.search()
}
async function applyCommonQuery(q: CommonQuery) {
  if (q.kind === 'all-source') {
    sourceId.value = ''
    await onSourceChange()
    return
  }
  panelRef.value?.search({ sql: q.sql })
}

// ---- 展示 SQL（方案 §1.4-6，本地拼接，不发请求） ----
const showSql = ref(false)
const sqlPreview = computed(() => {
  let s = `select * from ${tableMeta.value?.tableName ?? ''} where 1=1`
  if (panelFilter.value.dataId) s += ` and entry_id in (${panelFilter.value.dataId})`
  if (panelFilter.value.parentId) s += ` and parent_id in (${panelFilter.value.parentId})`
  if (sourceId.value) s += ` and source_id=${sourceId.value}`
  if (panelFilter.value.startTime) s += ` and CREATE_DT >= '${panelFilter.value.startTime}'`
  if (panelFilter.value.endTime) s += ` and CREATE_DT <= '${panelFilter.value.endTime}'`
  if (panelFilter.value.sql) s += ` and ${panelFilter.value.sql}`
  return s
})

// ---- 导出 EXCEL（方案 §1.1，URL 直开，不走 axios） ----
function onExport() {
  window.open(dataApi.exportUrl(buildQuery()), '_blank')
}

// ---- 危险操作确认（对照 EntryTab.vue 的 confirmDanger 本地封装） ----
async function confirmDanger(
  title: string,
  body: string,
  run: () => Promise<unknown>,
  successFallback?: string,
) {
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    const r = await run()
    const message = r && typeof r === 'object' && 'message' in r ? (r as { message?: string }).message : undefined
    ElMessage.success(message || successFallback || '操作成功')
    await panelRef.value?.refresh()
  } catch (error) {
    ElMessage.error(`操作失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---- 删除数据▾（仅测试表 state==='C'，方案 §1.4-4） ----
const isTestTable = computed(() => tableMeta.value?.state === 'C')

function onDeleteSelected() {
  if (!selectedRowKeys.value.length) return
  void confirmDanger(
    '警告',
    `[实验性]，批量删除选中的数据,共[${selectedRowKeys.value.length} ] 条记录?`,
    async () => {
      const r = await dataApi.rowDeleteBatch(tableId.value, selectedRowKeys.value)
      if (r.success === 0) ElMessage.warning('未能改变数据, 可能原因:\n【未找到对应ID】')
      return { message: `成功，删:${r.success}, 共:${r.all}, 未找到:${r.not_found}` }
    },
  )
}
async function onDeleteByRange(all: 0 | 1, scope: 'source' | 'all' = 'source') {
  // scope='source' 仅删当前源数据；scope='all' 清空整表（不带 sourceId 过滤）
  const sid = scope === 'source' ? (sourceId.value || undefined) : undefined
  const scopeLabel = scope === 'source' ? (sourceId.value || '不限') : '全部源'
  const scopeText = scope === 'source' ? '删除该源' : '清空表数据'
  if (all === 1 && scope === 'all') {
    try {
      const result = await ElMessageBox.prompt(
        `这是不可恢复的全量清空操作。请输入当前表名“${tableId.value}”继续。`,
        '高风险确认',
        { inputPlaceholder: tableId.value, inputErrorMessage: '请输入当前表名' },
      )
      if (result.value.trim() !== tableId.value) {
        ElMessage.warning('表名不匹配，已取消操作')
        return
      }
    } catch {
      return
    }
  }
  void confirmDanger(
    '确认删除',
    all === 1
      ? `确认${scopeText}【所有】数据，源[${scopeLabel}], 表:${tableId.value}，注意删除后无法恢复`
      : `确认${scopeText}【当天】数据，源[${scopeLabel}], 表:${tableId.value}，注意删除后无法恢复`,
    async () => {
      const r = await dataApi.rowDelete(tableId.value, { sourceId: sid, all })
      if (!r.success) ElMessage.warning('未能改变数据, 可能原因:\n【数据超过14天或未找到对应ID】')
      return { message: `${scopeText}[${all === 1 ? '所有' : '当日'}]成功，清除条数:${r.success ?? 0}` }
    },
  )
}
async function onDeleteByIds() {
  let text = ''
  try {
    const result = await ElMessageBox.prompt('批量删除物理表数据，每条一行', '填入IDs删除', { inputType: 'textarea' })
    text = result.value
  } catch {
    return
  }
  const ids = text.split('\n').map((s) => s.trim()).filter(Boolean)
  if (!ids.length) return
  void confirmDanger('警告', `[实验性]，批量删除选中的数据,共[${ids.length} ] 条记录?`, async () => {
    const r = await dataApi.rowDeleteBatch(tableId.value, ids)
    return { message: `成功，删:${r.success}, 共:${r.all}, 未找到:${r.not_found}` }
  })
}
function onMarkFormal() {
  void confirmDanger(
    '正式态确认',
    '如确认设置为正式态，将不再支持从页面删除该表数据',
    async () => {
      const r = await entryApi.markEntryType(tableId.value, 'AC')
      await loadTableMeta()
      return r
    },
    '设置成功',
  )
}

async function onDistinctSource() {
  try {
    const ids = await dataApi.distinctSource(buildQuery())
    await ElMessageBox.alert(ids.join(',') || '（无）', '展示当前条件下所有的源:')
  } catch (error) {
    ElMessage.error(`加载失败:${error instanceof Error ? error.message : String(error)}`)
  }
}
function onClearParent() {
  if (!canWrite.value) {
    ElMessage.error('仅管理员可清除父表后续标识')
    return
  }
  if (!sourceId.value) {
    ElMessage.warning('请先选择源，再清除父表后续标识')
    return
  }
  if (!selectedRowKeys.value.length) {
    ElMessage.warning('请先选择要清除标识的数据')
    return
  }
  void confirmDanger(
    '提示',
    '确认清除父表后续标识?',
    () => dataApi.clearParent(buildQuery(), selectedRowKeys.value),
    '设置成功',
  )
}

// ---- 工具▾：旧平台入口恢复为显式菜单；未迁移的复杂弹窗不伪造成功结果 ----
const apiOpen = ref(false)
const apiPreview = computed(() => {
  const query = buildQuery()
  return [
    '查询接口：POST /api/v1/entry/entryDataPaged',
    `导出接口：GET ${dataApi.exportUrl(query)}`,
    `当前条件：${JSON.stringify(query)}`,
  ].join('\n')
})

function onShowApi() {
  apiOpen.value = true
}
function onGenerateSource() {
  if (!selectedRowKeys.value.length) {
    ElMessage.warning('请选择要提取的数据行')
    return
  }
  ElMessage.info('“提取数据生成源”需要源配置选择，当前版本已保留入口，生成对话框待迁移')
}
function onOpenDataset() {
  void router.push({ path: '/metrics', query: { entryType: tableId.value, sourceId: sourceId.value || undefined } })
}
function onToolCommand(command: string) {
  switch (command) {
    case 'steps':
      openStepDrawer()
      break
    case 'api':
      onShowApi()
      break
    case 'dataset':
      onOpenDataset()
      break
    case 'generate-source':
      onGenerateSource()
      break
  }
}

// ---- 统计（方案 §1.4-5，read 也可见） ----
const summaryOpen = ref(false)
const maintenanceOpen = ref(false)

function onMoreCommand(command: string) {
  // 延后一帧打开抽屉，避免下拉菜单的当前 click 冒泡到抽屉遮罩后立即触发关闭。
  if (command === 'summary') window.setTimeout(() => { summaryOpen.value = true }, 0)
  if (command === 'sql') showSql.value = !showSql.value
}

function openMaintenance() { maintenanceOpen.value = true }
function handleMaintenanceAction(action: string) {
  maintenanceOpen.value = false
  switch (action) {
    case 'reprocess':
      onNextStepAll()
      break
    case 'delete-selected':
      onDeleteSelected()
      break
    case 'delete-source-day':
      onDeleteByRange(0, 'source')
      break
    case 'delete-source-all':
      onDeleteByRange(1, 'source')
      break
    case 'delete-ids':
      void onDeleteByIds()
      break
    case 'mark-formal':
      onMarkFormal()
      break
    case 'clear-table-day':
      onDeleteByRange(0, 'all')
      break
    case 'clear-table-all':
      onDeleteByRange(1, 'all')
      break
    case 'clear-parent':
      onClearParent()
      break
  }
}

// ---- 展示步骤（方案 §1.4-3；简化为步骤列表，无 DAG 图，见方案 §4.1 偏离决定） ----
const stepOpen = ref(false)
function openStepDrawer() {
  if (!sourceId.value) {
    ElMessage.error('查询栏中未指定源ID,无法展示步骤')
    return
  }
  stepOpen.value = true
}
async function onStepSelectTable(outputTable: string) {
  const all = [...group.value.list1, ...group.value.list2, ...group.value.list3]
  const match = all.find((t) => t.tableName === outputTable)
  if (!match) {
    ElMessage.warning(`未找到匹配的表:${outputTable}`)
    return
  }
  tableId.value = match.tableId
  await onTableChange()
}

// ---- 任务实例弹窗（方案 §1.6-5；DETAIL_ID 列点入口 / 行内「查后续任务实例」入口） ----
const taskInst = reactive<{ visible: boolean; sourceId: string; parentId: string | null; taskId: string }>({
  visible: false, sourceId: '', parentId: null, taskId: '',
})
function openTaskInstByDetail(row: DataRow) {
  if (!row.detailId) return
  taskInst.sourceId = row.sourceId
  taskInst.parentId = null
  taskInst.taskId = row.detailId
  taskInst.visible = true
}
function openTaskInstByRow(row: DataRow) {
  taskInst.sourceId = row.sourceId
  taskInst.parentId = row.dataId
  taskInst.taskId = ''
  taskInst.visible = true
}

// ---- 选中批量条：发后续任务 / 更多批量操作 ----
function onNextStepSelected() {
  if (!selectedRowKeys.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  dataApi.nextStep(sourceId.value, tableId.value, selectedRowKeys.value)
    .then((r) => ElMessage.success(`发送成功:${r.message ?? ''}`))
    .catch((err) => ElMessage.error(`发送失败,原因: [${err instanceof Error ? err.message : String(err)}]`))
}
function onNextStepAll() {
  if (unsupportedBatchFilters.value.length) {
    ElMessage.warning(`当前筛选包含${unsupportedBatchFilters.value.join('、')}，旧平台批量后续暂不支持，请清除后再操作`)
    return
  }
  const body = `[实验性] 批量发送当前条件下全部后续任务?  条件: [ {源:${sourceId.value || '不限'} && ...} ]`
  ElMessageBox.confirm(body, '提示', { type: 'warning' }).then(async () => {
    try {
      const r = await dataApi.nextStepBatch({
        tableId: tableId.value, sourceId: sourceId.value || undefined,
        size: 500000, start: 0, nextFlag: panelFilter.value.nextFlag, cond: panelFilter.value.sql,
      })
      ElMessage.success(`发送成功:${r.message ?? ''}`)
    } catch (err) {
      ElMessage.error(`发送失败,原因: [${err instanceof Error ? err.message : String(err)}]`)
    }
  }).catch(() => {})
}
async function onNextStepPage() {
  const ids = panelRows.value.map((r) => r.dataId)
  if (!ids.length) {
    ElMessage.warning('本页无数据')
    return
  }
  try {
    const r = await dataApi.nextStep(sourceId.value, tableId.value, ids)
    ElMessage.success(`发送成功:${r.message ?? ''}, 将自动跳转到下一页`)
    panelRef.value?.advancePage()
  } catch (err) {
    ElMessage.error(`发送失败,原因: [${err instanceof Error ? err.message : String(err)}]`)
  }
}

// ---- 发大量后续（黄色批量条，方案 §1.4-2） ----
const yellowOpen = ref(false)
const yStart = ref('1')
const yEnd = ref('')
const ySize = ref('5000')
const yState1 = ref('')
const yNextFlag = ref('')
const yCond = ref('')
function openYellowPanel() {
  yellowOpen.value = true
  if (!yEnd.value && panelRows.value.length) {
    yEnd.value = String(Math.max(...panelRows.value.map((r) => Number(r.dataId) || 0)))
  }
}
function onSendYellowBatch() {
  const sourceId1 = sourceId.value || undefined
  const state1 = yState1.value || undefined
  const start1 = Number(yStart.value) || 1
  const end1 = yEnd.value ? Number(yEnd.value) : undefined
  const size1 = Number(ySize.value) || 5000
  // 标签声明 1-1W 条，提交前强制校验范围
  if (!Number.isFinite(size1) || size1 < 1 || size1 > 10000) {
    ElMessage.warning('发送数量必须在 1-10000 之间')
    return
  }
  const nextFlag1 = yNextFlag.value || undefined
  const cond1 = yCond.value || undefined
  // 展示文案原样保留旧字段名 entryTypeId（旧平台 nextStep2 载荷键名，见方案 §1.4-2）
  const displayParam = { entryTypeId: tableId.value, sourceId: sourceId1, state: state1, start: start1, end: end1, size: size1, nextFlag: nextFlag1, cond: cond1 }
  ElMessageBox.confirm(JSON.stringify(displayParam), '确认发送大批量后续问题', { type: 'warning' }).then(async () => {
    try {
      const r = await dataApi.nextStepBatch({ tableId: tableId.value, sourceId: sourceId1, state: state1, start: start1, end: end1, size: size1, nextFlag: nextFlag1, cond: cond1 })
      ElMessage.success(`发送成功:${r.message ?? ''}`)
    } catch (err) {
      ElMessage.error(`发送失败,原因: [${err instanceof Error ? err.message : String(err)}]`)
    }
  }).catch(() => {})
}

// ---- 数据详情抽屉（只读，行 + showItems + subs；父数据详情复用同一抽屉换参） ----
const detail = reactive<{ visible: boolean; data: EntryDetail | null }>({ visible: false, data: null })
async function openDetailFor(forTableId: string, forDataId: string) {
  try {
    detail.data = await dataApi.rowDetail(forTableId, forDataId)
    detail.visible = true
  } catch (error) {
    ElMessage.error(`获取数据表详情失败${error instanceof Error ? error.message : String(error)}`)
  }
}
function openDetail(row: DataRow) { void openDetailFor(tableId.value, row.dataId) }
function openParentDetail(row: DataRow) {
  if (row.categoryId && row.parentId && row.parentId !== '0') void openDetailFor(row.categoryId, row.parentId)
}

// ---- 手动添加 / 手动修改（方案 §1.6-2/3，不自动刷新，原样保留） ----
const editor = reactive<{ visible: boolean; mode: 'add' | 'edit'; row: DataRow | null }>({
  visible: false, mode: 'add', row: null,
})
function openAdd() { editor.mode = 'add'; editor.row = null; editor.visible = true }
function openEdit(row: DataRow) { editor.mode = 'edit'; editor.row = row; editor.visible = true }

// ---- 行内操作：删除单条 / 重新保存原始 JSON（对照 EntryTab.vue 行内操作模式） ----
function onDeleteOne(row: DataRow) {
  void confirmDanger(
    '确认删除',
    `确认删除一条:${row.dataId} / 是否确认删除数据？ 【删除后无法恢复】`,
    () => dataApi.rowDelete(tableId.value, { sourceId: row.sourceId, all: 1, entryId: row.dataId }),
    '删除成功',
  )
}
function onReSave(row: DataRow) {
  if (!row.k0) return
  void confirmDanger(
    '确认',
    `是否确认重新保存该原始json :${row.k0} / 本次保存可能更新1条或多条数据`,
    () => dataApi.reSave(row.sourceId, row.k0 as string),
    '重新保存成功,请检查数据',
  )
}
function openRawJson(row: DataRow) {
  if (!row.k0) return
  const params = new URLSearchParams({ sourceId: row.sourceId, id: String(row.k0) })
  window.open(`/api/v1/readJson?${params}`, '_blank')
}

// ---- 动态列（方案 §1.5-3：物理表字段全部保留，通过横向滚动查看）→ 面板 columns prop ----
const dynamicColumns = computed(() => (tableMeta.value?.fields ?? []).filter((f) => f.columnName || f.prop))
function columnWidth(desc: string) {
  const base = /区间|时间|日期|周期/.test(desc) ? 140 : 120
  return Math.round(base * 0.9)
}
const panelColumns = computed<DataQueryColumn[]>(() => dynamicColumns.value.map((f) => ({
  prop: f.columnName ?? f.prop,
  label: `${f.desc}-${f.columnName}`,
  width: columnWidth(f.desc),
  sortable: true,
  hintProp: f.prop,
})))
function formatDateTime(value?: string) {
  return value ? value.slice(0, 16) : '—'
}
// 相对时间（方案 §1.5-4/§4.3：timeago + hover 绝对时间 title）
function timeAgo(value?: string): string {
  if (!value) return '—'
  const ts = new Date(value).getTime()
  if (Number.isNaN(ts)) return value
  const diff = Date.now() - ts
  if (diff < 0) return value.slice(0, 16)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  return value.slice(0, 10)
}

// ---- 深链接：?entryType=/?sourceId= 进入自动带入，watch 路由参数变化即时重载 ----
watch(() => route.query.entryType, (v) => {
  if (typeof v === 'string' && v && v !== tableId.value) { tableId.value = v; void onTableChange() }
})
watch(() => route.query.sourceId, (v) => {
  const next = typeof v === 'string' ? v : ''
  if (next !== sourceId.value) { sourceId.value = next; void onSourceChange() }
})

onMounted(async () => {
  const etQuery = route.query.entryType
  const sidQuery = route.query.sourceId
  if (typeof sidQuery === 'string') sourceId.value = sidQuery
  await loadSources()
  await loadGroup()
  if (typeof etQuery === 'string' && etQuery) tableId.value = etQuery
  await loadTableMeta()
  panelRef.value?.search()
})
</script>

<template>
  <div class="rc-card dv-page">
    <!-- 数据范围：选表/选源（查询条件与快捷查询由 DataQueryPanel 统一承载） -->
    <div class="rc-toolbar wrap">
      <el-select v-model="tableId" filterable placeholder="选择数据表" style="width: 220px" @change="onTableChange">
        <el-option-group label="main">
          <el-option v-for="t in group.list1" :key="t.tableId" :value="t.tableId" :label="`${t.name || t.tableName}`" />
        </el-option-group>
        <el-option-group label="subs">
          <el-option v-for="t in group.list2" :key="t.tableId" :value="t.tableId" :label="`${t.name || t.tableName}`" />
        </el-option-group>
        <el-option-group label="other">
          <el-option v-for="t in group.list3.slice(0, 5)" :key="t.tableId" :value="t.tableId" :label="`${t.name || t.tableName}`" />
        </el-option-group>
        <template #footer>
          <span class="dv-link" @click="moreTablesOpen = true">
            <el-icon><Plus /></el-icon>加载更多数据表...
          </span>
        </template>
      </el-select>
      <button class="rc-btn dv-help-btn" type="button" title="表结构详情" @click="openTableDetail">
        <el-icon><QuestionFilled /></el-icon>
      </button>
      <el-select v-model="sourceId" filterable clearable placeholder="选择源" style="width: 200px" @change="onSourceChange">
        <el-option v-for="s in sourceOptions" :key="s.sourceId" :value="s.sourceId" :label="`${s.sourceId} ${s.name}`" />
        <template #footer>
          <span class="dv-link" @click="moreSourcesOpen = true">
            <el-icon><Plus /></el-icon>更多源...
          </span>
        </template>
      </el-select>
      <button class="rc-btn dv-help-btn" type="button" title="源详情" @click="openSourceDetail">
        <el-icon><QuestionFilled /></el-icon>
      </button>
    </div>

    <!-- 查询条件与结果表格：基础条件常显，高级条件默认收起，见 DataQueryPanel.vue -->
    <DataQueryPanel
      ref="panelRef"
      :table-id="tableId"
      :source-id="sourceId"
      :columns="panelColumns"
      :selectable="canWrite"
      v-model:selected-keys="selectedRowKeys"
      @query-change="onPanelQueryChange"
      @loaded="onPanelLoaded"
    >
      <template #quick>
        <span class="dv-quick-label">快捷：</span>
        <button v-for="q in COMMON_QUERIES" :key="q.label" class="dv-quick-btn" type="button" @click="applyCommonQuery(q)">
          {{ q.label }}
        </button>
      </template>
      <template #toolbar>
        <!-- 结果工具条：默认仅保留刷新、新增、导出、更多四个入口 -->
        <div class="dv-result-toolbar" data-testid="data-result-toolbar">
          <span class="dv-spacer" />
          <button class="rc-icon-btn" data-testid="data-refresh" type="button" title="刷新" aria-label="刷新" @click="panelRef?.refresh()">
            <el-icon><Refresh /></el-icon>
          </button>
          <button v-if="canWrite" class="rc-btn" data-testid="data-add" type="button" @click="openAdd">新增数据</button>
          <el-dropdown trigger="click">
            <button class="rc-btn" data-testid="data-export" type="button">导出<el-icon class="et-caret"><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="onExport">导出 Excel</el-dropdown-item>
                <el-dropdown-item @click="onDistinctSource">查看去重源 ID</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown v-if="canWrite && isTestTable" trigger="click">
            <button class="rc-btn" data-testid="data-delete" type="button">删除数据<el-icon class="et-caret"><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :disabled="!selectedRowKeys.length" @click="onDeleteSelected">删除选中的数据</el-dropdown-item>
                <el-dropdown-item divided disabled>按时间删除…</el-dropdown-item>
                <el-dropdown-item @click="onDeleteByRange(0, 'source')">删除该源-当日数据</el-dropdown-item>
                <el-dropdown-item @click="onDeleteByRange(1, 'source')">删除该源-所有数据</el-dropdown-item>
                <el-dropdown-item @click="onDeleteByIds">填入 IDs-删除</el-dropdown-item>
                <el-dropdown-item divided disabled>表操作</el-dropdown-item>
                <el-dropdown-item @click="onMarkFormal">设为正式表</el-dropdown-item>
                <el-dropdown-item @click="onDeleteByRange(0, 'all')">清空表数据【当日】</el-dropdown-item>
                <el-dropdown-item @click="onDeleteByRange(1, 'all')">清空表数据【全量】</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click">
            <button class="rc-btn" data-testid="data-tools" type="button">工具<el-icon class="et-caret"><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="onToolCommand('steps')">展示步骤</el-dropdown-item>
                <el-dropdown-item @click="onShowApi">取数 API</el-dropdown-item>
                <el-dropdown-item @click="onToolCommand('dataset')">指标数据集</el-dropdown-item>
                <el-dropdown-item @click="onToolCommand('generate-source')">提取数据生成源</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click">
            <button class="rc-btn" data-testid="data-more" type="button">更多<el-icon class="et-caret"><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="onMoreCommand('summary')">查看统计</el-dropdown-item>
                <el-dropdown-item @click="onMoreCommand('sql')">{{ showSql ? '隐藏查询条件/SQL' : '查看查询条件/SQL' }}</el-dropdown-item>
                <el-dropdown-item v-if="canWrite" divided @click="openMaintenance">数据维护</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div v-if="showSql" class="dv-sql-tip">{{ sqlPreview }}</div>
        <!-- 选中批量条 -->
        <div v-if="canWrite && selectedRowKeys.length" class="dv-batch">
          <span class="dv-batch-count">已选择 <b>{{ selectedRowKeys.length }}</b> 项</span>
          <button class="rc-btn primary" type="button" @click="onNextStepSelected">发后续任务</button>
          <el-dropdown trigger="click">
            <span class="dv-link">更多批量操作<el-icon class="et-caret"><ArrowDown /></el-icon></span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item :disabled="!canSendAll" @click="onNextStepAll">发全部后续(当前条件下所有)</el-dropdown-item>
                <el-dropdown-item @click="onNextStepPage">发本页任务</el-dropdown-item>
                <el-dropdown-item divided @click="openYellowPanel">发大量后续...</el-dropdown-item>
                <el-dropdown-item v-if="isTestTable" divided @click="onDeleteSelected">删除选中的数据</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span class="dv-spacer" />
          <span class="dv-link" @click="selectedRowKeys = []">取消选择</span>
        </div>

        <!-- 发大量后续黄色面板 -->
        <div v-if="yellowOpen" class="dv-yellow">
          <div class="dv-yellow-row">
            <label>从该ID起<el-input v-model="yStart" style="width: 100px" /></label>
            <label>至该ID止<el-input v-model="yEnd" style="width: 100px" /></label>
            <label>发送数量(1-1W条)<el-input v-model="ySize" style="width: 100px" /></label>
            <label>状态过滤<el-input v-model="yState1" placeholder="表中state列" style="width: 110px" /></label>
            <label>后续标识<el-input v-model="yNextFlag" placeholder="-1未抓后续，1已抓" style="width: 130px" /></label>
            <label>自定SQL条件<el-input v-model="yCond" placeholder="如 K1 IS NULL" style="width: 160px" /></label>
            <button class="rc-btn danger" type="button" @click="onSendYellowBatch">批量发后续</button>
          </div>
          <!-- 参考API（方案 §1.4-2）：展示 nextStep2 拼接 URL 供运营核对 -->
          <div class="dv-yellow-api">参考API: POST /api/v1/source/nextStep2 (AES, timeout 180s)</div>
        </div>
      </template>

      <template #columns-before>
        <el-table-column prop="dataId" label="ENTRY_ID" width="105" fixed="left" sortable="custom">
          <template #default="{ row }"><a class="dv-a" @click="openDetail(row)">{{ row.dataId }}</a></template>
        </el-table-column>
        <el-table-column prop="sourceId" label="源" width="100" sortable="custom">
          <template #default="{ row }">
            <a v-if="row.sourceId" class="dv-a" @click="openSourceDetailForRow(row.sourceId)">{{ row.sourceId }}</a>
            <span v-else>—</span>
          </template>
        </el-table-column>
      </template>

      <template #columns-after>
        <el-table-column prop="updateDt" label="更新" width="90" sortable="custom">
          <template #default="{ row }"><span :title="formatDateTime(row.updateDt)">{{ timeAgo(row.updateDt) }}</span></template>
        </el-table-column>
        <el-table-column prop="createDt" label="生成" width="90" sortable="custom">
          <template #default="{ row }"><span :title="formatDateTime(row.createDt)">{{ timeAgo(row.createDt) }}</span></template>
        </el-table-column>
        <el-table-column label="任务" width="100">
          <template #default="{ row }">
            <a v-if="row.detailId" class="dv-a" @click="openTaskInstByDetail(row)">{{ row.detailId }}</a>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="nextFlag" label="后续" width="70">
          <template #default="{ row }">{{ row.nextFlag ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="父ID" width="90">
          <template #default="{ row }">
            <a v-if="row.categoryId && row.parentId && row.parentId !== '0'" class="dv-a" @click="openParentDetail(row)">{{ row.parentId }}</a>
            <span v-else>{{ row.parentId || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="原始" width="70">
          <template #default="{ row }">
            <a v-if="row.k0" class="dv-a" @click="openRawJson(row)">查看</a>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <!-- 占位列：所有其它列都是定宽，列少/窗口宽时总宽度撑不满容器，"操作"这个 fixed="right" 列
             会贴着容器右边缘悬空，跟前一列之间露出空白缝隙。这列不设宽度，Element Plus 会把它当
             弹性列吸收剩余空间，保证"操作"前面永远有内容顶着，不留缝（参照 TaskInstDialog.vue 里
             "任务名"不设宽度的同款做法）。 -->
        <el-table-column />
        <el-table-column v-if="canWrite" label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <span class="dv-row-actions">
              <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
              <el-dropdown trigger="click">
                <el-button link type="primary" size="small">更多<el-icon class="et-caret"><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click="openTaskInstByRow(row)">查后续任务实例</el-dropdown-item>
                    <el-dropdown-item v-if="isTestTable" @click="openEdit(row)">手动修改</el-dropdown-item>
                    <el-dropdown-item v-if="isTestTable" @click="onDeleteOne(row)">删除单条【无法恢复】</el-dropdown-item>
                    <el-dropdown-item v-if="row.k0" :divided="isTestTable" @click="onReSave(row)">重新保存原始JSON</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </template>
        </el-table-column>
      </template>
    </DataQueryPanel>

    <div v-if="apiOpen" class="dv-api-panel">
      <div class="dv-api-panel-title">取数 API <span>当前条件预览</span></div>
      <p class="dv-dialog-hint">可将当前表、源和筛选条件交给接口调用方；鉴权仍沿用当前登录会话。</p>
      <pre class="dv-api-preview">{{ apiPreview }}</pre>
      <button class="rc-btn" type="button" @click="apiOpen = false">关闭</button>
    </div>

    <!-- 数据详情抽屉（只读） -->
    <el-drawer v-model="detail.visible" title="数据表详情" size="480px">
      <template v-if="detail.data">
        <dl class="rc-kv">
          <template v-for="item in detail.data.showItems" :key="item.itemId ?? item.columnName">
            <dt>{{ item.itemName || item.columnName }}</dt>
            <dd>{{ item.value ?? '—' }}</dd>
          </template>
        </dl>
        <template v-if="detail.data.subs?.length">
          <div class="dv-section">子列表</div>
          <div v-for="sub in detail.data.subs" :key="sub.dataId" class="dv-sub-row">{{ sub.dataId }} · {{ sub.sourceId }}</div>
        </template>
      </template>
    </el-drawer>

    <!-- 手动添加 / 手动修改 -->
    <RowEditDialog
      v-model="editor.visible"
      :table-id="tableId"
      :table-meta="tableMeta"
      :mode="editor.mode"
      :row="editor.row"
      :first-row="panelRows[0] ?? null"
    />

    <!-- 统计（方案 §1.6-4） -->
    <SummaryDrawer v-model="summaryOpen" :table-meta="tableMeta" :build-query="buildQuery" />

    <DataMaintenanceDrawer
      v-model="maintenanceOpen"
      :table-id="tableId"
      :table-name="tableMeta?.tableName"
      :source-id="sourceId"
      :selected-count="selectedRowKeys.length"
      :is-test-table="isTestTable"
      :can-clear-parent="canWrite && !!sourceId && selectedRowKeys.length > 0"
      @action="handleMaintenanceAction"
    />

    <!-- 展示步骤（方案 §1.6-5，简化列表版；见 §4.1 偏离决定） -->
    <StepDrawer
      v-model="stepOpen"
      :source-id="sourceId"
      :current-table-name="tableMeta?.tableName"
      @select-table="onStepSelectTable"
    />

    <!-- 任务实例弹窗（方案 §1.6-5） -->
    <TaskInstDialog
      v-model="taskInst.visible"
      :source-id="taskInst.sourceId"
      :parent-id="taskInst.parentId"
      :task-id="taskInst.taskId"
      :can-write="canWrite"
    />

    <!-- 表结构详情 / 源详情（方案 §1.3-1/§1.3-2） -->
    <TableDetailDialog v-model="tableDetailOpen" :table-meta="tableMeta" />
    <SourceDetailDrawer v-model="sourceDetailOpen" :source-id="sourceDetailTargetId" />

    <!-- 加载更多数据表 / 更多源（方案 §1.3-1/§1.3-2） -->
    <MoreTablesDialog v-model="moreTablesOpen" @picked="onTablePicked" />
    <MoreSourcesDialog v-model="moreSourcesOpen" @picked="onSourcePicked" />
  </div>
</template>

<style scoped>
.dv-page {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.dv-result-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 4px 16px;
  border-top: 1px solid var(--rc-border-soft);
  border-bottom: 1px solid var(--rc-border-soft);
  background: #fff;
}
.rc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid #d5e2f2;
  border-radius: 7px;
  background: #fff;
  color: var(--rc-text-2);
  cursor: pointer;
}
.rc-icon-btn:hover {
  border-color: #bfdbfe;
  background: var(--rc-primary-bg);
  color: var(--rc-primary-ink);
}
.dv-spacer {
  flex: 1;
}
.dv-quick-label {
  color: var(--rc-muted);
  font-size: 12px;
  white-space: nowrap;
}
.dv-quick-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.dv-quick-btn:hover {
  text-decoration: underline;
}
.dv-link {
  display: inline-flex;
  align-items: center;
  color: var(--rc-text-2);
  font-size: 13px;
  cursor: pointer;
}
.dv-link:hover {
  color: var(--rc-primary-ink);
}
.et-caret {
  margin-left: 4px;
  font-size: 12px;
}
.dv-sql-tip {
  padding: 8px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
  color: var(--rc-muted);
  font-size: 12px;
  font-family: var(--rc-mono, monospace);
  background: #f8fafc;
}
.dv-dialog-hint {
  margin: 0 0 10px;
  color: var(--rc-muted);
  font-size: 12px;
}
.dv-api-panel {
  display: grid;
  gap: 8px;
  margin: 8px 16px;
  padding: 12px;
  border: 1px solid #bfdbfe;
  border-radius: var(--rc-radius-sm);
  background: #f8fbff;
}
.dv-api-panel-title {
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.dv-api-panel-title span {
  margin-left: 8px;
  color: var(--rc-muted);
  font-size: 11px;
  font-weight: 400;
}
.dv-api-preview {
  max-height: 260px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid var(--rc-border-soft);
  border-radius: var(--rc-radius-sm);
  background: #f8fafc;
  color: var(--rc-text-2);
  font: 12px/1.6 var(--rc-mono, monospace);
  white-space: pre-wrap;
  word-break: break-word;
}
.dv-batch {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--rc-primary-bg);
  border-bottom: 1px solid #bfdbfe;
}
.dv-batch-count {
  font-size: 13px;
  color: var(--rc-text-2);
}
.dv-batch-count b {
  color: var(--rc-primary-ink);
}
.dv-yellow {
  background: #fffbe6;
  border: 1px solid #f2d675;
  border-radius: var(--rc-radius-sm);
  margin: 10px 16px;
  padding: 10px 12px;
}
.dv-yellow-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: flex-end;
}
.dv-yellow-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--rc-text-2);
}
.dv-yellow-api {
  margin-top: 6px;
  font-size: 11px;
  color: var(--rc-muted);
  font-family: var(--rc-mono, monospace);
}
.dv-a {
  color: var(--rc-primary-ink);
  cursor: pointer;
}
.dv-a:hover {
  text-decoration: underline;
}
.dv-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dv-section {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--rc-text);
}
.dv-sub-row {
  padding: 6px 0;
  border-bottom: 1px solid var(--rc-border-soft);
  font-size: 12px;
  color: var(--rc-text-2);
}
</style>
