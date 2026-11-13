<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{ value: number; duration?: number; decimals?: number }>(),
  { duration: 900, decimals: 0 },
)

const reduce =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const display = ref('0')

function fmt(n: number): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  })
}

function run(to: number) {
  if (reduce || props.duration <= 0) {
    display.value = fmt(to)
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / props.duration)
    const eased = 1 - Math.pow(1 - t, 3)
    display.value = fmt(to * eased)
    if (t < 1) requestAnimationFrame(step)
    else display.value = fmt(to)
  }
  requestAnimationFrame(step)
}

onMounted(() => run(props.value))
watch(() => props.value, (v) => run(v))
</script>

<template>
  <span>{{ display }}</span>
</template>
