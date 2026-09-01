<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type DataTableMeta, type EntryDetail, type FileResourceRecord } from '@/api'
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

watch(
  () => [props.modelValue, props.file?.dataId, props.tableId] as const,
  async ([visible, dataId, tableId]) => {
    parentView.value = null
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
        liveFile.value = overlayFile(props.file, res)
        subsCount.value = res.subs?.length ?? 0
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

const sourceNameOf = computed(() => {
  const file = displayed.value
  if (!file) return ''
  if (file.sourceId === props.file?.sourceId) return props.sourceName || ''
  return ''
})

const typeId = computed(() => {
  if (parentView.value) return props.file?.categoryId || ''
  return props.tableId || ''
})

const typeName = computed(() => (parentView.value ? '' : props.tableName || ''))

const canDrillParent = computed(() => {
  const file = displayed.value
  return !!file?.categoryId && !!file.parentId && file.parentId !== '0' && !parentView.value
})

type IdentityItem = { key: string; label: string; value: string; action?: 'task' | 'parent' | 'raw' }
const identityItems = computed<IdentityItem[]>(() => {
  const file = displayed.value
  if (!file) return []
  const items: IdentityItem[] = [
    { key: 'dataId', label: '数据ID', value: textOf(file.dataId) },
    { key: 'sourceId', label: '源ID', value: textOf(file.sourceId) },
    { key: 'sourceName', label: '源名称', value: textOf(sourceNameOf.value) },
    { key: 'fileId', label: '文件ID', value: textOf(file.fileId) },
    { key: 'tableId', label: '类型ID', value: textOf(typeId.value) },
    { key: 'tableName', label: '类型名', value: textOf(typeName.value) },
    { key: 'parentId', label: '父ID', value: textOf(file.parentId && file.parentId !== '0' ? file.parentId : ''), action: canDrillParent.value ? 'parent' : undefined },
    { key: 'detailId', label: '任务ID', value: textOf(file.detailId), action: file.detailId ? 'task' : undefined },
    { key: 'state', label: '状态', value: textOf(file.state) },
    { key: 'seq', label: '序号', value: textOf(file.seq) },
    { key: 'times', label: '总次数', value: textOf(file.times) },
    { key: 'k0', label: '原始', value: file.k0 ? '查看' : '—', action: file.k0 ? 'raw' : undefined },
    { key: 'updateDt', label: '更新时间', value: textOf(file.updateDt) },
    { key: 'createDt', label: '生成时间', value: textOf(file.createDt) },
  ]
  if (subsCount.value !== null && !parentView.value) {
    items.push({ key: 'subs', label: '子数据量', value: String(subsCount.value) })
  } else if (parentView.value) {
    items.push({ key: 'subs', label: '子数据量', value: String(parentView.value.subs?.length ?? 0) })
  }
  return items
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
      label: field.desc || columnName,
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
  const file = displayed.value
  if (!file) return
  if (item.action === 'task' && file.detailId) {
    taskInst.sourceId = file.sourceId
    taskInst.taskId = file.detailId
    taskInst.visible = true
  } else if (item.action === 'parent') {
    void openParent()
  } else if (item.action === 'raw' && file.k0) {
    const params = new URLSearchParams({ sourceId: file.sourceId, id: file.k0 })
    window.open(`/api/v1/readJson?${params}`, '_blank')
  }
}

async function openParent() {
  const file = displayed.value
  if (!file?.categoryId || !file.parentId) return
  parentLoading.value = true
  try {
    const res = await dataApi.rowDetail(file.categoryId, file.parentId)
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
  <el-drawer :model-value="modelValue" :with-header="false" size="560px" @update:model-value="emit('update:modelValue', $event)">
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

      <div class="ffd-section">标识</div>
      <div class="ffd-id-grid" data-testid="file-detail-identity">
        <div v-for="item in identityItems" :key="item.key" class="ffd-id-item">
          <div class="ffd-id-label">{{ item.label }}</div>
          <div class="ffd-id-value" :title="item.value">
            <button
              v-if="item.action"
              class="ffd-link"
              type="button"
              :data-testid="`file-detail-${item.key}`"
              :disabled="item.action === 'parent' && parentLoading"
              @click="onIdentityAction(item)"
            >{{ item.value }}</button>
            <span v-else :data-testid="`file-detail-${item.key}`">{{ item.value }}</span>
          </div>
        </div>
      </div>

      <div class="ffd-section">业务字段</div>
      <div data-testid="file-detail-fields">
        <div
          v-for="field in businessFields"
          :key="field.key"
          class="ffd-field"
          :title="field.itemId ? `字段ID ${field.itemId}` : undefined"
        >
          <div class="ffd-field-head">
            <span class="ffd-field-label">{{ field.label }}</span>
            <span class="ffd-field-code">{{ field.code }}</span>
          </div>
          <div class="ffd-field-value">
            <a
              v-if="k2Href(field)"
              class="ffd-link"
              :href="k2Href(field)"
              target="_blank"
              rel="noreferrer noopener nofollow"
              data-testid="file-detail-k2"
            >打开</a>
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
          </div>
        </div>
      </div>

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
.ffd-id-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
.ffd-id-label { color: var(--rc-muted); font-size: 11px; }
.ffd-id-value { margin-top: 2px; min-width: 0; color: var(--rc-text); font-size: 12px; word-break: break-all; }
.ffd-field { padding: 8px 0; border-bottom: 1px solid var(--rc-border-soft); }
.ffd-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ffd-field-label { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.ffd-field-code { flex: none; color: var(--rc-faint); font-size: 11px; }
.ffd-field-value { margin-top: 4px; color: var(--rc-text-2); font-size: 12px; word-break: break-all; }
.ffd-link { padding: 0; border: 0; background: none; color: var(--rc-primary); cursor: pointer; font-size: inherit; text-decoration: none; }
.ffd-link:hover { text-decoration: underline; }
.ffd-link:disabled { color: var(--rc-faint); cursor: default; text-decoration: none; }
.ffd-preview-btn { margin-left: 8px; }
.ffd-extras { margin-top: 12px; color: var(--rc-text-2); font-size: 12px; }
.ffd-extras summary { cursor: pointer; color: var(--rc-faint); }
.rc-btn.ghost { border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
</style>
