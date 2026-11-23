<script setup lang="ts">
import { computed, h, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { prepareDeploymentProcesses } from '@/utils/deploymentProcesses'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'
import { runnerManagementApi, type CodeRepository, type DeploymentEnvironment, type DeploymentResourceRule, type TaskArtifact, type NodeDeploymentResource, type NodeDeploymentSettings, type RunnerInstance } from '@/api/runnerManagement'

const props = defineProps<{
  sourceId: string
  flowId: string
  stepId: string
  configId: string
  configType: string
  archiveId?: string
  archiveCommit?: string
  archiveLoading?: boolean
  queueName?: string
}>()
const emit = defineEmits<{ (e: 'refresh-archive'): void }>()

const auth = useAuthStore(), environment = ref<DeploymentEnvironment>('test')
const selection = ref<NodeDeploymentResource | null>(null), runners = ref<RunnerInstance[]>([])
const loading = ref(false), saving = ref(false), busy = ref(false), error = ref('')
type DeployedNodeOutput = Pick<TaskArtifact, 'artifactId' | 'taskId' | 'gitCommit' | 'archiveId' | 'resourceId' | 'updatedAt' | 'outputFiles'> & {
  runnerId: string; runnerName: string; runnerIp: string; installedPath: string; targetPath: string
}
const deployedJobs = ref<DeployedNodeOutput[]>([]), deployedLoading = ref(false), deployedError = ref('')
const advancedOpen = ref(false)
const deployedExpanded = ref(true)

const deployedResources = computed(() => {
  const byRunner = new Map<string, DeployedNodeOutput>()
  for (const job of [...deployedJobs.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    if (job.runnerId && !byRunner.has(job.runnerId)) byRunner.set(job.runnerId, job)
  }
  return [...byRunner.values()]
})
const deployedResourceName = (job: DeployedNodeOutput) => selection.value?.resources.find(item => item.resourceId === job.resourceId || item.runnerId === job.runnerId)?.resourceName || job.runnerName || '部署资源'
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

const freshnessState = computed<{ label: string; tone: 'success' | 'warn' | 'muted' }>(() => {
  if (!props.archiveId) return { label: '待生成代码', tone: 'muted' }
  if (deployedLoading.value || loading.value || previewLoading.value) return { label: '查询中…', tone: 'muted' }
  if (deployedError.value) return { label: '部署状态读取失败', tone: 'warn' }
  if (!selectedIds.value.length) return { label: '未选择部署目标', tone: 'muted' }
  if (settingsValidation.value || previewError.value) return { label: '部署配置待补全', tone: 'warn' }
  const targets = selectedIds.value.map(id => targetDeployMeta(id))
  if (targets.every(item => item.state === 'fresh')) return { label: '尚未部署', tone: 'warn' }
  if (targets.some(item => item.state === 'update')) return { label: '有新代码待部署', tone: 'warn' }
  if (targets.some(item => item.state === 'directory')) return { label: '部署目录待更新', tone: 'warn' }
  if (targets.some(item => item.state === 'fresh')) return { label: '有目标尚未部署', tone: 'warn' }
  return { label: '与已部署一致', tone: 'success' }
})

const entryPointDisplay = computed(() => (settingsDirty.value ? pathPreview.value : selection.value)?.entryPoint || '')
const hasCustomSettings = computed(() => !followGeneration.value || !!draft.value.deploymentDirectory.trim())
const advancedSummary = computed(() => {
  const parts: string[] = [followGeneration.value ? '仅部署生成文件' : '手动指定 Git']
  if (entryPointDisplay.value) parts.push(`入口 ${entryPointDisplay.value}`)
  if (deploymentDirectoryInput.value) parts.push(`目录 ${deploymentDirectoryInput.value}`)
  return parts.join(' · ')
})

const footerStatusTone = computed<'error' | 'warn' | 'ok'>(() => {
  if (settingsStatus.value.startsWith('自动保存失败：') || settingsValidation.value) return 'error'
  if (busy.value || saving.value || settingsDirty.value) return 'warn'
  return 'ok'
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
const machineById = (runnerId?: string) => runners.value.find(item => item.runnerId === runnerId)
const ruleByResourceId = (resourceId?: string) => choices.value.find(item => item.resourceId === resourceId)
const runnerDirectory = (rule: DeploymentResourceRule) => machine(rule)?.installDirectory || 'Runner 目录未上报'

type TargetDeployState = 'fresh' | 'update' | 'directory' | 'latest'
interface TargetDeployMeta {
  resourceId: string
  runnerId: string
  label: string
  ip: string
  directory: string
  state: TargetDeployState
  deployedJob?: DeployedNodeOutput
}
function normalizePath(value?: string) {
  if (!value) return ''
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}
function normalizedDeploymentPath(value: string | undefined, runnerId: string) {
  const path = normalizePath(value)
  const root = normalizePath(machineById(runnerId)?.installDirectory)
  return path && root && !/^(?:[a-z]:|\/)/i.test(path) ? normalizePath(`${root}/${path}`) : path
}
function targetDeployMeta(resourceId: string, runnerId?: string, plannedDir?: string): TargetDeployMeta {
  const rule = ruleByResourceId(resourceId)
  const rid = runnerId || rule?.runnerId || ''
  const m = machineById(rid)
  const target = actualTargets.value.find(item => item.resourceId === resourceId)
    || selection.value?.targets?.find(item => item.resourceId === resourceId)
  const directory = plannedDir || target?.deploymentDirectory || target?.targetPath || selection.value?.targetPath || ''
  const deployedJob = rid ? deployedResources.value.find(job => job.runnerId === rid) : undefined
  let state: TargetDeployState = 'fresh'
  if (deployedJob) {
    const sameCommit = props.archiveCommit
      ? deployedJob.gitCommit === props.archiveCommit
      : !!props.archiveId && !!deployedJob.archiveId && deployedJob.archiveId === props.archiveId
    const deployedDir = normalizedDeploymentPath(deployedJob.installedPath || deployedJob.targetPath, rid)
    const nextDir = normalizedDeploymentPath(directory, rid)
    const sameDir = !deployedDir || !nextDir || deployedDir === nextDir
    state = !sameCommit ? 'update' : sameDir ? 'latest' : 'directory'
  }
  return {
    resourceId,
    runnerId: rid,
    label: rule?.resourceName || m?.name || '部署资源',
    ip: m?.ipAddress || rid,
    directory,
    state,
    deployedJob,
  }
}
const targetBadgeText: Record<TargetDeployState, string> = { fresh: '首次部署', update: '待更新', directory: '目录待更新', latest: '与已部署一致' }
function targetBadgeTitle(meta: TargetDeployMeta) {
  if (meta.state === 'fresh') return '该机器当前环境尚未部署过此节点'
  const oldCommit = meta.deployedJob?.gitCommit?.slice(0, 12) || ''
  if (meta.state === 'latest') return `代码版本 ${oldCommit} 和部署目录均一致`
  if (meta.state === 'directory') return `代码版本 ${oldCommit} 相同，部署目录将变更。\n已部署目录：${meta.deployedJob?.installedPath || meta.deployedJob?.targetPath}\n目标目录：${meta.directory}`
  return `已部署 ${oldCommit}${props.archiveCommit ? ` → 将更新至 ${props.archiveCommit.slice(0, 12)}` : '，将覆盖更新'}`
}
let confirmChoiceSequence = 0
async function confirmExistingDeployment(ids: string[]): Promise<string[] | null> {
  const metas = ids.map(id => targetDeployMeta(id))
  const latestMetas = metas.filter(item => item.state === 'latest')
  const pendingMetas = metas.filter(item => item.state !== 'latest')
  const deployedMetas = metas.filter(item => item.state !== 'fresh')
  const isProd = environment.value === 'production'
  if (!latestMetas.length && !(isProd && deployedMetas.length)) return ids

  const mixedLatest = latestMetas.length > 0 && pendingMetas.length > 0
  let skipLatest = mixedLatest
  const radioName = `deploy-existing-choice-${++confirmChoiceSequence}`
  const summaryText = latestMetas.length === ids.length
    ? `所选 ${ids.length} 台机器均已部署当前版本，是否确认重新部署？`
    : latestMetas.length > 0
      ? `所选目标中有 ${latestMetas.length} 台已部署当前版本${isProd ? '（生产环境）' : ''}，请选择本次部署范围：`
      : `生产环境以下 ${deployedMetas.length} 台机器已有部署记录，本次将覆盖更新，是否继续？`
  const listMetas = latestMetas.length > 0 && !isProd ? latestMetas : deployedMetas
  const confirmButtonText = latestMetas.length === ids.length ? '确认重新部署' : isProd ? '确认覆盖部署' : '继续部署'

  try {
    await ElMessageBox.confirm(h('div', [
      h('p', summaryText),
      h('ul', { style: { maxHeight: '160px', overflow: 'auto', paddingLeft: '18px', margin: '8px 0' } }, listMetas.map(item => {
        const oldCommit = item.deployedJob?.gitCommit?.slice(0, 8) || ''
        const nextCommit = props.archiveCommit?.slice(0, 8) || ''
        const detail = item.state === 'latest'
          ? `已是最新（${oldCommit}）`
          : `覆盖更新（${oldCommit}${nextCommit ? ` → ${nextCommit}` : ''}）`
        return h('li', { style: { overflowWrap: 'anywhere', marginBottom: '4px' } }, `${item.label}（${item.ip}）· ${detail}`)
      })),
      ...(mixedLatest ? [
        h('p', { style: { margin: '6px 0 4px' } }, [h('label', [
          h('input', { type: 'radio', name: radioName, value: 'skip', checked: true, onChange: () => { skipLatest = true } }),
          ` 仅部署未更新的 ${pendingMetas.length} 台机器（跳过已是最新）`,
        ])]),
        h('p', { style: { margin: '4px 0' } }, [h('label', [
          h('input', { type: 'radio', name: radioName, value: 'all', onChange: () => { skipLatest = false } }),
          ` 全部 ${ids.length} 台重新部署`,
        ])]),
      ] : []),
    ]), isProd ? '生产部署确认' : '重复部署确认', {
      type: 'warning',
      confirmButtonText,
      cancelButtonText: '取消',
      closeOnClickModal: false,
    })
  } catch (action) {
    if (action === 'cancel' || action === 'close') return null
    throw action
  }
  return mixedLatest && skipLatest ? pendingMetas.map(item => item.resourceId) : ids
}

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
  void loadDeployed(seq, scope, background)
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
async function loadDeployed(seq: number, scope: ReturnType<typeof context>, background: boolean) {
  if (!background) deployedLoading.value = true
  try {
    const items: DeployedNodeOutput[] = []
    let page = 1, total = 0
    do {
      const result = await runnerManagementApi.artifacts({ sourceId: scope.sourceId, flowId: scope.flowId,
        stepId: scope.stepId, configId: scope.configId, artifactType: 'deployment', environment: scope.environment, status: 'success', page, size: 100 })
      if (seq !== sequence || stopped) return
      items.push(...result.items.map(output => ({ ...output, outputFiles: output.outputFiles || [], runnerId: output.serverId, runnerName: output.serverName,
        runnerIp: output.serverIp, installedPath: output.machinePath, targetPath: output.targetPath })))
      total = result.total
      page++
      if (!result.items.length) break
    } while (items.length < total)
    deployedJobs.value = items
    deployedError.value = ''
  } catch (e) { if (seq === sequence && !stopped) deployedError.value = e instanceof Error ? e.message : String(e) }
  finally { if (seq === sequence) deployedLoading.value = false }
}
function refreshAll() {
  emit('refresh-archive')
  void load()
}
function poll() {
  clearTimeout(timer)
  timer = setTimeout(async () => { if (!saving.value && !busy.value && !settingsDirty.value) await load(true); if (!stopped) poll() }, 10000)
}
watch(() => [props.sourceId, props.flowId, props.stepId, props.configId, props.configType, props.queueName, props.archiveId, environment.value], () => {
  flushSettings(); revisionState = { revision: '' }; settingsStatus.value = '修改后自动保存'
  sequence++; operation++; selection.value = null; error.value = ''; saving.value = false; busy.value = false
  deployedJobs.value = []; deployedError.value = ''; deployedLoading.value = false
  advancedOpen.value = false
  resetSettings()
  void load(); poll()
}, { immediate: true })
watch(() => deployedResources.value.length, (count) => {
  deployedExpanded.value = count <= 2
})
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
  const initialIds = [...selectedIds.value], targetRevision = selection.value.revision, archiveId = props.archiveId
  busy.value = true; error.value = ''
  let closedCount = 0
  try {
    const ids = await confirmExistingDeployment(initialIds)
    if (!ids?.length || seq !== sequence || stopped) return
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
    <!-- 1. 顶部上下文条：环境切换 + 合并刷新 + 管理入口 -->
    <div class="dt-toolbar">
      <el-radio-group v-model="environment" :disabled="saving || busy || settingsDirty" size="small" aria-label="部署环境">
        <el-radio-button value="test">测试</el-radio-button>
        <el-radio-button value="production">生产</el-radio-button>
      </el-radio-group>
      <div class="dt-toolbar-actions">
        <el-button
          size="small"
          :loading="loading || archiveLoading"
          :disabled="saving || busy || settingsDirty"
          title="刷新代码归档与部署信息"
          @click="refreshAll"
        >刷新</el-button>
        <RouterLink class="dt-link" :to="{ path: '/settings', query: { tab: 'runners', view: 'resources' } }" target="_blank">管理资源 ↗</RouterLink>
      </div>
    </div>

    <!-- 2. 版本与已部署状态卡 -->
    <section class="dt-card dt-status-card">
      <div class="dt-card-head">
        <span class="dt-card-title">当前方案对比</span>
        <span class="dt-pill" :class="`is-${freshnessState.tone}`">{{ freshnessState.label }}</span>
      </div>

      <p class="dt-muted-line">按当前版本和目标目录比较历史部署；修改配置不会执行部署。</p>

      <slot />

      <p v-if="!archiveId" class="dt-hint-warn">当前源和流程节点尚无已归档的生成代码，请先在“智能体配置”生成并提交代码。</p>

      <div class="dt-deployed" data-testid="node-deployed-resources">
        <div class="dt-deployed-head">
          <span class="dt-sub-title" title="按成功部署回执显示，不代表机器当前在线">已部署资源</span>
          <button
            v-if="deployedResources.length"
            type="button"
            class="dt-text-btn"
            @click="deployedExpanded = !deployedExpanded"
          >{{ deployedResources.length }} 台 {{ deployedExpanded ? '收起 ▴' : '展开 ▾' }}</button>
        </div>
        <p v-if="deployedLoading && !deployedResources.length" role="status" class="dt-muted-line">正在查询已部署资源…</p>
        <el-alert v-if="deployedError" :title="`已部署资源加载失败：${deployedError}`" type="error" :closable="false" show-icon />
        <div v-if="deployedResources.length" v-show="deployedExpanded" class="dt-deployed-list">
          <div v-for="job in deployedResources" :key="job.runnerId" class="dt-deployed-row" data-testid="deployed-resource-row">
            <div class="dt-deployed-top">
              <strong class="dt-deployed-name">{{ deployedResourceName(job) }}</strong>
              <span class="dt-ip">{{ job.runnerIp || machineById(job.runnerId)?.ipAddress || job.runnerId }}</span>
              <span class="dt-target-badge is-latest">部署成功</span>
              <span class="dt-commit-tag" :title="job.gitCommit">{{ job.gitCommit.slice(0, 8) }}</span>
              <time class="dt-time">{{ formatRunnerDateTime(job.updatedAt) }}</time>
            </div>
            <code class="dt-path-code" :title="job.installedPath || job.targetPath">{{ job.installedPath || job.targetPath || '部署目录未记录' }}</code>
            <details v-if="job.outputFiles.length" class="dt-deployed-files">
              <summary>已部署文件（{{ job.outputFiles.length }}）</summary>
              <code v-for="file in job.outputFiles" :key="file.path" class="dt-path-code" :title="file.sha256">{{ file.path }}</code>
            </details>
          </div>
        </div>
        <p v-if="!deployedLoading && !deployedError && !deployedResources.length" class="dt-muted-line">
          当前节点在{{ environment === 'test' ? '测试' : '生产' }}环境暂无成功部署记录。
        </p>
      </div>
    </section>

    <!-- 3. 核心高频区：部署目标机器 + 落地目录所见即所得 -->
    <section class="dt-card dt-targets-card">
      <div class="dt-card-head">
        <label class="dt-card-title" for="node-deployment-resources">
          部署目标
          <span v-if="selectedIds.length" class="dt-count">{{ selectedIds.length }} 台</span>
        </label>
        <label class="dt-switch" :class="{ 'is-disabled': !canEdit || settingsDirty }">
          <input
            type="checkbox"
            :checked="useDefault"
            :disabled="!canEdit || settingsDirty"
            data-testid="deployment-follow-default"
            @change="toggleDefault"
          />
          <span class="dt-switch-track" aria-hidden="true" />
          <span class="dt-switch-text">{{ useDefault ? '使用默认' : '自定义' }}</span>
        </label>
      </div>

      <el-select
        id="node-deployment-resources"
        class="dt-resource-select"
        :model-value="selectedIds"
        multiple
        filterable
        clearable
        collapse-tags
        collapse-tags-tooltip
        :max-collapse-tags="2"
        :disabled="!canEdit || settingsDirty"
        :loading="loading"
        placeholder="请选择部署资源（可多选，修改后自动保存）"
        aria-label="部署资源"
        data-testid="deployment-resource-select"
        @change="saveTargets($event, false)"
      >
        <el-option
          v-for="rule in choices"
          :key="rule.resourceId"
          :value="rule.resourceId"
          :label="`${machine(rule)?.ipAddress || '机器未上报 IP'} · ${runnerDirectory(rule)}`"
          :title="`${machine(rule)?.status === 'online' ? '在线' : '离线，提交后等待上线'} · ${rule.runnerId}\n${runnerDirectory(rule)}`"
        >
          <span class="dt-option-main">
            <i class="dt-dot" :class="machine(rule)?.status === 'online' ? 'is-online' : 'is-offline'" />
            <span>{{ machine(rule)?.ipAddress || '机器未上报 IP' }} · {{ runnerDirectory(rule) }}</span>
          </span>
          <small class="dt-resource-status">{{ machine(rule)?.status === 'online' ? '在线' : '离线' }}</small>
        </el-option>
      </el-select>

      <p v-if="!loading && !choices.length" class="dt-muted-line">当前节点类型和环境没有可用部署资源，请先添加。</p>
      <p v-if="unavailable" role="alert" class="dt-error-line">部分已选部署资源已停用或不适用，请重新选择部署目标。</p>

      <!-- 已选机器与落地目录合并预览 -->
      <div class="dt-actual-targets" data-testid="deployment-actual-directories">
        <div class="dt-actual-head">
          <span>落地目录{{ settingsDirty ? '（按当前输入预览）' : '' }}</span>
          <span v-if="environment === 'test' && selectedIds.length" class="dt-auto-tip" title="生成并提交代码成功后，按已保存的测试目标分别创建部署任务；修改目标不会中断已经执行的任务。">提交后自动部署测试</span>
        </div>
        <small v-if="previewLoading" class="dt-muted-line">正在计算部署目录…</small>
        <small v-else-if="previewError" role="alert" class="dt-error-line">{{ previewError }}</small>
        <template v-else>
          <div v-for="target in actualTargets" :key="target.resourceId" class="dt-target-row">
            <div class="dt-target-top">
              <i class="dt-dot" :class="machineById(target.runnerId)?.status === 'online' ? 'is-online' : 'is-offline'" />
              <span class="dt-ip">{{ machineById(target.runnerId)?.ipAddress || target.runnerId }}</span>
              <span
                class="dt-target-badge"
                :class="`is-${targetDeployMeta(target.resourceId, target.runnerId, target.deploymentDirectory).state}`"
                :title="targetBadgeTitle(targetDeployMeta(target.resourceId, target.runnerId, target.deploymentDirectory))"
              >{{ targetBadgeText[targetDeployMeta(target.resourceId, target.runnerId, target.deploymentDirectory).state] }}</span>
              <span class="dt-target-state">{{ machineById(target.runnerId)?.status === 'online' ? '在线' : '离线' }}</span>
            </div>
            <code
              class="dt-path-code"
              :class="{ 'dt-error': target.pathError }"
              :title="target.deploymentDirectory || target.pathError || '目录未上报'"
            >{{ target.deploymentDirectory || target.pathError || '目录未上报' }}</code>
          </div>
          <small v-if="!actualTargets.length" class="dt-muted-line">请选择部署资源后查看各机器的实际部署目录</small>
        </template>
      </div>
    </section>

    <!-- 4. 低频高级配置（默认折叠，渐进式披露） -->
    <section class="dt-card dt-advanced-card">
      <button type="button" class="dt-collapse-head" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
        <span class="dt-collapse-left">
          <span class="dt-chevron">{{ advancedOpen ? '▾' : '▸' }}</span>
          <span class="dt-card-title">部署路径与来源设置</span>
          <span v-if="settingsValidation" class="dt-mini-tag is-error">待补全</span>
          <span v-else-if="hasCustomSettings" class="dt-mini-tag is-custom">已自定义</span>
        </span>
        <span class="dt-collapse-action">{{ advancedOpen ? '收起' : '展开' }}</span>
      </button>
      <p v-if="!advancedOpen" class="dt-collapse-summary" :title="advancedSummary">{{ advancedSummary }}</p>

      <div v-show="advancedOpen" class="dt-settings">
        <div class="dt-toggle-row">
          <span class="dt-field-label" title="使用本次生成结果的 Git 仓库和固定版本，保留相对目录结构，仅下发生成文件及其依赖清单。">仅部署本次生成的文件</span>
          <label class="dt-switch" :class="{ 'is-disabled': !canEdit }">
            <input
              type="checkbox"
              :checked="followGeneration"
              :disabled="!canEdit"
              data-testid="deployment-follow-generation"
              @change="changeFollowGeneration"
            />
            <span class="dt-switch-track" aria-hidden="true" />
            <span class="dt-switch-text">{{ followGeneration ? '已开启' : '已关闭' }}</span>
          </label>
        </div>

        <div v-if="followGeneration" class="dt-generated-files" data-testid="deployment-generated-files">
          <code v-for="file in selection?.generatedFiles || []" :key="file" :title="file">{{ file }}</code>
          <small v-if="!selection?.generatedFiles?.length" class="dt-muted-line">
            {{ archiveId ? '暂无生成文件清单，请刷新部署信息' : '生成并提交代码后显示待部署文件' }}
          </small>
        </div>

        <div class="dt-field">
          <div class="dt-field-head">
            <label for="node-deployment-repository">Git 地址：</label>
            <RouterLink class="dt-link" :to="{ path: '/settings', query: { tab: 'code-repos' } }" target="_blank">管理 Git 仓库地址 ↗</RouterLink>
          </div>
          <el-select
            id="node-deployment-repository"
            size="small"
            :model-value="followGeneration ? selection?.repositoryId || '' : draft.repositoryId"
            :disabled="!canEdit || followGeneration"
            filterable
            placeholder="请选择已配置的 Git 仓库"
            aria-label="部署 Git 地址"
            @update:model-value="draft.repositoryId = $event"
          >
            <el-option
              v-for="repo in activeRepositories"
              :key="repo.repoId"
              :value="repo.repoId"
              :label="`${repo.name} · ${repo.remoteUrl || repo.path}`"
              :title="`${repo.remoteUrl || repo.path} · 分支 ${repo.branch}`"
            />
          </el-select>
        </div>

        <div class="dt-field">
          <label for="node-deployment-source">Git 文件目录：</label>
          <el-input
            id="node-deployment-source"
            size="small"
            :model-value="followGeneration ? selection?.gitDirectory || '' : draft.sourceDirectory"
            :disabled="!canEdit || followGeneration"
            placeholder="仓库内相对目录，例如 links/1401218"
            data-testid="deployment-source-directory"
            @update:model-value="draft.sourceDirectory = $event"
          />
        </div>

        <div class="dt-field">
          <label>入口程序：</label>
          <div class="dt-entry-box" data-testid="deployment-configured-entry" title="入口保存在部署配置中，多台机器共用；生成的网站脚本由入口程序调用。">
            <code>{{ entryPointDisplay || '未设置入口程序（仅下发文件）' }}</code>
          </div>
        </div>

        <div class="dt-field">
          <label for="node-deployment-directory">部署目录：</label>
          <el-input
            id="node-deployment-directory"
            v-model="deploymentDirectoryInput"
            size="small"
            :disabled="!canEdit"
            placeholder="默认按部署资源计算，可填相对路径或完整路径"
            data-testid="deployment-destination-directory"
          />
        </div>
      </div>
    </section>

    <el-alert v-if="error && !error.startsWith('自动保存失败：')" :title="error" type="error" :closable="false" show-icon />

    <!-- 5. 底部固定操作栏 -->
    <div class="dt-footer">
      <div class="dt-footer-status">
        <i class="dt-status-dot" :class="`is-${footerStatusTone}`" />
        <small role="status" aria-live="polite" class="dt-status-text" data-testid="deployment-settings-status" :title="busy ? deploymentStatus : settingsStatus">
          {{ busy ? deploymentStatus : settingsStatus }}
        </small>
      </div>
      <el-button
        type="primary"
        size="small"
        :loading="busy"
        :disabled="!canEdit || settingsDirty || !archiveId || !selectedIds.length || unavailable"
        data-testid="deploy-selected-machines"
        @click="deploy"
      >创建部署任务（{{ selectedIds.length }} 台）</el-button>
    </div>
  </div>
</template>

<style scoped>
.deployment-targets { display: flex; flex-direction: column; gap: 10px; font-size: 12px; min-width: 0; }

/* 1. 顶部工具栏 */
.dt-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.dt-toolbar-actions { display: flex; align-items: center; gap: 10px; }
.dt-link { color: var(--el-color-primary); font-size: 11px; text-decoration: none; white-space: nowrap; }
.dt-link:hover { text-decoration: underline; }

/* 通用分组卡片 */
.dt-card { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--rc-border-soft, var(--el-border-color-lighter)); border-radius: 8px; background: #fff; min-width: 0; }
.dt-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.dt-card-title { font-size: 12px; font-weight: 600; color: var(--rc-text, var(--el-text-color-primary)); display: inline-flex; align-items: center; gap: 6px; }
.dt-sub-title { font-size: 11px; font-weight: 600; color: var(--rc-text-2, var(--el-text-color-secondary)); cursor: help; }
.dt-count { font-size: 11px; font-weight: 500; color: var(--el-color-primary); background: var(--el-color-primary-light-9); padding: 0 6px; border-radius: 10px; }

/* 状态胶囊 */
.dt-pill { font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 10px; white-space: nowrap; }
.dt-pill.is-success { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.dt-pill.is-warn { color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.dt-pill.is-muted { color: var(--el-text-color-secondary); background: var(--el-fill-color); }

/* 轻量滑动开关（对齐项目控件视觉强调约定） */
.dt-switch { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; white-space: nowrap; }
.dt-switch.is-disabled { cursor: not-allowed; opacity: 0.6; }
.dt-switch input { position: absolute; opacity: 0; width: 0; height: 0; margin: 0; }
.dt-switch-track { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--el-border-color-darker, #cbd5e1); transition: background-color 0.18s ease; flex-shrink: 0; }
.dt-switch-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18); transition: transform 0.18s ease; }
.dt-switch input:checked + .dt-switch-track { background: var(--el-color-primary); }
.dt-switch input:checked + .dt-switch-track::after { transform: translateX(12px); }
.dt-switch input:focus-visible + .dt-switch-track { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 1px; }
.dt-switch-text { font-size: 11px; color: var(--rc-text-2, var(--el-text-color-secondary)); }

/* 已部署资源区 */
.dt-deployed { display: grid; gap: 6px; padding-top: 8px; border-top: 1px dashed var(--rc-border-soft, var(--el-border-color-lighter)); min-width: 0; }
.dt-deployed-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dt-text-btn { border: 0; background: transparent; padding: 0; color: var(--el-color-primary); font-size: 11px; cursor: pointer; }
.dt-text-btn:hover { text-decoration: underline; }
.dt-deployed-list { display: grid; gap: 6px; min-width: 0; }
.dt-deployed-row { display: grid; gap: 3px; padding: 6px 8px; border-radius: 6px; background: var(--el-fill-color-light); min-width: 0; }
.dt-deployed-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; font-size: 11px; }
.dt-deployed-name { color: var(--el-text-color-primary); font-weight: 600; }
.dt-ip { color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.dt-commit-tag { padding: 0 5px; border-radius: 4px; background: #fff; border: 1px solid var(--el-border-color-lighter); color: var(--el-text-color-regular); font-family: monospace; font-size: 10px; }
.dt-time { margin-left: auto; color: var(--el-text-color-placeholder); font-size: 10px; white-space: nowrap; }
.dt-path-code { display: block; font-size: 11px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 目标选择与落地目录预览 */
.dt-resource-select { width: 100%; min-width: 0; }
.dt-option-main { display: inline-flex; align-items: center; gap: 6px; }
.dt-resource-status { margin-left: 10px; color: var(--el-text-color-secondary); }
.dt-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.dt-dot.is-online { background: var(--el-color-success); }
.dt-dot.is-offline { background: var(--el-text-color-placeholder); }

.dt-actual-targets { display: grid; gap: 6px; padding: 8px; border-radius: 6px; background: var(--el-fill-color-light); min-width: 0; }
.dt-actual-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--el-text-color-secondary); }
.dt-auto-tip { font-size: 10px; color: var(--el-color-primary); background: var(--el-color-primary-light-9); padding: 1px 6px; border-radius: 4px; cursor: help; }
.dt-target-row { display: grid; gap: 2px; padding: 5px 7px; border-radius: 5px; background: #fff; border: 1px solid var(--el-border-color-extra-light); min-width: 0; }
.dt-target-top { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
.dt-target-badge { font-size: 10px; padding: 0 5px; border-radius: 4px; white-space: nowrap; }
.dt-target-badge.is-fresh { color: var(--el-text-color-secondary); background: var(--el-fill-color); }
.dt-target-badge.is-update, .dt-target-badge.is-directory { color: var(--el-color-warning); background: var(--el-color-warning-light-9); }
.dt-target-badge.is-latest { color: var(--el-color-success); background: var(--el-color-success-light-9); }
.dt-target-state { margin-left: auto; font-size: 10px; color: var(--el-text-color-secondary); white-space: nowrap; }

/* 可折叠高级配置 */
.dt-advanced-card { gap: 6px; }
.dt-collapse-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left; }
.dt-collapse-left { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dt-chevron { color: var(--el-text-color-secondary); font-size: 11px; width: 10px; text-align: center; }
.dt-collapse-action { font-size: 11px; color: var(--el-color-primary); white-space: nowrap; }
.dt-collapse-summary { margin: 0; font-size: 11px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-mini-tag { font-size: 10px; padding: 0 5px; border-radius: 4px; font-weight: 500; }
.dt-mini-tag.is-custom { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.dt-mini-tag.is-error { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }

.dt-settings { display: grid; gap: 10px; padding-top: 8px; border-top: 1px dashed var(--rc-border-soft, var(--el-border-color-lighter)); min-width: 0; }
.dt-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dt-field-label { font-size: 12px; color: var(--el-text-color-primary); cursor: help; }
.dt-generated-files { display: grid; gap: 3px; padding: 6px 8px; border-radius: 6px; background: var(--el-fill-color-light); min-width: 0; }
.dt-generated-files code { font-size: 11px; color: var(--el-text-color-regular); overflow-wrap: anywhere; }

/* 上下堆叠表单（适配 380px 窄栏） */
.dt-field { display: grid; gap: 4px; min-width: 0; }
.dt-field > label, .dt-field-head > label { font-size: 11px; color: var(--el-text-color-secondary); }
.dt-field-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dt-field .el-select { width: 100%; min-width: 0; }
.dt-entry-box { padding: 5px 8px; border-radius: 4px; background: var(--el-fill-color-light); font-size: 11px; color: var(--el-text-color-regular); overflow-wrap: anywhere; }

/* 提示与报错 */
.dt-muted-line { margin: 0; font-size: 11px; color: var(--el-text-color-secondary); }
.dt-hint-warn { margin: 0; padding: 6px 8px; border-radius: 6px; background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2, #b88230); font-size: 11px; line-height: 1.5; }
.dt-error-line, .dt-error { margin: 0; font-size: 11px; color: var(--el-color-danger); }

/* 5. 固定底栏（对齐 NodeInspector .rc-insp-foot） */
.dt-footer { position: sticky; bottom: -12px; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px -12px -12px; padding: 8px 12px; background: #fff; border-top: 1px solid var(--rc-border-soft, var(--el-border-color-lighter)); }
.dt-footer-status { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.dt-status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dt-status-dot.is-ok { background: var(--el-color-success); }
.dt-status-dot.is-warn { background: var(--el-color-warning); }
.dt-status-dot.is-error { background: var(--el-color-danger); }
.dt-status-text { font-size: 11px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
