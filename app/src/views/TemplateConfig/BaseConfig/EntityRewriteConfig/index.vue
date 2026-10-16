<script setup lang="ts">
// 实体改写管理（旧 ai-chat-view「基础配置 → 实体改写管理」，src/demo/EntityRewriteConfigList.vue，1015 迁入）。
// 一条 = 问句里一个实体词的改写规则：按替换类型（正则 / 简单）把「替换内容」换成「目标内容」。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层（同选表规则配置）：
// · 查询区是**两个条件**（实体名称输入框 + 状态下拉），通用层只有一个名称输入框；
// · 替换类型列要把 cleanType 的码值渲染成中文（通用层的列只有 text/status/mono）；
// · 操作列有**删除**（/poc/entity-rewrite-config/delete），通用层没有这个入口。
// 接口走 api/templateConfig.ts 的 entityRewriteConfigApi，页面代码全部留在本目录。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /entity-rewrite-config/status，行为等价、可逆。旧列表本来没有状态列，加了列才放得下开关。
// 2. 旧版删除用的是 this.$confirm（旧工程全局挂载的 Modal.confirm），这里用项目的 ElMessageBox，
//    文案照旧（确定要删除该配置吗？/ 确认删除）。
// 3. 旧版「替换类型」列直接吐出英文码值（List.vue:96-100 没有 customRender），这里渲染成中文，未知码值留空。
// 4. 旧版查询条件改了就直接带进下一次翻页请求，这里与通用层一致：改了不自动查，点「搜索」才生效；
//    「重置」按参数设置的口径清掉草稿与已生效条件并回第一页重查。
// 5. 旧版列表横向滚动 x:1400、时间列 200 宽，这里按项目表格惯例压到 160 + 省略提示。
//
// ⚠️ 本域四条端点还没在 186 后端实测通（分页回通用 500，见 api/endpoints.ts 的 poc/entity-rewrite-config），
// 现在整体走 mock。「状态」下拉在真实后端上生不生效未知，按 1:1 迁移原则保留这个条件、也不在前端自己过滤。
// ⚠️ 同域的选表规则 / 表改写真实行里 status 回的是**数字**，所以开关与筛选一律走 String(row.status)。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { entityRewriteConfigApi } from '@/api/templateConfig'
import type { EntityRewriteConfig } from '@/api/types/template'
import { ENTITY_REWRITE_CONFIG_STATUS_OPTIONS, STATUS_ALL_OPTION_LABEL, entityRewriteCleanTypeLabel } from './options'
import EntityRewriteConfigEditDialog from './EntityRewriteConfigEditDialog.vue'

defineOptions({ name: 'EntityRewriteConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：实体名称输入框上送参数名 entityName，状态空串 = 全部
const draft = reactive({ entityName: '', status: '' })
const applied = reactive({ entityName: '', status: '' })

// ---- 列表状态 ----
const rows = ref<EntityRewriteConfig[]>([])
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
    const res = await entityRewriteConfigApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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
  applied.entityName = draft.entityName.trim()
  applied.status = draft.status
  pageNo.value = 1
  void load()
}

/** 旧版「重置」只清草稿、不重查（清掉后靠下一次翻页把空条件带上去）；这里与参数设置同口径，清完直接回第一页重查 */
function resetQuery() {
  draft.entityName = ''
  draft.status = ''
  applied.entityName = ''
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
function isEnabled(row: EntityRewriteConfig): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: EntityRewriteConfig, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await entityRewriteConfigApi.changeStatus?.(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 删除（旧 deleteConfig，id 走 query）----
async function handleDelete(row: EntityRewriteConfig) {
  try {
    await ElMessageBox.confirm('确定要删除该配置吗？', '确认删除', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' })
  } catch {
    return // 用户取消
  }
  try {
    await entityRewriteConfigApi.remove(Number(row.id))
    ElMessage.success('删除成功')
    refresh(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof EntityRewriteConfigEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: EntityRewriteConfig) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="erc-shell" v-loading="loading">
    <!-- 查询区（旧页两个 inline 表单项 + 查询/重置/新建，顺序照旧：实体名称 / 状态） -->
    <el-form :inline="true" class="erc-filter-form" size="small" @submit.prevent>
      <el-form-item label="实体名称">
        <el-input v-model="draft.entityName" placeholder="实体名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择状态">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in ENTITY_REWRITE_CONFIG_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="erc-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: EntityRewriteConfig) => row.id">
      <el-table-column prop="id" label="id" width="70" align="center" />
      <el-table-column prop="entityName" label="实体名称" min-width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.entityName ?? '' }}</template>
      </el-table-column>
      <el-table-column label="替换类型" width="110" align="center">
        <template #default="{ row }">{{ entityRewriteCleanTypeLabel(row.cleanType) }}</template>
      </el-table-column>
      <el-table-column prop="content" label="替换内容" min-width="180" align="center" show-overflow-tooltip>
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
          <div class="erc-row-actions">
            <span class="erc-op-link" @click="openEdit(row)">编辑</span>
            <span class="erc-op-divider">|</span>
            <span class="erc-op-link erc-op-link--danger" @click="handleDelete(row)">删除</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="erc-pager">
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

    <EntityRewriteConfigEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.erc-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.erc-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.erc-filter-form :deep(.el-input),
.erc-filter-form :deep(.el-select) {
  width: 160px;
}
.erc-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.erc-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.erc-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.erc-op-link:hover {
  text-decoration: underline;
}
/* 旧版「删除」就是红色文字链接，沿用（不改成大号实心按钮，同控件强调约定） */
.erc-op-link--danger {
  color: var(--rc-danger, #dc2626);
}
.erc-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.erc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
