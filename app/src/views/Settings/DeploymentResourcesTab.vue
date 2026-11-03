<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { RouterLink, useRoute } from 'vue-router'
import { configApi, type NodeType } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentResourceRule, type GeneratedDeploymentJob, type RunnerInstance, type RuntimeConfiguration } from '@/api/runnerManagement'
import { deploymentStatuses } from '@/utils/deploymentStatus'
import DeploymentRuntimeActions from './DeploymentRuntimeActions.vue'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'

const route = useRoute(), auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const view = ref(route.query.configId ? 'jobs' : 'rules')
const resources = ref<DeploymentResourceRule[]>([]), revision = ref(''), runners = ref<RunnerInstance[]>([]), types = ref<NodeType[]>([])
const runtimes = ref<RuntimeConfiguration[]>([])
const jobs = ref<GeneratedDeploymentJob[]>([]), total = ref(0), page = ref(1)
const nodeType = ref(typeof route.query.nodeType === 'string' ? route.query.nodeType : ''), env = ref(typeof route.query.environment === 'string' ? route.query.environment : ''), configId = ref(typeof route.query.configId === 'string' ? route.query.configId : '')
const loading = ref(false), saving = ref(false), error = ref(''), formError = ref('')
const draft = ref<DeploymentResourceRule | null>(null), editing = ref(-1), busyJob = ref(''), selected = ref<GeneratedDeploymentJob | null>(null)
const editingResourceId = ref('')
const inlineEditing = computed(() => !!editingResourceId.value)
const committedResources = ref<DeploymentResourceRule[]>([])
const supports = (item: DeploymentResourceRule, value: string) => item.environment === value || item.environment === 'both'
const filtered = computed(() => resources.value.filter(item => (item.resourceId === editingResourceId.value || ((!nodeType.value || item.configType === nodeType.value) && (!env.value || supports(item, env.value))))))
const machine = (id: string) => runners.value.find(item => item.runnerId === id)
const label = (id: string) => { const item = machine(id); return item ? `${item.ipAddress} · ${item.installDirectory}` : id }
const resourceDirectory = (item: DeploymentResourceRule) => {
  const root = machine(item.runnerId)?.installDirectory || ''
  const value = item.deploymentDirectory?.trim()
  if (!value || value === '.') return root || '等待实例目录'
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(value)) return value
  const separator = root.includes('\\') ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + separator + value.split(/[\\/]/).join(separator)
}
let active = true, initialized = false, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
async function load() {
  if (saving.value) return
  const request = ++sequence
  loading.value = true; error.value = ''
  const results = await Promise.allSettled([runnerManagementApi.deploymentResources(), runnerManagementApi.instances(), configApi.nodeTypeList(),
    runnerManagementApi.generatedDeployments({ configId: configId.value.trim() || undefined, environment: env.value === 'test' || env.value === 'production' ? env.value : undefined, page: page.value, size: 20 }), view.value === 'jobs' ? runnerManagementApi.runtimeConfigurations() : Promise.resolve([])])
  if (request !== sequence || !active) return
  const [rules, machines, nodeTypes, deployments, runtimeResult] = results
  if (runtimeResult.status === 'fulfilled') runtimes.value = runtimeResult.value
  else { runtimes.value = []; error.value = `运行配置加载失败：${message(runtimeResult.reason)}` }
  if (rules.status === 'fulfilled') { if (!draft.value && !saving.value && !inlineEditing.value) { resources.value = rules.value.items; committedResources.value = JSON.parse(JSON.stringify(rules.value.items)); revision.value = rules.value.revision } } else error.value = `默认资源加载失败：${message(rules.reason)}`
  if (machines.status === 'fulfilled') runners.value = machines.value; else error.value += ` 服务器加载失败：${message(machines.reason)}`
  if (nodeTypes.status === 'fulfilled') types.value = nodeTypes.value; else error.value += ` 节点类型加载失败：${message(nodeTypes.reason)}`
  if (deployments.status === 'fulfilled') { jobs.value = deployments.value.items; total.value = deployments.value.total; if (selected.value) selected.value = jobs.value.find(item => item.jobId === selected.value?.jobId) || selected.value } else error.value += ` 部署记录加载失败：${message(deployments.reason)}`
  loading.value = false
}
function edit(item?: DeploymentResourceRule) {
  editing.value = item ? resources.value.indexOf(item) : -1
  draft.value = item ? { ...item, deploymentDirectory: item.deploymentDirectory || machine(item.runnerId)?.installDirectory || '' } : { resourceName: '', configType: nodeType.value, configTypeName: '', environment: env.value === 'production' ? 'production' : 'test', runnerId: '', deploymentDirectory: '', enabled: true, isDefault: false }
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
  const row: DeploymentResourceRule = { resourceId: draft.value.resourceId, resourceName: (draft.value.resourceName || '').trim(),
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
  sequence++; loading.value = false; error.value = ''; editingResourceId.value = row.resourceId || ''
}
function cancelRow() {
  if (saving.value) return
  resources.value = JSON.parse(JSON.stringify(committedResources.value))
  editingResourceId.value = ''; error.value = ''
}
async function saveRow(row: DeploymentResourceRule) {
  if (saving.value || !canWrite.value) return
  sequence++; loading.value = false
  const previous = committedResources.value.find(item => item.resourceId === row.resourceId)
  if (previous && previous.runnerId !== row.runnerId && (!previous.deploymentDirectory || previous.deploymentDirectory === machine(previous.runnerId)?.installDirectory)) row.deploymentDirectory = ''
  const items = resources.value.map(item => ({ ...item, resourceName: item.resourceName?.trim(),
    configTypeName: types.value.find(type => String(type.sourceType) === item.configType)?.typeName || item.configTypeName }))
  const changed = items.find(item => item.resourceId === row.resourceId)!
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
async function act(job: GeneratedDeploymentJob, action: 'retry') {
  if (busyJob.value) return
  busyJob.value = job.jobId
  try { await runnerManagementApi.generatedDeploymentAction(job.jobId, action); ElMessage.success('部署任务已提交'); await load() }
  catch (e) { ElMessage.error(message(e)) }
  finally { busyJob.value = '' }
}
function search() { page.value = 1; void load() }
function poll() { if (timer) clearTimeout(timer); timer = setTimeout(async () => { if (active && !draft.value && !saving.value && !inlineEditing.value) await load(); if (active) poll() }, 10000) }
onMounted(() => { initialized = true; void load(); poll() })
onActivated(() => { active = true; if (initialized) { void load(); poll() } })
function stop() { active = false; sequence++; if (timer) clearTimeout(timer) }
onDeactivated(stop); onUnmounted(stop)
</script>

<template>
  <section class="dr-page" data-testid="settings-deployment-resources">
    <div class="dr-toolbar"><el-radio-group v-model="view"><el-radio-button value="rules">部署资源</el-radio-button><el-radio-button value="jobs">部署记录</el-radio-button></el-radio-group>
      <el-select v-if="view === 'rules'" v-model="nodeType" placeholder="节点类型" clearable filterable aria-label="筛选节点类型"><el-option v-for="item in types" :key="item.sourceType" :value="String(item.sourceType)" :label="item.typeName" /></el-select>
      <el-input v-else v-model="configId" placeholder="配置 ID" clearable aria-label="配置 ID" @keyup.enter="search" />
      <el-select v-model="env" placeholder="全部环境" clearable aria-label="部署环境" @change="search"><el-option label="测试" value="test" /><el-option label="生产" value="production" /></el-select>
      <el-button v-if="view === 'rules' && canWrite" :disabled="!!draft || inlineEditing || saving" @click="edit()">新增资源</el-button>
      <el-button :icon="Refresh" :loading="loading" aria-label="刷新部署资源" @click="load" />
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="view === 'rules'">
      <div v-if="draft" class="dr-editor" data-testid="deployment-resource-editor">
        <el-input v-model="draft.resourceName" aria-label="资源名称" maxlength="100" placeholder="资源名称，如：网页抓取测试机" />
        <el-select v-model="draft.configType" placeholder="节点类型" filterable aria-label="默认资源节点类型"><el-option v-for="item in types" :key="item.sourceType" :value="String(item.sourceType)" :label="item.typeName" /></el-select>
        <el-select v-model="draft.environment" aria-label="默认资源环境"><el-option label="测试" value="test" /><el-option label="生产" value="production" /><el-option label="生产和测试" value="both" /></el-select>
        <el-select v-model="draft.runnerId" placeholder="选择服务器实例" filterable aria-label="默认部署服务器"><el-option v-if="draft.runnerId && !machine(draft.runnerId)" :value="draft.runnerId" label="原实例已不存在，请重新选择" disabled /><el-option v-for="item in runners" :key="item.runnerId" :value="item.runnerId" :label="`${label(item.runnerId)} · ${item.status === 'online' ? '在线' : '离线'}`" /></el-select>
        <el-input v-model="draft.deploymentDirectory" aria-label="环境部署目录" :placeholder="machine(draft.runnerId)?.installDirectory || '默认使用 Runner instance 目录'" />
        <el-input v-model="draft.entryPoint" aria-label="入口文件" placeholder="如 main.py" />
        <div class="dr-actions"><el-switch v-model="draft.enabled" active-text="启用" inactive-text="停用" />
        <span>是否默认</span><el-switch v-model="draft.isDefault" active-text="是" inactive-text="否" />
        <el-button type="primary" :loading="saving" @click="save">保存</el-button><el-button :disabled="saving" @click="draft = null">取消</el-button></div>
        <p v-if="formError" role="alert">{{ formError }}</p>
      </div>
      <el-table class="dr-resources" row-key="resourceId" table-layout="fixed" :data="filtered" empty-text="尚未配置默认资源。代码生成后会等待匹配资源。">
        <el-table-column prop="runnerId" label="资源 ID" min-width="200" show-overflow-tooltip />
        <el-table-column label="资源名称" min-width="160"><template #default="{ row }"><el-input v-if="canWrite && editingResourceId === row.resourceId" v-model="row.resourceName" aria-label="列表资源名称" :disabled="saving || !!draft" maxlength="100" /><span v-else class="dr-value">{{ row.resourceName || row.configTypeName }}</span></template></el-table-column>
        <el-table-column label="节点类型" min-width="140"><template #default="{ row }"><el-select v-if="canWrite && editingResourceId === row.resourceId" v-model="row.configType" aria-label="列表节点类型" :disabled="saving || !!draft" filterable><el-option v-for="item in types" :key="item.sourceType" :value="String(item.sourceType)" :label="item.typeName" /></el-select><span v-else class="dr-value">{{ row.configTypeName }}</span></template></el-table-column>
        <el-table-column label="环境" min-width="145"><template #default="{ row }"><el-select v-if="canWrite && editingResourceId === row.resourceId" v-model="row.environment" aria-label="列表资源环境" :disabled="saving || !!draft"><el-option label="测试" value="test" /><el-option label="生产" value="production" /><el-option label="生产和测试" value="both" /></el-select><span v-else class="dr-value">{{ row.environment === 'both' ? '生产和测试' : row.environment === 'test' ? '测试' : '生产' }}</span></template></el-table-column>
        <el-table-column label="服务器 / Runner 实例" min-width="170"><template #default="{ row }"><el-select v-if="canWrite && editingResourceId === row.resourceId" v-model="row.runnerId" aria-label="列表服务器实例" :disabled="saving || !!draft" filterable><el-option v-for="item in runners" :key="item.runnerId" :value="item.runnerId" :label="item.ipAddress" :title="item.installDirectory">{{ item.ipAddress }} · {{ item.installDirectory }}</el-option></el-select><span v-else class="dr-value">{{ machine(row.runnerId)?.ipAddress || '实例不存在' }}</span></template></el-table-column>
        <el-table-column label="环境部署目录" min-width="200"><template #default="{ row }"><el-input v-if="canWrite && editingResourceId === row.resourceId" v-model="row.deploymentDirectory" aria-label="列表环境部署目录" :placeholder="resourceDirectory({ ...row, deploymentDirectory: '' })" :disabled="saving || !!draft" /><span v-else class="dr-value">{{ resourceDirectory(row) }}</span></template></el-table-column>
        <el-table-column label="入口文件" min-width="180"><template #default="{ row }"><el-input v-if="canWrite && editingResourceId === row.resourceId" v-model="row.entryPoint" aria-label="列表入口文件" :placeholder="row.entryPoints?.join('、') || '如 main.py'" :disabled="saving || !!draft" /><span v-else class="dr-value" :title="row.entryPoint || row.entryPoints?.join('、')">{{ row.entryPoint || row.entryPoints?.join('、') || '未设置' }}</span></template></el-table-column>
        <el-table-column label="状态" width="120"><template #default="{ row }"><el-switch v-if="canWrite && editingResourceId === row.resourceId" v-model="row.enabled" aria-label="资源启用状态" :disabled="saving || !!draft" :active-text="row.enabled ? '启用' : '停用'" /><span v-else class="dr-value">{{ row.enabled ? '启用' : '停用' }}</span></template></el-table-column>
        <el-table-column label="是否默认" width="120"><template #default="{ row }"><el-switch v-if="canWrite && editingResourceId === row.resourceId" v-model="row.isDefault" aria-label="资源默认状态" :disabled="saving || !!draft" :active-text="row.isDefault ? '是' : '否'" /><span v-else class="dr-value">{{ row.isDefault !== false ? '是' : '否' }}</span></template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="130" fixed="right"><template #default="{ row }">
          <div v-if="editingResourceId === row.resourceId" class="dr-row-actions"><el-button link type="primary" :loading="saving" @click="saveRow(row)">保存</el-button><el-button link :disabled="saving" @click="cancelRow">取消</el-button></div>
          <div v-else class="dr-row-actions"><el-button link type="primary" :disabled="inlineEditing || !!draft || saving" @click="editRow(row)">编辑</el-button></div>
        </template></el-table-column>
      </el-table>
    </template>
    <template v-else>
      <el-table row-key="jobId" :data="jobs" highlight-current-row @row-click="selected = $event" empty-text="暂无部署记录">
        <el-table-column label="源 / 配置" min-width="130"><template #default="{ row }">配置 {{ row.configId }}<small>源 {{ row.sourceId }} · 节点 {{ row.stepId }}</small></template></el-table-column>
        <el-table-column label="环境" width="75"><template #default="{ row }">{{ row.environment === 'test' ? '测试' : '生产' }}</template></el-table-column>
        <el-table-column label="部署状态" min-width="125"><template #default="{ row }"><span :title="row.message">{{ deploymentStatuses[row.status] || row.status }}</span></template></el-table-column>
        <el-table-column label="服务器 / 目录" min-width="190"><template #default="{ row }">{{ row.runnerIp || '待分配' }}<small>{{ row.installedPath || row.targetPath || row.message }}</small></template></el-table-column>
        <el-table-column label="Git 目录" min-width="180"><template #default="{ row }"><code>{{ row.gitDirectory || '未记录' }}</code><small>{{ row.repositoryName || row.repositoryId }}</small></template></el-table-column>
        <el-table-column label="Git 版本" width="120"><template #default="{ row }"><code>{{ row.gitCommit.slice(0, 12) }}</code></template></el-table-column>
        <el-table-column label="更新时间" width="165"><template #default="{ row }">{{ formatRunnerDateTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" min-width="255"><template #default="{ row }"><DeploymentRuntimeActions :job="row" :current-runtime="runtimes.find(item => item.runtimeId === row.runtimeId) || null" /><template v-if="canWrite"><el-button v-if="['waiting_resource','queued','failed'].includes(row.status)" link :disabled="!!busyJob" @click.stop="act(row, 'retry')">重试</el-button></template></template></el-table-column>
      </el-table>
      <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total, prev, pager, next" @current-change="load" />
    </template>
    <el-drawer :model-value="!!selected" title="部署详情" size="min(620px, 92vw)" @close="selected = null">
      <template v-if="selected"><dl class="dr-details"><template v-for="field in [{label:'状态',value:deploymentStatuses[selected.status]}, {label:'说明',value:selected.message}, {label:'源 / 流程 / 节点',value:`${selected.sourceId} / ${selected.flowId} / ${selected.stepId}`}, {label:'配置 ID',value:selected.configId}, {label:'生成任务',value:selected.taskId}, {label:'Git 仓库',value:selected.repositoryName || selected.repositoryId}, {label:'Git 目录',value:selected.gitDirectory}, {label:'Git 版本',value:selected.gitCommit}, {label:'Runner 实例',value:selected.runnerId}, {label:'实例目录',value:selected.instanceDirectory}, {label:'环境部署目录',value:selected.resourceDirectory}, {label:'部署目录',value:selected.installedPath || selected.targetPath}, {label:'更新时间',value:formatRunnerDateTime(selected.updatedAt)}]" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value || '—' }}</dd></template></dl>
        <DeploymentRuntimeActions :job="selected" :current-runtime="runtimes.find(item => item.runtimeId === selected?.runtimeId) || null" />
        <RouterLink v-if="selected.deploymentId" :to="{path:'/settings',query:{tab:'directory-layout',deploymentId:selected.deploymentId}}" target="_blank">查看部署配置</RouterLink>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.dr-page{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto}.dr-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dr-toolbar>.el-select,.dr-toolbar>.el-input{width:175px}.dr-editor{display:grid;grid-template-columns:minmax(140px,1fr) 140px 90px minmax(240px,1.4fr);gap:8px;padding:12px;border:1px solid var(--el-border-color);border-radius:8px}.dr-actions{grid-column:1/-1;display:flex;align-items:center;gap:12px}.dr-actions>.el-button:first-of-type{margin-left:auto}.dr-editor p{grid-column:1/-1;margin:0;color:var(--el-color-danger)}small{display:block;color:var(--el-text-color-secondary);font-size:11px;overflow-wrap:anywhere}.dr-details{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px}.dr-details dt{color:var(--el-text-color-secondary)}.dr-details dd{margin:0;overflow-wrap:anywhere}.el-drawer a{display:inline-block;margin-right:16px}@media(max-width:1200px){.dr-editor{grid-template-columns:1fr 1fr}.dr-editor>.el-select:nth-child(4){grid-column:1/-1}}

.dr-resources :deep(.el-table__body .el-table__cell){height:44px;padding:6px 0}
.dr-resources :deep(.el-table__body .cell){height:32px;display:flex;align-items:center;white-space:nowrap}
.dr-resources :deep(.dr-value){display:block;min-width:0;padding-inline:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dr-resources :deep(.el-input),.dr-resources :deep(.el-select){width:100%;min-width:0}
.dr-resources :deep(.el-input__wrapper),.dr-resources :deep(.el-select__wrapper){min-height:32px;box-sizing:border-box}
.dr-resources :deep(.el-switch){height:32px;margin-left:12px}
.dr-row-actions{display:flex;align-items:center;gap:12px;height:32px;white-space:nowrap}
.dr-row-actions .el-button{margin:0}
</style>
