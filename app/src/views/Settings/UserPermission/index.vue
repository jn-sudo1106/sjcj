<script setup lang="ts">
// 用户权限设置（1030）：侧栏「系统设置」组下的第二个二级入口，页内两个 tab —— 数据权限设置、用户管理。
// 这两项原本挤在系统设置页的十几个 tab 里（机器/部署配置中间夹着人和权限），本次整体迁出，
// tab 元数据在 router/tabs.ts 的 USER_PERMISSION_TABS，旧 /settings?tab=… 链接由系统设置页跳过来。
// tab 条样式与系统设置（Settings/index.vue）、采集资产同一套，不另起一套。
// 「用户管理」只对 admin 可见（1027 决策：admin 是唯一超管，账号维护不开放给只读账号；
// 后端 /api/v1/sys-user/** 同样只认 roles[admin]）。可见性还没进 canAccess，先在本页按角色过滤。
import { computed, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { canAccess } from '@/composables/usePermission'
import { useAuthStore } from '@/stores/auth'
import { USER_PERMISSION_TABS } from '@/router/tabs'
import DataPermissionTab from '../DataPermissionTab.vue'
import UserManagementTab from '../UserManagementTab.vue'

const comps: Record<string, Component> = {
  'data-permission': DataPermissionTab,
  users: UserManagementTab,
}

const auth = useAuthStore()
const tabs = computed(() => USER_PERMISSION_TABS.filter((t) => canAccess(t.permission) && (!t.adminOnly || auth.role === 'admin')))

const route = useRoute()
const router = useRouter()
const active = computed(() => tabs.value.find((t) => t.key === String(route.query.tab ?? '')) ?? tabs.value[0])

// 非法 / 无权限的 tab 值：把地址归一到实际显示的那个，免得书签里留着一个打不开的 tab
watch(() => route.query.tab, (tab) => {
  if (route.path !== '/user-permission') return
  if (tab != null && active.value && tab !== active.value.key && tab !== '') {
    void router.replace({ path: '/user-permission', query: active.value.key === tabs.value[0]?.key ? {} : { tab: active.value.key } })
  }
}, { immediate: true })

function selectTab(key: string) {
  void router.replace({ path: '/user-permission', query: key === tabs.value[0]?.key ? {} : { tab: key } })
}
</script>

<template>
  <div class="up-page">
    <div class="up-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="up-tab-link"
        :class="{ active: active?.key === t.key }"
        type="button"
        data-testid="user-permission-tab"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="up-content">
      <KeepAlive>
        <component :is="comps[active.key]" v-if="active" :key="active.key" />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.up-page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.up-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.up-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.up-tab-link {
  border: 0;
  background: transparent;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.up-tab-link:hover { color: #0f172a; }
.up-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
</style>
