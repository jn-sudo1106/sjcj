<script setup lang="ts">
import SqlConditionEditor from '@/components/SqlConditionEditor.vue'
import { rememberSqlCondition } from '@/utils/sqlConditionHistory'
// 网站文件视图：具体网站下 file_resource 只支持单个 sourceId，所以网站“全部源”按源分页取数后做前端归并。
// 未选择网站时直接查询 file_resource 全量范围，避免任务文件尚未完成网站关联时被过滤掉。
// 不展示流程节点——网站没有唯一流程；选具体源仅收窄文件范围，仍默认展示该源全部文件。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, fileApi, siteApi, type DataTableMeta, type FileResourceRecord, type Source } from '@/api'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import GlobalSourceSelect from './components/GlobalSourceSelect.vue'
import FileDetailDrawer from './FileDetailDrawer.vue'
import FilePreviewDrawer from './components/FilePreviewDrawer.vue'
import { initMergeState, mergeLoadMore, type MergeSourceState, type MergeLoadMoreResult } from './siteDataMerge'

const props = defineProps<{ siteId?: string; initialSourceId?: string }>()

const PAGE_SIZE_OPTIONS = [20, 50, 100]
const MAX_PARALLEL_REQUESTS = 8

const selectedSourceId = ref(props.initialSourceId ?? '')
const siteSources = ref<Source[]>([])
const sourceNames = computed<Record<string, string>>(() => Object.fromEntries(siteSources.value.map((source) => [source.sourceId, source.name])))
type ResourceTable = Pick<DataTableMeta, 'tableId' | 'tableName'> & { name?: string; fields?: DataTableMeta['fields'] }
const table = ref<ResourceTable | null>(null)
// 检测到多张 file_resource 表时此前直接报错停住，用户完全够不着数据；旧平台 FileList2.vue
// 是给了一个"表ID"下拉手动选（loadEntryTypes1），不是自动挑一张——这里补齐同样的手动选择。
const tableCandidates = ref<ResourceTable[]>([])
const rows = ref<FileResourceRecord[]>([])
const filters = reactive({ fileName: '', ext: '', state: '', sql: '' })
const page = ref(1)
const size = ref(PAGE_SIZE_OPTIONS[0])
const total = ref(0)
const tableLoading = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const failedSources = ref<MergeLoadMoreResult<FileResourceRecord>['failedSources']>([])
const allExhausted = ref(false)
const noCandidateSources = ref(false)
const detail = reactive<{ visible: boolean; file: FileResourceRecord | null }>({ visible: false, file: null })
// 全部网站或已收窄到单个源时，entryDataPaged 能返回准确 total，直接用常规分页；只有
// 网站“全部源”需要前端跨源归并，才只能提供加载更多。
const usesDirectPaging = computed(() => !props.siteId || !!selectedSourceId.value)
const tableWrapRef = ref<HTMLElement | null>(null)
const loadMoreSentinelRef = ref<HTMLElement | null>(null)

let mergeStates: MergeSourceState<FileResourceRecord>[] = []
let candidateSourceIds: string[] = []
let tableRequest = 0
let queryRequest = 0
let loadMoreObserver: IntersectionObserver | undefined

function teardownLoadMoreObserver() {
  loadMoreObserver?.disconnect()
  loadMoreObserver = undefined
}
function setupLoadMoreObserver() {
  teardownLoadMoreObserver()
  if (usesDirectPaging.value || allExhausted.value || typeof IntersectionObserver === 'undefined') return
  if (!tableWrapRef.value || !loadMoreSentinelRef.value) return
  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !loading.value && !loadingMore.value && !allExhausted.value) {
        void loadMore()
      }
    },
    { root: tableWrapRef.value, rootMargin: '0px 0px 160px' },
  )
  loadMoreObserver.observe(loadMoreSentinelRef.value)
}
watch([tableWrapRef, loadMoreSentinelRef, usesDirectPaging, allExhausted], () => void nextTick(setupLoadMoreObserver), { flush: 'post' })
onMounted(() => void nextTick(setupLoadMoreObserver))
onBeforeUnmount(teardownLoadMoreObserver)

async function loadResourceTable() {
  const requestId = ++tableRequest
  table.value = null
  tableCandidates.value = []
  error.value = ''
  tableLoading.value = true
  try {
    const candidates = await fileApi.resourceTables()
    if (requestId !== tableRequest) return
    if (!candidates.length) {
      error.value = '未找到 file_resource 文件资源表'
      return
    }
    tableCandidates.value = candidates
    await selectTable(candidates[0], requestId)
  } catch {
    if (requestId !== tableRequest) return
    error.value = '加载文件资源表失败'
    ElMessage.warning('加载文件列表失败')
  } finally {
    if (requestId === tableRequest) tableLoading.value = false
  }
}
// 旧平台列表用固定 K 字段渲染，表目录已足够查询；详情接口异常不能阻断文件列表。
async function selectTable(candidate: ResourceTable, requestId = tableRequest) {
  table.value = candidate
  void fileApi.resourceMeta(candidate.tableId).then((meta) => {
    if (requestId === tableRequest && meta) table.value = meta
  }).catch(() => undefined)
  if (requestId === tableRequest) await resetAndLoad()
}
function onTableChange(tableId: string) {
  const candidate = tableCandidates.value.find((c) => c.tableId === tableId)
  if (!candidate) return
  void selectTable(candidate)
}

async function fetchPage(sourceId: string, page: number, size: number, condition: { tableId: string; sql: string }): Promise<FileResourceRecord[]> {
  const result = await fileApi.resourceRows({
    tableId: condition.tableId,
    // 全部网站范围用一次不带 sourceId 的查询，不能把“全部”伪装成某个源。
    sourceId: sourceId || undefined,
    state: filters.state || undefined,
    fileName: filters.fileName || undefined,
    ext: filters.ext || undefined,
    sql: condition.sql || undefined,
    page,
    size,
  })
  return result.list
}

async function loadMore(requestId = queryRequest) {
  if (!table.value || !candidateSourceIds.length || allExhausted.value || loadingMore.value) return
  loadingMore.value = true
  const condition = { tableId: table.value.tableId, sql: filters.sql }
  let queried = false
  try {
    const result = await mergeLoadMore(mergeStates, PAGE_SIZE_OPTIONS[0], PAGE_SIZE_OPTIONS[0],
      async (sourceId, page, size) => {
        const list = await fetchPage(sourceId, page, size, condition)
        queried = true
        return list
      }, { maxParallel: MAX_PARALLEL_REQUESTS })
    if (requestId !== queryRequest) return
    if (queried && !result.failedSources.length) rememberSqlCondition(condition.tableId, condition.sql)
    rows.value = [...rows.value, ...result.rows]
    failedSources.value = result.failedSources
    allExhausted.value = result.allExhausted
  } catch {
    if (requestId !== queryRequest) return
    error.value = '加载文件列表失败，请重试'
  } finally {
    if (requestId === queryRequest) loadingMore.value = false
  }
}

async function resetAndLoad(resetPage = true) {
  const requestId = ++queryRequest
  if (resetPage) page.value = 1
  rows.value = []
  // 翻页时**不能**把 total 清零：el-pagination 的 current-page 是受控的，看到 total=0
  // 会立刻把页码夹回第 1 页并回发一次 current-change，于是翻页永远停在第 1 页
  // （手写的上一页/下一页没这个问题，它直接读 page，不受 total 约束）。
  // 只有换查询条件（resetPage=true）时才清，那时页码本来就要回到 1。
  if (resetPage) total.value = 0
  failedSources.value = []
  allExhausted.value = false
  noCandidateSources.value = false
  mergeStates = []
  candidateSourceIds = []
  error.value = ''
  if (!table.value) return
  loading.value = true
  try {
    if (props.siteId) {
      const sources = await siteApi.siteSources(props.siteId)
      if (requestId !== queryRequest) return
      siteSources.value = sources
      if (selectedSourceId.value) {
        candidateSourceIds = sources.filter((source) => source.sourceId === selectedSourceId.value).map((source) => source.sourceId)
      } else {
        // 「全部源」逐个查 file_resource：源多的网站（实测 6496 个）会打上千次请求、页面卡在
        // 「正在定位…」。先用 distinctSource 收窄到真正在这张表里有文件的源（与 SiteDataView 同款），
        // 查不到 / 报错再退回网站全部源。size 传大值取全量（默认 20 会漏，见 SiteDataView 同注释）。
        let distinctIds: string[] | null = null
        try {
          distinctIds = await dataApi.distinctSource({ tableId: table.value.tableId, size: 1000 })
        } catch {
          distinctIds = null
        }
        if (requestId !== queryRequest) return
        const siteSourceIds = new Set(sources.map((source) => source.sourceId))
        const scoped = distinctIds?.filter((sid) => siteSourceIds.has(sid)) ?? []
        candidateSourceIds = scoped.length ? scoped : sources.map((source) => source.sourceId)
      }
    } else {
      siteSources.value = []
      // mergeLoadMore 仍可复用分页/加载更多状态；空字符串在 fetchPage 中转换为 undefined。
      candidateSourceIds = ['']
    }
    if (!candidateSourceIds.length) {
      noCandidateSources.value = true
      return
    }
    if (usesDirectPaging.value) {
      const query = {
        tableId: table.value.tableId,
        sourceId: selectedSourceId.value || undefined,
        state: filters.state || undefined,
        fileName: filters.fileName || undefined,
        ext: filters.ext || undefined,
        sql: filters.sql || undefined,
        page: page.value,
        size: size.value,
      }
      const result = await fileApi.resourceRows(query)
      if (requestId !== queryRequest) return
      rememberSqlCondition(query.tableId, query.sql)
      rows.value = result.list
      total.value = result.total
      allExhausted.value = true
      return
    }
    mergeStates = initMergeState<FileResourceRecord>(candidateSourceIds)
    await loadMore(requestId)
  } catch {
    if (requestId !== queryRequest) return
    error.value = '加载文件列表失败，请重试'
  } finally {
    if (requestId === queryRequest) loading.value = false
  }
}

function runQuery() {
  void resetAndLoad()
}
function clearFilters() {
  filters.fileName = ''
  filters.ext = ''
  filters.state = ''
  filters.sql = ''
  runQuery()
}
function valueOf(file: FileResourceRecord, key: string): unknown {
  return file.values[key]
}
function textOf(file: FileResourceRecord, key: string): string {
  const value = valueOf(file, key)
  return value == null || value === '' ? '—' : String(value)
}
function formatSize(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function safeExternalUrl(value: unknown): string {
  const url = String(value ?? '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
  } catch {
    return ''
  }
}
function failedSourceText({ sourceId, error }: MergeLoadMoreResult<FileResourceRecord>['failedSources'][number]): string {
  const name = sourceNames.value[sourceId] || sourceId
  const reason = error.replaceAll(/\s+/g, ' ').slice(0, 120)
  return `${name}（${sourceId}）：${reason}`
}
function openDetail(file: FileResourceRecord) {
  previewVisible.value = false
  detail.file = file
  detail.visible = true
}
function onPageChange() {
  if (!usesDirectPaging.value) return
  void resetAndLoad(false)
}
function changePageSize() {
  if (!usesDirectPaging.value) return
  page.value = 1
  void resetAndLoad()
}

watch(() => [props.siteId, props.initialSourceId] as const, () => {
  selectedSourceId.value = props.initialSourceId ?? ''
  void loadResourceTable()
}, { immediate: true })
watch(selectedSourceId, () => {
  if (table.value) void resetAndLoad()
})

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）

// 点表格行开预览（2026-08-21 产品意见）：预览篇幅大，与「详情」的字段列表拆开各走各的抽屉。
// 行尾「详情」按钮用 @click.stop，避免冒泡把预览一起打开。
const previewVisible = ref(false)
const previewFile = ref<FileResourceRecord | null>(null)
function openPreview(file: FileResourceRecord) {
  detail.visible = false
  previewFile.value = file
  previewVisible.value = true
}
</script>

<template>
  <main class="sfv-shell">
    <div class="sfv-toolbar">
      <slot name="toolbar-prefix" />
      <SiteSourceSelect v-if="siteId" v-model="selectedSourceId" :site-id="siteId" />
      <GlobalSourceSelect v-else v-model="selectedSourceId" />
      <select
        v-if="tableCandidates.length > 1"
        class="sfv-input"
        aria-label="表ID"
        data-testid="site-file-table-select"
        :value="table?.tableId"
        @change="onTableChange(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="c in tableCandidates" :key="c.tableId" :value="c.tableId">[{{ c.tableId }}] {{ c.name || c.tableName }}</option>
      </select>
      <input v-model="filters.fileName" class="sfv-input" placeholder="文件名或展示名" aria-label="文件名">
      <input v-model="filters.ext" class="sfv-input" placeholder="类型，如 pdf、html" aria-label="文件类型">
      <select v-model="filters.state" class="sfv-input" aria-label="状态">
        <option value="">状态（不限）</option><option value="C">初始</option><option value="AC">被消重</option>
      </select>
      <SqlConditionEditor v-model="filters.sql" v-slot="{ value, update }" :table-id="table?.tableId" :table-name="table?.tableName" class="sfv-sql">
        <input :value="value" @input="update(($event.target as HTMLInputElement).value)" class="sfv-input" placeholder="自定义SQL, 如 K1 IS NULL" aria-label="自定义SQL">
      </SqlConditionEditor>
      <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
      <button class="rc-btn" type="button" @click="clearFilters">清空</button>
    </div>

    <div v-if="tableLoading" class="sfv-empty">正在定位 file_resource 文件资源表…</div>
    <div v-else-if="error" class="sfv-empty">{{ error }}</div>
    <div v-else-if="noCandidateSources" class="sfv-empty">当前网站没有可查询的源</div>
    <template v-else>
      <div v-if="failedSources.length" class="sfv-notice" data-testid="site-file-partial-fail">
        {{ failedSources.length }} 个源本次查询失败，结果可能不完整：{{ failedSources.map(failedSourceText).join('；') }}
      </div>
      <div class="sfv-tablehead">
        <span class="sfv-tablename">{{ table?.name || table?.tableName || 'file_resource' }}</span>
        <span class="sfv-count">{{ usesDirectPaging ? `共 ${total} 个文件` : `已加载 ${rows.length} 个文件` }}</span>
      </div>
      <div ref="tableWrapRef" class="sfv-table-wrap">
        <table class="rc-data-table sfv-table" v-loading="loading">
          <thead><tr><th>所属源</th><th>文件名-K1</th><th>展示名-K6</th><th>扩展名-K7</th><th class="num">大小-K4</th><th>MD5-K5</th><th>文件链接-K2</th><th>文件路径-K3</th><th>文本文件-K8</th><th>文本路径-K9</th><th class="num">文本大小-K10</th><th>状态</th><th>更新时间</th><th>生成时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr
              v-for="file in rows"
              :key="`${file.sourceId}-${file.dataId}`"
              class="sfv-row"
              :class="{ active: previewFile?.dataId === file.dataId }"
              @click="openPreview(file)"
            >
              <!-- 源 ID 不在当前网站的源列表里时，标出来而不是让它看着像个源名：
                   导入的文件数据带的是对方体系的源 ID（会议 15:53），对不上是常态，
                   得让人一眼看出"这不是本站的源"，而不是以为源名显示成了一串数字。 -->
              <td>
                <template v-if="sourceNames[file.sourceId]">{{ sourceNames[file.sourceId] }}</template>
                <span v-else class="sfv-unmatched" :title="`源 ID ${file.sourceId} 不在当前范围的源列表中`" data-testid="file-source-unmatched">
                  {{ file.sourceId }}<em>未匹配</em>
                </span>
              </td>
              <td class="sfv-name">{{ textOf(file, 'K1') }}</td>
              <td>{{ textOf(file, 'K6') }}</td>
              <td>{{ textOf(file, 'K7') }}</td>
              <td class="num">{{ formatSize(valueOf(file, 'K4')) }}</td>
              <td class="sfv-md5">{{ textOf(file, 'K5') }}</td>
              <td><a v-if="safeExternalUrl(valueOf(file, 'K2'))" class="sfv-link" :href="safeExternalUrl(valueOf(file, 'K2'))" target="_blank" rel="noreferrer noopener nofollow">打开</a><span v-else class="soft">{{ textOf(file, 'K2') }}</span></td>
              <td class="sfv-path">{{ textOf(file, 'K3') }}</td>
              <td>{{ textOf(file, 'K8') }}</td>
              <td class="sfv-path">{{ textOf(file, 'K9') }}</td>
              <td class="num">{{ formatSize(valueOf(file, 'K10')) }}</td>
              <td>{{ file.state || '—' }}</td>
              <td class="soft">{{ file.updateDt || '—' }}</td>
              <td class="soft">{{ file.createDt || '—' }}</td>
              <td><button class="sfv-link" type="button" data-testid="site-file-detail" @click.stop="openDetail(file)">详情</button></td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="15" class="sfv-empty-row">没有匹配的文件</td></tr>
          </tbody>
        </table>
        <div
          v-if="!usesDirectPaging && !allExhausted"
          ref="loadMoreSentinelRef"
          class="sfv-load-sentinel"
          data-testid="site-file-load-sentinel"
          aria-hidden="true"
        />
      </div>
      <div class="sfv-foot">
        <!-- 分页与数据中心统一（DataQueryPanel 的 .dqp-pager 同款 el-pagination）。
             只有直查分页（全平台 / 选定单个源）才有真实 total 可分页；网站聚合模式
             是多源归并，没有可信的总数，滚动到表格底部时自动取下一批。 -->
        <template v-if="usesDirectPaging">
          <el-pagination
            data-testid="site-file-pagination"
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="PAGE_SIZE_OPTIONS"
            layout="total, sizes, prev, pager, next, jumper"
            background
            small
            :disabled="loading"
            @current-change="onPageChange"
            @size-change="changePageSize"
          />
        </template>
        <span v-else-if="allExhausted" class="muted">已加载全部文件</span>
        <span v-else class="muted" data-testid="site-file-auto-load-status">{{ loadingMore ? '加载中…' : '向下滚动自动加载更多' }}</span>
      </div>
    </template>
    <FileDetailDrawer
      v-model="detail.visible"
      :file="detail.file"
      :source-name="detail.file ? sourceNames[detail.file.sourceId] || '' : ''"
      :table-id="table?.tableId"
      :table-name="table?.name || table?.tableName || ''"
      :fields="table?.fields ?? []"
      @preview="openPreview"
    />
    <FilePreviewDrawer v-model="previewVisible" :file="previewFile" data-testid="site-file-preview-drawer" />
  </main>
</template>

<style scoped>
.sfv-sql { flex: 0 1 260px; min-width: 180px; }
.sfv-shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); }
/* 默认就换行（2026-08-20）：原先 nowrap、只在 ≤900px 的断点才 wrap，中间宽度区间会把
   筛选条件挤出容器；筛选行横向滚动很难用——「查询」按钮会被滚出视野。 */
.sfv-unmatched { display: inline-flex; align-items: center; gap: 5px; color: var(--rc-text-2); }
.sfv-unmatched em { flex: none; padding: 1px 5px; border-radius: 4px; background: #fef3c7; color: #92400e; font-size: 10px; font-style: normal; }
.sfv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.sfv-input { height: 28px; min-width: 112px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; }
.sfv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sfv-toolbar .rc-btn, .sfv-foot .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.sfv-toolbar :deep(.sss-wrap) { min-width: 170px; width: 170px; }
.sfv-toolbar :deep(.sss-input) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sfv-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.sfv-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.sfv-tablehead { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.sfv-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); }
.sfv-count, .muted { color: var(--rc-faint); font-size: 12px; }
.sfv-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.sfv-load-sentinel { width: 1px; height: 1px; }
.sfv-table { width: 100%; min-width: 1160px; border-collapse: separate; border-spacing: 0; }
.sfv-table th { position: sticky; top: 0; z-index: 1; padding: 10px 12px; background: #f8fafc; color: #475569; font-size: 12px; font-weight: 600; text-align: left; white-space: nowrap; }
.sfv-table td { padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-text-2); font-size: 12px; }
.sfv-table th.num, .sfv-table td.num { text-align: right; }
.sfv-name, .sfv-md5 { font-family: var(--rc-mono, monospace); color: #334155; }
.sfv-path { max-width: 220px; overflow: hidden; color: var(--rc-faint); text-overflow: ellipsis; white-space: nowrap; }
.sfv-link { padding: 0; border: 0; background: none; color: var(--rc-primary); text-decoration: none; cursor: pointer; }
.sfv-link:hover { text-decoration: underline; }
.soft { color: var(--rc-faint); }
.sfv-empty-row { padding: 40px 12px !important; color: var(--rc-faint) !important; text-align: center; }
.sfv-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); }
@media (max-width: 900px) {
  .sfv-toolbar :deep(.sss-wrap), .sfv-toolbar :deep(.gss-wrap) { min-width: 220px; width: auto; }
}
.sfv-row { cursor: pointer; }
.sfv-row.active > td { background: var(--rc-primary-bg); }
</style>
