<script setup lang="ts">
// 单系列柱状图（旧页两个 a-card 里的 v-chart + v-bar：总任务分布 / ERROR 分布）。
//
// 与 StatePieChart 同理：新项目没有图表依赖，用 SVG 重画等价形态 ——
// 竖向柱、y 轴 5 档刻度、x 轴标签自动旋转、悬停 tooltip（旧页 tooltip 的 data-key="x*y"，
// 显示「分组名 + 数量」，数量走 toLocaleString）。
import { computed, ref } from 'vue'
import type { BarItem } from './stat'

const props = withDefaults(
  defineProps<{ items: BarItem[]; color?: string; emptyText?: string }>(),
  { color: '#3e79f7', emptyText: '暂无统计数据' },
)

// 坐标：与旧页 :padding="['auto','auto',48,40]" 同量级（左 40 留 y 轴刻度，下 48 留旋转标签）
const VW = 460
const VH = 240
const PAD = { top: 14, right: 12, bottom: 48, left: 44 }
const innerW = VW - PAD.left - PAD.right
const innerH = VH - PAD.top - PAD.bottom

const max = computed(() => {
  const m = Math.max(1, ...props.items.map((i) => i.value))
  const step = Math.pow(10, Math.floor(Math.log10(m)))
  return Math.ceil(m / step) * step
})

const band = computed(() => innerW / Math.max(1, props.items.length))

const bars = computed(() =>
  props.items.map((item, i) => {
    const w = Math.max(6, Math.min(38, band.value * 0.56))
    const x = PAD.left + band.value * (i + 0.5) - w / 2
    const h = (item.value / max.value) * innerH
    return { ...item, x, y: PAD.top + innerH - h, w, h: Math.max(h, item.value > 0 ? 1.5 : 0) }
  }),
)

const yTicks = computed(() => {
  const n = 5
  return Array.from({ length: n + 1 }, (_, i) => {
    const v = (max.value / n) * i
    return { v, y: PAD.top + innerH - (v / max.value) * innerH }
  })
})

const xLabels = computed(() =>
  props.items.map((item, i) => ({
    text: item.label,
    x: PAD.left + band.value * (i + 0.5),
    y: PAD.top + innerH + 14,
  })),
)

const hover = ref<number | null>(null)
const tip = ref({ x: 0, y: 0 })
function onEnter(i: number, e: MouseEvent) {
  hover.value = i
  move(e)
}
function move(e: MouseEvent) {
  const box = (e.currentTarget as Element).closest('.bc-wrap')?.getBoundingClientRect()
  if (!box) return
  tip.value = { x: e.clientX - box.left, y: e.clientY - box.top }
}

function kfmt(v: number): string {
  if (v >= 10_000) return `${(v / 10_000).toFixed(v % 10_000 === 0 ? 0 : 1)}w`
  if (v >= 1_000) return `${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}k`
  return String(Math.round(v))
}
</script>

<template>
  <div class="bc-wrap">
    <svg class="bc-svg" :viewBox="`0 0 ${VW} ${VH}`" preserveAspectRatio="none" role="img" :aria-label="emptyText">
      <g>
        <line
          v-for="t in yTicks"
          :key="`g${t.v}`"
          :x1="PAD.left"
          :x2="VW - PAD.right"
          :y1="t.y"
          :y2="t.y"
          stroke="#eef2f7"
        />
        <text v-for="t in yTicks" :key="`y${t.v}`" :x="PAD.left - 6" :y="t.y + 3" class="bc-axis" text-anchor="end">
          {{ kfmt(t.v) }}
        </text>
      </g>

      <g v-for="(bar, i) in bars" :key="bar.label">
        <rect
          class="bc-bar"
          :class="{ 'bc-dim': hover !== null && hover !== i }"
          :x="bar.x"
          :y="bar.y"
          :width="bar.w"
          :height="bar.h"
          rx="3"
          :fill="color"
          @mouseenter="onEnter(i, $event)"
          @mousemove="move"
          @mouseleave="hover = null"
        />
      </g>

      <!-- 旧页 x 轴 autoRotate：标签旋转 -30° 末端对齐，避免 10 个长分组名互相压字 -->
      <text
        v-for="l in xLabels"
        :key="l.text"
        class="bc-axis"
        :x="l.x"
        :y="l.y"
        :transform="`rotate(-30 ${l.x} ${l.y})`"
        text-anchor="end"
      >
        {{ l.text }}
      </text>
    </svg>

    <div v-if="hover !== null" class="bc-tip" :style="{ left: `${tip.x + 10}px`, top: `${tip.y + 10}px` }">
      <b>{{ bars[hover].label }}</b>
      <span>{{ bars[hover].value.toLocaleString() }}</span>
    </div>
  </div>
</template>

<style scoped>
.bc-wrap {
  position: relative;
  padding: 0 8px 6px;
}
.bc-svg {
  display: block;
  width: 100%;
  height: 240px;
}
.bc-bar {
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.bc-dim {
  opacity: 0.4;
}
.bc-axis {
  fill: #8c8c8c;
  font-size: 11px;
}
.bc-tip {
  position: absolute;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.86);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  pointer-events: none;
  white-space: nowrap;
}
</style>
