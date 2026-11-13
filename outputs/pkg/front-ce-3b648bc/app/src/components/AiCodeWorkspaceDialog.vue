<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const open = defineModel<boolean>({ required: true })
withDefaults(defineProps<{ title?: string; busy?: boolean }>(), { title: 'AI 代码工作区', busy: false })
</script>

<template>
  <el-dialog v-model="open" :title="title" width="min(1360px, 96vw)" top="3vh" append-to-body :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" v-bind="$attrs">
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </el-dialog>
</template>
