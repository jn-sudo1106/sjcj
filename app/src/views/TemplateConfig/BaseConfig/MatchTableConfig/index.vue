<script setup lang="ts">
// 选表规则配置（旧 ai-chat-view「基础配置 → 选表规则配置」，src/demo/MatchTableConfigList.vue，1015 迁入）。
// 一条规则 = 一张表怎么被选中：问句选表按规则文本匹配，向量选表按 rule 里的向量表检索。
//
// 2026-11-03 改版：左表右明细。左侧复用数据中心「数据查询」的表导航（@/components/DataTableSidebar.vue），
// 右侧是当前表选中的规则；原「表名称 + 状态」查询区与分页器整体去掉，找表改用侧栏自带的搜表名/ID。
// 侧栏在本页只按业务目录分组（biz-only，「数据库」页签不出）；数据中心那一页两种分组都保留。
//
// 为什么规则一次性拉全、不在选表时按条件查后端：
// · /poc/match-table-config/page 的条件只有 name（LIKE table_name）、selectionType、ids，**没有 tableId**
//   （见 chat-bi-backend MatchTableConfigController#page），按 name 查会把名字相近的表一起捞出来；
// · 更要紧的是**弹窗新增的行没有 tableId**（旧页面从来不给这个列赋值），只能靠 tableName 认亲。
// 所以这里拉全量后在前端按 tableId + 表名两种口径匹配；配置表量级是个位数到几十条，全量安全。
// ⚠️ 「状态」筛选在新版里不再是查询条件（后端本就没实现，见 api/endpoints.ts 同域注释），
//    改成右侧每行一个滑动开关直接改。真实行的 status 回的是**数字**，一律走 String(row.status)。
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, DArrowRight, Edit, Plus, Warning } from '@element-plus/icons-vue'
import DataTableSidebar from '@/components/DataTableSidebar.vue'
import { dataApi, type EntryType } from '@/api'
import { matchTableConfigApi } from '@/api/templateConfig'
import type { MatchTableConfig } from '@/api/types/template'
import { matchTableSelectionTypeLabel } from './options'
import MatchTableConfigEditDialog from './MatchTableConfigEditDialog.vue'

defineOptions({ name: 'MatchTableConfigPage' })

// ---- 左侧表导航 ----
// 与数据中心同一份取数：entryTypesGroup 的三个分组并集就是全库表，源只影响分组。
const tables = ref<EntryType[]>([])
const selectedTableId = ref('')
const navigationLoading = ref(false)
const navigationError = ref('')
const sidebarCollapsed = ref(false)
let navigationRequest = 0

async function loadTables() {
  const requestId = ++navigationRequest
  navigationLoading.value = true
  navigationError.value = ''
  try {
    const group = await dataApi.entryTypesGroup()
    if (requestId !== navigationRequest) return
    const seen = new Set<string>()
    tables.value = [...group.list1, ...group.list2, ...group.list3].filter((table) => {
      if (seen.has(table.tableId)) return false
      seen.add(table.tableId)
      return true
    })
  } catch (err) {
    if (requestId !== navigationRequest) return
    navigationError.value = `加载数据表失败：${err instanceof Error ? err.message : String(err)}`
    tables.value = []
  } finally {
    if (requestId === navigationRequest) navigationLoading.value = false
  }
}

const selectedTable = computed(() => tables.value.find((table) => table.tableId === selectedTableId.value) ?? null)

function selectTable(table: EntryType) {
  selectedTableId.value = table.tableId
  showUnmatched.value = false
}

// ---- 右侧规则明细 ----
/** 一次性拉全量的分页参数；真实库里这个域只有个位数行，翻页兜底见 loadRules 的循环 */
const RULE_PAGE_SIZE = 200
const rules = ref<MatchTableConfig[]>([])
const rulesLoading = ref(false)
const rulesError = ref('')
/** 并发保护：慢请求回来时若已有新查询在跑，丢弃旧结果 */
let rulesSeq = 0

async function loadRules() {
  const seq = ++rulesSeq
  rulesLoading.value = true
  rulesError.value = ''
  try {
    const collected: MatchTableConfig[] = []
    let pageNo = 1
    // total 大于已取到的行数就继续翻页，避免全量假设被后端分页截断
    for (;;) {
      const res = await matchTableConfigApi.page({ pageNo, pageSize: RULE_PAGE_SIZE })
      if (seq !== rulesSeq) return
      collected.push(...(res.list ?? []))
      const total = res.total ?? collected.length
      if (collected.length >= total || !(res.list ?? []).length) break
      pageNo += 1
    }
    rules.value = collected
  } catch (err) {
    if (seq !== rulesSeq) return
    rulesError.value = err instanceof Error ? err.message : String(err)
    rules.value = []
  } finally {
    if (seq === rulesSeq) rulesLoading.value = false
  }
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/** 一张表能被规则认亲的名字：业务名、物理名、以及去掉库名前缀后的物理名尾段 */
function tableNames(table: EntryType): Set<string> {
  const physical = norm(table.tableName)
  return new Set([norm(table.name), physical, norm(physical.split('.').pop())].filter(Boolean))
}

function matchesTable(rule: MatchTableConfig, table: EntryType): boolean {
  if (rule.tableId != null && String(rule.tableId) === table.tableId) return true
  const name = norm(rule.tableName)
  return !!name && tableNames(table).has(name)
}

/** 当前表的规则；未选中表时为空 */
const tableRules = computed(() => {
  const table = selectedTable.value
  return table ? rules.value.filter((rule) => matchesTable(rule, table)) : []
})

/**
 * 认不到任何数据表的规则（表被删了、或名字写得对不上）。
 * 左表右明细之后这些行本来会在界面上消失，所以保留一个入口能看能删。
 */
const unmatchedRules = computed(() => rules.value.filter((rule) => !tables.value.some((table) => matchesTable(rule, table))))
const showUnmatched = ref(false)
const visibleRules = computed(() => (showUnmatched.value ? unmatchedRules.value : tableRules.value))

const panelTitle = computed(() => {
  if (showUnmatched.value) return '未匹配到数据表的规则'
  const table = selectedTable.value
  return table ? table.name || table.tableName || table.tableId : '选表规则'
})

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
    void loadRules()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

// ---- 编辑弹窗 ----
const dialogRef = ref<InstanceType<typeof MatchTableConfigEditDialog> | null>(null)
/** 新增时把当前表带进弹窗：表名称可改，tableId 一并落库，之后这张表就能按 ID 认亲 */
function openAdd() {
  const table = selectedTable.value
  dialogRef.value?.open(null, table ? { tableName: table.name || table.tableName, tableId: Number(table.tableId) } : undefined)
}
function openEdit(row: MatchTableConfig) {
  dialogRef.value?.open(row)
}

onMounted(() => {
  void loadTables()
  void loadRules()
})
</script>

<template>
  <div class="mtc-shell">
    <div class="mtc-workspace" :class="{ 'is-collapsed': sidebarCollapsed }">
      <DataTableSidebar
        v-show="!sidebarCollapsed"
        :tables="tables"
        :selected-id="selectedTableId"
        scope="all"
        biz-only
        :loading="navigationLoading"
        :error="navigationError"
        @select="selectTable"
        @collapse="sidebarCollapsed = true"
        @retry="loadTables"
      />

      <section class="mtc-detail" aria-label="选表规则明细">
        <header class="mtc-detail-head">
          <div class="mtc-context">
            <button v-if="sidebarCollapsed" class="mtc-nav-expand" type="button" title="展开数据表导航" aria-label="展开数据表导航" @click="sidebarCollapsed = false"><el-icon><DArrowRight /></el-icon></button>
            <strong :title="panelTitle">{{ panelTitle }}</strong>
            <el-tag v-if="selectedTable && !showUnmatched" class="mtc-engine" size="small" effect="plain">{{ selectedTable.dsKind ?? 'MYSQL' }}</el-tag>
            <span v-if="selectedTable && !showUnmatched" class="mtc-table-id">表 ID：{{ selectedTableId }}</span>
            <el-tag v-else-if="showUnmatched" size="small" type="warning" effect="plain">{{ unmatchedRules.length }} 条</el-tag>
          </div>
          <div class="mtc-head-actions">
            <el-button v-if="unmatchedRules.length" size="small" :type="showUnmatched ? 'primary' : 'default'" :icon="Warning" data-testid="mtc-unmatched" @click="showUnmatched = !showUnmatched">
              {{ showUnmatched ? '返回当前表' : `未匹配规则 ${unmatchedRules.length}` }}
            </el-button>
            <el-button size="small" type="primary" :icon="Plus" data-testid="mtc-add-rule" @click="openAdd">新增规则</el-button>
          </div>
        </header>

        <p v-if="rulesError" class="mtc-alert" role="alert">{{ rulesError }}<el-button size="small" @click="loadRules">重试</el-button></p>

        <div v-if="!selectedTable && !showUnmatched" class="mtc-empty">
          <p>从左侧选一张表，这里会列出它的选表规则。</p>
          <p class="mtc-empty-sub">规则按问句匹配（前瞻正则）或走向量表检索，命中后这张表就是本次问数的候选表。</p>
        </div>

        <el-table v-else :data="visibleRules" v-loading="rulesLoading" border stripe size="small" :row-key="(row: MatchTableConfig) => row.id">
          <el-table-column prop="id" label="id" width="70" align="center" />
          <el-table-column prop="tableName" label="表名称" min-width="150" align="center" show-overflow-tooltip>
            <template #default="{ row }">{{ row.tableName ?? '' }}</template>
          </el-table-column>
          <el-table-column label="选表类型" width="100" align="center">
            <template #default="{ row }">{{ matchTableSelectionTypeLabel(row.selectionType) }}</template>
          </el-table-column>
          <el-table-column prop="rule" label="匹配规则" min-width="280" align="center" show-overflow-tooltip>
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
          <template #empty>
            <span>{{ showUnmatched ? '所有规则都能对应到数据表' : '这张表还没有选表规则，点「新增规则」建一条' }}</span>
          </template>
        </el-table>
      </section>
    </div>

    <MatchTableConfigEditDialog ref="dialogRef" @saved="loadRules" />
  </div>
</template>

<style scoped>
.mtc-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
/* 左右分栏的列宽、折叠与每列一个滚动区的口径照数据中心「数据查询」（DataQueryTab 的 dv-data-workspace），
   两处共用同一个侧栏组件，视觉与响应式断点保持一致。 */
.mtc-workspace {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.mtc-workspace.is-collapsed {
  grid-template-columns: minmax(0, 1fr);
}
.mtc-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.mtc-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.mtc-context {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}
.mtc-context strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mtc-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mtc-nav-expand {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--rc-faint);
  cursor: pointer;
}
.mtc-nav-expand:hover {
  background: #f1f5f9;
  color: var(--rc-text);
}
.mtc-table-id {
  color: var(--rc-faint);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.mtc-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--rc-danger-bg, #fef2f2);
  color: var(--rc-danger, #dc2626);
  font-size: 12px;
}
.mtc-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 40px 16px;
  color: var(--rc-text-2, #475569);
  font-size: 13px;
  text-align: center;
}
.mtc-empty-sub {
  margin: 0;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
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
@media (max-width: 1100px) {
  .mtc-workspace {
    grid-template-columns: 208px minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .mtc-workspace {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }
  .mtc-workspace :deep(.dt-sidebar) {
    max-height: 240px;
  }
  .mtc-detail {
    min-height: 320px;
    overflow-y: visible;
  }
}
</style>
