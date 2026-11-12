<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { runnerManagementApi as api, type CodeGenerationServer } from '@/api/runnerManagement'
import { copyToClipboard } from '@/utils/clipboard'

const route = useRoute()
const servers = ref<CodeGenerationServer[]>([]), selectedId = ref(''), kind = ref('launcher')
const selected = computed(() => servers.value.find(row => row.serverId === selectedId.value))
const content = ref(''), error = ref(''), loading = ref(false), follow = ref(true)
let active = true, sequence = 0, timer: ReturnType<typeof setTimeout> | undefined
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
async function load() {
  const id = selectedId.value, request = ++sequence
  if (!id) return
  loading.value = true; error.value = ''
  try {
    const result = await api.remoteCodeFiles<{ content: string }>(id, { action: 'logs', kind: kind.value })
    if (active && request === sequence) content.value = result.content
  } catch (e) { if (active && request === sequence) error.value = problem(e) }
  finally { if (request === sequence) loading.value = false }
}
async function refreshServers() {
  try {
    const result = await api.codeGenerationServers()
    if (!active) return
    servers.value = result.items
    const requested = typeof route.query.serverId === 'string' ? route.query.serverId : ''
    if (!selectedId.value && requested && servers.value.some(row => row.serverId === requested)) selectedId.value = requested
    else if (!servers.value.some(row => row.serverId === selectedId.value)) selectedId.value = servers.value[0]?.serverId || ''
  } catch (e) { if (active) error.value = problem(e) }
}
function schedule() {
  clearTimeout(timer)
  if (active) timer = setTimeout(async () => {
    if (follow.value) { await refreshServers(); await load() }
    schedule()
  }, 5000)
}
function reset() { ++sequence; content.value = ''; error.value = ''; loading.value = false; void load() }
watch([selectedId, kind], reset)
watch(() => route.query.serverId, () => { selectedId.value = ''; content.value = ''; void refreshServers() })
function stop() { active = false; ++sequence; loading.value = false; clearTimeout(timer) }
onMounted(async () => { await refreshServers(); schedule() })
onActivated(() => { active = true; schedule() })
onDeactivated(stop); onUnmounted(stop)
</script>

<template>
  <div class="cg-log-workspace" data-testid="code-server-runtime-logs">
    <aside>
      <header><strong>代码生成服务</strong><el-button link @click="refreshServers">刷新</el-button></header>
      <div class="cg-log-servers">
        <button v-for="server in servers" :key="server.serverId" type="button" class="cg-log-server" :class="{ active: selectedId === server.serverId }" @click="selectedId = server.serverId">
          <strong>{{ server.name }} · {{ server.status === 'online' ? '在线' : '离线' }}</strong>
          <small>{{ server.ipAddress }} · {{ server.installDirectory }}</small><small>实例 ID：{{ server.serverId }}</small>
          <small>版本：{{ server.version }}<template v-if="server.pid"> · PID：{{ server.pid }}</template></small>
        </button>
        <el-empty v-if="!servers.length" description="暂无代码生成服务" :image-size="50" />
      </div>
    </aside>
    <section>
      <header><strong>{{ selected?.name || '请选择服务实例' }}</strong><el-select v-model="kind" aria-label="代码服务日志类型" style="width:180px"><el-option label="启动 / 升级日志" value="launcher" /><el-option label="服务运行日志" value="service" /><el-option label="工作进程输出" value="worker" /></el-select><el-checkbox v-model="follow">自动刷新</el-checkbox><el-button link :loading="loading" :disabled="!selectedId" @click="load">刷新</el-button><el-button link :disabled="!content" @click="copyToClipboard(content, '代码服务日志')">复制</el-button></header>
      <el-alert v-if="selected?.upgrade?.message" :title="selected.upgrade.message" :type="selected.upgrade.status === 'failed' ? 'error' : 'info'" :closable="false" />
      <el-alert v-if="selected?.status === 'offline'" title="服务离线，无法远程读取本机日志；恢复连接后刷新查看。" type="warning" :closable="false" />
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <pre v-if="content" class="cg-log-content" data-testid="code-server-log-content">{{ content }}</pre>
      <el-empty v-else-if="!loading && !error" description="暂无此类型日志" :image-size="60" />
    </section>
  </div>
</template>

<style scoped>
.cg-log-workspace{display:grid;grid-template-columns:300px minmax(0,1fr);gap:12px;flex:1;min-height:0}
aside,section{display:flex;flex-direction:column;min-height:0;overflow:hidden;border:1px solid var(--el-border-color-light);border-radius:10px;background:var(--el-bg-color)}
header{display:flex;align-items:center;gap:10px;padding:12px;flex-wrap:wrap;font-size:13px}header>strong{margin-right:auto}
.cg-log-servers{overflow:auto;flex:1}.cg-log-server{display:flex;flex-direction:column;gap:6px;width:100%;padding:14px;text-align:left;border:0;border-top:1px solid var(--el-border-color-light);background:transparent;color:var(--el-text-color-primary);cursor:pointer}.cg-log-server.active{background:var(--el-color-primary-light-9);box-shadow:inset 3px 0 var(--el-color-primary)}.cg-log-server small{overflow-wrap:anywhere;color:var(--el-text-color-secondary)}
.cg-log-content{flex:1;min-height:0;overflow:auto;margin:12px;padding:12px;background:var(--el-fill-color-light);border-radius:6px;font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:1100px){.cg-log-workspace{grid-template-columns:250px minmax(0,1fr)}}
</style>
