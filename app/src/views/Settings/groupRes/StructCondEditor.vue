<script setup lang="ts">
// 数据权限规则 → STRUCT 结构化条件行编辑器（多行 AND）。
//
// 契约：condJson = [{ field, op, values }]，字段/操作符/值控件全部由 meta 的 fields 驱动
// （field 白名单、ops、type、valueFrom），组件内零硬编码列名。
// 值控件统一走 CondValueInput（按 valueFrom/type/是否 IN 分发到 picker 或原生控件）。
//
// 行内不做完整校验（保存时统一走 condItemsError + 后端 preview），这里只做联动收敛：
// 换字段重置 op/values，换 op 时非 IN 只保留第一个值。
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { GroupResCondItem, GroupResField } from '@/api/groupRes'
import CondValueInput from './CondValueInput.vue'

const props = defineProps<{
  modelValue: GroupResCondItem[]
  fields: GroupResField[]
}>()
const emit = defineEmits<{ 'update:modelValue': [items: GroupResCondItem[]] }>()

const items = computed(() => props.modelValue)

function metaOf(field: string): GroupResField | undefined {
  return props.fields.find((f) => f.field === field)
}

function emitItems(next: GroupResCondItem[]) {
  emit('update:modelValue', next)
}

function addRow() {
  const first = props.fields[0]
  emitItems([...items.value, { field: first?.field ?? '', op: first?.ops[0] ?? '', values: [] }])
}

function removeRow(index: number) {
  emitItems(items.value.filter((_, i) => i !== index))
}

function onFieldChange(index: number, field: string) {
  const meta = metaOf(field)
  const next = items.value.map((item, i) => (i === index ? { field, op: meta?.ops[0] ?? '', values: [] } : item))
  emitItems(next)
}

function onOpChange(index: number, op: string) {
  const next = items.value.map((item, i) =>
    i === index ? { ...item, op, values: op === 'IN' ? item.values : item.values.slice(0, 1) } : item,
  )
  emitItems(next)
}

function onValuesChange(index: number, values: string[]) {
  emitItems(items.value.map((item, i) => (i === index ? { ...item, values } : item)))
}
</script>

<template>
  <div class="sce-root" data-testid="struct-cond-editor">
    <div v-for="(item, index) in items" :key="index" class="sce-row" :data-testid="`struct-cond-row-${index}`">
      <el-select
        :model-value="item.field"
        class="sce-field"
        placeholder="字段"
        :data-testid="`struct-field-${index}`"
        @update:model-value="onFieldChange(index, String($event))"
      >
        <el-option v-for="f in fields" :key="f.field" :label="`${f.name}（${f.field}）`" :value="f.field" />
      </el-select>
      <el-select
        :model-value="item.op"
        class="sce-op"
        placeholder="操作符"
        :data-testid="`struct-op-${index}`"
        @update:model-value="onOpChange(index, String($event))"
      >
        <el-option v-for="op in metaOf(item.field)?.ops ?? []" :key="op" :label="op" :value="op" />
      </el-select>

      <!-- 值控件：按 valueFrom / type / 是否 IN 分发（CondValueInput 内部实现） -->
      <CondValueInput
        :model-value="item.values"
        :field="metaOf(item.field) ?? { field: item.field, name: item.field, type: 'str', ops: item.op ? [item.op] : [], valueFrom: 'text' }"
        :multiple="item.op === 'IN'"
        :data-testid="`struct-values-${index}`"
        @update:model-value="onValuesChange(index, $event)"
      />

      <el-button
        class="sce-del"
        :icon="Delete"
        circle
        size="small"
        :data-testid="`struct-row-del-${index}`"
        @click="removeRow(index)"
      />
    </div>
    <div v-if="!items.length" class="sce-empty">还没有条件，点下方按钮添加（多个条件之间是 AND 关系）</div>
    <el-button size="small" :icon="Plus" data-testid="struct-cond-add" @click="addRow">添加条件</el-button>
  </div>
</template>

<style scoped>
.sce-root { width: 100%; }
.sce-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
.sce-field { width: 190px; flex-shrink: 0; }
.sce-op { width: 92px; flex-shrink: 0; }
.sce-value { flex: 1; min-width: 120px; }
.sce-row > :deep(.cvi-root) { flex: 1; min-width: 120px; }
.sce-del { flex-shrink: 0; }
.sce-empty { font-size: 12px; color: var(--rc-muted); margin-bottom: 8px; }
</style>
