<script setup lang="ts">
// 系统设置（0924-02）：一级菜单，页内 tab 分节点类型 / 分类目录等。
// 动态 Tab 架构改造：使用 useDynamicTabs 接入后端动态资源配置与权限过滤，保留本地 fallbackTabs 兜底。
import { watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDynamicTabs } from '@/composables/useDynamicTabs'
import NodeTypeTab from './NodeTypeTab.vue'
import CategoryTab from './CategoryTab.vue'
import ServerConfigurationsTab from './ServerConfigurationsTab.vue'
import CodeRepositoryTab from './CodeRepositoryTab.vue'
import DirectoryLayoutTab from './DirectoryLayoutTab.vue'
import RuntimeLogsTab from './RuntimeLogsTab.vue'
import ProcessorProcessesTab from './ProcessorProcessesTab.vue'
import CodeGenerationServersTab from './CodeGenerationServersTab.vue'
import ProgramVersionsTab from './ProgramVersionsTab.vue'
import DeploymentResourcesTab from './DeploymentResourcesTab.vue'

const componentMap: Record<string, Component> = {
  'node-type': NodeTypeTab,
  category: CategoryTab,
  'code-servers': CodeGenerationServersTab,
  runners: ServerConfigurationsTab,
  processors: ProcessorProcessesTab,
  'code-repos': CodeRepositoryTab,
  'directory-layout': DirectoryLayoutTab,
  'deployment-resources': DeploymentResourcesTab,
  'runtime-logs': RuntimeLogsTab,
  releases: ProgramVersionsTab,
}

const fallbackTabs = [
  { key: 'node-type', label: '节点类型', permission: 'settings:nodeType', order: 1 },
  { key: 'category', label: '分类目录', permission: 'settings:category', order: 2 },
  { key: 'code-servers', label: '代码生成服务器', permission: 'settings:nodeType', order: 3 },
  { key: 'runners', label: '服务器', permission: 'settings:runners', order: 4 },
  { key: 'processors', label: '处理机', permission: 'settings:assignments', order: 5 },
  { key: 'code-repos', label: '代码仓库', permission: 'settings:releases', order: 6 },
  { key: 'directory-layout', label: '部署配置', permission: 'settings:releases', order: 7 },
  { key: 'deployment-resources', label: '部署资源', permission: 'settings:assignments', order: 8 },
  { key: 'runtime-logs', label: '运行日志', permission: 'settings:assignments', order: 9 },
  { key: 'releases', label: '程序版本', permission: 'settings:releases', order: 10 },
]

const route = useRoute()
const router = useRouter()

const { tabs, activeTab, currentComponent, selectTab } = useDynamicTabs({
  componentMap,
  fallbackTabs,
  autoNormalizeQuery: false,
  aliasMap: {
    'model-interfaces': 'code-servers',
    'site-code': 'runners',
    assignments: 'runners',
  },
})

// 非法 / 无权限 / 跨路由跳转历史兼容处理
watch(
  () => route.query?.tab,
  (tab) => {
    if (route.path !== '/settings') return
    if (tab === 'model-interfaces') {
      void router.replace({ path: '/settings', query: { ...(route.query || {}), tab: 'code-servers', view: 'models' } })
      return
    }
    if (tab === 'source-group') {
      void router.replace({ path: '/collect', query: { tab: 'personal', ...(route.query?.group ? { group: route.query.group } : {}) } })
      return
    }
    if (tab === 'data-permission' || tab === 'users') {
      void router.replace({ path: '/user-permission', query: { tab } })
      return
    }
    if (tab != null && activeTab.value && tab !== activeTab.value.key && tab !== '') {
      void router.replace({
        path: '/settings',
        query: ['site-code', 'assignments'].includes(String(tab)) && activeTab.value.key === 'runners'
          ? { ...(route.query || {}), tab: 'runners', mode: undefined }
          : activeTab.value.key === tabs.value[0]?.key
            ? {}
            : { tab: activeTab.value.key },
      })
    }
  },
  { immediate: true },
)

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
        :class="{ active: activeTab?.key === t.key }"
        type="button"
        @click="selectTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="st-content">
      <KeepAlive>
        <component
          :is="currentComponent"
          v-if="currentComponent"
          :key="activeTab?.key"
          :section="activeTab?.key"
          :repository-id="typeof route.query.repoId === 'string' ? route.query.repoId : ''"
          :repository-file-path="typeof route.query.filePath === 'string' ? route.query.filePath : ''"
          :repository-folder-path="typeof route.query.folderPath === 'string' ? route.query.folderPath : undefined"
          :repository-directory-id="typeof route.query.directoryId === 'string' ? route.query.directoryId : ''"
          @edit-directory="editDirectory"
        />
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
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.st-tab-link:hover { color: #0f172a; }
.st-tab-link.active {
  background: #ffffff;
  color: #0284c7;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
</style>
