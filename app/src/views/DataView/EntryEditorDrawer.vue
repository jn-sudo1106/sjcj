<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { pinyin } from 'pinyin-pro'
import { entryApi, type EntryField, type EntryType } from '../../api'
import {
  ENTRY_FIELD_DEFAULT_WIDTH, ENTRY_PREPROCESS_PRESETS,
  ENTRY_CHECK_RULE_PRESETS, entryCheckRuleLabel,
} from '../../constants/entry'

const props = defineProps<{ modelValue: boolean; entry?: EntryType | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [tableId: string] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// ---- 抽屉宽度（2026-10-10：字段定义列多且长，支持拖左边缘拉宽；拖过就记住） ----
// 用 el-drawer 原生 resizable（官方 useResizable，rtl 下把手在左边缘），
// 松手时 resize-end 事件回传最终宽度，这里负责持久化 + 下次打开沿用。
const DRAWER_WIDTH_KEY = 'rc.dataview.entryEditor.drawerWidth'
const DRAWER_WIDTH_DEFAULT = 760
const DRAWER_WIDTH_MIN = 560
function readDrawerWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(DRAWER_WIDTH_KEY))
    return Number.isFinite(value) && value >= DRAWER_WIDTH_MIN ? value : DRAWER_WIDTH_DEFAULT
  } catch {
    return DRAWER_WIDTH_DEFAULT
  }
}
const drawerWidth = ref(readDrawerWidth())
const drawerSize = computed(() => `${drawerWidth.value}px`)
function writeDrawerWidth(width: number): void {
  try {
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(Math.round(width)))
  } catch {
    /* 存不下就算了，下次退回默认宽度 */
  }
}
/** 官方 resizable 拖拽松手：size 是最终像素宽，写入本地偏好供下次打开沿用 */
function onResizeEnd(_evt: MouseEvent, size: number) {
  drawerWidth.value = Math.max(DRAWER_WIDTH_MIN, Math.round(size))
  writeDrawerWidth(drawerWidth.value)
}
const form = reactive<EntryType>({ tableId: '', tableName: '', name: '', remark: '', fields: [] })
/** 1013 字段必填校验：行内标红集合，存 `${index}:prop` / `${index}:desc`（提交拦截时空行输入框标红，输入即清） */
const invalidFields = ref<Set<string>>(new Set())
function fieldInvalidKey(index: number, key: 'prop' | 'desc'): string {
  return `${index}:${key}`
}
function isFieldInvalid(index: number, key: 'prop' | 'desc'): boolean {
  return invalidFields.value.has(fieldInvalidKey(index, key))
}
function clearFieldInvalid(index: number, key: 'prop' | 'desc') {
  const next = new Set(invalidFields.value)
  next.delete(fieldInvalidKey(index, key))
  invalidFields.value = next
}
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

function preprocessSuggestions(query: string, cb: (results: { value: string }[]) => void) {
  const options = ENTRY_PREPROCESS_PRESETS.filter((p) => !query || p.includes(query))
  cb(options.map((value) => ({ value })))
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
    dedupMode: entry?.dedupMode ?? 'source',
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
/**
 * 删除后把**新增行**的 K 序补齐，不留空洞（对齐旧平台 EntryTypeEdit.delItem）。
 *
 * 为什么必须补：`columnName` 是前端定的，后端照单收（entryTypeToLegacy 原样发 columnName）。
 * 2026-08-28 生产实测 77 张表，K 序**全部连续、零空洞**——没有先例说明后端能处理空洞，
 * 别拿生产当试验场。而我们原来的实现会漏出空洞：连加 K5/K6/K7 再删 K6，就剩 K5、K7。
 *
 * 为什么是安全的：**只有新增行可删**（itemId <= 0，见上面的 return），所以重排永远只动
 * 还没落库的行；已落库字段（itemId > 0）的 columnName **一个都不碰**——那才是会让
 * 已入库数据错位的操作。旧平台的重排也是这个前提下才成立的。
 */
function compactNewColumnNames() {
  let next = 0
  for (const f of form.fields) {
    if (Number(f.itemId ?? 0) <= 0) continue
    const m = /^K(\d+)$/.exec(f.columnName ?? '')
    if (m) next = Math.max(next, Number(m[1]))
  }
  for (const f of form.fields) {
    if (Number(f.itemId ?? 0) > 0) continue
    next += 1
    f.columnName = `K${next}`
  }
}
/** 已落库字段（itemId > 0），且有编码或展示名 —— 真正的"物理列绑着数据"，不可删 */
function isLockedField(field: EntryField): boolean {
  return Number(field.itemId ?? 0) > 0 && !!(field.prop?.trim() || field.desc?.trim())
}
/** 已落库但编码/展示名全空 —— 脏数据（缺校验时被存进表定义），允许清理 */
function isDirtyField(field: EntryField): boolean {
  return Number(field.itemId ?? 0) > 0 && !field.prop?.trim() && !field.desc?.trim()
}
function removeField(index: number) {
  const field = form.fields[index]
  if (Number(field.itemId ?? 0) > 0) {
    // 已落库字段不可删：物理列已绑数据。以前这里静默 return，按钮又没禁用样式，
    // 点了毫无反应——必须说清楚为什么（2026-10 用户反馈「没有提示」）。
    //
    // 例外：**空编码且空展示名的已落库行**（2026-10 用户在生产表 6200039 实测的脏数据：
    // 新平台此前缺「编码/展示名非空」校验，空行被存进了表定义）。这种行物理列上
    // 从没写过业务值，属于脏数据，允许清理——但必须二次确认，因为后端
    // modifyEntryType 对 items 变少是否会 DROP 物理列未经契约确认，删的是定义、
    // 物理列可能残留（残留列无定义引用，不影响保存）。
    if (!field.prop?.trim() && !field.desc?.trim()) {
      ElMessageBox.confirm(
        `该字段（${field.columnName ?? ''}）编码和展示名均为空，是脏数据，将从表定义中移除。\n确认删除？`,
        '删除脏字段',
        { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
      )
        .then(() => {
          form.fields.splice(index, 1)
          form.fields.forEach((f, i) => { f.seq = i + 1 })
          compactNewColumnNames()
        })
        .catch(() => { /* 用户取消，不动 */ })
      return
    }
    ElMessage.warning('该字段已落库，物理列绑着数据，不能删除')
    return
  }
  form.fields.splice(index, 1)
  form.fields.forEach((f, i) => { f.seq = i + 1 })
  compactNewColumnNames()
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

// 导入字段（0828 D13，原「批量加」）。会上定的交互：**既能粘文本，也能选文件；
// 选了文件就把内容读进同一个文本框再点确定**——原话「他选一个文件，然后可以把它文件展出来，
// 就直接上面贴，然后点确定」。不做独立的文件解析分支，用户能看见解析成什么样。
async function openBatchAdd() {
  batchDialog.text = 'code:编码:100\nname:名称:200\nurl:url:500'
  batchDialog.visible = true
}
async function onPickImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  batchDialog.text = await file.text()
  input.value = '' // 允许连续选同一个文件
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
  // 编码 / 展示名逐字段非空（对齐旧 EntryTypeEdit 的 requireRule：'属性不能为空'/'描述不能为空'，
  // 提交走 aFrom.validate 拦截）。此前漏了这条，空编码字段会被存进库、落库后删不掉。
  const emptyFields = form.fields
    .map((f, index) => ({ index, emptyCode: !f.prop.trim(), emptyDesc: !f.desc.trim() }))
    .filter((e) => e.emptyCode || e.emptyDesc)
  if (emptyFields.length) {
    // 1013：把空的编码/展示名输入框标红，让用户一眼看到是哪一行缺了（不只弹笼统提示）
    invalidFields.value = new Set(
      emptyFields.flatMap((e) => [
        ...(e.emptyCode ? [fieldInvalidKey(e.index, 'prop')] : []),
        ...(e.emptyDesc ? [fieldInvalidKey(e.index, 'desc')] : []),
      ]),
    )
    ElMessage.warning('出错，属性不能为空')
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
  <el-drawer v-model="visible" title="数据表编辑" :size="drawerSize" resizable append-to-body @resize-end="onResizeEnd">
    <div class="ete-grid">
      <div v-if="isEdit" class="rc-field"><label>表ID</label><input class="rc-input" :value="form.tableId" disabled /></div>
      <div class="rc-field"><label>名称</label><input v-model="form.name" class="rc-input" @input="onNameInput" /></div>
      <div class="rc-field"><label>物理表</label><input v-model="form.tableName" class="rc-input" :disabled="isEdit" :title="isEdit ? '物理表名已落库，不允许修改（改错会让表配置指向不存在的物理表）' : ''" placeholder="例如 tb_entry_news" data-testid="entry-table-name" @input="onTableNameInput" /></div>
      <div class="rc-field"><label>去重列</label><input class="rc-input" :value="form.keyField || '—'" disabled /></div>
      <div class="rc-field"><label>去重方式</label>
        <select v-model="form.dedupMode" class="rc-input" data-testid="entry-dedup-mode">
          <option value="source">源内去重</option>
          <option value="table">表内去重</option>
        </select>
      </div>
      <div class="rc-field ete-wide"><label>备注</label><textarea v-model="form.remark" class="rc-input" rows="2" /></div>
    </div>

    <div class="ete-title"><strong>字段定义</strong>
      <span>
        <button class="rc-btn" type="button" @click="openBatchAdd">导入字段</button>
      </span>
    </div>
    <!-- 加属性只保留一个，放在字段表下方（0828 D14）。本抽屉原本只有顶部那一个，
         挪到表下是为了跟画布侧的表编辑弹窗位置一致。 -->
    <div class="rc-table-scroll">
      <table class="rc-data-table ete-table">
        <thead><tr><th style="width: 44px">序号</th><th>编码<span class="ete-required" aria-hidden="true">*</span></th><th>展示名<span class="ete-required" aria-hidden="true">*</span></th><th style="width: 70px">数据库列</th><th style="width: 96px">类型</th><th style="width: 110px">校验</th><th>预处理</th><th style="width: 44px">去重</th><th style="width: 44px">必填</th><th style="width: 64px">列宽</th><th style="width: 90px">操作</th></tr></thead>
        <tbody>
          <tr v-for="(field, index) in form.fields" :key="field.itemId || index">
            <td>{{ field.seq ?? index + 1 }}</td>
            <td><input v-model="field.prop" class="rc-input" :class="{ 'is-invalid': isFieldInvalid(index, 'prop') }" :aria-required="true" :aria-invalid="isFieldInvalid(index, 'prop')" placeholder="必填" @input="clearFieldInvalid(index, 'prop')" @blur="onItemCodeBlur(field)" /></td>
            <td><input v-model="field.desc" class="rc-input" :class="{ 'is-invalid': isFieldInvalid(index, 'desc') }" :aria-required="true" :aria-invalid="isFieldInvalid(index, 'desc')" placeholder="必填" @input="clearFieldInvalid(index, 'desc')" /></td>
            <td><input class="rc-input" :value="field.columnName" disabled /></td>
            <td>
              <select v-model="field.type" class="rc-select">
                <option value="string">string</option>
                <option value="text">text</option>
                <option value="longtext">longtext</option>
              </select>
            </td>
            <td>
              <!-- 校验：旧平台是可搜索下拉且能补自定义值（handleNextSearch），这里用 allow-create 等价 -->
              <el-select v-model="field.checkRule" filterable allow-create default-first-option placeholder="不校验" style="width: 100%">
                <el-option v-for="v in ENTRY_CHECK_RULE_PRESETS" :key="v" :label="entryCheckRuleLabel(v)" :value="v" />
              </el-select>
            </td>
            <td>
              <el-autocomplete v-model="field.preprocess" :fetch-suggestions="preprocessSuggestions" style="width: 100%" clearable />
            </td>
            <td><input v-model="field.dedup" type="checkbox" /></td>
            <td><input v-model="field.required" type="checkbox" /></td>
            <!-- 列宽放到最后（0828 D17） -->
            <td><input v-model.number="field.width" class="rc-input ete-number" type="number" /></td>
            <td class="ete-actions">
              <button type="button" @click="moveField(index, -1)">↑</button>
              <button type="button" @click="moveField(index, 1)">↓</button>
              <!-- 已落库字段不可删：用禁用态而不是隐藏，否则用户看不出"为什么这行没有删除按钮"。
                   2026-10 起改为 aria-disabled + 点击弹提示（原来纯 disabled 不触发点击，点红按钮毫无反应）。
                   例外：空编码且空展示名的已落库行是脏数据（缺校验时被存进去的），给可删样式、二次确认后清掉。 -->
              <button
                type="button"
                class="danger"
                :class="{ 'is-locked': isLockedField(field) }"
                :aria-disabled="isLockedField(field)"
                :title="isLockedField(field)
                  ? '该字段已落库，物理列绑着数据，不能删除'
                  : (isDirtyField(field) ? '该字段编码和展示名为空，是脏数据，可删除' : '删除')"
                @click="removeField(index)"
              >删</button>
            </td>
          </tr>
        </tbody>
      </table>
      <button class="ete-addrow" type="button" @click="addField">＋ 新增字段</button>
    </div>

    <!-- 「高级」：本期只做**校验 / 校验脚本**（0828 D15 原本整块暂缓，2026-08-28 拍板校验要做）。
         记变化同属旧平台这一行，但本期隐藏，见下方注释。 -->
    <div class="ete-adv-toggle" @click="advancedOpen = !advancedOpen">高级 {{ advancedOpen ? '▲' : '▼' }}</div>
    <div v-if="advancedOpen" class="ete-grid">
      <!-- 「记变化」（recFlag）2026-08-28 拍板隐藏：本期只做校验。
           **只隐藏控件，不动数据**——reset 仍回填、提交仍原样带回，后端已有值不会被这次保存抹掉。
           要恢复就把下面这段注释还原成控件。 -->
      <div class="rc-field">
        <label>校验</label>
        <select v-model="form.checkFlag" class="rc-select" data-testid="entry-check-flag">
          <option value="">请选择</option>
          <option value="1">校验(失败进err库)</option>
          <option value="0">不校验</option>
        </select>
      </div>
      <div class="rc-field ete-wide"><label>校验脚本</label><input v-model="form.checkRule" class="rc-input" placeholder="校验通过的数据行才能入库" /></div>
    </div>
    <template #footer><div class="ete-foot"><button class="rc-btn" type="button" @click="visible = false">取消</button><button class="rc-btn primary" type="button" @click="submit">保存</button></div></template>
  </el-drawer>

  <el-dialog v-model="batchDialog.visible" title="导入字段" width="480px" append-to-body>
    <div class="ete-import-head">
      <label class="rc-btn ete-import-file">
        选择文件…
        <input type="file" accept=".csv,.txt" data-testid="import-fields-file" @change="onPickImportFile" />
      </label>
      <span class="ete-import-hint">支持 .csv / .txt；选完会把内容填到下面，可再编辑</span>
    </div>
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
/* 1013 字段必填：编码/展示名列头红星 + 空值输入框红框提示 */
.ete-required { color: #f5222d; margin-left: 2px; }
.rc-input.is-invalid { border-color: #f5222d; background: #fff7f7; }
.rc-input.is-invalid:focus { border-color: #f5222d; box-shadow: 0 0 0 3px rgba(245, 34, 45, 0.12); }
.ete-title { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
.ete-title span { display: flex; gap: 8px; }
.ete-table { min-width: 1220px; }
.ete-table td { padding: 6px; }
.ete-number { width: 72px; }
.ete-actions { white-space: nowrap; }
.ete-actions button { border: 0; background: transparent; color: var(--rc-primary); cursor: pointer; }
.ete-actions button.danger { color: #dc2626; }
/* 已落库行：删除按钮置灰，一眼看出不能删（2026-10 补；此前缺这条，禁用按钮仍是红色、看着能点） */
.ete-actions button.danger.is-locked { color: var(--rc-border); cursor: not-allowed; }
.ete-addrow { width: 100%; height: 34px; border: 0; border-top: 1px solid var(--rc-border-soft); background: #fbfdff; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.ete-addrow:hover { background: var(--rc-primary-bg); }
.ete-adv-toggle { margin: 12px 0 8px; font-size: 12px; font-weight: 600; color: var(--rc-primary-ink); cursor: pointer; }
.ete-import-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ete-import-file { position: relative; overflow: hidden; cursor: pointer; }
.ete-import-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.ete-import-hint { color: var(--rc-faint); font-size: 11px; }
.ete-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
