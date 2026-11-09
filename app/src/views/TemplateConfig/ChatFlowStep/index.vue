<script setup lang="ts">
// 提示词配置（旧 ai-chat-view「模板配置 → 提示词配置」，src/demo/ChatFlowStepList.vue）。
//
// ⚠️ 菜单标题叫「提示词配置」，但旧路由是 /demo/chat-flow-step-list、端点域是 /poc/chat-flow-step，
// 字段全是对话流程步骤口径（步骤编码 / 流程编码 / 下一步编码 / 模板定义）。旧平台自身的命名不一致，
// 1:1 迁移不改名，目录、路由、接口都按 chat-flow-step（同表模板：菜单叫表模板、端点域 question-temp）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 通用层的查询区是「一个名称输入框」，旧页面这里是**状态下拉**（实体根本没有 name 字段）；
// · 弹窗有 16 个可编辑字段，通用层的 fields 表达不了数字输入（重试次数是旧页唯一的 a-input-number）。
// 所以照问句改写 / 数据索引同步的先例在本目录自己实现，接口走 api/templateConfig.ts 的 chatFlowStepApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /chat-flow-step/status，行为等价、可逆。
// 2. 旧版请求失败只 console.log + 一句「加载数据失败」，这里把后端 msg 透出来（同其余模板模块）。
// 3. 旧版列表横向滚动 x:1400、时间列 200 宽，这里按项目表格惯例压到 160 + 省略提示。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit, Plus, Search } from '@element-plus/icons-vue'
import { chatFlowStepApi } from '@/api/templateConfig'
import type { ChatFlowStep } from '@/api/types/template'
import { CHAT_FLOW_STEP_STATUS_OPTIONS, STATUS_ALL_OPTION_LABEL } from './options'
import ChatFlowStepEditDialog from './ChatFlowStepEditDialog.vue'

defineOptions({ name: 'ChatFlowStepPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：只有状态一个下拉，空串 = 全部；queryParam 里还固定带一个 name: ''（实体没有该字段，后端忽略）
const draft = reactive({ status: '' })
const applied = reactive({ status: '' })

// ---- 列表状态 ----
const rows = ref<ChatFlowStep[]>([])
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
    const res = await chatFlowStepApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, name: '', ...applied })
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

// ---- 状态开关（'0' 启用 / '1' 禁用，字符串口径照旧平台）----
function isEnabled(row: ChatFlowStep): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: ChatFlowStep, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await chatFlowStepApi.changeStatus?.(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof ChatFlowStepEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: ChatFlowStep) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="cfs-shell" v-loading="loading">
    <!-- 查询区（旧页就一个状态下拉 + 搜索按钮） -->
    <el-form :inline="true" class="cfs-filter-form" size="small" @submit.prevent>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in CHAT_FLOW_STEP_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
      </el-form-item>
    </el-form>

    <div class="cfs-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: ChatFlowStep) => row.id">
      <el-table-column prop="id" label="id" width="70" align="center" />
      <el-table-column prop="stepCode" label="步骤编码" min-width="120" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.stepCode ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="flowCode" label="流程编码" min-width="110" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.flowCode ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="stepName" label="步骤名称" min-width="120" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.stepName ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="dictCodes" label="引用字典编码" min-width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.dictCodes ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="inputParams" label="入参定义" min-width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.inputParams ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="execCond" label="执行条件" min-width="140" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.execCond ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="stepAction" label="步骤动作" min-width="100" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.stepAction ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="templateDef" label="模板定义" min-width="200" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.templateDef ?? '' }}</template>
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
      <el-table-column label="操作" width="60" fixed="right" align="center">
        <template #default="{ row }">
          <div class="cfs-row-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="cfs-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="cfs-pager">
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

    <ChatFlowStepEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.cfs-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.cfs-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.cfs-filter-form :deep(.el-select) {
  width: 160px;
}
.cfs-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cfs-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.cfs-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.cfs-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.cfs-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
