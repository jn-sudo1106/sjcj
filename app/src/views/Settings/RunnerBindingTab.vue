<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type DeploymentConfiguration, type DirectoryDelivery, type DirectoryRunnerBinding, type RunnerInstance, type RuntimeConfiguration, type RuntimeConfigurationInput } from '@/api/runnerManagement'
import DirectoryDeliveryDialog from './DirectoryDeliveryDialog.vue'

const route = useRoute(), router = useRouter(), auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const rows = ref<RuntimeConfiguration[]>([]), configurations = ref<DeploymentConfiguration[]>([]), runners = ref<RunnerInstance[]>([])
const keyword = ref(typeof route.query.configId === 'string' ? route.query.configId : '')
const machineFilter = ref(''), deliveryFilter = ref(''), page = ref(1), pageSize = ref(20)
const loading = ref(false), saving = ref(false), error = ref(''), formError = ref('')
const editing = ref(false), editingRow = ref<RuntimeConfiguration | null>(null)
const controlling = ref(''), programErrors = ref<Record<string, string>>({})
const form = reactive<RuntimeConfigurationInput>({ deploymentId: '', layoutRevision: '', runnerId: '', environment: 'test', concurrency: 1 })
const machineMap = computed(() => new Map(runners.value.map(item => [item.runnerId, item])))
const configurationMap = computed(() => new Map(configurations.value.map(item => [item.deploymentId, item])))
const selectedConfiguration = computed(() => configurationMap.value.get(form.deploymentId))
const existingTask = computed(() => editingRow.value?.deploymentId === form.deploymentId ? editingRow.value.assignment : null)
const executionQueue = computed(() => selectedConfiguration.value?.queueName || existingTask.value?.queue || '')
const hasExecution = computed(() => !!existingTask.value || !!selectedConfiguration.value?.entryPoint)
const filteredRows = computed(() => {
  const search = keyword.value.trim().toLowerCase()
  return rows.value.filter(item => {
    const configuration = configurationMap.value.get(item.deploymentId)
    return (!machineFilter.value || machineState(item.runnerId) === machineFilter.value) &&
      (!deliveryFilter.value || (item.binding?.delivery?.status || 'none') === deliveryFilter.value) &&
      [item.name, item.deploymentId, item.directoryTemplate, configuration?.configId || '', configuration?.sourceNode?.nodeName || '',
        item.assignment?.queue || '', configuration?.queueName || '', runnerLabel(item.runnerId), directoryPath(item), fullPath(item.runnerId, directoryPath(item))]
        .some(value => value.toLowerCase().includes(search))
  })
})
const visibleRows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const boundMachines = computed(() => new Set(rows.value.map(row => row.runnerId)))
const onlineMachines = computed(() => [...boundMachines.value].filter(id => machineState(id) === 'online').length)
const deliveryRow = ref<RuntimeConfiguration | null>(null)
const deliveryBinding = computed<DirectoryRunnerBinding | null>(() => deliveryRow.value?.binding || null)
const machineStates = { online: '在线', offline: '离线', upgrading: '升级中', error: '异常', unknown: '状态未知' }
const deliveryStates = { none: '未下发', pending: '等待下发', running: '下发中', success: '已下发', failed: '下发失败' }
let active = true, initialized = false, request = 0, timer: ReturnType<typeof setTimeout> | undefined
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
const inFlight = (row: RuntimeConfiguration) => ['pending', 'running'].includes(row.binding?.delivery?.status || '')
const machineState = (id: string) => machineMap.value.get(id)?.status || 'unknown'
function runnerLabel(id: string) {
  const item = machineMap.value.get(id)
  return item ? `${item.name} · ${item.ipAddress} · ${item.installDirectory}` : id
}
function resolveDirectory(layout?: DeploymentConfiguration) {
  if (!layout?.directoryTemplate) return ''
  let result = layout.directoryTemplate
  // Match directory_delivery.target_path: variables belong to the deployment,
  // not to an optional execution task. Legacy environment templates need an edit.
  const values: [string, string][] = [['{configId}', layout.configId], ['{queue}', layout.queueName], ['{website}', layout.siteHost]]
  for (const [token, value] of values) {
    if (result.includes(token) && !value) return ''
    result = result.replaceAll(token, value)
  }
  return /[{}]/.test(result) ? '' : result
}
const directoryPath = (row: RuntimeConfiguration) => row.assignment?.processorType === 'deployment-entry'
  ? row.directoryTemplate : resolveDirectory(configurationMap.value.get(row.deploymentId))
function fullPath(runnerId: string, relative: string) {
  const machine = machineMap.value.get(runnerId)
  if (!relative || !machine?.installDirectory) return ''
  const separator = machine.platform.toLowerCase().startsWith('win') || /^[a-z]:[\\/]/i.test(machine.installDirectory) || machine.installDirectory.startsWith('\\\\') ? '\\' : '/'
  return machine.installDirectory.replace(/[\\/]+$/, '') + separator + relative.replaceAll('/', separator)
}
function time(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
function deliveryTime(row: RuntimeConfiguration) {
  const item = row.binding?.delivery
  return item ? `${item.finishedAt ? '完成' : '提交'}于 ${time(item.finishedAt || item.requestedAt)}` : '尚未手动下发'
}
function programState(row: RuntimeConfiguration): { label: string; type: 'info' | 'success' | 'warning' | 'danger'; detail: string; waiting?: boolean } {
  const assignment = row.assignment, machine = machineMap.value.get(row.runnerId)
  if (!assignment) return { label: '仅下发目录', type: 'info', detail: '' }
  if (!machine || machine.status === 'offline') return { label: '运行状态未知', type: 'info', detail: `机器离线 · ${assignment.enabled ? '已请求启动' : '已请求停止'}` }
  if (machine.workerProcesses == null) return { label: '进程未上报', type: 'info', detail: assignment.enabled ? '已请求启动，等待进程上报' : '已请求停止，等待进程上报' }
  const processes = machine.workerProcesses.filter(item => item.assignmentId === assignment.assignmentId)
  const detail = processes.length ? `实例：${processes.length}/${assignment.concurrency} · PID：${processes.map(item => item.pid).join('、')}` : ''
  if (!assignment.enabled) return { label: processes.length ? '停止中' : '已停止', type: 'info', detail, waiting: !!processes.length }
  if (processes.length) return { label: processes.length >= assignment.concurrency ? '运行中' : `部分运行 ${processes.length}/${assignment.concurrency}`, type: processes.length >= assignment.concurrency ? 'success' : 'warning', detail, waiting: processes.length < assignment.concurrency }
  if (machine.lastError || machine.status === 'error') return { label: 'Runner 异常', type: 'danger', detail: machine.lastError || '请查看 Runner 日志' }
  return { label: '等待启动', type: 'warning', detail: '等待 Runner 启动并上报进程', waiting: true }
}
async function controlProgram(row: RuntimeConfiguration, start: boolean) {
  if (!canWrite.value || controlling.value || !row.assignment) return
  controlling.value = row.runtimeId; delete programErrors.value[row.runtimeId]; stopPoll(); ++request
  try {
    const item = await (start ? runnerManagementApi.startRuntimeProgram : runnerManagementApi.stopRuntimeProgram)(row.runtimeId, row.revision)
    rows.value = rows.value.map(value => value.runtimeId === item.runtimeId ? item : value)
    ElMessage.success(start ? '启动指令已提交，等待 Runner 上报进程' : '停止指令已提交，等待 Runner 停止进程')
  } catch (e) { programErrors.value[row.runtimeId] = problem(e) }
  finally { controlling.value = ''; poll() }
}
function stopPoll() { clearTimeout(timer); timer = undefined }
function poll() {
  stopPoll()
  if (active && initialized && !editing.value && !loading.value && !controlling.value) timer = setTimeout(() => { void refreshRows() }, rows.value.some(row => inFlight(row) || programState(row).waiting) ? 3000 : 15000)
}
async function refreshRows() {
  const seq = ++request
  try {
    const [items, layouts, machines] = await Promise.all([runnerManagementApi.runtimeConfigurations(), runnerManagementApi.deploymentConfigurations(), runnerManagementApi.instances()])
    if (seq === request && active) { rows.value = items; configurations.value = layouts; runners.value = machines; error.value = '' }
  } catch (e) { if (seq === request && active) error.value = problem(e) }
  finally { poll() }
}
async function load() {
  const seq = ++request
  stopPoll(); loading.value = true; error.value = ''
  try {
    const [items, layouts, machines] = await Promise.all([runnerManagementApi.runtimeConfigurations(), runnerManagementApi.deploymentConfigurations(), runnerManagementApi.instances()])
    if (seq !== request) return
    rows.value = items; configurations.value = layouts; runners.value = machines
  } catch (e) { if (seq === request) error.value = problem(e) }
  finally { if (seq === request) loading.value = false; initialized = true; poll() }
}
function open(row: RuntimeConfiguration | null = null) {
  editingRow.value = row; editing.value = true; formError.value = ''; stopPoll(); ++request
  const item = configurationMap.value.get(row?.deploymentId || '') || (!row ? configurations.value[0] : undefined)
  Object.assign(form, { runtimeId: row?.runtimeId, revision: row?.revision, deploymentId: item?.deploymentId || '', layoutRevision: item?.revision || '',
    runnerId: row?.runnerId || '', environment: row?.assignment?.environment || 'test', concurrency: row?.assignment?.concurrency || 1 })
}
function selectConfiguration(value: unknown) {
  if (typeof value !== 'string') return
  form.deploymentId = value; form.layoutRevision = selectedConfiguration.value?.revision || ''
}
function cancel() { editing.value = false; editingRow.value = null; formError.value = ''; poll() }
async function save() {
  if (!canWrite.value || saving.value || !form.deploymentId || !form.runnerId) return
  saving.value = true; formError.value = ''
  try {
    const item = await runnerManagementApi.saveRuntimeConfiguration({ ...form, layoutRevision: selectedConfiguration.value?.revision || form.layoutRevision })
    rows.value = [...rows.value.filter(value => value.runtimeId !== editingRow.value?.runtimeId && value.runtimeId !== item.runtimeId), item]
    cancel(); ElMessage.success('机器配置已保存')
  } catch (e) { formError.value = problem(e) }
  finally { saving.value = false }
}
async function remove(row: RuntimeConfiguration) {
  try {
    await ElMessageBox.confirm(`移除“${row.name}”与此机器的绑定${row.assignment ? '，并停止该队列' : ''}？部署配置和仓库代码会保留。`, '移除机器配置', { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' })
    await runnerManagementApi.removeRuntimeConfiguration(row.runtimeId, row.revision)
    rows.value = rows.value.filter(item => item.runtimeId !== row.runtimeId); ElMessage.success('已移除机器配置')
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(problem(e)) }
}
function editDirectory(row: RuntimeConfiguration) { void router.replace({ path: '/settings', query: { tab: 'directory-layout', deploymentId: row.deploymentId } }) }
function deliver(row: RuntimeConfiguration) { if (canWrite.value && row.binding && !inFlight(row)) deliveryRow.value = row }
function delivered(item: DirectoryDelivery) {
  rows.value = rows.value.map(row => row.binding?.bindingType === item.bindingType && row.binding.ownerId === item.ownerId && row.runnerId === item.runnerId
    ? { ...row, binding: { ...row.binding, delivery: item } } : row)
  deliveryRow.value = null; poll()
}
watch([keyword, machineFilter, deliveryFilter, pageSize], () => { page.value = 1 })
watch(() => filteredRows.value.length, length => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize.value))) })
onMounted(() => { void load() })
onActivated(() => { active = true; if (initialized && !loading.value && !editing.value) void load() })
onDeactivated(() => { active = false; stopPoll() })
onUnmounted(() => { active = false; ++request; stopPoll() })
</script>

<template>
  <section class="rb-page" data-testid="settings-runtime-bindings">
    <div class="rb-filters">
      <label class="rb-search">机器 / 目录 / 配置<el-input v-model="keyword" clearable :prefix-icon="Search" :disabled="editing" placeholder="名称、IP、配置 ID 或目录路径" aria-label="搜索机器配置" /></label>
      <label>机器状态<el-select v-model="machineFilter" placeholder="全部状态" :disabled="editing" aria-label="筛选机器状态" data-testid="binding-machine-filter"><el-option label="全部状态" value="" /><el-option v-for="(label, value) in machineStates" :key="value" :value="value" :label="label" /></el-select></label>
      <label>下发状态<el-select v-model="deliveryFilter" placeholder="全部状态" :disabled="editing" aria-label="筛选下发状态" data-testid="binding-delivery-filter"><el-option label="全部状态" value="" /><el-option v-for="(label, value) in deliveryStates" :key="value" :value="value" :label="label" /></el-select></label>
      <span class="rb-filter-note">绑定目录 · 下发代码 · 启动节点程序</span>
    </div>
    <div class="rb-card">
      <header class="rb-toolbar">
        <div><strong>机器与运行目录</strong><span>{{ rows.length }} 项配置 · {{ boundMachines.size }} 个实例 · {{ onlineMachines }} 个在线</span></div>
        <div><el-button :icon="Refresh" circle :disabled="loading || saving || editing || !!controlling" aria-label="刷新机器配置" @click="load" /><el-button v-if="canWrite" type="primary" :icon="Plus" :disabled="loading || saving || editing || !!controlling || !!error" data-testid="binding-create" @click="open()">新增绑定</el-button></div>
      </header>
      <el-alert v-if="error" :title="`机器配置加载失败：${error}`" description="当前信息可能已过期，请刷新重试。" type="error" :closable="false" show-icon class="rb-error" />
      <div v-loading="loading" class="rb-table">
        <table class="rc-data-table">
          <colgroup><col class="rb-col-machine"><col class="rb-col-config"><col class="rb-col-directory"><col class="rb-col-state"><col class="rb-col-actions"></colgroup>
          <thead><tr><th>运行机器</th><th>部署配置</th><th>运行目录</th><th>程序与下发</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-if="editing" class="rb-draft" data-testid="binding-new-row">
              <td colspan="5">
                <div class="rb-editor">
                  <div class="rb-editor-title"><strong>{{ editingRow ? '编辑机器配置' : '新增机器配置' }}</strong><span>选择机器和部署目录，保存后可手动下发代码</span></div>
                  <div class="rb-editor-fields">
                    <label>运行机器<el-select v-model="form.runnerId" filterable :disabled="saving || !!editingRow" placeholder="选择 IP / Runner 实例目录" aria-label="选择运行机器" data-testid="binding-runner"><el-option v-for="runner in runners" :key="runner.runnerId" :value="runner.runnerId" :label="runnerLabel(runner.runnerId)" /></el-select></label>
                    <label>运行目录<el-select :model-value="form.deploymentId" filterable :disabled="saving" placeholder="选择已保存的部署配置" aria-label="选择运行目录" data-testid="binding-deployment" @update:model-value="selectConfiguration"><el-option v-for="item in configurations" :key="item.deploymentId" :value="item.deploymentId" :label="`${item.name} · ${resolveDirectory(item) || item.directoryTemplate}`" /></el-select></label>
                    <div class="rb-execution-summary" data-testid="binding-execution-summary"><span v-if="executionQueue">队列：{{ executionQueue }}</span><span v-if="selectedConfiguration?.entryPoint">启动文件：{{ selectedConfiguration.entryPoint }}</span><small>{{ hasExecution ? '直接启动所选文件；更换入口或代码后需重新下发并手动启动' : '在部署目录中选择启动文件；未选择时仅下发代码' }}</small></div>
                    <div class="rb-path-preview"><el-icon><Folder /></el-icon><div><span>目标目录</span><code data-testid="binding-target-preview">{{ fullPath(form.runnerId, resolveDirectory(selectedConfiguration)) || (resolveDirectory(selectedConfiguration) ? `Runner / ${resolveDirectory(selectedConfiguration)}` : '请先选择已配置完整目录的部署配置') }}</code></div></div>
                    <div v-if="hasExecution" class="rb-runtime-fields"><label>任务环境<el-select v-model="form.environment" :disabled="saving" aria-label="运行环境" data-testid="binding-environment"><el-option label="测试" value="test" /><el-option label="生产" value="production" /></el-select></label><label>并发数<el-input-number v-model="form.concurrency" :min="1" :max="100" :disabled="saving" controls-position="right" aria-label="并发数" /></label></div>
                  </div>
                  <p v-if="formError" role="alert" class="rb-inline-error" data-testid="binding-form-error">{{ formError }}</p>
                  <footer class="rb-editor-footer"><span>保存采用完整配置；下发代码时可选择文件范围。</span><div><el-button :disabled="saving" data-testid="binding-cancel" @click="cancel">取消</el-button><el-button type="primary" :loading="saving" :disabled="!form.deploymentId || !form.runnerId" data-testid="binding-save" @click="save">保存配置</el-button></div></footer>
                </div>
              </td>
            </tr>
            <tr v-for="row in visibleRows" :key="row.runtimeId" data-testid="binding-row">
              <td>
                <div class="rb-machine-title"><strong :title="machineMap.get(row.runnerId)?.name || row.runnerId">{{ machineMap.get(row.runnerId)?.name || row.runnerId }}</strong><span class="rb-machine-state" :class="`is-${machineState(row.runnerId)}`">{{ machineStates[machineState(row.runnerId)] }}</span></div>
                <small :title="`最近心跳：${time(machineMap.get(row.runnerId)?.lastHeartbeat)}`">{{ machineMap.get(row.runnerId)?.ipAddress || 'IP 未知' }} · {{ machineMap.get(row.runnerId)?.platform || '平台未知' }}</small>
                <small :title="`Runner 实例目录：${machineMap.get(row.runnerId)?.installDirectory || '未知'}\n最近心跳：${time(machineMap.get(row.runnerId)?.lastHeartbeat)}`">{{ machineMap.get(row.runnerId)?.installDirectory || '实例目录未知' }}</small>
              </td>
              <td>
                <strong :title="`${row.name}\n部署 ID：${row.deploymentId || '未绑定'}`">{{ row.name }}</strong>
                <small :title="configurationMap.get(row.deploymentId)?.sourceNode?.nodeName">{{ configurationMap.get(row.deploymentId)?.configId ? `配置 ID：${configurationMap.get(row.deploymentId)?.configId}` : row.deploymentId ? '公共目录' : '未关联部署配置' }}</small>
                <small v-if="row.assignment && !row.assignment.queue.startsWith('@deployment:')" :title="`任务：${row.assignment.queue} · ${row.assignment.environment === 'production' ? '生产' : '测试'} · ${row.assignment.concurrency} 并发 · ${row.assignment.enabled ? '已启用' : '已停用'}`">任务：{{ row.assignment.queue }}</small>
              </td>
              <td>
                <div class="rb-directory-title"><el-icon><Folder /></el-icon><strong :title="directoryPath(row) || row.directoryTemplate" data-testid="binding-directory">{{ directoryPath(row) || (row.deploymentId ? '待完善目录模板' : '待选择部署目录') }}</strong></div>
                <small v-if="fullPath(row.runnerId, directoryPath(row))" :title="fullPath(row.runnerId, directoryPath(row))" data-testid="binding-full-path">目标：{{ fullPath(row.runnerId, directoryPath(row)) }}</small>
                <small v-if="row.entryPoint" :title="row.entryPoint">启动文件：{{ row.entryPoint }}</small>
                <small v-if="row.assignment && row.assignment.processorType !== 'deployment-entry' && row.entryPoint" class="rb-inline-error">旧启动方式，请编辑保存后采用所选文件</small>
                <small v-if="row.binding?.delivery?.status === 'success' && row.binding.delivery.installedPath" :title="row.binding.delivery.installedPath" data-testid="binding-installed-path">上次落盘：{{ row.binding.delivery.installedPath }}</small>
              </td>
              <td>
                <div class="rb-program-status" data-testid="binding-program-status"><el-tag size="small" :type="programState(row).type">{{ programState(row).label }}</el-tag><small v-if="programState(row).detail" :title="programState(row).detail">{{ programState(row).detail }}</small></div>
                <div class="rb-statuses"><el-tag size="small" :type="row.appliedRevision && row.appliedRevision === row.layoutRevision ? 'success' : 'info'">{{ row.appliedRevision ? row.appliedRevision === row.layoutRevision ? '已采用' : '配置有更新' : '原有配置' }}</el-tag><el-tag size="small" :type="row.binding?.delivery?.status === 'failed' ? 'danger' : row.binding?.delivery?.status === 'success' ? 'success' : 'info'">{{ deliveryStates[row.binding?.delivery?.status || 'none'] }}</el-tag></div>
                <small :title="deliveryTime(row)">{{ deliveryTime(row) }}</small>
                <small v-if="row.appliedRevision && row.appliedRevision !== row.layoutRevision">编辑保存以采用新配置</small>
                <small v-if="row.binding?.delivery?.status === 'success' && row.binding.delivery.layoutRevision !== row.layoutRevision">目录有更新，待重新下发</small>
                <small v-if="row.binding?.delivery?.error" class="rb-inline-error" :title="row.binding.delivery.error">{{ row.binding.delivery.error }}</small>
                <small v-if="programErrors[row.runtimeId]" role="alert" class="rb-inline-error" :title="programErrors[row.runtimeId]" data-testid="binding-program-error">{{ programErrors[row.runtimeId] }}</small>
              </td>
              <td><div class="rb-actions">
                <el-button v-if="canWrite && row.assignment" link type="primary" :disabled="loading || !!error || editing || saving || !!controlling || inFlight(row) || row.assignment.enabled || machineState(row.runnerId) !== 'online'" :loading="controlling === row.runtimeId && !row.assignment.enabled" data-testid="binding-start" @click="controlProgram(row, true)">启动</el-button>
                <el-button v-if="canWrite && row.assignment" link type="danger" :disabled="loading || !!error || editing || saving || !!controlling || !row.assignment.enabled" :loading="controlling === row.runtimeId && row.assignment.enabled" data-testid="binding-stop" @click="controlProgram(row, false)">停止</el-button>
                <el-button v-if="canWrite" link type="primary" :disabled="loading || !!error || editing || saving || !!controlling || inFlight(row)" @click="open(row)">编辑</el-button>
                <el-button v-if="canWrite" link type="primary" :disabled="loading || !!error || !row.binding || inFlight(row) || editing || saving || !!controlling" data-testid="binding-deliver" @click="deliver(row)">下发代码</el-button>
                <el-button link type="primary" :disabled="!row.deploymentId || !!controlling" @click="editDirectory(row)">部署目录</el-button>
                <el-button v-if="canWrite" link type="danger" :disabled="loading || !!error || editing || saving || !!controlling || inFlight(row)" @click="remove(row)">移除</el-button>
              </div></td>
            </tr>
            <tr v-if="!loading && !visibleRows.length && !editing"><td colspan="5" class="rb-empty">{{ error ? '服务不可用，请刷新重试' : rows.length ? '没有匹配的机器配置' : '暂无机器配置，先保存部署配置，再新增绑定' }}</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="rb-footer"><span>同一 IP 下的不同 Runner 目录为独立实例</span><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" :total="filteredRows.length" :disabled="editing || loading" /></footer>
    </div>
    <DirectoryDeliveryDialog v-if="deliveryBinding" :binding="deliveryBinding" :runner-name="runnerLabel(deliveryBinding.runnerId)" @close="deliveryRow = null" @delivered="delivered" />
  </section>
</template>

<style scoped>
.rb-page { display:flex; flex:1; flex-direction:column; min-height:0; gap:12px; }
.rb-filters { display:flex; align-items:end; gap:16px; padding:14px 16px; border:1px solid var(--el-border-color-light); border-radius:12px; background:var(--el-bg-color); }
.rb-filters label { width:145px; flex-shrink:0; }
.rb-filters .rb-search { width:320px; }
.rb-filters label, .rb-editor-fields label { display:block; font-size:12px; color:var(--el-text-color-regular); line-height:20px; }
.rb-filters .el-input, .rb-filters .el-select, .rb-editor-fields .el-select, .rb-editor-fields .el-input-number { display:block; margin-top:6px; width:100%; }
.rb-filters .el-input, .rb-editor-fields .el-input-number { display:inline-flex; }
.rb-filter-note { margin-left:auto; padding-bottom:7px; font-size:12px; color:var(--rc-muted); }
.rb-card { display:flex; flex:1; flex-direction:column; min-height:0; border:1px solid var(--el-border-color-light); border-radius:12px; background:var(--el-bg-color); overflow:hidden; }
.rb-toolbar { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; gap:12px; }
.rb-toolbar > div { display:flex; align-items:center; gap:12px; }
.rb-toolbar strong { font-size:14px; }.rb-toolbar span { font-size:12px; color:var(--rc-muted); }
.rb-error { margin:0 12px 8px; width:auto; }
.rb-table { flex:1; min-height:0; overflow:auto; }
.rb-table table { table-layout:fixed; min-width:900px; }
.rb-col-machine { width:22%; }.rb-col-config { width:19%; }.rb-col-directory { width:26%; }.rb-col-state { width:20%; }.rb-col-actions { width:140px; }
.rb-table th { position:sticky; top:0; z-index:1; }.rb-table td { vertical-align:top; padding:16px 12px; white-space:normal; }
.rb-table strong { display:block; min-width:0; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rb-table small { display:block; color:var(--rc-muted); font-size:11px; margin-top:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rb-machine-title, .rb-directory-title { display:flex; align-items:center; gap:8px; min-height:20px; }
.rb-machine-state { flex-shrink:0; color:var(--el-text-color-secondary); font-size:11px; }.rb-machine-state::before { content:''; display:inline-block; width:5px; height:5px; margin:0 4px 1px 0; border-radius:50%; background:currentColor; }.rb-machine-state.is-online { color:var(--el-color-success); }.rb-machine-state.is-error { color:var(--el-color-danger); }.rb-machine-state.is-upgrading { color:var(--el-color-primary); }
.rb-directory-title .el-icon { color:var(--el-color-primary); flex-shrink:0; font-size:16px; }
.rb-statuses { display:flex; flex-wrap:wrap; gap:5px; }.rb-program-status { margin-bottom:10px; }
.rb-actions { display:grid; grid-template-columns:1fr 1fr; gap:10px 8px; justify-items:start; }.rb-actions .el-button { margin:0; font-size:12px; }
.rb-table .rb-empty { padding:56px 12px; text-align:center; color:var(--rc-muted); }
.rb-inline-error { color:var(--rc-error)!important; font-size:12px; }
.rb-table .rb-draft > td { padding:12px; background:var(--el-fill-color-lighter); }
.rb-editor { padding:16px; border:1px solid var(--el-color-primary-light-7); border-radius:8px; background:var(--el-bg-color); }
.rb-editor-title { display:flex; align-items:center; gap:12px; margin-bottom:16px; }.rb-editor-title strong { font-size:14px; }.rb-editor-title span { color:var(--rc-muted); font-size:12px; }
.rb-editor-fields { display:grid; grid-template-columns:1fr 1fr 1fr; align-items:start; gap:16px; }.rb-editor-fields > * { min-width:0; }
.rb-path-preview { display:flex; align-items:center; gap:10px; grid-column:span 2; min-height:54px; background:var(--el-fill-color-light); padding:8px 12px; border-radius:6px; }.rb-path-preview .el-icon { color:var(--el-color-primary); font-size:20px; flex-shrink:0; }.rb-path-preview > div { min-width:0; }.rb-path-preview span { display:block; font-size:11px; color:var(--rc-muted); }.rb-path-preview code { display:block; margin-top:5px; font-size:12px; overflow-wrap:anywhere; }
.rb-runtime-fields { display:flex; gap:12px; }.rb-runtime-fields > label { flex:1; min-width:0; }.rb-execution-summary { align-self:center; line-height:1.6; font-size:12px; }.rb-execution-summary > span { display:block; overflow-wrap:anywhere; }.rb-execution-summary > small { color:var(--rc-muted); }
.rb-editor-footer { display:flex; justify-content:space-between; align-items:center; gap:12px; border-top:1px solid var(--el-border-color-lighter); margin-top:16px; padding-top:12px; }.rb-editor-footer > span { color:var(--rc-muted); font-size:12px; }
.rb-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-top:1px solid var(--el-border-color-lighter); }.rb-footer > span { font-size:12px; color:var(--rc-muted); }
@media (max-width:1100px) { .rb-filter-note, .rb-footer > span { display:none; }.rb-footer { justify-content:flex-end; }.rb-filters .rb-search { flex:1; width:auto; } }
</style>
