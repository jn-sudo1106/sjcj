<script setup lang="ts">
// 表模板编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/QuestionTempEditModal.vue`）。
//
// 旧版这里有两处数据形状上的坑，迁移时保留了口径、修掉了崩溃：
// · tableArr / sqlTempConfigIds 在库里是 **JSON 字符串**，回显要 parse、提交要 stringify；
// · 「使用表范围」「sql模板」都是远程搜索多选，选项来自 /poc/database/entry-list 与 /poc/sql-temp/page。
//
// 与旧版的有意偏差（旧版缺陷）：
// 1. 旧版 JSON.parse 裸奔，任一字段是非法 JSON 就整页报错、弹窗打不开；这里解析失败按空处理并提示，
//    让用户重选后再保存（不静默把原值覆盖成空）。
// 2. 旧版 sql 模板回显固定 pageSize=10，选中超过 10 个时后面的只剩 id；这里按已选数量放宽。
// 3. 旧版提交不看校验结果，问句样例为空也提示「提交成功」；这里 required 直接拦下。
// 4. 旧版编辑时把整行（含 createTime/updateTime/delFlag）原样 POST 回去；只提交表单字段 + id。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { pocTableEntryList, sqlTemplateApi, tableTemplateApi } from '@/api/templateConfig'
import type { PocTableEntry, SqlTemplate, TableTemplate } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ name: '', rule: '', status: '0' })

// ---- 使用表范围（多选值 = 表名字符串数组，旧版 tableNameList）----
const tableNames = ref<string[]>([])
const tableOptions = ref<PocTableEntry[]>([])
const tableLoading = ref(false)
/** 见过的表都缓存下来：远程搜索会把选项列表整页换掉，已选项的中文名不能被换掉后丢失 */
const tableCache = new Map<string, PocTableEntry>()

// ---- sql模板（多选值 = sql 模板 id 数组，旧版 sqlTempConfigIdList）----
const sqlTempIds = ref<number[]>([])
const sqlTempOptions = ref<SqlTemplate[]>([])
const sqlLoading = ref(false)
const sqlCache = new Map<number, SqlTemplate>()

const title = computed(() => (recordId.value == null ? '新增模板' : '编辑模板'))

/** 旧版选项文案：表名【类型名】；类型名缺失（已选但当前选项里查不到）时只显示表名 */
function tableLabel(entry: PocTableEntry): string {
  return entry.typeName ? `${entry.tableName}【${entry.typeName}】` : entry.tableName
}

/** 远程搜索结果与已选项合并：已选但不在本次结果里的，用缓存补上，标签才不会退化成裸值 */
function mergeTableOptions(fresh: PocTableEntry[]) {
  fresh.forEach((entry) => tableCache.set(entry.tableName, entry))
  const inFresh = new Set(fresh.map((entry) => entry.tableName))
  const kept = tableNames.value
    .filter((name) => !inFresh.has(name))
    .map((name) => tableCache.get(name) ?? { tableName: name })
  tableOptions.value = [...kept, ...fresh]
}

function mergeSqlOptions(fresh: SqlTemplate[]) {
  fresh.forEach((entry) => {
    if (entry.id != null) sqlCache.set(Number(entry.id), entry)
  })
  const inFresh = new Set(fresh.map((entry) => Number(entry.id)))
  const kept = sqlTempIds.value
    .filter((id) => !inFresh.has(id))
    .map((id) => sqlCache.get(id) ?? { id, name: `#${id}` })
  sqlTempOptions.value = [...kept, ...fresh]
}

let tableSeq = 0
async function searchTables(name: string) {
  const seq = ++tableSeq
  tableLoading.value = true
  try {
    const list = await pocTableEntryList(name.trim())
    if (seq !== tableSeq) return
    mergeTableOptions(Array.isArray(list) ? list : [])
  } catch (err) {
    if (seq !== tableSeq) return
    ElMessage.error(err instanceof Error ? err.message : '加载数据表失败')
  } finally {
    if (seq === tableSeq) tableLoading.value = false
  }
}

let sqlSeq = 0
/** 名称搜索（旧 sqlTempConfigSearch）：固定取前 10 条，与旧版一致 */
async function searchSqlTemplates(name: string) {
  const seq = ++sqlSeq
  sqlLoading.value = true
  try {
    const res = await sqlTemplateApi.page({ pageNo: 1, pageSize: 10, name: name.trim() })
    if (seq !== sqlSeq) return
    mergeSqlOptions(res.list ?? [])
  } catch (err) {
    if (seq !== sqlSeq) return
    ElMessage.error(err instanceof Error ? err.message : '加载 sql 模板失败')
  } finally {
    if (seq === sqlSeq) sqlLoading.value = false
  }
}

/** 编辑回显：旧版把已选 id 连同 pageSize 一起发给分页端点反查名称 */
async function loadSqlTemplatesByIds(ids: number[]) {
  if (!ids.length) {
    sqlTempOptions.value = []
    return
  }
  const seq = ++sqlSeq
  sqlLoading.value = true
  try {
    const res = await sqlTemplateApi.page({ pageNo: 1, pageSize: Math.max(10, ids.length), name: '', ids })
    if (seq !== sqlSeq) return
    mergeSqlOptions(res.list ?? [])
  } catch (err) {
    if (seq !== sqlSeq) return
    ElMessage.error(err instanceof Error ? err.message : '加载 sql 模板失败')
  } finally {
    if (seq === sqlSeq) sqlLoading.value = false
  }
}

/** 后端这两个字段是 JSON 字符串；坏数据（非法 JSON / 不是数组）按空返回并标记 broken，让调用方提示用户 */
function parseJsonArray(raw: unknown): { list: unknown[]; broken: boolean } {
  if (raw === null || raw === undefined || raw === '') return { list: [], broken: false }
  if (Array.isArray(raw)) return { list: raw, broken: false }
  if (typeof raw !== 'string') return { list: [], broken: true }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? { list: parsed, broken: false } : { list: [], broken: true }
  } catch {
    return { list: [], broken: true }
  }
}

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增（status 默认 '0' 启用，同旧版） */
function open(record?: TableTemplate | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  form.name = record?.name == null ? '' : String(record.name)
  form.rule = record?.rule == null ? '' : String(record.rule)
  form.status = record?.status == null ? '0' : String(record.status)

  const parsedTables = parseJsonArray(record?.tableArr)
  tableNames.value = parsedTables.list.map(String)
  const parsedSql = parseJsonArray(record?.sqlTempConfigIds)
  sqlTempIds.value = parsedSql.list.map(Number).filter((id) => Number.isFinite(id))
  if (parsedTables.broken || parsedSql.broken) {
    ElMessage.warning('原「使用表范围」或「sql模板」数据格式无法解析，已按空处理，请重新选择后再保存')
  }

  void searchTables('')
  if (recordId.value == null) {
    sqlTempOptions.value = []
    sqlCache.clear()
  } else {
    void loadSqlTemplatesByIds(sqlTempIds.value)
  }
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写问句样例')
    return
  }
  const payload: Partial<TableTemplate> = {
    name: form.name,
    rule: form.rule,
    // 旧 QuestionTempEditModal.vue:142-143：两个数组按 JSON 字符串入库
    tableArr: JSON.stringify(tableNames.value),
    sqlTempConfigIds: JSON.stringify(sqlTempIds.value),
    status: form.status,
  }
  if (recordId.value != null) payload.id = recordId.value

  saving.value = true
  try {
    await tableTemplateApi.save(payload)
    ElMessage.success('提交成功')
    visible.value = false
    emit('saved', { mode: recordId.value == null ? 'add' : 'edit', id: recordId.value })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '提交失败')
  } finally {
    saving.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="900px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="tt-edit-dialog"
  >
    <el-form class="tt-edit-form" label-width="130px" @submit.prevent>
      <el-form-item label="问句样例" required>
        <el-input v-model="form.name" placeholder="请输入" clearable />
      </el-form-item>
      <el-form-item label="匹配规则">
        <el-input v-model="form.rule" type="textarea" :rows="4" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="使用表范围">
        <el-select
          v-model="tableNames"
          multiple
          filterable
          remote
          :remote-method="searchTables"
          :loading="tableLoading"
          loading-text="搜索中"
          no-data-text="无匹配数据表"
          placeholder="搜索"
          class="tt-multi"
        >
          <el-option v-for="item in tableOptions" :key="item.tableName" :label="tableLabel(item)" :value="item.tableName" />
        </el-select>
      </el-form-item>
      <el-form-item label="sql模板">
        <el-select
          v-model="sqlTempIds"
          multiple
          filterable
          remote
          :remote-method="searchSqlTemplates"
          :loading="sqlLoading"
          loading-text="搜索中"
          no-data-text="无匹配 sql 模板"
          placeholder="搜索"
          class="tt-multi"
        >
          <el-option v-for="item in sqlTempOptions" :key="String(item.id)" :label="String(item.name ?? item.id)" :value="Number(item.id)" />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <!-- 旧版「状态」用 radio-group（启用/禁用两项都摆在眼前），不换成开关 -->
        <el-radio-group v-model="form.status">
          <el-radio value="0">启用</el-radio>
          <el-radio value="1">禁用</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线（AGENTS.md 弹窗适配 + 滚动容器约定）：el-dialog 是 append-to-body 的 teleport，
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 DeploymentNodePicker）。
   默认 900px，小视口按视口留边收缩；正文自己滚、footer 常驻。 */
:global(.tt-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.tt-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.tt-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.tt-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.tt-multi {
  width: 100%;
}
</style>
