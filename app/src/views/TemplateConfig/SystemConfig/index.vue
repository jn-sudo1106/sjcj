<script setup lang="ts">
// 问数系统配置（1015）：旧 ai-chat-view「系统配置」组的两个侧栏子页（/config 参数设置、/page-config 页面配置）
// 收成侧栏「问数配置」组下的一个菜单，子模块在这里以 tab 呈现，结构与口径照本域「模板配置」页
// （views/TemplateConfig/index.vue）：tab 落 URL query，刷新/深链回得到同一个 tab。
// tab 元数据在 router/tabs.ts 的 SYSTEM_CONFIG_TABS —— SYSTEM_CONFIG_TABS[0]（参数设置）是无 ?tab= 时的默认。
// 页面代码放在 TemplateConfig 目录下（与模板配置同属问数配置域），不改 components/ 下的通用组件。
import { computed, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { canAccess } from '@/composables/usePermission'
import { SYSTEM_CONFIG_TABS } from '@/router/tabs'
import ParamConfigPage from './ParamConfig/index.vue'
import PageConfigPage from './PageConfig/index.vue'

defineOptions({ name: 'SystemConfigPage' })

const comps: Record<string, Component> = {
  'param-config': ParamConfigPage,
  'page-config': PageConfigPage,
}

const route = useRoute()
const router = useRouter()

const tabs = computed(() => SYSTEM_CONFIG_TABS.filter((t) => canAccess(t.permission)))
const active = computed(() => tabs.value.find((t) => t.key === String(route.query.tab ?? '')) ?? tabs.value[0])

// 非法 / 无权限的 tab 值：把地址归一到实际显示的那个，免得书签里留着一个打不开的 tab
watch(() => route.query.tab, (tab) => {
  if (route.path !== '/system-config') return
  if (tab == null || tab === '' || tab === active.value?.key) return
  void selectTab(String(active.value?.key ?? ''))
}, { immediate: true })

function selectTab(key: string) {
  // 默认 tab（参数设置）不写进 URL，保持 /system-config 这个地址干净（与模板配置同口径）
  void router.replace({ path: '/system-config', query: key === tabs.value[0]?.key ? {} : { tab: key } })
}
</script>

<template>
  <div class="sc-page">
    <div class="sc-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="sc-tab-link"
        :class="{ active: active?.key === t.key }"
        type="button"
        :title="t.desc"
        data-testid="system-config-tab"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="sc-content">
      <transition name="fade-slide" mode="out-in">
        <component :is="comps[active!.key]" v-if="active" :key="active.key" />
      </transition>
    </div>
  </div>
</template>

<style scoped>
.sc-page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.sc-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.sc-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.sc-tab-link {
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
.sc-tab-link:hover { color: #0f172a; }
.sc-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-slide-enter-from { opacity: 0; transform: translateY(8px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
