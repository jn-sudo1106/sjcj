<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { prepareDeploymentProcesses } from '@/utils/deploymentProcesses'
import { runnerManagementApi, type CodeRepository, type DeploymentEnvironment, type DeploymentResourceRule, type NodeDeploymentResource, type NodeDeploymentSettings, type RunnerInstance } from '@/api/runnerManagement'

const props = defineProps<{ sourceId: string; flowId: string; stepId: string; configId: string; configType: string; archiveId?: string; queueName?: string }>()
const auth = useAuthStore(), environment = ref<DeploymentEnvironment>('test')
const selection = ref<NodeDeploymentResource | null>(null), runners = ref<RunnerInstance[]>([])
const loading = ref(false), saving = ref(false), busy = ref(false), error = ref('')
const deploymentStatus = ref('')
const repositories = ref<CodeRepository[]>([]), followGeneration = ref(true)
const emptySettings = (): NodeDeploymentSettings => ({ repositoryId: '', sourceDirectory: '', deploymentDirectory: '' })
const draft = ref(emptySettings()), savedSettings = ref(JSON.stringify(emptySettings()))
const settingsStatus = ref('修改后自动保存')
const settingsValidation = computed(() => !followGeneration.value && (!draft.value.repositoryId || !draft.value.sourceDirectory.trim())
  ? '请选择 Git 地址并填写源目录后自动保存' : '')
const settingsDirty = computed(() => JSON.stringify(draft.value) !== savedSettings.value || followGeneration.value !== !JSON.parse(savedSettings.value).repositoryId)
const activeRepositories = computed(() => repositories.value.filter(repo => repo.status === 'ACTIVE'))
const pathPreview = ref<NodeDeploymentResource | null>(null), previewLoading = ref(false), previewError = ref('')
const actualTargets = computed(() => (settingsDirty.value ? pathPreview.value : selection.value)?.targets || [])
const deploymentDirectoryInput = computed({
  get: () => draft.value.deploymentDirectory || ((settingsDirty.value ? pathPreview.value?.targetPath : '')
    || selection.value?.targetPath || selection.value?.targets?.[0]?.targetPath || '').replace(/[\\/]+$/, ''),
  set: (value: string) => { draft.value.deploymentDirectory = value },
})
let previewSequence = 0, previewTimer: ReturnType<typeof setTimeout> | undefined
function resetSettings() {
  draft.value = { ...emptySettings(), ...selection.value?.deploymentSettings }
  draft.value.deploymentDirectory = draft.value.deploymentDirectory.replace(/[\\/]+$/, '')
  savedSettings.value = JSON.stringify(draft.value); followGeneration.value = !draft.value.repositoryId
}
function changeFollowGeneration(event: Event) {
  followGeneration.value = (event.target as HTMLInputElement).checked
  draft.value.repositoryId = followGeneration.value ? '' : selection.value?.repositoryId || activeRepositories.value[0]?.repoId || ''
  draft.value.sourceDirectory = followGeneration.value ? '' : selection.value?.gitDirectory || ''
}
const choices = computed(() => selection.value?.resources.flatMap(item => item.enabled && item.resourceId ? [{ ...item, resourceId: item.resourceId }] : []) || [])
const selectedIds = computed(() => selection.value?.effectiveResourceIds || (selection.value?.effectiveResourceId ? [selection.value.effectiveResourceId] : []))
const useDefault = computed(() => selection.value?.useDefault ?? !selection.value?.resourceId)
const unavailable = computed(() => selectedIds.value.some(id => !choices.value.some(item => item.resourceId === id)))
const canEdit = computed(() => auth.role === 'admin' && !!selection.value && !loading.value && !saving.value && !busy.value)
const context = () => ({ sourceId: props.sourceId, flowId: props.flowId, stepId: props.stepId, configId: props.configId,
  configType: props.configType, environment: environment.value, queueName: props.queueName || '', ...(props.archiveId ? { archiveId: props.archiveId } : {}) })
const machine = (rule: DeploymentResourceRule) => runners.value.find(item => item.runnerId === rule.runnerId)
const destination = (rule: DeploymentResourceRule) => selection.value?.targets?.find(item => item.resourceId === rule.resourceId)?.deploymentDirectory
  || rule.deploymentDirectory || machine(rule)?.installDirectory || '目录未上报'
let sequence = 0, operation = 0, stopped = false, timer: ReturnType<typeof setTimeout> | undefined
type SettingsBody = Parameters<typeof runnerManagementApi.saveNodeDeploymentResource>[0]
let settingsTimer: ReturnType<typeof setTimeout> | undefined, settingsWrites = Promise.resolve()
let revisionState = { revision: '' }
let pendingSettings: { body: SettingsBody; sequence: number; state: typeof revisionState; fingerprint: string } | null = null
function scheduleSettings() {
  clearTimeout(settingsTimer); pendingSettings = null
  if (selection.value && !settingsDirty.value && !saving.value) { settingsStatus.value = '部署配置已保存'; return }
  if (!selection.value || !settingsDirty.value || stopped || loading.value || busy.value || auth.role !== 'admin') return
  if (settingsValidation.value) { settingsStatus.value = settingsValidation.value; return }
  const settings = { ...draft.value }
  if (followGeneration.value) { settings.repositoryId = ''; settings.sourceDirectory = '' }
  pendingSettings = { sequence, state: revisionState, fingerprint: JSON.stringify([draft.value, followGeneration.value]), body: { ...context(), revision: selection.value.revision,
    resourceId: selection.value.resourceId, resourceIds: selection.value.resourceIds || [], useDefault: useDefault.value,
    deploymentSettings: settings } }
  settingsStatus.value = '等待自动保存…'
  settingsTimer = setTimeout(flushSettings, 700)
}
function flushSettings() {
  clearTimeout(settingsTimer)
  const pending = pendingSettings; pendingSettings = null
  if (!pending) return
  settingsWrites = settingsWrites.then(async () => {
    const current = () => pending.sequence === sequence && !stopped
    if (current()) { saving.value = true; error.value = ''; settingsStatus.value = '正在自动保存…' }
    try {
      const result = await runnerManagementApi.saveNodeDeploymentResource({ ...pending.body, revision: pending.state.revision })
      pending.state.revision = result.revision
      if (current()) {
        selection.value = result
        savedSettings.value = JSON.stringify({ ...emptySettings(), ...result.deploymentSettings })
        if (pending.fingerprint === JSON.stringify([draft.value, followGeneration.value])) resetSettings()
        settingsStatus.value = settingsDirty.value ? '等待自动保存…' : '部署配置已自动保存'
      }
    } catch (e) {
      const reason = `自动保存失败：${e instanceof Error ? e.message : String(e)}`
      if (current()) { error.value = reason; settingsStatus.value = reason }
      else ElMessage.error(`配置 ${pending.body.configId} ${reason}`)
    } finally { if (current()) saving.value = false }
  })
}
function suspend() { flushSettings(); stopped = true; sequence++; operation++; previewSequence++; clearTimeout(timer); clearTimeout(previewTimer) }
onBeforeUnmount(suspend)
onDeactivated(suspend)
onActivated(() => { if (stopped) { stopped = false; saving.value = false; busy.value = false; void load(); poll() } })
async function load(background = false) {
  const seq = ++sequence, scope = context()
  if (!background) loading.value = true
  try {
    if (!background) await settingsWrites
    if (seq !== sequence || stopped) return
    const [choice, instances, repos] = await Promise.all([
      runnerManagementApi.nodeDeploymentResource(scope), runnerManagementApi.instances(), runnerManagementApi.codeRepositories(),
    ])
    if (seq !== sequence || stopped || settingsDirty.value) return
    selection.value = choice; revisionState.revision = choice.revision
    runners.value = instances; repositories.value = repos; resetSettings(); error.value = ''
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) loading.value = false }
}
function poll() {
  clearTimeout(timer)
  timer = setTimeout(async () => { if (!saving.value && !busy.value && !settingsDirty.value) await load(true); if (!stopped) poll() }, 10000)
}
watch(() => [props.sourceId, props.flowId, props.stepId, props.configId, props.configType, props.queueName, props.archiveId, environment.value], () => {
  flushSettings(); revisionState = { revision: '' }; settingsStatus.value = '修改后自动保存'
  sequence++; operation++; selection.value = null; error.value = ''; saving.value = false; busy.value = false
  resetSettings()
  void load(); poll()
}, { immediate: true })
watch(() => JSON.stringify([draft.value, followGeneration.value]), scheduleSettings, { flush: 'sync' })
watch(() => JSON.stringify([context(), selection.value?.revision, selectedIds.value, draft.value, followGeneration.value]), () => {
  const seq = ++previewSequence
  clearTimeout(previewTimer); pathPreview.value = null; previewError.value = ''; previewLoading.value = false
  if (!selection.value || !settingsDirty.value || stopped) return
  if (!followGeneration.value && (!draft.value.repositoryId || !draft.value.sourceDirectory.trim())) {
    previewError.value = '请选择 Git 地址并填写源目录，以计算实际部署目录'; return
  }
  const scope = context(), settings = { ...draft.value }
  if (followGeneration.value) { settings.repositoryId = ''; settings.sourceDirectory = '' }
  previewLoading.value = true
  previewTimer = setTimeout(async () => {
    try {
      const result = await runnerManagementApi.previewNodeDeploymentResource(scope, settings)
      if (seq === previewSequence && !stopped) pathPreview.value = result
    } catch (e) { if (seq === previewSequence && !stopped) previewError.value = e instanceof Error ? e.message : String(e) }
    finally { if (seq === previewSequence) previewLoading.value = false }
  }, 250)
})
async function saveTargets(ids: string[], followDefault: boolean) {
  if (!canEdit.value || settingsDirty.value || !selection.value) return
  const seq = ++sequence, scope = context(), revision = selection.value.revision
  saving.value = true; error.value = ''
  try {
    const result = await runnerManagementApi.saveNodeDeploymentResource({ ...scope, revision, resourceId: ids[0] || '', resourceIds: ids, useDefault: followDefault })
    if (seq === sequence && !stopped) { selection.value = result; revisionState.revision = result.revision; ElMessage.success('部署目标已保存') }
  } catch (e) { if (seq === sequence && !stopped) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) saving.value = false }
}
async function toggleDefault(event: Event) {
  const input = event.target as HTMLInputElement
  await saveTargets([], input.checked)
  input.checked = useDefault.value
}
async function deploy() {
  if (!canEdit.value || settingsDirty.value || !selection.value || !props.archiveId || !selectedIds.value.length || unavailable.value) return
  const seq = sequence, op = ++operation, scope = context()
  const ids = [...selectedIds.value], targetRevision = selection.value.revision, archiveId = props.archiveId
  busy.value = true; error.value = ''
  let closedCount = 0
  try {
    const preparation = await prepareDeploymentProcesses(ids.map(id => {
      const rule = choices.value.find(item => item.resourceId === id)!
      const target = selection.value?.targets?.find(item => item.resourceId === id)
      return { runnerId: rule.runnerId, directory: target?.deploymentDirectory || target?.targetPath || selection.value?.targetPath || '' }
    }), () => seq === sequence && !stopped, text => { deploymentStatus.value = text })
    if (!preparation.proceed || seq !== sequence || stopped) return
    closedCount = preparation.stoppedCount; deploymentStatus.value = '正在提交部署任务…'
    const result = await runnerManagementApi.deployGeneratedArchive({ ...scope, archiveId,
      resourceIds: ids, targetRevision })
    if (seq !== sequence || stopped) return
    ElMessage.success(`已提交 ${result.items?.length || 1} 个独立部署任务，请到任务中心的“部署任务”查看${closedCount ? '；部署完成后请在运行实例启动程序' : ''}`)
    await load()
  } catch (e) { if (seq === sequence && !stopped) error.value = (e instanceof Error ? e.message : String(e)) + (closedCount ? '；相关进程已关闭，请到运行实例查看状态' : '') }
  finally { if (!stopped && op === operation) busy.value = false }
}
</script>

<template>
  <div class="deployment-targets" data-testid="node-deployment-targets">
    <div class="dt-toolbar">
      <el-radio-group v-model="environment" :disabled="saving || busy || settingsDirty" size="small" aria-label="部署环境">
        <el-radio-button value="test">测试</el-radio-button><el-radio-button value="production">生产</el-radio-button>
      </el-radio-group>
      <el-button size="small" :loading="loading" :disabled="saving || busy || settingsDirty" @click="load()">刷新部署信息</el-button>
      <RouterLink :to="{ path: '/settings', query: { tab: 'runners', view: 'resources' } }" target="_blank">管理部署资源</RouterLink>
    </div>
    <p>选择部署资源后自动保存，支持多选。每台机器生成一个独立部署任务，可在任务中心查看结果和重试。</p>
    <label class="dt-default"><input type="checkbox" :checked="useDefault" :disabled="!canEdit || settingsDirty" data-testid="deployment-follow-default" @change="toggleDefault" /> 使用默认部署资源</label>
    <div class="dt-resources">
      <label for="node-deployment-resources">部署资源</label>
      <el-select id="node-deployment-resources" :model-value="selectedIds" multiple filterable clearable collapse-tags collapse-tags-tooltip :max-collapse-tags="2"
        :disabled="!canEdit || settingsDirty" :loading="loading" placeholder="请选择部署资源（可多选）" aria-label="部署资源" data-testid="deployment-resource-select" @change="saveTargets($event, false)">
        <el-option v-for="rule in choices" :key="rule.resourceId" :value="rule.resourceId"
          :label="`${machine(rule)?.ipAddress || '机器未上报 IP'} · ${rule.resourceName || machine(rule)?.name || rule.configTypeName}`"
          :title="`${machine(rule)?.status === 'online' ? '在线' : '离线，提交后等待上线'} · ${rule.runnerId}\n${destination(rule)}`">
          <span>{{ machine(rule)?.ipAddress || '机器未上报 IP' }} · {{ rule.resourceName || machine(rule)?.name || rule.configTypeName }}</span>
          <small class="dt-resource-status">{{ machine(rule)?.status === 'online' ? '在线' : '离线' }}</small>
        </el-option>
      </el-select>
    </div>
    <p v-if="!loading && !choices.length">当前节点类型和环境没有可用部署资源，请先添加。</p>
    <p v-if="unavailable" role="alert">部分已选部署资源已停用或不适用，请重新选择部署目标。</p>
    <p v-if="!selectedIds.length">未选择部署机器，生成代码后不会自动下发到指定机器。</p>
    <p v-else-if="environment === 'test'">生成并提交代码成功后，按已保存的测试目标分别创建部署任务；修改目标不会中断已经执行的任务。</p>
    <div class="dt-settings">
      <strong>部署任务配置</strong>
      <label class="dt-default"><input type="checkbox" :checked="followGeneration" :disabled="!canEdit" data-testid="deployment-follow-generation" @change="changeFollowGeneration" /> 仅部署本次生成的文件</label>
      <div v-if="followGeneration" class="dt-generated-files" data-testid="deployment-generated-files">
        <small>使用本次生成结果的 Git 仓库和固定版本，保留相对目录结构，仅下发生成文件及其依赖清单。</small>
        <code v-for="file in selection?.generatedFiles || []" :key="file">{{ file }}</code>
        <small v-if="!selection?.generatedFiles?.length">{{ archiveId ? '暂无生成文件清单，请刷新部署信息' : '生成并提交代码后显示待部署文件' }}</small>
      </div>
      <div class="dt-setting-field">
        <label for="node-deployment-repository">Git 地址：</label>
        <div class="dt-setting-control">
          <el-select id="node-deployment-repository" :model-value="followGeneration ? selection?.repositoryId || '' : draft.repositoryId" :disabled="!canEdit || followGeneration" filterable placeholder="请选择已配置的 Git 仓库" aria-label="部署 Git 地址" @update:model-value="draft.repositoryId = $event">
            <el-option v-for="repo in activeRepositories" :key="repo.repoId" :value="repo.repoId" :label="`${repo.name} · ${repo.remoteUrl || repo.path}`" :title="`${repo.remoteUrl || repo.path} · 分支 ${repo.branch}`" />
          </el-select>
          <RouterLink :to="{ path: '/settings', query: { tab: 'code-repos' } }" target="_blank">管理 Git 仓库地址</RouterLink>
        </div>
      </div>
      <div class="dt-setting-field">
        <label for="node-deployment-source">Git 文件目录：</label>
        <div class="dt-setting-control"><el-input id="node-deployment-source" :model-value="followGeneration ? selection?.gitDirectory || '' : draft.sourceDirectory" :disabled="!canEdit || followGeneration" placeholder="仓库内相对目录，例如 links/1401218" data-testid="deployment-source-directory" @update:model-value="draft.sourceDirectory = $event" /></div>
      </div>
      <div class="dt-setting-field">
        <label>入口程序：</label>
        <div class="dt-setting-control" data-testid="deployment-configured-entry"><code>{{ (settingsDirty ? pathPreview : selection)?.entryPoint || '未设置入口程序（仅下发文件）' }}</code><small>入口保存在部署配置中，多台机器共用；生成的网站脚本由入口程序调用。</small></div>
      </div>
      <div class="dt-setting-field">
        <label for="node-deployment-directory">部署目录：</label>
        <div class="dt-setting-control">
          <el-input id="node-deployment-directory" v-model="deploymentDirectoryInput" :disabled="!canEdit" placeholder="请选择部署资源以计算目录" data-testid="deployment-destination-directory" />
          <small>默认显示按部署资源计算的目录，可直接修改为实例内的相对路径或完整路径。下方显示每台机器上的完整部署目录。</small>
        </div>
      </div>
      <div class="dt-actual-targets" data-testid="deployment-actual-directories">
        <strong>实际部署目录{{ settingsDirty ? '（按当前输入计算）' : '' }}</strong>
        <small v-if="previewLoading">正在计算部署目录…</small>
        <small v-else-if="previewError" role="alert">{{ previewError }}</small>
        <template v-else><div v-for="target in actualTargets" :key="target.resourceId"><span>{{ runners.find(item => item.runnerId === target.runnerId)?.ipAddress || target.runnerId }}</span><code :class="{ 'dt-error': target.pathError }">{{ target.deploymentDirectory || target.pathError || '目录未上报' }}</code></div><small v-if="!actualTargets.length">请选择部署资源后查看实际部署目录</small></template>
      </div>
      <small role="status" aria-live="polite" data-testid="deployment-settings-status">{{ settingsStatus }}</small>
    </div>
    <el-button type="primary" :loading="busy" :disabled="!canEdit || settingsDirty || !archiveId || !selectedIds.length || unavailable" data-testid="deploy-selected-machines" @click="deploy">创建部署任务（{{ selectedIds.length }} 台）</el-button>
    <small v-if="busy" role="status">{{ deploymentStatus }}</small>
    <p v-if="!archiveId">当前源和流程节点尚无已归档的生成代码，请先在“智能体配置”生成并提交代码。</p>
    <el-alert v-if="error && !error.startsWith('自动保存失败：')" :title="error" type="error" :closable="false" show-icon />
  </div>
</template>

<style scoped>
.deployment-targets { font-size:12px; min-width:0; }
.dt-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
p, small { color:var(--el-text-color-secondary); }
.dt-default { display:flex; align-items:center; gap:8px; margin:12px 0; }
.dt-resources { display:grid; gap:6px; }
.dt-resources .el-select { width:100%; min-width:0; }
.dt-resource-status { margin-left:12px; }
.dt-settings { display:grid; gap:6px; margin:14px 0; padding-top:12px; border-top:1px solid var(--el-border-color-lighter); }
.dt-settings .dt-default { margin:4px 0; }
.dt-settings .el-select { width:100%; min-width:0; }
.dt-generated-files { display:grid; gap:4px; }
.dt-generated-files code { overflow-wrap:anywhere; }
.dt-setting-field { display:grid; grid-template-columns:80px minmax(0, 1fr); gap:8px; margin-top:4px; }
.dt-setting-field>label { padding-top:6px; text-align:right; line-height:20px; white-space:nowrap; }
.dt-setting-control { display:grid; gap:6px; min-width:0; }
.dt-actual-targets { display:grid; gap:6px; padding:8px; background:var(--el-fill-color-light); border-radius:6px; }
.dt-actual-targets>div { display:grid; gap:3px; }
.dt-actual-targets code { overflow-wrap:anywhere; white-space:normal; }
.dt-error, [role=alert] { color:var(--el-color-danger); }
a { color:var(--el-color-primary); }
</style>
