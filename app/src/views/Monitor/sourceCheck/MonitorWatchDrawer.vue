<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { monitorWatchApi, type MonitorWatchQueueStatus, type MonitorWatchSnapshot } from '@/api/monitorWatch'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const snapshot = ref<MonitorWatchSnapshot | null>(null)
const loading = ref(false)
const scanning = ref(false)
const error = ref('')

const QUEUE_TEXT: Record<MonitorWatchQueueStatus, string> = {
  ok: '正常',
  missing: '队列缺失',
  backlog: '积压',
  insufficient: '量不足',
  slow_consumer: '消费过慢',
  too_fast: '消费过快',
  no_consumer: '消费者不足',
}

const queueProblems = computed(() => (snapshot.value?.queue.items || []).filter((item) => item.status !== 'ok'))
const healthy = computed(() => snapshot.value?.summary.healthy === true)
const unsettled = computed(() => !snapshot.value
  || !snapshot.value.queue.reachable
  || !snapshot.value.monitors.available)

function toneOf(status: MonitorWatchQueueStatus) {
  if (status === 'ok') return 'ok'
  if (status === 'missing' || status === 'no_consumer' || status === 'backlog') return 'err'
  return 'warn'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await monitorWatchApi.status()
    snapshot.value = result.latest
  } catch (e) {
    error.value = `巡检状态读取失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loading.value = false
  }
}

async function scan() {
  scanning.value = true
  error.value = ''
  try {
    snapshot.value = await monitorWatchApi.scan()
    ElMessage.success('已完成一次独立巡检')
  } catch (e) {
    error.value = `巡检失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    scanning.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) void load()
}, { immediate: true })
</script>

<template>
  <el-drawer :model-value="open" title="独立巡检" size="520px" @update:model-value="(v: boolean) => !v && emit('close')">
    <div class="mw-body">
      <p class="mw-note">
        独立线程巡检队列与漏跑，不经过采集队列；<b>指标不可取得时按未知处理，不显示为正常</b>。
      </p>

      <div class="mw-head">
        <span v-if="snapshot" class="mw-at">巡检时间 {{ snapshot.at.replace('T', ' ').slice(0, 19) }}</span>
        <span v-else class="mw-at">尚无巡检结果</span>
        <span
          class="mw-state"
          :class="unsettled ? 'is-unknown' : healthy ? 'is-ok' : 'is-bad'"
        >{{ unsettled ? '未知' : healthy ? '正常' : '有异常' }}</span>
        <span class="mw-spacer" />
        <el-button size="small" :loading="scanning" @click="scan">重新巡检</el-button>
      </div>

      <p v-if="error" class="mw-error">{{ error }}</p>
      <p v-else-if="loading" class="mw-note">正在读取巡检结果…</p>

      <template v-if="snapshot">
        <section class="mw-section">
          <header class="mw-section-head">
            <span>队列健康</span>
            <span v-if="snapshot.queue.reachable" class="mw-count">
              {{ snapshot.queue.summary.total }} 个启用队列 · 异常 {{ snapshot.queue.summary.problems }}
            </span>
            <span v-else class="mw-count">不可取得</span>
          </header>
          <p v-if="!snapshot.queue.reachable" class="mw-warn">
            队列指标不可取得：{{ snapshot.queue.error || '未知原因' }}。当前不能判断队列是否正常。
          </p>
          <p v-else-if="!queueProblems.length" class="mw-ok-note">启用的队列都在阈值内。</p>
          <ul v-else class="mw-list">
            <li v-for="item in queueProblems" :key="item.name">
              <span class="mw-name">{{ item.name }}</span>
              <span class="mw-tag" :class="`is-${toneOf(item.status)}`">{{ QUEUE_TEXT[item.status] }}</span>
              <span class="mw-reason">{{ item.reason }}</span>
            </li>
          </ul>
        </section>

        <section class="mw-section">
          <header class="mw-section-head">
            <span>监控自身漏跑</span>
            <span v-if="snapshot.monitors.available" class="mw-count">
              超过宽限 {{ snapshot.monitors.graceMinutes }} 分钟 · {{ snapshot.monitors.count }} 项
            </span>
            <span v-else class="mw-count">不可取得</span>
          </header>
          <p v-if="!snapshot.monitors.available" class="mw-warn">
            漏跑核对不可取得：{{ snapshot.monitors.error || '未知原因' }}。当前不能判断是否有漏跑。
          </p>
          <p v-else-if="!snapshot.monitors.count" class="mw-ok-note">没有超过宽限期仍未执行的检查项。</p>
          <ul v-else class="mw-list">
            <li v-for="item in snapshot.monitors.items" :key="item.monitorId">
              <span class="mw-name">{{ item.name }}</span>
              <span class="mw-tag is-err">漏跑</span>
              <span class="mw-reason">
                源 {{ item.sourceId }} · 检查 {{ item.monitorId }} · 应执行 {{ item.due }}<template v-if="item.lastLog"> · 最近日志 {{ item.lastLog }}</template>
              </span>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </el-drawer>
</template>

<style scoped>
.mw-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mw-note {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}
.mw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #475569;
}
.mw-spacer { flex: 1; }
.mw-at { color: #64748b; }
.mw-state {
  padding: 0 7px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 20px;
}
.mw-state.is-ok { background: #f0fdf4; color: #15803d; }
.mw-state.is-bad { background: #fef2f2; color: #dc2626; }
.mw-state.is-unknown { background: #f1f5f9; color: #64748b; }
.mw-error {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12px;
}
.mw-section {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
}
.mw-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 600;
  color: #0f172a;
}
.mw-count { color: #64748b; font-weight: 400; font-size: 12px; }
.mw-warn {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 12px;
  line-height: 1.6;
}
.mw-ok-note { margin: 8px 0 0; color: #15803d; font-size: 12px; }
.mw-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mw-list li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
}
.mw-name { font-weight: 600; color: #0f172a; }
.mw-tag {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}
.mw-tag.is-ok { background: #f0fdf4; color: #15803d; }
.mw-tag.is-warn { background: #fff7ed; color: #c2410c; }
.mw-tag.is-err { background: #fef2f2; color: #dc2626; }
.mw-reason { color: #64748b; }
</style>