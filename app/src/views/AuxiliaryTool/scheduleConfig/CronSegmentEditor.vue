<script setup lang="ts">
// cron 单段编辑器（秒/分/时/日/月/周 通用）—— 旧 `components/Cron/tabs/*.vue` 六份近乎重复的模板
// 合并成一个组件，选项语义与旧版一一对应：
//   不设置(?) / 每秒(*) / 区间(start-end) / 循环(start/interval) / 指定(勾选)
// 周段的取值显示成「周日…周六」（旧 Week.vue 的 WEEK_MAP），其余段显示数字。
//
// ⚠️ 这里用原生 radio 而不是 el-radio-group：旧版的控件是**嵌在单选项内部**的
//    （「区间: 从 [__] 至 [__]」整行是一个 radio），el-radio-group 不允许内部再塞表单控件。
//    原生 input + accent-color 既保持同样的行内结构，又不会被表单控件抢走点击。
import { computed } from 'vue'
import { ElCheckbox, ElInputNumber, ElSelect, ElOption } from 'element-plus'
import type { SegmentSpec, SegmentState, SegmentType } from './cronSegments'

const props = defineProps<{
  modelValue: SegmentState
  spec: SegmentSpec
  /** 日/周互斥时把另一端置灰（旧 Day/Week 的 disableChoice） */
  disabled?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: SegmentState): void }>()

function patch(partial: Partial<SegmentState>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function setType(type: SegmentType) {
  if (props.disabled) return
  patch({ type })
}

const active = computed(() => props.modelValue.type)
const usable = computed(() => !props.disabled)

/** 勾选区/下拉的取值列表 */
const options = computed(() =>
  Array.from({ length: props.spec.max - props.spec.min + 1 }, (_, index) => props.spec.min + index),
)
const labelOf = (value: number): string => props.spec.labels?.[value] ?? String(value)

function toggleItem(value: number, checked: boolean) {
  if (props.disabled) return
  const next = new Set(props.modelValue.list)
  if (checked) next.add(value)
  else next.delete(value)
  patch({ list: [...next] })
}
</script>

<template>
  <div class="cse" :class="{ 'is-disabled': disabled }">
    <!-- 不设置（只有日/周有） -->
    <label v-if="spec.allowNotSet" class="cse-row">
      <input
        type="radio"
        name="cse-type"
        :checked="active === 'notset'"
        :disabled="!usable"
        @change="setType('notset')"
      />
      <span>不设置</span>
      <span class="cse-tip">日和周只能设置其中之一</span>
    </label>

    <!-- 每秒 / 每分 / … -->
    <label class="cse-row">
      <input type="radio" name="cse-type" :checked="active === 'every'" :disabled="!usable" @change="setType('every')" />
      <span>{{ spec.everyLabel }}</span>
    </label>

    <!-- 区间 -->
    <div class="cse-row" :class="{ 'is-active': active === 'range' }">
      <label class="cse-inline-label">
        <input type="radio" name="cse-type" :checked="active === 'range'" :disabled="!usable" @change="setType('range')" />
        <span>区间: 从</span>
      </label>
      <el-select
        v-if="spec.labels"
        :model-value="modelValue.start"
        class="cse-week-select"
        :disabled="active !== 'range' || !usable"
        @update:model-value="(v: number) => patch({ start: v })"
      >
        <el-option v-for="v in options" :key="v" :label="labelOf(v)" :value="v" />
      </el-select>
      <el-input-number
        v-else
        :model-value="modelValue.start"
        :min="spec.min"
        :max="spec.max"
        :precision="0"
        :controls="false"
        class="cse-num"
        :disabled="active !== 'range' || !usable"
        @update:model-value="(v: number | undefined) => patch({ start: v ?? spec.rangeStart })"
      />
      <span class="cse-word">至</span>
      <el-select
        v-if="spec.labels"
        :model-value="modelValue.end"
        class="cse-week-select"
        :disabled="active !== 'range' || !usable"
        @update:model-value="(v: number) => patch({ end: v })"
      >
        <el-option v-for="v in options" :key="v" :label="labelOf(v)" :value="v" />
      </el-select>
      <el-input-number
        v-else
        :model-value="modelValue.end"
        :min="spec.min"
        :max="spec.max"
        :precision="0"
        :controls="false"
        class="cse-num"
        :disabled="active !== 'range' || !usable"
        @update:model-value="(v: number | undefined) => patch({ end: v ?? spec.rangeEnd })"
      />
    </div>

    <!-- 循环 -->
    <div class="cse-row" :class="{ 'is-active': active === 'loop' }">
      <label class="cse-inline-label">
        <input type="radio" name="cse-type" :checked="active === 'loop'" :disabled="!usable" @change="setType('loop')" />
        <span>循环: 从</span>
      </label>
      <el-select
        v-if="spec.labels"
        :model-value="modelValue.loopStart"
        class="cse-week-select"
        :disabled="active !== 'loop' || !usable"
        @update:model-value="(v: number) => patch({ loopStart: v })"
      >
        <el-option v-for="v in options" :key="v" :label="labelOf(v)" :value="v" />
      </el-select>
      <el-input-number
        v-else
        :model-value="modelValue.loopStart"
        :min="spec.min"
        :max="spec.max"
        :precision="0"
        :controls="false"
        class="cse-num"
        :disabled="active !== 'loop' || !usable"
        @update:model-value="(v: number | undefined) => patch({ loopStart: v ?? spec.loopStart })"
      />
      <span class="cse-word">开始，间隔</span>
      <el-input-number
        :model-value="modelValue.interval"
        :min="1"
        :max="spec.max - spec.min + 1"
        :precision="0"
        :controls="false"
        class="cse-num"
        :disabled="active !== 'loop' || !usable"
        @update:model-value="(v: number | undefined) => patch({ interval: v ?? 1 })"
      />
    </div>

    <!-- 指定：勾选 -->
    <div class="cse-row cse-row-specify">
      <label class="cse-inline-label">
        <input type="radio" name="cse-type" :checked="active === 'specify'" :disabled="!usable" @change="setType('specify')" />
        <span>指定</span>
      </label>
      <div class="cse-list" :class="{ 'is-off': active !== 'specify' || !usable }">
        <el-checkbox
          v-for="v in options"
          :key="v"
          :model-value="modelValue.list.includes(v)"
          :label="labelOf(v)"
          :disabled="active !== 'specify' || !usable"
          @change="(checked: boolean | string | number) => toggleItem(v, Boolean(checked))"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.cse {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 2px;
}
.cse.is-disabled {
  opacity: 0.6;
}
.cse-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 32px;
  line-height: 1.4;
}
.cse-row.is-active {
  color: var(--rc-text, #0f172a);
}
.cse-inline-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--rc-text, #0f172a);
}
.cse-row input[type='radio'] {
  accent-color: var(--rc-primary, #2563eb);
  margin: 0;
  cursor: pointer;
}
.cse-row label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--rc-text, #0f172a);
  cursor: pointer;
}
.cse-row-specify {
  align-items: flex-start;
}
.cse-word {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.cse-tip {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.cse-num {
  width: 72px;
}
.cse-week-select {
  width: 96px;
}
.cse-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(62px, 1fr));
  gap: 2px 8px;
  flex: 1;
  min-width: 0;
}
.cse-list.is-off {
  opacity: 0.55;
}
.cse-list :deep(.el-checkbox) {
  margin-right: 0;
  height: 24px;
}
</style>
