<script setup lang="ts">
// 多选表澄清卡片：直接消费服务端 clarification（options 全部来自真实候选），
// 支持 1~maxSelect 张多选 + 自由补充；确认后锁定并回传所选键列表。
// 文本提取的候选 entryTypeId 为 null（拿不到主键不伪造），选择键退回展示序号 ordinal。
// 数据来源契约见 @/api/aiChat 的 Clarification。
import { computed, ref, watch } from 'vue'
import { clarificationOptionKey, type ClarificationState } from '@/api/aiChat'

const props = withDefaults(defineProps<{
  clarification: ClarificationState
  confirmed?: boolean
  confirmedLabel?: string
}>(), {
  confirmed: false,
  confirmedLabel: '已采纳该口径',
})

const emit = defineEmits<{
  (e: 'confirm', payload: { selectedEntryTypeIds: number[]; freeText: string }): void
}>()

// 确认后卡片会按 key 重新挂载、历史回放也是新卡片：从澄清状态回显已选项，不能每次都清空成 0
const selectedIds = ref<number[]>([...(props.clarification.selectedEntryTypeIds ?? [])])
const freeText = ref(props.clarification.freeText ?? '')

const keyedOptions = computed(() =>
  props.clarification.options.map((option, index) => ({
    option,
    key: clarificationOptionKey(option, index),
  })),
)

const isTableChoice = computed(() => props.clarification.kind !== 'free_text')
const effectiveMaxSelect = computed(() => {
  const optionsCount = props.clarification.options?.length ?? 0
  const max = props.clarification.maxSelect ?? 5
  return optionsCount > 0 ? Math.min(max, optionsCount) : max
})
const reachedMax = computed(() => selectedIds.value.length >= effectiveMaxSelect.value)
const canSubmit = computed(() =>
  selectedIds.value.length > 0
  || (props.clarification.allowFreeText && freeText.value.trim().length > 0))
const selectedNames = computed(() =>
  keyedOptions.value
    .filter(({ key }) => selectedIds.value.includes(key))
    .map(({ option }) => option.typeName || option.tableName))

function isRedundantQuestion(q?: string): boolean {
  if (!q) return true
  const trimmed = q.trim()
  return (
    trimmed === '请勾选需要分析的数据源或表（支持多选，勾选后点击下方确认即可发送）：' ||
    trimmed === '请勾选需要分析的数据源或表（勾选后点击下方确认即可发送，支持快捷「直接使用」）：' ||
    trimmed === '请选择要使用的表（可直接点击「直接使用」，或勾选多项）：' ||
    trimmed === '请确认需要分析的表或口径：'
  )
}

watch(() => props.clarification, (next) => {
  selectedIds.value = [...(next.selectedEntryTypeIds ?? [])]
  freeText.value = next.freeText ?? ''
})

function isSelected(key: number): boolean {
  return selectedIds.value.includes(key)
}

function toggleOption(key: number): void {
  if (props.confirmed) return
  const index = selectedIds.value.indexOf(key)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
    return
  }
  if (effectiveMaxSelect.value === 1) {
    selectedIds.value = [key]
    return
  }
  if (selectedIds.value.length < effectiveMaxSelect.value) {
    selectedIds.value.push(key)
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
        {{ isTableChoice ? '待确认项：请选择要分析的数据源或表：' : '请补充要分析的口径：' }}
      </span>
      <span class="cc-hint">最多 {{ effectiveMaxSelect }} 张 · 已选 {{ selectedIds.length }}</span>
    </div>

    <p v-if="clarification.question && !isRedundantQuestion(clarification.question)" class="cc-question">{{ clarification.question }}</p>

    <!-- 交互式候选选项表格：勾选后点击下方「确认选择」推进会话 -->
    <div v-if="isTableChoice && clarification.options.length" class="cc-table-wrapper">
      <table class="cc-interactive-table" data-testid="clarification-table">
        <thead>
          <tr>
            <th class="th-check">勾选</th>
            <th class="th-no">编号</th>
            <th class="th-name">数据源 / 表名</th>
            <th class="th-desc">业务说明</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="({ option, key }, index) in keyedOptions"
            :key="key"
            class="cc-option cc-tr"
            :class="{
              selected: isSelected(key),
              disabled: confirmed || (reachedMax && !isSelected(key)),
            }"
            :data-testid="`clarification-option-${key}`"
            role="checkbox"
            :aria-checked="isSelected(key)"
            :tabindex="confirmed ? -1 : 0"
            @click="toggleOption(key)"
            @keydown.space.prevent="toggleOption(key)"
            @keydown.enter.prevent="toggleOption(key)"
          >
            <td class="td-check" @click.stop="toggleOption(key)">
              <span class="cc-check" :class="{ checked: isSelected(key) }">
                <span v-if="isSelected(key)" class="cc-check-mark">✓</span>
              </span>
            </td>
            <td class="td-no">
              <span class="cc-num-badge">{{ index + 1 }}</span>
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
      <span class="cc-selected">已选 {{ selectedIds.length }}/{{ effectiveMaxSelect }}<template v-if="selectedNames.length">：{{ selectedNames.join('、') }}</template></span>
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
