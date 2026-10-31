<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, ArrowDown } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { formatRunnerDateTime, formatRunnerHeartbeat } from '@/utils/format/runnerHeartbeat'
import {
  runnerManagementApi,
  type ArtifactRelease,
  type QueueAssignment,
  type RunnerInstance,
  type EnrollmentCode,
  type SiteCodeVersion,
  type RunnerPackageInfo,
} from '@/api/runnerManagement'

const props = defineProps<{ section: 'runners' | 'assignments' | 'releases'; selectable?: boolean; compact?: boolean; selectedRunnerId?: string; selectionDisabled?: boolean }>()
const emit = defineEmits<{ manageVersions: [configId: string]; selectRunner: [runnerId: string]; instancesChange: [items: RunnerInstance[]]; visibleInstancesChange: [items: RunnerInstance[], filtered: boolean]; releasesChange: [items: ArtifactRelease[]] }>()
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const loading = ref(false)
const error = ref('')
const runners = ref<RunnerInstance[]>([])
const assignments = ref<QueueAssignment[]>([])
const releases = ref<ArtifactRelease[]>([])
const nodeCodes = ref<(SiteCodeVersion & { environments?: ('test' | 'prd')[] })[]>([])
const keyword = ref('')
const runnerIp = ref('')
const runnerState = ref<RunnerInstance['status'] | ''>('')
const runnerIps = computed(() => [...new Set(runners.value.map(row => row.ipAddress).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
const detail = ref<RunnerInstance | QueueAssignment | ArtifactRelease | null>(null)
const detailOpen = ref(false)
const enrollment = ref<EnrollmentCode | null>(null)
const enrollmentOpen = ref(false)
const assignmentOpen = ref(false)
const upgradeOpen = ref(false)
const upgradeRunner = ref<RunnerInstance | null>(null)
const targetRunnerDigest = ref('')
const selectedRunnerIds = ref<string[]>([])
const batchUpgradeOpen = ref(false)
const batchUpgradeDigest = ref('')
type BatchUpgradeResult = { runner: RunnerInstance; state: 'pending' | 'sent' | 'failed'; message: string }
const batchUpgradeResults = ref<BatchUpgradeResult[]>([])
const saving = ref(false)
const packageOpen = ref(false), packageLoading = ref(false), packageDownloading = ref(false), packageError = ref('')
const packageInfo = ref<RunnerPackageInfo | null>(null)
const packageForm = reactive({ server: '', digest: '' })
const formError = ref('')
const form = reactive({ runnerId: '', scriptDigest: '', concurrency: 1, environment: 'test' as 'production' | 'test' })
let loaded = false
let statusTimer: ReturnType<typeof setInterval> | undefined

const sectionTitle = computed(() => ({ runners: '服务器', assignments: '队列运行', releases: 'Runner 版本' })[props.section])
const filteredRunners = computed(() => runners.value.filter((row) =>
  (!runnerIp.value || row.ipAddress === runnerIp.value) && (!runnerState.value || row.status === runnerState.value) &&
  [row.ipAddress, row.installDirectory, row.name, row.runnerId, row.osType, row.osVersion].some((text) => text?.toLowerCase().includes(keyword.value.trim().toLowerCase())),
))
const selectedRunners = computed(() => runners.value.filter(row => selectedRunnerIds.value.includes(row.runnerId)))
watch(filteredRunners, items => emit('visibleInstancesChange', items, !!(keyword.value.trim() || runnerIp.value || runnerState.value)))
const allVisibleSelected = computed(() => filteredRunners.value.length > 0 && filteredRunners.value.every(row => selectedRunnerIds.value.includes(row.runnerId)))
const someVisibleSelected = computed(() => filteredRunners.value.some(row => selectedRunnerIds.value.includes(row.runnerId)))
watch([keyword, runnerIp, runnerState], () => { selectedRunnerIds.value = [] })
watch(runners, rows => { selectedRunnerIds.value = selectedRunnerIds.value.filter(id => rows.some(row => row.runnerId === id)); emit('instancesChange', rows) })
watch(releases, items => emit('releasesChange', items))
const filteredAssignments = computed(() => assignments.value.filter((row) =>
  [row.queue, row.processorType, row.runnerId, runnerLabel(row.runnerId), row.configId, row.deliveryPath, row.repoName].some((text) => text?.toLowerCase().includes(keyword.value.trim().toLowerCase())),
))
const filteredReleases = computed(() => releases.value.filter((row) => row.kind === 'runner' &&
  [row.name, row.digest, row.gitCommit, formatRunnerDateTime(row.publishedAt)].some((text) => text?.toLowerCase().includes(keyword.value.trim().toLowerCase())),
).sort(compareReleaseDate))
const selectedNodeCode = computed(() => nodeCodes.value.find((row) => row.scriptDigest === form.scriptDigest))
const availableRunCodes = computed(() => {
  const groups = new Map<string, typeof nodeCodes.value>()
  for (const code of nodeCodes.value) {
    const key = JSON.stringify([code.codeId, code.configId, code.queueName, code.siteHost])
    const group = groups.get(key)
    if (group) group.push(code)
    else groups.set(key, [code])
  }
  const environment = form.environment === 'production' ? 'prd' : 'test'
  return [...groups.values()].map(versions => versions.find(code => code.environments?.includes(environment)) || versions[0]!)
})
watch(availableRunCodes, choices => {
  const selected = selectedNodeCode.value
  if (selected) form.scriptDigest = choices.find(code => code.codeId === selected.codeId && code.configId === selected.configId && code.queueName === selected.queueName && code.siteHost === selected.siteHost)?.scriptDigest || ''
})
const competingAssignments = computed(() => assignments.value.filter((row) =>
  row.enabled && row.queue === selectedNodeCode.value?.queueName && row.environment === form.environment && row.runnerId !== form.runnerId,
))
const publishedRunnerReleases = computed(() => releases.value.filter(row => row.kind === 'runner' && row.status === 'published').sort(compareReleaseDate))
const latestRunnerDigest = computed(() => {
  const first = publishedRunnerReleases.value[0]
  return first && Number.isFinite(releaseDate(first)) ? first.digest : ''
})
const runnerReleasesByDigest = computed(() => new Map(releases.value.filter(row => row.kind === 'runner').map(row => [row.digest, row])))
const detailRunner = computed(() => {
  const item = detail.value
  return props.section === 'runners' && item && 'runnerId' in item
    ? runners.value.find(row => row.runnerId === item.runnerId) || item as RunnerInstance : null
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (props.section === 'runners') {
      const [runnerRows, releaseRows] = await Promise.all([runnerManagementApi.instances(), runnerManagementApi.releases()])
      runners.value = runnerRows
      releases.value = releaseRows
    }
    if (props.section === 'assignments') {
      const [runnerRows, assignmentRows, codeRows] = await Promise.all([
        runnerManagementApi.instances(), runnerManagementApi.assignments(), runnerManagementApi.siteCodeCatalog(),
      ])
      runners.value = runnerRows
      assignments.value = assignmentRows
      nodeCodes.value = codeRows
    }
    if (props.section === 'releases') releases.value = await runnerManagementApi.releases()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false; loaded = true
  }
}
onActivated(() => { if (loaded && !loading.value && !assignmentOpen.value) void load() })
onMounted(() => {
  void load()
  if (props.section === 'runners') {
    statusTimer = setInterval(async () => {
      if (document.hidden || loading.value) return
      try {
        runners.value = await runnerManagementApi.instances()
        error.value = ''
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    }, 5_000)
  }
})
onUnmounted(() => { if (statusTimer) clearInterval(statusTimer) })

function showDetail(row: RunnerInstance | QueueAssignment | ArtifactRelease) {
  detail.value = row
  detailOpen.value = true
}
function openInstanceDetails(id: string) {
  const row = runners.value.find(item => item.runnerId === id)
  if (row) showDetail(row)
}
function editInstanceVersion(id: string) {
  const row = runners.value.find(item => item.runnerId === id)
  if (row && canWrite.value && !saving.value && !props.selectionDisabled) openUpgrade(row)
}
defineExpose({ openInstanceDetails, editInstanceVersion })

async function createEnrollment() {
  saving.value = true
  try {
    enrollment.value = await runnerManagementApi.enrollmentCode()
    enrollmentOpen.value = true
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally {
    saving.value = false
  }
}

function openAssignment() {
  Object.assign(form, { runnerId: '', scriptDigest: '', concurrency: 1, environment: 'test' })
  formError.value = ''
  assignmentOpen.value = true
}

async function saveAssignment() {
  if (!form.runnerId || !selectedNodeCode.value) {
    formError.value = '请选择运行代码和运行机器'
    return
  }
  saving.value = true
  formError.value = ''
  try {
    await runnerManagementApi.createAssignment({
      runnerId: form.runnerId,
      scriptDigest: form.scriptDigest,
      concurrency: form.concurrency,
      environment: form.environment,
    })
    assignmentOpen.value = false
    ElMessage.success('队列运行配置已保存')
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function removeAssignment(row: QueueAssignment) {
  try {
    await ElMessageBox.confirm(`取消 ${row.queue} 对实例 ${row.runnerId} 的分配？`, '取消队列执行', { type: 'warning' })
    await runnerManagementApi.removeAssignment(row.assignmentId)
    ElMessage.success('已移除队列')
    await load()
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(e instanceof Error ? e.message : String(e))
  }
}

async function publishRunner() {
  saving.value = true
  try {
    const result = await runnerManagementApi.publishRunner()
    ElMessage.success(result.created ? 'Runner 新版本已发布' : 'Runner 源码未变化，已复用现有版本')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally { saving.value = false }
}

async function openPackage() {
  packageOpen.value = true; packageLoading.value = true; packageError.value = ''; packageInfo.value = null
  try {
    const info = await runnerManagementApi.runnerPackageInfo()
    packageInfo.value = info
    packageForm.server = info.server; packageForm.digest = info.releases[0]?.digest || ''
  } catch (e) { packageError.value = e instanceof Error ? e.message : String(e) }
  finally { packageLoading.value = false }
}
async function downloadPackage() {
  if (packageDownloading.value || !packageForm.digest || !packageForm.server || !packageInfo.value?.ready) return
  packageDownloading.value = true; packageError.value = ''
  try {
    const result = await runnerManagementApi.downloadRunnerPackage({ ...packageForm })
    const url = URL.createObjectURL(result.blob)
    try {
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.name; anchor.click()
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
    packageOpen.value = false
    ElMessage.success('Runner 包已下载，解压后双击启动Runner.cmd')
  } catch (e) { packageError.value = e instanceof Error ? e.message : String(e) }
  finally { packageDownloading.value = false }
}

function openUpgrade(row: RunnerInstance) {
  upgradeRunner.value = row
  targetRunnerDigest.value = row.desiredDigest || ''
  upgradeOpen.value = true
}

async function saveUpgrade() {
  if (!canWrite.value || saving.value || !upgradeRunner.value || !targetRunnerDigest.value) return
  saving.value = true
  try {
    await runnerManagementApi.setDesiredRunner(upgradeRunner.value.runnerId, targetRunnerDigest.value)
    upgradeOpen.value = false
    ElMessage.success('Runner 目标版本已下发，等待该实例自动升级')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally { saving.value = false }
}

function selectRunner(id: string, checked: boolean) {
  selectedRunnerIds.value = checked ? [...new Set([...selectedRunnerIds.value, id])] : selectedRunnerIds.value.filter(value => value !== id)
}
function selectVisibleRunners(checked: boolean) {
  selectedRunnerIds.value = checked ? filteredRunners.value.map(row => row.runnerId) : []
}
async function upgradeSelectedRunners() {
  if (!canWrite.value || saving.value || !selectedRunners.value.length || !latestRunnerDigest.value) return
  const targets = selectedRunners.value.slice()
  const digest = latestRunnerDigest.value
  batchUpgradeDigest.value = digest
  batchUpgradeResults.value = targets.map(runner => ({ runner, state: 'pending', message: '' }))
  batchUpgradeOpen.value = true
  saving.value = true
  try {
    const outcomes = await Promise.allSettled(targets.map(row => runnerManagementApi.setDesiredRunner(row.runnerId, digest)))
    batchUpgradeResults.value = outcomes.map((result, index) => ({
      runner: targets[index]!, state: result.status === 'fulfilled' ? 'sent' : 'failed',
      message: result.status === 'rejected' ? (result.reason instanceof Error ? result.reason.message : String(result.reason)) : '',
    }))
    selectedRunnerIds.value = batchUpgradeResults.value.filter(row => row.state === 'failed').map(row => row.runner.runnerId)
    await load()
  } finally { saving.value = false }
}
function batchUpgradeStatus(result: BatchUpgradeResult) {
  if (result.state === 'pending') return '正在下发'
  if (result.state === 'failed') return '下发失败'
  const runner = runners.value.find(row => row.runnerId === result.runner.runnerId)
  if (runner?.actualDigest === batchUpgradeDigest.value) return '已升级'
  return runner?.status === 'offline' ? '已下发 · 等待上线' : '已下发 · 等待升级'
}

function runnerLabel(runnerId: string) {
  const runner = runners.value.find((row) => row.runnerId === runnerId)
  return runner ? `${runner.ipAddress} · ${runner.installDirectory}` : runnerId
}

function runnerStatus(status: RunnerInstance['status']) {
  return ({ online: '在线', offline: '离线', upgrading: '升级中', error: '异常' })[status]
}

function runnerVersion(digest: string | null) {
  if (!digest) return '未上报'
  if (digest === 'source-local') return '本地源码（source-local）'
  return digest.startsWith('sha256:') ? digest.slice(7, 19) : digest
}

function operatingSystem(row: RunnerInstance) {
  return row.osType || ({ win32: 'Windows', windows: 'Windows', linux: 'Linux', darwin: 'macOS' } as Record<string, string>)[row.platform] || row.platform || '未上报'
}

function releaseDate(row: ArtifactRelease) {
  const time = row.publishedAt ? Date.parse(row.publishedAt) : NaN
  return Number.isNaN(time) ? -Infinity : time
}
function compareReleaseDate(a: ArtifactRelease, b: ArtifactRelease) {
  return releaseDate(b) - releaseDate(a) || a.digest.localeCompare(b.digest)
}
function releaseTime(digest?: string | null) {
  return formatRunnerDateTime(digest ? runnerReleasesByDigest.value.get(digest)?.publishedAt : null)
}
function releaseLabel(row: ArtifactRelease) {
  return `${formatRunnerDateTime(row.publishedAt)} · ${runnerVersion(row.digest)} · ${row.name}${row.digest === latestRunnerDigest.value ? ' · 最新发布' : ''}`
}

function detailFieldLabel(key: string) {
  if (key === 'publishedAt') return '发布时间（北京时间）'
  if (props.section !== 'runners') return key
  return ({ runnerId: '实例 ID', name: '实例名称', ipAddress: '机器 IP', platform: '运行平台', capabilities: '支持能力', status: '状态', assignmentCount: '队列数量', lastError: '最近异常', actualDigest: '当前 Runner 版本', desiredDigest: '目标 Runner 版本', workerDigests: '队列处理程序摘要', runnerPid: 'Runner 进程 ID', launcherVersion: '通用启动器版本', lastHeartbeat: '最近心跳（北京时间）', osType: '操作系统类型', osVersion: '操作系统版本', installDirectory: '实例目录' } as Record<string, string>)[key] || key
}

function detailValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.length ? value.map(item => typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)).join('、') : '—'
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
}

function detailEntries() {
  if (!detail.value) return []
  return Object.entries(detailRunner.value || detail.value).filter(([key]) => !/credential|secret|token|password/i.test(key) && key !== 'workerProcesses')
    .map(([key, value]) => [key, key === 'lastHeartbeat' ? formatRunnerHeartbeat(value) : key === 'publishedAt' ? formatRunnerDateTime(value) : key === 'status' && props.section === 'runners' ? runnerStatus(value as RunnerInstance['status']) || value : value])
}
</script>

<template>
  <div class="rc-card rm-main" :class="{ 'is-compact': compact }" :data-testid="`settings-${section}`">
    <div v-if="compact" class="rm-sidebar-tools">
      <header><strong>服务器实例</strong><span>{{ filteredRunners.length }} / {{ runners.length }}</span><el-button :icon="Refresh" circle size="small" :loading="loading" aria-label="刷新服务器" @click="load" />
        <el-dropdown v-if="canWrite" trigger="click"><el-button size="small">管理<el-icon><ArrowDown /></el-icon></el-button><template #dropdown><el-dropdown-menu>
          <el-dropdown-item @click="openPackage">下载 Runner 包</el-dropdown-item>
          <el-dropdown-item v-if="canWrite" :disabled="saving" @click="createEnrollment">远程接入码</el-dropdown-item>
          <el-dropdown-item v-if="canWrite" :disabled="saving || selectionDisabled || loading || !!error || !selectedRunners.length || !latestRunnerDigest" @click="upgradeSelectedRunners">一键升级{{ selectedRunners.length ? `（${selectedRunners.length}）` : '' }}</el-dropdown-item>
          <el-dropdown-item v-if="batchUpgradeResults.length" @click="batchUpgradeOpen = true">升级结果</el-dropdown-item>
        </el-dropdown-menu></template></el-dropdown>
      </header>
      <el-input v-model="keyword" clearable size="small" :disabled="saving || selectionDisabled" placeholder="筛选机器：IP、目录、名称或实例 ID" aria-label="搜索服务器" />
      <div class="rm-sidebar-filters"><el-select v-model="runnerIp" filterable clearable size="small" placeholder="全部 IP" aria-label="服务器 IP" :disabled="saving || selectionDisabled" data-testid="runner-ip-filter"><el-option v-for="ip in runnerIps" :key="ip" :value="ip" :label="ip" /></el-select><el-select v-model="runnerState" clearable size="small" placeholder="全部状态" aria-label="服务器状态" :disabled="saving || selectionDisabled" data-testid="runner-status-filter"><el-option v-for="state in (['online','offline','upgrading','error'] as const)" :key="state" :value="state" :label="runnerStatus(state)" /></el-select></div>
      <el-checkbox v-if="canWrite" :model-value="allVisibleSelected" :indeterminate="someVisibleSelected && !allVisibleSelected" :disabled="loading || saving || selectionDisabled || !filteredRunners.length" @change="selectVisibleRunners(Boolean($event))">勾选当前筛选实例用于升级</el-checkbox>
    </div>
    <div v-else class="rc-toolbar wrap">
      <el-input v-model="keyword" clearable :disabled="section === 'runners' && saving" :placeholder="section === 'runners' ? 'IP、目录、实例名' : section === 'assignments' ? '队列、配置 ID、代码文件或机器' : '名称、摘要、Git 提交'" style="width: 260px" />
      <template v-if="section === 'runners'">
        <el-select v-model="runnerIp" filterable clearable placeholder="全部 IP" aria-label="服务器 IP" :disabled="saving" class="rm-ip-filter" data-testid="runner-ip-filter"><el-option v-for="ip in runnerIps" :key="ip" :label="ip" :value="ip" /></el-select>
        <el-select v-model="runnerState" clearable placeholder="全部状态" aria-label="服务器状态" :disabled="saving" class="rm-status-filter" data-testid="runner-status-filter"><el-option v-for="state in (['online', 'offline', 'upgrading', 'error'] as const)" :key="state" :label="runnerStatus(state)" :value="state" /></el-select>
      </template>
      <button class="rc-btn" type="button" :disabled="loading" @click="load">刷新</button>
      <el-button v-if="section === 'runners' && canWrite" type="primary" :loading="saving" :disabled="loading || !!error || !selectedRunners.length || !latestRunnerDigest" :title="`将勾选实例升级到最新 Runner ${runnerVersion(latestRunnerDigest)}，自动重启 Runner 主进程`" data-testid="runner-batch-upgrade" @click="upgradeSelectedRunners">一键升级{{ selectedRunners.length ? `（${selectedRunners.length}）` : '' }}</el-button>
      <el-button v-if="section === 'runners' && batchUpgradeResults.length" link @click="batchUpgradeOpen = true">升级结果</el-button>
      <span class="rm-spacer" />
      <span v-if="section === 'runners'" class="rm-note">每个 Runner 对应一个实例目录，同一台机器可以部署多个</span>
      <el-button v-if="section === 'runners' && canWrite" type="primary" @click="openPackage">下载 Runner 包</el-button>
      <button v-if="canWrite && section === 'runners'" class="rc-btn primary" type="button" :disabled="saving" @click="createEnrollment">远程接入码</button>
      <button v-if="canWrite && section === 'assignments'" class="rc-btn primary" type="button" :disabled="loading || !!error || assignmentOpen" data-testid="assignment-create" @click="openAssignment">新增队列</button>
      <span v-if="section === 'releases'" class="rm-code-note">生成 Runner 版本后，到服务器中设置目标版本并升级</span>
      <template v-if="canWrite && section === 'releases'">
        <el-button :disabled="saving" @click="openPackage">下载 Runner 包</el-button>
        <button class="rc-btn primary" type="button" :disabled="saving" @click="publishRunner">生成 Runner 版本</button>
      </template>
    </div>
    <div v-if="error" class="rm-error" role="alert">{{ sectionTitle }}加载失败：{{ error }}。请确认 Runner 管理服务已部署。</div>
    <div v-loading="loading" class="rc-table-scroll rm-table">
      <div v-if="compact" class="rm-server-list">
        <article v-for="row in filteredRunners" :key="row.runnerId" class="rm-server-card" :class="{ selected: row.runnerId === selectedRunnerId }">
          <el-checkbox v-if="canWrite" class="rm-card-checkbox" :model-value="selectedRunnerIds.includes(row.runnerId)" :disabled="saving || loading || selectionDisabled" :aria-label="`勾选升级实例 ${row.runnerId}`" @change="selectRunner(row.runnerId, Boolean($event))" />
          <button class="rm-server-select" :class="{ 'has-checkbox': canWrite }" :disabled="selectionDisabled || saving || !selectable" :aria-pressed="row.runnerId === selectedRunnerId" :data-testid="`runner-card-${row.runnerId}`" @click="emit('selectRunner', row.runnerId)">
            <span class="rm-card-heading"><strong>{{ row.ipAddress }}</strong><span class="rm-card-state" :class="`is-${row.status}`">{{ runnerStatus(row.status) }}</span></span>
            <span class="rm-card-name">{{ row.name || '未命名实例' }}</span><span class="rm-card-directory" :title="row.installDirectory">{{ row.installDirectory }}</span>
          </button>
        </article>
        <p v-if="!loading && !filteredRunners.length" class="rm-sidebar-empty">{{ error ? '服务不可用' : '暂无符合筛选条件的服务器实例' }}</p>
      </div>
      <table v-else-if="section === 'runners'" class="rc-data-table rm-runner-table">
        <colgroup><col v-if="canWrite" style="width:38px"><col style="width:9%"><col style="width:11%"><col style="width:8%"><col style="width:14%"><col style="width:11%"><col style="width:5%"><col style="width:5%"><col style="width:14%"><col style="width:12%"><col style="width:11%"></colgroup>
        <thead><tr><th v-if="canWrite" class="rm-selection"><el-checkbox :model-value="allVisibleSelected" :indeterminate="someVisibleSelected && !allVisibleSelected" :disabled="loading || saving || !filteredRunners.length" aria-label="选择当前筛选的全部实例" data-testid="runner-select-all" @change="selectVisibleRunners(Boolean($event))" /></th><th>机器 IP</th><th>实例目录</th><th>实例名称</th><th>实例 ID</th><th>操作系统</th><th>状态</th><th>队列数</th><th>Runner 版本</th><th title="北京时间（UTC+8）">最近心跳</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filteredRunners" :key="row.runnerId">
            <td v-if="canWrite" class="rm-selection"><el-checkbox :model-value="selectedRunnerIds.includes(row.runnerId)" :disabled="saving || loading" :aria-label="`选择实例 ${row.ipAddress} ${row.installDirectory}`" :data-testid="`runner-select-${row.runnerId}`" @change="selectRunner(row.runnerId, Boolean($event))" /></td>
            <td><el-button v-if="selectable" link type="primary" :data-testid="`runner-view-config-${row.runnerId}`" @click="emit('selectRunner', row.runnerId)">查看配置</el-button><span v-else>{{ row.ipAddress }}</span><small v-if="selectable" class="rm-process-note">{{ row.ipAddress }}</small></td><td class="rm-path" :title="row.installDirectory">{{ row.installDirectory }}</td>
            <td :title="row.name"><span v-if="row.name">{{ row.name }}</span><small class="rm-process-note" :title="`最近心跳上报的 Runner 主进程：${formatRunnerHeartbeat(row.lastHeartbeat)}（北京时间）`" data-testid="runner-pid">PID：{{ row.runnerPid || '未上报' }}</small></td>
            <td :title="row.runnerId"><span class="rm-instance-id" aria-label="Runner 实例 ID" data-testid="runner-instance-id">{{ row.runnerId }}</span></td>
            <td class="rm-os" data-testid="runner-os" :title="`${operatingSystem(row)} · ${row.osVersion || '版本未上报，请升级 Runner'}`"><span>{{ operatingSystem(row) }}</span><small>{{ row.osVersion || '版本未上报' }}</small></td><td>{{ runnerStatus(row.status) }}</td><td>{{ row.assignmentCount }}<small v-if="row.workerProcesses != null" class="rm-process-note" :title="row.workerProcesses.map(item => `${item.queue} · 并发 ${item.slot + 1} · PID ${item.pid}`).join('\n')">{{ row.workerProcesses.length }} 个进程</small></td>
            <td class="rm-runner-version" data-testid="runner-version"><span :title="`Runner 心跳上报版本：${row.actualDigest || '未上报'}\n发布时间：${releaseTime(row.actualDigest)}（北京时间）`">当前：{{ runnerVersion(row.actualDigest) }}{{ row.actualDigest && row.actualDigest === latestRunnerDigest ? '（最新）' : '' }}</span><small v-if="row.actualDigest && runnerReleasesByDigest.has(row.actualDigest)" :title="'发布时间（北京时间）'">{{ releaseTime(row.actualDigest) }}</small><small :title="`Runner 升级目标版本：${row.desiredDigest || '未设置'}\n发布时间：${releaseTime(row.desiredDigest)}（北京时间）`">目标：{{ row.desiredDigest ? runnerVersion(row.desiredDigest) : '未设置' }}</small></td>
            <td :title="`${formatRunnerHeartbeat(row.lastHeartbeat)}（北京时间）`" data-testid="runner-heartbeat">{{ formatRunnerHeartbeat(row.lastHeartbeat) }}</td><td><div class="rm-runner-actions"><el-button link type="primary" @click="showDetail(row)">详情</el-button><el-button v-if="canWrite" link type="primary" @click="openUpgrade(row)">设置 Runner 版本</el-button></div></td>
          </tr>
          <tr v-if="!loading && !filteredRunners.length"><td :colspan="canWrite ? 11 : 10">{{ error ? '服务不可用' : runnerIp || runnerState || keyword.trim() ? '暂无符合筛选条件的服务器实例' : '暂无服务器实例' }}</td></tr>
        </tbody>
      </table>
      <table v-else-if="section === 'assignments'" class="rc-data-table">
        <thead><tr><th>运行代码</th><th>队列</th><th>运行环境</th><th>运行机器（IP · 目录）</th><th>并发</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="assignmentOpen" class="rm-assignment-draft" data-testid="assignment-new-row">
            <td><el-select v-model="form.scriptDigest" filterable :disabled="saving" class="rm-node-select" data-testid="assignment-node-code" placeholder="选择运行代码"><el-option v-for="row in availableRunCodes" :key="row.codeId" :value="row.scriptDigest" :label="`${row.queueName} · #${row.configId} · ${row.siteHost || '队列通用'}`" /></el-select><small v-if="selectedNodeCode" class="rm-code-note" :title="selectedNodeCode.deliveryPath">{{ selectedNodeCode.deliveryPath }} · Git {{ selectedNodeCode.gitCommit.slice(0, 10) }}</small></td>
            <td data-testid="assignment-selected-queue">{{ selectedNodeCode?.queueName || '—' }}</td>
            <td><el-select v-model="form.environment" :disabled="saving" class="rm-env-select" data-testid="assignment-environment"><el-option label="测试" value="test" /><el-option label="生产" value="production" /></el-select></td>
            <td><el-select v-model="form.runnerId" filterable :disabled="saving" class="rm-runner-select" data-testid="assignment-runner" placeholder="选择运行机器"><el-option v-for="row in runners" :key="row.runnerId" :label="runnerLabel(row.runnerId)" :value="row.runnerId" /></el-select></td>
            <td><el-input-number v-model="form.concurrency" :disabled="saving" :min="1" :max="100" controls-position="right" size="small" class="rm-concurrency" data-testid="assignment-concurrency" /></td>
            <td>待保存</td><td><el-button link type="primary" :loading="saving" data-testid="assignment-save" @click="saveAssignment">保存</el-button><el-button link :disabled="saving" data-testid="assignment-cancel" @click="assignmentOpen = false">取消</el-button></td>
          </tr>
          <tr v-if="assignmentOpen && (formError || !nodeCodes.length || competingAssignments.length)" class="rm-assignment-note"><td colspan="7"><span v-if="formError" class="rm-form-error" role="alert">{{ formError }}</span><span v-else-if="!nodeCodes.length">暂无运行代码，请先在流程节点中生成或关联仓库代码。</span><span v-else>该队列在此环境已有 {{ competingAssignments.length }} 个其他实例共同消费。</span></td></tr>
          <tr v-for="row in filteredAssignments" :key="row.assignmentId">
            <td class="rm-node-code" :title="row.scriptDigest"><span v-if="row.configId">#{{ row.configId }} · {{ row.deliveryPath || '未发布运行代码' }}</span><span v-else>旧分配 · {{ row.processorType }}</span><small v-if="row.directoryTemplate" class="rm-code-note" :title="row.directoryTemplate">{{ row.directoryTemplate }} · version.json</small><small v-if="row.gitCommit" class="rm-code-note">{{ row.repoName || '—' }} · Git {{ row.gitCommit.slice(0, 10) }}</small></td>
            <td>{{ row.queue }}</td><td>{{ row.environment === 'test' ? '测试' : '生产' }}</td>
            <td class="rm-path" :title="runnerLabel(row.runnerId)">{{ runnerLabel(row.runnerId) }}</td>
            <td>{{ row.concurrency }}</td><td>{{ row.enabled ? '启用' : '停用' }}</td>
            <td><el-button link type="primary" @click="showDetail(row)">详情</el-button><el-button v-if="canWrite && row.configId" link type="primary" @click="emit('manageVersions', row.configId)">运行版本</el-button><el-button v-if="canWrite" link type="danger" @click="removeAssignment(row)">移除队列</el-button></td>
          </tr>
          <tr v-if="!loading && !filteredAssignments.length && !assignmentOpen"><td colspan="7">{{ error ? '服务不可用' : '暂无队列运行配置' }}</td></tr>
        </tbody>
      </table>
      <table v-else class="rc-data-table">
        <thead><tr><th>Runner 名称</th><th>平台</th><th>版本标识</th><th title="北京时间（UTC+8），最新发布时间排在最前">发布时间</th><th>Git 提交</th><th>状态</th><th title="按最近心跳上报的 Runner 版本统计，包括离线实例">安装实例</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filteredReleases" :key="row.digest">
            <td>{{ row.name }}</td><td>{{ row.platform }}</td>
            <td :title="row.digest"><div class="rm-release-version">{{ runnerVersion(row.digest) }}<el-tag v-if="row.digest === latestRunnerDigest" size="small" type="success">最新发布</el-tag></div></td><td data-testid="runner-published-at" :title="'发布时间（北京时间）'">{{ formatRunnerDateTime(row.publishedAt) }}</td><td :title="row.gitCommit">{{ row.gitCommit.slice(0, 12) }}</td>
            <td>{{ row.status }}</td><td>{{ row.usedBy }}</td><td><el-button link type="primary" @click="showDetail(row)">详情</el-button></td>
          </tr>
          <tr v-if="!loading && !filteredReleases.length"><td colspan="8">{{ error ? '服务不可用' : '暂无 Runner 版本' }}</td></tr>
        </tbody>
      </table>
    </div>
    <el-drawer v-model="detailOpen" :title="`${sectionTitle}详情`" size="min(760px, 94vw)" append-to-body direction="rtl" class="rm-instance-drawer">
      <dl class="rm-detail" data-testid="runner-instance-detail"><template v-for="[key, value] in detailEntries()" :key="key"><dt>{{ detailFieldLabel(String(key)) }}</dt><dd>{{ detailValue(value) }}</dd></template></dl>
      <section v-if="detailRunner" class="rm-process-detail" data-testid="runner-process-detail">
        <h3>任务进程</h3><p>以下进程来自最近一次心跳上报：{{ formatRunnerHeartbeat(detailRunner.lastHeartbeat) }}（北京时间）{{ detailRunner.status === 'offline' ? '（机器已离线）' : '' }}</p>
        <el-table v-if="detailRunner.workerProcesses?.length" :data="detailRunner.workerProcesses" size="small">
          <el-table-column prop="entry" label="启动文件" min-width="180" show-overflow-tooltip />
          <el-table-column prop="queue" label="任务队列" min-width="160" show-overflow-tooltip />
          <el-table-column label="并发序号" width="90"><template #default="{ row }">{{ row.slot + 1 }}</template></el-table-column>
          <el-table-column prop="pid" label="进程 ID" width="100" />
        </el-table>
        <p v-else>{{ detailRunner.workerProcesses == null ? '尚未上报任务进程，请更新 Runner 后查看。' : '最近心跳未上报存活的任务进程。' }}</p>
      </section>
    </el-drawer>
    <el-dialog v-model="enrollmentOpen" title="远程机器接入码" width="min(480px, 94vw)" append-to-body @closed="enrollment = null">
      <p>远程 Runner 首次接入时使用此登记码；本机开发环境无需填写。关闭窗口后不再显示。</p>
      <p class="rm-code">{{ enrollment?.code }}</p><p>有效期至：{{ enrollment?.expiresAt }}</p>
    </el-dialog>
    <el-dialog v-model="packageOpen" title="下载 Runner 包" width="min(580px, 94vw)" append-to-body :close-on-click-modal="!packageDownloading" :show-close="!packageDownloading">
      <div v-loading="packageLoading">
        <p class="rm-package-description">Windows 64 位便携包，内置 Python 和 Runner 必需依赖。解压到独立目录后，双击“启动Runner.cmd”即可接入。</p>
        <el-alert v-if="packageError" :title="packageError" type="error" :closable="false" />
        <el-alert v-if="packageInfo && !packageInfo.ready" title="服务器尚未准备 Windows 便携运行环境" type="warning" :closable="false" />
        <el-form label-position="top">
          <el-form-item label="管理服务地址"><el-input v-model="packageForm.server" :disabled="packageLoading || packageDownloading" aria-label="Runner 包管理服务地址" placeholder="http://目标机器能访问的地址:8092" /></el-form-item>
          <el-form-item label="Runner 版本"><el-select v-model="packageForm.digest" :disabled="packageLoading || packageDownloading" filterable style="width:100%" aria-label="Runner 包版本"><el-option v-for="row in packageInfo?.releases || []" :key="row.digest" :label="releaseLabel(row)" :value="row.digest" /></el-select></el-form-item>
        </el-form>
        <p v-if="packageInfo" class="rm-package-description">Python {{ packageInfo.pythonVersion }} · 同一包可复制到多个目录，分别启动为独立实例，无需修改端口。包内接入凭据有效期 {{ packageInfo.enrollmentMinutes }} 分钟，已登记实例重启不受影响。</p>
        <p v-if="packageInfo && !packageInfo.releases.length" class="rm-form-error">暂无可下载版本，请先在 Runner 版本中生成版本。</p>
      </div>
      <template #footer><el-button :disabled="packageDownloading" @click="packageOpen = false">取消</el-button><el-button type="primary" :loading="packageDownloading" :disabled="packageLoading || !packageInfo?.ready || !packageForm.server || !packageForm.digest" @click="downloadPackage">下载 ZIP 包</el-button></template>
    </el-dialog>
    <el-dialog v-model="batchUpgradeOpen" title="批量升级结果" width="min(860px, 94vw)" append-to-body :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <p class="rm-upgrade-current">目标版本：{{ runnerVersion(batchUpgradeDigest) }} · {{ releaseTime(batchUpgradeDigest) }}（北京时间）</p>
      <p class="rm-upgrade-current">已下发 {{ batchUpgradeResults.filter(row => row.state === 'sent').length }} / {{ batchUpgradeResults.length }} 个实例。实际升级结果随心跳更新，失败实例保留勾选，可重试下发。</p>
      <table class="rc-data-table rm-batch-results" data-testid="runner-batch-results"><thead><tr><th>机器实例</th><th>状态</th><th>信息</th></tr></thead><tbody>
        <tr v-for="result in batchUpgradeResults" :key="result.runner.runnerId"><td>{{ result.runner.ipAddress }}<small>{{ result.runner.installDirectory }}</small><small>{{ result.runner.runnerId }}</small></td><td>{{ batchUpgradeStatus(result) }}</td><td class="rm-batch-message" :class="{ 'rm-form-error': result.state === 'failed' }">{{ result.message || (result.state === 'sent' ? '目标版本已下发' : '正在请求管理服务') }}</td></tr>
      </tbody></table>
      <template #footer><el-button :disabled="saving" @click="batchUpgradeOpen = false">关闭</el-button></template>
    </el-dialog>
    <el-dialog v-model="upgradeOpen" title="选择 Runner 升级版本" width="min(520px, 94vw)" append-to-body>
      <p>{{ upgradeRunner?.ipAddress }} · {{ upgradeRunner?.installDirectory }}</p>
      <p class="rm-upgrade-current">当前 Runner 版本：{{ runnerVersion(upgradeRunner?.actualDigest || null) }}</p>
      <p v-if="upgradeRunner?.actualDigest && runnerReleasesByDigest.has(upgradeRunner.actualDigest)" class="rm-upgrade-current">发布时间：{{ releaseTime(upgradeRunner.actualDigest) }}（北京时间）</p>
      <el-select v-model="targetRunnerDigest" filterable style="width: 100%" placeholder="选择已发布 Runner 版本" aria-label="选择 Runner 版本" data-testid="runner-upgrade-version">
        <el-option v-for="row in publishedRunnerReleases" :key="row.digest" :label="releaseLabel(row)" :value="row.digest" />
      </el-select>
      <template #footer><el-button @click="upgradeOpen = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!targetRunnerDigest" @click="saveUpgrade">应用升级</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.is-compact { overflow: hidden; }
.rm-sidebar-tools { padding: 12px; display: flex; flex-direction: column; gap: 10px; border-bottom: 1px solid var(--el-border-color-lighter); }
.rm-sidebar-tools header { display: flex; align-items: center; gap: 8px; font-size: 13px; }.rm-sidebar-tools header > span { margin-right: auto; color: var(--rc-muted); font-size: 11px; }
.rm-sidebar-filters { display: grid; grid-template-columns: 1.15fr 1fr; gap: 8px; min-width: 0; }.rm-sidebar-filters .el-select { min-width: 0; }
.rm-sidebar-tools :deep(.el-checkbox__label) { font-size: 11px; }
.is-compact .rm-table { overflow-x: hidden; }.rm-server-list { padding: 8px; display: grid; gap: 8px; }
.rm-server-card { position: relative; border: 1px solid var(--el-border-color-light); border-radius: 8px; background: var(--el-bg-color); overflow: hidden; }.rm-server-card.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.rm-card-checkbox { position: absolute; top: 8px; left: 10px; z-index: 1; }
.rm-server-select { width: 100%; display: flex; flex-direction: column; gap: 5px; padding: 12px; border: 0; background: transparent; text-align: left; cursor: pointer; color: var(--rc-text); }.rm-server-select.has-checkbox { padding-left: 36px; }.rm-server-select:disabled { cursor: default; }.rm-server-select:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.rm-card-heading { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px; }.rm-card-heading strong { font-size: 13px; }.rm-card-state { font-size: 11px; color: var(--el-text-color-secondary); }.rm-card-state.is-online { color: var(--el-color-success); }.rm-card-state.is-error { color: var(--el-color-danger); }.rm-card-state.is-upgrading { color: var(--el-color-primary); }
.rm-card-name { font-size: 12px; }.rm-card-directory { font-size: 12px; width: 100%; overflow-wrap: anywhere; }.rm-card-meta { width: 100%; color: var(--rc-muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rm-server-card footer { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 0 12px 10px; }.rm-server-card footer .el-button { margin-left: 0; font-size: 11px; }.rm-sidebar-empty { padding: 16px 8px; text-align: center; color: var(--rc-muted); font-size: 12px; }
.rm-ip-filter { width: 180px; }
.rm-status-filter { width: 130px; }
.rm-main { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.rm-selection { text-align:center; padding:0 8px !important; }.rm-selection :deep(.el-checkbox) { margin:0; }
.rm-batch-results { width:100%; }.rm-batch-results td { vertical-align:top; }.rm-batch-results small { display:block; margin-top:4px; color:var(--rc-muted); font-size:11px; overflow-wrap:anywhere; }.rm-batch-message { max-width:240px; overflow-wrap:anywhere; }
.rm-release-version { display:flex; align-items:center; gap:8px; }
.rm-package-description { color:var(--rc-muted); font-size:12px; line-height:1.7; }
.rm-spacer { flex: 1; }
.rm-table { flex: 1; min-height: 0; overflow: auto; }
.rm-table td { white-space: nowrap; }
.rm-path { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.rm-runner-version { min-width: 175px; }.rm-runner-version span, .rm-runner-version small { display: block; }.rm-runner-version small { margin-top: 5px; color: var(--rc-muted); font-size: 11px; }.rm-upgrade-current { color: var(--rc-muted); font-size: 12px; }
.rm-process-note { display:block; margin-top:5px; font-size:11px; color:var(--rc-muted); }.rm-process-detail { margin-top:24px; border-top:1px solid var(--el-border-color-lighter); padding-top:12px; }.rm-process-detail h3 { font-size:14px; }.rm-process-detail p { color:var(--rc-muted); font-size:12px; line-height:1.6; }
.rm-instance-id { display:block; font:12px/1.5 ui-monospace,monospace; white-space:normal; overflow-wrap:anywhere; user-select:all; }
.rm-os span,.rm-os small { display:block; white-space:normal; overflow-wrap:anywhere; }.rm-os small { margin-top:5px; font-size:11px; color:var(--rc-muted); }
.rm-runner-table th,.rm-runner-table td { padding-left:8px; padding-right:8px; }.rm-runner-version span { white-space:normal; overflow-wrap:anywhere; }
.rm-runner-table { table-layout:fixed; min-width:1000px; }.rm-runner-table td { overflow:hidden; text-overflow:ellipsis; }.rm-runner-actions { display:flex; flex-direction:column; align-items:flex-start; gap:5px; }.rm-runner-actions .el-button { margin:0; font-size:12px; }
.rm-assignment-draft { background: var(--rc-primary-bg); }.rm-node-select { width: 290px; }.rm-runner-select { width: 220px; }.rm-env-select { width: 90px; }.rm-concurrency { width: 80px; }
.rm-node-code { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }.rm-code-note { display: block; margin-top: 4px; color: var(--rc-muted); font-size: 11px; }
.rm-assignment-note td { white-space: normal; font-size: 12px; color: var(--rc-muted); }.rm-form-error { color: var(--rc-error); }
.rm-error { margin: 0 12px 8px; padding: 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; }
.rm-detail { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 12px 16px; font-size: 13px; line-height: 1.6; }
.rm-detail dt { color: var(--rc-muted); }
.rm-detail dd { min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.rm-process-detail { min-width: 0; }.rm-process-detail p { overflow-wrap: anywhere; }
@media (max-width: 540px) { .rm-detail { grid-template-columns: 105px minmax(0, 1fr); gap: 10px; } }
.rm-code { padding: 12px; background: #f1f5f9; font: 16px ui-monospace, monospace; overflow-wrap: anywhere; }
.rm-note { color: #b45309; font-size: 12px; }
</style>
