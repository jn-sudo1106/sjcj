<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { fileApi, type FileResourceRecord } from '@/api'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import FileDetailDrawer from './FileDetailDrawer.vue'
import FilePreviewDrawer from './components/FilePreviewDrawer.vue'
import { buildHorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'
import { withoutComposition } from '@/utils/enterKey'

// 文件视图只在具体源下挂载。真实旧平台 FileList2.vue 的链路是：
// file_resource 表目录 → tableMeta → entryDataPaged；网站全部源仍由上层页面另行处理。
// 文件记录与流程节点的真实关联字段尚未确认，因此这里不再用 sourceSteps 冒充 nodeId 筛选。
const flow = useFlowStore()
const sourceId = computed(() => flow.sourceCtx?.sourceId ?? '')
const processLayout = computed(() =>
  buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }),
)
const selectedNodeId = ref('')

// 节点归属是**存量数据问题，不是系统能力缺失**（2026-08-21 产品澄清）：
// 迁移过来的这批文件没有跟节点绑定，所以统一落在首个步骤；后续新增源采集到的文件
// 都会带上真实的节点归属。会议 15:21 说的"这个数据要刷一下、刷到第一个步骤上面"
// 指的就是给这批存量数据补值。
//
// 因此轨道当前是只读的流程上下文：现有数据全在首节点，按节点筛选筛不出任何差异，
// 可点只会让人以为筛过了（原先就是这样——点了换高亮、结果纹丝不动）。
// 等数据侧把节点归属补齐、新数据积累起来之后，这里再放开为真正的筛选器（R5）。
const nodeSelectable = () => false
watch(processLayout, (layout) => {
  selectedNodeId.value = layout.nodes[0]?.id ?? ''
}, { immediate: true })

type ResourceTable = { tableId: string; tableName: string; name?: string }
const table = ref<ResourceTable | null>(null)
// 检测到多张 file_resource 表时此前直接报错停住（Q5①未确认多表规则），用户完全够不着数据；
// 旧平台 FileList2.vue 其实是给了一个"表ID"下拉手动选（loadEntryTypes1，query name=file_resource
// 最多 10 条），不是自动挑一张——这里补齐同样的手动选择，而不是等 Q5① 有结论才能查文件。
const tableCandidates = ref<ResourceTable[]>([])
const rows = ref<FileResourceRecord[]>([])
const total = ref(0)
const loading = ref(false)
const tableLoading = ref(false)
const error = ref('')
const listError = ref('')
const page = ref(1)
const size = ref(20)
const jumpPage = ref(1)
const filters = reactive({ fileName: '', ext: '', state: '', sql: '' })
const detail = reactive<{ visible: boolean; file: FileResourceRecord | null }>({ visible: false, file: null })
const maxPage = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

let tableRequest = 0
async function loadResourceTable() {
  const requestId = ++tableRequest
  table.value = null
  tableCandidates.value = []
  rows.value = []
  total.value = 0
  error.value = ''
  listError.value = ''
  if (!sourceId.value) return
  tableLoading.value = true
  try {
    const candidates = await fileApi.resourceTables()
    if (requestId !== tableRequest) return
    if (candidates.length === 0) {
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
// 旧平台文件列表以固定 K 字段展示，表目录已足够发起查询；详情接口不可用时不阻断列表。
async function selectTable(candidate: ResourceTable, requestId = tableRequest) {
  table.value = candidate
  void fileApi.resourceMeta(candidate.tableId).then((meta) => {
    if (requestId === tableRequest && meta) table.value = meta
  }).catch(() => undefined)
  await loadList(requestId)
}
function onTableChange(tableId: string) {
  const candidate = tableCandidates.value.find((c) => c.tableId === tableId)
  if (!candidate) return
  page.value = 1
  jumpPage.value = 1
  void selectTable(candidate)
}
let listRequest = 0
async function loadList(parentRequest = tableRequest) {
  const requestId = ++listRequest
  if (!sourceId.value || !table.value || parentRequest !== tableRequest) {
    rows.value = []
    total.value = 0
    listError.value = ''
    return
  }
  const query = {
    tableId: table.value.tableId,
    sourceId: sourceId.value,
    state: filters.state || undefined,
    fileName: filters.fileName || undefined,
    ext: filters.ext || undefined,
    sql: filters.sql || undefined,
    page: page.value,
    size: size.value,
  }
  loading.value = true
  listError.value = ''
  try {
    const result = await fileApi.resourceRows(query)
    if (requestId !== listRequest || parentRequest !== tableRequest) return
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch {
    if (requestId !== listRequest || parentRequest !== tableRequest) return
    rows.value = []
    total.value = 0
    listError.value = '文件列表查询失败，请重试'
    ElMessage.warning('加载文件列表失败')
  } finally {
    if (requestId === listRequest) loading.value = false
  }
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
function previousPage() {
  page.value = Math.max(1, page.value - 1)
  jumpPage.value = page.value
  void loadList()
}
function nextPage() {
  if (page.value * size.value >= total.value) return
  page.value += 1
  jumpPage.value = page.value
  void loadList()
}
function changePageSize() {
  page.value = 1
  jumpPage.value = 1
  void loadList()
}
function goToPage() {
  page.value = Math.min(maxPage.value, Math.max(1, Number(jumpPage.value) || 1))
  jumpPage.value = page.value
  void loadList()
}
function openDetail(file: FileResourceRecord) {
  detail.file = file
  detail.visible = true
}

watch(sourceId, () => {
  page.value = 1
  jumpPage.value = 1
  void loadResourceTable()
}, { immediate: true })

function resetFilters() {
  filters.fileName = ''
  filters.ext = ''
  filters.state = ''
  filters.sql = ''
  page.value = 1
  jumpPage.value = 1
  if (table.value) void loadList()
}

// 筛选一律点「查询」执行（2026-08-20）。此前 fileName/ext/state 挂在自动 watch 上边打字边查
// ——当时的判断是"模糊匹配最多结果多点少点"，但在生产的大表上那是每敲一个字符白打一次库；
// 而且同一个文件查询功能在网站文件视图（SiteFileView）里是手动的，两边行为本就不一致。
// 也不绑回车：中文输入法上屏时同样会发 Enter 的 keyup，Vue 的 @keyup.enter 不过滤
// isComposing，绑了等于打字打到一半就把半截条件查出去。
function runQuery() {
  page.value = 1
  jumpPage.value = 1
  if (table.value) void loadList()
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterJump = withoutComposition(() => goToPage())

// 点表格行开预览（2026-08-21 产品意见）：预览篇幅大，与「详情」的字段列表拆开各走各的抽屉。
// 行尾「详情」按钮用 @click.stop，避免冒泡把预览一起打开。
const previewVisible = ref(false)
const previewFile = ref<FileResourceRecord | null>(null)
function openPreview(file: FileResourceRecord) {
  previewFile.value = file
  previewVisible.value = true
}
</script>

<template>
  <main class="fv-shell">
    <CanvasHeader />
    <div class="fv-body">
      <div v-if="!sourceId" class="fv-empty-row">文件视图仅在源详情下可用。</div>
      <template v-else>
        <div class="fv-process-rail" data-testid="file-process-rail">
          <ProcessNodeRail :model-value="selectedNodeId" :layout="processLayout" :selectable="nodeSelectable" />
          <div class="fv-rail-note" data-testid="file-rail-note">
            当前文件多为迁移数据，未绑定流程节点，统一显示在首个步骤；新采集的文件会带上真实节点归属
          </div>
        </div>
        <div class="fv-filters">
          <select
            v-if="!tableLoading && !error && tableCandidates.length > 1"
            class="fv-input"
            aria-label="表ID"
            data-testid="file-table-select"
            :value="table?.tableId"
            @change="onTableChange(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="c in tableCandidates" :key="c.tableId" :value="c.tableId">[{{ c.tableId }}] {{ c.name || c.tableName }}</option>
          </select>
          <input v-model="filters.fileName" class="fv-input" placeholder="文件名或展示名" aria-label="文件名">
          <input v-model="filters.ext" class="fv-input" placeholder="类型，如 pdf、html" aria-label="文件类型">
          <select v-model="filters.state" class="fv-input fv-input-fixed" aria-label="状态">
            <option value="">状态（不限）</option><option value="C">初始</option><option value="AC">被消重</option>
          </select>
          <input v-model="filters.sql" class="fv-input" placeholder="自定义SQL, 如 K1 IS NULL" aria-label="自定义SQL">
          <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
          <button class="rc-btn" type="button" @click="resetFilters">清空</button>
        </div>

        <!-- 表名与计数从筛选行移到这里（2026-08-21）：筛选行只放「怎么查」，表头放「查的是哪张表、
             多少条」——与数据视图（ResultView 的 DataGrid #head）同口径。这两项原先挤在筛选行里
             各占 143px 和 67px，加上一个 flex:1 的占位符吃掉整行剩余空间，直接把查询/清空按钮
             挤到了第二行。 -->
        <div class="fv-tablehead">
          <span class="fv-toolbar-note" data-testid="file-resource-table">
            <span v-if="tableLoading">正在定位 file_resource 文件资源表…</span>
            <span v-else-if="error" class="fv-error">{{ error }}</span>
            <span v-else-if="tableCandidates.length <= 1">数据源：{{ table?.name || table?.tableName || 'file_resource' }}</span>
          </span>
          <span class="muted">共 {{ total }} 个文件</span>
        </div>

        <table class="rc-data-table fv-table" v-loading="loading">
          <thead><tr><th>文件名-K1</th><th>展示名-K6</th><th>扩展名-K7</th><th class="num">大小-K4</th><th>MD5-K5</th><th>文件链接-K2</th><th>文件路径-K3</th><th>文本文件-K8</th><th>文本路径-K9</th><th class="num">文本大小-K10</th><th>状态</th><th>更新时间</th><th>生成时间</th><th>操作</th></tr></thead>
          <tbody>
            <tr
              v-for="file in rows"
              :key="file.dataId"
              class="fv-row"
              :class="{ active: previewFile?.dataId === file.dataId }"
              @click="openPreview(file)"
            >
              <td class="fv-name">{{ textOf(file, 'K1') }}</td>
              <td>{{ textOf(file, 'K6') }}</td>
              <td>{{ textOf(file, 'K7') }}</td>
              <td class="num">{{ formatSize(valueOf(file, 'K4')) }}</td>
              <td class="fv-md5">{{ textOf(file, 'K5') }}</td>
              <td>
                <a v-if="safeExternalUrl(valueOf(file, 'K2'))" class="fv-op" :href="safeExternalUrl(valueOf(file, 'K2'))" target="_blank" rel="noreferrer noopener nofollow">打开</a>
                <span v-else class="soft">{{ textOf(file, 'K2') }}</span>
              </td>
              <td class="fv-path">{{ textOf(file, 'K3') }}</td>
              <td>{{ textOf(file, 'K8') }}</td>
              <td class="fv-path">{{ textOf(file, 'K9') }}</td>
              <td class="num">{{ formatSize(valueOf(file, 'K10')) }}</td>
              <td>{{ file.state || '—' }}</td>
              <td class="soft">{{ file.updateDt || '—' }}</td>
              <td class="soft">{{ file.createDt || '—' }}</td>
              <td><button class="fv-op" type="button" data-testid="file-detail" @click.stop="openDetail(file)">详情</button></td>
            </tr>
            <tr v-if="!rows.length && !loading"><td colspan="14" class="fv-empty-row">{{ listError || error || '没有匹配的文件' }}</td></tr>
          </tbody>
        </table>
        <div class="fv-pager">
          <label class="muted">每页
            <select v-model.number="size" class="fv-page-size" aria-label="每页条数" @change="changePageSize"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select>
            条
          </label>
          <button class="rc-btn" :disabled="page <= 1" @click="previousPage">上一页</button>
          <span class="muted">第 {{ page }} / {{ maxPage }} 页</span>
          <button class="rc-btn" :disabled="page >= maxPage" @click="nextPage">下一页</button>
          <input v-model.number="jumpPage" class="fv-page-jump" type="number" min="1" :max="maxPage" aria-label="跳转页码" @keyup.enter="onEnterJump">
          <button class="rc-btn" type="button" @click="goToPage">跳转</button>
        </div>
      </template>
    </div>
    <FileDetailDrawer v-model="detail.visible" :file="detail.file" />
    <FilePreviewDrawer v-model="previewVisible" :file="previewFile" data-testid="file-preview-drawer" />
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
.fv-empty-row { text-align: center; color: var(--rc-faint); font-size: 13px; padding: 40px 12px; }
.fv-process-rail {
  min-height: 80px;
  margin-bottom: 8px;
  overflow-x: auto;
  background: #f8fafc;
  border: 1px solid var(--rc-border-soft, #e2e8f0);
  border-radius: 10px;
}
.fv-rail-note { padding: 0 12px 8px; color: var(--rc-faint); font-size: 11px; }
.fv-toolbar-note { flex: 0 1 auto; min-width: 0; color: var(--rc-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fv-error { color: var(--rc-error); }

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.fv-filters {
  display: flex;
  /* 换行而不是把条件挤出容器（2026-08-20，与另外两个查询页同口径） */
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  background: #f8fafc;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #f1f5f9;
}
.fv-input {
  height: 30px;
  min-width: 0;
  flex: 1 1 128px;
  max-width: 190px;
  padding: 0 10px;
  color: var(--rc-text);
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.fv-input-fixed { flex: none; width: 110px; }
.fv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.fv-filters .rc-btn { height: 30px; padding: 0 14px; font-size: 12px; }
/* 表头条：表名靠左、计数靠右，跟表格同宽 */
.fv-tablehead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.muted { color: #94a3b8; font-size: 13px; }

.fv-table { width: 100%; border-collapse: separate; border-spacing: 0; }
.fv-table th { background: #f8fafc; color: #475569; font-weight: 600; padding: 12px 16px; font-size: 13px; border-bottom: 2px solid #e2e8f0; text-align: left; }
.fv-table td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; transition: background 0.2s; vertical-align: middle; }
.fv-table tbody tr:hover td { background: #fdfefe; }
.fv-table th.num, .fv-table td.num { text-align: right; }

.fv-name, .fv-md5 { font-family: var(--rc-mono, monospace); font-size: 12px; color: #334155; }
.fv-path { max-width: 220px; color: var(--rc-faint); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.soft { color: #94a3b8; font-size: 12px; }

.rc-status { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; display: inline-block; }
.rc-status.ok { background: rgba(34, 197, 94, 0.1); color: #16a34a; border: 1px solid rgba(34, 197, 94, 0.2); }
.rc-status.err { background: rgba(239, 68, 68, 0.1); color: #dc2626; border: 1px solid rgba(239, 68, 68, 0.2); }

.fv-op { margin-right: 12px; padding: 0; border: 0; background: none; font-size: 13px; color: #3b82f6; text-decoration: none; font-weight: 500; cursor: pointer; transition: color 0.2s; }
.fv-op:hover { color: #2563eb; text-decoration: underline; }

.fv-pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.fv-pager .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }
.fv-page-size, .fv-page-jump { height: 28px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; }
.fv-page-size { width: 54px; margin: 0 4px; }
.fv-page-jump { width: 54px; padding: 0 6px; }

/* 新增自定义 SQL 输入框后 .fv-filters 四个筛选项 + 提示文案在窄容器下会被挤出可视区
   （原生 flex 默认 nowrap，且父级 overflow: visible，溢出部分既不换行也不能横向滚动，
   实测在这次核对里就撞见了）。对齐 SiteFileView.vue 已有的同一断点处理，允许换行。 */
@media (max-width: 900px) {
  .fv-filters { flex-wrap: wrap; }
}
.fv-row { cursor: pointer; }
.fv-row.active > td { background: var(--rc-primary-bg); }
</style>
