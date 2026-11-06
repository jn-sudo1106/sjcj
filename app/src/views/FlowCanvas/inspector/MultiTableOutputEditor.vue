<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { entryApi, type EntryType } from '@/api'
import { readOutputTableConfig, writeOutputTableConfig, type OutputColumnMapping, type OutputTableDefinition } from '@/utils/flow/multiTableOutput'

const props = defineProps<{ modelValue: string; mainTableId: string; tables: EntryType[] }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const parsed = computed(() => readOutputTableConfig(props.modelValue))
const root = computed(() => parsed.value.config?.table)
const children = computed(() => root.value?.subs ?? [])
const draft = ref<{ index: number; tableId: string; keys: string; colMap: OutputColumnMapping[]; pCol: string; original?: OutputTableDefinition }>()
const editingMain = computed(() => draft.value?.index === -1)
const message = ref('')
const metadata = ref<EntryType>()
const metadataLoading = ref(false)
const metadataError = ref('')
let metadataSeq = 0
const searchResults = ref<EntryType[]>([])
const searchLoading = ref(false)
let searchSeq = 0
const summaryTables = ref<Record<string, EntryType>>({})
watch(() => [root.value?.entryTypeId, ...children.value.map((table) => table.entryTypeId)].filter(Boolean), (ids) => {
  for (const id of ids) {
    const tableId = String(id)
    if (summaryTables.value[tableId] || props.tables.some((table) => table.tableId === tableId)) continue
    void entryApi.entryDetail(tableId).then((table) => { summaryTables.value[tableId] = table }).catch(() => { /* 保留表 ID，编辑时可重试字段加载。 */ })
  }
}, { immediate: true })
const fields = computed(() => (metadata.value?.fields ?? []).filter((field) => field.itemId))
const tableLabel = (tableId: string | number) => {
  const table = props.tables.find((table) => table.tableId === String(tableId))
    ?? summaryTables.value[String(tableId)]
    ?? searchResults.value.find((table) => table.tableId === String(tableId))
  return table ? `${table.name || table.tableName} · ${tableId}` : `数据表 #${tableId}`
}
const options = computed(() => {
  const list = [...searchResults.value]
  const current = draft.value?.tableId
  const table = metadata.value ?? props.tables.find((table) => table.tableId === current)
  if (current && !list.some((table) => table.tableId === current)) {
    list.unshift(table ?? { tableId: current, tableName: `数据表 #${current}`, fields: [] })
  }
  return list
})

async function loadMetadata(tableId: string) {
  const seq = ++metadataSeq
  metadata.value = undefined
  metadataError.value = ''
  metadataLoading.value = !!tableId
  if (!tableId) return
  try {
    const cached = props.tables.find((table) => table.tableId === tableId && table.fields.length) ?? summaryTables.value[tableId]
    const table = cached ?? await entryApi.entryDetail(tableId)
    if (seq === metadataSeq) metadata.value = table
  } catch (error) {
    if (seq === metadataSeq) metadataError.value = `加载表字段失败：${(error as Error).message}`
  } finally {
    if (seq === metadataSeq) metadataLoading.value = false
  }
}
watch(() => draft.value?.tableId ?? '', (tableId) => { void loadMetadata(tableId) })
watch(() => props.modelValue, () => { draft.value = undefined; message.value = '' })
watch(() => props.mainTableId, () => { draft.value = undefined; message.value = '' })

async function searchTables(keyword: string) {
  const seq = ++searchSeq
  searchLoading.value = true
  try {
    const list = await entryApi.searchTables(keyword, 30)
    if (seq === searchSeq) searchResults.value = list
  } catch (error) {
    if (seq === searchSeq) message.value = `搜索表失败：${(error as Error).message}`
  } finally {
    if (seq === searchSeq) searchLoading.value = false
  }
}

function edit(index: number) {
  const table = index === -1 ? root.value : children.value[index]
  draft.value = {
    index,
    tableId: String(index === -1 ? props.mainTableId : table?.entryTypeId ?? ''),
    keys: table?.keys.join(', ') ?? '',
    colMap: table?.colMap.map((row) => ({ ...row })) ?? [],
    pCol: table?.pCol ?? '',
    original: table,
  }
  message.value = ''
}
function changeTable(value: string) {
  if (!draft.value) return
  // 显式换表保留原映射供核对，实际字段 ID 不匹配时禁止完成，不按 K 列套用。
  draft.value.tableId = value
}
function fieldLabel(field: EntryType['fields'][number]) {
  return `${field.desc || field.prop}${field.columnName ? `（${field.columnName}）` : ''}`
}
const rootMismatch = computed(() => !!root.value && String(root.value.entryTypeId) !== props.mainTableId)
function apply() {
  if (!draft.value || !parsed.value.config) return
  const value = draft.value
  const tableId = Number(value.tableId)
  const keys = [...new Set(value.keys.split(/[,，\n]/).map((key) => key.trim()).filter(Boolean))]
  if (!Number.isSafeInteger(tableId) || tableId <= 0) { message.value = '请先选择输出表。'; return }
  if (!keys.length) { message.value = '请填写结果分组。'; return }
  if (!metadata.value || metadataLoading.value || metadataError.value) { message.value = '请先成功加载目标表字段。'; return }
  const known = new Set(fields.value.map((field) => String(field.itemId)))
  if (!value.colMap.length || value.colMap.some((row) => !known.has(row.colId) || !row.fromId.trim())) {
    message.value = '请补全字段映射；已失效的目标字段需要重新选择。'; return
  }
  if (new Set(value.colMap.map((row) => row.colId)).size !== value.colMap.length) { message.value = '同一个目标字段只能配置一次。'; return }
  if (value.pCol && !known.has(value.pCol)) { message.value = '父记录字段已失效，请重新选择。'; return }
  if (value.index !== -1 && (rootMismatch.value || tableId === root.value?.entryTypeId
    || children.value.some((table, index) => index !== value.index && table.entryTypeId === tableId))) {
    message.value = rootMismatch.value ? '请先核对主输出映射，使其与上方输出表一致。' : '该表已在输出目标中，请编辑已有配置。'; return
  }
  const definition: OutputTableDefinition = {
    ignored: [], subs: [], ...value.original,
    entryTypeId: tableId, keys,
    colMap: value.colMap.map((row) => ({ ...row, fromId: row.fromId.trim() })),
  }
  if (value.pCol) definition.pCol = value.pCol
  else delete definition.pCol
  const next = value.index === -1 ? definition : {
    ...root.value!, subs: [...children.value],
  }
  if (value.index !== -1) next.subs!.splice(value.index, value.original ? 1 : 0, definition)
  draft.value = undefined
  emit('update:modelValue', writeOutputTableConfig(parsed.value.config, next))
}
function remove(index: number) {
  if (!root.value || !parsed.value.config) return
  draft.value = undefined
  emit('update:modelValue', writeOutputTableConfig(parsed.value.config, {
    ...root.value, subs: children.value.filter((_table, i) => i !== index),
  }))
}
</script>

<template>
  <section class="mto" aria-label="多表输出" data-testid="multi-table-output">
    <div class="mto-heading">
      <span>多表输出 <span v-if="root" class="mto-count">{{ children.length + 1 }} 张表</span></span>
      <button v-if="!draft" type="button" class="mto-link" :disabled="!!parsed.error || !mainTableId" data-testid="add-output-table" @click="edit(root ? children.length : -1)">{{ root ? '＋ 添加输出表' : '配置多表输出' }}</button>
    </div>
    <p v-if="parsed.error" class="mto-hint">{{ parsed.error }}</p>
    <p v-else-if="!root && !draft" class="mto-hint">需要把同一批采集结果写入多张表时，在这里添加输出目标。</p>
    <template v-if="root">
      <div class="mto-target">
        <div class="mto-target-line"><span class="mto-role">主表</span><strong>{{ tableLabel(root.entryTypeId) }}</strong><button type="button" class="mto-link" :disabled="!!draft" data-testid="edit-main-output" @click="edit(-1)">编辑映射</button></div>
        <div class="mto-target-summary">{{ root.keys.join('、') }} · {{ root.colMap.length }} 项映射 · {{ rootMismatch ? '旧配置中的主表' : '后续步骤使用此表' }}</div>
      </div>
      <div v-for="(table, index) in children" :key="index" class="mto-target" data-testid="additional-output-table">
        <div class="mto-target-line">
          <span class="mto-role">附表</span><strong>{{ tableLabel(table.entryTypeId) }}</strong>
          <button type="button" class="mto-link" :disabled="!!draft" @click="edit(index)">编辑</button>
          <button type="button" class="mto-link mto-remove" :disabled="!!draft" :aria-label="`移除输出表 ${table.entryTypeId}${table.subs?.length ? '及其下级配置' : ''}`" @click="remove(index)">移除</button>
        </div>
        <div class="mto-target-summary">{{ table.keys.join('、') }} · {{ table.colMap.length }} 项映射 · 关联主表记录<span v-if="table.subs?.length"> · 含 {{ table.subs.length }} 项下级配置（保留）</span></div>
      </div>
      <p v-if="rootMismatch" class="mto-error">此处主表与上方输出表不一致，请编辑主表映射并核对字段。</p>
    </template>
    <div v-if="draft" class="mto-editor" data-testid="output-target-editor">
      <div class="mto-editor-title">{{ editingMain ? '主输出映射' : draft.original ? '编辑附加输出' : '添加输出表' }}</div>
      <div class="mto-field"><label>输出表</label>
        <div v-if="editingMain" class="mto-readonly">{{ tableLabel(mainTableId) }}</div>
        <el-select v-else :model-value="draft.tableId || undefined" filterable remote :remote-method="searchTables" :loading="searchLoading" placeholder="搜索表名或表 ID" aria-label="附加输出表" @update:model-value="changeTable" @visible-change="(open: boolean) => { if (open && !searchResults.length) searchResults = [...tables] }">
          <el-option v-for="table in options" :key="table.tableId" :value="table.tableId" :label="`${table.name || table.tableName} · ${table.tableId}`" />
        </el-select>
      </div>
      <div class="mto-field"><label for="output-result-keys">结果分组</label><input id="output-result-keys" v-model="draft.keys" class="mto-input" placeholder="例如 news、attachments，多个用逗号分隔" /><div class="mto-hint">填写采集结果中的分组名，用于找到本表需要保存的数据。</div></div>
      <div class="mto-mapping-heading"><span>字段映射</span><button type="button" class="mto-link" :disabled="!fields.length" data-testid="add-output-mapping" @click="draft.colMap.push({ colId: '', fromId: '' })">＋ 添加字段</button></div>
      <p v-if="metadataLoading" class="mto-hint">正在加载目标表字段…</p>
      <p v-else-if="metadataError" class="mto-error">{{ metadataError }} <button type="button" class="mto-link" @click="loadMetadata(draft.tableId)">重试</button></p>
      <div v-if="draft.colMap.length" class="mto-map-labels"><span>目标字段</span><span>结果取值</span><span /></div>
      <div v-for="(row, index) in draft.colMap" :key="index" class="mto-map-row" data-testid="output-mapping-row">
        <select v-model="row.colId" class="mto-input" :aria-label="`目标字段 ${index + 1}`">
          <option value="">选择目标字段</option>
          <option v-if="row.colId && !fields.some((field) => String(field.itemId) === row.colId)" :value="row.colId">#{{ row.colId }}（待核对）</option>
          <option v-for="field in fields" :key="field.itemId" :value="String(field.itemId)">{{ fieldLabel(field) }}</option>
        </select>
        <input v-model="row.fromId" class="mto-input" :aria-label="`结果取值 ${index + 1}`" placeholder="结果字段 ID 或键名" />
        <button type="button" class="mto-link mto-remove" :aria-label="`移除映射 ${index + 1}`" @click="draft.colMap.splice(index, 1)">×</button>
      </div>
      <p v-if="!draft.colMap.length && !metadataLoading" class="mto-hint">添加需要写入的字段，并指定对应的结果取值。</p>
      <div v-if="!editingMain" class="mto-field mto-parent"><label>关联主表记录的字段 <span class="mto-optional">可选</span></label>
        <select v-model="draft.pCol" class="mto-input" aria-label="关联主表记录的字段"><option value="">仅保留系统父子关系</option><option v-if="draft.pCol && !fields.some((field) => String(field.itemId) === draft?.pCol)" :value="draft.pCol">#{{ draft.pCol }}（待核对）</option><option v-for="field in fields" :key="field.itemId" :value="String(field.itemId)">{{ fieldLabel(field) }}</option></select>
      </div>
      <div class="mto-edit-actions"><span>完成后再保存节点配置</span><button type="button" class="mto-link" @click="draft = undefined; message = ''">取消</button><button type="button" class="mto-done" :disabled="metadataLoading" data-testid="complete-output-target" @click="apply">完成</button></div>
    </div>
    <p v-if="message" class="mto-error" role="status">{{ message }}</p>
    <p v-if="root || draft" class="mto-hint mto-footnote">附表按主表记录建立父子关系，不改变后续步骤的输入。执行效果待联调。</p>
  </section>
</template>

<style scoped>
.mto { margin: 12px 0; padding: 10px 0; border-top: 1px solid var(--rc-border-soft); border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text-2); font-size: 11px; min-width: 0; }
.mto-heading, .mto-target-line, .mto-mapping-heading, .mto-edit-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mto-heading, .mto-mapping-heading { justify-content: space-between; }
.mto-heading { font-weight: 600; color: var(--rc-text); }
.mto-count, .mto-optional { font-size: 10px; font-weight: 400; color: var(--rc-faint); margin-left: 4px; }
.mto-link { padding: 2px 0; border: 0; background: transparent; color: var(--rc-primary); font: inherit; white-space: nowrap; cursor: pointer; }
.mto-link:hover { text-decoration: underline; }
.mto-link:disabled { color: var(--rc-faint); cursor: default; text-decoration: none; }
.mto-target { margin-top: 8px; padding: 8px; border: 1px solid var(--rc-border-soft); border-radius: 6px; }
.mto-target-line strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.mto-role { color: var(--rc-muted); flex-shrink: 0; font-size: 10px; }
.mto-target-summary { margin-top: 5px; font-size: 10px; color: var(--rc-faint); overflow-wrap: anywhere; }
.mto-hint { margin: 5px 0 0; font-size: 10px; color: var(--rc-faint); line-height: 1.6; }
.mto-error { color: var(--rc-warn); margin: 6px 0 0; font-size: 11px; line-height: 1.5; }
.mto-editor { margin-top: 8px; padding: 10px; border: 1px solid var(--rc-border-soft); border-radius: 7px; background: #f8fafc; }
.mto-editor-title { font-weight: 600; color: var(--rc-text); margin-bottom: 10px; }
.mto-field { margin-bottom: 10px; }
.mto-field label { display: block; color: var(--rc-muted); margin-bottom: 4px; }
.mto-readonly { padding: 7px 9px; border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #fff; overflow-wrap: anywhere; }
.mto-input { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid #dbe3ee; border-radius: 6px; padding: 7px; background: #fff; color: var(--rc-text); font: inherit; }
.mto-input:focus-visible, .mto-link:focus-visible, .mto-done:focus-visible { outline: 2px solid var(--rc-primary); outline-offset: 2px; }
.mto-map-labels, .mto-map-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 18px; align-items: center; gap: 6px; margin-top: 6px; }
.mto-map-labels { color: var(--rc-muted); font-size: 10px; }
.mto-parent { margin-top: 10px; }
.mto-remove { color: var(--rc-muted); }
.mto-remove:hover { color: var(--rc-error); }
.mto-edit-actions { margin-top: 10px; justify-content: flex-end; }
.mto-edit-actions > span { margin-right: auto; color: var(--rc-faint); font-size: 10px; }
.mto-done { border: 1px solid var(--rc-primary); background: var(--rc-primary); color: #fff; border-radius: 5px; padding: 4px 10px; font: inherit; cursor: pointer; }
.mto-done:disabled { opacity: .5; cursor: default; }
.mto :deep(.el-select__wrapper) { min-height: 30px; border-radius: 6px; font-size: 11px; }
</style>
