<script setup lang="ts">
// 多选表澄清卡片：直接消费服务端 clarification（options 全部来自真实候选），
// 支持 1~maxSelect 张多选 + 自由补充；确认后锁定并回传 entryTypeId 列表。
// 数据来源契约见 @/api/aiChat 的 Clarification。
import { computed, ref, watch } from 'vue'
import type { Clarification, ClarificationOption } from '@/api/aiChat'

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
  if (props.clarification.maxSelect === 1) {
    selectedIds.value = [entryTypeId]
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

function handleDirectSelect(option: ClarificationOption): void {
  if (props.confirmed) return
  selectedIds.value = [option.entryTypeId]
  emit('confirm', {
    selectedEntryTypeIds: [option.entryTypeId],
    freeText: freeText.value.trim(),
  })
}
</script>

<template>
  <div class="cc-card" :class="{ confirmed }" data-testid="clarification-card">
    <div class="cc-head">
      <span class="cc-title">
        <span class="cc-dot"></span>
        {{ isTableChoice ? '请选择要分析的表（可直接点击「直接使用」或勾选多项）：' : '请补充要分析的口径：' }}
      </span>
      <span class="cc-hint">最多 {{ clarification.maxSelect }} 张 · 已选 {{ selectedIds.length }}</span>
    </div>

    <p v-if="clarification.question" class="cc-question">{{ clarification.question }}</p>

    <!-- 交互式候选选项表格：支持勾选多选与单行直接点击使用 -->
    <div v-if="isTableChoice && clarification.options.length" class="cc-table-wrapper">
      <table class="cc-interactive-table" data-testid="clarification-table">
        <thead>
          <tr>
            <th class="th-check">选择</th>
            <th class="th-no">编号</th>
            <th class="th-name">表名</th>
            <th class="th-desc">说明</th>
            <th v-if="!confirmed" class="th-action">快捷操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="option in clarification.options"
            :key="option.entryTypeId"
            class="cc-option cc-tr"
            :class="{
              selected: isSelected(option.entryTypeId),
              disabled: confirmed || (reachedMax && !isSelected(option.entryTypeId)),
            }"
            :data-testid="`clarification-option-${option.entryTypeId}`"
            role="checkbox"
            :aria-checked="isSelected(option.entryTypeId)"
            :tabindex="confirmed ? -1 : 0"
            @click="toggleOption(option.entryTypeId)"
            @keydown.space.prevent="toggleOption(option.entryTypeId)"
            @keydown.enter.prevent="toggleOption(option.entryTypeId)"
          >
            <td class="td-check" @click.stop="toggleOption(option.entryTypeId)">
              <span class="cc-check" :class="{ checked: isSelected(option.entryTypeId) }">
                <span v-if="isSelected(option.entryTypeId)" class="cc-check-mark">✓</span>
              </span>
            </td>
            <td class="td-no">
              <span class="cc-num-badge">{{ option.entryTypeId }}</span>
            </td>
            <td class="td-name">
              <code class="cc-table-code">{{ option.tableName }}</code>
            </td>
            <td class="td-desc">
              <div class="cc-option-name">{{ option.typeName || option.tableName }}</div>
              <div
                v-if="option.hint && !option.hint.startsWith('编号')"
                class="cc-option-hint"
              >
                {{ option.hint }}
              </div>
            </td>
            <td v-if="!confirmed" class="td-action" @click.stop>
              <el-button
                type="primary"
                size="small"
                class="cc-direct-btn"
                :data-testid="`clarification-direct-${option.entryTypeId}`"
                @click="handleDirectSelect(option)"
              >
                直接使用
              </el-button>
            </td>
          </tr>
        </tbody>
      </table>
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

.cc-table-wrapper {
  overflow-x: auto;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
}

.cc-interactive-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
}

.cc-interactive-table th {
  background: #f8fafc;
  color: #475569;
  font-weight: 600;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
}

.cc-tr {
  cursor: pointer;
  transition: background-color 0.15s ease;
  border-bottom: 1px solid #f1f5f9;
}

.cc-tr:last-child {
  border-bottom: none;
}

.cc-tr:hover:not(.disabled) {
  background: #f0f7ff;
}

.cc-tr.selected {
  background: #eff6ff;
}

.cc-tr.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.cc-interactive-table td {
  padding: 9px 12px;
  vertical-align: middle;
}

.th-check,
.td-check {
  width: 44px;
  text-align: center;
}

.th-no,
.td-no {
  width: 56px;
  text-align: center;
}

.cc-num-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f1f5f9;
  color: #475569;
  font-size: 12px;
  font-weight: 600;
}

.cc-tr.selected .cc-num-badge {
  background: #3b82f6;
  color: #ffffff;
}

.th-name {
  width: 28%;
}

.cc-table-code {
  font: 12px/1.4 Consolas, Menlo, Monaco, monospace;
  background: #f8fafc;
  color: #0f172a;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  display: inline-block;
  word-break: break-all;
}

.th-action,
.td-action {
  width: 90px;
  text-align: right;
  white-space: nowrap;
}

.cc-direct-btn {
  font-size: 12px;
  padding: 4px 8px;
}

.cc-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid #cbd5e1;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: transparent;
  background-color: #ffffff;
  transition: all 0.15s ease;
  flex-shrink: 0;
  margin-top: 2px;
}

.cc-option:hover:not(.disabled) .cc-check {
  border-color: #3b82f6;
}

.cc-option.selected .cc-check {
  border-color: #3b82f6;
  background-color: #3b82f6;
  color: #ffffff;
}

.cc-check-mark {
  display: block;
  line-height: 1;
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
