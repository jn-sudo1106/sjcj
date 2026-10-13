<script setup lang="ts">
// 源列表选择弹窗 —— 1:1 迁移旧平台
//   `data-view/src/page/base/detail/SourceListShow.vue`（弹窗外壳，确认后 emit('selected', rows)）
// + `data-view/src/page/config/list/SourceList2.vue`（弹窗本体：分类树 + 多条件筛选 + 多选表格 + 分页）
//
// 旧形态：a-modal（width = 视口 - 100）内嵌 SourceList2，左侧 CategoryTree、右侧 s-table（rowSelection 多选）。
// 新形态：el-dialog（1200px，随视口留边）+ el-tree 分类树（见 SourceCategoryTree）
//         + el-table 多选 + el-pagination。
//
// 选源口径与旧版一致：**多选**，点「确定」把勾选行整批 emit('selected', rows)；
// 上层（SourceSelect）只取 rows[0] 作为当前源——与旧 DSourceSelect.handleSelected 相同。
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import SourceCategoryTree from './SourceCategoryTree.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  selected: [rows: Source[]]
}>()

const state = reactive<{
  loading: boolean
  sourceIds: string
  name: string
  configId: string
  sourceUrl: string
  entryTypeId: string
  enable: string
  count: string
  dataDate: string
  categorys: string
  advanced: boolean
  page: number
  size: number
  total: number
  list: Source[]
}>({
  loading: false,
  sourceIds: '',
  name: '',
  configId: '',
  sourceUrl: '',
  entryTypeId: '',
  // 旧 SourceList2 queryParam.enable 默认 '0'（在用）
  enable: '0',
  count: '',
  dataDate: '',
  // 旧 SourceList2 queryParam.categorys：逗号拼接的分类 ID（多选，树勾选产生）
  categorys: '',
  advanced: false,
  page: 1,
  size: 20,
  total: 0,
  list: [],
})

const tableRef = ref()
const categoryTreeRef = ref<InstanceType<typeof SourceCategoryTree> | null>(null)
const selectedRows = ref<Source[]>([])

/** 旧 SourceList2：源ID 走 a-textarea，按换行分隔成 ids；这里兼容逗号/空格/换行 */
function normalizedIds() {
  return state.sourceIds.split(/[，,\s]+/).map((id) => id.trim()).filter(Boolean).join(',')
}

async function load() {
  state.loading = true
  try {
    const ids = normalizedIds()
    const r = await sourceApi.sourcePaged({
      page: state.page,
      size: state.size,
      ids: ids || undefined,
      sourceIds: ids || undefined,
      name: state.name.trim() || undefined,
      configId: state.configId.trim() || undefined,
      sourceUrl: state.sourceUrl.trim() || undefined,
      entryTypeId: state.entryTypeId.trim() || undefined,
      enable: state.enable,
      count: state.count.trim() || undefined,
      dataDate: state.dataDate || undefined,
      // 对齐旧 SourceList2：多选分类以逗号拼接传给 categorys
      categorys: state.categorys || undefined,
    })
    state.list = r.list
    state.total = r.total
  } catch (error) {
    ElMessage.error(`加载源列表失败：${error instanceof Error ? error.message : String(error)}`)
    state.list = []
    state.total = 0
  } finally {
    state.loading = false
  }
}

function onSearch() {
  state.page = 1
  void load()
}
function onReset() {
  state.sourceIds = ''
  state.name = ''
  state.configId = ''
  state.sourceUrl = ''
  state.entryTypeId = ''
  state.enable = '0'
  state.count = ''
  state.dataDate = ''
  state.categorys = ''
  state.page = 1
  categoryTreeRef.value?.clearSelection()
  void load()
}
function onPageChange() {
  void load()
}
function onSizeChange() {
  state.page = 1
  void load()
}
/** 分类树筛选变化（点击=单选，勾选=多选）：更新 categorys 并回到第一页重查 */
function onTreeFilter(ids: string[]) {
  state.categorys = ids.join(',')
  state.page = 1
  void load()
}

function onSelectionChange(rows: Source[]) {
  selectedRows.value = rows
}

function close() {
  emit('update:modelValue', false)
}
/** 确认：把勾选行整批交回上层（旧 SourceListShow.handleSubmit → emit('selected', rows)） */
function confirm() {
  emit('selected', selectedRows.value)
  close()
}

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    // 每次打开重置筛选与勾选（旧版 a-modal :destroyOnClose + 重新 mount）
    state.sourceIds = ''
    state.name = ''
    state.configId = ''
    state.sourceUrl = ''
    state.entryTypeId = ''
    state.enable = '0'
    state.count = ''
    state.dataDate = ''
    state.categorys = ''
    state.advanced = false
    state.page = 1
    selectedRows.value = []
    tableRef.value?.clearSelection?.()
    categoryTreeRef.value?.clearSelection()
    void load()
  },
  // immediate：万一调用方一开始就把弹窗挂成打开态，也要加载首屏
  { immediate: true },
)

function formatUrl(value?: string) {
  return value || '—'
}
function formatCount(value?: number) {
  return value == null ? '—' : value
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="sld-dialog"
    title="源列表选择"
    width="1500px"
    destroy-on-close
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="sld-layout">
      <!-- 分类树：可筛选（复选/单选）+ 可编辑（编辑分类）——1:1 迁移旧 CategoryTree -->
      <aside class="sld-categories">
        <SourceCategoryTree ref="categoryTreeRef" @filter="onTreeFilter" />
      </aside>

      <main class="sld-main">
        <div class="sld-toolbar">
          <label class="sld-field">
            <span class="sld-field-label">源ID</span>
            <el-input
              v-model="state.sourceIds"
              class="sld-id-input"
              type="textarea"
              :rows="1"
              resize="none"
              placeholder="可多个，换行分隔"
              @keyup.enter="onSearch"
            />
          </label>
          <label class="sld-field">
            <span class="sld-field-label">名称</span>
            <el-input v-model="state.name" class="sld-name-input" clearable placeholder="源名称" @keyup.enter="onSearch" />
          </label>
          <label class="sld-field">
            <span class="sld-field-label">配置</span>
            <el-input v-model="state.configId" class="sld-config-input" clearable placeholder="配置ID" @keyup.enter="onSearch" />
          </label>
          <div class="sld-toolbar-actions">
            <el-button type="primary" @click="onSearch">查询</el-button>
            <el-button @click="onReset">重置</el-button>
            <button class="sld-advanced-link" type="button" @click="state.advanced = !state.advanced">
              {{ state.advanced ? '收起' : '展开' }}
              <span>{{ state.advanced ? '⌃' : '⌄' }}</span>
            </button>
          </div>
        </div>

        <div v-if="state.advanced" class="sld-advanced">
          <label class="sld-field">
            <span class="sld-field-label">URL</span>
            <el-input v-model="state.sourceUrl" clearable placeholder="URL片断" @keyup.enter="onSearch" />
          </label>
          <label class="sld-field">
            <span class="sld-field-label">输出</span>
            <el-input v-model="state.entryTypeId" clearable placeholder="表ID" @keyup.enter="onSearch" />
          </label>
          <label class="sld-field">
            <span class="sld-field-label">状态</span>
            <el-select v-model="state.enable" placeholder="状态" @change="onSearch">
              <el-option label="在用" value="0" />
              <el-option label="停用" value="1" />
              <el-option label="全部" value="" />
            </el-select>
          </label>
          <label class="sld-field">
            <span class="sld-field-label">数据</span>
            <el-input v-model="state.count" clearable placeholder="数据量" @keyup.enter="onSearch" />
          </label>
          <label class="sld-field">
            <span class="sld-field-label">数据时间</span>
            <el-date-picker v-model="state.dataDate" value-format="YYYY-MM-DD" type="date" placeholder="选择日期" />
          </label>
        </div>

        <div class="sld-table-wrap">
          <el-table
            ref="tableRef"
            v-loading="state.loading"
            :data="state.list"
            border
            row-key="sourceId"
            height="100%"
            @selection-change="onSelectionChange"
          >
            <el-table-column type="selection" width="40" />
            <el-table-column prop="sourceId" label="源ID" width="120" sortable />
            <el-table-column prop="name" label="名称" min-width="200" sortable />
            <el-table-column label="URL" min-width="220">
              <template #default="{ row }"><span class="sld-ellipsis" :title="row.url">{{ formatUrl(row.url) }}</span></template>
            </el-table-column>
            <el-table-column prop="configId" label="配置ID" width="100" sortable />
            <el-table-column label="数据" width="95" sortable>
              <template #default="{ row }">{{ formatCount(row.dataCount) }}</template>
            </el-table-column>
            <el-table-column prop="mainTable" label="表ID" width="95" sortable />
            <el-table-column prop="domain" label="域" min-width="110" />
          </el-table>
        </div>

        <div class="sld-pagination">
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
      </main>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :disabled="!selectedRows.length" @click="confirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sld-dialog :deep(.el-dialog) {
  max-width: calc(100vw - 48px);
  margin: 5vh auto;
}
.sld-dialog :deep(.el-dialog__body) {
  max-height: calc(100vh - 150px);
  overflow: hidden;
}
.sld-layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  height: min(560px, calc(100vh - 200px));
}
.sld-categories {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 4px 12px 4px 0;
  border-right: 1px solid var(--rc-border-soft, #e2e8f0);
}
.sld-advanced-link {
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink, #1d4ed8);
  cursor: pointer;
  font-size: 13px;
}
/* 右侧主区：flex 纵向 —— 筛选固定、表格吃剩余高度、分页固定底部（不再被裁切） */
.sld-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.sld-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  flex: none;
}
.sld-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sld-field-label {
  flex: none;
  color: var(--rc-muted, #64748b);
  font-size: 13px;
  white-space: nowrap;
}
.sld-id-input {
  width: 180px;
}
.sld-name-input {
  width: 150px;
}
.sld-config-input {
  width: 130px;
}
.sld-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sld-toolbar :deep(.el-textarea__inner) {
  min-height: 32px !important;
  padding: 6px 11px;
}
.sld-advanced-link {
  padding: 8px 4px;
}
.sld-spacer {
  flex: 1;
}
.sld-advanced {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 12px;
  flex: none;
}
.sld-advanced .sld-field {
  flex: none;
}
.sld-advanced :deep(.el-input),
.sld-advanced :deep(.el-select),
.sld-advanced :deep(.el-date-editor) {
  width: 172px;
}
.sld-table-wrap {
  flex: 1;
  min-height: 0;
  margin-top: 12px;
}
.sld-table-wrap :deep(.el-table) {
  height: 100%;
}
.sld-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  flex: none;
}
.sld-selected-tip {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.sld-ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 900px) {
  .sld-dialog :deep(.el-dialog__body) {
    overflow: auto;
  }
  .sld-layout {
    grid-template-columns: 1fr;
    height: auto;
  }
  .sld-categories {
    min-height: auto;
    max-height: 180px;
    padding-right: 0;
    border-right: 0;
    border-bottom: 1px solid var(--rc-border-soft, #e2e8f0);
    padding-bottom: 8px;
  }
  .sld-main {
    overflow: visible;
  }
  .sld-table-wrap {
    flex: none;
  }
  .sld-table-wrap :deep(.el-table) {
    height: auto;
  }
}
</style>
