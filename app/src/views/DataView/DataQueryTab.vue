<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
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
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import RowEditDialog from './RowEditDialog.vue'
import DataRowDetail from './DataRowDetail.vue'
import EntryRecordTable from './EntryRecordTable.vue'
import SummaryDrawer from '@/components/data/SummaryDrawer.vue'
import TaskInstDialog from './TaskInstDialog.vue'
import StepDrawer from './StepDrawer.vue'
import TableDetailDialog from './TableDetailDialog.vue'
import SourceDetailDrawer from './SourceDetailDrawer.vue'
import MoreTablesDialog from './MoreTablesDialog.vue'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import DataImportDialog from './DataImportDialog.vue'
import AddDataMenu from '@/components/ResultToolbar/AddDataMenu.vue'
import ExportMenu from '@/components/ResultToolbar/ExportMenu.vue'
import FullscreenToggle from '@/components/ResultToolbar/FullscreenToggle.vue'
import BrowseModeToggle, { type BrowseMode } from '@/components/ResultToolbar/BrowseModeToggle.vue'
import RailNodePicker from '@/views/FlowCanvas/result/components/RailNodePicker.vue'
import { buildHorizontalLayout, buildSourceSeed, effectiveInputTable, nodeOutputTable } from '@/views/FlowCanvas/canvas/flowModel'
import { downloadCsv } from '@/utils/format/csvExport'
import { resultRowsCsv } from '@/views/FlowCanvas/result/exportRows'
import { backTraceSources } from '@/utils/data/backTraceSources'
import { unsupportedNextStepBatchFilters } from './batchGuards'
import { extFromFieldHint, extFromName, ossPathWithExt } from '@/utils/ossFile'
import FilePreview from '@/views/FlowCanvas/result/components/FilePreview.vue'
import DataFetchApiDialog from '@/components/data/DataFetchApiDialog.vue'
import { currentBackendHost } from '@/api/client'
import { SYNC_PLATFORM_BACKEND_HOST } from '@/constants/backend'

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
const tableSourceIds = ref<string[]>([])
const sourceLoading = ref(false)
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
  // “更多源”是跨表按源搜索入口：选中源后切到该源的默认数据表。
  sourceId.value = source.sourceId
  await loadGroup()
  tableId.value = group.value.main || source.mainTable || group.value.list1[0]?.tableId || group.value.list3[0]?.tableId || ''
  await loadTableMeta()
  await loadSources()
  if (source.mainTable === tableId.value && !tableSourceIds.value.includes(source.sourceId)) {
    tableSourceIds.value = [source.sourceId, ...tableSourceIds.value]
  }
  sourceId.value = tableSourceIds.value.includes(source.sourceId) ? source.sourceId : ''
  if (sourceId.value && !sourceOptions.value.some((s) => s.sourceId === source.sourceId)) {
    sourceOptions.value = [{ sourceId: source.sourceId, name: source.name }, ...sourceOptions.value]
  }
  panelRef.value?.search()
}
const SOURCE_PREVIEW_SIZE = 50
const SOURCE_LOOKUP_CHUNK = 150
let sourceSearchTimer: ReturnType<typeof setTimeout> | undefined
const sourceSearchKeyword = ref('')
let sourceScopeRequest = 0
let sourceSearchRequest = 0

async function sourceOptionsForIds(ids: string[], name?: string): Promise<SourceOption[]> {
  if (!ids.length) return []
  const result = await sourceApi.sourcePaged({ sourceIds: ids, name, page: 1, size: ids.length })
  return result.list.map((source) => ({ sourceId: source.sourceId, name: source.name }))
}

async function loadSources() {
  const requestId = ++sourceScopeRequest
  ++sourceSearchRequest
  if (sourceSearchTimer) clearTimeout(sourceSearchTimer)
  const selectedTable = tableId.value
  sourceOptions.value = []
  tableSourceIds.value = []
  if (!selectedTable) return
  sourceLoading.value = true
  try {
    // sourceSame 按当前源的主表找同类源；数据中心必须按当前数据表中的 SOURCE_ID 定范围。
    const ids = [...new Set(await dataApi.distinctSource({ tableId: selectedTable, size: 20000 }))]
    if (requestId !== sourceScopeRequest || selectedTable !== tableId.value) return
    tableSourceIds.value = ids
    // 按步骤看时源就是上下文（节点是它的流程节点，输出表一定有它的数据），不能因为它不在这张表的源清单里
    // （清单取数上限 2 万，大表里本来就列不全）就被清掉，否则一切表，步骤列表跟着消失
    const keepSource = browseMode.value === 'step' && !!sourceId.value
    const clearedSource = !keepSource && !!sourceId.value && !ids.includes(sourceId.value)
    if (clearedSource) {
      sourceId.value = ''
      await loadGroup()
      if (requestId !== sourceScopeRequest || selectedTable !== tableId.value) return
    }
    const previewIds = ids.slice(0, SOURCE_PREVIEW_SIZE)
    if (sourceId.value && ids.includes(sourceId.value) && !previewIds.includes(sourceId.value)) {
      previewIds[previewIds.length - 1] = sourceId.value
    } else if (keepSource && !ids.includes(sourceId.value)) {
      previewIds.push(sourceId.value)
    }
    sourceOptions.value = await sourceOptionsForIds(previewIds)
    if (requestId === sourceScopeRequest && sourceSearchKeyword.value.trim()) {
      await searchSources(sourceSearchKeyword.value)
    }
  } catch (error) {
    if (requestId === sourceScopeRequest) ElMessage.warning(`加载当前表的源失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (requestId === sourceScopeRequest) sourceLoading.value = false
  }
}

async function searchSources(keyword: string) {
  const requestId = ++sourceSearchRequest
  const ids = tableSourceIds.value
  if (!keyword.trim()) {
    sourceLoading.value = true
    try {
      const options = await sourceOptionsForIds(ids.slice(0, SOURCE_PREVIEW_SIZE))
      if (requestId === sourceSearchRequest) sourceOptions.value = options
    } finally {
      if (requestId === sourceSearchRequest) sourceLoading.value = false
    }
    return
  }
  sourceLoading.value = true
  try {
    const query = keyword.trim()
    let options: SourceOption[] = []
    const idMatches = ids.filter((id) => id.includes(query))
    if (idMatches.length) {
      options = await sourceOptionsForIds(idMatches.slice(0, SOURCE_PREVIEW_SIZE))
    } else {
      // 名称检索由后端在表的源 ID 分块内执行，避免先全局分页再取交集漏掉本表的源。
      for (let i = 0; i < ids.length && options.length < SOURCE_PREVIEW_SIZE; i += SOURCE_LOOKUP_CHUNK * 4) {
        const batch = Array.from({ length: 4 }, (_, n) => ids.slice(i + n * SOURCE_LOOKUP_CHUNK, i + (n + 1) * SOURCE_LOOKUP_CHUNK)).filter((part) => part.length)
        const found = await Promise.all(batch.map((part) => sourceOptionsForIds(part, query)))
        if (requestId !== sourceSearchRequest) return
        options = [...options, ...found.flat()].slice(0, SOURCE_PREVIEW_SIZE)
      }
    }
    if (requestId === sourceSearchRequest) sourceOptions.value = options
  } catch (error) {
    if (requestId === sourceSearchRequest) ElMessage.warning(`搜索当前表的源失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (requestId === sourceSearchRequest) sourceLoading.value = false
  }
}
function onSourceSearch(keyword: string) {
  sourceSearchKeyword.value = keyword
  if (sourceSearchTimer) clearTimeout(sourceSearchTimer)
  sourceSearchTimer = setTimeout(() => void searchSources(keyword), 300)
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
// 「同步到其他环境」只在和同步服务同库的环境出现：别的环境带过去的表名，在同步服务的库里可能不存在，同名表搬的也是同步服务那边的数据
const syncSameBackend = currentBackendHost() === SYNC_PLATFORM_BACKEND_HOST
const selectedRowKeys = ref<string[]>([])

async function onTableChange() {
  await loadTableMeta()
  await loadSources()
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
// 「导出 ▾」里的当前页 CSV（1008-07，与源数据视图同一份 resultRowsCsv）：导出表格里这一页已查出的全部字段
const pageExportDisabled = computed(() => !tableId.value || !panelRows.value.length)
function onExportPage() {
  if (pageExportDisabled.value) return
  try {
    const name = `${tableMeta.value?.tableName || tableId.value}_第${panelFilter.value.page}页`.replace(/[\\/:*?"<>|]/g, '_')
    downloadCsv(`${name}.csv`, resultRowsCsv(panelRows.value, tableMeta.value))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  }
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

const apiSourceLabel = computed(() => {
  if (!sourceId.value) return '全部源'
  const source = sourceOptions.value.find((item) => item.sourceId === sourceId.value)
  return source ? `${source.name}（${source.sourceId}）` : sourceId.value
})

// 详情的两份内容体各管一个入口（刻意不同源，见模板注释）：
//   · DataRowDetail.vue     —— 抽屉用（点整行 / 操作列「详情」），自带复制 JSON / 导出字段工具栏
//   · EntryRecordTable.vue  —— ENTRY_ID 弹窗用，复刻旧平台 RecordDetailComm 的「列 / 值」平铺表
// 需要父组件配合的三件事留在本文件：openTaskInstByDetail（任务实例弹窗）、openRawJson（原始 JSON）、
// onCellFile（文件预览），由抽屉那份内容体 emit 回来。

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
  // 节点的输出表是表 ID（如 6200029），旧写法只按物理表名比，按 ID 给的节点永远「未找到匹配的表」
  const match = all.find((t) => t.tableId === outputTable || t.tableName === outputTable)
  if (!match) {
    ElMessage.warning(`未找到匹配的表:${outputTable}`)
    return
  }
  tableId.value = match.tableId
  await onTableChange()
}

// ---- 查看方式：按数据表 / 按步骤（1008-07，对齐源数据视图 ResultView 的「按步骤查看」）----
// 按步骤：选了源之后，用该源流程里的节点代替「数据表」下拉（RailNodePicker，与源 / 文件 / 任务视图同款）；
// 选节点 = 看这个节点的数据。节点输入表与输出表不同时，旁边的「输入 / 输出」可以切换看哪一张，
// 相同时合并成「输入·输出」（ResultView 的 M3-0C 定案）。没有输入输出表的节点不进候选。
// 没选源时没有流程可看，提示先选源。
// 流程图开合按钮打开「展示处理步骤」抽屉（那边点节点会切到它的输出表）。
interface StepNode { id: string; title: string; inputTable: string; outputTable: string }
const browseMode = ref<BrowseMode>('table')
const stepNodes = ref<StepNode[]>([])
const stepNodeId = ref('')
const stepScope = ref<'output' | 'input'>('output')
const stepLoading = ref(false)
let stepLoadSeq = 0
async function loadStepNodes() {
  const sid = sourceId.value
  const seq = ++stepLoadSeq
  stepNodes.value = []
  stepNodeId.value = ''
  if (browseMode.value !== 'step' || !sid) {
    stepLoading.value = false
    return
  }
  stepLoading.value = true
  try {
    const [detail, steps] = await Promise.all([sourceApi.sourceDetail(sid), sourceApi.sourceSteps(sid)])
    if (seq !== stepLoadSeq || !detail) return
    const seed = buildSourceSeed(detail, steps ?? [])
    const layout = buildHorizontalLayout(seed.main, seed.branches, seed.configs, seed.branchGroups, { includeTerminals: false })
    stepNodes.value = layout.nodes.flatMap((node) => {
      const cfg = seed.configs[node.id]
      if (!cfg) return []
      const outputTable = nodeOutputTable(cfg)
      const inputTable = effectiveInputTable(seed.main, seed.branches, seed.configs, node.id, seed.branchGroups)
      return outputTable || inputTable ? [{ id: node.id, title: cfg.title || node.id, inputTable, outputTable }] : []
    })
    syncStepFromTable()
  } catch (error) {
    if (seq === stepLoadSeq) ElMessage.warning(`步骤加载失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (seq === stepLoadSeq) stepLoading.value = false
  }
}
watch([browseMode, sourceId], () => void loadStepNodes())
const stepNode = computed(() => stepNodes.value.find((n) => n.id === stepNodeId.value))
const stepSameTable = computed(() => !!stepNode.value && !!stepNode.value.inputTable && stepNode.value.inputTable === stepNode.value.outputTable)
const stepScopeSwitchable = computed(() => !!stepNode.value && !!stepNode.value.inputTable && !!stepNode.value.outputTable && !stepSameTable.value)
const stepNodeOptions = computed(() => stepNodes.value.map((n) => ({ id: n.id, title: n.title })))
function stepTableOf(node: StepNode, scope: 'output' | 'input') {
  return scope === 'output' ? node.outputTable : node.inputTable
}
/** 表在别处被切走（下拉、抽屉、深链）后，让节点 / 范围跟上：当前选择仍对得上就不动，否则找第一个输出表（再找输入表）等于当前表的节点 */
function syncStepFromTable() {
  if (browseMode.value !== 'step') return
  const table = tableId.value
  const meta = tableMeta.value?.tableName
  const is = (t: string) => !!t && (t === table || t === meta)
  const cur = stepNode.value
  if (cur && is(stepTableOf(cur, stepScope.value))) return
  const byOutput = stepNodes.value.find((n) => is(n.outputTable))
  if (byOutput) { stepNodeId.value = byOutput.id; stepScope.value = 'output'; return }
  const byInput = stepNodes.value.find((n) => is(n.inputTable))
  if (byInput) { stepNodeId.value = byInput.id; stepScope.value = 'input'; return }
  stepNodeId.value = ''
}
watch([tableId, () => tableMeta.value?.tableName], syncStepFromTable)
async function onStepNodePicked(nodeId: string) {
  const node = stepNodes.value.find((n) => n.id === nodeId)
  if (!node) return
  stepNodeId.value = nodeId
  stepScope.value = node.outputTable ? 'output' : 'input'
  await onStepSelectTable(stepTableOf(node, stepScope.value))
}
async function onStepScope(scope: 'output' | 'input') {
  const node = stepNode.value
  if (!node || stepScope.value === scope) return
  stepScope.value = scope
  await onStepSelectTable(stepTableOf(node, scope))
}
/** 流程图开合：打开「展示处理步骤」抽屉；收起由抽屉自己关闭 */
function onStepRailToggle(open: boolean) {
  if (open) openStepDrawer()
  else stepOpen.value = false
}

// ---- 全屏（1008-07，与源数据视图同口径）：同一份 DOM 直接铺满视口，Esc 退出 ----
const fullscreen = ref(false)
function onFullscreenKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false
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
// ---- 数据详情的两个容器（只读，行 + showItems + subsCnt） ----
// 两个入口各挂各的容器与内容体：点整行 / 操作列「详情」用抽屉（原有行为），点 ENTRY_ID 链接用居中弹窗。
// mode 记录本次是哪种，模板里二选一挂载，避免两个容器同时存在、抢同一个 visible。
const detail = reactive<{ visible: boolean; data: EntryDetail | null; mode: 'drawer' | 'dialog' }>({
  visible: false, data: null, mode: 'drawer',
})
async function openDetailFor(forTableId: string, forDataId: string, mode: 'drawer' | 'dialog' = 'drawer') {
  try {
    detail.mode = mode
    detail.data = await dataApi.rowDetail(forTableId, forDataId)
    detail.visible = true
  } catch (error) {
    ElMessage.error(`获取数据表详情失败${error instanceof Error ? error.message : String(error)}`)
  }
}
/** 抽屉：点整行、操作列「详情」按钮 */
function openDetail(row: DataRow) { void openDetailFor(tableId.value, row.dataId) }
/** 弹窗：点 ENTRY_ID 链接（复刻旧平台 entry-list-view 的 ENTRY_ID 链接） */
function openDetailDialog(row: DataRow) { void openDetailFor(tableId.value, row.dataId, 'dialog') }
// 详情内容可能很长（showItems 动辄数十项），不封顶会把弹窗撑出视口、底部字段看不到。
// 与 RowEditDialog 同口径：页面根节点带 transform，position:fixed 的基准被劫持，
// 静态 calc() 猜不出通用公式——弹窗打开后实测内容区离视口顶部的距离，再算还剩下多少高度给它。
const detailBodyEl = ref<HTMLElement | null>(null)
const detailBodyMaxHeight = ref(420)
function recalcDetailHeight() {
  if (!detailBodyEl.value) return
  const top = detailBodyEl.value.getBoundingClientRect().top
  detailBodyMaxHeight.value = Math.max(180, window.innerHeight - top - 72)
}
if (typeof window !== 'undefined') window.addEventListener('resize', recalcDetailHeight)
onUnmounted(() => window.removeEventListener('resize', recalcDetailHeight))
// 点一行打开详情。点的是单元格里自带动作的东西（ENTRY_ID / 源 / 任务 / 父 ID 链接、按钮、
// 勾选框、下拉、文件路径）时让它自己处理，不叠开详情；选中文字准备复制时也不开
function onRowClickDetail(row: DataRow, event: Event) {
  const target = event.target as HTMLElement | null
  if (target?.closest('a, button, input, label, .el-checkbox, .el-dropdown, .el-button, [role="button"]')) return
  if (window.getSelection()?.toString()) return
  openDetail(row)
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
  await loadGroup()
  if (typeof etQuery === 'string' && etQuery) tableId.value = etQuery
  await loadTableMeta()
  await loadSources()
  panelRef.value?.search()
  window.addEventListener('keydown', onFullscreenKey)
})
onUnmounted(() => {
  if (sourceSearchTimer) clearTimeout(sourceSearchTimer)
  window.removeEventListener('keydown', onFullscreenKey)
})
</script>

<template>
  <div class="rc-card dv-page" :class="{ 'is-fullscreen': fullscreen }">
    <!-- 表与源作为查询上下文放在筛选主行，减少割裂的独立工具栏。 -->
    <!-- 查询条件与结果表格：基础条件常显，高级条件默认收起，见 DataQueryPanel.vue -->
    <DataQueryPanel
      ref="panelRef"
      :table-id="tableId"
      :source-id="sourceId"
      :columns="panelColumns"
      show-state
      one-row
      row-clickable
      :selectable="canWrite"
      default-sort-field="updateDt"
      default-sort-order="descend"
      v-model:selected-keys="selectedRowKeys"
      @query-change="onPanelQueryChange"
      @loaded="onPanelLoaded"
      @file-click="onCellFile"
      @row-click="onRowClickDetail"
    >
      <template #context>
      <BrowseModeToggle v-model="browseMode" />
      <el-select v-if="browseMode === 'table'" ref="tableSelectRef" v-model="tableId" filterable placeholder="选择数据表" style="width: 160px" @change="onTableChange">
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
      <button v-if="browseMode === 'table'" class="rc-btn dv-help-btn" type="button" title="表结构详情" @click="openTableDetail">
        <el-icon><QuestionFilled /></el-icon>
      </button>
      <el-select ref="sourceSelectRef" v-model="sourceId" filterable remote clearable :remote-method="onSourceSearch" :loading="sourceLoading" placeholder="选择源（ID或名称）" style="width: 150px" @change="onSourceChange">
        <el-option v-for="s in sourceOptions" :key="s.sourceId" :value="s.sourceId" :label="`${s.sourceId} ${s.name}`" />
        <template #footer>
          <span class="dv-link" @click.stop="openMoreSources">
            <el-icon><Plus /></el-icon>按源搜索（可跨表）...
          </span>
        </template>
      </el-select>
      <button class="rc-btn dv-help-btn" type="button" title="源详情" @click="openSourceDetail">
        <el-icon><QuestionFilled /></el-icon>
      </button>
      <!-- 按步骤：节点依赖源，所以排在源后面；选节点看它的数据，输入 / 输出表不同时可切换 -->
      <template v-if="browseMode === 'step'">
        <RailNodePicker
          v-if="sourceId"
          :open="stepOpen"
          :model-value="stepNodeId"
          :nodes="stepNodeOptions"
          :disabled="stepLoading || !stepNodes.length"
          toggle-testid="data-rail-toggle"
          @update:model-value="onStepNodePicked"
          @update:open="onStepRailToggle"
        />
        <span v-else class="dv-step-hint" data-testid="data-step-need-source">先选择源</span>
        <span v-if="stepNode" class="dv-step-scope" data-testid="data-step-scope">
          <span v-if="stepSameTable" class="dv-scope-piece" data-testid="data-scope-merged"><span class="k">输入·输出</span><span class="v">{{ stepNode.inputTable }}</span></span>
          <template v-else>
            <button v-if="stepScopeSwitchable" type="button" class="dv-scope-piece is-btn" :class="{ active: stepScope === 'input' }" data-testid="data-scope-input" @click="onStepScope('input')"><span class="k">输入</span><span class="v">{{ stepNode.inputTable }}</span></button>
            <span v-else-if="stepNode.inputTable" class="dv-scope-piece"><span class="k">输入</span><span class="v">{{ stepNode.inputTable }}</span></span>
            <span v-if="stepNode.inputTable && stepNode.outputTable" class="dv-scope-sep">·</span>
            <button v-if="stepScopeSwitchable" type="button" class="dv-scope-piece is-btn" :class="{ active: stepScope === 'output' }" data-testid="data-scope-output" @click="onStepScope('output')"><span class="k">输出</span><span class="v">{{ stepNode.outputTable }}</span></button>
            <span v-else-if="stepNode.outputTable" class="dv-scope-piece"><span class="k">输出</span><span class="v">{{ stepNode.outputTable }}</span></span>
          </template>
        </span>
        <button class="rc-btn dv-help-btn" type="button" title="表结构详情" @click="openTableDetail">
          <el-icon><QuestionFilled /></el-icon>
        </button>
      </template>
      </template>
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
      <!-- 操作按钮并入筛选行（1008-07，一行放不下横向滚动）。顺序与源数据视图一致：刷新、新增 ▾、导出、删除、更多、全屏。 -->
      <template #actions>
        <button class="rc-icon-btn" data-testid="data-refresh" type="button" title="刷新" aria-label="刷新" @click="panelRef?.refresh()">
          <el-icon><Refresh /></el-icon>
        </button>
        <AddDataMenu v-if="canWrite" @manual="openAdd" @import="openImport" />
        <!-- 0930-14D：导出 Excel 从「导出 ▾」下拉里提到一级（会上「入口不好找」），点了直接按当前条件下载；
             「导出 ▾」里放当前页 CSV 和取数 API（1008-07：取数 API 从「更多」挪到这里） -->
        <button
          class="rc-btn"
          data-testid="data-export"
          type="button"
          title="按当前查询条件导出全部命中的数据（不是当前页），直接下载 Excel"
          :disabled="!tableId"
          @click="onExport"
        >导出 Excel</button>
        <ExportMenu :show-excel="false" :page-disabled="pageExportDisabled" :api-disabled="!tableId" trigger-testid="data-export-menu" @export-page="onExportPage" @show-api="onShowApi" />
        <button v-if="syncSameBackend && tableMeta?.tableName" class="rc-btn" type="button" data-testid="data-sync" @click="router.push({ path: '/sync/create', query: { tableName: tableMeta.tableName } })">同步到其他环境</button>
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
        <FullscreenToggle v-model="fullscreen" />
      </template>
      <template #toolbar>
        <!-- 整行内容（SQL 提示 / 批量条 / 发大量后续面板）；按钮在上面的 #actions 里，已并入筛选行 -->
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
        <!-- ENTRY_ID 可点开详情（复刻旧平台 entry-list-view 的 ENTRY_ID 链接），展示为居中弹窗。
             不加 @click.stop：行点击 onRowClickDetail 已把 a/button 这类「自带动作」的目标排除掉，
             与同列的「源」「任务」链接同口径。 -->
        <el-table-column prop="dataId" label="ENTRY_ID" width="105" fixed="left" sortable="custom">
          <template #default="{ row }">
            <a
              v-if="row.dataId"
              class="dv-a"
              data-testid="row-open-detail"
              @click="openDetailDialog(row)"
            >{{ row.dataId }}</a>
            <span v-else>—</span>
          </template>
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
            <span>{{ row.parentId || '—' }}</span>
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

    <DataFetchApiDialog
      v-model="apiOpen"
      :url="apiIdFetchUrl"
      :params="apiParams"
      :returns="apiReturns"
      :table-label="tableMeta?.tableName || tableId"
      :source-label="apiSourceLabel"
    />


    <DataImportDialog
      v-model="importOpen"
      :table-id="tableId"
      :source-id="importSourceId"
      :initial-config-id="importConfigId"
      @uploaded="panelRef?.refresh()"
    />

    <!-- 数据详情：两个入口是**两套口径**，各有各的内容体。 -->
    <!-- · 点整行 / 操作列「详情」→ 右侧抽屉（原有行为，保持不变），内容体 DataRowDetail.vue：
         中文标签分组 + showItems 中文名 + 复制 JSON / 导出字段工具栏。 -->
    <el-drawer v-if="detail.mode === 'drawer'" v-model="detail.visible" title="数据表详情" size="480px">
      <DataRowDetail
        v-if="detail.data"
        :data="detail.data"
        :table-meta="tableMeta"
        @open-task="openTaskInstByDetail"
        @open-raw="openRawJson"
        @preview-file="onCellFile"
      />
    </el-drawer>
    <!-- · 点 ENTRY_ID 链接 → 居中弹窗（复刻旧平台 entry-list-view 的 ENTRY_ID 链接），
         内容体 EntryRecordTable.vue：复刻旧平台 RecordDetailComm —— 整行记录按「列 / 值」原样平铺，
         没有工具栏、没有中文分组，跟抽屉那份刻意不同源。 -->
    <el-dialog
      v-else
      v-model="detail.visible"
      title="记录详情"
      width="640px"
      @opened="recalcDetailHeight"
    >
      <div v-if="detail.data" ref="detailBodyEl" class="dv-detail-body" :style="{ maxHeight: `${detailBodyMaxHeight}px` }">
        <EntryRecordTable :data="detail.data" />
      </div>
    </el-dialog>

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
/* 全屏（1008-07）：同一份 DOM 铺满视口，不复制模板也不套弹层；z-index 与源数据视图的全屏同值（60） */
.dv-page.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 60;
  height: 100vh;
  border: 0;
  border-radius: 0;
}
/* 按步骤的输入 / 输出范围：样式与源数据视图摘要行里的同名小段一致（那边是 ResultView 的 scoped 样式） */
.dv-step-hint { flex: none; color: var(--rc-faint); font-size: 12px; white-space: nowrap; }
.dv-step-scope { display: inline-flex; flex: none; align-items: center; gap: 6px; }
.dv-scope-piece { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--rc-text-2); white-space: nowrap; }
.dv-scope-piece .k { font-size: 11px; color: var(--rc-faint); }
.dv-scope-piece .v { font-family: var(--rc-mono, monospace); font-size: 11.5px; }
.dv-scope-sep { color: #cbd5e1; }
button.dv-scope-piece.is-btn { border: 0; background: transparent; font: inherit; padding: 2px 6px; border-radius: 6px; cursor: pointer; opacity: .55; }
button.dv-scope-piece.is-btn:hover { opacity: .85; background: var(--rc-border-soft); }
button.dv-scope-piece.is-btn.active { opacity: 1; background: var(--rc-primary-bg); }
button.dv-scope-piece.is-btn.active .k, button.dv-scope-piece.is-btn.active .v { color: var(--rc-primary-ink); }
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
/* 详情弹窗内容区：高度由 recalcDetailHeight 实测封顶（见 script），这里只负责滚动。
   抽屉分支不需要它——抽屉 body 本来就滚。
   详情内部（工具条 / 复制按钮 / 文件按钮）的样式已随内容体迁到 DataRowDetail.vue。 */
.dv-detail-body {
  overflow-y: auto;
  padding-right: 4px;
}
</style>
