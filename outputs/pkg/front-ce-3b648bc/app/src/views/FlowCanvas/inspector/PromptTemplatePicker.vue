<script setup lang="ts">
import { computed } from 'vue'
import type { PromptTemplateItem } from '@/api/prompt'
const props = defineProps<{ items: Pick<PromptTemplateItem, 'promptId' | 'promptName' | 'nodeTypeName' | 'isDefault'>[]; modelValue: number; loading?: boolean; disabled?: boolean; testId?: string }>()
const emit = defineEmits<{ select: [number] }>()
const unavailable = computed(() => props.modelValue > 0 && !props.items.some(item => item.promptId === props.modelValue))
function select(value: unknown) { if (typeof value === 'number') emit('select', value) }
</script>
<template>
  <label class="prompt-picker"><span>提示词</span><el-select :model-value="modelValue" :loading="loading" :disabled="disabled || loading" :data-testid="testId" placeholder="选择提示词" @update:model-value="select">
    <el-option :value="0" label="当前提示词（自定义）" />
    <el-option v-if="unavailable" :value="modelValue" label="当前引用提示词（已停用或不可用）" disabled />
    <el-option v-for="item in items" :key="item.promptId" :value="item.promptId" :label="`${item.promptName || `${item.nodeTypeName}提示词 ${item.promptId}`}${item.isDefault ? '（默认）' : ''}`" />
  </el-select></label>
</template>
<style scoped>
.prompt-picker { display:flex; align-items:center; gap:10px; min-width:0; padding:10px 0; font-size:12px; }.prompt-picker>span { flex:none; color:var(--el-text-color-secondary); }.prompt-picker .el-select { flex:1; min-width:0; }
</style>
