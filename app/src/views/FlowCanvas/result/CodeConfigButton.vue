<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { workflowBindingApi, type Source, type WorkflowBinding } from '@/api'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import type { CodeConfigTarget } from '@/utils/flow/codeConfigTargets'
import { loadCodeStepChoices, withNodeOrchestration, type CodeStepChoice } from '@/utils/flow/codeConfigSteps'
import SourceMqCodeTasks from './SourceMqCodeTasks.vue'
defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ sources?: Source[]; buildTargets?: () => CodeConfigTarget[]; label?: string; disabled?: boolean; hideTrigger?: boolean; selectStep?: boolean; nodeConfigs?: Record<string, NodeConfig> }>(), { sources: () => [], label: '代码生成' })
const open = ref(false), busy = ref(false), loadingSteps = ref(false), stepDialog = ref(false), selectedStep = ref('')
const choices = ref<CodeStepChoice[]>([])
// 单个源发起时先选流程（1105 会议：源绑了多个流程，要能指定按哪个流程生成代码）
const flowDialog = ref(false), selectedFlow = ref(''), flowChoices = ref<WorkflowBinding[]>([])
const targets = ref<CodeConfigTarget[]>([]), selectedSources = ref<Source[]>([])
async function show() {
  if (props.disabled || loadingSteps.value || busy.value) return
  try {
    targets.value = props.buildTargets?.().map(target => JSON.parse(JSON.stringify(target))) ?? []
    selectedSources.value = props.sources.map(source => ({ ...source }))
    if (!targets.value.length && !selectedSources.value.length) throw new Error('请先选择源或数据')
    if (!targets.value.length && selectedSources.value.length === 1) {
      loadingSteps.value = true
      const source = selectedSources.value[0]!
      // 查不到绑定或接口失败时不拦着：照旧交给后端按默认流程生成
      const bindings = await workflowBindingApi.list(source.sourceId).catch(() => [])
      const runnable = bindings.filter(binding => binding.workflowStatus !== 'DISABLED')
      if (runnable.length === 1) targets.value = [{ sourceId: source.sourceId, name: source.name, flowId: runnable[0]!.workflowId }]
      if (runnable.length > 1) {
        flowChoices.value = bindings
        selectedFlow.value = (runnable.find(binding => binding.primary) ?? runnable[0]!).workflowId
        flowDialog.value = true
        return
      }
    }
    if (props.selectStep) {
      loadingSteps.value = true
      choices.value = await loadCodeStepChoices(targets.value)
      if (!choices.value.length) throw new Error('没有与所选数据入参表匹配的启用后续步骤')
      selectedStep.value = ''
      stepDialog.value = true
    } else {
      targets.value = targets.value.map(target => withNodeOrchestration(target, props.nodeConfigs))
      open.value = true
    }
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : String(e)) }
  finally { loadingSteps.value = false }
}
function confirmFlow() {
  const source = selectedSources.value[0]
  if (!source || !selectedFlow.value) return
  targets.value = [{ sourceId: source.sourceId, name: source.name, flowId: selectedFlow.value }]
  flowDialog.value = false
  open.value = true
}
function confirmStep() {
  const choice = choices.value.find(item => item.key === selectedStep.value)
  if (!choice) return
  targets.value = choice.targets.map(target => withNodeOrchestration(target, props.nodeConfigs))
  stepDialog.value = false
  open.value = true
}
defineExpose({ show })
</script>
<template>
  <button v-if="!hideTrigger" v-bind="$attrs" class="rc-btn" type="button" :disabled="disabled || loadingSteps" :aria-busy="loadingSteps" @click="show">{{ loadingSteps ? '加载步骤…' : label }}</button>
  <el-dialog v-if="flowDialog" v-model="flowDialog" title="选择代码生成流程" width="min(620px, 94vw)" append-to-body destroy-on-close>
    <p>该源绑定了多个流程，选择按哪个流程生成代码。</p>
    <label>流程<select v-model="selectedFlow" class="code-step-select" aria-label="代码生成流程"><option v-for="flow in flowChoices" :key="flow.workflowId" :value="flow.workflowId" :disabled="flow.workflowStatus === 'DISABLED'">{{ flow.workflowName }} · 流程 {{ flow.workflowId }}{{ flow.primary ? '（默认）' : '' }}{{ flow.workflowStatus === 'DISABLED' ? '（已禁用）' : '' }}</option></select></label>
    <template #footer><el-button @click="flowDialog = false">取消</el-button><el-button type="primary" :disabled="!selectedFlow" @click="confirmFlow">下一步</el-button></template>
  </el-dialog>
  <el-dialog v-if="stepDialog" v-model="stepDialog" title="选择代码生成步骤" width="min(620px, 94vw)" append-to-body destroy-on-close>
    <p>选择一个后续步骤，基于该步骤和适用的勾选数据生成代码。</p>
    <label>目标步骤<select v-model="selectedStep" class="code-step-select" aria-label="代码生成目标步骤"><option value="">请选择一个后续步骤</option><option v-for="choice in choices" :key="choice.key" :value="choice.key">{{ choice.name }} · 步骤 {{ choice.stepId }} · 流程 {{ choice.flowId }} · {{ choice.targets.length }} 个源 / {{ choice.targets.reduce((sum, target) => sum + (target.entryIds?.length || 0), 0) }} 条数据</option></select></label>
    <template #footer><el-button @click="stepDialog = false">取消</el-button><el-button type="primary" :disabled="!selectedStep" @click="confirmStep">下一步</el-button></template>
  </el-dialog>
  <el-drawer v-if="open" v-model="open" title="代码生成" size="min(760px, 96vw)" append-to-body destroy-on-close :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy">
    <SourceMqCodeTasks :sources="selectedSources" :targets="targets" @busy="busy = $event" />
  </el-drawer>
</template>
<style scoped>.code-step-select { display: block; width: 100%; margin-top: 8px; padding: 8px; border: 1px solid var(--el-border-color); border-radius: 4px; background: var(--el-bg-color); color: var(--el-text-color-primary); }</style>
