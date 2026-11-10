<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { flowCenterApi, sourceApi, workflowBindingApi, type Source, type Step, type WorkflowBinding } from '@/api'
import { runnerManagementApi as api, type ModelInterface } from '@/api/runnerManagement'
import { ALL_AGENTS, agentStatusLabel, isAgentInterface } from '@/utils/agentPool'
import GenerationFlowPicker from './GenerationFlowPicker.vue'

const props = defineProps<{ sources: Source[] }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
type Group = { source: Source; flows: WorkflowBinding[]; flowId: string; nodes: Step[]; selected: string[]; loading: boolean; error: string; request: number }
const groups = ref<Group[]>([]), models = ref<ModelInterface[]>([]), interfaceId = ref(ALL_AGENTS)
const error = ref(''), loading = ref(false), sending = ref(false)
const results = ref<{ key: string; label: string; taskId?: string; error?: string }[]>([])
const completed = new Set<string>()
let sequence = 0
const selectedCount = computed(() => groups.value.reduce((count, group) => count + group.selected.length, 0))
async function loadNodes(group: Group) {
  const request = ++group.request
  group.loading = true; group.error = ''; group.nodes = []; group.selected = []
  try {
    const nodes = await flowCenterApi.steps(group.flowId, { withConfigDetails: false, backendScope: 'default' })
    if (request !== group.request) return
    group.nodes = nodes
  } catch (e) { if (request === group.request) group.error = e instanceof Error ? e.message : String(e) }
  finally { if (request === group.request) group.loading = false }
}
async function load() {
  const request = ++sequence
  loading.value = true; error.value = ''; groups.value = []; results.value = []; completed.clear()
  try {
    const settings = await api.modelInterfaces()
    if (request !== sequence) return
    models.value = settings.items.filter(item => item.enabled && isAgentInterface(item))
    for (const selected of props.sources) {
      if (request !== sequence) return
      const group: Group = { source: { ...selected }, flows: [], flowId: '', nodes: [], selected: [], loading: true, error: '', request: 0 }
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
  if (loading.value || sending.value || !selectedCount.value || selectedCount.value > 200) return
  const targets = groups.value.flatMap(group => group.nodes.filter(node => group.selected.includes(node.stepId)).map(node => ({ source: { ...group.source }, flowId: group.flowId, node: { ...node } })))
  const chosen = interfaceId.value
  sending.value = true; emit('busy', true); results.value = []
  try {
    for (const target of targets) {
      const { source, flowId, node } = target
      const key = `${source.sourceId}:${flowId}:${node.stepId}`
      if (completed.has(key)) continue
      const result: typeof results.value[number] = { key, label: `${source.name} / ${node.name} · 配置 ${node.configId}` }
      try {
        const settings = await api.nodeGenerationSettings(node.configId!)
        if (!settings.generation) throw new Error('此节点尚未配置生成参数，请先在编排配置中配置提示词和仓库')
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
    <p>选择各源的流程，勾选需要生成代码的配置节点。每个节点创建一条智能体任务，无空闲资源时等待。</p>
    <label>智能体接口 <select v-model="interfaceId" aria-label="批量生成智能体接口" :disabled="sending || loading"><option :value="ALL_AGENTS">全选 · 任意空闲智能体</option><option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }} · {{ agentStatusLabel(model) }}</option></select></label>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading">正在读取源和流程…</p>
    <section v-for="group in groups" :key="group.source.sourceId" class="source-generation-group">
      <strong>{{ group.source.name }} · {{ group.source.sourceId }}</strong>
      <label>流程 <select v-model="group.flowId" :aria-label="`源 ${group.source.sourceId} 的流程`" :disabled="sending || group.loading" @change="loadNodes(group)"><option v-for="flow in group.flows" :key="flow.workflowId" :value="flow.workflowId">{{ flow.workflowName }} · {{ flow.workflowId }}</option></select></label>
      <p v-if="group.error" role="alert">{{ group.error }}</p>
      <p v-else-if="!group.loading && !group.nodes.length">该流程没有可用配置节点。</p>
      <GenerationFlowPicker v-if="!group.loading && group.nodes.length" v-model="group.selected" :source="group.source" :nodes="group.nodes" :disabled="sending" :completed-ids="group.nodes.filter(node => completed.has(`${group.source.sourceId}:${group.flowId}:${node.stepId}`)).map(node => node.stepId)" />
    </section>
    <p v-if="!sources.length">请先勾选源。</p>
    <p v-if="selectedCount > 200" role="alert">每次最多提交 200 个配置节点。</p>
    <div class="source-generation-actions"><el-button type="primary" :loading="sending" :disabled="loading || sending || !selectedCount || selectedCount > 200" data-testid="submit-selected-code-nodes" @click="submit">创建任务（{{ selectedCount }}）</el-button><el-button :disabled="sending || loading" @click="load">刷新</el-button></div>
    <p v-for="result in results" :key="result.key" :role="result.error ? 'alert' : undefined">{{ result.label }}：{{ result.error || `任务已提交 ${result.taskId}` }}</p>
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
