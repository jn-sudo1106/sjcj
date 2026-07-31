<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { pinyin } from 'pinyin-pro'
import { entryApi, type EntryField, type EntryType } from '../../api'
import { ENTRY_FIELD_DEFAULT_WIDTH } from '../../constants/entry'

const props = defineProps<{ modelValue: boolean; entry?: EntryType | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [tableId: string] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const form = reactive<EntryType>({ tableId: '', tableName: '', name: '', remark: '', fields: [] })
const isEdit = computed(() => !!props.entry?.tableId)
const advancedOpen = ref(false)
const batchDialog = reactive<{ visible: boolean; text: string }>({ visible: false, text: '' })

// §1.4：新建时按名称拼音首字母自动生成物理表名 TB_{PY}（用户已手改过物理表名后不再覆盖）
const tableNameTouched = ref(false)
function onNameInput() {
  if (isEdit.value || tableNameTouched.value) return
  const letters = pinyin(form.name || '', { pattern: 'first', toneType: 'none', type: 'array' }).join('')
  form.tableName = letters ? `TB_${letters.toUpperCase()}` : ''
}
function onTableNameInput() { tableNameTouched.value = true }

const PREPROCESS_PRESETS = [
  "date('yyyy-MM-dd')",
  'SOURCE_NAME',
  'SOURCE_URL',
  "subIndex(value, 'c', 1, -1)",
  "value ? '有' : '无'",
]
function preprocessSuggestions(query: string, cb: (results: { value: string }[]) => void) {
  const options = PREPROCESS_PRESETS.filter((p) => !query || p.includes(query))
  cb(options.map((value) => ({ value })))
}

const CHECK_RULE_PRESETS = ['', 'Y']
function checkRuleLabel(v: string) {
  if (v === '') return '不校验'
  if (v === 'Y') return '校验非空'
  return v
}

// K 序规则：新增行 columnName = 'K' + (当前最大序号+1)；已有行 columnName 任何操作都不得改写。
function maxKSeq(): number {
  let max = 0
  for (const f of form.fields) {
    const m = /^K(\d+)$/.exec(f.columnName ?? '')
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}
function blankField(seq: number): EntryField {
  const k = maxKSeq() + 1
  return { prop: '', desc: '', type: 'string', required: false, dedup: false, seq, columnName: `K${k}`, width: ENTRY_FIELD_DEFAULT_WIDTH }
}

function reset() {
  const entry = props.entry
  Object.assign(form, {
    tableId: entry?.tableId ?? '',
    tableName: entry?.tableName ?? '',
    name: entry?.name ?? '',
    remark: entry?.remark ?? '',
    // entry 是响应式 props，字段元素是 Vue reactive Proxy；structuredClone 处理不了 Proxy，需先 toRaw 剥掉再 clone
    fields: entry?.fields?.map((field) => structuredClone(toRaw(field))) ?? [],
    keyField: entry?.keyField,
    state: entry?.state ?? 'C',
    // null/undefined → ''：与 el-option value="" "请选择" 对齐，提交时透传空串 = 未配置（避免 String(null)='null'）
    recFlag: entry?.recFlag == null ? '' : String(entry.recFlag),
    checkFlag: entry?.checkFlag == null ? '' : String(entry.checkFlag),
    checkRule: entry?.checkRule ?? '',
    coreParam: entry?.coreParam,
  })
  if (!form.fields.length) form.fields.push(blankField(1))
  tableNameTouched.value = isEdit.value
  advancedOpen.value = false
}
watch(() => props.modelValue, (open) => { if (open) reset() }, { immediate: true })

// 去重勾选↔keyField 只读联动：keyField 由勾选行 columnName 逗号连接实时派生。
watch(
  () => form.fields.map((f) => (f.dedup ? f.columnName : null)).join(','),
  () => {
    form.keyField = form.fields.filter((f) => f.dedup && f.columnName).map((f) => f.columnName).join(',')
  },
  { immediate: true },
)

function addField() {
  form.fields.push(blankField(form.fields.length + 1))
}
function removeField(index: number) {
  const field = form.fields[index]
  if (Number(field.itemId ?? 0) > 0) return // 仅新增行可删（物理列已绑定，不可删）
  form.fields.splice(index, 1)
  form.fields.forEach((f, i) => { f.seq = i + 1 })
}
function moveField(index: number, offset: number) {
  const next = index + offset
  if (next < 0 || next >= form.fields.length) return
  const [field] = form.fields.splice(index, 1)
  form.fields.splice(next, 0, field)
  // 排序只重排 seq，不动 columnName（物理列绑定不受影响）
  form.fields.forEach((item, i) => { item.seq = i + 1 })
}
function onItemCodeBlur(field: EntryField) {
  if (!field.desc?.trim() && field.prop?.trim()) field.desc = field.prop.trim()
}

async function openBatchAdd() {
  batchDialog.text = 'code:编码:100\nname:名称:200\nurl:url:500'
  batchDialog.visible = true
}
function submitBatchAdd() {
  const lines = batchDialog.text.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    const [prop, desc, widthStr] = line.split(':')
    if (!prop?.trim()) continue
    form.fields.push({
      ...blankField(form.fields.length + 1),
      prop: prop.trim(),
      desc: desc?.trim() || prop.trim(),
      width: widthStr?.trim() ? Number(widthStr.trim()) : ENTRY_FIELD_DEFAULT_WIDTH,
    })
  }
  batchDialog.visible = false
}

async function submit() {
  if (!form.name?.trim()) {
    ElMessage.warning('表名称必填')
    return
  }
  if (!form.tableName?.trim()) {
    ElMessage.warning('表名必填')
    return
  }
  if (!form.fields.length) {
    ElMessage.warning('请增加属性')
    return
  }
  const codes = form.fields.map((f) => f.prop.trim())
  const dup = codes.find((code, i) => code && codes.indexOf(code) !== i)
  if (dup) {
    ElMessage.warning(`出错，属性重复:${dup}`)
    return
  }
  try {
    const result = await entryApi.entrySave({
      ...form,
      name: form.name.trim(),
      tableName: form.tableName.trim(),
      fields: form.fields.map((field, index) => ({ ...field, prop: field.prop.trim(), desc: field.desc.trim(), seq: index + 1 })),
    })
    ElMessage.success(result.message || '处理成功')
    visible.value = false
    emit('saved', result.tableId || form.tableId)
  } catch (error) {
    ElMessage.error(`处理失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}
</script>

<template>
  <el-drawer v-model="visible" title="数据表编辑" size="760px" append-to-body>
    <div class="ete-grid">
      <div v-if="isEdit" class="rc-field"><label>表ID</label><input class="rc-input" :value="form.tableId" disabled /></div>
      <div class="rc-field"><label>名称</label><input v-model="form.name" class="rc-input" @input="onNameInput" /></div>
      <div class="rc-field"><label>物理表</label><input v-model="form.tableName" class="rc-input" placeholder="例如 tb_entry_news" @input="onTableNameInput" /></div>
      <div class="rc-field"><label>去重列</label><input class="rc-input" :value="form.keyField || '—'" disabled /></div>
      <div class="rc-field ete-wide"><label>备注</label><textarea v-model="form.remark" class="rc-input" rows="2" /></div>
    </div>

    <div class="ete-title"><strong>字段定义</strong>
      <span>
        <button class="rc-btn" type="button" @click="addField">加属性</button>
        <button class="rc-btn" type="button" @click="openBatchAdd">批量加</button>
      </span>
    </div>
    <div class="rc-table-scroll">
      <table class="rc-data-table ete-table">
        <thead><tr><th style="width: 44px">序号</th><th>编码</th><th>展示名</th><th style="width: 70px">数据库列</th><th style="width: 96px">类型</th><th style="width: 110px">校验</th><th style="width: 64px">列宽</th><th>预处理</th><th style="width: 44px">去重</th><th style="width: 44px">必填</th><th style="width: 90px">操作</th></tr></thead>
        <tbody>
          <tr v-for="(field, index) in form.fields" :key="field.itemId || index">
            <td>{{ field.seq ?? index + 1 }}</td>
            <td><input v-model="field.prop" class="rc-input" @blur="onItemCodeBlur(field)" /></td>
            <td><input v-model="field.desc" class="rc-input" /></td>
            <td><input class="rc-input" :value="field.columnName" disabled /></td>
            <td>
              <select v-model="field.type" class="rc-select">
                <option value="string">string</option>
                <option value="text">text</option>
                <option value="longtext">longtext</option>
              </select>
            </td>
            <td>
              <el-select v-model="field.checkRule" filterable allow-create default-first-option placeholder="不校验" style="width: 100%">
                <el-option v-for="v in CHECK_RULE_PRESETS" :key="v" :label="checkRuleLabel(v)" :value="v" />
              </el-select>
            </td>
            <td><input v-model.number="field.width" class="rc-input ete-number" type="number" /></td>
            <td>
              <el-autocomplete v-model="field.preprocess" :fetch-suggestions="preprocessSuggestions" style="width: 100%" clearable />
            </td>
            <td><input v-model="field.dedup" type="checkbox" /></td>
            <td><input v-model="field.required" type="checkbox" /></td>
            <td class="ete-actions">
              <button type="button" @click="moveField(index, -1)">↑</button>
              <button type="button" @click="moveField(index, 1)">↓</button>
              <button v-if="!(Number(field.itemId ?? 0) > 0)" type="button" class="danger" @click="removeField(index)">删</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="ete-adv-toggle" @click="advancedOpen = !advancedOpen">高级 {{ advancedOpen ? '▲' : '▼' }}</div>
    <div v-if="advancedOpen" class="ete-grid">
      <div class="rc-field">
        <label>记变化</label>
        <select v-model="form.recFlag" class="rc-select">
          <option value="">请选择</option>
          <option value="1">记变化(进rec库)</option>
          <option value="0">不记变化</option>
        </select>
      </div>
      <div class="rc-field">
        <label>校验</label>
        <select v-model="form.checkFlag" class="rc-select">
          <option value="">请选择</option>
          <option value="1">校验(失败进err库)</option>
          <option value="0">不校验</option>
        </select>
      </div>
      <div class="rc-field ete-wide"><label>校验脚本</label><input v-model="form.checkRule" class="rc-input" placeholder="校验通过的数据行才能入库" /></div>
    </div>

    <template #footer><div class="ete-foot"><button class="rc-btn" type="button" @click="visible = false">取消</button><button class="rc-btn primary" type="button" @click="submit">保存</button></div></template>
  </el-drawer>

  <el-dialog v-model="batchDialog.visible" title="批量加属性" width="480px" append-to-body>
    <textarea v-model="batchDialog.text" class="rc-input" rows="8" placeholder="英文名:中文名:宽度，一行一个" />
    <template #footer>
      <button class="rc-btn" type="button" @click="batchDialog.visible = false">取消</button>
      <button class="rc-btn primary" type="button" @click="submitBatchAdd">确定</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ete-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.ete-wide { grid-column: 1 / -1; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; margin-bottom: 12px; }
.rc-field label { display: block; margin-bottom: 4px; color: var(--rc-muted); font-size: 11px; }
.rc-input, .rc-select { width: 100%; box-sizing: border-box; border: 1px solid #dbe3ee; border-radius: 6px; padding: 6px 8px; background: #fff; color: var(--rc-text); font-size: 12px; }
.ete-title { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
.ete-title span { display: flex; gap: 8px; }
.ete-table { min-width: 1220px; }
.ete-table td { padding: 6px; }
.ete-number { width: 72px; }
.ete-actions { white-space: nowrap; }
.ete-actions button { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; }
.ete-actions button.danger { color: #dc2626; }
.ete-adv-toggle { margin: 12px 0 8px; font-size: 12px; font-weight: 600; color: var(--rc-primary-ink); cursor: pointer; }
.ete-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
