<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
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
const router = useRouter()
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
const size = 20
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

let taskRequest = 0
async function loadTasks() {
  const requestId = ++taskRequest
  const query = {
    siteId: siteId.value,
    sourceId: filters.sourceId || undefined,
    nodeId: filters.nodeId || undefined,
    configId: configIdForNode(filters.nodeId),
    state: (filters.state || undefined) as 'L' | 'C' | 'E' | undefined,
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
    const result = await sourceApi.sourceTaskPaged(query)
    if (requestId !== taskRequest) return
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
  } catch {
    if (requestId !== taskRequest) return
    rows.value = []
    total.value = 0
    ElMessage.warning('加载任务记录失败')
  } finally {
    if (requestId === taskRequest) loading.value = false
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
function previousPage() {
  page.value = Math.max(1, page.value - 1)
  loadTasks()
}
function nextPage() {
  if (page.value * size >= total.value) return
  page.value += 1
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

function openDataView() {
  const navSiteId = siteId.value
  void router.push({
    path: '/canvas',
    query: {
      ...(navSiteId ? { siteId: navSiteId } : {}),
      sourceId: sourceId.value,
      view: 'data',
      ...(filters.nodeId ? { nodeId: filters.nodeId } : {}),
    },
  })
}
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

        <div class="tv-banner" data-testid="task-view-banner">
          这里是任务运行记录；要看节点产出的数据请去数据视图
          <button v-if="!siteWide" class="tv-jump" type="button" data-testid="task-goto-data" @click="openDataView">打开数据视图 →</button>
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
              <td><span class="rc-status" :class="stateClass(task.state)">{{ stateText(task.state) }}</span></td>
              <td class="tv-time">{{ task.updatedAt || '—' }}</td>
            </tr>
            <tr v-if="!rows.length && !loading"><td :colspan="showSourceColumn ? 10 : 9" class="tv-empty-row">没有匹配的任务记录</td></tr>
          </tbody>
        </table>
        <div class="tv-pager">
          <span class="muted">共 {{ total }} 条</span>
          <button class="rc-btn" type="button" :disabled="page <= 1" @click="previousPage">上一页</button>
          <span class="muted">第 {{ page }} 页</span>
          <button class="rc-btn" type="button" :disabled="page * size >= total" @click="nextPage">下一页</button>
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
.tv-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; padding: 8px 10px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; color: var(--rc-text-2); font-size: 12px; }
.tv-jump { height: 24px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 999px; background: #fff; color: var(--rc-primary); font-size: 11.5px; cursor: pointer; }
.tv-jump:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.tv-next-fields { margin: 0 0 10px; color: var(--rc-muted); font-size: 12px; }
.tv-input { height: 28px; min-width: 112px; padding: 0 10px; color: var(--rc-text); border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; font-size: 12px; }
.tv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.tv-filters .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.tv-table { width: 100%; }
.tv-id, .tv-time { color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 11px; }
.tv-pager .rc-btn { height: 26px; padding: 0 9px; font-size: 11px; }
.tv-pager { justify-content: flex-end; margin-top: 10px; margin-bottom: 0; }
.tv-empty-row { padding: 28px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.muted { color: var(--rc-faint); font-size: 12px; }
</style>
