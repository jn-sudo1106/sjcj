<script setup lang="ts">
// 副表输出分组（1106 W5）：单表/多表开关切到「多表」后显示。
// 口径见 设计稿/设计方案/1105-单表多表输出开关_开发设计方案_2026-11-06.md（v5）：
//   副表 = 上方输出表的直接子表，最多 1 张；用户只做「选副表 + 勾字段」，
//   keys / colMap / pCol 按既有配置与字段 code 同名自动生成，对不上时进「高级」兜底。
import { computed, ref, watch } from 'vue'
import { entryApi, type EntryField, type EntryType } from '@/api'
import {
  columnCodeOf, outputModeOfConfig, readOutputTableConfig, subTableOf, withSubTable,
  type OutputTableDefinition,
} from '@/utils/flow/multiTableOutput'
import MultiTableOutputEditor from './MultiTableOutputEditor.vue'

const props = defineProps<{ modelValue: string; mainTableId: string; tables: EntryType[] }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const parsed = computed(() => readOutputTableConfig(props.modelValue))
const config = computed(() => parsed.value.config)
const root = computed(() => config.value?.table)
const sub = computed(() => subTableOf(config.value))
const mode = computed(() => outputModeOfConfig(config.value))
const overflow = computed(() => mode.value === 'overflow')
const hint = ref('')
const picking = ref(false)

const subMeta = ref<EntryType>()
const mainMeta = ref<EntryType>()
watch(() => sub.value?.entryTypeId, async (tableId) => {
  if (!tableId) { subMeta.value = undefined; return }
  const cached = props.tables.find((table) => table.tableId === String(tableId) && table.fields.length)
  subMeta.value = cached
  if (cached) return
  try { subMeta.value = await entryApi.entryDetail(String(tableId)) } catch { /* 字段加载失败时只标表名，高级里可重试 */ }
}, { immediate: true })
watch(() => props.mainTableId, async (tableId) => {
  if (!tableId) { mainMeta.value = undefined; return }
  const cached = props.tables.find((table) => table.tableId === tableId && table.fields.length)
  mainMeta.value = cached
  if (cached) return
  try { mainMeta.value = await entryApi.entryDetail(tableId) } catch { /* 同上 */ }
}, { immediate: true })

const mainFields = computed<EntryField[]>(() => mainMeta.value?.fields ?? props.tables.find((table) => table.tableId === props.mainTableId)?.fields ?? [])
const subFields = computed<EntryField[]>(() => (subMeta.value?.fields ?? []).filter((field) => field.itemId))
const subLabel = computed(() => {
  const tableId = String(sub.value?.entryTypeId ?? '')
  const table = props.tables.find((item) => item.tableId === tableId) ?? subMeta.value
  return table ? `${table.name || table.tableName} · ${tableId}` : `数据表 #${tableId}`
})
const fieldLabel = (field: EntryField) => `${field.desc || field.prop}${field.columnName ? `（${field.columnName}）` : ''}`

/** 主表里同 code 的字段 prop：作为副表字段的取值来源（fromId）。 */
function sourceOf(field: EntryField): string | undefined {
  const code = columnCodeOf(field)
  if (!code) return undefined
  const matched = mainFields.value.find((item) => columnCodeOf(item) === code)
  return matched?.prop
}
const isSelected = (field: EntryField) => !!sub.value?.colMap.some((row) => row.colId === String(field.itemId))
const selectedCount = computed(() => subFields.value.filter(isSelected).length)
const unmatchedCount = computed(() => subFields.value.filter((field) => !isSelected(field) && !sourceOf(field)).length)

// 副表候选：本页已加载的表 + 远程搜索；主表自身 disabled（不能作为副表）。
const searchResults = ref<EntryType[]>([])
const searching = ref(false)
let searchSeq = 0
async function searchTables(keyword: string) {
  const seq = ++searchSeq
  searching.value = true
  try {
    const list = await entryApi.searchTables(keyword, 30)
    if (seq === searchSeq) searchResults.value = list
  } catch (error) {
    if (seq === searchSeq) hint.value = `搜索表失败：${(error as Error).message}`
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}
const options = computed<EntryType[]>(() => {
  const list = [...searchResults.value, ...props.tables]
  if (subMeta.value && !list.some((table) => table.tableId === subMeta.value!.tableId)) list.unshift(subMeta.value)
  const seen = new Set<string>()
  return list.filter((table) => {
    if (seen.has(table.tableId)) return false
    seen.add(table.tableId)
    return true
  })
})
function optionLabel(table: EntryType) {
  const label = `${table.name || table.tableName} · ${table.tableId}`
  return table.tableId === props.mainTableId ? `${label}（同主表输出表，不能作为副表）` : label
}

function write(next: OutputTableDefinition | undefined, fallbackHint = '') {
  if (!config.value) return
  hint.value = fallbackHint
  emit('update:modelValue', withSubTable(config.value, next))
}

function createSub(tableId: string) {
  if (!root.value) {
    hint.value = '当前步骤还没有结果分组与字段映射，请先在「高级」里配置主表映射，再选择副表。'
    return
  }
  write({
    entryTypeId: Number(tableId),
    keys: [...root.value.keys],
    colMap: [],
  })
}

function onPick(tableId: string) {
  if (!tableId) return
  const value = String(tableId)
  if (value === props.mainTableId) {
    hint.value = '副表不能与主表相同，请重新选择。'
    picking.value = false
    return
  }
  if (sub.value) {
    // 已配置 1 张：先移除再更换（与设计稿 §3.4 一致，避免悄悄替换丢映射）。
    hint.value = `已配置「${subLabel.value}」，最多 1 张副表。请先移除再更换。`
    picking.value = false
    return
  }
  createSub(value)
}

function removeSub() {
  picking.value = false
  write(undefined, '')
}

function toggleField(field: EntryField) {
  if (!sub.value) return
  if (isSelected(field)) {
    write({ ...sub.value, colMap: sub.value.colMap.filter((row) => row.colId !== String(field.itemId)) }, '')
    return
  }
  const fromId = sourceOf(field)
  if (!fromId) {
    hint.value = `「${fieldLabel(field)}」在主表里没有同名列，需在「高级」里手工指定取值字段。`
    return
  }
  write({ ...sub.value, colMap: [...sub.value.colMap, { colId: String(field.itemId), fromId }] }, '')
}

function selectAllFields() {
  if (!sub.value) return
  const rows = subFields.value
    .map((field) => ({ field, fromId: sourceOf(field) }))
    .filter((item): item is { field: EntryField; fromId: string } => !!item.fromId)
    .map((item) => ({ colId: String(item.field.itemId), fromId: item.fromId }))
  write({ ...sub.value, colMap: rows }, unmatchedCount.value ? '部分字段在主表里没有同名列，未加入映射；可到「高级」手工指定。' : '')
}

function clearFields() {
  if (!sub.value) return
  write({ ...sub.value, colMap: [] }, '')
}

const advancedOpen = ref(false)
</script>

<template>
  <section class="stg" aria-label="副表输出" data-testid="sub-table-group">
    <div class="stg-head">
      <span class="stg-title">副表</span>
      <span class="stg-badge">{{ overflow ? '最多 1 张' : '主表记录下自动挂父子关系' }}</span>
    </div>

    <p v-if="parsed.error" class="stg-hint">{{ parsed.error }}</p>
    <template v-else-if="overflow">
      <p class="stg-warn" data-testid="sub-table-overflow">
        当前已配置 2 张以上副表，这个页面只支持主表 + 1 张副表。可继续使用高级配置维护，保存不会改动原配置。
      </p>
    </template>
    <template v-else-if="!root">
      <p class="stg-hint" data-testid="sub-table-needs-main">当前步骤还没有结果分组与字段映射，请先在「高级」里配置主表映射，再选择副表。</p>
    </template>
    <template v-else>
      <div class="stg-field">
        <div class="stg-label-row">
          <label>输出表</label>
          <span v-if="sub" class="stg-actions">
            <button type="button" class="rc-text-btn" data-testid="change-sub-type" @click="picking = true">更换</button>
            <button type="button" class="rc-text-btn" data-testid="remove-sub-table" @click="removeSub">移除</button>
          </span>
        </div>
        <div v-if="sub && !picking" class="stg-current" data-testid="sub-table-current">{{ subLabel }}</div>
        <el-select
          v-else :model-value="''" filterable remote reserve-keyword :remote-method="searchTables" :loading="searching"
          placeholder="＋ 选择副表" data-testid="sub-output-table" class="stg-select"
          @update:model-value="onPick" @visible-change="(open: boolean) => { if (open && !searchResults.length) searchResults = [...props.tables] }"
        >
          <el-option v-for="table in options" :key="table.tableId" :label="optionLabel(table)" :value="table.tableId" :disabled="table.tableId === mainTableId" />
        </el-select>
      </div>

      <template v-if="sub && !picking">
        <div class="stg-field">
          <div class="stg-label-row">
            <label>输出字段选择（已选中 {{ selectedCount }} / {{ subFields.length }} 个字段，不选默认全部字段）</label>
            <span class="stg-actions">
              <button type="button" class="rc-text-btn" data-testid="sub-select-all-fields" @click="selectAllFields">全选</button>
              <button type="button" class="rc-text-btn" data-testid="sub-clear-all-fields" @click="clearFields">清空</button>
            </span>
          </div>
          <div class="rc-tag-row" data-testid="sub-output-fields-list">
            <span
              v-for="field in subFields" :key="field.itemId" class="rc-tag"
              :class="{ on: isSelected(field), pending: !isSelected(field) && !sourceOf(field) }"
              @click="toggleField(field)"
            >
              <input type="checkbox" :checked="isSelected(field)" class="rc-tag-check" @click.stop="toggleField(field)" />
              <span class="rc-tag-text">{{ field.prop }} {{ field.desc ? `· ${field.desc}` : '' }}</span>
              <span v-if="!isSelected(field) && !sourceOf(field)" class="stg-pending">待对应</span>
            </span>
          </div>
          <div class="rc-help">取值按字段 code 自动对应采集结果，不需要逐个配映射。</div>
        </div>
        <div v-if="hint" class="stg-warn" role="status" data-testid="sub-table-hint">{{ hint }}</div>
        <details class="stg-advanced" :open="advancedOpen" @toggle="advancedOpen = ($event.target as HTMLDetailsElement).open">
          <summary data-testid="sub-advanced-toggle">▸ 高级：结果分组 / 手工字段映射 / 关联字段</summary>
          <MultiTableOutputEditor
            :key="`${sub.entryTypeId}-${modelValue}`" :model-value="modelValue" :main-table-id="mainTableId" :tables="tables"
            :max-subs="1" @update:model-value="emit('update:modelValue', $event)"
          />
        </details>
      </template>
    </template>
    <p v-if="hint && (overflow || !root)" class="stg-warn" role="status" data-testid="sub-table-hint">{{ hint }}</p>
  </section>
</template>

<style scoped>
.stg { margin: 10px 0 12px; padding: 10px 12px 12px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fbfdff; }
.stg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.stg-title { font-weight: 700; color: var(--rc-text); }
.stg-badge { font-size: 10px; color: var(--rc-faint); }
.stg-field { margin-top: 8px; }
.stg-label-row { display: flex; align-items: center; gap: 8px; }
.stg-label-row > label { flex: 1; min-width: 0; }
.stg-actions { display: inline-flex; gap: 8px; }
.stg-current { margin-top: 4px; padding: 7px 9px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text); overflow-wrap: anywhere; }
.stg-select { width: 100%; margin-top: 4px; }
.stg-select :deep(.el-select__wrapper) { min-height: 30px; border-radius: 6px; font-size: 11px; }
.stg-hint { margin: 4px 0 0; font-size: 10px; color: var(--rc-faint); line-height: 1.6; }
.stg-warn { margin: 6px 0 0; font-size: 11px; color: var(--rc-warn); line-height: 1.6; }
.stg-pending { margin-left: 4px; font-size: 10px; color: var(--rc-warn); }
.stg-advanced { margin-top: 8px; }
.stg-advanced > summary { cursor: pointer; font-size: 10px; color: var(--rc-muted); list-style: none; }
.stg-advanced > summary::-webkit-details-marker { display: none; }
.rc-tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.rc-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border: 1px solid #d5e2f2; border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-size: 11px; cursor: pointer; user-select: none; transition: all 0.12s ease; }
.rc-tag:hover { border-color: #93c5fd; background: #eff6ff; }
.rc-tag.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 600; }
.rc-tag-check { margin: 0; cursor: pointer; accent-color: var(--rc-primary); }
.rc-tag.pending { border-style: dashed; color: var(--rc-faint); }
.rc-tag.pending:hover { border-color: #fcd34d; background: #fffbeb; }
.rc-text-btn { padding: 0; border: 0; background: transparent; color: var(--rc-primary); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; }
.rc-text-btn:hover { text-decoration: underline; }
.rc-help { margin-top: 4px; font-size: 10px; color: var(--rc-faint); line-height: 1.6; }
</style>