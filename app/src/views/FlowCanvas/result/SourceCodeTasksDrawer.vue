<script setup lang="ts">
import type { Source } from '@/api'
import SourceGenerationTaskPanel from './SourceGenerationTaskPanel.vue'
const open = defineModel<boolean>({ required: true })
defineProps<{ sources: Source[] }>()
</script>
<template>
  <el-drawer v-model="open" title="代码生成" size="min(1100px, 96vw)" append-to-body destroy-on-close>
    <SourceGenerationTaskPanel v-if="open" :sources="sources" />
  </el-drawer>
</template>
