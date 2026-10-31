<script setup lang="ts">
// 系统设置（0924-02）：一级菜单，页内 tab 分节点类型 / 分类目录。
// 会上原话「新增一级目录系统设置：包括节点类型（旧平台为源类型）和分类目录（现在放在查询页面有点奇怪），
// 留个口子，后续做人员菜单权限控制」——所以每个 tab 也带权限码，过一遍 canAccess。
// tab 条样式与采集资产（CollectAssets/index.vue）同一套。
// 数据权限设置、用户管理（1030）已整体迁到侧栏同组的「用户权限设置」页，本页只剩机器 / 部署 / 目录类 tab；
// 旧 /settings?tab=data-permission|users 书签在下面的 watch 里跳过去。
import { computed, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { canAccess } from '@/composables/usePermission'
import NodeTypeTab from './NodeTypeTab.vue'
import CategoryTab from './CategoryTab.vue'
import ServerConfigurationsTab from './ServerConfigurationsTab.vue'
import CodeRepositoryTab from './CodeRepositoryTab.vue'
import DirectoryLayoutTab from './DirectoryLayoutTab.vue'
import RuntimeLogsTab from './RuntimeLogsTab.vue'
import ProcessorProcessesTab from './ProcessorProcessesTab.vue'
import DataPermissionTab from './DataPermissionTab.vue'
import CodeGenerationServersTab from './CodeGenerationServersTab.vue'
import ProgramVersionsTab from './ProgramVersionsTab.vue'
import UserManagementTab from './UserManagementTab.vue'

// 来源组（1008-03）：10-13 曾放这里，同日迁回源管理「我的分组」（leo：管理员也在源管理里改）；旧链接 ?tab=source-group 跳过去。
// 各环境展示同一套入口，菜单可见性统一由账号权限决定（2026-10-26）。
const ALL_TABS: { key: string; label: string; permission: string; comp: Component }[] = [
  { key: 'node-type', label: '节点类型', permission: 'settings:nodeType', comp: NodeTypeTab },
  { key: 'category', label: '分类目录', permission: 'settings:category', comp: CategoryTab },
  { key: 'code-servers', label: '代码生成服务器', permission: 'settings:nodeType', comp: CodeGenerationServersTab },
  { key: 'runners', label: '服务器', permission: 'settings:runners', comp: ServerConfigurationsTab },
  { key: 'processors', label: '处理机', permission: 'settings:assignments', comp: ProcessorProcessesTab },
  { key: 'code-repos', label: '代码仓库', permission: 'settings:releases', comp: CodeRepositoryTab },
  { key: 'directory-layout', label: '部署配置', permission: 'settings:releases', comp: DirectoryLayoutTab },
  { key: 'runtime-logs', label: '运行日志', permission: 'settings:assignments', comp: RuntimeLogsTab },
  { key: 'releases', label: '程序版本', permission: 'settings:releases', comp: ProgramVersionsTab },
  { key: 'data-permission', label: '数据权限设置', permission: 'settings:dataPermission', comp: DataPermissionTab },
  { key: 'users', label: '用户管理', permission: 'settings:users', comp: UserManagementTab, adminOnly: true },
]
const tabs = computed(() => ALL_TABS.filter((t) => canAccess(t.permission)))

const route = useRoute()
const router = useRouter()
const active = computed(() => {
  const key = String(route.query.tab ?? '')
  return tabs.value.find((t) => t.key === (key === 'model-interfaces' ? 'code-servers' : ['site-code', 'assignments'].includes(key) ? 'runners' : key)) ?? tabs.value[0]
})

// 非法 / 无权限的 tab 值：把地址归一到实际显示的那个，免得书签里留着一个打不开的 tab
watch(() => route.query.tab, (tab) => {
  // 已经离开本页（跳去源管理、或页面被缓存）时不再归一，否则会把别的页面的 tab 改回 /settings
  if (route.path !== '/settings') return
  if (tab === 'model-interfaces') {
    void router.replace({ path: '/settings', query: { ...route.query, tab: 'code-servers', view: 'models' } })
    return
  }
  if (tab === 'source-group') {
    void router.replace({ path: '/collect', query: { tab: 'personal', ...(route.query.group ? { group: route.query.group } : {}) } })
    return
  }
  // 数据权限设置 / 用户管理已迁到「用户权限设置」页（1030）：旧书签照旧可用，落到新菜单对应 tab。
  // 两项都显式带 ?tab=，不在这页猜新页的默认是哪个（新页会把默认项自己归一成干净地址）。
  if (tab === 'data-permission' || tab === 'users') {
    void router.replace({ path: '/user-permission', query: { tab } })
    return
  }
  if (tab != null && active.value && tab !== active.value.key && tab !== '') {
    void router.replace({ path: '/settings', query: ['site-code', 'assignments'].includes(String(tab)) && active.value.key === 'runners'
      ? { ...route.query, tab: 'runners', mode: undefined }
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
        <component :is="active.comp" v-if="active" :key="active.key" :section="active.key" :repository-id="typeof route.query.repoId === 'string' ? route.query.repoId : ''" :repository-file-path="typeof route.query.filePath === 'string' ? route.query.filePath : ''" :repository-folder-path="typeof route.query.folderPath === 'string' ? route.query.folderPath : undefined" :repository-directory-id="typeof route.query.directoryId === 'string' ? route.query.directoryId : ''" @edit-directory="editDirectory" />
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
