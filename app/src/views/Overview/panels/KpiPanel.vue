<script setup lang="ts">
// KPI 面板（P3-1 收尾 · 性能优化 · P0-1 修复）
// props 收窄：原 props.data: OverviewSummary → kpi + byState + trend 3 个具体字段
// 收益：OverviewSummary 任意字段变化不再触发 KpiPanel 重渲染，只在 kpi/byState/trend 自身变化时触发
import { computed, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { Box, CircleCheck, Document, Files, Bell } from '@element-plus/icons-vue'
import type { OverviewKpi, OverviewSlice, TrendPoint } from '@/api'
import CountUp from '@/components/CountUp.vue'

const props = defineProps<{
  kpi: OverviewKpi
  byState: OverviewSlice[]
  trend: TrendPoint[]
}>()

const router = useRouter()

function goCollect(state?: string) {
  router.push({ path: '/collect', query: state ? { state } : {} })
}

function asTrend(v?: string): 'up' | 'down' | undefined {
  return v === 'up' || v === 'down' ? v : undefined
}

interface Kpi {
  key: string
  label: string
  value: string | number
  numeric: boolean
  unit?: string
  delta: string
  trend?: 'up' | 'down'
  icon: Component
  tone: string
  to?: () => void
}

const activeSources = computed(() =>
  (props.byState ?? []).filter((slice) => slice.label !== '已停用').reduce((sum, slice) => sum + slice.value, 0),
)

const latestTaskCount = computed(() => props.trend.at(-1)?.snatch ?? 0)

const displayKpis = computed<Kpi[]>(() => {
  const k = props.kpi
  if (!k) return []
  return [
    { key: 'sources', label: '采集资产总数', value: k.sources, numeric: true, delta: k.deltas?.sources ?? '', trend: asTrend(k.deltas?.sourcesTrend), icon: Box, tone: 'primary', to: () => goCollect() },
    { key: 'active', label: '启用采集源', value: activeSources.value, numeric: true, delta: k.deltas?.active ?? '', trend: asTrend(k.deltas?.activeTrend), icon: CircleCheck, tone: 'ok', to: () => goCollect() },
    { key: 'today', label: '今日采集任务', value: latestTaskCount.value, numeric: true, delta: k.deltas?.today ?? '', trend: asTrend(k.deltas?.todayTrend), icon: Document, tone: 'primary', to: () => router.push('/runs') },
    { key: 'rate', label: '成功率', value: k.successRate, numeric: false, delta: k.deltas?.rate ?? '', trend: asTrend(k.deltas?.rateTrend), icon: CircleCheck, tone: 'primary' },
    { key: 'alarms', label: '告警数量', value: k.alarms, numeric: true, unit: '条', delta: k.deltas?.alarms ?? '', trend: asTrend(k.deltas?.alarmsTrend), icon: Bell, tone: 'err', to: () => router.push('/tools') },
    { key: 'new7', label: '近7日新增资产', value: k.newAssets7, numeric: true, delta: k.deltas?.new7 ?? '', trend: asTrend(k.deltas?.new7Trend), icon: Files, tone: 'indigo' },
  ]
})
</script>

<template>
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
        <span v-if="k.delta" class="ov-delta" :class="k.trend">较昨日 <b>{{ k.trend === 'up' ? '↑' : '↓' }} {{ k.delta }}</b></span>
      </span>
      <span class="ov-kpi-icon"><el-icon><component :is="k.icon" /></el-icon></span>
    </button>
  </div>
</template>

<style scoped>
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

@media (max-width: 1480px) {
  .ov-kpis {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .ov-kpis {
    grid-template-columns: 1fr;
  }

  .ov-kpi {
    min-height: 96px;
  }
}
</style>
