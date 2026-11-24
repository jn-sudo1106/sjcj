<script setup lang="ts">
// 检查项面板（源内监控视图的主体内容，1110 §3.1 / 1110 原型说明 §四·一）。
//
// 一页 = 一个源：源由上层 props 传入，这里不提供换源下拉；新增/编辑都锁死 sourceId。
// 列表由容器统一加载（listMonitorsOfSource），本组件只负责展示与触发编辑/开关/运行记录，
// 编辑成功后 emit('saved') 让容器重新拉取，保证与「最差事实」「最近运行」同一份数据。
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { MonitorRecordView } from '@/api/types/monitorCenter'
import { DATA_TEXT, EXEC_TEXT } from '@/utils/monitor/record'
import MonitorConfigEditor from './MonitorConfigEditor.vue'
import {
  checkSummary,
  kindText,
  monitorStatus,
  planText,
  planTitle,
  toneClass,
  type MonitorStatus,
} from './monitor-site/monitorFacts'

const props = defineProps<{
  siteId: string
  sourceId: string
  monitors: MonitorRecordView[]
  loading?: boolean
  error?: string
  /** 正在请求启停的检查项 id（避免连点） */
  togglingId?: string
}>()

const emit = defineEmits<{
  /** 编辑器回读到的记录（回读不到时 null）；容器据此刷新检查项与最近运行 */
  saved: [record: MonitorRecordView | null]
  toggle: [monitor: MonitorRecordView, enabled: boolean]
  runs: [monitor: MonitorRecordView]
  /** 打开本源全部运行记录（右侧抽屉） */
  allRuns: []
  retry: []
}>()

const dialogVisible = ref(false)
const editing = ref<MonitorRecordView | null>(null)
const editorRef = ref<InstanceType<typeof MonitorConfigEditor>>()

const total = computed(() => props.monitors.length)
const enabledCount = computed(() => props.monitors.filter((m) => m.enabled).length)

const onlyProblems = ref(false)

const allRows = computed(() =>
  props.monitors
    .map((monitor, index) => ({ monitor, status: monitorStatus(monitor), index }))
    // 不正常的排前面，同级保持接口原顺序
    .sort((a, b) => a.status.rank - b.status.rank || a.index - b.index),
)
const problemCount = computed(
  () => allRows.value.filter((row) => row.status.tone === 'bad' || row.status.tone === 'warn').length,
)
const rows = computed(() =>
  onlyProblems.value && problemCount.value
    ? allRows.value.filter((row) => row.status.tone === 'bad' || row.status.tone === 'warn')
    : allRows.value,
)
const lastCheckAt = computed(() =>
  props.monitors.reduce((latest, m) => (m.lastCheckAt && m.lastCheckAt > latest ? m.lastCheckAt : latest), ''),
)

/** 状态列悬浮提示：执行、数据结论、条数、原因一次说清，列本身只放一个状态。 */
function statusTitle(monitor: MonitorRecordView, status: MonitorStatus): string {
  const parts = [
    `执行：${EXEC_TEXT[monitor.exec] ?? monitor.exec}`,
    `数据结论：${DATA_TEXT[monitor.data] ?? monitor.data}`,
    `条数：${monitor.count || '—'}`,
  ]
  if (status.reason) parts.push(`原因：${status.reason}`)
  return parts.join('｜')
}

function openAdd() {
  editing.value = null
  dialogVisible.value = true
}

function openEdit(monitor: MonitorRecordView) {
  editing.value = monitor
  dialogVisible.value = true
}

async function beforeClose(done: () => void) {
  if (editorRef.value?.isBusy()) return
  if (editorRef.value?.isDirty()) {
    try {
      await ElMessageBox.confirm('编辑器里还有未保存的改动，确定放弃并关闭？', '放弃修改', {
        confirmButtonText: '放弃修改',
        cancelButtonText: '继续编辑',
        type: 'warning',
      })
    } catch {
      return
    }
  }
  done()
}

// 确认保存成功后关闭弹窗；回读未知时保留编辑内容供核对。
function onSaved(record: MonitorRecordView | null) {
  if (record) onCancel()
  emit('saved', record)
}

// 编辑器已经自己做过未保存改动确认，这里只负责弹窗归宿：关窗并清掉当前记录，
// 免得下次「＋ 加监控」还带着上一次的 record 打开。
function onCancel() {
  editing.value = null
  dialogVisible.value = false
}
</script>

<template>
  <section class="smc" data-testid="site-monitor-checks">
    <header class="smc-head">
      <div class="smc-title">
        <strong>检查项</strong>
        <span v-if="total" class="smc-summary" data-testid="site-monitor-checks-count">
          {{ enabledCount }} 启用 ／ 共 {{ total }} 项
          <template v-if="problemCount">
            ·
            <button
              type="button"
              class="smc-problem"
              :class="{ 'is-active': onlyProblems }"
              data-testid="site-monitor-checks-problems"
              :title="onlyProblems ? '显示全部检查项' : '只看异常 / 执行失败的检查项'"
              @click="onlyProblems = !onlyProblems"
            >
              {{ problemCount }} 项不正常{{ onlyProblems ? '（仅看这些）' : '' }}
            </button>
          </template>
          <template v-if="lastCheckAt"> · 最近检查 {{ lastCheckAt }}</template>
        </span>
      </div>
      <div class="smc-actions">
        <button
          v-if="total"
          class="smc-link"
          type="button"
          data-testid="site-monitor-all-runs"
          @click="emit('allRuns')"
        >
          全部运行记录
        </button>
        <button v-if="total || error" class="smc-add" type="button" data-testid="site-monitor-add-monitor" @click="openAdd">＋ 加监控</button>
      </div>
    </header>

    <p v-if="error" class="smc-error" data-testid="site-monitor-checks-error">
      {{ error }}
      <button type="button" class="smc-link" @click="emit('retry')">重试</button>
    </p>
    <p v-else-if="loading && !monitors.length" class="smc-empty" data-testid="site-monitor-checks-loading">加载检查项…</p>
    <div v-else-if="!monitors.length" class="smc-blank" data-testid="site-monitor-checks-empty">
      <p>该源还没有配置监控</p>
      <span>加一个检查项后，这里会显示它每次检查是否正常。</span>
      <button class="smc-add is-primary" type="button" data-testid="site-monitor-add-monitor" @click="openAdd">＋ 加监控</button>
    </div>

    <table v-else class="smc-table" data-testid="site-monitor-checks-table">
      <colgroup>
        <col class="c-name" />
        <col class="c-kind" />
        <col class="c-status" />
        <col class="c-last" />
        <col class="c-plan" />
        <col class="c-enabled" />
        <col class="c-op" />
      </colgroup>
      <thead>
        <tr>
          <th>检查项</th>
          <th>方式</th>
          <th>状态</th>
          <th>最近检查</th>
          <th>计划</th>
          <th>启用</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.monitor.id"
          data-testid="site-monitor-check-row"
          :data-id="row.monitor.id"
          :data-tone="row.status.tone"
          :class="{ 'is-problem': row.status.tone === 'bad' || row.status.tone === 'warn' }"
        >
          <td class="c-name">
            <span class="smc-name" :title="row.monitor.name">{{ row.monitor.name || '未命名检查项' }}</span>
            <span v-if="row.monitor.publishStatus === 'draft'" class="smc-tag" title="草稿未发布，不会执行">未生效</span>
            <span v-else-if="row.monitor.publishStatus === 'pending'" class="smc-tag">待生效</span>
            <span v-else-if="row.monitor.publishStatus === 'failed'" class="smc-tag smc-tag-bad">发布失败</span>
          </td>
          <td class="c-kind" :title="`${kindText(row.monitor)}：${checkSummary(row.monitor)}`">
            {{ kindText(row.monitor) }}<span class="smc-muted"> · {{ checkSummary(row.monitor) }}</span>
          </td>
          <td class="c-status" :title="statusTitle(row.monitor, row.status)">
            <span class="smc-status" :class="toneClass(row.status.tone)" data-testid="site-monitor-check-status">
              <i class="smc-dot" aria-hidden="true" />{{ row.status.label }}
            </span>
            <span v-if="row.status.reason" class="smc-reason">{{ row.status.reason }}</span>
          </td>
          <td class="c-last">{{ row.monitor.lastCheckAt || '—' }}</td>
          <td class="c-plan" :title="planTitle(row.monitor)">
            <span class="smc-plan">{{ planText(row.monitor) }}</span>
            <span v-if="!row.monitor.schedule" class="smc-tag" title="没有执行计划：不会自动运行，只能在检查项里手动执行">仅手动</span>
          </td>
          <td class="c-enabled">
            <div class="smc-enable">
              <el-switch
                size="small"
                :model-value="row.monitor.enabled"
                :loading="togglingId === row.monitor.id"
                :disabled="!!togglingId && togglingId !== row.monitor.id"
                data-testid="site-monitor-check-toggle"
                @change="(value: string | number | boolean) => emit('toggle', row.monitor, Boolean(value))"
              />
              <span class="smc-enable-text" :class="row.monitor.enabled ? 'is-on' : 'is-off'">
                {{ row.monitor.enabled ? '启用' : '停用' }}
              </span>
            </div>
          </td>
          <td class="c-op">
            <button type="button" class="smc-link" data-testid="site-monitor-check-edit" @click="openEdit(row.monitor)">编辑</button>
            <button type="button" class="smc-link" data-testid="site-monitor-check-runs" @click="emit('runs', row.monitor)">
              记录
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <el-dialog
      class="monitor-editor-dialog"
      v-model="dialogVisible"
      title="监控配置"
      :width="'min(1080px, calc(100vw - 32px))'"
      append-to-body
      destroy-on-close
      :before-close="beforeClose"
      data-testid="site-monitor-editor-dialog"
    >
      <MonitorConfigEditor
        ref="editorRef"
        :site-id="siteId"
        :source-id="sourceId"
        :record="editing"
        :source-locked="true"
        @saved="onSaved"
        @draft-saved="(record) => emit('saved', record)"
        @cancel="onCancel"
      />
    </el-dialog>
  </section>
</template>

<style scoped>
.smc {
  min-width: 0;
}
.smc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 4px 6px;
  white-space: nowrap;
}
.smc-title {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
.smc-title strong {
  color: var(--rc-text-1, #1f2937);
  font-size: 13px;
}
.smc-add {
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
.smc-add:hover {
  border-color: var(--rc-primary, #2563eb);
  color: var(--rc-primary, #2563eb);
}
.smc-empty,
.smc-error {
  margin: 0;
  padding: 18px 8px;
  color: var(--rc-text-3, #8a94a6);
  font-size: 12px;
  text-align: center;
}
.smc-error {
  color: var(--rc-danger, #dc2626);
}
.smc-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12.5px;
}
.smc-table .c-name { width: 21%; }
.smc-table .c-kind { width: 15%; }
.smc-table .c-status { width: 18%; }
.smc-table .c-last { width: 14%; }
.smc-table .c-plan { width: 13%; }
.smc-table .c-enabled { width: 9%; }
.smc-table .c-op { width: 10%; }
.smc-table th,
.smc-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--rc-border-soft, #eef1f5);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.smc-table th {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  font-weight: 500;
  background: var(--rc-bg-muted, #f7f9fc);
}
.smc-name {
  font-weight: 500;
  color: var(--rc-text-1, #1f2937);
}
.smc-tag {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--rc-bg-muted, #f1f4f8);
  color: var(--rc-text-3, #8a94a6);
  font-size: 10.5px;
}
.smc-tag-bad {
  color: var(--rc-danger, #dc2626);
}
.smc-enable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.smc-enable-text {
  font-size: 11.5px;
}
.smc-enable-text.is-on { color: var(--rc-primary, #2563eb); }
.smc-enable-text.is-off { color: var(--rc-text-3, #8a94a6); }
.smc-table tbody tr.is-problem > td {
  background: color-mix(in srgb, var(--rc-danger, #dc2626) 4%, transparent);
}
.smc-table tbody tr[data-tone='warn'].is-problem > td {
  background: color-mix(in srgb, var(--rc-warning, #d97706) 5%, transparent);
}
.smc-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
}
.smc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
.smc-status.tone-good { color: var(--rc-success, #16a34a); }
.smc-status.tone-bad { color: var(--rc-danger, #dc2626); }
.smc-status.tone-warn { color: var(--rc-warning, #d97706); }
.smc-status.tone-unknown { color: var(--rc-text-2, #5b667a); }
.smc-status.tone-muted { color: var(--rc-text-3, #8a94a6); }
.smc-reason {
  margin-left: 6px;
  color: var(--rc-text-2, #5b667a);
  font-size: 11.5px;
}
.smc-muted {
  color: var(--rc-text-3, #8a94a6);
}
.c-op .smc-link + .smc-link {
  margin-left: 10px;
}
.smc-actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex: none;
}
.smc-summary {
  color: var(--rc-text-2, #5b667a);
  font-size: 12px;
}
.smc-problem {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rc-danger, #dc2626);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.smc-problem:hover,
.smc-problem.is-active {
  text-decoration: underline;
}
.smc-blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 8px;
  border: 1px dashed var(--rc-border, #d8dee9);
  border-radius: 8px;
  text-align: center;
}
.smc-blank p {
  margin: 0;
  color: var(--rc-text-1, #1f2937);
  font-size: 13px;
  font-weight: 500;
}
.smc-blank span {
  color: var(--rc-text-3, #8a94a6);
  font-size: 12px;
}
.smc-blank .smc-add {
  margin-top: 6px;
}
.smc-add.is-primary {
  border-color: var(--rc-primary, #2563eb);
  background: var(--rc-primary, #2563eb);
  color: #fff;
}
.smc-add.is-primary:hover {
  color: #fff;
  opacity: 0.9;
}
.smc-plan {
  font-family: var(--rc-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
  color: var(--rc-text-2, #5b667a);
}
.smc-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.smc-link:hover {
  text-decoration: underline;
}
</style>
