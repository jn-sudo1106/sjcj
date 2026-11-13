<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { listNotifications, retryNotification } from '@/api/monitorCenter'
import type { MonitorNotificationDelivery, MonitorNotificationEvent } from '@/api/monitorCenter'

const props = defineProps<{
  sourceId?: string
  jobId?: string
}>()

const open = ref(false)
const rows = ref<MonitorNotificationEvent[]>([])
const count = ref(0)
const loading = ref(false)
const retrying = ref('')
const blocked = ref('')
const titleName = ref('')
const sourceId = ref(props.sourceId ?? '')
const jobId = ref(props.jobId ?? '')

/** 只有异常/失败才建事件，NORMAL 仅作防御性映射。 */
const STATUS_TEXT: Record<string, string> = {
  NORMAL: '正常',
  ABNORMAL: '异常',
  ERROR: '执行失败',
}
const DELIVERY_TEXT: Record<string, string> = {
  pending: '待投递',
  sending: '投递中',
  sent: '已发送',
  failed: '投递失败',
  'not-configured': '未配置通知',
}
const NO_JOB_TIP = '这条检查还没有 id，无法查询通知回执'

async function load() {
  if (!jobId.value) {
    rows.value = []
    count.value = 0
    blocked.value = NO_JOB_TIP
    return
  }
  blocked.value = ''
  loading.value = true
  try {
    const res = await listNotifications({ monitorId: jobId.value, limit: 50 })
    rows.value = res.items
    count.value = res.count
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载通知回执失败')
    rows.value = []
    count.value = 0
  } finally {
    loading.value = false
  }
}

function statusText(event: MonitorNotificationEvent) {
  const status = String(event.status ?? '').toUpperCase()
  return STATUS_TEXT[status] || status || '未知'
}
function statusTone(event: MonitorNotificationEvent): 'ok' | 'err' | 'muted' {
  const status = String(event.status ?? '').toUpperCase()
  if (status === 'NORMAL') return 'ok'
  if (status === 'ABNORMAL' || status === 'ERROR') return 'err'
  return 'muted'
}

function deliveryOf(event: MonitorNotificationEvent): MonitorNotificationDelivery | undefined {
  return event.delivery
}
function deliveryText(event: MonitorNotificationEvent) {
  const state = String(deliveryOf(event)?.state ?? '')
  if (!state) return '未取得回执'
  return DELIVERY_TEXT[state] || state
}
function deliveryTone(event: MonitorNotificationEvent): 'ok' | 'err' | 'muted' {
  const state = String(deliveryOf(event)?.state ?? '')
  if (state === 'sent') return 'ok'
  if (state === 'failed') return 'err'
  return 'muted'
}
function attemptText(event: MonitorNotificationEvent) {
  const attempts = Number(deliveryOf(event)?.attempts ?? 0)
  return attempts > 0 ? `第 ${attempts} 次` : ''
}
function deliveryDetail(event: MonitorNotificationEvent) {
  const delivery = deliveryOf(event)
  return delivery?.reason || delivery?.error || ''
}

/** sent / sending 不再允许重试（发送中重试会重复投递）。 */
function canRetry(event: MonitorNotificationEvent) {
  const state = String(deliveryOf(event)?.state ?? '')
  return !!event.eventId && state !== 'sent' && state !== 'sending'
}

async function retry(event: MonitorNotificationEvent) {
  if (!event.eventId) return
  retrying.value = event.eventId
  try {
    await retryNotification(event.eventId)
    ElMessage.success('已重新投递')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '重试投递失败')
  } finally {
    retrying.value = ''
  }
}

function countText(value?: number) {
  return value === undefined ? '—' : String(value)
}

// 对外：与 CheckLogsDrawer 相同的打开方式
defineExpose({
  show(nextSourceId: string, nextJobId?: string, monitorName?: string) {
    sourceId.value = nextSourceId
    jobId.value = nextJobId || ''
    titleName.value = monitorName || ''
    retrying.value = ''
    open.value = true
    void load()
  },
})
</script>

<template>
  <el-drawer
    v-model="open"
    :title="titleName ? `通知回执 · ${titleName}` : '通知回执'"
    direction="rtl"
    size="70%"
    destroy-on-close
  >
    <div class="nt-note">异常/失败才会生成通知事件；正常跑完不发通知</div>

    <el-alert
      v-if="blocked"
      :title="blocked"
      type="info"
      :closable="false"
      show-icon
      class="nt-blocked"
      data-testid="notify-blocked"
    />

    <template v-else>
      <div class="nt-head">
        <span class="nt-count">
          源 <span class="mono">{{ sourceId || '—' }}</span>
          <template v-if="count > 0"> · 共 <b>{{ count }}</b> 条</template>
        </span>
        <button class="rc-btn" type="button" :disabled="loading" @click="load">刷新</button>
      </div>

      <el-table
        v-if="rows.length"
        v-loading="loading"
        :data="rows"
        border
        stripe
        row-key="eventId"
        class="nt-table"
        max-height="700"
      >
        <el-table-column label="时间" width="140">
          <template #default="{ row }">
            <span class="mono-cell">{{ row.createdAt || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="运行编号" width="152">
          <template #default="{ row }">
            <span class="mono-cell nt-ellipsis" :title="row.runId || ''">{{ row.runId || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="结果" width="84" align="center">
          <template #default="{ row }">
            <span class="sc-badge" :class="`sc-badge-${statusTone(row)}`">{{ statusText(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="检查/异常" width="92" align="right">
          <template #default="{ row }">
            <span class="nt-nums">{{ countText(row.checkedCount) }} / {{ countText(row.abnormalCount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="原因" min-width="150">
          <template #default="{ row }">
            <span class="nt-ellipsis nt-reason" :title="row.reason || ''">{{ row.reason || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="投递状态" min-width="170">
          <template #default="{ row }">
            <div class="nt-delivery">
              <span class="sc-badge" :class="`sc-badge-${deliveryTone(row)}`">{{ deliveryText(row) }}</span>
              <span v-if="attemptText(row)" class="nt-sub">{{ attemptText(row) }}</span>
            </div>
            <div v-if="deliveryDetail(row)" class="nt-sub nt-detail" :title="deliveryDetail(row)">
              {{ deliveryDetail(row) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="96" align="center">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              :disabled="!canRetry(row)"
              :loading="retrying === row.eventId"
              @click="retry(row)"
            >
              重试投递
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-else-if="!loading"
        description="还没有通知回执：只有异常或执行失败才会产生通知事件"
        :image-size="60"
      />
    </template>
  </el-drawer>
</template>

<style scoped>
.nt-note {
  margin-bottom: 8px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.nt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.nt-count b {
  color: var(--rc-text, #0f172a);
  font-variant-numeric: tabular-nums;
}
.nt-table {
  width: 100%;
}
.nt-ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono-cell {
  font-family: var(--rc-mono, monospace);
  font-size: 11px;
}
.mono {
  font-family: var(--rc-mono, monospace);
}
.nt-reason {
  font-size: 12px;
}
.nt-nums {
  font-variant-numeric: tabular-nums;
}
.nt-delivery {
  display: flex;
  align-items: center;
  gap: 4px;
}
.nt-sub {
  color: var(--rc-muted, #64748b);
  font-size: 10px;
  white-space: nowrap;
}
.nt-detail {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}
.sc-badge-err {
  color: var(--rc-error, #dc2626);
  background: #fef2f2;
}
.sc-badge-ok {
  color: var(--rc-ok, #15803d);
  background: #f0fdf4;
}
.sc-badge-muted {
  color: var(--rc-muted, #64748b);
  background: #f1f5f9;
}
.nt-blocked {
  margin-bottom: 8px;
}
</style>