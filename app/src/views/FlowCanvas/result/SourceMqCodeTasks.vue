<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CodeConfigTarget } from '@/utils/flow/codeConfigTargets'
import { sourceApi, flowCenterApi, type Source } from '@/api'
const props = withDefaults(defineProps<{ sources?: Source[]; targets?: CodeConfigTarget[] }>(), { sources: () => [], targets: () => [] })
const emit = defineEmits<{ busy: [value: boolean] }>()
const targets = computed<CodeConfigTarget[]>(() => props.targets.length ? props.targets : props.sources.map(source => ({ sourceId: source.sourceId, name: source.name })))
const configId = ref(''), queueMode = ref('default'), queue = ref(''), sending = ref(false), error = ref('')
const receipts = ref<{ sourceId: string; name: string; message: string; failed: boolean }[]>([])
async function send() {
  if (sending.value || !targets.value.length || targets.value.length > 200) return
  error.value = ''
  const dispatchConfigId = configId.value.trim(), targetQueue = queue.value.trim()
  if (dispatchConfigId && !/^[1-9]\d*$/.test(dispatchConfigId)) { error.value = '请输入有效的 201 派发配置 ID'; return }
  if (queueMode.value === 'custom' && (!targetQueue || /[,，]/.test(targetQueue))) { error.value = '请指定一个有效队列'; return }
  // Freeze form values so a batch always uses the same dispatch options.
  const options = { ...(dispatchConfigId ? { configId: dispatchConfigId } : {}), ...(queueMode.value === 'custom' ? { queue: targetQueue } : {}) }
  const batch = targets.value.map(target => ({ ...target, ...(target.entryIds ? { entryIds: [...target.entryIds] } : {}) }))
  sending.value = true; emit('busy', true); receipts.value = []
  const flows = new Map<string, Awaited<ReturnType<typeof flowCenterApi.steps>>>()
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
        const target = { ...selected }; delete target.name
        const result = await sourceApi.sendCodeConfig({ ...target, sourceId: source.sourceId, flowId, ...(stepId ? { stepId } : {}), ...options })
        const errors = result.tasks.flatMap(task => task.errors).filter(Boolean)
        receipts.value.push({ sourceId: source.sourceId, name: source.name || selected.name || source.sourceId, failed: result.failCnt > 0,
          message: `已派发 ${result.sendCnt} 个任务，失败 ${result.failCnt} 个；队列 ${result.queue}；派发配置 ${result.configId}；任务 ID：${result.taskIds.join('、') || '无'}${errors.length ? `；${errors.join('；')}` : ''}` })
      } catch (e) {
        receipts.value.push({ sourceId: selected.sourceId, name: selected.name || selected.sourceId, failed: true, message: e instanceof Error ? e.message : String(e) })
      }
    }
  } finally { sending.value = false; emit('busy', false) }
}
</script>
<template>
  <div class="mq-code-tasks">
    <p v-if="!props.targets.length" class="note">为选中源生效默认流程的 ROOT 步骤派发 MQ 代码生成任务。</p>
    <p v-else class="note">将为以下目标生成代码；带数据时，未指定步骤的目标由后端按入参表选择匹配的后续步骤。</p>
    <ul v-if="props.targets.length" aria-label="代码生成目标"><li v-for="(target, index) in targets" :key="index">源 {{ target.sourceId }} · {{ target.flowId ? `流程 ${target.flowId}` : '生效默认流程' }} · {{ target.stepId ? `步骤 ${target.stepId}` : target.entryIds?.length ? '匹配的后续步骤' : 'ROOT 步骤' }}<span v-if="target.entryIds?.length"> · 表 {{ target.entryTypeId }} · {{ target.entryIds.length }} 条数据</span><span v-if="target.ver"> · 版本 {{ target.ver }}</span></li></ul>
    <fieldset :disabled="sending">
      <label>201 派发配置 ID<input v-model="configId" aria-label="201 派发配置 ID" inputmode="numeric" placeholder="留空自动选择 ID 最小的启用配置" /></label>
      <label>派发队列<select v-model="queueMode" aria-label="派发队列"><option value="default">默认队列（201 配置 TOPIC）</option><option value="custom">指定队列</option></select></label>
      <label v-if="queueMode === 'custom'">队列名称<input v-model="queue" aria-label="队列名称" placeholder="请输入单个队列名称" /></label>
    </fieldset>
    <p class="note">派发配置必须为 201 类型；步骤运行配置由后端从节点读取。指定队列只改变本次路由，脚本保存表仍取派发配置。</p>
    <el-button type="primary" :loading="sending" :disabled="!targets.length || targets.length > 200" @click="send">代码生成（{{ targets.length }} 个目标）</el-button>
    <p v-if="targets.length > 200" role="alert">每次最多选择 200 个目标。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <ul v-if="receipts.length" aria-label="MQ 派发结果"><li v-for="(receipt, index) in receipts" :key="index" :class="{ failed: receipt.failed }">{{ receipt.name }}（{{ receipt.sourceId }}）：{{ receipt.message }}</li></ul>
  </div>
</template>
<style scoped>
fieldset { display: flex; gap: 12px; flex-wrap: wrap; border: 0; padding: 0; margin: 0; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; flex: 1 1 240px; }
input, select { min-width: 0; padding: 8px; color: var(--el-text-color-primary); background: var(--el-bg-color); border: 1px solid var(--el-border-color); border-radius: 4px; }
.note { color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
li { margin: 12px 0; overflow-wrap: anywhere; font-size: 13px; } .failed { color: var(--el-color-danger); }
</style>
