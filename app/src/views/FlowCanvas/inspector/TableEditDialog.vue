<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { entryApi, type EntryType, type EntryField } from '@/api'
import { pinyin } from 'pinyin-pro'
import { ENTRY_PREPROCESS_PRESETS, ENTRY_CHECK_RULE_PRESETS, entryCheckRuleLabel } from '@/constants/entry'

const props = defineProps<{ open: boolean; tableId?: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; saved: [string] }>()

// 字段类型照抄旧平台（旧 page/config/modules/EntryTypeEdit.vue 的 dataType 下拉**只有这三项**）。
// 2026-08-28 订正：此前还编了 url / number / date / json 四个后端不存在的类型，
// 与业务类型、抓取类型是同一类问题（0824-11 §1.2d：枚举一律照抄，不自造）。
const FIELD_TYPES = ['string', 'text', 'longtext'] as const

interface FieldVM {
  /** 已落库字段带后端 itemId（> 0）；新增行没有。删除限制与 K 序补齐都靠它区分 */
  itemId?: string
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
  dedupMode: 'source' as 'source' | 'table',
  recordChange: '',
  validate: '',
  validateScript: '',
  fields: [] as FieldVM[],
})
const loading = ref(false)
const touched = ref(false)
const advancedOpen = ref(false)

const isEdit = computed(() => !!props.tableId)
/**
 * 去重列：勾了「去重」的字段按 columnName 逗号连接（旧 EntryTypeEdit.uniqueKeyChange 同款）。
 * 旧平台顶部表单有这一项且只读——它不是独立字段，改要去下面的字段表勾「去重」。
 * 展示与保存共用这一个派生，避免"界面显示的"和"存进去的"两套算法。
 */
const keyField = computed(() => form.fields.filter((f) => f.dedup && f.dbColumn).map((f) => f.dbColumn).join(','))

/**
 * 新建时按名称拼音首字母生成物理表名 `TB_XXX`（旧 EntryTypeEdit 的 `watch form.typeName` 同款）。
 * 比旧平台多一条：**用户手改过物理表名就不再覆盖**——旧平台是无条件覆盖，改完名字手填的表名会被冲掉。
 * 与采集资产抽屉（EntryEditorDrawer）行为一致。
 */
const tableNameTouched = ref(false)
function onNameInput() {
  if (isEdit.value || tableNameTouched.value) return
  const letters = pinyin(form.name || '', { pattern: 'first', toneType: 'none', type: 'array' }).join('')
  form.tableName = letters ? `TB_${letters.toUpperCase()}` : ''
}
function onTableNameInput() { tableNameTouched.value = true }

/** 预处理候选：与采集资产抽屉共用同一份预设（照抄旧平台 clearRuleOptions） */
function preprocessSuggestions(query: string, cb: (results: { value: string }[]) => void) {
  const options = ENTRY_PREPROCESS_PRESETS.filter((p) => !query || p.includes(query))
  cb(options.map((value) => ({ value })))
}
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
/** 已落库字段：物理列已绑数据，不可删、K 序不可改（对齐旧 EntryTypeEdit 的 itemId<=0 判定） */
function isPersisted(f: FieldVM): boolean {
  return Number(f.itemId ?? 0) > 0
}
function nextDbColumn(): string {
  const used = form.fields.map((f) => Number((f.dbColumn.match(/^K(\d+)$/) || [])[1] || 0))
  return `K${Math.max(0, ...used) + 1}`
}

function resetFromTable(t?: EntryType) {
  touched.value = false
  tableNameTouched.value = !!t?.tableId
  if (!t) {
    form.tableId = ''
    form.name = ''
    form.tableName = ''
    form.remark = ''
    form.dedupMode = 'source'
    form.fields = []
    return
  }
  form.tableId = t.tableId
  form.name = t.name || ''
  form.tableName = t.tableName
  form.remark = t.remark || ''
  // 去重方式的编辑入口已挪到「表配置」（0824-00 §6.3：查看/编辑表只操作表资产）；
  // 这里只把原值带着走，保存时原样回写，避免编辑一次表就把它重置成源内去重。
  form.dedupMode = t.dedupMode || 'source'
  // null/undefined → ''：与 option value="" 的「请选择」对齐，提交时空串 = 未配置
  form.recordChange = t.recFlag == null ? '' : String(t.recFlag)
  form.validate = t.checkFlag == null ? '' : String(t.checkFlag)
  form.validateScript = t.checkRule ?? ''
  form.fields = t.fields.map((f, i) => {
    const { code, dbColumn } = splitProp(f.prop)
    return {
      itemId: f.itemId,
      dbColumn: dbColumn || f.columnName || `K${i + 1}`,
      code,
      desc: f.desc,
      type: f.type,
      validate: f.checkRule ?? '',
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
/** 编码失焦时补展示名（旧 EntryTypeEdit.vue 的 handleBlurCode：展示名为空才填，不覆盖已填的） */
function onCodeBlur(field: FieldVM) {
  if (field.code.trim() && !field.desc.trim()) field.desc = field.code.trim()
}
/**
 * 删除字段。**只有新增行可删**（旧 EntryTypeEdit 的删除图标就带 `itemId <= 0` 条件）——
 * 已落库字段的物理列绑着数据，删掉定义会让已入库数据对不上列。
 */
function removeField(i: number) {
  if (isPersisted(form.fields[i])) return
  form.fields.splice(i, 1)
  compactNewColumnNames()
}
/**
 * 删除后把**新增行**的 K 序补齐，不留空洞。
 * 2026-08-28 生产实测 77 张表 K 序全部连续，`columnName` 又是前端定的、后端照单收，
 * 不能给后端漏空洞。已落库字段的 K 一个都不碰（历史数据里本就存在的空洞是既成事实）。
 */
function compactNewColumnNames() {
  let next = 0
  for (const f of form.fields) {
    if (!isPersisted(f)) continue
    const m = /^K(\d+)$/.exec(f.dbColumn)
    if (m) next = Math.max(next, Number(m[1]))
  }
  for (const f of form.fields) {
    if (isPersisted(f)) continue
    next += 1
    f.dbColumn = `K${next}`
  }
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
    dedupMode: form.dedupMode,
    keyField: keyField.value,
    recFlag: form.recordChange || undefined,
    checkFlag: form.validate || undefined,
    checkRule: form.validateScript || undefined,
    fields: form.fields.map<EntryField>((f, i) => ({
      prop: f.dbColumn ? `${f.code || f.dbColumn.toLowerCase()}-${f.dbColumn}` : f.code,
      desc: f.desc,
      type: f.type as EntryField['type'],
      required: false,
      width: f.width,
      preprocess: f.preprocess || undefined,
      dedup: f.dedup || undefined,
      checkRule: f.validate || undefined,
      itemId: f.itemId,
      columnName: f.dbColumn,
      seq: i + 1,
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
// 导入字段（0828 D13，原「批量加」）：粘文本或选文件，选了文件就把内容读进同一个文本框再确定
// （会上原话「他选一个文件，然后可以把它文件展出来，就直接上面贴，然后点确定」）。
// 与采集资产侧 EntryEditorDrawer 的实现保持一致，格式同为 `编码:展示名:列宽` 一行一条。
const importDialog = reactive<{ visible: boolean; text: string }>({ visible: false, text: '' })
function openImport() {
  importDialog.text = 'code:编码:100\nname:名称:200\nurl:url:500'
  importDialog.visible = true
}
async function onPickImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importDialog.text = await file.text()
  input.value = ''
}
function submitImport() {
  importDialog.text.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const [code, desc, widthStr] = line.split(':')
    if (!code?.trim()) return
    form.fields.push({
      ...blankField(1),
      dbColumn: nextDbColumn(),
      code: code.trim(),
      desc: desc?.trim() || code.trim(),
      width: widthStr?.trim() ? Number(widthStr.trim()) : 255,
    })
  })
  importDialog.visible = false
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
          <input v-model="form.name" class="ted-input" placeholder="表显示名" @input="onNameInput" />
        </div>
        <div class="ted-field">
          <label><i class="req">*</i>物理表</label>
          <input
            v-model="form.tableName"
            class="ted-input"
            :class="{ err: tableNameError }"
            placeholder="如 sense_data.TB_XXX"
            @input="onTableNameInput"
            @blur="touched = true"
          />
          <div v-if="tableNameError" class="ted-err">{{ tableNameError }}</div>
        </div>
        <!-- 去重列（旧平台顶部表单同款位置）：只读，由字段表的「去重」勾选实时派生 -->
        <div class="ted-field">
          <label>去重列</label>
          <input
            class="ted-input"
            :value="keyField || '—'"
            readonly
            data-testid="ted-key-field"
            title="按这些字段判断数据是否重复；改动请在下方字段表勾选「去重」"
          />
        </div>
        <div class="ted-field">
          <label>备注</label>
          <input v-model="form.remark" class="ted-input" placeholder="可选" />
        </div>
        <!-- 加属性只保留字段表下方那一个（0828 D14）；「高级」本期不做（D15） -->
        <div class="ted-meta-actions">
          <button class="rc-btn ghost" type="button" data-testid="import-fields-open" @click="openImport">导入字段</button>
        </div>
      </div>

      <!-- 「高级」：本期只做**校验 / 校验脚本**，与采集资产侧同款；字段沿用旧 checkFlag / checkRule。
           记变化（recFlag）本期隐藏，见下方注释。 -->
      <div class="ted-adv-toggle" @click="advancedOpen = !advancedOpen">高级 {{ advancedOpen ? '▲' : '▼' }}</div>
      <div v-if="advancedOpen" class="ted-meta2">
        <!-- 「记变化」（recFlag）2026-08-28 拍板隐藏：本期只做校验。
           **只隐藏控件，不动数据**——reset 仍回填、提交仍原样带回，后端已有值不会被这次保存抹掉。
           要恢复就把下面这段注释还原成控件。 -->
        <div class="ted-field sm">
          <label>校验</label>
          <select v-model="form.validate" class="ted-input" data-testid="ted-check-flag">
            <option value="">请选择</option>
            <option value="1">校验(失败进err库)</option>
            <option value="0">不校验</option>
          </select>
        </div>
        <div class="ted-field grow">
          <label>校验脚本</label>
          <input v-model="form.validateScript" class="ted-input" placeholder="校验通过的数据行才能入库" />
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
              <th style="width:120px">校验</th>
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
              <td><input v-model="f.code" class="ted-cell" @blur="onCodeBlur(f)" /></td>
              <td><input v-model="f.desc" class="ted-cell" /></td>
              <td>
                <select v-model="f.type" class="ted-cell">
                  <option v-for="t in FIELD_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td>
                <!-- 校验：旧平台可搜索下拉且能补自定义值，用 allow-create 等价 -->
                <el-select v-model="f.validate" size="small" filterable allow-create default-first-option placeholder="不校验" style="width: 100%">
                  <el-option v-for="v in ENTRY_CHECK_RULE_PRESETS" :key="v" :label="entryCheckRuleLabel(v)" :value="v" />
                </el-select>
              </td>
              <td>
                <el-autocomplete
                  v-model="f.preprocess"
                  :fetch-suggestions="preprocessSuggestions"
                  size="small"
                  placeholder="如 trim"
                  style="width: 100%"
                  clearable
                />
              </td>
              <td class="center"><input v-model="f.dedup" type="checkbox" class="ted-check" /></td>
              <td><input v-model.number="f.width" type="number" class="ted-cell" /></td>
              <td class="center">
                <!-- 已落库字段不可删（§3.1）。**用禁用态的 ✕ 而不是空白或「—」**：
                     整列「—」看起来像功能坏了（2026-08-28 实测反馈），禁用按钮 + 悬浮说明才讲得清为什么不能删。 -->
                <button
                  class="ted-del"
                  type="button"
                  :disabled="isPersisted(f)"
                  :title="isPersisted(f) ? '该字段已落库，物理列绑着数据，不能删除；如需停用请改用其他方式' : '删除'"
                  :data-testid="isPersisted(f) ? 'ted-del-locked' : 'ted-del'"
                  @click="removeField(i)"
                >✕</button>
              </td>
            </tr>
          </tbody>
        </table>
        <button class="ted-addrow" type="button" @click="addField">＋ 新增字段</button>
      </div>
    </div>

    <template #footer>
      <button class="rc-btn" type="button" @click="close">取消</button>
      <button class="rc-btn primary" type="button" @click="onSave">确定</button>
    </template>
  </el-dialog>

  <el-dialog v-model="importDialog.visible" title="导入字段" width="480px" append-to-body>
    <div class="ted-import-head">
      <label class="rc-btn ted-import-file">
        选择文件…
        <input type="file" accept=".csv,.txt" data-testid="import-fields-file" @change="onPickImportFile" />
      </label>
      <span class="ted-import-hint">支持 .csv / .txt；选完会把内容填到下面，可再编辑</span>
    </div>
    <textarea v-model="importDialog.text" class="ted-input ted-import-text" rows="8" placeholder="编码:展示名:列宽，一行一个" />
    <template #footer>
      <button class="rc-btn" type="button" @click="importDialog.visible = false">取消</button>
      <button class="rc-btn primary" type="button" data-testid="import-fields-submit" @click="submitImport">确定</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ted { display: flex; flex-direction: column; gap: 14px; }
.ted-meta { display: grid; grid-template-columns: repeat(4, 1fr) auto; gap: 12px 16px; align-items: end; }
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
.ted-adv-toggle { font-size: 12px; font-weight: 600; color: var(--rc-primary-ink); cursor: pointer; }
.ted-import-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ted-import-file { position: relative; overflow: hidden; cursor: pointer; }
.ted-import-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.ted-import-hint { color: var(--rc-faint); font-size: 11px; }
.ted-import-text { width: 100%; box-sizing: border-box; height: auto; padding: 8px 10px; font-family: var(--rc-mono, monospace); }

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
.ted-del:hover:not(:disabled) { background: #fef2f2; color: #ef4444; }
.ted-del:disabled { color: var(--rc-border); cursor: not-allowed; }
.ted-addrow { width: 100%; height: 36px; border: 0; border-top: 1px solid var(--rc-border-soft); background: #fbfdff; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.ted-addrow:hover { background: var(--rc-primary-bg); }

.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 14px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 13px; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn.ghost { background: transparent; }
.rc-btn:hover { border-color: #bfdbfe; }
.rc-btn.primary:hover { opacity: 0.92; }
</style>
