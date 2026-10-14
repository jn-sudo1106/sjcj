<script setup lang="ts">
// 任务实例弹窗 —— 迁移旧 data-view `src/page/inst/MeasureData.vue` 里挂的
// `<task-list-show ref="taskList">`（= `src/page/base/detail/TaskListShow.vue` 套 `src/page/inst/TaskInst.vue`）。
//
// 旧链路：
//   MeasureData.handleShowTask(record)    → taskList.showModal({ sourceId, parentId: null, taskId: DETAIL_ID + 0 })
//   MeasureData.handleShowSubTask(tab)    → taskList.showModal({ sourceId, configId: null, taskId: '', parentId: ENTRY_ID })
//   → TaskListShow：`Object.assign(this, param)` 后把 modal width 设成 `document.body.clientWidth - 100` 再打开
//   → 内部 TaskInst：完整的一页任务实例（12 项筛选 + 表格 + 勾选重发 + 详情 / 配置模板）
//
// 迁移方式：**复用 Monitor/taskList**。旧 TaskInst.vue 与 Monitor 的任务实例页是同一个源文件，
// Monitor 那份已经 1:1 迁完（列配置 / 状态圆点 / timeago / 详情抽屉 / 配置模板抽屉都在那儿），
// 连接口层也是同一个契约（`@/api/taskList` 的 taskInstPaged → GET /v1/task/topTaskPaged，
// resendTask → GET /v1/task/resetTaskInsts）。Monitor 文件夹里的组件按迁移约束可以直接引用。
// 这里只补「弹窗壳 + 由 param 预置筛选」这一层——旧 TaskListShow 干的事。
//
// 有意偏差（都在交付说明里单列）：
//   1. 旧 TaskInst 的**编辑弹窗是死代码**（行内操作只有 详情 | 重发，没有任何入口触发
//      `$refs.modal.doEdit`；且 updateCallback 只 console.log、不发请求）。Monitor 那份也没迁，这里同样不迁。
//   2. 旧「重发」没有二次确认，点一下直接发。`task/resetTaskInsts` 在新平台契约里是 danger 端点，
//      平台约定「danger 写操作 UI 侧保留二次确认」；Monitor 的任务实例页已加了确认，这里沿用同一口径
//      （`confirmDanger`），避免同一个写操作在两个入口下行为不一致。
//   3. 旧页「查询」与「回车」是两条刷新路径（`refresh(false)` 保持当前页 / `refresh(true)` 回第 1 页）。
//      本弹窗是临时检索场景，统一成「一律回第 1 页」，行为更可预期（旧版保持当前页时，换条件后
//      可能停在一个没有数据的页码上）。
//   4. 弹窗宽度用 `calc(100vw - 100px)` 等价复刻旧版 `document.body.clientWidth - 100`。
//   5. 旧 `created` 里还读了 `$route.query` 的一堆键（siteId/taskTopic/sourceIds/taskUrl/groupId/
//      startTime/endTime/all…）。那是「TaskInst 当整页用」时的钻取入口，本弹窗的入参只有上面那 5 个
//      （弹窗场景下路由参数会串味），所以不读路由，只认 `open(param)`。
import { reactive, ref } from 'vue'
import { ElMessage, type TableInstance } from 'element-plus'
import { Search, Refresh, Warning, Calendar } from '@element-plus/icons-vue'
import { resendTask, taskInstPaged, type TaskRow } from '@/api/taskList'
import { confirmDanger } from '@/utils/confirmDanger'
import { STATE_OPTIONS, TASK_LIST_BASE, taskDotTone, timeAgoText } from '@/views/Monitor/taskList/columns'
import TaskDetailDrawer from '@/views/Monitor/taskList/TaskDetailDrawer.vue'
import ConfigTemplateDrawer from '@/views/Monitor/taskList/ConfigTemplateDrawer.vue'

defineOptions({ name: 'TaskInstDialog' })

/** 旧 TaskListShow.showModal(param) 的入参 */
interface TaskInstOpenParam {
  taskId?: string | number | null
  sourceId?: string | number | null
  configId?: string | number | null
  parentId?: string | number | null
  fileId?: string | number | null
}

/** 弹窗自己持有 visible（旧 TaskListShow 就是自持 `visible` + 暴露 `showModal(param)`），
 *  所以这里不写 v-model，改用 `open(param)`——与 shared 里另外几个弹层同一形态。 */
const visible = ref(false)

/** 旧 TaskInst 的 12 项筛选（状态/任务规格/源/源IDs/任务URL/网站ID/分组ID/队列/任务ID/配置ID/父ID/文件ID
 *  + 展示类 + 创建时间）。除 `title` 之类旧层根本不下发的历史遗留键外，全部按旧页保留。 */
const form = reactive({
  state: '',
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
  all: '' as '' | '1',
  startTime: '',
  endTime: '',
})
const dateRange = ref<[string, string] | null>(null)
/** 已「执行」的条件（点查询/回车后才生效） */
const filters = reactive({ ...form })

const rows = ref<TaskRow[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 taskId（旧 s-table 的 rowKey 就是 record.taskId） */
const selected = ref<string[]>([])
const page = ref(1)
const size = ref(20)

const tableRef = ref<TableInstance>()
const configDrawerRef = ref<InstanceType<typeof ConfigTemplateDrawer>>()
const detailVisible = ref(false)
const detailRecord = ref<TaskRow | null>(null)

const COLUMNS = TASK_LIST_BASE
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
      // 契约里分页键是 page/limit（不是 pageNo/pageSize，也不是 size）
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

/** 旧页两条刷新路径这里统一成「回第 1 页」（见文件头偏差第 3 条） */
function runQuery() {
  Object.assign(filters, form)
  page.value = 1
  void load()
}

function resetQuery() {
  Object.assign(form, {
    state: '', taskSpecId: '', sourceId: '', sourceIds: '', taskUrl: '', siteId: '', groupId: '',
    taskTopic: '', taskId: '', configId: '', parentId: '', fileId: '', all: '', startTime: '', endTime: '',
  })
  dateRange.value = null
}

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
function onAllChange(checked: boolean | string | number) {
  form.all = checked ? '1' : ''
  runQuery()
}

function onSelectionChange(selection: TaskRow[]) {
  selected.value = selection.map((row) => row.taskId)
}
/** 旧版每次重发后 `selectedRowKeys = []`；el-table 的勾选由内部 store 管，光清数组会出现
 *  「按钮已置灰、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  tableRef.value?.clearSelection()
}

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

async function resendOne(row: TaskRow) {
  await confirmDanger('提示', `将重发任务 ${row.taskId}，确认执行？`, async () => {
    const res = await resendTask([row.taskId])
    clearSelection()
    void load()
    return res?.message ? res : { message: `已重置为待发送:${row.taskId}` }
  })
}

function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

function openDetail(row: TaskRow) {
  detailRecord.value = row
  detailVisible.value = true
}
/** 旧 handleShowConfig(text)：点配置ID 的蓝色 tag → 打开「配置模板」详情 */
function openConfig(configId: unknown) {
  configDrawerRef.value?.open(String(configId ?? ''))
}
function timeText(value?: string) {
  return timeAgoText(value)
}
function cellText(row: TaskRow, key: string): string {
  const v = row[key]
  return v == null ? '' : String(v)
}

/** 旧 TaskListShow.showModal(param)：`Object.assign(this, param)` 后打开；这里把 param 写进筛选条件 */
function open(param: TaskInstOpenParam = {}) {
  resetQuery()
  const str = (v: string | number | null | undefined) => (v == null ? '' : String(v))
  form.taskId = str(param.taskId)
  form.sourceId = str(param.sourceId)
  form.configId = str(param.configId)
  form.parentId = str(param.parentId)
  form.fileId = str(param.fileId)
  Object.assign(filters, form)
  page.value = 1
  clearSelection()
  visible.value = true
  void load()
}

function close() {
  visible.value = false
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="任务实例"
    top="20px"
    destroy-on-close
    class-name="rc-dialog tid-dialog"
    width="calc(100vw - 100px)"
  >
    <div v-loading="loading" class="tid-body">
      <el-form :inline="true" class="tid-filter-form">
        <el-row :gutter="8">
          <el-col :md="3" :sm="24">
            <el-form-item>
              <!-- 旧页这个 select 没有 label，第一项就是「-不限-」 -->
              <el-select v-model="form.state" placeholder="-不限-" @change="runQuery">
                <el-option v-for="opt in STATE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="任务规格">
              <el-input v-model="form.taskSpecId" placeholder="类型" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="源">
              <el-input v-model="form.sourceId" placeholder="源" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="源IDs">
              <el-input v-model="form.sourceIds" placeholder="逗号分隔" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="任务URL">
              <el-input v-model="form.taskUrl" placeholder="URL片断" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="网站ID">
              <el-input v-model="form.siteId" placeholder="网站ID" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="分组ID">
              <el-input v-model="form.groupId" placeholder="分组ID" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="队列">
              <el-input v-model="form.taskTopic" placeholder="队列名片段" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="任务ID">
              <el-input v-model="form.taskId" placeholder="任务ID" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="配置ID">
              <el-input v-model="form.configId" placeholder="配置ID" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="父ID">
              <el-input v-model="form.parentId" placeholder="父ID" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item label="文件ID">
              <el-input v-model="form.fileId" placeholder="文件ID" clearable @keyup.enter="runQuery" />
            </el-form-item>
          </el-col>
          <!-- 「展示类」只有 3 个字，给 2 栅格；省下的 1 栅格让给「创建时间」（6→7），
               这样「日期区间 + 当天按钮」才放得下同一行。 -->
          <el-col :md="2" :sm="24">
            <el-form-item>
              <!-- 旧 a-checkbox：勾选 → all='1'（不过滤展示类任务规格），同时回第 1 页 -->
              <el-checkbox :model-value="form.all === '1'" @update:model-value="onAllChange">展示类</el-checkbox>
            </el-form-item>
          </el-col>
          <el-col :md="7" :sm="24">
            <el-form-item label="创建时间" class="tid-date-item">
              <el-date-picker
                v-model="dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                unlink-panels
                class="tid-date"
                @change="(v: [string, string] | null) => onDateChange(v)"
              />
              <el-button size="small" class="tid-today" :icon="Calendar" @click="selectToday">当天</el-button>
            </el-form-item>
          </el-col>
          <el-col :md="3" :sm="24">
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
              <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <!-- 操作条：旧版勾选后才出现 [重发]；这里常显、未勾选时置灰（与 Monitor 的任务实例页一致） -->
      <div class="tid-op-bar">
        <el-button type="primary" :icon="Warning" :disabled="!selected.length" @click="resendBatch">重发</el-button>
        <span v-if="selected.length" class="tid-op-hint">已选 {{ selected.length }} 条</span>
      </div>

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
            <span v-if="col.dataIndex === 'taskId'" class="tid-id">
              <span class="tid-dot" :class="`tid-dot-${taskDotTone(row.state)}`" />
              {{ row.taskId }}
            </span>

            <!-- 配置ID：旧 configShowSlot —— 蓝色 tag，点击看配置模板详情 -->
            <span v-else-if="col.dataIndex === 'configId'" class="tid-config" @click="openConfig(row.configId)">
              <el-tag size="small">{{ row.configId }}</el-tag>
            </span>

            <!-- 更新时间：旧 lastDateSlot → timeago 相对时间；悬停看绝对时间 -->
            <el-tooltip
              v-else-if="col.dataIndex === 'updateDt'"
              :content="String(row.updateDt ?? '—')"
              placement="top-start"
            >
              <span class="tid-time">{{ timeText(row.updateDt) }}</span>
            </el-tooltip>

            <!-- 操作：旧 actionSlot —— 详情 | 重发（没有编辑） -->
            <span v-else-if="col.dataIndex === 'action'" class="tid-actions">
              <span class="tid-op-link" @click="openDetail(row)">详情</span>
              <span class="tid-op-divider">|</span>
              <span class="tid-op-link" @click="resendOne(row)">重发</span>
            </span>

            <span v-else>{{ cellText(row, col.dataIndex) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页：默认 20，可选 10/30/100/200，共N条 + 快速跳页（旧 s-table pagination 口径） -->
      <div class="tid-pager">
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
    </div>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>

    <TaskDetailDrawer v-model="detailVisible" :record="detailRecord" />
    <ConfigTemplateDrawer ref="configDrawerRef" />
  </el-dialog>
</template>

<style scoped>
.tid-body {
  min-height: 200px;
}
.tid-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.tid-filter-form :deep(.el-select),
.tid-filter-form :deep(.el-input) {
  width: 100%;
}
.tid-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
/* 创建时间：日期区间 + 「当天」按钮必须同行 */
.tid-date-item :deep(.el-form-item__content) {
  flex-wrap: nowrap;
}
.tid-date {
  flex: 1 1 auto;
  min-width: 0;
}
.tid-today {
  flex: none;
  margin-left: 4px;
}
.tid-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.tid-op-hint {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.tid-id {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tid-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
.tid-dot-success {
  background: #16a34a;
}
.tid-dot-error {
  background: #dc2626;
}
.tid-dot-default {
  background: #94a3b8;
}
.tid-dot-processing {
  background: #2563eb;
}
.tid-config {
  cursor: pointer;
}
.tid-time {
  white-space: nowrap;
}
.tid-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.tid-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.tid-op-link:hover {
  text-decoration: underline;
}
.tid-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.tid-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
