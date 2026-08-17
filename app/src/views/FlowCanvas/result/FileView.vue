<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { fileApi, sourceApi, type RawFile, type RawFileStats, type Step } from '@/api'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { buildHorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'

// 文件视图只在具体源下挂载（0812 计划 M1-4）：网站汇总态的文件页签是"开发中"占位，
// 不会渲染这个组件，所以这里不需要、也不做"全部源遍历查询"的分支——那条路径此前会对
// 网站下每个源各发一次 sourceSteps 请求（N+1），已按 M3-3 删掉，不是"先留着以后再用"，
// 真要做网站范围文件查询也得等 R2（后端 filePaged 支持 siteId 聚合）到位后按新接口重做。
const flow = useFlowStore()
const sourceId = computed(() => flow.sourceCtx?.sourceId ?? '')
const siteId = computed(() => flow.sourceCtx?.siteId ?? '')
const processLayout = computed(() => buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }))

const steps = ref<Step[]>([])
const stats = ref<RawFileStats | null>(null)
const rows = ref<RawFile[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = 20
// 查询参数对齐旧平台 page/inst/FileList.vue 与 /v1/filePaged（0812 计划 M3-1：
// state/attachId/fileId/ext），nodeId 是新平台专属（按流程节点筛选，旧平台没有节点概念）。
// 文件名查询和日期范围 UI 不加：filePaged 是否支持 fileName/siteId 聚合尚未确认（Q5/R2），
// 旧平台本身也没有日期筛选（M3-2）。
const filters = reactive({ nodeId: '', state: '', attachId: '', fileId: '', ext: '' })
const previewFile = ref<RawFile | null>(null)
const previewOpen = ref(false)

function scope() {
  return { siteId: siteId.value, sourceId: sourceId.value }
}

let metadataRequest = 0
async function loadNodeMetadata() {
  const requestId = ++metadataRequest
  if (!sourceId.value) {
    steps.value = []
    return
  }
  try {
    const result = await sourceApi.sourceSteps(sourceId.value)
    if (requestId !== metadataRequest) return
    steps.value = result
  } catch {
    if (requestId !== metadataRequest) return
    steps.value = []
    ElMessage.warning('加载流程节点失败')
  }
}
let statsRequest = 0
async function loadStats() {
  const requestId = ++statsRequest
  if (!siteId.value || !sourceId.value) {
    stats.value = null
    return
  }
  const query = { ...scope(), nodeId: filters.nodeId || undefined, state: filters.state || undefined, attachId: filters.attachId || undefined, fileId: filters.fileId || undefined, ext: filters.ext || undefined }
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
  if (!siteId.value || !sourceId.value) {
    rows.value = []
    total.value = 0
    return
  }
  const query = {
    ...scope(),
    nodeId: filters.nodeId || undefined,
    state: filters.state || undefined,
    attachId: filters.attachId || undefined,
    fileId: filters.fileId || undefined,
    ext: filters.ext || undefined,
    page: page.value,
    size,
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
function nodeName(nodeId: string): string {
  return steps.value.find((step) => step.stepId === nodeId)?.name ?? nodeId
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
  const name = file.realName.toLowerCase()
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

watch(sourceId, () => {
  page.value = 1
  void loadNodeMetadata()
}, { immediate: true })

watch([processLayout, steps], () => {
  if (!filters.nodeId || (steps.value.length > 0 && !steps.value.some((s) => s.stepId === filters.nodeId))) {
    const firstId = processLayout.value.nodes[0]?.id || steps.value[0]?.stepId
    if (firstId) filters.nodeId = firstId
  }
}, { immediate: true })

function resetFilters() {
  filters.nodeId = processLayout.value.nodes[0]?.id || steps.value[0]?.stepId || ''
  filters.state = ''
  filters.attachId = ''
  filters.fileId = ''
  filters.ext = ''
}

watch(() => [filters.nodeId, filters.state, filters.attachId, filters.fileId, filters.ext] as const, () => {
  page.value = 1
  void Promise.all([loadStats(), loadList()])
}, { immediate: true })
</script>

<template>
  <main class="fv-shell">
    <CanvasHeader />
    <div class="fv-body">
      <div v-if="!sourceId" class="fv-empty-row">文件视图仅在源详情下可用。</div>
      <template v-else>
        <div class="fv-process-rail" data-testid="file-process-rail">
          <ProcessNodeRail v-model="filters.nodeId" :layout="processLayout" />
        </div>
        <!-- 查询字段对齐旧平台 page/inst/FileList.vue（0812 计划 M3-1）：state/attachId/fileId/ext，
             流程节点下拉是新平台专属加项。不加文件名/日期筛选——fileName、siteId 聚合是否被
             后端支持还没确认（Q5/R2），旧平台本身也没有日期筛选（M3-2）。 -->
        <div class="fv-filters">
          <select v-model="filters.nodeId" class="fv-input" data-testid="file-node-filter" aria-label="流程节点">
            <option v-if="!steps.length" value="">暂无节点</option>
            <option v-for="step in steps" :key="step.stepId" :value="step.stepId">{{ step.name }}</option>
          </select>
          <select v-model="filters.state" class="fv-input" aria-label="状态">
            <option value="">状态（不限）</option><option value="C">初始</option><option value="AC">被消重</option>
          </select>
          <input v-model="filters.attachId" class="fv-input" placeholder="附件ID" aria-label="附件ID">
          <input v-model="filters.fileId" class="fv-input" placeholder="批次ID" aria-label="批次ID">
          <input v-model="filters.ext" class="fv-input" placeholder="类型，如 xls, doc" aria-label="类型">
          <button class="rc-btn" type="button" @click="resetFilters">清空筛选</button>
          <span class="fv-spacer" />
          <span class="muted">共 {{ total }} 个文件 <span v-if="stats?.totalSize">({{ formatSize(stats.totalSize) }})</span></span>
        </div>

        <table class="rc-data-table fv-table" v-loading="loading">
          <thead><tr><th>附件ID</th><th>批次ID</th><th>状态</th><th>名称</th><th>节点</th><th>类型</th><th class="num">大小</th><th>MD5</th><th>扩展属性</th><th>下载时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="file in rows" :key="file.attachId">
              <td class="fv-name">{{ file.attachId }}</td><td class="soft">{{ file.fileId }}</td><td>{{ file.state }}</td><td class="fv-name">{{ file.realName }}</td><td>{{ nodeName(file.nodeId) }}</td><td>{{ file.contentType }}</td><td class="num">{{ formatSize(file.fileSize) }}</td>
              <td class="fv-md5">{{ file.md5 || '—' }}</td><td class="fv-attrs">{{ formatAttributes(file.attributes) }}</td><td class="soft">{{ file.createDt }}</td>
              <td><button class="fv-op" type="button" :data-testid="`file-preview-${file.attachId}`" @click="openPreview(file)">预览</button><a v-if="file.downloadUrl" class="fv-op" :href="file.downloadUrl" :download="file.realName">下载</a></td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="11" class="fv-empty-row">没有匹配的文件</td></tr>
          </tbody>
        </table>
        <div class="fv-pager"><button class="rc-btn" :disabled="page <= 1" @click="previousPage">上一页</button><span class="muted">第 {{ page }} 页</span><button class="rc-btn" :disabled="page * size >= total" @click="nextPage">下一页</button></div>
      </template>
    </div>
    <el-drawer v-model="previewOpen" title="文件预览" size="70%" destroy-on-close>
      <template v-if="previewFile">
        <img v-if="previewType(previewFile) === 'image'" class="fv-preview-image" :src="previewFile.viewUrl" :alt="previewFile.realName">
        <iframe v-else-if="previewType(previewFile) === 'iframe'" class="fv-preview-frame" :src="safePreviewUrl(previewFile.viewUrl)" :title="previewFile.realName" />
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
