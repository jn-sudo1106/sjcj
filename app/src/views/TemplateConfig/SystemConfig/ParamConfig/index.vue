<script setup lang="ts">
// 参数设置（旧 ai-chat-view「系统配置 → 参数设置」，src/system/config/ConfigIndex.vue，1015 迁入「问数系统配置」tab）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**两个输入框**（参数编码 / 参数名称），通用层只有一个名称输入框；
// · 旧操作列的「修改」要先请求 GET /poc/system/config/{configId} 拉详情再回填弹窗（detail 端点 id 走路径段），
//   通用层的编辑直接吃当前行数据，表达不了这次取数。
// 所以照分词 / 提示词的先在各自目录实现，接口走 api/templateConfig.ts 的 systemConfigApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版工具栏的新增/删除/导出/刷新缓存按钮全部被注释掉，queryParam 里的 configType 也恒为 undefined
//    —— 这里只迁「搜索 / 重置 + 列表 + 修改」，与旧版实际可见的功能一致（接口层因此没有 add/delete/export/refreshCache）。
// 2. 旧版「重置」只清查询条件、不重查（与旧搜索同口径：点了搜索才发请求）；这里重置同时清掉已生效条件并回第一页重查，
//    与本项目其余模板列表页的草稿→执行两态模型一致。
// 3. 旧版请求失败只 console.log + 一句「加载数据失败」，这里把后端 msg 透出来（同其余模板模块）。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit, Refresh, Search } from '@element-plus/icons-vue'
import { systemConfigApi } from '@/api/templateConfig'
import type { SystemConfigParam } from '@/api/types/template'
import ParamConfigEditDialog from './ParamConfigEditDialog.vue'

defineOptions({ name: 'ParamConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：configKey / configName 两个模糊筛选进 body（旧 queryParam 里恒 undefined 的 configType 不上送）
const draft = reactive({ configKey: '', configName: '' })
const applied = reactive({ configKey: '', configName: '' })

// ---- 列表状态 ----
const rows = ref<SystemConfigParam[]>([])
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
    const res = await systemConfigApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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
  applied.configKey = draft.configKey.trim()
  applied.configName = draft.configName.trim()
  pageNo.value = 1
  void load()
}

function resetQuery() {
  draft.configKey = ''
  draft.configName = ''
  applied.configKey = ''
  applied.configName = ''
  pageNo.value = 1
  void load()
}

/** 弹窗保存后回第一页重查（旧 @refresh="handleRefresh(true)"） */
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

// ---- 修改（旧 showEditor：先按 id 拉详情，再开弹窗回填）----
const dialogRef = ref<InstanceType<typeof ParamConfigEditDialog> | null>(null)
const detailLoading = ref(false)
async function openEdit(row: SystemConfigParam) {
  if (detailLoading.value) return
  detailLoading.value = true
  try {
    const detail = await systemConfigApi.detail(Number(row.id))
    dialogRef.value?.open(detail)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    detailLoading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="scp-shell" v-loading="loading">
    <!-- 查询区（旧页两个输入框 + 搜索/重置） -->
    <el-form :inline="true" class="scp-filter-form" size="small" @submit.prevent>
      <el-form-item label="参数编码">
        <el-input v-model="draft.configKey" placeholder="请输入参数编码" clearable @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="参数名称">
        <el-input v-model="draft.configName" placeholder="请输入参数名称" clearable @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <el-table :data="rows" border stripe size="small" :row-key="(row: SystemConfigParam) => row.id">
      <el-table-column prop="configKey" label="参数编码" min-width="220" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.configKey ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="configName" label="参数名称" min-width="220" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.configName ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="configValue" label="参数值" min-width="260" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.configValue ?? '' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="60" fixed="right" align="center">
        <template #default="{ row }">
          <div class="scp-row-actions">
            <el-tooltip content="修改" placement="top">
              <span class="scp-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
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
        size="small"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <ParamConfigEditDialog ref="dialogRef" @saved="refresh(true)" />
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
.scp-filter-form :deep(.el-input) {
  width: 180px;
}
.scp-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.scp-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.scp-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.scp-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
