<script setup lang="ts">
// 选择流程模板（1123 A1：添加时就能看到流程节点和表配置）。
// 内容是 FlowTemplatePickerPanel（左模板列表、右节点图与节点 / 表 / 任务配置），新建采集页内嵌的是同一个面板。
// 由 FlowTemplatePickerHost 按 pickFlowTemplate() 的请求打开；只负责选，建流程由调用方完成。
import { computed, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import FlowTemplatePickerPanel from './FlowTemplatePickerPanel.vue'
import type { FlowRecord } from '@/api'
import { NO_FLOW_TEMPLATE } from '@/utils/flow/createFromTemplate'

const props = defineProps<{
  modelValue: boolean
  templates: FlowRecord[]
  /** 列表最后加「暂不配置流程」 */
  allowNone?: boolean
  message?: string
  initialId?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  pick: [templateId: string]
}>()

const selected = ref('')
watch(() => props.modelValue, (open) => {
  if (!open) return
  const known = props.templates.some(t => t.id === props.initialId) || (props.allowNone && props.initialId === NO_FLOW_TEMPLATE)
  selected.value = known ? props.initialId! : (props.templates[0]?.id ?? NO_FLOW_TEMPLATE)
}, { immediate: true })

const selectedFlow = computed(() => props.templates.find(t => t.id === selected.value) ?? null)
const noneSelected = computed(() => !!props.allowNone && selected.value === NO_FLOW_TEMPLATE)

function close() { emit('update:modelValue', false) }
function confirm() {
  if (!selectedFlow.value && !noneSelected.value) return
  emit('pick', selected.value)
}
</script>

<template>
  <ElDialog
    :model-value="modelValue"
    class="ftp-dialog"
    title="选择流程模板"
    width="min(1280px, calc(100vw - 32px))"
    append-to-body
    data-testid="flow-template-picker"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <p class="ftp-hint">{{ message || '选择起始节点结构。右侧可查看模板的节点和每个节点的表配置；创建后可独立调整节点与配置。' }}</p>
    <div class="ftp-body">
      <FlowTemplatePickerPanel v-model="selected" :templates="templates" :allow-none="allowNone" :list-width="320" />
    </div>
    <template #footer>
      <span v-if="selectedFlow" class="ftp-picked">已选：{{ selectedFlow.name }}（#{{ selectedFlow.id }}）</span>
      <button class="rc-btn" type="button" data-testid="flow-template-cancel" @click="close">取消</button>
      <button class="rc-btn primary" type="button" :disabled="!selectedFlow && !noneSelected" data-testid="flow-template-confirm" @click="confirm">确定</button>
    </template>
  </ElDialog>
</template>

<style scoped>
.ftp-hint { margin: 0 0 10px; font-size: 12px; color: var(--rc-muted); }
.ftp-body { height: min(600px, calc(100vh - 240px)); min-height: 300px; }
.ftp-picked { margin-right: auto; font-size: 12px; color: var(--rc-text-2); }
</style>

<style>
.ftp-dialog .el-dialog__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
</style>
