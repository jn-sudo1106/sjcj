<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { monitorApi, type HealthCard, type MqQueue, type SyncRow, type AlarmRow } from '../../api'
import { useUiStore } from '../../stores/ui'
import StatusTag from '@/components/StatusTag.vue'

const ui = useUiStore()

const health = ref<HealthCard[]>([])
const mq = ref<MqQueue[]>([])
const sync = ref<SyncRow[]>([])
const alarms = ref<AlarmRow[]>([])
const stats = reactive({ healthText: '—', queueAlarms: 0, cacheWindow: '—', dangerOpen: 0 })

async function loadAll() {
  const [h, m, s, a, st] = await Promise.all([
    monitorApi.health(),
    monitorApi.mq(),
    monitorApi.sync(),
    monitorApi.alarms(),
    monitorApi.monitorStats(),
  ])
  health.value = h
  mq.value = m
  sync.value = s
  alarms.value = a
  Object.assign(stats, st)
}

function healthMeta(s: string) {
  if (s === 'ok') return { cls: 'ok', text: '正常' }
  if (s === 'warn') return { cls: 'warn', text: '告警' }
  return { cls: 'err', text: '离线' }
}
function mqMeta(s: string) {
  if (s === 'ok') return { cls: 'ok', text: '正常' }
  if (s === 'warn') return { cls: 'warn', text: '积压' }
  return { cls: 'err', text: '失败' }
}
function alarmMeta(l: string) {
  if (l === 'fail') return { cls: 'err', text: '失败' }
  if (l === 'block') return { cls: 'warn', text: '阻断' }
  return { cls: 'ok', text: '恢复' }
}

const CONTROLLED = ['清空队列', '清本地缓存', '批量重发']
function applyApproval(name: string) {
  ElMessageBox.confirm(`「${name}」为高危运维动作，首期不直接执行，是否提交审批？`, '提交审批', {
    type: 'warning',
    confirmButtonText: '提交审批',
    cancelButtonText: '取消',
  })
    .then(() => ElMessage.success('已提交审批（演示环境，高危动作不直接执行）'))
    .catch(() => {})
}

onMounted(async () => {
  await loadAll()
  ui.registerAction('刷新', async () => {
    await loadAll()
    ElMessage.success('已刷新监控状态')
  })
  ui.registerAction('导出报表', () => ElMessage.info('导出报表：演示环境占位'))
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="mo-wrap">
    <div class="rc-metric-grid mo-kpis">
      <div class="rc-metric"><span>执行器健康</span><b>{{ stats.healthText }}</b></div>
      <div class="rc-metric"><span>队列告警</span><b class="danger">{{ stats.queueAlarms }}</b></div>
      <div class="rc-metric"><span>本地缓存窗口</span><b>{{ stats.cacheWindow }}</b></div>
      <div class="rc-metric"><span>已开放高危动作</span><b>{{ stats.dangerOpen }}</b></div>
    </div>

    <!-- 健康卡 -->
    <div class="mo-health">
      <div v-for="h in health" :key="h.key" class="rc-card mo-hcard">
        <div class="mo-hcard-top">
          <strong>{{ h.name }}</strong>
          <span class="rc-status" :class="healthMeta(h.status).cls">{{ healthMeta(h.status).text }}</span>
        </div>
        <div class="muted">{{ h.detail }}</div>
      </div>
    </div>

    <div class="mo-cols">
      <!-- MQ -->
      <div class="rc-card mo-block">
        <div class="rc-card-head"><div class="rc-card-title">MQ 状态</div></div>
        <div class="rc-table-scroll">
          <table class="rc-data-table">
            <thead>
              <tr><th>队列</th><th style="width: 80px">积压</th><th style="width: 80px">失败</th><th style="width: 80px">状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="q in mq" :key="q.name">
                <td>{{ q.name }}</td>
                <td>{{ q.pending.toLocaleString() }}</td>
                <td>{{ q.failed }}</td>
                <td><span class="rc-status" :class="mqMeta(q.state).cls">{{ mqMeta(q.state).text }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 同步状态 -->
      <div class="rc-card mo-block">
        <div class="rc-card-head"><div class="rc-card-title">同步状态</div></div>
        <div class="rc-table-scroll">
          <table class="rc-data-table">
            <thead>
              <tr><th>客户端</th><th style="width: 90px">状态</th><th style="width: 70px">差异</th><th style="width: 90px">外部变更</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in sync" :key="s.client">
                <td>{{ s.client }}</td>
                <td>{{ s.status }}</td>
                <td>{{ s.diff }}</td>
                <td>
                  <StatusTag v-if="s.externalChanged" text="待确认" tone="warn" :show-icon="false" />
                  <StatusTag v-else text="一致" tone="ok" :show-icon="false" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 告警 -->
    <div class="rc-card mo-block">
      <div class="rc-card-head"><div class="rc-card-title">告警</div></div>
      <div class="mo-alarms">
        <div v-for="a in alarms" :key="a.alarmId" class="mo-alarm">
          <span class="rc-status" :class="alarmMeta(a.level).cls">{{ alarmMeta(a.level).text }}</span>
          <span class="mo-alarm-text">{{ a.text }}</span>
          <span class="muted">{{ a.at }}</span>
        </div>
      </div>
    </div>

    <!-- 受控动作 -->
    <div class="rc-card mo-block">
      <div class="rc-card-head">
        <div>
          <div class="rc-card-title">受控运维动作</div>
          <div class="rc-card-sub">高危动作首期只显审批入口，不直接执行</div>
        </div>
      </div>
      <div class="mo-controlled">
        <div v-for="c in CONTROLLED" :key="c" class="mo-ctrl">
          <span>{{ c }}</span>
          <button class="rc-btn danger" type="button" @click="applyApproval(c)">申请审批</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mo-wrap {
  height: calc(100vh - 168px);
  min-height: 560px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}
.mo-kpis {
  flex: none;
}
.mo-health {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.mo-hcard {
  padding: 14px 16px;
}
.mo-hcard-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.mo-hcard-top strong {
  font-size: 13px;
  color: var(--rc-text);
}
.mo-cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.mo-block {
  min-width: 0;
}
.mo-alarms {
  padding: 8px 16px 14px;
  display: flex;
  flex-direction: column;
}
.mo-alarm {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--rc-border-soft);
  font-size: 13px;
}
.mo-alarm:first-child {
  border-top: 0;
}
.mo-alarm-text {
  flex: 1;
  color: var(--rc-text-2);
}
.mo-controlled {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}
.mo-ctrl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: #fff;
  font-size: 13px;
  color: var(--rc-text-2);
}

@media (max-width: 1100px) {
  .mo-health {
    grid-template-columns: 1fr 1fr;
  }
  .mo-cols, .mo-controlled {
    grid-template-columns: 1fr;
  }
}
</style>
