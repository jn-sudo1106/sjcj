<script setup lang="ts">
// 异常面板（P3-1 收尾 · 性能优化 · P0-1 修复 + P2-3）
// props 收窄：原 props.data: OverviewSummary → topSources + exceptions + kpi
//   · kpi 仍传完整 object（仅用 3 字段 alarms/errorSources/runningRuns，进一步激进收窄
//     拆 3 个 number props 收益有限且接口复杂，保持当前方案）
//   · P2-3 模板行内 `stateMeta(s.state)` 每行调两次 → 抽 displayedSources row-level computed
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { OverviewException, OverviewKpi, OverviewTopSource } from '@/api'

const props = defineProps<{
  topSources: OverviewTopSource[]
  exceptions: OverviewException[]
  kpi: OverviewKpi
}>()

const router = useRouter()

function goCollect(state?: string) {
  router.push({ path: '/collect', query: state ? { state } : {} })
}

function stateMeta(s: string) {
  if (s === 'D') return { cls: 'muted', text: '已停用' }
  if (s === 'C') return { cls: 'ok', text: '在线' }
  if (s === 'E') return { cls: 'err', text: '异常' }
  if (s === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '-' }
}

const runtimeRows = computed(() =>
  (props.topSources ?? []).slice(0, 5).map((s, index) => ({
    time: s.lastSuccessAt?.slice(11, 16) || `14:${32 - index}`,
    title: s.name,
    detail: s.state === 'E' ? '采集失败，等待重试' : `数据量：${s.dataCount.toLocaleString()} 条`,
    cls: s.state === 'E' ? 'err' : s.state === 'L' ? 'run' : 'ok',
  })),
)

// P2-3：把 stateMeta 提到 row 上，每行只算一次（避免模板 :class 和 {{ }} 各调一次）
const displayedSources = computed(() =>
  (props.topSources ?? []).map((s) => ({
    source: s,
    stateMeta: stateMeta(s.state),
  })),
)

const alertCards = computed(() => {
  const exceptions = props.exceptions ?? []
  return [
    { label: '紧急', value: exceptions.filter((e) => e.kind === 'error').length, cls: 'urgent', level: 'error' },
    { label: '重要', value: exceptions.filter((e) => e.kind === 'external').length || props.kpi?.alarms || 0, cls: 'major', level: 'external' },
    { label: '一般', value: exceptions.filter((e) => e.kind === 'disabled').length || props.kpi?.errorSources || 0, cls: 'normal', level: 'disabled' },
    { label: '提示', value: props.kpi?.runningRuns ?? 0, cls: 'info', level: 'running' },
  ]
})

function onAlert(level: string) {
  if (level === 'error') return goCollect('E')
  if (level === 'external') return goCollect('external')
  if (level === 'disabled') return goCollect('disabled')
  if (level === 'running') return router.push({ path: '/runs', query: { state: 'L' } })
  return router.push('/monitor')
}
</script>

<template>
  <div class="ov-bottom-grid">
    <div class="rc-card ov-source-card">
      <div class="rc-card-head">
        <div class="rc-card-title">重点采集源</div>
        <button class="ov-more" type="button" @click="goCollect()">查看全部 ›</button>
      </div>
      <div class="rc-table-scroll">
        <table class="rc-data-table">
          <thead>
            <tr>
              <th style="width: 54px">排名</th>
              <th>采集源名称</th>
              <th style="width: 90px">类型</th>
              <th style="width: 100px">负责人</th>
              <th style="width: 84px">状态</th>
              <th style="width: 150px">最近同步</th>
              <th style="width: 90px">质量评分</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in displayedSources" :key="row.source.sourceId">
              <td><span class="ov-rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
              <td>
                <div class="ov-src-name">{{ row.source.name }}</div>
                <div class="muted">{{ row.source.sourceId }}</div>
              </td>
              <td>{{ row.source.category }}</td>
              <td>{{ row.source.owner ?? '—' }}</td>
              <td><span class="rc-status" :class="row.stateMeta.cls">{{ row.stateMeta.text }}</span></td>
              <td class="muted">{{ row.source.lastSuccessAt || '-' }}</td>
              <td>{{ row.source.qualityScore ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="rc-card ov-live-card">
      <div class="rc-card-head">
        <div class="rc-card-title">实时运行动态</div>
        <button class="ov-more" type="button" @click="router.push('/runs')">查看更多 ›</button>
      </div>
      <div class="ov-live">
        <button v-for="r in runtimeRows" :key="r.title + r.time" class="ov-live-row" type="button" @click="router.push('/runs')">
          <span class="ov-live-dot" :class="r.cls" />
          <span class="ov-live-time">{{ r.time }}</span>
          <span class="ov-live-copy">
            <b>{{ r.title }}</b>
            <small>{{ r.detail }}</small>
          </span>
        </button>
      </div>
    </div>

    <div class="ov-side-stack">
      <div class="rc-card">
        <div class="rc-card-head">
          <div class="rc-card-title">告警概览</div>
          <button class="ov-more" type="button" @click="goCollect('E')">查看更多 ›</button>
        </div>
        <div class="ov-alerts">
          <button v-for="a in alertCards" :key="a.label" class="ov-alert" :class="a.cls" type="button" :aria-label="`${a.label}告警 ${a.value} 条`" @click="onAlert(a.level)">
            <span>{{ a.label }}</span>
            <b>{{ a.value }}</b>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ov-bottom-grid {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1.7fr) minmax(360px, 1fr) 390px;
  gap: 12px;
  align-items: stretch;
  animation: ov-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.38s both;
}

.ov-side-stack {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}

.rc-card {
  min-width: 0;
  border-color: #dfe8f5;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}

.rc-card:hover {
  border-color: #cfe0fb;
  box-shadow: 0 12px 32px rgba(37, 99, 235, 0.08);
}

.rc-card-head {
  min-height: 48px;
  padding: 12px 16px;
  background: #fff;
}

.rc-card-title {
  color: #0f1e46;
  font-size: 15px;
}

.ov-live-card {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.ov-more {
  border: 0;
  background: transparent;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.15s ease, opacity 0.15s ease;
}

.ov-more:hover {
  color: #1d4ed8;
  opacity: 0.85;
}

.ov-src-name {
  color: #1e293b;
  font-size: 12px;
  font-weight: 700;
}

.ov-rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #64748b;
  font-weight: 800;
}

.ov-rank.top {
  border: 1px solid #fdba74;
  color: #f97316;
  background: #fff7ed;
}

.ov-live {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 10px 16px 14px;
}

.ov-live-row {
  display: grid;
  grid-template-columns: 16px 54px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.ov-live-dot {
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border: 2px solid currentColor;
  border-radius: 50%;
  color: #22c55e;
}

.ov-live-dot.err {
  color: #ef4444;
}

.ov-live-dot.run {
  color: #2563eb;
  animation: ov-dot-pulse 1.8s ease-in-out infinite;
}

.ov-live-time {
  color: #526481;
  font-size: 12px;
}

.ov-live-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.ov-live-copy b {
  overflow: hidden;
  color: #1e293b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-live-copy small {
  overflow: hidden;
  margin-top: 2px;
  color: #64748b;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-alerts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  padding: 14px 16px 16px;
}

.ov-alert {
  min-height: 56px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.25s ease, border-color 0.2s ease;
}

.ov-alert:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.ov-alert span {
  display: block;
  font-size: 12px;
  font-weight: 700;
}

.ov-alert b {
  display: block;
  margin-top: 4px;
  font-size: 24px;
}

.ov-alert.urgent {
  border-color: #fecaca;
  color: #dc2626;
  background: #fff7f7;
}

.ov-alert.major {
  border-color: #fed7aa;
  color: #ea580c;
  background: #fff7ed;
}

.ov-alert.normal {
  border-color: #fde68a;
  color: #b45309;
  background: #fffbeb;
}

.ov-alert.info {
  border-color: #bfdbfe;
  color: #2563eb;
  background: #eff6ff;
}

@keyframes ov-rise {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes ov-dot-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(37, 99, 235, 0);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(37, 99, 235, 0.15);
  }
}

@media (max-width: 1480px) {
  .ov-bottom-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ov-source-card {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .ov-bottom-grid {
    grid-template-columns: 1fr;
  }

  .ov-source-card {
    grid-column: auto;
  }

  .ov-alerts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
