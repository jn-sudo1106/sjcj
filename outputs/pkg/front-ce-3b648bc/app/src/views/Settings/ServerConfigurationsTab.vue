<script setup lang="ts">
import { computed, onActivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { canAccess } from '@/composables/usePermission'
import { useAuthStore } from '@/stores/auth'
import { formatRunnerDateTime, formatRunnerHeartbeat } from '@/utils/format/runnerHeartbeat'
import type { ArtifactRelease, RunnerInstance } from '@/api/runnerManagement'
import RunnerManagementTab from './RunnerManagementTab.vue'
import RunnerBindingTab from './RunnerBindingTab.vue'

const route = useRoute(), router = useRouter()
const auth = useAuthStore()
const serverManager = ref<InstanceType<typeof RunnerManagementTab> | null>(null)
const releases = ref<ArtifactRelease[]>([])
const infoExpanded = ref(false)
const instances = ref<RunnerInstance[]>([])
const visibleInstances = ref<RunnerInstance[]>([])
const visibleIds = computed(() => visibleInstances.value.map(item => item.runnerId))
const hasMachineFilters = ref(false)
const busy = ref(false)
const isServerRoute = computed(() => route.path === '/settings' && ['runners', 'assignments', 'site-code'].includes(String(route.query.tab)))
const runnerId = computed(() => typeof route.query.runnerId === 'string' ? route.query.runnerId : '')
const selected = computed(() => instances.value.find(item => item.runnerId === runnerId.value))
const canViewBindings = computed(() => canAccess('settings:assignments'))
const statusLabels = { online: '在线', offline: '离线', upgrading: '升级中', error: '异常' }
function versionInfo(digest: string | null | undefined, empty: string) {
  return !digest ? empty : digest === 'source-local' ? '本地源码（source-local）' : digest
}
function versionDate(digest: string | null | undefined) {
  const stamp = releases.value.find(item => item.kind === 'runner' && item.digest === digest)?.publishedAt
  return stamp ? `发布时间：${formatRunnerDateTime(stamp)}（北京时间）` : ''
}
function shortVersion(digest: string | null | undefined) {
  return !digest ? '未上报' : digest === 'source-local' ? '本地源码' : digest.startsWith('sha256:') ? digest.slice(7, 19) : digest
}
const machineInformation = computed(() => {
  const item = selected.value
  if (!item) return []
  return [
    { label: '实例 ID', value: item.runnerId, span: 2, code: true },
    { label: '实例目录', value: item.installDirectory, span: 2, code: true },
    { label: '运行平台', value: [item.osType, item.platform].filter(Boolean).join(' / ') || '未上报' },
    { label: '系统版本', value: item.osVersion || '未上报' },
    { label: 'Runner PID', value: item.runnerPid || '未上报' },
    { label: '任务进程', value: item.workerProcesses == null ? '未上报' : `${item.workerProcesses.length} 个` },
    { label: '队列数量', value: item.assignmentCount ?? 0 },
    { label: '最近心跳（北京时间）', value: formatRunnerHeartbeat(item.lastHeartbeat), span: 2 },
    { label: '支持能力', value: item.capabilities?.join('、') || '—' },
    { label: '当前 Runner 版本', value: versionInfo(item.actualDigest, '未上报'), description: versionDate(item.actualDigest), span: 2, code: true },
    { label: '目标 Runner 版本', value: versionInfo(item.desiredDigest, '未设置'), description: versionDate(item.desiredDigest), span: 2, code: true },
    { label: '启动器版本', value: item.launcherVersion || '未上报' },
    { label: '最近异常', value: item.lastError || '无', span: 3, error: !!item.lastError },
  ]
})
watch(runnerId, () => { infoExpanded.value = false })
function selectRunner(value: string) {
  if (busy.value || !isServerRoute.value) return
  void router.replace({ path: '/settings', query: { ...route.query, tab: 'runners', runnerId: value || undefined } })
}
function reconcileSelection() {
  // KeepAlive 中仍可能收到后台刷新结果，只能在服务器页自动选择机器。
  if (busy.value || !isServerRoute.value) return
  const items = visibleInstances.value
  if (hasMachineFilters.value && !items.length) {
    if (runnerId.value) selectRunner('')
  } else if (items.length && (!runnerId.value || (hasMachineFilters.value && !visibleIds.value.includes(runnerId.value)))) selectRunner(items[0]!.runnerId)
}
function visibleInstancesChanged(items: RunnerInstance[], filtered = false) {
  visibleInstances.value = items
  hasMachineFilters.value = filtered
  reconcileSelection()
}
watch(busy, value => { if (!value) reconcileSelection() })
onActivated(reconcileSelection)
</script>

<template>
  <section class="server-workspace" data-testid="settings-server-workspace">
    <RunnerManagementTab ref="serverManager" section="runners" compact :selectable="canViewBindings" :selected-runner-id="runnerId" :selection-disabled="busy" class="server-sidebar" @select-runner="selectRunner" @instances-change="instances = $event" @visible-instances-change="visibleInstancesChanged" @releases-change="releases = $event" />
    <section class="server-main rc-card" :class="{ 'is-expanded': infoExpanded }">
      <header v-if="runnerId && canViewBindings" class="server-context">
        <div class="server-heading"><strong>{{ selected?.name || '服务器实例' }}</strong><span v-if="selected" class="server-status">{{ statusLabels[selected.status] }}</span><span v-if="selected" class="server-address">{{ selected.ipAddress }}</span><div v-if="selected" class="server-info-actions"><el-button v-if="auth.role === 'admin'" link type="primary" :disabled="busy" data-testid="server-set-version" @click="serverManager?.editInstanceVersion(runnerId)">设置版本</el-button><el-button link type="primary" data-testid="server-open-detail" @click="serverManager?.openInstanceDetails(runnerId)">详情 / 进程</el-button><el-button link data-testid="server-toggle-info" @click="infoExpanded = !infoExpanded">{{ infoExpanded ? '收起更多' : '更多信息' }}</el-button></div></div>
        <div v-if="selected" class="server-summary" data-testid="server-machine-summary"><span class="server-summary-directory" :title="selected.installDirectory"><span>目录</span><code>{{ selected.installDirectory }}</code></span><span>PID {{ selected.runnerPid || '未上报' }}</span><span>进程 {{ selected.workerProcesses == null ? '未上报' : selected.workerProcesses.length }}</span><span :title="`${versionInfo(selected.actualDigest, '未上报')}\n${versionDate(selected.actualDigest)}`">Runner {{ shortVersion(selected.actualDigest) }}</span><span :title="'北京时间：' + formatRunnerHeartbeat(selected.lastHeartbeat)">心跳 {{ formatRunnerHeartbeat(selected.lastHeartbeat) }}</span></div>
        <p v-if="selected?.lastError && !infoExpanded" class="server-summary-error" :title="selected.lastError">异常：{{ selected.lastError }}</p>
        <dl v-if="selected && infoExpanded" class="server-information" data-testid="server-machine-information"><div v-for="field in machineInformation" :key="field.label" class="server-information-field" :class="{ 'span-two': field.span === 2, 'span-three': field.span === 3, 'is-error': field.error }"><dt>{{ field.label }}</dt><dd :class="{ 'is-code': field.code }">{{ field.value }}<small v-if="field.description">{{ field.description }}</small></dd></div></dl>
        <div v-if="!selected" class="server-identity">实例 ID：{{ runnerId }}（尚未加载或已不存在）</div><div v-else-if="!visibleIds.includes(runnerId)" class="server-identity">当前实例不在左侧筛选结果中</div>
      </header>
      <RunnerBindingTab v-if="runnerId && canViewBindings" :key="runnerId" :runner-id="runnerId" class="server-content" @busy="busy = $event" />
      <div v-else class="server-empty"><el-empty :description="!canViewBindings ? '没有机器配置查看权限' : hasMachineFilters && !visibleInstances.length ? '没有符合筛选条件的机器，请调整左侧筛选' : '选择左侧服务器实例，查看对应配置'" /></div>
    </section>
  </section>
</template>

<style scoped>
.server-workspace { display: grid; grid-template-columns: 280px minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); align-items: stretch; flex: 1; min-width: 0; min-height: 0; gap: 14px; }
.server-sidebar { min-width: 0; min-height: 0; margin: 0; animation: none; transform: none; }
.server-main { display: flex; flex-direction: column; gap: 0; min-width: 0; min-height: 0; margin: 0; overflow: hidden; animation: none; }.server-main.is-expanded { overflow-y: auto; }
.server-content { flex: 1; min-height: 0; }.server-main.is-expanded .server-content { flex: 1 0 340px; min-height: 340px; }
.server-context { display: flex; flex-shrink: 0; flex-direction: column; gap: 6px; padding: 8px 12px; border: 0; border-bottom: 1px solid var(--rc-border-soft); border-radius: 0; background: var(--el-bg-color); }
.server-main :deep(.rb-page.rb-scoped) { gap: 0; }
.server-main :deep(.rb-scoped .rb-filters) { border: 0; border-bottom: 1px solid var(--rc-border-soft); border-radius: 0; }
.server-main :deep(.rb-scoped .rb-card) { border: 0; border-radius: 0; }
.server-heading { display: flex; align-items: center; gap: 12px; font-size: 14px; }.server-address { font-size: 12px; }.server-directory { font-size: 12px; overflow-wrap: anywhere; }
.server-status, .server-identity { font-size: 12px; color: var(--rc-muted); }
.server-identity { overflow-wrap: anywhere; }
.server-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; font-size: 11px; line-height: 1.6; color: var(--rc-muted); }.server-summary > span { white-space: nowrap; }.server-summary-directory { display: flex; gap: 6px; align-items: center; flex: 1 1 160px; min-width: 0; }.server-summary-directory code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text); font: inherit; }.server-summary-error { margin: 0; font-size: 11px; color: var(--el-color-danger); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.server-heading { flex-wrap: wrap; }.server-info-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; }.server-info-actions .el-button { margin-left: 0; font-size: 12px; }
.server-information { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 16px; margin: 0; }
.server-information-field { min-width: 0; }.server-information-field.span-two { grid-column: span 2; }.server-information-field.span-three { grid-column: span 3; }
.server-information dt { color: var(--rc-muted); font-size: 11px; line-height: 1.5; }.server-information dd { margin: 4px 0 0; color: var(--rc-text); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; user-select: text; }.server-information dd.is-code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; }.server-information dd small { display: block; margin-top: 4px; color: var(--rc-muted); font: 10px/1.5 var(--el-font-family); }.server-information .is-error dd { color: var(--el-color-danger); }
.server-empty { display: grid; place-items: center; flex: 1; }
@media (max-width: 1100px) { .server-workspace { grid-template-columns: 240px minmax(0, 1fr); gap: 10px; }.server-information { grid-template-columns: repeat(2, minmax(0, 1fr)); }.server-information-field.span-three { grid-column: span 2; } }
@media (max-width: 760px) { .server-workspace { grid-template-columns: 1fr; grid-template-rows: 260px minmax(360px, 1fr); overflow-y: auto; } }
</style>
