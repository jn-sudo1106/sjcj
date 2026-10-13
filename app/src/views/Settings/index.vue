<script setup lang="ts">
// 系统设置（0924-02）：一级菜单，页内 tab 分节点类型 / 分类目录。
// 会上原话「新增一级目录系统设置：包括节点类型（旧平台为源类型）和分类目录（现在放在查询页面有点奇怪），
// 留个口子，后续做人员菜单权限控制」——所以每个 tab 也带权限码，过一遍 canAccess。
// tab 条样式与采集资产（CollectAssets/index.vue）同一套。
import { computed, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { canAccess } from '@/composables/usePermission'
import { runnerManagementAvailable } from '@/constants/deployGates'
import NodeTypeTab from './NodeTypeTab.vue'
import CategoryTab from './CategoryTab.vue'
import SourceGroupTab from './SourceGroupTab.vue'
import RunnerManagementTab from './RunnerManagementTab.vue'
import RunnerBindingTab from './RunnerBindingTab.vue'
import CodeRepositoryTab from './CodeRepositoryTab.vue'
import DirectoryLayoutTab from './DirectoryLayoutTab.vue'
import RuntimeLogsTab from './RuntimeLogsTab.vue'
import ProcessorProcessesTab from './ProcessorProcessesTab.vue'

// 来源组（1008-03）：从采集资产页签条移到系统设置（平台配置性质：决定组内源跑哪条流程）。
// runner：依赖 Runner 管理服务的 tab，部署环境（2806 / 2807）网关还没有转发这个服务，先隐藏（见 runnerManagementAvailable；10-10 用户确认隐藏）。
// 2026-10-12：这两处在内网合并 a27a2c4 时丢了（Settings/index.vue 取了内网版本），按原口径补回，页签名称沿用内网新版。
const ALL_TABS: { key: string; label: string; permission: string; comp: Component; runner?: true }[] = [
  { key: 'node-type', label: '节点类型', permission: 'settings:nodeType', comp: NodeTypeTab },
  { key: 'category', label: '分类目录', permission: 'settings:category', comp: CategoryTab },
  { key: 'runners', label: '运行机器', permission: 'settings:runners', comp: RunnerManagementTab, runner: true },
  { key: 'processors', label: '处理机', permission: 'settings:assignments', comp: ProcessorProcessesTab, runner: true },
  { key: 'code-repos', label: '代码仓库', permission: 'settings:releases', comp: CodeRepositoryTab, runner: true },
  { key: 'directory-layout', label: '部署配置', permission: 'settings:releases', comp: DirectoryLayoutTab, runner: true },
  { key: 'assignments', label: '机器配置', permission: 'settings:assignments', comp: RunnerBindingTab, runner: true },
  { key: 'runtime-logs', label: '运行日志', permission: 'settings:assignments', comp: RuntimeLogsTab, runner: true },
  { key: 'releases', label: 'Runner 版本', permission: 'settings:releases', comp: RunnerManagementTab, runner: true },
  { key: 'source-group', label: '来源组', permission: 'settings:sourceGroup', comp: SourceGroupTab },
]
const tabs = computed(() => ALL_TABS.filter((t) => canAccess(t.permission) && (!t.runner || runnerManagementAvailable())))

const route = useRoute()
const router = useRouter()
const active = computed(() => {
  const key = String(route.query.tab ?? '')
  return tabs.value.find((t) => t.key === (key === 'site-code' ? 'assignments' : key)) ?? tabs.value[0]
})

// 非法 / 无权限的 tab 值：把地址归一到实际显示的那个，免得书签里留着一个打不开的 tab
watch(() => route.query.tab, (tab) => {
  if (tab != null && active.value && tab !== active.value.key && tab !== '') {
    void router.replace({ path: '/settings', query: tab === 'site-code' && active.value.key === 'assignments'
      ? { ...route.query, tab: 'assignments', mode: undefined }
      : active.value.key === tabs.value[0]?.key ? {} : { tab: active.value.key } })
  }
}, { immediate: true })

function selectTab(key: string) {
  void router.replace({ path: '/settings', query: key === tabs.value[0]?.key ? {} : { tab: key } })
}
function editDirectory(configId: string) {
  void router.replace({ path: '/settings', query: { tab: 'directory-layout', configId } })
}
</script>

<template>
  <div class="st-page">
    <div class="st-tabs-inner">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="st-tab-link"
        :class="{ active: active?.key === t.key }"
        type="button"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="st-content">
      <KeepAlive>
        <component :is="active.comp" v-if="active" :key="active.key" :section="active.key" :repository-id="typeof route.query.repoId === 'string' ? route.query.repoId : ''" @edit-directory="editDirectory" />
      </KeepAlive>
    </div>
  </div>
</template>

<style scoped>
.st-page { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.st-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.st-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.st-tab-link {
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
.st-tab-link:hover { color: #0f172a; }
.st-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
</style>
