<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { formatRunnerHeartbeat } from '@/utils/format/runnerHeartbeat'
import { runnerManagementApi, type ProcessorProcess, type RunnerInstance } from '@/api/runnerManagement'

const router = useRouter()
const canWrite = computed(() => useAuthStore().role === 'admin')
const runners = ref<RunnerInstance[]>([]), processes = ref<ProcessorProcess[]>([])
const runnerId = ref(''), keyword = ref(''), loading = ref(false), error = ref(''), busy = ref('')
let active = true, initialized = false, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
const identity = (process: ProcessorProcess) => `${process.runnerId}:${process.assignmentId}:${process.slot}:${process.pid}`
const machine = (id: string) => runners.value.find(row => row.runnerId === id)
const label = (row: RunnerInstance) => `${row.ipAddress} · ${row.installDirectory}`
const visibleRunners = computed(() => runners.value.filter(row => !runnerId.value || row.runnerId === runnerId.value))
const visibleProcesses = computed(() => processes.value.filter(row => (!runnerId.value || row.runnerId === runnerId.value)
  && [row.entry, row.workingDirectory, row.queue, String(row.pid), machine(row.runnerId)?.installDirectory, machine(row.runnerId)?.ipAddress]
    .some(value => value?.toLowerCase().includes(keyword.value.trim().toLowerCase()))))
const unsupported = computed(() => visibleRunners.value.filter(row => !row.capabilities.includes('process-control')
  && processes.value.some(process => process.runnerId === row.runnerId)))
const name = (entry: string | undefined) => entry?.split(/[\\/]/).at(-1) || '未上报'
const status = (row: ProcessorProcess) => machine(row.runnerId)?.status === 'offline' ? '离线，状态未确认'
  : row.stopStatus === 'pending' || row.stopStatus === 'applied' ? '等待关闭确认' : '运行中'
const stoppable = (row: ProcessorProcess) => canWrite.value && machine(row.runnerId)?.status !== 'offline'
  && machine(row.runnerId)?.capabilities.includes('process-control') && !['pending', 'applied'].includes(row.stopStatus)
const stopReason = (row: ProcessorProcess) => machine(row.runnerId)?.status === 'offline' ? '实例已离线，请等待 Runner 恢复在线'
  : !machine(row.runnerId)?.capabilities.includes('process-control') ? '此 Runner 版本不支持单进程关闭，请先升级 Runner'
    : ['pending', 'applied'].includes(row.stopStatus) ? '关闭指令已提交，等待 Runner 确认' : ''

function stopPolling() { clearTimeout(timer); timer = undefined }
function poll() { stopPolling(); if (active) timer = setTimeout(async () => { await load(true); poll() }, 3000) }
async function load(background = false) {
  const current = ++sequence
  if (!background) loading.value = true
  try {
    const result = await runnerManagementApi.processorProcesses()
    if (!active || current !== sequence) return
    runners.value = result.runners; processes.value = result.items; error.value = ''
  } catch (e) { if (active && current === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (current === sequence) loading.value = false }
}
async function refresh() { stopPolling(); await load(); initialized = true; poll() }
async function closeProcess(row: ProcessorProcess) {
  if (busy.value || !stoppable(row)) return
  try {
    await ElMessageBox.confirm(`关闭 ${label(machine(row.runnerId)!)} 的 ${name(row.entry)}（PID ${row.pid}，并发 ${row.slot + 1}）？其他进程继续运行；此进程不会自动重启，可到机器配置手动启动恢复。`, '关闭处理进程', { confirmButtonText: '关闭进程', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  busy.value = identity(row); stopPolling(); ++sequence
  try {
    const result = await runnerManagementApi.stopProcessorProcess(row)
    if (!active) return
    const current = processes.value.find(item => identity(item) === identity(row))
    if (current) { current.stopStatus = result.status; current.stopError = result.error }
    ElMessage.success('关闭指令已提交，等待 Runner 确认')
    await load(true)
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = ''; poll() }
}
function logs(row: ProcessorProcess) {
  void router.replace({ path: '/settings', query: { tab: 'runtime-logs', runnerId: row.runnerId,
    assignmentId: row.assignmentId, processPid: String(row.pid), processSlot: String(row.slot),
    ...(row.runtimeId ? { runtimeId: row.runtimeId } : {}), ...(row.runId ? { recordId: row.runId } : {}) } })
}
function upgrade() { void router.replace({ path: '/settings', query: { tab: 'runners' } }) }
onMounted(() => { void refresh() })
onActivated(() => { active = true; if (initialized) void refresh() })
onDeactivated(() => { active = false; stopPolling(); ++sequence })
onUnmounted(() => { active = false; stopPolling(); ++sequence })
</script>

<template>
  <section class="pp-page" data-testid="settings-processors">
    <div class="pp-toolbar">
      <el-select v-model="runnerId" filterable clearable placeholder="全部 Runner 实例" aria-label="筛选处理机实例"><el-option v-for="row in runners" :key="row.runnerId" :value="row.runnerId" :label="label(row)" /></el-select>
      <el-input v-model="keyword" clearable :prefix-icon="Search" placeholder="搜索入口、队列、PID 或目录" aria-label="搜索处理进程" />
      <span class="pp-count">{{ visibleRunners.length }} 个实例 · {{ visibleProcesses.length }} 个处理进程</span>
      <el-button :icon="Refresh" circle :loading="loading" :disabled="!!busy" aria-label="刷新处理进程" @click="refresh" />
    </div>
    <el-alert v-if="error" :title="`处理进程请求失败：${error}`" type="error" :closable="false" show-icon />
    <div v-if="unsupported.length" class="pp-upgrade"><span>{{ unsupported.length }} 个实例尚不支持单进程关闭，需要升级 Runner。</span><el-button link type="primary" @click="upgrade">前往运行机器</el-button></div>
    <div class="pp-summary"><span v-for="row in visibleRunners" :key="row.runnerId" :title="label(row)">{{ row.installDirectory }} · {{ row.workerProcesses == null ? '进程未上报' : `${row.workerProcesses.length} 个进程` }}{{ row.status === 'offline' ? '（离线）' : '' }}</span></div>
    <div v-loading="loading" class="pp-table-scroll">
      <table class="rc-data-table pp-table"><thead><tr><th>Runner 实例</th><th>启动文件 / 运行目录</th><th>队列</th><th>并发序号</th><th>PID</th><th>状态</th><th>操作</th></tr></thead><tbody>
        <tr v-for="row in visibleProcesses" :key="identity(row)" :data-testid="`processor-${row.pid}`">
          <td><strong>{{ machine(row.runnerId)?.ipAddress }}</strong><small :title="machine(row.runnerId)?.installDirectory">{{ machine(row.runnerId)?.installDirectory }}</small></td>
          <td><strong :title="row.entry">{{ name(row.entry) }}</strong><small :title="row.workingDirectory">{{ row.workingDirectory || '未上报' }}</small></td>
          <td :title="row.queue">{{ row.queue.startsWith('@deployment:') ? '未绑定节点' : row.queue }}</td><td>{{ row.slot + 1 }}</td><td>{{ row.pid }}</td>
          <td><el-tag size="small" :type="machine(row.runnerId)?.status === 'offline' ? 'info' : row.stopStatus === 'pending' || row.stopStatus === 'applied' ? 'warning' : 'success'">{{ status(row) }}</el-tag><small :title="`${formatRunnerHeartbeat(machine(row.runnerId)?.lastHeartbeat)}（北京时间）`">心跳：{{ formatRunnerHeartbeat(machine(row.runnerId)?.lastHeartbeat) }}</small><small v-if="row.stopError" class="pp-error">{{ row.stopError }}</small></td>
          <td><div class="pp-actions"><el-button link type="primary" @click="logs(row)">日志</el-button><el-button v-if="canWrite" link type="danger" :disabled="!stoppable(row) || !!busy" :loading="busy === identity(row)" :data-testid="`processor-stop-${row.pid}`" @click="closeProcess(row)">关闭进程</el-button></div><small v-if="canWrite && stopReason(row)" :title="stopReason(row)">{{ stopReason(row) }}</small></td>
        </tr>
        <tr v-if="!loading && !visibleProcesses.length"><td colspan="7" class="pp-empty">{{ error ? '进程列表暂不可用，请刷新重试' : '当前筛选范围没有已上报的处理进程' }}</td></tr>
      </tbody></table>
    </div>
    <p class="pp-note">每 3 秒刷新心跳结果。关闭操作只针对选中的处理进程，Runner 主进程保持运行；关闭后到机器配置手动启动可恢复。</p>
  </section>
</template>

<style scoped>
.pp-page { display:flex; flex:1; min-height:0; flex-direction:column; gap:12px; }.pp-toolbar { display:flex; align-items:center; gap:10px; }.pp-toolbar .el-select { width:300px; flex-shrink:0; }.pp-toolbar .el-input { flex:1; }.pp-count { white-space:nowrap; font-size:12px; color:var(--rc-muted); }.pp-summary { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:var(--rc-muted); }.pp-upgrade { display:flex; align-items:center; gap:12px; font-size:12px; color:var(--el-color-warning-dark-2); }.pp-table-scroll { flex:1; min-height:0; overflow:auto; border:1px solid var(--rc-border); border-radius:8px; background:var(--rc-card); }.pp-table { width:100%; table-layout:fixed; }.pp-table th:nth-child(1),.pp-table th:nth-child(2) { width:22%; }.pp-table th:nth-child(3) { width:12%; }.pp-table th:nth-child(4) { width:8%; }.pp-table th:nth-child(5) { width:8%; }.pp-table th:nth-child(6) { width:17%; }.pp-table th:nth-child(7) { width:11%; }.pp-table td { overflow-wrap:anywhere; }.pp-table strong { font-size:12px; font-weight:500; }.pp-table small { display:block; margin-top:5px; font-size:11px; color:var(--rc-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.pp-table .pp-error { color:var(--el-color-danger); white-space:normal; }.pp-actions { display:flex; flex-wrap:wrap; gap:6px; }.pp-actions .el-button { margin:0; }.pp-empty { text-align:center; color:var(--rc-muted); padding:32px !important; }.pp-note { margin:0; font-size:12px; color:var(--rc-muted); }
@media(max-width:1100px) { .pp-toolbar { flex-wrap:wrap; }.pp-toolbar .el-select { width:260px; }.pp-toolbar .el-input { min-width:180px; } }
</style>
