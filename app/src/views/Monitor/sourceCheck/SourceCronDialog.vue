<script setup lang="ts">
// 定时弹窗（1:1 迁移旧 data-view `src/page/config/modules/SourceCron.vue` 的 `ids === '-1'` 形态）。
//
// 旧版 `show(ids, cron, indexKey)` 有两套形态：`ids !== '-1'` 时是「给一批源配定时任务」
// （多出 源ID / 加监控 / 执行流程 三个字段 + 「提交并启用」按钮）；CheckAdd 走的是
// `show('-1', '')`——只有 定时表达式 + 常用定时 + 测试 + cron 编辑器 + 最近运行时间。
// 这里只迁后一套（本页用得到的），并把手写输入 + 编辑器双向联动按旧版 watch 口径还原：
//   常用定时 / 编辑器改动 → 输入框跟随 + 刷新「最近运行时间」
//   手改输入框 → 不联动（要按「测试」才生效），与旧版 v-decorator 单向绑定一致
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { checkCron } from '@/api/monitor'
import CronBuilder from './CronBuilder.vue'

const props = defineProps<{
  modelValue: boolean
  /** 打开时的初始表达式（不是 cron 形态时按空处理，交给编辑器自己补默认值） */
  cron?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'submit', cron: string): void
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

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return
    const initial = normalizeCron(props.cron)
    inputCron.value = initial
    builderCron.value = initial
    runs.value = []
    runsError.value = ''
    void loadRuns(initial)
  },
  { immediate: true },
)
</script>

<template>
  <el-dialog
    v-model="open"
    title="定时"
    width="920px"
    destroy-on-close
    :close-on-click-modal="false"
    class="scd-dialog"
  >
    <div class="scd-row">
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
      <el-button type="primary" @click="onSubmit">仅提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
.scd-cron {
  flex: 1;
  min-width: 0;
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
