<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, sourceApi, type DataRow, type DataTableMeta, type EntryDetail, type FileResourceRecord } from '@/api'
import TaskInstDialog from '@/views/DataView/TaskInstDialog.vue'

const props = defineProps<{
  modelValue: boolean
  file: FileResourceRecord | null
  sourceName?: string
  tableId?: string
  tableName?: string
  fields?: DataTableMeta['fields']
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  preview: [file: FileResourceRecord]
}>()

// 表结构还没到时，先按 file_resource 约定的 K1～K10 排，避免 Object.entries 把 QUERYID 混进来。
const FALLBACK_FIELDS: DataTableMeta['fields'] = [
  { prop: 'filename', type: 'string', desc: '文件名', columnName: 'K1' },
  { prop: 'fileurl', type: 'url', desc: '文件链接', columnName: 'K2' },
  { prop: 'filepath', type: 'string', desc: '文件路径', columnName: 'K3' },
  { prop: 'filesize', type: 'number', desc: '文件大小', columnName: 'K4' },
  { prop: 'md5', type: 'string', desc: 'MD5', columnName: 'K5' },
  { prop: 'displayname', type: 'string', desc: '展示名', columnName: 'K6' },
  { prop: 'ext', type: 'string', desc: '扩展名', columnName: 'K7' },
  { prop: 'textfile', type: 'string', desc: '文本文件', columnName: 'K8' },
  { prop: 'textpath', type: 'string', desc: '文本路径', columnName: 'K9' },
  { prop: 'textsize', type: 'number', desc: '文本大小', columnName: 'K10' },
]

function textOf(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}

function formatSize(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return textOf(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatValue(columnName: string, value: unknown): string {
  return columnName === 'K4' || columnName === 'K10' ? formatSize(value) : textOf(value)
}

function safeExternalUrl(value: unknown): string {
  const url = String(value ?? '').trim()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
  } catch {
    return ''
  }
}

function overlayFile(base: FileResourceRecord, detail: EntryDetail): FileResourceRecord {
  const row = detail.row
  const values = { ...base.values }
  for (const item of detail.showItems) {
    if (item.columnName) values[item.columnName] = item.value
  }
  return {
    ...base,
    dataId: row.dataId || base.dataId,
    sourceId: row.sourceId || base.sourceId,
    state: row.state ?? base.state,
    createDt: row.createDt ?? base.createDt,
    updateDt: row.updateDt ?? base.updateDt,
    fileId: row.fileId ?? base.fileId,
    configId: row.configId ?? base.configId,
    detailId: row.detailId ?? base.detailId,
    parentId: row.parentId ?? base.parentId,
    categoryId: row.categoryId ?? base.categoryId,
    seq: row.seq ?? base.seq,
    times: row.times ?? base.times,
    k0: row.k0 ?? base.k0,
    nextFlag: row.nextFlag ?? base.nextFlag,
    values,
  }
}

const liveFile = ref<FileResourceRecord | null>(null)
/**
 * entryDetail 返回的整行。**标识区必须以它为准**：旧平台详情顶部那 16 项
 * （`allColumns.ENTRY_DETAIL.base`）里，`源名称 / 类型ID / 类型名 / 版本 / 抓取日期`
 * 只在这一行里有——列表行（FileResourceRecord）根本没有这几个字段，
 * 这就是此前「源名称没正确展示」的根因（2026-10-16）。
 */
const liveRow = ref<DataRow | null>(null)
const subsCount = ref<number | null>(null)
const detailLoading = ref(false)
const parentView = ref<EntryDetail | null>(null)
const parentLoading = ref(false)
const taskInst = reactive({ visible: false, sourceId: '', taskId: '' })
let detailRequest = 0

const displayed = computed(() => {
  if (parentView.value) return overlayFile({
    dataId: parentView.value.row.dataId,
    sourceId: parentView.value.row.sourceId,
    values: {},
  }, parentView.value)
  return liveFile.value ?? props.file
})

/** 标识区取数行：上游钻取 > 详情返回行 > 列表行兜底 */
const idRow = computed<DataRow | null>(() => {
  if (parentView.value) return parentView.value.row
  if (liveRow.value) return liveRow.value
  const file = props.file
  if (!file) return null
  return { ...file, title: '', summary: '', acceptState: 'accepted' }
})

watch(
  () => [props.modelValue, props.file?.dataId, props.tableId] as const,
  async ([visible, dataId, tableId]) => {
    parentView.value = null
    liveRow.value = null
    if (!visible || !props.file) {
      liveFile.value = null
      subsCount.value = null
      return
    }
    liveFile.value = props.file
    if (!dataId || !tableId) return
    const requestId = ++detailRequest
    detailLoading.value = true
    try {
      const res = await dataApi.rowDetail(tableId, dataId)
      if (requestId !== detailRequest) return
      if (res?.row?.dataId) {
        liveRow.value = res.row
        liveFile.value = overlayFile(props.file, res)
        // 旧平台 base 的「子数据量」= subsCnt（子行总数），只有拿不到总数时才退回本页条数
        subsCount.value = res.subsCnt ?? res.subs?.length ?? 0
      }
    } catch (error) {
      if (requestId !== detailRequest) return
      ElMessage.warning(`加载详情失败，仍展示列表字段${error instanceof Error ? `（${error.message}）` : ''}`)
    } finally {
      if (requestId === detailRequest) detailLoading.value = false
    }
  },
  { immediate: true },
)

const title = computed(() => {
  const file = displayed.value
  if (!file) return '—'
  const name = textOf(file.values.K6)
  return name !== '—' ? name : textOf(file.values.K1)
})

// 源名兜底（2026-10-16）：首选详情行自带的 `SOURCE_NAME`（旧平台详情顶部那列就是它），
// 其次父组件传进来的源名（SiteFileView 的站内源名映射 / FileView 的画布上下文，
// 数据视图里通常是空的）；都拿不到才按 sourceId 查一次源详情，
// 最后退化成显示源 ID（不是「—」）。
const fetchedSourceName = ref('')
watch(
  () => [
    idRow.value?.sourceId ?? props.file?.sourceId,
    props.sourceName,
    idRow.value?.sourceName,
    // 详情请求在路上时先别查：entryDetail 的 SOURCE_NAME 一般就够用，
    // 等它回来（loading 落回 false）再看要不要兜底，免得每开一次详情都白打一次 sourceDetail
    detailLoading.value,
  ] as const,
  async ([sourceId, given, rowName, loading]) => {
    fetchedSourceName.value = ''
    if (!sourceId || given || rowName || loading) return
    try {
      fetchedSourceName.value = (await sourceApi.sourceDetail(sourceId))?.name ?? ''
    } catch {
      // 拿不到就退回显示源 ID，不阻断详情
    }
  },
  { immediate: true },
)

const sourceNameOf = computed(() => {
  const row = idRow.value
  // 钻取到上游数据时那一行属于另一个源，此时不沿用列表行的源名
  const given = row && row.sourceId === props.file?.sourceId ? props.sourceName : ''
  return idRow.value?.sourceName || given || fetchedSourceName.value
})

const canDrillParent = computed(() => {
  const row = idRow.value
  return !!row?.categoryId && !!row.parentId && row.parentId !== '0' && !parentView.value
})

type IdentityItem = { key: string; label: string; value: string; action?: 'task' | 'parent' | 'raw' }
/**
 * 标识区逐项对齐旧平台 `allColumns.ENTRY_DETAIL.base`（column.config.js）——
 * 那正是 FileList2.vue 的「详情」按钮最终渲染的清单（BaseDetail.vue 的 4 列 bordered descriptions，
 * 每项 span 2）。顺序、文案都照抄，包括旧平台把 `updateDt` / `createDt` 的 title 写成了原始字段名这处疏漏，
 * 保持并排对比时一眼能对上（2026-10-16）。
 * 旧平台的 `link`（源ID/文件ID/类型ID/任务ID 跳列表页）是新开多标签页的老机制，这里只保留
 * 任务ID→任务实例弹窗、父ID→上游数据、原始→readJson 这三个有落处的动作。
 */
const identityItems = computed<IdentityItem[]>(() => {
  const row = idRow.value
  if (!row) return []
  const subsTotal = parentView.value
    ? (parentView.value.subsCnt ?? parentView.value.subs?.length ?? 0)
    : subsCount.value
  return [
    { key: 'dataId', label: '数据ID', value: textOf(row.dataId) },
    { key: 'sourceId', label: '源ID', value: textOf(row.sourceId) },
    // 源名拿不到就退化成源 ID，不显示成「—」
    { key: 'sourceName', label: '源名称', value: textOf(sourceNameOf.value || row.sourceId) },
    { key: 'fileId', label: '文件ID', value: textOf(row.fileId) },
    { key: 'tableId', label: '类型ID', value: textOf(row.entryTypeId || props.tableId) },
    { key: 'tableName', label: '类型名', value: textOf(row.entryTypeName || props.tableName) },
    // 旧平台直接把 PARENT_ID 原值摆出来（顶层行的 0 也照显）。
    // 这里以前把 '0' 折成「—」，正是「父ID 没正确展示」的观感来源——是否可点仍由 canDrillParent 决定。
    { key: 'parentId', label: '父ID', value: textOf(row.parentId), action: canDrillParent.value ? 'parent' : undefined },
    { key: 'detailId', label: '任务ID', value: textOf(row.detailId), action: row.detailId ? 'task' : undefined },
    { key: 'updateDt', label: 'updateDt', value: textOf(row.updateDt) },
    { key: 'createDt', label: 'createDt', value: textOf(row.createDt) },
    { key: 'ver', label: '版本', value: textOf(row.ver) },
    { key: 'times', label: '总次数', value: textOf(row.times) },
    { key: 'seq', label: '序号', value: textOf(row.seq) },
    { key: 'flag1', label: '抓取日期', value: textOf(row.flag1) },
    // 旧平台这里就是 K0 的原值本身（不是「查看」两个字），值照旧显示，只是可点开 readJson
    { key: 'k0', label: '原始', value: textOf(row.k0), action: row.k0 ? 'raw' : undefined },
    { key: 'subs', label: '子数据量', value: subsTotal == null ? '—' : String(subsTotal) },
  ]
})

type FieldItem = {
  key: string
  label: string
  code: string
  itemId?: string
  columnName: string
  value: string
  raw: unknown
}
const schemaFields = computed(() => (props.fields?.length ? props.fields : FALLBACK_FIELDS))
const businessFields = computed<FieldItem[]>(() => {
  if (parentView.value) {
    return parentView.value.showItems.map((item) => ({
      key: item.itemId ?? item.columnName,
      label: item.itemName || item.columnName,
      code: item.columnName,
      itemId: item.itemId,
      columnName: item.columnName,
      value: formatValue(item.columnName, item.value),
      raw: item.value,
    }))
  }
  const file = displayed.value
  if (!file) return []
  return schemaFields.value.map((field) => {
    const columnName = field.columnName || field.prop
    const raw = file.values[columnName]
    return {
      key: field.itemId ?? columnName,
      // 旧平台 BaseDetail 渲染的 label 是 `${itemName}-${columnName}`（如「文件名-K1」），
      // 不是纯字段名；这里对齐同一口径（2026-10-16）。
      label: `${field.desc || field.prop}-${columnName}`,
      code: [field.prop, columnName].filter(Boolean).join(' · '),
      itemId: field.itemId,
      columnName,
      value: formatValue(columnName, raw),
      raw,
    }
  })
})

const extraFields = computed(() => {
  if (parentView.value) return []
  const file = displayed.value
  if (!file) return []
  const known = new Set(schemaFields.value.map((field) => field.columnName || field.prop))
  return Object.entries(file.values)
    .filter(([key]) => !known.has(key))
    .map(([key, raw]) => ({ key, value: textOf(raw) }))
})

function close() {
  emit('update:modelValue', false)
}

function onIdentityAction(item: IdentityItem) {
  const row = idRow.value
  if (!row) return
  if (item.action === 'task' && row.detailId) {
    taskInst.sourceId = row.sourceId
    taskInst.taskId = row.detailId
    taskInst.visible = true
  } else if (item.action === 'parent') {
    void openParent()
  } else if (item.action === 'raw' && row.k0) {
    const params = new URLSearchParams({ sourceId: row.sourceId, id: row.k0 })
    window.open(`/api/v1/readJson?${params}`, '_blank')
  }
}

async function openParent() {
  const row = idRow.value
  if (!row?.categoryId || !row.parentId) return
  parentLoading.value = true
  try {
    const res = await dataApi.rowDetail(row.categoryId, row.parentId)
    if (!res?.row?.dataId) {
      ElMessage.warning('未找到上游数据')
      return
    }
    parentView.value = res
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '获取上游数据失败')
  } finally {
    parentLoading.value = false
  }
}

function openPreview() {
  if (!props.file) return
  emit('update:modelValue', false)
  emit('preview', props.file)
}

function k2Href(field: FieldItem): string {
  return field.columnName === 'K2' ? safeExternalUrl(field.raw) : ''
}

function canPreviewPath(field: FieldItem): boolean {
  return !parentView.value && field.columnName === 'K3' && textOf(field.raw) !== '—'
}
</script>

<template>
  <!-- 宽度跟旧平台 BaseDetail 对齐：`min(850, max(500, windowWidth * 0.58))`——
       4 列的 bordered 表格在 560px 下每格只剩几十像素，label 会被挤断行。 -->
  <el-drawer :model-value="modelValue" :with-header="false" size="min(850px, 92vw)" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="displayed" class="ffd-detail" data-testid="file-detail-drawer">
      <div class="ffd-head">
        <div class="ffd-head-main">
          <div class="ffd-title">{{ title }}</div>
          <div class="ffd-sub">数据 ID {{ displayed.dataId }}<template v-if="sourceNameOf"> · 所属源 {{ sourceNameOf }}</template></div>
        </div>
        <button class="rc-btn ghost ffd-close" type="button" @click="close">关闭</button>
      </div>

      <div v-if="parentView" class="ffd-parent-bar" data-testid="file-detail-parent">
        <span>上游数据 · {{ parentView.row.dataId }}</span>
        <button class="rc-btn ghost" type="button" @click="parentView = null">返回当前文件</button>
      </div>
      <div v-if="detailLoading || parentLoading" class="ffd-loading">{{ parentLoading ? '加载上游数据…' : '加载详情…' }}</div>

      <!-- 旧平台 BaseDetail 渲染的是 `<a-descriptions :column="4" bordered size="small">`——
           带框的 label/value 键值表格。这里换成同一形态（el-descriptions border），
           标识项各占半行（span 2），与旧 allColumns.ENTRY_DETAIL.base 里每项 span 2 一致。 -->
      <div class="ffd-section">标识</div>
      <el-descriptions :column="4" border size="small" class="ffd-desc" data-testid="file-detail-identity">
        <el-descriptions-item v-for="item in identityItems" :key="item.key" :label="item.label" :span="2">
          <button
            v-if="item.action"
            class="ffd-link"
            type="button"
            :data-testid="`file-detail-${item.key}`"
            :disabled="item.action === 'parent' && parentLoading"
            @click="onIdentityAction(item)"
          >{{ item.value }}</button>
          <span v-else :data-testid="`file-detail-${item.key}`" :title="item.value">{{ item.value }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 业务字段同样是旧 `columns()` 出的列：旧 BaseDetail 里 required 的列 span 4（独占一行），
           标题就是 `字段名-物理列名`。code（prop · 物理列名）是本站额外加的字段溯源信息，
           放在值后面而不是塞进 label，免得把表格的 label 列撑宽。 -->
      <div class="ffd-section">业务字段</div>
      <el-descriptions :column="4" border size="small" class="ffd-desc" data-testid="file-detail-fields">
        <el-descriptions-item
          v-for="field in businessFields"
          :key="field.key"
          :label="field.label"
          :span="4"
        >
          <!-- 文件链接（K2）显示完整 URL 本身并可直接点开——旧 BaseDetail 对 `url: true` 的列
               就是 `<a :href="值">{{ 值 }}</a>`，不是「打开」这类占位文案（2026-10-16）。
               文案用 k2Href（已 trim + 协议校验）而不是 field.value，保证「看到的」与「点开的」逐字符一致。 -->
          <a
            v-if="k2Href(field)"
            class="ffd-link ffd-url"
            :href="k2Href(field)"
            :title="k2Href(field)"
            target="_blank"
            rel="noreferrer noopener nofollow"
            data-testid="file-detail-k2"
          >{{ k2Href(field) }}</a>
          <template v-else>
            <span>{{ field.value }}</span>
            <button
              v-if="canPreviewPath(field)"
              class="ffd-link ffd-preview-btn"
              type="button"
              data-testid="file-detail-k3-preview"
              @click="openPreview"
            >预览</button>
          </template>
          <span
            class="ffd-field-code ffd-code-inline"
            :title="field.itemId ? `字段ID ${field.itemId}` : undefined"
          >{{ field.code }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <details v-if="extraFields.length" class="ffd-extras" data-testid="file-detail-extras">
        <summary>其他列</summary>
        <div v-for="field in extraFields" :key="field.key" class="ffd-field">
          <div class="ffd-field-head">
            <span class="ffd-field-label">{{ field.key }}</span>
          </div>
          <div class="ffd-field-value">{{ field.value }}</div>
        </div>
      </details>
    </div>
  </el-drawer>
  <TaskInstDialog
    v-model="taskInst.visible"
    :source-id="taskInst.sourceId"
    :task-id="taskInst.taskId"
    :can-write="false"
  />
</template>

<style scoped>
.ffd-detail { padding: 18px; }
.ffd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.ffd-head-main { min-width: 0; flex: 1; }
.ffd-close { flex: none; height: 28px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.ffd-title { font-size: 14px; font-weight: 700; color: var(--rc-text); line-height: 1.4; word-break: break-word; }
.ffd-sub { margin-top: 3px; color: var(--rc-faint); font-size: 11px; }
.ffd-parent-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; padding: 8px 10px; border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-size: 12px; }
.ffd-loading { margin-bottom: 8px; color: var(--rc-faint); font-size: 12px; }
.ffd-section { margin: 14px 0 8px; color: var(--rc-faint); font-size: 11px; letter-spacing: 0.04em; }
/* 详情表格：旧 BaseDetail 的 bordered descriptions 形态。
   label 列留够放「文本文件路径-K9」的宽度，值列的长文本在格内断行、不撑破表格。 */
.ffd-desc :deep(.el-descriptions__label) {
  width: 168px;
  color: var(--rc-muted);
  font-size: 11px;
  font-weight: 400;
  vertical-align: top;
}
.ffd-desc :deep(.el-descriptions__content) {
  color: var(--rc-text);
  font-size: 12px;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.ffd-desc-label { display: inline-flex; flex-direction: column; gap: 1px; align-items: flex-start; }
.ffd-field { padding: 8px 0; border-bottom: 1px solid var(--rc-border-soft); }
.ffd-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ffd-field-label { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.ffd-field-code { flex: none; color: var(--rc-faint); font-size: 11px; }
.ffd-code-inline { margin-left: 8px; }
.ffd-field-value { margin-top: 4px; color: var(--rc-text-2); font-size: 12px; word-break: break-all; }
.ffd-link { padding: 0; border: 0; background: none; color: var(--rc-primary); cursor: pointer; font-size: inherit; text-decoration: none; }
.ffd-link:hover { text-decoration: underline; }
.ffd-link:disabled { color: var(--rc-faint); cursor: default; text-decoration: none; }
/* 完整 URL 往往很长：值单元格已有 break-all，这里再兜一层，保证链接自身换行、不撑破 4 列表格 */
.ffd-url { word-break: break-all; overflow-wrap: anywhere; }
.ffd-preview-btn { margin-left: 8px; }
.ffd-extras { margin-top: 12px; color: var(--rc-text-2); font-size: 12px; }
.ffd-extras summary { cursor: pointer; color: var(--rc-faint); }
.rc-btn.ghost { border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
</style>
