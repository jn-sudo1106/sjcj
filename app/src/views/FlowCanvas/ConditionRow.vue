<script setup lang="ts">
import { computed } from 'vue'
import { CONDITION_OP_OPTIONS, conditionGroupLabel, type ConditionGroup, type ConditionOp, type EntryCondition } from './flowModel'

// 进入条件行编辑组件（0701 问题十·方案B；0706 优化·主题二升级为条件组）：
// 多行 字段(下拉，来自输入表 schema) + 操作符 + 值，行间用 AND/OR 逻辑连接符组合。
// 任务触发条件、入库校验条件等场景复用同一组件（0706 条件表达式统一规范）。
const props = defineProps<{
  condition?: ConditionGroup
  fields: { prop: string; desc: string }[]
}>()
const emit = defineEmits<{ change: [cond: ConditionGroup | undefined] }>()

const items = computed(() => props.condition?.items ?? [])
const enabled = computed(() => items.value.length > 0)
const logic = computed(() => props.condition?.logic ?? 'AND')

function emitItems(next: EntryCondition[], nextLogic?: 'AND' | 'OR') {
  if (!next.length) emit('change', undefined)
  else emit('change', { logic: nextLogic ?? logic.value, items: next })
}
function toggle(e: Event) {
  if ((e.target as HTMLInputElement).checked) emitItems([{ field: props.fields[0]?.prop ?? '', op: 'contains', value: '' }])
  else emit('change', undefined)
}
function onLogic(l: 'AND' | 'OR') {
  emitItems(items.value, l)
}
function updateItem(i: number, patch: Partial<EntryCondition>) {
  emitItems(items.value.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
}
function addItem() {
  emitItems([...items.value, { field: props.fields[0]?.prop ?? '', op: 'contains', value: '' }])
}
function removeItem(i: number) {
  emitItems(items.value.filter((_, idx) => idx !== i))
}
function fieldDescOf(field: string) {
  return props.fields.find((f) => f.prop === field)?.desc
}
const summary = computed(() => conditionGroupLabel(props.condition, fieldDescOf))
</script>

<template>
  <div class="cond-row">
    <label class="cond-toggle"><input type="checkbox" :checked="enabled" @change="toggle" /> 进入条件</label>
    <template v-if="enabled">
      <div v-if="items.length > 1" class="cond-logic">
        <button type="button" :class="{ active: logic === 'AND' }" @click="onLogic('AND')">且 AND</button>
        <button type="button" :class="{ active: logic === 'OR' }" @click="onLogic('OR')">或 OR</button>
      </div>
      <div v-for="(item, i) in items" :key="i" class="cond-fields">
        <select class="rc-select" :value="item.field" @change="updateItem(i, { field: ($event.target as HTMLSelectElement).value })">
          <option value="">选择字段</option>
          <option v-for="f in fields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
        </select>
        <select class="rc-select" :value="item.op" @change="updateItem(i, { op: ($event.target as HTMLSelectElement).value as ConditionOp })">
          <option v-for="o in CONDITION_OP_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input v-if="item.op !== 'notEmpty'" class="rc-input" :value="item.value" placeholder="值" @input="updateItem(i, { value: ($event.target as HTMLInputElement).value })" />
        <button v-if="items.length > 1" class="cond-del" type="button" title="删除该条件" @click="removeItem(i)">✕</button>
      </div>
      <button class="cond-add" type="button" @click="addItem">+ 添加条件</button>
      <div v-if="summary" class="cond-summary">本节点仅处理满足「{{ summary }}」的行，其余数据不处理</div>
    </template>
  </div>
</template>

<style scoped>
.cond-row { margin-bottom: 10px; }
.cond-toggle { display: flex; align-items: center; gap: 6px; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; cursor: pointer; }
.cond-logic { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; margin-bottom: 6px; }
.cond-logic button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 4px 10px; font-size: 11px; cursor: pointer; }
.cond-logic button:first-child { border-left: 0; }
.cond-logic button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.cond-fields { display: grid; grid-template-columns: 1.4fr 0.9fr 1fr auto; gap: 6px; margin-bottom: 6px; align-items: center; }
.cond-del { width: 24px; height: 24px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.cond-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.cond-add { border: 1px dashed #dbe3ee; background: #fff; color: var(--rc-primary); border-radius: 7px; font-size: 11px; padding: 5px 9px; cursor: pointer; margin-bottom: 4px; }
.cond-add:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.cond-summary { margin-top: 5px; color: var(--rc-faint); font-size: 11px; line-height: 1.5; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
