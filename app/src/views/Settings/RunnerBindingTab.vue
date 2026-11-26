<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { formatRunnerDateTime, formatRunnerHeartbeat } from '@/utils/format/runnerHeartbeat'
import { runnerManagementApi, type CodeRepository, type DeploymentConfiguration, type DirectoryDelivery, type DirectoryRunnerBinding, type RunnerInstance, type RuntimeConfiguration, type RuntimeConfigurationInput, type RunnerRetryPolicy, type RuntimeGitVersions } from '@/api/runnerManagement'
import { flowCenterApi, sourceApi } from '@/api'
import DirectoryDeliveryDialog from './DirectoryDeliveryDialog.vue'
import RunnerFilesDrawer from './RunnerFilesDrawer.vue'
import { targetPath } from './directoryLayout'

const props = defineProps<{ runnerId?: string }>()
const emit = defineEmits<{ busy: [value: boolean] }>()

const route = useRoute(), router = useRouter(), auth = useAuthStore()
const deploymentReturnPath = computed(() => router.resolve({ path: '/settings', query: {
  ...route.query, tab: 'runners', runnerId: props.runnerId || route.query.runnerId, view: undefined, returnTo: undefined,
} }).fullPath)
const canWrite = computed(() => auth.role === 'admin')
const rows = ref<RuntimeConfiguration[]>([]), configurations = ref<DeploymentConfiguration[]>([]), runners = ref<RunnerInstance[]>([])
const repositories = ref<CodeRepository[]>([]), repositoryError = ref('')
const sourceNames = ref<Record<string, string>>({})
function originalSourceLink(row: RuntimeConfiguration) {
  const source = row.sourceContext!
  return { path: '/canvas', query: { sourceId: source.sourceId, view: 'flow', flowId: source.flowId, nodeId: source.stepId } }
}
async function loadSourceNames(items: RuntimeConfiguration[], seq: number) {
  const ids = [...new Set(items.map(row => row.sourceContext?.sourceId).filter((id): id is string => !!id && !sourceNames.value[id]))]
  for (let index = 0; index < ids.length; index += 100) {
    try {
      const result = await sourceApi.sourcePaged({ sourceIds: ids.slice(index, index + 100), size: 100 })
      if (seq !== request || !active) return
      for (const source of result.list) sourceNames.value[source.sourceId] = source.name
    } catch { return } // The saved source ID remains a working link if its name cannot be read.
  }
}
const gitSources = computed(() => {
  const repos = new Map(repositories.value.map(repo => [repo.repoId, repo]))
  return new Map(configurations.value.map(layout => {
    const sources = new Map<string, { repoId: string; name: string; address: string; branch: string; directories: Set<string>; commits: Set<string> }>()
    for (const node of layout.nodes) {
      if (!node.repoId || !node.sourcePath) continue
      const repo = repos.get(node.repoId)
      let source = sources.get(node.repoId)
      if (!source) {
        source = { repoId: node.repoId, name: repo?.name || node.repoId, address: repo?.remoteUrl || repo?.path || '仓库地址未取得', branch: repo?.branch || '', directories: new Set(), commits: new Set() }
        sources.set(node.repoId, source)
      }
      const relative = targetPath(layout.nodes, node.id)
      const base = node.sourceType === 'directory' ? node.sourcePath
        : relative && node.sourcePath.endsWith('/' + relative) ? node.sourcePath.slice(0, -relative.length - 1)
          : node.sourcePath.split('/').slice(0, -1).join('/')
      source.directories.add(base)
      if (node.gitCommit) source.commits.add(node.gitCommit)
    }
    return [layout.deploymentId, [...sources.values()].map(source => ({ ...source, directories: [...source.directories], commits: [...source.commits] }))]
  }))
})
const keyword = ref(typeof route.query.configId === 'string' ? route.query.configId : '')
const machineFilter = ref(''), deliveryFilter = ref(''), page = ref(1), pageSize = ref(20)
function resetFilters() { keyword.value = ''; machineFilter.value = ''; deliveryFilter.value = ''; page.value = 1 }
defineExpose({ resetFilters })
watch(() => route.query.configId, value => {
  if (route.path === '/settings' && route.query.tab === 'runners') keyword.value = typeof value === 'string' ? value : ''
})
const loading = ref(false), saving = ref(false), error = ref(''), formError = ref('')
const editing = ref(false), editingRow = ref<RuntimeConfiguration | null>(null)
const controlling = ref(''), programErrors = ref<Record<string, string>>({})
const browsing = ref<{ runner: RunnerInstance; directory: string } | null>(null)
const defaultRetryPolicy = (): RunnerRetryPolicy => ({ enabled: true, maxAttempts: 5, windowSeconds: 300, delaysSeconds: [5, 15, 30, 60] })
const form = reactive<Omit<RuntimeConfigurationInput, 'environment' | 'retryPolicy'> & { retryPolicy: RunnerRetryPolicy }>({ deploymentId: '', layoutRevision: '', runnerId: '', concurrency: 1, retryPolicy: defaultRetryPolicy() })
const retryWindowMinutes = ref(5), retryDelays = ref('5, 15, 30, 60')
const machineMap = computed(() => new Map(runners.value.map(item => [item.runnerId, item])))
const configurationMap = computed(() => new Map(configurations.value.map(item => [item.deploymentId, item])))
const selectedConfiguration = computed(() => configurationMap.value.get(form.deploymentId))
const existingTask = computed(() => editingRow.value?.deploymentId === form.deploymentId ? editingRow.value.assignment : null)
const executionQueue = computed(() => {
  const queue = selectedConfiguration.value?.queueName ?? existingTask.value?.queue ?? ''
  return queue.startsWith('@deployment:') ? '' : queue
})
const hasExecution = computed(() => !!existingTask.value || !!selectedConfiguration.value?.entryPoint)
function unbound(row: RuntimeConfiguration) { return row.runtimeId.startsWith('unbound-') }
const scopedRows = computed(() => {
  const bound = rows.value.filter(item => !props.runnerId || item.runnerId === props.runnerId)
  const pending = configurations.value.filter(layout => !rows.value.some(row => {
    if (row.deploymentId === layout.deploymentId) return true
    const other = configurationMap.value.get(row.deploymentId)
    // A legacy definition for the same saved node is already represented by
    // its generated deployment. Keep its data; avoid a duplicate list entry.
    return !!layout.configId && other?.configId === layout.configId
      && !!layout.sourceNode && other.sourceNode?.flowId === layout.sourceNode.flowId && other.sourceNode?.stepId === layout.sourceNode.stepId
  })).map(layout => ({ runtimeId: 'unbound-' + layout.deploymentId, deploymentId: layout.deploymentId,
    name: layout.name, runnerId: props.runnerId || '', assignmentId: '', appliedRevision: '', layoutRevision: layout.revision,
    revision: '', directoryTemplate: layout.directoryTemplate, entryPoint: layout.entryPoint, binding: null, assignment: null } as RuntimeConfiguration))
  return [...bound, ...pending]
})
const filteredRows = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  return scopedRows.value.filter(item => {
    const configuration = configurationMap.value.get(item.deploymentId)
    return (!machineFilter.value || machineState(item.runnerId) === machineFilter.value) &&
      (!deliveryFilter.value || (item.binding?.delivery?.status || 'none') === deliveryFilter.value) &&
      [item.name, item.deploymentId, item.directoryTemplate, configurationId(item), configuration?.sourceNode?.nodeName || '',
        sourceNode(item)?.flowName || '', configuration?.sourceNode?.flowId || '', configuration?.sourceNode?.stepId || '',
        ...sourceNodes(item).flatMap(node => [node.flowName, node.flowId, node.nodeName, node.stepId]), runtimeQueue(item), nodeQueue(item), runnerLabel(item.runnerId), directoryPath(item), fullPath(item.runnerId, directoryPath(item)),
        ...(gitSources.value.get(item.deploymentId) || []).flatMap(source => [source.name, source.address, source.branch, ...source.directories])]
        .some(value => value.toLowerCase().includes(search))
  })
})
const visibleRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const boundMachines = computed(() => new Set(scopedRows.value.filter(row => !unbound(row)).map(row => row.runnerId)))
const onlineMachines = computed(() => [...boundMachines.value].filter(id => machineState(id) === 'online').length)
const deliveryRow = ref<RuntimeConfiguration | null>(null)
watch(() => editing.value || saving.value || !!controlling.value || !!deliveryRow.value, value => emit('busy', value), { immediate: true })
const deliveryBinding = computed<DirectoryRunnerBinding | null>(() => deliveryRow.value?.binding || null)
const machineStates = { online: '在线', offline: '离线', upgrading: '升级中', error: '异常', unknown: '状态未知' }
const deliveryStates = { none: '未下发', pending: '等待下发', running: '下发中', success: '已下发', failed: '下发失败' }
let active = true, initialized = false, request = 0, timer: ReturnType<typeof setTimeout> | undefined
const gitVersions = ref<Record<string, RuntimeGitVersions>>({}), gitVersionsLoading = ref(false), gitVersionsError = ref('')
let gitVersionRequest = 0
const gitVersionScope = computed(() => JSON.stringify(visibleRows.value.filter(row => gitSources.value.get(row.deploymentId)?.length).map(row => [
  row.runtimeId, row.runnerId, row.deploymentId, directoryPath(row), row.binding?.delivery?.deliveryId, row.binding?.delivery?.status,
  gitSources.value.get(row.deploymentId)?.map(source => [source.repoId, source.directories]),
])))
async function loadGitVersions(refresh = false) {
  const seq = ++gitVersionRequest
  const ids = visibleRows.value.filter(row => gitSources.value.get(row.deploymentId)?.length).map(row => row.runtimeId)
  gitVersions.value = {}; gitVersionsError.value = ''
  if (!active || !ids.length) { gitVersionsLoading.value = false; return }
  gitVersionsLoading.value = true
  try {
    const result = await runnerManagementApi.runtimeGitVersions(ids, refresh)
    if (seq === gitVersionRequest && active) gitVersions.value = Object.fromEntries(result.items.map(item => [item.runtimeId, item]))
  } catch (e) { if (seq === gitVersionRequest && active) gitVersionsError.value = problem(e) }
  finally { if (seq === gitVersionRequest && active) gitVersionsLoading.value = false }
}
watch(gitVersionScope, () => { void loadGitVersions() }, { immediate: true, flush: 'post' })
function gitVersion(row: RuntimeConfiguration, repoId: string, directory: string) {
  return gitVersions.value[row.runtimeId]?.sources.find(source => source.repoId === repoId && source.directory === directory)
}
function deliveredGitLabel(row: RuntimeConfiguration, repoId: string, directory: string) {
  if (gitVersionsLoading.value) return '读取中…'
  if (gitVersionsError.value) return '读取失败'
  const detail = gitVersions.value[row.runtimeId], source = gitVersion(row, repoId, directory)
  if (!detail) return '未取得'
  if (detail.deployedStatus === 'not_delivered') return '尚未下发'
  if (detail.deployedStatus === 'unknown') return '无法读取'
  const commits = source?.deployedCommits || []
  return commits.length ? commits.slice(0, 2).map(commit => commit.slice(0, 12)).join('、') + (commits.length > 2 ? ` 等 ${commits.length} 个` : '') + (commits.length > 1 ? '（混合版本）' : '') : '未记录 Git 版本'
}
function remoteGitLabel(row: RuntimeConfiguration, repoId: string, directory: string) {
  if (gitVersionsLoading.value) return '查询中…'
  if (gitVersionsError.value) return '查询失败'
  const source = gitVersion(row, repoId, directory)
  if (!source) return '未取得'
  if (source.remoteStatus === 'unconfigured') return '未配置远程'
  if (source.remoteStatus === 'error') return '查询失败'
  if (source.remoteStatus === 'checking') return '查询中…'
  const comparison = source.deployedCommits.length && gitVersions.value[row.runtimeId]?.deployedStatus === 'ok'
    ? source.contentStatus === 'same' ? '（已下发文件一致）'
      : source.contentStatus === 'different' ? '（已下发文件有差异）'
        : source.deployedCommits.length === 1 && source.deployedCommits[0] === source.remoteCommit ? '（提交一致）'
          : '（来源提交不同）' : ''
  return source.remoteCommit.slice(0, 12) + comparison
}
function deliveredGitTitle(row: RuntimeConfiguration, repoId: string, directory: string) {
  return gitVersionsError.value || gitVersions.value[row.runtimeId]?.deployedError || gitVersion(row, repoId, directory)?.deployedCommits.join('\n') || ''
}
function remoteGitTitle(row: RuntimeConfiguration, repoId: string, directory: string) {
  const source = gitVersion(row, repoId, directory)
  return gitVersionsError.value || source?.remoteError || (source ? [source.remoteCommit, `远程分支：${source.branch}`,
    `查询时间：${formatRunnerDateTime(source.checkedAt)}`, source.contentError,
    source.differentPaths?.length ? `存在差异的文件：\n${source.differentPaths.join('\n')}` : '',
    '仅核对已下发文件与远程同路径内容；未下发文件不在该范围内。'].filter(Boolean).join('\n') : '')
}
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
const inFlight = (row: RuntimeConfiguration) => ['pending', 'running'].includes(row.binding?.delivery?.status || '')
const machineState = (id: string) => machineMap.value.get(id)?.status || 'unknown'
function runnerLabel(id: string) {
  const item = machineMap.value.get(id)
  return item ? `${item.name} · ${item.ipAddress} · ${item.installDirectory}` : id
}
const flowNames = ref<Record<string, string>>({}), flowNameError = ref('')
const sourceNodes = (row: RuntimeConfiguration) => {
  const layout = configurationMap.value.get(row.deploymentId)
  return (layout?.sourceNode ? [layout.sourceNode] : layout?.relatedSourceNodes || [])
    .map(source => ({ ...source, flowName: flowNames.value[source.flowId] || source.flowName }))
}
const sourceNode = (row: RuntimeConfiguration) => sourceNodes(row)[0]
async function loadFlowNames(layouts: DeploymentConfiguration[], seq: number) {
  const ids = [...new Set(layouts.flatMap(item => item.sourceNode ? [item.sourceNode] : item.relatedSourceNodes || [])
    .filter(node => node.flowId && (!node.flowName || node.flowName === node.flowId) && !flowNames.value[node.flowId]).map(node => node.flowId))]
  const failures: string[] = []
  for (let i = 0; i < ids.length; i += 4) await Promise.all(ids.slice(i, i + 4).map(async id => {
    try {
      const flow = await flowCenterApi.detail(id)
      if (seq === request && active && flow) flowNames.value[id] = flow.name
      if (!flow) failures.push(`流程 ${id} 不存在`)
    } catch (e) { failures.push(`流程 ${id} 名称加载失败：${problem(e)}`) }
  }))
  if (seq === request && active) flowNameError.value = failures.join('；')
}
const configurationId = (row: RuntimeConfiguration) => sourceNode(row)?.configId || configurationMap.value.get(row.deploymentId)?.configId || row.assignment?.configId || ''
function showConfigurationId(row: RuntimeConfiguration) {
  const id = configurationId(row)
  return !!id && !(row.name || '').split(/[^A-Za-z0-9_-]+/).includes(id)
}
function runtimeQueue(row: RuntimeConfiguration) {
  const queue = row.assignment?.queue || ''
  return queue.startsWith('@deployment:') ? '' : queue
}
const nodeQueue = (row: RuntimeConfiguration) => sourceNode(row) ? configurationMap.value.get(row.deploymentId)?.queueName || '' : ''
function configurationLabel(item: DeploymentConfiguration) {
  return [item.name, item.sourceNode ? `${item.sourceNode.flowName} / ${item.sourceNode.nodeName}` : '',
    item.configId ? `配置 ${item.configId}` : '', item.queueName ? `${item.sourceNode ? '节点 MQ' : '部署队列'} ${item.queueName}` : '', resolveDirectory(item) || item.directoryTemplate].filter(Boolean).join(' · ')
}
function resolveDirectory(layout?: DeploymentConfiguration) {
  if (!layout?.directoryTemplate) return ''
  let result = layout.directoryTemplate
  // Match directory_delivery.target_path: variables belong to the deployment,
  // not to an optional execution task. Legacy environment templates need an edit.
  const values: [string, string][] = [['{configId}', layout.configId], ['{queue}', layout.queueName], ['{website}', layout.siteHost]]
  for (const [token, value] of values) {
    if (result.includes(token) && !value) return ''
    result = result.replaceAll(token, value)
  }
  return /[{}]/.test(result) ? '' : result
}
const directoryPath = (row: RuntimeConfiguration) => row.assignment?.processorType === 'deployment-entry'
  ? row.directoryTemplate : resolveDirectory(configurationMap.value.get(row.deploymentId))
function fullPath(runnerId: string, relative: string) {
  const machine = machineMap.value.get(runnerId)
  if (!relative || !machine?.installDirectory) return ''
  if (/^(?:[a-z]:[\\/]|[\\/])/i.test(relative)) return relative
  const separator = machine.platform.toLowerCase().startsWith('win') || /^[a-z]:[\\/]/i.test(machine.installDirectory) || machine.installDirectory.startsWith('\\\\') ? '\\' : '/'
  return machine.installDirectory.replace(/[\\/]+$/, '') + separator + relative.replaceAll('/', separator)
}
function time(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
function deliveryTime(row: RuntimeConfiguration) {
  const item = row.binding?.delivery
  return item ? `${item.finishedAt ? '完成' : '提交'}于 ${time(item.finishedAt || item.requestedAt)}` : '尚未手动下发'
}
function deliveryAdvice(row: RuntimeConfiguration) {
  return row.binding?.delivery?.status === 'success' ? '启动使用最近下发成功的文件' : ''
}
function canRestoreProcesses(row: RuntimeConfiguration) {
  const machine = machineMap.value.get(row.runnerId)
  return !!row.assignment?.enabled && !!row.stoppedProcessSlots?.length && machine?.workerProcesses != null
    && machine.workerProcesses.filter(item => item.assignmentId === row.assignment!.assignmentId).length < row.assignment.concurrency
}
function programState(row: RuntimeConfiguration): { label: string; type: 'info' | 'success' | 'warning' | 'danger'; detail: string; waiting?: boolean } {
  if (unbound(row)) return { label: '未绑定实例', type: 'info', detail: '选择部署实例并保存绑定后下发' }
  const assignment = row.assignment, machine = machineMap.value.get(row.runnerId)
  if (!assignment) return { label: configuredEntry(row) ? '待启动' : '仅下发目录', type: 'info', detail: configuredEntry(row) ? '启动时采用部署配置中的入口' : '' }
  if (!machine || machine.status === 'offline') return { label: '运行状态未知', type: 'info', detail: `机器离线 · ${assignment.enabled ? '已请求启动' : '已请求停止'}` }
  if (machine.workerProcesses == null) return { label: '进程未上报', type: 'info', detail: assignment.enabled ? '已请求启动，等待进程上报' : '已请求停止，等待进程上报' }
  const processes = machine.workerProcesses.filter(item => item.assignmentId === assignment.assignmentId)
  const detail = processes.length ? `实例：${processes.length}/${assignment.concurrency} · PID：${processes.map(item => item.pid).join('、')}` : ''
  if (!assignment.enabled) return { label: processes.length ? '停止中' : '已停止', type: 'info', detail, waiting: !!processes.length }
  if (processes.length) return { label: processes.length >= assignment.concurrency ? '运行中' : `部分运行 ${processes.length}/${assignment.concurrency}`, type: processes.length >= assignment.concurrency ? 'success' : 'warning', detail, waiting: processes.length < assignment.concurrency }
  if (row.stoppedProcessSlots?.length) return { label: '已手动关闭', type: 'info', detail: '点击恢复进程可重新启动已关闭的并发实例' }
  if (machine.lastError || machine.status === 'error') return { label: 'Runner 异常', type: 'danger', detail: machine.lastError || '请查看 Runner 日志' }
  return { label: '等待启动', type: 'warning', detail: '等待 Runner 启动并上报进程', waiting: true }
}
async function controlProgram(row: RuntimeConfiguration, start: boolean) {
  if (!canWrite.value || controlling.value || (!row.assignment && !configuredEntry(row))) return
  controlling.value = row.runtimeId; delete programErrors.value[row.runtimeId]; stopPoll(); ++request
  try {
    const item = await (start ? runnerManagementApi.startRuntimeProgram : runnerManagementApi.stopRuntimeProgram)(row.runtimeId, row.revision)
    rows.value = rows.value.map(value => value.runtimeId === row.runtimeId ? item : value)
    ElMessage.success(start ? '启动指令已提交，等待 Runner 上报进程' : '停止指令已提交，等待 Runner 停止进程')
  } catch (e) { programErrors.value[row.runtimeId] = problem(e) }
  finally { controlling.value = ''; poll() }
}
function configuredEntry(row: RuntimeConfiguration) { return configurationMap.value.get(row.deploymentId)?.entryPoint ?? row.entryPoint }
function stopPoll() { clearTimeout(timer); timer = undefined }
function poll() {
  stopPoll()
  if (active && initialized && !editing.value && !browsing.value && !loading.value && !controlling.value) timer = setTimeout(() => { void refreshRows() }, rows.value.some(row => inFlight(row) || programState(row).waiting) ? 3000 : 15000)
}
async function refreshRows() {
  const seq = ++request
  try {
    const [items, layouts, machines, repos] = await readRows()
    if (seq === request && active) { rows.value = items; configurations.value = layouts; runners.value = machines; repositories.value = repos.items; repositoryError.value = repos.error; error.value = ''; void loadFlowNames(layouts, seq); void loadSourceNames(items, seq) }
  } catch (e) { if (seq === request && active) error.value = problem(e) }
  finally { poll() }
}
function readRows() {
  return Promise.all([runnerManagementApi.runtimeConfigurations(), runnerManagementApi.deploymentConfigurations(), runnerManagementApi.instances(),
    runnerManagementApi.codeRepositories().then(items => ({ items, error: '' }), e => ({ items: [] as CodeRepository[], error: problem(e) }))])
}
async function load(refreshVersions = false) {
  const seq = ++request
  stopPoll(); loading.value = true; error.value = ''
  try {
    const [items, layouts, machines, repos] = await readRows()
    if (seq !== request) return
    rows.value = items; configurations.value = layouts; runners.value = machines; repositories.value = repos.items; repositoryError.value = repos.error
    void loadFlowNames(layouts, seq); void loadSourceNames(items, seq)
  } catch (e) { if (seq === request) error.value = problem(e) }
  finally {
    if (seq === request) {
      loading.value = false
      if (refreshVersions) void loadGitVersions(true)
    }
    initialized = true; poll()
  }
}
function open(row: RuntimeConfiguration | null = null) {
  editingRow.value = row; editing.value = true; formError.value = ''; stopPoll(); ++request
  const item = configurationMap.value.get(row?.deploymentId || '') || (!row ? configurations.value[0] : undefined)
  Object.assign(form, { runtimeId: row?.runtimeId, revision: row?.revision, deploymentId: item?.deploymentId || '', layoutRevision: item?.revision || '',
    runnerId: row?.runnerId || props.runnerId || '', concurrency: row?.assignment?.concurrency || 1,
    retryPolicy: row?.retryPolicy ? { ...row.retryPolicy, delaysSeconds: [...row.retryPolicy.delaysSeconds] } : defaultRetryPolicy() })
  retryWindowMinutes.value = form.retryPolicy.windowSeconds / 60
  retryDelays.value = form.retryPolicy.delaysSeconds.join(', ')
}
function selectConfiguration(value: unknown) {
  if (typeof value !== 'string') return
  form.deploymentId = value; form.layoutRevision = selectedConfiguration.value?.revision || ''
}
function cancel() { editing.value = false; editingRow.value = null; formError.value = ''; poll() }
async function save() {
  if (!canWrite.value || saving.value || !form.deploymentId || !form.runnerId) return
  if (props.runnerId && form.runnerId !== props.runnerId) { formError.value = '请选择当前服务器实例'; return }
  saving.value = true; formError.value = ''
  try {
    const tokens = retryDelays.value.split(/[,，]/).map(value => value.trim())
    const delays = tokens.map(Number)
    if (form.retryPolicy.enabled && (!Number.isInteger(retryWindowMinutes.value) || retryWindowMinutes.value < 1 || retryWindowMinutes.value > 1440
      || !Number.isInteger(form.retryPolicy.maxAttempts) || form.retryPolicy.maxAttempts < 1 || form.retryPolicy.maxAttempts > 100
      || tokens.length > 10 || tokens.some(value => !/^\d+$/.test(value)) || delays.some(value => !Number.isInteger(value) || value < 1 || value > 3600))) {
      formError.value = '统计窗口须为 1–1440 分钟，尝试上限须为 1–100 次；重试间隔填写 1–10 个 1–3600 秒的整数，用逗号分隔。'
      return
    }
    if (form.retryPolicy.enabled) { form.retryPolicy.windowSeconds = retryWindowMinutes.value * 60; form.retryPolicy.delaysSeconds = delays }
    else {
      const previous = editingRow.value?.retryPolicy || defaultRetryPolicy()
      if (!Number.isInteger(form.retryPolicy.maxAttempts) || form.retryPolicy.maxAttempts < 1 || form.retryPolicy.maxAttempts > 100) form.retryPolicy.maxAttempts = previous.maxAttempts
      form.retryPolicy.windowSeconds = Number.isInteger(retryWindowMinutes.value) && retryWindowMinutes.value >= 1 && retryWindowMinutes.value <= 1440 ? retryWindowMinutes.value * 60 : previous.windowSeconds
      form.retryPolicy.delaysSeconds = tokens.length <= 10 && tokens.every(value => /^\d+$/.test(value)) && delays.every(value => value >= 1 && value <= 3600) ? delays : [...previous.delaysSeconds]
    }
    // Keep the legacy execution flag at the API boundary without making it a user setting.
    const item = await runnerManagementApi.saveRuntimeConfiguration({ ...form, retryPolicy: { ...form.retryPolicy, delaysSeconds: [...form.retryPolicy.delaysSeconds] }, layoutRevision: selectedConfiguration.value?.revision || form.layoutRevision, environment: editingRow.value?.assignment?.environment || 'test' })
    rows.value = [...rows.value.filter(value => value.runtimeId !== editingRow.value?.runtimeId && value.runtimeId !== item.runtimeId), item]
    cancel(); ElMessage.success('机器配置已保存')
  } catch (e) { formError.value = problem(e) }
  finally { saving.value = false }
}
async function remove(row: RuntimeConfiguration) {
  try {
    await ElMessageBox.confirm(`移除“${row.name}”与此机器的绑定${row.assignment ? '，并停止该队列' : ''}？部署配置和仓库代码会保留。`, '移除机器配置', { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' })
    await runnerManagementApi.removeRuntimeConfiguration(row.runtimeId, row.revision)
    rows.value = rows.value.filter(item => item.runtimeId !== row.runtimeId); ElMessage.success('已移除机器配置')
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(problem(e)) }
}
function browseDirectory(row: RuntimeConfiguration, directory: string) {
  const runner = machineMap.value.get(row.runnerId)
  if (!runner || !directory) return
  stopPoll(); ++request; browsing.value = { runner, directory }
}
function closeBrowser() { browsing.value = null; poll() }
function bindConfiguration(row: RuntimeConfiguration) {
  open()
  Object.assign(form, { deploymentId: row.deploymentId, layoutRevision: row.layoutRevision })
}
function editMapping(row: RuntimeConfiguration) { void router.replace({ path: '/settings', query: { tab: 'directory-layout', deploymentId: row.deploymentId, returnTab: 'runners', runnerId: row.runnerId || props.runnerId || undefined, runtimeId: unbound(row) ? undefined : row.runtimeId } }) }
async function deleteUnbound(row: RuntimeConfiguration) {
  if (!canWrite.value || !unbound(row) || controlling.value) return
  const layout = configurationMap.value.get(row.deploymentId)
  if (!layout) return
  try {
    await ElMessageBox.confirm(`删除部署配置「${layout.name}」？仓库代码和机器上已下发的文件会保留。`, '删除部署配置', { type: 'warning' })
    controlling.value = row.runtimeId; stopPoll()
    await runnerManagementApi.deleteDeploymentConfiguration(layout.deploymentId, layout.revision)
    configurations.value = configurations.value.filter(item => item.deploymentId !== layout.deploymentId)
    ElMessage.success('部署配置已删除')
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(problem(e)) }
  finally { controlling.value = ''; poll() }
}
function viewLogs(row: RuntimeConfiguration) { void router.replace({ path: '/settings', query: { tab: 'runtime-logs', runtimeId: row.runtimeId } }) }
function openBatch(row: RuntimeConfiguration) {
  const id = configurationId(row)
  const batchConfig = id ? `config:${id}` : `deployment:${row.deploymentId}`
  void router.replace({ path: '/settings', query: { tab: 'runners', view: 'batch', batchConfig, runnerId: props.runnerId || undefined } })
}
function deliver(row: RuntimeConfiguration) { if (canWrite.value && row.binding && !inFlight(row)) deliveryRow.value = row }
function delivered(item: DirectoryDelivery) {
  rows.value = rows.value.map(row => row.binding?.bindingType === item.bindingType && row.binding.ownerId === item.ownerId && row.runnerId === item.runnerId
    ? { ...row, binding: { ...row.binding, delivery: item } } : row)
  deliveryRow.value = null; poll()
}
watch([keyword, machineFilter, deliveryFilter, pageSize], () => { page.value = 1 })
watch(() => filteredRows.value.length, length => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize.value))) })
onMounted(() => { void load() })
onActivated(() => { active = true; if (initialized && !loading.value && !editing.value) { void load(); void loadGitVersions() } })
onDeactivated(() => { active = false; ++gitVersionRequest; browsing.value = null; stopPoll() })
onUnmounted(() => { active = false; ++request; ++gitVersionRequest; stopPoll() })
</script>

<template>
  <section class="rb-page" :class="{ 'rb-scoped': !!runnerId }" data-testid="settings-runtime-bindings">
    <div class="rb-filters">
      <label class="rb-search">{{ runnerId ? '查询' : '机器 / 流程 / 节点 / MQ' }}<el-input v-model="keyword" clearable :prefix-icon="Search" :disabled="editing" placeholder="IP、流程、节点、配置 ID、MQ 或目录" aria-label="搜索机器配置" /></label>
      <label v-if="!runnerId">机器状态<el-select v-model="machineFilter" placeholder="全部状态" :disabled="editing" aria-label="筛选机器状态" data-testid="binding-machine-filter"><el-option label="全部状态" value="" /><el-option v-for="(label, value) in machineStates" :key="value" :value="value" :label="label" /></el-select></label>
      <label>下发状态<el-select v-model="deliveryFilter" placeholder="全部状态" :disabled="editing" aria-label="筛选下发状态" data-testid="binding-delivery-filter"><el-option label="全部状态" value="" /><el-option v-for="(label, value) in deliveryStates" :key="value" :value="value" :label="label" /></el-select></label>
      <span class="rb-filter-note">绑定目录 · 下发代码 · 启动节点程序</span>
    </div>
    <div class="rb-card">
      <header class="rb-toolbar">
        <div><strong>{{ runnerId ? '当前实例的机器配置' : '机器与流程节点绑定' }}</strong><span>{{ scopedRows.length }} 项配置 · {{ boundMachines.size }} 个实例 · {{ onlineMachines }} 个在线</span></div>
        <div><el-button :icon="Refresh" circle :disabled="loading || saving || editing || !!controlling" aria-label="刷新机器配置" @click="load(true)" /><el-button v-if="canWrite && runnerId" :disabled="loading || editing || saving || !!controlling" data-testid="binding-manual-deployment" @click="router.replace({ path: '/settings', query: { tab: 'directory-layout', create: '1', returnTab: 'runners', runnerId } })">手工新建</el-button><el-button v-if="canWrite" type="primary" :icon="Plus" :disabled="loading || saving || editing || !!controlling || !!error" data-testid="binding-create" @click="open()">新增绑定</el-button></div>
      </header>
      <el-alert v-if="error" :title="`机器配置加载失败：${error}`" description="当前信息可能已过期，请刷新重试。" type="error" :closable="false" show-icon class="rb-error" />
      <el-alert v-if="flowNameError" :title="flowNameError" type="warning" :closable="false" show-icon />
      <el-alert v-if="repositoryError" :title="`Git 仓库信息加载失败：${repositoryError}`" type="warning" :closable="false" show-icon />
      <div v-loading="loading" class="rb-table">
        <table class="rc-data-table">
          <colgroup><col v-if="!runnerId" class="rb-col-machine"><col class="rb-col-config"><col class="rb-col-directory"><col class="rb-col-state"><col class="rb-col-actions"></colgroup>
          <thead><tr><th v-if="!runnerId">运行机器</th><th>流程 / 配置节点</th><th>运行目录</th><th>程序与下发</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-if="editing" class="rb-draft" data-testid="binding-new-row">
              <td :colspan="runnerId ? 4 : 5">
                <div class="rb-editor">
                  <div class="rb-editor-title"><strong>{{ editingRow ? '编辑机器配置' : '新增机器配置' }}</strong><span>选择机器和部署配置，保存后可手动下发代码</span></div>
                  <div class="rb-editor-fields">
                    <label>运行机器<el-select v-model="form.runnerId" filterable :disabled="saving || !!editingRow || !!runnerId" placeholder="选择 IP / Runner 实例目录" aria-label="选择运行机器" data-testid="binding-runner"><el-option v-for="runner in runners.filter(item => !runnerId || item.runnerId === runnerId)" :key="runner.runnerId" :value="runner.runnerId" :label="runnerLabel(runner.runnerId)" /></el-select></label>
                    <label>运行目录<el-select :model-value="form.deploymentId" filterable :disabled="saving" placeholder="选择部署配置，可搜索流程、节点或 MQ" aria-label="选择运行目录" data-testid="binding-deployment" @update:model-value="selectConfiguration"><el-option v-for="item in configurations" :key="item.deploymentId" :value="item.deploymentId" :label="configurationLabel(item)" /></el-select></label>
                    <div class="rb-execution-summary" data-testid="binding-execution-summary"><span v-if="selectedConfiguration?.sourceNode">流程：{{ selectedConfiguration.sourceNode.flowName }}<br />配置节点：{{ selectedConfiguration.sourceNode.nodeName }}</span><span v-if="selectedConfiguration?.sourceNode && executionQueue">节点 MQ 队列：{{ executionQueue }}</span><span v-else-if="existingTask?.queue && !existingTask.queue.startsWith('@deployment:')">运行 MQ：{{ existingTask.queue }}</span><span v-if="selectedConfiguration?.entryPoint">启动文件：{{ selectedConfiguration.entryPoint }}</span><small>{{ hasExecution ? '直接启动所选文件；仅入口变更无需下发，文件 hash 变化后下发并手动启动' : '在部署配置中选择启动文件；未选择时仅下发代码' }}</small></div>
                    <div class="rb-path-preview"><el-icon><Folder /></el-icon><div><span>目标目录</span><code data-testid="binding-target-preview">{{ fullPath(form.runnerId, resolveDirectory(selectedConfiguration)) || (resolveDirectory(selectedConfiguration) ? `Runner / ${resolveDirectory(selectedConfiguration)}` : '请先选择已配置完整目录的部署配置') }}</code></div></div>
                    <div v-if="hasExecution" class="rb-runtime-fields"><label>并发数<el-input-number v-model="form.concurrency" :min="1" :max="100" :disabled="saving" controls-position="right" aria-label="并发数" /></label></div>
                    <section v-if="hasExecution" class="rb-retry" data-testid="binding-retry-policy">
                      <header><strong>重试策略</strong><label class="rb-retry-switch"><span>自动重试</span><el-switch v-model="form.retryPolicy.enabled" :disabled="saving" aria-label="自动重试" /><span>{{ form.retryPolicy.enabled ? '启用' : '关闭' }}</span></label></header>
                      <div v-if="form.retryPolicy.enabled" class="rb-retry-fields">
                        <label>失败统计窗口（分钟）<el-input-number v-model="retryWindowMinutes" :min="1" :max="1440" :precision="0" :disabled="saving" controls-position="right" aria-label="失败统计窗口（分钟）" /></label>
                        <label>窗口内尝试上限（含首次）<el-input-number v-model="form.retryPolicy.maxAttempts" :min="1" :max="100" :precision="0" :disabled="saving" controls-position="right" aria-label="窗口内尝试上限（含首次）" /></label>
                        <label>重试间隔（秒）<el-input v-model="retryDelays" :disabled="saving" placeholder="如：5, 15, 30, 60" aria-label="重试间隔（秒）" /></label>
                      </div>
                      <p>{{ form.retryPolicy.enabled ? '每次重试依次采用这些间隔，超过列表后沿用最后一个。任一并发实例达到上限后暂停当前绑定。' : '启动失败或程序退出后不自动重启，需要手动启动。' }} 已暂停的程序保存后仍需手动启动。</p>
                    </section>
                  </div>
                  <p v-if="formError" role="alert" class="rb-inline-error" data-testid="binding-form-error">{{ formError }}</p>
                  <footer class="rb-editor-footer"><span>保存采用完整配置；下发代码时可选择文件范围。</span><div><el-button :disabled="saving" data-testid="binding-cancel" @click="cancel">取消</el-button><el-button type="primary" :loading="saving" :disabled="!form.deploymentId || !form.runnerId" data-testid="binding-save" @click="save">保存配置</el-button></div></footer>
                </div>
              </td>
            </tr>
            <tr v-for="row in visibleRows" :key="row.runtimeId" data-testid="binding-row">
              <td v-if="!runnerId">
                <div class="rb-machine-title"><strong :title="machineMap.get(row.runnerId)?.name || row.runnerId">{{ machineMap.get(row.runnerId)?.name || row.runnerId }}</strong><span class="rb-machine-state" :class="`is-${machineState(row.runnerId)}`">{{ machineStates[machineState(row.runnerId)] }}</span></div>
                <small :title="`最近心跳：${formatRunnerHeartbeat(machineMap.get(row.runnerId)?.lastHeartbeat)}（北京时间）`">{{ machineMap.get(row.runnerId)?.ipAddress || 'IP 未知' }} · {{ machineMap.get(row.runnerId)?.platform || '平台未知' }}</small>
                <small :title="`Runner 实例目录：${machineMap.get(row.runnerId)?.installDirectory || '未知'}\n最近心跳：${formatRunnerHeartbeat(machineMap.get(row.runnerId)?.lastHeartbeat)}（北京时间）`">{{ machineMap.get(row.runnerId)?.installDirectory || '实例目录未知' }}</small>
              </td>
              <td data-testid="binding-flow-node">
                <template v-if="sourceNode(row)">
                  <strong :title="`流程：${sourceNode(row)?.flowName}\n流程 ID：${sourceNode(row)?.flowId}`" data-testid="binding-flow">{{ sourceNode(row)?.flowName && sourceNode(row)?.flowName !== sourceNode(row)?.flowId ? sourceNode(row)?.flowName : '流程名称未获取' }}</strong>
                  <small data-testid="binding-flow-id">流程 ID：{{ sourceNode(row)?.flowId || '未记录' }}</small>
                  <small class="rb-node-name" :title="`配置节点：${sourceNode(row)?.nodeName}\n步骤 ID：${sourceNode(row)?.stepId}`" data-testid="binding-node">节点：{{ sourceNode(row)?.nodeName }}</small>
                  <small v-for="node in sourceNodes(row).slice(1)" :key="`${node.flowId}:${node.stepId}`" class="rb-node-name" data-testid="binding-related-node">{{ node.flowName }} · 流程 {{ node.flowId }} · 节点 {{ node.nodeName }}（{{ node.stepId }}）</small>
                  <small :title="`${row.name}\n部署 ID：${row.deploymentId}`">部署：{{ row.name }}</small>
                </template>
                <template v-else>
                  <strong :title="`${row.name}\n部署 ID：${row.deploymentId || '未绑定'}`">{{ row.name }}</strong>
                  <small>{{ configurationId(row) ? '历史配置 · 未记录来源节点' : row.deploymentId ? '公共目录 · 未绑定流程节点' : '未关联部署配置' }}</small>
                </template>
                <RouterLink v-if="row.sourceContext?.sourceId" :to="originalSourceLink(row)" class="rb-original-source" data-testid="binding-original-source" :title="`源 ${row.sourceContext.sourceId}`">{{ sourceNames[row.sourceContext.sourceId] || `源 ${row.sourceContext.sourceId}` }}</RouterLink>
                <small v-if="showConfigurationId(row)" :title="configurationId(row)">配置 ID：{{ configurationId(row) }}</small>
              </td>
              <td>
                <div class="rb-directory-title"><el-button link type="primary" :icon="Folder" :disabled="!fullPath(row.runnerId, directoryPath(row))" :title="directoryPath(row) || row.directoryTemplate" data-testid="binding-directory" @click="browseDirectory(row, fullPath(row.runnerId, directoryPath(row)))">{{ directoryPath(row) || (row.deploymentId ? '待完善目录模板' : '待选择部署配置') }}</el-button></div>
                <small :title="configuredEntry(row)" data-testid="binding-configured-entry">入口程序：{{ configuredEntry(row) || '未设置（仅下发文件）' }}</small>
                <small v-if="row.assignment && row.entryPoint && row.entryPoint !== configuredEntry(row)" :title="row.entryPoint" data-testid="binding-adopted-entry">{{ row.assignment.enabled ? '运行入口' : '已采用入口' }}：{{ row.entryPoint }}</small>
                <small v-if="row.assignment && row.assignment.processorType !== 'deployment-entry' && row.entryPoint" class="rb-inline-error">旧启动方式，请编辑保存后采用所选文件</small>
                <div class="rb-git-sources" data-testid="binding-git-sources">
                  <div v-for="source in gitSources.get(row.deploymentId) || []" :key="source.repoId" class="rb-git-source">
                    <div v-for="directory in source.directories" :key="directory" class="rb-git-directory-version">
                      <RouterLink :to="{ path: '/settings', query: { tab: 'code-repos', repoId: source.repoId, folderPath: directory, returnTo: deploymentReturnPath } }" class="rb-git-directory" data-testid="binding-git-directory">Git 目录：{{ directory || '仓库根目录' }}</RouterLink>
                      <small :title="deliveredGitTitle(row, source.repoId, directory)" data-testid="binding-delivered-git-version">已下发版本：{{ deliveredGitLabel(row, source.repoId, directory) }}</small>
                      <small :title="remoteGitTitle(row, source.repoId, directory)" data-testid="binding-remote-git-version">远程最新：{{ remoteGitLabel(row, source.repoId, directory) }}</small>
                    </div>
                  </div>
                  <small v-if="!gitSources.get(row.deploymentId)?.length">未关联 Git 代码</small>
                </div>
              </td>
              <td>
                <div class="rb-program-status" data-testid="binding-program-status"><el-tag size="small" :type="programState(row).type">{{ programState(row).label }}</el-tag><small v-if="programState(row).detail" :title="programState(row).detail">{{ programState(row).detail }}</small></div>
                <div class="rb-statuses"><el-tag size="small" :type="row.appliedRevision && row.appliedRevision === row.layoutRevision ? 'success' : 'info'">{{ row.appliedRevision ? row.appliedRevision === row.layoutRevision ? '已采用' : '配置有更新' : '原有配置' }}</el-tag><el-tag size="small" :type="row.binding?.delivery?.status === 'failed' ? 'danger' : row.binding?.delivery?.status === 'success' ? 'success' : 'info'" data-testid="binding-delivery-status">{{ deliveryStates[row.binding?.delivery?.status || 'none'] }}</el-tag></div>
                <small :title="deliveryTime(row)">{{ deliveryTime(row) }}</small>
                <small v-if="!row.assignment && configuredEntry(row)" class="rb-code-advice">入口来自部署配置，启动时自动采用</small>
                <small v-if="deliveryAdvice(row)" class="rb-code-advice" :title="deliveryAdvice(row)" data-testid="binding-delivery-advice">{{ deliveryAdvice(row) }}</small>
                <small v-if="row.binding?.delivery?.error" class="rb-inline-error" :title="row.binding.delivery.error">{{ row.binding.delivery.error }}</small>
                <small v-if="programErrors[row.runtimeId]" role="alert" class="rb-inline-error rb-program-error" :title="programErrors[row.runtimeId]" data-testid="binding-program-error">{{ programErrors[row.runtimeId] }}</small>
              </td>
              <td><div v-if="unbound(row)" class="rb-actions"><el-button v-if="canWrite" link type="primary" data-testid="binding-unbound" :disabled="loading || editing || saving" @click="bindConfiguration(row)">新增绑定</el-button><el-button v-if="canWrite" link type="primary" @click="editMapping(row)">编辑配置</el-button><el-button v-if="canWrite" link type="danger" data-testid="binding-delete-configuration" :disabled="loading || editing || saving || !!controlling" @click="deleteUnbound(row)">删除配置</el-button></div><div v-else class="rb-actions">
                <el-button link type="primary" data-testid="binding-logs" @click="viewLogs(row)">日志</el-button>
                <el-button v-if="canWrite && row.deploymentId" link type="primary" :disabled="loading || editing || saving || !!controlling || inFlight(row)" data-testid="binding-entry" @click="editMapping(row)">{{ configuredEntry(row) ? '更换入口' : '设置入口' }}</el-button>
                <el-button v-if="canWrite && (row.assignment || configuredEntry(row))" link type="primary" :disabled="loading || !!error || editing || saving || !!controlling || inFlight(row) || (row.assignment?.enabled && !canRestoreProcesses(row)) || machineState(row.runnerId) !== 'online'" :loading="controlling === row.runtimeId && (!row.assignment?.enabled || canRestoreProcesses(row))" data-testid="binding-start" @click="controlProgram(row, true)">{{ canRestoreProcesses(row) ? '恢复进程' : '启动' }}</el-button>
                <el-button v-if="canWrite && row.assignment" link type="danger" :disabled="loading || !!error || editing || saving || !!controlling || !row.assignment.enabled" :loading="controlling === row.runtimeId && row.assignment.enabled" data-testid="binding-stop" @click="controlProgram(row, false)">停止</el-button>
                <el-button v-if="canWrite" link type="primary" :disabled="loading || !!error || editing || saving || !!controlling || inFlight(row)" @click="open(row)">编辑</el-button>
                <el-button v-if="canWrite" link type="primary" :disabled="loading || !!error || !row.binding || inFlight(row) || editing || saving || !!controlling" data-testid="binding-deliver" @click="deliver(row)">下发代码</el-button>
                <el-button v-if="canWrite" link type="primary" :disabled="loading || editing || saving || !!controlling" data-testid="binding-batch" @click="openBatch(row)">同配置批量</el-button>
                <el-button v-if="row.deploymentId" link type="primary" :disabled="loading || editing || saving || !!controlling" data-testid="binding-edit-directory" @click="editMapping(row)">{{ canWrite ? '编辑目录' : '查看目录' }}</el-button>
                <el-button v-if="canWrite" link type="danger" :disabled="loading || !!error || editing || saving || !!controlling || inFlight(row)" @click="remove(row)">移除</el-button>
              </div></td>
            </tr>
            <tr v-if="!loading && !visibleRows.length && !editing"><td :colspan="runnerId ? 4 : 5" class="rb-empty">{{ error ? '服务不可用，请刷新重试' : scopedRows.length ? '没有匹配的机器配置' : runnerId ? '当前实例暂无机器配置，可新增绑定' : '暂无机器配置，先保存部署配置，再新增绑定' }}</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="rb-footer"><span>同一 IP 下的不同 Runner 目录为独立实例</span><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" :total="filteredRows.length" :disabled="editing || loading" /></footer>
    </div>
    <RunnerFilesDrawer v-if="browsing" :runner="browsing.runner" :directory="browsing.directory" @close="closeBrowser" />
    <DirectoryDeliveryDialog v-if="deliveryBinding" :binding="deliveryBinding" :runner-name="runnerLabel(deliveryBinding.runnerId)" @close="deliveryRow = null" @delivered="delivered" />
  </section>
</template>

<style scoped>
.rb-scoped .rb-filter-note, .rb-scoped .rb-footer > span { display: none; }
.rb-scoped .rb-filters { gap: 10px; padding: 8px 12px; align-items: center; }.rb-scoped .rb-filters .rb-search { flex: 1; width: auto; min-width: 180px; }.rb-scoped .rb-filters label { display: flex; align-items: center; gap: 8px; white-space: nowrap; }.rb-scoped .rb-filters label:not(.rb-search) { width: 200px; }.rb-scoped .rb-filters .el-input, .rb-scoped .rb-filters .el-select { margin-top: 0; flex: 1; min-width: 0; }
.rb-scoped .rb-table table { min-width: 740px; }.rb-scoped .rb-col-config { width: 28%; }.rb-scoped .rb-col-directory { width: 30%; }.rb-scoped .rb-col-state { width: 23%; }.rb-scoped .rb-col-actions { width: 110px; }
.rb-scoped .rb-table td { padding: 8px; }.rb-scoped .rb-table small { margin-top: 3px; line-height: 1.35; }.rb-scoped .rb-actions { gap: 4px 8px; }.rb-scoped .rb-actions .el-button { font-size: 11px; }.rb-scoped .rb-toolbar, .rb-scoped .rb-footer { padding: 8px 12px; }.rb-scoped .rb-program-status { margin-bottom: 5px; }.rb-scoped .rb-editor-fields { grid-template-columns: 1fr 1fr; }.rb-scoped .rb-path-preview { grid-column: 1 / -1; }.rb-page.rb-scoped { gap: 8px; }
.rb-page { display:flex; flex:1; flex-direction:column; min-height:0; gap:12px; }
.rb-filters { display:flex; align-items:end; gap:16px; padding:14px 16px; border:1px solid var(--el-border-color-light); border-radius:12px; background:var(--el-bg-color); }
.rb-filters label { width:145px; flex-shrink:0; }
.rb-filters .rb-search { width:320px; }
.rb-filters label, .rb-editor-fields label { display:block; font-size:12px; color:var(--el-text-color-regular); line-height:20px; }
.rb-filters .el-input, .rb-filters .el-select, .rb-editor-fields .el-select, .rb-editor-fields .el-input-number { display:block; margin-top:6px; width:100%; }
.rb-filters .el-input, .rb-editor-fields .el-input-number { display:inline-flex; }
.rb-filter-note { margin-left:auto; padding-bottom:7px; font-size:12px; color:var(--rc-muted); }
.rb-card { display:flex; flex:1; flex-direction:column; min-height:0; border:1px solid var(--el-border-color-light); border-radius:12px; background:var(--el-bg-color); overflow:hidden; }
.rb-toolbar { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; gap:12px; }
.rb-toolbar > div { display:flex; align-items:center; gap:12px; }
.rb-toolbar strong { font-size:14px; }.rb-toolbar span { font-size:12px; color:var(--rc-muted); }
.rb-error { margin:0 12px 8px; width:auto; }
.rb-table { flex:1; min-height:0; overflow:auto; }
.rb-table table { table-layout:fixed; min-width:960px; }
.rb-col-machine { width:17%; }.rb-col-config { width:25%; }.rb-col-directory { width:25%; }.rb-col-state { width:16%; }.rb-col-actions { width:140px; }
.rb-table th { position:sticky; top:0; z-index:1; }.rb-table td { vertical-align:top; padding:16px 12px; white-space:normal; }
.rb-table strong { display:block; min-width:0; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rb-table small { display:block; color:var(--rc-muted); font-size:11px; margin-top:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rb-original-source { display:block; margin-top:6px; font-size:12px; color:var(--el-color-primary); text-decoration:none; overflow-wrap:anywhere; }.rb-original-source:hover { text-decoration:underline; }
.rb-table .rb-node-name { color:var(--rc-text); font-size:12px; }
.rb-machine-title, .rb-directory-title { display:flex; align-items:center; gap:8px; min-height:20px; }
.rb-machine-state { flex-shrink:0; color:var(--el-text-color-secondary); font-size:11px; }.rb-machine-state::before { content:''; display:inline-block; width:5px; height:5px; margin:0 4px 1px 0; border-radius:50%; background:currentColor; }.rb-machine-state.is-online { color:var(--el-color-success); }.rb-machine-state.is-error { color:var(--el-color-danger); }.rb-machine-state.is-upgrading { color:var(--el-color-primary); }
.rb-directory-title .el-button { min-width:0; max-width:100%; justify-content:flex-start; font-size:12px; }.rb-directory-title .el-button :deep(span) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.rb-table small .el-button { max-width:100%; height:auto; padding:0; font-size:inherit; vertical-align:baseline; }.rb-table small .el-button :deep(span) { white-space:normal; overflow-wrap:anywhere; text-align:left; }
.rb-directory-title .el-icon { color:var(--el-color-primary); flex-shrink:0; font-size:16px; }
.rb-git-sources { display:grid; gap:8px; margin-top:8px; padding-top:6px; border-top:1px solid var(--el-border-color-lighter); }
.rb-git-source { display:grid; gap:3px; font-size:11px; }
.rb-git-source a { color:var(--el-color-primary); text-decoration:none; overflow-wrap:anywhere; }
.rb-git-source a:hover { text-decoration:underline; }
.rb-git-address { font-family:inherit; white-space:normal; overflow-wrap:anywhere; user-select:text; }
.rb-table .rb-git-source small { margin-top:0; white-space:normal; overflow-wrap:anywhere; }
.rb-statuses { display:flex; flex-wrap:wrap; gap:5px; }.rb-program-status { margin-bottom:10px; }
.rb-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px 8px; justify-items:start; }.rb-actions .el-button { margin:0; font-size:12px; }
.rb-table .rb-empty { padding:56px 12px; text-align:center; color:var(--rc-muted); }
.rb-inline-error { color:var(--rc-error)!important; font-size:12px; }
.rb-table .rb-program-error, .rb-table .rb-code-advice { white-space:normal; overflow:visible; text-overflow:clip; overflow-wrap:anywhere; line-height:1.5; }
.rb-table .rb-draft > td { padding:12px; background:var(--el-fill-color-lighter); }
.rb-editor { padding:16px; border:1px solid var(--el-color-primary-light-7); border-radius:8px; background:var(--el-bg-color); }
.rb-editor-title { display:flex; align-items:center; gap:12px; margin-bottom:16px; }.rb-editor-title strong { font-size:14px; }.rb-editor-title span { color:var(--rc-muted); font-size:12px; }
.rb-editor-fields { display:grid; grid-template-columns:1fr 1fr 1fr; align-items:start; gap:16px; }.rb-editor-fields > * { min-width:0; }
.rb-path-preview { display:flex; align-items:center; gap:10px; grid-column:span 2; min-height:54px; background:var(--el-fill-color-light); padding:8px 12px; border-radius:6px; }.rb-path-preview .el-icon { color:var(--el-color-primary); font-size:20px; flex-shrink:0; }.rb-path-preview > div { min-width:0; }.rb-path-preview span { display:block; font-size:11px; color:var(--rc-muted); }.rb-path-preview code { display:block; margin-top:5px; font-size:12px; overflow-wrap:anywhere; }
.rb-runtime-fields { display:flex; gap:12px; }.rb-runtime-fields > label { flex:1; min-width:0; }.rb-execution-summary { align-self:center; line-height:1.6; font-size:12px; }.rb-execution-summary > span { display:block; overflow-wrap:anywhere; }.rb-execution-summary > small { color:var(--rc-muted); }
.rb-retry { grid-column:1 / -1; border-top:1px solid var(--el-border-color-lighter); padding-top:12px; }.rb-retry header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }.rb-retry header strong { font-size:13px; }.rb-retry .rb-retry-switch { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--rc-text); }.rb-retry-fields { display:grid; grid-template-columns:1fr 1fr 1.4fr; gap:16px; }.rb-retry-fields label { min-width:0; }.rb-retry-fields .el-input-number { width:100%; }.rb-retry p { margin:10px 0 0; color:var(--rc-muted); font-size:12px; line-height:1.6; }
.rb-editor-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; border-top:1px solid var(--el-border-color-lighter); margin-top:16px; padding-top:12px; }.rb-editor-footer > span { color:var(--rc-muted); font-size:12px; }
.rb-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-top:1px solid var(--el-border-color-lighter); }.rb-footer > span { font-size:12px; color:var(--rc-muted); }
@media (max-width:1100px) { .rb-filter-note, .rb-footer > span { display:none; }.rb-footer { justify-content:flex-end; }.rb-filters .rb-search { flex:1; width:auto; } }
</style>
