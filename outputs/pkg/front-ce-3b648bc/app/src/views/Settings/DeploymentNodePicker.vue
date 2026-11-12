<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { flowCenterApi, type FlowRecord, type Step } from '@/api'
import type { DeploymentSourceNode } from '@/api/runnerManagement'

const props = defineProps<{ modelValue: boolean; busy: boolean; error: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; select: [node: DeploymentSourceNode] }>()
const keyword = ref(''), page = ref(1), total = ref(0), flows = ref<FlowRecord[]>([])
const flow = ref<FlowRecord | null>(null), steps = ref<Step[]>([]), selected = ref<Step | null>(null)
const loading = ref(false), nodesLoading = ref(false), loadError = ref('')
const selectable = computed(() => selected.value?.configId && selected.value.configId !== '0')
let flowRequest = 0, nodeRequest = 0
const problem = (e: unknown) => e instanceof Error ? e.message : String(e)
async function loadFlows(nextPage = 1) {
  const request = ++flowRequest
  ++nodeRequest
  page.value = nextPage; loading.value = true; loadError.value = ''
  flows.value = []; flow.value = null; steps.value = []; selected.value = null; nodesLoading.value = false
  try {
    const query = keyword.value.trim()
    const result = await flowCenterApi.paged({ page: nextPage, size: 10, ...(/^\d+$/.test(query) ? { flowIds: [query] } : { keywords: query }) })
    if (request !== flowRequest) return
    flows.value = result.list; total.value = result.total
    if (result.list[0]) void chooseFlow(result.list[0])
  } catch (e) { if (request === flowRequest) loadError.value = problem(e) }
  finally { if (request === flowRequest) loading.value = false }
}
async function chooseFlow(value: FlowRecord) {
  if (props.busy) return
  const request = ++nodeRequest
  flow.value = value; steps.value = []; selected.value = null; nodesLoading.value = true; loadError.value = ''
  try {
    const result = await flowCenterApi.steps(value.id, { withConfigDetails: false, backendScope: 'flow' })
    if (request !== nodeRequest) return
    steps.value = result
  } catch (e) { if (request === nodeRequest) loadError.value = problem(e) }
  finally { if (request === nodeRequest) nodesLoading.value = false }
}
function confirm() {
  if (!flow.value || !selected.value?.configId || !selectable.value || props.busy || nodesLoading.value) return
  emit('select', { flowId: flow.value.id, flowName: flow.value.name, stepId: selected.value.stepId, nodeName: selected.value.name || selected.value.configName || selected.value.configId, configId: selected.value.configId })
}
watch(() => props.modelValue, value => {
  if (value) { keyword.value = ''; void loadFlows() }
  else { ++flowRequest; ++nodeRequest }
})
</script>

<template>
  <el-dialog :model-value="modelValue" title="从流程节点创建部署配置" width="900px" class="deployment-node-picker" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @update:model-value="emit('update:modelValue', $event)">
    <p class="node-picker-intro">选择已保存配置的节点，带入任务队列、已有代码和目录映射。</p>
    <div class="node-picker-search"><el-input v-model="keyword" placeholder="搜索流程名称或 ID" clearable :disabled="busy" aria-label="搜索来源流程" @keyup.enter="loadFlows()" @clear="loadFlows()" /><el-button :disabled="busy || loading" @click="loadFlows()">查询</el-button><el-button :icon="Refresh" circle :disabled="busy || loading" aria-label="刷新流程列表" @click="loadFlows(page)" /></div>
    <el-alert v-if="loadError || error" :title="loadError || error" type="error" :closable="false" show-icon />
    <div class="node-picker-columns">
      <section v-loading="loading" class="node-picker-flows"><header>流程</header><div class="node-picker-scroll"><button v-for="item in flows" :key="item.id" type="button" class="node-picker-flow" :class="{ active: flow?.id === item.id }" :disabled="busy" @click="chooseFlow(item)"><span>{{ item.name }}</span><small>{{ item.id }}</small></button><el-empty v-if="!loading && !flows.length" description="未找到流程" :image-size="48" /></div><el-pagination v-if="total > 10" small layout="prev, pager, next" :pager-count="5" :current-page="page" :page-size="10" :total="total" :disabled="busy || loading" @current-change="loadFlows" /></section>
      <section v-loading="nodesLoading" class="node-picker-nodes"><header>{{ flow?.name || '选择流程' }}<small>选择一个配置节点</small></header><div class="node-picker-scroll"><el-table :data="steps" highlight-current-row row-key="stepId" empty-text="此流程暂无配置节点" @current-change="(row: Step | null) => { if (!busy) selected = row }"><el-table-column label="节点" min-width="150"><template #default="{ row }"><span>{{ row.name || row.configName || row.stepId }}</span><small v-if="!row.configId || row.configId === '0'" class="node-picker-unsaved">请先在流程中保存节点配置</small></template></el-table-column><el-table-column prop="configId" label="配置 ID" width="115" /><el-table-column label="" width="54"><template #default="{ row }"><span v-if="selected?.stepId === row.stepId && selectable" class="node-picker-check">已选</span></template></el-table-column></el-table></div></section>
    </div>
    <template #footer><span class="node-picker-selection">{{ selectable ? `节点配置 ${selected?.configId}` : '请先选择节点' }}</span><el-button :disabled="busy" @click="emit('update:modelValue', false)">取消</el-button><el-button type="primary" :loading="busy" :disabled="!selectable || nodesLoading || loading || busy" data-testid="deployment-node-confirm" @click="confirm">使用节点配置</el-button></template>
  </el-dialog>
</template>

<style scoped>
.node-picker-intro { margin: 0 0 14px; color: var(--el-text-color-secondary); }
.node-picker-search { display: flex; gap: 8px; margin-bottom: 14px; }
.node-picker-search .el-input { flex: 1; }
.node-picker-columns { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 14px; height: min(380px, 48vh); margin-top: 12px; }
.node-picker-columns section { display: flex; flex-direction: column; min-height: 0; min-width: 0; border: 1px solid var(--el-border-color-light); border-radius: 8px; overflow: hidden; }
.node-picker-columns header { padding: 12px; border-bottom: 1px solid var(--el-border-color-light); font-weight: 600; flex-shrink: 0; }
.node-picker-columns header small { display: block; color: var(--el-text-color-secondary); font-weight: 400; margin-top: 4px; }
.node-picker-scroll { flex: 1; min-height: 0; overflow: auto; }
.node-picker-flow { display: flex; flex-direction: column; gap: 4px; text-align: left; width: 100%; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); padding: 12px; background: var(--el-bg-color); color: var(--el-text-color-primary); cursor: pointer; }
.node-picker-flow span { overflow-wrap: anywhere; }
.node-picker-flow small, .node-picker-unsaved { color: var(--el-text-color-secondary); }
.node-picker-flow.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.node-picker-unsaved { display: block; font-size: 12px; }
.node-picker-check { color: var(--el-color-primary); font-size: 12px; }
.node-picker-selection { float: left; line-height: 32px; color: var(--el-text-color-secondary); }
.el-pagination { padding: 8px; }
:global(.deployment-node-picker) { max-width: calc(100vw - 40px); margin-top: 8vh; }
@media (max-width: 760px) { .node-picker-columns { grid-template-columns: 35% minmax(0, 1fr); } }
</style>
