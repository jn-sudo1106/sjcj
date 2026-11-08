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

// 这几个页签根元素自己就是白底卡片（rc-card），容器不再套卡片，免得卡片套卡片
const SELF_FRAMED_TABS = new Set(['node-type', 'runners', 'code-repos'])
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
    <div class="st-content" :class="{ 'is-framed': activeTab && !SELF_FRAMED_TABS.has(activeTab.key) }">
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
/* 页签内容统一白底卡片，令牌同监控中心各页（.sc-shell 等）；自带卡片的页签不再套一层 */
.st-content.is-framed { padding: 12px; background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: auto; }
.st-tabs-inner {
  display: inline-flex;
  flex-wrap: wrap;
  align-self: flex-start;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
/* 页签与监控中心、规则资产等模块同一套样式（1107 页面盘点：此前选中文字是天蓝色） */
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
