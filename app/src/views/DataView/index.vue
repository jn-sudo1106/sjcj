<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, QuestionFilled, Plus } from '@element-plus/icons-vue'
import {
  dataApi, sourceApi, entryApi,
  type DataRow, type DataTableMeta, type EntryTypeGroup, type EntryDetail, type RowQuery, type SourceOption,
  type EntryType, type Source,
} from '../../api'
import { useAuthStore } from '../../stores/auth'
import RowEditDialog from './RowEditDialog.vue'
import SummaryDrawer from './SummaryDrawer.vue'
import TaskInstDialog from './TaskInstDialog.vue'
import StepDrawer from './StepDrawer.vue'
import TableDetailDialog from './TableDetailDialog.vue'
import SourceDetailDrawer from './SourceDetailDrawer.vue'
import MoreTablesDialog from './MoreTablesDialog.vue'
import MoreSourcesDialog from './MoreSourcesDialog.vue'

// 单表数据查看迁移方案（E 包）+ 数据表页_UI重写设计_2026-07-30：
// 本文件覆盖检索区/工具条/批量条/动态列表格/分页/数据详情抽屉/手动添加/手动修改/统计/
// 步骤展示（简化列表，无 DAG 图，见方案 §4.1 偏离决定）/任务实例弹窗/
// 表结构详情·源详情（? 按钮）/加载更多数据表·更多源（方案 §1.3 补齐）。
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const route = useRoute()

const AUTO1_KEY = 'auto1'
const STATE_OPTIONS = [
  { value: 'C', label: 'C 初始' },
  { value: 'AC', label: 'AC 已审核' },
  { value: 'NF', label: 'NF 404' },
  { value: 'E', label: 'E 出错' },
]
interface CommonQuery { label: string; sql: string; clearSource?: boolean }
const COMMON_QUERIES: CommonQuery[] = [
  { label: '日新增', sql: 'CREATE_DT > CURDATE()' },
  { label: '日更新', sql: 'UPDATE_DT > CURDATE()' },
  { label: '近2日新增', sql: 'CREATE_DT > DATE_SUB(CURDATE(), INTERVAL 1 DAY)' },
  { label: '近2日更新', sql: 'UPDATE_DT > DATE_SUB(CURDATE(), INTERVAL 1 DAY)' },
  { label: '日新增(所有源)', sql: 'CREATE_DT > CURDATE()', clearSource: true },
  { label: '日更新(所有源)', sql: 'UPDATE_DT > CURDATE()', clearSource: true },
]

// ---- 选表 / 选源 ----
const group = ref<EntryTypeGroup>({ list1: [], list2: [], list3: [] })
const tableId = ref('')
const tableMeta = ref<DataTableMeta | null>(null)
const sourceOptions = ref<SourceOption[]>([])
const sourceId = ref('')
const lastSourceId = ref('') // 常用查询"所有源"变体清空源后，用于恢复

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
function openSourceDetail() {
  if (!sourceId.value) {
    ElMessage.error('请先选择源ID')
    return
  }
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

// ---- 检索字段 ----
const dataId = ref('')
const parentId = ref('')
const stateArray = ref<string[]>([])
const nextFlag = ref('')
const minId = ref('')
const maxId = ref('')
const sql = ref('')
const sortField = ref('')
const sortOrder = ref<'ascend' | 'descend' | ''>('')
const advancedOpen = ref(false)

const sqlHistory = ref<string[]>(readAuto1())
function readAuto1(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTO1_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
function saveAuto1(value: string) {
  if (!value.trim()) return
  const list = [value, ...sqlHistory.value.filter((v) => v !== value)].slice(0, 20)
  sqlHistory.value = list
  localStorage.setItem(AUTO1_KEY, JSON.stringify(list))
}
function querySqlHistory(queryString: string, cb: (results: { value: string }[]) => void) {
  cb(sqlHistory.value.filter((v) => v.includes(queryString)).map((v) => ({ value: v })))
}

// ---- 结果 / 分页 / 选择 ----
const rows = ref<DataRow[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const selectedRowKeys = ref<string[]>([])

const allChecked = computed(() => rows.value.length > 0 && selectedRowKeys.value.length === rows.value.length)
const pageIndeterminate = computed(() => selectedRowKeys.value.length > 0 && selectedRowKeys.value.length < rows.value.length)
function togglePage(val: boolean) {
  selectedRowKeys.value = val ? rows.value.map((r) => r.dataId) : []
}
function toggleSelected(id: string, val: boolean) {
  selectedRowKeys.value = val ? [...selectedRowKeys.value, id] : selectedRowKeys.value.filter((k) => k !== id)
}

function buildQuery(): RowQuery {
  return {
    tableId: tableId.value,
    sourceId: sourceId.value || undefined,
    dataId: dataId.value.trim() || undefined,
    parentId: parentId.value.trim() || undefined,
    state: stateArray.value.join(',') || undefined,
    sql: sql.value.trim() || undefined,
    nextFlag: nextFlag.value || undefined,
    min: minId.value.trim() || undefined,
    max: maxId.value.trim() || undefined,
    sortField: sortField.value || undefined,
    sortOrder: sortOrder.value || undefined,
    page: page.value,
    size: size.value,
  }
}

async function loadRows() {
  if (!tableId.value) return
  loading.value = true
  try {
    const result = await dataApi.rowQueryPaged(buildQuery())
    rows.value = result.list
    total.value = result.total
    selectedRowKeys.value = []
  } catch (error) {
    ElMessage.error(`查询失败:${String(error instanceof Error ? error.message : error).slice(0, 100)}`)
  } finally {
    loading.value = false
  }
}

// canSendAll（方案 §1.4-2）：total ≤ 500000 且源/状态/SQL/nextFlag 条件自上次查询未变动
// nextStepBatch 实际使用 sourceId/state/sql/nextFlag，签名只含这些字段；minId/maxId 不参与 batch 故不纳入
const lastSignature = ref('')
function querySignature() {
  return JSON.stringify([sourceId.value, stateArray.value.join(','), sql.value, nextFlag.value])
}
const canSendAll = computed(() => total.value <= 500000 && querySignature() === lastSignature.value)

function onSearch() {
  if (sql.value.trim()) saveAuto1(sql.value.trim())
  page.value = 1
  lastSignature.value = querySignature()
  void loadRows()
}
function onRefresh() {
  void loadRows()
}
async function onTableChange() {
  await loadTableMeta()
  onSearch()
}
async function onSourceChange() {
  await loadGroup()
  onSearch()
}
function applyCommonQuery(q: CommonQuery) {
  sql.value = q.sql
  if (q.clearSource) {
    lastSourceId.value = sourceId.value
    sourceId.value = ''
  } else if (lastSourceId.value) {
    sourceId.value = lastSourceId.value
  }
  onSearch()
}
function removeStateChip(value: string) {
  stateArray.value = stateArray.value.filter((v) => v !== value)
  onSearch()
}
function clearNextFlag() { nextFlag.value = ''; onSearch() }
function clearParentId() { parentId.value = ''; onSearch() }
function clearRange() { minId.value = ''; maxId.value = ''; onSearch() }

const chips = computed(() => {
  const list: { key: string; label: string; clear: () => void }[] = []
  for (const s of stateArray.value) {
    const opt = STATE_OPTIONS.find((o) => o.value === s)
    list.push({ key: `state-${s}`, label: opt?.label ?? s, clear: () => removeStateChip(s) })
  }
  if (nextFlag.value) list.push({ key: 'nextFlag', label: `后续标识：${nextFlag.value}`, clear: clearNextFlag })
  if (parentId.value) list.push({ key: 'parentId', label: `父ID：${parentId.value}`, clear: clearParentId })
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
  onSearch()
}
// 动态列排序仅当 total ≤ 500000 时开放（方案 §1.5-5）
const allSort = computed(() => total.value <= 500000)

function onPageChange() { void loadRows() }
function onSizeChange() { page.value = 1; void loadRows() }

// ---- 展示 SQL（方案 §1.4-6，本地拼接，不发请求） ----
const showSql = ref(false)
const sqlPreview = computed(() => {
  let s = `select * from ${tableMeta.value?.tableName ?? ''} where 1=1`
  if (dataId.value.trim()) s += ` and entry_id in (${dataId.value.trim()})`
  if (sourceId.value) s += ` and source_id=${sourceId.value}`
  if (stateArray.value.length) s += ` and state in (${stateArray.value.map((v) => `'${v}'`).join(',')})`
  if (sql.value.trim()) s += ` and ${sql.value.trim()}`
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
    await loadRows()
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
function onDeleteByRange(all: 0 | 1, scope: 'source' | 'all' = 'source') {
  // scope='source' 仅删当前源数据；scope='all' 清空整表（不带 sourceId 过滤）
  const sid = scope === 'source' ? (sourceId.value || undefined) : undefined
  const scopeLabel = scope === 'source' ? (sourceId.value || '不限') : '全部源'
  const scopeText = scope === 'source' ? '删除该源' : '清空表数据'
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

// ---- 工具▾（方案 §1.4-3；展示步骤/生成源/取数API/指标数据集依赖确认后迁或复杂组件，不做） ----
async function onDistinctSource() {
  try {
    const ids = await dataApi.distinctSource(buildQuery())
    await ElMessageBox.alert(ids.join(',') || '（无）', '展示当前条件下所有的源:')
  } catch (error) {
    ElMessage.error(`加载失败:${error instanceof Error ? error.message : String(error)}`)
  }
}
function onClearParent() {
  void confirmDanger(
    '提示',
    '确认清除父表后续标识?',
    () => dataApi.clearParent(buildQuery(), selectedRowKeys.value),
    '设置成功',
  )
}

// ---- 统计（方案 §1.4-5，read 也可见） ----
const summaryOpen = ref(false)

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
  const body = `[实验性] 批量发送当前条件下全部后续任务?  条件: [ {源:${sourceId.value || '不限'} && 状态:${stateArray.value.join(',') || '不限'} && ...} ]`
  ElMessageBox.confirm(body, '提示', { type: 'warning' }).then(async () => {
    try {
      const r = await dataApi.nextStepBatch({
        tableId: tableId.value, sourceId: sourceId.value || undefined, state: stateArray.value.join(',') || undefined,
        size: 500000, start: 0, nextFlag: nextFlag.value || undefined, cond: sql.value || undefined,
      })
      ElMessage.success(`发送成功:${r.message ?? ''}`)
    } catch (err) {
      ElMessage.error(`发送失败,原因: [${err instanceof Error ? err.message : String(err)}]`)
    }
  }).catch(() => {})
}
async function onNextStepPage() {
  const ids = rows.value.map((r) => r.dataId)
  if (!ids.length) {
    ElMessage.warning('本页无数据')
    return
  }
  try {
    const r = await dataApi.nextStep(sourceId.value, tableId.value, ids)
    ElMessage.success(`发送成功:${r.message ?? ''}, 将自动跳转到下一页`)
    page.value += 1
    await loadRows()
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
  if (!yEnd.value && rows.value.length) {
    yEnd.value = String(Math.max(...rows.value.map((r) => Number(r.dataId) || 0)))
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

// ---- 动态列（方案 §1.5-3：required 前 20 个，宽度 120×0.9／140×0.9） ----
const dynamicColumns = computed(() => (tableMeta.value?.fields ?? []).filter((f) => f.required).slice(0, 20))
function columnWidth(desc: string) {
  const base = /区间|时间|日期|周期/.test(desc) ? 140 : 120
  return Math.round(base * 0.9)
}
function cellKind(prop: string, desc: string, value: unknown): 'link' | 'minio' | 'text' {
  const v = String(value ?? '')
  if (!v) return 'text'
  if (/^https?:/.test(v)) return 'link'
  if ((prop.includes('path') || prop.includes('minio') || /地址|路径|图片/.test(desc)) && v.startsWith('/')) return 'minio'
  return 'text'
}
function minioUrl(value: string) {
  // OSS 端口走环境变量，默认 9102（演示环境）
  const ossPort = import.meta.env.VITE_OSS_PORT || '9102'
  return `http://${location.hostname}:${ossPort}/api/oss/download?fileId=${encodeURIComponent(value)}`
}
function formatDateTime(value?: string) {
  return value ? value.slice(0, 16) : '—'
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
  onSearch()
})
</script>

<template>
  <div class="rc-card dv-page">
    <!-- 检索主行 -->
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
      <el-input v-model="dataId" clearable placeholder="请输入数据 ID" style="width: 160px" @keyup.enter="onSearch" />
      <button class="rc-btn primary" type="button" @click="onSearch">查询</button>
    </div>

    <!-- 筛选芯片行 -->
    <div class="rc-toolbar wrap">
      <el-tag v-for="c in chips" :key="c.key" closable size="small" effect="plain" @close="c.clear">{{ c.label }}</el-tag>
      <span class="dv-spacer" />
      <span class="dv-link" @click="advancedOpen = !advancedOpen">
        高级筛选<el-icon class="et-caret"><ArrowDown /></el-icon>
      </span>
      <el-divider direction="vertical" />
      <el-dropdown trigger="click" @command="applyCommonQuery">
        <span class="dv-link">常用查询<el-icon class="et-caret"><ArrowDown /></el-icon></span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="q in COMMON_QUERIES" :key="q.label" :command="q">{{ q.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 高级筛选折叠面板 -->
    <div v-if="advancedOpen" class="rc-toolbar wrap">
      <el-input v-model="parentId" clearable placeholder="父 ID" style="width: 120px" @keyup.enter="onSearch" />
      <el-checkbox-group v-model="stateArray" @change="onSearch">
        <el-checkbox-button v-for="o in STATE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox-button>
      </el-checkbox-group>
      <el-input v-model="nextFlag" clearable placeholder="后续标识（如 -1）" style="width: 150px" @keyup.enter="onSearch" />
      <span class="dv-range">
        <el-input v-model="minId" placeholder="起始 ID" style="width: 100px" @keyup.enter="onSearch" />
        <span class="dv-range-sep">－</span>
        <el-input v-model="maxId" placeholder="终止 ID" style="width: 100px" @keyup.enter="onSearch" />
      </span>
      <el-autocomplete
        v-model="sql"
        :fetch-suggestions="querySqlHistory"
        clearable
        placeholder="SQL 条件，如 CREATE_DT > CURDATE()"
        style="width: 320px"
        @keyup.enter="onSearch"
      />
    </div>

    <!-- 工具条 -->
    <div class="rc-toolbar wrap">
      <button class="rc-btn" type="button" @click="onRefresh">刷新</button>
      <button class="rc-btn" type="button" @click="showSql = !showSql">展示SQL</button>
      <button class="rc-btn" type="button" @click="onExport">导出EXCEL</button>
      <button class="rc-btn" type="button" @click="summaryOpen = true">统计</button>
      <template v-if="canWrite">
        <button class="rc-btn" type="button" @click="openAdd">手动添加</button>
        <el-dropdown v-if="isTestTable" trigger="click">
          <button class="rc-btn danger" type="button">删除数据<el-icon class="et-caret"><ArrowDown /></el-icon></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :disabled="!selectedRowKeys.length" @click="onDeleteSelected">删除选中的数据</el-dropdown-item>
              <el-dropdown-item divided @click="onDeleteByRange(0, 'source')">删除该源-当日</el-dropdown-item>
              <el-dropdown-item @click="onDeleteByRange(1, 'source')">删除该源-所有</el-dropdown-item>
              <el-dropdown-item @click="onDeleteByIds">填入IDs-删除</el-dropdown-item>
              <el-dropdown-item divided @click="onMarkFormal">设为正式表</el-dropdown-item>
              <el-dropdown-item @click="onDeleteByRange(0, 'all')">清空表数据【当日】</el-dropdown-item>
              <el-dropdown-item @click="onDeleteByRange(1, 'all')">清空表数据【全量】</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click">
          <button class="rc-btn" type="button">工具<el-icon class="et-caret"><ArrowDown /></el-icon></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="onDistinctSource">提取去重后源 ID</el-dropdown-item>
              <el-dropdown-item @click="openStepDrawer">展示步骤</el-dropdown-item>
              <el-dropdown-item divided @click="onClearParent">A.清除-父表-后续标识</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
    </div>
    <div v-if="showSql" class="dv-sql-tip">{{ sqlPreview }}</div>

    <!-- 选中批量条 -->
    <div v-if="canWrite && selectedRowKeys.length" class="dv-batch">
      <el-checkbox :model-value="allChecked" :indeterminate="pageIndeterminate" @change="togglePage" />
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
    </div>

    <!-- 动态列表格 -->
    <div v-loading="loading" class="rc-table-scroll dv-table">
      <el-table :data="rows" style="width: 100%" show-overflow-tooltip @sort-change="onSortChange">
        <el-table-column v-if="canWrite" width="42" fixed="left">
          <template #header>
            <el-checkbox :model-value="allChecked" :indeterminate="pageIndeterminate" aria-label="选择本页" @change="togglePage" />
          </template>
          <template #default="{ row }">
            <el-checkbox
              :model-value="selectedRowKeys.includes(row.dataId)"
              :aria-label="`选择 ${row.dataId}`"
              @change="(val: boolean) => toggleSelected(row.dataId, val)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="dataId" label="ENTRY_ID" width="105" fixed="left" sortable="custom">
          <template #default="{ row }"><a class="dv-a" @click="openDetail(row)">{{ row.dataId }}</a></template>
        </el-table-column>
        <el-table-column prop="sourceId" label="源" width="100" sortable="custom">
          <template #default="{ row }">{{ row.sourceId }}</template>
        </el-table-column>
        <el-table-column
          v-for="f in dynamicColumns"
          :key="f.columnName"
          :prop="f.columnName"
          :label="`${f.desc}-${f.columnName}`"
          :width="columnWidth(f.desc)"
          :sortable="allSort ? 'custom' : false"
        >
          <template #default="{ row }">
            <template v-if="cellKind(f.prop, f.desc, row.values?.[f.columnName!]) === 'link'">
              <a class="dv-a" :href="String(row.values?.[f.columnName!])" target="_blank" rel="noopener">{{ row.values?.[f.columnName!] }}</a>
            </template>
            <template v-else-if="cellKind(f.prop, f.desc, row.values?.[f.columnName!]) === 'minio'">
              <a class="dv-a" :href="minioUrl(String(row.values?.[f.columnName!]))" target="_blank" rel="noopener">{{ row.values?.[f.columnName!] }}</a>
            </template>
            <span v-else>{{ row.values?.[f.columnName!] ?? '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="state" label="状态" width="70" sortable="custom">
          <template #default="{ row }">{{ row.state || '—' }}</template>
        </el-table-column>
        <el-table-column prop="updateDt" label="更新" width="90" sortable="custom">
          <template #default="{ row }">{{ formatDateTime(row.updateDt) }}</template>
        </el-table-column>
        <el-table-column prop="createDt" label="生成" width="90" sortable="custom">
          <template #default="{ row }">{{ formatDateTime(row.createDt) }}</template>
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
      </el-table>
    </div>
    <div class="dv-pager">
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
      :first-row="rows[0] ?? null"
    />

    <!-- 统计（方案 §1.6-4） -->
    <SummaryDrawer v-model="summaryOpen" :table-meta="tableMeta" :build-query="buildQuery" />

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
    <SourceDetailDrawer v-model="sourceDetailOpen" :source-id="sourceId" />

    <!-- 加载更多数据表 / 更多源（方案 §1.3-1/§1.3-2） -->
    <MoreTablesDialog v-model="moreTablesOpen" @picked="onTablePicked" />
    <MoreSourcesDialog v-model="moreSourcesOpen" @picked="onSourcePicked" />
  </div>
</template>

<style scoped>
.dv-page {
  display: flex;
  flex-direction: column;
}
.dv-spacer {
  flex: 1;
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
.dv-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dv-range-sep {
  color: var(--rc-faint);
}
.dv-sql-tip {
  padding: 8px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
  color: var(--rc-muted);
  font-size: 12px;
  font-family: var(--rc-mono, monospace);
  background: #f8fafc;
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
.dv-table {
  flex: 1;
}
/* 方案 §1.5-1：行高 40；配合 show-overflow-tooltip 单行截断，避免长文本撑高行高 */
.dv-table :deep(.el-table .cell) {
  white-space: nowrap;
}
.dv-table :deep(.el-table td.el-table__cell),
.dv-table :deep(.el-table th.el-table__cell) {
  padding: 8px 0;
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
.dv-pager {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid var(--rc-border-soft);
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
