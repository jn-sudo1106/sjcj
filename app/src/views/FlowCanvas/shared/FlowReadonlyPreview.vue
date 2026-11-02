<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { configApi, flowCenterApi, flowVersionApi, type FlowRecord, type Source, type Step } from '@/api'
import { buildSourceSeed, effectiveInputTable, rootStepForSource } from '@/views/FlowCanvas/canvas/flowModel'
import FlowReadonlyCanvas, { type ReadonlyFlowDef } from '@/views/FlowCanvas/canvas/FlowReadonlyCanvas.vue'
import FlowNodeReadonlyPanel from '@/views/FlowCanvas/canvas/FlowNodeReadonlyPanel.vue'
import ResizableFlowSplit from './ResizableFlowSplit.vue'

const props = defineProps<{ flow: FlowRecord | null }>()
const versionLabel = ref('')
let requestSeq = 0
// ---- 右侧预览：按流程工作区同一条还原路径（步骤 → 画布定义，见 FlowDetailDrawer.deriveFromFlowConfig）----
const previewDef = ref<ReadonlyFlowDef | null>(null)
const previewSteps = ref<Step[]>([])
const previewLoading = ref(false)
const previewError = ref('')
const previewNodeId = ref('')
async function preview(flow: FlowRecord, versionId: string | undefined, req: number) {
  previewDef.value = null
  previewSteps.value = []
  previewNodeId.value = ''
  previewError.value = ''
  previewLoading.value = true
  try {
    const steps = await flowCenterApi.steps(flow.id, versionId ? { versionId } : {})
    // 后端没给真实根行（旧数据）时按流程自己的配置合成起点，同工作区
    const hasRoot = steps.some((step) => step.isRoot)
    const config = hasRoot ? null : await configApi.configDetail(flow.id).catch(() => null)
    const stub: Source = {
      sourceId: '', name: config?.name || flow.name, url: config?.url || '', configId: flow.id,
      mainTable: config?.entryTypeId || '', owner: '', state: 'C',
    }
    const root = hasRoot ? null : rootStepForSource(stub)
    const seed = buildSourceSeed(stub, root ? [root, ...steps] : steps)
    if (req !== requestSeq) return
    previewSteps.value = steps
    previewDef.value = { main: seed.main, branches: seed.branches, configs: seed.configs, branchGroups: seed.branchGroups }
    // 同工作区：打开流程默认选中第一个真实节点，右侧配置区直接有内容
    previewNodeId.value = seed.main.find((id) => id !== 'start' && id !== 'end' && seed.configs[id]) ?? ''
  } catch (error) {
    if (req === requestSeq) previewError.value = `流程读取失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    if (req === requestSeq) previewLoading.value = false
  }
}
const previewEmpty = computed(() => !!previewDef.value && !previewDef.value.main.some((id) => id !== 'start' && id !== 'end'))
/** 画布上选中的节点：右侧只读配置区的数据（配置、步骤行、继承后的输入表） */
const previewNode = computed(() => {
  const def = previewDef.value
  const id = previewNodeId.value
  const cfg = id ? def?.configs[id] : undefined
  if (!def || !cfg) return null
  return {
    id,
    cfg,
    step: previewSteps.value.find((s) => s.stepId === id),
    inputTable: effectiveInputTable(def.main, def.branches, def.configs, id, def.branchGroups),
  }
})

watch(() => props.flow, async (flow) => {
  const req = ++requestSeq
  previewDef.value = null
  previewError.value = ''
  versionLabel.value = ''
  if (!flow) return
  previewLoading.value = true
  try {
    const overview = await flowVersionApi.overview(flow.id)
    if (req !== requestSeq) return
    const versionId = overview.enabled ? overview.publishId || overview.draftId : null
    const version = overview.versions.find(v => v.versionId === versionId)
    versionLabel.value = !overview.enabled ? '流程当前版本' : overview.publishId
      ? `已发布${version ? ` v${version.flowVer}` : ''}`
      : overview.draftId ? `草稿${version ? ` v${version.flowVer}` : ''}（尚未发布）` : '无可用版本'
    if (overview.enabled && !versionId) {
      previewError.value = '没有可预览的发布版本或草稿'
      previewLoading.value = false
      return
    }
    await preview(flow, versionId || undefined, req)
  } catch (error) {
    if (req === requestSeq) {
      previewError.value = `版本读取失败：${error instanceof Error ? error.message : String(error)}`
      previewLoading.value = false
    }
  }
}, { immediate: true })
</script>

<template>
  <section class="frp" data-testid="flow-readonly-preview">
    <template v-if="flow">
      <div class="frp-head"><b :title="flow.name">{{ flow.name }}</b><span>#{{ flow.id }} · {{ versionLabel }}</span></div>
      <ResizableFlowSplit class="frp-work" resize-side="right" :initial-width="270" :min-left="150" :min-right="180" label="调整节点配置宽度">
        <template #left>
        <div class="frp-canvas" v-loading="previewLoading">
          <p v-if="previewError" class="frp-state frp-error">{{ previewError }}</p>
          <p v-else-if="previewEmpty" class="frp-state">这个流程还没有节点</p>
          <FlowReadonlyCanvas v-else-if="previewDef" :def="previewDef" :selected="previewNodeId" @select="previewNodeId = $event" />
        </div>
        </template>
        <template #right>
        <FlowNodeReadonlyPanel v-if="previewNode" class="frp-node" :node-id="previewNode.id" :cfg="previewNode.cfg" :step="previewNode.step" :input-table="previewNode.inputTable" />
        <p v-else class="frp-node frp-state">点画布上的节点，查看它的配置</p>
        </template>
      </ResizableFlowSplit>
    </template>
    <p v-else class="frp-state">点左侧流程，在这里预览流程图</p>
  </section>
</template>

<style scoped>
.frp { display:flex; flex-direction:column; min-width:0; min-height:0; border:1px solid var(--rc-border); border-radius:8px; overflow:hidden; }
.frp-head { display:flex; gap:10px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--rc-border-soft); font-size:12px; color:var(--rc-text-2); }
.frp-head b { color:var(--rc-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.frp-work { flex:1; min-height:0; }
.frp-canvas { position:relative; height:100%; min-width:0; min-height:0; }
.frp-node { min-width:0; }
.frp-state { padding:40px 12px; text-align:center; color:var(--rc-faint); font-size:12px; }
.frp-error { color:#dc2626; }

</style>
