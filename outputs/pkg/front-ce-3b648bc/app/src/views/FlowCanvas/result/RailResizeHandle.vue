<script setup lang="ts">
// 流程图区底边的高度分隔条（0928）：数据 / 文件 / 任务视图共用。分支多的流程图能有好几百像素高，
// 展开后把下面的表格整个顶出视口——流程图区给默认最大高度（超出在区内滚动），拖这条调整，
// 松手记住（三个视图同一个偏好，见 resultLayoutPref）。上限留出下面列表的地方（视口 70%）。
import { RAIL_HEIGHT_MIN, writeResultRailHeight } from './resultLayoutPref'

const height = defineModel<number>({ required: true })

function start(event: PointerEvent) {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = height.value
  const maxHeight = Math.max(RAIL_HEIGHT_MIN, Math.round(window.innerHeight * 0.7))
  // 记下拖动中的最新值：v-model 回写要等父组件重渲染，松手时同步读 height.value 可能还是旧值
  let latest = startHeight
  const onMove = (ev: PointerEvent) => {
    latest = Math.min(maxHeight, Math.max(RAIL_HEIGHT_MIN, startHeight + ev.clientY - startY))
    height.value = latest
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    writeResultRailHeight(latest)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
</script>

<template>
  <div class="rrh" data-testid="rail-resize" title="拖动调整流程图高度" @pointerdown="start"><span class="rrh-grip" /></div>
</template>

<style scoped>
.rrh { flex: none; height: 6px; background: var(--rc-border-soft); cursor: row-resize; position: relative; touch-action: none; transition: background 0.15s; }
.rrh:hover { background: var(--rc-primary-bg); }
.rrh-grip { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 28px; height: 2px; background: var(--rc-faint); border-radius: 1px; box-shadow: 0 4px 0 var(--rc-faint); }
</style>
