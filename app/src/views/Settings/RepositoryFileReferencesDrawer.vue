<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { runnerManagementApi as api, type RepositoryFileReferences, type RepositoryFileReference } from '@/api/runnerManagement'
import ConfigTemplateDrawer from '@/views/Monitor/taskList/ConfigTemplateDrawer.vue'

const visible = ref(false), loading = ref(false), error = ref(''), scope = ref('all')
const result = ref<RepositoryFileReferences>(), repoId = ref(''), path = ref('')
const config = ref<InstanceType<typeof ConfigTemplateDrawer>>()
const items = computed(() => (result.value?.items || []).filter(item => scope.value === 'all' || item.scope === scope.value))
let sequence = 0
async function load() {
  const request = ++sequence
  loading.value = true; error.value = ''; result.value = undefined
  try { const data = await api.codeRepositoryFileReferences(repoId.value, path.value); if (request === sequence) result.value = data }
  catch (e) { if (request === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === sequence) loading.value = false }
}
function open(repositoryId: string, filePath: string) {
  repoId.value = repositoryId; path.value = filePath; scope.value = 'all'; visible.value = true; void load()
}
function openConfig(item: RepositoryFileReference) {
  void config.value?.open(item.configId, { backendScope: item.sourceNodes.length ? 'flow' : 'default' })
}
const title = (item: RepositoryFileReference) => item.kind === 'deployment' ? item.name : item.kind === 'generation' ? item.archiveStatus === 'pending' ? '生成结果（待提交）' : item.archiveStatus === 'failed' ? '生成结果（归档失败）' : '节点生成代码归档' : item.kind === 'node' ? '节点代码关联' : item.isLatest ? '最新代码版本' : item.environments?.length || item.machineBindingCount ? '历史版本（仍有运行绑定）' : '历史代码版本'
onBeforeUnmount(() => { sequence++ })
defineExpose({ open })
</script>

<template>
  <el-drawer v-model="visible" title="代码引用位置" size="min(860px, 94vw)" data-testid="repository-references-drawer">
    <div class="rr-heading"><b>{{ result?.repoName }}</b><code>{{ path }}</code><el-button :disabled="loading" @click="load">刷新</el-button></div>
    <p v-if="result?.protectionReasons.length" class="rr-muted">保护原因：{{ result.protectionReasons.join('、') }}</p>
    <p v-if="error" class="rr-error" role="alert">{{ error }}</p>
    <div class="rr-filters"><button v-for="option in [{ key: 'all', label: '全部' }, { key: 'current', label: '当前引用' }, { key: 'history', label: '历史引用' }]" :key="option.key" :aria-pressed="scope === option.key" @click="scope = option.key">{{ option.label }}</button><span>共 {{ items.length }} 项</span></div>
    <div v-loading="loading" class="rr-list">
      <article v-for="(item, index) in items" :key="`${item.kind}-${item.deploymentId || item.digest || item.codeId}-${index}`" class="rr-card" data-testid="repository-reference">
        <header><b>{{ title(item) }}</b><el-tag size="small" :type="item.scope === 'history' ? 'info' : 'primary'">{{ item.scope === 'history' ? '历史' : '当前' }}</el-tag><RouterLink v-if="item.deploymentId" :to="{ path: '/settings', query: { tab: 'directory-layout', deploymentId: item.deploymentId } }" target="_blank" rel="noopener" data-testid="reference-deployment-link">打开部署配置</RouterLink></header>
        <div v-for="node in item.sourceNodes" :key="`${node.flowId}-${node.stepId}`" class="rr-origin"><RouterLink :to="{ path: '/flows', query: { q: node.flowId } }" target="_blank" rel="noopener">{{ node.flowName }}</RouterLink><span>/ {{ node.nodeName }}</span><small>流程 {{ node.flowId }} · 节点 {{ node.stepId }}</small></div>
        <p v-if="!item.sourceNodes.length" class="rr-muted">未记录或未找到关联流程节点</p>
        <div class="rr-attributes"><span v-if="item.configId">配置 ID：<el-button link type="primary" :data-testid="`reference-config-${item.configId}`" @click="openConfig(item)">{{ item.configId }}</el-button></span><span v-if="item.queueName">MQ：{{ item.queueName }}</span><span v-if="item.publishedAt">保存时间：{{ new Date(item.publishedAt).toLocaleString('zh-CN', { hour12: false }) }}</span><span v-if="item.environments?.length">运行绑定：{{ item.environments.join('、') }}</span><span v-if="item.machineBindingCount">启用的机器绑定：{{ item.machineBindingCount }}</span></div>
        <p v-if="item.targetPaths?.length" class="rr-path">部署目标：{{ item.targetPaths.join('、') }}</p><code v-if="item.digest" class="rr-digest">{{ item.digest }}</code>
      </article>
      <p v-if="!loading && !error && !items.length" class="rr-muted">未找到{{ scope === 'history' ? '历史' : scope === 'current' ? '当前' : '' }}引用记录{{ result?.protectionReasons.includes('系统管理目录') ? '；该文件因位于系统管理目录而受保护。' : '。' }}</p>
    </div>
  </el-drawer>
  <ConfigTemplateDrawer ref="config" />
</template>

<style scoped>
.rr-heading,.rr-card header,.rr-origin,.rr-attributes,.rr-filters { display:flex; align-items:center; gap:8px 12px; flex-wrap:wrap; }
.rr-heading code { flex:1; overflow-wrap:anywhere; font-size:12px; }
.rr-filters { margin:16px 0; }.rr-filters button { border:1px solid var(--el-border-color); border-radius:5px; padding:5px 10px; background:var(--el-bg-color); color:var(--el-text-color-regular); cursor:pointer; }.rr-filters button[aria-pressed=true] { background:var(--el-color-primary-light-9); color:var(--el-color-primary); border-color:var(--el-color-primary); }.rr-filters span { color:var(--el-text-color-secondary); font-size:12px; margin-left:auto; }
.rr-card { padding:12px; border:1px solid var(--el-border-color-light); border-radius:7px; margin-bottom:10px; font-size:12px; }.rr-card header { margin-bottom:10px; }.rr-card header b { font-size:13px; }.rr-card header a { margin-left:auto; }.rr-origin { margin:7px 0; }.rr-origin small,.rr-muted,.rr-attributes { color:var(--el-text-color-secondary); }.rr-muted { font-size:12px; }.rr-path,.rr-digest { overflow-wrap:anywhere; }.rr-digest { display:block; margin-top:10px; font-size:11px; }.rr-error { color:var(--el-color-danger); font-size:12px; }
a { color:var(--el-color-primary); text-decoration:none; } a:hover { text-decoration:underline; }
</style>
