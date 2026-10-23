<script setup lang="ts">
// 表改写管理（旧 ai-chat-view「基础配置 → 表改写管理」，src/demo/ReplaceTableConfigList.vue，1015 迁入）。
// 一条 = 一张表在出 SQL 时整体换成另一张表：tableName 是被改写的表，replaceTableName 是换进去的表，
// 替换类型旧平台只有 unionall 一个码值（旧弹窗下拉的唯一选项）。
//
// 为什么这一页没有走 components/templateConfig 的通用 schema 列表层：
// · 查询区是**两个条件**（表名称输入框 + 状态下拉），通用层的 TemplateListPage 只有一个 searchProp 输入框，
//   多出来的「状态」没地方放 —— 这是唯一的拦路项，其余（列的 text/status、弹窗的 select/radio 字段）通用层都覆盖得了。
// 所以照同域的选表规则配置先例在本目录自己实现，接口走 api/templateConfig.ts 的 replaceTableConfigApi。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版「启用/禁用」是操作列里的文字链接，这里改成状态列滑动开关（AGENTS.md 控件强调约定），
//    仍然只发一次 /replace-table-config/status，行为等价、可逆。旧列表本来没有状态列，加了列才放得下开关。
// 2. 旧版查询条件改了就直接带进下一次翻页请求，这里与通用层一致：改了不自动查，点「搜索」才生效；
//    「重置」按参数设置的口径清掉草稿与已生效条件并回第一页重查。
// 3. 旧版列表横向滚动 x:1400、时间列 200 宽，这里按项目表格惯例压到 160 + 省略提示。
// 4. 操作列只有「编辑」—— 本域旧接口文件只有 page / 根 / status 三个端点，**没有删除**，
//    所以不像选表规则配置那样补一个删除入口（旧平台也没有）。
//
// ⚠️ 与选表规则配置**不同**：本域分页的「状态」筛选在真实后端是**生效的**（2026-10-15 在 186 实测
// status 传 '0' 回 0 条、'1' 回全量 2 条），所以这个下拉不是占位控件。
// ⚠️ 真实行的 status 回的是**数字**（2026-10-15 抓样为 1），所以开关与筛选一律走 String(row.status)。
// ⚠️ 「表名称」搜索框上送的参数名是 name、实体列是 tableName（旧 ReplaceTableConfigList.vue:11、90-98），
// 实测按 tableName 模糊筛且**大小写敏感**（name=JX 回 1 条、name=jx 回 0 条）—— 旧平台同口径，不在前端补归一。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Edit, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { replaceTableConfigApi } from '@/api/templateConfig'
import type { ReplaceTableConfig } from '@/api/types/template'
import { REPLACE_TABLE_CONFIG_STATUS_OPTIONS, STATUS_ALL_OPTION_LABEL } from './options'
import ReplaceTableConfigEditDialog from './ReplaceTableConfigEditDialog.vue'

defineOptions({ name: 'ReplaceTableConfigPage' })

// ---- 查询条件（草稿 → 执行 两态）----
// 旧口径：表名称输入框上送的参数名叫 name（实体列是 tableName），状态空串 = 全部
const draft = reactive({ name: '', status: '' })
const applied = reactive({ name: '', status: '' })

// ---- 列表状态 ----
const rows = ref<ReplaceTableConfig[]>([])
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
    const res = await replaceTableConfigApi.page({ pageNo: pageNo.value, pageSize: pageSize.value, ...applied })
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

/** 弹窗保存后回第一页重查（旧 handleRefresh(true)） */
function refreshAfterSave() {
  pageNo.value = 1
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
// 旧版启停后会 handleRefresh(false) 重查当前页；这里与选表规则配置同口径：只发一次 /status，
// 靠乐观更新改这一行的显示，失败回滚，不再为一条状态变化多打一次分页请求。
function isEnabled(row: ReplaceTableConfig): boolean {
  return String(row.status) === '0'
}
async function toggleStatus(row: ReplaceTableConfig, nextEnabled: boolean) {
  const prev = row.status
  const next = nextEnabled ? '0' : '1'
  row.status = next // 乐观更新，失败回滚
  try {
    await replaceTableConfigApi.changeStatus?.(Number(row.id), next)
    ElMessage.success(nextEnabled ? '已启用' : '已禁用')
  } catch (err) {
    row.status = prev
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof ReplaceTableConfigEditDialog> | null>(null)
function openAdd() {
  dialogRef.value?.open()
}
function openEdit(row: ReplaceTableConfig) {
  dialogRef.value?.open(row)
}

onMounted(() => void load())
</script>

<template>
  <div class="rtc-shell" v-loading="loading">
    <!-- 查询区（旧页两个 inline 表单项 + 查询/重置/新建，顺序照旧：表名称 / 状态） -->
    <el-form :inline="true" class="rtc-filter-form" size="small" @submit.prevent>
      <el-form-item label="表名称">
        <el-input v-model="draft.name" placeholder="表名称" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="draft.status" placeholder="请选择状态">
          <el-option :label="STATUS_ALL_OPTION_LABEL" value="" />
          <el-option v-for="option in REPLACE_TABLE_CONFIG_STATUS_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">搜索</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="rtc-operator">
      <el-button type="primary" :icon="Plus" @click="openAdd">新增</el-button>
    </div>

    <el-table :data="rows" border stripe size="small" :row-key="(row: ReplaceTableConfig) => row.id">
      <el-table-column prop="id" label="id" width="70" align="center" />
      <el-table-column prop="tableName" label="表名称" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.tableName ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="replaceType" label="类型" width="110" align="center">
        <template #default="{ row }">{{ row.replaceType ?? '' }}</template>
      </el-table-column>
      <el-table-column prop="replaceTableName" label="替换表" min-width="180" align="center" show-overflow-tooltip>
        <template #default="{ row }">{{ row.replaceTableName ?? '' }}</template>
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
      <!-- 本域没有删除端点（旧接口只有 page / 根 / status），操作列只留编辑 -->
      <el-table-column label="操作" width="60" fixed="right" align="center">
        <template #default="{ row }">
          <div class="rtc-row-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="rtc-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="rtc-pager">
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

    <ReplaceTableConfigEditDialog ref="dialogRef" @saved="refreshAfterSave" />
  </div>
</template>

<style scoped>
.rtc-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.rtc-filter-form :deep(.el-form-item) {
  margin-bottom: 0;
  margin-right: 8px;
}
.rtc-filter-form :deep(.el-input),
.rtc-filter-form :deep(.el-select) {
  width: 160px;
}
.rtc-operator {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rtc-row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.rtc-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.rtc-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.rtc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
