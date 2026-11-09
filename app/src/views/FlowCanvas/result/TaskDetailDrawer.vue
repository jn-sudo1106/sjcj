<script setup lang="ts">
import type { TaskInst } from '@/api'
import TaskDetailContent from './TaskDetailContent.vue'

defineProps<{
  modelValue: boolean
  task: TaskInst | null
  sourceName?: string
  stepName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  locateData: [task: TaskInst]
  openSource: [task: TaskInst]
}>()
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :with-header="false"
    size="560px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <TaskDetailContent
      :task="task"
      :source-name="sourceName"
      :step-name="stepName"
      @close="emit('update:modelValue', false)"
      @locate-data="emit('locateData', $event)"
      @open-source="emit('openSource', $event)"
    />
  </el-drawer>
</template>
