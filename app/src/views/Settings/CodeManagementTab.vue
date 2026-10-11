<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi, type SiteCodeVersion } from '@/api/runnerManagement'

type Environment = 'test' | 'prd'
type Version = SiteCodeVersion & { environments: Environment[] }
interface RunCode { key: string; latest: Version; versions: Version[] }
const router = useRouter(), route = useRoute()
const canWrite = computed(() => useAuthStore().role === 'admin')
const rows = ref<Version[]>([]), keyword = ref(typeof route.query.configId === 'string' ? route.query.configId : ''), repoFilter = ref('')
watch(() => route.query.configId, value => { keyword.value = typeof value === 'string' ? value : '' })
const loading = ref(false), error = ref(''), saving = ref('')
const drafts = reactive<Record<string, string>>({}), errors = reactive<Record<string, string>>({})
let loaded = false
const keyOf = (row: Version) => JSON.stringify([row.codeId, row.configId, row.queueName, row.siteHost])
const selectionKey = (row: RunCode, env: Environment) => `${row.key}:${env}`
const groups = computed(() => {
  const result = new Map<string, RunCode>()
  for (const version of rows.value) {
    const key = keyOf(version)
    const group = result.get(key)
    if (group) group.versions.push(version)
    else result.set(key, { key, latest: version, versions: [version] })
  }
  return [...result.values()]
})
const repoOptions = computed(() => [...new Map(rows.value.filter(row => row.repoId).map(row => [row.repoId!, row.repoName || row.repoId!])).entries()])
const filtered = computed(() => groups.value.filter(row => (!repoFilter.value || row.versions.some(version => version.repoId === repoFilter.value))
  && row.versions.some(version => [version.configId, version.queueName, version.siteHost, version.storagePath, version.deliveryPath, version.repoName || ''].some(value => value.toLowerCase().includes(keyword.value.trim().toLowerCase())))))
const adopted = (row: RunCode, env: Environment) => row.versions.find(version => version.environments.includes(env))
const selected = (row: RunCode, env: Environment) => drafts[selectionKey(row, env)] ?? adopted(row, env)?.scriptDigest ?? ''
const selectedVersion = (row: RunCode, env: Environment) => row.versions.find(version => version.scriptDigest === selected(row, env))
const dirty = (row: RunCode, env: Environment) => selected(row, env) !== (adopted(row, env)?.scriptDigest || '')
const environmentLabel = (env: Environment) => env === 'test' ? '测试' : '生产'
function versionLabel(version: Version) {
  const date = version.publishedAt && !Number.isNaN(Date.parse(version.publishedAt))
    ? new Date(version.publishedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '已保存'
  return `${date} · Git ${version.gitCommit.slice(0, 10)}`
}
function choose(row: RunCode, env: Environment, value: unknown) {
  if (!canWrite.value || typeof value !== 'string' || saving.value) return
  const key = selectionKey(row, env)
  if (value === (adopted(row, env)?.scriptDigest || '')) delete drafts[key]
  else drafts[key] = value
  delete errors[key]
}
async function load() {
  loading.value = true; error.value = ''
  try { rows.value = await runnerManagementApi.siteCodeCatalog() }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { loading.value = false; loaded = true }
}
async function apply(row: RunCode, env: Environment) {
  const version = selectedVersion(row, env), key = selectionKey(row, env)
  if (!canWrite.value || saving.value || !version || !dirty(row, env)) return
  saving.value = key; delete errors[key]
  try {
    await runnerManagementApi.bindSiteCode({ configId: version.configId, queueName: version.queueName, environment: env, scriptDigest: version.scriptDigest })
    rows.value = rows.value.map(item => keyOf(item) !== row.key ? item : { ...item,
      environments: [...item.environments.filter(value => value !== env), ...(item.scriptDigest === version.scriptDigest ? [env] : [])] })
    delete drafts[key]
    ElMessage.success(`${environmentLabel(env)}环境已采用所选代码版本`)
  } catch (e) { errors[key] = e instanceof Error ? e.message : String(e) }
  finally { saving.value = '' }
}
function openRepository(row: RunCode) {
  if (row.latest.repoId) void router.replace({ path: '/settings', query: { tab: 'code-repos', repoId: row.latest.repoId } })
}
function openDirectory(row: RunCode) {
  void router.replace({ path: '/settings', query: { tab: 'directory-layout', configId: row.latest.configId } })
}
onMounted(() => { void load() })
onActivated(() => { if (loaded && !loading.value && !Object.keys(drafts).length) void load() })
</script>

<template>
  <div class="rc-card rcv-main" data-testid="settings-runtime-versions">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" clearable placeholder="配置 ID、队列、网站或代码文件" class="rcv-search" aria-label="搜索运行版本" />
      <el-select v-model="repoFilter" clearable placeholder="全部仓库" class="rcv-repo" data-testid="runtime-code-repo-filter"><el-option v-for="[id, name] in repoOptions" :key="id" :value="id" :label="name" /></el-select>
      <el-button :icon="Refresh" circle :disabled="loading || !!saving" aria-label="刷新运行版本" @click="load" />
      <span class="rcv-note">选择测试、生产环境实际采用的代码；文件内容统一在代码仓库查看。</span>
    </div>
    <el-alert v-if="error" :title="`运行版本加载失败：${error}`" type="error" :closable="false" show-icon class="rcv-error" />
    <div v-loading="loading" class="rc-table-scroll rcv-table">
      <table class="rc-data-table">
        <thead><tr><th>配置 ID / 队列</th><th>适用网站</th><th>测试环境</th><th>生产环境</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="row in filtered" :key="row.key" data-testid="runtime-code-row">
            <td class="rcv-identity"><strong>{{ row.latest.configId }}</strong><div :title="row.latest.queueName">{{ row.latest.queueName }}</div><small>{{ row.latest.repoName || '未关联仓库' }}</small></td>
            <td class="rcv-website" :title="row.latest.siteHost">{{ row.latest.siteHost || '队列通用' }}</td>
            <td v-for="env in (['test', 'prd'] as const)" :key="env" class="rcv-version" :data-testid="`runtime-code-${row.latest.codeId}-${env}`">
              <el-select :model-value="selected(row, env)" :disabled="!canWrite || !!saving || loading || !!error" filterable placeholder="尚未采用，选择版本" class="rcv-select" :aria-label="`${row.latest.configId} ${environmentLabel(env)}运行版本`" @update:model-value="(value: unknown) => choose(row, env, value)">
                <el-option v-for="version in row.versions" :key="version.scriptDigest" :value="version.scriptDigest" :label="versionLabel(version)" />
              </el-select>
              <div class="rcv-entry" :title="selectedVersion(row, env)?.deliveryPath">{{ selectedVersion(row, env)?.deliveryPath || '尚未配置执行入口' }}</div>
              <div v-if="dirty(row, env)" class="rcv-version-actions"><el-tag size="small" type="warning">待应用</el-tag><el-button link type="primary" :disabled="!!saving || loading || !!error" :loading="saving === selectionKey(row, env)" :data-testid="`runtime-code-apply-${env}`" @click="apply(row, env)">应用版本</el-button><el-button link :disabled="!!saving" @click="delete drafts[selectionKey(row, env)]; delete errors[selectionKey(row, env)]">取消</el-button></div>
              <small v-else class="rcv-current">{{ adopted(row, env) ? '当前采用' : '未采用' }}</small>
              <p v-if="errors[selectionKey(row, env)]" class="rcv-inline-error" role="alert">{{ errors[selectionKey(row, env)] }}</p>
            </td>
            <td class="rcv-actions"><el-button link type="primary" :disabled="!row.latest.repoId" @click="openRepository(row)">查看仓库</el-button><el-button link type="primary" @click="openDirectory(row)">部署目录</el-button></td>
          </tr>
          <tr v-if="!loading && !filtered.length"><td colspan="5">{{ error ? '服务不可用' : keyword || repoFilter ? '没有匹配的运行代码' : '暂无运行代码，请先在流程节点中生成或关联仓库代码' }}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="rcv-help">应用版本会更新该环境使用此配置的队列任务。文件下发范围及目标机器在「代码下发」中设置。</p>
  </div>
</template>

<style scoped>
.rcv-main { display:flex; flex:1; min-height:0; flex-direction:column; }.rcv-search { width:240px; }.rcv-repo { width:160px; }.rcv-note { margin-left:auto; font-size:12px; color:var(--rc-muted); }.rcv-table { flex:1; min-height:0; overflow:auto; }.rcv-error { margin:0 12px 8px; width:auto; }.rcv-table th,.rcv-table td { white-space:nowrap; }.rcv-identity { width:170px; max-width:190px; }.rcv-identity strong { font-weight:500; }.rcv-identity div,.rcv-identity small { display:block; margin-top:4px; overflow:hidden; text-overflow:ellipsis; }.rcv-identity small,.rcv-current,.rcv-entry { font-size:12px; color:var(--rc-muted); }.rcv-website { max-width:160px; overflow:hidden; text-overflow:ellipsis; }.rcv-version { min-width:230px; }.rcv-select { width:220px; }.rcv-entry { margin:5px 0; max-width:220px; overflow:hidden; text-overflow:ellipsis; }.rcv-version-actions { display:flex; gap:10px; align-items:center; }.rcv-version-actions .el-button+.el-button { margin-left:0; }.rcv-inline-error { max-width:220px; color:var(--rc-error); white-space:normal; font-size:12px; margin:6px 0 0; }.rcv-help { margin:10px 12px; font-size:12px; color:var(--rc-muted); }.rcv-actions .el-button { display:block; margin:0 0 6px; }
</style>
