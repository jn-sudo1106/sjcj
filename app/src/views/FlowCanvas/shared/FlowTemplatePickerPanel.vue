<script setup lang="ts">
// 流程模板选择面板（1123 A1）：左侧模板列表，右侧只读预览（节点图 + 节点 / 表 / 任务配置）。
// 弹窗（FlowTemplatePickerDialog）和新建采集页内嵌共用；高度由父级给（面板撑满父级）。
import { computed, ref } from 'vue'
import FlowReadonlyPreview from './FlowReadonlyPreview.vue'
import ResizableFlowSplit from './ResizableFlowSplit.vue'
import type { FlowRecord } from '@/api'
import { NO_FLOW_TEMPLATE } from '@/utils/flow/createFromTemplate'

const props = withDefaults(defineProps<{
  templates: FlowRecord[]
  /** 已选模板 ID；NO_FLOW_TEMPLATE = 暂不配置流程 */
  modelValue: string
  /** 列表最后加「暂不配置流程」 */
  allowNone?: boolean
  /** 左侧列表初始宽度 */
  listWidth?: number
}>(), { allowNone: false, listWidth: 300 })
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const keyword = ref('')
const shown = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return kw ? props.templates.filter(t => t.name.toLowerCase().includes(kw) || t.id.includes(kw)) : props.templates
})
const selectedFlow = computed(() => props.templates.find(t => t.id === props.modelValue) ?? null)
const noneSelected = computed(() => props.allowNone && props.modelValue === NO_FLOW_TEMPLATE)
const selected = computed({
  get: () => props.modelValue,
  set: (id: string) => emit('update:modelValue', id),
})
</script>

<template>
  <ResizableFlowSplit class="ftp-content" :initial-width="listWidth" label="调整模板列表宽度">
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
            <input v-model="selected" class="ftp-radio" type="radio" name="ftp-template" :value="t.id" />
            <span class="ftp-name" :title="t.name">{{ t.name }}</span>
            <small class="ftp-id">#{{ t.id }}</small>
          </label>
          <p v-if="!shown.length" class="ftp-empty">没有匹配的模板</p>
        </div>
        <label v-if="allowNone" class="ftp-none" :class="{ on: noneSelected }" data-testid="flow-template-none" title="源建好后没有流程，进画布后在流程标签栏「＋」配置">
          <input v-model="selected" class="ftp-radio" type="radio" name="ftp-template" :value="NO_FLOW_TEMPLATE" />
          <span>暂不配置流程，先只建源</span>
        </label>
      </div>
    </template>
    <template #right>
      <div class="ftp-preview">
        <FlowReadonlyPreview v-if="selectedFlow" :flow="selectedFlow" style="height: 100%" />
        <div v-else class="ftp-placeholder" data-testid="flow-template-placeholder">
          <strong>{{ noneSelected ? '暂不配置流程' : '请选择一个模板' }}</strong>
          <span>{{ noneSelected ? '只创建网站和源，源建好后没有流程；进画布后在流程标签栏「＋」按模板新建。' : '选中左侧模板后，这里显示它的节点和每个节点的表配置。' }}</span>
        </div>
      </div>
    </template>
  </ResizableFlowSplit>
</template>

<style scoped>
.ftp-content { height: 100%; min-height: 300px; }
.ftp-list { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ftp-search { height: 32px; box-sizing: border-box; padding: 0 10px; margin-bottom: 8px; border: 1px solid #dbe3ee; border-radius: 7px; font-size: 12px; outline: none; }
.ftp-search:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
/* 紧凑单行：名称 + ID，选中整行高亮（左侧主色竖条） */
.ftp-items { flex: 0 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 4px; }
.ftp-item { position: relative; display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 10px; border-radius: 7px; cursor: pointer; }
.ftp-item:hover { background: #f5f8fc; }
.ftp-item.on { background: var(--rc-primary-bg); }
.ftp-item.on::before { content: ''; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px; border-radius: 2px; background: var(--rc-primary, #2563eb); }
.ftp-radio { flex: none; margin: 0; accent-color: var(--rc-primary, #2563eb); }
.ftp-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; color: var(--rc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ftp-item.on .ftp-name { color: var(--rc-primary-ink); }
.ftp-id { flex: none; font-size: 11px; color: var(--rc-faint); font-variant-numeric: tabular-nums; }
.ftp-empty { margin: 8px 10px; font-size: 12px; color: var(--rc-faint); }
/* 「暂不配置流程」不是一个模板：放在列表底部，弱化成次要选项 */
.ftp-none { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 9px 10px 0; border-top: 1px solid var(--rc-border-soft, #eef2f7); color: var(--rc-muted); font-size: 12px; cursor: pointer; }
.ftp-none.on { color: var(--rc-primary-ink); font-weight: 600; }
.ftp-preview { height: 100%; min-width: 0; }
.ftp-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; height: 100%; padding: 0 24px; box-sizing: border-box; border: 1px solid #e5eaf1; border-radius: 10px; background: #f8fafc; text-align: center; }
.ftp-placeholder strong { color: var(--rc-text-2); font-size: 13px; }
.ftp-placeholder span { max-width: 360px; color: var(--rc-faint); font-size: 12px; line-height: 1.6; }
</style>
