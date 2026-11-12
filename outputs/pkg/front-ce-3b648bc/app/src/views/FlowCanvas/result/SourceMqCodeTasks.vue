<script setup lang="ts">
import { computed, ref } from 'vue'
import { withNodeOrchestration } from '@/utils/flow/codeConfigSteps'
import type { CodeConfigTarget } from '@/utils/flow/codeConfigTargets'
import { sourceApi, flowCenterApi, type Source } from '@/api'
const props = withDefaults(defineProps<{ sources?: Source[]; targets?: CodeConfigTarget[] }>(), { sources: () => [], targets: () => [] })
const emit = defineEmits<{ busy: [value: boolean] }>()
const targets = computed<CodeConfigTarget[]>(() => props.targets.length ? props.targets : props.sources.map(source => ({ sourceId: source.sourceId, name: source.name })))
const sending = ref(false), error = ref('')
const receipts = ref<{ sourceId: string; name: string; message: string; failed: boolean }[]>([])
async function send() {
  if (sending.value || !targets.value.length || targets.value.length > 200) return
  error.value = ''
  const batch = targets.value.map(target => ({ ...target, ...(target.entryIds ? { entryIds: [...target.entryIds] } : {}) }))
  sending.value = true; emit('busy', true); receipts.value = []
  const flows = new Map<string, Awaited<ReturnType<typeof flowCenterApi.steps>>>()
  const definitions = new Map<string, Awaited<ReturnType<typeof flowCenterApi.detail>>>()
  try {
    for (const selected of batch) {
      try {
        const source = selected.flowId ? selected : await sourceApi.sourceDetail(selected.sourceId)
        if (!source) throw new Error('源不存在或已删除')
        const flowId = selected.flowId || ('defaultFlowId' in source ? source.defaultFlowId : undefined) || source.flowId
        if (!flowId || flowId === '0') throw new Error('源没有生效的默认流程')
        let stepId = selected.stepId
        if (!stepId && !selected.entryIds?.length) {
          const flowKey = `${flowId}:${selected.ver || ''}`
          let nodes = flows.get(flowKey)
          if (!nodes) { nodes = await flowCenterApi.steps(flowId, { withConfigDetails: false, ...(selected.ver ? { versionId: selected.ver } : {}) }); flows.set(flowKey, nodes) }
          const root = nodes.find(node => node.isRoot && node.enabled && (!node.sourceId || node.sourceId === '-1' || node.sourceId === '0' || node.sourceId === source.sourceId))
          if (!root?.stepId) throw new Error('默认流程没有可用的 ROOT 步骤')
          stepId = root.stepId
        }
        if (selected.entryIds?.length && (!selected.entryTypeId || selected.entryTypeId <= 0)) throw new Error('数据代码生成必须指定有效的入参表')
        if (selected.entryIds?.length && !stepId) throw new Error('请选择一个目标后续步骤再生成代码')
        const target = { ...selected }; delete target.name; delete target.fromStepId
        if (target.orchestration === undefined && stepId) {
          if (!definitions.has(flowId)) definitions.set(flowId, await flowCenterApi.detail(flowId, { backendScope: 'default' }))
          const resolved = withNodeOrchestration({ ...target, stepId }, definitions.get(flowId)?.definition.configs)
          if (resolved.orchestration !== undefined) target.orchestration = resolved.orchestration
        }
        const result = await sourceApi.sendCodeConfig({ ...target, sourceId: source.sourceId, flowId, ...(stepId ? { stepId } : {}) })
        const errors = result.tasks.flatMap(task => task.errors).filter(Boolean)
        receipts.value.push({ sourceId: source.sourceId, name: source.name || selected.name || source.sourceId, failed: result.failCnt > 0,
          message: `已保存 ${result.sendCnt} 个数据库任务，失败 ${result.failCnt} 个；配置 ${result.stepConfigId || result.configId}；任务 ID：${result.taskIds.join('、') || '无'}${errors.length ? `；${errors.join('；')}` : ''}` })
      } catch (e) {
        receipts.value.push({ sourceId: selected.sourceId, name: selected.name || selected.sourceId, failed: true, message: e instanceof Error ? e.message : String(e) })
      }
    }
  } finally { sending.value = false; emit('busy', false) }
}
</script>
<template>
  <div class="mq-code-tasks">
    <p v-if="!props.targets.length" class="note">为选中源生效默认流程的 ROOT 步骤创建数据库代码生成任务。</p>
    <p v-else class="note">将为以下目标生成代码；数据级生成只使用已选择的目标步骤和勾选数据。</p>
    <ul v-if="props.targets.length" aria-label="代码生成目标"><li v-for="(target, index) in targets" :key="index">源 {{ target.sourceId }} · {{ target.flowId ? `流程 ${target.flowId}` : '生效默认流程' }} · {{ target.stepId ? `步骤 ${target.stepId}` : target.entryIds?.length ? '匹配的后续步骤' : 'ROOT 步骤' }}<span v-if="target.entryIds?.length"> · 表 {{ target.entryTypeId }} · {{ target.entryIds.length }} 条数据</span><span v-if="target.ver"> · 版本 {{ target.ver }}</span></li></ul>
    <p class="note">使用节点保存的模型、提示词和仓库配置。机器未上线时任务保持等待。</p>
    <el-button type="primary" :loading="sending" :disabled="!targets.length || targets.length > 200" aria-label="开始代码生成" @click="send">代码生成（{{ targets.length }} 个目标）</el-button>
    <p v-if="targets.length > 200" role="alert">每次最多选择 200 个目标。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <ul v-if="receipts.length" aria-label="任务创建结果"><li v-for="(receipt, index) in receipts" :key="index" :class="{ failed: receipt.failed }">{{ receipt.name }}（{{ receipt.sourceId }}）：{{ receipt.message }}</li></ul>
  </div>
</template>
<style scoped>
.config-status { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
fieldset { display: flex; gap: 12px; flex-wrap: wrap; border: 0; padding: 0; margin: 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; flex: 1 1 240px; }
input, select { min-width: 0; padding: 8px; color: var(--el-text-color-primary); background: var(--el-bg-color); border: 1px solid var(--el-border-color); border-radius: 4px; }
.note { color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
li { margin: 12px 0; overflow-wrap: anywhere; font-size: 13px; } .failed { color: var(--el-color-danger); }
</style>
