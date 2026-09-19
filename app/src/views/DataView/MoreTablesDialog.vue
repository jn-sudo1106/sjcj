<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Refresh } from '@element-plus/icons-vue'
import { entryApi, type DataTableMeta, type EntryType } from '../../api'
import { useAuthStore } from '../../stores/auth'
import EntryEditorDrawer from './EntryEditorDrawer.vue'
import TableDetailDialog from './TableDetailDialog.vue'
import { withoutComposition } from '@/utils/enterKey'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; picked: [EntryType] }>()

const auth = useAuthStore()
const canWrite = computed(() => auth.role === 'admin')
const state = reactive<{
  loading: boolean
  tableId: string
  name: string
  page: number
  size: number
  total: number
  list: EntryType[]
  selected: string[]
}>({ loading: false, tableId: '', name: '', page: 1, size: 20, total: 0, list: [], selected: [] })

const editorOpen = ref(false)
const detailOpen = ref(false)
const detailTable = ref<DataTableMeta | null>(null)
const tableHeight = 'min(450px, calc(100vh - 300px))'

async function load() {
  state.loading = true
  try {
    const r = await entryApi.entryPaged({
      page: state.page,
      size: state.size,
      entryTypeId: state.tableId.trim() || undefined,
      name: state.name.trim() || undefined,
    })
    state.list = r.list
    state.total = r.total
    state.selected = state.selected.filter((id) => state.list.some((row) => row.tableId === id))
  } catch (error) {
    ElMessage.error(`加载数据表失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
function onKeywordInput() {
  clearTimeout(timer)
  timer = setTimeout(() => { state.page = 1; void load() }, 250)
}
function onSearch() { state.page = 1; void load() }
function onReset() {
  state.tableId = ''
  state.name = ''
  state.page = 1
  void load()
}
function onPageChange() { void load() }
function onSizeChange() { state.page = 1; void load() }

onUnmounted(() => clearTimeout(timer))

watch(() => props.modelValue, (v) => {
  if (!v) return
  state.tableId = ''
  state.name = ''
  state.page = 1
  state.selected = []
  void load()
})

function pick(row: EntryType) {
  emit('picked', row)
  emit('update:modelValue', false)
}

function toggleSelected(tableId: string, checked: boolean) {
  state.selected = checked
    ? Array.from(new Set([...state.selected, tableId]))
    : state.selected.filter((id) => id !== tableId)
}
const allChecked = computed(() => !!state.list.length && state.list.every((row) => state.selected.includes(row.tableId)))
const indeterminate = computed(() => !allChecked.value && state.list.some((row) => state.selected.includes(row.tableId)))
function togglePage(checked: boolean) {
  const ids = state.list.map((row) => row.tableId)
  state.selected = checked
    ? Array.from(new Set([...state.selected, ...ids]))
    : state.selected.filter((id) => !ids.includes(id))
}

function formatDate(value?: string) { return value ? value.slice(0, 16) : '—' }

async function openDetail(row: EntryType) {
  try {
    const entry = await entryApi.entryDetail(row.tableId)
    detailTable.value = {
      tableId: entry.tableId,
      tableName: entry.tableName,
      rowCount: entry.rowCount ?? 0,
      state: entry.state,
      keyField: entry.keyField,
      fields: entry.fields,
    }
    detailOpen.value = true
  } catch (error) {
    ElMessage.error(`加载表详情失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function openCreate() { editorOpen.value = true }
function onSaved() { state.page = 1; void load() }

async function runBatch(action: 'rebuild' | 'delete') {
  if (!state.selected.length) {
    ElMessage.warning('请选择要操作的数据')
    return
  }
  const title = action === 'rebuild' ? '检查表结构提示' : '提示'
  const body = action === 'rebuild'
    ? `是否确定检查并重建物理表，数量:${state.selected.length}？\n表ID：${state.selected.join(',')}`
    : `是否确认要删除表，数量:${state.selected.length}？\n表ID：${state.selected.join(',')}`
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    const ids = [...state.selected]
    const result = action === 'rebuild' ? await entryApi.rebuildTable(ids) : await entryApi.deleteEntries(ids)
    ElMessage.success(result?.message || (action === 'rebuild' ? '处理成功' : '删除成功'))
    state.selected = []
    await load()
  } catch (error) {
    ElMessage.error(`操作失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

// 回车触发，但跳过中文输入法上屏时的 Enter（见 utils/enterKey.ts）
const onEnterSearch = withoutComposition(() => onSearch())
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="dv-picker-dialog"
    title="数据表选择"
    width="900px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="dv-picker-toolbar">
      <el-input v-model="state.tableId" clearable placeholder="表 ID" style="width: 150px" @input="onKeywordInput" @keyup.enter="onEnterSearch" />
      <el-input v-model="state.name" clearable placeholder="表名称" style="width: 190px" @input="onKeywordInput" @keyup.enter="onEnterSearch" />
      <el-button type="primary" @click="onSearch">查询</el-button>
      <el-button @click="onReset">重置</el-button>
      <span class="dv-picker-spacer" />
      <el-button v-if="canWrite" type="primary" plain @click="openCreate">新建</el-button>
    </div>

    <div class="dv-picker-actions">
      <el-dropdown v-if="canWrite && state.selected.length" trigger="click">
        <el-button>更多<el-icon><ArrowDown /></el-icon></el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="runBatch('rebuild')">检查并重建表</el-dropdown-item>
            <el-dropdown-item divided @click="runBatch('delete')">删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span class="dv-picker-spacer" />
      <button class="dv-picker-refresh" type="button" title="刷新" aria-label="刷新" @click="load">
        <el-icon><Refresh /></el-icon>
      </button>
    </div>

    <el-table v-loading="state.loading" :data="state.list" border :height="tableHeight" @row-click="pick">
      <el-table-column v-if="canWrite" width="48" fixed="left">
        <template #header>
          <el-checkbox :model-value="allChecked" :indeterminate="indeterminate" aria-label="选择本页" @change="togglePage" />
        </template>
        <template #default="{ row }">
          <span @click.stop>
            <el-checkbox :model-value="state.selected.includes(row.tableId)" :aria-label="`选择表 ${row.tableId}`" @change="toggleSelected(row.tableId, $event)" />
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="tableId" label="表ID" width="100" sortable />
      <el-table-column label="表名称" min-width="160">
        <template #default="{ row }">{{ row.name || '—' }}</template>
      </el-table-column>
      <el-table-column prop="tableName" label="物理表名" min-width="220" />
      <el-table-column prop="keyField" label="去重字段" width="120" />
      <el-table-column prop="state" label="状态" width="75" />
      <el-table-column prop="remark" label="备注" min-width="160" />
      <el-table-column prop="updatedAt" label="更新时间" width="125">
        <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column prop="rowCount" label="数据量" width="95" />
      <el-table-column label="操作" width="75" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="openDetail(row)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="dv-picker-pagination">
      <el-pagination
        v-model:current-page="state.page"
        v-model:page-size="state.size"
        :total="state.total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <EntryEditorDrawer v-model="editorOpen" :entry="null" @saved="onSaved" />
    <TableDetailDialog v-model="detailOpen" :table-meta="detailTable" />
  </el-dialog>
</template>

<style scoped>
.dv-picker-dialog :deep(.el-dialog) { max-width: calc(100vw - 48px); margin: 5vh auto; }
.dv-picker-dialog :deep(.el-dialog__body) { max-height: calc(100vh - 150px); overflow: auto; }
.dv-picker-toolbar, .dv-picker-actions, .dv-picker-pagination { display: flex; align-items: center; gap: 8px; }
.dv-picker-toolbar { flex-wrap: wrap; }
.dv-picker-actions { margin: 14px 0 10px; }
.dv-picker-spacer { flex: 1; }
.dv-picker-refresh { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.dv-picker-refresh:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dv-picker-pagination { justify-content: flex-end; margin-top: 14px; }
</style>
