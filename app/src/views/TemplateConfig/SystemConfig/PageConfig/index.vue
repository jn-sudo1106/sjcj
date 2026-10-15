<script setup lang="ts">
// 页面配置（旧 ai-chat-view「系统配置 → 页面配置」，src/system/config/SysPageConfigList.vue，1015 迁入「问数系统配置」tab）。
// 一条 = 问数前端可配置的一个页面标识（内容），启用/禁用控制是否在问数侧生效。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**状态下拉**（通用层是名称输入框）；
// · 工具条上有「批量新增」（一次 POST 一个 {content} 对象数组）和「导出」
//   （toolbar 插槽拿不到当前已执行的筛选条件，导出会与列表不同口径）—— 同分词配置的先在各自目录实现。
// 接口走 api/templateConfig.ts 的 pageConfigApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版没有「新增」按钮：弹窗的 doEdit('', false) add 分支没绑任何入口、分支内请求又被注释掉（死代码），
//    单条新增端点也就不迁；新增一律走「批量新增」（同分词配置偏差 1）。
// 2. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /system/page-config/status（参数走 body，口径照旧），行为等价、可逆；
//    旧版启停成功后还要重查当前页，这里与通用层一致改为乐观更新（失败回滚），少一次请求。
// 3. 旧版批量新增把空行也发 {content:''}、零有效行仍 POST 空数组（见批量弹窗偏差 2），这里过滤空白行、
//    每段 trim，零有效行不发请求。
// 4. 旧版编辑不看校验，内容留空也能存进库；这里必填直接拦下（同分词/数据字典先例）。
// 5. 旧版导出用 xlsx-style 带单元格样式生成 .xlsx，且文件名前缀写的是「分词配置列表_」（从分词页复制过来忘了改）；
//    本项目不引 xlsx-style，改用自研 utils/format/xlsxExport（同分词配置偏差 5），文件名按本页正名
//    「页面配置列表_YYYYMMDD」，列、列名、取数口径（当前筛选 + 前 10000 条）照旧版。
//    导出的状态列渲染成 启用/禁用（旧版导出的是原码值 0/1）。旧版导出会直接改 this.queryParam 的
//    pageNo/pageSize 污染后续搜索，这里导出用独立参数。
// 6. 旧版查询条件改了就直接带进下一次请求，这里与通用层一致：改了不自动查，点「搜索」才生效。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Plus, Search } from '@element-plus/icons-vue'
import { pageConfigApi } from '@/api/templateConfig'
import type { SysPageConfig } from '@/api/types/template'
import { downloadXlsx, exportDateTag, type XlsxCell } from '@/utils/format/xlsxExport'
import {
  PAGE_CONFIG_STATUS_OPTIONS,
  STATUS_ALL_OPTION_LABEL,
  pageConfigStatusLabel,
} from './options'
import PageConfigEditDialog from './PageConfigEditDialog.vue'
import PageConfigBatchAddDialog from './PageConfigBatchAddDialog.vue'

defineOptions({ name: 'PageConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：queryParam 固定带 name:''/type:''/status:''（类型/内容搜索框被注释掉但参数照发），1:1 保留入参形状
const draft = reactive({ status: '' })
const applied = reactive({ status: '' })

// ---- 列表状态 ----
const rows = ref<SysPageConfig[]>([])
const total = ref(0)
const loading = ref(false)
const exporting = ref(false)
const pageNo = ref(1)
const pageSize = ref(20)
/** 并发保护：慢请求回来时若已有新查询在跑，丢弃旧结果 */
let loadSeq = 0

function buildQuery(pageNoValue: number, pageSizeValue: number) {
  return { pageNo: pageNoValue, pageSize: pageSizeValue, name: '', type: '', status: applied.status }
}

async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await pageConfigApi.page(buildQuery(pageNo.value, pageSize.value))
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
  applied.status = draft.status
  pageNo.value = 1
  void load()
}

/** 弹窗保存后刷新：保存回第一页（旧 handleRefresh(true)），启停留在当前页（旧 changeStatus 传 false） */
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

// ---- 状态开关（'0' 启用 / '1' 禁用，字符串口径照旧平台；真实响应可能回数字，先 String()）----
function isEnabled(row: SysPageConfig): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: SysPageConfig, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await pageConfigApi.changeStatus(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 导出（旧 exportData：按当前筛选取前 10000 条，列同列表去掉操作列）----
const EXPORT_COLUMNS: { prop: keyof SysPageConfig & string; label: string }[] = [
  { prop: 'id', label: 'id' },
  { prop: 'content', label: '内容' },
  { prop: 'status', label: '状态' },
  { prop: 'createTime', label: '创建时间' },
  { prop: 'updateTime', label: '修改时间' },
]

async function exportData() {
  exporting.value = true
  try {
    const res = await pageConfigApi.page(buildQuery(1, 10000))
    const cells: XlsxCell[][] = [EXPORT_COLUMNS.map((col) => col.label)]
    for (const row of res.list ?? []) {
      cells.push(EXPORT_COLUMNS.map((col) =>
        col.prop === 'status' ? pageConfigStatusLabel(row.status) : ((row[col.prop] ?? '') as XlsxCell),
      ))
    }
    downloadXlsx(`页面配置列表_${exportDateTag()}`, cells, '页面配置列表')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    exporting.value = false
  }
}

// ---- 弹窗 ----
const editDialogRef = ref<InstanceType<typeof PageConfigEditDialog> | null>(null)
const batchDialogRef = ref<InstanceType<typeof PageConfigBatchAddDialog> | null>(null)
function openEdit(row: SysPageConfig) {
  editDialogRef.value?.open(row)
}
function openBatchAdd() {
  batchDialogRef.value?.open()
}

onMounted(() => void load())
</script>

<template>
  <div class="scp-shell" v-loading="loading">
    <!-- 查询区（旧页一个状态下拉 + 搜索/导出，导出挨着搜索按钮放，顺序照旧） -->
    <el-form :inline="true" class="scp-filter-form" size="small" @submit.prevent>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in PAGE_CONFIG_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Download" :loading="exporting" @click="exportData">导出</el-button>
      </el-form-item>
    </el-form>

    <div class="scp-operator">
      <el-button type="primary" :icon="Plus" @click="openBatchAdd">批量新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: SysPageConfig) => row.id">
      <el-table-column prop="id" label="id" width="80" align="center" />
      <el-table-column prop="content" label="内容" min-width="300" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.content ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="96" align="center">
        <template #default="{ row }">
          <el-switch
            size="small"
            :model-value="isEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="禁用"
            @change="(v: string | number | boolean) => toggleStatus(row, !!v)"
          />
        </template>
      </el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="160" align="center" />
      <el-table-column prop="updateTime" label="修改时间" width="160" align="center" />
      <el-table-column label="操作" width="80" fixed="right" align="center">
        <template #default="{ row }">
          <div class="scp-row-actions">
            <span class="scp-op-link" @click="openEdit(row)">编辑</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="scp-pager">
      <el-pagination
        :current-page="pageNo"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <PageConfigEditDialog ref="editDialogRef" @saved="refresh(true)" />
    <PageConfigBatchAddDialog ref="batchDialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.scp-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.scp-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.scp-filter-form :deep(.el-select) {
  width: 160px;
}
.scp-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.scp-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.scp-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.scp-op-link:hover {
  text-decoration: underline;
}
.scp-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
