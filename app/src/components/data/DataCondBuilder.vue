<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  COND_OPS,
  compileCond,
  fieldLabel,
  parseCond,
  type CondField,
  type CondRow,
} from './condCompile'

const props = defineProps<{
  modelValue: string
  fields: CondField[]
}>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const advanced = ref(false)
const joiner = ref<'AND' | 'OR'>('AND')
const rows = ref<CondRow[]>([{ field: '', op: '=', value: '' }])
const parseFailed = ref(false)
const sqlDraft = ref(props.modelValue)

watch(() => props.modelValue, (sql) => {
  if (advanced.value) {
    sqlDraft.value = sql
    return
  }
  applyParsed(sql)
}, { immediate: true })

function applyParsed(sql: string) {
  const parsed = parseCond(sql, props.fields)
  if (!parsed) {
    parseFailed.value = true
    advanced.value = true
    sqlDraft.value = sql
    return
  }
  parseFailed.value = false
  joiner.value = parsed.joiner
  rows.value = parsed.rows.length ? parsed.rows : [{ field: '', op: '=', value: '' }]
}

function emitCompiled() {
  emit('update:modelValue', compileCond(rows.value, joiner.value, props.fields))
}

watch(rows, () => emitCompiled(), { deep: true })
watch(joiner, () => emitCompiled())

function addRow() {
  rows.value = [...rows.value, { field: '', op: '=', value: '' }]
}
function removeRow(index: number) {
  rows.value = rows.value.filter((_, i) => i !== index)
  if (!rows.value.length) rows.value = [{ field: '', op: '=', value: '' }]
}

function enterAdvanced() {
  sqlDraft.value = compileCond(rows.value, joiner.value, props.fields) || props.modelValue
  advanced.value = true
}
function leaveAdvanced() {
  const parsed = parseCond(sqlDraft.value, props.fields)
  if (!parsed) {
    parseFailed.value = true
    return
  }
  parseFailed.value = false
  advanced.value = false
  joiner.value = parsed.joiner
  rows.value = parsed.rows
  emit('update:modelValue', sqlDraft.value)
}

function onSqlInput(event: Event) {
  sqlDraft.value = (event.target as HTMLInputElement).value
  emit('update:modelValue', sqlDraft.value)
}

function needsValue(op: string) {
  return COND_OPS.find((item) => item.value === op)?.needsValue !== false
}
</script>

<template>
  <div class="dcb" data-testid="data-cond-builder">
    <div class="dcb-toolbar">
      <button
        class="dcb-mode"
        type="button"
        data-testid="data-cond-advanced"
        :class="{ on: advanced }"
        @click="advanced ? leaveAdvanced() : enterAdvanced()"
      >{{ advanced ? '构造器' : '高级' }}</button>
      <template v-if="!advanced">
        <button class="dcb-join" type="button" data-testid="data-cond-joiner" @click="joiner = joiner === 'AND' ? 'OR' : 'AND'">
          {{ joiner }}
        </button>
        <button class="dcb-add" type="button" data-testid="data-cond-add" @click="addRow">+ 条件</button>
      </template>
      <span v-if="parseFailed" class="dcb-warn">当前 SQL 无法解析成构造器，请先改成合法条件</span>
    </div>
    <div v-if="advanced">
      <input
        class="dcb-sql"
        data-testid="data-cond-sql"
        :value="sqlDraft"
        placeholder="SQL 条件，如 K1 LIKE '%金融%'"
        @input="onSqlInput"
      />
    </div>
    <div v-else class="dcb-rows">
      <div v-for="(row, index) in rows" :key="index" class="dcb-row">
        <select v-model="row.field" data-testid="data-cond-field">
          <option value="">字段</option>
          <option v-for="field in fields" :key="field.prop" :value="field.prop">{{ fieldLabel(field) }}</option>
        </select>
        <select v-model="row.op" data-testid="data-cond-op">
          <option v-for="op in COND_OPS" :key="op.value" :value="op.value">{{ op.label }}</option>
        </select>
        <input
          v-if="needsValue(row.op)"
          v-model="row.value"
          data-testid="data-cond-value"
          placeholder="值"
        />
        <button type="button" class="dcb-del" :data-testid="`data-cond-del-${index}`" @click="removeRow(index)">×</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dcb { display: grid; gap: 6px; min-width: 0; flex: 1; }
.dcb-toolbar { display: flex; align-items: center; gap: 6px; }
.dcb-mode, .dcb-join, .dcb-add { height: 24px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.dcb-mode.on { border-color: var(--rc-primary); color: var(--rc-primary); }
.dcb-warn { color: #9a3412; font-size: 11px; }
.dcb-sql, .dcb-row select, .dcb-row input { height: 30px; padding: 0 8px; border: 1px solid #dbe3ee; border-radius: 6px; color: var(--rc-text); font-size: 12px; }
.dcb-sql { width: 100%; }
.dcb-rows { display: grid; gap: 4px; }
.dcb-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.dcb-row select { min-width: 92px; }
.dcb-row input { min-width: 0; flex: 1; }
.dcb-del { width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: var(--rc-faint); cursor: pointer; }
</style>
