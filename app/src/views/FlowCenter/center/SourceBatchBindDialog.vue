<script setup lang="ts">
// 流程中心「复用已有实例 · 整站源批量绑定」弹窗（1109 原型 `#frame7` / 方案 R02·R04·R05）。
//
// 两段式（原型 frame7 的两张卡）：
//   ①范围与预览：网站 / 源关键词 / 当前绑定三个筛选 + 范围模式四选一 → previewScope 出预计计数。
//     预览即冻结（R02）：每次预览成功都生成一个 scopeToken，并把当前范围快照存下来；
//     之后改筛选 / 改范围 / 改默认流程都会重新冻结（token 换新），页面上一直能看到「这份冻结」。
//   ②分批执行：startBatchBind 冻结集合拿 jobId → 页面每 1s 轮询 fetchBatchJob，
//     服务端每次推进一批；status 到 done/failed 就停表（关掉页面作业继续，重开按 jobId 看进度）。
//
// 口径（R02/R04/R05 定稿，与 frame7 回执一字对齐）：
//   · 合计 = 终态（新增 + 跳过 + 失败）＝ 冻结集合里已处理的部分；待开始 / 执行中不进合计；
//   · 待开始 = 总数 − 已处理 − 执行中（本地算，不直接用服务端 pending，避免两套口径打架）；
//   · 补默认单独展示、不计入合计；默认流程默认不勾（保留各源已有有效默认）；
//   · 已绑本实例记「跳过」，不重复写；追加关联是默认语义（原流程保留）。
//
// 诚实边界（客户端只有 previewScope / startBatchBind / fetchBatchJob）：
//   · 暂停 = 只停本地轮询（服务端作业继续跑），提示「已暂停，继续可恢复」；
//   · 取消待处理项 / 重试失败项没有对应接口 → 显式提示「未提交任何请求」，不假装成功。
//
// 取舍：预览表的行没有对应接口（ScopePreview 只回计数，原型里那几行也是演示样本），
// 所以用本地 SAMPLE_SOURCES 复刻原型的四类绑定状态；表格只作抽样展示，提交范围以冻结计数为准。
//
// 样式：弹窗外壳用 Element Plus `el-dialog`（`:destroy-on-close="false"`，轮询不能随关闭销毁），
// 内部容器/状态/表格用全局设计系统类（`app/src/design/tokens.css` 的 rc-*），局部样式统一 `sbb-` 前缀。
import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { fetchBatchJob, previewScope, startBatchBind } from '@/api/flowCenterCenter'
import type { BatchJob, ScopeIntent, ScopeMode, ScopePreview } from '@/api/types/flowCenterCenter'

const props = defineProps<{
  visible: boolean
  /** 目标实例：既是绑定落点，也是 previewScope 的目标流程 ID（复用已有实例就是复用它的流程结构） */
  instanceId: string
  instanceName: string
}>()
const emit = defineEmits<{ close: []; done: [] }>()

type BindKind = 'unbound' | 'self' | 'other' | 'group'

interface SampleSource {
  sourceId: string
  name: string
  siteName: string
  kind: BindKind
  /** kind === 'other' 时是「已绑哪个流程」，与原型 frame7 的 pill 文案一致 */
  boundName?: string
}

/** 原型 frame7 预览表的抽样行：四类绑定状态各来几条 */
const SAMPLE_SOURCES: SampleSource[] = [
  { sourceId: '2219', name: '上交所公告列表', siteName: '上市公司网站', kind: 'unbound' },
  { sourceId: '2231', name: '深交所公告列表', siteName: '上市公司网站', kind: 'other', boundName: '公告详情抓取' },
  { sourceId: '2246', name: '证监局处罚公告', siteName: '上市公司网站', kind: 'self' },
  { sourceId: '2258', name: '北交所公告列表', siteName: '北交所网站', kind: 'other', boundName: '公告列表→详情（旧）' },
  { sourceId: '2270', name: '上交所问询函', siteName: '上交所网站', kind: 'unbound' },
  { sourceId: '2283', name: '深交所问询函', siteName: '深交所网站', kind: 'unbound' },
  { sourceId: '2295', name: '公告组内：停复牌', siteName: '上市公司网站', kind: 'group' },
  { sourceId: '2302', name: '北交所问询函', siteName: '北交所网站', kind: 'self' },
]

const SITES = [...new Set(SAMPLE_SOURCES.map((row) => row.siteName))]

/** 源范围四选一（互斥），文案与原型 #frame2 / #frame7 一致 */
const SCOPE_MODES: { value: ScopeMode; label: string }[] = [
  { value: 'site-all', label: '该网站全部源' },
  { value: 'unbound', label: '仅未绑定流程的源' },
  { value: 'manual', label: '手选源' },
  { value: 'skip', label: '暂不关联源' },
]

const BIND_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'unbound', label: '未绑定' },
  { value: 'self', label: '已绑本实例' },
  { value: 'other', label: '已绑其它流程' },
] as const

type BindFilter = (typeof BIND_FILTERS)[number]['value']

const POLL_INTERVAL = 1000
/** 预览表每页行数：只影响抽样展示，不影响冻结计数 */
const PAGE_SIZE = 10

const stage = ref<'range' | 'job'>('range')
const mode = ref<ScopeMode>('site-all')
const siteFilter = ref('')
const keyword = ref('')
const bindFilter = ref<BindFilter>('all')
const setDefault = ref(false)
/** 只有「手选源」模式下才有意义；其它模式的勾选列禁用 */
const selectedIds = ref<string[]>([])
/** 预览表分页（本地抽样行翻页） */
const page = ref(1)

const preview = ref<ScopePreview | null>(null)
const previewLoading = ref(false)
const previewError = ref('')
const submitError = ref('')
const scopeToken = ref('')
/** 冻结时的范围快照：提交只提交这一份，后续改筛选不会偷偷改掉它 */
const frozenScope = ref<ScopeIntent | null>(null)
/** 预览请求序号：切换筛选很快时只认最后一次响应，旧响应不覆盖新计数 */
let previewSeq = 0

const job = ref<BatchJob | null>(null)
const submitting = ref(false)
const pollError = ref('')
const paused = ref(false)
const note = ref('')
let pollTimer: number | null = null
let polling = false
let doneEmitted = false

const selectedTotal = computed(() => preview.value?.total ?? 0)
/** 合计只看终态（新增 + 跳过 + 预计不可操作）；组内源、待开始、执行中、补默认都不进 */
const terminalPreviewTotal = computed(() => {
  const data = preview.value
  return data ? data.toAdd + data.toSkip + data.expectedUnavailable : 0
})
const emptyScope = computed(() => !!preview.value && preview.value.total === 0)
/** 待开始 = 总数 − 已处理 − 执行中（任务口径，不用 job.pending） */
const pendingCount = computed(() => {
  const data = job.value
  return data ? Math.max(0, data.total - data.processed - data.running) : 0
})
const terminalTotal = computed(() => {
  const data = job.value
  return data ? data.added + data.skipped + data.failed : 0
})
const percent = computed(() => {
  const data = job.value
  if (!data || !data.total) return 0
  return Math.min(100, Math.max(0, Math.round((data.processed / data.total) * 100)))
})
const failures = computed(() => job.value?.failures ?? [])
const statusLabel = computed(() => {
  switch (job.value?.status) {
    case 'running':
      return '执行中'
    case 'done':
      return '已完成'
    case 'failed':
      return '失败'
    case 'paused':
      return '已暂停'
    default:
      return '待开始'
  }
})
/** 作业状态 → 设计系统状态色（rc-status 的修饰类） */
const statusClass = computed(() => {
  const status = job.value?.status
  if (status === 'done') return 'ok'
  if (status === 'failed') return 'err'
  return 'run'
})
const progressText = computed(() => {
  const data = job.value
  if (!data) return ''
  if (data.status === 'done') {
    return `已完成 ${data.batchTotal} / ${data.batchTotal} 批（已处理 ${fmt(data.processed)} / ${fmt(data.total)}）`
  }
  const doneBatches = Math.min(data.batchIndex, data.batchTotal)
  const runningBatch = Math.min(data.batchTotal, doneBatches + 1)
  return `已完成 ${doneBatches} / ${data.batchTotal} 批，第 ${runningBatch} 批执行中（已处理 ${fmt(data.processed)} / ${fmt(data.total)}）`
})
const visibleRows = computed(() =>
  SAMPLE_SOURCES.filter((row) => {
    if (siteFilter.value && row.siteName !== siteFilter.value) return false
    const kw = keyword.value.trim().toLowerCase()
    if (kw && !`${row.name} ${row.sourceId}`.toLowerCase().includes(kw)) return false
    if (bindFilter.value !== 'all' && row.kind !== bindFilter.value) return false
    // 「仅未绑定流程的源」范围下，表里也只看这类源，避免样本和范围口径打架
    if (mode.value === 'unbound' && row.kind !== 'unbound') return false
    return true
  }),
)
const pagedRows = computed(() => visibleRows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const selectableRows = computed(() => visibleRows.value.filter((row) => row.kind !== 'group'))
const allChecked = computed(
  () =>
    selectableRows.value.length > 0 && selectableRows.value.every((row) => selectedIds.value.includes(row.sourceId)),
)
const canSubmit = computed(() => !!scopeToken.value && !!frozenScope.value && selectedTotal.value > 0 && !submitting.value)

function fmt(value: number | undefined): string {
  return String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '未知错误'
}

/** 冻结令牌：原型展示形如 `20261110-0931`（ScopePreview 没有 token 字段，由前端在预览成功时生成） */
function makeScopeToken(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/** 当前范围意图（C09 的 ScopeIntent 形状，冻结 / 提交都用它） */
function currentScope(): ScopeIntent {
  return {
    sites: siteFilter.value ? [siteFilter.value] : [],
    mode: mode.value,
    manualSourceIds: mode.value === 'manual' ? [...selectedIds.value] : [],
    setDefault: setDefault.value,
  }
}

function bindLabel(row: SampleSource): string {
  if (row.kind === 'self') return '已绑本实例'
  if (row.kind === 'other') return `已绑「${row.boundName ?? '其它流程'}」`
  if (row.kind === 'group') return '组内源'
  return '未绑定'
}

/** 绑定状态 → 设计系统状态色（rc-status 的修饰类） */
function bindStatusClass(row: SampleSource): string {
  if (row.kind === 'self') return 'ok'
  if (row.kind === 'other') return 'run'
  if (row.kind === 'group') return 'warn'
  return 'muted'
}

/** 本次操作：文案照原型 frame7 的四类 */
function actionText(row: SampleSource): string {
  if (row.kind === 'group') return '组内源，需单独确认后绑定'
  if (row.kind === 'self') return '已绑定、跳过（不重复写）'
  if (row.kind === 'other') return '追加关联，原流程保留'
  return '新增关联（追加）'
}

/** 预览并冻结：成功就换新 scopeToken + 记录范围快照；失败清掉冻结态（不能拿旧 token 提交新范围） */
async function refreshPreview(): Promise<void> {
  const seq = ++previewSeq
  previewLoading.value = true
  previewError.value = ''
  submitError.value = ''
  try {
    const data = await previewScope(props.instanceId, currentScope())
    if (seq !== previewSeq) return
    preview.value = data
    frozenScope.value = currentScope()
    scopeToken.value = makeScopeToken()
  } catch (error) {
    if (seq !== previewSeq) return
    preview.value = null
    frozenScope.value = null
    scopeToken.value = ''
    previewError.value = `范围预览失败：${errorText(error)}`
    ElMessage.error(previewError.value)
  } finally {
    if (seq === previewSeq) previewLoading.value = false
  }
}

function onFilter(): void {
  page.value = 1
  void refreshPreview()
}

function setMode(next: ScopeMode): void {
  if (mode.value === next) return
  mode.value = next
  page.value = 1
  selectedIds.value =
    next === 'manual' ? SAMPLE_SOURCES.filter((row) => row.kind !== 'group').map((row) => row.sourceId) : []
  void refreshPreview()
}

/** Element Plus 的 change 回传类型比 ScopeMode 宽，入口处收敛一次 */
function onModeChange(value: string | number | boolean | undefined): void {
  setMode(value as ScopeMode)
}

function toggleDefault(): void {
  setDefault.value = !setDefault.value
  void refreshPreview()
}

function checked(row: SampleSource): boolean {
  return selectedIds.value.includes(row.sourceId)
}

function toggleRow(row: SampleSource): void {
  if (mode.value !== 'manual' || row.kind === 'group') return
  const rest = selectedIds.value.filter((id) => id !== row.sourceId)
  selectedIds.value = rest.length === selectedIds.value.length ? [...rest, row.sourceId] : rest
  void refreshPreview()
}

function toggleAll(): void {
  if (mode.value !== 'manual') return
  const visibleIds = selectableRows.value.map((row) => row.sourceId)
  if (allChecked.value) selectedIds.value = selectedIds.value.filter((id) => !visibleIds.includes(id))
  else selectedIds.value = [...new Set([...selectedIds.value, ...visibleIds])]
  void refreshPreview()
}

function onPageChange(next: number): void {
  page.value = next
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function markDone(): void {
  if (doneEmitted) return
  doneEmitted = true
  emit('done')
}

/** 轮询一次：每条响应都覆盖本地 job；done/failed 停表并通知父级刷新列表 */
async function pollOnce(): Promise<void> {
  const current = job.value
  if (!current || polling || paused.value || stage.value !== 'job') return
  polling = true
  try {
    const data = await fetchBatchJob(current.jobId)
    if (stage.value !== 'job') return
    job.value = data
    pollError.value = ''
    if (data.status === 'done' || data.status === 'failed') {
      stopPolling()
      markDone()
      if (data.status === 'done') ElMessage.success('作业执行完成')
      else ElMessage.error('作业失败：可重试失败项或按 jobId 到作业详情排查')
    }
  } catch (error) {
    stopPolling()
    pollError.value = `进度获取失败：${errorText(error)}`
    ElMessage.error(pollError.value)
  } finally {
    polling = false
  }
}

function startPolling(): void {
  stopPolling()
  pollTimer = window.setInterval(() => {
    void pollOnce()
  }, POLL_INTERVAL)
}

function resumePolling(): void {
  paused.value = false
  pollError.value = ''
  startPolling()
  ElMessage.info('已继续轮询')
}

async function submitFrozen(): Promise<void> {
  const scope = frozenScope.value
  const token = scopeToken.value
  if (!scope || !token) {
    ElMessage.warning('请先预览并确认范围')
    return
  }
  if (selectedTotal.value === 0) {
    ElMessage.warning('当前筛选没有可绑定的源')
    return
  }
  submitting.value = true
  submitError.value = ''
  try {
    const data = await startBatchBind({ instanceId: props.instanceId, scopeToken: token, scope })
    job.value = data
    stage.value = 'job'
    paused.value = false
    pollError.value = ''
    note.value = ''
    if (data.status === 'done' || data.status === 'failed') markDone()
    else startPolling()
  } catch (error) {
    submitError.value = `提交失败：${errorText(error)}`
    ElMessage.error(submitError.value)
  } finally {
    submitting.value = false
  }
}

/** 暂停只停本地轮询：服务端作业继续跑，点「继续」就接着按 jobId 取进度 */
function togglePause(): void {
  if (job.value?.status === 'done' || job.value?.status === 'failed') return
  if (paused.value) {
    paused.value = false
    note.value = ''
    startPolling()
    ElMessage.info('已继续轮询')
    return
  }
  paused.value = true
  stopPolling()
  note.value = '已暂停，继续可恢复：这里只停掉页面轮询，服务端作业仍在执行，点「继续」恢复取进度。'
  ElMessage.warning('已暂停，继续可恢复')
}

function cancelPending(): void {
  if (pendingCount.value === 0) {
    ElMessage.warning('当前没有待处理的源')
    return
  }
  note.value = `取消待处理项：客户端暂未提供取消接口，本次未提交任何请求（待开始 ${fmt(pendingCount.value)} 个源仍在服务端队列里；已完成项不会被回滚）。`
  ElMessage.warning('取消接口未接入，未提交请求')
}

function retryFailed(): void {
  if (failures.value.length === 0) {
    ElMessage.warning('当前没有可重试的失败项')
    return
  }
  note.value = `重试失败项：客户端暂未提供重试接口，本次未提交任何请求（失败清单 ${failures.value.length} 项保持原样）。真接口接入后只对失败清单重跑，已成功项不重复写。`
  ElMessage.warning('重试接口未接入，未提交请求')
}

async function copyJobId(): Promise<void> {
  const jobId = job.value?.jobId
  if (!jobId) return
  try {
    await navigator.clipboard.writeText(jobId)
    ElMessage.success(`已复制作业号 ${jobId}`)
  } catch {
    ElMessage.warning(`复制失败，请手动记下作业号：${jobId}`)
  }
}

/** 关掉 / 重开时都要清干净：轮询定时器是第一优先级，漏掉会一直打接口 */
function teardown(): void {
  stopPolling()
  previewSeq += 1
  polling = false
  stage.value = 'range'
  mode.value = 'site-all'
  siteFilter.value = ''
  keyword.value = ''
  bindFilter.value = 'all'
  setDefault.value = false
  selectedIds.value = []
  page.value = 1
  preview.value = null
  previewLoading.value = false
  previewError.value = ''
  submitError.value = ''
  scopeToken.value = ''
  frozenScope.value = null
  job.value = null
  submitting.value = false
  pollError.value = ''
  paused.value = false
  note.value = ''
  doneEmitted = false
}

function open(): void {
  teardown()
  void refreshPreview()
}

function closeDialog(): void {
  stopPolling()
  emit('close')
}

/** el-dialog 自己关（遮罩 / ESC / 关闭按钮）时同步给父级，避免内外两份 visible 打架 */
function onDialogUpdate(value: boolean): void {
  if (!value) closeDialog()
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) open()
    else teardown()
  },
  { immediate: true },
)

onUnmounted(() => {
  stopPolling()
})
</script>

<template>
  <!-- 弹窗：轮询不能被关闭动作销毁，所以 destroy-on-close 显式关掉、遮罩点击不关 -->
  <el-dialog
    :model-value="visible"
    title="复用已有实例 · 批量绑定源"
    width="900px"
    append-to-body
    :close-on-click-modal="false"
    :destroy-on-close="false"
    :show-close="false"
    class="sbb-dialog"
    data-testid="source-batch-bind-dialog"
    @update:model-value="onDialogUpdate"
  >
    <template #header>
      <div class="sbb-head">
        <div class="sbb-head-text">
          <div class="sbb-crumb">流程中心 / 实例 / {{ instanceName }} #{{ instanceId }}</div>
          <h2 class="sbb-title">复用已有实例 · 批量绑定源</h2>
        </div>
        <el-button link type="primary" data-testid="sb-close-head" @click="closeDialog">关闭</el-button>
      </div>
    </template>

    <div class="sbb-body">
      <!-- ① 范围筛选 + 预览表 -->
      <template v-if="stage === 'range'">
        <section class="rc-card sbb-card">
          <div class="rc-card-head">
            <div class="sbb-hgroup">
              <b class="sbb-ctitle">选择源</b>
              <span class="sbb-num">{{ fmt(selectedTotal) }}</span>
              <span v-if="scopeToken" class="rc-status run" data-testid="sb-scope-token">
                已冻结 · scopeToken {{ scopeToken }}
              </span>
            </div>
            <span class="sbb-hint">确认只作用于冻结集合，之后新增的源不会进入本批</span>
          </div>

          <div class="rc-toolbar wrap">
            <span class="sbb-flabel">网站</span>
            <el-select
              v-model="siteFilter"
              class="sbb-select"
              placeholder="全部"
              aria-label="网站筛选"
              data-testid="sb-site"
              @change="onFilter"
            >
              <el-option label="全部" value="" />
              <el-option v-for="site in SITES" :key="site" :label="site" :value="site" />
            </el-select>
            <span class="sbb-flabel">源</span>
            <el-input
              v-model="keyword"
              class="sbb-input"
              clearable
              placeholder="名称 / 源 ID 关键词"
              aria-label="源关键词"
              data-testid="sb-keyword"
              @keyup.enter="onFilter"
            />
            <span class="sbb-flabel">当前绑定</span>
            <el-select
              v-model="bindFilter"
              class="sbb-select"
              aria-label="当前绑定筛选"
              data-testid="sb-bind"
              @change="onFilter"
            >
              <el-option v-for="opt in BIND_FILTERS" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
            <el-button type="primary" plain data-testid="sb-query" @click="onFilter">查询</el-button>
            <span class="rc-field sbb-right">已选 <b>{{ fmt(selectedTotal) }}</b> 个（= 当前筛选全部）</span>
          </div>

          <div class="rc-toolbar wrap">
            <span class="sbb-flabel">范围</span>
            <el-radio-group
              :model-value="mode"
              class="sbb-modes"
              aria-label="源范围"
              data-testid="sb-mode"
              @change="onModeChange"
            >
              <el-radio-button
                v-for="item in SCOPE_MODES"
                :key="item.value"
                :value="item.value"
                :data-testid="`sb-mode-${item.value}`"
              >
                {{ item.label }}
              </el-radio-button>
            </el-radio-group>
            <span v-if="mode === 'manual'" class="rc-field sbb-right">已手选 {{ selectedIds.length }} 个源</span>
          </div>

          <div class="sbb-default-row">
            <el-checkbox
              :model-value="setDefault"
              class="sbb-check"
              data-testid="sb-set-default"
              @change="toggleDefault"
            >
              设为这些源的默认流程
            </el-checkbox>
            <span class="sbb-default-note">默认不勾选：保留已有有效默认</span>
          </div>

          <div class="rc-table-scroll sbb-table-wrap">
            <table class="rc-data-table sbb-table" data-testid="sb-table">
              <thead>
                <tr>
                  <th class="sbb-col-check">
                    <el-checkbox
                      :model-value="allChecked"
                      :disabled="mode !== 'manual'"
                      aria-label="全选当前筛选的源"
                      data-testid="sb-check-all"
                      @change="toggleAll"
                    />
                  </th>
                  <th class="sbb-col-src">源</th>
                  <th class="sbb-col-site">网站</th>
                  <th class="sbb-col-bind">当前绑定</th>
                  <th>本次操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in pagedRows"
                  :key="row.sourceId"
                  data-testid="sb-row"
                  :class="{ active: checked(row) }"
                >
                  <td class="sbb-col-check">
                    <el-checkbox
                      :model-value="checked(row)"
                      :disabled="mode !== 'manual' || row.kind === 'group'"
                      :aria-label="`勾选 ${row.name}`"
                      data-testid="sb-row-check"
                      @change="toggleRow(row)"
                    />
                  </td>
                  <td class="sbb-cell-src"><b>{{ row.name }}</b> <span class="sbb-mono">#{{ row.sourceId }}</span></td>
                  <td class="sbb-mono">{{ row.siteName }}</td>
                  <td class="sbb-col-bind">
                    <el-tooltip :content="bindLabel(row)" placement="top" :show-after="400">
                      <span class="rc-status sbb-bind" :class="bindStatusClass(row)">
                        <span class="sbb-bind-text">{{ bindLabel(row) }}</span>
                      </span>
                    </el-tooltip>
                  </td>
                  <td :title="actionText(row)"><span class="sbb-why">{{ actionText(row) }}</span></td>
                </tr>
                <tr v-if="pagedRows.length === 0" data-testid="sb-empty-table">
                  <td colspan="5" class="sbb-empty-td">
                    当前筛选没有可绑定的源
                    <span class="sbb-hint">换个网站 / 关键词，或把范围改成「该网站全部源」再预览</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="sbb-tfoot">
            <span class="sbb-meta">已选 <b>{{ fmt(selectedTotal) }}</b></span>
            <span class="sbb-hint">表格为抽样预览 · 提交范围以冻结计数为准</span>
            <el-pagination
              class="sbb-pager sbb-right"
              size="small"
              background
              layout="prev, pager, next"
              :current-page="page"
              :page-size="PAGE_SIZE"
              :total="visibleRows.length"
              data-testid="sb-pager"
              @current-change="onPageChange"
            />
          </div>
        </section>

        <div v-if="previewLoading" class="sbb-receipt" data-testid="sb-preview-loading">
          <el-alert type="info" :closable="false" show-icon>正在估算范围…</el-alert>
        </div>
        <div v-else-if="previewError" class="sbb-receipt" data-testid="sb-preview-error">
          <el-alert type="error" :closable="false" show-icon>
            <span class="sbb-alert-row">
              <span>{{ previewError }}</span>
              <el-button link type="primary" data-testid="sb-preview-retry" @click="refreshPreview">重试</el-button>
            </span>
          </el-alert>
        </div>
        <div v-else-if="emptyScope" class="sbb-receipt" data-testid="sb-empty">
          <el-alert type="warning" :closable="false" show-icon>
            <span class="sbb-alert-col">
              <span>当前筛选没有可绑定的源</span>
              <span class="sbb-hint">调整网站 / 关键词 / 当前绑定，或切换范围模式后重新预览</span>
            </span>
          </el-alert>
        </div>
        <section v-else-if="preview" class="rc-card sbb-receipt" data-testid="sb-preview-card">
          <div class="rc-card-head">
            <div class="sbb-hgroup">
              <b class="sbb-ctitle">范围预览</b>
              <span class="sbb-num">{{ fmt(preview.total) }}</span>
              <span class="rc-status muted">冻结 scopeToken {{ scopeToken }}</span>
            </div>
            <span class="sbb-hint">计数为预览值，真实结果看执行回执</span>
          </div>
          <div class="sbb-receipt-body">
            <div class="rc-mini-card sbb-stats">
              <span class="sbb-stat">预计新增 <b>{{ fmt(preview.toAdd) }}</b></span>
              <span class="sbb-stat">预计跳过 <b>{{ fmt(preview.toSkip) }}</b></span>
              <span class="sbb-stat warn">预计不可操作 <b>{{ fmt(preview.expectedUnavailable) }}</b></span>
              <span class="sbb-stat">
                组内源 <b>{{ fmt(preview.groupSources) }}</b><span class="sbb-stat-note">需单独确认</span>
              </span>
              <span class="sbb-stat" data-testid="sb-default-filled">
                补默认 <b>{{ fmt(preview.defaultFilled) }}</b><span class="sbb-stat-note">不计入合计</span>
              </span>
              <span class="sbb-stat total">合计 <b>{{ fmt(terminalPreviewTotal) }}</b></span>
            </div>
            <p class="sbb-why-block">
              合计 = 预计新增 + 预计跳过 + 预计不可操作 = {{ fmt(terminalPreviewTotal) }}；组内源
              {{ fmt(preview.groupSources) }} 个不进合计（流程由源组统一指定，需单独确认）。补默认单独统计、不计入合计。
            </p>
          </div>
        </section>

        <div v-if="submitError" data-testid="sb-submit-error">
          <el-alert type="error" :closable="false" show-icon>{{ submitError }}</el-alert>
        </div>
      </template>

      <!-- ② 分批执行 -->
      <template v-else>
        <section class="rc-card sbb-card" data-testid="sb-job">
          <div class="rc-card-head">
            <div class="sbb-hgroup">
              <b class="sbb-ctitle">服务端批次作业</b>
              <b class="sbb-num" data-testid="sb-job-id">{{ job?.jobId }}</b>
              <span class="rc-status muted">{{ job?.batchTotal }} 批 · 每批 {{ job?.batchSize }} 个源</span>
            </div>
            <span class="sbb-hgroup">
              <span class="sbb-hint">关闭页面后继续执行，重开按 jobId 查看进度</span>
              <span class="rc-status" :class="statusClass" data-testid="sb-job-status">{{ statusLabel }}</span>
            </span>
          </div>

          <div class="sbb-job-body">
            <div class="sbb-progress-row">
              <span class="sbb-flabel">进度</span>
              <el-progress class="sbb-progress" :percentage="percent" :stroke-width="8" :show-text="false" />
              <span class="sbb-mono" data-testid="sb-progress">{{ progressText }}</span>
            </div>

            <div class="rc-mini-card sbb-stats" data-testid="sb-receipts">
              <span class="sbb-stat">新增 <b data-testid="sb-added">{{ fmt(job?.added) }}</b></span>
              <span class="sbb-stat">已绑定跳过 <b data-testid="sb-skipped">{{ fmt(job?.skipped) }}</b></span>
              <span class="sbb-stat warn">
                失败 <b data-testid="sb-failed">{{ fmt(job?.failed) }}</b><span class="sbb-stat-note">并发锁冲突，可重试</span>
              </span>
              <span class="sbb-stat">待开始 <b data-testid="sb-pending">{{ fmt(pendingCount) }}</b></span>
              <span class="sbb-stat">执行中 <b data-testid="sb-running">{{ fmt(job?.running) }}</b></span>
              <span class="sbb-stat" data-testid="sb-default-filled-job">
                补默认 <b>{{ fmt(job?.defaultFilled) }}</b><span class="sbb-stat-note">不计入合计</span>
              </span>
            </div>

            <p class="sbb-why-block">
              终态合计 <b>{{ fmt(terminalTotal) }}</b> = 新增 + 跳过 + 失败 = 已处理 {{ fmt(job?.processed) }} / 冻结
              {{ fmt(job?.total) }}；待开始 = 总数 − 已处理 − 执行中 = {{ fmt(pendingCount) }}。动作分开：离开页面作业继续 ·
              暂停不再取新批次 · 取消待处理项不回滚已完成。
            </p>

            <div v-if="failures.length" class="sbb-failures" data-testid="sb-failures">
              <div class="sbb-failures-head">失败清单（{{ failures.length }}）· 并发锁冲突可重试，已成功项不重复写</div>
              <ul>
                <li v-for="item in failures" :key="item.sourceId">
                  <span class="sbb-mono">#{{ item.sourceId }}</span> {{ item.sourceName }}
                  <span class="sbb-fail-reason">{{ item.reason }}</span>
                </li>
              </ul>
            </div>

            <div v-if="pollError" data-testid="sb-poll-error">
              <el-alert type="error" :closable="false" show-icon>
                <span class="sbb-alert-row">
                  <span>{{ pollError }}</span>
                  <el-button link type="primary" @click="resumePolling">继续轮询</el-button>
                </span>
              </el-alert>
            </div>

            <div v-if="note" data-testid="sb-note">
              <el-alert type="warning" :closable="false" show-icon>{{ note }}</el-alert>
            </div>
          </div>
        </section>
      </template>
    </div>

    <div class="rc-actions sbb-foot">
      <span class="sbb-hint sbb-foot-hint">
        {{
          stage === 'range'
            ? '预览即冻结：改筛选 / 改范围 / 改默认流程都会重新冻结并换新 scopeToken'
            : '关闭页面后作业继续执行；重开按 jobId 查看进度'
        }}
      </span>
      <template v-if="stage === 'range'">
        <el-button data-testid="sb-close" @click="closeDialog">关闭</el-button>
        <el-button :disabled="previewLoading" data-testid="sb-preview-confirm" @click="refreshPreview">
          预览并确认
        </el-button>
        <el-button type="primary" :disabled="!canSubmit" data-testid="sb-submit" @click="submitFrozen">
          {{ submitting ? '提交中…' : '提交冻结集合' }}
        </el-button>
      </template>
      <template v-else>
        <el-button data-testid="sb-cancel-pending" @click="cancelPending">取消待处理项</el-button>
        <el-button data-testid="sb-pause" @click="togglePause">{{ paused ? '继续' : '暂停' }}</el-button>
        <el-button data-testid="sb-retry-failed" @click="retryFailed">重试失败项</el-button>
        <el-button data-testid="sb-copy" @click="copyJobId">复制作业号</el-button>
        <el-button type="primary" disabled data-testid="sb-submit-locked" title="本批已提交，冻结范围不可修改">
          提交冻结集合
        </el-button>
        <el-button data-testid="sb-close" @click="closeDialog">关闭</el-button>
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
/* el-dialog 外壳不是本组件渲染的元素（拿不到 scoped 的 data-v），
   所以用 :global + `.sbb-dialog` 唯一前缀收口，避免污染其它弹窗。 */
:global(.sbb-dialog.el-dialog) {
  max-width: calc(100vw - 32px);
  padding: 0;
}
:global(.sbb-dialog .el-dialog__header) {
  margin: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
:global(.sbb-dialog .el-dialog__body) {
  display: flex;
  flex-direction: column;
  max-height: min(72vh, 760px);
  padding: 0;
  overflow: hidden;
  color: var(--rc-text-2);
  font-size: 12px;
  /* 控件字号跟随设计系统：Element Plus 默认 14px，这里整体降到 13px */
  --el-font-size-base: 13px;
}

/* 头部：面包屑 + 标题 + 关闭 */
.sbb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.sbb-head-text {
  min-width: 0;
}
.sbb-crumb {
  color: var(--rc-faint);
  font-size: 12px;
  line-height: 1.5;
}
.sbb-title {
  margin: 2px 0 0;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}

/* 主体：唯一的滚动容器；底部按钮栏固定在弹窗底部 */
.sbb-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding: 12px 16px 4px;
  overflow: auto;
}
.sbb-card,
.sbb-receipt {
  flex: none;
}
.sbb-hgroup {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.sbb-ctitle {
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.sbb-num {
  color: var(--rc-primary);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sbb-hint {
  color: var(--rc-faint);
  font-size: 12px;
  font-weight: 400;
}
.sbb-flabel {
  color: var(--rc-muted);
  font-size: 12px;
}
.sbb-select {
  width: 152px;
}
.sbb-input {
  width: 208px;
}
.sbb-check {
  margin-right: 0;
}
.sbb-modes {
  flex-wrap: wrap;
}
.sbb-right {
  margin-left: auto;
}
/* 默认流程勾选单独成行，和上面的范围按钮组留 8px 间距 */
.sbb-default-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 2px 16px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.sbb-default-note {
  color: var(--rc-muted);
  font-size: 12px;
}

/* 预览表：表头吸顶，表格自己横滚，纵向只有 .sbb-body 一个滚动条 */
.sbb-table-wrap {
  flex: none;
  max-height: 302px;
}
.sbb-table {
  min-width: 800px;
  table-layout: fixed;
}
.sbb-table :deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 1;
}
.sbb-col-check {
  width: 44px;
}
.sbb-col-src {
  width: 232px;
}
.sbb-col-site {
  width: 132px;
}
/* 当前绑定列放宽：长流程名单行省略 + tooltip 看全名 */
.sbb-col-bind {
  width: 246px;
}
.sbb-cell-src {
  color: var(--rc-text);
}
.sbb-mono {
  color: var(--rc-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sbb-bind {
  max-width: 100%;
}
.sbb-bind-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sbb-why {
  display: block;
  overflow: hidden;
  color: var(--rc-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sbb-empty-td {
  padding: 26px 12px;
  color: var(--rc-faint);
  font-size: 12px;
  text-align: center;
}
.sbb-empty-td .sbb-hint {
  display: block;
  margin-top: 4px;
}
.sbb-tfoot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-top: 1px solid var(--rc-border-soft);
  background: var(--rc-surface);
}
.sbb-meta {
  color: var(--rc-text-2);
  font-size: 12px;
}
.sbb-meta b {
  color: var(--rc-text);
  font-variant-numeric: tabular-nums;
}
.sbb-pager {
  flex: none;
}

/* 回执：计数网格用 rc-mini-card 承载，文案口径不变 */
.sbb-receipt {
  flex: none;
}
.sbb-receipt-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
}
/* 统计条：每项独立分隔（竖细线 + 16px 内边距），数字加粗 + 等宽数字，
   长说明（需单独确认 / 不计入合计 / 可重试）落到第二行，不再挤成一条文字流 */
.sbb-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 10px 0;
  margin-top: 0;
  padding: 10px 16px;
}
.sbb-stat {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 5px;
  padding: 0 16px;
  color: var(--rc-text-2);
  font-size: 12px;
}
.sbb-stat:first-child {
  padding-left: 0;
}
.sbb-stat + .sbb-stat {
  border-left: 1px solid var(--rc-border);
}
.sbb-stat b {
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sbb-stat-note {
  flex: 1 0 100%;
  color: var(--rc-faint);
  font-size: 12px;
  line-height: 1.5;
}
.sbb-stat.warn b {
  color: var(--rc-warn);
}
.sbb-stat.total b {
  color: var(--rc-primary);
}
.sbb-why-block {
  margin: 0;
  color: var(--rc-muted);
  font-size: 12px;
  line-height: 1.6;
}
.sbb-why-block b {
  color: var(--rc-text-2);
}
.sbb-alert-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.sbb-alert-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 分批进度 */
.sbb-job-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
}
.sbb-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sbb-progress {
  flex: 1 1 auto;
  min-width: 120px;
}
.sbb-failures {
  overflow: hidden;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm);
  background: var(--rc-warn-bg);
}
.sbb-failures-head {
  padding: 6px 10px;
  border-bottom: 1px solid var(--rc-border);
  background: var(--rc-surface);
  color: var(--rc-warn);
  font-size: 12px;
  font-weight: 700;
}
.sbb-failures ul {
  max-height: 132px;
  margin: 0;
  padding: 6px 10px;
  overflow: auto;
  list-style: none;
}
.sbb-failures li {
  color: var(--rc-text-2);
  font-size: 12px;
  line-height: 1.7;
}
.sbb-fail-reason {
  color: var(--rc-muted);
  font-size: 12px;
}

/* 底部按钮栏：不参与滚动 */
.sbb-foot {
  flex: 0 0 auto;
  padding: 10px 16px;
  border-top: 1px solid var(--rc-border-soft);
  background: var(--rc-surface);
}
.sbb-foot-hint {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
}
</style>