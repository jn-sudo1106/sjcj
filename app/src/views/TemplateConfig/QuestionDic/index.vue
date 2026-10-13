<script setup lang="ts">
// 问句改写配置（旧 ai-chat-view「模板配置 → 问句改写配置」，src/demo/QuestionDicList.vue）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**四个条件**（阶段/类型/内容/状态），通用层只有一个名称输入框；
// · 阶段、类型两列要把码值渲染成中文（通用层的列只有 text/status/mono）；
// · 操作列有**删除**（模板域唯一的删除端点），通用层没有这个入口。
// 所以照表模板 / 自动补全的先例在本目录自己实现，接口走 api/templateConfig.ts 的 questionDicApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /question-dic/status，行为等价、可逆。旧列表本来没有状态列，加了列才放得下开关。
// 2. 旧版删除用 a-popconfirm，这里用项目的 ElMessageBox 确认框，文案照旧（确定要删除吗？/ 确定 / 取消）。
// 3. 旧版查询条件改了就直接带进下一次请求，这里与通用层一致：改了不自动查，点「搜索」才生效。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { questionDicApi } from '@/api/templateConfig'
import type { QuestionDic } from '@/api/types/template'
import {
  QUESTION_DIC_STATUS_OPTIONS,
  QUESTION_DIC_STEP_OPTIONS,
  QUESTION_DIC_TYPE_OPTIONS,
  STATUS_ALL_OPTION_LABEL,
  STEP_ALL_OPTION_LABEL,
  TYPE_ALL_OPTION_LABEL,
  questionDicStepLabel,
  questionDicTypeLabel,
} from './options'
import QuestionDicEditDialog from './QuestionDicEditDialog.vue'

defineOptions({ name: 'QuestionDicPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：内容模糊筛的参数名叫 name；阶段/类型/状态空串 = 全部
const draft = reactive({ stepCode: '', type: '', name: '', status: '' })
const applied = reactive({ stepCode: '', type: '', name: '', status: '' })

// ---- 列表状态 ----
const rows = ref<QuestionDic[]>([])
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
    const res = await questionDicApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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
  applied.stepCode = draft.stepCode
  applied.type = draft.type
  applied.name = draft.name.trim()
  applied.status = draft.status
  pageNo.value = 1
  void load()
}

/** 弹窗保存 / 删除后刷新：保存回第一页（旧 handleRefresh(true)），删除留在当前页（旧 changeStatus 传 false） */
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
function isEnabled(row: QuestionDic): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: QuestionDic, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await questionDicApi.changeStatus?.(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 删除（旧平台唯一的删除端点，body 发整行）----
async function handleDelete(row: QuestionDic) {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '提示', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' })
  } catch {
    return // 用户取消
  }
  try {
    await questionDicApi.remove(row)
    ElMessage.success('删除成功')
    refresh(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof QuestionDicEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: QuestionDic) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="qd-shell" v-loading="loading">
    <!-- 查询区（旧页四个 inline 表单项 + 搜索按钮，顺序照旧：阶段 / 类型 / 内容 / 状态） -->
    <el-form :inline="true" class="qd-filter-form" size="small" @submit.prevent>
      <el-form-item label="阶段">
        <el-select v-model="draft.stepCode" placeholder="请选择">
          <el-option :label="STEP_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in QUESTION_DIC_STEP_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="draft.type" placeholder="请选择">
          <el-option :label="TYPE_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in QUESTION_DIC_TYPE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="内容">
        <el-input v-model="draft.name" placeholder="内容" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in QUESTION_DIC_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
      </el-form-item>
    </el-form>

    <div class="qd-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: QuestionDic) => row.id">
      <el-table-column prop="id" label="id" width="80" align="center" />
      <el-table-column label="阶段" width="150" align="center">
        <template #default="{ row }">{{ questionDicStepLabel(row.stepCode) }}</template>
      </el-table-column>
      <el-table-column prop="receiveRule" label="接收条件" min-width="220" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.receiveRule ?? '' }}</template>
      </el-table-column>
      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">{{ questionDicTypeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column prop="content" label="内容" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.content ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="targetContent" label="目标内容" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.targetContent ?? '' }}</template>
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
      <el-table-column prop="createTime" label="创建时间" width="160" align="center" />
      <el-table-column prop="updateTime" label="修改时间" width="160" align="center" />
      <el-table-column label="操作" width="120" fixed="right" align="center">
        <template #default="{ row }">
          <div class="qd-row-actions">
            <span class="qd-op-link" @click="openEdit(row)">编辑</span>
            <span class="qd-op-divider">|</span>
            <span class="qd-op-link qd-op-link--danger" @click="handleDelete(row)">删除</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="qd-pager">
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

    <QuestionDicEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.qd-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.qd-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.qd-filter-form :deep(.el-input),
.qd-filter-form :deep(.el-select) {
  width: 160px;
}
.qd-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.qd-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.qd-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.qd-op-link:hover {
  text-decoration: underline;
}
/* 旧版「删除」就是红色文字链接，沿用（不改成大号实心按钮，同控件强调约定） */
.qd-op-link--danger {
  color: var(--rc-danger, #dc2626);
}
.qd-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.qd-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
