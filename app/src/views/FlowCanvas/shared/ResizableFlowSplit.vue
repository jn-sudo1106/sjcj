<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{ initialWidth?: number; resizeSide?: 'left' | 'right'; minLeft?: number; minRight?: number; label?: string }>(), { initialWidth: 360, resizeSide: 'left', minLeft: 240, minRight: 378, label: '调整流程列表宽度' })
const container = ref<HTMLElement | null>(null)
const leftWidth = ref(props.initialWidth)
let dragging = false

function clampWidth(width: number) {
  const available = container.value?.clientWidth || 1000
  const min = props.resizeSide === 'right' ? props.minRight : props.minLeft
  const otherMin = props.resizeSide === 'right' ? props.minLeft : props.minRight
  const max = Math.max(min, available - otherMin - 12)
  return Math.min(Math.max(width, min), max)
}
function move(event: PointerEvent) {
  if (!dragging || !container.value) return
  const rect = container.value.getBoundingClientRect()
  const offset = event.clientX - rect.left
  leftWidth.value = clampWidth(props.resizeSide === 'right' ? container.value.clientWidth - offset - 6 : offset)
}
function stop() {
  dragging = false
  window.removeEventListener('pointermove', move)
  window.removeEventListener('pointerup', stop)
  window.removeEventListener('pointercancel', stop)
}
function start(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  dragging = true
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
}
function keyResize(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const step = event.key === 'ArrowLeft' ? -20 : 20
  leftWidth.value = clampWidth(leftWidth.value + (props.resizeSide === 'right' ? -step : step))
}
onBeforeUnmount(stop)
</script>

<template>
  <div ref="container" class="rfs" :class="{ 'rfs-resize-right': resizeSide === 'right' }" :style="{ '--split-width': `${leftWidth}px`, '--min-left': `${minLeft}px`, '--min-right': `${minRight}px` }">
    <div class="rfs-left"><slot name="left" /></div>
    <div class="rfs-handle" role="separator" tabindex="0" :aria-label="label" aria-orientation="vertical" :aria-valuenow="leftWidth" :aria-valuemin="resizeSide === 'right' ? minRight : minLeft" data-testid="flow-split-handle" @pointerdown="start" @keydown="keyResize"><span /></div>
    <div class="rfs-right"><slot name="right" /></div>
  </div>
</template>

<style scoped>
.rfs { display:flex; min-width:0; min-height:0; }
.rfs-left { flex:0 1 var(--split-width); min-width:var(--min-left); min-height:0; }
.rfs-resize-right .rfs-left { flex:1; }
.rfs-handle { flex:0 0 12px; display:flex; justify-content:center; align-items:center; cursor:col-resize; touch-action:none; outline-offset:-2px; }
.rfs-handle span { width:3px; height:40px; border-radius:2px; background:var(--rc-border); }
.rfs-handle:hover span, .rfs-handle:focus-visible span { background:var(--rc-primary); }
.rfs-right { flex:1; min-width:0; min-height:0; display:flex; }
.rfs-resize-right .rfs-right { flex:0 1 var(--split-width); min-width:var(--min-right); }
.rfs-right > * { flex:1; min-width:0; }
</style>
