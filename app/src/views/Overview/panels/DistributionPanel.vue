<script setup lang="ts">
// 分布面板（P3-1 收尾 · 性能优化 · P0-1 修复）
// props 收窄：原 props.data: OverviewSummary → panorama + byCategory + sourceTotal
import { useRouter } from 'vue-router'
import type { OverviewPanorama, OverviewSlice } from '@/api'
import DonutChart from '@/components/charts/DonutChart.vue'
import AssetFlow from '@/components/charts/AssetFlow.vue'

const props = defineProps<{
  panorama: OverviewPanorama
  byCategory: OverviewSlice[]
  sourceTotal: number
}>()

const router = useRouter()

function goCollect(state?: string) {
  router.push({ path: '/collect', query: state ? { state } : {} })
}

function goCollectCategory(category: string) {
  router.push({ path: '/collect', query: category ? { category } : {} })
}
</script>

<template>
  <div class="ov-dist-grid">
    <div class="rc-card ov-eco-card">
      <div class="rc-card-head">
        <div class="rc-card-title">采集网站全景</div>
        <div class="ov-eco-meta">
          <span class="website"><i />{{ panorama.total }} 网站</span>
          <span class="error"><i />{{ panorama.error }} 异常</span>
          <button class="ov-more" type="button" @click="goCollect()">查看全部 ›</button>
        </div>
      </div>
      <AssetFlow :panorama="panorama" @select="goCollectCategory" />
    </div>

    <div class="rc-card">
      <div class="rc-card-head">
        <div class="rc-card-title">资产类型分布</div>
      </div>
      <DonutChart :slices="byCategory" :center-value="sourceTotal" center-label="总数" />
    </div>
  </div>
</template>

<style scoped>
.ov-dist-grid {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1.7fr) minmax(360px, 1fr);
  gap: 12px;
  align-items: stretch;
  animation: ov-rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.28s both;
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

.ov-eco-card {
  min-height: 274px;
}

.ov-eco-meta,
.ov-eco-meta span {
  display: inline-flex;
  align-items: center;
}

.ov-eco-meta {
  gap: 12px;
  color: #64748b;
  font-size: 11px;
  white-space: nowrap;
}

.ov-eco-meta span {
  gap: 5px;
  font-weight: 700;
}

.ov-eco-meta i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent);
}

.ov-eco-meta .website {
  color: #2563eb;
}

.ov-eco-meta .error {
  color: #dc2626;
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

@media (max-width: 960px) {
  .ov-dist-grid {
    grid-template-columns: 1fr;
  }
}
</style>
