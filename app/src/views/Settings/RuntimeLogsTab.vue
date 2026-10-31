<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { Download, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { copyToClipboard } from '@/utils/clipboard'
import { formatRunnerHeartbeat } from '@/utils/format/runnerHeartbeat'
import CodeServerLogsPanel from './CodeServerLogsPanel.vue'
import { runnerManagementApi, type RunnerInstance, type RuntimeLogRecord, type RuntimeLogDetail, type RuntimeLogLine, type RuntimeLogPolicy } from '@/api/runnerManagement'

const route = useRoute(), router = useRouter()
const auth = useAuthStore()
const settingsOpen = ref(false), settingsLoading = ref(false), settingsError = ref(''), settingsSaving = ref(false)
const settings = ref<RuntimeLogPolicy>({ directory: '', retentionDays: 30, quotaMb: 1024, hasLogs: false })
const filters = reactive({ keyword: '', runnerId: '', kind: '', status: '', period: '24', page: 1 })
const codeServerMode = computed(() => filters.kind === 'code-server')
const kinds: Record<string, string> = { delivery: '代码下发', start: '请求启动', stop: '请求停止', run: '程序运行', runner: 'Runner 日志' }
const statuses: Record<string, string> = { pending: '等待处理', checking: '启动检查中', running: '运行中', success: '已完成', partial: '部分实例失败', failed: '失败', stopped: '已停止', exited: '已退出', paused: '反复失败已暂停', unknown: '结果待确认' }
const tabs = [{ key: 'events', label: '执行过程' }, { key: 'output', label: '程序输出' }, { key: 'results', label: '任务结果' }, { key: 'info', label: '运行信息' }]
const stages: Record<string, string> = { requested: '提交指令', validation: '配置检查', received: '接收下发', finished: '下发结果', created: '开始检查', started: '启动完成', failed: '执行失败', exited: '程序退出', stopped: '停止完成', 'retry-paused': '暂停重试', 'directory-check': '目录检查', download: '下载代码', verify: '校验代码', install: '写入目录', installed: '写入完成', 'delivery-sync': '下发通信', sync: '服务通信', upgrade: 'Runner 升级', rollback: '版本回滚', 'upgrade-check': '升级检查' }
Object.assign(stages, { 'dependency-check': '依赖检查', 'dependency-env': '创建依赖环境', 'dependency-install': '安装依赖', 'dependency-ready': '依赖就绪' })
const rows = ref<RuntimeLogRecord[]>([]), machines = ref<RunnerInstance[]>([]), total = ref(0)
const selected = ref(''), detail = ref<RuntimeLogDetail | null>(null), tab = ref('events')
const loading = ref(false), detailLoading = ref(false), outputLoading = ref(false), downloading = ref(false)
const error = ref(''), detailError = ref(''), outputError = ref('')
const outputNotice = ref('')
const streamId = ref(''), lines = ref<RuntimeLogLine[]>([]), cursor = ref(0), firstCursor = ref(0), hasEarlier = ref(false)
const streamChosenManually = ref(false)
const sortedStreams = computed(() => [...(detail.value?.streams || [])].sort((a, b) => {
  const stamp = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity
  return stamp(b.updatedAt) - stamp(a.updatedAt) || a.streamId.localeCompare(b.streamId)
}))
const follow = ref(true), search = ref(''), errorsOnly = ref(false), consoleBox = ref<HTMLElement>()
const runtimeId = computed(() => typeof route.query.runtimeId === 'string' ? route.query.runtimeId : '')
const queryText = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const processContext = computed(() => !!queryText('processPid'))
const scopeKey = computed(() => JSON.stringify(['runtimeId', 'recordId', 'runnerId', 'assignmentId', 'processPid', 'processSlot', 'kind', 'serverId'].map(queryText)))
let loadedScope = ''
const programError = computed(() => {
  if (!detail.value || !(detail.value.status === 'failed' || detail.value.status === 'paused' || (detail.value.run?.exit_code ?? 0) !== 0)) return ''
  // Use unfiltered output so searching or filtering cannot hide the failure cause.
  return [...lines.value].reverse().find(line => /(?:\b[\w.]+(?:Error|Exception)\s*:|^Error\s*:|^Exception\s*:)/.test(line.text.trim()))?.text.trim() || ''
})
const visibleLines = computed(() => lines.value.filter(line => (!search.value || line.text.toLowerCase().includes(search.value.toLowerCase())) && (!errorsOnly.value || /error|exception|traceback|失败|错误|异常/i.test(line.text))))
// Bounded window + virtual rows prevents growing the DOM while following long logs.
const scrollTop = ref(0), windowStart = computed(() => Math.max(0, Math.floor(scrollTop.value / 24) - 8))
const renderedLines = computed(() => visibleLines.value.slice(windowStart.value, windowStart.value + 50))
let active = true, initialized = false, listSeq = 0, detailSeq = 0, outputSeq = 0, timer: ReturnType<typeof setTimeout> | undefined
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
const time = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const statusLabel = (row: RuntimeLogRecord) => row.status === 'success' ? row.kind === 'delivery' ? '下发成功' : row.kind === 'start' ? '启动已确认' : '已停止' : statuses[row.status] || row.status
const statusType = (status: string) => status === 'failed' || status === 'paused' ? 'danger' : status === 'success' || status === 'running' ? 'success' : 'info'
function instanceContext(row: RuntimeLogRecord) {
  const machine = machines.value.find(item => item.runnerId === row.runnerId)
  // Preserve historical identity after an instance is renamed or removed.
  return {
    name: row.snapshot.runnerName || machine?.name || '',
    ip: row.snapshot.ipAddress || machine?.ipAddress || 'IP 未上报',
    directory: row.snapshot.installDirectory || machine?.installDirectory || '实例目录未上报',
  }
}
function stopPoll() { clearTimeout(timer); timer = undefined }
function poll() {
  stopPoll()
  if (active) timer = setTimeout(async () => { await load(true); poll() }, 3000)
}
async function load(background = false) {
  const seq = ++listSeq
  if (codeServerMode.value) { loading.value = false; return }
  if (!background) { loading.value = true; error.value = '' }
  try {
    const since = filters.period && filters.period !== 'all' ? new Date(Date.now() - Number(filters.period) * 3600000).toISOString() : ''
    const result = await runnerManagementApi.runtimeLogs({ keyword: filters.keyword, runnerId: filters.runnerId, kind: filters.kind, status: filters.status, page: filters.page, runtimeId: runtimeId.value || undefined,
      ...(processContext.value ? { assignmentId: queryText('assignmentId'), processPid: Number(queryText('processPid')), processSlot: Number(queryText('processSlot')) } : {}), since, pageSize: 20 })
    if (!active || seq !== listSeq) return
    rows.value = result.items; total.value = result.total; error.value = ''
    const requested = typeof route.query.recordId === 'string' ? route.query.recordId : ''
    const requestedRecord = result.items.find(row => row.recordId === requested)?.recordId
    if (!selected.value && (requestedRecord || result.items[0])) await select(requestedRecord || result.items[0]!.recordId)
    else if (selected.value) await loadDetail(selected.value, background)
  } catch (e) { if (active && seq === listSeq) error.value = problem(e) }
  finally { if (seq === listSeq) loading.value = false }
}
async function refresh() { stopPoll(); await load(); poll() }
function resetSelection() {
  ++detailSeq; ++outputSeq; selected.value = ''; detail.value = null; rows.value = []; total.value = 0
  detailError.value = ''; outputError.value = ''; outputNotice.value = ''; streamId.value = ''; streamChosenManually.value = false; lines.value = []
  detailLoading.value = false; outputLoading.value = false; cursor.value = 0; firstCursor.value = 0; hasEarlier.value = false
}
async function query() { filters.page = 1; resetSelection(); await refresh() }
function applyScope() {
  loadedScope = scopeKey.value
  search.value = ''; errorsOnly.value = false; follow.value = true
  Object.assign(filters, { keyword: '', runnerId: queryText('runnerId'), kind: queryText('kind') === 'code-server' ? 'code-server' : processContext.value ? 'run' : '', status: '', period: processContext.value ? 'all' : '24', page: 1 })
  resetSelection()
}
async function select(id: string) {
  selected.value = id; detail.value = null; streamId.value = ''; streamChosenManually.value = false; lines.value = []; cursor.value = 0; firstCursor.value = 0
  ++outputSeq; detailError.value = ''; outputError.value = ''; outputNotice.value = ''; hasEarlier.value = false; follow.value = true; tab.value = processContext.value ? 'output' : 'events'; scrollTop.value = 0
  await loadDetail(id)
}
async function loadDetail(id: string, background = false) {
  const seq = ++detailSeq
  if (!background) detailLoading.value = true
  try {
    const item = await runnerManagementApi.runtimeLogDetail(id)
    if (!active || seq !== detailSeq || selected.value !== id) return
    detail.value = item; detailError.value = ''
    if (!item.streams.some(stream => stream.streamId === streamId.value)) streamChosenManually.value = false
    const nextStream = streamChosenManually.value ? streamId.value : sortedStreams.value[0]?.streamId || ''
    if (nextStream !== streamId.value) await switchStream(nextStream)
    else if ((!background || follow.value) && streamId.value) await output()
  } catch (e) { if (active && seq === detailSeq && selected.value === id) detailError.value = problem(e) }
  finally { if (seq === detailSeq) detailLoading.value = false }
}
async function switchStream(id: string) {
  ++outputSeq; outputLoading.value = false; outputError.value = ''; outputNotice.value = ''
  streamId.value = id; lines.value = []; cursor.value = 0; firstCursor.value = 0; hasEarlier.value = false; scrollTop.value = 0
  await output()
}
function selectStream(value: unknown) {
  if (typeof value === 'string' && detail.value?.streams.some(stream => stream.streamId === value)) {
    streamChosenManually.value = true
    void switchStream(value)
  }
}
async function output(earlier = false) {
  if (!streamId.value) return
  const id = streamId.value, seq = ++outputSeq
  outputLoading.value = true
  try {
    const result = await runnerManagementApi.runtimeLogEntries(id, earlier ? 0 : cursor.value, earlier ? firstCursor.value : 0)
    if (!active || id !== streamId.value || seq !== outputSeq) return
    const joined = earlier ? [...result.entries, ...lines.value] : [...lines.value, ...result.entries]
    const seen = new Set<string>()
    lines.value = joined.filter(line => { const key = `${line.seq}:${line.index}`; if (seen.has(key)) return false; seen.add(key); return true }).slice(earlier ? 0 : -5000, earlier ? 5000 : undefined)
    if (!earlier) cursor.value = result.cursor
    firstCursor.value = lines.value[0]?.seq || result.firstCursor
    hasEarlier.value = result.earliestSeq !== undefined ? result.earliestSeq > 0 && firstCursor.value > result.earliestSeq : result.hasEarlier || firstCursor.value > 1
    outputNotice.value = result.expired ? '程序输出已按日志保留期限清理。' : (result.earliestSeq || 0) > 1 ? '较早输出已按日志保留期限清理。' : ''
    outputError.value = ''
    await nextTick()
    if (follow.value && !earlier && consoleBox.value) consoleBox.value.scrollTop = consoleBox.value.scrollHeight
  } catch (e) { if (active && id === streamId.value && seq === outputSeq) outputError.value = problem(e) }
  finally { if (seq === outputSeq) outputLoading.value = false }
}
function scrolled(e: Event) {
  const element = e.target as HTMLElement
  scrollTop.value = element.scrollTop
  if (element.scrollHeight - element.scrollTop - element.clientHeight > 60) follow.value = false
}
// 复制统一走 utils/clipboard：部署站是 http，navigator.clipboard 不可用，要靠它的同步兜底
async function copy() {
  await copyToClipboard(visibleLines.value.map(line => `${time(line.time)} ${line.text}`).join('\n'), '当前日志')
}
async function download() {
  if (!streamId.value || downloading.value) return
  downloading.value = true
  try {
    const result = await runnerManagementApi.downloadRuntimeLog(streamId.value)
    const url = URL.createObjectURL(new Blob([result.content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.name; anchor.click(); URL.revokeObjectURL(url)
  } catch (e) { outputError.value = problem(e) }
  finally { downloading.value = false }
}
function clearBinding() { void router.replace({ path: '/settings', query: { tab: 'runtime-logs' } }) }
async function changeInstance(value: unknown) {
  if (runtimeId.value || processContext.value || queryText('recordId') || queryText('assignmentId')) {
    // Switching Runner leaves the previous process/binding scope entirely.
    await router.replace({ path: '/settings', query: { tab: 'runtime-logs', ...(typeof value === 'string' && value ? { runnerId: value } : {}) } })
  } else {
    await query()
  }
}
async function openSettings() {
  settingsOpen.value = true; settingsLoading.value = true; settingsError.value = ''
  try { settings.value = await runnerManagementApi.runtimeLogPolicy() } catch (e) { settingsError.value = problem(e) }
  finally { settingsLoading.value = false }
}
async function saveSettings() {
  settingsSaving.value = true; settingsError.value = ''
  try { settings.value = await runnerManagementApi.saveRuntimeLogPolicy(settings.value); settingsOpen.value = false; ElMessage.success('日志设置已保存') }
  catch (e) { settingsError.value = problem(e) }
  finally { settingsSaving.value = false }
}
async function initialize() {
  applyScope()
  try { machines.value = await runnerManagementApi.instances() } catch { /* records remain queryable when inventory is unavailable */ }
  await refresh(); initialized = true
}
watch(scopeKey, () => { if (initialized && active) { applyScope(); void query() } })
watch([search, errorsOnly], () => { scrollTop.value = 0; if (consoleBox.value) consoleBox.value.scrollTop = 0 })
onMounted(() => { void initialize() })
onActivated(() => { active = true; if (initialized) { if (loadedScope !== scopeKey.value) applyScope(); void refresh() } })
onDeactivated(() => { active = false; stopPoll(); ++listSeq; ++detailSeq; ++outputSeq })
onUnmounted(() => { active = false; stopPoll(); ++listSeq; ++detailSeq; ++outputSeq })
</script>

<template>
  <section class="rl-page" data-testid="settings-runtime-logs">
    <div class="rl-filters">
      <el-input v-if="!codeServerMode" v-model="filters.keyword" clearable :prefix-icon="Search" placeholder="部署名称、流程节点、配置 ID 或 MQ" aria-label="搜索运行日志" @keyup.enter="query" />
      <el-select v-if="!codeServerMode" v-model="filters.runnerId" filterable clearable placeholder="全部实例" aria-label="日志实例" @change="changeInstance">
        <el-option v-for="machine in machines" :key="machine.runnerId" :value="machine.runnerId" :label="`${machine.ipAddress} · ${machine.installDirectory} · ${machine.runnerId} · ${machine.name}`" class="rl-instance-option">
          <strong>{{ machine.ipAddress }} · {{ machine.name }}</strong><small>{{ machine.installDirectory }}</small><small>实例 ID：{{ machine.runnerId }}</small>
        </el-option>
      </el-select>
      <el-select v-model="filters.kind" :disabled="processContext" placeholder="全部类型" aria-label="日志类型" @change="query"><el-option label="全部类型" value="" /><el-option v-for="(label, key) in kinds" :key="key" :value="key" :label="label" /><el-option label="代码生成服务" value="code-server" /></el-select>
      <el-select v-if="!codeServerMode" v-model="filters.status" placeholder="全部结果" aria-label="日志结果" @change="query"><el-option label="全部结果" value="" /><el-option v-for="(label, key) in statuses" :key="key" :value="key" :label="label" /></el-select>
      <el-select v-if="!codeServerMode" v-model="filters.period" aria-label="日志时间范围" @change="query"><el-option label="最近 24 小时" value="24" /><el-option label="最近 7 天" value="168" /><el-option label="全部时间" value="all" /></el-select>
      <template v-if="!codeServerMode"><el-button :icon="Search" aria-label="查询运行日志" @click="query" /><el-button :icon="Refresh" circle :loading="loading" aria-label="刷新运行日志" @click="refresh" /></template>
      <el-button v-if="!codeServerMode && auth.role === 'admin'" link @click="openSettings">日志设置</el-button>
    </div>
    <div v-if="processContext" class="rl-context" data-testid="process-log-context">当前进程：PID {{ queryText('processPid') }} · 并发 {{ Number(queryText('processSlot')) + 1 }} · 实例 ID：{{ queryText('runnerId') }}<el-button link @click="changeInstance(queryText('runnerId'))">查看实例日志</el-button><el-button link @click="clearBinding">查看全部日志</el-button></div>
    <div v-else-if="runtimeId" class="rl-context">当前绑定：{{ detail?.snapshot.name || runtimeId }}<el-button link @click="clearBinding">查看全部绑定</el-button></div>
    <el-alert v-if="error" :title="`日志查询失败：${error}`" type="error" :closable="false" show-icon />
    <CodeServerLogsPanel v-if="codeServerMode" />
    <div v-else class="rl-workspace">
      <aside class="rl-records" v-loading="loading">
        <header><strong>{{ processContext ? '当前进程运行记录' : '下发与运行记录' }}</strong><span>{{ total }} 条</span></header>
        <div class="rl-record-list">
          <button v-for="row in rows" :key="row.recordId" class="rl-record" :class="{ active: selected === row.recordId }" type="button" data-testid="log-record" @click="select(row.recordId)">
            <span class="rl-record-top"><b>{{ kinds[row.kind] }}</b><el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row) }}</el-tag></span>
            <strong>{{ row.snapshot.name || '未关联部署配置' }}</strong>
            <small>{{ instanceContext(row).ip }}<template v-if="instanceContext(row).name"> · {{ instanceContext(row).name }}</template></small>
            <small class="rl-record-directory" data-testid="log-record-directory" :title="instanceContext(row).directory">{{ instanceContext(row).directory }}</small>
            <small class="rl-instance-id" data-testid="log-record-instance-id">实例 ID：{{ row.runnerId || '未上报' }}</small>
            <small>{{ row.snapshot.sourceNode?.nodeName || row.snapshot.entryPoint || row.snapshot.directoryTemplate }}</small><small>{{ time(row.requestedAt) }}</small>
            <span v-if="row.error" class="rl-error-summary" :title="row.error">{{ row.error }}</span>
          </button>
          <el-empty v-if="!loading && !rows.length" :image-size="50" :description="filters.period !== 'all' ? '当前时间范围内暂无记录，可切换「全部时间」查看历史日志' : processContext ? '当前进程暂无符合条件的日志，请检查筛选条件或等待 Runner 上报' : '暂无符合条件的记录；新的下发和启动会生成日志'" />
        </div>
        <el-pagination v-model:current-page="filters.page" size="small" layout="prev, pager, next" :total="total" :page-size="20" @current-change="refresh" />
      </aside>
      <div class="rl-detail" v-loading="detailLoading">
        <el-alert v-if="detailError" :title="detailError" type="error" :closable="false" /><el-empty v-else-if="!detail" description="选择一条记录查看日志" />
        <template v-if="detail">
          <header class="rl-detail-header"><div><strong>{{ kinds[detail.kind] }} · {{ detail.snapshot.name || '运行详情' }}</strong><small>{{ instanceContext(detail).ip }} · {{ instanceContext(detail).directory }}</small><small class="rl-instance-id" data-testid="log-detail-instance-id">Runner 实例 ID：{{ detail.runnerId || '未上报' }}<template v-if="detail.run?.pid"> · PID：{{ detail.run.pid }} · 并发：{{ detail.run.slot + 1 }}</template></small></div><el-tag :type="statusType(detail.status)">{{ statusLabel(detail) }}</el-tag></header>
          <el-alert v-if="detail.error" :title="detail.error" type="error" :closable="false" />
          <el-alert v-if="programError" :title="`程序错误：${programError}`" type="error" :closable="false" show-icon data-testid="program-error"><el-button link type="danger" @click="tab = 'output'">查看完整程序输出</el-button></el-alert>
          <el-alert v-if="detail.status === 'unknown'" :title="`运行状态未确认，最后心跳：${formatRunnerHeartbeat(detail.lastHeartbeat)}（北京时间）`" type="warning" :closable="false" />
          <div v-if="detail.runs.length" class="rl-instances"><span>启动实例</span><el-button v-for="run in detail.runs" :key="run.recordId" size="small" @click="select(run.recordId)">{{ time(run.requestedAt) }} · {{ statuses[run.status] }}</el-button></div>
          <nav class="rl-tabs" role="tablist" aria-label="日志详情"><button v-for="item in tabs" :id="`log-tab-${item.key}`" :key="item.key" type="button" role="tab" :aria-selected="tab === item.key" :class="{ active: tab === item.key }" @click="tab = item.key">{{ item.label }}</button></nav>
          <div v-if="tab === 'events'" class="rl-body" role="tabpanel" aria-labelledby="log-tab-events">
            <article v-for="event in detail.events" :key="event.eventId" class="rl-event" :class="{ 'is-error': event.level === 'error' }"><div><time>{{ time(event.time) }}</time><span>{{ stages[event.stage] || event.stage }}</span></div><p>{{ event.message }}</p><pre v-if="event.detail">{{ event.detail }}</pre></article>
            <el-empty v-if="!detail.events.length" description="暂无阶段日志" />
          </div>
          <div v-else-if="tab === 'output'" class="rl-output" role="tabpanel" aria-labelledby="log-tab-output">
            <div class="rl-output-tools"><el-input v-model="search" clearable placeholder="搜索已加载日志" aria-label="搜索程序输出" /><el-checkbox v-model="errorsOnly">错误关键词</el-checkbox><el-checkbox v-model="follow" @change="follow && output()">跟随最新</el-checkbox><el-button link :disabled="!streamId || outputLoading" @click="output()">刷新</el-button><el-button link :disabled="!lines.length" @click="copy">复制</el-button><el-button :icon="Download" link :disabled="!streamId" :loading="downloading" @click="download">下载</el-button></div>
            <el-select v-if="detail.streams.length > 1" :model-value="streamId" aria-label="选择日志流" @update:model-value="selectStream"><el-option v-for="(stream, index) in sortedStreams" :key="stream.streamId" :value="stream.streamId" :label="`${stream.streamId} · ${time(stream.updatedAt)}${index === 0 ? ' · 最新' : ''}`" /></el-select>
            <el-alert v-if="outputError" :title="outputError" type="error" :closable="false" />
            <div class="rl-output-note"><span>{{ outputNotice || `显示已加载的 ${lines.length} 行；检索范围为当前窗口，错误关键词不代表执行结果。` }}</span><el-button v-if="hasEarlier" link :disabled="outputLoading" @click="follow = false; output(true)">加载更早日志</el-button></div>
            <div v-if="streamId" ref="consoleBox" class="rl-console" data-testid="log-console" @scroll="scrolled"><div :style="{ height: `${visibleLines.length * 24}px`, position: 'relative' }"><div class="rl-console-window" :style="{ transform: `translateY(${windowStart * 24}px)` }"><div v-for="line in renderedLines" :key="`${line.seq}:${line.index}`" class="rl-line" :title="line.text"><time>{{ time(line.time) }}</time><code>{{ line.text }}</code></div></div></div></div>
            <el-empty v-else :image-size="60" :description="detail.logAvailable === false ? '此 Runner 未上报日志能力，请先升级 Runner' : detail.kind === 'start' ? '选择上方启动实例查看程序输出' : '尚无已上传输出；请查看执行过程或等待 Runner 同步'" />
          </div>
          <div v-else-if="tab === 'results'" class="rl-body" role="tabpanel" aria-labelledby="log-tab-results"><el-empty description="业务结果未上报" /><p class="rl-result-note">当前记录反映下发和进程运行情况。处理程序接入任务结果上报后，才能显示任务成功、失败及输出数据数量。</p></div>
          <div v-else class="rl-body" role="tabpanel" aria-labelledby="log-tab-info">
            <dl class="rl-info"><dt>记录 ID</dt><dd>{{ detail.recordId }}</dd><dt>部署配置</dt><dd>{{ detail.snapshot.name || '—' }} · {{ detail.deploymentId || '—' }}</dd><dt>流程 / 节点</dt><dd>{{ detail.snapshot.sourceNode?.flowName || '—' }} / {{ detail.snapshot.sourceNode?.nodeName || '—' }}</dd><dt>配置 ID / MQ</dt><dd>{{ detail.snapshot.configId || '—' }} / {{ detail.snapshot.queue?.startsWith('@deployment:') ? '—' : detail.snapshot.queue || '—' }}</dd><dt>启动文件</dt><dd>{{ detail.run?.entry || detail.snapshot.entryPoint || '—' }}</dd><dt>工作目录</dt><dd>{{ detail.run?.working_directory || detail.snapshot.directoryTemplate || '—' }}</dd><dt>解释器</dt><dd>{{ detail.run?.interpreter || '—' }}</dd><dt>PID / 并发实例</dt><dd>{{ detail.run?.pid ?? '未产生或未上报' }} / {{ detail.run ? detail.run.slot + 1 : '—' }}</dd><dt>开始 / 结束</dt><dd>{{ time(detail.run?.started_at || detail.requestedAt) }} / {{ time(detail.run?.ended_at || detail.finishedAt) }}</dd><dt>退出码</dt><dd>{{ detail.run?.exit_code ?? '—' }}</dd><dt>部署修订</dt><dd>{{ detail.snapshot.revision || '—' }}</dd><dt>代码制品</dt><dd>{{ detail.snapshot.releaseDigest || '—' }}</dd><dt v-if="detail.snapshot.runnerVersion">Runner 版本</dt><dd v-if="detail.snapshot.runnerVersion">{{ detail.snapshot.runnerVersion }}</dd><dt v-if="detail.snapshot.scope">下发范围</dt><dd v-if="detail.snapshot.scope">{{ detail.snapshot.scope === 'selected' ? detail.snapshot.selectedPaths?.join('、') : '全部代码' }}</dd></dl>
            <article v-for="(source, index) in detail.snapshot.sources" :key="index" class="rl-source"><strong>{{ source.sourcePath || source.name }}</strong><small>仓库：{{ source.repoId || '—' }} · 目标：{{ source.targetPath || source.name || '—' }}</small><code>Git：{{ source.gitCommit || '—' }}</code></article>
          </div>
        </template>
      </div>
    </div>
    <el-drawer v-model="settingsOpen" title="日志设置" size="420px" :close-on-click-modal="!settingsSaving">
      <div v-loading="settingsLoading"><el-alert v-if="settingsError" :title="settingsError" type="error" :closable="false" /><el-form label-position="top"><el-form-item label="服务器日志目录"><el-input v-model="settings.directory" :disabled="settings.hasLogs || settingsSaving" /><small v-if="settings.hasLogs">已有日志，目录保持固定以便读取历史记录。</small></el-form-item><el-form-item label="日志保留天数"><el-input-number v-model="settings.retentionDays" :min="1" :max="365" :disabled="settingsSaving" /></el-form-item><el-form-item label="服务器日志容量（MB）"><el-input-number v-model="settings.quotaMb" :min="64" :max="1048576" :disabled="settingsSaving" /></el-form-item></el-form></div>
      <template #footer><el-button :disabled="settingsSaving" @click="settingsOpen = false">取消</el-button><el-button type="primary" :loading="settingsSaving" :disabled="settingsLoading || !settings.directory" @click="saveSettings">保存</el-button></template>
    </el-drawer>
  </section>
</template>

<style scoped>
.rl-page { display:flex; flex:1; min-height:0; flex-direction:column; gap:12px; }
.rl-instance-option { height:auto; line-height:1.5; padding-top:8px; padding-bottom:8px; }
.rl-instance-option strong,.rl-instance-option small { display:block; font-size:12px; }
.rl-instance-option small { color:var(--el-text-color-secondary); }
.rl-record small.rl-instance-id,.rl-record small.rl-record-directory { white-space:normal; overflow-wrap:anywhere; }
.rl-instance-id { font-family:var(--el-font-family); user-select:all; }
.rl-detail-header > div { min-width:0; }
.rl-detail-header > .el-tag { flex-shrink:0; }
.rl-filters { display:flex; gap:8px; align-items:center; padding:12px; border:1px solid var(--el-border-color-light); border-radius:10px; background:var(--el-bg-color); }
.rl-filters > .el-input { flex:1; min-width:170px; }.rl-filters > .el-select { width:130px; flex-shrink:0; }.rl-filters > .el-select:first-of-type { width:180px; }.rl-filters .el-button { margin-left:0; }
.rl-context { display:flex; align-items:center; gap:12px; font-size:12px; color:var(--el-text-color-secondary); }
.rl-workspace { display:grid; grid-template-columns:300px minmax(0,1fr); gap:12px; flex:1; min-height:0; }
.rl-records,.rl-detail { border:1px solid var(--el-border-color-light); border-radius:10px; background:var(--el-bg-color); min-height:0; overflow:hidden; display:flex; flex-direction:column; }
.rl-records > header { display:flex; justify-content:space-between; padding:14px; font-size:13px; }.rl-records > header span { color:var(--rc-muted); }.rl-record-list { flex:1; min-height:0; overflow:auto; }.rl-records > .el-pagination { padding:10px; justify-content:center; }
.rl-record { display:flex; flex-direction:column; gap:6px; border:0; border-top:1px solid var(--el-border-color-lighter); background:transparent; padding:12px 14px; width:100%; text-align:left; cursor:pointer; color:var(--el-text-color-primary); }.rl-record:hover,.rl-record.active { background:var(--el-color-primary-light-9); }.rl-record.active { box-shadow:inset 3px 0 var(--el-color-primary); }.rl-record strong { font-size:13px; }.rl-record small { font-size:11px; color:var(--rc-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.rl-record-top { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; }.rl-error-summary { color:var(--el-color-danger); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rl-detail-header { padding:14px 16px; display:flex; gap:12px; align-items:center; justify-content:space-between; }.rl-detail-header strong { font-size:14px; }.rl-detail-header small { display:block; margin-top:6px; color:var(--rc-muted); font-size:12px; overflow-wrap:anywhere; }.rl-detail > .el-alert { flex-shrink:0; }.rl-tabs { display:flex; gap:6px; padding:0 12px; border-bottom:1px solid var(--el-border-color-light); }.rl-tabs button { padding:10px 12px; cursor:pointer; border:0; background:transparent; color:var(--el-text-color-secondary); }.rl-tabs button.active { color:var(--el-color-primary); box-shadow:inset 0 -2px var(--el-color-primary); }.rl-tabs button:focus-visible { outline:2px solid var(--el-color-primary); outline-offset:-2px; }
.rl-body { flex:1; min-height:0; padding:16px; overflow:auto; }.rl-event { padding:0 0 14px 12px; margin-bottom:14px; border-left:2px solid var(--el-border-color); }.rl-event.is-error { border-color:var(--el-color-danger); }.rl-event > div { display:flex; gap:12px; font-size:11px; color:var(--rc-muted); }.rl-event p { margin:8px 0; font-size:13px; overflow-wrap:anywhere; }.rl-event pre { margin:8px 0 0; padding:10px; border-radius:6px; background:var(--el-fill-color-light); white-space:pre-wrap; overflow-wrap:anywhere; font-size:12px; line-height:1.6; }.rl-instances { padding:0 12px 10px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; font-size:12px; }.rl-instances .el-button { margin:0; }
.rl-output { display:flex; flex-direction:column; flex:1; min-height:0; padding:12px; gap:10px; }.rl-output-tools { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }.rl-output-tools .el-input { flex:1; min-width:130px; }.rl-output-tools .el-button { margin:0; }.rl-output-note { display:flex; gap:8px; justify-content:space-between; align-items:center; font-size:11px; color:var(--rc-muted); }.rl-console { flex:1; min-height:120px; overflow:auto; background:var(--el-fill-color-light); border-radius:6px; }.rl-console-window { position:absolute; inset:0 0 auto; }.rl-line { display:flex; height:24px; align-items:center; padding:0 10px; gap:12px; font-size:12px; white-space:pre; min-width:max-content; }.rl-line time { color:var(--rc-muted); font-size:11px; flex-shrink:0; }.rl-info { display:grid; grid-template-columns:110px minmax(0,1fr); gap:12px; margin:0; font-size:12px; }.rl-info dt { color:var(--rc-muted); }.rl-info dd { margin:0; overflow-wrap:anywhere; }.rl-source { margin-top:16px; display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--el-border-color-light); padding-top:12px; font-size:12px; overflow-wrap:anywhere; }.rl-source small,.rl-result-note { color:var(--rc-muted); }.rl-result-note { text-align:center; font-size:12px; line-height:1.7; }
@media(max-width:1100px) { .rl-filters { flex-wrap:wrap; }.rl-workspace { grid-template-columns:250px minmax(0,1fr); }.rl-filters > .el-select { width:120px; }.rl-filters > .el-select:first-of-type { width:150px; } }
</style>
