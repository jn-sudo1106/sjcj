<script setup lang="ts">
import { reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { sourceApi, type Source, type SourceCategory } from '../../api'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; picked: [Source] }>()

const state = reactive<{
  loading: boolean
  categoriesLoading: boolean
  sourceIds: string
  name: string
  configId: string
  sourceUrl: string
  entryTypeId: string
  enable: string
  count: string
  dataDate: string
  category: string
  advanced: boolean
  page: number
  size: number
  total: number
  list: Source[]
  categories: SourceCategory[]
}>({
  loading: false,
  categoriesLoading: false,
  sourceIds: '',
  name: '',
  configId: '',
  sourceUrl: '',
  entryTypeId: '',
  enable: '0',
  count: '',
  dataDate: '',
  category: '',
  advanced: false,
  page: 1,
  size: 20,
  total: 0,
  list: [],
  categories: [],
})
const tableHeight = 'min(450px, calc(100vh - 300px))'

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
      category: state.category || undefined,
    })
    state.list = r.list
    state.total = r.total
  } catch (error) {
    ElMessage.error(`加载源列表失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
}

async function loadCategories() {
  state.categoriesLoading = true
  try {
    state.categories = await sourceApi.sourceCategories()
  } catch (error) {
    ElMessage.error(`加载源分类失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.categoriesLoading = false
  }
}

function onSearch() { state.page = 1; void load() }
function onReset() {
  state.sourceIds = ''
  state.name = ''
  state.configId = ''
  state.sourceUrl = ''
  state.entryTypeId = ''
  state.enable = ''
  state.count = ''
  state.dataDate = ''
  state.category = ''
  state.page = 1
  void load()
}
function onPageChange() { void load() }
function onSizeChange() { state.page = 1; void load() }
function onCategory(category: SourceCategory) {
  state.category = category.id
  state.page = 1
  void load()
}
function clearCategory() {
  state.category = ''
  state.page = 1
  void load()
}

watch(() => props.modelValue, (v) => {
  if (!v) return
  state.sourceIds = ''
  state.name = ''
  state.configId = ''
  state.sourceUrl = ''
  state.entryTypeId = ''
  state.enable = '0'
  state.count = ''
  state.dataDate = ''
  state.category = ''
  state.advanced = false
  state.page = 1
  void Promise.all([loadCategories(), load()])
})

function pick(row: Source) {
  emit('picked', row)
  emit('update:modelValue', false)
}

function formatUrl(value?: string) { return value || '—' }
function formatCount(value?: number) { return value == null ? '—' : value }
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    class="dv-picker-dialog"
    title="源列表选择"
    width="980px"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="dv-source-layout">
      <aside v-loading="state.categoriesLoading" class="dv-source-categories">
        <button class="dv-category-all" :class="{ active: !state.category }" type="button" @click="clearCategory">全部</button>
        <el-tree
          v-if="state.categories.length"
          :data="state.categories"
          node-key="id"
          :props="{ label: 'name', children: 'children' }"
          highlight-current
          @node-click="onCategory"
        >
          <template #default="{ data }">
            <span>{{ data.name }}（{{ data.count }}）</span>
          </template>
        </el-tree>
      </aside>

      <main class="dv-source-main">
        <div class="dv-picker-toolbar">
          <el-input v-model="state.sourceIds" type="textarea" :rows="1" resize="none" placeholder="源ID（可输入多个）" style="width: 190px" @keyup.enter="onSearch" />
          <el-input v-model="state.name" clearable placeholder="源名称" style="width: 170px" @keyup.enter="onSearch" />
          <el-input v-model="state.configId" clearable placeholder="配置" style="width: 130px" @keyup.enter="onSearch" />
          <el-button type="primary" @click="onSearch">查询</el-button>
          <el-button @click="onReset">重置</el-button>
          <button class="dv-advanced-link" type="button" @click="state.advanced = !state.advanced">
            {{ state.advanced ? '收起' : '展开' }}
            <span>{{ state.advanced ? '⌃' : '⌄' }}</span>
          </button>
          <span class="dv-picker-spacer" />
          <button class="dv-picker-refresh" type="button" title="刷新" aria-label="刷新" @click="load">
            <el-icon><Refresh /></el-icon>
          </button>
        </div>

        <div v-if="state.advanced" class="dv-source-advanced">
          <el-input v-model="state.sourceUrl" clearable placeholder="URL片断" @keyup.enter="onSearch" />
          <el-input v-model="state.entryTypeId" clearable placeholder="输出表ID" @keyup.enter="onSearch" />
          <el-select v-model="state.enable" placeholder="状态" @change="onSearch">
            <el-option label="在用" value="0" />
            <el-option label="停用" value="1" />
            <el-option label="全部" value="" />
          </el-select>
          <el-input v-model="state.count" clearable placeholder="数据量" @keyup.enter="onSearch" />
          <el-date-picker v-model="state.dataDate" value-format="YYYY-MM-DD" type="date" placeholder="数据时间" />
        </div>

        <el-table v-loading="state.loading" :data="state.list" border :height="tableHeight" @row-click="pick">
          <el-table-column prop="sourceId" label="源ID" width="120" sortable />
          <el-table-column prop="name" label="名称" min-width="210" sortable />
          <el-table-column label="URL" min-width="235">
            <template #default="{ row }"><span class="dv-ellipsis" :title="row.url">{{ formatUrl(row.url) }}</span></template>
          </el-table-column>
          <el-table-column prop="configId" label="配置ID" width="100" sortable />
          <el-table-column label="数据" width="95" sortable>
            <template #default="{ row }">{{ formatCount(row.dataCount) }}</template>
          </el-table-column>
          <el-table-column prop="mainTable" label="表ID" width="95" sortable />
          <el-table-column prop="domain" label="域" min-width="120" />
          <el-table-column prop="state" label="状态" width="75" />
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
      </main>
    </div>
  </el-dialog>
</template>

<style scoped>
.dv-picker-dialog :deep(.el-dialog) { max-width: calc(100vw - 48px); margin: 5vh auto; }
.dv-picker-dialog :deep(.el-dialog__body) { max-height: calc(100vh - 150px); overflow: auto; }
.dv-source-layout { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 16px; }
.dv-source-categories { min-height: 450px; padding-right: 12px; border-right: 1px solid var(--rc-border-soft); }
.dv-category-all, .dv-advanced-link { border: 0; background: transparent; color: var(--rc-primary-ink); cursor: pointer; font-size: 13px; }
.dv-category-all { width: 100%; padding: 8px 10px; text-align: left; border-radius: 4px; }
.dv-category-all.active, .dv-category-all:hover { background: var(--rc-primary-soft); }
.dv-source-main { min-width: 0; }
.dv-picker-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dv-picker-toolbar :deep(.el-textarea__inner) { min-height: 32px !important; padding: 6px 11px; }
.dv-advanced-link { padding: 8px 4px; }
.dv-picker-spacer { flex: 1; }
.dv-picker-refresh { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); cursor: pointer; }
.dv-picker-refresh:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.dv-source-advanced { display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: 8px; margin-top: 10px; }
.dv-picker-pagination { display: flex; justify-content: flex-end; margin-top: 14px; }
.dv-ellipsis { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 900px) {
  .dv-source-layout { grid-template-columns: 1fr; }
  .dv-source-categories { min-height: auto; padding-right: 0; border-right: 0; border-bottom: 1px solid var(--rc-border-soft); padding-bottom: 8px; }
  .dv-source-advanced { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
}
</style>
