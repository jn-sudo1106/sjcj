<script setup lang="ts">
// 启动时拉一次后端抓取类型字典（= 节点类型 = config.configType）做漂移检测。
// 失败 / 空数据由 store 内部静默回退到 seeds 快照；这里只 fire-and-forget。
import { onMounted } from 'vue'
import { useDictStore } from '@/stores/dict'

onMounted(() => {
  useDictStore().loadSnatchTypes().catch(() => {})
})
</script>

<template>
  <router-view />
</template>
