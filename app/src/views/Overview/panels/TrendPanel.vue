<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import type { OverviewSummary, TrendPoint } from '@/api'
import TrendBars from '@/components/charts/TrendBars.vue'
import DonutChart from '@/components/charts/DonutChart.vue'

const props = defineProps<{
  data: OverviewSummary
  trend: TrendPoint[]
}>()

const router = useRouter()
const days = ref(7)

function setDays(d: number) {
  days.value = d
  // 通知父组件重新加载趋势数据
  emit('updateDays', d)
}

const emit = defineEmits<{
  updateDays: [days: number]
}>()
</script>

<template>
  <div class="ov-trend-grid">
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
      <div class="rc-card-head">
        <div class="rc-card-title">采集周期分布</div>
        <button class="ov-more" type="button" @click="router.push('/metrics')">查看更多 ›</button>
      </div>
      <DonutChart v-if="data" :slices="data.byCycle" :center-value="data.kpi.sources" center-label="总数" />
    </div>
  </div>
</template>

<style scoped>
.ov-trend-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(360px, 1fr);
  gap: 12px;
  align-items: stretch;
  animation: ov-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.28s both;
}

.rc-card {
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

.rc-card-head.compact {
  min-height: 48px;
}

.rc-card-title {
  color: #0f1e46;
  font-size: 15px;
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
  .ov-trend-grid {
    grid-template-columns: 1fr;
  }
}
</style>
