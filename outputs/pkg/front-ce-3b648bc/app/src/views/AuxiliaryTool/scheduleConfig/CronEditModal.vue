<script setup lang="ts">
// 修改调度表达式弹窗 —— 旧 `page/config/modules/CronEditModal.vue` 的 1:1 迁移。
//
// 三种模式（mode）：
//   batch  —— 把「范围内所有用 oldCron 的任务」统一改成新表达式（提交前二次确认；无筛选范围时强确认）
//   single —— 改单个 jobId 的表达式
//   pick   —— 只选一个表达式回传给父级（发 `pick` 事件），不提交
//
// 逐条对齐的旧行为：
//   · 批量模式预填原表达式（用户只改需要改的段）
//   · 提交前用 checkLocal 做轻量校验（@秒数 或 6~7 段），完整合法性交给后端
//   · 「测试」调 source/lastRun 拿最近几次运行时间
//   · 批量失败**不关弹窗**，结果区显示错误 + 「重试」按钮（修改接口幂等，重复提交安全）
//   · 批量成功把新表达式通过 refresh 事件抛给父级（抽屉据此切到新表达式，避免列表变空）
//   · Cron 编辑器挂载瞬间会回填一次默认表达式，用 editorReady 吞掉第一次回调
//
// 有意偏差：结果提示里没有后端那句 `msg`（client.ts 在 data 是对象时只回 data），
// 所以文案由 affected / skipped 自己拼；后端 msg 里的特殊说明就看不到了。
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { ArrowDown, RefreshLeft } from '@element-plus/icons-vue'
import { previewCronTimes } from '@/api/schedule'
import { CRON_PRESETS } from './cron'
import CronEditor from './CronEditor.vue'
import FixedTimeAdjust from './FixedTimeAdjust.vue'

defineOptions({ name: 'ScheduleCronEditModal' })

type Mode = 'batch' | 'single' | 'pick'

const props = defineProps<{
  /** 提交回调：batch 传 {oldCron,newCron}，single 传 {id,cron}；pick 模式不调用 */
  callback?: (param: Record<string, unknown>) => Promise<unknown>
}>()

const emit = defineEmits<{
  (e: 'refresh', payload?: { schedule?: string }): void
  (e: 'pick', cron: string): void
}>()

const visible = ref(false)
const confirmLoading = ref(false)
const mode = ref<Mode>('batch')
const oldCron = ref('')
const jobId = ref<string | undefined>(undefined)
const tip = ref<string | undefined>(undefined)
const title = ref('修改调度表达式')
const newCron = ref('')
const runs = ref<string[]>([])
/** 批量结果（成功是计数对象，失败带 _error） */
const result = ref<Record<string, unknown> | null>(null)
const cronStatus = ref<'' | 'error'>('')
const cronHelp = ref('')
const jobCnt = ref(0)
const scopeEmpty = ref(false)
const lastParam = ref<Record<string, unknown> | null>(null)
const editorReady = ref(false)

/** 当前表达式按空格拆的段数（0 = 空 / @秒数） */
const partCount = computed(() => {
  const text = String(newCron.value ?? '').trim()
  if (/^@\d+$/.test(text)) return 0
  return text.split(/\s+/).filter(Boolean).length
})

/** 可视化编辑器：pick 模式才有；@秒数 与 7 段（含年）不渲染 */
const showCronEditor = computed(
  () => mode.value === 'pick' && !/^@\d+$/.test(newCron.value || '') && partCount.value < 7,
)

const visualEditBlocked = computed(
  () => mode.value === 'pick' && (/^@\d+$/.test(newCron.value || '') || partCount.value === 7),
)

/** 编辑器因模式/格式变化重建时，重新吞一次挂载回填 */
watch(showCronEditor, (next) => {
  if (next) editorReady.value = false
})

const footerOkText = computed(() => (mode.value === 'pick' ? '使用该表达式' : '提交'))

const resultMsg = computed(() => {
  const data = result.value
  if (!data) return ''
  if (data._error) return ''
  if (typeof data._msg === 'string' && data._msg) return data._msg
  const affected = Number(data.affected ?? 0)
  const skipped = Number(data.skipped ?? 0)
  return mode.value === 'batch'
    ? `已统一修改 ${affected} 个任务${skipped > 0 ? `（跳过 ${skipped} 个：执行中或已是新表达式）` : ''}`
    : '修改成功'
})

/** 打开弹窗 */
function show(opt: {
  mode?: Mode
  oldCron?: string
  id?: string
  tip?: string
  title?: string
  cron?: string
  jobCnt?: number
  scopeEmpty?: boolean
} = {}) {
  mode.value = opt.mode ?? 'batch'
  oldCron.value = opt.oldCron ?? ''
  jobId.value = opt.id
  tip.value = opt.tip
  jobCnt.value = opt.jobCnt ?? 0
  scopeEmpty.value = !!opt.scopeEmpty
  lastParam.value = null
  title.value =
    opt.title ||
    (mode.value === 'batch' ? '统一修改表达式' : mode.value === 'single' ? '修改任务表达式' : '选取调度表达式')
  // 批量预填原表达式，改动一眼可见
  newCron.value = opt.cron ?? (mode.value === 'batch' ? oldCron.value : '')
  runs.value = []
  result.value = null
  cronStatus.value = ''
  cronHelp.value = ''
  editorReady.value = false
  visible.value = true
}

/** 编辑器回调：吞掉挂载回填；@秒数 两边都不接收（编辑器表达不了） */
function onEditorChange(value: string) {
  if (!editorReady.value) {
    editorReady.value = true
    return
  }
  if (value === newCron.value) return
  if (/^@\d+/.test(newCron.value || '') || /^@\d+/.test(value)) return
  newCron.value = value
  runs.value = []
}

function onPreset(command: string) {
  const item = CRON_PRESETS[Number(command)]
  if (!item) return
  newCron.value = item.cron
  runs.value = []
}

function onCronAdjusted(value: string) {
  newCron.value = value
  runs.value = []
}

/** 轻量前端校验：@秒数 或 6~7 段（完整合法性由后端兜底） */
function checkLocal(): boolean {
  const text = String(newCron.value ?? '').trim()
  if (!text) {
    cronStatus.value = 'error'
    cronHelp.value = '请输入调度表达式'
    return false
  }
  if (/^@\d+$/.test(text)) {
    cronStatus.value = ''
    cronHelp.value = ''
    return true
  }
  const fields = text.split(/\s+/)
  if (fields.length < 6 || fields.length > 7) {
    cronStatus.value = 'error'
    cronHelp.value = '格式应为 6 段 spring cron（秒 分 时 日 月 周），可含第 7 段年；或使用 @秒数 间隔格式'
    return false
  }
  cronStatus.value = ''
  cronHelp.value = ''
  return true
}

async function test() {
  checkLocal()
  if (cronStatus.value === 'error') return
  const text = newCron.value.trim()
  if (!text) return
  try {
    runs.value = await previewCronTimes(text)
  } catch (error) {
    runs.value = []
    ElMessage.error(`表达式测试失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleOk() {
  if (!checkLocal()) return
  const cron = newCron.value.trim()
  if (mode.value === 'pick') {
    emit('pick', cron)
    visible.value = false
    return
  }
  const param: Record<string, unknown> =
    mode.value === 'batch' ? { oldCron: oldCron.value, newCron: cron } : { id: jobId.value, cron }
  if (mode.value === 'batch' && param.oldCron === cron) {
    ElMessage.warning('新表达式与原表达式相同，无需修改')
    return
  }
  if (mode.value === 'batch') {
    if (scopeEmpty.value) {
      try {
        await ElMessageBox.confirm(
          `未传任何筛选范围，本次操作将对全部信息源的任务生效！\n将把使用「${oldCron.value}」的全部任务统一修改为「${cron}」。范围过大需缩小筛选范围分批操作。\n执行中或已是相同表达式的任务会被跳过（幂等，可安全重试）`,
          '警告：将对全部信息源生效',
          { type: 'warning', confirmButtonText: '确认全部修改', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
        )
      } catch {
        return
      }
      void doSubmit(param)
      return
    }
    if (jobCnt.value > 0) {
      try {
        await ElMessageBox.confirm(
          `将对使用该表达式的 ${jobCnt.value} 个任务统一修改为「${cron}」，执行中或已是相同表达式的任务会被跳过，是否继续？`,
          '确认统一修改表达式',
          { type: 'warning', confirmButtonText: '确认修改', cancelButtonText: '取消' },
        )
      } catch {
        return
      }
      void doSubmit(param)
      return
    }
  }
  void doSubmit(param)
}

async function doSubmit(param: Record<string, unknown>) {
  const run = props.callback
  if (!run) {
    ElNotification.error({ title: '未配置提交回调' })
    return
  }
  confirmLoading.value = true
  lastParam.value = param
  try {
    const res = await run(param)
    if (mode.value === 'batch') {
      const data = res && typeof res === 'object' && !Array.isArray(res) ? (res as Record<string, unknown>) : {}
      result.value = { ...data }
      emit('refresh', { schedule: param.newCron as string })
    } else {
      ElNotification.success({ title: '修改成功' })
      visible.value = false
      emit('refresh')
    }
  } catch (error) {
    if (mode.value === 'batch') {
      // 失败不关弹窗：可调整后重提，或直接点「重试」
      result.value = { _error: error instanceof Error ? error.message : String(error), skipped: 0 }
    } else {
      ElNotification.error({ title: '修改失败', message: error instanceof Error ? error.message : String(error) })
    }
  } finally {
    confirmLoading.value = false
  }
}

/** 结果区「重试」：原参数重发（修改类接口幂等） */
function retrySubmit() {
  if (!lastParam.value) return
  void doSubmit(lastParam.value)
}

function closeModal() {
  visible.value = false
  result.value = null
}

defineExpose({ show })
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="1000px" top="6vh" destroy-on-close append-to-body>
    <el-form label-width="84px" label-position="right" @submit.prevent>
      <el-form-item v-if="mode === 'batch'" label="原表达式">
        <el-alert type="info" :closable="false" show-icon>
          <template #title>
            <code class="ce-code">{{ oldCron }}</code>
            <span v-if="tip" class="ce-tip-text"> - {{ tip }}</span>
          </template>
        </el-alert>
      </el-form-item>

      <el-form-item v-if="mode === 'single'" label="任务ID">
        <el-input :model-value="String(jobId ?? '')" readonly class="ce-id" />
      </el-form-item>

      <el-form-item label="新表达式" :error="cronStatus === 'error' ? cronHelp : ''">
        <div class="ce-cron-row">
          <el-input
            v-model="newCron"
            placeholder="6段spring格式，如 0 0/30 * * * ?；或 @秒数，如 @300"
            class="ce-cron-input"
            @blur="checkLocal"
          />
          <el-dropdown @command="onPreset">
            <el-button class="ce-ghost-btn">
              常用定时
              <el-icon class="ce-drop-arrow"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="(item, index) in CRON_PRESETS" :key="index" :command="String(index)">
                  {{ item.txt }}<span class="ce-preset-cron">（{{ item.cron }}）</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button class="ce-ghost-btn" @click="test">测试</el-button>
        </div>
        <FixedTimeAdjust :cron="newCron" @change="onCronAdjusted" />
      </el-form-item>
    </el-form>

    <!-- 可视化编辑器 + 最近运行时间 -->
    <div v-if="showCronEditor" class="ce-editor-wrap">
      <CronEditor class="ce-editor" :cron-value="newCron" @change="onEditorChange" />
      <div class="ce-runs">
        <div class="ce-runs-title">最近运行时间</div>
        <div class="ce-runs-body">
          <el-tag v-for="(entry, index) in runs" :key="index" type="warning" class="ce-run-tag">{{ entry }}</el-tag>
          <span v-if="!runs.length" class="ce-empty">点击「测试」查看</span>
        </div>
      </div>
    </div>
    <div v-else class="ce-runs ce-runs-solo">
      <div class="ce-runs-title">最近运行时间</div>
      <div class="ce-runs-body">
        <el-tag v-for="(entry, index) in runs" :key="index" type="warning" class="ce-run-tag">{{ entry }}</el-tag>
        <span v-if="!runs.length" class="ce-empty">点击「测试」查看</span>
      </div>
    </div>

    <el-alert
      v-if="visualEditBlocked"
      type="warning"
      :closable="false"
      show-icon
      class="ce-blocked"
      title="@秒数 格式或含年段的 7 段表达式不支持可视化编辑（编辑器会丢失年段），请直接在输入框中修改表达式"
    />

    <!-- 批量结果 -->
    <div v-if="result" class="ce-result">
      <el-alert v-if="resultMsg" type="success" :closable="false" show-icon :title="resultMsg" />
      <el-alert
        v-if="Number(result.skipped ?? 0) > 0"
        type="warning"
        :closable="false"
        show-icon
        class="ce-result-gap"
        :title="`有 ${result.skipped} 个任务未修改（执行中或已是新表达式，jobId: ${((result.skippedIds as string[]) || []).join(', ')}），请稍后重试或人工处理`"
      />
      <el-alert v-if="result._error" type="error" :closable="false" show-icon class="ce-result-gap" :title="String(result._error)" />
      <div v-if="Number(result.skipped ?? 0) > 0 || result._error" class="ce-retry">
        <el-button type="primary" plain :icon="RefreshLeft" :loading="confirmLoading" @click="retrySubmit">重试</el-button>
        <span class="ce-retry-tip">
          修改类接口幂等，重试不会重复改动已完成的任务；仍失败可检查表达式或缩小筛选范围
        </span>
      </div>
    </div>

    <template #footer>
      <template v-if="result">
        <el-button type="primary" @click="closeModal">关闭</el-button>
      </template>
      <template v-else>
        <el-button @click="closeModal">取消</el-button>
        <el-button type="primary" :loading="confirmLoading" @click="handleOk">{{ footerOkText }}</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.ce-code {
  padding: 2px 6px;
  background: var(--rc-border-soft, #f1f5f9);
  border-radius: 4px;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
}
.ce-tip-text {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.ce-id {
  width: 200px;
}
.ce-cron-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.ce-cron-input {
  flex: 1;
  min-width: 0;
}
.ce-ghost-btn {
  border-color: #00a0e9;
  color: #00a0e9;
}
.ce-drop-arrow {
  margin-left: 4px;
}
.ce-preset-cron {
  margin-left: 6px;
  color: var(--rc-muted, #64748b);
}
.ce-editor-wrap {
  display: grid;
  grid-template-columns: minmax(0, 17fr) minmax(0, 7fr);
  gap: 0;
  margin-top: 4px;
}
.ce-editor {
  border-right: 0;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}
.ce-runs {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  overflow: hidden;
}
.ce-runs-solo {
  margin-top: 8px;
}
.ce-runs-title {
  padding: 6px 10px;
  border-bottom: 1px solid var(--rc-border-soft, #f1f5f9);
  font-size: 12px;
  font-weight: 600;
  color: var(--rc-text, #0f172a);
}
.ce-runs-body {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 10px;
  max-height: 220px;
  overflow: auto;
}
.ce-run-tag {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.ce-empty {
  color: var(--rc-faint, #94a3b8);
  font-size: 12px;
}
.ce-blocked {
  margin-top: 8px;
}
.ce-result {
  margin-top: 12px;
}
.ce-result-gap {
  margin-top: 8px;
}
.ce-retry {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.ce-retry-tip {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
</style>
