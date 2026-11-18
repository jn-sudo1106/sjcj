<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElDrawer, ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { RouterLink, useRoute } from 'vue-router'
import { configApi, sourceApi, flowCenterApi, type NodeType } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentResourceRule, type GeneratedDeploymentJob, type RunnerInstance } from '@/api/runnerManagement'
import { deploymentStatuses } from '@/utils/deploymentStatus'
import DeploymentTaskProcess from './DeploymentTaskProcess.vue'
import RunnerFilesDrawer from './RunnerFilesDrawer.vue'
import DeploymentFilesDrawer from './DeploymentFilesDrawer.vue'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'

const route = useRoute(), auth = useAuthStore()
const props = defineProps<{ tasksOnly?: boolean; resourcesOnly?: boolean; runnerId?: string; sourceScopeId?: string }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const canWrite = computed(() => auth.role === 'admin')
const view = ref(props.resourcesOnly ? 'rules' : props.tasksOnly || route.query.configId ? 'jobs' : 'rules')
const resources = ref<DeploymentResourceRule[]>([]), revision = ref(''), runners = ref<RunnerInstance[]>([]), types = ref<NodeType[]>([])
const taskProcess = ref<InstanceType<typeof DeploymentTaskProcess>>()
const jobs = ref<GeneratedDeploymentJob[]>([]), total = ref(0), page = ref(1)
const sourceNames = ref<Record<string, string>>({}), flowNames = ref<Record<string, string>>({}), nodeNames = ref<Record<string, string>>({})
const metadataError = ref('')
const machineError = ref('')
async function loadNames(items: GeneratedDeploymentJob[], request: number) {
  const sourceIds = [...new Set(items.map(item => item.sourceId).filter(id => id && !sourceNames.value[id]))]
  const flowIds = [...new Set(items.map(item => item.flowId).filter(id => id && !flowNames.value[id]))]
  const failures: string[] = []
  await Promise.all([
    sourceIds.length ? sourceApi.sourcePaged({ sourceIds, size: sourceIds.length }).then(result => {
      if (request === sequence && active) for (const item of result.list) sourceNames.value[item.sourceId] = item.name
    }).catch(() => { failures.push('源名称加载失败，暂显示源 ID') }) : Promise.resolve(),
    (async () => { for (let i = 0; i < flowIds.length; i += 4) await Promise.all(flowIds.slice(i, i + 4).map(async id => {
      try {
        const [flow, nodes] = await Promise.all([flowCenterApi.detail(id), flowCenterApi.steps(id, { withConfigDetails: false })])
        if (request !== sequence || !active) return
        if (flow) flowNames.value[id] = flow.name
        for (const node of nodes) nodeNames.value[`${id}:${node.stepId}`] = node.name
      } catch { failures.push('流程或节点名称加载失败，暂显示 ID') }
    })) })(),
  ])
  if (request === sequence && active) metadataError.value = [...new Set(failures)].join('；')
}
const nodeType = ref(!props.sourceScopeId && typeof route.query.nodeType === 'string' ? route.query.nodeType : ''), env = ref(!props.sourceScopeId && typeof route.query.environment === 'string' ? route.query.environment : ''), configId = ref(!props.sourceScopeId && typeof route.query.configId === 'string' ? route.query.configId : '')
const loading = ref(false), saving = ref(false), error = ref(''), formError = ref('')
const draft = ref<DeploymentResourceRule | null>(null), editing = ref(-1), busyJob = ref(''), selected = ref<GeneratedDeploymentJob | null>(null)
const editingResourceId = ref('')
const browsing = ref<{ runner: RunnerInstance; directory: string } | null>(null)
const fileJob = ref<GeneratedDeploymentJob | null>(null)
function showDeploymentFiles(job: GeneratedDeploymentJob) { selected.value = null; browsing.value = null; fileJob.value = job }
const resourceKey = (row: DeploymentResourceRule) => String(resources.value.indexOf(row))
const inlineEditing = computed(() => !!editingResourceId.value)
const committedResources = ref<DeploymentResourceRule[]>([])
const supports = (item: DeploymentResourceRule, value: string) => item.environment === value || item.environment === 'both'
const filtered = computed(() => resources.value.filter(item => (!props.runnerId || item.runnerId === props.runnerId) && (resourceKey(item) === editingResourceId.value || ((!nodeType.value || item.configType === nodeType.value) && (!env.value || supports(item, env.value))))))
watch(() => saving.value || !!draft.value || inlineEditing.value, value => emit('busy', value), { immediate: true })
const machine = (id: string) => runners.value.find(item => item.runnerId === id)
const label = (id: string) => { const item = machine(id); return item ? `${item.ipAddress} · ${item.installDirectory}` : id }
function browseDeployment(row: GeneratedDeploymentJob, directory = row.installedPath || row.targetPath) {
  const runner = machine(row.runnerId)
  if (runner && directory) {
    selected.value = null
    browsing.value = { runner, directory }
  }
}
const repositoryDirectoryLink = (row: GeneratedDeploymentJob) => ({ path: '/settings', query: { tab: 'code-repos', repoId: row.repositoryId, folderPath: row.gitDirectory } })
const instanceLink = (row: GeneratedDeploymentJob) => ({ path: '/settings', query: { tab: 'runners', runnerId: row.runnerId, view: 'instances' } })
const deploymentInstanceLink = (row: GeneratedDeploymentJob) => ({ path: '/settings', query: { tab: 'runners', runnerId: row.runnerId, view: 'runner' } })
const deploymentInstanceIp = (row: GeneratedDeploymentJob) => row.runnerIp || machine(row.runnerId)?.ipAddress || row.runnerId
const deploymentInstanceName = (row: GeneratedDeploymentJob) => row.runnerName || machine(row.runnerId)?.name || row.runnerId
const deploymentInstanceDirectory = (row: GeneratedDeploymentJob) => row.instanceDirectory || machine(row.runnerId)?.installDirectory || ''
const deploymentInstanceTitle = (row: GeneratedDeploymentJob) => [deploymentInstanceIp(row), deploymentInstanceName(row), row.runnerId, deploymentInstanceDirectory(row)].filter(Boolean).join('\n')
const instanceStatusLabels = { online: '在线', offline: '离线', upgrading: '升级中', error: '异常' }
const nodeLink = (row: GeneratedDeploymentJob, deployment = false) => ({ path: '/canvas', query: {
  sourceId: row.sourceId, view: 'flow', ...(row.flowId ? { flowId: row.flowId } : {}),
  ...(row.stepId ? { nodeId: row.stepId } : {}), ...(deployment ? { tab: 'deployment' } : {}),
} })
let active = true, initialized = false, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const taskQuery = () => ({ configId: configId.value.trim() || undefined,
  sourceId: props.sourceScopeId || (typeof route.query.sourceId === 'string' ? route.query.sourceId : undefined),
  flowId: !props.sourceScopeId && typeof route.query.flowId === 'string' ? route.query.flowId : undefined,
  stepId: !props.sourceScopeId && typeof route.query.stepId === 'string' ? route.query.stepId : undefined,
  environment: env.value === 'test' || env.value === 'production' ? env.value as 'test' | 'production' : undefined, page: page.value, size: 20 })
async function loadTaskMachines(request: number) {
  try {
    const items = await runnerManagementApi.instances()
    if (request === sequence && active) { runners.value = items; machineError.value = '' }
  } catch (e) { if (request === sequence && active) machineError.value = `服务器信息加载失败：${message(e)}` }
}
async function loadTaskPage() {
  const request = ++sequence
  loading.value = true; error.value = ''
  void loadTaskMachines(request)
  try {
    const result = await runnerManagementApi.generatedDeployments(taskQuery())
    if (request !== sequence || !active) return
    jobs.value = result.items; total.value = result.total
    if (selected.value) selected.value = result.items.find(item => item.jobId === selected.value?.jobId) || selected.value
    void loadNames(result.items, request)
  } catch (e) { if (request === sequence && active) error.value = `部署任务加载失败：${message(e)}` }
  finally { if (request === sequence && active) loading.value = false }
}
function refresh() { void load(); void taskProcess.value?.refresh() }
async function load() {
  if (saving.value) return
  if (props.tasksOnly) return loadTaskPage()
  const request = ++sequence
  loading.value = true; error.value = ''
  const results = await Promise.allSettled([runnerManagementApi.deploymentResources(), runnerManagementApi.instances(), configApi.nodeTypeList(),
    props.resourcesOnly ? Promise.resolve({ items: [] as GeneratedDeploymentJob[], total: 0 }) : runnerManagementApi.generatedDeployments({ configId: configId.value.trim() || undefined,
      sourceId: typeof route.query.sourceId === 'string' ? route.query.sourceId : undefined,
      flowId: typeof route.query.flowId === 'string' ? route.query.flowId : undefined,
      stepId: typeof route.query.stepId === 'string' ? route.query.stepId : undefined,
      environment: env.value === 'test' || env.value === 'production' ? env.value : undefined, page: page.value, size: 20 })])
  if (request !== sequence || !active) return
  const [rules, machines, nodeTypes, deployments] = results
  if (rules.status === 'fulfilled') { if (!draft.value && !saving.value && !inlineEditing.value) { resources.value = rules.value.items; committedResources.value = JSON.parse(JSON.stringify(rules.value.items)); revision.value = rules.value.revision } } else error.value = `默认资源加载失败：${message(rules.reason)}`
  if (machines.status === 'fulfilled') runners.value = machines.value; else error.value += ` 服务器加载失败：${message(machines.reason)}`
  if (nodeTypes.status === 'fulfilled') types.value = nodeTypes.value; else error.value += ` 节点类型加载失败：${message(nodeTypes.reason)}`
  if (deployments.status === 'fulfilled') { jobs.value = deployments.value.items; total.value = deployments.value.total; if (selected.value) selected.value = jobs.value.find(item => item.jobId === selected.value?.jobId) || selected.value } else error.value += ` 部署任务加载失败：${message(deployments.reason)}`
  loading.value = false
  if (view.value === 'jobs' && deployments.status === 'fulfilled') void loadNames(deployments.value.items, request)
}
function edit(item?: DeploymentResourceRule) {
  editing.value = item ? resources.value.indexOf(item) : -1
  draft.value = item ? { ...item, deploymentDirectory: item.deploymentDirectory || machine(item.runnerId)?.installDirectory || '' } : { resourceName: '', configType: nodeType.value, configTypeName: '', environment: env.value === 'production' ? 'production' : 'test', runnerId: props.runnerId || '', deploymentDirectory: props.runnerId ? machine(props.runnerId)?.installDirectory || '' : '', enabled: true, isDefault: false }
  formError.value = ''
}
watch(view, () => { void load() })
watch(() => [draft.value?.configType, draft.value?.environment], () => {
  if (draft.value && editing.value < 0) draft.value.isDefault = !resources.value.some(item => item.enabled && item.isDefault !== false && item.configType === draft.value?.configType && (item.environment === draft.value?.environment || item.environment === 'both' || draft.value?.environment === 'both'))
})
watch(() => draft.value?.runnerId, (runnerId, previous) => {
  if (!runnerId || !draft.value) return
  if (!draft.value.deploymentDirectory || draft.value.deploymentDirectory === machine(previous || '')?.installDirectory) {
    draft.value.deploymentDirectory = machine(runnerId)?.installDirectory || ''
  }
})
async function save() {
  if (!draft.value || saving.value) return
  if (!draft.value.configType || !draft.value.runnerId) { formError.value = '请选择节点类型和服务器实例'; return }
  if (props.runnerId && draft.value.runnerId !== props.runnerId) { formError.value = '请选择当前服务器实例'; return }
  const row: DeploymentResourceRule = { resourceId: draft.value.runnerId, resourceName: machine(draft.value.runnerId)?.name || draft.value.runnerId,
    configType: draft.value.configType, configTypeName: types.value.find(item => String(item.sourceType) === draft.value?.configType)?.typeName || draft.value.configTypeName,
    environment: draft.value.environment, runnerId: draft.value.runnerId, deploymentDirectory: (draft.value.deploymentDirectory || '').trim(), entryPoint: (draft.value.entryPoint || '').trim(),
    enabled: draft.value.enabled, isDefault: draft.value.isDefault !== false }
  const items = resources.value.map(item => ({ ...item }))
  if (editing.value < 0) items.push(row); else items[editing.value] = row
  if (row.isDefault) for (const item of items) if (item !== row && item.configType === row.configType && (supports(item, row.environment) || row.environment === 'both')) item.isDefault = false
  saving.value = true; formError.value = ''
  try { const saved = await runnerManagementApi.saveDeploymentResources({ items, revision: revision.value }); resources.value = saved.items; committedResources.value = JSON.parse(JSON.stringify(saved.items)); revision.value = saved.revision; draft.value = null; ElMessage.success('部署资源已保存') }
  catch (e) { formError.value = message(e) }
  finally { saving.value = false }
}
function editRow(row: DeploymentResourceRule) {
  if (!canWrite.value || saving.value || draft.value || inlineEditing.value) return
  sequence++; loading.value = false; error.value = ''; editingResourceId.value = resourceKey(row)
}
function cancelRow() {
  if (saving.value) return
  resources.value = JSON.parse(JSON.stringify(committedResources.value))
  editingResourceId.value = ''; error.value = ''
}
async function saveRow(row: DeploymentResourceRule) {
  if (saving.value || !canWrite.value) return
  if (props.runnerId && row.runnerId !== props.runnerId) { error.value = '资源必须属于当前服务器实例'; return }
  sequence++; loading.value = false
  const previous = committedResources.value[resources.value.indexOf(row)]
  if (previous && previous.runnerId !== row.runnerId && (!previous.deploymentDirectory || previous.deploymentDirectory === machine(previous.runnerId)?.installDirectory)) row.deploymentDirectory = ''
  const items = resources.value.map(item => ({ ...item, resourceId: item.runnerId, resourceName: machine(item.runnerId)?.name || item.runnerId,
    configTypeName: types.value.find(type => String(type.sourceType) === item.configType)?.typeName || item.configTypeName }))
  const changed = items[resources.value.indexOf(row)]!
  if (changed.enabled && changed.isDefault) for (const item of items) {
    if (item !== changed && item.configType === changed.configType && (supports(item, changed.environment) || changed.environment === 'both')) item.isDefault = false
  }
  saving.value = true; error.value = ''
  try {
    const saved = await runnerManagementApi.saveDeploymentResources({ items, revision: revision.value })
    resources.value = saved.items; committedResources.value = JSON.parse(JSON.stringify(saved.items)); revision.value = saved.revision
    editingResourceId.value = ''; ElMessage.success('部署资源已保存')
  } catch (e) { error.value = message(e) }
  finally { saving.value = false }
}
async function act(job: GeneratedDeploymentJob, action: 'retry' | 'sync-git') {
  if (busyJob.value) return
  busyJob.value = job.jobId
  try {
    const result = await runnerManagementApi.generatedDeploymentAction(job.jobId, action)
    ElMessage.success(action === 'sync-git' && result.status === 'success' ? '已部署仓库最新版本' : '部署任务已提交')
    await load()
  }
  catch (e) { ElMessage.error(message(e)) }
  finally { busyJob.value = '' }
}
function search() { page.value = 1; void load() }
function poll() { if (timer) clearTimeout(timer); timer = setTimeout(async () => { if (active && !loading.value && !draft.value && !saving.value && !inlineEditing.value) await load(); if (active) poll() }, 10000) }
onMounted(() => { initialized = true; void load(); poll() })
onActivated(() => { const reactivated = !active; active = true; if (initialized && reactivated) { void load(); poll() } })
function stop() { active = false; sequence++; if (timer) clearTimeout(timer) }
onDeactivated(stop); onUnmounted(stop)
onUnmounted(() => emit('busy', false))
</script>

<template>
  <section class="dr-page" :class="{ 'dr-task-center': tasksOnly }" data-testid="settings-deployment-resources">
    <header v-if="tasksOnly" class="dr-task-header"><h2>部署任务</h2><span>每台机器独立部署 · 分别查看执行结果</span></header>
    <div class="dr-toolbar"><el-radio-group v-if="!tasksOnly && !resourcesOnly" v-model="view"><el-radio-button value="rules">部署资源</el-radio-button><el-radio-button value="jobs">部署任务</el-radio-button></el-radio-group>
      <el-select v-if="view === 'rules' && !runnerId" v-model="nodeType" placeholder="节点类型" clearable filterable aria-label="筛选节点类型"><el-option v-for="item in types" :key="item.sourceType" :value="String(item.sourceType)" :label="item.typeName" /></el-select>
      <el-input v-else-if="view !== 'rules'" v-model="configId" placeholder="配置 ID" clearable aria-label="配置 ID" @keyup.enter="search" />
      <el-select v-if="!runnerId || view !== 'rules'" v-model="env" placeholder="全部环境" clearable aria-label="部署环境" @change="search"><el-option label="测试" value="test" /><el-option label="生产" value="production" /></el-select>
      <el-button v-if="view === 'rules' && canWrite" :disabled="!!draft || inlineEditing || saving" @click="edit()">{{ runnerId ? '配置节点类型' : '新增资源' }}</el-button>
      <el-button :icon="Refresh" :loading="loading" :aria-label="view === 'jobs' ? '刷新部署任务' : '刷新部署资源'" @click="refresh" />
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-alert v-if="view === 'jobs' && metadataError" :title="metadataError" type="warning" :closable="false" />
    <el-alert v-if="tasksOnly && machineError" :title="machineError" type="warning" :closable="false" />
    <div class="dr-body" :class="{ 'dr-task-layout': tasksOnly }" :data-testid="tasksOnly ? 'deployment-task-split-layout' : undefined">
    <section class="dr-list-panel" :aria-label="tasksOnly ? '部署任务列表' : undefined">
    <template v-if="view === 'rules'">
      <div v-if="draft" class="dr-editor" data-testid="deployment-resource-editor">
        <el-select v-model="draft.configType" placeholder="节点类型" filterable aria-label="默认资源节点类型"><el-option v-for="item in types" :key="item.sourceType" :value="String(item.sourceType)" :label="item.typeName" /></el-select>
        <el-select v-model="draft.environment" aria-label="默认资源环境"><el-option label="测试" value="test" /><el-option label="生产" value="production" /><el-option label="生产和测试" value="both" /></el-select>
        <el-select v-if="!runnerId" v-model="draft.runnerId" :disabled="!!props.runnerId" placeholder="选择服务器实例" filterable aria-label="默认部署服务器"><el-option v-if="draft.runnerId && !machine(draft.runnerId)" :value="draft.runnerId" label="原实例已不存在，请重新选择" disabled /><el-option v-for="item in runners" :key="item.runnerId" :value="item.runnerId" :label="`${label(item.runnerId)} · ${item.status === 'online' ? '在线' : '离线'}`" /></el-select>
        <small>入口程序在部署配置的 Git 源目录中统一设置</small>
        <div class="dr-actions"><el-switch v-model="draft.enabled" active-text="启用" inactive-text="停用" />
        <span>是否默认</span><el-switch v-model="draft.isDefault" active-text="是" inactive-text="否" />
        <el-button type="primary" :loading="saving" @click="save">保存</el-button><el-button :disabled="saving" @click="draft = null">取消</el-button></div>
        <p v-if="formError" role="alert">{{ formError }}</p>
      </div>
      <el-table class="dr-resources" :row-key="resourceKey" table-layout="fixed" :data="filtered" empty-text="尚未配置默认资源。代码生成后会等待匹配资源。">
        <el-table-column v-if="!runnerId" prop="runnerId" label="资源 ID" min-width="200" show-overflow-tooltip />
        <el-table-column v-if="!runnerId" label="资源名称" min-width="160"><template #default="{ row }"><span class="dr-value">{{ machine(row.runnerId)?.name || row.runnerId }}</span></template></el-table-column>
        <el-table-column label="节点类型" min-width="140"><template #default="{ row }"><el-select v-if="canWrite && editingResourceId === resourceKey(row)" v-model="row.configType" aria-label="列表节点类型" :disabled="saving || !!draft" filterable><el-option v-for="item in types" :key="item.sourceType" :value="String(item.sourceType)" :label="item.typeName" /></el-select><span v-else class="dr-value">{{ row.configTypeName }}</span></template></el-table-column>
        <el-table-column label="环境" min-width="145"><template #default="{ row }"><el-select v-if="canWrite && editingResourceId === resourceKey(row)" v-model="row.environment" aria-label="列表资源环境" :disabled="saving || !!draft"><el-option label="测试" value="test" /><el-option label="生产" value="production" /><el-option label="生产和测试" value="both" /></el-select><span v-else class="dr-value">{{ row.environment === 'both' ? '生产和测试' : row.environment === 'test' ? '测试' : '生产' }}</span></template></el-table-column>
        <el-table-column v-if="!runnerId" label="服务器 / Runner 实例" min-width="170"><template #default="{ row }"><el-select v-if="canWrite && editingResourceId === resourceKey(row)" v-model="row.runnerId" aria-label="列表服务器实例" :disabled="saving || !!draft || !!props.runnerId" filterable><el-option v-for="item in runners" :key="item.runnerId" :value="item.runnerId" :label="item.ipAddress" :title="item.installDirectory">{{ item.ipAddress }} · {{ item.installDirectory }}</el-option></el-select><span v-else class="dr-value">{{ machine(row.runnerId)?.ipAddress || '实例不存在' }}</span></template></el-table-column>
        <el-table-column label="状态" width="120"><template #default="{ row }"><el-switch v-if="canWrite && editingResourceId === resourceKey(row)" v-model="row.enabled" aria-label="资源启用状态" :disabled="saving || !!draft" :active-text="row.enabled ? '启用' : '停用'" /><span v-else class="dr-value">{{ row.enabled ? '启用' : '停用' }}</span></template></el-table-column>
        <el-table-column label="是否默认" width="120"><template #default="{ row }"><el-switch v-if="canWrite && editingResourceId === resourceKey(row)" v-model="row.isDefault" aria-label="资源默认状态" :disabled="saving || !!draft" :active-text="row.isDefault ? '是' : '否'" /><span v-else class="dr-value">{{ row.isDefault !== false ? '是' : '否' }}</span></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="130" fixed="right"><template #default="{ row }">
          <div v-if="editingResourceId === resourceKey(row)" class="dr-row-actions"><el-button link type="primary" :loading="saving" @click="saveRow(row)">保存</el-button><el-button link :disabled="saving" @click="cancelRow">取消</el-button></div>
          <div v-else class="dr-row-actions"><el-button link type="primary" :disabled="inlineEditing || !!draft || saving" @click="editRow(row)">编辑</el-button></div>
        </template></el-table-column>
      </el-table>
    </template>
    <template v-else>
      <el-table row-key="jobId" :height="tasksOnly ? '100%' : undefined" :current-row-key="selected?.jobId" :data="jobs" highlight-current-row @row-click="selected = $event" empty-text="暂无部署任务">
        <el-table-column :label="tasksOnly ? '任务信息 / 状态' : '任务 ID'" min-width="155" show-overflow-tooltip><template #default="{ row }"><el-button link type="primary" @click.stop="selected = row">{{ row.jobId }}</el-button><template v-if="tasksOnly"><div class="dr-task-status" :class="`is-${row.status}`">{{ deploymentStatuses[row.status] || row.status }}</div><small>{{ row.environment === 'test' ? '测试' : '生产' }} · {{ formatRunnerDateTime(row.updatedAt) }}</small></template></template></el-table-column>
        <el-table-column label="所属源 / 流程节点" min-width="200"><template #default="{ row }"><RouterLink v-if="row.sourceId" :to="nodeLink(row)" class="dr-node-link dr-source-name" :title="sourceNames[row.sourceId] || row.sourceId" data-testid="deployment-source-link" @click.stop>{{ sourceNames[row.sourceId] || row.sourceId }}</RouterLink><span v-else>未记录源</span><small>源 {{ row.sourceId || '—' }}</small><div class="dr-flow-node" :title="`${flowNames[row.flowId] || row.flowId} / ${nodeNames[`${row.flowId}:${row.stepId}`] || row.stepId}`">{{ flowNames[row.flowId] || row.flowId || '未记录流程' }} / {{ nodeNames[`${row.flowId}:${row.stepId}`] || row.stepId || '未记录节点' }}</div><small><RouterLink v-if="row.sourceId && row.flowId && row.stepId && row.configId" :to="nodeLink(row, true)" class="dr-node-link dr-config-id" data-testid="deployment-config-link" @click.stop>配置 {{ row.configId }}</RouterLink><span v-else>配置 {{ row.configId || '—' }}</span></small></template></el-table-column>
        <el-table-column v-if="!tasksOnly" label="环境" width="75"><template #default="{ row }">{{ row.environment === 'test' ? '测试' : '生产' }}</template></el-table-column>
        <el-table-column v-if="!tasksOnly" label="部署状态" min-width="125">
          <template #default="{ row }">
            <span :title="row.message">{{ deploymentStatuses[row.status] || row.status }}</span>
            <small v-if="['queued', 'waiting_resource'].includes(row.status) && row.message">{{ row.message }}</small>
          </template>
        </el-table-column>
        <el-table-column label="部署实例 / 目录" min-width="190">
          <template #default="{ row }">
            <RouterLink v-if="row.runnerId" :to="deploymentInstanceLink(row)" :title="deploymentInstanceTitle(row)" class="dr-instance-link" data-testid="deployment-instance-link" @click.stop>
              <span class="dr-instance-heading"><strong>{{ deploymentInstanceIp(row) }}</strong><span v-if="machine(row.runnerId)" class="dr-instance-status" :class="`is-${machine(row.runnerId)!.status}`">{{ instanceStatusLabels[machine(row.runnerId)!.status] }}</span></span>
              <span class="dr-instance-name">{{ deploymentInstanceName(row) }}</span>
              <span class="dr-instance-directory">{{ deploymentInstanceDirectory(row) || '实例目录未记录' }}</span>
            </RouterLink>
            <span v-else>{{ row.status === 'superseded' ? '无需分配' : '待分配' }}</span>
            <small><el-button v-if="canWrite && machine(row.runnerId) && (row.installedPath || row.targetPath)" link type="primary" class="dr-job-directory" data-testid="browse-deployment-directory" :title="row.installedPath || row.targetPath" @click.stop="browseDeployment(row)">📁 {{ row.installedPath || row.targetPath }}</el-button><template v-else>{{ row.installedPath || row.targetPath || row.message }}</template></small>
          </template>
        </el-table-column>
        <el-table-column v-if="!tasksOnly" label="Git 目录" min-width="180"><template #default="{ row }"><RouterLink v-if="row.repositoryId && row.gitDirectory" :to="repositoryDirectoryLink(row)" class="dr-git-directory" data-testid="browse-deployment-git-directory" @click.stop>📁 {{ row.gitDirectory }}</RouterLink><code v-else>{{ row.gitDirectory || '未记录' }}</code><small>{{ row.repositoryName || row.repositoryId }}</small></template></el-table-column>
        <el-table-column v-if="!tasksOnly" label="Git 版本" width="120"><template #default="{ row }"><code>{{ row.gitCommit.slice(0, 12) }}</code></template></el-table-column>
        <el-table-column v-if="!tasksOnly" label="更新时间" width="165"><template #default="{ row }">{{ formatRunnerDateTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column v-if="tasksOnly" label="操作" width="120" fixed="right"><template #default="{ row }"><div class="dr-task-actions"><el-button link type="primary" data-testid="deployment-view-detail" @click.stop="selected = row">查看详情</el-button><RouterLink v-if="row.runnerId" :to="instanceLink(row)" data-testid="deployment-open-instance" @click.stop>查看运行实例</RouterLink></div></template></el-table-column><el-table-column v-else label="操作" min-width="255"><template #default="{ row }"><el-button v-if="row.status === 'success'" link type="primary" data-testid="open-deployment-files" @click.stop="showDeploymentFiles(row)">部署文件</el-button><RouterLink v-if="row.runnerId" :to="instanceLink(row)" data-testid="deployment-open-instance" @click.stop>查看运行实例</RouterLink><RouterLink v-if="row.deliveryId" :to="{ path: '/settings', query: { tab: 'runtime-logs', recordId: row.deliveryId, runnerId: row.runnerId } }" target="_blank">部署日志</RouterLink><template v-if="canWrite"><el-button v-if="row.status === 'success'" link :disabled="!!busyJob" data-testid="sync-deployment-git" @click.stop="act(row, 'sync-git')">同步 Git 代码</el-button><el-button v-if="['waiting_resource','queued','failed'].includes(row.status)" link :disabled="!!busyJob" @click.stop="act(row, 'retry')">重试</el-button></template></template></el-table-column>
      </el-table>
      <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total, prev, pager, next" @current-change="load" />
    </template>
    </section>
    <DeploymentFilesDrawer v-if="fileJob" :job="fileJob" @close="fileJob = null" />
    <RunnerFilesDrawer v-if="browsing" :runner="browsing.runner" :directory="browsing.directory" @close="browsing = null" />
    <component :is="tasksOnly ? 'section' : ElDrawer" v-bind="tasksOnly ? { class: 'dr-detail-panel', 'aria-label': '部署任务详情', 'data-testid': 'deployment-task-detail-panel' } : { modelValue: !!selected, title: '部署任务详情', size: 'min(620px, 92vw)' }" @close="selected = null">
      <div v-if="tasksOnly" class="dr-detail-heading"><b>任务详情<span v-if="selected"> · {{ selected.jobId }}</span></b><el-button v-if="selected" :icon="Refresh" :loading="loading" @click="refresh">刷新</el-button></div>
      <template v-if="tasksOnly && selected">
        <div class="dr-detail-summary"><div>部署状态：{{ deploymentStatuses[selected.status] || selected.status }}</div><div>环境：{{ selected.environment === 'test' ? '测试' : '生产' }}</div><div>所属源：<RouterLink :to="nodeLink(selected)">{{ sourceNames[selected.sourceId] || selected.sourceId || '未记录' }}</RouterLink></div><div>节点配置：<RouterLink :to="nodeLink(selected, true)">{{ selected.configId }}</RouterLink></div><div>来源流程：{{ flowNames[selected.flowId] || selected.flowId || '未记录' }}</div><div>流程节点：{{ nodeNames[`${selected.flowId}:${selected.stepId}`] || selected.stepId || '未记录' }}</div><div>执行机器：<RouterLink v-if="selected.runnerId" :to="instanceLink(selected)" data-testid="deployment-machine-instance-link" title="查看该机器的运行实例">{{ selected.runnerIp || selected.runnerId }}</RouterLink><span v-else>待分配</span></div><div>更新时间：{{ formatRunnerDateTime(selected.updatedAt) }}</div></div>
        <el-alert :title="deploymentStatuses[selected.status] || selected.status" :description="selected.message" :type="selected.status === 'failed' ? 'error' : selected.status === 'success' ? 'success' : 'info'" :closable="false" />
      </template>
      <template v-if="selected"><DeploymentTaskProcess :key="selected.jobId" ref="taskProcess" :job="selected"><dl class="dr-details">
        <dt>部署 ID</dt><dd><code>{{ selected.deploymentId || '未分配' }}</code></dd>
        <dt>部署任务 ID</dt><dd><code>{{ selected.jobId }}</code></dd>
        <dt v-if="selected.status === 'success'">部署文件</dt><dd v-if="selected.status === 'success'"><el-button link type="primary" data-testid="open-deployment-detail-files" @click="showDeploymentFiles(selected)">查看本次部署文件</el-button></dd>
        <template v-for="field in [{label:'状态',value:deploymentStatuses[selected.status]}, {label:'说明',value:selected.message}, {label:'源 / 流程 / 节点',value:`${selected.sourceId} / ${selected.flowId} / ${selected.stepId}`}, {label:'配置 ID',value:selected.configId}, {label:'生成任务',value:selected.taskId}, {label:'Git 仓库',value:selected.repositoryName || selected.repositoryId}, {label:'Git 目录',value:selected.gitDirectory}, {label:'Git 版本',value:selected.gitCommit}, {label:'Runner 实例',value:selected.runnerId}, {label:'实例目录',value:selected.instanceDirectory}, {label:'环境部署目录',value:selected.resourceDirectory}, {label:'部署目录',value:selected.installedPath || selected.targetPath}, {label:'更新时间',value:formatRunnerDateTime(selected.updatedAt)}]" :key="field.label"><dt>{{ field.label }}</dt><dd><RouterLink v-if="field.label === '源 / 流程 / 节点' && selected.sourceId" :to="nodeLink(selected)">{{ field.value }}</RouterLink><RouterLink v-else-if="field.label === '配置 ID' && selected.sourceId && selected.flowId && selected.stepId && selected.configId" :to="nodeLink(selected, true)">{{ field.value }}</RouterLink><RouterLink v-else-if="field.label === 'Git 目录' && selected.repositoryId && selected.gitDirectory" :to="repositoryDirectoryLink(selected)" class="dr-git-directory" data-testid="browse-deployment-detail-git-directory">📁 {{ field.value }}</RouterLink><el-button v-else-if="canWrite && machine(selected.runnerId) && field.value && ['实例目录','环境部署目录','部署目录'].includes(field.label)" link type="primary" class="dr-job-directory" :data-testid="field.label === '部署目录' ? 'browse-deployment-detail-directory' : undefined" @click="browseDeployment(selected, field.value)">📁 {{ field.value }}</el-button><template v-else>{{ field.value || '—' }}</template></dd></template></dl>
        <RouterLink v-if="selected.deliveryId" :to="{ path: '/settings', query: { tab: 'runtime-logs', recordId: selected.deliveryId, runnerId: selected.runnerId } }" target="_blank">部署日志</RouterLink>
        <el-button v-if="tasksOnly && canWrite && ['waiting_resource','queued','failed'].includes(selected.status)" link type="primary" :loading="busyJob === selected.jobId" :disabled="!!busyJob" @click="act(selected, 'retry')">重试部署</el-button>
        </DeploymentTaskProcess>
      </template>
      <div v-else-if="tasksOnly" class="dr-detail-empty">请选择左侧任务查看详情</div>
    </component>
    </div>
  </section>
</template>

<style scoped>
.dr-body,.dr-list-panel{display:contents}
.dr-page.dr-task-center{overflow:hidden;padding:14px 16px;border:1px solid var(--rc-border-soft);border-radius:var(--rc-radius-sm);background:var(--el-bg-color)}
.dr-task-header{display:flex;align-items:baseline;gap:12px}.dr-task-header h2{margin:0;font-size:16px}.dr-task-header span{font-size:12px;color:var(--rc-muted)}
.dr-body.dr-task-layout{display:grid;grid-template-columns:minmax(560px,1.3fr) minmax(380px,1fr);gap:12px;flex:1;min-height:0;min-width:0}
.dr-task-layout .dr-list-panel{display:flex;flex-direction:column;gap:10px;min-height:0;min-width:0;padding:10px;border:1px solid var(--rc-border-soft);border-radius:var(--rc-radius-sm)}
.dr-task-layout .dr-list-panel>.el-table{flex:1;min-height:120px}
.dr-detail-panel{overflow-y:auto;min-width:0;min-height:0;padding:14px 16px;border:1px solid var(--rc-border-soft);border-radius:var(--rc-radius-sm);font-size:13px}
.dr-detail-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;font-size:13px}.dr-detail-heading b{overflow-wrap:anywhere}.dr-detail-heading span{font-weight:400;color:var(--el-text-color-secondary)}
.dr-detail-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:18px;overflow-wrap:anywhere}.dr-detail-panel h4{font-size:13px;margin:14px 0 6px}.dr-detail-panel a{color:var(--el-color-primary);text-decoration:none}.dr-detail-panel .deployment-runtime-actions{margin-top:14px}
.dr-detail-empty{padding:48px 16px;color:var(--rc-faint);font-size:12px;text-align:center}.dr-task-status{font-size:12px;color:var(--el-color-info)}.dr-task-status.is-success{color:var(--el-color-success)}.dr-task-status.is-failed{color:var(--el-color-danger)}.dr-task-status.is-queued,.dr-task-status.is-waiting_resource{color:var(--el-color-warning)}
.dr-task-center .dr-toolbar :deep(.el-input__wrapper),.dr-task-center .dr-toolbar :deep(.el-select__wrapper){min-height:28px;font-size:12px}.dr-task-center .dr-toolbar :deep(.el-button){height:28px;font-size:12px}
@media(max-width:760px){.dr-page.dr-task-center{overflow:auto}.dr-body.dr-task-layout{grid-template-columns:1fr;grid-template-rows:360px minmax(320px,auto);flex:none}.dr-detail-panel{overflow:visible}.dr-task-header span{display:none}}
.dr-page{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto}.dr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dr-toolbar>.el-select,.dr-toolbar>.el-input{width:175px}.dr-editor{display:grid;grid-template-columns:minmax(140px,1fr) 140px 90px minmax(240px,1.4fr);gap:8px;padding:12px;border:1px solid var(--el-border-color);border-radius:8px}.dr-actions{grid-column:1/-1;display:flex;align-items:center;gap:12px}.dr-actions>.el-button:first-of-type{margin-left:auto}.dr-editor p{grid-column:1/-1;margin:0;color:var(--el-color-danger)}small{display:block;color:var(--el-text-color-secondary);font-size:11px;overflow-wrap:anywhere}.dr-details{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px}.dr-details dt{color:var(--el-text-color-secondary)}.dr-details dd{margin:0;overflow-wrap:anywhere}.el-drawer a{display:inline-block;margin-right:16px}@media(max-width:1200px){.dr-editor{grid-template-columns:1fr 1fr}.dr-editor>.el-select:nth-child(4){grid-column:1/-1}}

.dr-resources :deep(.el-table__body .el-table__cell){height:44px;padding:6px 0}
.dr-resources :deep(.el-table__body .cell){height:32px;display:flex;align-items:center;white-space:nowrap}
.dr-resources :deep(.dr-value){display:block;min-width:0;padding-inline:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-resources :deep(.el-input),.dr-resources :deep(.el-select){width:100%;min-width:0}
.dr-resources :deep(.el-input__wrapper),.dr-resources :deep(.el-select__wrapper){min-height:32px;box-sizing:border-box}
.dr-resources :deep(.el-switch){height:32px;margin-left:12px}
.dr-row-actions{display:flex;align-items:center;gap:12px;height:32px;white-space:nowrap}
.dr-row-actions .el-button{margin:0}
.dr-directory-link{min-width:0;max-width:100%;padding-left:12px}.dr-directory-link :deep(span){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-job-directory{max-width:100%;height:auto;white-space:normal;text-align:left}.dr-job-directory :deep(span){min-width:0;overflow-wrap:anywhere}
.dr-instance-link{display:flex;flex-direction:column;gap:3px;min-width:0;padding:8px 10px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--el-color-primary-light-9);color:var(--el-text-color-primary);text-decoration:none}.dr-instance-link:hover,.dr-instance-link:focus-visible{border-color:var(--el-color-primary)}.dr-instance-heading{display:flex;align-items:center;gap:8px}.dr-instance-heading strong{font-size:12px}.dr-instance-status{margin-left:auto;font-size:11px;color:var(--el-text-color-secondary)}.dr-instance-status.is-online{color:var(--el-color-success)}.dr-instance-status.is-error{color:var(--el-color-danger)}.dr-instance-name,.dr-instance-directory{font-size:11px;line-height:1.6;overflow-wrap:anywhere}.dr-task-actions{display:flex;flex-direction:column;align-items:flex-start;gap:6px}.dr-task-actions a{color:var(--el-color-primary);text-decoration:none;white-space:nowrap}.dr-task-actions a:hover{text-decoration:underline}
.dr-git-directory{color:var(--el-color-primary);text-decoration:none;overflow-wrap:anywhere}.dr-git-directory:hover{text-decoration:underline}
.dr-node-link{color:var(--el-color-primary);text-decoration:none;overflow-wrap:anywhere}.dr-node-link:hover{text-decoration:underline}
.dr-source-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dr-flow-node{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px}.dr-config-id{color:var(--el-text-color-secondary)}
</style>
