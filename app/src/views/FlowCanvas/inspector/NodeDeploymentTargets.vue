<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentEnvironment, type DeploymentResourceRule, type GeneratedDeploymentJob, type NodeDeploymentResource, type RunnerInstance, type RuntimeConfiguration } from '@/api/runnerManagement'
import { deploymentStatuses } from '@/utils/deploymentStatus'
import DeploymentRuntimeActions from '@/views/Settings/DeploymentRuntimeActions.vue'

const props = defineProps<{ sourceId: string; flowId: string; stepId: string; configId: string; configType: string; archiveId?: string; queueName?: string }>()
const auth = useAuthStore(), environment = ref<DeploymentEnvironment>('test')
const selection = ref<NodeDeploymentResource | null>(null), runners = ref<RunnerInstance[]>([])
const jobs = ref<GeneratedDeploymentJob[]>([]), runtimes = ref<RuntimeConfiguration[]>([])
const loading = ref(false), saving = ref(false), busy = ref(false), error = ref('')
const choices = computed(() => selection.value?.resources.flatMap(item => item.enabled && item.resourceId ? [{ ...item, resourceId: item.resourceId }] : []) || [])
const selectedIds = computed(() => selection.value?.effectiveResourceIds || (selection.value?.effectiveResourceId ? [selection.value.effectiveResourceId] : []))
const useDefault = computed(() => selection.value?.useDefault ?? !selection.value?.resourceId)
const unavailable = computed(() => selectedIds.value.some(id => !choices.value.some(item => item.resourceId === id)))
const records = computed(() => jobs.value.filter(job => job.environment === environment.value).slice(0, 30))
const canEdit = computed(() => auth.role === 'admin' && !!selection.value && !loading.value && !saving.value && !busy.value)
const context = () => ({ sourceId: props.sourceId, flowId: props.flowId, stepId: props.stepId, configId: props.configId,
  configType: props.configType, environment: environment.value, queueName: props.queueName || '', ...(props.archiveId ? { archiveId: props.archiveId } : {}) })
const machine = (rule: DeploymentResourceRule) => runners.value.find(item => item.runnerId === rule.runnerId)
const destination = (rule: DeploymentResourceRule) => selection.value?.targets?.find(item => item.resourceId === rule.resourceId)?.deploymentDirectory
  || rule.deploymentDirectory || machine(rule)?.installDirectory || '目录未上报'
let sequence = 0, operation = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined
function suspend() { stopped = true; sequence++; operation++; clearTimeout(timer) }
onBeforeUnmount(suspend)
onDeactivated(suspend)
onActivated(() => { if (stopped) { stopped = false; saving.value = false; busy.value = false; void load(); poll() } })
async function load(background = false) {
  const seq = ++sequence, scope = context()
  if (!background) loading.value = true
  try {
    const [choice, instances, results, runtimeRows] = await Promise.all([
      runnerManagementApi.nodeDeploymentResource(scope), runnerManagementApi.instances(),
      runnerManagementApi.generatedDeployments({ sourceId: scope.sourceId, flowId: scope.flowId, stepId: scope.stepId, configId: scope.configId, size: 100 }),
      runnerManagementApi.runtimeConfigurations(),
    ])
    if (seq !== sequence || stopped) return
    selection.value = choice; runners.value = instances; jobs.value = results.items; runtimes.value = runtimeRows; error.value = ''
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) loading.value = false }
}
function poll() {
  clearTimeout(timer)
  timer = setTimeout(async () => { if (!saving.value && !busy.value) await load(true); if (!stopped) poll() }, 10000)
}
watch(() => [props.sourceId, props.flowId, props.stepId, props.configId, props.configType, props.queueName, props.archiveId, environment.value], () => {
  sequence++; operation++; selection.value = null; jobs.value = []; error.value = ''; saving.value = false; busy.value = false
  void load(); poll()
}, { immediate: true })
async function saveTargets(ids: string[], followDefault: boolean) {
  if (!canEdit.value || !selection.value) return
  const seq = ++sequence, scope = context(), revision = selection.value.revision
  saving.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.saveNodeDeploymentResource({ ...scope, revision, resourceId: ids[0] || '', resourceIds: ids, useDefault: followDefault })
    if (seq === sequence && !stopped) { selection.value = result; ElMessage.success('部署目标已保存') }
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) saving.value = false }
}
async function toggle(rule: DeploymentResourceRule, event: Event) {
  if (!rule.resourceId) return
  const input = event.target as HTMLInputElement
  const ids = input.checked ? [...new Set([...selectedIds.value, rule.resourceId])] : selectedIds.value.filter(id => id !== rule.resourceId)
  await saveTargets(ids, false)
  input.checked = selectedIds.value.includes(rule.resourceId)
}
async function toggleDefault(event: Event) {
  const input = event.target as HTMLInputElement
  await saveTargets([], input.checked)
  input.checked = useDefault.value
}
async function deploy() {
  if (!canEdit.value || !selection.value || !props.archiveId || !selectedIds.value.length || unavailable.value) return
  const seq = sequence, op = ++operation, scope = context()
  busy.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.deployGeneratedArchive({ ...scope, archiveId: props.archiveId,
      resourceIds: [...selectedIds.value], targetRevision: selection.value.revision })
    if (seq !== sequence || stopped) return
    ElMessage.success(`已提交 ${result.items?.length || 1} 个独立部署任务`)
    await load()
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (!stopped && op === operation) busy.value = false }
}
async function retry(job: GeneratedDeploymentJob) {
  if (!canEdit.value) return
  const seq = sequence, op = ++operation; busy.value = true
  try {
    await runnerManagementApi.generatedDeploymentAction(job.jobId, 'retry')
    if (seq === sequence && !stopped) { ElMessage.success('该机器的部署任务已重试'); await load() }
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (!stopped && op === operation) busy.value = false }
}
</script>

<template>
  <div class="deployment-targets" data-testid="node-deployment-targets">
    <div class="dt-toolbar">
      <el-radio-group v-model="environment" :disabled="saving || busy" size="small" aria-label="部署环境">
        <el-radio-button value="test">测试</el-radio-button><el-radio-button value="production">生产</el-radio-button>
      </el-radio-group>
      <el-button size="small" :loading="loading" :disabled="saving || busy" @click="load()">刷新部署信息</el-button>
      <RouterLink :to="{ path: '/settings', query: { tab: 'deployment-resources' } }" target="_blank">管理部署资源</RouterLink>
    </div>
    <p>勾选部署机器，选择后自动保存。每台机器生成一个独立部署任务，可分别查看结果和重试。</p>
    <label class="dt-default"><input type="checkbox" :checked="useDefault" :disabled="!canEdit" data-testid="deployment-follow-default" @change="toggleDefault" /> 使用默认部署资源</label>
    <div class="dt-machines" aria-label="部署机器">
      <label v-for="rule in choices" :key="rule.resourceId" class="dt-machine">
        <input type="checkbox" :checked="selectedIds.includes(rule.resourceId)" :disabled="!canEdit" :data-testid="`deployment-target-${rule.resourceId}`" @change="toggle(rule, $event)" />
        <span><strong>{{ machine(rule)?.ipAddress || '机器未上报 IP' }} · {{ rule.resourceName || machine(rule)?.name || rule.configTypeName }}</strong>
          <small>{{ machine(rule)?.status === 'online' ? '在线' : '离线，提交后等待上线' }} · {{ rule.runnerId }}</small>
          <small>{{ destination(rule) }}</small></span>
      </label>
      <p v-if="!loading && !choices.length">当前节点类型和环境没有可用部署资源，请先添加。</p>
    </div>
    <p v-if="unavailable" role="alert">部分已选部署资源已停用或不适用，请重新选择部署目标。</p>
    <p v-if="!selectedIds.length">未选择部署机器，生成代码后不会自动下发到指定机器。</p>
    <p v-else-if="environment === 'test'">生成并提交代码成功后，按已保存的测试目标分别创建部署任务；修改目标不会中断已经执行的任务。</p>
    <el-button type="primary" :loading="busy" :disabled="!canEdit || !archiveId || !selectedIds.length || unavailable" data-testid="deploy-selected-machines" @click="deploy">部署当前生成代码（{{ selectedIds.length }} 台）</el-button>
    <p v-if="!archiveId">当前源和流程节点尚无已归档的生成代码，请先在“编排配置”生成并提交代码。</p>
    <p v-if="error" role="alert" class="dt-error">{{ error }}</p>
    <h4>最近部署任务</h4>
    <article v-for="job in records" :key="job.jobId" class="dt-job" :data-testid="`deployment-job-${job.jobId}`">
      <div><strong>{{ job.runnerIp || runners.find(item => item.runnerId === choices.find(rule => rule.resourceId === job.targetResourceId)?.runnerId)?.ipAddress || '等待机器分配' }}</strong> · {{ deploymentStatuses[job.status] }}</div>
      <small>部署任务 ID：{{ job.jobId }}</small><small v-if="job.installedPath || job.targetPath">{{ job.installedPath || job.targetPath }}</small>
      <p v-if="job.message">{{ job.message }}</p>
      <el-button v-if="job.status === 'failed' || job.status === 'queued' || job.status === 'waiting_resource'" link :disabled="!canEdit" @click="retry(job)">重试此任务</el-button>
      <DeploymentRuntimeActions v-if="job.status === 'success'" :job="job" :current-runtime="runtimes.find(item => item.runtimeId === job.runtimeId) || null" />
      <RouterLink v-if="job.deliveryId" :to="{ path: '/settings', query: { tab: 'runtime-logs', recordId: job.deliveryId, runnerId: job.runnerId } }" target="_blank">部署日志</RouterLink>
    </article>
    <p v-if="!loading && !records.length">暂无部署任务</p>
    <RouterLink :to="{ path: '/settings', query: { tab: 'deployments', sourceId, flowId, stepId, configId } }" target="_blank">查看部署记录</RouterLink>
  </div>
</template>

<style scoped>
.deployment-targets { font-size:12px; min-width:0; }
.dt-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
p, small { color:var(--el-text-color-secondary); }
.dt-default { display:flex; align-items:center; gap:8px; margin:12px 0; }
.dt-machines { display:grid; gap:8px; }
.dt-machine { display:flex; align-items:flex-start; gap:10px; padding:10px; border:1px solid var(--el-border-color-light); border-radius:6px; }
.dt-machine input { margin-top:3px; flex-shrink:0; }
.dt-machine span { min-width:0; overflow-wrap:anywhere; }
small { display:block; margin-top:4px; overflow-wrap:anywhere; }
.dt-job { margin-top:8px; padding:10px 0; border-bottom:1px solid var(--el-border-color-light); overflow-wrap:anywhere; }
.dt-error, [role=alert] { color:var(--el-color-danger); }
a { color:var(--el-color-primary); }
</style>
