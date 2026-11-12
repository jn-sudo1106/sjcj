<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dataApi, type EntryType } from '@/api'
import { currentBackendHost, isProductionBackend } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ modelValue: boolean; sourceIds: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; cleaned: [] }>()
const auth = useAuthStore()
const allowed = computed(() => auth.role === 'admin' && !isProductionBackend() && currentBackendHost() !== '118.25.96.217')
const idsText = ref('')
const tableId = ref('')
const all = ref<0 | 1>(0)
const tables = ref<EntryType[]>([])
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const result = ref('')
const reviewed = ref<{ ids: string[]; tableId: string; tableName: string; all: 0 | 1 } | null>(null)
const ids = computed(() => [...new Set(idsText.value.split(/[,，\s]+/).filter(Boolean))])
const validIds = computed(() => ids.value.length > 0 && ids.value.every(id => /^[1-9]\d*$/.test(id)))
const busy = computed(() => loading.value || submitting.value)

watch([idsText, tableId, all], () => { reviewed.value = null; error.value = '' }, { flush: 'sync' })
watch(() => props.modelValue, async open => {
  if (!open) return
  idsText.value = props.sourceIds.join(', ')
  tableId.value = ''
  all.value = 0
  result.value = ''
  loading.value = true
  try {
    const group = await dataApi.entryTypesGroup()
    tables.value = [...new Map([...group.list1, ...group.list2, ...group.list3].map(table => [table.tableId, table])).values()]
  } catch (cause) {
    error.value = `加载数据表失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally { loading.value = false }
}, { immediate: true })

async function preview() {
  if (!allowed.value || busy.value) return
  if (!validIds.value) { error.value = '请输入有效的数字源 ID，多个 ID 用逗号、空格或换行分隔'; return }
  const table = tables.value.find(item => item.tableId === tableId.value)
  if (!table) { error.value = '请选择目标数据表'; return }
  const scope = { ids: [...ids.value], tableId: table.tableId, tableName: table.name || table.tableName, all: all.value }
  loading.value = true
  error.value = ''
  result.value = ''
  try {
    const meta = await dataApi.tableMeta(scope.tableId)
    // 沿用数据中心的测试表限制，不能借移动入口清理正式表。
    if (meta?.state !== 'C') { error.value = '仅支持清理测试表的数据，请重新选择目标表'; return }
    reviewed.value = scope
  } catch (cause) {
    error.value = `读取目标表失败：${cause instanceof Error ? cause.message : String(cause)}`
  } finally { loading.value = false }
}
async function submit() {
  const scope = reviewed.value
  if (!scope || !allowed.value || busy.value) return
  submitting.value = true
  try {
    try {
      await ElMessageBox.confirm(`确认清理 ${scope.ids.length} 个源在 ${scope.tableName}（${scope.tableId}）中的${scope.all ? '全部历史' : '当日'}数据？删除后无法恢复。`, '确认清理源数据', { type: 'warning', confirmButtonText: '确认清理', cancelButtonText: '取消' })
    } catch { return }
    if (!allowed.value || reviewed.value !== scope) return
    let completed = 0
    let deleted = 0
    let failure = ''
    // 复用旧 entryDelete 的单源契约，不把多个 ID 塞进 sourceId，也不省略目标表。
    for (const sourceId of scope.ids) {
      try {
        const response = await dataApi.rowDelete(scope.tableId, { sourceId, all: scope.all })
        if (typeof response.success !== 'number') throw new Error('接口未返回清理条数，请核对数据后重试')
        deleted += response.success
        completed += 1
      } catch (cause) {
        failure = `源 ${sourceId} 清理未完成：${cause instanceof Error ? cause.message : String(cause)}。已停止后续请求，请核对该源后重试。`
        break
      }
    }
    result.value = `已完成 ${completed}/${scope.ids.length} 个源，接口返回清理 ${deleted} 条数据。${completed < scope.ids.length ? '输入框已保留未完成的源。' : ''}`
    idsText.value = scope.ids.slice(completed).join(', ')
    reviewed.value = null
    error.value = failure
    if (completed === scope.ids.length) ElMessage.success('清理完成')
    if (completed) emit('cleaned')
  } finally { submitting.value = false }
}
function close() {
  if (!busy.value) emit('update:modelValue', false)
}
</script>

<template>
  <el-dialog :model-value="modelValue" title="清理源数据" width="620px" class="source-cleanup-dialog" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" :before-close="close" @update:model-value="(value: boolean) => { if (!value) close() }">
    <el-alert v-if="!allowed" title="仅管理员可在非生产环境清理源数据" type="warning" :closable="false" show-icon />
    <el-form label-position="top" :disabled="busy || !allowed" class="sc-form">
      <el-form-item label="源 ID">
        <el-input v-model="idsText" type="textarea" :rows="3" placeholder="多个源 ID 用逗号、空格或换行分隔" data-testid="cleanup-source-ids" />
        <span class="sc-hint">已识别 {{ ids.length }} 个源，重复 ID 自动合并</span>
      </el-form-item>
      <el-form-item label="目标数据表（必选）">
        <el-select v-model="tableId" filterable clearable placeholder="输入表名 / ID 匹配" :loading="loading" data-testid="cleanup-table" style="width: 100%">
          <el-option v-for="table in tables" :key="table.tableId" :label="`${table.name || table.tableName} · ${table.tableId}`" :value="table.tableId" />
        </el-select>
      </el-form-item>
      <el-form-item label="时间范围">
        <el-radio-group v-model="all" data-testid="cleanup-period"><el-radio :value="0">当日数据</el-radio><el-radio :value="1">全部历史数据</el-radio></el-radio-group>
      </el-form-item>
    </el-form>
    <p class="sc-hint">仅清理目标表中的源数据，保留源、流程和配置。仅支持测试表。</p>
    <el-alert v-if="reviewed" type="warning" :closable="false" show-icon data-testid="cleanup-review">
      <template #title>待清理：{{ reviewed.ids.length }} 个源 · {{ reviewed.tableName }}（{{ reviewed.tableId }}）· {{ reviewed.all ? '全部历史数据' : '当日数据' }}</template>
      此处展示选择范围，实际清理条数以接口执行结果为准。删除后无法恢复。
    </el-alert>
    <p v-if="result" class="sc-result" role="status">{{ result }}</p>
    <p v-if="error" class="sc-error" role="alert">{{ error }}</p>
    <template #footer>
      <el-button :disabled="busy" @click="close">关闭</el-button>
      <el-button v-if="!reviewed" type="primary" :loading="loading" :disabled="!allowed || busy" data-testid="cleanup-preview" @click="preview">预览清理范围</el-button>
      <el-button v-else type="danger" :loading="submitting" :disabled="!allowed || busy" data-testid="cleanup-submit" @click="submit">确认清理</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sc-form { margin-top: 16px; }
.sc-hint { margin: 5px 0 12px; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.sc-result { color: var(--rc-text); font-size: 13px; line-height: 1.6; }
.sc-error { color: var(--el-color-danger); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
</style>
<style>
.source-cleanup-dialog { max-width: calc(100vw - 32px); }
</style>
