<script setup lang="ts">
// 表达式下任务明细抽屉 —— 旧 `page/config/modules/ScheduleJobDrawer.vue` 的 1:1 迁移。
//
// 旧页面全貌：
//   顶部统计条：共 N 个任务 / 启用 / 停用 / 执行中 / 最近一次下次执行（执行中 > 0 时再加一条警告）
//   操作条：[统一修改表达式]（无表达式时禁用）+ [刷新]（无表达式时红字提示）
//   表格：启用开关 / 定时ID / 定时名 / 源ID / 定时策略 / 状态 / 下次运行 / 总运行次 / 成功次 /
//         上次运行 / 操作（编辑 + 更多→详情/立即运行/删除），带分页
//   加载失败用错误条区分「失败」与「没有数据」
//
// 有意偏差（都在交付说明里说明）：
//   1. 行内「编辑」打开的是**表达式修改弹窗**（single 模式，提交 job/updateJob 的 id+cron），
//      而不是旧版那个全字段 BaseEdit（它把 CRON 的 10 列 + 执行流程/配置 ID 一起塞进 a-descriptions）。
//      理由：抽屉里真正要改的就是 cron；全字段编辑涉及流程选择器（FLOW_ID），属于画布/源配置的活。
//   2. 「详情」用本地只读弹窗展示该行全部字段，不再依赖旧项目的 BaseDetailDrawer。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { ArrowDown, Refresh } from '@element-plus/icons-vue'
import {
  changeJobState,
  deleteJob,
  runJob,
  snatchJobIdsByCond,
  snatchJobPaged,
  updateJobCron,
  updateScheduleByCron,
  type ScheduleJob,
  type ScheduleSummaryRow,
} from '@/api/schedule'
import { rangeIsEmpty } from './range'
import CronEditModal from './CronEditModal.vue'

defineOptions({ name: 'ScheduleJobDrawer' })

const emit = defineEmits<{ (e: 'refresh'): void }>()

const visible = ref(false)
const schedule = ref('')
const extraQuery = ref<Record<string, unknown>>({})
const stats = ref<ScheduleSummaryRow | null>(null)
const loadError = ref(false)

const rows = ref<ScheduleJob[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(10)

const cronEditRef = ref<InstanceType<typeof CronEditModal>>()
/** 单条编辑用的那个弹窗实例（与批量的分开，回调和标题都不同） */
const singleCronRef = ref<InstanceType<typeof CronEditModal>>()

const drawerTitle = computed(() => (schedule.value ? `任务明细 - ${schedule.value}` : '任务明细'))

/** 当前源过滤的中文描述（统一修改确认文案用） */
const filterDesc = computed(() => {
  const parts: string[] = []
  if (extraQuery.value.sourceId) parts.push(`源ID=${String(extraQuery.value.sourceId)}`)
  if (extraQuery.value.ids) parts.push(`源ID(批)=${String(extraQuery.value.ids)}`)
  return parts.length ? parts.join(' & ') : '无额外源过滤'
})

async function load() {
  // snatchJobPaged 要求至少一个过滤条件；没有表达式时没必要发请求
  if (!schedule.value) {
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await snatchJobPaged({
      page: page.value,
      limit: size.value,
      schedule: schedule.value,
      sourceId: extraQuery.value.sourceId == null ? undefined : String(extraQuery.value.sourceId),
      ids: extraQuery.value.ids == null ? undefined : String(extraQuery.value.ids),
    })
    // 旧版把 isDelete===0 映射成开关的 enabled 字段
    rows.value = res.list.map((job) => ({ ...job, enabled: Number(job.isDelete ?? 0) === 0 }))
    total.value = res.total
    loadError.value = false
  } catch (error) {
    loadError.value = true
    rows.value = []
    total.value = 0
    ElNotification.error({
      title: '加载任务明细失败',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}

function show(targetSchedule: string, targetStats?: ScheduleSummaryRow | null, targetQuery?: Record<string, unknown>) {
  schedule.value = targetSchedule || ''
  stats.value = targetStats ?? null
  extraQuery.value = targetQuery ?? {}
  page.value = 1
  visible.value = true
  void load()
}

function handleRefresh() {
  void load()
}

/** 内部数据变更后：刷新本抽屉并通知父页同步汇总 */
function innerRefresh() {
  void load()
  emit('refresh')
}

function onPageChange(value: number) {
  page.value = value
  void load()
}

function onSizeChange(value: number) {
  size.value = value
  page.value = 1
  void load()
}

function nextRunText(value: string | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

/** 行内启停：乐观翻转，失败回滚（旧版同样是先翻再请求） */
async function onToggleEnabled(row: ScheduleJob, value: boolean) {
  const previous = !value
  row.enabled = value
  try {
    await changeJobState([row.jobId], value)
    ElMessage.success('更改状态成功')
    innerRefresh()
  } catch (error) {
    row.enabled = previous
    ElNotification.error({ title: '更改状态失败', message: error instanceof Error ? error.message : String(error) })
  }
}

/** 行内编辑：改单个任务的表达式（single 模式） */
function openEdit(row: ScheduleJob) {
  singleCronRef.value?.show({
    mode: 'single',
    id: row.jobId,
    cron: row.schedule,
    title: '修改任务表达式',
  })
}

async function onSubmitCron(param: Record<string, unknown>) {
  return updateJobCron(String(param.id ?? ''), String(param.cron ?? ''))
}

/** 立即运行 / 删除（旧版是 popconfirm 二次确认） */
async function onRun(row: ScheduleJob) {
  try {
    await ElMessageBox.confirm(`是否确定立即重跑当前定时任务 - ${row.jobName}`, '提示', {
      type: 'warning',
      confirmButtonText: '重跑',
      cancelButtonText: '不处理',
    })
  } catch {
    return
  }
  try {
    await runJob(row.jobId)
    ElMessage.success('已触发立即运行')
    void load()
  } catch (error) {
    ElNotification.error({
      title: '触发立即运行失败',
      message: `${error instanceof Error ? error.message : String(error)}，请稍后重试`,
    })
  }
}

async function onDelete(row: ScheduleJob) {
  try {
    await ElMessageBox.confirm(`是否确定删除定时任务 - ${row.jobName}`, '提示', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '放弃',
    })
  } catch {
    return
  }
  try {
    await deleteJob(row.jobId)
    ElMessage.success('删除成功')
    innerRefresh()
  } catch (error) {
    ElNotification.error({ title: '删除失败', message: error instanceof Error ? error.message : String(error) })
  }
}

/** 详情弹窗 */
const detailVisible = ref(false)
const detailRow = ref<ScheduleJob | null>(null)
const detailFields = computed(() => {
  const row = detailRow.value
  if (!row) return [] as { label: string; value: string }[]
  const labels: Record<string, string> = {
    jobId: '定时ID',
    jobName: '定时名',
    sourceId: '源ID',
    schedule: '定时策略',
    state: '状态',
    nextRun: '下次运行',
    lastRun: '上次运行',
    runCnt: '总运行次',
    successCnt: '成功次',
    isDelete: '启用(0=启用/1=停用)',
    flowId: '执行流程',
    configId: '使用配置',
  }
  return Object.keys(row)
    .filter((key) => key !== 'enabled')
    .map((key) => ({
      label: labels[key] ?? key,
      value: row[key] === undefined || row[key] === null || row[key] === '' ? '-' : String(row[key]),
    }))
})
function openDetail(row: ScheduleJob) {
  detailRow.value = row
  detailVisible.value = true
}

/** 统一修改表达式：先按抽屉当前过滤统计受影响任务数，再打开批量修改 */
async function openBatchEdit() {
  if (!schedule.value) {
    ElMessage.warning('未指定调度表达式，无法统一修改')
    return
  }
  const affectsAllSources = rangeIsEmpty(extraQuery.value)
  try {
    const { ids, truncated } = await snatchJobIdsByCond({ schedule: schedule.value, ...extraQuery.value })
    if (!visible.value) return
    if (!ids.length) {
      ElMessage.warning('当前过滤下没有使用该表达式的任务，无需修改')
      return
    }
    const capNote = truncated ? '（超过 20000 上限，仅对前 20000 个生效，需缩小筛选范围分批操作）' : ''
    const tip = affectsAllSources
      ? `当前抽屉未带源过滤，统一修改将对【全部源】中使用该表达式的 ${ids.length} 个任务生效${capNote}`
      : `将作用于抽屉当前过滤（${filterDesc.value}）范围内的 ${ids.length} 个任务${capNote}`
    cronEditRef.value?.show({
      mode: 'batch',
      oldCron: schedule.value,
      tip,
      jobCnt: ids.length,
      scopeEmpty: affectsAllSources,
    })
  } catch (error) {
    if (!visible.value) return
    // 统计失败降级：沿用汇总行数据，但保留「全部源」强确认
    ElNotification.error({
      title: '统计受影响任务失败',
      message: error instanceof Error ? error.message : String(error),
    })
    cronEditRef.value?.show({
      mode: 'batch',
      oldCron: schedule.value,
      tip: affectsAllSources
        ? '当前抽屉未带源过滤，统一修改将对全部源中使用该表达式的任务生效'
        : `修改范围为抽屉当前过滤（${filterDesc.value}）`,
      jobCnt: stats.value?.jobCnt ?? 0,
      scopeEmpty: affectsAllSources,
    })
  }
}

/** 批量统一修改的提交（与抽屉当前过滤同范围） */
async function onSubmitBatch(param: Record<string, unknown>) {
  return updateScheduleByCron(String(param.oldCron ?? ''), String(param.newCron ?? ''), extraQuery.value)
}

/** 批量改完：切到新表达式刷新，避免旧表达式下列表变空 */
function onCronRefresh(payload?: { schedule?: string }) {
  if (payload?.schedule && payload.schedule !== schedule.value) {
    schedule.value = payload.schedule
    stats.value = null
  }
  innerRefresh()
}

defineExpose({ show })
</script>

<template>
  <el-drawer v-model="visible" :title="drawerTitle" size="1120px" destroy-on-close>
    <div v-if="stats" class="sd-stats">
      <el-alert type="info" :closable="false" show-icon>
        <template #title>
          共 {{ stats.jobCnt }} 个任务：启用 {{ stats.enableCnt }} / 停用 {{ stats.disableCnt }} / 执行中
          {{ stats.runningCnt }}，最近一次下次执行 {{ nextRunText(stats.minNextRun) }}
        </template>
      </el-alert>
      <el-alert
        v-if="stats.runningCnt > 0"
        type="warning"
        :closable="false"
        show-icon
        class="sd-stats-gap"
        title="有任务正在执行中，统一修改时这些任务会被跳过"
      />
    </div>

    <div class="sd-ops">
      <el-button type="primary" :disabled="!schedule" @click="openBatchEdit">统一修改表达式</el-button>
      <el-button :icon="Refresh" @click="handleRefresh">刷新</el-button>
      <span v-if="!schedule" class="sd-warn">
        未指定调度表达式，请先从汇总表选择具体表达式（任务列表需要至少一个筛选条件）
      </span>
    </div>

    <el-alert
      v-if="loadError"
      type="error"
      :closable="false"
      show-icon
      class="sd-stats-gap"
      title="任务明细加载失败，请点击「刷新」重试"
    />

    <el-table
      v-loading="loading"
      :data="rows"
      border
      size="small"
      empty-text="没有匹配的任务"
      :row-key="(row: ScheduleJob) => row.jobId"
      class="sd-table"
    >
      <el-table-column label="启用" width="70" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="!!row.enabled"
            size="small"
            @update:model-value="(v: string | number | boolean) => onToggleEnabled(row, Boolean(v))"
          />
        </template>
      </el-table-column>
      <el-table-column prop="jobId" label="定时ID" width="90" />
      <el-table-column prop="jobName" label="定时名" min-width="200" show-overflow-tooltip />
      <el-table-column prop="sourceId" label="源ID" width="110" />
      <el-table-column prop="schedule" label="定时策略" width="150" show-overflow-tooltip />
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <span :class="row.state === 'L' ? 'sd-state-run' : 'sd-state-ok'">
            {{ row.state === 'L' ? '执行中' : '等待执行' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="下次运行" width="165">
        <template #default="{ row }">{{ nextRunText(row.nextRun) }}</template>
      </el-table-column>
      <el-table-column prop="runCnt" label="总运行次" width="90" align="right" />
      <el-table-column prop="successCnt" label="成功次" width="90" align="right" />
      <el-table-column label="上次运行" width="165">
        <template #default="{ row }">{{ nextRunText(row.lastRun) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" align="center" fixed="right">
        <template #default="{ row }">
          <div class="sd-actions">
            <a class="sd-link" @click="openEdit(row)">编辑</a>
            <el-divider direction="vertical" class="sd-divider" />
            <el-dropdown trigger="click">
              <a class="sd-link">
                更多<el-icon class="sd-drop-arrow"><ArrowDown /></el-icon>
              </a>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="openDetail(row)">详情</el-dropdown-item>
                  <el-dropdown-item @click="onRun(row)">立即运行</el-dropdown-item>
                  <el-dropdown-item @click="onDelete(row)">删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="sd-pager">
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

    <CronEditModal ref="cronEditRef" :callback="onSubmitBatch" @refresh="onCronRefresh" />

    <!-- 任务详情（只读，列全部字段） -->
    <el-dialog v-model="detailVisible" title="任务详情" width="720px" append-to-body>
      <el-descriptions border :column="2" size="small">
        <el-descriptions-item v-for="field in detailFields" :key="field.label" :label="field.label">
          {{ field.value }}
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 单条编辑用的表达式弹窗（与批量共用一个组件，mode 不同） -->
    <CronEditModal ref="singleCronRef" :callback="onSubmitCron" @refresh="innerRefresh" />
  </el-drawer>
</template>

<style scoped>
.sd-stats {
  margin-bottom: 10px;
}
.sd-stats-gap {
  margin-top: 8px;
}
.sd-stats :deep(.el-alert__title) {
  font-size: 12px;
}
.sd-ops {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.sd-warn {
  color: var(--rc-error, #dc2626);
  font-size: 12px;
}
.sd-table {
  width: 100%;
}
.sd-state-run {
  color: var(--rc-warn, #c2410c);
  font-size: 12px;
}
.sd-state-ok {
  color: var(--rc-ok, #15803d);
  font-size: 12px;
}
.sd-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.sd-link {
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.sd-link:hover {
  text-decoration: underline;
}
.sd-divider {
  height: 1em;
  margin: 0 4px;
}
.sd-drop-arrow {
  margin-left: 2px;
  vertical-align: -0.15em;
}
.sd-pager {
  display: flex;
  justify-content: flex-end;
  padding: 10px 0 2px;
}
</style>
