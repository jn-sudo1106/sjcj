<script setup lang="ts">
// 自定义告警（通用定时任务）—— 1:1 迁移旧 data-view `src/page/config/CommJobList.vue`（路由 /config/comm-job）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   搜索栏：队列名(query.queue) / ID(query.queueId) / 描述(query.name) / 状态(query.enable，**初值 '0' = 只用）
//           + [查询] [重置]
//           ⚠️ 与 queueCheck 不同：状态框带 @change → **改完立刻查**（其它输入框要按回车或点查询）。
//   操作条：增加告警 + 竖分割线 + 「更多..」下拉（未勾选时置灰，勾选后可用）
//   批量：下拉菜单三项 启用(enable=0) / 禁用(enable=1) / 删除
//   表格：COMM_JOB.base 13 列（定时ID / 类型 / 定时名 / 执行信息 / SQL定义 / 告警条件 / 运行参数 /
//         定时策略 / 下次运行 / 总运行次 / 成功次 / 上次运行 / 操作）
//         行内操作 = 编辑 + 复制 + 运行（**没有详情链接**；详情入口是点「定时ID」或「定时名」）
//   分页：默认 **100**，可选 10/20/40/100/200，显示总条数 + 快速跳页
//   弹窗：base-edit-modal（新增 title「新增数据」预填 jobName+isDelete=0 / 编辑）、base-detail-drawer
//   接口：pagedCommJobCheck / addCommJobCheck / updateCommJobCheck / deleteCommJobCheck /
//         changeCommJobCheckEnable / commJobCopy / runCommJob（7 条全部走真实接口，见 api/commJob.ts）
//
// 有意偏差（都在交付说明里单列）：
//   1. 不迁死代码：`快速生成数据集`（模板 v-if 依赖 this.sourceId / this.entryTypeId，而这两个既不是 props
//      也没定义，handleGenDataset 方法根本不存在 → 按钮永远不渲染）；MeasureShow / MeasureAdd / Prompt
//      （模板只挂了 Prompt，从未 show 过）；msgSlot（COMM_JOB 没有任何列引用它）；showLogModal
//      （$refs.logModal 不存在）；resetSearchForm / handleSearch / handleReset / handleCloseCurrentTab /
//      handleOpenTab（未接线）；`watch $route.query.configId`（本页在新平台是 Monitor 的 tab，没有这个路由参数）。
//   2. 首屏不再「自动选中第一行」：旧 loadData 写的是 `selectedRowKeys = [oriData[0].datasetId]`，
//      而定时任务记录上没有 datasetId（那是数据集页的字段）→ 实际一个都没勾中，却让「更多」下拉出现、
//      点删除会发出空 ids。这里不做任何自动勾选（与 queueCheck / sourceCheck 一致）。
//   3. 搜索框文案 1:1 保留旧版（队列名 / ID / 描述 / 状态）。这几栏对定时任务页来说其实是「定时名 / ID /
//      定时名 / 状态」——旧文案是从 QueueCheck.vue 抄过来的，字段名也没改。是否改叫「定时名」由你定。
//   4. 「增加告警」预填：旧 `handleAdd` 写的是 `{ queueName: 查询框.queue, isDelete: 0 }`，
//      而 COMM_JOB 记录上根本没有 queueName 字段（列叫 jobName）——同样是复制过来的笔误。
//      这里改成预填 `jobName`（真正会被提交的字段），否则那一栏白填、还多带一个无用键进请求体。
//   5. 批量操作 1:1 复刻旧版 a-dropdown「更多..」（菜单项 启用/禁用/删除 与图标 thunderbolt /
//      disconnect / scissor 一一对应）；差别只是旧版勾选后才出现，这里常显、未勾选时置灰（你上轮的要求）。
//      确认框统一用平台 confirmDanger；「清勾选 + 刷新」写在 run 回调里（confirmDanger 取消时是正常 return，
//      写在 await 之后会「取消也刷新」，旧版这步在 .then 里）。
//      ⚠️ 确认框本身是一处偏差：旧版 **批量删除** 有 $confirm，而 **批量启用/禁用** 是直接调接口、不弹框
//      （batchChangeEnable 里没有任何 $confirm）。这里三项目前都走 confirmDanger —— 启停是可逆的轻操作，
//      若要与旧版严格一致、给启停去掉确认，说一声即可（改回直接调 runAndReport）。
//   6. 表头不排序：旧 COMM_JOB 的列里没有任何 `sorter: true`（与队列告警不同），故不挂 sortable。
//   7. 「下次运行 / 上次运行」列表里走旧 timeago 的相对时间（悬停看绝对时间）；详情抽屉里按旧版仍是绝对时间。
//   8. 行内「运行」保持旧版的**无二次确认**（旧代码就是直接 runCommJob + 通知）。因为它会真的触发任务执行，
//      如果要加确认框，说一声即可。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type TableInstance } from 'element-plus'
import {
  Search,
  Plus,
  Refresh,
  Setting,
  ArrowDown,
  Lightning,
  SwitchButton,
  Scissor,
  DocumentCopy,
  VideoPlay,
  Edit
} from '@element-plus/icons-vue'
import type { CommJob } from '@/api'
import {
  pagedCommJobCheck,
  changeCommJobCheckEnable,
  deleteCommJobCheck,
  commJobCopy,
  runCommJob,
} from '@/api/commJob'
import { confirmDanger } from '@/utils/confirmDanger'
import { listColumns, jobTypeText, timeAgoText } from './columns'
import CommJobEditDialog from './CommJobEditDialog.vue'
import CommJobDetailDrawer from './CommJobDetailDrawer.vue'

defineOptions({ name: 'CommJobList' })

// ---- 查询条件（草稿 → 执行 两态：文本项变化不自动查，点「查询」/ 回车才发请求）----
const form = reactive({
  queue: '',    // 队列名（旧 queryParam.queue → 后端落 jobName）
  queueId: '',  // ID
  name: '',     // 描述（旧 queryParam.name）
  enable: '0',  // '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的（⚠️ 初值 '0'，与 queueCheck 不同）
})
/** 已「执行」的筛选条件。分页单独管——旧 pagedCommJobCheck 只发筛选字段 + page/limit。 */
const filters = reactive({ queue: '', queueId: '', name: '', enable: '0' })

// ---- 列表状态 ----
const rows = ref<CommJob[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 jobId（旧 s-table 的 rowKey 就是 record.jobId） */
const selected = ref<string[]>([])
const page = ref(1)
const size = ref(100) // 旧 s-table 的 `:pageSize="100"` + pagination.defaultPageSize

const COLUMNS = listColumns()
/** 长文本列：列上挂 show-overflow-tooltip（悬停看全文），与列宽自适应配套 */
const OVERFLOW_COLS = new Set(['lastMsg', 'sqlDef', 'ruleDef', 'jobParam'])

async function load() {
  loading.value = true
  try {
    const res = await pagedCommJobCheck({
      queue: filters.queue,
      queueId: filters.queueId,
      name: filters.name,
      enable: filters.enable,
      page: page.value,
      limit: size.value,
    })
    rows.value = res.list
    total.value = res.total
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载自定义告警列表失败')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  filters.queue = form.queue.trim()
  filters.queueId = form.queueId.trim()
  filters.name = form.name.trim()
  filters.enable = form.enable
  page.value = 1
  void load()
}

/** 旧「重置」按钮：`queryParam = {}` —— 只清条件，不发请求（下一次查询才生效）。
 *  差别：旧版清完 enable 是 undefined（下拉回到空 placeholder），这里回到「全部」（''），
 *  两者在接口上等价——都是不带 enable 条件。 */
function resetQuery() {
  form.queue = ''
  form.queueId = ''
  form.name = ''
  form.enable = ''
}

// ---- 批量操作（旧版：勾选后点「更多..」下拉 → 启用 / 禁用 / 删除）----
const tableRef = ref<TableInstance>()

function onSelectionChange(selection: CommJob[]) {
  selected.value = selection.map((row) => row.jobId)
}

/** 旧版每批操作后 `selectedRowKeys = []`（受控 rowSelection，表格勾选会同步清空）。
 *  el-table 的勾选由内部 store 管，光清数组会出现「按钮已禁用、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  tableRef.value?.clearSelection()
}

async function batchEnable(enable: boolean) {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  await confirmDanger(
    enable ? '批量启用' : '批量禁用',
    `将${enable ? '启用' : '禁用'}选中的 ${ids.length} 条定时任务，确认执行？`,
    async () => {
      const res = (await changeCommJobCheckEnable(ids, enable)) as { message?: string }
      clearSelection()
      void load()
      return res
    },
  )
}
async function batchDelete() {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  // 旧版确认文案：'是否确认要删除以下告警配置:' + size
  await confirmDanger('提示', `是否确认要删除以下告警配置：${ids.length}`, async () => {
    const res = (await deleteCommJobCheck(ids)) as { message?: string }
    clearSelection()
    void load()
    return res
  })
}

/** 「更多..」下拉派发：command 与菜单项一一对应（旧 batchChangeEnable(0)/batchChangeEnable(1)/batchDelete） */
function onBatchCommand(command: string) {
  if (command === 'enable') void batchEnable(true)
  else if (command === 'disable') void batchEnable(false)
  else if (command === 'delete') void batchDelete()
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
const editDialogRef = ref<InstanceType<typeof CommJobEditDialog>>()
const detailVisible = ref(false)
const detailRecord = ref<CommJob | null>(null)

/** 旧 handleAdd：把查询框里的关键词带进新增弹窗，并预置 isDelete=0。
 *  查询框没填时传 undefined（不覆盖列初值）。字段名见文件头「有意偏差 4」。 */
function openAdd() {
  editDialogRef.value?.openDialog(null, { jobName: form.queue || undefined, isDelete: 0 })
}
function onSaved() {
  void load()
}
function openEdit(row: CommJob) {
  editDialogRef.value?.openDialog(row)
}
function openDetail(row: CommJob) {
  detailRecord.value = row
  detailVisible.value = true
}

/** 行内「复制」：旧版有 $confirm（'真的要复制JOB吗 ?'），成功后提示刷新后查最新 ID */
async function copyJob(row: CommJob) {
  await confirmDanger('提示', '真的要复制JOB吗 ?', async () => {
    const res = (await commJobCopy(row.jobId)) as { message?: string }
    ElMessage.success(res?.message || '复制成功,请刷新后查询最新ID')
    void load()
    return res
  })
}

/** 行内「运行」：旧版**没有**二次确认，直连接口后提示 + 刷新（旧的成功文案误抄成「复制成功…」，
 *  这里按真实语义改文案，接口调用口径不变）。 */
async function runJob(row: CommJob) {
  try {
    const res = (await runCommJob(row.jobId)) as { message?: string }
    ElMessage.success(res?.message || '运行已提交')
    void load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '运行失败')
  }
}

/** 时间列：旧 timeago 相对时间；悬停看绝对时间 */
function timeText(value?: string) {
  return timeAgoText(value)
}

onMounted(() => void load())
</script>

<template>
  <div class="cj-shell" v-loading="loading">
    <!-- <div class="cj-head">
      <div class="cj-title">自定义告警</div>
      <div class="cj-sub">通用定时任务（SQL-告警 / 定时 Job）的配置列表，支持批量启停、复制与运行。</div>
    </div> -->

    <!-- 筛选表单（对齐旧 a-form layout="inline" + a-row 栅格；文本项不自动查，状态项 @change 即查） -->
    <el-form :inline="true" class="cj-filter-form">
      <el-row :gutter="8" class="cj-filter-row">
        <el-col :md="4" :sm="24">
          <el-form-item label="队列名">
            <el-input v-model="form.queue" placeholder="队列名" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="ID">
            <el-input v-model="form.queueId" placeholder="ID" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="描述">
            <el-input v-model="form.name" placeholder="描述" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="状态">
            <!-- 旧版这个 select 带 @change="handleRefresh"：改完立刻查（1:1） -->
            <el-select v-model="form.enable" placeholder="请选择" @change="runQuery">
              <el-option label="全部" value="" />
              <el-option label="在用" value="0" />
              <el-option label="停用" value="1" />
              <el-option label="历史删除的" value="-1" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
            <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <!-- 操作条：旧版 .operation —— 增加告警 + 竖分割线 + 「更多..」下拉（常显、未勾选置灰） -->
    <div class="cj-op-bar">
      <el-button type="danger" :icon="Plus" @click="openAdd">增加告警</el-button>
      <el-divider direction="vertical" class="cj-op-divider-v" />
      <el-dropdown class="cj-more" :disabled="!selected.length" @command="onBatchCommand">
        <el-button :icon="Setting" :disabled="!selected.length">
          更多..
          <el-icon class="cj-more-arrow"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="enable" :icon="Lightning">启用</el-dropdown-item>
            <el-dropdown-item command="disable" :icon="SwitchButton">禁用</el-dropdown-item>
            <el-dropdown-item command="delete" :icon="Scissor">删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 表格：列定义来自 allColumns.COMM_JOB.base（标题/顺序 1:1）。
         列宽自适应：文本列走 min-width，短列走固定 width；操作列 fixed="right"（旧列配置同款）。
         旧 COMM_JOB 没有任何 sorter，所以表头不排序。 -->
    <el-table
      ref="tableRef"
      :data="rows"
      border
      size="small"
      :row-key="(r: CommJob) => r.jobId"
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
          <!-- 定时ID：旧 idSlot —— 整格可点进详情，按 isDelete 三态上色 -->
          <span v-if="col.dataIndex === 'jobId'" class="cj-id" @click="openDetail(row)">
            <span v-if="row.isDelete === 0">{{ row.jobId }}</span>
            <el-tag v-else-if="row.isDelete === 1" type="danger" size="small">{{ row.jobId }}</el-tag>
            <span v-else class="cj-history">
              <span class="cj-warn">!</span>
              <el-tag size="small">{{ row.jobId }}</el-tag>
            </span>
          </span>

          <!-- 类型：旧 jobTypeSlot → typeFilter -->
          <span v-else-if="col.dataIndex === 'jobType'">{{ jobTypeText(row.jobType) }}</span>

          <!-- 定时名：旧 nameSlot —— 三态 + 悬停看全文 + 点击进详情 -->
          <span v-else-if="col.dataIndex === 'jobName'" class="cj-name">
            <el-tooltip :content="String(row.jobName ?? '')" placement="top-start">
              <div class="cj-name-inner">
                <a v-if="row.isDelete === 0" class="cj-link" @click="openDetail(row)">{{ row.jobName }}</a>
                <el-tag v-else-if="row.isDelete === 1" type="danger" size="small" class="cj-tag" @click="openDetail(row)">
                  {{ row.jobName }}
                </el-tag>
                <span v-else class="cj-history">
                  <span class="cj-warn">!</span>
                  <el-tag size="small" class="cj-tag" @click="openDetail(row)">{{ row.jobName }}</el-tag>
                </span>
              </div>
            </el-tooltip>
          </span>

          <!-- 下次运行 / 上次运行：旧 lastDateSlot → timeago 相对时间；悬停看绝对时间 -->
          <el-tooltip
            v-else-if="col.dataIndex === 'nextRun' || col.dataIndex === 'lastRun'"
            :content="String(row[col.dataIndex as 'nextRun' | 'lastRun'] ?? '—')"
            placement="top-start"
          >
            <span class="cj-time">{{ timeText(row[col.dataIndex as 'nextRun' | 'lastRun']) }}</span>
          </el-tooltip>

          <!-- 操作：旧 actionSlot —— 编辑 / 复制 / 运行（图标化） -->
          <span v-else-if="col.dataIndex === 'action'" class="cj-actions">
            <el-tooltip content="编辑" placement="top">
              <span class="cj-op-icon" @click="openEdit(row)"><el-icon :size="15"><Edit /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="复制" placement="top">
              <span class="cj-op-icon" @click="copyJob(row)"><el-icon :size="15"><DocumentCopy /></el-icon></span>
            </el-tooltip>
            <el-tooltip content="运行" placement="top">
              <span class="cj-op-icon" @click="runJob(row)"><el-icon :size="15"><VideoPlay /></el-icon></span>
            </el-tooltip>
          </span>

          <!-- 其余列（含禁用列以外的短列）：直接显示字段值；长文本走列上的 show-overflow-tooltip -->
          <span v-else>{{ row[col.dataIndex as keyof CommJob] }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：默认 100，可选 10/20/40/100/200，共N条 + 快速跳页（旧 s-table pagination 口径） -->
    <div class="cj-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <CommJobEditDialog ref="editDialogRef" @saved="onSaved" />
    <CommJobDetailDrawer v-model="detailVisible" :record="detailRecord" />
  </div>
</template>

<style scoped>
/* 表头文字颜色统一 */
.cj-shell :deep(.el-table__header th) {
  color: var(--rc-text-2);
}
.cj-shell {
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
.cj-head {
  margin-bottom: 2px;
}
.cj-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.cj-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
/* 筛选表单：对齐旧 a-form layout="inline" 的栅格宽度比例 */
.cj-filter-form {
  margin-bottom: 0;
}
.cj-filter-row {
  width: 100%;
}
.cj-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.cj-filter-form :deep(.el-select),
.cj-filter-form :deep(.el-input) {
  width: 100%;
}
.cj-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
.cj-filter-form .el-col:last-child :deep(.el-form-item) {
  width: auto;
}
.cj-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cj-op-divider-v {
  height: 1.2em;
  margin: 0;
}
.cj-more-arrow {
  margin-left: 4px;
  vertical-align: -0.15em;
}
/* 定时ID：整格可点 */
.cj-id {
  cursor: pointer;
}
/* 定时名：旧版是 div max-width:180px + 省略 + popover 全文；列宽自适应后改成 100% */
.cj-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
}
.cj-name-inner {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-all;
}
.cj-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.cj-link:hover {
  text-decoration: underline;
}
.cj-op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  /* color: var(--rc-primary, #2563eb); */
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}
.cj-op-icon:hover {
  background: var(--rc-primary-bg, #eff6ff);
  color: var(--rc-primary, #2563eb);
}
.cj-tag {
  cursor: pointer;
}
.cj-history {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cj-warn {
  color: var(--rc-error, #dc2626);
  font-weight: 700;
}
.cj-time {
  white-space: nowrap;
}
.cj-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.cj-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>

