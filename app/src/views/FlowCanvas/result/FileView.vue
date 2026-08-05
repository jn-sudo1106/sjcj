<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { fileApi, siteApi, sourceApi, type RawFile, type RawFileStats, type Source, type Step } from '@/api'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { buildHorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'

const props = defineProps<{ siteWide?: boolean }>()
const flow = useFlowStore()
const sourceId = computed(() => flow.sourceCtx?.sourceId ?? '')
const siteId = computed(() => flow.sourceCtx?.siteId ?? '')
const processLayout = computed(() => buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }))

const siteSources = ref<Source[]>([])
const stepsBySource = ref<Record<string, Step[]>>({})
const stats = ref<RawFileStats | null>(null)
const rows = ref<RawFile[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = 20
const filters = reactive({ sourceId: '', nodeId: '', contentType: '', dateFrom: '', dateTo: '' })
const previewFile = ref<RawFile | null>(null)
const previewOpen = ref(false)
const showSourceColumn = computed(() => !filters.sourceId)
const sourceNames = computed(() => Object.fromEntries(siteSources.value.map((source) => [source.sourceId, source.name])))
const filterSteps = computed(() => {
  const sourceIds = filters.sourceId ? [filters.sourceId] : siteSources.value.map((source) => source.sourceId)
  return sourceIds.flatMap((id) => (stepsBySource.value[id] ?? []).map((step) => ({ ...step, sourceId: id })))
})

function scope() {
  return { siteId: siteId.value, sourceId: filters.sourceId || undefined }
}

let metadataRequest = 0
async function loadNodeMetadata() {
  const requestId = ++metadataRequest
  const sourceIds = filters.sourceId ? [filters.sourceId] : siteSources.value.map((source) => source.sourceId)
  if (!sourceIds.length) {
    stepsBySource.value = {}
    return
  }
  try {
    const metadata = await Promise.all(sourceIds.map(async (id) => ({ id, steps: await sourceApi.sourceSteps(id) })))
    if (requestId !== metadataRequest) return
    stepsBySource.value = Object.fromEntries(metadata.map(({ id, steps }) => [id, steps]))
  } catch {
    if (requestId !== metadataRequest) return
    stepsBySource.value = {}
    ElMessage.warning('加载流程节点失败')
  }
}
async function loadSiteSources() {
  const currentSiteId = siteId.value
  try {
    const result = currentSiteId ? await siteApi.siteSources(currentSiteId) : []
    if (currentSiteId !== siteId.value) return
    siteSources.value = result
  } catch {
    if (currentSiteId !== siteId.value) return
    siteSources.value = []
    ElMessage.warning('加载所属子源失败')
  }
}
let statsRequest = 0
async function loadStats() {
  const requestId = ++statsRequest
  const query = { ...scope(), nodeId: filters.nodeId || undefined, contentType: filters.contentType || undefined, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined }
  if (!siteId.value) {
    stats.value = null
    return
  }
  try {
    const result = await fileApi.fileStats(query)
    if (requestId !== statsRequest) return
    stats.value = result
  } catch {
    if (requestId !== statsRequest) return
    stats.value = null
    ElMessage.warning('加载统计信息失败')
  }
}
let listRequest = 0
async function loadList() {
  const requestId = ++listRequest
  const query = {
    ...scope(),
    nodeId: filters.nodeId || undefined,
    contentType: filters.contentType || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    page: page.value,
    size,
  }
  if (!query.siteId) {
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const result = await fileApi.filePaged(query)
    if (requestId !== listRequest) return
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch {
    if (requestId !== listRequest) return
    rows.value = []
    total.value = 0
    ElMessage.warning('加载文件列表失败')
  } finally {
    if (requestId === listRequest) loading.value = false
  }
}
function nodeName(fileSourceId: string, nodeId: string): string {
  return stepsBySource.value[fileSourceId]?.find((step) => step.stepId === nodeId)?.name ?? nodeId
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function formatAttributes(attributes?: Record<string, unknown>): string {
  if (!attributes || !Object.keys(attributes).length) return '—'
  return Object.entries(attributes).map(([key, value]) => `${key}: ${String(value)}`).join('；')
}
const ALLOWED_PREVIEW_PROTOCOLS = ['https:', 'http:', 'blob:']
function safePreviewUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url, window.location.origin)
    return ALLOWED_PREVIEW_PROTOCOLS.includes(u.protocol) ? url : ''
  } catch {
    return ''
  }
}
function previewType(file: RawFile): 'image' | 'iframe' | 'unsupported' {
  const name = file.fileName.toLowerCase()
  if (file.contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) return file.viewUrl ? 'image' : 'unsupported'
  if (file.viewUrl && (file.contentType === 'html' || file.contentType === 'pdf' || file.contentType.startsWith('text/') || file.contentType.includes('json') || /\.(html?|pdf|txt|json|xml|csv)$/.test(name))) return 'iframe'
  return 'unsupported'
}
function openPreview(file: RawFile) {
  previewFile.value = file
  previewOpen.value = true
}
function previousPage() {
  page.value = Math.max(1, page.value - 1)
  loadList()
}
function nextPage() {
  if (page.value * size >= total.value) return
  page.value += 1
  loadList()
}

watch(sourceId, async (id) => {
  page.value = 1
  filters.sourceId = props.siteWide ? '' : id
  await loadSiteSources()
}, { immediate: true })

watch([processLayout, filterSteps], () => {
  if (!filters.nodeId || (filterSteps.value.length > 0 && !filterSteps.value.some((s) => s.stepId === filters.nodeId))) {
    const firstId = processLayout.value.nodes[0]?.id || filterSteps.value[0]?.stepId
    if (firstId) filters.nodeId = firstId
  }
}, { immediate: true })

function resetFilters() {
  filters.sourceId = props.siteWide ? '' : sourceId.value
  filters.nodeId = processLayout.value.nodes[0]?.id || filterSteps.value[0]?.stepId || ''
  filters.contentType = ''
  filters.dateFrom = ''
  filters.dateTo = ''
}

watch(() => [filters.sourceId, filters.nodeId, filters.contentType, filters.dateFrom, filters.dateTo] as const, ([nextSourceId], previous) => {
  page.value = 1
  void Promise.all([nextSourceId !== previous?.[0] ? loadNodeMetadata() : Promise.resolve(), loadStats(), loadList()])
}, { immediate: true })
</script>

<template>
  <main class="fv-shell">
    <CanvasHeader v-if="!siteWide" />
    <div class="fv-body">
      <div v-if="!sourceId" class="fv-empty-row">{{ siteWide ? '该网站暂无子源，无法查看文件。' : '文件视图仅在子源详情下可用。' }}</div>
      <template v-else>
        <div v-if="!siteWide" class="fv-process-rail" data-testid="file-process-rail">
          <ProcessNodeRail v-model="filters.nodeId" :layout="processLayout" />
        </div>
        <div class="fv-filters">
          <select v-model="filters.nodeId" class="fv-input" data-testid="file-node-filter" aria-label="流程节点">
            <option v-if="!filterSteps.length" value="">暂无节点</option>
            <option v-for="step in filterSteps" :key="`${step.sourceId}-${step.stepId}`" :value="step.stepId">{{ showSourceColumn ? `${sourceNames[step.sourceId] || step.sourceId} · ${step.name}` : step.name }}</option>
          </select>
          <select v-model="filters.contentType" class="fv-input" aria-label="文件类型">
            <option value="">类型（全部）</option><option value="html">html</option><option value="pdf">pdf</option><option value="json">json</option>
          </select>
          <input v-model="filters.dateFrom" class="fv-input fv-date" type="date" aria-label="开始日期">
          <input v-model="filters.dateTo" class="fv-input fv-date" type="date" aria-label="结束日期">
          <button class="rc-btn" type="button" @click="resetFilters">清空筛选</button>
          <span class="fv-spacer" />
          <span class="muted">共 {{ total }} 个文件 <span v-if="stats?.totalSize">({{ formatSize(stats.totalSize) }})</span></span>
        </div>

        <table class="rc-data-table fv-table" v-loading="loading">
          <thead><tr><th>文件名</th><th v-if="showSourceColumn">所属子源</th><th>节点</th><th>类型</th><th class="num">大小</th><th>MD5</th><th>扩展属性</th><th>生成时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="file in rows" :key="file.fileId">
              <td class="fv-name">{{ file.fileName }}</td><td v-if="showSourceColumn">{{ sourceNames[file.sourceId] || file.sourceId }}</td><td>{{ nodeName(file.sourceId, file.nodeId) }}</td><td>{{ file.contentType }}</td><td class="num">{{ formatSize(file.size) }}</td>
              <td class="fv-md5">{{ file.md5 || '—' }}</td><td class="fv-attrs">{{ formatAttributes(file.attributes) }}</td><td class="soft">{{ file.createdAt }}</td>
              <td><button class="fv-op" type="button" :data-testid="`file-preview-${file.fileId}`" @click="openPreview(file)">预览</button><a v-if="file.downloadUrl" class="fv-op" :href="file.downloadUrl" :download="file.fileName">下载</a></td>
            </tr>
            <tr v-if="!rows.length && !loading"><td :colspan="showSourceColumn ? 9 : 8" class="fv-empty-row">没有匹配的文件</td></tr>
          </tbody>
        </table>
        <div class="fv-pager"><button class="rc-btn" :disabled="page <= 1" @click="previousPage">上一页</button><span class="muted">第 {{ page }} 页</span><button class="rc-btn" :disabled="page * size >= total" @click="nextPage">下一页</button></div>
      </template>
    </div>
    <el-drawer v-model="previewOpen" title="文件预览" size="70%" destroy-on-close>
      <template v-if="previewFile">
        <img v-if="previewType(previewFile) === 'image'" class="fv-preview-image" :src="previewFile.viewUrl" :alt="previewFile.fileName">
        <iframe v-else-if="previewType(previewFile) === 'iframe'" class="fv-preview-frame" :src="safePreviewUrl(previewFile.viewUrl)" :title="previewFile.fileName" />
        <div v-else class="fv-preview-empty">该文件格式暂不支持站内预览，请下载后查看。</div>
      </template>
    </el-drawer>
  </main>
</template>

<style scoped>
.fv-shell {
  background: linear-gradient(145deg, #fafcff 0%, #ffffff 100%);
  border: 1px solid var(--rc-border);
  border-radius: 12px;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
}
.fv-body { flex: 1; overflow: auto; padding: 20px 24px; animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1); }
.fv-empty-row, .fv-preview-empty { text-align: center; color: var(--rc-faint); font-size: 13px; padding: 40px 12px; }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.fv-process-rail {
  min-height: 80px;
  margin-bottom: 14px;
  overflow-x: auto;
  background: #f8fafc;
  border: 1px solid var(--rc-border-soft);
  border-radius: 10px;
}
.fv-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #f1f5f9;
}
.fv-input {
  height: 30px;
  min-width: 112px;
  padding: 0 10px;
  color: var(--rc-text);
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.fv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.fv-date { min-width: 126px; }
.fv-filters .rc-btn { height: 30px; padding: 0 14px; font-size: 12px; }
.fv-spacer { flex: 1; }
.muted { color: #94a3b8; font-size: 13px; }

.fv-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.fv-table th { background: #f8fafc; color: #475569; font-weight: 600; padding: 12px 16px; font-size: 13px; border-bottom: 2px solid #e2e8f0; text-align: left; }
.fv-table td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; transition: background 0.2s; vertical-align: middle; }
.fv-table tbody tr:hover td { background: #fdfefe; }
.fv-table th.num, .fv-table td.num { text-align: right; }

.fv-name, .fv-md5 { font-family: var(--rc-mono, monospace); font-size: 12px; color: #334155; }
.fv-attrs { max-width: 200px; color: var(--rc-faint); font-size: 12px; }
.soft { color: #94a3b8; font-size: 12px; }

.rc-status { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-block; }
.rc-status.ok { background: rgba(34, 197, 94, 0.1); color: #16a34a; border: 1px solid rgba(34, 197, 94, 0.2); }
.rc-status.err { background: rgba(239, 68, 68, 0.1); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.2); }

.fv-op { margin-right: 12px; padding: 0; border: 0; background: none; font-size: 13px; color: #3b82f6; text-decoration: none; font-weight: 500; cursor: pointer; transition: color 0.2s; }
.fv-op:hover { color: #2563eb; text-decoration: underline; }

.fv-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.fv-pager .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.fv-preview-frame { width: 100%; min-height: 70vh; border: 0; }
.fv-preview-image { display: block; max-width: 100%; max-height: 70vh; margin: 0 auto; object-fit: contain; }
</style>
