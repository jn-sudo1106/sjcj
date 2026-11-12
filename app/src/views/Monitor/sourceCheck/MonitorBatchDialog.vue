<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus } from '@element-plus/icons-vue'
import { monitorBatchesApi, type MonitorBatch, type MonitorBatchOptions } from '@/api/monitorBatches'
import type { Source } from '@/api'
import SourceListDialog from './SourceListDialog.vue'

const props = defineProps<{ modelValue: boolean; siteId?: string }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; changed: [] }>()
const options = reactive<MonitorBatchOptions>({ window: 'hours', hours: 24, schedule: '0 0 * * * ?' })
const ids = ref('')
const keyword = ref('')
const allSources = ref(false)
const picking = ref(false)
const creating = ref(false)
const error = ref('')
const current = ref<MonitorBatch | null>(null)
const history = ref<MonitorBatch[]>([])
const page = ref(1)
const selected = ref('')
const recipient = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let request = 0
const active = computed(() => !!current.value && ['preparing', 'applying', 'verifying'].includes(current.value.status))
const labels: Record<string, string> = {
  pending: '等待预检', preparing: '正在预检', previewed: '预检完成', ready: '可新增', existing: '已有通用检查',
  blocked: '条件不足', applying: '正在补齐', completed: '处理完成', paused: '已暂停',
  create_unknown: '提交待核对', created: '已新增', queued: '等待运行回执', verifying: '正在回查',
  unconfirmed: '未取得运行回执', executed: '已取得运行日志',
}
const readyCount = computed(() => current.value?.counts?.ready || 0)

async function load() {
  if (!selected.value || !props.modelValue) return
  const token = ++request
  clearTimeout(timer)
  try {
    const result = await monitorBatchesApi.get(selected.value, page.value)
    if (token !== request || !props.modelValue) return
    current.value = result
    error.value = ''
    if (result.delivery?.recipient) recipient.value = result.delivery.recipient
    if (active.value || result.delivery?.enabled) timer = setTimeout(() => void load(), active.value ? 2000 : 15000)
  } catch (reason) {
    if (token === request) error.value = reason instanceof Error ? reason.message : '读取批次失败'
  }
}

async function loadHistory() {
  try { history.value = await monitorBatchesApi.list() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : '读取批次失败' }
}

function pick(rows: Source[]) {
  ids.value = [...new Set([...ids.value.split(/[,，\s]+/), ...rows.map(row => row.sourceId)].filter(Boolean))].join('\n')
}

async function preview() {
  creating.value = true
  error.value = ''
  try {
    const result = await monitorBatchesApi.create({
      scope: { sourceIds: ids.value.split(/[,，\s]+/).filter(Boolean), siteId: props.siteId, name: keyword.value.trim() },
      allSources: allSources.value,
      options: { ...options },
    })
    selected.value = result.batchId
    page.value = 1
    await load()
    await loadHistory()
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '预检失败' }
  finally { creating.value = false }
}

async function action(kind: 'apply' | 'resume' | 'pause' | 'retry' | 'verify' | 'retry_delivery') {
  if (!current.value) return
  if (kind === 'retry_delivery') {
    try { await ElMessageBox.confirm('未取得回执的邮件可能已经发出，重试可能重复。确认核对过收件箱后重试？', '重试邮件投递', { confirmButtonText: '重试', cancelButtonText: '取消' }) }
    catch { return }
  }
  if (kind === 'apply' || kind === 'verify') {
    try {
      await ElMessageBox.confirm(kind === 'apply'
        ? `将为 ${readyCount.value} 个源新增独立定时检查。已有通用检查保持原样，新检查的业务通知默认静默。`
        : '将立即运行本批新建检查，并等待实际运行日志；已有检查不会被触发。业务通知保持静默。',
      kind === 'apply' ? '确认补齐监控' : '运行并核验', { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' })
    } catch { return }
  }
  creating.value = true
  try {
    await monitorBatchesApi.action(current.value.batchId, kind)
    await load()
    if (kind === 'apply') emit('changed')
  } catch (reason) { ElMessage.error(reason instanceof Error ? reason.message : '操作失败') }
  finally { creating.value = false }
}

async function delivery(enabled: boolean | string | number) {
  if (!current.value) return
  creating.value = true
  try {
    await monitorBatchesApi.delivery(current.value.batchId, recipient.value.trim(), enabled === true)
    await load()
  } catch (reason) { ElMessage.error(reason instanceof Error ? reason.message : '通知设置失败') }
  finally { creating.value = false }
}

function fresh() {
  clearTimeout(timer)
  request += 1
  current.value = null
  selected.value = ''
  recipient.value = ''
  page.value = 1
  error.value = ''
}

watch(() => props.modelValue, (open) => {
  if (open) { void loadHistory(); if (selected.value) void load() }
  else { request += 1; clearTimeout(timer); emit('changed') }
})
onBeforeUnmount(() => { request += 1; clearTimeout(timer) })
</script>

<template>
  <el-dialog :model-value="modelValue" title="批量补齐入库监控" width="min(1080px, calc(100vw - 32px))" top="4vh" class="monitor-batch-dialog" append-to-body @update:model-value="emit('update:modelValue', $event)">
    <div class="mb-shell">
      <div class="mb-toolbar">
        <span>后台批次</span>
        <el-select v-model="selected" placeholder="查看已有批次" style="width: 320px" @change="page = 1; load()">
          <el-option v-for="job in history" :key="job.batchId" :value="job.batchId" :label="`${job.createdAt} · ${labels[job.status] || job.status}`" />
        </el-select>
        <el-button :icon="Refresh" circle size="small" aria-label="刷新批次" @click="loadHistory(); load()" />
        <el-button :icon="Plus" size="small" @click="fresh">新批次</el-button>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <template v-if="!current">
        <p class="mb-note">先验证源和实际查询，再批量新增独立定时检查。仅处理启用源；填写源 ID 时按 ID 圈定，否则按名称、网站或全部启用源圈定。检查不依赖流程完成，原有检查不被覆盖。</p>
        <div class="mb-form">
          <label class="mb-field"><span>源 ID（逗号或换行分隔）</span><el-input v-model="ids" type="textarea" :rows="3" placeholder="输入源 ID，或通过右侧按钮选择" /></label>
          <div class="mb-field"><span>源范围</span><el-button @click="picking = true">选择源</el-button><el-input v-model="keyword" placeholder="源名称筛选" /><el-checkbox v-model="allSources" :disabled="!!ids.trim()">包含全部符合条件的启用源</el-checkbox><small v-if="siteId">范围锁定当前网站 {{ siteId }}</small></div>
          <label class="mb-field"><span>检查窗口</span><el-radio-group v-model="options.window"><el-radio value="hours">最近时长</el-radio><el-radio value="today">当日</el-radio></el-radio-group><el-input-number v-if="options.window === 'hours'" v-model="options.hours" :min="1" :max="8784" /><small>最近时长单位为小时；不同更新周期请分批设置，不能把月更源按日更检查。</small></label>
          <label class="mb-field"><span>独立检查计划（cron）</span><el-input v-model="options.schedule" placeholder="例如 0 0 * * * ?" /><small>默认每小时检查；每个窗口至少应有 1 条新增。新检查通知静默，可在单项编辑中配置。</small></label>
        </div>
        <el-button type="primary" :loading="creating" @click="preview">开始预检</el-button>
      </template>
      <template v-else>
        <div class="mb-summary"><strong>{{ labels[current.status] || current.status }}</strong><span>源 {{ current.total }} · 可新增 {{ current.counts.ready || 0 }} · 已有 {{ current.counts.existing || 0 }} · 已新增 {{ current.counts.created || 0 }} · 已回执 {{ current.counts.executed || 0 }} · 条件不足 {{ current.counts.blocked || 0 }} · 待核对 {{ (current.counts.create_unknown || 0) + (current.counts.unconfirmed || 0) }}</span></div>
        <p class="mb-note">{{ current.message }}</p>
        <div class="mb-actions">
          <el-button v-if="current.status === 'previewed' && readyCount" type="primary" :loading="creating" @click="action('apply')">补齐 {{ readyCount }} 项检查</el-button>
          <el-button v-if="!active && ((current.counts.created || 0) + (current.counts.unconfirmed || 0) > 0)" :loading="creating" @click="action('verify')">运行并核验本批新建检查</el-button>
          <el-button v-if="active" @click="action('pause')">暂停批次</el-button>
          <el-button v-if="current.status === 'paused'" @click="action('resume')">继续批次</el-button>
          <el-button v-if="!active && current.counts.blocked" @click="action('retry')">重试条件不足项</el-button>
          <span class="mb-note">关闭弹窗后后台继续；服务重启或会话失效后可继续批次。</span>
        </div>
        <section v-if="(current.counts.created || 0) + (current.counts.queued || 0) + (current.counts.executed || 0) + (current.counts.unconfirmed || 0) > 0" class="mb-delivery">
          <div class="mb-actions"><strong>独立邮件通知</strong><el-input v-model="recipient" type="email" placeholder="通知邮箱" :disabled="!!current.delivery?.recipient" style="width: 250px" aria-label="独立通知邮箱" /><el-switch :model-value="!!current.delivery?.enabled" :loading="creating" aria-label="启用独立邮件通知" @change="delivery" /><span>{{ current.delivery?.enabled ? '已启用' : '未启用' }}</span></div>
          <p class="mb-note">仅通知本批次新增检查，包含异常、恢复和超期 15 分钟未运行；直接投递到填写的邮箱，不经过采集队列。已有检查的通知保持原样。</p>
          <p v-if="current.delivery?.lastPollAt" class="mb-note">最近巡检：{{ current.delivery.lastPollAt }}</p>
          <p v-if="current.delivery?.error" class="mb-bad">{{ current.delivery.error }}</p>
          <div v-for="receipt in current.delivery?.receipts.slice(0, 5)" :key="receipt.messageId" class="mb-receipt"><strong>{{ receipt.status === 'accepted' ? 'SMTP 已接受' : receipt.status === 'failed' ? '投递失败' : receipt.status === 'uncertain' ? '投递待核对' : '等待投递' }}</strong> · {{ receipt.subject }}<div class="mb-note">{{ receipt.message }} · {{ receipt.acceptedAt || receipt.createdAt }} · {{ receipt.messageId }}</div></div>
          <el-button v-if="current.delivery?.receipts.some(row => ['failed', 'uncertain'].includes(row.status))" size="small" @click="action('retry_delivery')">核对后重试投递</el-button>
        </section>
        <el-table :data="current.items" size="small" class="rc-data-table">
          <el-table-column label="源" min-width="165"><template #default="{ row }"><strong>{{ row.name }}</strong><div class="mb-note">{{ row.sourceId }}</div></template></el-table-column>
          <el-table-column prop="tableName" label="检查表" min-width="160" show-overflow-tooltip />
          <el-table-column label="状态" width="132"><template #default="{ row }">{{ labels[row.status] || row.status }}</template></el-table-column>
          <el-table-column label="查询条数" width="80"><template #default="{ row }">{{ row.checkedCount ?? '—' }}</template></el-table-column>
          <el-table-column prop="monitorId" label="检查 ID" width="85" />
          <el-table-column label="结果与原因" min-width="250"><template #default="{ row }"><span v-if="row.data" :class="row.data === 'abnormal' ? 'mb-bad' : ''">{{ row.exec === 'failed' ? '执行失败' : row.data === 'abnormal' ? '数据异常' : row.data === 'normal' ? '数据正常' : '待判断' }} · </span><span :title="row.message">{{ row.message }}</span></template></el-table-column>
        </el-table>
        <el-pagination v-model:current-page="page" :total="current.total" :page-size="50" size="small" background layout="total, prev, pager, next" @current-change="load" />
      </template>
    </div>
    <SourceListDialog v-model="picking" @selected="pick" />
  </el-dialog>
</template>

<style scoped>
.mb-shell { display: flex; flex-direction: column; gap: 12px; max-height: calc(88dvh - 90px); overflow-y: auto; }
.mb-toolbar, .mb-actions, .mb-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mb-toolbar { padding-bottom: 12px; border-bottom: 1px solid var(--rc-border); }
.mb-form { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.mb-field { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.mb-field > span { font-weight: 600; }
.mb-field small, .mb-note { color: var(--rc-muted); font-size: 11px; line-height: 1.6; margin: 0; }
.mb-summary { background: var(--rc-bg); padding: 10px 12px; border-radius: 6px; font-size: 12px; }
.mb-summary strong { color: var(--rc-primary); }
.mb-bad { color: var(--rc-error); }
.mb-delivery { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; }
.mb-receipt { padding-top: 6px; border-top: 1px solid var(--rc-border); overflow-wrap: anywhere; }
@media (max-width: 700px) { .mb-form { grid-template-columns: 1fr; } }
</style>
