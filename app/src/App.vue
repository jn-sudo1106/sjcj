<script setup lang="ts">
// 启动时拉一次后端抓取类型字典（= 节点类型 = config.configType）做漂移检测，并取节点类型默认队列。
// 失败 / 空数据由 store 内部静默回退到 seeds 快照；这里只 fire-and-forget。
// 2026-11-06：同时预热登录会话（/user-info.htm + /sys/menu/user-nav，store 内并行且单飞）与动态路由，
// 免得「刷新页面后第一次点侧栏」才去拉会话、同步装配路由，表现为点一下卡住。
// 2026-11-17：字典改为**会话向后端确认有效之后**再拉。以前 onMounted 就无条件发，会话已死时这两个
// 请求 302→logout.htm 触发会话失效处理；此时路由还没落到 /user/login，「登录页不弹」判断不生效，
// 于是登录页上多弹一个「登录失效,请重新登录」。顺带补上：重新登录后也会拉一次字典（以前要整页刷新）。
import { onMounted, watch } from 'vue'
import { useDictStore } from '@/stores/dict'
import { useAuthStore } from '@/stores/auth'
import { warmUpAuth } from '@/router'

const dict = useDictStore()
const auth = useAuthStore()

// 每个会话只拉一次；登出（info 清空）后复位，换账号再登录会重新拉
let dictLoaded = false
function loadDictOnce() {
  if (dictLoaded) return
  dictLoaded = true
  dict.loadSnatchTypes().catch(() => {})
  dict.loadNodeTypeTopics().catch(() => {})
}

// 登录成功：login() 生成新的 sessionKey，随后 fetchInfo 成功写入 info。
// 刷新页面时 sessionKey 为空、info 来自本地快照（未经后端确认），不走这里，交给下面的 warmUpAuth。
watch(() => auth.info, (info) => {
  if (!info) {
    dictLoaded = false
    return
  }
  if (auth.sessionKey) loadDictOnce()
})

onMounted(async () => {
  if (await warmUpAuth()) loadDictOnce()
})
</script>

<template>
  <router-view />
</template>
