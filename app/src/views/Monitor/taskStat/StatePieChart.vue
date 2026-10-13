<script setup lang="ts">
// 任务状态构成环图（旧页 a-card 里的 v-chart + v-pie）。
//
// 为什么手写 SVG：新项目**没有**任何图表依赖（package.json 里没有 echarts / @antv/g2 / visactor），
// 旧页的 v-chart 来自 ant-design-vue 的 viser 全家桶。为了不把依赖面的改动外溢到 package.json，
// 这里用等价的 SVG 重画：环图（inner/outer 比例沿用旧页 0.6 / 0.8）、底部图例、悬停 tooltip。
import { computed, ref } from 'vue'
import type { PieSlice } from './stat'

const props = defineProps<{ slices: PieSlice[] }>()

/** 旧页配色按状态固定，颜色取自 antd 默认色板里语义相邻的几个 */
const TONE: Record<string, string> = {
  E: '#f5222d',
  C: '#52c41a',
  AC: '#13c2c2',
  W1: '#3e79f7',
  W: '#faad14',
  L: '#722ed1',
  其他: '#bfbfbf',
}
const FALLBACK = ['#3e79f7', '#13c2c2', '#f5222d', '#52c41a', '#faad14', '#722ed1', '#bfbfbf']

// 旧页 :radius="0.8" :inner-radius="0.6" → 内/外 = 0.75
const R = 70
const W = 20
const C = 2 * Math.PI * R

const segs = computed(() => {
  let acc = 0
  const slices = props.slices
  return slices.map((s, i) => {
    const len = s.percent * C
    const seg = {
      ...s,
      color: TONE[s.label.split(' ')[0]] ?? TONE[s.label] ?? FALLBACK[i % FALLBACK.length],
      dash: `${len} ${C - len}`,
      offset: -acc,
      pct: Math.round(s.percent * 1000) / 10,
    }
    acc += len
    return seg
  })
})

const hover = ref<number | null>(null)
const tip = ref({ x: 0, y: 0 })

function onEnter(i: number, e: MouseEvent) {
  hover.value = i
  move(e)
}
function move(e: MouseEvent) {
  const box = (e.currentTarget as Element).closest('.sp-wrap')?.getBoundingClientRect()
  if (!box) return
  tip.value = { x: e.clientX - box.left, y: e.clientY - box.top }
}
</script>

<template>
  <div class="sp-wrap">
    <svg class="sp-svg" viewBox="0 0 180 180" role="img" aria-label="任务状态构成">
      <circle cx="90" cy="90" :r="R" fill="none" stroke="#eef2f7" :stroke-width="W" />
      <circle
        v-for="(seg, i) in segs"
        :key="seg.label"
        class="sp-seg"
        :class="{ 'sp-dim': hover !== null && hover !== i }"
        cx="90"
        cy="90"
        :r="R"
        fill="none"
        :stroke="seg.color"
        :stroke-width="W"
        :stroke-dasharray="seg.dash"
        :stroke-dashoffset="seg.offset"
        transform="rotate(-90 90 90)"
        @mouseenter="onEnter(i, $event)"
        @mousemove="move"
        @mouseleave="hover = null"
      />
    </svg>

    <ul class="sp-legend">
      <li v-for="(seg, i) in segs" :key="seg.label" :class="{ 'sp-on': hover === i }">
        <span class="sp-dot" :style="{ background: seg.color }" />
        <span class="sp-name">{{ seg.label }}</span>
        <span class="sp-val">{{ seg.value.toLocaleString() }}</span>
        <span class="sp-pct">{{ seg.pct }}%</span>
      </li>
    </ul>

    <!-- 旧页 v-tooltip data-key="item*percent"：悬停显示「状态名 + 占比」 -->
    <div v-if="hover !== null" class="sp-tip" :style="{ left: `${tip.x + 10}px`, top: `${tip.y + 10}px` }">
      <b>{{ segs[hover].label }}</b>
      <span>{{ segs[hover].pct }}% · {{ segs[hover].value.toLocaleString() }}</span>
    </div>
  </div>
</template>

<style scoped>
.sp-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 8px 0;
}
.sp-svg {
  width: 160px;
  height: 160px;
}
.sp-seg {
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.sp-dim {
  opacity: 0.35;
}
.sp-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
  width: 100%;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
.sp-legend li {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.sp-legend li.sp-on {
  color: var(--rc-text, #0f172a);
  font-weight: 600;
}
.sp-dot {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 2px;
}
.sp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sp-val {
  color: var(--rc-text, #0f172a);
  font-variant-numeric: tabular-nums;
}
.sp-pct {
  width: 46px;
  text-align: right;
  color: var(--rc-muted, #64748b);
  font-variant-numeric: tabular-nums;
}
.sp-tip {
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
