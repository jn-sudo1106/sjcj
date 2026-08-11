<script setup lang="ts">
// 数据查看的“展示处理步骤”与流程/数据/文件/任务视图共用 ProcessNodeRail，避免另维护一套卡片顺序和名称。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { flowApi, sourceApi, type NodeRunStat, type Source, type Step } from '../../api'
import ProcessNodeRail from '@/views/FlowCanvas/result/ProcessNodeRail.vue'
import { buildHorizontalLayout, buildSourceSeed, nodeOutputTable, type FlowDef } from '@/views/FlowCanvas/canvas/flowModel'

const props = defineProps<{
  modelValue: boolean
  sourceId?: string
  currentTableName?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; 'select-table': [string] }>()

const loading = ref(false)
const source = ref<Source | null>(null)
const steps = ref<Step[]>([])
const nodeRuns = ref<NodeRunStat[]>([])
const persistedDef = ref<FlowDef | null>(null)
const selectedNodeId = ref('')
let loadSeq = 0

const flowDef = computed<FlowDef | null>(() => {
  if (!source.value) return null
  if (persistedDef.value) return persistedDef.value
  const seed = buildSourceSeed(source.value, steps.value)
  return {
    id: source.value.sourceId,
    name: source.value.name,
    version: 'source-step-seed',
    updatedAt: '',
    main: seed.main,
    branches: seed.branches,
    configs: seed.configs,
  }
})
const processLayout = computed(() => {
  const def = flowDef.value
  return def ? buildHorizontalLayout(def.main, def.branches, def.configs, def.branchGroups, { includeTerminals: false }) : null
})
const nodeStates = computed<Record<string, string | undefined>>(() => {
  const states: Record<string, string | undefined> = Object.fromEntries(nodeRuns.value.map((item) => [item.nodeId, item.state]))
  if (source.value?.disabled) {
    processLayout.value?.nodes.forEach((node) => { states[node.id] = 'D' })
  }
  return states
})
const selectedConfig = computed(() => selectedNodeId.value ? flowDef.value?.configs[selectedNodeId.value] : undefined)
const selectedOutputTable = computed(() => selectedConfig.value ? nodeOutputTable(selectedConfig.value) : '')

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId
  const outputTable = flowDef.value?.configs[nodeId] ? nodeOutputTable(flowDef.value.configs[nodeId]) : ''
  if (!outputTable) {
    ElMessage.info('该节点没有可切换的输出表')
    return
  }
  emit('select-table', outputTable)
}
function stateText(state?: string) {
  return state === 'E' ? '异常' : state === 'L' ? '运行中' : state === 'C' ? '完成' : state === 'D' ? '已停用' : '暂无运行记录'
}

async function load() {
  const sourceId = props.sourceId
  if (!sourceId) {
    ElMessage.error('查询栏中未指定源ID,无法展示步骤')
    emit('update:modelValue', false)
    return
  }
  const requestId = ++loadSeq
  loading.value = true
  try {
    const [detail, sourceSteps, runs, savedDef] = await Promise.all([
      sourceApi.sourceDetail(sourceId),
      sourceApi.sourceSteps(sourceId),
      sourceApi.sourceNodeRuns(sourceId),
      flowApi.flowLoad(sourceId),
    ])
    if (requestId !== loadSeq) return
    source.value = detail
    steps.value = sourceSteps ?? []
    nodeRuns.value = runs ?? []
    persistedDef.value = savedDef
    selectedNodeId.value = processLayout.value?.nodes[0]?.id || ''
  } catch (error) {
    if (requestId !== loadSeq) return
    source.value = null
    steps.value = []
    nodeRuns.value = []
    persistedDef.value = null
    ElMessage.error(`步骤加载失败:${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (requestId === loadSeq) loading.value = false
  }
}

watch(() => [props.modelValue, props.sourceId] as const, ([open]) => {
  if (open) void load()
}, { immediate: true })
</script>

<template>
  <el-drawer :model-value="modelValue" title="处理步骤" size="520px" @update:model-value="(v: boolean) => emit('update:modelValue', v)">
    <div class="sp-legend"><span class="rc-mini-card">源:{{ sourceId }}</span><span>节点顺序和名称与流程视图一致</span></div>
    <div v-loading="loading" class="sp-content">
      <div v-if="processLayout" class="sp-rail-wrap" data-testid="data-step-rail">
        <ProcessNodeRail :model-value="selectedNodeId" :layout="processLayout" :node-states="nodeStates" @update:model-value="selectNode" />
      </div>
      <div v-if="selectedConfig" class="sp-selected">
        <b>{{ selectedConfig.title }}</b>
        <span>状态：{{ stateText(nodeStates[selectedNodeId]) }}</span>
        <span>输出表：{{ selectedOutputTable || '—' }}</span>
        <span v-if="selectedOutputTable === currentTableName" class="sp-current">当前查看表</span>
      </div>
      <div v-if="!loading && !processLayout" class="sp-empty">没有查询到步骤数据</div>
    </div>
  </el-drawer>
</template>

<style scoped>
.sp-legend { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--rc-muted); font-size: 11px; }
.sp-content { min-height: 140px; }
.sp-rail-wrap { overflow-x: auto; padding: 12px 0 16px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #f8fafc; }
.sp-rail-wrap :deep(.pnr) { margin: 0 12px; }
.sp-selected { display: grid; gap: 4px; margin-top: 12px; padding: 10px 12px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; color: var(--rc-text-2); font-size: 12px; }
.sp-selected b { color: var(--rc-text); }
.sp-current { color: #2563eb; font-weight: 700; }
.sp-empty { padding: 34px; color: var(--rc-faint); text-align: center; font-size: 13px; }
</style>
