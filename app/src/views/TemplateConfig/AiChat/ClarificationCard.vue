<script setup lang="ts">
// 多选表澄清卡片：直接消费服务端 clarification（options 全部来自真实候选），
// 支持 1~maxSelect 张多选 + 自由补充；确认后锁定并回传 entryTypeId 列表。
// 数据来源契约见 @/api/aiChat 的 Clarification。
import { computed, ref, watch } from 'vue'
import type { Clarification } from '@/api/aiChat'

const props = withDefaults(defineProps<{
  clarification: Clarification
  confirmed?: boolean
  confirmedLabel?: string
}>(), {
  confirmed: false,
  confirmedLabel: '已采纳该口径',
})

const emit = defineEmits<{
  (e: 'confirm', payload: { selectedEntryTypeIds: number[]; freeText: string }): void
}>()

const selectedIds = ref<number[]>([])
const freeText = ref('')

const isTableChoice = computed(() => props.clarification.kind !== 'free_text')
const reachedMax = computed(() => selectedIds.value.length >= props.clarification.maxSelect)
const canSubmit = computed(() =>
  selectedIds.value.length > 0
  || (props.clarification.allowFreeText && freeText.value.trim().length > 0))
const selectedNames = computed(() =>
  props.clarification.options
    .filter((option) => selectedIds.value.includes(option.entryTypeId))
    .map((option) => option.typeName || option.tableName))

watch(() => props.clarification, () => {
  selectedIds.value = []
  freeText.value = ''
})

function isSelected(entryTypeId: number): boolean {
  return selectedIds.value.includes(entryTypeId)
}

function toggleOption(entryTypeId: number): void {
  if (props.confirmed) return
  const index = selectedIds.value.indexOf(entryTypeId)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
    return
  }
  if (selectedIds.value.length < props.clarification.maxSelect) {
    selectedIds.value.push(entryTypeId)
  }
}

function handleConfirm(): void {
  if (props.confirmed || !canSubmit.value) return
  emit('confirm', {
    selectedEntryTypeIds: [...selectedIds.value],
    freeText: freeText.value.trim(),
  })
}
</script>

<template>
  <div class="cc-card" :class="{ confirmed }" data-testid="clarification-card">
    <div class="cc-head">
      <span class="cc-title">
        <span class="cc-dot"></span>
        {{ isTableChoice ? '请选择要分析的表（可多选）：' : '请补充要分析的口径：' }}
      </span>
      <span class="cc-hint">最多 {{ clarification.maxSelect }} 张 · 已选 {{ selectedIds.length }}</span>
    </div>

    <p v-if="clarification.question" class="cc-question">{{ clarification.question }}</p>

    <div v-if="isTableChoice && clarification.options.length" class="cc-options">
      <div
        v-for="option in clarification.options"
        :key="option.entryTypeId"
        class="cc-option"
        :class="{
          selected: isSelected(option.entryTypeId),
          disabled: confirmed || (reachedMax && !isSelected(option.entryTypeId)),
        }"
        :data-testid="`clarification-option-${option.entryTypeId}`"
        @click="toggleOption(option.entryTypeId)"
      >
        <span class="cc-check">{{ isSelected(option.entryTypeId) ? '●' : '○' }}</span>
        <div class="cc-option-body">
          <div class="cc-option-name">{{ option.typeName || option.tableName }}</div>
          <div class="cc-option-table">{{ option.tableName }}</div>
          <div v-if="option.hint" class="cc-option-hint">{{ option.hint }}</div>
        </div>
      </div>
    </div>

    <div v-if="clarification.allowFreeText" class="cc-free">
      <el-input
        v-model="freeText"
        size="small"
        :disabled="confirmed"
        placeholder="补充时间范围或筛选条件（可选）"
        data-testid="clarification-free-text"
      />
    </div>

    <div class="cc-foot">
      <span class="cc-selected">
        已选 {{ selectedIds.length }}/{{ clarification.maxSelect }}
        <template v-if="selectedNames.length">：{{ selectedNames.join('、') }}</template>
      </span>
      <el-button
        v-if="!confirmed"
        type="primary"
        size="small"
        :disabled="!canSubmit"
        data-testid="clarification-confirm"
        @click="handleConfirm"
      >
        确认选择并开始分析
      </el-button>
      <el-tag v-else type="success" size="small" effect="light" data-testid="clarification-confirmed">
        {{ confirmedLabel }}
      </el-tag>
    </div>
  </div>
</template>

<style scoped>
.cc-card {
  margin-top: 10px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #f8fafc;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cc-card.confirmed {
  border-color: #bbf7d0;
  background: #f6fef9;
}

.cc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #334155;
}

.cc-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.cc-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
}

.cc-hint {
  font-size: 12px;
  color: #94a3b8;
}

.cc-question {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #475569;
}

.cc-options {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.cc-option {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.cc-option:hover {
  border-color: #93c5fd;
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}

.cc-option.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.cc-option.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cc-check {
  color: #3b82f6;
  font-size: 12px;
  line-height: 20px;
}

.cc-option-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cc-option-name {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.cc-option-table {
  font-size: 12px;
  color: #64748b;
  word-break: break-all;
}

.cc-option-hint {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}

.cc-free {
  max-width: 420px;
}

.cc-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.cc-selected {
  font-size: 12px;
  color: #64748b;
  word-break: break-all;
}
</style>
