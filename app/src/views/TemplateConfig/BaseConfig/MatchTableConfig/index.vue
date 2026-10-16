<script setup lang="ts">
// 选表规则配置（旧 ai-chat-view「基础配置 → 选表规则配置」，src/demo/MatchTableConfigList.vue，1015 迁入）。
// 一条规则 = 一张表怎么被选中：问句选表按规则文本匹配，向量选表按 rule 里的向量表检索。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**两个条件**（表名称输入框 + 状态下拉），通用层只有一个名称输入框；
// · 选表类型列要把码值渲染成中文（通用层的列只有 text/status/mono）；
// · 操作列有**删除**（/poc/match-table-config/delete），通用层没有这个入口。
// 所以照问句改写 / 提示词配置的先例在本目录自己实现，接口走 api/templateConfig.ts 的 matchTableConfigApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /match-table-config/status，行为等价、可逆。旧列表本来没有状态列，加了列才放得下开关。
// 2. 旧版删除用的是 this.$confirm（旧工程全局挂载的 Modal.confirm），这里用项目的 ElMessageBox，
//    文案照旧（确定要删除该配置吗？/ 确认删除）。
// 3. 旧版查询条件改了就直接带进下一次翻页请求，这里与通用层一致：改了不自动查，点「搜索」才生效；
//    「重置」按参数设置的口径清掉草稿与已生效条件并回第一页重查。
// 4. 旧版列表横向滚动 x:1400、时间列 200 宽，这里按项目表格惯例压到 160 + 省略提示。
// 5. 选表类型列不再照抄旧版的三元表达式（text_selection → 问句选表，**其余一律向量选表**），
//    未知/空缺的码值改为留空，见 options.ts 的 matchTableSelectionTypeLabel。
//
// ⚠️ 「状态」下拉在真实后端上是**空转**的：186 实测 status 传 '0' / '1' / 数字 / 不传，四种请求都回同样的全量
//（旧平台同为这个行为，见 api/endpoints.ts 的 poc/match-table-config/page）。按 1:1 迁移原则保留这个条件、
// 也不在前端自己过滤 —— 要真筛得改后端。
// ⚠️ 真实行的 status 回的是**数字**（2026-10-15 抓样为 1），所以开关与筛选一律走 String(row.status)。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { matchTableConfigApi } from '@/api/templateConfig'
import type { MatchTableConfig } from '@/api/types/template'
import { MATCH_TABLE_CONFIG_STATUS_OPTIONS, STATUS_ALL_OPTION_LABEL, matchTableSelectionTypeLabel } from './options'
import MatchTableConfigEditDialog from './MatchTableConfigEditDialog.vue'

defineOptions({ name: 'MatchTableConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：表名称输入框上送的参数名叫 name（实体列是 tableName），状态空串 = 全部
const draft = reactive({ name: '', status: '' })
const applied = reactive({ name: '', status: '' })

// ---- 列表状态 ----
const rows = ref<MatchTableConfig[]>([])
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
    const res = await matchTableConfigApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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
  applied.name = draft.name.trim()
  applied.status = draft.status
  pageNo.value = 1
  void load()
}

/** 旧版「重置」只清草稿、不重查（清掉后靠下一次翻页把空条件带上去）；这里与参数设置同口径，清完直接回第一页重查 */
function resetQuery() {
  draft.name = ''
  draft.status = ''
  applied.name = ''
  applied.status = ''
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
function isEnabled(row: MatchTableConfig): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: MatchTableConfig, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await matchTableConfigApi.changeStatus?.(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 删除（旧 deleteConfig，id 走 query）----
async function handleDelete(row: MatchTableConfig) {
  try {
    await ElMessageBox.confirm('确定要删除该配置吗？', '确认删除', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' })
  } catch {
    return // 用户取消
  }
  try {
    await matchTableConfigApi.remove(Number(row.id))
    ElMessage.success('删除成功')
    refresh(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof MatchTableConfigEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: MatchTableConfig) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="mtc-shell" v-loading="loading">
    <!-- 查询区（旧页两个 inline 表单项 + 查询/重置/新建，顺序照旧：表名称 / 状态） -->
    <el-form :inline="true" class="mtc-filter-form" size="small" @submit.prevent>
      <el-form-item label="表名称">
        <el-input v-model="draft.name" placeholder="表名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择状态">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in MATCH_TABLE_CONFIG_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="mtc-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: MatchTableConfig) => row.id">
      <el-table-column prop="id" label="id" width="70" align="center" />
      <el-table-column prop="tableName" label="表名称" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.tableName ?? '' }}</template>
      </el-table-column>
      <el-table-column label="选表类型" width="110" align="center">
        <template #default="{ row }">{{ matchTableSelectionTypeLabel(row.selectionType) }}</template>
      </el-table-column>
      <el-table-column prop="rule" label="匹配规则" min-width="260" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.rule ?? '' }}</template>
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
      <el-table-column label="操作" width="90" fixed="right" align="center">
        <template #default="{ row }">
          <div class="mtc-row-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="mtc-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="删除" placement="top">
              <span class="mtc-op-icon mtc-op-danger" @click="handleDelete(row)"><el-icon :size="15"><Delete /></el-icon></span>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="mtc-pager">
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

    <MatchTableConfigEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.mtc-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.mtc-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.mtc-filter-form :deep(.el-input),
.mtc-filter-form :deep(.el-select) {
  width: 160px;
}
.mtc-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mtc-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.mtc-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.mtc-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
/* 删除保持危险色（不改成大号实心按钮，同控件强调约定） */
.mtc-op-icon.mtc-op-danger {
  color: var(--rc-danger, #dc2626);
}
.mtc-op-icon.mtc-op-danger:hover {
  background: var(--rc-danger-bg, #fef2f2);
  color: var(--rc-danger, #dc2626);
}
.mtc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
