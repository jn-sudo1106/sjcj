<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { dataApi, siteApi, sourceApi, type NodeRunStat, type Source, type Step, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useAuthStore } from '@/stores/auth'
import { confirmDanger } from '@/utils/confirmDanger'
import { toExternalHref } from '@/utils/url/externalUrl'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import { buildHorizontalLayout, nodeTaskQueue } from '@/views/FlowCanvas/canvas/flowModel'
import { useWorkspaceStore } from '@/stores/workspace'
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
 * 网站态「全部源」的查询范围（0915-05 / 后端需求 B15）。
 *
 * 走 `topTaskPaged` 的 `siteId`（后端 2026-09-16 加、2026-09-17 修好 SQL）：一个参数圈定
 * 整站来源，分页和排序都在后端做，源再多也只发一个请求。
 * 实测站 11（6496 源）→ 6526 条、335ms，抽查本页 200 条的 sourceId 全部属于该站。
 *
 * 同批后端还给了 `sourceIds`（逗号分隔源 ID），本页**有意不用**：它把源 ID 全拼进 URL，
 * 实测 500 个（5.0KB）还行、800 个（8.0KB）400、1073 个（10.8KB）414，上限卡在 URL 长度上，
 * 三个上市公司大站都超。`siteId` 修好后它在这里没有存在价值，留着只会多一条要维护的路径。
 */
const siteScopeId = computed(() => (props.siteWide && !filters.sourceId ? siteId.value : ''))
/**
 * 网站态未收窄到单源、又没有 siteId 时不能发请求：不带任何来源过滤的 topTaskPaged
 * 查的是**全平台**任务，不是本网站的。
 */
const siteWideBlocked = computed(() => !!props.siteWide && !filters.sourceId && !siteScopeId.value)
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
/**
 * 「所属源」列（0917-02 起可点）。
 *
 * **筛到了某一个源就不显示**：那时整列每行都是同一个值，130px 纯浪费。
 * 源态画布下 `filters.sourceId` 恒空（那个下拉只在网站态出现），所以源态照常显示这一列——
 * 0917-02 要的"具体源态下也能点源名"并不需要把这个条件改成恒真。
 *
 * 2026-09-22：这里一度被改成 `computed(() => true)`，连带下面的 `v-if` 和 colspan 三元
 * 都成了走不到的死分支；按用户要求恢复原语义。
 */
const showSourceColumn = computed(() => !filters.sourceId)
const nodeQueues = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  const targetSourceId = filters.sourceId || sourceId.value
  const steps = stepsBySource.value[targetSourceId] ?? []
  const runs = nodeRunsBySource.value[targetSourceId] ?? []
  for (const node of processLayout.value.nodes) {
    const fromFlow = nodeTaskQueue(node.cfg)
    if (fromFlow) {
      map[node.id] = fromFlow
      continue
    }
    const fromStep = steps.find((s) => s.stepId === node.id)?.topic
    if (fromStep) {
      map[node.id] = fromStep
      continue
    }
    const fromRun = runs.find((r) => r.nodeId === node.id)?.queue
    if (fromRun) {
      map[node.id] = fromRun
    }
  }
  return map
})
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
  const currentSiteId = siteId.value
  if (!currentSiteId) {
    siteSources.value = []
    return
  }
  try {
    // 源列表只用来把表格里的 sourceId 显示成源名、以及填「源」筛选下拉，**不参与查询**
    // （查询靠 siteId 一个参数）。所以它慢不阻塞任务表：拿不到就退化成显示源 ID。
    const result = await siteApi.siteSources(currentSiteId)
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
const router = useRouter()
const ws = useWorkspaceStore()
const detailTask = ref<TaskInst | null>(null)
const detailVisible = ref(false)

async function ensureSourceMetadata(targetSourceId: string) {
  if (!targetSourceId || stepsBySource.value[targetSourceId]) return
  try {
    const [steps, nodeRuns] = await Promise.all([
      sourceApi.sourceSteps(targetSourceId),
      sourceApi.sourceNodeRuns(targetSourceId),
    ])
    stepsBySource.value = {
      ...stepsBySource.value,
      [targetSourceId]: steps,
    }
    nodeRunsBySource.value = {
      ...nodeRunsBySource.value,
      [targetSourceId]: nodeRuns,
    }
  } catch {
    // 失败时不打扰，nodeName 会回退到 task.node
  }
}

function openDetail(task: TaskInst) {
  detailTask.value = task
  detailVisible.value = true
  if (task.sourceId && !stepsBySource.value[task.sourceId]) {
    void ensureSourceMetadata(task.sourceId)
  }
}

/**
 * 这条任务对应的**真节点 ID**（2026-09-22 修）。
 *
 * `task.node` 映射自后端 `nodeCode`，实测那是**队列名**（`nodeCode: "news_wechat"`，
 * 同一条记录的 `stepId` 是 null），不是步骤 ID。而数据视图按节点 ID 选中节点
 * （`ResultView` 的 `allNodes.some(n => n.id === id)`，node id = stepId），
 * 直接把 `task.node` 当 nodeId 传过去**永远匹配不上**：跳过去停在原先选中的节点上，
 * 多节点源就会在错的表里查这条数据、得到 0 条。
 *
 * 解析口径与 {@link nodeName} 一致：先按 stepId 对（万一后端哪天真给 stepId），
 * 再按 configId 找回那一步。都找不到就**不传 nodeId**——传一个无效值只会留在 URL 里误导人。
 */
function stepIdOfTask(task: TaskInst): string {
  const steps = stepsBySource.value[task.sourceId] ?? []
  const byStepId = steps.find((step) => step.stepId === task.node)
  if (byStepId) return byStepId.stepId
  const byConfig = task.configId ? steps.find((step) => step.configId === task.configId) : undefined
  return byConfig?.stepId ?? ''
}

function onLocateData(task: TaskInst) {
  if (!task.bizId) return
  const nodeId = stepIdOfTask(task)
  void router.push({
    path: '/canvas',
    query: {
      siteId: siteId.value || undefined,
      sourceId: task.sourceId,
      view: 'data',
      dataId: task.bizId,
      ...(nodeId ? { nodeId } : {}),
    },
  })
}

function openSource(task: TaskInst) {
  if (!task.sourceId) return
  const name = sourceNames.value[task.sourceId] || (flow.sourceCtx?.sourceId === task.sourceId ? flow.sourceCtx.name : '') || task.sourceId
  // 满 8 个时 ws.open 返回 false（页签条加不上，但内容照常显示）。**照常跳，但得说一句**——
  // 否则点了源名，页签条一动不动，没有任何解释（2026-09-22 补；另两处调用
  // FlowCanvas/index.vue 与 SiteDataView.vue 一直是这么做的，这里漏了）。
  if (!ws.open(task.sourceId, name)) {
    ElMessage.warning('页签已达上限（8 个），这个源没能加进页签条——内容照常显示，关掉几个页签后重新进入即可固定')
  }
  ws.activate(task.sourceId)
  detailVisible.value = false
  void router.push({
    path: '/canvas',
    query: {
      siteId: siteId.value || undefined,
      sourceId: task.sourceId,
      view: 'task',
    },
  })
}

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
    // 网站态「全部源」：只在这时传 siteId，交给后端圈定整站来源（见 api/index.ts 的说明）。
    siteScopeId: siteScopeId.value || undefined,
    nodeId: filters.nodeId || undefined,
    configId: configIdForNode(filters.nodeId),
    state: (filters.state || undefined) as 'L' | 'C' | 'E' | undefined,
    queue: filters.queue?.trim() || undefined,
    topic: filters.queue?.trim() || undefined,
    page: page.value,
    size: size.value,
  }
  if (!query.siteId || siteWideBlocked.value) {
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

// 换源就把节点筛选清掉：节点 ID 是源内的，换了源就不成立。
// 上面那个 filterSteps 守卫在**回到「全部源」**时兜不住——网站态不选源就不拉步骤元数据，
// filterSteps 是空数组，`length > 0` 的前提不满足，于是旧 nodeId 会继续作用在查询上，
// 而节点下拉这时是不渲染的，用户看不见也清不掉。必须排在下面那个查询 watch 之前。
watch(() => filters.sourceId, () => { filters.nodeId = '' })

watch(() => [filters.sourceId, filters.nodeId, filters.state, filters.queue, siteScopeId.value] as const, ([nextSourceId], previous) => {
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
  if (task.topic) return task.topic
  const runQueue = nodeRun(task.sourceId, task.node)?.queue
  if (runQueue) return runQueue
  const steps = stepsBySource.value[task.sourceId] ?? []
  // ⚠️ `s.stepId === task.node` 这半边永远不成立（task.node 是 nodeCode/队列名，见 stepIdOfTask），
  // 真正起作用的是 configId 那半边。留着是因为后端哪天把 stepId 填上就自然生效。
  const stepQueue = steps.find((s) => s.stepId === task.node || (task.configId && s.configId === task.configId))?.topic
  if (stepQueue) return stepQueue
  // 原来这里还有一级 `flow.configs[task.configId]?.taskCfg?.queue`，**键用错了**：
  // configs 是按 stepId 键的（flowModel.seeds.ts 的 `configs[step.stepId] = ...`），
  // configId 是另一套 ID，取出来恒 undefined。看着像兜底，其实是死代码，删掉（2026-09-22）。
  return '—'
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
      <template v-else>
        <div v-if="!siteWide" class="tv-process-rail" data-testid="task-process-rail">
          <ProcessNodeRail :model-value="filters.nodeId" :layout="processLayout" :node-queues="nodeQueues" @update:model-value="onSelectNode" />
        </div>

        <p v-if="nextStepHints.length" class="tv-next-fields" data-testid="task-next-fields">
          下一节点会用到：{{ nextStepHints.join('、') }}
        </p>
        <div class="tv-filters">
          <!-- 网站态第一格是**源**，跟数据/文件/监控视图同一个选择器（2026-09-17 用户提）：
               那几个视图都从「全部源 → 具体源」开始收窄，只有这里一上来给的是节点。
               而节点下拉在没选源时本来就是空的——loadNodeMetadata 在网站态未选源时不拉
               步骤元数据（6496 个源要打一万多个请求），所以它当时只剩一个「全部节点」。 -->
          <SiteSourceSelect v-if="siteWide && siteId" v-model="filters.sourceId" :site-id="siteId" />
          <select v-if="siteWide && filters.sourceId" v-model="filters.nodeId" class="tv-input" data-testid="task-node-filter" aria-label="流程节点">
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
          <colgroup>
            <col style="width: 110px" />
            <col v-if="showSourceColumn" style="width: 130px" />
            <col style="width: 110px" />
            <col style="width: 120px" />
            <col style="width: 110px" />
            <col style="width: 180px" />
            <col style="width: 180px" />
            <col style="width: 80px" />
            <col style="width: 80px" />
            <col style="width: 80px" />
            <col style="width: 80px" />
            <col style="width: 140px" />
            <col style="width: 110px" />
          </colgroup>
          <thead>
            <tr>
              <th>任务 ID</th>
              <th v-if="showSourceColumn">所属源</th>
              <th>流程节点</th>
              <th>任务名称</th>
              <th>数据 ID</th>
              <th>任务 URL</th>
              <th>队列</th>
              <th>总任务数</th>
              <th>已处理数</th>
              <th>类型</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in rows" :key="task.taskId">
              <td class="tv-id">
                <a
                  v-if="task.taskId"
                  class="tv-link tv-id-link"
                  role="button"
                  tabindex="0"
                  data-testid="task-id-link"
                  :title="`查看任务详情: ${task.taskId}`"
                  @click="openDetail(task)"
                  @keydown.enter="openDetail(task)"
                >{{ task.taskId }}</a>
                <span v-else class="muted">—</span>
              </td>
              <td v-if="showSourceColumn">
                <a
                  v-if="task.sourceId"
                  class="tv-link tv-source-link"
                  role="button"
                  tabindex="0"
                  data-testid="task-source-link"
                  :title="`打开源: ${sourceNames[task.sourceId] || task.sourceId}`"
                  @click="openSource(task)"
                  @keydown.enter="openSource(task)"
                >{{ sourceNames[task.sourceId] || task.sourceId }}</a>
                <span v-else class="muted">—</span>
              </td>
              <td>{{ nodeName(task) }}</td>
              <td>{{ task.taskName }}</td>
              <td>
                <a
                  v-if="task.bizId"
                  class="tv-link"
                  role="button"
                  tabindex="0"
                  data-testid="task-biz-link"
                  :title="`定位数据 ID: ${task.bizId}`"
                  @click="onLocateData(task)"
                  @keydown.enter="onLocateData(task)"
                >{{ task.bizId }}</a>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <a
                  v-if="toExternalHref(task.taskUrl)"
                  class="tv-link tv-url-link"
                  :href="toExternalHref(task.taskUrl)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :title="task.taskUrl"
                  data-testid="task-url-link"
                >{{ task.taskUrl }}</a>
                <span v-else class="muted">—</span>
              </td>
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
              <td class="tv-actions-cell">
                <button class="tv-action-btn" type="button" data-testid="task-detail-btn" @click="openDetail(task)">详情</button>
                <button v-if="canWrite" class="tv-resend" type="button" data-testid="task-resend" @click="resendTask(task)">重发</button>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading"><td :colspan="showSourceColumn ? 13 : 12" class="tv-empty-row">没有匹配的任务记录</td></tr>
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
    <TaskDetailDrawer
      v-model="detailVisible"
      :task="detailTask"
      :source-name="detailTask ? (sourceNames[detailTask.sourceId] || detailTask.sourceId) : ''"
      :step-name="detailTask ? nodeName(detailTask) : ''"
      @locate-data="onLocateData"
      @open-source="openSource"
    />
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
.tv-link { color: var(--rc-primary); text-decoration: none; cursor: pointer; }
.tv-link:hover { text-decoration: underline; }
.tv-id-link { color: var(--rc-primary); font-family: var(--rc-mono, monospace); font-size: 11px; }
.tv-source-link { display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.tv-url-link { display: inline-block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.tv-queue-cell { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ⚠️ 这里**不能设 display**：给 <td> 设 inline-flex/flex 会让它不再是 table-cell，
   colgroup 那条 110px 直接失效（浏览器实测：同表 200px 的列加上 inline-flex 后实测 95px）。
   要的只是两个按钮别换行 + 有点间距，用 nowrap ＋ 相邻间距就够（2026-09-22）。 */
.tv-actions-cell { white-space: nowrap; }
.tv-action-btn + .tv-resend { margin-left: 8px; }
.tv-action-btn { border: 0; background: transparent; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.tv-action-btn:hover { text-decoration: underline; }
.tv-spin { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: tv-spin 0.7s linear infinite; vertical-align: -1px; }
.rc-status.run .tv-spin { border-color: currentColor; border-top-color: transparent; }
@keyframes tv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .tv-spin { animation-duration: 2s; } }
</style>
