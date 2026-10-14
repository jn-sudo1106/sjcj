<script setup lang="ts">
// 数据索引同步（旧 ai-chat-view「模板配置 → 数据索引同步」，src/demo/DataIndexSyncList.vue）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 操作列有**同步**（POST /poc/data-index-sync/sync，本域独有的动作端点，通用层只有启停/复制）；
// · 同步类型列要把数字码值 0/1/2 渲染成中文（通用层的列只有 text/status/mono）；
// · 本域**没有启停端点**（旧列表与旧弹窗都没有启停入口），通用层的 status 列会渲染成可点的开关。
// 所以照表模板 / 自动补全 / 问句改写的先例在本目录自己实现，接口走 api/templateConfig.ts 的 dataIndexSyncApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版同步中的行没有 loading，连点会重复下发；这里同一行请求期间把「同步」置灰（不发第二个请求）。
// 2. 旧版查询条件改了就直接带进下一次请求，这里与通用层一致：改了不自动查，点「搜索」才生效。
// 3. 「同步」不做二次确认（旧平台点即执行，且行为可重复执行、不破坏配置）；请求结果照旧文案提示。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Search } from '@element-plus/icons-vue'
import { dataIndexSyncApi } from '@/api/templateConfig'
import type { DataIndexSync } from '@/api/types/template'
import {
  DATA_INDEX_SYNC_STATUS_OPTIONS,
  STATUS_ALL_OPTION_LABEL,
  dataIndexSyncStatusLabel,
  dataIndexSyncTypeLabel,
} from './options'
import DataIndexSyncEditDialog from './DataIndexSyncEditDialog.vue'

defineOptions({ name: 'DataIndexSyncPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：名称模糊筛的参数名叫 name（匹配的却是「同步名称」comment），状态空串 = 全部
const draft = reactive({ name: '', status: '' })
const applied = reactive({ name: '', status: '' })

// ---- 列表状态 ----
const rows = ref<DataIndexSync[]>([])
const total = ref(0)
const loading = ref(false)
const pageNo = ref(1)
const pageSize = ref(20)
/** 正在同步的行 id（旧版没有这个保护，连点会重复下发） */
const syncingIds = ref<Set<number>>(new Set())
/** 并发保护：慢请求回来时若已有新查询在跑，丢弃旧结果 */
let loadSeq = 0

async function load() {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await dataIndexSyncApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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

/** 弹窗保存后刷新：保存回第一页（旧 handleRefresh(true)），同步留在当前页（旧 syncData 传 false） */
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

// ---- 同步（旧平台独有动作：body 发 id 数组，单行同步就是 [row.id]）----
async function handleSync(row: DataIndexSync) {
  const id = Number(row.id)
  if (syncingIds.value.has(id)) return
  syncingIds.value = new Set([...syncingIds.value, id])
  try {
    await dataIndexSyncApi.sync([id])
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

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof DataIndexSyncEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: DataIndexSync) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="dis-shell" v-loading="loading">
    <!-- 查询区（旧页两个 inline 表单项 + 搜索/新增按钮在同一行，顺序照旧：名称 / 状态） -->
    <el-form :inline="true" class="dis-filter-form" size="small" @submit.prevent>
      <el-form-item label="名称">
        <el-input v-model="draft.name" placeholder="名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in DATA_INDEX_SYNC_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="rows" border stripe size="small" :row-key="(row: DataIndexSync) => row.id">
      <el-table-column prop="id" label="id" width="80" align="center" />
      <el-table-column label="同步类型" width="110" align="center">
        <template #default="{ row }">{{ dataIndexSyncTypeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column prop="comment" label="同步名称" min-width="200" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.comment ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="tableName" label="表/主题" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.tableName ?? '' }}</template>
      </el-table-column>
      <!-- 同步内容：sql同步/分词同步放 select，消息同步放 {"type":...} 串，都是长串 -->
      <el-table-column prop="syncSql" label="同步内容" min-width="320" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.syncSql ?? '' }}</template>
      </el-table-column>
      <!-- 本域没有启停端点，所以状态是**只读文本**，不做成开关（旧列表也是文字） -->
      <el-table-column prop="status" label="状态" width="80" align="center">
        <template #default="{ row }">{{ dataIndexSyncStatusLabel(row.status) }}</template>
      </el-table-column>
      <el-table-column prop="lastSync" label="最近同步时间" width="160" align="center">
        <template #default="{ row }">{{ row.lastSync ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="160" align="center" />
      <el-table-column prop="updateTime" label="修改时间" width="160" align="center" />
      <el-table-column label="操作" width="120" fixed="right" align="center">
        <template #default="{ row }">
          <div class="dis-row-actions">
            <span class="dis-op-link" @click="openEdit(row)">编辑</span>
            <span class="dis-op-divider">|</span>
            <span
              class="dis-op-link"
              :class="{ 'dis-op-link--pending': syncingIds.has(Number(row.id)) }"
              @click="handleSync(row)"
              >{{ syncingIds.has(Number(row.id)) ? '同步中' : '同步' }}</span
            >
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="dis-pager">
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

    <DataIndexSyncEditDialog ref="dialogRef" @saved="refresh(true)" />
  </div>
</template>

<style scoped>
.dis-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.dis-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.dis-filter-form :deep(.el-input),
.dis-filter-form :deep(.el-select) {
  width: 160px;
}
.dis-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.dis-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.dis-op-link:hover {
  text-decoration: underline;
}
/* 同步请求期间：置灰且不再发第二个请求（旧版连点会重复下发） */
.dis-op-link--pending,
.dis-op-link--pending:hover {
  color: var(--rc-faint, #94a3b8);
  cursor: not-allowed;
  text-decoration: none;
}
.dis-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.dis-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
