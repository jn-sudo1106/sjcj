<script setup lang="ts">
// 按范围统一定时 —— 旧 `page/config/modules/CategoryScheduleModal.vue` 的 1:1 迁移。
//
// 用途：给「当前筛选范围内的信源」统一设置 cron / 启停，没有任务的按选项新建。
// 逐条对齐的旧行为：
//   · 表达式与「已有任务启停」至少填一项才能提交（都没有 → 提示，不提交）
//   · 「只启停」时强制 createIfMissing=false（没有 cron 无法新建任务）
//   · 无任何筛选范围 = 全部源 → 二次确认后带 confirmAll=true（后端也要求）
//   · 提交参数名是 newCron / jobStatus / jobEnable —— 不能叫 cron / enable，那是筛选字段
//   · 结果区展示：涉及信源 / 新增 / 更新 / 已有相同表达式 / 跳过 + 跳过的 jobId 清单
//   · 内置「表达式编辑器」按钮，打开 CronEditModal 的 pick 模式取表达式
//
// 有意偏差：结果标题用「设置成功」+ 计数，因为 client.ts 在 data 是对象时丢掉了后端 msg
// （旧版 `result.msg || '设置成功'` 基本也是落到兜底文案）。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { setScheduleByCategory, type SetScheduleResult } from '@/api/schedule'
import { CRON_PRESETS, localCronCheck } from './cron'
import { rangeIsEmpty } from './range'
import { previewCronTimes } from '@/api/schedule'
import CronEditModal from './CronEditModal.vue'
import FixedTimeAdjust from './FixedTimeAdjust.vue'

defineOptions({ name: 'ScheduleCategoryModal' })

const emit = defineEmits<{ (e: 'refresh'): void }>()

const visible = ref(false)
const fromSchedule = ref(false)
const cond = ref<Record<string, unknown>>({})
const setParam = ref({
  cron: '',
  /** keep=不改变 / enable(0) / disable(1) */
  jobStatus: 'keep' as 'keep' | 'enable' | 'disable',
  /** 仅对本次新建的 job 生效 */
  enable: 'keep' as 'keep' | 'enable' | 'disable',
  createIfMissing: true,
})
const cronRuns = ref<string[]>([])
const setting = ref(false)
const result = ref<SetScheduleResult | null>(null)
const cronEditRef = ref<InstanceType<typeof CronEditModal>>()

const categoryIds = computed(() => {
  const value = cond.value.categoryIds
  return value === undefined || value === null ? '' : String(value).trim()
})
const categoryIdList = computed(() => categoryIds.value.split(',').filter(Boolean))

const cronFilled = computed(() => !!setParam.value.cron && setParam.value.cron.trim() !== '')
const canSubmit = computed(() => cronFilled.value || setParam.value.jobStatus !== 'keep')
/** 表达式为空且没选已有任务启停 → 表达式必填 */
const scheduleRequired = computed(() => !cronFilled.value && setParam.value.jobStatus === 'keep')
const rangeEmpty = computed(() => rangeIsEmpty(cond.value))

/** 当前筛选条件的中文描述（不含 categoryIds） */
const filterDesc = computed(() => {
  const names: Record<string, string> = {
    name: '名称',
    entryTypeId: '主表',
    state: '状态',
    configId: '配置ID',
    sourceUrl: 'URL',
    flag: '标记',
    count: '数量',
    enable: '启禁用',
  }
  const source = cond.value
  const parts = Object.keys(source)
    .filter((key) => key !== 'categoryIds')
    .filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== '')
    .map((key) => `${names[key] || key}=${String(source[key])}`)
  return parts.length ? `按页面当前筛选条件（${parts.join('、')}）圈定范围` : ''
})

const scopeTip = computed(() => {
  if (rangeEmpty.value) {
    return '未传任何筛选范围：提交时需二次确认，确认后将对全部信息源生效（单次最多 20000 个，范围过大需缩小筛选范围分批操作）'
  }
  const base = fromSchedule.value
    ? '范围为当前筛选条件（来源列表 / 调度整体配置带入，与列表所见一致）'
    : '仅处理左侧目录树当前勾选的目录（多个目录为并集去重，不递归子目录）'
  const tail = '，已有任务更新 cron、无任务的按选项新建；执行中的任务将被跳过。'
  return filterDesc.value
    ? `${base}；${filterDesc.value}，与列表所见范围一致${tail}`
    : `${base}：范围内有效信源（启用、未删除）统一设置${tail}`
})

function show(targetCond?: Record<string, unknown>, opt: { fromSchedule?: boolean } = {}) {
  fromSchedule.value = !!opt.fromSchedule
  cond.value = targetCond ?? {}
  setParam.value = { cron: '', jobStatus: 'keep', enable: 'keep', createIfMissing: true }
  cronRuns.value = []
  result.value = null
  visible.value = true
}

function closeModal() {
  visible.value = false
  result.value = null
}

function onPreset(command: string) {
  const item = CRON_PRESETS[Number(command)]
  if (!item) return
  setParam.value.cron = item.cron
  cronRuns.value = []
}

async function testCron() {
  const value = setParam.value.cron
  if (!value || !value.trim()) return
  const errMsg = localCronCheck(value)
  if (errMsg) {
    ElMessage.warning(errMsg)
    cronRuns.value = []
    return
  }
  try {
    cronRuns.value = await previewCronTimes(value.trim())
  } catch (error) {
    cronRuns.value = []
    ElMessage.error(`表达式测试失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

function openCronPicker() {
  cronEditRef.value?.show({ mode: 'pick', cron: setParam.value.cron, title: '选取调度表达式' })
}

function onPickCron(cron: string) {
  setParam.value.cron = cron
  cronRuns.value = []
}

function onCronAdjusted(value: string) {
  setParam.value.cron = value
  cronRuns.value = []
}

/** 启停选项的中文描述（确认弹窗用） */
function enableLabel(): string {
  const parts: string[] = []
  const { jobStatus, enable } = setParam.value
  if (jobStatus === 'enable') parts.push('已有任务统一【启用】')
  if (jobStatus === 'disable') parts.push('已有任务统一【禁用】')
  if (jobStatus === 'keep') parts.push('已有任务启停状态不变')
  if (enable === 'enable') parts.push('新建任务将【启用】')
  if (enable === 'disable') parts.push('新建任务将【禁用】')
  if (enable === 'keep') parts.push('新建任务状态保持默认')
  return parts.join('；')
}

function actionDesc(): string {
  const cron = (setParam.value.cron || '').trim()
  if (!cron) return '仅启停：不修改 cron、不新建任务'
  return `设置 cron：${cron}，已有任务更新 cron、无任务的按选项新建`
}

function scopePhrase(): string {
  if (fromSchedule.value) {
    const desc = filterDesc.value || (categoryIds.value ? `目录:${categoryIds.value}` : '全部源需二次确认')
    return `当前筛选范围（${desc}）`
  }
  return `左侧目录树当前勾选的目录（ID: ${categoryIds.value}）下有效信源`
}

async function openConfirm() {
  if (!canSubmit.value) {
    ElMessage.warning('请填写调度表达式，或选择已有任务启停状态')
    return
  }
  const cron = (setParam.value.cron || '').trim()
  if (cron) {
    const errMsg = localCronCheck(cron)
    if (errMsg) {
      ElMessage.warning(errMsg)
      return
    }
  }
  if (rangeEmpty.value) {
    try {
      await ElMessageBox.confirm(
        `未传任何筛选范围，将对全部信息源生效（单次最多 20000 个，范围过大需缩小筛选范围分批操作）。${actionDesc()}。${enableLabel()}，确认？`,
        '确认对全部信息源生效',
        { type: 'warning', confirmButtonText: '确认全部设置', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
    void doUpdate()
    return
  }
  const scope = !fromSchedule.value && filterDesc.value ? `，${filterDesc.value}（与列表所见一致）` : ''
  try {
    await ElMessageBox.confirm(
      `将按${scopePhrase()}${actionDesc()}${scope}。${enableLabel()}，是否继续？`,
      '确认按范围更新定时配置',
      { type: 'warning', confirmButtonText: '确认更新', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  void doUpdate()
}

async function doUpdate() {
  const cron = (setParam.value.cron || '').trim()
  const param: Record<string, unknown> = {
    // 范围参数原样带上（与 sourcePaged 同一参数组）
    ...cond.value,
    createIfMissing: setParam.value.createIfMissing,
  }
  if (cron) param.newCron = cron
  // 只启停：不新建任务
  else param.createIfMissing = false
  if (setParam.value.jobStatus === 'enable') param.jobStatus = 0
  if (setParam.value.jobStatus === 'disable') param.jobStatus = 1
  if (setParam.value.enable === 'enable') param.jobEnable = true
  if (setParam.value.enable === 'disable') param.jobEnable = false
  if (rangeEmpty.value) param.confirmAll = true

  setting.value = true
  try {
    result.value = await setScheduleByCategory(param)
    emit('refresh')
  } catch (error) {
    // 批量接口可能部分成功：提示用户重试一次（幂等安全），不向外抛
    ElNotification.error({
      title: '按目录设置 cron 失败',
      message: `${error instanceof Error ? error.message : String(error)}，请检查表达式或缩小筛选范围后重试`,
    })
  } finally {
    setting.value = false
  }
}

defineExpose({ show })
</script>

<template>
  <el-dialog v-model="visible" title="按目录更新定时配置" width="680px" top="8vh" destroy-on-close append-to-body>
    <el-form label-width="110px" label-position="right" @submit.prevent>
      <el-form-item v-if="!fromSchedule || categoryIdList.length > 0" label="目标目录">
        <div v-if="categoryIdList.length" class="cs-tags">
          <el-tag v-for="cid in categoryIdList" :key="cid" type="primary" class="cs-tag">目录 ID: {{ cid }}</el-tag>
        </div>
        <span v-else class="cs-muted">未勾选目录</span>
        <div class="cs-tip">
          范围为左侧目录树当前勾选的目录（可多选，不递归子目录）；如需调整，请先关闭本窗口，在左侧目录树重新勾选后再打开。
        </div>
      </el-form-item>

      <el-form-item label="调度表达式" :required="scheduleRequired">
        <div class="cs-cron-row">
          <el-input
            v-model="setParam.cron"
            placeholder="6段spring格式，如 0 0/30 * * * ?；或 @秒数，如 @300；只启停时可留空"
          />
        </div>
        <div class="cs-cron-actions">
          <el-dropdown @command="onPreset">
            <el-button size="small" class="cs-ghost-btn">
              常用定时
              <el-icon class="cs-drop-arrow"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="(item, index) in CRON_PRESETS" :key="index" :command="String(index)">
                  {{ item.txt }}<span class="cs-preset-cron">（{{ item.cron }}）</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" class="cs-ghost-btn" @click="testCron">测试</el-button>
          <el-button size="small" class="cs-ghost-btn" @click="openCronPicker">表达式编辑器</el-button>
        </div>
        <div v-if="cronRuns.length" class="cs-runs">
          <el-tag v-for="(entry, index) in cronRuns" :key="index" type="warning" class="cs-run-tag">{{ entry }}</el-tag>
        </div>
        <FixedTimeAdjust :cron="setParam.cron" @change="onCronAdjusted" />
      </el-form-item>

      <el-form-item label="已有任务启停">
        <el-select v-model="setParam.jobStatus" class="cs-select">
          <el-option label="不改变" value="keep" />
          <el-option label="启用" value="enable" />
          <el-option label="禁用" value="disable" />
        </el-select>
        <span class="cs-tip-inline">对范围内已有 job 统一启停（jobStatus=0/1）；只启停不填表达式时不新建任务</span>
      </el-form-item>

      <el-form-item label="新建任务启用">
        <el-select v-model="setParam.enable" class="cs-select">
          <el-option label="不改变（新建按默认启用）" value="keep" />
          <el-option label="启用" value="enable" />
          <el-option label="禁用" value="disable" />
        </el-select>
        <span class="cs-tip-inline">仅对本次【新建】的 job 生效，已有 job 的启停状态保持不变</span>
      </el-form-item>

      <el-form-item label="无任务时新建">
        <el-switch v-model="setParam.createIfMissing" />
        <span class="cs-tip-inline">关闭后只更新已有 job 的信源</span>
      </el-form-item>
    </el-form>

    <el-alert type="info" :closable="false" show-icon class="cs-scope" :title="scopeTip" />

    <!-- 结果 -->
    <div v-if="result" class="cs-result">
      <el-alert type="success" :closable="false" show-icon title="设置成功" />
      <el-descriptions border :column="3" size="small" class="cs-desc">
        <el-descriptions-item label="涉及信源">{{ result.total ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="新增任务">{{ result.created ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="更新任务">{{ result.updated ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="已有相同表达式">{{ result.existed ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="跳过(执行中)">
          <el-tag v-if="Number(result.skipped ?? 0) > 0" type="warning" size="small">{{ result.skipped }}</el-tag>
          <span v-else>{{ result.skipped ?? 0 }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="跳过 jobId">
          {{ (result.skippedJobIds || []).join(', ') || '-' }}
        </el-descriptions-item>
      </el-descriptions>
      <el-alert
        v-if="Number(result.existed ?? 0) > 0"
        type="info"
        :closable="false"
        show-icon
        class="cs-result-gap"
        :title="`有 ${result.existed} 个信源已配置相同表达式，未改动`"
      />
      <el-alert
        v-if="Number(result.skipped ?? 0) > 0"
        type="warning"
        :closable="false"
        show-icon
        class="cs-result-gap"
        :title="`有 ${result.skipped} 个任务未修改（执行中或已是相同表达式，jobId: ${(result.skippedJobIds || []).join(', ')}），请稍后重试或人工处理`"
      />
    </div>

    <template #footer>
      <template v-if="result">
        <el-button type="primary" @click="closeModal">关闭</el-button>
      </template>
      <template v-else>
        <el-button @click="closeModal">取消</el-button>
        <el-button type="primary" :loading="setting" @click="openConfirm">更新定时配置</el-button>
      </template>
    </template>

    <CronEditModal ref="cronEditRef" @pick="onPickCron" />
  </el-dialog>
</template>

<style scoped>
.cs-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.cs-tag {
  margin: 0;
}
.cs-muted {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.cs-tip {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  line-height: 1.5;
}
.cs-cron-row {
  width: 100%;
}
.cs-cron-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.cs-ghost-btn {
  border-color: #00a0e9;
  color: #00a0e9;
}
.cs-drop-arrow {
  margin-left: 4px;
}
.cs-preset-cron {
  margin-left: 6px;
  color: var(--rc-muted, #64748b);
}
.cs-runs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}
.cs-run-tag {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.cs-select {
  width: 220px;
}
.cs-tip-inline {
  margin-left: 10px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.cs-scope {
  margin-top: 6px;
}
.cs-scope :deep(.el-alert__title) {
  font-size: 12px;
  line-height: 1.6;
}
.cs-result {
  margin-top: 12px;
}
.cs-desc {
  margin-top: 10px;
}
.cs-result-gap {
  margin-top: 8px;
}
</style>
