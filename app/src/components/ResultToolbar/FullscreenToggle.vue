<script setup lang="ts">
// 全屏开关按钮（1008-07 从 ResultView 抽出）。只管按钮本身，全屏的铺满样式由各页面自己的根容器负责。
// 根节点就是按钮：页面 scoped 样式（如 ResultView 的 .ctx-summary .rc-btn.tiny）对它照常生效。
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <button
    class="rc-btn tiny"
    type="button"
    data-testid="data-fullscreen-toggle"
    :title="modelValue ? '退出全屏（Esc）' : '全屏查看数据'"
    @click="emit('update:modelValue', !modelValue)"
  >{{ modelValue ? '⤡ 退出全屏' : '⤢ 全屏' }}</button>
</template>
