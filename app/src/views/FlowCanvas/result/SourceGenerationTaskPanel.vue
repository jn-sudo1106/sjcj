<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { flowCenterApi, sourceApi, workflowBindingApi, type Source, type Step, type WorkflowBinding } from '@/api'
import { runnerManagementApi as api, type ModelInterface } from '@/api/runnerManagement'
import { ALL_AGENTS, agentStatusLabel, isOnlineAgentInterface } from '@/utils/agentPool'
import GenerationFlowPicker from './GenerationFlowPicker.vue'

const props = defineProps<{ sources: Source[] }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
type Group = { source: Source; flows: WorkflowBinding[]; flowId: string; nodes: Step[]; loading: boolean; error: string; request: number }
const groups = ref<Group[]>([]), models = ref<ModelInterface[]>([]), interfaceId = ref(ALL_AGENTS)
const error = ref(''), loading = ref(false), sending = ref(false)
const results = ref<{ key: string; label: string; taskId?: string; error?: string }[]>([])
const resultSummary = computed(() => {
  if (sending.value || !results.value.length) return ''
  const succeeded = results.value.filter(item => item.taskId).length
  const failures = results.value.filter(item => item.error)
  if (!failures.length) return `已创建 ${succeeded} 条任务，请关闭当前窗口，前往任务中心查看。`
  const reasons = [...new Set(failures.map(item => item.error))].join('；')
  return `已创建 ${succeeded} 条任务，${failures.length} 条创建失败：${reasons}。可重试未成功的任务，已创建的任务请到任务中心查看。`
})
const completed = new Set<string>()
const selections = ref<Record<string, string[]>>({})
const nodeRequests = new Map<string, Promise<Step[]>>()
let sequence = 0
const flowGroups = computed(() => {
  const flows = new Map<string, { flowId: string; name: string; groups: Group[]; nodes: Step[] }>()
  for (const group of groups.value) {
    if (group.loading || group.error || !group.flowId) continue
    let flow = flows.get(group.flowId)
    if (!flow) {
      flow = { flowId: group.flowId, name: group.flows.find(item => item.workflowId === group.flowId)?.workflowName || group.flowId, groups: [], nodes: group.nodes }
      flows.set(group.flowId, flow)
    }
    flow.groups.push(group)
  }
  return [...flows.values()]
})
function applies(node: Step, source: Source) {
  return node.enabled !== false && /^[1-9]\d*$/.test(node.configId || '') && (!node.sourceId || ['0', '-1', source.sourceId].includes(node.sourceId))
}
const targets = computed(() => groups.value.filter(group => !group.loading && !group.error).flatMap(group => group.nodes
  .filter(node => selections.value[group.flowId]?.includes(node.stepId) && applies(node, group.source))
  .map(node => ({ source: { ...group.source }, flowId: group.flowId, node: { ...node } }))))
const selectedCount = computed(() => targets.value.length)
const commonFlows = computed(() => groups.value[0]?.flows.filter(flow => groups.value.every(group => group.flows.some(item => item.workflowId === flow.workflowId))) || [])
const batchFlow = computed(() => new Set(groups.value.map(group => group.flowId)).size === 1 ? groups.value[0]?.flowId || '' : '')
async function changeBatchFlow(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  if (!id) return
  await Promise.all(groups.value.map(group => { group.flowId = id; return loadNodes(group) }))
}
async function loadNodes(group: Group) {
  const request = ++group.request
  group.loading = true; group.error = ''; group.nodes = []
  try {
    if (!selections.value[group.flowId]) selections.value[group.flowId] = []
    if (!nodeRequests.has(group.flowId)) nodeRequests.set(group.flowId, flowCenterApi.steps(group.flowId, { withConfigDetails: false, backendScope: 'default' }))
    const nodes = await nodeRequests.get(group.flowId)!
    if (request !== group.request) return
    group.nodes = nodes
  } catch (e) { if (request === group.request) { nodeRequests.delete(group.flowId); group.error = e instanceof Error ? e.message : String(e) } }
  finally { if (request === group.request) group.loading = false }
}
async function load() {
  const request = ++sequence
  loading.value = true; error.value = ''; groups.value = []; results.value = []; completed.clear()
  selections.value = {}; nodeRequests.clear()
  try {
    const settings = await api.modelInterfaces()
    if (request !== sequence) return
    models.value = settings.items.filter(isOnlineAgentInterface)
    for (const selected of props.sources) {
      if (request !== sequence) return
      const group: Group = { source: { ...selected }, flows: [], flowId: '', nodes: [], loading: true, error: '', request: 0 }
      groups.value.push(group)
      const reactiveGroup = groups.value[groups.value.length - 1]!
      try {
        const source = await sourceApi.sourceDetail(selected.sourceId)
        if (!source) throw new Error('源不存在或已删除')
        reactiveGroup.source = source
        const bindings = await workflowBindingApi.list(source.sourceId)
        reactiveGroup.flows = bindings.filter(item => item.workflowStatus !== 'DISABLED')
        if (!reactiveGroup.flows.length && (source.defaultFlowId || source.flowId)) {
          const id = source.defaultFlowId || source.flowId!
          reactiveGroup.flows = [{ workflowId: id, workflowName: `流程 ${id}`, primary: true } as WorkflowBinding]
        }
        reactiveGroup.flowId = (reactiveGroup.flows.find(item => item.primary) || reactiveGroup.flows[0])?.workflowId || ''
        if (!reactiveGroup.flowId) throw new Error('源没有可用流程')
        if (request !== sequence) return
        await loadNodes(reactiveGroup)
      } catch (e) { reactiveGroup.error = e instanceof Error ? e.message : String(e) }
      finally { reactiveGroup.loading = false }
    }
  } catch (e) { if (request === sequence) error.value = e instanceof Error ? e.message : String(e) }
  finally { if (request === sequence) loading.value = false }
}
async function submit() {
  if (loading.value || groups.value.some(group => group.loading) || sending.value || !selectedCount.value || selectedCount.value > 200) return
  const selectedTargets = targets.value
  const chosen = interfaceId.value
  sending.value = true; emit('busy', true); results.value = []
  try {
    for (const target of selectedTargets) {
      const { source, flowId, node } = target
      const key = `${source.sourceId}:${flowId}:${node.stepId}`
      if (completed.has(key)) continue
      const result: typeof results.value[number] = { key, label: `${source.name} / ${node.name} · 配置 ${node.configId}` }
      try {
        const settings = await api.nodeGenerationSettings(node.configId!)
        if (!settings.generation) throw new Error('此节点尚未配置生成参数，请先在智能体配置中配置提示词和仓库')
        const receipt = await api.createCodeGenerationTask({ sourceId: source.sourceId, sourceName: source.name, flowId, stepId: node.stepId,
          configId: node.configId!, nodeName: node.name, generation: { ...settings.generation, interfaceId: chosen, url: source.url } })
        result.taskId = receipt.job.taskId; completed.add(key)
      } catch (e) { result.error = e instanceof Error ? e.message : String(e) }
      results.value.push(result)
    }
  } finally { sending.value = false; emit('busy', false) }
}
watch(() => props.sources.map(source => source.sourceId).join(','), () => void load(), { immediate: true })
onBeforeUnmount(() => { sequence++; for (const group of groups.value) group.request++ })
</script>

<template>
  <section class="source-generation-panel">
    <p>同一流程只需勾选一次节点，应用到该流程下所有已选源；每个源的选中节点分别创建任务，无空闲资源时等待。</p>
    <label>智能体接口 <select v-model="interfaceId" aria-label="批量生成智能体接口" :disabled="sending || loading"><option :value="ALL_AGENTS">全选 · 任意空闲智能体</option><option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }} · {{ agentStatusLabel(model) }}</option></select></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading">正在读取源和流程…</p>
    <p v-for="group in groups.filter(item => item.error)" :key="group.source.sourceId" role="alert">{{ group.source.name }}：{{ group.error }}</p>
    <label v-if="commonFlows.length">批量流程 <select :value="batchFlow" aria-label="批量选择流程" :disabled="sending || loading || groups.some(group => group.loading)" @change="changeBatchFlow"><option value="" disabled>各源使用不同流程</option><option v-for="flow in commonFlows" :key="flow.workflowId" :value="flow.workflowId">{{ flow.workflowName }} · {{ flow.workflowId }}</option></select></label>
    <details><summary>源与流程（{{ groups.length }}）</summary>
    <section v-for="group in groups" :key="group.source.sourceId" class="source-generation-group">
      <strong>{{ group.source.name }} · {{ group.source.sourceId }}</strong>
      <label>流程 <select v-model="group.flowId" :aria-label="`源 ${group.source.sourceId} 的流程`" :disabled="sending || group.loading" @change="loadNodes(group)"><option v-for="flow in group.flows" :key="flow.workflowId" :value="flow.workflowId">{{ flow.workflowName }} · {{ flow.workflowId }}</option></select></label>
      <p v-if="group.error" role="alert">{{ group.error }}</p>
    </section>
    </details>
    <section v-for="flow in flowGroups" :key="flow.flowId" class="source-generation-group">
      <strong>{{ flow.name }} · {{ flow.flowId }} · {{ flow.groups.length }} 个源</strong>
      <p v-if="!flow.nodes.length">该流程没有可用配置节点。</p>
      <GenerationFlowPicker v-if="flow.nodes.length" :model-value="selections[flow.flowId] || []" :source="flow.groups[0]!.source" :source-ids="flow.groups.map(group => group.source.sourceId)" :nodes="flow.nodes" :disabled="sending || loading" :completed-ids="flow.nodes.filter(node => flow.groups.filter(group => applies(node, group.source)).every(group => completed.has(`${group.source.sourceId}:${flow.flowId}:${node.stepId}`))).map(node => node.stepId)" @update:model-value="selections[flow.flowId] = $event" />
    </section>
    <p v-if="!sources.length">请先勾选源。</p>
    <p v-if="selectedCount > 200" role="alert">每次最多提交 200 个配置节点。</p>
    <div class="source-generation-actions"><el-button type="primary" :loading="sending" :disabled="loading || groups.some(group => group.loading) || sending || !selectedCount || selectedCount > 200" data-testid="submit-selected-code-nodes" @click="submit">创建任务（{{ selectedCount }}）</el-button></div>
    <p v-if="resultSummary" :role="results.some(item => item.error) ? 'alert' : 'status'">{{ resultSummary }}</p>
  </section>
</template>

<style scoped>
.source-generation-panel { display: flex; flex-direction: column; gap: 12px; }
.source-generation-panel p { margin: 0; font-size: 12px; color: var(--rc-muted); }
.source-generation-panel [role=alert] { color: var(--el-color-danger); }
.source-generation-panel select { max-width: 100%; padding: 6px; border: 1px solid var(--el-border-color); border-radius: 5px; color: var(--el-text-color-primary); background: var(--el-bg-color); }
.source-generation-group { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--el-border-color); border-radius: 6px; padding: 12px; }
.source-generation-actions { display: flex; gap: 8px; }
</style>
