<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CONDITION_OP_OPTIONS, conditionGroupLabel, type ConditionGroup, type ConditionOp, type EntryCondition } from './flowModel'

// 进入条件行编辑组件（0701 问题十·方案B；0706 优化·主题二升级为条件组；0707 优化·补加表达式模式）：
// 字段模式 = 多行 字段(下拉，来自输入表 schema) + 操作符 + 值，行间用 AND/OR 逻辑连接符组合；
// 表达式模式 = 裸文本框，写原始表达式（1:1 对应 Step.condition 契约），用于跨字段比较/函数调用等结构化三元组表达不了的场景；
// 两种模式二选一，不混用；本组件同时供节点级「进入条件」（NodeInspector）与分支条件（BranchEditor）复用。
const props = defineProps<{
  condition?: ConditionGroup
  fields: { prop: string; desc: string }[]
  /** 节点进入条件采用一体化编辑：字段选择自动生成下方可编辑表达式。 */
  integrated?: boolean
}>()
const emit = defineEmits<{ change: [cond: ConditionGroup | undefined] }>()

const active = ref(false)
const mode = ref<'fields' | 'expr'>('fields')
const items = ref<EntryCondition[]>([])
const logic = ref<'AND' | 'OR'>('AND')
const expr = ref('')
const exprEdited = ref(false)

function expressionOf(entries = items.value, joiner = logic.value): string {
  const parts = entries
    .filter((item) => item.field)
    .map((item) => {
      if (item.op === 'notEmpty') return `${item.field} IS NOT EMPTY`
      const op = { contains: 'CONTAINS', eq: '=', ne: '!=', gt: '>', lt: '<' }[item.op]
      return `${item.field} ${op} "${item.value}"`
    })
  return parts.join(` ${joiner} `)
}

function reinit(cond?: ConditionGroup) {
  active.value = !!cond
  mode.value = cond?.mode ?? 'fields'
  logic.value = cond?.logic ?? 'AND'
  items.value = cond ? cond.items.map((it) => ({ ...it })) : []
  expr.value = cond?.expr ?? (props.integrated ? expressionOf(items.value, logic.value) : '')
  exprEdited.value = Boolean(props.integrated && cond?.expr && cond.expr !== expressionOf(items.value, logic.value))
}
watch(() => props.condition, reinit, { deep: true, immediate: true })

function currentGroup(): ConditionGroup {
  if (props.integrated) return { mode: 'expr', logic: logic.value, items: items.value, expr: expr.value }
  return mode.value === 'expr'
    ? { mode: 'expr', logic: 'AND', items: [], expr: expr.value }
    : { mode: 'fields', logic: logic.value, items: items.value }
}
function commit() {
  emit('change', active.value ? currentGroup() : undefined)
}
function toggle(e: Event) {
  if ((e.target as HTMLInputElement).checked) {
    active.value = true
    if (mode.value === 'fields' && !items.value.length) {
      items.value = [{ field: props.fields[0]?.prop ?? '', op: 'contains', value: '' }]
    }
    if (props.integrated) {
      expr.value = expressionOf()
      exprEdited.value = false
    }
  } else {
    active.value = false
  }
  commit()
}
function onModeChange(m: 'fields' | 'expr') {
  mode.value = m
  if (m === 'fields' && !items.value.length) {
    items.value = [{ field: props.fields[0]?.prop ?? '', op: 'contains', value: '' }]
  }
  commit()
}
function onLogic(l: 'AND' | 'OR') {
  logic.value = l
  if (props.integrated && !exprEdited.value) expr.value = expressionOf(items.value, l)
  commit()
}
function updateItem(i: number, patch: Partial<EntryCondition>) {
  items.value = items.value.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
  if (props.integrated && !exprEdited.value) expr.value = expressionOf()
  commit()
}
function addItem() {
  items.value = [...items.value, { field: props.fields[0]?.prop ?? '', op: 'contains', value: '' }]
  if (props.integrated && !exprEdited.value) expr.value = expressionOf()
  commit()
}
function removeItem(i: number) {
  items.value = items.value.filter((_, idx) => idx !== i)
  if (props.integrated && !exprEdited.value) expr.value = expressionOf()
  commit()
}
function onExprInput(e: Event) {
  expr.value = (e.target as HTMLTextAreaElement).value
  exprEdited.value = true
  commit()
}
function fieldDescOf(field: string) {
  return props.fields.find((f) => f.prop === field)?.desc
}
const summary = computed(() => conditionGroupLabel(active.value ? currentGroup() : undefined, fieldDescOf))
</script>

<template>
  <div class="cond-row">
    <label class="cond-toggle"><input type="checkbox" :checked="active" @change="toggle" /> 进入条件</label>
    <template v-if="active">
      <div v-if="!integrated" class="cond-mode">
        <button type="button" :class="{ active: mode === 'fields' }" @click="onModeChange('fields')">字段模式</button>
        <button type="button" :class="{ active: mode === 'expr' }" @click="onModeChange('expr')">表达式模式</button>
      </div>
      <template v-if="integrated || mode === 'fields'">
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
      </template>
      <template v-if="integrated || mode === 'expr'">
        <label v-if="integrated" class="cond-expr-label">表达式（可编辑）</label>
        <textarea
          class="rc-input cond-expr"
          :value="expr"
          placeholder='写原始表达式，如 status = "C" AND quality_score >= 0.95'
          rows="3"
          @input="onExprInput"
        />
        <div class="cond-expr-hint">{{ integrated ? '选择字段、运算符和值后会自动生成表达式；支持继续手工编辑。' : '表达式模式不做语法校验，原样存储、原样透传给执行侧解析。' }}</div>
      </template>
      <div v-if="summary" class="cond-summary">本节点仅处理满足「{{ summary }}」的行，其余数据不处理</div>
    </template>
  </div>
</template>

<style scoped>
.cond-row { margin-bottom: 10px; }
.cond-toggle { display: flex; align-items: center; gap: 6px; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; cursor: pointer; }
.cond-mode { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; margin-bottom: 6px; }
.cond-mode button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 4px 10px; font-size: 11px; cursor: pointer; }
.cond-mode button:first-child { border-left: 0; }
.cond-mode button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.cond-logic { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; margin-bottom: 6px; }
.cond-logic button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 4px 10px; font-size: 11px; cursor: pointer; }
.cond-logic button:first-child { border-left: 0; }
.cond-logic button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.cond-fields { display: grid; grid-template-columns: 1.4fr 0.9fr 1fr auto; gap: 6px; margin-bottom: 6px; align-items: center; }
.cond-del { width: 24px; height: 24px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.cond-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.cond-add { border: 1px dashed #dbe3ee; background: #fff; color: var(--rc-primary); border-radius: 7px; font-size: 11px; padding: 5px 9px; cursor: pointer; margin-bottom: 4px; }
.cond-add:hover { border-color: var(--rc-primary); background: var(--rc-primary-bg); }
.cond-expr { font-family: var(--rc-mono, monospace); resize: vertical; margin-bottom: 4px; }
.cond-expr-label { display: block; margin: 6px 0 4px; color: var(--rc-muted); font-size: 11px; }
.cond-expr-hint { font-size: 10px; color: var(--rc-faint); margin-bottom: 4px; }
.cond-summary { margin-top: 5px; color: var(--rc-faint); font-size: 11px; line-height: 1.5; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
</style>
