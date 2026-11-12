<script setup lang="ts">
// 旧调用方的兼容薄包装（源维度列表 / 源内视图现有用法）：
//   props: { sourceId, jobId? }，通过 ref.show(sourceId, jobId?, monitorName?) 打开。
//
// 真正的实现已统一到 ./monitor-runs/RunsDrawer.vue（两层：运行列表 → 单次详情），
// 这里不再自己拉 paged-logs，只把范围转发过去，保证调用方只换 import 路径、不换调用方式。
//
// ⚠️ jobId 按 monitorId 解释：旧后端 CkJobLogService.saveLog 把 ckSource.id（监控记录 id）
// 写进日志的 jobId 字段；源维度列表传进来的 row.jobId 是采集任务 jobId，不是这里要的值。
// 该由调用方改传监控记录 id（集成时 Lead/fe-list 对齐），包装层不做「任务 jobId → 监控 id」的猜测。
import { ref, watch } from 'vue'
import RunsDrawer from './monitor-runs/RunsDrawer.vue'

const props = defineProps<{
  sourceId?: string
  jobId?: string
  monitorName?: string
}>()

const open = ref(false)
const scope = ref({
  sourceId: props.sourceId ?? '',
  monitorId: props.jobId ?? '',
  name: props.monitorName ?? '',
})

// props 变化只更新「还没被 show() 覆盖」的默认范围，避免覆盖显式 show 的入参。
watch(
  () => [props.sourceId, props.jobId, props.monitorName] as const,
  ([sourceId, jobId, monitorName]) => {
    scope.value = { sourceId: sourceId ?? '', monitorId: jobId ?? '', name: monitorName ?? '' }
  },
)

defineExpose({
  show(sourceId?: string, jobId?: string, monitorName?: string) {
    scope.value = {
      sourceId: sourceId ?? props.sourceId ?? '',
      monitorId: jobId ?? props.jobId ?? '',
      name: monitorName ?? props.monitorName ?? '',
    }
    open.value = true
  },
  close() {
    open.value = false
  },
})

function onClose() {
  open.value = false
}
</script>

<template>
  <RunsDrawer
    :open="open"
    :source-id="scope.sourceId"
    :monitor-id="scope.monitorId"
    :title="scope.name"
    @close="onClose"
  />
</template>