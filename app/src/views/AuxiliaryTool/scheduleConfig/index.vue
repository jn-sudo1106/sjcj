<script setup lang="ts">
// 调度整体配置 —— 1:1 迁移旧 data-view `src/page/config/ScheduleConfig.vue` +
// `src/page/config/modules/ScheduleConfigModal.vue`（旧路由 /config/schedule-config）。
//
// 旧页面结构：
//   筛选：状态（全部/启用/停用）+ 源ID + [查询][重置]
//   范围提示：带筛选范围时说明「统计范围 = 来源列表页当前筛选」，否则提示"未带范围 → 统计全部可见源"
//   操作：[统一定时（按当前范围）] + 说明
//   汇总表：调度表达式（悬停看中文描述）/ 任务数 / 启用 / 停用 / 执行中 / 最近下次执行 / 操作
//   展开行：懒加载该表达式下的任务明细（带刷新、加载中、失败、空态四种状态）
//   行内操作：统一修改 / 启用 / 禁用 / 任务明细
//
// 有意偏差（重点，交付说明里逐条列了）：
//   1. 旧页面是个**弹窗壳**：打开即自动弹 ScheduleConfigModal，关掉后只剩一张空态卡片。
//      新项目这一屏是「辅助工具」的页内 tab，没有"从来源列表带入筛选范围"的入口，
//      所以直接把弹窗内容做成页面本体（不再套一层 on-mount 自动打开的弹窗）——
//      用户也不需要点两下才能看到表。
//   2. 因此 `scopeQuery` 恒为空，"来源列表带入范围"那条链路在新项目里没有入口（旧版是从
//      来源列表的「操作类 → 定时任务变更」钻进来的）。范围提示保留，文案改为说明这一点。
//   3. 汇总表分页仍是**前端切片**：旧 loadSummary 拿到全量数组后自己 slice（后端不分页），
//      这里照旧，默认 30 条/页，可选 10/30/100。
//   4. 展开行的任务明细分页改为每行独立页码（旧版 a-table 内部也有独立分页，行为一致）。
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import {
  getJobsBySchedule,
  getScheduleSummary,
  updateScheduleByCron,
  type ScheduleJob,
  type ScheduleSummaryRow,
  type ScheduleUpdateResult,
} from '@/api/schedule'
import { describeCron } from './cron'
import { rangeIsEmpty } from './range'
import CronEditModal from './CronEditModal.vue'
import CategoryScheduleModal from './CategoryScheduleModal.vue'
import ScheduleJobDrawer from './ScheduleJobDrawer.vue'

defineOptions({ name: 'ScheduleConfig' })

/** 状态下拉哨兵：el-select 把空串判成"没选"，选"全部"时框里看不到字 */
const ENABLE_ALL = 'all'
const toApiEnable = (value: string): string => (value === ENABLE_ALL ? '' : value)

// ---- 筛选（草稿 → 执行 两态，与旧版一致：点查询才发请求）----
const form = reactive({ enable: ENABLE_ALL as string, sourceId: '' })
const filters = reactive({ enable: ENABLE_ALL as string, sourceId: '' })

/** 来源列表带入的范围：新项目没有这个入口，恒为空（见文件头偏差 2） */
const scopeQuery = ref<Record<string, unknown>>({})
const scopeKeys = computed(() => Object.keys(scopeQuery.value).filter((key) => scopeQuery.value[key] !== ''))
const scopeDesc = computed(() => scopeKeys.value.map((key) => `${key}=${String(scopeQuery.value[key])}`).join('、'))

/** 统计 / 明细 / 统一修改共用的范围参数 */
function condParams(): Record<string, unknown> {
  const params: Record<string, unknown> = { ...scopeQuery.value }
  if (filters.enable && filters.enable !== ENABLE_ALL) params.enable = toApiEnable(filters.enable)
  if (filters.sourceId && filters.sourceId.trim()) params.sourceId = filters.sourceId.trim()
  return params
}

const scopeEmpty = computed(() => rangeIsEmpty(condParams()))

// ---- 汇总表 ----
const allRows = ref<ScheduleSummaryRow[]>([])
const loading = ref(false)
const page = ref(1)
const size = ref(30)

/** 旧 loadSummary 是前端切片：后端给全量，页面自己分页 */
const rows = computed(() => {
  const start = (page.value - 1) * size.value
  return allRows.value.slice(start, start + size.value)
})
const total = computed(() => allRows.value.length)

async function loadSummary() {
  loading.value = true
  try {
    allRows.value = await getScheduleSummary(condParams())
  } catch (error) {
    allRows.value = []
    ElNotification.error({
      title: '加载调度汇总失败',
      message: `${error instanceof Error ? error.message : String(error)}，请点击「查询」重试`,
    })
  } finally {
    loading.value = false
  }
}

function runQuery() {
  filters.enable = form.enable
  filters.sourceId = form.sourceId
  page.value = 1
  detailState.value = {}
  void loadSummary()
}

/** 旧「重置」：条件清空并回查一次（旧版 handleReset 会 refresh(true)） */
function resetQuery() {
  form.enable = ENABLE_ALL
  form.sourceId = ''
  runQuery()
}

/** 数据变更后：清明细缓存 + 重查汇总 */
function refreshAll() {
  detailState.value = {}
  void loadSummary()
}

function onPageChange(value: number) {
  page.value = value
}
function onSizeChange(value: number) {
  size.value = value
  page.value = 1
}

/** 悬停提示：中文描述 + 原文（旧 scheduleTip） */
function scheduleTip(text: string): string {
  const desc = describeCron(text)
  return desc ? `${desc}\n（${text}）` : text
}

function timeText(value: string | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

// ---- 展开行：懒加载任务明细 ----
interface DetailState {
  status: 'loading' | 'done' | 'error'
  jobs: ScheduleJob[]
  running: number
  /** 每行独立页码（旧 a-table 内部也是独立分页） */
  page: number
}
const detailState = ref<Record<string, DetailState>>({})
const DETAIL_PAGE_SIZE = 20

/** 同一行重复刷新的请求序号：旧响应到达时丢弃，避免写回新明细 */
const detailSeq: Record<string, number> = {}

async function loadDetail(schedule: string) {
  detailState.value = {
    ...detailState.value,
    [schedule]: { status: 'loading', jobs: [], running: 0, page: detailState.value[schedule]?.page ?? 1 },
  }
  detailSeq[schedule] = (detailSeq[schedule] ?? 0) + 1
  const my = detailSeq[schedule]
  try {
    const jobs = await getJobsBySchedule(schedule, condParams())
    if (detailSeq[schedule] !== my) return
    detailState.value = {
      ...detailState.value,
      [schedule]: {
        status: 'done',
        jobs,
        running: jobs.filter((job) => job.state === 'L').length,
        page: detailState.value[schedule]?.page ?? 1,
      },
    }
  } catch {
    if (detailSeq[schedule] !== my) return
    detailState.value = {
      ...detailState.value,
      [schedule]: { status: 'error', jobs: [], running: 0, page: 1 },
    }
  }
}

function onExpandChange(row: ScheduleSummaryRow, expandedRows: ScheduleSummaryRow[]) {
  const expanded = expandedRows.some((item) => item.schedule === row.schedule)
  if (!expanded) return
  const current = detailState.value[row.schedule]
  if (current && current.status === 'done') return
  void loadDetail(row.schedule)
}

function detailRows(schedule: string): ScheduleJob[] {
  const state = detailState.value[schedule]
  if (!state) return []
  const start = (state.page - 1) * DETAIL_PAGE_SIZE
  return state.jobs.slice(start, start + DETAIL_PAGE_SIZE)
}

function onDetailPage(schedule: string, value: number) {
  const state = detailState.value[schedule]
  if (!state) return
  detailState.value = { ...detailState.value, [schedule]: { ...state, page: value } }
}

// ---- 弹窗 ----
const cronEditRef = ref<InstanceType<typeof CronEditModal>>()
const categoryRef = ref<InstanceType<typeof CategoryScheduleModal>>()
const jobDrawerRef = ref<InstanceType<typeof ScheduleJobDrawer>>()

/** 行内「统一修改」：把当前范围与受影响任务数带给弹窗（旧 handleUnifyEdit） */
function openUnifyEdit(row: ScheduleSummaryRow) {
  cronEditRef.value?.show({
    mode: 'batch',
    oldCron: row.schedule,
    tip: `当前筛选范围内被 ${row.jobCnt} 个任务使用，修改后范围内统一生效（跳过执行中或已是新表达式的）`,
    jobCnt: row.jobCnt,
    scopeEmpty: scopeEmpty.value,
  })
}

/** 批量修改的提交（与统计同范围） */
async function onSubmitBatch(param: Record<string, unknown>): Promise<ScheduleUpdateResult> {
  return updateScheduleByCron(String(param.oldCron ?? ''), String(param.newCron ?? ''), condParams())
}

/** 统一定时（按当前范围） */
function openCategorySchedule() {
  categoryRef.value?.show(condParams(), { fromSchedule: true })
}

/** 行内启用 / 禁用：先查一次该表达式下的任务（拿数量与执行中数量），再二次确认，最后单接口批量启停 */
async function onLineState(row: ScheduleSummaryRow, enabled: boolean) {
  const action = enabled ? '启用' : '禁用'
  let jobs: ScheduleJob[]
  try {
    jobs = await getJobsBySchedule(row.schedule, condParams())
  } catch (error) {
    ElNotification.error({
      title: '获取该表达式下任务失败',
      message: error instanceof Error ? error.message : String(error),
    })
    return
  }
  if (!jobs.length) {
    ElMessage.warning('当前筛选范围内该表达式下没有任务')
    return
  }
  const running = jobs.filter((job) => job.state === 'L').length
  const runningTip = running > 0 ? `，其中 ${running} 个任务正在执行中（会被跳过）` : ''
  try {
    if (scopeEmpty.value) {
      await ElMessageBox.confirm(
        `未传任何筛选范围，将把使用「${row.schedule}」的全部任务${action}！\n${running > 0 ? `${running} 个任务正在执行中（将被跳过）。\n` : ''}提交时将携带 confirmAll=true（后端强制要求）；启停可反向恢复。`,
        '警告：将对全部信息源生效',
        { type: 'warning', confirmButtonText: `确认全部${action}`, cancelButtonText: '取消' },
      )
    } else {
      await ElMessageBox.confirm(
        `将把当前筛选范围内使用「${row.schedule}」的 ${jobs.length} 个任务${action}${runningTip}，是否继续？`,
        `确认按当前范围批量${action}`,
        { type: 'warning', confirmButtonText: `确认${action}`, cancelButtonText: '取消' },
      )
    }
  } catch {
    return
  }
  try {
    const data = await updateScheduleByCron(
      row.schedule,
      undefined,
      condParams(),
      { jobStatus: enabled ? 0 : 1, confirmAll: scopeEmpty.value || undefined },
    )
    const skipped = Number(data.skipped ?? 0)
    const skippedIds = data.skippedIds ?? []
    const done = data.affected ?? '-'
    const totalCnt = data.total ?? '-'
    let message = `按范围批量${action}完成：${done}/${totalCnt}`
    if (skipped > 0) {
      message += `，${skipped} 个任务未${action}（执行中/并发变化/无需修改，jobId: ${skippedIds.join(', ')}），请稍后重试或人工处理`
      ElMessage.warning(message)
    } else {
      ElMessage.success(message)
    }
    refreshAll()
  } catch (error) {
    ElNotification.error({
      title: `按范围批量${action}失败`,
      message: `${error instanceof Error ? error.message : String(error)}（可能部分生效，建议重新查询确认）`,
    })
  }
}

/** 任务明细抽屉 */
function openJobs(row: ScheduleSummaryRow) {
  const extraQuery: Record<string, unknown> = {}
  if (scopeQuery.value.ids) extraQuery.ids = scopeQuery.value.ids
  if (scopeQuery.value.sourceId) extraQuery.sourceId = scopeQuery.value.sourceId
  if (filters.sourceId.trim()) extraQuery.sourceId = filters.sourceId.trim()
  jobDrawerRef.value?.show(row.schedule, row, extraQuery)
}

/** 汇总行视觉标记：执行中 > 0 的行黄底 */
function rowClassName({ row }: { row: ScheduleSummaryRow }): string {
  return Number(row.runningCnt) > 0 ? 'row-running' : ''
}

onMounted(() => void loadSummary())
</script>

<template>
  <div class="sc-shell">
    <!-- 筛选（旧 a-form layout="inline"） -->
    <el-form :inline="true" class="sc-filter" @submit.prevent>
      <el-form-item label="状态">
        <el-select v-model="form.enable" class="sc-select">
          <el-option label="全部" :value="ENABLE_ALL" />
          <el-option label="启用" value="0" />
          <el-option label="停用" value="1" />
        </el-select>
      </el-form-item>
      <el-form-item label="源ID">
        <el-input v-model="form.sourceId" placeholder="只看某信源下的任务" clearable @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <!-- 范围提示：带范围时说明来源，否则说明"统计全部可见源" -->
    <el-alert v-if="scopeKeys.length" type="info" :closable="false" show-icon class="sc-scope">
      <template #title>
        统计范围 = <strong>来源列表页当前筛选</strong>（{{ scopeDesc }}）：页面看到哪些源，统计就是哪些源，批量设置同口径。
      </template>
      <template #default>
        统计 / 明细 / 「统一修改 / 行内启停 / 统一定时」均按当前筛选范围生效（跳过执行中或已是新表达式的任务）。
      </template>
    </el-alert>
    <el-alert
      v-else
      type="info"
      :closable="false"
      show-icon
      class="sc-scope"
      title="未从来源列表带入筛选范围：统计全部可见源（本页只有下面这组快捷筛选：状态 / 源ID）。"
    />

    <!-- 操作条 -->
    <div class="sc-ops">
      <el-button type="primary" @click="openCategorySchedule">统一定时（按当前范围）</el-button>
      <span class="sc-ops-tip">
        按 cron 表达式统计任务使用量；「统一修改 / 行内启停」让当前筛选范围内使用该表达式的任务一次性生效，点击「任务明细」可查看/单条管理任务。
      </span>
      <el-button :icon="Refresh" class="sc-ops-refresh" @click="refreshAll">刷新</el-button>
    </div>

    <!-- 汇总表 -->
    <el-table
      v-loading="loading"
      :data="rows"
      border
      size="small"
      row-key="schedule"
      :row-class-name="rowClassName"
      empty-text="没有匹配的调度表达式"
      class="sc-table"
      @expand-change="onExpandChange"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="sc-detail">
            <div class="sc-detail-bar">
              <el-button size="small" :icon="Refresh" @click="loadDetail(row.schedule)">刷新明细</el-button>
              <el-alert
                v-if="detailState[row.schedule]?.status === 'done' && detailState[row.schedule].running > 0"
                type="warning"
                :closable="false"
                show-icon
                class="sc-detail-warn"
                :title="`有 ${detailState[row.schedule].running} 个任务正在执行中（state=L），统一修改时将被跳过`"
              />
            </div>

            <div v-if="detailState[row.schedule]?.status === 'loading'" class="sc-detail-loading">加载任务明细...</div>

            <template v-else-if="detailState[row.schedule]?.status === 'done'">
              <el-table :data="detailRows(row.schedule)" border size="small" max-height="260">
                <el-table-column prop="jobId" label="jobId" width="90" />
                <el-table-column prop="jobName" label="任务名" min-width="200" show-overflow-tooltip />
                <el-table-column prop="sourceId" label="源ID" width="110" />
                <el-table-column prop="schedule" label="表达式" width="160" show-overflow-tooltip />
                <el-table-column label="状态" width="100" align="center">
                  <template #default="{ row: job }">
                    <span :class="job.state === 'L' ? 'sc-run' : 'sc-wait'">
                      {{ job.state === 'L' ? '执行中' : '等待执行' }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column label="下次执行" width="165">
                  <template #default="{ row: job }">{{ timeText(job.nextRun) }}</template>
                </el-table-column>
                <el-table-column label="上次执行" width="165">
                  <template #default="{ row: job }">{{ timeText(job.lastRun) }}</template>
                </el-table-column>
                <el-table-column prop="runCnt" label="总次数" width="90" align="right" />
                <el-table-column prop="successCnt" label="成功" width="90" align="right" />
              </el-table>
              <div v-if="detailState[row.schedule].jobs.length" class="sc-detail-pager">
                <el-pagination
                  :current-page="detailState[row.schedule].page"
                  :page-size="20"
                  :total="detailState[row.schedule].jobs.length"
                  layout="total, prev, pager, next"
                  small
                  background
                  @current-change="(value: number) => onDetailPage(row.schedule, value)"
                />
              </div>
              <div v-else class="sc-detail-empty">该表达式下暂无任务</div>
            </template>

            <div v-else-if="detailState[row.schedule]?.status === 'error'" class="sc-detail-error">
              明细加载失败，请点击上方「刷新明细」重试
            </div>

            <div v-else class="sc-detail-empty">数据已更新，请点击上方「刷新明细」查看最新</div>
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="schedule" label="调度表达式" width="220">
        <template #default="{ row }">
          <el-tooltip :content="scheduleTip(row.schedule)" placement="top-start">
            <span class="sc-schedule">{{ row.schedule }}</span>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column prop="jobCnt" label="任务数" min-width="90" align="right" />
      <el-table-column prop="enableCnt" label="启用" width="90" align="right" />
      <el-table-column prop="disableCnt" label="停用" width="90" align="right" />
      <el-table-column label="执行中" width="90" align="right">
        <template #default="{ row }">
          <el-tag v-if="Number(row.runningCnt) > 0" type="warning" size="small">{{ row.runningCnt }}</el-tag>
          <span v-else>{{ row.runningCnt }}</span>
        </template>
      </el-table-column>
      <el-table-column label="最近下次执行" width="180">
        <template #default="{ row }">{{ timeText(row.minNextRun) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="250" align="center" fixed="right">
        <template #default="{ row }">
          <div class="sc-actions">
            <a class="sc-link" @click="openUnifyEdit(row)">统一修改</a>
            <el-divider direction="vertical" class="sc-divider" />
            <a class="sc-link" @click="onLineState(row, true)">启用</a>
            <el-divider direction="vertical" class="sc-divider" />
            <a class="sc-link sc-link-danger" @click="onLineState(row, false)">禁用</a>
            <el-divider direction="vertical" class="sc-divider" />
            <a class="sc-link" @click="openJobs(row)">任务明细</a>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="sc-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 30, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <CronEditModal ref="cronEditRef" :callback="onSubmitBatch" @refresh="refreshAll" />
    <CategoryScheduleModal ref="categoryRef" @refresh="refreshAll" />
    <ScheduleJobDrawer ref="jobDrawerRef" @refresh="refreshAll" />
  </div>
</template>

<style scoped>
.sc-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.sc-filter {
  margin-bottom: 0;
}
.sc-filter :deep(.el-form-item) {
  margin-bottom: 6px;
  margin-right: 12px;
}
.sc-filter :deep(.el-form-item__label) {
  font-size: 12px;
}
.sc-select {
  width: 120px;
}
.sc-scope :deep(.el-alert__title),
.sc-scope :deep(.el-alert__description) {
  font-size: 12px;
  line-height: 1.6;
}
.sc-ops {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sc-ops-tip {
  flex: 1;
  min-width: 240px;
  padding: 4px 10px;
  background: var(--rc-primary-bg, #eff6ff);
  border-radius: 4px;
  color: var(--rc-text-2, #475569);
  font-size: 12px;
  line-height: 1.5;
}
.sc-ops-refresh {
  margin-left: auto;
}
.sc-table :deep(.el-table__header th) {
  color: var(--rc-text-2, #475569);
}
/* 执行中任务 > 0 的表达式行：黄底提示（旧 .row-running） */
.sc-table :deep(.row-running > td) {
  background: #fffbe6;
}
.sc-schedule {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.sc-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.sc-link {
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.sc-link:hover {
  text-decoration: underline;
}
.sc-link-danger {
  color: var(--rc-error, #dc2626);
}
.sc-divider {
  height: 1em;
  margin: 0 4px;
}
.sc-detail {
  padding: 4px 12px 8px 40px;
}
.sc-detail-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.sc-detail-warn {
  display: inline-flex;
  width: auto;
}
.sc-detail-warn :deep(.el-alert__title) {
  font-size: 12px;
}
.sc-detail-loading,
.sc-detail-empty,
.sc-detail-error {
  padding: 8px 0;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.sc-detail-error {
  color: var(--rc-error, #dc2626);
}
.sc-detail-pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.sc-run {
  color: var(--rc-warn, #c2410c);
  font-size: 12px;
}
.sc-wait {
  color: var(--rc-ok, #15803d);
  font-size: 12px;
}
.sc-pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
</style>
