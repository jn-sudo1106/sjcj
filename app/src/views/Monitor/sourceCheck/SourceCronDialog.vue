<script setup lang="ts">
// 定时弹窗（1:1 迁移旧 data-view `src/page/config/modules/SourceCron.vue` 的 `ids === '-1'` 形态）。
//
// 旧版 `show(ids, cron, indexKey)` 有两套形态：`ids !== '-1'` 时是「给一批源配定时任务」
// （多出 源ID / 加监控 / 执行流程 三个字段 + 「提交并启用」按钮）；CheckAdd 走的是
// `show('-1', '')`——只有 定时表达式 + 常用定时 + 测试 + cron 编辑器 + 最近运行时间。
// 不传 `sourceIds` 是后一套（emit submit 交给调用方）；传了 `sourceIds` 是前一套——源列表
// 「批量配定时」（2026-10-23），弹窗自己调 `sourceApi.createJobs` 提交，成功 emit saved。
// 手写输入 + 编辑器双向联动按旧版 watch 口径还原：
//   常用定时 / 编辑器改动 → 输入框跟随 + 刷新「最近运行时间」
//   手改输入框 → 不联动（要按「测试」才生效），与旧版 v-decorator 单向绑定一致
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { checkCron } from '@/api/monitor'
import { sourceApi, type FlowRecord } from '@/api'
import CronBuilder from './CronBuilder.vue'

const props = defineProps<{
  modelValue: boolean
  /** 打开时的初始表达式（不是 cron 形态时按空处理，交给编辑器自己补默认值） */
  cron?: string
  /** 批量配定时的源（旧 `ids !== '-1'` 形态）；不传 = 只编辑表达式 */
  sourceIds?: string[]
  /** 执行流程候选（批量形态用） */
  flows?: FlowRecord[]
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'submit', cron: string): void
  (e: 'saved'): void
}>()

/** 旧 crons 数组按 key 取值的顺序（key 与旧版 a-menu-item 一致，只是顺序不同） */
const PRESETS = [
  { key: '7', label: '每10秒钟', cron: '0/10 * * * * ?' },
  { key: '0', label: '每30分钟', cron: '0 0/30 * * * ?' },
  { key: '1', label: '每1小时', cron: '0 0 0/1 * * ?' },
  { key: '2', label: '每2小时', cron: '0 0 0/2 * * ?' },
  { key: '3', label: '每天3点', cron: '0 0 3 * * ?' },
  { key: '4', label: '每天22点', cron: '0 0 22 * * ?' },
  { key: '5', label: '每月1日', cron: '0 0 0 1 * ?' },
  { key: '6', label: '每周一19点', cron: '0 0 19 ? * 1' },
]

const open = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

const batch = computed(() => props.sourceIds !== undefined)
const idsText = computed(() => (props.sourceIds ?? []).join(','))
const monitorEnable = ref(false)
const monitorAfter = ref(30)
/** 执行流程；空 = 使用来源默认流程（旧 flowId=0） */
const flowId = ref('')
const submitting = ref(false)

const inputCron = ref('')
const builderCron = ref('')
const runs = ref<string[]>([])
const runsError = ref('')
const loadingRuns = ref(false)
/** 已经拉过预览的表达式，避免「打开回填」和「编辑器首次 emit」各发一次同样的请求 */
let runsLoadedFor = ''

/** 只有 5~7 段空白分隔的表达式才当 cron；`AFTER:30` 之类直接丢弃（旧版这里传空串） */
function normalizeCron(value?: string): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const parts = text.split(/\s+/)
  return parts.length >= 5 && parts.length <= 7 ? text : ''
}

async function loadRuns(cron: string, force = false) {
  if (!cron) {
    runs.value = []
    runsError.value = ''
    runsLoadedFor = ''
    return
  }
  if (!force && cron === runsLoadedFor) return
  loadingRuns.value = true
  runsError.value = ''
  try {
    runs.value = (await checkCron(cron)) ?? []
    runsLoadedFor = cron
  } catch (error) {
    runs.value = []
    runsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingRuns.value = false
  }
}

/** 编辑器 / 常用定时改表达式：输入框跟随 + 刷新预览（旧版 watch cronValue 的净效果） */
function applyCron(cron: string, force = false) {
  builderCron.value = cron
  inputCron.value = cron
  void loadRuns(cron, force)
}

function onPreset(key: string | number | object) {
  const hit = PRESETS.find((p) => p.key === String(key))
  if (hit) applyCron(hit.cron)
}

/** 「测试」：把输入框的值推给编辑器，再强制刷新预览（输入为空时不联动，旧版 getLastRun 直接 return） */
function onTest() {
  const value = inputCron.value.trim()
  if (!value) return
  applyCron(value, true)
}

function onSubmit() {
  const value = inputCron.value.trim()
  if (!value) {
    ElMessage.error('请配置 cron 表达式')
    return
  }
  emit('submit', value)
  open.value = false
}

/** 批量形态：「提交并启用」enable=true /「仅提交」enable=false（旧 handleOk(enable)） */
async function onBatchSubmit(enable: boolean) {
  const cron = inputCron.value.trim()
  if (!idsText.value || !cron) {
    ElMessage.error('请输入!')
    return
  }
  submitting.value = true
  try {
    const ack = await sourceApi.createJobs({
      sourceIds: props.sourceIds ?? [],
      cron,
      enable,
      monitorEnable: monitorEnable.value,
      monitorAfter: monitorAfter.value,
      flowId: flowId.value,
    })
    if (!ack.ok) throw new Error(ack.message || '')
    // 旧文案是 `'提交定时任务成功，' + enable ? '已启用' : '[未启用]'`，优先级 bug 让它永远是「已启用」，按原意修正
    ElMessage.success('提交定时任务成功，' + (enable ? '已启用' : '[未启用]'))
    open.value = false
    emit('saved')
  } catch (error) {
    // 旧版只提示「提交定时任务失败」；后端会说明哪些源没关联所选流程，带上原因
    const cause = (error as { cause?: unknown })?.cause
    const reason = cause instanceof Error ? cause.message : error instanceof Error ? error.message : ''
    ElMessage.error(reason ? `提交定时任务失败：${reason}` : '提交定时任务失败')
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    const initial = normalizeCron(props.cron)
    inputCron.value = initial
    builderCron.value = initial
    runs.value = []
    runsError.value = ''
    monitorEnable.value = false
    monitorAfter.value = 30
    flowId.value = ''
    void loadRuns(initial)
  },
  { immediate: true },
)
</script>

<template>
  <el-dialog
    v-model="open"
    :title="batch ? '批量配定时' : '定时'"
    width="920px"
    destroy-on-close
    :close-on-click-modal="false"
    class="scd-dialog"
  >
    <div v-if="batch" class="scd-row">
      <span class="scd-label">源ID</span>
      <el-input :model-value="idsText" readonly class="scd-ids" placeholder="请输入源" data-testid="scd-ids" />
    </div>
    <div class="scd-row" :class="{ 'scd-row-gap': batch }">
      <span class="scd-label">定时</span>
      <el-input v-model="inputCron" class="scd-cron" placeholder="请配置cron表达式" @keyup.enter="onTest" />
      <el-dropdown trigger="click" @command="onPreset">
        <el-button class="scd-preset-btn">
          常用定时
          <el-icon class="scd-caret"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="p in PRESETS" :key="p.key" :command="p.key">{{ p.label }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <el-button class="scd-preset-btn" @click="onTest">测试</el-button>
    </div>
    <template v-if="batch">
      <div class="scd-row scd-row-gap">
        <span class="scd-label">监控</span>
        <el-switch v-model="monitorEnable" data-testid="scd-monitor" />
        <span class="scd-text">加监控</span>
        <el-input-number v-model="monitorAfter" :min="1" :step="5" controls-position="right" class="scd-after" data-testid="scd-monitor-after" />
        <span class="scd-text">分钟后</span>
      </div>
      <div class="scd-row scd-row-gap">
        <span class="scd-label">流程</span>
        <el-select v-model="flowId" clearable filterable placeholder="使用来源默认流程" class="scd-flow" data-testid="scd-flow">
          <el-option v-for="f in flows ?? []" :key="f.id" :label="`${f.name} · ${f.id}`" :value="f.id" />
        </el-select>
        <span class="scd-hint">留空使用来源默认流程；所选流程须与每个来源关联。</span>
      </div>
    </template>

    <div class="scd-body">
      <div class="scd-builder">
        <CronBuilder :model-value="builderCron" @update:model-value="applyCron" />
      </div>
      <div v-loading="loadingRuns" class="scd-runs">
        <div class="scd-runs-title">最近运行时间</div>
        <div class="scd-runs-list">
          <el-tag v-for="(item, index) in runs" :key="index" type="warning" class="scd-run">{{ item }}</el-tag>
          <span v-if="!runs.length && !runsError" class="scd-empty">暂无预览</span>
          <span v-if="runsError" class="scd-error">{{ runsError }}</span>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <template v-if="batch">
        <el-button :loading="submitting" data-testid="scd-submit" @click="onBatchSubmit(false)">仅提交</el-button>
        <el-button type="primary" :loading="submitting" data-testid="scd-submit-enable" @click="onBatchSubmit(true)">提交并启用</el-button>
      </template>
      <el-button v-else type="primary" @click="onSubmit">仅提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏：宽度按视口留边，正文超高时只在弹窗正文里滚 */
:global(.scd-dialog) {
  max-width: calc(100vw - 32px);
  margin-top: 6vh;
}
:global(.scd-dialog .el-dialog__body) {
  max-height: calc(88vh - 120px);
  overflow: auto;
}
.scd-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.scd-label {
  flex: none;
  width: 42px;
  color: var(--rc-text-2, #334155);
  font-size: 14px;
  text-align: right;
}
.scd-cron,
.scd-ids {
  flex: 1;
  min-width: 0;
}
.scd-row-gap {
  margin-top: 12px;
}
.scd-text,
.scd-hint {
  flex: none;
  color: var(--rc-text-2, #334155);
  font-size: 13px;
}
.scd-hint {
  flex: 1;
  min-width: 0;
  color: var(--rc-faint, #94a3b8);
  font-size: 12px;
}
.scd-after {
  width: 120px;
}
.scd-flow {
  width: 360px;
  flex: none;
}
/* 旧版这两个按钮是描边蓝（#00A0E9），这里沿项目主色 */
.scd-preset-btn {
  flex: none;
}
.scd-caret {
  margin-left: 2px;
}
.scd-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 262px;
  margin-top: 16px;
  border: 1px solid var(--rc-border, #d5e2f2);
  border-radius: 6px;
  overflow: hidden;
}
.scd-builder {
  min-width: 0;
  padding: 12px 14px;
  border-right: 1px solid var(--rc-border, #d5e2f2);
}
.scd-runs {
  display: flex;
  flex-direction: column;
  min-height: 120px;
  padding: 12px 14px;
  background: var(--rc-bg-soft, #f8fafc);
}
.scd-runs-title {
  margin-bottom: 10px;
  color: var(--rc-text, #1e293b);
  font-size: 14px;
  font-weight: 600;
}
.scd-runs-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-height: 300px;
  overflow: auto;
}
.scd-run {
  max-width: 100%;
}
.scd-empty,
.scd-error {
  color: var(--rc-faint, #94a3b8);
  font-size: 12px;
}
.scd-error {
  color: var(--rc-error, #dc2626);
}
</style>
