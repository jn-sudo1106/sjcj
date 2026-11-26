<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { prepareDeploymentProcesses } from '@/utils/deploymentProcesses'
import { runnerManagementApi as api, type DeploymentConfiguration, type RuntimeConfiguration,
  type RunnerInstance, type DirectoryDeliveryPreview } from '@/api/runnerManagement'

const route = useRoute()
const emit = defineEmits<{ busy: [value: boolean] }>()
const canWrite = computed(() => useAuthStore().role === 'admin')
const loading = ref(false), busy = ref(false), error = ref(''), progress = ref('')
const rows = ref<RuntimeConfiguration[]>([]), configurations = ref<DeploymentConfiguration[]>([]), machines = ref<RunnerInstance[]>([])
const config = ref(''), environment = ref(''), status = ref('online'), programFilter = ref(''), keyword = ref('')
const selection = ref<string[]>([]), scope = ref<'changes' | 'all'>('changes')
type Outcome = { runtimeId: string; machine: string; directory: string; message: string; failed?: boolean; skipped?: boolean; jobId?: string }
type Plan = { row: RuntimeConfiguration; preview: DirectoryDeliveryPreview; paths: string[] }
const outcomes = ref<Outcome[]>([]), plans = ref<Plan[]>([])
let active = true, loadSequence = 0, pollTimer: ReturnType<typeof setTimeout> | undefined
watch(busy, value => emit('busy', value))
function stopPoll() { clearTimeout(pollTimer); pollTimer = undefined }
onBeforeUnmount(() => { active = false; ++loadSequence; stopPoll(); emit('busy', false) })
const problem = (value: unknown) => value instanceof Error ? value.message : String(value)
const layouts = computed(() => new Map(configurations.value.map(item => [item.deploymentId, item])))
const runners = computed(() => new Map(machines.value.map(item => [item.runnerId, item])))
const deliveryStates: Record<string, string> = { none: '未下发', pending: '等待下发', running: '下发中', success: '已下发', failed: '下发失败' }

function configKey(row: RuntimeConfiguration) {
  const id = layouts.value.get(row.deploymentId)?.configId || row.sourceContext?.configId
  return id ? `config:${id}` : `deployment:${row.deploymentId}`
}
const configOptions = computed(() => {
  const grouped = new Map<string, { key: string; baseLabel: string; total: number; online: number }>()
  for (const row of rows.value) {
    const key = configKey(row), layout = layouts.value.get(row.deploymentId)
    const id = layout?.configId || row.sourceContext?.configId
    const online = runners.value.get(row.runnerId)?.status === 'online' ? 1 : 0
    const existing = grouped.get(key)
    if (existing) { existing.total += 1; existing.online += online; continue }
    const nodePart = layout?.sourceNode?.nodeName || layout?.name || row.name
    const flowPart = layout?.sourceNode?.flowName && layout.sourceNode.flowName !== layout.sourceNode.flowId ? ` · ${layout.sourceNode.flowName}` : ''
    const baseLabel = id ? `配置 ${id} · ${nodePart}${flowPart}` : `${nodePart}${flowPart}`
    grouped.set(key, { key, baseLabel, total: 1, online })
  }
  return [...grouped.values()].map(item => ({
    key: item.key,
    label: `${item.baseLabel}（${item.total} 台 · ${item.online} 在线）`,
  }))
})

function rowEnvironment(row: RuntimeConfiguration) { return row.assignment?.environment || layouts.value.get(row.deploymentId)?.deploymentEnvironment || '' }
function configuredEntry(row: RuntimeConfiguration) { return layouts.value.get(row.deploymentId)?.entryPoint || row.entryPoint || '' }
function inFlight(row: RuntimeConfiguration) { return ['pending', 'running'].includes(row.binding?.delivery?.status || '') }

type ProgramCategory = 'running' | 'stopped' | 'transition' | 'error' | 'unknown'
function programState(row: RuntimeConfiguration): { label: string; type: 'info' | 'success' | 'warning' | 'danger'; detail: string; category: ProgramCategory; waiting?: boolean } {
  const assignment = row.assignment, machine = runners.value.get(row.runnerId)
  if (!assignment) return { label: configuredEntry(row) ? '待启动' : '仅下发目录', type: 'info', detail: '', category: 'stopped' }
  if (!machine || machine.status === 'offline') return { label: '状态未知', type: 'info', detail: `离线 · ${assignment.enabled ? '已请求启动' : '已请求停止'}`, category: 'unknown' }
  if (machine.workerProcesses == null) return { label: '进程未上报', type: 'info', detail: assignment.enabled ? '已请求启动' : '已请求停止', category: 'unknown' }
  const processes = machine.workerProcesses.filter(item => item.assignmentId === assignment.assignmentId)
  const detail = processes.length ? `实例 ${processes.length}/${assignment.concurrency || 1} · PID ${processes.map(item => item.pid).join('、')}` : ''
  if (!assignment.enabled) return { label: processes.length ? '停止中' : '已停止', type: 'info', detail, category: processes.length ? 'transition' : 'stopped', waiting: !!processes.length }
  if (processes.length) {
    const full = processes.length >= (assignment.concurrency || 1)
    return { label: full ? '运行中' : `部分运行 ${processes.length}/${assignment.concurrency || 1}`, type: full ? 'success' : 'warning', detail, category: 'running', waiting: !full }
  }
  if (row.stoppedProcessSlots?.length) return { label: '已手动关闭', type: 'info', detail: '可点击批量启动恢复', category: 'stopped' }
  if (machine.lastError || machine.status === 'error') return { label: 'Runner 异常', type: 'danger', detail: machine.lastError || '请查看日志', category: 'error' }
  return { label: '等待启动', type: 'warning', detail: '等待 Runner 启动并上报进程', category: 'transition', waiting: true }
}

const visibleRows = computed(() => rows.value.filter(row => config.value && configKey(row) === config.value
  && (!environment.value || rowEnvironment(row) === environment.value)
  && (!status.value || runners.value.get(row.runnerId)?.status === status.value)
  && (!programFilter.value || programState(row).category === programFilter.value)
  && [runners.value.get(row.runnerId)?.ipAddress, runners.value.get(row.runnerId)?.name,
    runners.value.get(row.runnerId)?.installDirectory, row.runnerId, row.directoryTemplate]
    .join(' ').toLowerCase().includes(keyword.value.trim().toLowerCase())))
const selectedRows = computed(() => visibleRows.value.filter(row => selection.value.includes(row.runtimeId)))
const allSelected = computed(() => !!visibleRows.value.length && selectedRows.value.length === visibleRows.value.length)
const someSelected = computed(() => !!selectedRows.value.length && !allSelected.value)
const unavailable = computed(() => loading.value || busy.value || !!error.value)
const activePlans = computed(() => plans.value.filter(plan => selection.value.includes(plan.row.runtimeId)))

const outcomeSummary = computed(() => {
  let ok = 0, skipped = 0, failed = 0
  for (const item of outcomes.value) {
    if (item.failed) failed++
    else if (item.skipped) skipped++
    else ok++
  }
  return { total: outcomes.value.length, ok, skipped, failed }
})
const failedVisibleIds = computed(() => visibleRows.value
  .filter(row => outcomeMap.value.get(row.runtimeId)?.failed)
  .map(row => row.runtimeId))
const changedVisibleIds = computed(() => visibleRows.value
  .filter(row => planMap.value.has(row.runtimeId))
  .map(row => row.runtimeId))

function clearPreview() { plans.value = []; outcomes.value = []; progress.value = '' }
watch([config, environment, status, programFilter, keyword], () => { selection.value = []; clearPreview() })
watch(scope, clearPreview)
watch(() => route.query.batchConfig, value => {
  if (typeof value === 'string' && value && configOptions.value.some(item => item.key === value)) config.value = value
})

function selectRow(id: string, checked: boolean) {
  selection.value = checked ? [...selection.value, id] : selection.value.filter(value => value !== id)
}
function selectFailedOnly() {
  selection.value = failedVisibleIds.value.slice()
}
function selectChangedOnly() {
  selection.value = changedVisibleIds.value.slice()
}
function label(row: RuntimeConfiguration) {
  const runner = runners.value.get(row.runnerId)
  return `${runner?.ipAddress || row.runnerId} · ${runner?.installDirectory || '实例目录未上报'}`
}
function outcome(row: RuntimeConfiguration, message: string, failed = false, jobId?: string, skipped = false): Outcome {
  return { runtimeId: row.runtimeId, machine: label(row), directory: row.directoryTemplate, message, failed, skipped, jobId }
}
function setOutcome(value: Outcome) {
  outcomes.value = [...outcomes.value.filter(item => item.runtimeId !== value.runtimeId), value]
}
const outcomeMap = computed(() => new Map(outcomes.value.map(item => [item.runtimeId, item])))
const planMap = computed(() => new Map(plans.value.map(item => [item.row.runtimeId, item])))

async function limited<T>(items: T[], operation: (item: T) => Promise<void>) {
  let index = 0
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (active && index < items.length) await operation(items[index++]!)
  }))
}

function schedulePoll() {
  stopPoll()
  if (!active || loading.value || busy.value || !config.value) return
  const needsPoll = visibleRows.value.some(row => inFlight(row) || programState(row).waiting)
  if (!needsPoll) return
  pollTimer = setTimeout(() => { void refreshQuiet() }, 3000)
}
async function refreshQuiet() {
  if (!active || busy.value || loading.value) return
  const sequence = ++loadSequence
  try {
    const [runtimes, definitions, instances] = await Promise.all([api.runtimeConfigurations(), api.deploymentConfigurations(), api.instances()])
    if (!active || sequence !== loadSequence) return
    rows.value = runtimes; configurations.value = definitions; machines.value = instances
  } catch { /* 后台静默刷新失败不覆盖当前结果 */ }
  finally { schedulePoll() }
}

async function load() {
  if (busy.value) return
  const sequence = ++loadSequence
  stopPoll(); loading.value = true; error.value = ''; selection.value = []; clearPreview()
  try {
    const [runtimes, definitions, instances] = await Promise.all([api.runtimeConfigurations(), api.deploymentConfigurations(), api.instances()])
    if (!active || sequence !== loadSequence) return
    rows.value = runtimes; configurations.value = definitions; machines.value = instances
    const requested = typeof route.query.batchConfig === 'string' ? route.query.batchConfig : ''
    if (requested && !config.value && configOptions.value.some(item => item.key === requested)) config.value = requested
    else if (!configOptions.value.some(item => item.key === config.value)) config.value = ''
  } catch (value) { if (active && sequence === loadSequence) error.value = problem(value) }
  finally { if (active && sequence === loadSequence) { loading.value = false; schedulePoll() } }
}
onMounted(load)

async function control(start: boolean) {
  if (!canWrite.value || unavailable.value || !selectedRows.value.length) return
  const targets = selectedRows.value.slice()
  stopPoll(); busy.value = true; clearPreview()
  try {
    try {
      await ElMessageBox.confirm(`将对勾选的 ${targets.length} 项机器配置${start ? '提交启动指令' : '提交停止指令，停止会中断正在执行的任务'}。是否继续？`,
        start ? '批量启动程序' : '批量停止程序', { type: 'warning', confirmButtonText: start ? '启动程序' : '停止程序', cancelButtonText: '取消' })
    } catch (value) { if (value === 'cancel' || value === 'close') return; throw value }
    if (!active || !canWrite.value) return
    await limited(targets, async row => {
      if (start && runners.value.get(row.runnerId)?.status !== 'online') { setOutcome(outcome(row, '机器未在线，未提交启动', true)); return }
      if (start && inFlight(row)) { setOutcome(outcome(row, '代码正在下发，请完成后再启动', true)); return }
      if (start && row.assignment?.enabled && !row.stoppedProcessSlots?.length) { setOutcome(outcome(row, '已请求运行，无需重复启动', false, undefined, true)); return }
      if (!start && !row.assignment?.enabled) { setOutcome(outcome(row, '未请求运行，无需重复提交停止指令', false, undefined, true)); return }
      try {
        const updated = await (start ? api.startRuntimeProgram : api.stopRuntimeProgram)(row.runtimeId, row.revision)
        if (!active) return
        rows.value = rows.value.map(item => item.runtimeId === row.runtimeId ? updated : item)
        setOutcome(outcome(row, start ? '启动指令已提交，等待 Runner 上报进程' : '停止指令已提交，等待 Runner 确认'))
      } catch (value) { if (active) setOutcome(outcome(row, problem(value), true)) }
    })
  } catch (value) { if (active) error.value = problem(value) }
  finally { busy.value = false; schedulePoll() }
}

async function previewDelivery() {
  if (!canWrite.value || unavailable.value || !selectedRows.value.length) return
  const targets = selectedRows.value.slice()
  stopPoll(); busy.value = true; clearPreview(); progress.value = '正在核对各机器与当前 Git 目录的文件差异…'
  try {
    await limited(targets, async row => {
      if (!row.binding) { setOutcome(outcome(row, '尚未绑定部署目录', true)); return }
      if (inFlight(row)) { setOutcome(outcome(row, '已有下发任务执行中，请完成后重试', true)); return }
      try {
        const preview = await api.directoryDeliveryPreview(row.binding)
        if (!active) return
        const files = preview.items.filter(item => item.kind === 'file')
        const paths = files.filter(item => scope.value === 'all' || item.status !== 'unchanged').map(item => item.path)
        if (!paths.length) { setOutcome(outcome(row, '文件一致，无需下发', false, undefined, true)); return }
        plans.value.push({ row: { ...row }, preview, paths })
        setOutcome(outcome(row, `待提交：${paths.length} 个文件`))
      } catch (value) { if (active) setOutcome(outcome(row, problem(value), true)) }
    })
  } finally { progress.value = ''; busy.value = false; schedulePoll() }
}

async function submitDelivery() {
  if (!canWrite.value || unavailable.value || !activePlans.value.length) return
  const prepared = activePlans.value.slice()
  stopPoll(); busy.value = true
  let stoppedCount = 0
  try {
    const current = await api.runtimeConfigurations()
    if (!active || !canWrite.value) return
    const valid = prepared.filter(plan => {
      const latest = current.find(item => item.runtimeId === plan.row.runtimeId)
      if (!latest || latest.revision !== plan.row.revision || inFlight(latest)) {
        setOutcome(outcome(plan.row, '机器配置或下发状态已变化，请重新预览', true)); return false
      }
      return true
    })
    if (!valid.length) { plans.value = []; return }
    const preparation = await prepareDeploymentProcesses(valid.map(plan => ({ runnerId: plan.row.runnerId, directory: plan.preview.targetPath })),
      () => active && canWrite.value, text => { progress.value = text })
    if (!preparation.proceed || !active || !canWrite.value) return
    stoppedCount = preparation.stoppedCount
    progress.value = '正在分别创建各机器的部署任务…'
    await limited(valid, async plan => {
      const binding = plan.row.binding!, preview = plan.preview
      try {
        const delivery = await api.deliverDirectoryBinding({ bindingType: binding.bindingType, ownerId: binding.ownerId, runnerId: binding.runnerId,
          revision: preview.revision, scope: scope.value === 'all' ? 'all' : 'selected',
          ...(scope.value === 'all' ? {} : { paths: plan.paths }), baselineDigest: preview.baselineDigest,
          ...(preview.sourceMode ? { sourceMode: preview.sourceMode, sourceRevision: preview.sourceRevision } : {}) })
        if (!active) return
        rows.value = rows.value.map(row => row.runtimeId === plan.row.runtimeId ? { ...row, binding: { ...binding, delivery } } : row)
        setOutcome(outcome(plan.row, delivery.unchanged ? '文件一致，无需下发' : '部署任务已提交，等待 Runner 执行', false, delivery.deliveryId, !!delivery.unchanged))
      } catch (value) { if (active) setOutcome(outcome(plan.row, problem(value) + (stoppedCount ? '；已关闭的程序需在部署完成后手动启动' : ''), true)) }
    })
    const submittedIds = new Set(valid.map(plan => plan.row.runtimeId))
    plans.value = plans.value.filter(plan => !submittedIds.has(plan.row.runtimeId))
    if (stoppedCount) progress.value = `已关闭 ${stoppedCount} 个进程，请在部署完成后启动程序。`
    else progress.value = ''
  } catch (value) { if (active) { error.value = problem(value); if (stoppedCount) progress.value = '相关进程已关闭，请检查执行结果后手动启动。' } }
  finally { busy.value = false; if (progress.value.startsWith('正在')) progress.value = ''; schedulePoll() }
}
</script>

<template>
  <section class="batch-deploy" data-testid="batch-deployment-operations">
    <header><strong>按部署配置批量操作</strong><el-button :icon="Refresh" circle :disabled="loading || busy" aria-label="刷新批量配置" @click="load" /></header>
    <p class="batch-note">操作范围为全部部署资源，不受左侧机器筛选影响。勾选需要操作的机器配置，每台机器分别提交并展示实时状态与结果。</p>
    <div class="batch-filters">
      <label class="batch-config">部署配置<el-select v-model="config" filterable :disabled="loading || busy" placeholder="选择配置，可按配置 ID / 节点搜索" aria-label="批量部署配置" data-testid="batch-config"><el-option v-for="option in configOptions" :key="option.key" :label="option.label" :value="option.key" /></el-select></label>
      <label>环境<el-select v-model="environment" :disabled="busy" aria-label="批量操作环境" data-testid="batch-environment"><el-option label="全部环境" value="" /><el-option label="测试" value="test" /><el-option label="生产" value="production" /></el-select></label>
      <label>机器状态<el-select v-model="status" :disabled="busy" aria-label="批量机器状态" data-testid="batch-status"><el-option label="在线" value="online" /><el-option label="离线" value="offline" /><el-option label="全部状态" value="" /></el-select></label>
      <label>程序状态<el-select v-model="programFilter" :disabled="busy" aria-label="批量程序状态" data-testid="batch-program-status"><el-option label="全部程序状态" value="" /><el-option label="运行中" value="running" /><el-option label="已停止 / 待启动" value="stopped" /><el-option label="启动/停止中" value="transition" /><el-option label="Runner 异常" value="error" /></el-select></label>
      <el-input v-model="keyword" clearable :disabled="busy" placeholder="搜索 IP、Runner ID 或目录" aria-label="搜索批量机器" />
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <div v-if="canWrite" class="batch-actions">
      <span>已选 {{ selectedRows.length }} / {{ visibleRows.length }} 项</span>
      <el-button :disabled="unavailable || !selectedRows.length" data-testid="batch-start" @click="control(true)">批量启动</el-button>
      <el-button :disabled="unavailable || !selectedRows.length" data-testid="batch-stop" @click="control(false)">批量停止</el-button>
      <el-select v-model="scope" :disabled="busy" aria-label="批量下发范围" data-testid="batch-delivery-scope"><el-option label="仅下发变更文件" value="changes" /><el-option label="全部配置文件" value="all" /></el-select>
      <el-button :disabled="unavailable || !selectedRows.length" data-testid="batch-preview" @click="previewDelivery">预览下发</el-button>
      <el-button v-if="activePlans.length" type="primary" :disabled="unavailable" data-testid="batch-submit" @click="submitDelivery">提交 {{ activePlans.length }} 个部署任务</el-button>
    </div>
    <div v-if="outcomeSummary.total" class="batch-summary" data-testid="batch-outcome-summary">
      <span>本次结果：成功 <b>{{ outcomeSummary.ok }}</b> · 跳过 <b>{{ outcomeSummary.skipped }}</b> · 失败 <b :class="{ 'batch-failed': outcomeSummary.failed }">{{ outcomeSummary.failed }}</b></span>
      <el-button v-if="canWrite && failedVisibleIds.length" link type="danger" :disabled="unavailable" data-testid="batch-select-failed" @click="selectFailedOnly">仅勾选失败项（{{ failedVisibleIds.length }}）</el-button>
      <el-button v-if="canWrite && changedVisibleIds.length && changedVisibleIds.length < visibleRows.length" link type="primary" :disabled="unavailable" data-testid="batch-select-changed" @click="selectChangedOnly">仅勾选有变更（{{ changedVisibleIds.length }}）</el-button>
    </div>
    <p v-if="progress" role="status" class="batch-note">{{ progress }}</p>
    <div v-loading="loading" class="batch-list">
      <table class="rc-data-table">
        <thead><tr><th v-if="canWrite" class="batch-check"><input type="checkbox" aria-label="全选当前配置的机器" :checked="allSelected" :indeterminate="someSelected" :disabled="unavailable || !visibleRows.length" @change="selection = ($event.target as HTMLInputElement).checked ? visibleRows.map(row => row.runtimeId) : []"></th><th>部署实例 / 目录</th><th>环境 / 程序与下发</th><th>操作结果</th></tr></thead>
        <tbody>
          <tr v-for="row in visibleRows" :key="row.runtimeId" :data-testid="`batch-row-${row.runtimeId}`">
            <td v-if="canWrite" class="batch-check"><input type="checkbox" :aria-label="`选择 ${label(row)}`" :checked="selection.includes(row.runtimeId)" :disabled="unavailable" @change="selectRow(row.runtimeId, ($event.target as HTMLInputElement).checked)"></td>
            <td><RouterLink :to="{ path: '/settings', query: { tab: 'runners', runnerId: row.runnerId } }">{{ runners.get(row.runnerId)?.ipAddress || row.runnerId }}</RouterLink> · {{ runners.get(row.runnerId)?.status === 'online' ? '在线' : '离线或状态异常' }}<small>{{ runners.get(row.runnerId)?.installDirectory || '实例目录未上报' }}</small><small>部署目录：{{ row.directoryTemplate }}</small></td>
            <td>
              <div class="batch-tags">
                <span>{{ rowEnvironment(row) === 'production' ? '生产' : rowEnvironment(row) === 'test' ? '测试' : '环境未记录' }}</span>
                <el-tag size="small" :type="programState(row).type">{{ programState(row).label }}</el-tag>
                <el-tag size="small" :type="row.binding?.delivery?.status === 'failed' ? 'danger' : row.binding?.delivery?.status === 'success' ? 'success' : 'info'">{{ deliveryStates[row.binding?.delivery?.status || 'none'] || '未下发' }}</el-tag>
              </div>
              <small v-if="programState(row).detail" :title="programState(row).detail">{{ programState(row).detail }}</small>
              <small>入口：{{ configuredEntry(row) || '未设置' }}</small>
            </td>
            <td :class="{ 'batch-failed': outcomeMap.get(row.runtimeId)?.failed }">
              <span>{{ outcomeMap.get(row.runtimeId)?.message || '—' }}</span>
              <template v-if="outcomeMap.get(row.runtimeId)?.jobId"><small>下发记录：{{ outcomeMap.get(row.runtimeId)?.jobId }}</small><RouterLink :to="{ path: '/tasks', query: { tab: 'deployment', configId: layouts.get(row.deploymentId)?.configId || row.sourceContext?.configId } }">查看部署任务</RouterLink><RouterLink :to="{ path: '/settings', query: { tab: 'runtime-logs', recordId: outcomeMap.get(row.runtimeId)?.jobId, runnerId: row.runnerId } }">部署日志</RouterLink></template>
              <details v-if="planMap.has(row.runtimeId)"><summary>查看本次文件（{{ planMap.get(row.runtimeId)!.paths.length }}）</summary><code v-for="path in planMap.get(row.runtimeId)!.paths" :key="path">{{ path }}</code></details>
            </td>
          </tr>
          <tr v-if="!loading && !visibleRows.length"><td :colspan="canWrite ? 4 : 3" class="batch-empty">{{ config ? '当前筛选下没有已绑定的机器配置' : '请选择部署配置' }}</td></tr>
        </tbody>
      </table>
    </div>
    <section v-if="outcomes.some(item => !visibleRows.some(row => row.runtimeId === item.runtimeId))" class="batch-hidden-results"><strong>本次其他结果</strong><p v-for="item in outcomes.filter(item => !visibleRows.some(row => row.runtimeId === item.runtimeId))" :key="item.runtimeId" :class="{ 'batch-failed': item.failed }">{{ item.machine }}：{{ item.message }}</p></section>
  </section>
</template>

<style scoped>
.batch-deploy { padding:16px; min-width:0; min-height:0; overflow:auto; font-size:13px; }
header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.batch-note { color:var(--el-text-color-secondary); font-size:12px; line-height:1.6; }
.batch-filters,.batch-actions { display:flex; align-items:flex-end; flex-wrap:wrap; gap:10px; margin:14px 0; }
.batch-filters label { display:flex; flex-direction:column; gap:6px; width:145px; }
.batch-filters .batch-config { width:320px; max-width:100%; }.batch-filters>.el-input { width:220px; }
.batch-actions { align-items:center; }.batch-actions .el-button { margin-left:0; }.batch-actions .el-select { width:180px; }
.batch-summary { display:flex; align-items:center; flex-wrap:wrap; gap:12px; padding:8px 12px; margin:0 0 12px; border-radius:6px; background:var(--el-fill-color-light); font-size:12px; color:var(--el-text-color-regular); }
.batch-tags { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
.batch-check { width:36px; text-align:center; }.batch-check input { accent-color:var(--el-color-primary); cursor:pointer; }
.batch-list td { vertical-align:top; overflow-wrap:anywhere; }.batch-list small,.batch-list code,.batch-list td>a:last-child { display:block; margin-top:5px; }
.batch-list small { color:var(--el-text-color-secondary); font-size:12px; }.batch-list a { color:var(--el-color-primary); }
.batch-list details { margin-top:8px; }.batch-list summary { color:var(--el-color-primary); cursor:pointer; }.batch-list code { font-size:11px; }
.batch-empty { text-align:center; color:var(--el-text-color-secondary); padding:28px; }.batch-failed { color:var(--el-color-danger); }
.batch-list table { width:100%; table-layout:fixed; }.batch-list th:nth-last-child(2) { width:26%; }.batch-list th:last-child { width:34%; }
@media(max-width:760px) { .batch-deploy{padding:10px}.batch-filters label{width:calc(50% - 5px)}.batch-filters .batch-config,.batch-filters>.el-input{width:100%} }
</style>
