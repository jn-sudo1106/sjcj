<script setup lang="ts">
// 检查项面板（源内监控视图的主体内容，1110 §3.1 / 1110 原型说明 §四·一）。
//
// 一页 = 一个源：源由上层 props 传入，这里不提供换源下拉；新增/编辑都锁死 sourceId。
// 列表由容器统一加载（listMonitorsOfSource），本组件只负责展示与触发编辑/开关/运行记录，
// 编辑成功后 emit('saved') 让容器重新拉取，保证与「最差事实」「最近运行」同一份数据。
import { computed, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { MonitorRecordView } from '@/api/types/monitorCenter'
import { EXEC_TEXT } from '@/utils/monitor/record'
import MonitorConfigEditor from './MonitorConfigEditor.vue'
import { checkSummary, dataText, kindText, planText, planTitle, toneClass } from './monitor-site/monitorFacts'

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
  retry: []
}>()

const dialogVisible = ref(false)
const editing = ref<MonitorRecordView | null>(null)
const editorRef = ref<InstanceType<typeof MonitorConfigEditor>>()

const total = computed(() => props.monitors.length)
const enabledCount = computed(() => props.monitors.filter((m) => m.enabled).length)

/** 检查摘要、数据结论的悬浮提示：把执行、时间、条数一次说清，列本身保持窄。 */
function dataTitle(monitor: MonitorRecordView): string {
  const parts = [
    `执行：${EXEC_TEXT[monitor.exec] ?? monitor.exec}`,
    `最近检查：${monitor.lastCheckAt || '—'}`,
    `条数：${monitor.count || '—'}`,
  ]
  if (monitor.exec === 'failed' || monitor.exec === 'timeout' || monitor.exec === 'cancelled') {
    parts.push('执行失败时数据结论统一为「待判断」')
  }
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

// 1109/1110 规格：保存后弹窗保留，编辑器内部已按回读重置基线；这里把当前记录切到回读结果，
// 保证「新增后再保存」命中 update 而不是重复新增，容器同时刷新底层检查项与最近运行。
function onSaved(record: MonitorRecordView | null) {
  if (record) editing.value = record
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
        <span class="smc-count" data-testid="site-monitor-checks-count">
          {{ enabledCount }} 启用 ／ 共 {{ total }} 项
        </span>
        <span class="smc-hint">当前源锁定，不支持在此切换源</span>
      </div>
      <button class="smc-add" type="button" data-testid="site-monitor-add-monitor" @click="openAdd">＋ 加监控</button>
    </header>

    <p v-if="error" class="smc-error" data-testid="site-monitor-checks-error">
      {{ error }}
      <button type="button" class="smc-link" @click="emit('retry')">重试</button>
    </p>
    <p v-else-if="loading" class="smc-empty" data-testid="site-monitor-checks-loading">加载检查项…</p>
    <p v-else-if="!monitors.length" class="smc-empty" data-testid="site-monitor-checks-empty">
      该源还没有监控检查项，可直接在右上角「＋ 加监控」新增；新增后运行记录按检查项归档。
    </p>

    <table v-else class="smc-table" data-testid="site-monitor-checks-table">
      <colgroup>
        <col class="c-name" />
        <col class="c-kind" />
        <col class="c-summary" />
        <col class="c-enabled" />
        <col class="c-data" />
        <col class="c-plan" />
        <col class="c-edit" />
        <col class="c-runs" />
      </colgroup>
      <thead>
        <tr>
          <th>名称</th>
          <th>方式</th>
          <th>检查摘要</th>
          <th>启用</th>
          <th>最近数据结论</th>
          <th>计划</th>
          <th>编辑</th>
          <th>运行记录</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="monitor in monitors" :key="monitor.id" data-testid="site-monitor-check-row" :data-id="monitor.id">
          <td class="c-name">
            <span class="smc-name" :title="monitor.name">{{ monitor.name || '未命名检查项' }}</span>
            <span v-if="monitor.publishStatus === 'draft'" class="smc-tag" title="草稿未发布，不会执行">未生效</span>
            <span v-else-if="monitor.publishStatus === 'pending'" class="smc-tag">待生效</span>
            <span v-else-if="monitor.publishStatus === 'failed'" class="smc-tag smc-tag-bad">发布失败</span>
          </td>
          <td class="c-kind">{{ kindText(monitor) }}</td>
          <td class="c-summary" :title="checkSummary(monitor)">{{ checkSummary(monitor) }}</td>
          <td class="c-enabled">
            <div class="smc-enable">
              <el-switch
                size="small"
                :model-value="monitor.enabled"
                :loading="togglingId === monitor.id"
                :disabled="!!togglingId && togglingId !== monitor.id"
                data-testid="site-monitor-check-toggle"
                @change="(value: string | number | boolean) => emit('toggle', monitor, Boolean(value))"
              />
              <span class="smc-enable-text" :class="monitor.enabled ? 'is-on' : 'is-off'">
                {{ monitor.enabled ? '启用' : '停用' }}
              </span>
            </div>
          </td>
          <td class="c-data" :title="dataTitle(monitor)">
            <span class="smc-data" :class="toneClass(monitor.data === 'normal' ? 'good' : monitor.data === 'abnormal' ? 'bad' : 'unknown')">
              {{ dataText(monitor) }}
            </span>
          </td>
          <td class="c-plan" :title="planTitle(monitor)">
            <span class="smc-plan">{{ planText(monitor) }}</span>
          </td>
          <td class="c-edit">
            <button type="button" class="smc-link" data-testid="site-monitor-check-edit" @click="openEdit(monitor)">编辑</button>
          </td>
          <td class="c-runs">
            <button type="button" class="smc-link" data-testid="site-monitor-check-runs" @click="emit('runs', monitor)">
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
.smc-count {
  color: var(--rc-text-2, #5b667a);
  font-size: 12px;
}
.smc-hint {
  color: var(--rc-text-3, #8a94a6);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
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
.smc-table .c-name { width: 17%; }
.smc-table .c-kind { width: 9%; }
.smc-table .c-summary { width: 27%; }
.smc-table .c-enabled { width: 11%; }
.smc-table .c-data { width: 12%; }
.smc-table .c-plan { width: 14%; }
.smc-table .c-edit { width: 5%; }
.smc-table .c-runs { width: 5%; }
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
.smc-data.tone-good { color: var(--rc-success, #16a34a); }
.smc-data.tone-bad { color: var(--rc-danger, #dc2626); }
.smc-data.tone-unknown { color: var(--rc-text-2, #5b667a); }
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