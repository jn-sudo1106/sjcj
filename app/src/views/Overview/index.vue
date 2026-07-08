<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Bell, Box, CircleCheck, Document, Files } from '@element-plus/icons-vue'
import { overviewApi, type OverviewSummary, type TrendPoint } from '../../api'
import { useUiStore } from '../../stores/ui'
import CountUp from '../../components/CountUp.vue'
import DonutChart from '../../components/charts/DonutChart.vue'
import TrendBars from '../../components/charts/TrendBars.vue'
import AssetFlow from '../../components/charts/AssetFlow.vue'

const router = useRouter()
const ui = useUiStore()

const data = ref<OverviewSummary | null>(null)
const trend = ref<TrendPoint[]>([])
const days = ref(7)
const loading = ref(false)
const loadError = ref('')

async function loadSummary() {
  data.value = await overviewApi.summary()
}

async function loadTrend() {
  trend.value = await overviewApi.trend(days.value)
}

async function loadAll() {
  loading.value = true
  loadError.value = ''
  try {
    await Promise.all([loadSummary(), loadTrend()])
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '数据加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function setDays(d: number) {
  days.value = d
  loadTrend()
}

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

interface Kpi {
  key: string
  label: string
  value: string | number
  numeric: boolean
  unit?: string
  delta: string
  trend: 'up' | 'down'
  icon: Component
  tone: string
  to?: () => void
}

const activeSources = computed(() =>
  (data.value?.byState ?? []).filter((s) => s.label !== '已停用').reduce((a, b) => a + b.value, 0),
)

const latestTaskCount = computed(() => trend.value.at(-1)?.snatch ?? 0)
const displayKpis = computed<Kpi[]>(() => {
  const k = data.value?.kpi
  if (!k) return []
  return [
    { key: 'sources', label: '采集资产总数', value: k.sources, numeric: true, delta: '3.2%', trend: 'up', icon: Box, tone: 'primary', to: () => goCollect() },
    { key: 'active', label: '在线采集源', value: activeSources.value, numeric: true, delta: '5.6%', trend: 'up', icon: CircleCheck, tone: 'ok', to: () => goCollect() },
    { key: 'today', label: '今日采集任务', value: latestTaskCount.value, numeric: true, delta: '12.7%', trend: 'up', icon: Document, tone: 'primary', to: () => router.push('/runs') },
    { key: 'rate', label: '成功率', value: k.successRate, numeric: false, delta: '0.42%', trend: 'up', icon: CircleCheck, tone: 'primary' },
    { key: 'alarms', label: '告警数量', value: k.alarms, numeric: true, unit: '条', delta: '20.0%', trend: 'down', icon: Bell, tone: 'err', to: () => router.push('/tools') },
    { key: 'new7', label: '近7日新增资产', value: k.newAssets7, numeric: true, delta: '18.4%', trend: 'up', icon: Files, tone: 'indigo' },
  ]
})

const updatedAt = computed(() => data.value?.updatedAt ?? '-')

const runtimeRows = computed(() =>
  (data.value?.topSources ?? []).slice(0, 5).map((s, index) => ({
    time: s.lastSuccessAt?.slice(11, 16) || `14:${32 - index}`,
    title: s.name,
    detail: s.state === 'E' ? '采集失败，等待重试' : `数据量：${s.dataCount.toLocaleString()} 条`,
    cls: s.state === 'E' ? 'err' : s.state === 'L' ? 'run' : 'ok',
  })),
)

const alertCards = computed(() => {
  const exceptions = data.value?.exceptions ?? []
  return [
    { label: '紧急', value: exceptions.filter((e) => e.kind === 'error').length, cls: 'urgent', level: 'error' },
    { label: '重要', value: exceptions.filter((e) => e.kind === 'external').length || data.value?.kpi.alarms || 0, cls: 'major', level: 'external' },
    { label: '一般', value: exceptions.filter((e) => e.kind === 'disabled').length || data.value?.kpi.errorSources || 0, cls: 'normal', level: 'disabled' },
    { label: '提示', value: data.value?.kpi.runningRuns ?? 0, cls: 'info', level: 'running' },
  ]
})

function onAlert(level: string) {
  if (level === 'error') return goCollect('E')
  if (level === 'external') return goCollect('external')
  if (level === 'disabled') return goCollect('disabled')
  if (level === 'running') return router.push({ path: '/runs', query: { state: 'L' } })
  return router.push('/tools')
}

onMounted(async () => {
  await loadAll()
  ui.registerAction('刷新', async () => {
    await loadAll()
    ElMessage.success('已刷新采集资产总览')
  })
  ui.registerAction('导出', () => ElMessage.info('导出总览：演示环境占位'))
  ui.registerAction('新建采集', () => {
    router.push({ path: '/canvas', query: { mode: 'new' } })
  })
})

onUnmounted(() => ui.clearActions())
</script>

<template>
  <div v-loading="loading" class="ov">
    <div v-if="loadError" class="ov-empty">
      <div class="ov-empty-icon">!</div>
      <div class="ov-empty-title">加载失败</div>
      <div class="ov-empty-text">{{ loadError }}</div>
      <button class="ov-empty-btn" type="button" @click="loadAll">重新加载</button>
    </div>

    <template v-else-if="data">
    <div class="ov-intro">
      <div>实时掌握采集资产运行态势，提升数据采集稳定性与治理效率。</div>
      <div class="ov-fresh">
        <span>数据更新时间：{{ updatedAt }}</span>
      </div>
    </div>

    <div class="ov-kpis">
      <button
        v-for="k in displayKpis"
        :key="k.key"
        class="ov-kpi"
        :class="[k.tone, { clickable: !!k.to }]"
        type="button"
        :aria-label="`${k.label}：${k.value}${k.unit ?? ''}`"
        @click="k.to?.()"
      >
        <span class="ov-kpi-copy">
          <span class="ov-kpi-label">{{ k.label }}</span>
          <span class="ov-kpi-val">
            <CountUp v-if="k.numeric" :value="Number(k.value)" />
            <template v-else>{{ k.value }}</template>
            <small v-if="k.unit">{{ k.unit }}</small>
          </span>
          <span class="ov-delta" :class="k.trend">较昨日 <b>{{ k.trend === 'up' ? '↑' : '↓' }} {{ k.delta }}</b></span>
        </span>
        <span class="ov-kpi-icon"><el-icon><component :is="k.icon" /></el-icon></span>
      </button>
    </div>

    <div class="ov-top-grid">
      <div class="rc-card ov-eco-card">
        <div class="rc-card-head">
          <div class="rc-card-title">采集资产全景</div>
        </div>
        <AssetFlow v-if="data" :ecosystem="data.ecosystem" />
      </div>

      <div class="rc-card">
        <div class="rc-card-head compact">
          <div class="rc-card-title">采集任务趋势</div>
          <div class="ov-seg">
            <button :class="{ on: days === 7 }" type="button" @click="setDays(7)">近7日</button>
            <button :class="{ on: days === 30 }" type="button" @click="setDays(30)">近30日</button>
          </div>
        </div>
        <TrendBars :points="trend" />
      </div>

      <div class="rc-card">
        <div class="rc-card-head"><div class="rc-card-title">资产类型分布</div></div>
        <DonutChart v-if="data" :slices="data.byCategory" :center-value="data.kpi.sources" center-label="总数" />
      </div>
    </div>

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
              <tr v-for="(s, index) in data?.topSources ?? []" :key="s.sourceId">
                <td><span class="ov-rank" :class="{ top: index < 3 }">{{ index + 1 }}</span></td>
                <td>
                  <div class="ov-src-name">{{ s.name }}</div>
                  <div class="muted">{{ s.sourceId }}</div>
                </td>
                <td>{{ s.category }}</td>
                <td>{{ ['张三', '李四', '王五', '赵六', '孙七'][index % 5] }}</td>
                <td><span class="rc-status" :class="stateMeta(s.state).cls">{{ stateMeta(s.state).text }}</span></td>
                <td class="muted">{{ s.lastSuccessAt || '-' }}</td>
                <td>{{ Math.max(88, 98 - index) }}</td>
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

        <div class="rc-card">
          <div class="rc-card-head">
            <div class="rc-card-title">采集周期分布</div>
            <button class="ov-more" type="button" @click="router.push('/metrics')">查看更多 ›</button>
          </div>
          <DonutChart v-if="data" :slices="data.byCycle" :center-value="data.kpi.sources" center-label="总数" />
        </div>
      </div>
    </div>

    </template>
  </div>
</template>

<style scoped>
.ov {
  --ov-grid-columns: minmax(0, 1.7fr) minmax(360px, 1fr) 390px;

  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.ov > * {
  flex: none;
}

.ov-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: #334155;
  font-size: 13px;
  padding: 10px 16px;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.04) 0%, rgba(6, 182, 212, 0.04) 100%);
  border: 1px solid rgba(37, 99, 235, 0.06);
}

.ov-fresh {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #64748b;
  font-size: 12px;
  white-space: nowrap;
}

.ov-kpis {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.ov-kpi {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 120px;
  padding: 18px 16px;
  border: 1px solid #dfe8f5;
  border-radius: 8px;
  background: linear-gradient(180deg, #fff 0%, #fbfdff 100%);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
  text-align: left;
  cursor: default;
  overflow: hidden;
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
  animation: ov-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.ov-kpi::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #2563eb, #06b6d4);
  opacity: 0;
  transition: opacity 0.25s ease;
}

.ov-kpi.ok::before {
  background: linear-gradient(90deg, #22c55e, #06b6d4);
}

.ov-kpi.err::before {
  background: linear-gradient(90deg, #ef4444, #f97316);
}

.ov-kpi.indigo::before {
  background: linear-gradient(90deg, #7c3aed, #2563eb);
}

.ov-kpi:nth-child(1) { animation-delay: 0.04s; }
.ov-kpi:nth-child(2) { animation-delay: 0.08s; }
.ov-kpi:nth-child(3) { animation-delay: 0.12s; }
.ov-kpi:nth-child(4) { animation-delay: 0.16s; }
.ov-kpi:nth-child(5) { animation-delay: 0.20s; }
.ov-kpi:nth-child(6) { animation-delay: 0.24s; }

.ov-kpi.clickable {
  cursor: pointer;
}

.ov-kpi.clickable:hover {
  border-color: #bfdbfe;
  box-shadow: 0 12px 30px rgba(37, 99, 235, 0.12), 0 0 0 1px rgba(37, 99, 235, 0.08);
  transform: translateY(-3px);
}

.ov-kpi.clickable:hover::before {
  opacity: 1;
}

.ov-kpi-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.ov-kpi-label {
  color: #526481;
  font-size: 13px;
  font-weight: 700;
}

.ov-kpi-val {
  margin: 9px 0 8px;
  color: #0f1e46;
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}

.ov-kpi-val small {
  margin-left: 4px;
  font-size: 13px;
}

.ov-delta {
  color: #64748b;
  font-size: 12px;
}

.ov-delta b {
  margin-left: 8px;
}

.ov-delta.up b {
  color: #16a34a;
}

.ov-delta.down b {
  color: #ef4444;
}

.ov-kpi-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  flex: none;
  border-radius: 50%;
  color: #2563eb;
  background: #eff6ff;
  font-size: 28px;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.ov-kpi.clickable:hover .ov-kpi-icon {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.18);
}

.ov-kpi.ok .ov-kpi-icon {
  color: #22c55e;
  background: #f0fdf4;
}

.ov-kpi.err .ov-kpi-icon {
  color: #ef4444;
  background: #fff1f2;
}

.ov-kpi.indigo .ov-kpi-icon {
  color: #7c3aed;
  background: #f5f3ff;
}

.ov-top-grid {
  display: grid;
  grid-template-columns: var(--ov-grid-columns);
  gap: 12px;
  align-items: stretch;
  animation: ov-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.28s both;
}

.ov-bottom-grid {
  display: grid;
  grid-template-columns: var(--ov-grid-columns);
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

.ov-live-card {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}

.ov .rc-card {
  border-color: #dfe8f5;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
}

.ov .rc-card-head {
  min-height: 48px;
  padding: 12px 16px;
  background: #fff;
}

.ov .rc-card-head.compact {
  min-height: 48px;
}

.ov .rc-card-title {
  color: #0f1e46;
  font-size: 15px;
}

.ov-eco-card {
  min-height: 274px;
}

.ov-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid #dbeafe;
  border-radius: 6px;
  background: #f8fbff;
}

.ov-seg button {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.ov-seg button.on {
  background: #fff;
  color: #1d4ed8;
  box-shadow: 0 4px 10px rgba(37, 99, 235, 0.12);
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

.ov-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}

.ov-empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fef2f2;
  color: #ef4444;
  font-size: 22px;
  font-weight: 800;
}

.ov-empty-title {
  margin-top: 8px;
  color: #0f1e46;
  font-size: 15px;
  font-weight: 700;
}

.ov-empty-text {
  color: #64748b;
  font-size: 13px;
}

.ov-empty-btn {
  margin-top: 12px;
  height: 34px;
  padding: 0 20px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.ov-empty-btn:hover {
  background: #1d4ed8;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.2);
}

.ov .rc-card {
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}

.ov .rc-card:hover {
  border-color: #cfe0fb;
  box-shadow: 0 12px 32px rgba(37, 99, 235, 0.08);
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
  .ov-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ov-top-grid,
  .ov-bottom-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .ov {
    height: auto;
    min-height: 0;
  }

  .ov-intro,
  .ov-fresh {
    align-items: flex-start;
    flex-direction: column;
  }

  .ov-kpis {
    grid-template-columns: 1fr;
  }

  .ov-kpi {
    min-height: 96px;
  }

  .ov-alerts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
