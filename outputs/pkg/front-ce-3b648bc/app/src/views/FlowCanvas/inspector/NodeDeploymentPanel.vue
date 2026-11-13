<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentEnvironment, type GeneratedDeploymentJob, type RunnerInstance, type NodeDeploymentResource, type DeploymentResourceRule } from '@/api/runnerManagement'
import { deploymentStatuses } from '@/utils/deploymentStatus'

const props = defineProps<{ sourceId: string; flowId: string; stepId: string; configId: string; configType?: string; archiveId?: string; queueName?: string }>()
const auth = useAuthStore(), environment = ref<DeploymentEnvironment>('test')
const DEFAULT_RESOURCE = '__default__'
const jobs = ref<GeneratedDeploymentJob[]>([]), runners = ref<RunnerInstance[]>([]), selection = ref<NodeDeploymentResource | null>(null)
const error = ref(''), busy = ref(false), savingResource = ref(false)
const current = computed(() => jobs.value.find(job => job.environment === environment.value && job.status !== 'superseded'))
const choices = computed(() => [...new Map((selection.value?.resources || [])
  .filter(item => item.resourceId && item.enabled && (item.environment === environment.value || item.environment === 'both') && item.configType === selection.value?.configType)
  .map(item => [item.resourceId, item])).values()])
const defaultRule = computed(() => choices.value.find(item => item.resourceId === selection.value?.defaultResourceId))
const rule = computed(() => choices.value.find(item => item.resourceId === selection.value?.effectiveResourceId))
const resourceLabel = (resource: DeploymentResourceRule) => {
  const machine = runners.value.find(row => row.runnerId === resource.runnerId)
  const name = resource.resourceName?.trim() || `${resource.configTypeName}${resource.environment === 'both' ? '' : resource.environment === 'test' ? '测试' : '生产'}资源`
  return `${name} · ${machine?.ipAddress || '机器信息不可用'}${machine?.status === 'offline' ? '（离线）' : ''}`
}
const resourceTitle = (resource: DeploymentResourceRule) => `${resourceLabel(resource)} · ${runners.value.find(row => row.runnerId === resource.runnerId)?.installDirectory || ''} · ${resource.runnerId}`
const selectedResourceId = computed(() => selection.value?.resourceId || defaultRule.value?.resourceId || DEFAULT_RESOURCE)
const unavailableChoice = computed(() => selection.value?.resourceId && !choices.value.some(item => item.resourceId === selection.value?.resourceId))
const needsDeployment = computed(() => {
  const previous = jobs.value.find(job => job.archiveId === props.archiveId && job.environment === 'test')
  return !previous || previous.status === 'success' && !!rule.value && (previous.runnerId !== rule.value.runnerId || !!selection.value?.targetPath && previous.targetPath !== selection.value.targetPath)
})
const nodeContext = () => ({ sourceId: props.sourceId, flowId: props.flowId, stepId: props.stepId, configId: props.configId, configType: props.configType || '', environment: environment.value,
  ...(props.queueName ? { queueName: props.queueName } : {}), ...(props.archiveId ? { archiveId: props.archiveId } : {}) })
let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined, stopped = false
async function load() {
  const request = ++sequence, context = { sourceId: props.sourceId, flowId: props.flowId, stepId: props.stepId, configId: props.configId }
  try {
    const [records, choice, instances] = await Promise.all([runnerManagementApi.generatedDeployments({ ...context, size: 100 }), runnerManagementApi.nodeDeploymentResource(nodeContext()), runnerManagementApi.instances()])
    if (request !== sequence || stopped) return
    jobs.value = records.items; if (!savingResource.value) selection.value = choice; runners.value = instances; error.value = ''
  } catch (e) { if (request === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
}
function poll() { if (timer) clearTimeout(timer); timer = setTimeout(async () => { if (!savingResource.value) await load(); if (!stopped) poll() }, 10000) }
watch(() => [props.sourceId, props.flowId, props.stepId, props.configId, props.configType, props.queueName, props.archiveId, environment.value], () => { jobs.value = []; selection.value = null; error.value = ''; void load(); poll() }, { immediate: true })
onBeforeUnmount(() => { stopped = true; sequence++; if (timer) clearTimeout(timer) })
onDeactivated(() => { stopped = true; sequence++; if (timer) clearTimeout(timer) })
onActivated(() => { if (stopped) { stopped = false; void load(); poll() } })
async function chooseResource(value: string) {
  if (!selection.value || savingResource.value || value === selectedResourceId.value) return
  const request = ++sequence, body = { ...nodeContext(), resourceId: value === DEFAULT_RESOURCE || value === defaultRule.value?.resourceId ? '' : value, revision: selection.value.revision }
  savingResource.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.saveNodeDeploymentResource(body)
    if (request === sequence && !stopped) { selection.value = result; ElMessage.success('当前节点部署资源已保存') }
  } catch (e) { if (request === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { savingResource.value = false; if (request !== sequence && !stopped) void load() }
}
async function act(job: GeneratedDeploymentJob, action: 'retry') {
  if (busy.value) return
  busy.value = true
  try { await runnerManagementApi.generatedDeploymentAction(job.jobId, action); ElMessage.success('部署任务已提交'); await load() }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : String(e)) }
  finally { busy.value = false }
}
async function deployExisting() {
  if (busy.value || !props.archiveId) return
  busy.value = true
  try { await runnerManagementApi.deployGeneratedArchive({ archiveId: props.archiveId, configId: props.configId, sourceId: props.sourceId, flowId: props.flowId, stepId: props.stepId }); ElMessage.success('测试部署任务已提交'); await load() }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : String(e)) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="nd-panel" data-testid="node-deployment-panel">
    <div class="nd-controls"><span>代码部署</span><el-radio-group v-model="environment" :disabled="savingResource || busy" size="small" aria-label="节点部署环境"><el-radio-button value="test">测试</el-radio-button><el-radio-button value="production">生产</el-radio-button></el-radio-group>
      <el-select class="nd-resource" :model-value="selectedResourceId" :disabled="!selection || savingResource || busy || auth.role !== 'admin'" :loading="savingResource" size="small" aria-label="当前节点部署资源" @change="chooseResource">
        <el-option v-if="!defaultRule" :value="DEFAULT_RESOURCE" label="待分配资源" />
        <el-option v-if="unavailableChoice" :value="selection!.resourceId" label="原选择已停用或不再适用于当前节点，请重新选择" disabled />
        <el-option v-for="item in choices" :key="item.resourceId" :value="item.resourceId!" :label="`${resourceLabel(item)}${item.resourceId === selection?.defaultResourceId ? ' · 默认资源' : ''}`" :title="resourceTitle(item)" />
      </el-select>
    </div>
    <p class="nd-path" data-testid="node-final-deployment-directory"><span>最终部署目录：</span><code :title="selection?.deploymentDirectory || selection?.pathError">{{ savingResource || !selection ? '正在计算…' : selection.deploymentDirectory || selection.pathError || '待选择可用部署资源' }}</code></p>
    <div class="nd-status"><span :title="current?.message">{{ current ? deploymentStatuses[current.status] : environment === 'test' ? '生成并提交成功后自动部署测试' : '选择生产部署资源' }}</span><code v-if="current" :title="current.gitCommit">{{ current.gitCommit.slice(0, 12) }}</code>
      <el-button v-if="auth.role === 'admin' && environment === 'test' && archiveId && needsDeployment" link type="primary" :disabled="savingResource" :loading="busy" @click="deployExisting">部署已有代码</el-button>
      <el-button v-if="auth.role === 'admin' && current && ['failed','waiting_resource','queued'].includes(current.status)" link :loading="busy" @click="act(current, 'retry')">重试部署</el-button>
      <RouterLink :to="{path:'/settings',query:{tab:'deployment-resources',configId}}" target="_blank" rel="noopener">部署记录</RouterLink>
      <RouterLink v-if="current?.deliveryId" :to="{path:'/settings',query:{tab:'runtime-logs',recordId:current.deliveryId,runnerId:current.runnerId}}" target="_blank" rel="noopener">日志</RouterLink>
    </div>
    <p v-if="current?.installedPath && (current.installedPath !== selection?.deploymentDirectory || current.runnerId !== rule?.runnerId)" class="nd-path">上次部署：{{ current.runnerIp ? `${current.runnerIp} · ` : '' }}{{ current.installedPath }}</p>
    <p v-if="error" role="alert" class="nd-error">部署信息加载失败：{{ error }}</p>
  </div>
</template>

<style scoped>
.nd-panel{padding:9px 10px;border:1px solid var(--el-border-color-lighter);border-radius:6px;font-size:12px}.nd-controls,.nd-status{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}.nd-status{margin-top:6px;color:var(--el-text-color-secondary)}.nd-resource{flex:1;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nd-path{margin:5px 0 0;overflow-wrap:anywhere;color:var(--el-text-color-secondary)}.nd-error{margin:5px 0 0;color:var(--el-color-danger)}a{font-size:12px;white-space:nowrap}
</style>
