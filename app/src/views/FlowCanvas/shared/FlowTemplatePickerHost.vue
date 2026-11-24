<script setup lang="ts">
// 全局挂一个：把 pickFlowTemplate() 的请求渲染成 FlowTemplatePickerDialog（1123 A1）。
// 挂在 App 根上，弹窗拿得到 pinia / 路由等应用上下文，调用方仍然只 await 一个模板 ID。
import { computed } from 'vue'
import FlowTemplatePickerDialog from './FlowTemplatePickerDialog.vue'
import { flowTemplatePickRequest } from '@/utils/flow/createFromTemplate'

const request = flowTemplatePickRequest
const open = computed({
  get: () => !!request.value,
  set: (value: boolean) => { if (!value) request.value?.reject('cancel') },
})
</script>

<template>
  <FlowTemplatePickerDialog
    v-if="request"
    v-model="open"
    :templates="request.templates"
    :allow-none="request.allowNone"
    :message="request.message"
    :initial-id="request.initialId"
    @pick="(id) => request?.resolve(id)"
  />
</template>
