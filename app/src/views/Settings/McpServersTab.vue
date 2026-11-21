<script setup lang="ts">
// MCP 服务管理（1118 需求原型落地）：系统设置页内 tab，紧跟「智能体资源」。
// 列表是卡片网格（接入数量级小、筛选在前端做），详情走右侧抽屉，接入/编辑走居中弹窗（短流程编辑）。
// 用户明确要求不接 mock（2026-11-18）：后端未就绪时列表区原样展示真实接口错误。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import {
  fetchMcpServerList,
  fetchMcpServerDetail,
  saveMcpServer,
  deleteMcpServer,
  changeMcpServerStatus,
  probeMcpServer,
  probeAllMcpServers,
  type McpServerItem,
  type McpServerDetail,
  type McpServerForm,
  type McpTransport,
} from '@/api/mcp'
import { timeAgo } from '@/utils/format/relativeTime'

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')

/* ── 列表与筛选 ── */
const servers = ref<McpServerItem[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')
const filterReachable = ref<'all' | 'online' | 'offline'>('all')
const filterTransport = ref<'all' | McpTransport>('all')

const TRANSPORT_LABELS: Record<McpTransport, string> = { stdio: 'stdio', streamableHttp: 'streamableHttp', sse: 'sse' }
const transportLabel = (t: McpTransport) => TRANSPORT_LABELS[t] ?? t

const counts = computed(() => {
  const all = servers.value
  return {
    all: all.length,
    online: all.filter((s) => s.lastReachable === true).length,
    offline: all.filter((s) => s.lastReachable === false).length,
    stdio: all.filter((s) => s.transport === 'stdio').length,
    streamableHttp: all.filter((s) => s.transport === 'streamableHttp').length,
    sse: all.filter((s) => s.transport === 'sse').length,
  }
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return servers.value.filter((s) => {
    if (filterReachable.value === 'online' && s.lastReachable !== true) return false
    if (filterReachable.value === 'offline' && s.lastReachable !== false) return false
    if (filterTransport.value !== 'all' && s.transport !== filterTransport.value) return false
    if (kw && ![s.name, s.description, String(s.id)].join(' ').toLowerCase().includes(kw)) return false
    return true
  })
})

function reachableText(s: McpServerItem): string {
  if (s.lastReachable === null) return '未测试'
  return s.lastReachable ? '在线' : '离线'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    servers.value = await fetchMcpServerList()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/* ── 连通测试 ── */
const probingId = ref<number | null>(null)
const probingAll = ref(false)

async function probe(row: McpServerItem) {
  if (probingId.value !== null || probingAll.value) return
  probingId.value = row.id
  try {
    const res = await probeMcpServer(row.id)
    ElMessage.success(
      `「${row.name}」连通正常${typeof res.toolCount === 'number' ? `，已同步 ${res.toolCount} 个工具` : ''}`,
    )
  } catch (e) {
    ElMessage.error(`「${row.name}」连通测试失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    probingId.value = null
    await load()
    if (drawerOpen.value && detail.value?.id === row.id) await loadDetail(row.id)
  }
}

async function probeAll() {
  if (probingAll.value || probingId.value !== null) return
  probingAll.value = true
  try {
    await probeAllMcpServers()
    ElMessage.success('全部连通测试完成')
  } catch (e) {
    ElMessage.error(`批量连通测试失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    probingAll.value = false
    await load()
  }
}

/* ── 启停（轻量开关 + 被引用停用二次确认） ── */
const statusSavingId = ref<number | null>(null)

async function toggleEnabled(row: McpServerItem): Promise<boolean> {
  if (!canWrite.value || statusSavingId.value !== null || loading.value || saving.value) return false
  let confirmed = false
  if (row.enabled && row.usedByCount > 0) {
    try {
      await ElMessageBox.confirm(
        `「${row.name}」正被 ${row.usedByCount} 处引用，停用后引用它的智能体调用会失败。确定停用？`,
        '停用 MCP 服务',
        { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' },
      )
      confirmed = true
    } catch {
      return false
    }
  }
  statusSavingId.value = row.id
  error.value = ''
  try {
    await changeMcpServerStatus(row.id, !row.enabled, confirmed)
    ElMessage.success(row.enabled ? '服务已停用' : '服务已启用')
    await load()
    if (drawerOpen.value && detail.value?.id === row.id) await loadDetail(row.id)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    statusSavingId.value = null
  }
  // 状态以服务端回执 + 重新拉取为准，开关不在本地先翻转
  return false
}

/* ── 详情抽屉 ── */
const drawerOpen = ref(false)
const detail = ref<McpServerDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')

async function loadDetail(id: number) {
  detailLoading.value = true
  detailError.value = ''
  try {
    detail.value = await fetchMcpServerDetail(id)
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : String(e)
  } finally {
    detailLoading.value = false
  }
}

function openDetail(row: McpServerItem) {
  drawerOpen.value = true
  detail.value = null
  void loadDetail(row.id)
}

const detailEnvEntries = computed(() => Object.entries(detail.value?.env ?? {}))
const detailHeaderEntries = computed(() => Object.entries(detail.value?.headers ?? {}))

async function removeDetail() {
  const row = detail.value
  if (!row || !canWrite.value || saving.value) return
  try {
    await ElMessageBox.confirm(
      `确定删除「${row.name}」？删除为逻辑删除，已同步的 ${row.toolCount} 个工具会标记 stale 保留审计` +
        (row.usedByCount > 0 ? `；它仍被 ${row.usedByCount} 处引用，删除后引用方调用会失败` : '') +
        '。',
      '删除 MCP 服务',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    await deleteMcpServer(row.id)
    ElMessage.success('MCP 服务已删除')
    drawerOpen.value = false
    await load()
  } catch (e) {
    detailError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

/* ── 接入 / 编辑弹窗（表单 + JSON 两种模式；编辑只用表单） ── */
const editorOpen = ref(false)
const editorMode = ref<'form' | 'json'>('form')
const saving = ref(false)
const editorError = ref('')

interface EditorForm {
  id?: number
  name: string
  description: string
  transport: McpTransport
  timeoutSeconds: number
  enabled: boolean
  command: string
  argsText: string
  envText: string
  url: string
  headersText: string
}

const emptyForm = (): EditorForm => ({
  id: undefined,
  name: '',
  description: '',
  transport: 'stdio',
  timeoutSeconds: 60,
  enabled: true,
  command: '',
  argsText: '',
  envText: '',
  url: '',
  headersText: '',
})

const form = reactive<EditorForm>(emptyForm())
const jsonText = ref('')
const jsonName = ref('')

function openAdd() {
  if (!canWrite.value) return
  Object.assign(form, emptyForm())
  jsonText.value = ''
  jsonName.value = ''
  editorMode.value = 'form'
  editorError.value = ''
  editorOpen.value = true
}

function openEdit() {
  const d = detail.value
  if (!d || !canWrite.value) return
  Object.assign(form, emptyForm(), {
    id: d.id,
    name: d.name,
    description: d.description,
    transport: d.transport,
    timeoutSeconds: d.timeoutSeconds,
    enabled: d.enabled,
    command: d.command ?? '',
    argsText: (d.args ?? []).join('\n'),
    url: d.url ?? '',
    // envText / headersText 留空 = 不修改已保存的脱敏值；填写则整组替换
  })
  editorMode.value = 'form'
  editorError.value = ''
  editorOpen.value = true
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** KEY=VALUE 每行一个 → 对象；行格式错误时给出第一个错误 */
function parseKvText(text: string): { map: Record<string, string>; error?: string } {
  const map: Record<string, string> = {}
  for (const line of splitLines(text)) {
    const i = line.indexOf('=')
    if (i <= 0) return { map, error: `「${line}」不是 KEY=VALUE 格式` }
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { map }
}

function buildFormPayload(): McpServerForm | string {
  const name = form.name.trim()
  if (!name) return '请填写服务名称'
  const payload: McpServerForm = {
    name,
    description: form.description.trim(),
    transport: form.transport,
    timeoutSeconds: form.timeoutSeconds,
    enabled: form.enabled,
  }
  if (form.id) payload.id = form.id
  if (form.transport === 'stdio') {
    const command = form.command.trim()
    if (!command) return 'stdio 服务需填写启动命令'
    payload.command = command
    payload.args = splitLines(form.argsText)
    const env = parseKvText(form.envText)
    if (env.error) return `环境变量：${env.error}`
    // 编辑时留空 = 不修改已保存值
    if (!form.id || form.envText.trim()) payload.env = env.map
  } else {
    const url = form.url.trim()
    if (!url) return '请填写服务地址'
    if (!/^https?:\/\//i.test(url)) return '服务地址需以 http:// 或 https:// 开头'
    payload.url = url
    const headers = parseKvText(form.headersText)
    if (headers.error) return `请求头：${headers.error}`
    if (!form.id || form.headersText.trim()) payload.headers = headers.map
  }
  return payload
}

/** JSON 模式：支持 Claude Desktop 风格 {"mcpServers": {name: {...}}} 或单个服务对象 */
function buildJsonPayload(): McpServerForm | string {
  const text = jsonText.value.trim()
  if (!text) return '请粘贴 JSON 配置'
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'JSON 需为对象'
  let obj = raw as Record<string, unknown>
  let name = jsonName.value.trim()
  const servers = obj.mcpServers
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    const entries = Object.entries(servers as Record<string, unknown>)
    if (!entries.length) return 'mcpServers 为空'
    const picked = (name && entries.find(([k]) => k === name)) || entries[0]!
    if (!name) name = picked[0]
    const v = picked[1]
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `服务「${picked[0]}」的配置需为对象`
    obj = v as Record<string, unknown>
  }
  if (!name) name = String(obj.name ?? '').trim()
  if (!name) return '缺少服务名称（在 JSON 中提供 name 键，或在下方覆盖名称）'

  const t = obj.transport ?? obj.type
  let transport: McpTransport | undefined
  if (t === 'stdio' || t === 'sse' || t === 'streamableHttp' || t === 'streamable-http') {
    transport = t === 'streamable-http' ? 'streamableHttp' : t
  } else if (t === 'http') {
    transport = 'streamableHttp'
  } else if (typeof obj.command === 'string') {
    transport = 'stdio'
  } else if (typeof obj.url === 'string' || typeof obj.serverUrl === 'string') {
    transport = 'streamableHttp'
  }
  if (!transport) return '无法识别传输方式（transport/type 需为 stdio / streamableHttp / sse，或按 command/url 自动判断）'

  const payload: McpServerForm = {
    name,
    description: String(obj.description ?? obj.desc ?? ''),
    transport,
    enabled: true,
  }
  const timeout = Number(obj.timeoutSeconds ?? obj.timeout)
  if (Number.isFinite(timeout) && timeout > 0) payload.timeoutSeconds = timeout
  if (transport === 'stdio') {
    const command = String(obj.command ?? '').trim()
    if (!command) return 'stdio 服务缺少 command'
    payload.command = command
    if (Array.isArray(obj.args)) payload.args = obj.args.map(String)
    else if (typeof obj.args === 'string') payload.args = splitLines(obj.args)
    if (obj.env && typeof obj.env === 'object' && !Array.isArray(obj.env)) {
      payload.env = Object.fromEntries(Object.entries(obj.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    }
  } else {
    const url = String(obj.url ?? obj.serverUrl ?? '').trim()
    if (!url) return 'HTTP 服务缺少 url'
    if (!/^https?:\/\//i.test(url)) return '服务地址需以 http:// 或 https:// 开头'
    payload.url = url
    if (obj.headers && typeof obj.headers === 'object' && !Array.isArray(obj.headers)) {
      payload.headers = Object.fromEntries(Object.entries(obj.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    }
  }
  return payload
}

function formatJson() {
  try {
    jsonText.value = JSON.stringify(JSON.parse(jsonText.value), null, 2)
    editorError.value = ''
  } catch (e) {
    editorError.value = `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`
  }
}

async function save() {
  if (!canWrite.value || saving.value) return
  const payload = form.id || editorMode.value === 'form' ? buildFormPayload() : buildJsonPayload()
  if (typeof payload === 'string') {
    editorError.value = payload
    return
  }
  saving.value = true
  editorError.value = ''
  try {
    await saveMcpServer(payload)
    ElMessage.success(form.id ? 'MCP 服务已保存' : 'MCP 服务已接入')
    const editedId = form.id
    editorOpen.value = false
    await load()
    if (editedId && drawerOpen.value && detail.value?.id === editedId) await loadDetail(editedId)
  } catch (e) {
    editorError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="mcp-page" v-loading="loading">
    <div class="mcp-head">
      <div class="mcp-head-text">
        <h2>MCP 服务</h2>
        <p>管理智能体可调用的 MCP 工具服务：接入、连通测试、启停与工具清单同步。</p>
      </div>
      <div class="mcp-head-actions">
        <el-button :loading="probingAll" :disabled="loading || probingId !== null" data-testid="mcp-probe-all" @click="probeAll">全部连通测试</el-button>
        <el-button v-if="canWrite" type="primary" :disabled="loading" data-testid="mcp-add" @click="openAdd">接入 MCP</el-button>
        <el-button :disabled="loading" data-testid="mcp-refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="mcp-filters">
      <div class="mcp-chips" role="group" aria-label="连通状态筛选">
        <button
          v-for="c in [
            { key: 'all', label: '全部', count: counts.all },
            { key: 'online', label: '在线', count: counts.online },
            { key: 'offline', label: '离线', count: counts.offline },
          ]"
          :key="c.key"
          type="button"
          class="mcp-chip"
          :class="{ active: filterReachable === c.key }"
          @click="filterReachable = c.key as 'all' | 'online' | 'offline'"
        >
          {{ c.label }} <span class="mcp-chip-count">{{ c.count }}</span>
        </button>
      </div>
      <div class="mcp-chips" role="group" aria-label="传输方式筛选">
        <button
          v-for="c in [
            { key: 'stdio', count: counts.stdio },
            { key: 'streamableHttp', count: counts.streamableHttp },
            { key: 'sse', count: counts.sse },
          ]"
          :key="c.key"
          class="mcp-chip"
          :class="{ active: filterTransport === c.key }"
          @click="filterTransport = filterTransport === c.key ? 'all' : (c.key as McpTransport)"
        >
          {{ c.key }} <span class="mcp-chip-count">{{ c.count }}</span>
        </button>
      </div>
      <el-input v-model="keyword" class="mcp-search" placeholder="搜索名称或描述" clearable data-testid="mcp-search" />
    </div>

    <p v-if="error" class="mcp-error" role="alert">{{ error }}</p>
    <div v-if="!loading && !filtered.length && !error" class="mcp-empty">
      {{ servers.length ? '没有匹配的 MCP 服务，调整筛选条件试试' : '尚未接入 MCP 服务，点击右上角「接入 MCP」开始' }}
    </div>

    <div class="mcp-grid">
      <article
        v-for="s in filtered"
        :key="s.id"
        class="mcp-card"
        :class="{ 'is-down': s.lastReachable === false }"
        :data-testid="`mcp-card-${s.id}`"
        @click="openDetail(s)"
      >
        <div class="mcp-card-top">
          <div class="mcp-card-title">
            <b>{{ s.name }}</b>
            <span class="mcp-card-sub">{{ transportLabel(s.transport) }} · #{{ s.id }}</span>
          </div>
          <div class="mcp-pills">
            <span
              class="mcp-pill"
              :class="s.lastReachable === null ? 'mcp-pill-grey' : s.lastReachable ? 'mcp-pill-ok' : 'mcp-pill-down'"
            >{{ reachableText(s) }}</span>
            <span class="mcp-pill mcp-pill-grey">{{ s.enabled ? '已启用' : '已停用' }}</span>
          </div>
        </div>
        <p class="mcp-card-desc" :class="{ 'is-error': s.lastReachable === false && !!s.lastError }">
          {{ s.lastReachable === false && s.lastError ? `最近连通测试失败：${s.lastError}` : s.description || '—' }}
        </p>
        <div class="mcp-card-metrics">
          <span>工具 <b>{{ s.toolCount }}</b></span>
          <span>超时 <b>{{ s.timeoutSeconds }}s</b></span>
          <span>被引用 <b>{{ s.usedByCount }}</b></span>
          <span>连通测试 {{ timeAgo(s.lastProbeAt) }}</span>
        </div>
        <div class="mcp-card-actions" @click.stop>
          <el-button link type="primary" :loading="probingId === s.id" :disabled="probingAll" :data-testid="`mcp-probe-${s.id}`" @click="probe(s)">连通测试</el-button>
          <el-switch
            :model-value="s.enabled"
            :loading="statusSavingId === s.id"
            :disabled="!canWrite || loading || saving || statusSavingId !== null || probingAll"
            :before-change="() => toggleEnabled(s)"
            :aria-label="`${s.name}启用状态`"
            :data-testid="`mcp-toggle-${s.id}`"
          />
        </div>
      </article>
    </div>

    <el-drawer v-model="drawerOpen" :title="detail?.name ?? 'MCP 服务详情'" size="min(640px, 94vw)" data-testid="mcp-detail-drawer">
      <div v-loading="detailLoading" class="mcp-detail">
        <p v-if="detailError" class="mcp-error" role="alert">{{ detailError }}</p>
        <template v-if="detail">
          <section class="mcp-sec">
            <h3>基本信息</h3>
            <dl class="mcp-dl">
              <div><dt>名称</dt><dd>{{ detail.name }}</dd></div>
              <div><dt>传输方式</dt><dd>{{ transportLabel(detail.transport) }}</dd></div>
              <div><dt>状态</dt><dd>{{ reachableText(detail) }} · {{ detail.enabled ? '已启用' : '已停用' }}</dd></div>
              <div><dt>超时</dt><dd>{{ detail.timeoutSeconds }} 秒</dd></div>
              <div><dt>被引用</dt><dd>{{ detail.usedByCount }} 处</dd></div>
              <div><dt>最近连通测试</dt><dd>{{ timeAgo(detail.lastProbeAt) }}<template v-if="detail.lastProbeAt">（{{ detail.lastProbeAt }}）</template></dd></div>
              <div class="mcp-dl-full"><dt>功能简介</dt><dd>{{ detail.description || '—' }}</dd></div>
              <div v-if="detail.lastError" class="mcp-dl-full"><dt>最近错误</dt><dd class="mcp-error-text">{{ detail.lastError }}</dd></div>
            </dl>
          </section>

          <section class="mcp-sec">
            <h3>连接配置</h3>
            <template v-if="detail.transport === 'stdio'">
              <dl class="mcp-dl">
                <div class="mcp-dl-full"><dt>启动命令</dt><dd><code>{{ detail.command }}</code></dd></div>
                <div v-if="detail.args?.length" class="mcp-dl-full"><dt>参数</dt><dd><code>{{ detail.args.join(' ') }}</code></dd></div>
              </dl>
              <el-table v-if="detailEnvEntries.length" :data="detailEnvEntries" size="small" class="mcp-kv-table">
                <el-table-column label="环境变量" width="180"><template #default="{ row }"><code>{{ row[0] }}</code></template></el-table-column>
                <el-table-column label="值（脱敏）"><template #default="{ row }"><code>{{ row[1] }}</code></template></el-table-column>
              </el-table>
            </template>
            <template v-else>
              <dl class="mcp-dl">
                <div class="mcp-dl-full"><dt>服务地址</dt><dd><code>{{ detail.url }}</code></dd></div>
              </dl>
              <el-table v-if="detailHeaderEntries.length" :data="detailHeaderEntries" size="small" class="mcp-kv-table">
                <el-table-column label="请求头" width="180"><template #default="{ row }"><code>{{ row[0] }}</code></template></el-table-column>
                <el-table-column label="值（脱敏）"><template #default="{ row }"><code>{{ row[1] }}</code></template></el-table-column>
              </el-table>
            </template>
            <p class="mcp-note">密钥与请求头已脱敏回读；如需修改请在编辑中重新填写（留空保持不变）。</p>
          </section>

          <section class="mcp-sec">
            <h3>工具清单（{{ detail.tools?.length ?? 0 }}）</h3>
            <el-table :data="detail.tools ?? []" size="small" empty-text="暂无工具，保存或连通测试成功后自动同步">
              <el-table-column label="工具名" min-width="160"><template #default="{ row }"><code>{{ row.name }}</code><el-tag v-if="row.stale" size="small" type="danger" class="mcp-stale-tag">stale</el-tag></template></el-table-column>
              <el-table-column label="描述" min-width="220"><template #default="{ row }"><span :title="row.inputSchema">{{ row.description || '—' }}</span></template></el-table-column>
            </el-table>
          </section>

          <section class="mcp-sec">
            <h3>连通测试记录</h3>
            <el-table :data="detail.probeLogs ?? []" size="small" empty-text="暂无记录">
              <el-table-column label="时间" width="170"><template #default="{ row }">{{ row.probeAt }}</template></el-table-column>
              <el-table-column label="结果" width="80"><template #default="{ row }"><el-tag size="small" :type="row.success ? 'success' : 'danger'">{{ row.success ? '成功' : '失败' }}</el-tag></template></el-table-column>
              <el-table-column label="工具数" width="70"><template #default="{ row }">{{ row.toolCount ?? '—' }}</template></el-table-column>
              <el-table-column label="错误" min-width="160"><template #default="{ row }"><span class="mcp-error-text">{{ row.error || '' }}</span></template></el-table-column>
            </el-table>
          </section>
        </template>
      </div>
      <template #footer>
        <el-button @click="drawerOpen = false">关闭</el-button>
        <el-button :loading="detail ? probingId === detail.id : false" :disabled="!detail || probingAll" data-testid="mcp-detail-probe" @click="detail && probe(detail)">连通测试</el-button>
        <el-button v-if="canWrite" type="primary" :disabled="!detail" data-testid="mcp-detail-edit" @click="openEdit">编辑</el-button>
        <el-button v-if="canWrite" type="danger" :loading="saving" :disabled="!detail" data-testid="mcp-detail-delete" @click="removeDetail">删除</el-button>
      </template>
    </el-drawer>

    <el-dialog
      v-model="editorOpen"
      :title="form.id ? '编辑 MCP 服务' : '接入 MCP 服务'"
      width="min(720px, 96vw)"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      data-testid="mcp-editor-dialog"
    >
      <el-radio-group v-if="!form.id" v-model="editorMode" size="small" class="mcp-editor-mode" :disabled="saving" aria-label="接入方式" data-testid="mcp-editor-mode">
        <el-radio-button value="form">表单接入</el-radio-button>
        <el-radio-button value="json">JSON 配置</el-radio-button>
      </el-radio-group>

      <el-form v-if="form.id || editorMode === 'form'" label-position="top" :disabled="saving || !canWrite" class="mcp-form">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="例如 mysql-query" data-testid="mcp-form-name" />
        </el-form-item>
        <el-form-item label="功能简介">
          <el-input v-model="form.description" maxlength="200" placeholder="这个服务提供什么工具、给哪个智能体用" />
        </el-form-item>
        <div class="mcp-pair">
          <el-form-item label="传输方式" required>
            <el-radio-group v-model="form.transport" data-testid="mcp-form-transport">
              <el-radio-button value="stdio">stdio</el-radio-button>
              <el-radio-button value="streamableHttp">streamableHttp</el-radio-button>
              <el-radio-button value="sse">sse</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="超时（秒）">
            <el-input-number v-model="form.timeoutSeconds" :min="5" :max="600" :step="5" controls-position="right" />
          </el-form-item>
        </div>
        <template v-if="form.transport === 'stdio'">
          <el-form-item label="启动命令" required>
            <el-input v-model="form.command" placeholder="例如 npx 或 /usr/local/bin/mcp-server" data-testid="mcp-form-command" />
          </el-form-item>
          <el-form-item label="参数（每行一个）">
            <el-input v-model="form.argsText" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="-y&#10;@modelcontextprotocol/server-mysql" />
          </el-form-item>
          <el-form-item label="环境变量（KEY=VALUE，每行一个）">
            <el-input v-model="form.envText" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="MYSQL_HOST=192.168.1.30" />
            <p v-if="form.id" class="mcp-note">留空表示不修改已保存的环境变量；填写则整组替换。</p>
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="服务地址" required>
            <el-input v-model="form.url" placeholder="http://192.168.1.30:8080/mcp" data-testid="mcp-form-url" />
          </el-form-item>
          <el-form-item label="请求头（KEY=VALUE，每行一个）">
            <el-input v-model="form.headersText" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="Authorization=Bearer <token>" />
            <p v-if="form.id" class="mcp-note">留空表示不修改已保存的请求头；填写则整组替换。</p>
          </el-form-item>
        </template>
        <el-form-item v-if="!form.id">
          <el-switch v-model="form.enabled" active-text="接入后立即启用" />
        </el-form-item>
      </el-form>

      <div v-if="!form.id && editorMode === 'json'" class="mcp-json">
        <p class="mcp-note">支持 Claude Desktop 风格 {"mcpServers": {...}} 或单个服务对象；保存时执行 initialize → tools/list 连通校验，成功即同步工具清单。</p>
        <el-input v-model="jsonText" type="textarea" :autosize="{ minRows: 10, maxRows: 14 }" :disabled="saving" data-testid="mcp-json-text"
          placeholder='{"mcpServers": {"mysql-query": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-mysql"], "env": {"MYSQL_HOST": "192.168.1.30"}}}}' />
        <div class="mcp-json-bar">
          <el-input v-model="jsonName" placeholder="服务名称（可选：覆盖 JSON 中的键名）" maxlength="60" :disabled="saving" class="mcp-json-name" />
          <el-button :disabled="saving || !jsonText.trim()" data-testid="mcp-json-format" @click="formatJson">格式化</el-button>
        </div>
      </div>

      <p v-if="editorError" class="mcp-error" role="alert">{{ editorError }}</p>
      <template #footer>
        <el-button :disabled="saving" @click="editorOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" data-testid="mcp-save" @click="save">{{ form.id ? '保存' : '接入并连通测试' }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.mcp-page { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.mcp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.mcp-head-text h2 { margin: 0; font-size: 16px; }
.mcp-head-text p { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.mcp-head-actions { display: flex; gap: 10px; flex-wrap: wrap; }
.mcp-head-actions :deep(.el-button + .el-button) { margin-left: 0; }

.mcp-filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mcp-chips { display: inline-flex; gap: 4px; padding: 3px; background: #f1f5f9; border-radius: 8px; }
.mcp-chip {
  border: 0; background: transparent; padding: 4px 10px; font-size: 12px; color: #64748b;
  border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.mcp-chip:hover { color: #0f172a; }
.mcp-chip.active { background: #fff; color: #0f172a; font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.mcp-chip-count { color: var(--el-text-color-secondary); margin-left: 2px; }
.mcp-chip.active .mcp-chip-count { color: var(--el-color-primary); }
.mcp-search { max-width: 260px; margin-left: auto; }

.mcp-error { color: var(--el-color-danger); margin: 0; }
.mcp-note { color: var(--el-text-color-secondary); font-size: 12px; margin: 6px 0 0; }
.mcp-empty { padding: 40px 0; text-align: center; color: var(--el-text-color-secondary); font-size: 13px; }

.mcp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.mcp-card {
  display: flex; flex-direction: column; gap: 8px; padding: 14px;
  border: 1px solid var(--el-border-color-light); border-radius: 8px; background: #fff;
  cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s;
}
.mcp-card:hover { border-color: var(--el-color-primary-light-5); box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08); }
.mcp-card.is-down { opacity: 0.72; }
.mcp-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.mcp-card-title { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mcp-card-title b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-card-sub { font-size: 11px; color: var(--el-text-color-secondary); }
.mcp-pills { display: flex; gap: 4px; flex-shrink: 0; }
.mcp-pill { padding: 1px 8px; border-radius: 999px; font-size: 11px; line-height: 18px; white-space: nowrap; }
.mcp-pill-ok { background: var(--el-color-success-light-9); color: var(--el-color-success); }
.mcp-pill-down { background: var(--el-color-danger-light-9); color: var(--el-color-danger); }
.mcp-pill-grey { background: var(--el-fill-color); color: var(--el-text-color-secondary); }
.mcp-card-desc {
  margin: 0; font-size: 12px; color: var(--el-text-color-secondary); min-height: 32px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.mcp-card-desc.is-error { color: var(--el-color-danger); }
.mcp-card-metrics { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--el-text-color-secondary); }
.mcp-card-metrics b { color: var(--el-text-color-primary); font-weight: 600; }
.mcp-card-actions { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--el-border-color-lighter); padding-top: 8px; }

.mcp-detail { display: flex; flex-direction: column; gap: 18px; }
.mcp-sec h3 { margin: 0 0 10px; font-size: 13px; }
.mcp-dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 0; }
.mcp-dl > div { display: flex; gap: 8px; font-size: 12px; min-width: 0; }
.mcp-dl dt { color: var(--el-text-color-secondary); flex-shrink: 0; }
.mcp-dl dd { margin: 0; overflow-wrap: anywhere; }
.mcp-dl-full { grid-column: 1 / -1; }
.mcp-dl code, .mcp-kv-table code { font: 12px/1.6 monospace; overflow-wrap: anywhere; }
.mcp-error-text { color: var(--el-color-danger); }
.mcp-stale-tag { margin-left: 6px; }
.mcp-kv-table { margin-top: 8px; }

.mcp-editor-mode { margin-bottom: 16px; }
.mcp-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mcp-form :deep(.el-input-number) { width: 100%; }
.mcp-json { display: grid; gap: 10px; }
.mcp-json-bar { display: flex; gap: 10px; }
.mcp-json-name { max-width: 280px; }
@media (max-width: 600px) { .mcp-pair { grid-template-columns: 1fr; gap: 0; } .mcp-search { margin-left: 0; max-width: none; flex: 1; } }
</style>
