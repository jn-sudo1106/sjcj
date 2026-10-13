<script setup lang="ts">
// 任务实例 —— 1:1 迁移旧 data-view `src/page/inst/TaskInst.vue`（路由 /inst/task-list，标题「任务实例」）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   搜索栏：状态(state，**改完立刻查**) + 任务规格(taskSpecId) + 源(sourceId) + 源IDs(sourceIds) +
//           任务URL(taskUrl) + 网站ID(siteId) + 分组ID(groupId) + 队列(taskTopic) + 任务ID(taskId) +
//           配置ID(configId) + 父ID(parentId) + 文件ID(fileId) + 「展示类」勾选(all) +
//           创建时间(daterange) + [当天] + [查询]
//   操作条：只有勾选后才出现的 [重发]（旧 `v-if="selectedRowKeys.length > 0"`）
//   表格：TASK_LIST.base 12 列（任务ID / 状态 / 类型 / 类型名 / 任务名 / 源ID / 配置ID / 更新时间 /
//         执行节点 / 主题 / 父ID / 操作）
//         任务ID 前一个状态圆点（C绿 / E红 / AC灰 / 其它蓝）；更新时间走 timeago；
//         配置ID 是蓝色 tag，点击看「配置模板」详情；行内操作 = 详情 | 重发（**没有编辑**）
//   分页：**默认 20**，可选 10/30/100/200（注意：选项里没有 20），显示总条数 + 快速跳页；表格 scroll x=1500
//   弹窗：base-detail-drawer（详情）+ config-detail（配置模板详情）
//   接口：taskInstPaged → GET /v1/task/topTaskPaged（page/limit + 白名单字段）
//         resendTask    → GET /v1/task/resetTaskInsts（ids 逗号连接）
//
// ⚠️ 旧页「查询」与「回车」走的是**两条不同**的刷新路径，这里 1:1 保留（旧 `handleRefresh` 与 `searchTasks`）：
//   handleRefresh() = `table.refresh(false)` → **保持当前页**；searchTasks() = `table.refresh(true)` → **回到第 1 页**
//   · 回第 1 页：查询按钮、源IDs / 任务URL / 网站ID / 分组ID / 队列 的回车、创建时间变化、展示类勾选
//   · 保持当前页：状态下拉 change、任务规格 / 源 / 任务ID / 配置ID / 父ID / 文件ID 的回车
//   这是旧页里两组输入框走了两个方法留下的不一致（保持当前页时，换条件后可能停在一个没有数据的页码）。
//   要统一成「一律回第 1 页」的话说一声。
//
// 有意偏差（都在交付说明里单列）：
//   1. 不迁死代码：`base-edit-modal`（编辑弹窗）—— 行内操作里根本没有「编辑」入口，且旧 updateCallback
//      是个只 console.log 的空桩（保存动作压根不发请求）；`urlSlot2` / `dataShowSlot` / `msgSlot`
//      （TASK_LIST 的列里没有任何列引用这三个 slot）；`advanced`（模板里 `!advanced && 3 || 4` 的分支，
//      但 toggleAdvanced 没有任何按钮接线，恒 false）；`tableOption()`（created 里调一次，效果是关掉
//      表格顶部 alert 条，同时把 options.rowSelection 置 null —— 而模板上另有显式 :rowSelection，
//      所以 checkbox 列照常，等价于「只关 alert 条」）；`sendNext` / `configCron` / `deleteBatch` /
//      `sendBatch` / `handleChange` / `resetSearchForm` / `handleSearch` / `handleReset` /
//      `handleCloseCurrentTab` / `handleOpenTab`（未接线或依赖 $multiTab）。
//   2. 旧页有 taskId / sourceId / configId / parentId / fileId 五个 props，新平台是 Monitor 的一个 tab，
//      没有这套 props（不迁）。但旧页 created 里从 `$route.query` 预置筛选的那批键**已接通**：
//      siteId / taskTopic / sourceIds / taskUrl / groupId / startTime / endTime / taskId / all /
//      parentId / configId / sourceId / fileId / state —— 监控中心的任务统计页「任务明细 / 错误明细」
//      正是靠 `?tab=taskList&sourceId=&configId=&state=` 钻取过来的（旧页 $multiTab.open 的等价物）。
//   3. 表格顶部的 alert 条（旧 options.alert 被 tableOption 关掉）不迁；勾选框列照常保留。
//   4. 「重发」加了二次确认（confirmDanger）：task/resetTaskInsts 在契约里是 danger 端点，平台对它的
//      约定就是「UI 侧保留二次确认」（见 client.ts 该端点的注释，画布任务视图行内「重发」同样有确认）。
//      旧 TaskInst 页是**没有**确认、点一下就发。批量重发与行内重发都加了。
//   5. 时间列走 timeago 相对时间（悬停看绝对时间）；详情抽屉里按旧 BaseDetail 仍是绝对时间。
//   6. 详情抽屉标题从旧版的默认「详情」改成「任务实例 - 详情」（与 Monitor 里 commJob 的抽屉标题口径一致）。
//   7. 「配置模板」详情不迁旧的 vkbeautify.xml 美化，`抓取配置` 等长文本按原样展示（省掉一个只为缩进 XML 的依赖）。
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, type TableInstance } from 'element-plus'
import { Search, Refresh, Warning, Calendar } from '@element-plus/icons-vue'
import { taskInstPaged, resendTask, type TaskRow } from '@/api/taskList'
import { confirmDanger } from '@/utils/confirmDanger'
import { listColumns, STATE_OPTIONS, taskDotTone, timeAgoText } from './columns'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import ConfigTemplateDrawer from './ConfigTemplateDrawer.vue'

defineOptions({ name: 'TaskList' })

/** 监控中心用 `?tab=taskList&…` 切页签，钻取参数也走 query（旧页的 $multiTab.open 等价物） */
const route = useRoute()

// ---- 查询条件（草稿 → 执行 两态：文本项变化不自动查，点「查询」/ 回车才发请求）----
const form = reactive({
  state: '',        // '' 不限（无「全部」文案，第一项就叫 -不限-）
  taskSpecId: '',
  sourceId: '',
  sourceIds: '',
  taskUrl: '',
  siteId: '',
  groupId: '',
  taskTopic: '',
  taskId: '',
  configId: '',
  parentId: '',
  fileId: '',
  all: '' as '' | '1', // 展示类：'' 不勾 / '1' 勾选（后端约定 all=1 表示不过滤展示类任务规格）
  startTime: '',
  endTime: '',
})
const dateRange = ref<[string, string] | null>(null)
/** 已「执行」的筛选条件 */
const filters = reactive({ ...form })

// ---- 列表状态 ----
const rows = ref<TaskRow[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 taskId（旧 s-table 的 rowKey 就是 record.taskId） */
const selected = ref<string[]>([])
const page = ref(1)
const size = ref(20) // 旧 s-table 的 `:pageSize="20"`（分页选项里没有 20，但初始就是 20）

const COLUMNS = listColumns()
/** 长文本列：列上挂 show-overflow-tooltip（悬停看全文） */
const OVERFLOW_COLS = new Set(['taskName', 'nodeCode', 'taskTopic'])

async function load() {
  loading.value = true
  try {
    const res = await taskInstPaged({
      taskId: filters.taskId,
      state: filters.state,
      sourceId: filters.sourceId,
      sourceIds: filters.sourceIds,
      taskUrl: filters.taskUrl,
      siteId: filters.siteId,
      groupId: filters.groupId,
      configId: filters.configId,
      parentId: filters.parentId,
      taskSpecId: filters.taskSpecId,
      fileId: filters.fileId,
      taskTopic: filters.taskTopic,
      startTime: filters.startTime,
      endTime: filters.endTime,
      all: filters.all,
      page: page.value,
      limit: size.value,
    })
    rows.value = res.list
    total.value = res.total
  } catch (err) {
    ElMessage.error('任务列表查询失败: ' + (err instanceof Error ? err.message : String(err)))
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/** 草稿 → 执行。`resetPage` 对应旧页 searchTasks(true) / handleRefresh(false) 两条路径。 */
function runQuery(resetPage = true) {
  Object.assign(filters, form)
  if (resetPage) page.value = 1
  void load()
}

function resetQuery() {
  Object.assign(form, {
    state: '', taskSpecId: '', sourceId: '', sourceIds: '', taskUrl: '', siteId: '', groupId: '',
    taskTopic: '', taskId: '', configId: '', parentId: '', fileId: '', all: '', startTime: '', endTime: '',
  })
  dateRange.value = null
}

// ---- 创建时间（旧 a-range-picker format=YYYY-MM-DD + [当天] 按钮）----
function onDateChange(val: [string, string] | null) {
  form.startTime = val?.[0] ?? ''
  form.endTime = val?.[1] ?? ''
  runQuery()
}
function selectToday() {
  const today = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const iso = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  dateRange.value = [iso, iso]
  onDateChange([iso, iso])
}

// ---- 展示类勾选（旧 a-checkbox @change）----
function onAllChange(checked: boolean | string | number) {
  form.all = checked ? '1' : ''
  runQuery()
}

// ---- 批量/单行重发 ----
const tableRef = ref<TableInstance>()

function onSelectionChange(selection: TaskRow[]) {
  selected.value = selection.map((row) => row.taskId)
}
/** 旧版每次重发后 `selectedRowKeys = []`（受控 rowSelection，表格勾选同步清空）。
 *  el-table 的勾选由内部 store 管，光清数组会出现「按钮已禁用、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  tableRef.value?.clearSelection()
}

/** 旧 resendBatch：把勾选的任务重置为待发送。成功文案「已重置为待发送:N」。 */
async function resendBatch() {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  await confirmDanger('提示', `将重发选中的 ${ids.length} 条任务，确认执行？`, async () => {
    const res = await resendTask(ids)
    clearSelection()
    void load()
    return res?.message ? res : { message: `已重置为待发送:${ids.length}` }
  })
}

/** 行内「重发」（旧 handleResend）：成功文案「已重置为待发送:<taskId>」。 */
async function resendOne(row: TaskRow) {
  await confirmDanger('提示', `将重发任务 ${row.taskId}，确认执行？`, async () => {
    const res = await resendTask([row.taskId])
    clearSelection()
    void load()
    return res?.message ? res : { message: `已重置为待发送:${row.taskId}` }
  })
}

// ---- 分页（旧 s-table：共N条 + 快速跳页）----
function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

// ---- 子组件 ----
const detailVisible = ref(false)
const detailRecord = ref<TaskRow | null>(null)
const configDrawerRef = ref<InstanceType<typeof ConfigTemplateDrawer>>()

function openDetail(row: TaskRow) {
  detailRecord.value = row
  detailVisible.value = true
}
/** 旧 handleShowConfig(text)：点配置ID 的蓝色 tag → 打开「配置模板」详情 */
function openConfig(configId: unknown) {
  configDrawerRef.value?.open(String(configId ?? ''))
}

/** 时间列：旧 timeago 相对时间；悬停看绝对时间 */
function timeText(value?: string) {
  return timeAgoText(value)
}

/** 普通单元格取值：空值渲染成空串（旧模板直接 `{{ record[dataIndex] }}`） */
function cellText(row: TaskRow, key: string): string {
  const v = (row as Record<string, unknown>)[key]
  return v == null ? '' : String(v)
}

onMounted(() => {
  applyRouteQuery()
  void load()
})

/**
 * 路由预置筛选（旧页 created 里那段 `if (this.$route.query.xxx)`）。
 * 用 `replace` 导航（监控中心切页签）后组件重新挂载，所以只在 mount 时读一次即可。
 * 文本项写进 form 并同步到 filters，保证首屏请求就带上条件（而不是先查全量再补查）。
 */
function applyRouteQuery() {
  const q = route.query
  const pick = (key: string) => {
    const v = q[key]
    const s = Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '')
    return s.trim()
  }
  const keys = [
    'siteId', 'taskTopic', 'sourceIds', 'taskUrl', 'groupId', 'startTime', 'endTime',
    'taskId', 'all', 'parentId', 'configId', 'sourceId', 'fileId', 'state',
  ] as const
  keys.forEach((key) => {
    const v = pick(key)
    if (!v) return
    ;(form as Record<string, string>)[key] = v
  })
  // 创建时间范围：两端都带时同步到日期选择器（旧页 taskDateRange = [startTime, endTime]）
  if (form.startTime && form.endTime) dateRange.value = [form.startTime, form.endTime]
  Object.assign(filters, form)
}
</script>

<template>
  <div class="tl-shell" v-loading="loading">
    <div class="tl-head">
      <div class="tl-title">任务实例</div>
      <div class="tl-sub">采集任务的运行记录（事实源），支持按状态 / 源 / 时间等条件检索与重发。</div>
    </div>

    <!-- 筛选表单（对齐旧 a-form layout="inline" + a-row 栅格：多数 md=3；「展示类」md=2、时间 md=7，
         一行为 8×3=24 栅格，「日期区间 + 当天按钮」不换行）。
         文本项不自动查（回车 / 点查询），**状态下拉改完立刻查**（旧 @change="handleRefresh"）。 -->
    <el-form :inline="true" class="tl-filter-form" size="small">
      <el-row :gutter="8" class="tl-filter-row">
        <el-col :md="3" :sm="24">
          <el-form-item>
            <!-- 旧页这个 select 没有 label，第一项就是「-不限-」 -->
            <el-select v-model="form.state" placeholder="-不限-" @change="() => runQuery(false)">
              <el-option v-for="opt in STATE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="任务规格">
            <!-- 旧这 6 项回车走 handleRefresh（保持当前页） -->
            <el-input v-model="form.taskSpecId" placeholder="类型" clearable @keyup.enter="() => runQuery(false)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="源">
            <el-input v-model="form.sourceId" placeholder="源" clearable @keyup.enter="() => runQuery(false)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="源IDs">
            <!-- 旧这 5 项回车走 searchTasks（回第 1 页） -->
            <el-input v-model="form.sourceIds" placeholder="逗号分隔" clearable @keyup.enter="() => runQuery()" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="任务URL">
            <el-input v-model="form.taskUrl" placeholder="URL片断" clearable @keyup.enter="() => runQuery()" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="网站ID">
            <el-input v-model="form.siteId" placeholder="网站ID" clearable @keyup.enter="() => runQuery()" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="分组ID">
            <el-input v-model="form.groupId" placeholder="分组ID" clearable @keyup.enter="() => runQuery()" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="队列">
            <el-input v-model="form.taskTopic" placeholder="队列名片段" clearable @keyup.enter="() => runQuery()" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="任务ID">
            <el-input v-model="form.taskId" placeholder="任务ID" clearable @keyup.enter="() => runQuery(false)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="配置ID">
            <el-input v-model="form.configId" placeholder="配置ID" clearable @keyup.enter="() => runQuery(false)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="父ID">
            <el-input v-model="form.parentId" placeholder="父ID" clearable @keyup.enter="() => runQuery(false)" />
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item label="文件ID">
            <el-input v-model="form.fileId" placeholder="文件ID" clearable @keyup.enter="() => runQuery(false)" />
          </el-form-item>
        </el-col>
        <!-- 「展示类」只有 3 个字的勾选，给 2 栅格即可；省下的 1 栅格让给「创建时间」（6→7），
             这样「日期区间 + 当天按钮」才放得下同一行（原来 md=6 时「当天」会被挤到下一行）。 -->
        <el-col :md="2" :sm="24">
          <el-form-item>
            <!-- 旧 a-checkbox：勾选 → all='1'（不过滤展示类任务规格），同时回第 1 页 -->
            <el-checkbox :model-value="form.all === '1'" @update:model-value="onAllChange">展示类</el-checkbox>
          </el-form-item>
        </el-col>
        <el-col :md="7" :sm="24">
          <el-form-item label="创建时间" class="tl-date-item">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              unlink-panels
              class="tl-date"
              @change="(v: [string, string] | null) => onDateChange(v)"
            />
            <el-button size="small" class="tl-today" :icon="Calendar" @click="selectToday">当天</el-button>
          </el-form-item>
        </el-col>
        <el-col :md="3" :sm="24">
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="() => runQuery()">查询</el-button>
            <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <!-- 操作条：旧版勾选后才出现 [重发]；这里常显、未勾选时置灰（与 Monitor 里 queueCheck / commJob 一致） -->
    <div class="tl-op-bar">
      <el-button type="primary" :icon="Warning" :disabled="!selected.length" @click="resendBatch">重发</el-button>
      <span v-if="selected.length" class="tl-op-hint">已选 {{ selected.length }} 条</span>
    </div>

    <!-- 表格：列定义来自 allColumns.TASK_LIST.base（标题/顺序 1:1）。
         列宽自适应：文本列走 min-width，短列走固定 width；操作列 fixed="right"（旧列配置同款）。 -->
    <el-table
      ref="tableRef"
      :data="rows"
      border
      size="small"
      :row-key="(r: TaskRow) => r.taskId"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="40" />
      <el-table-column
        v-for="col in COLUMNS"
        :key="col.dataIndex"
        :label="col.title"
        :prop="col.dataIndex"
        :width="col.minWidth ? undefined : col.width"
        :min-width="col.minWidth"
        :align="col.align ?? 'left'"
        :fixed="col.fixed"
        :show-overflow-tooltip="OVERFLOW_COLS.has(col.dataIndex)"
      >
        <template #default="{ row }">
          <!-- 任务ID：旧 idSlot —— 状态圆点 + ID -->
          <span v-if="col.dataIndex === 'taskId'" class="tl-id">
            <span class="tl-dot" :class="`tl-dot-${taskDotTone(row.state)}`" />
            {{ row.taskId }}
          </span>

          <!-- 配置ID：旧 configShowSlot —— 蓝色 tag，点击看配置模板详情 -->
          <span v-else-if="col.dataIndex === 'configId'" class="tl-config" @click="openConfig(row.configId)">
            <el-tag size="small">{{ row.configId }}</el-tag>
          </span>

          <!-- 更新时间：旧 lastDateSlot → timeago 相对时间；悬停看绝对时间 -->
          <el-tooltip
            v-else-if="col.dataIndex === 'updateDt'"
            :content="String(row.updateDt ?? '—')"
            placement="top-start"
          >
            <span class="tl-time">{{ timeText(row.updateDt) }}</span>
          </el-tooltip>

          <!-- 操作：旧 actionSlot —— 详情 | 重发（没有编辑） -->
          <span v-else-if="col.dataIndex === 'action'" class="tl-actions">
            <span class="tl-op-link" @click="openDetail(row)">详情</span>
            <span class="tl-op-divider">|</span>
            <span class="tl-op-link" @click="resendOne(row)">重发</span>
          </span>

          <!-- 其余列：直接显示字段值；长文本走列上的 show-overflow-tooltip -->
          <span v-else>{{ cellText(row, col.dataIndex) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：默认 20，可选 10/30/100/200，共N条 + 快速跳页（旧 s-table pagination 口径） -->
    <div class="tl-pager">
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

    <TaskDetailDrawer v-model="detailVisible" :record="detailRecord" />
    <ConfigTemplateDrawer ref="configDrawerRef" />
  </div>
</template>

<style scoped>
.tl-shell {
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
.tl-head {
  margin-bottom: 2px;
}
.tl-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.tl-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
/* 筛选表单：对齐旧 a-form layout="inline" 的栅格宽度比例 */
.tl-filter-form {
  margin-bottom: 0;
}
.tl-filter-row {
  width: 100%;
}
.tl-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.tl-filter-form :deep(.el-select),
.tl-filter-form :deep(.el-input) {
  width: 100%;
}
.tl-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
/* 创建时间：日期区间 + 「当天」按钮必须同行。el-form-item__content 默认 flex-wrap: wrap，
   宽度不够时按钮会被挤到下一行；这里强制不换行，并让日期区间收缩让位（.tl-date 的 min-width:0 保证它能收）。*/
.tl-date-item :deep(.el-form-item__content) {
  flex-wrap: nowrap;
}
.tl-date {
  flex: 1 1 auto;
  min-width: 0;
}
.tl-today {
  flex: none;
  margin-left: 4px;
}
.tl-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tl-op-hint {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
/* 任务ID：状态圆点 + ID */
.tl-id {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.tl-dot-success {
  background: #16a34a;
}
.tl-dot-error {
  background: #dc2626;
}
.tl-dot-default {
  background: #94a3b8;
}
.tl-dot-processing {
  background: #2563eb;
}
.tl-config {
  cursor: pointer;
}
.tl-time {
  white-space: nowrap;
}
.tl-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tl-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.tl-op-link:hover {
  text-decoration: underline;
}
.tl-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.tl-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
