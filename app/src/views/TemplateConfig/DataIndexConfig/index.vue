<script setup lang="ts">
// 数据字典配置（旧 ai-chat-view「模板配置 → 数据字典配置」，src/demo/DataIndexList.vue）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**四个条件**（内容 / 编码 / 类型 / 状态），通用层只有一个名称输入框；
// · 「编码」是**远程下拉**（GET /poc/data-index-config/all-code，选项文案是 `编码 类型`），通用层没有这种筛选项；
// · 工具条上有「导出」（toolbar 插槽拿不到当前已执行的筛选条件，导出会与列表不同口径）。
// 所以照表模板 / 自动补全 / 问句改写 / 数据索引同步的先例在本目录自己实现，接口走 api/templateConfig.ts 的 dataIndexConfigApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /data-index-config/status（参数走 body，口径照旧），行为等价、可逆。旧列表本来就在状态列
//    显示文字，换成开关不动列结构。旧版启停成功后还要重查当前页，这里与通用层、问句改写一致改为
//    乐观更新（失败回滚），少一次请求。
// 2. 旧版导出用 xlsx-style 带单元格样式生成 .xlsx；本项目不引这个依赖，改用自研的
//    utils/format/xlsxExport 写出同样可被 Excel/WPS 直接打开的 .xlsx——列、列名、取数口径
//    （当前筛选 + 前 10000 条）与文件名（数据字典列表_YYYYMMDD）都照旧版，只不带表头底色/字体/列宽。
//    导出的状态列渲染成 启用/禁用（旧版导出的是原码值 0/1，打开表还得对照字典看）。
// 3. 旧版导出会直接改 this.queryParam 的 pageNo/pageSize，污染后续搜索；这里导出用独立参数。
// 4. 「编码」下拉加了 clearable：旧版选中一个编码后没有任何回退到「全部」的入口（没有空值项，也没开 allowClear）。
//    旧版 @search 每次都重新拉全量（queryAllCode 根本没用到入参），这里改为挂载时拉一次、下拉内前端过滤，
//    筛出来的结果同口径，请求数只减不增。
// 5. 旧版查询条件改了就直接带进下一次请求，这里与通用层一致：改了不自动查，点「搜索」才生效。
// 6. 旧页 handleDetail 引用的 $refs.detail 在模板里不存在（点不到的死代码），不迁。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Plus, Search } from '@element-plus/icons-vue'
import { dataIndexConfigApi } from '@/api/templateConfig'
import type { DataIndexCodeOption, DataIndexConfig } from '@/api/types/template'
import { downloadXlsx, exportDateTag, type XlsxCell } from '@/utils/format/xlsxExport'
import {
  DATA_INDEX_CONFIG_STATUS_OPTIONS,
  STATUS_ALL_OPTION_LABEL,
  dataIndexCodeOptionLabel,
  dataIndexConfigStatusLabel,
} from './options'
import DataIndexConfigEditDialog from './DataIndexConfigEditDialog.vue'

defineOptions({ name: 'DataIndexConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：四个参数都进 body，内容模糊筛的参数名叫 name；编码/类型/状态空串 = 全部
const draft = reactive({ name: '', code: '', type: '', status: '' })
const applied = reactive({ name: '', code: '', type: '', status: '' })

// ---- 「编码」下拉选项（旧 queryAllCode：挂载时一次拉全量）----
const codeOptions = ref<DataIndexCodeOption[]>([])

// ---- 列表状态 ----
const rows = ref<DataIndexConfig[]>([])
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
    const res = await dataIndexConfigApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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

async function loadCodeOptions() {
  try {
    codeOptions.value = (await dataIndexConfigApi.allCode()) ?? []
  } catch (err) {
    // 旧 queryAllCode 的失败文案就是「操作失败」，1:1 保留；只影响下拉选项，列表照常
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

function runQuery() {
  applied.name = draft.name.trim()
  applied.code = draft.code
  applied.type = draft.type.trim()
  applied.status = draft.status
  pageNo.value = 1
  void load()
}

/** 弹窗保存后回到第一页重查（旧 handleRefresh(true)）；启停在状态列就地乐观更新，不走这里 */
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
function isEnabled(row: DataIndexConfig): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: DataIndexConfig, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await dataIndexConfigApi.changeStatus(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 导出（旧 exportData：按当前筛选取前 10000 条，列同列表去掉操作列）----
const EXPORT_COLUMNS: { prop: keyof DataIndexConfig & string; label: string }[] = [
  { prop: 'id', label: 'id' },
  { prop: 'code', label: '编码' },
  { prop: 'type', label: '类型' },
  { prop: 'content', label: '数据内容' },
  { prop: 'alias', label: '数据别名' },
  { prop: 'contentCode', label: '数据ID' },
  { prop: 'status', label: '状态' },
  { prop: 'createTime', label: '创建时间' },
  { prop: 'updateTime', label: '修改时间' },
]

async function exportData() {
  exporting.value = true
  try {
    const res = await dataIndexConfigApi.page({ pageNo: 1, pageSize: 10000, ...applied })
    const rows: XlsxCell[][] = [EXPORT_COLUMNS.map((col) => col.label)]
    for (const row of res.list ?? []) {
      rows.push(EXPORT_COLUMNS.map((col) =>
        col.prop === 'status' ? dataIndexConfigStatusLabel(row.status) : ((row[col.prop] ?? '') as XlsxCell),
      ))
    }
    downloadXlsx(`数据字典列表_${exportDateTag()}`, rows, '数据字典列表')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    exporting.value = false
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof DataIndexConfigEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: DataIndexConfig) {
  dialogRef.value?.open(row)
}

onMounted(() => {
  void load()
  void loadCodeOptions()
})
</script>

<template>
  <div class="dic-shell" v-loading="loading">
    <!-- 查询区（旧页四个 inline 表单项 + 搜索/导出，顺序照旧：内容 / 编码 / 类型 / 状态） -->
    <el-form :inline="true" class="dic-filter-form" size="small" @submit.prevent>
      <el-form-item label="内容">
        <el-input v-model="draft.name" placeholder="内容" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="编码">
        <el-select v-model="draft.code" placeholder="请选择" filterable clearable>
          <el-option
            v-for="option in codeOptions"
            :key="String(option.code)"
            :label="dataIndexCodeOptionLabel(option)"
            :value="String(option.code ?? '')"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-input v-model="draft.type" placeholder="类型" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in DATA_INDEX_CONFIG_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Download" :loading="exporting" @click="exportData">导出</el-button>
      </el-form-item>
    </el-form>

    <div class="dic-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: DataIndexConfig) => row.id">
      <el-table-column prop="id" label="id" width="80" align="center" />
      <el-table-column prop="code" label="编码" width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.code ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.type ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="content" label="数据内容" min-width="260" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.content ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="alias" label="数据别名" min-width="200" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.alias ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="contentCode" label="数据ID" width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.contentCode ?? '' }}</template>
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
          <div class="dic-row-actions">
            <span class="dic-op-link" @click="openEdit(row)">编辑</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="dic-pager">
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

    <DataIndexConfigEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.dic-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.dic-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.dic-filter-form :deep(.el-input),
.dic-filter-form :deep(.el-select) {
  width: 160px;
}
.dic-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dic-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.dic-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.dic-op-link:hover {
  text-decoration: underline;
}
.dic-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
