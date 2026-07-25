<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { entryApi, type EntryType, type EntryField } from '../../../api'

const props = defineProps<{ open: boolean; tableId?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [string] }>()

const FIELD_TYPES = ['string', 'text', 'longtext', 'url', 'number', 'date', 'json'] as const

interface FieldVM {
  dbColumn: string
  code: string
  desc: string
  type: string
  validate: string
  width: number
  preprocess: string
  dedup: boolean
}
const form = reactive({
  tableId: '',
  name: '',
  tableName: '',
  remark: '',
  recordChange: '',
  validate: '',
  validateScript: '',
  fields: [] as FieldVM[],
})
const loading = ref(false)
const touched = ref(false)

const isEdit = computed(() => !!props.tableId)
const tableNameError = computed(() => (touched.value && !form.tableName.trim() ? '表名必填' : ''))

// prop "feed_id-K1" → { code: 'feed_id', dbColumn: 'K1' }
function splitProp(prop: string): { code: string; dbColumn: string } {
  const m = prop.match(/^(.*)-(K\d+)$/)
  if (m) return { code: m[1], dbColumn: m[2] }
  return { code: prop, dbColumn: '' }
}
function blankField(seq: number): FieldVM {
  return { dbColumn: `K${seq}`, code: '', desc: '', type: 'string', validate: '', width: 255, preprocess: '', dedup: false }
}
function nextDbColumn(): string {
  const used = form.fields.map((f) => Number((f.dbColumn.match(/^K(\d+)$/) || [])[1] || 0))
  return `K${Math.max(0, ...used) + 1}`
}

function resetFromTable(t?: EntryType) {
  touched.value = false
  if (!t) {
    form.tableId = ''
    form.name = ''
    form.tableName = ''
    form.remark = ''
    form.fields = []
    return
  }
  form.tableId = t.tableId
  form.name = t.name || ''
  form.tableName = t.tableName
  form.remark = t.remark || ''
  form.fields = t.fields.map((f, i) => {
    const { code, dbColumn } = splitProp(f.prop)
    return {
      dbColumn: dbColumn || `K${i + 1}`,
      code,
      desc: f.desc,
      type: f.type,
      validate: '',
      width: f.width ?? 255,
      preprocess: f.preprocess ?? '',
      dedup: !!f.dedup,
    }
  })
}

watch(
  () => props.open,
  async (v) => {
    if (!v) return
    if (props.tableId) {
      loading.value = true
      try {
        resetFromTable(await entryApi.entryDetail(props.tableId))
      } finally {
        loading.value = false
      }
    } else {
      resetFromTable()
    }
  },
  { immediate: true },
)

function addField() {
  form.fields.push({ ...blankField(1), dbColumn: nextDbColumn() })
}
function removeField(i: number) {
  form.fields.splice(i, 1)
}

function validate(): string {
  if (!form.tableName.trim()) return '物理表名必填'
  if (!form.fields.length) return '至少添加一个字段'
  const codes = form.fields.map((f) => f.code.trim()).filter(Boolean)
  if (new Set(codes).size !== codes.length) return '字段编码不可重复'
  return ''
}

async function onSave() {
  touched.value = true
  const err = validate()
  if (err) {
    ElMessage.warning(err)
    return
  }
  const entry: EntryType = {
    tableId: form.tableId,
    tableName: form.tableName.trim(),
    name: form.name.trim(),
    remark: form.remark.trim(),
    fields: form.fields.map<EntryField>((f) => ({
      prop: f.dbColumn ? `${f.code || f.dbColumn.toLowerCase()}-${f.dbColumn}` : f.code,
      desc: f.desc,
      type: f.type as EntryField['type'],
      required: false,
      width: f.width,
      preprocess: f.preprocess || undefined,
      dedup: f.dedup || undefined,
    })),
  }
  const res = await entryApi.entrySave(entry)
  ElMessage.success(res?.message || '已保存（演示）')
  emit('saved', res.tableId)
  close()
}
function close() {
  emit('update:open', false)
}
function notImpl(label: string) {
  ElMessage.info(`${label}：二期`)
}
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="isEdit ? '数据表编辑' : '新建数据表'"
    width="980px"
    :close-on-click-modal="false"
    @update:model-value="close"
  >
    <div v-loading="loading" class="ted">
      <!-- 表级 -->
      <div class="ted-meta">
        <div class="ted-field">
          <label><i class="req">*</i>名称</label>
          <input v-model="form.name" class="ted-input" placeholder="表显示名" />
        </div>
        <div class="ted-field">
          <label><i class="req">*</i>物理表</label>
          <input v-model="form.tableName" class="ted-input" :class="{ err: tableNameError }" placeholder="如 sense_data.TB_XXX" @blur="touched = true" />
          <div v-if="tableNameError" class="ted-err">{{ tableNameError }}</div>
        </div>
        <div class="ted-field">
          <label>备注</label>
          <input v-model="form.remark" class="ted-input" placeholder="可选" />
        </div>
        <div class="ted-meta-actions">
          <button class="rc-btn primary" type="button" @click="addField">＋ 加属性</button>
          <button class="rc-btn ghost" type="button" @click="notImpl('批量加')">批量加</button>
          <button class="rc-btn ghost" type="button" @click="notImpl('高级')">高级</button>
        </div>
      </div>

      <!-- 高级占位行 -->
      <div class="ted-meta2">
        <div class="ted-field sm">
          <label>记变化</label>
          <select class="ted-input" disabled><option>请选择</option></select>
        </div>
        <div class="ted-field sm">
          <label>校验</label>
          <select class="ted-input" disabled><option>请选择</option></select>
        </div>
        <div class="ted-field grow">
          <label>校验脚本</label>
          <input class="ted-input" disabled placeholder="校验通过的数据行才能入库（二期）" />
        </div>
      </div>

      <!-- 字段表 -->
      <div class="ted-table-wrap">
        <table class="ted-table">
          <thead>
            <tr>
              <th style="width:48px">序号</th>
              <th style="width:72px">数据库列</th>
              <th>编码</th>
              <th>展示名</th>
              <th style="width:110px">类型</th>
              <th style="width:96px">校验</th>
              <th style="width:120px">预处理</th>
              <th style="width:56px">去重</th>
              <th style="width:80px">列宽</th>
              <th style="width:44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(f, i) in form.fields" :key="i">
              <td class="muted">{{ i + 1 }}</td>
              <td class="muted mono">{{ f.dbColumn }}</td>
              <td><input v-model="f.code" class="ted-cell" /></td>
              <td><input v-model="f.desc" class="ted-cell" /></td>
              <td>
                <select v-model="f.type" class="ted-cell">
                  <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td><select class="ted-cell" disabled><option>-不校验-</option></select></td>
              <td><input v-model="f.preprocess" class="ted-cell" placeholder="如 trim" /></td>
              <td class="center"><input v-model="f.dedup" type="checkbox" class="ted-check" /></td>
              <td><input v-model.number="f.width" type="number" class="ted-cell" /></td>
              <td class="center"><button class="ted-del" type="button" title="删除" @click="removeField(i)">✕</button></td>
            </tr>
          </tbody>
        </table>
        <button class="ted-addrow" type="button" @click="addField">＋ 新增属性</button>
      </div>
    </div>

    <template #footer>
      <button class="rc-btn" type="button" @click="close">取消</button>
      <button class="rc-btn primary" type="button" @click="onSave">确定</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ted { display: flex; flex-direction: column; gap: 14px; }
.ted-meta { display: grid; grid-template-columns: repeat(3, 1fr) auto; gap: 12px 16px; align-items: end; }
.ted-meta2 { display: flex; gap: 16px; align-items: end; }
.ted-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ted-field.sm { width: 130px; flex: none; }
.ted-field.grow { flex: 1; }
.ted-field label { font-size: 12px; color: var(--rc-text-2); }
.ted-field .req { color: #ef4444; font-style: normal; margin-right: 2px; }
.ted-meta-actions { display: flex; gap: 8px; align-items: end; }
.ted-input { height: 32px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: 6px; font-size: 13px; outline: none; background: #fff; }
.ted-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ted-input.err { border-color: #f87171; }
.ted-input[readonly], .ted-input[disabled] { background: #f8fafc; color: var(--rc-faint); }
.ted-err { color: #ef4444; font-size: 11px; }

.ted-table-wrap { border: 1px solid var(--rc-border); border-radius: 8px; overflow: hidden; }
.ted-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ted-table th { background: #f8fafc; color: var(--rc-text-2); font-weight: 700; text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--rc-border); }
.ted-table td { padding: 5px 8px; border-bottom: 1px solid var(--rc-border-soft); }
.ted-table td.center { text-align: center; }
.ted-table td.muted { color: var(--rc-faint); }
.ted-table td.mono { font-family: var(--rc-mono, monospace); }
.ted-cell { width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--rc-border); border-radius: 5px; font-size: 12px; outline: none; background: #fff; box-sizing: border-box; }
.ted-cell:focus { border-color: #60a5fa; }
.ted-cell[disabled] { background: #f8fafc; color: var(--rc-faint); }
.ted-check { width: 16px; height: 16px; margin: 0; vertical-align: middle; accent-color: var(--rc-primary); }
.ted-del { width: 24px; height: 24px; border: 0; background: transparent; color: var(--rc-faint); cursor: pointer; border-radius: 5px; font-size: 13px; }
.ted-del:hover { background: #fef2f2; color: #ef4444; }
.ted-addrow { width: 100%; height: 36px; border: 0; border-top: 1px solid var(--rc-border-soft); background: #fbfdff; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.ted-addrow:hover { background: var(--rc-primary-bg); }

.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn.ghost { background: transparent; }
.rc-btn:hover { border-color: #bfdbfe; }
.rc-btn.primary:hover { opacity: 0.92; }
</style>
