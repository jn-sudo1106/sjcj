<script setup lang="ts">
// 规则处理节点「新增业务规则」表/字段绑定（0801 方案 §6.3/§7.2）。
// 表列表由父级传入（NodeInspector 资产 + RuleOrchestrationTab 按需 ensureTableDetail 补 fields）。
// 不走 vrule news-getTableList/news-getTableFields——两边 tableId 同源同编号空间（拍板清单 §2）。
import { computed, ref } from 'vue'
import type { EntryType, RuleDataSource, RuleFieldOption, RuleOrchestration, RuleTableOption } from '@/api'
import { isSystemField, ruleFieldOptionFromEntryField, ruleTableOptionFromEntryType } from '@/utils/flow/ruleOrchestration'

type BinderModel = Pick<
  RuleOrchestration,
  'dataSource' | 'name' | 'inputTable' | 'inputTableId' | 'outputTable' | 'outputTableId' | 'inputFields' | 'outputFields'
>

const props = defineProps<{ modelValue: BinderModel; tables: EntryType[] }>()
const emit = defineEmits<{ 'update:modelValue': [BinderModel] }>()

const DATA_SOURCES: { value: RuleDataSource; label: string }[] = [
  { value: 'dp-news', label: '资讯库' },
  { value: 'dp-wwdata', label: '采集库' },
  { value: 'dp-swdata', label: '申万库' },
]

function patch(p: Partial<BinderModel>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}

const tableOptions = computed<RuleTableOption[]>(() => props.tables.map(ruleTableOptionFromEntryType))

function fieldsOf(tableId: string | undefined): RuleFieldOption[] {
  if (!tableId) return []
  const entry = props.tables.find((t) => t.tableId === tableId)
  return entry ? entry.fields.map(ruleFieldOptionFromEntryField) : []
}

// 系统固定字段（seq < 0）默认不进可选池；已选中的仍保留在已选 tag，避免静默丢字段
const showSystemFields = ref(false)
function selectableFields(all: RuleFieldOption[]): RuleFieldOption[] {
  if (showSystemFields.value) return all
  return all.filter((f) => !isSystemField(f))
}

// 输出表为空时出参同源于输入表（0801 方案 §6.3：「输出表可选，默认使用输入表」）
const inputFieldOptions = computed(() => fieldsOf(props.modelValue.inputTableId))
const outputFieldOptions = computed(() =>
  props.modelValue.outputTableId ? fieldsOf(props.modelValue.outputTableId) : inputFieldOptions.value,
)
const inputFieldPool = computed(() => selectableFields(inputFieldOptions.value))
const outputFieldPool = computed(() => selectableFields(outputFieldOptions.value))

// 可搜索下拉：输入与下拉同一控件；filter-method 接管后按名称/物理表/ID 模糊过滤
const tableKeyword = ref('')
function onTableFilter(query: string) {
  tableKeyword.value = query
}
function onTableSelectVisible(open: boolean) {
  // 打开时重置关键词，保证已选项仍在 option 列表里能正确显示 label
  if (open) tableKeyword.value = ''
}
const filteredTableOptions = computed(() => {
  const kw = tableKeyword.value.trim().toLowerCase()
  if (!kw) return tableOptions.value
  return tableOptions.value.filter(
    (t) =>
      t.tableName.toLowerCase().includes(kw) ||
      t.dbTableName.toLowerCase().includes(kw) ||
      t.tableId.toLowerCase().includes(kw),
  )
})
function tableOptionLabel(t: RuleTableOption) {
  return `${t.tableName} · ${t.dbTableName}`
}

function onDataSourceChange(value: RuleDataSource) {
  // 会议要求切换数据源清空表/字段重选；本项目表列表当前统一来自采集库 entryApi，未按数据源分流，
  // 但切换动作仍应清空已选表字段，避免把上一数据源选的字段错误带到新数据源下（拍板范围内的稳妥默认）。
  patch({ dataSource: value, inputTable: '', inputTableId: '', outputTable: '', outputTableId: '', inputFields: [], outputFields: [] })
}
function onNameChange(e: Event) {
  patch({ name: (e.target as HTMLInputElement).value })
}
function onInputTableId(tableId: string | undefined | null) {
  const id = tableId ?? ''
  const table = tableOptions.value.find((t) => t.tableId === id)
  patch({ inputTableId: id, inputTable: table?.dbTableName ?? '', inputFields: [] })
}
function onOutputTableId(tableId: string | undefined | null) {
  const id = tableId ?? ''
  const table = tableOptions.value.find((t) => t.tableId === id)
  patch({ outputTableId: id, outputTable: table?.dbTableName ?? '', outputFields: [] })
}

function toggleField(kind: 'input' | 'output', code: string) {
  const key = kind === 'input' ? 'inputFields' : 'outputFields'
  const current = props.modelValue[key] ?? []
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
  patch({ [key]: next } as Partial<BinderModel>)
}

// 入参/出参默认折叠，只显示已选 + 展开入口（拍板 #15）：字段数量多时避免把表单撑得很长
const inputExpanded = ref(false)
const outputExpanded = ref(false)
</script>

<template>
  <div class="rc-field"><label>数据源 *</label>
    <div class="rc-segment">
      <button
        v-for="ds in DATA_SOURCES" :key="ds.value" type="button"
        :class="{ active: modelValue.dataSource === ds.value }"
        @click="onDataSourceChange(ds.value)"
      >{{ ds.label }}</button>
    </div>
  </div>

  <div class="rc-field"><label>规则名称 *</label>
    <input class="rc-input" :value="modelValue.name ?? ''" placeholder="请输入规则名称" @input="onNameChange" />
  </div>

  <div class="rc-field"><label>输入表 *</label>
    <el-select
      class="rc-table-select"
      :model-value="modelValue.inputTableId || undefined"
      filterable
      clearable
      placeholder="输入关键词筛选或选择表名"
      :filter-method="onTableFilter"
      @update:model-value="onInputTableId"
      @visible-change="onTableSelectVisible"
    >
      <el-option
        v-for="t in filteredTableOptions"
        :key="t.tableId"
        :label="tableOptionLabel(t)"
        :value="t.tableId"
      />
    </el-select>
  </div>

  <div class="rc-field"><label>输出表（可选，默认使用输入表）</label>
    <el-select
      class="rc-table-select"
      :model-value="modelValue.outputTableId || undefined"
      filterable
      clearable
      placeholder="默认 = 输入表；可输入筛选"
      :filter-method="onTableFilter"
      @update:model-value="onOutputTableId"
      @visible-change="onTableSelectVisible"
    >
      <el-option
        v-for="t in filteredTableOptions"
        :key="t.tableId"
        :label="tableOptionLabel(t)"
        :value="t.tableId"
      />
    </el-select>
  </div>

  <div class="rc-field"><label>入参字段 *</label>
    <div v-if="!modelValue.inputTableId" class="rc-readonly-hint">请先选择输入表</div>
    <template v-else>
      <div class="rc-tag-row">
        <span v-if="!modelValue.inputFields?.length" class="rc-readonly-hint rc-tag-empty">未选择</span>
        <span v-for="code in modelValue.inputFields" :key="code" class="rc-tag on" @click="toggleField('input', code)">
          {{ inputFieldOptions.find((f) => f.itemCode === code)?.itemName ?? code }} ×
        </span>
        <button class="rc-tag-toggle" type="button" @click="inputExpanded = !inputExpanded">
          {{ inputExpanded ? '▾ 收起' : `▸ 共 ${inputFieldPool.length} 个可选` }}
        </button>
        <button class="rc-tag-toggle" type="button" @click="showSystemFields = !showSystemFields">
          {{ showSystemFields ? '隐藏系统字段' : '显示系统字段' }}
        </button>
      </div>
      <div v-if="inputExpanded" class="rc-tag-row rc-tag-pool">
        <span
          v-for="f in inputFieldPool" :key="f.itemCode"
          class="rc-tag" :class="{ on: modelValue.inputFields?.includes(f.itemCode) }"
          @click="toggleField('input', f.itemCode)"
        >{{ f.itemName }}</span>
      </div>
    </template>
  </div>

  <div class="rc-field"><label>出参字段 *</label>
    <div v-if="!modelValue.inputTableId" class="rc-readonly-hint">请先选择输入表</div>
    <template v-else>
      <div class="rc-tag-row">
        <span v-if="!modelValue.outputFields?.length" class="rc-readonly-hint rc-tag-empty">未选择</span>
        <span v-for="code in modelValue.outputFields" :key="code" class="rc-tag on" @click="toggleField('output', code)">
          {{ outputFieldOptions.find((f) => f.itemCode === code)?.itemName ?? code }} ×
        </span>
        <button class="rc-tag-toggle" type="button" @click="outputExpanded = !outputExpanded">
          {{ outputExpanded ? '▾ 收起' : `▸ 共 ${outputFieldPool.length} 个可选` }}
        </button>
      </div>
      <div v-if="outputExpanded" class="rc-tag-row rc-tag-pool">
        <span
          v-for="f in outputFieldPool" :key="f.itemCode"
          class="rc-tag" :class="{ on: modelValue.outputFields?.includes(f.itemCode) }"
          @click="toggleField('output', f.itemCode)"
        >{{ f.itemName }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-table-select { width: 100%; }
.rc-table-select :deep(.el-select__wrapper) {
  min-height: 32px;
  border-radius: 7px;
  box-shadow: 0 0 0 1px #dbe3ee inset;
  font-size: 12px;
}
.rc-table-select :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px #60a5fa inset, 0 0 0 3px #dbeafe;
}
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.rc-tag-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rc-tag-empty { padding: 4px 8px; }
.rc-tag { display: inline-flex; align-items: center; padding: 4px 9px; border: 1px solid #dbe3ee; border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; user-select: none; }
.rc-tag:hover { border-color: #bfdbfe; }
.rc-tag.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 600; }
.rc-tag-toggle { border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; font-weight: 600; cursor: pointer; padding: 4px 2px; }
.rc-tag-toggle:hover { text-decoration: underline; }
.rc-tag-pool { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--rc-border-soft); }
</style>
