<script setup lang="ts">
// 源内 / 网站监控视图（1110 §3.1「一个源一页」、1110 原型说明 §四·一/§四·二）。
//
// 一次只展示一个上下文：
//   - 传了 sourceId：源内视图——一张检查项表（每行带最近状态），运行记录点「记录」走右侧抽屉。
//     源来自 props，本页不提供换源；源名/网站等信息页头已有，不再重复一条信息条（1123 沟通：两张表堆一起）。
//   - 没传 sourceId：网站视图——切网站由上层负责，这里只按 siteId 列出本站**已绑定监控**的源。
//     未绑定监控检查项的源不出行（1125 沟通：一片「未配置检查」的行只是噪音）；
//     视觉口径对齐监控中心「数据源监控」（页头 + 统计条 + 源行 + 展开检查项）。
//
// 判断（最差事实 / 覆盖 / 未配置）全部走 `utils/monitor/sourceSummary`，本页不自行拼状态；
// 运行记录列表与详情统一用 fe-runs 的 RunsDrawer（右侧抽屉），页内不再平铺最近运行表。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { siteApi, sourceApi, type Source } from '@/api'
import { listMonitors, listMonitorsOfSource, setMonitorsEnabled } from '@/api/monitorCenter'
import type { MonitorRecordView, MonitorSourceRow, MonitorRunView } from '@/api/types/monitorCenter'
import { summarizeSource, summarizeSources } from '@/utils/monitor/sourceSummary'
import { COVERAGE_PLACEHOLDER, SITE_SUMMARY_ITEMS, checkSummary, dataText, kindText, planText } from './monitor-site/monitorFacts'
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
/** 一行 = 一个**已绑定监控**的源；未绑定的源不入行（1125）。 */
interface SiteRow {
  sourceId: string
  sourceName: string
  siteName: string
  monitorEnabled: number
  monitorTotal: number
  coverage: MonitorSourceRow['coverage']
  label: string
  tone: string
  lastCheckAt: string
  monitors: MonitorRecordView[]
}
const siteSources = ref<Source[]>([])
const siteRows = ref<SiteRow[]>([])
/** 本站源总数里没绑定监控、被隐藏的那部分，用来解释「为什么只看到这几个源」。 */
const siteHiddenSources = ref(0)
const siteLoading = ref(false)
const siteError = ref('')
const siteLoaded = ref(false)
const expanded = ref<string[]>([])
let siteToken = 0

const siteName = computed(() => siteSources.value.find((s) => s.siteName)?.siteName || '')

const siteStats = computed(() => {
  const rows = siteRows.value
  return {
    sources: rows.length,
    monitors: rows.reduce((sum, row) => sum + row.monitorTotal, 0),
    enabled: rows.reduce((sum, row) => sum + row.monitorEnabled, 0),
  }
})

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
    siteHiddenSources.value = 0
    siteLoading.value = false
    siteLoaded.value = true
    return
  }
  const sources = sourcesResult.value ?? []
  siteSources.value = sources
  if (monitorsResult.status === 'rejected') {
    siteError.value = errorText(monitorsResult.reason, '监控记录加载失败')
    siteRows.value = []
    siteHiddenSources.value = 0
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
  const bound = rows
    .map<SiteRow>((row) => ({
      sourceId: String(row.sourceId),
      sourceName: row.sourceName || '',
      siteName: row.siteName || '',
      monitorEnabled: row.monitorEnabled,
      monitorTotal: row.monitorTotal,
      coverage: row.coverage,
      label: row.label,
      tone: row.tone,
      lastCheckAt: row.lastCheckAt || '',
      monitors: siteMonitors.filter((monitor) => String(monitor.sourceId) === String(row.sourceId)),
    }))
    // 没有绑定任何监控检查项的源不展示：整行都是「未配置检查」，只会淹没真正有结论的源。
    .filter((row) => row.monitors.length > 0)
  siteRows.value = bound
  siteHiddenSources.value = Math.max(0, sources.length - bound.length)
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

function openSourceRuns(row: SiteRow) {
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

    <!-- 网站视图：只按 siteId 看本站源，且只列已绑定监控的源 -->
    <template v-else>
      <header class="smv-scope">
        <div class="smv-heading">
          <h2>数据质量监控</h2>
          <span class="smv-tag">本站</span>
          <span v-if="siteName" class="smv-site">{{ siteName }}</span>
        </div>
        <p class="smv-scope-hint">
          只展示本站已绑定监控检查项的源；未绑定监控的源不在此出现，需要时到「监控中心 → 数据源监控」新增。
        </p>
      </header>

      <!-- 网站级汇总仍等 C07 聚合，这里保留口径但不铺成 7 张「—」卡片 -->
      <div class="smv-stats" data-testid="site-monitor-site-summary">
        <span v-for="item in SITE_SUMMARY_ITEMS" :key="item" class="smv-stat">
          {{ item }} <b class="is-pending" :title="COVERAGE_PLACEHOLDER">{{ COVERAGE_PLACEHOLDER }}</b>
        </span>
        <span class="smv-stat-note">网站级汇总需服务端聚合，不按当前页数据推算</span>
      </div>

      <div class="smv-bar">
        <span class="smv-count">
          共 <b>{{ siteStats.sources }}</b> 个已绑定监控的源 · 检查项 <b>{{ siteStats.monitors }}</b>（启用 {{ siteStats.enabled }}）
          <template v-if="siteHiddenSources"> · 另有 {{ siteHiddenSources }} 个源未绑定监控，已隐藏</template>
        </span>
        <el-button :icon="Refresh" circle size="small" title="重新查询本站监控" @click="loadSiteMode" />
      </div>

      <p v-if="siteLoading && !siteLoaded" class="smv-state" data-testid="site-monitor-site-loading">加载网站监控…</p>
      <p v-else-if="siteError" class="smv-state smv-state-error" data-testid="site-monitor-site-error">
        {{ siteError }}
        <button type="button" class="smv-link" @click="loadSiteMode">重试</button>
      </p>
      <div v-else-if="!siteRows.length" class="smv-empty" data-testid="site-monitor-site-empty">
        <strong>本站还没有绑定监控检查项的源</strong>
        <p>到「监控中心 → 数据源监控」给源新增检查项后，这里会按源展示检查覆盖、最差事实和最近一次检查时间。</p>
      </div>
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
            <th>检查覆盖</th>
            <th>最差事实</th>
            <th>最近检查</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in siteRows" :key="item.sourceId">
            <tr
              data-testid="site-monitor-site-row"
              :data-source-id="item.sourceId"
              :class="{ 'is-expanded': expanded.includes(item.sourceId) }"
            >
              <td class="c-expand">
                <button
                  type="button"
                  class="smv-expand"
                  :aria-expanded="expanded.includes(item.sourceId)"
                  :data-testid="`site-monitor-site-expand-${item.sourceId}`"
                  @click="toggleExpand(item.sourceId)"
                >
                  {{ expanded.includes(item.sourceId) ? '▾' : '▸' }}
                </button>
              </td>
              <td class="c-source" :title="item.sourceName || item.sourceId">
                <span class="smv-name">{{ item.sourceName || item.sourceId }}</span>
                <span class="smv-sub">{{ item.sourceId }}</span>
              </td>
              <td class="c-checks">
                <span class="smv-cover">{{ item.monitorEnabled }} 启用 ／ 共 {{ item.monitorTotal }} 项</span>
              </td>
              <td class="c-worst">
                <span class="rc-status" :class="item.tone === 'good' ? 'ok' : item.tone === 'bad' ? 'err' : item.tone === 'warn' ? 'warn' : 'muted'">
                  {{ item.label }}
                </span>
              </td>
              <td class="c-last" :title="item.lastCheckAt || '尚未检查'">{{ item.lastCheckAt || '尚未检查' }}</td>
              <td class="c-op">
                <button
                  type="button"
                  class="smv-link"
                  data-testid="site-monitor-site-row-runs"
                  @click="openSourceRuns(item)"
                >
                  运行记录
                </button>
              </td>
            </tr>
            <tr v-if="expanded.includes(item.sourceId)" class="smv-detail-row">
              <td colspan="6">
                <section class="smv-inner">
                  <div class="smv-inner-head">
                    <span class="smv-inner-title">{{ item.sourceName || item.sourceId }}</span>
                    <span class="smv-sub">{{ item.monitorEnabled }} 启用 ／ 共 {{ item.monitorTotal }} 项检查</span>
                    <span class="smv-inner-spacer"></span>
                    <button type="button" class="smv-link" @click="openSourceRuns(item)">查看运行记录</button>
                  </div>
                  <table class="smv-subtable" data-testid="site-monitor-site-subtable">
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
                        <td>
                          <span class="smv-check-name" :title="monitor.name || '未命名检查项'">{{ monitor.name || '未命名检查项' }}</span>
                          <div class="smv-sub">#{{ monitor.id }}</div>
                        </td>
                        <td>{{ kindText(monitor) }}</td>
                        <td>{{ checkSummary(monitor) }}</td>
                        <td>
                          <span class="rc-status" :class="monitor.enabled ? 'run' : 'muted'">{{ monitor.enabled ? '启用' : '停用' }}</span>
                        </td>
                        <td>{{ dataText(monitor) }}</td>
                        <td>{{ planText(monitor) }}</td>
                        <td>{{ monitor.lastCheckAt || '尚未检查' }}</td>
                      </tr>
                    </tbody>
                  </table>
                </section>
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
  padding: 0 0 12px;
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

/* 页头：与监控中心「数据源监控」同款（标题 + 范围标签 + 一行说明） */
.smv-scope {
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.smv-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}
.smv-heading h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--rc-text);
}
.smv-tag {
  padding: 2px 6px;
  background: var(--rc-bg);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--rc-muted);
}
.smv-site {
  font-size: 11px;
  color: var(--rc-muted);
}
.smv-scope-hint {
  margin: 5px 0 0;
  font-size: 11px;
  color: var(--rc-muted);
  line-height: 1.6;
}

/* 网站级汇总：一行小字，不铺 7 张占位卡片 */
.smv-stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 0 14px;
  padding: 8px 0;
  border-bottom: 1px solid var(--rc-border-soft);
  font-size: 11px;
  color: var(--rc-text-2, #475569);
}
.smv-stat b {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.smv-stat b.is-pending {
  color: var(--rc-faint, #94a3b8);
  font-weight: 400;
}
.smv-stat-note {
  margin-left: auto;
  color: var(--rc-faint, #94a3b8);
  font-size: 11px;
}

/* 工具条：源数统计 + 刷新 */
.smv-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 14px;
  padding: 8px 0;
  border-bottom: 1px solid var(--rc-border-soft);
}
.smv-count {
  font-size: 12px;
  color: var(--rc-muted, #64748b);
  font-variant-numeric: tabular-nums;
}
.smv-count b {
  color: var(--rc-text, #1e293b);
  font-weight: 600;
}
.smv-bar :deep(.el-button) {
  margin-left: auto;
}

.smv-empty {
  margin: 18px 14px;
  padding: 26px 16px;
  border: 1px dashed var(--rc-border, #d8dee9);
  border-radius: var(--rc-radius-sm, 6px);
  background: #fbfdff;
  text-align: center;
}
.smv-empty strong {
  display: block;
  color: var(--rc-text-1, #1f2937);
  font-size: 13px;
  font-weight: 600;
}
.smv-empty p {
  margin: 6px 0 0;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  line-height: 1.7;
}

.smv-table {
  width: calc(100% - 28px);
  margin: 0 14px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
}
.smv-table .c-expand { width: 3%; }
.smv-table .c-source { width: 28%; }
.smv-table .c-checks { width: 18%; }
.smv-table .c-worst { width: 17%; }
.smv-table .c-last { width: 19%; }
.smv-table .c-op { width: 15%; }
.smv-table th,
.smv-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smv-table thead th {
  color: var(--rc-text-2, #475569);
  font-size: 11.5px;
  font-weight: 700;
  background: #f8fafc;
}
.smv-table tbody tr:hover {
  background: #fbfdff;
}
.smv-table tbody tr.is-expanded {
  background: #fbfdff;
}
.smv-name {
  color: var(--rc-text-1, #1f2937);
  font-weight: 600;
}
.smv-sub {
  margin-left: 6px;
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
}
.smv-cover {
  color: var(--rc-text-2, #475569);
  font-variant-numeric: tabular-nums;
}
.smv-table .rc-status {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smv-expand {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--rc-border, #d8dee9);
  border-radius: 4px;
  background: #fff;
  color: var(--rc-text-2, #5b667a);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}
.smv-expand:hover {
  border-color: var(--rc-primary, #2563eb);
  color: var(--rc-primary, #2563eb);
}

/* 展开区：卡在行下的白底小面板，和监控中心的行内表同构 */
.smv-detail-row > td {
  padding: 0 10px 10px;
  background: #fbfdff;
}
.smv-inner {
  background: #fff;
  border: 1px solid #dbe6f6;
  border-radius: var(--rc-radius-sm, 6px);
  overflow: hidden;
}
.smv-inner-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border-soft, #e2e8f0);
  background: #fbfdff;
}
.smv-inner-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--rc-text, #1e293b);
}
.smv-inner-spacer {
  flex: 1 1 auto;
}
.smv-subtable {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12px;
}
.smv-subtable th,
.smv-subtable td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smv-subtable th {
  color: var(--rc-text-2, #475569);
  font-size: 11px;
  font-weight: 700;
  background: #f8fafc;
}
.smv-check-name {
  color: var(--rc-text-1, #1f2937);
  font-weight: 600;
}
.smv-subtable .smv-sub {
  margin: 2px 0 0;
}
.smv-subtable .rc-status {
  height: 20px;
  font-size: 11px;
}
.smv-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.smv-link:hover {
  text-decoration: underline;
}
</style>