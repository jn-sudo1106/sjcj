<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, siteApi, sourceApi, type NodeRunStat, type Source, type Step, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useAuthStore } from '@/stores/auth'
import { confirmDanger } from '@/utils/confirmDanger'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { buildHorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'
import { nextStepTokens } from '@/utils/flow/nextStepFields'

// 任务是源的运行事实：源画布下只看当前源；网站详情页（siteWide）聚合看全部源。
//
// 0915-05（2026-09-16）：`siteWide` 此前只有单测在用，页面上没有任何入口渲染过它。
// 接进网站详情页时补了两处——① siteId 不能再只从 `flow.sourceCtx` 取（网站态压根没有 sourceCtx，
// 取到空串会被 loadTasks 的守卫短路成空列表）；② 空态判定同理，见下方 hasContext。
const props = defineProps<{ siteWide?: boolean; siteId?: string }>()
const flow = useFlowStore()
const source = computed(() => flow.sourceCtx)
const sourceId = computed(() => source.value?.sourceId ?? '')
// 网站态由 props 给；源态仍从当前源的上下文取。
const siteId = computed(() => props.siteId || source.value?.siteId || '')
/** 有没有查询上下文：网站态只要有 siteId，源态要有 sourceCtx。 */
const hasContext = computed(() => (props.siteWide ? !!siteId.value : !!source.value))

/**
 * 网站级聚合查询的后端就绪开关（0915-05 / 后端需求 B15）。
 *
 * 2026-09-16 生产实测：`task/topTaskPaged` **只认 sourceId，不认 siteId** ——
 * `?siteId=11` 与 `?siteId=4` 都返回 `count: 0`，`?sourceId=430016944` 返回 122 条。
 * `sourceApi.sourceTaskPaged` 的 httpParams（`api/index.ts:598`）里也从来没有 siteId 这一项。
 *
 * 在后端支持之前，网站态发这个请求必然得 0 条，页面会显示"没有匹配的任务记录"——
 * 那是**误导**（看着像这个网站没任务，实为接口不支持）。所以这里直接不发请求，给明确说明。
 *
 * **后端加上 siteId 后**：把本常量改成 `true`，并在 `api/index.ts:598` 的 httpParams 里补 `siteId`，
 * 页面即恢复正常查询；本文件其余逻辑无需改动。
 */
const SITE_WIDE_BACKEND_READY = false
/** 网站态、且没有收窄到具体源时，聚合查询不可用。 */
const siteWidePending = computed(() => !!props.siteWide && !SITE_WIDE_BACKEND_READY && !filters.sourceId)
const siteSources = ref<Source[]>([])
const stepsBySource = ref<Record<string, Step[]>>({})
const nodeRunsBySource = ref<Record<string, NodeRunStat[]>>({})
const rows = ref<TaskInst[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(20)
const filters = reactive({ sourceId: '', nodeId: '', state: '', queue: '' })
const processLayout = computed(() => buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }))
const sourceNames = computed(() => Object.fromEntries(siteSources.value.map((item) => [item.sourceId, item.name])))
const showSourceColumn = computed(() => !filters.sourceId)
const filterSteps = computed(() => {
  const sourceIds = filters.sourceId ? [filters.sourceId] : siteSources.value.map((source) => source.sourceId)
  return sourceIds.flatMap((id) => (stepsBySource.value[id] ?? []).map((step) => ({ ...step, sourceId: id })))
})
const availableQueues = computed(() => {
  const set = new Set<string>()
  for (const step of filterSteps.value) {
    if (step.topic) set.add(step.topic)
  }
  for (const runs of Object.values(nodeRunsBySource.value)) {
    for (const run of runs) {
      if (run.queue) set.add(run.queue)
    }
  }
  for (const cfg of Object.values(flow.configs)) {
    if (cfg.taskCfg?.queue) set.add(cfg.taskCfg.queue)
  }
  for (const row of rows.value) {
    if (row.topic) set.add(row.topic)
  }
  return Array.from(set).filter(Boolean).sort()
})

let metadataRequest = 0
async function loadNodeMetadata() {
  const requestId = ++metadataRequest
  // ⚠️ 网站态**未选定具体源时不拉**：这里是每个源两个请求（steps + nodeRuns），
  // 而一个网站可以有 6496 个源（实测「上市公司(已复核)」），照源态的写法会打出一万多个请求。
  // 代价是未选源时「流程节点」列退回展示原始节点标识、队列名只认 task.topic——
  // 选定某个源后即恢复完整信息，这是本视图里唯一需要节点元数据的场景。
  const sourceIds = filters.sourceId
    ? [filters.sourceId]
    : props.siteWide ? [] : siteSources.value.map((source) => source.sourceId)
  if (!sourceIds.length) {
    stepsBySource.value = {}
    nodeRunsBySource.value = {}
    return
  }
  try {
    const metadata = await Promise.all(sourceIds.map(async (id) => {
      const [steps, nodeRuns] = await Promise.all([sourceApi.sourceSteps(id), sourceApi.sourceNodeRuns(id)])
      return { id, steps, nodeRuns }
    }))
    if (requestId !== metadataRequest) return
    stepsBySource.value = Object.fromEntries(metadata.map(({ id, steps }) => [id, steps]))
    nodeRunsBySource.value = Object.fromEntries(metadata.map(({ id, nodeRuns }) => [id, nodeRuns]))
  } catch {
    if (requestId !== metadataRequest) return
    stepsBySource.value = {}
    nodeRunsBySource.value = {}
    ElMessage.warning('加载流程节点失败')
  }
}

async function loadSiteSources() {
  // 聚合查询用不了时连源列表也不必拉：大站这一条是 6496 行的响应，拉回来没有任何消费方。
  if (siteWidePending.value) {
    siteSources.value = []
    return
  }
  const currentSiteId = siteId.value
  try {
    const result = currentSiteId ? await siteApi.siteSources(currentSiteId) : []
    if (currentSiteId !== siteId.value) return
    siteSources.value = result
  } catch {
    if (currentSiteId !== siteId.value) return
    siteSources.value = []
    ElMessage.warning('加载所属源失败')
  }
}

function configIdForNode(nodeId: string): string | undefined {
  if (!nodeId) return undefined
  const fromFlow = flow.configs[nodeId]?.configId
  if (fromFlow) return fromFlow
  return filterSteps.value.find((step) => step.stepId === nodeId)?.configId || undefined
}

// 任务视图无自动刷新时，「运行中」的任务会一直挂在旧快照上（后端跑完了界面不知道）。
// 列表里只要还有 state==='L' 的任务，就每 10s 静默重拉一次，全部 C/E 后自动停。
const REFRESH_MS = 10_000
let pollTimer: ReturnType<typeof setInterval> | undefined
const autoRefreshing = computed(() => rows.value.some((t) => t.state === 'L'))

// 重发 = task/resetTaskInsts（danger:true）。写入口对非 admin 隐藏，与 TaskInstDialog 同口径。
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
function resendTask(task: TaskInst) {
  void confirmDanger(
    '重发任务',
    `将把任务 ${task.taskId}（${task.taskName || '—'}）重置为待发送，重新排队执行，是否继续？`,
    () => dataApi.resendTask([task.taskId]),
    (res) => {
      ElMessage.success(res?.message || `任务 ${task.taskId} 已重置为待发送`)
      void loadTasks()
    },
  )
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined }
}
function syncPoll() {
  if (autoRefreshing.value && !pollTimer) {
    pollTimer = setInterval(() => void loadTasks({ silent: true }), REFRESH_MS)
  } else if (!autoRefreshing.value) {
    stopPoll()
  }
}
onUnmounted(stopPoll)

let taskRequest = 0
async function loadTasks(opts: { silent?: boolean } = {}) {
  const requestId = ++taskRequest
  const query = {
    siteId: siteId.value,
    sourceId: filters.sourceId || undefined,
    nodeId: filters.nodeId || undefined,
    configId: configIdForNode(filters.nodeId),
    state: (filters.state || undefined) as 'L' | 'C' | 'E' | undefined,
    queue: filters.queue?.trim() || undefined,
    topic: filters.queue?.trim() || undefined,
    page: page.value,
    size: size.value,
  }
  if (!query.siteId || siteWidePending.value) {
    rows.value = []
    total.value = 0
    stopPoll()
    return
  }
  if (!opts.silent) loading.value = true
  try {
    const result = await sourceApi.sourceTaskPaged(query)
    if (requestId !== taskRequest) return
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
    syncPoll()
  } catch {
    if (requestId !== taskRequest) return
    if (!opts.silent) {
      rows.value = []
      total.value = 0
      ElMessage.warning('加载任务记录失败')
    }
    // 静默轮询失败不清空列表、不打扰，下个周期再试
  } finally {
    if (requestId === taskRequest && !opts.silent) loading.value = false
  }
}

watch([siteId, sourceId], async () => {
  page.value = 1
  filters.sourceId = props.siteWide ? '' : sourceId.value
  filters.nodeId = ''
  filters.state = ''
  filters.queue = ''
  await loadSiteSources()
}, { immediate: true })

watch(filterSteps, () => {
  if (filters.nodeId && filterSteps.value.length > 0 && !filterSteps.value.some((step) => step.stepId === filters.nodeId)) {
    filters.nodeId = ''
  }
})

watch(() => [filters.sourceId, filters.nodeId, filters.state, filters.queue] as const, ([nextSourceId], previous) => {
  page.value = 1
  void Promise.all([nextSourceId !== previous?.[0] ? loadNodeMetadata() : Promise.resolve(), loadTasks()])
}, { immediate: true })

function onSelectNode(id: string) {
  filters.nodeId = filters.nodeId === id ? '' : id
}

function onSelectQueue(q?: string) {
  const target = q && q !== '—' ? q.trim() : ''
  if (!target) return
  filters.queue = filters.queue === target ? '' : target
}

function resetFilters() {
  filters.sourceId = props.siteWide ? '' : sourceId.value
  filters.nodeId = ''
  filters.state = ''
  filters.queue = ''
}

function nodeName(task: TaskInst): string {
  const steps = stepsBySource.value[task.sourceId] ?? []
  const byStepId = steps.find((step) => step.stepId === task.node)
  if (byStepId) return byStepId.name
  const byConfig = task.configId ? steps.find((step) => step.configId === task.configId) : undefined
  if (byConfig) return byConfig.name
  const fromFlow = task.configId
    ? Object.values(flow.configs).find((cfg) => cfg.configId === task.configId)?.title
    : undefined
  return fromFlow || task.node || '—'
}
function nodeRun(taskSourceId: string, nodeId?: string): NodeRunStat | undefined {
  return nodeRunsBySource.value[taskSourceId]?.find((run) => run.nodeId === nodeId)
}
function queueName(task: TaskInst): string {
  return task.topic || nodeRun(task.sourceId, task.node)?.queue || '—'
}
function stateText(state: TaskInst['state']): string {
  return state === 'L' ? '运行中' : state === 'E' ? '异常' : state === 'C' ? '完成' : (state || '—')
}
function stateClass(state: TaskInst['state']): string {
  return state === 'L' ? 'run' : state === 'E' ? 'err' : 'ok'
}
/** 改每页条数后回到第 1 页：旧页码在新的页大小下多半越界 */
function onSizeChange() {
  page.value = 1
  loadTasks()
}

const nextStepHints = computed(() => {
  if (!filters.nodeId) return []
  return nextStepTokens({
    main: flow.main,
    configs: flow.configs,
    branchGroups: flow.branchGroups,
    nodeId: filters.nodeId,
  })
})

</script>

<template>
  <main class="tv-shell">
    <CanvasHeader v-if="!siteWide" />
    <div class="tv-body">
      <div v-if="!hasContext" class="tv-empty-row">{{ siteWide ? '未指定网站，无法查看任务。' : '任务视图仅在源详情下可用。' }}</div>
      <div v-else-if="siteWidePending" class="tv-pending" data-testid="task-site-wide-pending">
        <p class="tv-pending-main">按网站聚合查看任务，后端接口尚未支持。</p>
        <p class="tv-pending-sub">
          任务查询接口目前只能按<b>单个源</b>过滤（实测传网站 ID 返回 0 条），
          所以这里暂时列不出本网站全部源的任务。后端支持后本页会自动恢复。
        </p>
        <p class="tv-pending-sub">临时办法：从左侧源列表点进具体的源，在该源的「任务视图」里查看。</p>
      </div>
      <template v-else>
        <div v-if="!siteWide" class="tv-process-rail" data-testid="task-process-rail">
          <ProcessNodeRail :model-value="filters.nodeId" :layout="processLayout" @update:model-value="onSelectNode" />
        </div>

        <p v-if="nextStepHints.length" class="tv-next-fields" data-testid="task-next-fields">
          下一节点会用到：{{ nextStepHints.join('、') }}
        </p>
        <div class="tv-filters">
          <select v-if="siteWide" v-model="filters.nodeId" class="tv-input" data-testid="task-node-filter" aria-label="流程节点">
            <option value="">全部节点</option>
            <option v-for="step in filterSteps" :key="`${step.sourceId}-${step.stepId}`" :value="step.stepId">{{ showSourceColumn ? `${sourceNames[step.sourceId] || step.sourceId} · ${step.name}` : step.name }}</option>
          </select>
          <select v-model="filters.state" class="tv-input" aria-label="任务状态">
            <option value="">状态（全部）</option>
            <option value="C">完成</option>
            <option value="L">运行中</option>
            <option value="E">异常</option>
          </select>
          <input
            v-model="filters.queue"
            class="tv-input tv-queue-input"
            data-testid="task-queue-filter"
            placeholder="队列名筛选"
            list="task-queue-options"
            aria-label="队列名"
          />
          <datalist id="task-queue-options">
            <option v-for="q in availableQueues" :key="q" :value="q" />
          </datalist>
          <button class="rc-btn" type="button" @click="resetFilters">清空</button>
          <button class="rc-btn" type="button" data-testid="task-refresh" :disabled="loading" @click="() => loadTasks()">刷新</button>
          <span v-if="autoRefreshing" class="tv-auto" data-testid="task-auto-refresh">
            <span class="tv-spin" />有任务运行中，每 10 秒自动刷新
          </span>
        </div>

        <table class="rc-data-table tv-table" data-testid="source-task-table" v-loading="loading">
          <thead>
            <tr><th>任务 ID</th><th v-if="showSourceColumn">所属源</th><th>流程节点</th><th>任务名称</th><th>队列</th><th>总任务数</th><th>已处理数</th><th>类型</th><th>状态</th><th>更新时间</th><th v-if="canWrite">操作</th></tr>
          </thead>
          <tbody>
            <tr v-for="task in rows" :key="task.taskId">
              <td class="tv-id">{{ task.taskId }}</td>
              <td v-if="showSourceColumn">{{ sourceNames[task.sourceId] || task.sourceId }}</td>
              <td>{{ nodeName(task) }}</td>
              <td>{{ task.taskName }}</td>
              <td
                class="tv-queue-cell"
                :class="{ 'tv-queue-clickable': queueName(task) !== '—' }"
                :title="queueName(task) !== '—' ? '点击按此队列筛选' : undefined"
                @click="onSelectQueue(queueName(task))"
              >
                {{ queueName(task) }}
              </td>
              <td>{{ nodeRun(task.sourceId, task.node)?.totalTasks ?? '—' }}</td>
              <td>{{ nodeRun(task.sourceId, task.node)?.processedTasks ?? '—' }}</td>
              <td>{{ task.typeName }}</td>
              <td>
                <span class="rc-status" :class="stateClass(task.state)">
                  <span v-if="task.state === 'L'" class="tv-spin" />{{ stateText(task.state) }}
                </span>
              </td>
              <td class="tv-time">{{ task.updatedAt || '—' }}</td>
              <td v-if="canWrite">
                <button class="tv-resend" type="button" data-testid="task-resend" @click="resendTask(task)">重发</button>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading"><td :colspan="(showSourceColumn ? 10 : 9) + (canWrite ? 1 : 0)" class="tv-empty-row">没有匹配的任务记录</td></tr>
          </tbody>
        </table>
        <!-- 分页与数据中心统一（DataQueryPanel 的 .dqp-pager 同款 el-pagination） -->
        <div class="tv-pager">
          <el-pagination
            data-testid="task-pagination"
            v-model:current-page="page"
            v-model:page-size="size"
            :total="total"
            :page-sizes="[20, 40, 100, 200]"
            layout="total, sizes, prev, pager, next, jumper"
            background
            small
            @current-change="() => loadTasks()"
            @size-change="onSizeChange"
          />
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.tv-shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); }
.tv-body { flex: 1; overflow: auto; padding: 12px; }
.tv-process-rail { min-height: 80px; margin-bottom: 10px; overflow-x: auto; background: #f8fafc; border: 1px solid var(--rc-border-soft); border-radius: 6px; }
.tv-filters, .tv-pager { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.tv-next-fields { margin: 0 0 10px; color: var(--rc-muted); font-size: 12px; }
.tv-input { height: 28px; min-width: 112px; padding: 0 10px; color: var(--rc-text); border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; font-size: 12px; }
.tv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.tv-queue-input { min-width: 130px; }
.tv-pending { padding: 28px 24px; border: 1px dashed var(--rc-border); border-radius: 8px; background: var(--rc-primary-bg, #f8fafc); }
.tv-pending-main { margin: 0 0 8px; color: var(--rc-text-2); font-size: 13px; font-weight: 600; }
.tv-pending-sub { margin: 0 0 6px; color: var(--rc-faint); font-size: 12px; line-height: 1.7; }
.tv-queue-clickable { cursor: pointer; color: var(--rc-primary); }
.tv-queue-clickable:hover { text-decoration: underline; }
.tv-filters .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.tv-table { width: 100%; }
.tv-id, .tv-time { color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 11px; }
.tv-pager { justify-content: flex-end; gap: 12px; padding: 10px 16px; margin-top: 0; margin-bottom: 0; border-top: 1px solid var(--rc-border-soft); }
.tv-empty-row { padding: 28px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.muted { color: var(--rc-faint); font-size: 12px; }
.tv-auto { display: inline-flex; align-items: center; gap: 5px; margin-left: 4px; color: var(--rc-muted); font-size: 11px; }
.tv-resend { border: 0; background: transparent; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.tv-resend:hover { text-decoration: underline; }
.tv-spin { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: tv-spin 0.7s linear infinite; vertical-align: -1px; }
.rc-status.run .tv-spin { border-color: currentColor; border-top-color: transparent; }
@keyframes tv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tv-spin { animation-duration: 2s; } }
</style>
