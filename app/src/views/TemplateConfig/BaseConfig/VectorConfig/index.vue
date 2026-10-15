<script setup lang="ts">
// 向量表管理（旧 ai-chat-view「基础配置 → 向量表管理」，src/demo/VectorTableList.vue，1015 迁入）。
// 一条 = 一张向量表：源表 + 列映射（编码/内容/别名三行）配置好后同步进向量库，供「向量表数据浏览」与问数向量检索使用。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**两个条件**（向量表名称 + 源表名称），通用层只有一个名称输入框；
// · 保存 body 是 {config, items} 包装、删除按 **name** 不按 id、另有同步动作端点，通用层的 CRUD 面表达不了；
// · 操作列四个入口（详情/编辑/同步/删除），通用层没有同步与详情。
// 所以照选表规则配置的先例在本目录自己实现，接口走 api/templateConfig.ts 的 vectorConfigApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「详情」是同一个弹窗的只读态，这里保留同一实现（编辑弹窗三态），不拆成右侧抽屉 ——
//    与问数域各页「详情=编辑表单只读」的既有口径一致，实体详情抽屉约定不适用于表单只读态。
// 2. 旧版同步成功后不刷新列表（lastSync 已变但页面看不到），这里按数据索引同步的先例同步成功后刷新当前页。
// 3. 旧版删除后回第一页（handleRefresh(true)），这里照旧；同步失败旧版无兜底（未 catch），这里补错误提示。
// 4. 旧版「新建」按钮混在查询行里，这里与选表规则配置同口径放操作区；查询条件改为「点搜索才生效」的两态口径。
// 5. 旧列表横向滚动 x:1400、时间列 200 宽，这里按项目表格惯例压缩并加省略提示（同选表规则配置偏差 4）。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { vectorConfigApi } from '@/api/templateConfig'
import type { VectorTableConfig } from '@/api/types/template'
import VectorConfigEditDialog from './VectorConfigEditDialog.vue'

defineOptions({ name: 'VectorConfigPage' })

// ---- 查询条件（草稿 → 执行 两态；参数名照旧 queryParam：name / sourceTable）----
const draft = reactive({ name: '', sourceTable: '' })
const applied = reactive({ name: '', sourceTable: '' })

// ---- 列表状态 ----
const rows = ref<VectorTableConfig[]>([])
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
    const res = await vectorConfigApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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
  applied.sourceTable = draft.sourceTable.trim()
  pageNo.value = 1
  void load()
}

/** 旧版「重置」只清条件、靠下一次翻页带上；这里与参数设置口径一致：清完直接回第一页重查 */
function resetQuery() {
  draft.name = ''
  draft.sourceTable = ''
  applied.name = ''
  applied.sourceTable = ''
  pageNo.value = 1
  void load()
}

/** 保存/删除回第一页（旧 handleRefresh(true)）；同步留当前页（旧版同步后不刷新，见文件头偏差 2） */
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

// ---- 同步（旧 sync([record.id])，body 是 id 数组；行级防重入同数据索引同步先例）----
const syncingIds = ref<Set<number>>(new Set())
async function handleSync(row: VectorTableConfig) {
  const id = Number(row.id)
  if (syncingIds.value.has(id)) return
  syncingIds.value = new Set([...syncingIds.value, id])
  try {
    await vectorConfigApi.sync([id])
    ElMessage.success('同步成功')
    refresh(false)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '同步失败')
  } finally {
    const next = new Set(syncingIds.value)
    next.delete(id)
    syncingIds.value = next
  }
}

// ---- 删除（⚠️ 旧口径按**向量表名称**删：body {type: name}，不是 id）----
async function handleDelete(row: VectorTableConfig) {
  try {
    await ElMessageBox.confirm('确定要删除吗？', '确认删除', { type: 'warning', confirmButtonText: '确定', cancelButtonText: '取消' })
  } catch {
    return // 用户取消
  }
  try {
    await vectorConfigApi.remove(String(row.name))
    ElMessage.success('删除成功')
    refresh(true)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

// ---- 弹窗（新建 / 编辑 / 详情三态）----
const dialogRef = ref<InstanceType<typeof VectorConfigEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: VectorTableConfig) {
  dialogRef.value?.open(row)
}
function openDetail(row: VectorTableConfig) {
  dialogRef.value?.openDetail(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="vtc-shell" v-loading="loading">
    <!-- 查询区（旧页两个 inline 输入框：向量表名称 / 源表名称） -->
    <el-form :inline="true" class="vtc-filter-form" size="small" @submit.prevent>
      <el-form-item label="向量表名称">
        <el-input v-model="draft.name" placeholder="向量表名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="源表名称">
        <el-input v-model="draft.sourceTable" placeholder="源表名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="vtc-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新建</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: VectorTableConfig) => row.id">
      <el-table-column prop="id" label="id" width="70" align="center" />
      <el-table-column prop="name" label="向量表名称" min-width="200" align="center" show-overflow-tooltip />
      <el-table-column prop="comment" label="向量表备注" min-width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.comment ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="sourceTable" label="源表名" min-width="160" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.sourceTable ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="matchDegree" label="匹配度" width="90" align="center" />
      <el-table-column prop="dataIndexCode" label="字典表类型" width="120" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.dataIndexCode ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="lastSync" label="最近同步时间" width="160" align="center" />
      <el-table-column prop="updateTime" label="修改时间" width="160" align="center" />
      <el-table-column label="操作" width="160" fixed="right" align="center">
        <template #default="{ row }">
          <div class="vtc-row-actions">
            <span class="vtc-op-link" @click="openDetail(row)">详情</span>
            <span class="vtc-op-divider">|</span>
            <span class="vtc-op-link" @click="openEdit(row)">编辑</span>
            <span class="vtc-op-divider">|</span>
            <span class="vtc-op-link" :class="{ 'vtc-op-link--disabled': syncingIds.has(Number(row.id)) }" @click="handleSync(row)">同步</span>
            <span class="vtc-op-divider">|</span>
            <span class="vtc-op-link vtc-op-link--danger" @click="handleDelete(row)">删除</span>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="vtc-pager">
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

    <VectorConfigEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.vtc-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.vtc-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.vtc-filter-form :deep(.el-input) {
  width: 160px;
}
.vtc-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vtc-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.vtc-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.vtc-op-link:hover {
  text-decoration: underline;
}
.vtc-op-link--disabled {
  color: var(--rc-muted, #94a3b8);
  pointer-events: none;
}
/* 旧版「删除」就是红色文字链接，沿用（同控件强调约定） */
.vtc-op-link--danger {
  color: var(--rc-danger, #dc2626);
}
.vtc-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.vtc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
