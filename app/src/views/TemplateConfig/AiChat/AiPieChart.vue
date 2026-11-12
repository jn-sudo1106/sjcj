<script setup lang="ts">
// AI 智能问数 · 交互式占比饼图 / 环形图组件
import { computed, ref } from 'vue'
import type { PieSlice } from '@/api/aiChat'

const props = withDefaults(
  defineProps<{
    slices: PieSlice[]
    centerLabel?: string
    centerValue?: string | number
    ringRadius?: number
    strokeWidth?: number
  }>(),
  {
    centerLabel: '样本总计',
    centerValue: '',
    ringRadius: 56,
    strokeWidth: 20,
  }
)

const hoveredIndex = ref<number | null>(null)

const TONE_COLORS: Record<string, string> = {
  primary: '#2563eb', // 经典蓝
  cyan: '#06b6d4',    // 青色
  indigo: '#6366f1',  // 靛蓝
  amber: '#f59e0b',   // 琥珀黄
  ok: '#16a34a',      // 成功绿
  err: '#dc2626',     // 警示红
  orange: '#ea580c',  // 橙色
  purple: '#8b5cf6',  // 紫色
  muted: '#94a3b8',   // 灰色
}

const DEFAULT_PALETTE = [
  '#dc2626', // 警示红
  '#ea580c', // 橙红
  '#f59e0b', // 琥珀黄
  '#2563eb', // 科技蓝
  '#06b6d4', // 青蓝
  '#16a34a', // 翠绿
  '#8b5cf6', // 丁香紫
  '#64748b', // 沉着灰
]

// 周长 C = 2 * PI * R
const circumference = computed(() => 2 * Math.PI * props.ringRadius)

const totalValue = computed(() =>
  props.slices.reduce((sum, item) => sum + (Number(item.value) || 0), 0)
)

interface SegmentItem extends PieSlice {
  color: string
  dash: string
  offset: number
  pct: number
}

const segments = computed<SegmentItem[]>(() => {
  const total = totalValue.value
  const C = circumference.value
  let currentOffset = 0

  return props.slices.map((slice, index) => {
    const val = Number(slice.value) || 0
    const frac = total > 0 ? val / total : 0
    const len = frac * C
    const color =
      slice.color ||
      (slice.tone && TONE_COLORS[slice.tone]) ||
      DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]

    const item: SegmentItem = {
      ...slice,
      color,
      dash: `${len} ${C - len}`,
      offset: -currentOffset,
      pct: Math.round(frac * 1000) / 10,
    }
    currentOffset += len
    return item
  })
})

// 中心动态文案展示：鼠标悬停在扇区或图例时显示该项的详情，移开显示总计
const centerDisplay = computed(() => {
  if (hoveredIndex.value !== null && segments.value[hoveredIndex.value]) {
    const seg = segments.value[hoveredIndex.value]
    return {
      top: seg.label,
      main: `${seg.pct}%`,
      bottom: seg.displayValue || `${seg.value} 次`,
    }
  }

  const mainVal =
    props.centerValue !== ''
      ? String(props.centerValue)
      : totalValue.value > 0
        ? totalValue.value >= 1000
          ? totalValue.value.toLocaleString()
          : String(totalValue.value)
        : '0'

  return {
    top: '',
    main: mainVal,
    bottom: props.centerLabel || '样本总计',
  }
})
</script>

<template>
  <div class="rc-pie-container" data-testid="rc-pie-container">
    <!-- 左侧 SVG 环形饼图 -->
    <div class="rc-pie-chart" data-testid="rc-pie-chart">
      <svg
        class="rc-pie-svg"
        viewBox="0 0 160 160"
        role="img"
        aria-label="业务数据占比饼图"
      >
        <!-- 背景底环 -->
        <circle
          cx="80"
          cy="80"
          :r="ringRadius"
          fill="none"
          stroke="#f1f5f9"
          :stroke-width="strokeWidth"
        />

        <!-- 各数据切片环 -->
        <circle
          v-for="(seg, idx) in segments"
          :key="seg.label + idx"
          cx="80"
          cy="80"
          :r="ringRadius"
          fill="none"
          :stroke="seg.color"
          :stroke-width="hoveredIndex === idx ? strokeWidth + 4 : strokeWidth"
          stroke-linecap="butt"
          :stroke-dasharray="seg.dash"
          :stroke-dashoffset="seg.offset"
          transform="rotate(-90 80 80)"
          class="rc-pie-slice"
          :class="{ active: hoveredIndex === idx }"
          @mouseenter="hoveredIndex = idx"
          @mouseleave="hoveredIndex = null"
        />

        <!-- 中心文字 -->
        <text
          v-if="centerDisplay.top"
          x="80"
          y="58"
          text-anchor="middle"
          class="rc-pie-center-top"
        >
          {{ centerDisplay.top }}
        </text>
        <text
          x="80"
          :y="centerDisplay.top ? 78 : 74"
          text-anchor="middle"
          class="rc-pie-center-main"
        >
          {{ centerDisplay.main }}
        </text>
        <text
          x="80"
          :y="centerDisplay.top ? 96 : 94"
          text-anchor="middle"
          class="rc-pie-center-bottom"
        >
          {{ centerDisplay.bottom }}
        </text>
      </svg>
    </div>

    <!-- 右侧图例与明细占比列表 -->
    <div class="rc-pie-legend" data-testid="rc-pie-legend">
      <div
        v-for="(seg, idx) in segments"
        :key="seg.label + idx"
        class="rc-pie-legend-row"
        :class="{ active: hoveredIndex === idx }"
        @mouseenter="hoveredIndex = idx"
        @mouseleave="hoveredIndex = null"
      >
        <span class="rc-pie-dot" :style="{ background: seg.color }" />
        <span class="rc-pie-label" :title="seg.label">{{ seg.label }}</span>
        <span
          class="rc-pie-pct-tag"
          :style="{
            color: seg.color,
            backgroundColor: `${seg.color}15`,
            borderColor: `${seg.color}30`,
          }"
        >
          {{ seg.pct }}%
        </span>
        <span class="rc-pie-val">
          {{ seg.displayValue || seg.value }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rc-pie-container {
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 24px;
  padding: 16px 20px;
  background: #ffffff;
  border-radius: 6px;
  min-height: 180px;
}

.rc-pie-chart {
  position: relative;
  width: 150px;
  height: 150px;
  flex: none;
}

.rc-pie-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.rc-pie-slice {
  cursor: pointer;
  transition:
    stroke-width 0.2s cubic-bezier(0.22, 1, 0.36, 1),
    stroke-dasharray 0.5s ease,
    filter 0.2s ease;
}

.rc-pie-slice:hover,
.rc-pie-slice.active {
  filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.15));
}

.rc-pie-center-top {
  font-size: 11px;
  fill: #64748b;
  font-weight: 500;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-pie-center-main {
  font-size: 20px;
  font-weight: 700;
  fill: #0f172a;
}

.rc-pie-center-bottom {
  font-size: 11px;
  fill: #94a3b8;
}

.rc-pie-legend {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rc-pie-legend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  font-size: 13px;
  color: #334155;
}

.rc-pie-legend-row:hover,
.rc-pie-legend-row.active {
  background-color: #f8fafc;
}

.rc-pie-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

.rc-pie-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.rc-pie-pct-tag {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
}

.rc-pie-val {
  flex: none;
  font-weight: 600;
  color: #0f172a;
  min-width: 50px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 640px) {
  .rc-pie-container {
    flex-direction: column;
    align-items: center;
  }
  .rc-pie-legend {
    width: 100%;
  }
}
</style>
