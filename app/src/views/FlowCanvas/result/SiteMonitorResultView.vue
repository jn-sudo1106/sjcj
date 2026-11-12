<script setup lang="ts">
// 运行概览（源内监控视图底部）：最近 5 行正式运行 + 「全部记录」入口（1110 §3.1 / 原型说明 §四·一）。
//
// 这里只渲染「页内最近运行」，一行对应一次正式运行（测试/试跑不计入，由 listRuns 口径保证）；
// 完整列表与单次详情由 fe-runs 的 RunsDrawer 负责——本组件不重复实现抽屉内部逻辑。
import { computed, onMounted, ref, watch } from 'vue'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import { listRuns } from '@/api/monitorCenter'
import { DATA_TEXT, EXEC_TEXT } from '@/utils/monitor/record'

const props = defineProps<{
  sourceId: string
  /** 抽屉标题用；缺省用源 id */
  title?: string
  /** 行数上限，默认 5（页面内只保留最近 5 行） */
  limit?: number
}>()

const emit = defineEmits<{
  all: []
  detail: [run: MonitorRunView]
}>()

const RECENT_LIMIT = 5

const runs = ref<MonitorRunView[]>([])
const loading = ref(false)
const error = ref('')
let loadToken = 0

const shownLimit = computed(() => props.limit ?? RECENT_LIMIT)
const scopeLabel = computed(() => (props.title ? `运行概览 · ${props.title}` : '运行概览'))

async function load() {
  const token = ++loadToken
  loading.value = true
  error.value = ''
  try {
    const page = await listRuns({ sourceId: props.sourceId, page: 1, size: shownLimit.value })
    if (token !== loadToken) return
    runs.value = page.list ?? []
  } catch (err) {
    if (token !== loadToken) return
    runs.value = []
    error.value = err instanceof Error ? err.message : '运行记录加载失败'
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function formatTime(at?: string): string {
  const text = String(at ?? '').trim()
  if (!text) return '—'
  return text.replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, '').trim()
}

function countText(run: MonitorRunView): string {
  return String(run.count ?? '').trim() || '—'
}

function execClass(run: MonitorRunView): string {
  if (run.exec === 'succeeded') return 'tone-good'
  if (run.exec === 'failed' || run.exec === 'timeout') return 'tone-bad'
  if (run.exec === 'running' || run.exec === 'queued') return 'tone-run'
  return 'tone-muted'
}

function dataClass(run: MonitorRunView): string {
  if (run.data === 'normal') return 'tone-good'
  if (run.data === 'abnormal') return 'tone-bad'
  if (run.data === 'no_data') return 'tone-warn'
  return 'tone-unknown'
}

/** 旧日志没有结构化通知回执，只能写「未取得回执」，不能冒充已送达。 */
function notifyText(run: MonitorRunView): string {
  if (run.legacy) return '未取得回执'
  const map: Record<string, string> = {
    none: '未配置',
    pending: '待投递',
    accepted: '已受理·未送达',
    delivered: '已送达',
    failed: '投递失败',
    suppressed: '已静默',
    unknown: '未取得回执',
  }
  return map[run.notify] ?? '未取得回执'
}

onMounted(load)
watch(() => props.sourceId, load)
watch(() => props.limit, load)

defineExpose({ refresh: load, runs })
</script>

<template>
  <section class="smr" data-testid="site-monitor-recent-runs">
    <header class="smr-head">
      <div class="smr-title">
        <strong>{{ scopeLabel }}</strong>
        <span class="smr-sub">最近运行 · 一行一次正式运行（测试/试跑不计入）</span>
      </div>
      <button type="button" class="smr-all" data-testid="site-monitor-all-runs" @click="emit('all')">全部记录</button>
    </header>

    <p v-if="loading && !runs.length" class="smr-empty" data-testid="site-monitor-recent-runs-loading">加载运行记录…</p>
    <p v-else-if="error" class="smr-error" data-testid="site-monitor-recent-runs-error">
      {{ error }}
      <button type="button" class="smr-link" @click="load">重试</button>
    </p>
    <p v-else-if="!runs.length" class="smr-empty" data-testid="site-monitor-recent-runs-empty">
      该源还没有正式运行记录。可直接在上方「＋ 加监控」新增检查项，运行后这里会出现记录。
    </p>

    <table v-else class="smr-table" data-testid="site-monitor-recent-runs-table">
      <colgroup>
        <col class="c-time" />
        <col class="c-monitor" />
        <col class="c-exec" />
        <col class="c-data" />
        <col class="c-count" />
        <col class="c-notify" />
        <col class="c-op" />
      </colgroup>
      <thead>
        <tr>
          <th>时间</th>
          <th>检查项</th>
          <th>执行</th>
          <th>数据结论</th>
          <th>实际数值</th>
          <th>通知</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id" data-testid="site-monitor-recent-run-row" :data-id="run.id">
          <td class="c-time" :title="formatTime(run.at)">{{ formatTime(run.at) }}</td>
          <td class="c-monitor" :title="run.monitorName || run.monitorId || '—'">
            {{ run.monitorName || '未命名检查项' }}
            <span v-if="run.legacy" class="smr-tag" title="旧日志：未取得结构化结论">旧日志</span>
          </td>
          <td class="c-exec">
            <span class="smr-status" :class="execClass(run)">{{ EXEC_TEXT[run.exec] ?? EXEC_TEXT.unknown }}</span>
          </td>
          <td class="c-data">
            <span class="smr-status" :class="dataClass(run)">{{ DATA_TEXT[run.data] ?? DATA_TEXT.unknown }}</span>
          </td>
          <td class="c-count" :title="countText(run)">{{ countText(run) }}</td>
          <td class="c-notify" :title="notifyText(run)">{{ notifyText(run) }}</td>
          <td class="c-op">
            <button type="button" class="smr-link" data-testid="site-monitor-recent-run-detail" @click="emit('detail', run)">
              详情
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.smr {
  min-width: 0;
  margin-top: 4px;
}
.smr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 4px;
  white-space: nowrap;
}
.smr-title {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
.smr-title strong {
  color: var(--rc-text-1, #1f2937);
  font-size: 13px;
}
.smr-sub {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smr-all {
  flex: none;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--rc-border, #d8dee9);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-text-1, #1f2937);
  font-size: 12px;
  cursor: pointer;
}
.smr-all:hover {
  border-color: var(--rc-primary, #2563eb);
  color: var(--rc-primary, #2563eb);
}
.smr-empty,
.smr-error {
  margin: 0;
  padding: 16px 8px;
  color: var(--rc-text-3, #8a94a6);
  font-size: 12px;
  text-align: center;
}
.smr-error {
  color: var(--rc-danger, #dc2626);
}
.smr-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12.5px;
}
.smr-table .c-time { width: 18%; }
.smr-table .c-monitor { width: 22%; }
.smr-table .c-exec { width: 10%; }
.smr-table .c-data { width: 11%; }
.smr-table .c-count { width: 11%; }
.smr-table .c-notify { width: 16%; }
.smr-table .c-op { width: 12%; }
.smr-table th,
.smr-table td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smr-table th {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  font-weight: 500;
  background: var(--rc-bg-muted, #f7f9fc);
}
.smr-status.tone-good { color: var(--rc-success, #16a34a); }
.smr-status.tone-bad { color: var(--rc-danger, #dc2626); }
.smr-status.tone-warn { color: var(--rc-warning, #d97706); }
.smr-status.tone-run { color: var(--rc-primary, #2563eb); }
.smr-status.tone-muted { color: var(--rc-text-2, #5b667a); }
.smr-tag {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--rc-bg-muted, #f1f4f8);
  color: var(--rc-text-3, #8a94a6);
  font-size: 10.5px;
}
.smr-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.smr-link:hover {
  text-decoration: underline;
}
</style>