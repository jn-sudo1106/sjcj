<script setup lang="ts">
// 分词配置（旧 ai-chat-view「模板配置 → 分词配置」，src/demo/WordSegmentConfigList.vue）。
// 模板域最后一个子模块：一条 = 分词词典里的一个词条（类型 / 内容 / 分词类型），
// 「数据索引同步」里 type=2 的分词同步就是往这张表灌数据。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**四个条件**（类型 / 内容 / 分词类型 / 状态），通用层只有一个名称输入框；
// · 工具条上有「批量新增」（一次 POST 一个对象数组，通用层的新增是单条表单）和「导出」
//   （toolbar 插槽拿不到当前已执行的筛选条件，导出会与列表不同口径）。
// 所以照数据字典 / 提示词 / 数据索引同步的先例在本目录自己实现，接口走 api/templateConfig.ts 的 wordSegmentApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版没有「新增」按钮：列表里的 showAdd 没绑到任何入口（死代码），单条新增端点也就走不到。
//    这里同样不提供单条新增，新增一律走「批量新增」（一行一条，与旧版一致），接口层因此只声明 update。
// 2. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /word-segment-config/status（参数走 body，口径照旧），行为等价、可逆；
//    旧版启停成功后还要重查当前页，这里与通用层、数据字典一致改为乐观更新（失败回滚），少一次请求。
// 3. 旧版批量新增会把格式不对的行**静默丢掉**，且一行都没解析出来时仍然把空数组 POST 给后端
//    （`if (list.length === 0) this.onCancel()` 后面没有 return）；这里把非法行的行号报出来、
//    零有效行不发请求。
// 4. 旧版编辑提交不看校验，三个字段留空也能存进库；这里三个必填直接拦下
//    （同 sql 模板、表模板、自动补全、数据索引同步的修正先例）。
// 5. 旧版导出用 xlsx-style 带单元格样式生成 .xlsx；本项目不引这个依赖，改用自研的
//    utils/format/xlsxExport 写出同样可被 Excel/WPS 直接打开的 .xlsx——列、列名、取数口径
//    （当前筛选 + 前 10000 条）与文件名（分词配置列表_YYYYMMDD）都照旧版，只不带表头底色/字体/列宽。
//    导出的状态列渲染成 启用/禁用（旧版导出的是原码值 0/1，打开表还得对照字典看）。
//    旧版导出会直接改 this.queryParam 的 pageNo/pageSize 污染后续搜索，这里导出用独立参数。
// 6. 旧版查询条件改了就直接带进下一次请求，这里与通用层一致：改了不自动查，点「搜索」才生效。
// 7. 旧页 handleDetail 引用的 $refs.detail 在模板里不存在（点不到的死代码），不迁。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Edit, Plus, Search } from '@element-plus/icons-vue'
import { wordSegmentApi } from '@/api/templateConfig'
import type { WordSegmentConfig } from '@/api/types/template'
import { downloadXlsx, exportDateTag, type XlsxCell } from '@/utils/format/xlsxExport'
import {
  STATUS_ALL_OPTION_LABEL,
  WORD_SEGMENT_STATUS_OPTIONS,
  wordSegmentStatusLabel,
} from './options'
import WordSegmentConfigEditDialog from './WordSegmentConfigEditDialog.vue'
import WordSegmentBatchAddDialog from './WordSegmentBatchAddDialog.vue'

defineOptions({ name: 'WordSegmentConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：四个参数都进 body，内容模糊筛的参数名叫 name，空串 = 全部
const draft = reactive({ type: '', name: '', token: '', status: '' })
const applied = reactive({ type: '', name: '', token: '', status: '' })

// ---- 列表状态 ----
const rows = ref<WordSegmentConfig[]>([])
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
    const res = await wordSegmentApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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
  applied.type = draft.type.trim()
  applied.name = draft.name.trim()
  applied.token = draft.token.trim()
  applied.status = draft.status
  pageNo.value = 1
  void load()
}

/** 弹窗保存后回第一页重查（旧 handleRefresh(true)）；启停在状态列就地乐观更新，不走这里 */
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

// ---- 状态开关（'0' 启用 / '1' 禁用，字符串口径照旧平台；真实响应回数字 0，所以先 String()）----
function isEnabled(row: WordSegmentConfig): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: WordSegmentConfig, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await wordSegmentApi.changeStatus(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 导出（旧 exportData：按当前筛选取前 10000 条，列同列表去掉操作列）----
const EXPORT_COLUMNS: { prop: keyof WordSegmentConfig & string; label: string }[] = [
  { prop: 'id', label: 'id' },
  { prop: 'type', label: '类型' },
  { prop: 'content', label: '内容' },
  { prop: 'token', label: '分词类型' },
  { prop: 'status', label: '状态' },
  { prop: 'createTime', label: '创建时间' },
  { prop: 'updateTime', label: '修改时间' },
]

async function exportData() {
  exporting.value = true
  try {
    const res = await wordSegmentApi.page({ pageNo: 1, pageSize: 10000, ...applied })
    const rows: XlsxCell[][] = [EXPORT_COLUMNS.map((col) => col.label)]
    for (const row of res.list ?? []) {
      rows.push(EXPORT_COLUMNS.map((col) =>
        col.prop === 'status' ? wordSegmentStatusLabel(row.status) : ((row[col.prop] ?? '') as XlsxCell),
      ))
    }
    downloadXlsx(`分词配置列表_${exportDateTag()}`, rows, '分词配置列表')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    exporting.value = false
  }
}

// ---- 弹窗 ----
const editDialogRef = ref<InstanceType<typeof WordSegmentConfigEditDialog> | null>(null)
const batchDialogRef = ref<InstanceType<typeof WordSegmentBatchAddDialog> | null>(null)
function openEdit(row: WordSegmentConfig) {
  editDialogRef.value?.open(row)
}
function openBatchAdd() {
  batchDialogRef.value?.open()
}

onMounted(() => void load())
</script>

<template>
  <div class="ws-shell" v-loading="loading">
    <!-- 查询区（旧页四个 inline 表单项 + 搜索/导出，顺序照旧：类型 / 内容 / 分词类型 / 状态） -->
    <el-form :inline="true" class="ws-filter-form" size="small" @submit.prevent>
      <el-form-item label="类型">
        <el-input v-model="draft.type" placeholder="类型" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="draft.name" placeholder="内容" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="分词类型">
        <el-input v-model="draft.token" placeholder="分词类型" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in WORD_SEGMENT_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Download" :loading="exporting" @click="exportData">导出</el-button>
      </el-form-item>
    </el-form>

    <div class="ws-operator">
      <el-button type="primary" :icon="Plus" @click="openBatchAdd">批量新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: WordSegmentConfig) => row.id">
      <el-table-column prop="id" label="id" width="80" align="center" />
      <el-table-column prop="type" label="类型" width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.type ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="content" label="内容" min-width="260" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.content ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="token" label="分词类型" width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.token ?? '' }}</template>
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
      <el-table-column label="操作" width="60" fixed="right" align="center">
        <template #default="{ row }">
          <div class="ws-row-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="ws-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="ws-pager">
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

    <WordSegmentConfigEditDialog ref="editDialogRef" @saved="refresh(true)" />
    <WordSegmentBatchAddDialog ref="batchDialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.ws-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.ws-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.ws-filter-form :deep(.el-input),
.ws-filter-form :deep(.el-select) {
  width: 160px;
}
.ws-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ws-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.ws-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.ws-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.ws-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
