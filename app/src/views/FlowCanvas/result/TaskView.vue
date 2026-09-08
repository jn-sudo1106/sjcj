<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type NodeRunStat, type Source, type Step, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import { buildHorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'
import { nextStepTokens } from '@/utils/flow/nextStepFields'

// 任务是源的运行事实：源画布下只看当前源；网站详情页（siteWide）聚合看全部源，不提供内部筛选。
const props = defineProps<{ siteWide?: boolean }>()
const flow = useFlowStore()
const source = computed(() => flow.sourceCtx)
const sourceId = computed(() => source.value?.sourceId ?? '')
const siteId = computed(() => source.value?.siteId ?? '')
const siteSources = ref<Source[]>([])
const stepsBySource = ref<Record<string, Step[]>>({})
const nodeRunsBySource = ref<Record<string, NodeRunStat[]>>({})
const rows = ref<TaskInst[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(20)
const filters = reactive({ sourceId: '', nodeId: '', state: '' })
const processLayout = computed(() => buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }))
const sourceNames = computed(() => Object.fromEntries(siteSources.value.map((item) => [item.sourceId, item.name])))
const showSourceColumn = computed(() => !filters.sourceId)
const filterSteps = computed(() => {
  const sourceIds = filters.sourceId ? [filters.sourceId] : siteSources.value.map((source) => source.sourceId)
  return sourceIds.flatMap((id) => (stepsBySource.value[id] ?? []).map((step) => ({ ...step, sourceId: id })))
})

let metadataRequest = 0
async function loadNodeMetadata() {
  const requestId = ++metadataRequest
  const sourceIds = filters.sourceId ? [filters.sourceId] : siteSources.value.map((source) => source.sourceId)
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
// 列表里只要还有「活跃的」state==='L' 任务，就每 10s 静默重拉一次，全部 C/E 后自动停。
const REFRESH_MS = 10_000
// 超过这个分钟数没更新的「运行中」任务，判为失联（后端 worker 挂了不会把 L 翻成 E）：
// 不再为它轮询，并在行上标「疑似卡住」——真实成败要看源的「上次成功」和数据视图。
const STUCK_MIN = 30
let pollTimer: ReturnType<typeof setInterval> | undefined
function staleMinutes(task: TaskInst): number {
  const t = new Date(String(task.updatedAt || '').replace(' ', 'T')).getTime()
  return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 60_000)
}
function isStuck(task: TaskInst): boolean {
  return task.state === 'L' && staleMinutes(task) >= STUCK_MIN
}
const autoRefreshing = computed(() => rows.value.some((t) => t.state === 'L' && !isStuck(t)))
const stuckCount = computed(() => rows.value.filter(isStuck).length)
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
    page: page.value,
    size: size.value,
  }
  if (!query.siteId) {
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

watch(sourceId, async () => {
  page.value = 1
  filters.sourceId = props.siteWide ? '' : sourceId.value
  filters.nodeId = ''
  filters.state = ''
  await loadSiteSources()
}, { immediate: true })

watch(filterSteps, () => {
  if (filters.nodeId && filterSteps.value.length > 0 && !filterSteps.value.some((step) => step.stepId === filters.nodeId)) {
    filters.nodeId = ''
  }
})

watch(() => [filters.sourceId, filters.nodeId, filters.state] as const, ([nextSourceId], previous) => {
  page.value = 1
  void Promise.all([nextSourceId !== previous?.[0] ? loadNodeMetadata() : Promise.resolve(), loadTasks()])
}, { immediate: true })

function onSelectNode(id: string) {
  filters.nodeId = filters.nodeId === id ? '' : id
}

function resetFilters() {
  filters.sourceId = props.siteWide ? '' : sourceId.value
  filters.nodeId = ''
  filters.state = ''
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
      <div v-if="!source" class="tv-empty-row">{{ siteWide ? '该网站暂无源，无法查看任务。' : '任务视图仅在源详情下可用。' }}</div>
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
          <button class="rc-btn" type="button" @click="resetFilters">清空</button>
          <button class="rc-btn" type="button" data-testid="task-refresh" :disabled="loading" @click="() => loadTasks()">刷新</button>
          <span v-if="autoRefreshing" class="tv-auto" data-testid="task-auto-refresh">
            <span class="tv-spin" />有任务运行中，每 10 秒自动刷新
          </span>
          <span v-if="stuckCount" class="tv-stuck-note" data-testid="task-stuck-note">
            {{ stuckCount }} 个任务超过 {{ STUCK_MIN }} 分钟无更新（疑似失联）——本轮成败请看源的「上次成功」时间与数据视图
          </span>
        </div>

        <table class="rc-data-table tv-table" data-testid="source-task-table" v-loading="loading">
          <thead>
            <tr><th>任务 ID</th><th v-if="showSourceColumn">所属源</th><th>流程节点</th><th>任务名称</th><th>队列</th><th>总任务数</th><th>已处理数</th><th>类型</th><th>状态</th><th>更新时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="task in rows" :key="task.taskId">
              <td class="tv-id">{{ task.taskId }}</td>
              <td v-if="showSourceColumn">{{ sourceNames[task.sourceId] || task.sourceId }}</td>
              <td>{{ nodeName(task) }}</td>
              <td>{{ task.taskName }}</td>
              <td>{{ queueName(task) }}</td>
              <td>{{ nodeRun(task.sourceId, task.node)?.totalTasks ?? '—' }}</td>
              <td>{{ nodeRun(task.sourceId, task.node)?.processedTasks ?? '—' }}</td>
              <td>{{ task.typeName }}</td>
              <td>
                <span class="rc-status" :class="[stateClass(task.state), { stuck: isStuck(task) }]">
                  <span v-if="task.state === 'L' && !isStuck(task)" class="tv-spin" />{{ stateText(task.state) }}
                </span>
                <span
                  v-if="isStuck(task)"
                  class="tv-stuck-tag"
                  title="该任务超过 30 分钟没有状态更新，后端很可能已失联（worker 挂了不会把「运行中」翻成「异常」）。这一轮到底成没成，看源头部的「上次成功」时间、以及数据 / 文件视图里有没有新数据落库。"
                >疑似卡住</span>
              </td>
              <td class="tv-time">{{ task.updatedAt || '—' }}</td>
            </tr>
            <tr v-if="!rows.length && !loading"><td :colspan="showSourceColumn ? 10 : 9" class="tv-empty-row">没有匹配的任务记录</td></tr>
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
.tv-filters .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.tv-table { width: 100%; }
.tv-id, .tv-time { color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 11px; }
.tv-pager { justify-content: flex-end; gap: 12px; padding: 10px 16px; margin-top: 0; margin-bottom: 0; border-top: 1px solid var(--rc-border-soft); }
.tv-empty-row { padding: 28px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.muted { color: var(--rc-faint); font-size: 12px; }
.tv-auto { display: inline-flex; align-items: center; gap: 5px; margin-left: 4px; color: var(--rc-muted); font-size: 11px; }
.tv-stuck-note { margin-left: 4px; color: #b45309; font-size: 11px; }
.rc-status.stuck { color: var(--rc-faint); }
.tv-stuck-tag { margin-left: 6px; padding: 1px 6px; border: 1px solid #fcd34d; border-radius: 4px; background: #fffbeb; color: #b45309; font-size: 10px; white-space: nowrap; cursor: help; }
.tv-spin { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: tv-spin 0.7s linear infinite; vertical-align: -1px; }
.rc-status.run .tv-spin { border-color: currentColor; border-top-color: transparent; }
@keyframes tv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tv-spin { animation-duration: 2s; } }
</style>
