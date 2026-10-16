<script setup lang="ts">
// 表模板配置（旧 ai-chat-view「模板配置 → 表模板配置」，src/demo/QuestionTempConfig.vue）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：旧编辑弹窗里有
// 「使用表范围」「sql模板」两个**远程搜索多选**，保存时还要把两个数组 JSON.stringify 成
// tableArr / sqlTempConfigIds（旧 QuestionTempEditModal.vue:142-143），通用层的
// input/textarea/select/radio 四种控件表达不了。所以列表在本目录内自己实现一份，
// 接口仍复用 api/templateConfig.ts 的 CRUD 工厂（tableTemplateApi）。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /question-temp/status，行为等价、可逆。
// 2. 旧版操作列的「复制」指向一个组件里不存在的方法，且旧后端没有 question-temp 复制端点
//    （EntityApi.js 只有 sql-temp/copy）。入口按用户要求保留，点击只提示未实现，不发请求。
// 3. 旧版列表把「表范围」列注释掉了，编辑弹窗里才能看到这块数据；这里保持 1:1 不展示。
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { DocumentCopy, Edit, Plus, Search } from '@element-plus/icons-vue'
import { tableTemplateApi } from '@/api/templateConfig'
import type { TableTemplate } from '@/api/types/template'
import TableTemplateEditDialog from './TableTemplateEditDialog.vue'

defineOptions({ name: 'TableTemplatePage' })

// ---- 查询条件（草稿 → 执行 两态：改了不自动查，点「搜索」才发请求，同通用列表层口径）----
const keyword = ref('')
const appliedName = ref('')

// ---- 列表状态 ----
const rows = ref<TableTemplate[]>([])
const total = ref(0)
const loading = ref(false)
const pageNo = ref(1)
const pageSize = ref(20)
/** 并发保护：慢请求回来时若已有新查询在跑，丢弃旧结果 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await tableTemplateApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, name: appliedName.value })
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

// ---- 状态开关（'0' 启用 / '1' 禁用，字符串口径照旧平台）----
function isEnabled(row: TableTemplate): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: TableTemplate, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await tableTemplateApi.changeStatus?.(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

function copyNotImplemented() {
  ElMessage.info('旧平台未提供表模板复制接口，功能未实现')
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof TableTemplateEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: TableTemplate) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="tt-shell" v-loading="loading">
    <!-- 查询区（旧页 a-form layout="inline"：一个「模板名称」输入框 + 搜索按钮） -->
    <el-form :inline="true" class="tt-filter-form" size="small" @submit.prevent>
      <el-form-item label="模板名称">
        <el-input v-model="keyword" placeholder="模板名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
      </el-form-item>
    </el-form>

    <div class="tt-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: TableTemplate) => row.id">
      <el-table-column prop="id" label="id" width="60" align="center" />
      <el-table-column prop="name" label="问句样例" min-width="240" align="center" show-overflow-tooltip />
      <el-table-column prop="rule" label="匹配规则" min-width="320" align="left" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="tt-mono">{{ row.rule ?? '' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="96" align="center">
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
      <el-table-column prop="createTime" label="创建时间" width="150" align="center" />
      <el-table-column prop="updateTime" label="修改时间" width="150" align="center" />
      <el-table-column label="操作" width="90" fixed="right" align="center">
        <template #default="{ row }">
          <div class="tt-row-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="tt-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="复制" placement="top">
              <span class="tt-op-icon" @click="copyNotImplemented"><el-icon :size="15"><DocumentCopy /></el-icon></span>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="tt-pager">
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

    <TableTemplateEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.tt-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.tt-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.tt-filter-form :deep(.el-input) {
  width: 200px;
}
.tt-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tt-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.tt-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.tt-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.tt-mono {
  font-family: var(--rc-mono, monospace);
  font-size: 11px;
}
.tt-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
