<script setup lang="ts">
import { computed } from 'vue'

interface Point {
  date: string
  snatch: number
  success: number
}

const props = defineProps<{ points: Point[] }>()

const W = 720
const H = 240
const PAD = { t: 16, r: 12, b: 26, l: 44 }
const innerW = W - PAD.l - PAD.r
const innerH = H - PAD.t - PAD.b

const max = computed(() => {
  const m = Math.max(1, ...props.points.flatMap((p) => [p.snatch, p.success]))
  const step = Math.pow(10, Math.floor(Math.log10(m)))
  return Math.ceil(m / step) * step
})

function y(v: number): number {
  return PAD.t + innerH - (v / max.value) * innerH
}

function bandX(i: number): number {
  const n = Math.max(1, props.points.length)
  return PAD.l + (i / n) * innerW
}

function barGeom(i: number, key: 'snatch' | 'success') {
  const n = Math.max(1, props.points.length)
  const band = innerW / n
  const groupW = Math.min(44, band * 0.58)
  const gap = 4
  const barW = Math.max(5, (groupW - gap) / 2)
  const start = bandX(i) + (band - groupW) / 2
  const x = key === 'snatch' ? start : start + barW + gap
  const top = y(props.points[i]?.[key] ?? 0)
  return { x, y: top, width: barW, height: PAD.t + innerH - top }
}

const yTicks = computed(() => {
  const n = 4
  return Array.from({ length: n + 1 }, (_, i) => {
    const v = (max.value / n) * i
    return { v, y: y(v) }
  })
})

const xLabels = computed(() => {
  const n = props.points.length
  if (!n) return []
  const idxs = n <= 7 ? props.points.map((_, i) => i) : [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1]
  return [...new Set(idxs)].map((i) => ({
    x: bandX(i) + innerW / Math.max(1, n) / 2,
    text: props.points[i]?.date ?? '',
  }))
})

function kfmt(v: number): string {
  return v >= 10000 ? `${(v / 10000).toFixed(1)}w` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}
</script>

<template>
  <div class="tb">
    <div class="tb-legend">
      <span><i class="tb-sw snatch" />抓取量</span>
      <span><i class="tb-sw success" />成功量</span>
    </div>
    <svg class="tb-svg" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" aria-label="采集任务趋势">
      <defs>
        <linearGradient id="tb-fill-snatch" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2f6fff" />
          <stop offset="1" stop-color="#70a4ff" />
        </linearGradient>
        <linearGradient id="tb-fill-success" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#08bfd8" />
          <stop offset="1" stop-color="#63d7e8" />
        </linearGradient>
      </defs>

      <g>
        <line
          v-for="t in yTicks"
          :key="`g${t.v}`"
          :x1="PAD.l"
          :x2="W - PAD.r"
          :y1="t.y"
          :y2="t.y"
          stroke="#eef2f7"
        />
        <text v-for="t in yTicks" :key="`y${t.v}`" :x="PAD.l - 8" :y="t.y + 3" class="tb-axis" text-anchor="end">
          {{ kfmt(t.v) }}
        </text>
      </g>

      <g v-for="(p, i) in points" :key="p.date">
        <rect v-bind="barGeom(i, 'snatch')" rx="4" fill="url(#tb-fill-snatch)" />
        <rect v-bind="barGeom(i, 'success')" rx="4" fill="url(#tb-fill-success)" />
      </g>

      <text v-for="l in xLabels" :key="l.text" :x="l.x" :y="H - 8" class="tb-axis" text-anchor="middle">
        {{ l.text }}
      </text>
    </svg>
  </div>
</template>

<style scoped>
.tb {
  padding: 8px 16px 14px;
}

.tb-legend {
  display: flex;
  gap: 16px;
  justify-content: flex-end;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--rc-muted);
}

.tb-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.tb-sw {
  width: 12px;
  height: 8px;
  border-radius: 2px;
}

.tb-sw.snatch {
  background: #2f6fff;
}

.tb-sw.success {
  background: #08bfd8;
}

.tb-svg {
  width: 100%;
  height: auto;
}

.tb-axis {
  fill: var(--rc-faint);
  font-size: 11px;
}

.tb-svg rect {
  transform-origin: bottom;
  animation: tb-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes tb-rise {
  from {
    transform: scaleY(0);
    opacity: 0.3;
  }
  to {
    transform: scaleY(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tb-svg rect {
    animation: none;
  }
}
</style>
