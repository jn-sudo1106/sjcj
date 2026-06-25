<script setup lang="ts">
import { computed } from 'vue'

interface Slice {
  label: string
  value: number
  tone?: string
}

const props = withDefaults(
  defineProps<{ slices: Slice[]; centerValue?: string | number; centerLabel?: string }>(),
  { centerValue: '', centerLabel: '' },
)

const TONE: Record<string, string> = {
  primary: '#2563eb',
  cyan: '#06b6d4',
  indigo: '#4f46e5',
  amber: '#f59e0b',
  ok: '#15803d',
  err: '#dc2626',
  muted: '#94a3b8',
}
const FALLBACK = ['#2563eb', '#06b6d4', '#4f46e5', '#f59e0b', '#15803d', '#dc2626', '#94a3b8']

const R = 54
const C = 2 * Math.PI * R

const total = computed(() => props.slices.reduce((s, x) => s + x.value, 0))

const segments = computed(() => {
  let offset = 0
  return props.slices.map((s, i) => {
    const frac = total.value ? s.value / total.value : 0
    const len = frac * C
    const seg = {
      ...s,
      color: s.tone ? (TONE[s.tone] ?? FALLBACK[i % FALLBACK.length]) : FALLBACK[i % FALLBACK.length],
      dash: `${len} ${C - len}`,
      offset: -offset,
      pct: Math.round(frac * 100),
    }
    offset += len
    return seg
  })
})
</script>

<template>
  <div class="dn">
    <svg class="dn-ring" viewBox="0 0 140 140" role="img" aria-label="占比环形图">
      <circle cx="70" cy="70" :r="R" fill="none" stroke="#eef2f7" stroke-width="16" />
      <circle
        v-for="seg in segments"
        :key="seg.label"
        cx="70"
        cy="70"
        :r="R"
        fill="none"
        :stroke="seg.color"
        stroke-width="16"
        stroke-linecap="butt"
        :stroke-dasharray="seg.dash"
        :stroke-dashoffset="seg.offset"
        transform="rotate(-90 70 70)"
      />
      <text v-if="centerValue !== ''" x="70" y="66" class="dn-num" text-anchor="middle">{{ centerValue }}</text>
      <text v-if="centerLabel" x="70" y="86" class="dn-cap" text-anchor="middle">{{ centerLabel }}</text>
    </svg>
    <ul class="dn-legend">
      <li v-for="seg in segments" :key="seg.label">
        <span class="dn-dot" :style="{ background: seg.color }" />
        <span class="dn-label">{{ seg.label }}</span>
        <span class="dn-val">{{ seg.value }}</span>
        <span class="dn-pct">{{ seg.pct }}%</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dn {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
}
.dn-ring {
  width: 132px;
  height: 132px;
  flex: none;
}
.dn-ring circle[stroke]:not([stroke='#eef2f7']) {
  transition: stroke-dasharray 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.dn-num {
  fill: var(--rc-text);
  font-size: 22px;
  font-weight: 700;
}
.dn-cap {
  fill: var(--rc-muted);
  font-size: 11px;
}
.dn-legend {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dn-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  font-size: 12px;
  color: var(--rc-text-2);
}
.dn-dot {
  width: 9px;
  height: 9px;
  flex: none;
  border-radius: 3px;
}
.dn-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dn-val {
  font-weight: 700;
  color: var(--rc-text);
}
.dn-pct {
  width: 38px;
  text-align: right;
  color: var(--rc-muted);
}
</style>
