<script setup lang="ts">
import type { Source } from '../../api'

// 源基础信息表单（0706 优化·Phase3）：新建源闸门段与 Phase4 源信息编辑抽屉共用同一份字段与交互。
// 只维护源名称与 URL；配置列表保留给后续系统对接，当前流程不再提供选用/新建配置入口。
// 0711 R5：代理/断点续爬/登录已从这里迁到 CollectorSettings.vue（节点级配置），本组件不再展示这几项。
const props = defineProps<{ modelValue: Source }>()
const emit = defineEmits<{ 'update:modelValue': [v: Source] }>()

function patch(p: Partial<Source>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}
function onInput(key: keyof Source, e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).value } as Partial<Source>)
}
</script>

<template>
  <div class="sbf">
    <div class="rc-field"><label>源名称</label><input class="rc-input" :value="modelValue.name" @input="onInput('name', $event)" placeholder="必填" /></div>
    <div class="rc-field"><label>源 URL</label><input class="rc-input" :value="modelValue.url" @input="onInput('url', $event)" placeholder="选填" /></div>
  </div>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
