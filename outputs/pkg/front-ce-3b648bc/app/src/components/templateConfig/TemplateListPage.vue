<script setup lang="ts">
// 模板配置通用列表页（schema 驱动）—— 1:1 对齐旧 ai-chat-view `src/demo/SqlTempConfig.vue`
// 那一套「s-table + 名称模糊查询 + 新增/编辑弹窗 + 行内启停/复制」的页面结构。
//
// 迁「模板配置」下其余 7 个模块时，只需换 columns / fields / api 三份声明，不再复制表格代码；
// 需要额外按钮或额外行操作时用 toolbar / row-actions 两个具名插槽，不要另开一份列表页。
// 例外：行内「删除」是通用能力（api.remove 存在就画按钮），因为它的交互与确认框在 8 个模块里必然同形；
// 后端没有 /delete 端点的模块不要给 api 加 remove——没端点就没按钮。
//
// 与旧版的有意偏差：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列的滑动开关（AGENTS.md 控件强调约定），
//    点击后仍然只发一次 /status，行为等价、可逆。
// 2. 旧版 s-table 在删除最后一条时会「自动翻页到上一页」，这里的分页由页码状态自己管。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, DocumentCopy, Edit, Plus, Search } from '@element-plus/icons-vue'
import type { TemplateRow } from '@/api/types/template'
import TemplateFormDialog from './TemplateFormDialog.vue'
import type { TemplateColumn, TemplateField, TemplateListApi } from './types'

const props = withDefaults(
  defineProps<{
    columns: TemplateColumn[]
    fields: TemplateField[]
    api: TemplateListApi
    /** 弹窗标题按新增/编辑分开（旧版是「新增sql模板」/「编辑sql模板」） */
    addTitle: string
    editTitle: string
    /** 模糊查询字段名（旧平台一律 name） */
    searchProp?: string
    searchLabel?: string
    searchPlaceholder?: string
    /** 旧页 :pageSize="20" + pageSizeOptions ['10','20'] */
    pageSize?: number
    pageSizes?: number[]
    /** 新增态默认值（旧 SqlTempEditModal 打开新增即 status:'0'） */
    defaults?: Record<string, unknown>
  }>(),
  {
    searchProp: 'name',
    searchLabel: '模板名称',
    searchPlaceholder: '模板名称',
    pageSize: 20,
    pageSizes: () => [10, 20],
    defaults: () => ({}),
  },
)

// ---- 查询条件（草稿 → 执行 两态：改了不自动查，点「查询」才发请求）----
const keyword = ref('')
const filters = reactive<Record<string, string>>({ [props.searchProp]: '' })

// ---- 列表状态 ----
const rows = ref<TemplateRow[]>([])
const total = ref(0)
const loading = ref(false)
const pageNo = ref(1)
const pageSize = ref(props.pageSize)
/** 并发保护：慢请求回来时如果已经有新的查询在跑，丢弃旧结果（与 Settings/NodeTypeTab 同一套路） */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await props.api.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...filters })
    if (seq !== loadSeq) return
    rows.value = res.list ?? []
    total.value = res.total ?? 0
  } catch (err) {
    if (seq !== loadSeq) return
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
    rows.value = []
    total.value = 0
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

function runQuery() {
  filters[props.searchProp] = keyword.value.trim()
  pageNo.value = 1
  void load()
}
/** 子组件保存后回到第一页重查（旧 handleRefresh(true)） */
function refresh(resetToFirstPage = false) {
  if (resetToFirstPage) pageNo.value = 1
  void load()
}

function onPageChange(page: number) {
  pageNo.value = page
  void load()
}
function onSizeChange(size: number) {
  pageSize.value = size
  pageNo.value = 1
  void load()
}

// ---- 状态开关（'0' 启用 / '1' 禁用，字符串口径照旧平台）----
function isEnabled(row: TemplateRow): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: TemplateRow, nextEnabled: boolean) {
  if (!props.api.changeStatus) return
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await props.api.changeStatus(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function copyRow(row: TemplateRow) {
  if (!props.api.copy) return
  try {
    await props.api.copy(Number(row.id))
    ElMessage.success('操作成功')
    refresh(true)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 删除（模块声明了 remove 才有这个入口：后端有 /delete 才给按钮，点了先确认）----
async function deleteRow(row: TemplateRow) {
  if (!props.api.remove) return
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' })
  } catch {
    return // 用户取消
  }
  try {
    await props.api.remove(Number(row.id))
    ElMessage.success('删除成功')
    // 删掉当前页最后一条时退回上一页（旧 s-table 就是这个行为，本页由页码状态自己管）
    if (rows.value.length <= 1 && pageNo.value > 1) pageNo.value -= 1
    // 留在当前页重查（同问句改写：只有新增/编辑保存才回第一页）
    refresh(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof TemplateFormDialog>>()
function openAdd() {
  dialogRef.value?.open(null)
}
function openEdit(row: TemplateRow) {
  dialogRef.value?.open(row)
}
function onSaved() {
  refresh(true)
}

/** 操作列宽：编辑图标 + 每个可选操作（复制 / 删除）多留一个图标的位（图标 24px + 间距 10px） */
const actionWidth = computed(() => 60 + (props.api.copy ? 30 : 0) + (props.api.remove ? 30 : 0))
/** 行内长文本：null 显示成空（旧平台就是空白单元格），不显示 null/undefined */
function cellText(row: TemplateRow, col: TemplateColumn): string {
  const value = row[col.prop]
  return value === null || value === undefined ? '' : String(value)
}

// 切换模块（列/接口换了）时回到第一页重查，避免带着上一个模块的页码
watch(
  () => props.api,
  () => refresh(true),
)

onMounted(() => void load())

defineExpose({ refresh })
</script>

<template>
  <div class="tc-shell" v-loading="loading">
    <!-- 查询区（对齐旧页 a-form layout="inline"：一个名称输入框 + 搜索按钮） -->
    <el-form :inline="true" class="tc-filter-form" size="small" @submit.prevent>
      <el-form-item :label="searchLabel">
        <el-input v-model="keyword" :placeholder="searchPlaceholder" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
      </el-form-item>
    </el-form>

    <!-- 工具条：新增 + 模块自己的额外按钮（导出、批量操作等走 toolbar 插槽） -->
    <div class="tc-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
      <slot name="toolbar" :refresh="refresh" />
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: TemplateRow) => row.id">
      <el-table-column
        v-for="col in columns"
        :key="col.prop"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :align="col.align ?? 'center'"
        :show-overflow-tooltip="col.ellipsis"
      >
        <template #default="{ row }">
          <!-- 状态列：滑动开关 + 状态文字（没有 /status 端点的模块退化成文字） -->
          <el-switch
            v-if="col.type === 'status' && api.changeStatus"
            size="small"
            :model-value="isEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="禁用"
            @change="(v: string | number | boolean) => toggleStatus(row, !!v)"
          />
          <span v-else-if="col.type === 'status'">{{ isEnabled(row) ? '启用' : '禁用' }}</span>
          <span v-else-if="col.type === 'mono'" class="tc-mono">{{ cellText(row, col) }}</span>
          <span v-else>{{ cellText(row, col) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="操作" :width="actionWidth" fixed="right" align="center">
        <template #default="{ row }">
          <div class="tc-row-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="tc-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
            <el-tooltip v-if="api.copy" content="复制" placement="top">
              <span class="tc-op-icon" @click="copyRow(row)"><el-icon :size="15"><DocumentCopy /></el-icon></span>
            </el-tooltip>
            <el-tooltip v-if="api.remove" content="删除" placement="top">
              <span class="tc-op-icon tc-op-danger" @click="deleteRow(row)"><el-icon :size="15"><Delete /></el-icon></span>
            </el-tooltip>
            <slot name="row-actions" :row="row" :refresh="refresh" />
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="tc-pager">
      <el-pagination
        :current-page="pageNo"
        :page-size="pageSize"
        :total="total"
        :page-sizes="pageSizes"
        layout="total, sizes, prev, pager, next, jumper"
        background
        size="small"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <TemplateFormDialog
      ref="dialogRef"
      :fields="fields"
      :api="api"
      :add-title="addTitle"
      :edit-title="editTitle"
      :defaults="defaults"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.tc-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.tc-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.tc-filter-form :deep(.el-input) {
  width: 200px;
}
.tc-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tc-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.tc-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.tc-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
/* 删除保持危险色（同问句改写与控件强调约定：不用大号实心按钮） */
.tc-op-icon.tc-op-danger {
  color: var(--rc-danger, #dc2626);
}
.tc-op-icon.tc-op-danger:hover {
  background: var(--rc-danger-bg, #fef2f2);
  color: var(--rc-danger, #dc2626);
}
.tc-mono {
  font-family: var(--rc-mono, monospace);
  font-size: 11px;
}
.tc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
