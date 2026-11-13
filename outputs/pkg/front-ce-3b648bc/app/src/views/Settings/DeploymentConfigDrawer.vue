<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { sourceApi, type Source } from '@/api'
import type { DeploymentConfiguration } from '@/api/runnerManagement'
import ConfigTemplateDrawer from '@/views/Monitor/taskList/ConfigTemplateDrawer.vue'

const details = ref<InstanceType<typeof ConfigTemplateDrawer>>()
const deployment = ref<DeploymentConfiguration | null>(null)
const origins = computed(() => deployment.value?.sourceNode ? [deployment.value.sourceNode] : deployment.value?.relatedSourceNodes || [])
const sources = ref<Source[]>([]), total = ref(0), page = ref(1), loading = ref(false), error = ref('')
let requestId = 0
async function loadSources() {
  const configId = deployment.value?.configId
  if (!configId) return
  const request = ++requestId
  loading.value = true; error.value = ''; sources.value = []; total.value = 0
  try {
    // Existing sourcePaged contract includes sources using this config in downstream steps.
    const result = await sourceApi.sourcePaged({ configId, page: page.value, size: 5 })
    if (request !== requestId) return
    sources.value = result.list; total.value = result.total
  } catch (e) {
    if (request === requestId) error.value = e instanceof Error ? e.message : String(e)
  } finally { if (request === requestId) loading.value = false }
}
async function open(item: DeploymentConfiguration) {
  if (!item.configId) return
  deployment.value = item; page.value = 1
  await nextTick()
  const scope = item.sourceNode ? 'flow' : 'default'
  // Configuration details keep the backend of their originating flow; sources keep the business backend.
  void details.value?.open(item.configId, { backendScope: scope })
  await loadSources()
}
function sourceLocation(source: Source) {
  return { path: '/canvas', query: { sourceId: source.sourceId,
    ...(source.siteId && source.siteId !== '0' ? { siteId: source.siteId } : {}), view: 'overview' } }
}
onBeforeUnmount(() => { requestId++ })
defineExpose({ open })
</script>

<template>
  <ConfigTemplateDrawer ref="details">
    <template #context>
      <section v-if="deployment" class="dc-context" data-testid="deployment-config-context">
        <div class="dc-origin"><strong>{{ deployment.name }}</strong><span>节点配置 ID：{{ deployment.configId }}</span></div>
        <div v-for="node in origins" :key="`${node.flowId}:${node.stepId}`" class="dc-flow" data-testid="deployment-config-flow">
          <span>来源流程 / 节点</span>
          <RouterLink :to="{ path: '/flows', query: { q: node.flowId } }" target="_blank" rel="noopener">{{ node.flowName }}{{ 'isDraft' in node && node.isDraft ? '（草稿）' : '' }}</RouterLink>
          <span>{{ node.nodeName }}</span>
          <small>流程 ID：{{ node.flowId }} · 节点 ID：{{ node.stepId }}</small>
        </div>
        <p v-if="!origins.length" class="dc-muted">{{ deployment.relatedSourceNodes ? '未找到关联流程节点，以下按配置 ID 查询关联源。' : '历史部署未记录具体来源流程节点，以下按配置 ID 查询关联源。' }}</p>
        <header><strong>关联源 <small>（{{ total }}）</small></strong><el-button link type="primary" :loading="loading" data-testid="deployment-config-source-refresh" @click="loadSources">刷新</el-button></header>
        <el-alert v-if="error" :title="`关联源查询失败：${error}`" type="error" :closable="false" show-icon />
        <el-table v-else v-loading="loading" :data="sources" size="small" empty-text="当前业务环境未查询到关联源" data-testid="deployment-config-sources">
          <el-table-column label="源名称" min-width="170"><template #default="{ row }"><RouterLink :to="sourceLocation(row)" target="_blank" rel="noopener" :data-testid="`deployment-config-source-${row.sourceId}`">{{ row.name || row.sourceId }}</RouterLink></template></el-table-column>
          <el-table-column prop="sourceId" label="源 ID" width="120" />
          <el-table-column prop="url" label="源地址" min-width="200" show-overflow-tooltip />
        </el-table>
        <el-pagination v-if="total > 5" v-model:current-page="page" :total="total" :page-size="5" :disabled="loading" small layout="total, prev, pager, next" @current-change="loadSources" />
        <h3>配置详情</h3>
      </section>
    </template>
  </ConfigTemplateDrawer>
</template>

<style scoped>
.dc-context { padding:0 4px; margin-bottom:14px; font-size:12px; }
.dc-origin,.dc-flow { display:flex; align-items:center; flex-wrap:wrap; gap:6px 12px; }
.dc-origin { margin-bottom:10px; }.dc-origin strong { color:var(--el-text-color-primary); }.dc-origin span,.dc-flow>span:first-child,.dc-flow small,.dc-muted { color:var(--el-text-color-secondary); }
.dc-context header { display:flex; align-items:center; justify-content:space-between; margin-top:12px; }.dc-context header small { font-weight:400; color:var(--el-text-color-secondary); }
.dc-context h3 { margin:18px 0 0; font-size:13px; }.dc-context a { color:var(--el-color-primary); text-decoration:none; }.dc-context a:hover { text-decoration:underline; }
.dc-context .el-pagination { justify-content:flex-end; margin-top:8px; }
</style>
