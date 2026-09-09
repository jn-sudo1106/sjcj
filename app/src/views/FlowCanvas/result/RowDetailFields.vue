<script setup lang="ts">
import { computed } from 'vue'
import type { RowDetailField } from './rowDetailFields'

const props = withDefaults(defineProps<{
  fields: RowDetailField[]
  editing?: boolean
  values?: Record<string, string>
  compact?: boolean
  /** 受控：显示空字段。开关在抽屉头，这里不再自持（0831 X4）。 */
  showEmpty?: boolean
  /** 只展示这些 prop；空 = 全部。编辑态忽略，强制全字段。 */
  visibleProps?: string[]
}>(), { editing: false, values: () => ({}), compact: false, showEmpty: false, visibleProps: () => [] })

const emit = defineEmits<{
  'update:field': [payload: { prop: string; value: string }]
  'file-click': [path: string]
}>()

const scopedFields = computed(() => {
  if (props.editing || !props.visibleProps.length) return props.fields
  const allow = new Set(props.visibleProps)
  return props.fields.filter((field) => allow.has(field.prop))
})
const emptyCount = computed(() => scopedFields.value.filter((field) => field.empty).length)
const filledCount = computed(() => scopedFields.value.length - emptyCount.value)
const visibleFields = computed(() => {
  if (props.editing || props.showEmpty) return scopedFields.value
  return scopedFields.value.filter((field) => !field.empty)
})
const hiddenEmpty = computed(() => (!props.editing && !props.showEmpty ? emptyCount.value : 0))

function onEdit(prop: string, event: Event) {
  emit('update:field', { prop, value: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <div class="rdf" :class="{ compact }">
    <div v-if="fields.length" class="rdf-toolbar">
      <span class="rdf-count">已填 {{ filledCount }} / {{ scopedFields.length }}</span>
      <span v-if="editing" class="rdf-edit-hint">编辑时展示全部字段</span>
    </div>
    <div
      v-for="field in visibleFields"
      :key="field.key"
      class="rdf-field"
      :class="{ empty: field.empty }"
      :data-testid="`row-detail-field-${field.prop}`"
    >
      <div class="rdf-field-head">
        <span class="rdf-name">{{ field.name }}</span>
        <!-- 右侧字段标识：prop · K1（2026-09-09）。K 名单独着色并加粗一档——
             写 SQL 条件、配规则用的都是物理列名，prop 只是逻辑名，可操作的那个要更醒目。
             没有 columnName 的字段（固定列、旧 showItems 路径）只显示 code，不留空分隔点。 -->
        <span class="rdf-code">
          {{ field.code }}<template v-if="field.columnName"><span class="rdf-code-sep"> · </span><span class="rdf-col">{{ field.columnName }}</span></template>
        </span>
      </div>
      <input
        v-if="editing"
        class="rdf-input"
        :value="values[field.prop] ?? ''"
        :aria-label="field.name"
        @input="onEdit(field.prop, $event)"
      />
      <div v-else class="rdf-value">
        <a
          v-if="field.href"
          class="rdf-link"
          :href="field.href"
          target="_blank"
          rel="noreferrer noopener nofollow"
        >{{ field.value }}</a>
        <button
          v-else-if="field.filePath"
          type="button"
          class="rdf-file"
          data-testid="row-detail-file"
          @click="emit('file-click', field.filePath)"
        >📄 {{ field.value }}</button>
        <span v-else>{{ field.value }}</span>
      </div>
    </div>
    <div v-if="hiddenEmpty" class="rdf-hidden" data-testid="row-detail-hidden-hint">另有 {{ hiddenEmpty }} 个空字段已隐藏</div>
    <div v-else-if="!visibleFields.length" class="rdf-empty">没有已填字段</div>
  </div>
</template>

<style scoped>
.rdf-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.rdf-count { color: var(--rc-faint); font-size: 11px; }
.rdf-edit-hint { color: var(--rc-muted); font-size: 11px; }
.rdf-field { padding: 9px 0; border-bottom: 1px solid var(--rc-border-soft); }
.rdf-field.empty .rdf-value { color: var(--rc-faint); }
.rdf-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rdf-name { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.rdf-code { flex: none; color: var(--rc-faint); font-family: var(--rc-mono, monospace); font-size: 11px; }
.rdf-code-sep { opacity: .6; }
.rdf-col { color: var(--rc-text-2); font-weight: 600; }
.rdf-value { margin-top: 4px; color: var(--rc-text-2); font-size: 12px; line-height: 1.45; word-break: break-all; }
.rdf-link { color: var(--rc-primary); text-decoration: none; }
.rdf-link:hover { text-decoration: underline; }
.rdf-file { padding: 0; border: 0; background: none; color: var(--rc-primary); font-size: inherit; text-align: left; cursor: pointer; word-break: break-all; }
.rdf-file:hover { text-decoration: underline; }
.rdf-input { width: 100%; margin-top: 6px; border: 1px solid #dbe3ee; border-radius: 6px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 6px 8px; outline: none; }
.rdf-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rdf-empty, .rdf-hidden { padding: 16px 0; color: var(--rc-faint); font-size: 11px; text-align: center; }
</style>
