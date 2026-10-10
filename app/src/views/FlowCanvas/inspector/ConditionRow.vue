<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { CONDITION_OP_OPTIONS, conditionGroupLabel, conditionOpNeedsValue, type ConditionGroup, type ConditionOp, type EntryCondition } from '@/views/FlowCanvas/canvas/flowModel'
import { conditionsToExpr, parseConditionExpr } from '@/utils/flow/conditionExpr'

// 进入条件行编辑组件（0701 问题十·方案B；0706 优化·主题二升级为条件组；0707 优化·补加表达式模式）：
// 字段模式 = 多行 字段(下拉，来自输入表 schema) + 操作符 + 值，行间用 AND/OR 逻辑连接符组合；
// 表达式模式 = 裸文本框，写原始表达式（1:1 对应 Step.condition 契约），用于跨字段比较/函数调用等结构化三元组表达不了的场景；
// 两种模式二选一，不混用；本组件供节点级「进入条件」（NodeInspector）使用（决策节点的分支条件编辑器已于 1008-BR-06 去掉）。
const props = defineProps<{
  condition?: ConditionGroup
  fields: { prop: string; desc: string; columnName?: string }[]
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

// item.field 存的是下拉选中的 prop（业务标识/itemCode），真实表达式里用的是物理列名（K1/K2/...）——
// 两者不是一套命名空间，读写表达式时要来回换；换不到（字段还没加载，或像 NEXT_FLAG 这种运行时
// 标记根本不是表字段）就原样用标识符本身，不猜。
function columnOf(field: string): string {
  return props.fields.find((f) => f.prop === field)?.columnName || field
}
function propOf(column: string): string {
  return props.fields.find((f) => f.columnName === column)?.prop || column
}
function expressionOf(entries = items.value, joiner = logic.value): string {
  return conditionsToExpr(entries.map((item) => ({ ...item, field: columnOf(item.field) })), joiner)
}

function reinit(cond?: ConditionGroup) {
  active.value = !!cond
  mode.value = cond?.mode ?? 'fields'
  logic.value = cond?.logic ?? 'AND'
  items.value = cond ? cond.items.map((it) => ({ ...it })) : []
  expr.value = cond?.expr ?? (props.integrated ? expressionOf(items.value, logic.value) : '')

  // 迁移来的条件只有 expr（没有 items，见 flowModel.seeds 的 applyStepMetadata）——解析回字段行，
  // 让用户直接看到/编辑「正文路径 为空」。解析不了的自定义函数等仍保留原文。
  const parsed = props.integrated && cond?.expr && !cond.items.length ? parseConditionExpr(cond.expr) : null
  if (parsed) {
    logic.value = parsed.logic
    items.value = parsed.items.map((item) => ({ ...item, field: propOf(item.field) }))
    exprEdited.value = false // 改字段行时按真实语法重新生成；未改动前保留原文的空格写法
    return
  }
  const parsedExisting = props.integrated && cond?.expr ? parseConditionExpr(cond.expr) : null
  const matchesItems = parsedExisting && JSON.stringify(parsedExisting.items) === JSON.stringify(items.value.map((item) => ({ ...item, field: columnOf(item.field) })))
  exprEdited.value = Boolean(props.integrated && cond?.expr && cond.expr !== expressionOf(items.value, logic.value) && !matchesItems)
}
watch(() => props.condition, reinit, { deep: true, immediate: true })

// 表字段是异步加载的（entryDetail），解析时可能还没到——那会儿 K6 映射不到 prop，先原样存着列名。
// 字段到位后把这些还是列名的项换成 prop，下拉才能正确显示成「正文路径」而不是裸列名。
watch(() => props.fields, (fields) => {
  if (!fields.length) return
  const remapped = items.value.map((item) => {
    if (fields.some((f) => f.prop === item.field)) return item
    const match = fields.find((f) => f.columnName === item.field)
    return match ? { ...item, field: match.prop } : item
  })
  if (remapped.some((item, i) => item.field !== items.value[i].field)) items.value = remapped
})

function currentGroup(): ConditionGroup {
  if (props.integrated) return { mode: 'expr', logic: logic.value, items: items.value, expr: expr.value }
  return mode.value === 'expr'
    ? { mode: 'expr', logic: 'AND', items: [], expr: expr.value }
    : { mode: 'fields', logic: logic.value, items: items.value }
}
function commit() {
  emit('change', active.value ? currentGroup() : undefined)
}
/** 「添加条件」：整合模式下代替原来的勾选框（0828 D20） */
function activate() {
  active.value = true
  if (!items.value.length) {
    items.value = [{ field: props.fields[0]?.prop ?? '', op: 'contains', value: '' }]
  }
  expr.value = expressionOf()
  exprEdited.value = false
  commit()
}
/** 「移除」：清掉条件，等价于原来取消勾选 */
function deactivate() {
  active.value = false
  commit()
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
function updateItem(i: number, patch: Partial<EntryCondition>) {
  items.value = items.value.map((it, idx) => (idx === i ? { ...it, ...patch } : it))
  if (props.integrated && !exprEdited.value) expr.value = expressionOf()
  commit()
}
async function addItem() {
  // 一体化模式下，若当前表达式是迁移来的原始文本（无法拆成字段，见 reinit 的 exprEdited 判定），
  // 字段行加了也不会同步回表达式——点“+ 添加条件”看似在编辑同一个条件，实际完全脱节。
  // 先确认清楚：继续会放弃原始表达式、改由字段模式重新生成，避免误以为是在原表达式基础上追加。
  if (props.integrated && exprEdited.value && expr.value) {
    try {
      await ElMessageBox.confirm('当前是迁移来的原始表达式，无法直接在字段模式里编辑。继续将放弃原表达式，改由字段模式重新生成，是否继续？', '切换为字段模式', { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' })
    } catch {
      return
    }
    exprEdited.value = false
  }
  items.value = [...items.value, { field: props.fields[0]?.prop ?? '', op: 'contains', value: '', joinWith: logic.value }]
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

// 下拉选项 = 输入表字段 + 条件里出现过但不属于该表的标识符（如 NEXT_FLAG 这种运行时标记，
// 生产里真实存在）。不补进选项的话这些条件在下拉里显示为空白，看起来像"没选字段"。
const fieldOptions = computed(() => {
  const known = new Set(props.fields.map((f) => f.prop))
  const extras = [...new Set(items.value.map((item) => item.field).filter((f) => f && !known.has(f)))]
  return [...props.fields.map((f) => ({ prop: f.prop, desc: f.desc })), ...extras.map((prop) => ({ prop, desc: '表外标识' }))]
})
const summary = computed(() => conditionGroupLabel(active.value ? currentGroup() : undefined, fieldDescOf))
</script>

<template>
  <div class="cond-row">
    <!-- 整合模式（节点上的进入条件，0828 D20）：不摆勾选框，直接一个「添加条件」按钮。
         会上原话「把这个去掉，比如添加条件不就行了吗」——勾选框 + 「进入条件」标签是多余的一层。
         非整合模式（原供决策节点的分支条件用）保留勾选框写法。 -->
    <button
      v-if="integrated && !active"
      class="cond-add cond-add-entry"
      type="button"
      data-testid="add-entry-condition"
      @click="activate"
    >+ 添加条件</button>
    <label v-else-if="!integrated" class="cond-toggle"><input type="checkbox" :checked="active" @change="toggle" /> 进入条件</label>
    <template v-if="active">
      <div v-if="integrated" class="cond-head">
        <span class="cond-head-title">进入条件</span>
        <button class="cond-clear" type="button" data-testid="clear-entry-condition" @click="deactivate">移除</button>
      </div>
      <div v-if="!integrated" class="cond-mode">
        <button type="button" :class="{ active: mode === 'fields' }" @click="onModeChange('fields')">字段模式</button>
        <button type="button" :class="{ active: mode === 'expr' }" @click="onModeChange('expr')">表达式模式</button>
      </div>
      <template v-if="integrated || mode === 'fields'">
        <template v-for="(item, i) in items" :key="i">
        <div v-if="i > 0" class="cond-logic" :aria-label="`第 ${i + 1} 条条件的连接方式`">
          <button type="button" :class="{ active: (item.joinWith ?? logic) === 'AND' }" @click="updateItem(i, { joinWith: 'AND' })">且 AND</button>
          <button type="button" :class="{ active: (item.joinWith ?? logic) === 'OR' }" @click="updateItem(i, { joinWith: 'OR' })">或 OR</button>
        </div>
        <div class="cond-fields">
          <select class="rc-select" :value="item.field" @change="updateItem(i, { field: ($event.target as HTMLSelectElement).value })">
            <option value="">选择字段</option>
            <option v-for="f in fieldOptions" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
          </select>
          <select class="rc-select" :value="item.op" @change="updateItem(i, { op: ($event.target as HTMLSelectElement).value as ConditionOp })">
            <option v-for="o in CONDITION_OP_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <input v-if="conditionOpNeedsValue(item.op)" class="rc-input" :value="item.value" placeholder="值" @input="updateItem(i, { value: ($event.target as HTMLInputElement).value })" />
          <button v-if="items.length > 1" class="cond-del" type="button" title="删除该条件" @click="removeItem(i)">✕</button>
        </div>
        </template>
        <button class="cond-add" type="button" @click="addItem">+ 添加条件</button>
      </template>
      <template v-if="integrated || mode === 'expr'">
        <label v-if="integrated" class="cond-expr-label">表达式（可编辑）</label>
        <textarea
          class="rc-input cond-expr"
          :value="expr"
          placeholder="写原始表达式，如 K17 != nil &amp;&amp; !string.contains(K2,'weixin.qq')"
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
.cond-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.cond-head-title { color: var(--rc-muted); font-size: 11px; }
.cond-clear { border: 0; background: transparent; color: var(--rc-faint); font-size: 11px; cursor: pointer; padding: 0; }
.cond-clear:hover { color: #b91c1c; }
.cond-add-entry { margin-bottom: 0; }
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
