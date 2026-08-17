<script setup lang="ts">
// 网站文件视图：file_resource 只支持单个 sourceId，所以网站“全部源”按源分页取数后做前端归并。
// 不展示流程节点——网站没有唯一流程；选具体源仅收窄文件范围，仍默认展示该源全部文件。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fileApi, siteApi, type FileResourceRecord, type Source } from '@/api'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import FileDetailDrawer from './FileDetailDrawer.vue'
import { initMergeState, mergeLoadMore, type MergeSourceState, type MergeLoadMoreResult } from './siteDataMerge'

const props = defineProps<{ siteId: string }>()

const PAGE_SIZE = 20
const MAX_PARALLEL_REQUESTS = 4

const selectedSourceId = ref('')
const siteSources = ref<Source[]>([])
const sourceNames = computed<Record<string, string>>(() => Object.fromEntries(siteSources.value.map((source) => [source.sourceId, source.name])))
const table = ref<{ tableId: string; tableName: string; name?: string } | null>(null)
const rows = ref<FileResourceRecord[]>([])
const filters = reactive({ fileName: '', ext: '', state: '' })
const tableLoading = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const failedSources = ref<MergeLoadMoreResult<FileResourceRecord>['failedSources']>([])
const allExhausted = ref(false)
const noCandidateSources = ref(false)
const detail = reactive<{ visible: boolean; file: FileResourceRecord | null }>({ visible: false, file: null })

let mergeStates: MergeSourceState<FileResourceRecord>[] = []
let candidateSourceIds: string[] = []
let tableRequest = 0
let queryRequest = 0

async function loadResourceTable() {
  const requestId = ++tableRequest
  table.value = null
  error.value = ''
  tableLoading.value = true
  try {
    const candidates = await fileApi.resourceTables()
    if (requestId !== tableRequest) return
    if (!candidates.length) {
      error.value = '未找到 file_resource 文件资源表'
      return
    }
    if (candidates.length > 1) {
      error.value = `检测到 ${candidates.length} 张 file_resource 表，暂不自动选择`
      return
    }
    // 旧平台列表用固定 K 字段渲染，表目录已足够查询；详情接口异常不能阻断文件列表。
    table.value = candidates[0]
    void fileApi.resourceMeta(candidates[0].tableId).then((meta) => {
      if (requestId === tableRequest && meta) table.value = meta
    }).catch(() => undefined)
    if (requestId === tableRequest) await resetAndLoad()
  } catch {
    if (requestId !== tableRequest) return
    error.value = '加载文件资源表失败'
    ElMessage.warning('加载文件列表失败')
  } finally {
    if (requestId === tableRequest) tableLoading.value = false
  }
}

async function fetchPage(sourceId: string, page: number, size: number): Promise<FileResourceRecord[]> {
  if (!table.value) return []
  const result = await fileApi.resourceRows({
    tableId: table.value.tableId,
    sourceId,
    state: filters.state || undefined,
    fileName: filters.fileName || undefined,
    ext: filters.ext || undefined,
    page,
    size,
  })
  return result.list
}

async function loadMore(requestId = queryRequest) {
  if (!candidateSourceIds.length || allExhausted.value) return
  loadingMore.value = true
  try {
    const result = await mergeLoadMore(mergeStates, PAGE_SIZE, PAGE_SIZE, fetchPage, MAX_PARALLEL_REQUESTS)
    if (requestId !== queryRequest) return
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

async function resetAndLoad() {
  const requestId = ++queryRequest
  rows.value = []
  failedSources.value = []
  allExhausted.value = false
  noCandidateSources.value = false
  mergeStates = []
  candidateSourceIds = []
  if (!table.value || error.value) return
  loading.value = true
  try {
    const sources = await siteApi.siteSources(props.siteId)
    if (requestId !== queryRequest) return
    siteSources.value = sources
    candidateSourceIds = selectedSourceId.value
      ? sources.filter((source) => source.sourceId === selectedSourceId.value).map((source) => source.sourceId)
      : sources.map((source) => source.sourceId)
    if (!candidateSourceIds.length) {
      noCandidateSources.value = true
      return
    }
    mergeStates = initMergeState<FileResourceRecord>(candidateSourceIds)
    await loadMore(requestId)
  } catch {
    if (requestId !== queryRequest) return
    error.value = '加载网站源列表失败，请重试'
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
  detail.file = file
  detail.visible = true
}

watch(() => props.siteId, () => {
  selectedSourceId.value = ''
  void loadResourceTable()
}, { immediate: true })
watch(selectedSourceId, () => {
  if (table.value) void resetAndLoad()
})
</script>

<template>
  <main class="sfv-shell">
    <div class="sfv-toolbar">
      <SiteSourceSelect v-model="selectedSourceId" :site-id="siteId" />
      <input v-model="filters.fileName" class="sfv-input" placeholder="文件名或展示名" aria-label="文件名" @keyup.enter="runQuery">
      <input v-model="filters.ext" class="sfv-input" placeholder="类型，如 pdf、html" aria-label="文件类型" @keyup.enter="runQuery">
      <select v-model="filters.state" class="sfv-input" aria-label="状态">
        <option value="">状态（不限）</option><option value="C">初始</option><option value="AC">被消重</option>
      </select>
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
        <span class="sfv-count">已加载 {{ rows.length }} 个文件</span>
      </div>
      <div class="sfv-table-wrap">
        <table class="rc-data-table sfv-table" v-loading="loading">
          <thead><tr><th>所属源</th><th>文件名</th><th>展示名</th><th>扩展名</th><th class="num">大小</th><th>MD5</th><th>文件链接</th><th>文件路径</th><th>文本文件</th><th>文本路径</th><th class="num">文本大小</th><th>状态</th><th>更新时间</th><th>生成时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="file in rows" :key="`${file.sourceId}-${file.dataId}`">
              <td>{{ sourceNames[file.sourceId] || file.sourceId }}</td>
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
              <td><button class="sfv-link" type="button" data-testid="site-file-detail" @click="openDetail(file)">详情</button></td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="15" class="sfv-empty-row">没有匹配的文件</td></tr>
          </tbody>
        </table>
      </div>
      <div class="sfv-foot">
        <span v-if="allExhausted" class="muted">已加载全部文件</span>
        <button v-else class="rc-btn" type="button" data-testid="site-file-load-more" :disabled="loadingMore" @click="loadMore()">{{ loadingMore ? '加载中…' : '加载更多' }}</button>
      </div>
    </template>
    <FileDetailDrawer v-model="detail.visible" :file="detail.file" :source-name="detail.file ? sourceNames[detail.file.sourceId] || detail.file.sourceId : ''" />
  </main>
</template>

<style scoped>
.sfv-shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); }
.sfv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.sfv-input { height: 28px; min-width: 112px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; outline: none; }
.sfv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.sfv-toolbar .rc-btn, .sfv-foot .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.sfv-empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.sfv-notice { padding: 7px 12px; border-bottom: 1px solid #fde68a; background: #fffbeb; color: #92400e; font-size: 12px; }
.sfv-tablehead { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.sfv-tablename { font-family: var(--rc-mono, monospace); font-size: 12px; color: var(--rc-text-2); }
.sfv-count, .muted { color: var(--rc-faint); font-size: 12px; }
.sfv-table-wrap { flex: 1; min-height: 0; overflow: auto; }
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
.sfv-foot { display: flex; justify-content: center; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); }
</style>
