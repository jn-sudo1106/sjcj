<script setup lang="ts">
import { computed, onActivated, onDeactivated, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { dataApi, siteApi, sourceApi, type NodeRunStat, type Source, type Step, type TaskInst } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useAuthStore } from '@/stores/auth'
import { confirmDanger } from '@/utils/confirmDanger'
import { toExternalHref } from '@/utils/url/externalUrl'
import CanvasHeader from '@/views/FlowCanvas/shared/CanvasHeader.vue'
import ProcessNodeRail from './ProcessNodeRail.vue'
import RailResizeHandle from './RailResizeHandle.vue'
import RailNodePicker from './components/RailNodePicker.vue'
import RailCollapseButton from './components/RailCollapseButton.vue'
import { taskTopicList } from '@/api/taskTopics'
import { initialRailOpen, readResultRailHeight } from './resultLayoutPref'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import GlobalSourceSelect from './components/GlobalSourceSelect.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import { buildHorizontalLayout, nodeTaskQueue } from '@/views/FlowCanvas/canvas/flowModel'
import { useWorkspaceStore } from '@/stores/workspace'
import { nextStepTokens } from '@/utils/flow/nextStepFields'
import { taskDataId } from './taskIds'

// 流程图区最大高度（0928，与数据视图共用同一偏好）：超出在区内滚动，底边分隔条拖拽调整
const railHeight = ref(readResultRailHeight())
// 流程图区默认收起（0930-02，会上：视图展开后空间不够），每次进来都收起、不记住展开。
// 收起时有节点下拉（首项「全部节点」），不展开也能换节点。
const railOpen = ref(initialRailOpen())
const railNodeOptions = computed(() => processLayout.value.nodes.map((n) => ({ id: n.id, title: n.cfg.title })))
function pickRailNode(id: string) {
  filters.nodeId = id
  form.nodeId = id
}

// 任务是源的运行事实：源画布下只看当前源；网站详情页（siteWide）聚合看全部源。
//
// 0915-05（2026-09-16）：`siteWide` 此前只有单测在用，页面上没有任何入口渲染过它。
// 接进网站详情页时补了两处——① siteId 不能再只从 `flow.sourceCtx` 取（网站态压根没有 sourceCtx，
// 取到空串会被 loadTasks 的守卫短路成空列表）；② 空态判定同理，见下方 hasContext。
const props = defineProps<{ siteWide?: boolean; siteId?: string; global?: boolean }>()
const flow = useFlowStore()
const source = computed(() => flow.sourceCtx)
const sourceId = computed(() => props.global ? '' : (source.value?.sourceId ?? ''))
// 网站态由 props 给；源态仍从当前源的上下文取。
const siteId = computed(() => props.global ? '' : (props.siteId || source.value?.siteId || ''))
/** 有没有查询上下文：网站态只要有 siteId，源态要有 sourceCtx。 */
const hasContext = computed(() => props.global || (props.siteWide ? !!siteId.value : !!source.value))

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
const globalSourceNames = ref<Record<string, string>>({})
const stepsBySource = ref<Record<string, Step[]>>({})
const nodeRunsBySource = ref<Record<string, NodeRunStat[]>>({})
const rows = ref<TaskInst[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(20)
/** 已生效的查询条件：查询 watch 只盯这一份 */
const filters = reactive({ sourceId: '', nodeId: '', state: '', queue: '', taskId: '', parentId: '', taskUrl: '', startTime: '', endTime: '' })
/**
 * 筛选栏上的草稿（2026-09-23 用户要求：跟源 / 数据 / 文件视图一样，改完点「查询」才查）。
 *
 * 此前每改一格就立刻发一次请求，站 11 这种大站选个日期、切个状态都要等。
 * 以下几个"点了就是要看结果"的动作仍立即生效，同时把草稿同步过去，免得两边对不上：
 * 点表格里的队列名、源态下点节点条、网站态切换具体的源（换查看对象，不算调条件）。
 */
const form = reactive({ nodeId: '', state: '', queue: '', startTime: '', endTime: '' })

/**
 * 创建时间区间（0920-04 会上：「支持一个当天，然后支持一个范围」；后端 B27 于 2026-09-23 加）。
 *
 * 只传日期（YYYY-MM-DD），后端自己补成当天 00:00:00 ~ 23:59:59.999，两端闭区间。
 * 日期面板选不出结束早于开始、也不会出非法格式，所以后端那条 code=1 在这里碰不到。
 * 口径是任务的**创建时间**（CREATE_DT）；表格那一列也随之从「更新时间」换成「创建时间」（2026-09-23 用户要求），
 * 否则按「今天」筛完，列表里看到的却是另一个时间（实测站 11 最近 200 条里 47 条两者不同）。
 */
const dateRange = computed<string[] | null>({
  get: () => (form.startTime && form.endTime ? [form.startTime, form.endTime] : null),
  set: (value: string[] | null) => {
    form.startTime = value?.[0] ?? ''
    form.endTime = value?.[1] ?? ''
  },
})
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}
/** 本地日期 YYYY-MM-DD（与日期组件 value-format 一致；不用 toISOString，那是 UTC，凌晨会差一天） */
function todayText(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const DATE_SHORTCUTS = [
  { text: '今天', value: () => [daysAgo(0), daysAgo(0)] },
  { text: '近 3 天', value: () => [daysAgo(2), daysAgo(0)] },
  { text: '近 7 天', value: () => [daysAgo(6), daysAgo(0)] },
]

/**
 * 「字段 ▾ ＋ 输入框」查询（0920-04，样式同源视图 0917-11 的三合一），回车才查。
 *
 * 2026-09-23 实测 topTaskPaged 只认 `taskId`；数据 ID、任务 URL 试了近 20 种参数名全被忽略
 * （提后端 B32）。那两项先放在下拉里但**禁用**：能看到规划，又不会填了没反应——
 * 队列筛选当初（B24，后端 0923 才补上）就是前车之鉴。后端加上后把 ready 改成 true、query 里带上即可。
 *
 * 2026-09-28：**数据 ID 放开了，参数是 `parentId`**——当时漏试的就是它（数据 ID 本来就是任务的
 * parentId，见 taskIds.ts；旧平台 TaskInst.vue 的「父ID」筛选同一个参数）。实测源 430017712
 * 共 83 条，parentId=1035124 → 2 条（它的 OCR 与摘要任务），不存在的 ID → 0 条。
 *
 * 2026-09-29：**任务 URL 放开，参数 `taskUrl`**（后端 topTaskPaged-api.md：按 task_inst.TASK_URL
 * 子串匹配，纯空白视为未传）。实测站 11：不带 58 万条；`mp.weixin.qq.com` → 536；某条 URL 的
 * 路径片段 → 4 条（同一 URL 的 4 次任务）；不存在的 → 0。
 */
type TaskSearchField = 'taskId' | 'parentId' | 'taskUrl'
const TASK_SEARCH_FIELDS: { value: TaskSearchField; label: string; placeholder: string; ready: boolean }[] = [
  { value: 'taskId', label: '任务 ID', placeholder: '输入任务 ID，回车查询', ready: true },
  { value: 'parentId', label: '数据 ID', placeholder: '输入数据 ID，回车查询', ready: true },
  { value: 'taskUrl', label: '任务 URL', placeholder: '输入任务 URL 片段，回车查询', ready: true },
]
const searchField = ref<TaskSearchField>('taskId')
const searchText = ref('')
const searchPlaceholder = computed(() => TASK_SEARCH_FIELDS.find((f) => f.value === searchField.value)?.placeholder ?? '')
const processLayout = computed(() => buildHorizontalLayout(flow.main, flow.branches, flow.configs, flow.branchGroups, { includeTerminals: false }))
const sourceNames = computed(() => ({ ...globalSourceNames.value, ...Object.fromEntries(siteSources.value.map((item) => [item.sourceId, item.name])) }))
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
/** 当前数据里能看到的队列：节点步骤 / 节点运行统计 / 流程节点配置 / 当前这页任务 */
const currentQueues = computed(() => {
  const set = new Set<string>()
  for (const step of filterSteps.value) {
    if (step.topic) set.add(step.topic)
  }
  for (const runs of Object.values(nodeRunsBySource.value)) {
    for (const run of runs) {
      if (run.queue) set.add(run.queue)
    }
  }
  if (!props.global) {
    for (const cfg of Object.values(flow.configs)) {
      if (cfg.taskCfg?.queue) set.add(cfg.taskCfg.queue)
    }
  }
  // 与表格「队列」列同一口径（queueName）：任务行没带 topic 时也按节点运行 / 步骤补出队列名
  for (const row of rows.value) {
    const queue = queueName(row)
    if (queue !== '—') set.add(queue)
  }
  return Array.from(set).filter(Boolean)
})
/**
 * 队列名下拉的候选（1016）：只增不减——按队列查询后当前页只剩这一个队列，候选不能跟着收缩成一项，
 * 否则没法直接切到别的队列。换了网站 / 源范围才重新累计（别把别的网站的队列带过来）。
 */
const seenQueues = ref<string[]>([])
watch(siteScopeId, () => { seenQueues.value = [] })
watch(currentQueues, (queues) => {
  const merged = new Set([...seenQueues.value, ...queues])
  if (merged.size !== seenQueues.value.length) seenQueues.value = [...merged]
}, { immediate: true })
// 后端给的全部队列：已加载行里没出现过的队列（还没查过的）也要能选；接口不可用时只剩上面的累计
const allTopics = ref<string[]>([])
let topicRequest = 0
async function loadAllTopics() {
  const requestId = ++topicRequest
  const query = {
    startTime: filters.startTime, endTime: filters.endTime,
    sourceId: filters.sourceId, siteId: siteScopeId.value,
  }
  // 没有任何范围条件时后端回空，不发
  if (!query.startTime && !query.endTime && !query.sourceId && !query.siteId) { allTopics.value = []; return }
  try {
    const topics = await taskTopicList(query)
    if (requestId === topicRequest) allTopics.value = topics
  } catch { /* 接口不可用：只用已加载行累计的候选 */ }
}
watch(() => [filters.startTime, filters.endTime, filters.sourceId, siteScopeId.value] as const, loadAllTopics, { immediate: true })
const availableQueues = computed(() => [...new Set([...allTopics.value, ...seenQueues.value])].sort())

let metadataRequest = 0
async function loadNodeMetadata() {
  const requestId = ++metadataRequest
  // ⚠️ 网站态**未选定具体源时不拉**：这里是每个源两个请求（steps + nodeRuns），
  // 而一个网站可以有 6496 个源（实测「上市公司(已复核)」），照源态的写法会打出一万多个请求。
  // 代价是未选源时「流程节点」列退回展示原始节点标识、队列名只认 task.topic——
  // 选定某个源后即恢复完整信息，这是本视图里唯一需要节点元数据的场景。
  const sourceIds = filters.sourceId
    ? [filters.sourceId]
    : props.siteWide || props.global ? [] : siteSources.value.map((source) => source.sourceId)
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
  if (props.global) return
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
  const fromFlow = props.global ? undefined : flow.configs[nodeId]?.configId
  if (fromFlow) return fromFlow
  return filterSteps.value.find((step) => step.stepId === nodeId)?.configId || undefined
}

/**
 * 自动刷新：**手动开关，默认关**（0920-05；2026-09-23 落地）。
 *
 * 原来是"列表里还有 state==='L' 就每 10s 重拉、全部 C/E 后自动停"。但任务终态不回写（B26，
 * 87 万条永远停在 L），这个条件恒为真，打开页签就一直在打请求、一直转圈。会上原话：
 * 「让他来一个按钮点一下就开始刷新，不点的话就不要这么转」。
 * 开着时每 10s 按**已生效**的条件静默重拉（不管有没有运行中的任务）；关掉就停，离开页面也停。
 */
const REFRESH_MS = 10_000
let pollTimer: ReturnType<typeof setInterval> | undefined
const autoRefresh = ref(false)

// 重发 = task/resetTaskInsts（danger:true）。写入口对非 admin 隐藏，与 TaskInstDialog 同口径。
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const router = useRouter()
const route = useRoute()
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

/**
 * 「数据 ID」那条数据所在的节点（2026-09-28）：任务处理的是**它输入表里**的数据，
 * 也就是上游节点产出的那一行，要定位到上游节点（它的输出表 = 本任务节点的输入表），
 * 而不是任务自己的节点——后者的输出表是这条任务产出的数据，不一定是同一张表。
 * 输入、输出同一张表时就用任务自己的节点：那种流程（如公众号 1400976 三个节点全落 6200029）
 * 往前找"输出这张表的节点"会撞上兄弟分支，高亮一个不相干的节点。上游找不到时也退回自己的节点。
 */
function dataStepIdOfTask(task: TaskInst): string {
  const own = stepIdOfTask(task)
  const steps = stepsBySource.value[task.sourceId] ?? []
  const index = steps.findIndex((step) => step.stepId === own)
  const input = index >= 0 ? steps[index]!.inputTable : ''
  if (!input || input === steps[index]!.outputTable) return own
  const upstream = steps.slice(0, index).reverse().find((step) => step.outputTable === input)
  return upstream?.stepId ?? own
}

async function onLocateData(task: TaskInst) {
  const dataId = taskDataId(task)
  if (!dataId) return
  // 全局/网站任务列表不预加载全部源的步骤，定位单条数据时再查它所属源。
  if (!stepsBySource.value[task.sourceId]) await ensureSourceMetadata(task.sourceId)
  const nodeId = dataStepIdOfTask(task)
  void router.push({
    path: '/canvas',
    query: {
      siteId: siteId.value || undefined,
      sourceId: task.sourceId,
      view: 'data',
      dataId,
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
function startPoll() {
  stopPoll()
  if (autoRefresh.value) pollTimer = setInterval(() => void loadTasks({ silent: true }), REFRESH_MS)
}
watch(autoRefresh, startPoll)
onUnmounted(stopPoll)
// 任务中心被 KeepAlive 缓存（AppShell include TaskCenter）：离开时停轮询，回来时按开关恢复，结果不重查
onDeactivated(stopPoll)
onActivated(startPoll)

/**
 * 加载等待提示（2026-10-10）：任务中心只按创建时间查时，topTaskPaged 在 217 上一次要十几秒
 * （实测今天全天 16.6s、近 1 小时 10.7s，时间窗缩小也快不了，疑似 CREATE_DT 没走索引，已提后端）。
 * 超过 2 秒才出提示，带源 / 状态等条件的查询通常不到 1 秒，看不到它。
 */
const loadingSeconds = ref(0)
let loadingTicker: ReturnType<typeof setInterval> | undefined
watch(loading, (on) => {
  if (loadingTicker) { clearInterval(loadingTicker); loadingTicker = undefined }
  loadingSeconds.value = 0
  if (on && props.global) loadingTicker = setInterval(() => { loadingSeconds.value += 1 }, 1000)
})
onUnmounted(() => { if (loadingTicker) clearInterval(loadingTicker) })

let taskRequest = 0
async function loadGlobalSourceNames(tasks: TaskInst[]) {
  if (!props.global) return
  const ids = [...new Set(tasks.map((task) => task.sourceId).filter((id) => id && !globalSourceNames.value[id]))]
  if (!ids.length) return
  try {
    const result = await sourceApi.sourcePaged({ sourceIds: ids, page: 1, size: ids.length })
    globalSourceNames.value = {
      ...globalSourceNames.value,
      ...Object.fromEntries(result.list.map((item) => [item.sourceId, item.name])),
    }
  } catch {
    // 源名查询失败仍显示源 ID，不影响任务列表。
  }
}
/**
 * 任务中心（global）一个条件都没有：topTaskPaged 不带过滤参数时后端直接回空（topTaskPaged-api.md §三-2，
 * 防全表扫描），发了也白发。这时不发请求，空态提示去选条件，而不是说「没有匹配的任务记录」。
 * 源态 / 网站态天然带 sourceId / siteId，不受影响。
 */
const globalNoCondition = computed(() => !!props.global
  && !filters.sourceId && !filters.nodeId && !filters.state && !filters.queue?.trim()
  && !filters.taskId && !filters.parentId && !filters.taskUrl && !filters.startTime && !filters.endTime)

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
    taskId: filters.taskId || undefined,
    parentId: filters.parentId || undefined,
    taskUrl: filters.taskUrl || undefined,
    startTime: filters.startTime || undefined,
    endTime: filters.endTime || undefined,
    page: page.value,
    size: size.value,
  }
  if ((!props.global && !query.siteId) || siteWideBlocked.value || globalNoCondition.value) {
    rows.value = []
    total.value = 0
    return
  }
  if (!opts.silent) loading.value = true
  try {
    const result = await sourceApi.sourceTaskPaged(query)
    if (requestId !== taskRequest) return
    rows.value = result?.list ?? []
    total.value = result?.total ?? 0
    void loadGlobalSourceNames(rows.value)
  } catch (error) {
    if (requestId !== taskRequest) return
    if (!opts.silent) {
      rows.value = []
      total.value = 0
      // 超时（请求被中断）单独说人话：只按创建时间查时后端很慢，加条件能快很多
      if (error instanceof Error && /abort/i.test(error.message)) {
        ElMessage.warning('查询超时：后端 60 秒内没有返回。只按创建时间查询较慢，请加上源、状态等条件后重试')
      } else {
        // 后端参数校验失败会带原因（如时间范围不合法），给出来比笼统一句好排查
        const reason = error instanceof Error && error.message ? `：${error.message}` : ''
        ElMessage.warning(`加载任务记录失败${reason}`)
      }
    }
    // 静默轮询失败不清空列表、不打扰，下个周期再试
  } finally {
    if (requestId === taskRequest && !opts.silent) loading.value = false
  }
}

watch([siteId, sourceId], async () => {
  page.value = 1
  filters.sourceId = props.siteWide || props.global ? '' : sourceId.value
  filters.nodeId = ''
  // 任务中心默认「今天 + 异常」（2026-10-10 用户定）：只按今天查要十几秒，加上异常 0.2 秒；地址栏带了 state 以它为准
  filters.state = props.global ? String(Array.isArray(route.query.state) ? route.query.state[0] ?? '' : route.query.state ?? 'E') : ''
  filters.queue = ''
  filters.taskId = ''
  filters.parentId = ''
  filters.taskUrl = ''
  // 任务中心默认只看今天创建的（2026-10-10 用户定）：不带条件后端回空；清空后不再补，改为提示选条件
  filters.startTime = props.global ? todayText() : ''
  filters.endTime = filters.startTime
  Object.assign(form, { nodeId: '', state: filters.state, queue: '', startTime: filters.startTime, endTime: filters.endTime })
  searchText.value = ''
  await loadSiteSources()
}, { immediate: true })

watch(filterSteps, () => {
  if (filters.nodeId && filterSteps.value.length > 0 && !filterSteps.value.some((step) => step.stepId === filters.nodeId)) {
    filters.nodeId = ''
    form.nodeId = ''
  }
})

// 换源就把节点筛选清掉：节点 ID 是源内的，换了源就不成立。
// 上面那个 filterSteps 守卫在**回到「全部源」**时兜不住——网站态不选源就不拉步骤元数据，
// filterSteps 是空数组，`length > 0` 的前提不满足，于是旧 nodeId 会继续作用在查询上，
// 而节点下拉这时是不渲染的，用户看不见也清不掉。必须排在下面那个查询 watch 之前。
watch(() => filters.sourceId, () => { filters.nodeId = ''; form.nodeId = '' })

watch(() => [filters.sourceId, filters.nodeId, filters.state, filters.queue, filters.taskId, filters.parentId, filters.taskUrl, filters.startTime, filters.endTime, siteScopeId.value] as const, ([nextSourceId], previous) => {
  page.value = 1
  void Promise.all([nextSourceId !== previous?.[0] ? loadNodeMetadata() : Promise.resolve(), loadTasks()])
}, { immediate: true })

// 下面两个是"点了就要看结果"的快捷筛选：立即生效，草稿跟着改
function onSelectNode(id: string) {
  filters.nodeId = filters.nodeId === id ? '' : id
  form.nodeId = filters.nodeId
}

function onSelectQueue(q?: string) {
  const target = q && q !== '—' ? q.trim() : ''
  if (!target) return
  filters.queue = filters.queue === target ? '' : target
  form.queue = filters.queue
}

/** 草稿折算成查询条件（任务 ID / 数据 ID / 任务 URL 来自「字段 ▾ ＋ 输入框」） */
function draftConditions() {
  return {
    nodeId: form.nodeId,
    state: form.state,
    queue: form.queue.trim(),
    taskId: searchField.value === 'taskId' ? searchText.value.trim() : '',
    parentId: searchField.value === 'parentId' ? searchText.value.trim() : '',
    taskUrl: searchField.value === 'taskUrl' ? searchText.value.trim() : '',
    startTime: form.startTime,
    endTime: form.endTime,
  }
}

/** 草稿和已生效的条件不一样 → 提示「条件已修改，点查询执行」 */
const filtersDirty = computed(() => {
  const draft = draftConditions()
  return (Object.keys(draft) as (keyof typeof draft)[]).some((key) => draft[key] !== filters[key])
})

/**
 * 「查询」/ 输入框回车：把草稿一次性生效。条件有变由查询 watch 去拉（一次）；
 * 条件没变（比如同样的条件再点一次）watch 不会触发，手动重查——点了查询总得有反应。
 */
function runQuery() {
  const changed = filtersDirty.value
  Object.assign(filters, draftConditions())
  if (!changed) {
    page.value = 1
    void loadTasks()
  }
}

/** 清空：草稿和条件都回到初始，并立即查一次 */
function resetFilters() {
  Object.assign(form, { nodeId: '', state: '', queue: '', startTime: '', endTime: '' })
  searchText.value = ''
  const sourceBefore = filters.sourceId
  filters.sourceId = props.siteWide || props.global ? '' : sourceId.value
  const changed = filtersDirty.value || filters.sourceId !== sourceBefore
  Object.assign(filters, draftConditions())
  if (!changed) {
    page.value = 1
    void loadTasks()
  }
}

function nodeName(task: TaskInst): string {
  const steps = stepsBySource.value[task.sourceId] ?? []
  const byStepId = steps.find((step) => step.stepId === task.node)
  if (byStepId) return byStepId.name
  const byConfig = task.configId ? steps.find((step) => step.configId === task.configId) : undefined
  if (byConfig) return byConfig.name
  const fromFlow = !props.global && task.configId
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
  if (props.global) return []
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
    <CanvasHeader v-if="!siteWide && !global" />
    <div class="tv-body">
      <div v-if="!hasContext" class="tv-empty-row">{{ siteWide ? '未指定网站，无法查看任务。' : '任务视图仅在源详情下可用。' }}</div>
      <template v-else>
        <div v-if="global" class="tv-global-head">
          <div class="tv-global-title">任务中心</div>
          <div class="tv-global-sub">查看和管理全部源的任务，可按源、节点、状态和创建时间筛选。</div>
        </div>
        <template v-if="!siteWide && !global && railOpen">
          <!-- 展开后与源数据视图一致：节点下拉隐藏，收起按钮在流程图右上角 -->
          <div class="tv-railbox">
            <div class="tv-process-rail" data-testid="task-process-rail" :style="{ maxHeight: `${railHeight}px` }">
              <ProcessNodeRail :model-value="filters.nodeId" :layout="processLayout" :node-queues="nodeQueues" @update:model-value="onSelectNode" />
            </div>
            <RailCollapseButton testid="task-rail-toggle" @collapse="railOpen = false" />
          </div>
          <RailResizeHandle v-model="railHeight" class="tv-rail-resize" />
        </template>

        <p v-if="nextStepHints.length" class="tv-next-fields" data-testid="task-next-fields">
          下一节点会用到：{{ nextStepHints.join('、') }}
        </p>
        <div class="tv-filters">
          <!-- 网站态第一格是**源**，跟数据/文件/监控视图同一个选择器（2026-09-17 用户提）：
               那几个视图都从「全部源 → 具体源」开始收窄，只有这里一上来给的是节点。
               而节点下拉在没选源时本来就是空的——loadNodeMetadata 在网站态未选源时不拉
               步骤元数据（6496 个源要打一万多个请求），所以它当时只剩一个「全部节点」。 -->
          <SiteSourceSelect v-if="siteWide && siteId" v-model="filters.sourceId" :site-id="siteId" />
          <GlobalSourceSelect v-if="global" v-model="filters.sourceId" data-testid="task-global-source-filter" />
          <!-- 源画布：节点下拉 + 流程图开合并进筛选行首位（0930-02），不单独占一行 -->
          <RailNodePicker
            v-if="!siteWide && !global && !railOpen"
            v-model:open="railOpen"
            :model-value="filters.nodeId"
            :nodes="railNodeOptions"
            all-label="全部节点"
            toggle-testid="task-rail-toggle"
            @update:model-value="pickRailNode"
          />
          <select v-if="(siteWide || global) && filters.sourceId" v-model="form.nodeId" class="tv-input" data-testid="task-node-filter" aria-label="流程节点">
            <option value="">全部节点</option>
            <option v-for="step in filterSteps" :key="`${step.sourceId}-${step.stepId}`" :value="step.stepId">{{ showSourceColumn ? `${sourceNames[step.sourceId] || step.sourceId} · ${step.name}` : step.name }}</option>
          </select>
          <span class="tv-search">
            <select v-model="searchField" class="tv-input tv-search-field" data-testid="task-search-field" aria-label="查询字段">
              <option v-for="f in TASK_SEARCH_FIELDS" :key="f.value" :value="f.value" :disabled="!f.ready">{{ f.label }}</option>
            </select>
            <input
              v-model="searchText"
              class="tv-input tv-search-input"
              data-testid="task-search-text"
              :placeholder="searchPlaceholder"
              aria-label="查询内容"
              @keyup.enter="runQuery"
            />
          </span>
          <el-date-picker
            v-model="dateRange"
            class="tv-date-range"
            data-testid="task-date-range"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="创建时间起"
            end-placeholder="创建时间止"
            :shortcuts="DATE_SHORTCUTS"
            size="small"
            unlink-panels
          />
          <select v-model="form.state" class="tv-input" data-testid="task-state-filter" aria-label="任务状态">
            <option value="">状态（全部）</option>
            <option value="C">完成</option>
            <option value="L">运行中</option>
            <option value="E">异常</option>
          </select>
          <!-- 1016：原来是 input + datalist，浏览器按框里已有的文字过滤候选，选中一个后下拉只剩它自己。
               改成可搜索下拉：候选始终列全部队列，可清空，也能手输候选里没有的队列名 -->
          <el-select
            v-model="form.queue"
            class="tv-queue-select"
            data-testid="task-queue-filter"
            placeholder="队列名筛选"
            aria-label="队列名"
            filterable
            clearable
            allow-create
            default-first-option
            size="small"
            :empty-values="['', null, undefined]"
            :value-on-clear="''"
          >
            <el-option v-for="q in availableQueues" :key="q" :label="q" :value="q" />
          </el-select>
          <!-- 按钮靠右，与源视图一致（2026-09-23 用户要求） -->
          <span class="tv-actions">
            <button class="rc-btn primary" type="button" data-testid="task-query" :disabled="loading" @click="runQuery">查询</button>
            <button class="rc-btn" type="button" @click="resetFilters">清空</button>
            <!-- 刷新用项目统一的紧凑图标按钮（与网站列表工具条同款），自动刷新是它旁边的轻量开关 -->
            <button class="tv-icon-btn" type="button" data-testid="task-refresh" :disabled="loading" title="按当前已生效的条件重新拉取" aria-label="刷新" @click="() => loadTasks()">
              <el-icon :size="14"><Refresh /></el-icon>
            </button>
            <label class="tv-auto" data-testid="task-auto-refresh" title="开启后每 10 秒按当前条件重新拉取一次">
              <el-switch v-model="autoRefresh" size="small" data-testid="task-auto-refresh-switch" />
              <span>自动刷新</span><span class="tv-auto-state" :class="{ on: autoRefresh }">{{ autoRefresh ? '开 · 10 秒' : '关' }}</span>
            </label>
          </span>
        </div>
        <p v-if="filtersDirty && !loading" class="tv-dirty" role="status" data-testid="task-filters-dirty">查询条件已修改，点「查询」执行</p>
        <p v-if="loading && loadingSeconds >= 2" class="tv-slow" role="status" data-testid="task-slow-hint">查询中，已等待 {{ loadingSeconds }} 秒。只按创建时间查询时后端较慢，加上源、状态等条件会快很多。</p>

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
              <th>类型</th>
              <th>状态</th>
              <th>创建时间</th>
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
                <!-- 源名拿到了才另起一行显示 ID；没拿到时链接本身显示的就是 ID，不重复 -->
                <div v-if="task.sourceId && sourceNames[task.sourceId]" class="tv-source-id" data-testid="task-source-id">{{ task.sourceId }}</div>
              </td>
              <td>{{ nodeName(task) }}</td>
              <td>{{ task.taskName }}</td>
              <td>
                <!-- 数据 ID 取 parentId（触发这条任务的数据），不是 bizId（运行上下文 ID），见 taskIds.ts -->
                <a
                  v-if="taskDataId(task)"
                  class="tv-link"
                  role="button"
                  tabindex="0"
                  data-testid="task-biz-link"
                  :title="`定位数据 ID: ${taskDataId(task)}`"
                  @click="onLocateData(task)"
                  @keydown.enter="onLocateData(task)"
                >{{ taskDataId(task) }}</a>
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
              <td>{{ task.typeName }}</td>
              <td>
                <span class="rc-status" :class="stateClass(task.state)">
                  <span v-if="task.state === 'L'" class="tv-spin" />{{ stateText(task.state) }}
                </span>
              </td>
              <td class="tv-time">{{ task.createdAt || '—' }}</td>
              <td class="tv-actions-cell">
                <button class="tv-action-btn" type="button" data-testid="task-detail-btn" @click="openDetail(task)">详情</button>
                <button v-if="canWrite" class="tv-resend" type="button" data-testid="task-resend" @click="resendTask(task)">重发</button>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading"><td :colspan="showSourceColumn ? 11 : 10" class="tv-empty-row" data-testid="task-empty">{{ globalNoCondition ? '请至少选择源、节点、状态、队列、创建时间，或输入任务 ID / 数据 ID / 任务 URL 后查询' : '没有匹配的任务记录' }}</td></tr>
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
.tv-global-head { margin: 2px 0 14px; }
.tv-global-title { color: var(--rc-text); font-size: 17px; font-weight: 700; }
.tv-global-sub { margin-top: 4px; color: var(--rc-muted); font-size: 12px; }
.tv-rail-resize { margin: 2px 0 10px; border-radius: 3px; }
.tv-railbox { position: relative; }
.tv-process-rail { min-height: 80px; overflow: auto; background: #f8fafc; border: 1px solid var(--rc-border-soft); border-radius: 6px; }
.tv-filters, .tv-pager { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.tv-next-fields { margin: 0 0 10px; color: var(--rc-muted); font-size: 12px; }
.tv-input { height: 28px; min-width: 112px; padding: 0 10px; color: var(--rc-text); border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; font-size: 12px; }
.tv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.tv-queue-select { width: 180px; flex: none; }
.tv-search { display: inline-flex; gap: 4px; }
.tv-search-field { width: 88px; min-width: 0; }
.tv-search-input { width: 140px; min-width: 0; }
.tv-filters :deep(.tv-date-range) { flex: none; width: 200px; height: 28px; }
.tv-queue-clickable { cursor: pointer; color: var(--rc-primary); }
.tv-queue-clickable:hover { text-decoration: underline; }
.tv-filters .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; white-space: nowrap; }
/* 查询多了一格后（0920-04），13.6 寸屏 + 网站态左侧源栏时一行放不下：折行，别把按钮挤成竖排 */
.tv-filters { flex-wrap: wrap; row-gap: 6px; }
.tv-actions { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.tv-dirty { margin: -4px 0 10px; color: var(--rc-warning, #b45309); font-size: 12px; }
.tv-slow { margin: -4px 0 10px; color: var(--rc-muted); font-size: 12px; }
.tv-table { width: 100%; }
.tv-id, .tv-time { color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 11px; }
.tv-pager { justify-content: flex-end; gap: 12px; padding: 10px 16px; margin-top: 0; margin-bottom: 0; border-top: 1px solid var(--rc-border-soft); }
.tv-empty-row { padding: 28px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; }
.muted { color: var(--rc-faint); font-size: 12px; }
.tv-auto { display: inline-flex; align-items: center; gap: 5px; margin-left: 4px; color: var(--rc-muted); font-size: 12px; white-space: nowrap; cursor: pointer; }
.tv-auto-state { color: var(--rc-faint); font-size: 11px; }
.tv-auto-state.on { color: var(--rc-primary); }
.tv-icon-btn { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-muted); cursor: pointer; }
.tv-icon-btn:hover:not(:disabled) { border-color: #bfdbfe; color: var(--rc-primary); }
.tv-icon-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.tv-resend { border: 0; background: transparent; padding: 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.tv-resend:hover { text-decoration: underline; }
.tv-link { color: var(--rc-primary); text-decoration: none; cursor: pointer; }
.tv-link:hover { text-decoration: underline; }
.tv-id-link { color: var(--rc-primary); font-family: var(--rc-mono, monospace); font-size: 11px; }
.tv-source-link { display: inline-block; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.tv-source-id { color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 11px; }
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
