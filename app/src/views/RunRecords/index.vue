<script setup lang="ts">
import TaskView from '@/views/FlowCanvas/result/TaskView.vue'

// AppShell 的 KeepAlive 按这个名字缓存任务中心：从任务点进源再返回，不用再等一次十几秒的查询
defineOptions({ name: 'TaskCenter' })
</script>

<template>
  <TaskView global class="task-center" />
</template>

<style scoped>
.task-center { min-height: 0; height: 100%; }
</style>
