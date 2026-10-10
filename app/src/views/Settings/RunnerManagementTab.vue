<script setup lang="ts">
import { computed, onActivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import {
  runnerManagementApi,
  type ArtifactRelease,
  type QueueAssignment,
  type RunnerInstance,
  type EnrollmentCode,
  type SiteCodeVersion,
} from '@/api/runnerManagement'

const props = defineProps<{ section: 'runners' | 'assignments' | 'releases' }>()
const emit = defineEmits<{ manageVersions: [configId: string] }>()
const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const loading = ref(false)
const error = ref('')
const runners = ref<RunnerInstance[]>([])
const assignments = ref<QueueAssignment[]>([])
const releases = ref<ArtifactRelease[]>([])
const nodeCodes = ref<(SiteCodeVersion & { environments?: ('test' | 'prd')[] })[]>([])
const keyword = ref('')
const detail = ref<RunnerInstance | QueueAssignment | ArtifactRelease | null>(null)
const detailOpen = ref(false)
const enrollment = ref<EnrollmentCode | null>(null)
const enrollmentOpen = ref(false)
const assignmentOpen = ref(false)
const upgradeOpen = ref(false)
const upgradeRunner = ref<RunnerInstance | null>(null)
const targetRunnerDigest = ref('')
const saving = ref(false)
const formError = ref('')
const form = reactive({ runnerId: '', scriptDigest: '', concurrency: 1, environment: 'test' as 'production' | 'test' })
let loaded = false
let statusTimer: ReturnType<typeof setInterval> | undefined

const sectionTitle = computed(() => ({ runners: '运行机器', assignments: '队列运行', releases: 'Runner 版本' })[props.section])
const filteredRunners = computed(() => runners.value.filter((row) =>
  [row.ipAddress, row.installDirectory, row.name, row.runnerId].some((text) => text?.toLowerCase().includes(keyword.value.trim().toLowerCase())),
))
const filteredAssignments = computed(() => assignments.value.filter((row) =>
  [row.queue, row.processorType, row.runnerId, runnerLabel(row.runnerId), row.configId, row.deliveryPath, row.repoName].some((text) => text?.toLowerCase().includes(keyword.value.trim().toLowerCase())),
))
const filteredReleases = computed(() => releases.value.filter((row) => row.kind === 'runner' &&
  [row.name, row.digest, row.gitCommit].some((text) => text?.toLowerCase().includes(keyword.value.trim().toLowerCase())),
))
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
const publishedRunnerReleases = computed(() => releases.value.filter(row => row.kind === 'runner' && row.status === 'published'))
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

function openUpgrade(row: RunnerInstance) {
  upgradeRunner.value = row
  targetRunnerDigest.value = row.desiredDigest || ''
  upgradeOpen.value = true
}

async function saveUpgrade() {
  if (!upgradeRunner.value || !targetRunnerDigest.value) return
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

function detailFieldLabel(key: string) {
  if (props.section !== 'runners') return key
  return ({ actualDigest: '当前 Runner 版本', desiredDigest: '目标 Runner 版本', workerDigests: '队列处理程序摘要', runnerPid: 'Runner 进程 ID' } as Record<string, string>)[key] || key
}

function detailEntries() {
  if (!detail.value) return []
  return Object.entries(detailRunner.value || detail.value).filter(([key]) => !/credential|secret|token|password/i.test(key) && key !== 'workerProcesses')
}
</script>

<template>
  <div class="rc-card rm-main" :data-testid="`settings-${section}`">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" clearable :placeholder="section === 'runners' ? 'IP、目录、实例名' : section === 'assignments' ? '队列、配置 ID、代码文件或机器' : '名称、摘要、Git 提交'" style="width: 260px" />
      <button class="rc-btn" type="button" :disabled="loading" @click="load">刷新</button>
      <span class="rm-spacer" />
      <span v-if="section === 'runners'" class="rm-note">每个 Runner 对应一个安装目录，同一台机器可以部署多个</span>
      <button v-if="canWrite && section === 'runners'" class="rc-btn primary" type="button" :disabled="saving" @click="createEnrollment">远程接入码</button>
      <button v-if="canWrite && section === 'assignments'" class="rc-btn primary" type="button" :disabled="loading || !!error || assignmentOpen" data-testid="assignment-create" @click="openAssignment">新增队列</button>
      <span v-if="section === 'releases'" class="rm-code-note">生成 Runner 版本后，到运行机器中设置目标版本并升级</span>
      <template v-if="canWrite && section === 'releases'">
        <button class="rc-btn primary" type="button" :disabled="saving" @click="publishRunner">生成 Runner 版本</button>
      </template>
    </div>
    <div v-if="error" class="rm-error" role="alert">{{ sectionTitle }}加载失败：{{ error }}。请确认 Runner 管理服务已部署。</div>
    <div v-loading="loading" class="rc-table-scroll rm-table">
      <table v-if="section === 'runners'" class="rc-data-table rm-runner-table">
        <colgroup><col style="width:9%"><col style="width:20%"><col style="width:13%"><col style="width:5%"><col style="width:6%"><col style="width:18%"><col style="width:15%"><col style="width:14%"></colgroup>
        <thead><tr><th>机器 IP</th><th>安装目录</th><th>实例</th><th>状态</th><th>队列数</th><th>Runner 版本</th><th>最近心跳</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filteredRunners" :key="row.runnerId">
            <td>{{ row.ipAddress }}</td><td class="rm-path" :title="row.installDirectory">{{ row.installDirectory }}</td>
            <td :title="row.runnerId">{{ row.name || row.runnerId }}<small class="rm-process-note" :title="`最近心跳上报的 Runner 主进程：${row.lastHeartbeat || '未收到心跳'}`" data-testid="runner-pid">PID：{{ row.runnerPid || '未上报' }}</small></td><td>{{ runnerStatus(row.status) }}</td><td>{{ row.assignmentCount }}<small v-if="row.workerProcesses != null" class="rm-process-note" :title="row.workerProcesses.map(item => `${item.queue} · 并发 ${item.slot + 1} · PID ${item.pid}`).join('\n')">{{ row.workerProcesses.length }} 个进程</small></td>
            <td class="rm-runner-version" data-testid="runner-version"><span :title="`Runner 心跳上报版本：${row.actualDigest || '未上报'}`">当前：{{ runnerVersion(row.actualDigest) }}</span><small :title="`Runner 升级目标版本：${row.desiredDigest || '未设置'}`">目标：{{ row.desiredDigest ? runnerVersion(row.desiredDigest) : '未设置' }}</small></td>
            <td :title="row.lastHeartbeat || '未收到心跳'">{{ row.lastHeartbeat || '—' }}</td><td><div class="rm-runner-actions"><el-button link type="primary" @click="showDetail(row)">详情</el-button><el-button v-if="canWrite" link type="primary" @click="openUpgrade(row)">设置 Runner 版本</el-button></div></td>
          </tr>
          <tr v-if="!loading && !filteredRunners.length"><td colspan="8">{{ error ? '服务不可用' : '暂无运行机器' }}</td></tr>
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
        <thead><tr><th>Runner 名称</th><th>平台</th><th>版本标识</th><th>Git 提交</th><th>状态</th><th title="按最近心跳上报的 Runner 版本统计，包括离线实例">安装实例</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filteredReleases" :key="row.digest">
            <td>{{ row.name }}</td><td>{{ row.platform }}</td>
            <td :title="row.digest">{{ runnerVersion(row.digest) }}</td><td :title="row.gitCommit">{{ row.gitCommit.slice(0, 12) }}</td>
            <td>{{ row.status }}</td><td>{{ row.usedBy }}</td><td><el-button link type="primary" @click="showDetail(row)">详情</el-button></td>
          </tr>
          <tr v-if="!loading && !filteredReleases.length"><td colspan="7">{{ error ? '服务不可用' : '暂无 Runner 版本' }}</td></tr>
        </tbody>
      </table>
    </div>
    <el-drawer v-model="detailOpen" :title="`${sectionTitle}详情`" size="min(540px, 94vw)">
      <dl class="rm-detail"><template v-for="[key, value] in detailEntries()" :key="key"><dt>{{ detailFieldLabel(key) }}</dt><dd>{{ Array.isArray(value) ? value.join('、') : value ?? '—' }}</dd></template></dl>
      <section v-if="detailRunner" class="rm-process-detail" data-testid="runner-process-detail">
        <h3>任务进程</h3><p>以下进程来自最近一次心跳上报：{{ detailRunner.lastHeartbeat || '—' }}{{ detailRunner.status === 'offline' ? '（机器已离线）' : '' }}</p>
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
    <el-dialog v-model="upgradeOpen" title="选择 Runner 升级版本" width="min(520px, 94vw)" append-to-body>
      <p>{{ upgradeRunner?.ipAddress }} · {{ upgradeRunner?.installDirectory }}</p>
      <p class="rm-upgrade-current">当前 Runner 版本：{{ runnerVersion(upgradeRunner?.actualDigest || null) }}</p>
      <el-select v-model="targetRunnerDigest" filterable style="width: 100%" placeholder="选择已发布 Runner 版本" aria-label="选择 Runner 版本" data-testid="runner-upgrade-version">
        <el-option v-for="row in publishedRunnerReleases" :key="row.digest" :label="`${row.name} · ${runnerVersion(row.digest)}`" :value="row.digest" />
      </el-select>
      <template #footer><el-button @click="upgradeOpen = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!targetRunnerDigest" @click="saveUpgrade">应用升级</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.rm-main { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.rm-spacer { flex: 1; }
.rm-table { flex: 1; min-height: 0; overflow: auto; }
.rm-table td { white-space: nowrap; }
.rm-path { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.rm-runner-version { min-width: 175px; }.rm-runner-version span, .rm-runner-version small { display: block; }.rm-runner-version small { margin-top: 5px; color: var(--rc-muted); font-size: 11px; }.rm-upgrade-current { color: var(--rc-muted); font-size: 12px; }
.rm-process-note { display:block; margin-top:5px; font-size:11px; color:var(--rc-muted); }.rm-process-detail { margin-top:24px; border-top:1px solid var(--el-border-color-lighter); padding-top:12px; }.rm-process-detail h3 { font-size:14px; }.rm-process-detail p { color:var(--rc-muted); font-size:12px; line-height:1.6; }
.rm-runner-table { table-layout:fixed; min-width:1000px; }.rm-runner-table td { overflow:hidden; text-overflow:ellipsis; }.rm-runner-actions { display:flex; flex-direction:column; align-items:flex-start; gap:5px; }.rm-runner-actions .el-button { margin:0; font-size:12px; }
.rm-assignment-draft { background: var(--rc-primary-bg); }.rm-node-select { width: 290px; }.rm-runner-select { width: 220px; }.rm-env-select { width: 90px; }.rm-concurrency { width: 80px; }
.rm-node-code { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }.rm-code-note { display: block; margin-top: 4px; color: var(--rc-muted); font-size: 11px; }
.rm-assignment-note td { white-space: normal; font-size: 12px; color: var(--rc-muted); }.rm-form-error { color: var(--rc-error); }
.rm-error { margin: 0 12px 8px; padding: 10px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; }
.rm-detail { display: grid; grid-template-columns: 145px 1fr; gap: 10px; font-size: 13px; }
.rm-detail dt { color: var(--rc-muted); }
.rm-detail dd { margin: 0; overflow-wrap: anywhere; }
.rm-code { padding: 12px; background: #f1f5f9; font: 16px ui-monospace, monospace; overflow-wrap: anywhere; }
.rm-note { color: #b45309; font-size: 12px; }
</style>
