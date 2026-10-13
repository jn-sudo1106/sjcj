<script setup lang="ts">
// 自动补全配置（旧 ai-chat-view「模板配置 → 自动补全配置」，src/demo/DicConfig.vue）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 工具条上有「导出」（toolbar 插槽拿不到当前已执行的筛选条件，导出会与列表不同口径）；
// · 搜索框是「内容」（旧 queryParam.name 模糊匹配 content），且没有启停/复制操作。
// 所以照表模板（TableTemplate/）的先例在本目录自己实现列表，接口走 api/templateConfig.ts 的 dicTemplateApi。
//
// 与旧版的有意偏差（旧版缺陷或依赖差异，交付说明单列）：
// 1. 旧版导出用 xlsx-style 生成 .xlsx；本项目没有该依赖，改用现成的 utils/csv（带 BOM，
//    Excel/WPS 直接打开不乱码），文件名口径不变：自动补全配置列表_YYYYMMDD。
// 2. 旧版导出会直接改 this.queryParam 的 pageNo/pageSize，污染后续搜索；这里导出用独立参数。
// 3. 旧版启停按钮本来就是注释掉的，且旧后端没有 /poc/dic/status —— 不提供状态列。
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Plus, Search } from '@element-plus/icons-vue'
import { dicTemplateApi } from '@/api/templateConfig'
import type { DicTemplate } from '@/api/types/template'
import { csvDateTag, downloadCsv, toCsv, type CsvCell } from '@/utils/csv'
import DicTemplateEditDialog from './DicTemplateEditDialog.vue'

defineOptions({ name: 'DicTemplatePage' })

// ---- 查询条件（草稿 → 执行 两态：改了不自动查，点「搜索」才发请求，同通用列表层口径）----
// 旧口径：参数名叫 name，模糊匹配的是「内容」content（搜索框标题就是「内容」）
const keyword = ref('')
const appliedName = ref('')

// ---- 列表状态 ----
const rows = ref<DicTemplate[]>([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const pageNo = ref(1)
const pageSize = ref(20)
/** 并发保护：慢请求回来时若已有新查询在跑，丢弃旧结果 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await dicTemplateApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, name: appliedName.value })
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
  appliedName.value = keyword.value.trim()
  pageNo.value = 1
  void load()
}

/** 弹窗保存后回到第一页重查（旧 handleRefresh(true)） */
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

// ---- 导出（旧 exportData：按当前筛选取前 10000 条，列同列表去掉操作列）----
const EXPORT_COLUMNS: { prop: keyof DicTemplate & string; label: string }[] = [
  { prop: 'id', label: 'id' },
  { prop: 'content', label: '内容' },
  { prop: 'keyWords', label: '简称' },
  { prop: 'createTime', label: '创建时间' },
  { prop: 'updateTime', label: '修改时间' },
]

async function exportData() {
  exporting.value = true
  try {
    const res = await dicTemplateApi.page({ pageNo: 1, pageSize: 10000, name: appliedName.value })
    const data = res.list ?? []
    const csvRows: CsvCell[][] = data.map((row) => EXPORT_COLUMNS.map((col) => (row[col.prop] ?? '') as CsvCell))
    downloadCsv(`自动补全配置列表_${csvDateTag()}`, toCsv(EXPORT_COLUMNS.map((col) => col.label), csvRows))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    exporting.value = false
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof DicTemplateEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: DicTemplate) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="dt-shell" v-loading="loading">
    <!-- 查询区（旧页 a-form layout="inline"：一个「内容」输入框 + 搜索 / 导出按钮） -->
    <el-form :inline="true" class="dt-filter-form" size="small" @submit.prevent>
      <el-form-item label="内容">
        <el-input v-model="keyword" placeholder="内容" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Download" :loading="exporting" @click="exportData">导出</el-button>
      </el-form-item>
    </el-form>

    <div class="dt-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: DicTemplate) => row.id">
      <el-table-column prop="id" label="id" width="100" align="center" />
      <el-table-column prop="content" label="内容" min-width="360" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.content ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="keyWords" label="简称" min-width="260" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.keyWords ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="170" align="center" />
      <el-table-column prop="updateTime" label="修改时间" width="170" align="center" />
      <el-table-column label="操作" width="80" fixed="right" align="center">
        <template #default="{ row }">
          <div class="dt-row-actions">
            <span class="dt-op-link" @click="openEdit(row)">编辑</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="dt-pager">
      <el-pagination
        :current-page="pageNo"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        size="small"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <DicTemplateEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.dt-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.dt-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.dt-filter-form :deep(.el-input) {
  width: 200px;
}
.dt-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dt-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.dt-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.dt-op-link:hover {
  text-decoration: underline;
}
.dt-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
