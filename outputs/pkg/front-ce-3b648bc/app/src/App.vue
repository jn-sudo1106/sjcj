<script setup lang="ts">
// 启动时拉一次后端抓取类型字典（= 节点类型 = config.configType）做漂移检测。
// 失败 / 空数据由 store 内部静默回退到 seeds 快照；这里只 fire-and-forget。
// 2026-11-06：同时预热登录会话（/user-info.htm + /sys/menu/user-nav，store 内并行且单飞）与动态路由，
// 免得「刷新页面后第一次点侧栏」才去拉会话、同步装配路由，表现为点一下卡住。
import { onMounted } from 'vue'
import { useDictStore } from '@/stores/dict'
import { warmUpAuth } from '@/router'

onMounted(() => {
  const dict = useDictStore()
  dict.loadSnatchTypes().catch(() => {})
  dict.loadNodeTypeTopics().catch(() => {})
  void warmUpAuth()
})
</script>

<template>
  <router-view />
</template>
