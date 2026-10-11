<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import type { DeploymentConfiguration, RuntimeConfiguration } from '@/api/runnerManagement'

const props = defineProps<{ items: DeploymentConfiguration[]; runtimes: RuntimeConfiguration[] | null; loading: boolean; canWrite: boolean; failed: boolean }>()
const emit = defineEmits<{ open: [id: string]; create: []; refresh: [] }>()
const query = reactive({ name: '', flow: '', configId: '', queue: '' })
const applied = ref({ ...query }), page = ref(1), size = ref(20)
const includes = (value: string | undefined, search: string) => (value || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
const filtered = computed(() => props.items.filter(item =>
  (includes(item.name, applied.value.name) || includes(item.deploymentId, applied.value.name)) &&
  includes([item.sourceNode?.flowName, item.sourceNode?.flowId, item.sourceNode?.nodeName].filter(Boolean).join(' '), applied.value.flow) &&
  includes(item.configId, applied.value.configId) && includes(item.queueName, applied.value.queue)))
const visible = computed(() => filtered.value.slice((page.value - 1) * size.value, page.value * size.value))
const machineCounts = computed(() => {
  const indexed = new Map<string, Set<string>>()
  for (const row of props.runtimes || []) {
    const machines = indexed.get(row.deploymentId) || new Set<string>()
    machines.add(row.runnerId); indexed.set(row.deploymentId, machines)
  }
  return indexed
})
watch([() => filtered.value.length, size], () => { page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / size.value))) })
function search() { applied.value = { ...query }; page.value = 1 }
function reset() { Object.assign(query, { name: '', flow: '', configId: '', queue: '' }); search() }
function time(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <section class="deployment-list" data-testid="deployment-list">
    <form class="deployment-filters" @submit.prevent="search">
      <label>部署名称<el-input v-model="query.name" clearable placeholder="名称或部署 ID" aria-label="查询部署名称" /></label>
      <label>来源流程<el-input v-model="query.flow" clearable placeholder="流程名称、ID 或节点名称" aria-label="查询来源流程" /></label>
      <label>节点配置 ID<el-input v-model="query.configId" clearable placeholder="configId" aria-label="查询节点配置 ID" /></label>
      <label>任务队列<el-input v-model="query.queue" clearable placeholder="队列名称" aria-label="查询任务队列" /></label>
      <div class="deployment-query-actions"><el-button native-type="submit" type="primary" :icon="Search" :disabled="loading" data-testid="deployment-search">查询</el-button><el-button :disabled="loading" @click="reset">重置</el-button></div>
    </form>
    <div class="deployment-table-card">
      <header class="deployment-list-toolbar"><div><strong>部署配置</strong><span>{{ filtered.length }} 项{{ filtered.length !== items.length ? ` / 共 ${items.length} 项` : '' }}</span></div><div><el-button :icon="Refresh" circle :disabled="loading" aria-label="刷新部署列表" @click="emit('refresh')" /><el-button v-if="canWrite" type="primary" :icon="Plus" :disabled="loading || failed" data-testid="deployment-new" @click="emit('create')">新建部署</el-button></div></header>
      <div v-loading="loading" class="deployment-table-scroll">
        <el-table :data="visible" height="100%" row-key="deploymentId" :empty-text="failed ? '列表加载失败，请刷新重试' : items.length ? '没有符合查询条件的部署配置' : '暂无部署配置，点击新建部署，从流程节点创建'" data-testid="deployment-table">
          <el-table-column label="部署名称" min-width="200"><template #default="{ row }"><button type="button" class="deployment-name-link" :title="row.name" :disabled="loading" :data-testid="`deployment-open-${row.deploymentId}`" @click="emit('open', row.deploymentId)">{{ row.name }}</button><small class="deployment-secondary" :title="row.deploymentId">{{ row.deploymentId }}</small></template></el-table-column>
          <el-table-column label="来源流程 / 节点" min-width="200"><template #default="{ row }"><template v-if="row.sourceNode"><span class="deployment-cell-text" :title="row.sourceNode.flowName">{{ row.sourceNode.flowName }}</span><small class="deployment-secondary" :title="row.sourceNode.nodeName">{{ row.sourceNode.nodeName }}</small></template><span v-else class="deployment-muted">历史配置 · 未记录来源节点</span></template></el-table-column>
          <el-table-column prop="configId" label="配置 ID" width="105" show-overflow-tooltip><template #default="{ row }">{{ row.configId || '—' }}</template></el-table-column>
          <el-table-column prop="queueName" label="任务队列" min-width="155" show-overflow-tooltip><template #default="{ row }">{{ row.queueName || '—' }}</template></el-table-column>
          <el-table-column label="绑定机器" width="88" align="center"><template #default="{ row }"><span :title="runtimes === null ? '绑定信息加载失败，请刷新重试' : '按 Runner 实例去重统计'">{{ runtimes === null ? '—' : machineCounts.get(row.deploymentId)?.size || 0 }}</span></template></el-table-column>
          <el-table-column label="更新时间" min-width="150"><template #default="{ row }"><span class="deployment-time" :title="row.updatedAt ? time(row.updatedAt) : '历史配置未记录更新时间'">{{ time(row.updatedAt) }}</span></template></el-table-column>
          <el-table-column label="操作" width="62" align="center"><template #default="{ row }"><el-button link type="primary" :disabled="loading" @click="emit('open', row.deploymentId)">{{ canWrite ? '编辑' : '查看' }}</el-button></template></el-table-column>
        </el-table>
      </div>
      <footer class="deployment-list-footer"><span>点击部署名称配置目标目录和仓库代码</span><el-pagination v-model:current-page="page" v-model:page-size="size" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" :total="filtered.length" :disabled="loading" /></footer>
    </div>
  </section>
</template>

<style scoped>
.deployment-list { display:flex; flex-direction:column; flex:1; min-height:0; gap:12px; }
.deployment-filters { display:grid; grid-template-columns:minmax(150px,1.2fr) minmax(170px,1.3fr) minmax(115px,.8fr) minmax(150px,1fr) auto; align-items:end; gap:12px; padding:16px; background:var(--el-bg-color); border:1px solid var(--el-border-color-light); border-radius:12px; }
.deployment-filters label { display:flex; flex-direction:column; gap:7px; min-width:0; font-size:12px; color:var(--el-text-color-regular); }
.deployment-query-actions { display:flex; }
.deployment-table-card { display:flex; flex-direction:column; flex:1; min-height:0; background:var(--el-bg-color); border:1px solid var(--el-border-color-light); border-radius:12px; overflow:hidden; }
.deployment-list-toolbar { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; gap:12px; }
.deployment-list-toolbar > div { display:flex; align-items:center; gap:10px; }
.deployment-list-toolbar strong { font-size:14px; }
.deployment-list-toolbar span, .deployment-muted { color:var(--el-text-color-secondary); font-size:12px; }
.deployment-table-scroll { flex:1; min-height:0; }
.deployment-name-link { display:block; max-width:100%; padding:0; border:0; background:none; font:inherit; font-weight:500; color:var(--el-color-primary); cursor:pointer; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.deployment-name-link:hover { text-decoration:underline; }
.deployment-secondary { display:block; margin-top:3px; color:var(--el-text-color-secondary); font-size:11px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.deployment-cell-text { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.deployment-time { color:var(--el-text-color-regular); font-size:12px; }
.deployment-list-footer { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-top:1px solid var(--el-border-color-lighter); }
.deployment-list-footer > span { font-size:12px; color:var(--el-text-color-secondary); }
:deep(.el-table th.el-table__cell) { background:var(--el-fill-color-light); color:var(--el-text-color-regular); font-size:12px; }
:deep(.el-table td.el-table__cell) { padding:12px 0; }
@media(max-width:1000px) { .deployment-filters { grid-template-columns:repeat(2,minmax(0,1fr)) auto; }.deployment-query-actions { grid-column:3; grid-row:1 / 3; align-self:end; }.deployment-list-footer > span { display:none; } }
</style>
