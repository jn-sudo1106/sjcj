<script setup lang="ts">
// 源内 / 网站监控视图（1110 §3.1「一个源一页」、1110 原型说明 §四·一/§四·二）。
//
// 一次只展示一个上下文：
//   - 传了 sourceId：源内视图——一张检查项表（每行带最近状态），运行记录点「记录」走右侧抽屉。
//     源来自 props，本页不提供换源；源名/网站等信息页头已有，不再重复一条信息条（1123 沟通：两张表堆一起）。
//   - 没传 sourceId：网站视图——切网站由上层负责，这里只按 siteId 列出本站源与监控摘要。
//
// 判断（最差事实 / 覆盖 / 未配置）全部走 `utils/monitor/sourceSummary`，本页不自行拼状态；
// 运行记录列表与详情统一用 fe-runs 的 RunsDrawer（右侧抽屉），页内不再平铺最近运行表。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { siteApi, sourceApi, type Source } from '@/api'
import { listMonitors, listMonitorsOfSource, setMonitorsEnabled } from '@/api/monitorCenter'
import type { MonitorRecordView, MonitorSourceRow, MonitorRunView } from '@/api/types/monitorCenter'
import { summarizeSource, summarizeSources } from '@/utils/monitor/sourceSummary'
import SiteSummaryBar from './monitor-site/SiteSummaryBar.vue'
import { COVERAGE_PLACEHOLDER, checkSummary, dataText, kindText, planText } from './monitor-site/monitorFacts'
import SiteMonitorConfigView from './SiteMonitorConfigView.vue'
import RunsDrawer from './monitor-runs/RunsDrawer.vue'

const props = defineProps<{
  siteId: string
  /** 源内视图必填：只来自路由/画布上下文，页面内部不允许换源 */
  sourceId?: string
}>()

const isSourceMode = computed(() => Boolean(props.sourceId))

// ---------- 源内视图 ----------
const source = ref<Source | null>(null)
const monitors = ref<MonitorRecordView[]>([])
const monitorsLoading = ref(false)
const monitorsError = ref('')
const loadedOnce = ref(false)
const togglingId = ref('')
let loadToken = 0

const sourceSummary = computed<MonitorSourceRow>(() =>
  summarizeSource(props.sourceId ?? '', monitors.value, {
    id: props.sourceId ?? '',
    name: source.value?.name,
    siteId: props.siteId,
    siteName: source.value?.siteName,
  }),
)
const sourceName = computed(() => source.value?.name || sourceSummary.value.sourceName || props.sourceId || '')

async function loadSourceMode() {
  const sourceId = props.sourceId
  if (!sourceId) return
  const token = ++loadToken
  monitorsLoading.value = true
  monitorsError.value = ''
  const [sourceResult, monitorsResult] = await Promise.allSettled([
    sourceApi.sourceDetail(sourceId),
    listMonitorsOfSource(sourceId),
  ])
  if (token !== loadToken) return
  source.value = sourceResult.status === 'fulfilled' ? sourceResult.value : null
  if (monitorsResult.status === 'fulfilled') {
    monitors.value = monitorsResult.value
  } else {
    monitors.value = []
    monitorsError.value = errorText(monitorsResult.reason, '检查项加载失败')
  }
  monitorsLoading.value = false
  loadedOnce.value = true
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

async function onToggle(monitor: MonitorRecordView, enabled: boolean) {
  if (togglingId.value) return
  togglingId.value = monitor.id
  try {
    await setMonitorsEnabled([monitor.id], enabled)
    ElMessage.success(enabled ? '已启用' : '已停用')
    await loadSourceMode()
  } catch (err) {
    ElMessage.error(errorText(err, enabled ? '启用失败' : '停用失败'))
  } finally {
    togglingId.value = ''
  }
}

async function onSaved() {
  await loadSourceMode()
}

// ---------- 网站视图 ----------
interface SiteSourceRow {
  row: MonitorSourceRow
  monitors: MonitorRecordView[]
}
const siteSources = ref<Source[]>([])
const siteRows = ref<SiteSourceRow[]>([])
const siteLoading = ref(false)
const siteError = ref('')
const siteLoaded = ref(false)
const expanded = ref<string[]>([])
let siteToken = 0

const siteName = computed(() => siteSources.value.find((s) => s.siteName)?.siteName || '')

async function loadSiteMode() {
  const token = ++siteToken
  siteLoading.value = true
  siteError.value = ''
  const [sourcesResult, monitorsResult] = await Promise.allSettled([siteApi.siteSources(props.siteId), listMonitors()])
  if (token !== siteToken) return
  if (sourcesResult.status === 'rejected') {
    siteError.value = errorText(sourcesResult.reason, '网站源列表加载失败')
    siteSources.value = []
    siteRows.value = []
    siteLoading.value = false
    siteLoaded.value = true
    return
  }
  const sources = sourcesResult.value ?? []
  siteSources.value = sources
  if (monitorsResult.status === 'rejected') {
    siteError.value = errorText(monitorsResult.reason, '监控记录加载失败')
    siteRows.value = []
    siteLoading.value = false
    siteLoaded.value = true
    return
  }
  // 只保留本站源：listMonitors 不带 sourceId 时会返回全库记录，必须先按本站源目录过滤，
  // 否则接口越权或数据异常时会把别的网站的源混进来。
  const allowed = new Set(sources.map((item) => String(item.sourceId)))
  const siteMonitors = monitorsResult.value.filter((monitor) => allowed.has(String(monitor.sourceId)))
  const rows = summarizeSources(
    siteMonitors,
    sources.map((item) => ({
      id: String(item.sourceId),
      name: item.name,
      siteId: item.siteId,
      siteName: item.siteName,
    })),
  )
  siteRows.value = rows.map((row) => ({
    row,
    monitors: siteMonitors.filter((monitor) => String(monitor.sourceId) === String(row.sourceId)),
  }))
  siteLoading.value = false
  siteLoaded.value = true
}

function toggleExpand(sourceId: string) {
  expanded.value = expanded.value.includes(sourceId)
    ? expanded.value.filter((id) => id !== sourceId)
    : [...expanded.value, sourceId]
}

// ---------- 运行抽屉（fe-runs 提供，本页只开） ----------
const selectedRun = ref<MonitorRunView | null>(null)

const drawer = ref<{ open: boolean; sourceId: string; monitorId: string; title: string }>({
  open: false,
  sourceId: '',
  monitorId: '',
  title: '',
})

function openAllRuns() {
  selectedRun.value = null
  drawer.value = { open: true, sourceId: props.sourceId ?? '', monitorId: '', title: sourceName.value }
}

function openMonitorRuns(monitor: MonitorRecordView) {
  selectedRun.value = null
  drawer.value = {
    open: true,
    sourceId: props.sourceId ?? monitor.sourceId,
    monitorId: monitor.id,
    title: monitor.name,
  }
}

function openSourceRuns(row: MonitorSourceRow) {
  selectedRun.value = null
  drawer.value = { open: true, sourceId: row.sourceId, monitorId: '', title: row.sourceName || row.sourceId }
}

function closeDrawer() {
  drawer.value = { ...drawer.value, open: false }
}

watch(
  () => [props.siteId, props.sourceId] as const,
  () => {
    loadedOnce.value = false
    siteLoaded.value = false
    expanded.value = []
    loadToken += 1
    siteToken += 1
    closeDrawer()
    if (isSourceMode.value) void loadSourceMode()
    else void loadSiteMode()
  },
  { immediate: true },
)
</script>

<template>
  <main class="smv-shell" :data-mode="isSourceMode ? 'source' : 'site'">
    <!-- 源内视图：源锁定，一张检查项表；运行记录走右侧抽屉 -->
    <template v-if="isSourceMode">
      <p v-if="monitorsLoading && !loadedOnce" class="smv-state" data-testid="site-monitor-loading">加载监控检查项…</p>
      <template v-else>
        <SiteMonitorConfigView
          :site-id="siteId"
          :source-id="sourceId!"
          :monitors="monitors"
          :loading="monitorsLoading"
          :error="monitorsError"
          :toggling-id="togglingId"
          @saved="onSaved"
          @toggle="onToggle"
          @runs="openMonitorRuns"
          @all-runs="openAllRuns"
          @retry="loadSourceMode"
        />
      </template>
    </template>

    <!-- 网站视图：只按 siteId 看本站源，不出现其他网站的源 -->
    <template v-else>
      <SiteSummaryBar :site-name="siteName" />
      <p v-if="siteLoading && !siteLoaded" class="smv-state" data-testid="site-monitor-site-loading">加载网站监控…</p>
      <p v-else-if="siteError" class="smv-state smv-state-error" data-testid="site-monitor-site-error">
        {{ siteError }}
        <button type="button" class="smv-link" @click="loadSiteMode">重试</button>
      </p>
      <p v-else-if="!siteRows.length" class="smv-state" data-testid="site-monitor-site-empty">
        该网站还没有可监控的源。请先在源列表里完成源配置，再回到这里查看监控。
      </p>
      <table v-else class="smv-table" data-testid="site-monitor-site-table">
        <colgroup>
          <col class="c-expand" />
          <col class="c-source" />
          <col class="c-checks" />
          <col class="c-worst" />
          <col class="c-last" />
          <col class="c-op" />
        </colgroup>
        <thead>
          <tr>
            <th aria-label="展开" />
            <th>源</th>
            <th>检查项</th>
            <th>最差事实</th>
            <th>最近检查</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in siteRows" :key="item.row.sourceId">
            <tr
              data-testid="site-monitor-site-row"
              :data-source-id="item.row.sourceId"
              :class="{ 'is-expanded': expanded.includes(String(item.row.sourceId)) }"
            >
              <td class="c-expand">
                <button
                  type="button"
                  class="smv-expand"
                  :aria-expanded="expanded.includes(String(item.row.sourceId))"
                  :data-testid="`site-monitor-site-expand-${item.row.sourceId}`"
                  @click="toggleExpand(String(item.row.sourceId))"
                >
                  {{ expanded.includes(String(item.row.sourceId)) ? '▾' : '▸' }}
                </button>
              </td>
              <td class="c-source" :title="item.row.sourceName || item.row.sourceId">
                <span class="smv-name">{{ item.row.sourceName || item.row.sourceId }}</span>
                <span class="smv-sub">{{ item.row.sourceId }}</span>
              </td>
              <td class="c-checks">{{ item.row.monitorEnabled }} 启用 ／ 共 {{ item.row.monitorTotal }} 项</td>
              <td class="c-worst">
                <span class="smv-worst" :class="`tone-${item.row.tone}`">{{ item.row.label }}</span>
              </td>
              <td class="c-last" :title="item.row.lastCheckAt || '尚未检查'">{{ item.row.lastCheckAt || '尚未检查' }}</td>
              <td class="c-op">
                <span v-if="!item.monitors.length" class="smv-muted">未配置检查</span>
                <span v-else-if="item.row.coverage === null" class="smv-muted" :title="COVERAGE_PLACEHOLDER">覆盖 —</span>
                <button
                  v-if="item.monitors.length"
                  type="button"
                  class="smv-link"
                  data-testid="site-monitor-site-row-runs"
                  @click="openSourceRuns(item.row)"
                >
                  运行记录
                </button>
              </td>
            </tr>
            <tr v-if="expanded.includes(String(item.row.sourceId))" class="smv-detail-row">
              <td colspan="6">
                <table v-if="item.monitors.length" class="smv-subtable" data-testid="site-monitor-site-subtable">
                  <thead>
                    <tr>
                      <th>检查项</th>
                      <th>方式</th>
                      <th>检查摘要</th>
                      <th>启用</th>
                      <th>最近数据结论</th>
                      <th>计划</th>
                      <th>最近检查</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="monitor in item.monitors" :key="monitor.id">
                      <td>{{ monitor.name || '未命名检查项' }}</td>
                      <td>{{ kindText(monitor) }}</td>
                      <td>{{ checkSummary(monitor) }}</td>
                      <td>{{ monitor.enabled ? '启用' : '停用' }}</td>
                      <td>{{ dataText(monitor) }}</td>
                      <td>{{ planText(monitor) }}</td>
                      <td>{{ monitor.lastCheckAt || '尚未检查' }}</td>
                    </tr>
                  </tbody>
                </table>
                <p v-else class="smv-muted smv-detail-empty">该源还没有监控检查项。</p>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>

    <RunsDrawer
      :open="drawer.open"
      :source-id="drawer.sourceId"
      :monitor-id="drawer.monitorId"
      :title="drawer.title"
      :initial-run="selectedRun"
      @close="closeDrawer"
    />
  </main>
</template>

<style scoped>
.smv-shell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 6px 12px 12px;
  box-sizing: border-box;
}
.smv-state {
  margin: 0;
  padding: 24px 8px;
  color: var(--rc-text-3, #8a94a6);
  font-size: 12px;
  text-align: center;
}
.smv-state-error {
  color: var(--rc-danger, #dc2626);
}
.smv-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12.5px;
}
.smv-table .c-expand { width: 3%; }
.smv-table .c-source { width: 24%; }
.smv-table .c-checks { width: 18%; }
.smv-table .c-worst { width: 18%; }
.smv-table .c-last { width: 20%; }
.smv-table .c-op { width: 17%; }
.smv-table th,
.smv-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smv-table th {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  font-weight: 500;
  background: var(--rc-bg-muted, #f7f9fc);
}
.smv-name {
  color: var(--rc-text-1, #1f2937);
  font-weight: 500;
}
.smv-sub {
  margin-left: 6px;
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
}
.smv-worst.tone-good { color: var(--rc-success, #16a34a); }
.smv-worst.tone-bad { color: var(--rc-danger, #dc2626); }
.smv-worst.tone-warn { color: var(--rc-warning, #d97706); }
.smv-worst.tone-unknown { color: var(--rc-text-2, #5b667a); }
.smv-worst.tone-muted { color: var(--rc-text-3, #8a94a6); }
.smv-muted {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11.5px;
}
.smv-expand {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid var(--rc-border, #d8dee9);
  border-radius: 4px;
  background: #fff;
  color: var(--rc-text-2, #5b667a);
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}
.smv-detail-row > td {
  padding: 0 8px 8px;
  background: var(--rc-bg-muted, #f7f9fc);
}
.smv-subtable {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
}
.smv-subtable th,
.smv-subtable td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smv-subtable th {
  color: var(--rc-text-3, #8a94a6);
  font-size: 10.5px;
  font-weight: 500;
}
.smv-detail-empty {
  margin: 0;
  padding: 10px 8px;
}
.smv-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.smv-link:hover {
  text-decoration: underline;
}
</style>