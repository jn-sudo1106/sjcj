<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Search, Plus } from '@element-plus/icons-vue'
import { type SourceCheck } from '@/api'
import {
  pagedSourceCheck,
  changeSourceCheckEnable,
  handleRunNow,
  deleteSourceCheck,
} from '@/api/monitor'
import SourceSelect from './SourceSelect.vue'
import StatusTag from '@/components/StatusTag.vue'
import { confirmDanger } from '@/utils/confirmDanger'
import CheckEditDialog from './CheckEditDialog.vue'
import CheckLogsDrawer from './CheckLogsDrawer.vue'

defineOptions({ name: 'SourceCheck' })

/** 嵌入形态：从源列表弹框打开时，固定 sourceId、隐藏源筛选 */
const props = withDefaults(defineProps<{ embedded?: boolean; sourceId?: string }>(), { embedded: false, sourceId: '' })

// ---- 查询条件（草稿 → 执行 两态：筛选项变化不自动查，点「查询」才发请求；与 TaskView 对齐）----
const form = reactive({
  enable: '',   // '' 全部 / '0' 在用 / '1' 停用
  state: '',    // '' 全部 / 'E' 告警 / 'C' 正常
  sourceId: props.sourceId || '',
  name: '',
})
/** 已「执行」的筛选条件（点查询 / 切下拉 / 换源后同步自 form）。分页单独管，不放进来——
 *  旧版 pagedSourceCheck 只发 sourceId/enable/state/name + page/limit，多带一个 size 就是多余参数。 */
const filters = reactive<{
  enable: string
  state: string
  sourceId: string
  name: string
}>({
  enable: '',
  state: '',
  sourceId: props.sourceId || '',
  name: '',
})
watch(
  () => props.sourceId,
  (v) => {
    form.sourceId = v || ''
    filters.sourceId = v || ''
  },
)

// ---- 列表状态 ----
const rows = ref<SourceCheck[]>([])
const total = ref(0)
const loading = ref(false)
const selected = ref<string[]>([])
const page = ref(1)
const size = ref(10)

async function load() {
  loading.value = true
  try {
    // 入参逐字段对齐旧 api/monitor.js 的 pagedSourceCheck（page/limit，不是 pageNo/pageSize/size）
    const res = await pagedSourceCheck({
      sourceId: filters.sourceId,
      enable: filters.enable,
      state: filters.state,
      name: filters.name,
      page: page.value,
      limit: size.value,
    })
    rows.value = res.list
    total.value = res.total
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载监控列表失败')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}
function runQuery() {
  filters.enable = form.enable
  filters.state = form.state
  filters.sourceId = form.sourceId
  filters.name = form.name.trim()
  page.value = 1
  void load()
}

// ---- 行内开关（el-switch size=small，文案「启用/停用」）----
/** 从后端 isDelete 推出"当前是否启用"：0=在用→true */
function isEnabled(row: SourceCheck): boolean {
  return row.isDelete === 0
}
/** 切换开关：想启用(newEnabled=true)→传 0，想停用→传 1（与后端 changeEnable 口径一致） */
async function toggleEnable(row: SourceCheck, newEnabled: boolean) {
  const prevIsDelete = row.isDelete // 0 或 1
  row.isDelete = newEnabled ? 0 : 1 // 先乐观更新
  try {
    await changeSourceCheckEnable([row.id], newEnabled)
    ElMessage.success(newEnabled ? '已启用' : '已停用')
  } catch {
    row.isDelete = prevIsDelete // 失败回滚
  }
}

// ---- 批量操作 ----
function onSelectionChange(keys: string[]) {
  selected.value = keys
}
async function batchEnable(enable: boolean) {
  if (!selected.value.length) return
  await confirmDanger(
    enable ? '批量启用' : '批量停用',
    `将${enable ? '启用' : '停用'}选中的 ${selected.value.length} 条监控，确认执行？`,
    () => changeSourceCheckEnable(selected.value, enable) as Promise<{ message?: string }>,
  )
  void load()
}
async function batchRunNow() {
  if (!selected.value.length) return
  await confirmDanger(
    '批量重跑',
    `立即触发选中的 ${selected.value.length} 条监控的校验？`,
    () => handleRunNow(selected.value) as Promise<{ message?: string }>,
  )
  void load()
}
async function batchDelete() {
  if (!selected.value.length) return
  await confirmDanger(
    '批量删除',
    `将永久删除选中的 ${selected.value.length} 条监控配置，不可恢复。确认执行？`,
    () => deleteSourceCheck(selected.value) as Promise<{ message?: string }>,
  )
  selected.value = []
  void load()
}

// ---- 行操作 ----
async function rowRunNow(row: SourceCheck) {
  await confirmDanger(
    '立即运行',
    `立即触发这条监控的校验？`,
    () => handleRunNow([row.id]) as Promise<{ message?: string }>,
  )
  void load()
}
async function rowDelete(row: SourceCheck) {
  await confirmDanger(
    '删除',
    `将永久删除这条监控配置，不可恢复。确认执行？`,
    () => deleteSourceCheck([row.id]) as Promise<{ message?: string }>,
  )
  void load()
}

// ---- 详情抽屉 ----
const detailVisible = ref(false)
const detailRecord = ref<SourceCheck | null>(null)
function openDetail(row: SourceCheck) {
  detailRecord.value = row
  detailVisible.value = true
}

// ---- 辅助：剥 lastMsg 时间戳前缀 ----
// 旧形态: "2026-09-09 11:00:46---[X]:xxx-异常, 数量:0" → 展示 "---" 之后的文本
const MSG_TS_PREFIX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}---/
function stripTimestamp(msg: string | undefined): string {
  if (!msg) return ''
  return msg.replace(MSG_TS_PREFIX, '')
}

// ---- 分页 ----
function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

onMounted(() => void load())

// ---- 子组件 ref ----
// 当前生效的源：筛选草稿优先（旧版 queryParam.sourceId 是下拉的即时值），再退回已执行的筛选 / 内嵌传入的源
const activeSourceId = computed(() => form.sourceId || filters.sourceId || props.sourceId || '')

const editDialogRef = ref<InstanceType<typeof CheckEditDialog>>()
const logsDrawerRef = ref<InstanceType<typeof CheckLogsDrawer>>()
function openAddDialog() {
  // 旧 MonitorList.handleAdd：未选源时 $message.error('请先选择源') 并 return
  if (!activeSourceId.value) {
    ElMessage.error('请先选择源')
    return
  }
  editDialogRef.value?.openDialog(null)
}
function openEditDialog(row: SourceCheck) {
  editDialogRef.value?.openDialog(row)
}
function openLogs(row: SourceCheck) {
  // 旧 MonitorList.handleLogs：showModal(queryParam.sourceId, record.jobId)
  // —— 传的是**任务的 jobId**（不是检查记录自身的 id），后端未给 jobId 时退化为只按 sourceId 过滤。
  logsDrawerRef.value?.show(activeSourceId.value || row.sourceId, row.jobId, row.name)
}
function onEditSaved() {
  void load()
}

// ---- 源选择变更后自动查询 ----
function onSourceChange() {
  runQuery()
}
</script>

<template>
  <div class="sc-shell" :class="{ 'sc-embedded': embedded }" v-loading="loading">
    <!-- 嵌入形态：外层由父组件弹窗包裹，这里直接渲染内容；独立形态：自己做卡片壳 -->
    <div class="sc-head" v-if="!embedded">
      <div class="sc-title">数据源告警</div>
      <div class="sc-sub">查看和管理各源的数据校验监控，可按源、状态、在用筛选。</div>
    </div>

    <!-- 筛选表单（对齐旧项目 a-form layout="inline" + a-row 栅格） -->
    <el-form :inline="true" class="sc-filter-form" size="small">
      <el-row :gutter="8" class="sc-filter-row">
        <el-col :md="4" :sm="24" v-if="!embedded">
          <el-form-item label="在用">
            <el-select v-model="form.enable" placeholder="全部" @change="runQuery">
              <el-option label="全部" value="" />
              <el-option label="在用" value="0" />
              <el-option label="停用" value="1" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24" v-if="!embedded">
          <el-form-item label="告警状态">
            <el-select v-model="form.state" placeholder="全部" @change="runQuery">
              <el-option label="全部" value="" />
              <el-option label="告警" value="E" />
              <el-option label="正常" value="C" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24" v-if="!embedded">
          <el-form-item label="源ID">
            <SourceSelect v-model="form.sourceId" @change="onSourceChange" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="名称">
            <el-input v-model="form.name" placeholder="名称" @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
            <!-- 旧版不置灰，未选源时点「加监控」弹「请先选择源」（openAddDialog 内拦截） -->
            <el-button type="primary" :icon="Plus" @click="openAddDialog">加监控</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <!-- 批量操作条（勾选态） -->
    <div v-if="selected.length" class="sc-batch-bar">
      <span>已选 <b>{{ selected.length }}</b> 条</span>
      <button class="rc-btn" type="button" @click="batchRunNow">批量重跑</button>
      <button class="rc-btn" type="button" @click="batchEnable(false)">批量停用</button>
      <button class="rc-btn" type="button" @click="batchEnable(true)">批量启用</button>
      <button class="rc-btn danger" type="button" @click="batchDelete">批量删除</button>
      <button class="rc-btn ghost" type="button" @click="selected = []">清除勾选</button>
    </div>

    <!-- 表格 -->
    <!-- 不设 default-sort：旧版列上的 sorter:true 是**服务端**排序（由后端决定整集顺序），
         而 s-table 转发的 sortField/sortOrder 又被旧 pagedSourceCheck 丢掉了，等于后端顺序直显。
         el-table 的 sortable/default-sort 只排当前页，会让人误以为整集已排序，反而不如照旧直显。 -->
    <el-table
      :data="rows"
      border
      stripe
      size="small"
      :row-key="(r: SourceCheck) => r.id"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="40" />
      <!-- 在用：开关 + 状态文字 -->
      <el-table-column label="在用" width="100" align="center">
        <template #default="{ row }">
          <el-switch
            size="small"
            :model-value="isEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
            @change="(v: string | number | boolean) => toggleEnable(row, !!v)"
          />
        </template>
      </el-table-column>
      <!-- 状态 -->
      <el-table-column label="状态" width="90" align="center" prop="state">
        <template #default="{ row }">
          <StatusTag
            :text="row.state === 'E' ? '告警' : row.state === 'C' ? '正常' : row.state"
            :tone="row.state === 'E' ? 'err' : row.state === 'C' ? 'ok' : 'muted'"
          />
        </template>
      </el-table-column>
      <!-- 执行结果：剥时间戳前缀，超长省略 -->
      <el-table-column label="执行结果" min-width="200" prop="lastMsg" show-overflow-tooltip>
        <template #default="{ row }">
          <span :title="row.lastMsg">{{ stripTimestamp(row.lastMsg) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="名称" width="150" prop="name" show-overflow-tooltip />
      <el-table-column label="表" min-width="180" prop="tableName" show-overflow-tooltip />
      <el-table-column label="cron" width="130" prop="schedule" class-name="mono-cell" />
      <el-table-column label="下次" width="160" prop="nextRun" />
      <el-table-column label="上次" width="160" prop="lastRun" />
      <el-table-column label="源" width="110" prop="sourceId" class-name="mono-cell" />
      <!-- 操作：日志 / 编辑（行内）+ 更多（详情 / 立即运行 / 删除） -->
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span class="sc-op-link" @click="openLogs(row)">日志</span>
            <span class="sc-op-divider">|</span>
            <span class="sc-op-link" @click="openEditDialog(row)">编辑</span>
            <span class="sc-op-divider">|</span>
            <el-dropdown trigger="click">
              <span class="sc-more-link">更多 ▾</span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openDetail(row)">详情</el-dropdown-item>
                  <el-dropdown-item @click="rowRunNow(row)">立即运行</el-dropdown-item>
                  <el-dropdown-item divided @click="rowDelete(row)">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div class="sc-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 30, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="detailVisible"
      title="监控详情"
      direction="rtl"
      size="70%"
      class-name="rc-drawer"
      v-if="detailRecord"
    >
      <el-descriptions border size="default" :column="1">
        <el-descriptions-item label="ID"><span class="mono">{{ detailRecord.id }}</span></el-descriptions-item>
        <el-descriptions-item label="源"><span class="mono">{{ detailRecord.sourceId }}</span></el-descriptions-item>
        <el-descriptions-item label="在用">
          <StatusTag :state="isEnabled(detailRecord) ? 'enabled' : 'disabled'" />
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          <StatusTag
            :text="detailRecord.state === 'E' ? '告警' : detailRecord.state === 'C' ? '正常' : detailRecord.state"
            :tone="detailRecord.state === 'E' ? 'err' : detailRecord.state === 'C' ? 'ok' : 'muted'"
          />
        </el-descriptions-item>
        <el-descriptions-item label="名称">{{ detailRecord.name }}</el-descriptions-item>
        <el-descriptions-item label="表">{{ detailRecord.tableName }}</el-descriptions-item>
        <el-descriptions-item label="cron"><span class="mono">{{ detailRecord.schedule }}</span></el-descriptions-item>
        <el-descriptions-item label="下次">{{ detailRecord.nextRun }}</el-descriptions-item>
        <el-descriptions-item label="上次">{{ detailRecord.lastRun }}</el-descriptions-item>
        <el-descriptions-item label="执行结果">
          <pre class="sc-pre">{{ detailRecord.lastMsg || '—' }}</pre>
        </el-descriptions-item>
        <el-descriptions-item label="校验详情">
          <pre class="sc-pre">{{ detailRecord.checkConf || '—' }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>

    <!-- 子组件挂载：新增/编辑弹窗 + 校验日志抽屉 -->
    <CheckEditDialog ref="editDialogRef" :source-id="activeSourceId" @saved="onEditSaved" />
    <CheckLogsDrawer ref="logsDrawerRef" :source-id="activeSourceId" />
  </div>
</template>

<style scoped>
/* 项目共享令牌缺失时回退值（与 TaskView 同口径） */
.sc-shell {
  display: flex;
  flex-direction: column;
  height: fit-content;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
  overflow: hidden;
}
.sc-shell.sc-embedded {
  border: 0;
  border-radius: 0;
  padding: 4px;
}
.sc-head {
  margin-bottom: 2px;
}
.sc-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.sc-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
/* 筛选表单：对齐旧项目 a-form layout="inline" 的栅格宽度比例 */
.sc-filter-form {
  margin-bottom: 4px;
}
.sc-filter-row {
  width: 100%;
}
/* el-col gutter 让列间距统一为 8px，但内部 form-item 默认 margin-right 会叠加，清零 */
.sc-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
/* 所有输入/下拉控件统一宽度，消除默认尺寸差异 */
.sc-filter-form :deep(.el-select),
.sc-filter-form :deep(.el-input),
.sc-filter-form :deep(.el-input-number) {
  width: 248px;
}
/* 源选择器 SourceSelect（.ss-wrap，非 el-input/el-select 直系）单独给宽 */
.sc-filter-form :deep(.ss-wrap) {
  width: 248px;
}
.sc-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
/* 按钮组单独一行左对齐，不撑满 col */
.sc-filter-form .el-col:last-child :deep(.el-form-item) {
  width: auto;
}
.sc-batch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--rc-primary-bg, #eff6ff);
  border: 1px solid var(--rc-border-soft, #e2e8f0);
  border-radius: 6px;
  font-size: 12px;
  color: var(--rc-primary-ink, #1d4ed8);
}
.sc-batch-bar b {
  font-size: 14px;
}
.sc-more-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.sc-more-link:hover {
  text-decoration: underline;
}
.sc-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.sc-op-link:hover {
  text-decoration: underline;
}
.sc-op-divider {
  margin: 0 4px;
  color: var(--rc-faint, #94a3b8);
}
.sc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
.mono-cell {
  font-family: var(--rc-mono, monospace);
  font-size: 11px;
}
.mono {
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
}
.sc-pre {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 6px 8px;
  background: var(--rc-border-soft, #f1f5f9);
  border-radius: 4px;
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
  line-height: 1.55;
}
/* 与 TaskView 同款 rc-btn / tv-icon-btn：rc-btn 由全局 tokens.css 注入，这里不重写 */
</style>
