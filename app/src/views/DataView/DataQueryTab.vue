<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, CopyDocument, QuestionFilled, Plus, Refresh } from '@element-plus/icons-vue'
import {
  dataApi, sourceApi, entryApi,
  type DataRow, type DataTableMeta, type EntryTypeGroup, type EntryDetail, type RowQuery, type SourceOption,
  type EntryType, type Source,
} from '../../api'
import { useAuthStore } from '../../stores/auth'
import DataQueryPanel, { type DataQueryColumn, type DataQueryFilter } from '@/components/DataQueryPanel.vue'
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import RowEditDialog from './RowEditDialog.vue'
import SummaryDrawer from '@/components/data/SummaryDrawer.vue'
import TaskInstDialog from './TaskInstDialog.vue'
import StepDrawer from './StepDrawer.vue'
import TableDetailDialog from './TableDetailDialog.vue'
import SourceDetailDrawer from './SourceDetailDrawer.vue'
import MoreTablesDialog from './MoreTablesDialog.vue'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import DataImportDialog from './DataImportDialog.vue'
import { backTraceSources } from '@/utils/data/backTraceSources'
import { unsupportedNextStepBatchFilters } from './batchGuards'
import { copyToClipboard } from '@/utils/clipboard'
import { extFromFieldHint, extFromName, ossPathWithExt } from '@/utils/ossFile'
import { isOssFilePath } from '@/views/FlowCanvas/result/rowDetailFields'
import FilePreview from '@/views/FlowCanvas/result/components/FilePreview.vue'

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

interface CommonQuery { label: string; sql?: string; allSources?: boolean }
const COMMON_QUERIES: CommonQuery[] = [
  { label: '所有源', allSources: true },
  { label: '日新增', sql: 'CREATE_DT > CURDATE()' },
  { label: '日更新', sql: 'UPDATE_DT > CURDATE()' },
  { label: '近2日新增', sql: 'CREATE_DT > DATE_SUB(CURDATE(), INTERVAL 1 DAY)' },
  { label: '近2日更新', sql: 'UPDATE_DT > DATE_SUB(CURDATE(), INTERVAL 1 DAY)' },
  { label: '日新增（所有源）', sql: 'CREATE_DT > CURDATE()', allSources: true },
  { label: '日更新（所有源）', sql: 'UPDATE_DT > CURDATE()', allSources: true },
]

// ---- 选表 / 选源 ----
const group = ref<EntryTypeGroup>({ list1: [], list2: [], list3: [] })
const tableId = ref('')
const tableMeta = ref<DataTableMeta | null>(null)
const sourceOptions = ref<SourceOption[]>([])
const sourceId = ref('')
const tableSelectRef = ref<{ blur: () => void } | null>(null)
const sourceSelectRef = ref<{ blur: () => void } | null>(null)

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
function openMoreTables() {
  tableSelectRef.value?.blur()
  moreTablesOpen.value = true
}
async function onTablePicked(entry: EntryType) {
  if (!group.value.list3.some((t) => t.tableId === entry.tableId)) {
    group.value = { ...group.value, list3: [entry, ...group.value.list3] }
  }
  tableId.value = entry.tableId
  await onTableChange()
}
const moreSourcesOpen = ref(false)
function openMoreSources() {
  sourceSelectRef.value?.blur()
  moreSourcesOpen.value = true
}
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
    panelFilter.value.state ?? '',
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

const router = useRouter()
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
  if (q.allSources) {
    sourceId.value = ''
    // DataQueryPanel 不会监听 sourceId 自动查询；先同步空源范围和表分组，
    // 再由下面的同一次 search 合并 SQL，避免组合快捷查询出现两次请求。
    await loadGroup()
    await nextTick()
  }
  panelRef.value?.search(q.sql ? { sql: q.sql } : undefined)
}
async function onCommonQuerySelect(label: string) {
  const query = COMMON_QUERIES.find((item) => item.label === label)
  if (query) await applyCommonQuery(query)
}

// ---- 展示 SQL（方案 §1.4-6，本地拼接，不发请求） ----
const showSql = ref(false)
const sqlPreview = computed(() => {
  let s = `select * from ${tableMeta.value?.tableName ?? ''} where 1=1`
  if (panelFilter.value.dataId) s += ` and entry_id in (${panelFilter.value.dataId})`
  if (panelFilter.value.parentId) s += ` and parent_id in (${panelFilter.value.parentId})`
  if (panelFilter.value.state) s += ` and STATE in (${panelFilter.value.state.split(',').map((item) => `'${item.trim()}'`).join(',')})`
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

// 按条件反查源。三代形态：
//   ① 0903 Y2-8 之前：把 ID 拼成逗号串 alert 出来（旧平台 1:1 迁移）——一串 ID 看完只能手动
//      去别处一个个查，等于把活推回给用户；
//   ② 0903 Y2-8：改成弹窗，列清单 + 「在源视图中打开」/「对这批源发任务」两条路；
//   ③ **0904 I01（本次）：弹窗退役，点一下直达源视图。** 会上原话「那你还不如把这个东西
//      直接放到那个源列表」「你直接反向你不是直接跑两步？」——中间那层没人要。
//
// 求命中源的算法在 `utils/data/backTraceSources.ts`。这里没有网站范围（数据查看页是全平台的），
// 走的是它的兜底分支：全表 distinctSource + 上限截断判定。
const backTracing = ref(false)
async function onDistinctSource() {
  if (backTracing.value) return
  const f = panelFilter.value as Record<string, unknown>
  const hasCondition = !!(f.sql || f.state || f.dataId || f.parentId)
  // 无条件 = 全部源（I01：「你不带条件就是查的所有的」），不必发请求。
  // **落到采集资产而不是源视图**：源视图锁死在单个网站内（0812 纠偏），而数据查看页是
  // 全平台的、没有网站锚点——`/canvas?view=source` 不带 siteId 会被路由兜底弹回 /collect，
  // 与其靠这个意外，不如直接写明目的地。采集资产就是"所有源"该去的地方。
  if (!hasCondition) {
    void router.push({ path: '/collect' })
    return
  }
  backTracing.value = true
  try {
    const { sourceIds } = await backTraceSources(buildQuery())
    if (!sourceIds.length) {
      ElMessage.info('当前条件没有命中任何源')
      return
    }
    void router.push({ path: '/canvas', query: { view: 'source', sourceIds: sourceIds.join(',') } })
  } catch (e) {
    ElMessage.error(`反查源失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    backTracing.value = false
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

// ---- 取数 API：还原旧平台的 ID 取数 API 描述 ----
const apiOpen = ref(false)
const apiIdFetchUrl = computed(() => {
  // 对照旧平台 EntryList2.handleShowApi：API 地址还要带源过滤，size 固定为 10。
  // appId/appKey 是旧接口的应用凭据，不使用当前登录 token 替代；部署时可通过
  // VITE_LEGACY_API_APP_ID / VITE_LEGACY_API_APP_KEY 覆盖默认演示值。
  const restBase = import.meta.env.VITE_LEGACY_REST_BASE || `${window.location.origin}/rest`
  const appId = import.meta.env.VITE_LEGACY_API_APP_ID || 'dev'
  const appKey = import.meta.env.VITE_LEGACY_API_APP_KEY || 'dev1'
  const params = [
    `appId=${encodeURIComponent(appId)}`,
    `appKey=${encodeURIComponent(appKey)}`,
    `type=${encodeURIComponent(tableId.value || '<tableId>')}`,
  ]
  if (sourceId.value) params.push(`sourceId=${encodeURIComponent(sourceId.value)}`)
  params.push(`startId=${encodeURIComponent(String(panelFilter.value.min || '0'))}`)
  if (panelFilter.value.max) params.push(`endId=${encodeURIComponent(String(panelFilter.value.max))}`)
  if (panelFilter.value.startTime || panelFilter.value.endTime) {
    const dateRange = `${panelFilter.value.startTime || 'EMPTY'} - ${panelFilter.value.endTime || 'EMPTY'}`
    params.push(`dataRange=${encodeURIComponent(dateRange)}`)
  }
  params.push('size=10')
  return `${restBase.replace(/\/$/, '')}/api/v1/data/entry?${params.join('&')}`
})

const apiParams = [
  { name: 'appId', type: '字符串', required: '是', limit: '-', description: '取数应用 ID，由部署环境提供' },
  { name: 'appKey', type: '字符串', required: '是', limit: '-', description: '取数应用密钥，由部署环境提供' },
  { name: 'type', type: '整型', required: '是', limit: '-', description: '实体类型 ID，对应数据表' },
  { name: 'sourceId', type: '长整型', required: '非', limit: '-', description: '限制某源采集的数据；查询全表时留空' },
  { name: 'size', type: '整型', required: '是', limit: '1-200', description: '每次获取数量' },
  { name: 'startId', type: '长整型', required: '必填', limit: '最小为0', description: '取数据的起始ID，如从头取，设成0' },
  { name: 'endId', type: '长整型', required: '非', limit: '-', description: '限制取数据的最大ID，与startId配合用来取一段数据' },
  { name: 'dataRange', type: '字符串', required: '非', limit: '时间范围', description: '时间上下限可单一为空，格式为“开始 - 结束”' },
]

const apiReturns = computed(() => [
  { code: 'data.lastId', name: '本次获取数据中最大ID', type: '长整型', description: '获取下一批数据时，startId 设为 lastId+1' },
  { code: 'data.size', name: '本次返回数量', type: '整型', description: '本次 list 实际返回的数据条数' },
  { code: 'data.list[].id', name: 'ID', type: '长整型', description: '数据主键' },
  { code: 'data.list[].state', name: '数据状态', type: '字符串', description: 'D 表示软删除' },
  { code: 'data.list[].sourceId', name: '源 ID', type: '长整型', description: '数据所属源' },
  { code: 'data.list[].parentId', name: '上层数据 ID', type: '长整型', description: '详情表与列表表中的关联字段（有则返回）' },
  { code: 'data.list[].seq', name: '序号', type: '长整型', description: '数据序号（有则返回）' },
  { code: 'data.list[].createDt', name: '生成时间', type: '字符串', description: '数据生成时间（有则返回）' },
  { code: 'data.list[].updateDt', name: '更新时间', type: '字符串', description: '数据更新时间（有则返回）' },
  ...(tableMeta.value?.fields ?? []).map((field) => ({
    code: `data.list[].${field.prop}`,
    name: `${field.desc}（${field.columnName || field.prop}）`,
    type: field.type || '-',
    description: '当前数据表字段，字段值随表结构返回',
  })),
])

async function copyApiUrl() {
  await copyToClipboard(apiIdFetchUrl.value, 'API 地址')
}

function copyText(val: string, label?: string) {
  void copyToClipboard(val, label)
}

function copyDetailJson() {
  if (!detail.data) return
  const payload: Record<string, unknown> = {
    ENTRY_ID: detail.data.row.dataId,
    SOURCE_ID: detail.data.row.sourceId,
    CREATE_DT: detail.data.row.createDt,
    UPDATE_DT: detail.data.row.updateDt,
  }
  for (const item of detail.data.showItems || []) {
    const key = item.columnName || item.itemName || item.itemId || 'item'
    payload[key] = item.value
  }
  void copyToClipboard(JSON.stringify(payload, null, 2), '全部字段 JSON')
}

function onShowApi() {
  apiOpen.value = true
}

// ---- 导入数据（旧 UploadData：entry/batch/uploadData） ----
// 旧页未选源时从当前结果首行回填 SOURCE_ID / CONFIG_ID；沿用该口径，避免导入目标与当前查询脱节。
const importOpen = ref(false)
const importSourceId = computed(() => sourceId.value || panelRows.value[0]?.sourceId || '')
const importConfigId = computed(() => panelRows.value[0]?.configId ?? '')
function openImport() {
  if (!tableId.value) {
    ElMessage.error('请先选择数据表')
    return
  }
  if (!importSourceId.value) {
    ElMessage.error('请先选择源，或先查询包含源 ID 的数据')
    return
  }
  importOpen.value = true
}

// ---- 统计（方案 §1.4-5，read 也可见） ----
const summaryOpen = ref(false)

function onMoreCommand(command: string) {
  // 延后一帧打开抽屉，避免下拉菜单的当前 click 冒泡到抽屉遮罩后立即触发关闭。
  if (command === 'summary') window.setTimeout(() => { summaryOpen.value = true }, 0)
  if (command === 'sql') showSql.value = !showSql.value
  if (command === 'steps') openStepDrawer()
  if (command === 'distinct-source') void onDistinctSource()
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
async function onNextStepSelected() {
  if (!selectedRowKeys.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  try {
    const r = await dataApi.nextStep(sourceId.value, tableId.value, selectedRowKeys.value)
    ElMessage.success(`发送成功:${r.message ?? ''}`)
    await panelRef.value?.refresh({ preserveSelection: true })
  } catch (err) {
    ElMessage.error(`发送失败,原因: [${err instanceof Error ? err.message : String(err)}]`)
  }
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
        state: panelFilter.value.state,
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

// ---- 文件预览（2026-09-28）：表格格子与详情抽屉里的 OSS 文件路径（.json / .txt / 图片等）点开就地预览，
// 与源数据视图（ResultView.onCellFile）同一个预览器、同一套补后缀口径。此前数据中心的路径格只认
// path/minio 字段、直连下载，TB_KAIPANLA「详情json」这类文件在这里看不了。
const filePreview = reactive({ visible: false, path: '', basePath: '', name: '', ext: '' })
function onCellFile(path: string, field?: { prop?: string; columnName?: string; desc?: string }) {
  const hintedExt = extFromFieldHint(field)
  const fullPath = ossPathWithExt(path, hintedExt)
  filePreview.path = fullPath
  filePreview.basePath = path
  filePreview.name = fullPath.split('/').pop() || ''
  // 路径自带后缀时以它为准，字段猜测只补没后缀的（与 ResultView 同口径）
  filePreview.ext = extFromName(path) || hintedExt
  filePreview.visible = true
}
/** 详情抽屉里的字段：showItems 只有列名，按列名回表结构取字段名 / 描述，再走同一套路径判据 */
function detailFileField(item: { columnName: string; itemName?: string; value: unknown }) {
  const value = item.value == null ? '' : String(item.value)
  if (!value) return null
  const meta = tableMeta.value?.fields?.find((f) => (f.columnName ?? f.prop) === item.columnName)
  const field = { prop: meta?.prop ?? item.columnName, columnName: item.columnName, desc: meta?.desc ?? item.itemName ?? '' }
  return isOssFilePath(field, value) ? field : null
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
  return value ? (value.length > 19 ? value.slice(0, 19) : value) : '—'
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
      <el-select ref="tableSelectRef" v-model="tableId" filterable placeholder="选择数据表" style="width: 220px" @change="onTableChange">
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
          <span class="dv-link" @click.stop="openMoreTables">
            <el-icon><Plus /></el-icon>加载更多数据表...
          </span>
        </template>
      </el-select>
      <button class="rc-btn dv-help-btn" type="button" title="表结构详情" @click="openTableDetail">
        <el-icon><QuestionFilled /></el-icon>
      </button>
      <el-select ref="sourceSelectRef" v-model="sourceId" filterable clearable placeholder="选择源" style="width: 200px" @change="onSourceChange">
        <el-option v-for="s in sourceOptions" :key="s.sourceId" :value="s.sourceId" :label="`${s.sourceId} ${s.name}`" />
        <template #footer>
          <span class="dv-link" @click.stop="openMoreSources">
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
      show-state
      :selectable="canWrite"
      default-sort-field="updateDt"
      default-sort-order="descend"
      v-model:selected-keys="selectedRowKeys"
      @query-change="onPanelQueryChange"
      @loaded="onPanelLoaded"
      @file-click="onCellFile"
    >
      <template #quick>
        <el-dropdown trigger="click" @command="onCommonQuerySelect">
          <button class="rc-btn dv-quick-btn" data-testid="data-quick" type="button">
            快捷查询 <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="q in COMMON_QUERIES" :key="q.label" :command="q.label">{{ q.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
      <template #toolbar>
        <!-- 结果工具条：按新增 / 导出 / 查看 / 删除与危险操作收敛，不保留泛化“工具”或重复“数据维护”。 -->
        <div class="dv-result-toolbar" data-testid="data-result-toolbar">
          <span class="dv-spacer" />
          <button class="rc-icon-btn" data-testid="data-refresh" type="button" title="刷新" aria-label="刷新" @click="panelRef?.refresh()">
            <el-icon><Refresh /></el-icon>
          </button>
          <button v-if="canWrite" class="rc-btn" data-testid="data-add" type="button" @click="openAdd">新增数据</button>
          <button v-if="canWrite" class="rc-btn" data-testid="data-import" type="button" @click="openImport">导入数据</button>
          <el-dropdown trigger="click">
            <button class="rc-btn" data-testid="data-export" type="button">导出<el-icon class="et-caret"><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="onExport">导出 Excel</el-dropdown-item>
                <el-dropdown-item @click="onShowApi">取数 API</el-dropdown-item>
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
          <!-- 0904 I02：反查源从「更多」下拉里放出来（原话「我到时候把放出来」）。
               它是数据视图通往源视图的唯一通路，藏在二级菜单里没人找得到。 -->
          <button
            class="rc-btn"
            type="button"
            data-testid="data-back-trace"
            :disabled="backTracing || !tableId"
            title="按当前查询条件找出这些数据来自哪些源，并直接在源视图中打开"
            @click="onDistinctSource"
          >{{ backTracing ? '反查中…' : '按条件查源 →' }}</button>
          <el-dropdown trigger="click">
            <button class="rc-btn" data-testid="data-more" type="button">更多<el-icon class="et-caret"><ArrowDown /></el-icon></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="onMoreCommand('summary')">查看统计</el-dropdown-item>
                <el-dropdown-item @click="onMoreCommand('sql')">{{ showSql ? '隐藏查询条件/SQL' : '查看查询条件/SQL' }}</el-dropdown-item>
                <el-dropdown-item @click="onMoreCommand('steps')">展示处理步骤</el-dropdown-item>
                <el-dropdown-item v-if="canWrite" divided :disabled="!sourceId || !selectedRowKeys.length" @click="onClearParent">
                  清除父表后续标识
                </el-dropdown-item>
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
            <!-- 0904 I04（Z4）：SQL 条件框从 220px 加宽。走查原话「太小了……人家已经选条件了，
                 他就不会看这个……你最好放过来放上去能看到全部就行了」。
                 右端还叠了两个图标按钮（最近条件 / 放大），220px 下几乎看不到条件正文。 -->
            <label>自定SQL条件<SqlConditionEditor v-model="yCond" v-slot="{ value, update }" :table-id="tableId" :fields="dynamicColumns" style="width: 360px"><el-input :model-value="value" @update:model-value="update" placeholder="如 K1 IS NULL" /></SqlConditionEditor></label>
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
        <el-table-column prop="updateDt" label="更新时间" width="165" sortable="custom">
          <template #default="{ row }">
            <span :title="row.updateDt ? `${row.updateDt} (${timeAgo(row.updateDt)})` : '—'">{{ formatDateTime(row.updateDt) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createDt" label="创建时间" width="165" sortable="custom">
          <template #default="{ row }">
            <span :title="row.createDt ? `${row.createDt} (${timeAgo(row.createDt)})` : '—'">{{ formatDateTime(row.createDt) }}</span>
          </template>
        </el-table-column>
      </template>

      <template #columns-after>
        <el-table-column prop="state" label="状态" width="84">
          <template #default="{ row }">
            <el-tag size="small" effect="light" :type="row.state === 'AC' ? 'success' : (row.state === 'E' || row.state === 'NF' ? 'danger' : 'info')">
              {{ row.state || '—' }}
            </el-tag>
          </template>
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

    <el-dialog v-model="apiOpen" class="dv-api-dialog" title="API描述" width="980px" destroy-on-close>
      <div class="dv-api-content" data-testid="data-api-dialog">
        <div class="dv-api-line">
          <span class="dv-api-dot" aria-hidden="true" />
          <span class="dv-api-label">[2] ID取数：</span>
          <code class="dv-api-url">{{ apiIdFetchUrl }}</code>
          <button class="rc-icon-btn dv-api-copy" type="button" title="复制 API 地址" aria-label="复制 API 地址" @click="copyApiUrl">
            <el-icon><CopyDocument /></el-icon>
          </button>
        </div>
        <div class="dv-api-line dv-api-section-title">
          <span class="dv-api-dot" aria-hidden="true" />
          <span>请求URL：</span>
        </div>
        <el-table :data="apiParams" border size="small" class="dv-api-table">
          <el-table-column prop="name" label="参数" width="150" />
          <el-table-column prop="type" label="类型" width="150" />
          <el-table-column prop="required" label="必填" width="120" />
          <el-table-column prop="limit" label="限制" width="150" />
          <el-table-column prop="description" label="说明" min-width="360" />
        </el-table>
        <div class="dv-api-line dv-api-section-title dv-api-return-title">
          <span class="dv-api-dot" aria-hidden="true" />
          <span>返回值说明：</span>
        </div>
        <el-table :data="apiReturns" border size="small" class="dv-api-table">
          <el-table-column prop="code" label="编码" width="180" />
          <el-table-column prop="name" label="名称" width="250" />
          <el-table-column prop="type" label="类型" width="180" />
          <el-table-column prop="description" label="说明" min-width="360" />
        </el-table>
        <p class="dv-api-note">返回值按真实接口的 data.lastId/data.size/data.list 结构展示；list 中还会返回当前数据表的全部业务字段。appId、appKey 使用部署环境配置，当前未配置时显示演示值。</p>
      </div>
      <template #footer>
        <button class="rc-btn" type="button" @click="apiOpen = false">关闭</button>
      </template>
    </el-dialog>


    <DataImportDialog
      v-model="importOpen"
      :table-id="tableId"
      :source-id="importSourceId"
      :initial-config-id="importConfigId"
      @uploaded="panelRef?.refresh()"
    />

    <!-- 数据详情抽屉（只读） -->
    <el-drawer v-model="detail.visible" title="数据表详情" size="480px">
      <template v-if="detail.data">
        <div class="dv-detail-toolbar">
          <button class="rc-btn sm" type="button" data-testid="detail-copy-json" @click="copyDetailJson">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
              />
            </svg>
            复制全部 JSON
          </button>
        </div>
        <dl class="rc-kv">
          <dt class="dv-detail-dt">
            <span>ENTRY_ID</span>
            <button
              v-if="detail.data.row.dataId"
              type="button"
              class="dv-copy-btn"
              title="复制 ENTRY_ID"
              data-testid="detail-copy-entry-id"
              @click="copyText(detail.data.row.dataId, 'ENTRY_ID')"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                  fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
                />
              </svg>
            </button>
          </dt>
          <dd>{{ detail.data.row.dataId || '—' }}</dd>
          <dt class="dv-detail-dt">
            <span>源 ID</span>
            <button
              v-if="detail.data.row.sourceId"
              type="button"
              class="dv-copy-btn"
              title="复制 源 ID"
              data-testid="detail-copy-source-id"
              @click="copyText(detail.data.row.sourceId, '源 ID')"
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                  fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
                />
              </svg>
            </button>
          </dt>
          <dd>{{ detail.data.row.sourceId || '—' }}</dd>
          <dt>创建时间</dt>
          <dd>{{ detail.data.row.createDt || '—' }}</dd>
          <dt>更新时间</dt>
          <dd>{{ detail.data.row.updateDt || '—' }}</dd>
          <template v-for="item in detail.data.showItems" :key="item.itemId ?? item.columnName">
            <dt class="dv-detail-dt">
              <span>{{ item.itemName || item.columnName }}</span>
              <button
                v-if="item.value !== undefined && item.value !== null && item.value !== ''"
                type="button"
                class="dv-copy-btn"
                :title="`复制 ${item.itemName || item.columnName}`"
                data-testid="detail-copy-item"
                @click="copyText(String(item.value), item.itemName || item.columnName)"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                    fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
                  />
                </svg>
              </button>
            </dt>
            <dd v-if="detailFileField(item)">
              <button
                type="button"
                class="dv-file"
                data-testid="detail-file"
                :title="`预览 ${item.value}`"
                @click="onCellFile(String(item.value), detailFileField(item) ?? undefined)"
              >📄 {{ item.value }}</button>
            </dd>
            <dd v-else>{{ item.value ?? '—' }}</dd>
          </template>
        </dl>
        <!-- 0904：原来这里只渲染一行 `dataId · sourceId`，子行自带的 24 个字段全丢了，
             也没有旧平台那个「本页展示子数据 3/6 条」的总数。换成与源画布数据视图同一个面板。 -->
        <!-- 0904 I06：「下级数据」面板已撤（Z0-1）。detail.data 仍在用（行 + showItems），
             只是不再罗列子行——下钻改走「带条件跳转 + 可返回」。 -->
      </template>
    </el-drawer>

    <!-- 文件预览：居中 dialog（看一眼就关的操作型短流程），与源数据视图同款 -->
    <el-dialog
      v-model="filePreview.visible"
      :title="filePreview.name || '文件预览'"
      width="92vw"
      top="4vh"
      :style="{ maxWidth: '1180px' }"
      append-to-body
    >
      <FilePreview
        :path="filePreview.path"
        :base-path="filePreview.basePath"
        :name="filePreview.name"
        :ext="filePreview.ext || extFromName(filePreview.name)"
        style="height: min(72vh, 720px)"
        data-testid="data-center-file-preview"
      />
    </el-dialog>

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
.dv-quick-btn {
  height: 32px;
  padding: 0 11px;
  font-size: 12px;
  font-weight: 600;
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
.dv-api-content {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.dv-api-dialog :deep(.el-dialog) {
  max-width: calc(100vw - 32px);
  border-radius: var(--rc-radius);
}
.dv-api-dialog :deep(.el-dialog__header) {
  margin-right: 0;
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.dv-api-dialog :deep(.el-dialog__title) {
  color: var(--rc-text);
  font-size: 15px;
  font-weight: 700;
}
.dv-api-dialog :deep(.el-dialog__body) {
  padding: 16px 20px;
}
.dv-api-dialog :deep(.el-dialog__footer) {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--rc-border-soft);
}
.dv-api-line {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
  color: var(--rc-text-2);
  font-size: 13px;
  line-height: 1.5;
}
.dv-api-dot {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rc-primary);
}
.dv-api-label {
  flex: 0 0 auto;
}
.dv-api-url {
  min-width: 0;
  overflow: hidden;
  color: var(--rc-primary-ink);
  font: 12px/1.5 var(--rc-mono, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dv-api-copy {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border: 0;
}
.dv-api-section-title {
  margin-top: 2px;
}
.dv-api-return-title {
  margin-top: 8px;
}
.dv-api-table {
  width: 100%;
}
.dv-api-table :deep(th.el-table__cell) {
  height: 40px;
  padding: 0;
  background: #f8fafc;
  color: var(--rc-text-2);
  font-size: 12px;
  font-weight: 700;
}
.dv-api-table :deep(td.el-table__cell) {
  padding: 7px 0;
  color: #334155;
}
.dv-api-table :deep(.cell) {
  color: inherit;
  font-size: 12px;
  line-height: 1.5;
  white-space: normal;
  word-break: break-word;
}
.dv-api-note {
  margin: 0;
  color: var(--rc-muted);
  font-size: 12px;
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
.dv-detail-toolbar {
  margin-bottom: 12px;
  display: flex;
  justify-content: flex-end;
}
.dv-detail-toolbar .rc-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dv-detail-dt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dv-copy-btn {
  border: 0;
  background: transparent;
  color: var(--rc-faint);
  padding: 1px 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.45;
  transition: opacity .12s, color .12s, background-color .12s;
}
.dv-detail-dt:hover .dv-copy-btn {
  opacity: 1;
}
.dv-file { max-width: 100%; padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font: inherit; text-align: left; cursor: pointer; word-break: break-all; }
.dv-file:hover { text-decoration: underline; }
.dv-copy-btn:hover {
  color: var(--rc-primary);
  background: var(--rc-primary-bg);
}
</style>
