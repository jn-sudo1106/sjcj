<script setup lang="ts">
// 选择流程模板（1123 A1：添加时就能看到流程节点和表配置）。
// 左侧模板列表，右侧与「关联已有流程」同一套只读预览（节点图 + 节点 / 表 / 任务配置）。
// 由 FlowTemplatePickerHost 按 pickFlowTemplate() 的请求打开；只负责选，建流程由调用方完成。
import { computed, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import FlowReadonlyPreview from './FlowReadonlyPreview.vue'
import ResizableFlowSplit from './ResizableFlowSplit.vue'
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

const keyword = ref('')
const selected = ref('')
watch(() => props.modelValue, (open) => {
  if (!open) return
  keyword.value = ''
  const known = props.templates.some(t => t.id === props.initialId) || (props.allowNone && props.initialId === NO_FLOW_TEMPLATE)
  selected.value = known ? props.initialId! : (props.templates[0]?.id ?? NO_FLOW_TEMPLATE)
}, { immediate: true })

const shown = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return kw ? props.templates.filter(t => t.name.toLowerCase().includes(kw) || t.id.includes(kw)) : props.templates
})
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
    <ResizableFlowSplit class="ftp-content" :initial-width="320" label="调整模板列表宽度">
      <template #left>
        <div class="ftp-list">
          <input v-model="keyword" class="ftp-search" placeholder="搜索模板名称 / ID" aria-label="搜索模板" data-testid="flow-template-search" />
          <div class="ftp-items" role="radiogroup" aria-label="流程模板">
            <label
              v-for="t in shown"
              :key="t.id"
              class="ftp-item"
              :class="{ on: selected === t.id }"
              :data-testid="`flow-template-${t.id}`"
            >
              <input v-model="selected" type="radio" name="ftp-template" :value="t.id" />
              <span class="ftp-text"><span class="ftp-name">{{ t.name }}</span><small class="ftp-id">#{{ t.id }}</small></span>
            </label>
            <p v-if="!shown.length" class="ftp-empty">没有匹配的模板</p>
            <label v-if="allowNone" class="ftp-item none" :class="{ on: noneSelected }" data-testid="flow-template-none">
              <input v-model="selected" type="radio" name="ftp-template" :value="NO_FLOW_TEMPLATE" />
              <span class="ftp-text"><span class="ftp-name">暂不配置流程</span><small class="ftp-id">源建好后没有流程，进画布后在流程标签栏「＋」配置</small></span>
            </label>
          </div>
        </div>
      </template>
      <template #right>
        <div class="ftp-preview">
          <FlowReadonlyPreview v-if="selectedFlow" :flow="selectedFlow" style="height: 100%" />
          <div v-else class="ftp-placeholder">{{ noneSelected ? '不配置流程：只建源，不显示节点与表。' : '请选择一个模板' }}</div>
        </div>
      </template>
    </ResizableFlowSplit>
    <template #footer>
      <span v-if="selectedFlow" class="ftp-picked">已选：{{ selectedFlow.name }}（#{{ selectedFlow.id }}）</span>
      <button class="rc-btn" type="button" data-testid="flow-template-cancel" @click="close">取消</button>
      <button class="rc-btn primary" type="button" :disabled="!selectedFlow && !noneSelected" data-testid="flow-template-confirm" @click="confirm">确定</button>
    </template>
  </ElDialog>
</template>

<style scoped>
.ftp-hint { margin: 0 0 10px; font-size: 12px; color: var(--rc-muted); }
.ftp-content { height: min(600px, calc(100vh - 240px)); min-height: 300px; }
.ftp-list { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ftp-search { height: 28px; box-sizing: border-box; padding: 0 8px; margin-bottom: 8px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 12px; outline: none; }
.ftp-search:focus { border-color: #60a5fa; }
.ftp-items { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
.ftp-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid var(--rc-border); border-radius: 8px; cursor: pointer; }
.ftp-item:hover { border-color: #bfdbfe; }
.ftp-item.on { border-color: #93c5fd; background: var(--rc-primary-bg); }
.ftp-item.none { border-style: dashed; margin-top: 4px; }
.ftp-item input { margin-top: 2px; }
.ftp-text { display: flex; flex-direction: column; min-width: 0; }
.ftp-name { font-size: 13px; font-weight: 600; color: var(--rc-text); overflow-wrap: anywhere; }
.ftp-id { font-size: 11px; color: var(--rc-faint); overflow-wrap: anywhere; }
.ftp-empty { margin: 8px 0; font-size: 12px; color: var(--rc-faint); }
.ftp-preview { height: 100%; min-width: 0; }
.ftp-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; border: 1px dashed var(--rc-border); border-radius: 8px; color: var(--rc-faint); font-size: 12px; }
.ftp-picked { margin-right: auto; font-size: 12px; color: var(--rc-text-2); }
</style>

<style>
.ftp-dialog .el-dialog__footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
</style>
