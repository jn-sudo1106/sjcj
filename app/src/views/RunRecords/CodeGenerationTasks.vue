<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, flowCenterApi, type Source, type TaskInst } from '@/api'
import { useAuthStore } from '@/stores/auth'
import GlobalSourceSelect from '@/views/FlowCanvas/result/components/GlobalSourceSelect.vue'
import { runnerManagementApi, type MqCodeJob, type GenerationModelCall, type GenerationRepositoryResult } from '@/api/runnerManagement'
import { runStateInfo } from '@/constants/runState'
import { prettyJsonText } from '@/utils/jsonText'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'

const props = defineProps<{ initialConfigId?: string; initialTaskId?: string }>()
const configId = ref(props.initialConfigId || '')
const taskId = ref(props.initialTaskId || '')
const state = ref('')
const sourceId = ref('')
const sources = ref<Record<string, Source>>({}), flows = ref<Record<string, string>>({})
const rowModels = ref<Record<string, GenerationModelCall>>({})
const rowArchives = ref<Record<string, GenerationRepositoryResult>>({})
const rowFinishedAt = ref<Record<string, string>>({})
const modelReferences = ref<Record<string, GenerationModelCall>>({})
const metadataError = ref(''), actionError = ref(''), deleting = ref('')
const canDelete = computed(() => useAuthStore().role === 'admin')
const rows = ref<TaskInst[]>([])
const checkedTasks = ref<TaskInst[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const loading = ref(false)
const error = ref('')
const executionError = ref('')
const execution = ref<Record<string, MqCodeJob['status'] | 'waiting'>>({})
const detailOpen = ref(false)
const selected = ref<TaskInst | null>(null)
const job = ref<MqCodeJob | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const referenceModel = ref<GenerationModelCall | null>(null), referenceError = ref('')
const detailTab = ref('request')
let listSequence = 0
let detailSequence = 0
let timer: ReturnType<typeof setTimeout> | undefined
let active = true
const statuses = { queued: '等待处理', running: '生成中', succeeded: '生成成功', failed: '生成失败' }
function executionLabel(task: TaskInst) {
  const status = execution.value[task.taskId]
  return status === 'waiting' ? '等待处理' : status ? statuses[status] : '执行状态待查询'
}
const context = computed(() => {
  const result: Record<string, unknown> = {}
  for (const text of [selected.value?.params, selected.value?.vars]) {
    try {
      const parsed: unknown = JSON.parse(text || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(result, parsed)
    } catch { /* 原始任务入参在详情中保留。 */ }
  }
  return result
})
function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { return object(JSON.parse(value)) } catch { return {} } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const generation = computed(() => {
  const params = { ...context.value, ...job.value?.params }
  return object(object(params.orchestration || params._codeOrchestration).aiGeneration)
})
const modelInfo = computed(() => {
  if (job.value?.modelCall) return job.value.modelCall
  const snapshot = object(generation.value.modelCall)
  return typeof snapshot.interfaceId === 'string' ? snapshot as unknown as GenerationModelCall : referenceModel.value
})
const interfaceLabel = computed(() => modelInfo.value?.name || modelInfo.value?.interfaceId || generation.value.interfaceId || '历史任务未记录模型接口')
const modelSource = computed(() => job.value?.modelCall ? job.value.startedAt ? '执行端记录的调用配置' : '创建任务时保存的调用配置' : object(generation.value.modelCall).interfaceId ? '提交任务时保存的调用配置' : referenceModel.value ? '当前接口配置参考（历史任务未保存快照，不代表当时的实际配置）' : '任务未记录完整模型配置')
const modelLabel = computed(() => modelInfo.value?.model || object(job.value?.request?.body).model || (modelInfo.value ? '接口默认模型' : '未记录'))
const requestText = computed(() => {
  const request = job.value?.request
  return request ? `${request.method} ${request.url}\n${Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n${JSON.stringify(request.body, null, 2)}` : ''
})
const taskParamsText = computed(() => {
  const raw = selected.value?.vars || selected.value?.params || '暂无参数'
  return prettyJsonText(raw) ?? raw
})
const taskResultText = computed(() => {
  const raw = selected.value?.taskResult || ''
  return prettyJsonText(raw) ?? raw
})
const resultArchive = computed(() => job.value?.result?.archive)
const resultFiles = computed(() => resultArchive.value?.files || [])
const resultServerId = computed(() => job.value?.serverId || resultArchive.value?.serverId || '')
const resultServerDirectory = computed(() => resultArchive.value?.serverCodeDirectory || job.value?.result?.workspace?.codeDir || '')
const gitResultStatus = computed(() => !resultArchive.value ? '未记录归档' : resultArchive.value.status === 'committed'
  ? resultArchive.value.pushed ? '已提交并推送' : '已提交本地' : resultArchive.value.status === 'failed' ? '归档失败' : '等待归档')
function serverResultTarget(path: string, file = false) {
  const normalized = path.replaceAll('\\', '/')
  const slash = normalized.lastIndexOf('/')
  const folder = file ? slash === 0 ? '/' : slash > 0 ? normalized.slice(0, slash) : '' : normalized
  return { path: '/settings', query: { tab: 'code-servers', serverId: resultServerId.value, serverFolder: folder } }
}
function gitFileTarget(path: string) {
  return { path: '/settings', query: { tab: 'code-repos', repoId: resultArchive.value?.repoId, directoryId: resultArchive.value?.directoryId, filePath: path } }
}
function taskContext(task: TaskInst) { return { ...object(task.params), ...object(task.vars) } }
function taskInfo(task: TaskInst) {
  const data = taskContext(task)
  const captured = String(data.taskName || task.taskName || '').match(/^生成步骤脚本\[([^\]]*)\]-(.*)$/)
  const owner = String(data.codeSourceId || data.sourceId || (task.sourceId !== '-1' ? task.sourceId : '') || '')
  const flowId = String(data.sourceFlowId || '')
  return { sourceId: owner, sourceName: sources.value[owner]?.name || captured?.[2] || owner || '未记录源',
    flowId, flowName: flows.value[flowId] || flowId || '未记录流程',
    stepId: String(data.stepId || data.itemConfig || ''), configId: String(data.stepConfigId || ''),
    nodeName: captured?.[1] || String(data.nodeName || data.stepName || data.stepConfigId || '未记录节点') }
}
function taskModel(task: TaskInst) {
  const saved = object(object(taskContext(task).orchestration || taskContext(task)._codeOrchestration).aiGeneration)
  const snapshot = object(saved.modelCall)
  return rowModels.value[task.taskId] || (typeof snapshot.interfaceId === 'string' ? snapshot as unknown as GenerationModelCall : modelReferences.value[String(saved.interfaceId || '')])
}
function generationServerLabel(model: GenerationModelCall | null | undefined, waiting = false) {
  return [model?.serverName || model?.serverId, model?.serverAddress].filter(Boolean).join(' · ')
    || (waiting ? '等待匹配生成服务器' : '未记录生成服务器')
}
function sourceLink(task: TaskInst) {
  const info = taskInfo(task)
  return { path: '/canvas', query: { sourceId: info.sourceId, view: 'flow', siteId: sources.value[info.sourceId]?.siteId,
    ...(info.flowId ? { flowId: info.flowId } : {}), ...(info.stepId ? { nodeId: info.stepId } : {}) } }
}
function repositoryResult(task: TaskInst) {
  const archive = (job.value?.taskId === task.taskId ? job.value.result?.archive : null) || rowArchives.value[task.taskId]
  if (!archive?.repoId || !archive.files?.length) return null
  const files = [...new Set(archive.files.map(file => file.path).filter(Boolean))]
  if (!files.length) return null
  const first = files[0]!
  const folder = first.split('/').slice(0, -1)
  for (const path of files.slice(1)) {
    const parts = path.split('/').slice(0, -1)
    while (folder.length && !folder.every((part, index) => part === parts[index])) folder.pop()
  }
  return { count: files.length, label: files.length === 1 ? first.split('/').pop()! : taskInfo(task).configId || task.configId,
    target: { path: '/settings', query: { tab: 'code-repos', repoId: archive.repoId, directoryId: archive.directoryId,
      ...(files.length === 1 ? { filePath: first } : { folderPath: folder.join('/') }) } } }
}
function pickSource(value: string | string[]) { sourceId.value = Array.isArray(value) ? value[0] || '' : value; void search() }
function clearDetail() { stopPolling(); selected.value = null; job.value = null; detailOpen.value = false }
async function loadMetadata(items: TaskInst[], sequence: number) {
  const ownerIds = [...new Set(items.map(item => taskInfo(item).sourceId).filter(id => /^[1-9]\d*$/.test(id)))]
  const flowIds = [...new Set(items.map(item => taskInfo(item).flowId).filter(id => /^[1-9]\d*$/.test(id) && !flows.value[id]))]
  const failures: string[] = []
  await Promise.all([
    ownerIds.length ? sourceApi.sourcePaged({ sourceIds: ownerIds, size: ownerIds.length }).then(result => { if (sequence === listSequence) for (const source of result.list) sources.value[source.sourceId] = source }).catch(() => { failures.push('源名称读取失败，暂用任务快照或 ID') }) : Promise.resolve(),
    (async () => { for (let index = 0; index < flowIds.length; index += 4) await Promise.all(flowIds.slice(index, index + 4).map(async id => {
      try { const flow = await flowCenterApi.detail(id); if (sequence === listSequence && flow) flows.value[id] = flow.name }
      catch { failures.push('流程名称读取失败，暂显示流程 ID') }
    })) })(),
    items.some(item => {
      const data = object(object(taskContext(item).orchestration || taskContext(item)._codeOrchestration).aiGeneration)
      return data.interfaceId && !data.modelCall
    }) ? runnerManagementApi.modelInterfaces().then(settings => {
      if (sequence !== listSequence) return
      modelReferences.value = Object.fromEntries(settings.items.map(model => { const endpoint = new URL(model.endpoint); return [model.id, {
        interfaceId: model.id, name: model.name, kind: model.kind, model: model.model, endpoint: `${endpoint.protocol}//${endpoint.host}${endpoint.pathname}`,
        method: model.kind === 'chat' ? 'GET' : 'POST', timeoutSeconds: model.timeoutSeconds,
      }] }))
    }).catch(() => { failures.push('当前模型配置参考读取失败') }) : Promise.resolve(),
  ])
  if (sequence === listSequence) metadataError.value = [...new Set(failures)].join('；')
}
async function removeTask(task: TaskInst) {
  if (!canDelete.value || deleting.value) return
  deleting.value = task.taskId; actionError.value = ''
  try { await ElMessageBox.confirm(`删除代码生成任务 ${task.taskId}？任务记录及其中的过程输出将从数据库删除，已有代码和 Git 归档保留。`, '删除任务', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) }
  catch { deleting.value = ''; return }
  try {
    const result = await runnerManagementApi.deleteCodeGenerationTask(task.taskId, task.configId || configId.value)
    if (selected.value?.taskId === task.taskId) clearDetail()
    ElMessage.success(result.message)
    if (rows.value.length === 1 && page.value > 1) page.value -= 1
    await load()
  } catch (e) { actionError.value = e instanceof Error ? e.message : String(e) }
  finally { deleting.value = '' }
}

function selectable(task: TaskInst) { return !deleting.value && execution.value[task.taskId] !== 'running' }
async function removeSelected() {
  const tasks = checkedTasks.value.filter(selectable)
  if (!canDelete.value || deleting.value || !tasks.length) return
  const dispatchConfig = configId.value
  deleting.value = 'batch'; actionError.value = ''
  try { await ElMessageBox.confirm(`删除所选 ${tasks.length} 个代码生成任务？任务记录及其中的过程输出将从数据库删除，已有代码和 Git 归档保留。`, '批量删除任务', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) }
  catch { deleting.value = ''; return }
  try {
    const result = await runnerManagementApi.deleteCodeGenerationTasks(tasks.map(task => task.taskId), dispatchConfig)
    const deleted = new Set(result.items.filter(item => item.ok).map(item => item.taskId))
    if (selected.value && deleted.has(selected.value.taskId)) clearDetail()
    if (result.deletedCount) ElMessage.success(`已删除 ${result.deletedCount} 个任务`)
    actionError.value = result.items.filter(item => !item.ok).map(item => `${item.taskId}：${item.message}`).join('；')
    if (configId.value === dispatchConfig) {
      if (rows.value.length && rows.value.every(row => deleted.has(row.taskId)) && page.value > 1) page.value -= 1
      await load()
    }
  } catch (e) { actionError.value = e instanceof Error ? e.message : String(e) }
  finally { deleting.value = '' }
}

async function loadConfigs() { await load() }
async function load() {
  const sequence = ++listSequence
  rows.value = []
  checkedTasks.value = []
  total.value = 0
  error.value = ''
  executionError.value = ''
  execution.value = {}
  rowModels.value = {}; rowArchives.value = {}; rowFinishedAt.value = {}; metadataError.value = ''
  loading.value = true
  try {
    const result = await runnerManagementApi.codeGenerationTasks({ configId: configId.value, sourceId: sourceId.value || undefined, taskId: taskId.value.trim() || undefined,
      state: (state.value || undefined) as TaskInst['state'] | undefined, page: page.value, size: size.value })
    if (sequence !== listSequence) return
    rows.value = result.list
    total.value = result.total
    if (selected.value) {
      const current = result.list.find(item => item.taskId === selected.value?.taskId)
      if (current) selected.value = current
      else clearDetail()
    }
    if (result.list.length) {
      void loadMetadata(result.list, sequence)
      try {
        const summary = await runnerManagementApi.mqCodeJobSummaries(result.list.map(row => row.taskId))
        if (sequence !== listSequence) return
        const states = new Map(summary.items.map(item => [item.taskId, item.status]))
        rowModels.value = Object.fromEntries(summary.items.filter(item => item.modelCall).map(item => [item.taskId, item.modelCall!]))
        rowArchives.value = Object.fromEntries(summary.items.filter(item => item.archive).map(item => [item.taskId, item.archive!]))
        rowFinishedAt.value = Object.fromEntries(summary.items.map(item => [item.taskId, item.finishedAt || '']))
        execution.value = Object.fromEntries(result.list.map(row => [row.taskId, states.get(row.taskId) || (['W', 'W1', 'L'].includes(row.state) ? 'waiting' : row.state === 'C' ? 'succeeded' : row.state === 'E' ? 'failed' : 'waiting')]))
      } catch (e) { if (sequence === listSequence) executionError.value = e instanceof Error ? e.message : String(e) }
    }
  } catch (e) { if (sequence === listSequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (sequence === listSequence) loading.value = false }
}
async function search() { page.value = 1; await load() }
function stopPolling() { clearTimeout(timer); ++detailSequence; detailLoading.value = false }
async function loadDetail() {
  clearTimeout(timer)
  if (!selected.value || !detailOpen.value || !active) return
  const sequence = ++detailSequence
  detailLoading.value = true
  try {
    const result = await runnerManagementApi.mqCodeJob(selected.value.taskId)
    if (sequence !== detailSequence) return
    job.value = result.job
    if (result.job) rowFinishedAt.value[selected.value!.taskId] = result.job.finishedAt || ''
    execution.value[selected.value!.taskId] = result.job?.status || (['W', 'W1', 'L'].includes(selected.value!.state) ? 'waiting' : selected.value!.state === 'C' ? 'succeeded' : 'failed')
    detailError.value = ''
    if (!modelInfo.value && typeof generation.value.interfaceId === 'string') {
      try {
        const settings = await runnerManagementApi.modelInterfaces()
        if (sequence !== detailSequence) return
        const model = settings.items.find(item => item.id === generation.value.interfaceId)
        if (model) {
          const endpoint = new URL(model.endpoint)
          referenceModel.value = { interfaceId: model.id, name: model.name, kind: model.kind, model: model.model,
            endpoint: `${endpoint.protocol}//${endpoint.host}${endpoint.pathname}`, method: model.kind === 'chat' ? 'GET' : 'POST', timeoutSeconds: model.timeoutSeconds, serverId: model.generationServerId }
        }
        referenceError.value = model ? '' : '任务所选接口已不存在，无法查询当前配置参考'
      } catch (e) { if (sequence === detailSequence) referenceError.value = `当前模型配置参考查询失败：${e instanceof Error ? e.message : String(e)}` }
    }
  } catch (e) { if (sequence === detailSequence) detailError.value = e instanceof Error ? e.message : String(e) }
  finally {
    if (sequence === detailSequence) {
      detailLoading.value = false
      if (detailOpen.value && active && (!job.value || !job.value.callbackSent)) timer = setTimeout(loadDetail, 5000)
    }
  }
}
function openDetail(task: TaskInst) {
  stopPolling()
  selected.value = task
  job.value = null
  detailError.value = ''
  referenceModel.value = null; referenceError.value = ''
  detailTab.value = 'request'
  detailOpen.value = true
  void loadDetail()
}
onMounted(loadConfigs)
onActivated(() => { active = true; if (detailOpen.value) void loadDetail() })
onDeactivated(() => { active = false; stopPolling() })
onBeforeUnmount(() => { active = false; ++listSequence; stopPolling() })
</script>

<template>
  <section class="code-tasks">
    <header><h2>代码生成任务</h2><span>数据库任务 · 自动匹配生成机器</span></header>
    <form class="filters" @submit.prevent="search">
      <el-input v-model="configId" aria-label="节点配置 ID" placeholder="节点配置 ID" clearable class="config-select" />
      <GlobalSourceSelect :model-value="sourceId" data-testid="code-task-source-filter" @update:model-value="pickSource" />
      <el-input v-model="taskId" aria-label="任务 ID" placeholder="任务 ID" clearable class="task-search" />
      <el-select v-model="state" aria-label="业务状态" placeholder="全部业务状态" clearable class="state-select" @change="search">
        <el-option v-for="code in ['L', 'C', 'E']" :key="code" :value="code" :label="code === 'L' ? '待处理 / 运行中' : runStateInfo(code).label" />
      </el-select>
      <el-button native-type="submit" type="primary" >查询</el-button>
      <el-button :icon="Refresh" aria-label="刷新代码生成任务" :loading="loading" @click="load()" />
    </form>
    <el-alert v-if="error" :title="`代码生成任务加载失败：${error}`" type="error" :closable="false" show-icon />
    <el-alert v-if="executionError" :title="`执行状态查询失败：${executionError}`" type="warning" :closable="false" />
    <el-alert v-if="metadataError" :title="metadataError" type="warning" :closable="false" />
    <el-alert v-if="actionError" :title="`删除任务失败：${actionError}`" type="error" :closable="false" />
    <div class="task-layout" data-testid="code-task-split-layout">
    <section class="task-list-panel" aria-label="代码生成任务列表">
    <div v-if="canDelete" class="task-actions"><el-button type="danger" plain size="small" :disabled="!checkedTasks.length || !!deleting || loading" :loading="deleting === 'batch'" data-testid="delete-selected-code-tasks" @click="removeSelected">删除所选{{ checkedTasks.length ? `（${checkedTasks.length}）` : '' }}</el-button><span>待处理任务可删除，运行中任务不可删除</span></div>
    <el-table v-loading="loading" :data="rows" class="task-table" height="100%" highlight-current-row :current-row-key="selected?.taskId" row-key="taskId" @selection-change="checkedTasks = $event" @row-click="openDetail" empty-text="当前条件暂无代码生成任务">
      <el-table-column v-if="canDelete" type="selection" width="38" :selectable="selectable" />
      <el-table-column label="任务信息 / 状态 / 结果" min-width="145"><template #default="{ row }"><el-button link type="primary" @click.stop="openDetail(row)">{{ row.taskId }}</el-button><div class="cell-ellipsis" :title="row.taskName">{{ row.taskName || '代码生成任务' }}</div><span class="task-status" :class="`is-${execution[row.taskId] || 'unknown'}`" :data-testid="`code-task-status-${row.taskId}`">{{ execution[row.taskId] === 'succeeded' ? '已完成' : executionLabel(row) }}</span><small v-if="rowFinishedAt[row.taskId]" :title="`完成时间：${formatRunnerDateTime(rowFinishedAt[row.taskId])}`">完成 {{ formatRunnerDateTime(rowFinishedAt[row.taskId]) }}</small><small v-else>{{ row.createdAt || '—' }}</small><template v-if="repositoryResult(row)"><RouterLink :to="repositoryResult(row)!.target" class="cell-source" :data-testid="`code-task-repository-${row.taskId}`" :title="repositoryResult(row)!.count === 1 ? '查看仓库代码文件' : '查看该配置生成的仓库文件'" @click.stop>{{ repositoryResult(row)!.label }}</RouterLink><small v-if="repositoryResult(row)!.count > 1">{{ repositoryResult(row)!.count }} 个文件</small></template></template></el-table-column>
      <el-table-column label="所属源 / 流程节点" min-width="165"><template #default="{ row }"><RouterLink v-if="taskInfo(row).sourceId" :to="sourceLink(row)" class="cell-source" :title="taskInfo(row).sourceId" @click.stop>{{ taskInfo(row).sourceName }}</RouterLink><span v-else>未记录源</span><small>源 {{ taskInfo(row).sourceId || '—' }}</small><div class="cell-ellipsis" :title="`${taskInfo(row).flowName} / ${taskInfo(row).nodeName}`">{{ taskInfo(row).flowName }} / {{ taskInfo(row).nodeName }}</div><small :title="taskInfo(row).configId">配置 {{ taskInfo(row).configId || '—' }}</small></template></el-table-column>
      <el-table-column label="模型 / 调用地址" min-width="155"><template #default="{ row }"><div class="cell-ellipsis" :title="taskModel(row)?.name">{{ taskModel(row)?.name || '未记录模型' }}</div><small>{{ taskModel(row)?.model || '接口默认模型' }}</small><div class="cell-ellipsis model-endpoint" :title="taskModel(row)?.endpoint">{{ taskModel(row)?.endpoint || '—' }}</div><div class="cell-ellipsis" :title="generationServerLabel(taskModel(row), ['waiting', 'queued'].includes(execution[row.taskId] || ''))" data-testid="task-generation-server">{{ generationServerLabel(taskModel(row), ['waiting', 'queued'].includes(execution[row.taskId] || '')) }}</div></template></el-table-column>
      <el-table-column label="操作" width="82" fixed="right"><template #default="{ row }"><el-button link type="primary" @click.stop="openDetail(row)">查看详情</el-button><el-button v-if="canDelete" link type="danger" :loading="deleting === row.taskId" :disabled="!!deleting || execution[row.taskId] === 'running'" :title="execution[row.taskId] === 'running' ? '执行结束后可删除' : '删除此代码生成任务'" data-testid="delete-code-task" @click.stop="removeTask(row)">删除</el-button></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="page" v-model:page-size="size" :total="total" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" @current-change="load" @size-change="search" />
    </section>
    <section class="task-detail-panel" aria-label="代码生成任务详情" data-testid="code-task-detail-panel">
      <div class="detail-heading"><b>任务详情<span v-if="selected"> · {{ selected.taskId }}</span></b><el-button v-if="selected" :icon="Refresh" :loading="detailLoading" @click="loadDetail">刷新</el-button></div>
      <template v-if="selected">
        <div class="detail-summary">
          <div>任务 ID：{{ selected.taskId }}</div>
          <div>生成状态：{{ executionLabel(selected) }}</div>
          <div>业务状态：{{ runStateInfo(selected.state).label }}</div>
          <div>节点配置：{{ selected.configId || configId }}</div>
          <div>所属源：<RouterLink v-if="taskInfo(selected).sourceId" :to="sourceLink(selected)">{{ taskInfo(selected).sourceName }}</RouterLink><span v-else>未记录</span>（{{ taskInfo(selected).sourceId || '—' }}）</div>
          <div>来源流程：{{ taskInfo(selected).flowName }}</div>
          <div>流程节点：{{ taskInfo(selected).nodeName }} · 配置 {{ job?.configId || taskInfo(selected).configId || '—' }}</div>
          <div v-if="job">生成服务实例：{{ job.serverId || '等待匹配机器' }}</div>
          <div>模型接口：{{ interfaceLabel }}</div>
          <div>大模型：{{ modelLabel }}</div>
        </div>
        <el-alert v-if="detailError" :title="`执行详情加载失败：${detailError}`" type="error" :closable="false" />
        <el-alert v-else-if="job" :title="`${statuses[job.status]} · ${job.callbackSent ? '结果已保存' : '尚未完成'}`" :description="job.message" :type="job.status === 'failed' ? 'error' : 'info'" :closable="false" />
        <el-alert v-else-if="!detailLoading" title="暂无处理机执行记录，任务可能尚未被领取。" type="info" :closable="false" />
        <el-tabs v-model="detailTab">
          <el-tab-pane label="过程输出" name="output"><pre>{{ job?.stages?.join('\n') }}{{ job?.stages?.length ? '\n\n' : '' }}{{ job?.output || '暂无过程输出' }}</pre></el-tab-pane>
          <el-tab-pane label="模型调用" name="request">
            <p class="model-info-source">{{ modelSource }}</p>
            <el-alert v-if="referenceError" :title="referenceError" type="warning" :closable="false" />
            <dl v-if="modelInfo" class="model-info" data-testid="generation-model-info">
              <div><dt>接口名称 / ID</dt><dd>{{ modelInfo.name }} / {{ modelInfo.interfaceId }}</dd></div>
              <div><dt>模型 / 接口类型</dt><dd>{{ modelInfo.model || '接口默认模型' }} · {{ modelInfo.kind }}</dd></div>
              <div class="model-address"><dt>接口地址</dt><dd>{{ modelInfo.method }} {{ modelInfo.endpoint }}</dd></div>
              <div><dt>调用超时</dt><dd>{{ modelInfo.timeoutSeconds }} 秒</dd></div>
              <div><dt>代码生成服务器</dt><dd>{{ generationServerLabel(modelInfo, job?.status === 'queued') }}</dd></div>
            </dl>
            <p v-else>历史任务未保存完整模型配置；{{ generation.interfaceId ? `接口 ID：${generation.interfaceId}` : '暂无模型接口信息' }}。</p>
            <details v-if="generation.systemPrompt || generation.userPrompt || generation.prompt" class="task-prompts"><summary>任务提示词</summary><h4>系统提示词</h4><pre>{{ generation.systemPrompt || '未记录' }}</pre><h4>用户提示词</h4><pre>{{ generation.userPrompt || generation.prompt || '未记录' }}</pre></details>
            <h4>执行时构造的 HTTP 请求</h4><pre data-testid="generation-model-request">{{ requestText || '尚未构造模型请求，当前展示的是任务调用配置，不代表已经发起调用。' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="生成结果" name="result"><section v-if="job?.result" class="generation-result" data-testid="generation-result">
            <dl class="result-info"><div><dt>结果文件</dt><dd>{{ resultFiles.length ? `${resultFiles.length} 个文件` : job.result.fileName }}</dd></div><div><dt>Git 状态</dt><dd>{{ gitResultStatus }}</dd></div><div v-if="resultArchive?.gitCommit"><dt>提交版本</dt><dd :title="resultArchive.gitCommit">{{ resultArchive.gitCommit.slice(0, 12) }}</dd></div></dl>
            <article v-for="file in resultFiles" :key="file.path" class="result-file"><h4>{{ file.path.split('/').pop() }}</h4><dl class="result-paths">
              <div><dt>生成服务器文件</dt><dd><RouterLink v-if="file.serverPath && resultServerId" :to="serverResultTarget(file.serverPath, true)" data-testid="generation-server-file-link" title="定位到生成服务器的文件目录">{{ file.serverPath }}</RouterLink><span v-else>{{ file.serverPath || '未记录生成服务器文件路径' }}</span></dd></div>
              <div><dt>Git 仓库文件</dt><dd><RouterLink v-if="resultArchive?.repoId" :to="gitFileTarget(file.path)" data-testid="generation-git-file-link">{{ file.path }}</RouterLink><span v-else>{{ file.path }}</span></dd></div>
            </dl></article>
            <template v-if="!resultFiles.length"><p>{{ job.result.fileName }}</p><dl v-if="resultServerDirectory" class="result-paths"><div><dt>生成服务器目录</dt><dd><RouterLink v-if="resultServerId" :to="serverResultTarget(resultServerDirectory)" data-testid="generation-server-directory-link">{{ resultServerDirectory }}</RouterLink><span v-else>{{ resultServerDirectory }}</span></dd></div></dl><p>尚无已归档的仓库文件</p></template>
            <p v-if="resultArchive?.message" class="result-message">{{ resultArchive.message }}</p>
          </section><el-empty v-else description="暂无生成结果" /></el-tab-pane>
          <el-tab-pane label="任务参数" name="params"><pre>{{ taskParamsText }}</pre><pre v-if="selected.taskResult">{{ taskResultText }}</pre></el-tab-pane>
        </el-tabs>
      </template>
      <el-empty v-else description="选择左侧任务，查看模型调用、过程输出和生成结果" />
    </section>
    </div>
  </section>
</template>

<style scoped>
.code-tasks { display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow: hidden; min-width:0; min-height:0; }
header { display: flex; align-items: baseline; gap: 16px; }
h2 { font-size: 18px; margin: 0; }
header span { font-size: 12px; color: var(--el-text-color-secondary); }
.filters { display: flex; gap: 10px; flex-wrap: wrap; }
.config-select { width: 220px; max-width: 100%; }
.task-search { width: 160px; }
.state-select { width: 130px; }
.task-table { flex: 1; min-height: 120px; }
.task-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }.task-actions span { font-size:11px; color:var(--el-text-color-secondary); }
.task-layout { display:grid; grid-template-columns:minmax(460px,1.05fr) minmax(400px,1fr); gap:12px; flex:1; min-height:0; min-width:0; }.task-list-panel { display:flex; flex-direction:column; gap:10px; min-height:0; min-width:0; }.task-detail-panel { overflow-y:auto; min-width:0; min-height:0; padding:12px; border:1px solid var(--el-border-color-lighter); border-radius:6px; }.detail-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; font-size:13px; }.detail-heading b { overflow-wrap:anywhere; }.detail-heading span { font-weight:400; color:var(--el-text-color-secondary); }.cell-ellipsis { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }.task-table small { display:block; color:var(--el-text-color-secondary); font-size:11px; }.model-endpoint { color:var(--el-text-color-secondary); font-family:Consolas,monospace; font-size:11px; }.cell-source { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--el-color-primary); font-size:12px; }
.detail-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; overflow-wrap: anywhere; }
.model-info-source { color: var(--el-text-color-secondary); font-size: 12px; }.model-info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }.model-info .model-address { grid-column: 1 / -1; }.model-info dt { color: var(--el-text-color-secondary); font-size: 12px; }.model-info dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 13px; }h4 { font-size: 13px; margin: 14px 0 6px; }.task-prompts { font-size: 13px; margin-top: 14px; }.task-prompts summary { cursor: pointer; }
:deep(.el-alert) { margin-top: 8px; flex-shrink: 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--el-fill-color-light); padding: 14px; border-radius: 6px; font-size: 12px; }
.task-status { display:inline-block; margin:3px 0; padding:1px 6px; border-radius:4px; font-size:11px; color:var(--el-text-color-secondary); background:var(--el-fill-color-light); }.task-status.is-succeeded { color:var(--el-color-success); background:var(--el-color-success-light-9); }.task-status.is-failed { color:var(--el-color-danger); background:var(--el-color-danger-light-9); }.task-status.is-running { color:var(--el-color-primary); background:var(--el-color-primary-light-9); }
.result-info { display:flex; flex-wrap:wrap; gap:12px 24px; }.result-info dt,.result-paths dt { color:var(--el-text-color-secondary); font-size:12px; }.result-info dd,.result-paths dd { margin:4px 0 0; font-size:12px; overflow-wrap:anywhere; }.result-file { padding:4px 0 12px; border-bottom:1px solid var(--el-border-color-lighter); }.result-paths { display:grid; gap:12px; }.result-paths a { color:var(--el-color-primary); text-decoration:none; }.result-paths a:hover { text-decoration:underline; }.result-message { color:var(--el-text-color-secondary); font-size:12px; }
@media (max-width:1100px) { .task-layout { grid-template-columns:minmax(370px,1fr) minmax(340px,1fr); gap:10px; }.detail-summary,.model-info { grid-template-columns:1fr; }.model-info .model-address { grid-column:auto; } }
@media (max-width:760px) { .code-tasks { overflow:auto; }.task-layout { grid-template-columns:1fr; grid-template-rows:360px minmax(320px,auto); flex:none; }.task-detail-panel { overflow:visible; }header span { display:none; } }
</style>
