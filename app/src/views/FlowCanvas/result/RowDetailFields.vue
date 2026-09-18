<script setup lang="ts">
import { computed } from 'vue'
import { copyToClipboard } from '@/utils/clipboard'
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
  /**
   * 点文件路径预览。**必须把字段一起带出去**（2026-09-18）：调用方靠列名/字段名判断
   * 该用哪种预览器，而公众号正文路径这类值在路径上没有后缀（K9/URLMD5，
   * `/gzh/gzh_msg/…/d0bc4a04…`），只给 path 的话预览器认不出类型，只能显示"不支持解析"。
   * 形状与 DataGrid 的同名事件对齐，两条入口共用调用方的同一个 handler。
   */
  'file-click': [path: string, field: { prop?: string; columnName?: string; desc?: string }]
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

function onCopy(value: string, name?: string) {
  void copyToClipboard(value, name)
}

function onCopyAll() {
  const result: Record<string, string> = {}
  for (const f of visibleFields.value) {
    if (!f.empty && f.value) {
      result[f.prop || f.code] = f.value
    }
  }
  void copyToClipboard(JSON.stringify(result, null, 2), 'JSON')
}
</script>

<template>
  <div class="rdf" :class="{ compact }">
    <div v-if="fields.length" class="rdf-toolbar">
      <div class="rdf-toolbar-left">
        <span class="rdf-count">已填 {{ filledCount }} / {{ scopedFields.length }}</span>
        <span v-if="editing" class="rdf-edit-hint">编辑时展示全部字段</span>
      </div>
      <button
        v-if="!editing && filledCount > 0"
        type="button"
        class="rdf-copy-all"
        data-testid="row-detail-copy-all"
        title="复制当前所有字段为 JSON"
        @click="onCopyAll"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
          />
        </svg>
        <span>复制全部 JSON</span>
      </button>
    </div>
    <div
      v-for="field in visibleFields"
      :key="field.key"
      class="rdf-field"
      :class="{ empty: field.empty }"
      :data-testid="`row-detail-field-${field.prop}`"
    >
      <div class="rdf-field-head">
        <div class="rdf-name-wrap">
          <span class="rdf-name">{{ field.name }}</span>
          <button
            v-if="!editing && field.value && !field.empty"
            type="button"
            class="rdf-copy"
            data-testid="row-detail-copy"
            :title="`复制 ${field.name}`"
            @click.stop="onCopy(field.value, field.name)"
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M5.5 2.5h6a1 1 0 0 1 1 1v6M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1 1-1Z"
                fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
        <!-- 右侧字段标识：prop · K1（2026-09-09）。K 名单独着色并加粗一档——
             写 SQL 条件、配规则用的都是物理列名，prop 只是逻辑名，可操作的那个要更醒目。
             没有 columnName 的字段（固定列、旧 showItems 路径）只显示 code，不留空分隔点。 -->
        <span class="rdf-code">
          {{ field.code }}<template v-if="field.columnName && field.columnName !== field.code"><span class="rdf-code-sep"> · </span><span class="rdf-col">{{ field.columnName }}</span></template>
        </span>
      </div>
      <input
        v-if="editing && field.prop !== 'ENTRY_ID'"
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
          @click="emit('file-click', field.filePath, { prop: field.prop, columnName: field.columnName, desc: field.name })"
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
.rdf-toolbar-left { display: flex; align-items: center; gap: 8px; }
.rdf-count { color: var(--rc-faint); font-size: 11px; }
.rdf-edit-hint { color: var(--rc-muted); font-size: 11px; }
.rdf-copy-all {
  border: 1px solid var(--rc-border-soft);
  background: #fff;
  color: var(--rc-text-2);
  font-size: 11px;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all .15s;
}
.rdf-copy-all:hover {
  border-color: #bfdbfe;
  background: var(--rc-primary-bg);
  color: var(--rc-primary-ink);
}
.rdf-field { padding: 9px 0; border-bottom: 1px solid var(--rc-border-soft); }
.rdf-field.empty .rdf-value { color: var(--rc-faint); }
.rdf-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.rdf-name-wrap { display: inline-flex; align-items: center; gap: 6px; }
.rdf-name { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.rdf-copy {
  border: 0;
  background: transparent;
  color: var(--rc-faint);
  padding: 2px 3px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.45;
  transition: opacity .12s, color .12s, background-color .12s;
}
.rdf-field:hover .rdf-copy { opacity: 1; }
.rdf-copy:hover { color: var(--rc-primary); background: var(--rc-primary-bg); }
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
