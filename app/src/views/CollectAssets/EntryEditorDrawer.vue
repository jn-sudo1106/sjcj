<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { entryApi, type EntryField, type EntryType } from '../../api'

const props = defineProps<{ modelValue: boolean; entry?: EntryType | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const form = reactive<EntryType>({ tableId: '', tableName: '', name: '', remark: '', fields: [] })
const isEdit = computed(() => !!props.entry?.tableId)

function blankField(seq: number): EntryField {
  return { prop: '', desc: '', type: 'string', required: false, dedup: false, seq }
}

function reset() {
  const entry = props.entry
  Object.assign(form, {
    tableId: entry?.tableId ?? '',
    tableName: entry?.tableName ?? '',
    name: entry?.name ?? '',
    remark: entry?.remark ?? '',
    fields: entry?.fields?.map((field) => ({ ...field })) ?? [blankField(1)],
    keyField: entry?.keyField,
    state: entry?.state ?? 'C',
    recFlag: entry?.recFlag,
    checkFlag: entry?.checkFlag,
    checkRule: entry?.checkRule,
    coreParam: entry?.coreParam,
  })
}
watch(() => props.modelValue, (open) => { if (open) reset() })

function addField() {
  form.fields.push(blankField(form.fields.length + 1))
}
function removeField(index: number) {
  form.fields.splice(index, 1)
  form.fields.forEach((field, i) => { field.seq = i + 1 })
}
function moveField(index: number, offset: number) {
  const next = index + offset
  if (next < 0 || next >= form.fields.length) return
  const [field] = form.fields.splice(index, 1)
  form.fields.splice(next, 0, field)
  form.fields.forEach((item, i) => { item.seq = i + 1 })
}

async function submit() {
  if (!form.name?.trim() || !form.tableName.trim()) {
    ElMessage.warning('请填写表名称和物理表名')
    return
  }
  if (!form.fields.length || form.fields.some((field) => !field.prop.trim() || !field.desc.trim())) {
    ElMessage.warning('请至少配置一个完整字段')
    return
  }
  const result = await entryApi.entrySave({
    ...form,
    name: form.name.trim(),
    tableName: form.tableName.trim(),
    fields: form.fields.map((field, index) => ({ ...field, prop: field.prop.trim(), desc: field.desc.trim(), seq: index + 1 })),
  })
  ElMessage.success(result.message || '实体表已保存')
  visible.value = false
  emit('saved')
}
</script>

<template>
  <el-drawer v-model="visible" :title="isEdit ? '编辑实体表' : '新建实体表'" size="760px" append-to-body>
    <div class="ete-grid">
      <div v-if="isEdit" class="rc-field"><label>表 ID</label><input class="rc-input" :value="form.tableId" disabled /></div>
      <div class="rc-field"><label>表名称</label><input v-model="form.name" class="rc-input" /></div>
      <div class="rc-field"><label>物理表名</label><input v-model="form.tableName" class="rc-input" placeholder="例如 tb_entry_news" /></div>
      <div class="rc-field"><label>去重字段</label><input v-model="form.keyField" class="rc-input" /></div>
      <div class="rc-field"><label>状态</label><select v-model="form.state" class="rc-select"><option value="C">测试表</option><option value="AC">正式表</option></select></div>
      <div class="rc-field"><label>核心参数</label><input v-model="form.coreParam" class="rc-input" /></div>
      <div class="rc-field ete-wide"><label>备注</label><textarea v-model="form.remark" class="rc-input" rows="2" /></div>
      <div class="rc-field"><label>记录变更</label><input v-model="form.recFlag" class="rc-input" /></div>
      <div class="rc-field"><label>校验标识</label><input v-model="form.checkFlag" class="rc-input" /></div>
      <div class="rc-field ete-wide"><label>表级校验规则</label><input v-model="form.checkRule" class="rc-input" /></div>
    </div>

    <div class="ete-title"><strong>字段定义</strong><button class="rc-btn primary" type="button" @click="addField">＋ 加属性</button></div>
    <div class="rc-table-scroll">
      <table class="rc-data-table ete-table">
        <thead><tr><th>属性</th><th>展示名</th><th>数据库列</th><th>类型</th><th>校验</th><th>列宽</th><th>预处理</th><th>去重</th><th>顺序</th></tr></thead>
        <tbody>
          <tr v-for="(field, index) in form.fields" :key="field.itemId || index">
            <td><input v-model="field.prop" class="rc-input" /></td>
            <td><input v-model="field.desc" class="rc-input" /></td>
            <td><input v-model="field.columnName" class="rc-input" /></td>
            <td><select v-model="field.type" class="rc-select"><option value="string">string</option><option value="text">text</option><option value="longtext">longtext</option><option value="url">url</option><option value="number">number</option><option value="date">date</option><option value="json">json</option></select></td>
            <td><input v-model="field.checkRule" class="rc-input" /></td>
            <td><input v-model.number="field.width" class="rc-input ete-number" type="number" /></td>
            <td><input v-model="field.preprocess" class="rc-input" /></td>
            <td><input v-model="field.dedup" type="checkbox" /></td>
            <td class="ete-actions"><button type="button" @click="moveField(index, -1)">↑</button><button type="button" @click="moveField(index, 1)">↓</button><button type="button" class="danger" @click="removeField(index)">删</button></td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer><div class="ete-foot"><button class="rc-btn" type="button" @click="visible = false">取消</button><button class="rc-btn primary" type="button" @click="submit">保存</button></div></template>
  </el-drawer>
</template>

<style scoped>
.ete-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.ete-wide { grid-column: 1 / -1; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; margin-bottom: 12px; }
.rc-field label { display: block; margin-bottom: 4px; color: var(--rc-muted); font-size: 11px; }
.rc-input, .rc-select { width: 100%; box-sizing: border-box; border: 1px solid #dbe3ee; border-radius: 6px; padding: 6px 8px; background: #fff; color: var(--rc-text); font-size: 12px; }
.ete-title { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
.ete-table { min-width: 1120px; }
.ete-table td { padding: 6px; }
.ete-number { width: 72px; }
.ete-actions { white-space: nowrap; }
.ete-actions button { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; }
.ete-actions button.danger { color: #dc2626; }
.ete-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
