<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { normalizeLoadParams } from './paramNormalize'

interface ParamRow {
  paramId: string
  paramName: string
  curValue?: string
  allValues?: string[]
  // ---- 以下为弹窗内部 UI 态，不进请求 ----
  check?: boolean
  curValues?: string[]
  showValues?: string[]
}

const props = defineProps<{
  /** 组装好参数后带参发送；返回结果用于成功提示 */
  callback: (
    ids: string[],
    param: Record<string, string>,
    all: number,
    include: string[],
    skip: number,
    queue: string,
  ) => Promise<{ message?: string; msg?: string }>
}>()

const emit = defineEmits<{ refresh: [] }>()

const visible = ref(false)
const loading = ref(false)
const all = ref(false)
const skip = ref<number>(0)
const queue = ref('')
const configKeys = ref<string[]>([])
const params = reactive<Record<string, ParamRow[]>>({})
const sources = ref<{ sourceId: string; name?: string }[]>([])

// 发送范围（旧平台契约：skip 取值 0=默认 / 1=不登陆 / 2=强制登陆），文案保持 1:1。
const loginOpts = [
  { value: 0, label: '[0]默认' },
  { value: 1, label: '[1]不登陆' },
  { value: 2, label: '[2]强制登陆' },
]

const totalParamCount = computed(() =>
  configKeys.value.reduce((n, k) => n + (params[k]?.length || 0), 0),
)
const subTitle = computed(() => {
  const names = sources.value.map((s) => s.name || s.sourceId)
  const src = names.length ? names.join('、') + ' · ' : ''
  return src + sources.value.length + ' 个源 · 共 ' + totalParamCount.value + ' 个参数' + (queue.value ? ' · 队列 ' + queue.value : '')
})

// 字段名兼容：后端可能用 id/name/value/values 等命名。
function toParamRow(e: Record<string, unknown>): ParamRow {
  const paramId = String(e.paramId ?? e.id ?? e.key ?? '')
  const paramName = String(e.paramName ?? e.name ?? e.label ?? paramId)
  const curValue = e.curValue ?? e.value ?? e.defaultValue ?? ''
  const allValues = (e.allValues ?? e.values ?? e.options ?? []) as unknown[]
  return {
    paramId,
    paramName,
    curValue: curValue == null ? '' : String(curValue),
    allValues: allValues.map(String),
    check: true,
    curValues:
      curValue === '' || curValue == null
        ? []
        : Array.isArray(curValue)
          ? (curValue as unknown[]).map(String)
          : [String(curValue)],
    showValues: allValues.slice(0, 100).map(String),
  }
}

// 对齐旧平台 SourceParam.showParam：curValue 归一为数组，showValues 截断前 100。
function showParam(
  data: unknown,
  srcs: { sourceId: string; name?: string }[],
  _hasLogin: boolean,
  q?: string,
) {
  queue.value = q || ''
  all.value = false
  skip.value = 0
  sources.value = srcs
  const normalized = normalizeLoadParams(data)
  const next: Record<string, ParamRow[]> = {}
  for (const cfg in normalized) {
    next[cfg] = normalized[cfg].map(toParamRow)
  }
  Object.keys(params).forEach((k) => delete params[k])
  Object.assign(params, next)
  configKeys.value = Object.keys(next)
  visible.value = true
}

function onSubmit() {
  const out: Record<string, string> = {}
  const include: string[] = []
  const ids = sources.value.map((s) => s.sourceId)
  let hasError = false
  for (const cfg of configKeys.value) {
    for (const p of params[cfg]) {
      if (!all.value && !p.check) continue
      include.push(cfg + '_' + p.paramId)
      const vs = p.curValues || []
      if (!vs.length) {
        hasError = true
        break
      }
      out[cfg + '_' + p.paramId] = vs.join(';')
    }
    if (hasError) break
  }
  if (hasError) {
    ElMessage.error('有无值的参数或参数值未选入，请检查或重新提交')
    return
  }
  loading.value = true
  props
    .callback(ids, out, all.value ? 1 : 0, include, skip.value, queue.value)
    .then((res) => {
      ElNotification.success({
        message:
          '发送成功, 本次发送' + ids.length +
          (queue.value ? ', 队列:-' + queue.value : '') +
          ', 返回值:-' + (res?.message || (res as { msg?: string }).msg || ''),
      })
      visible.value = false
      emit('refresh')
    })
    .catch(() => {
      ElNotification.error({ message: '发送失败' })
    })
    .finally(() => {
      loading.value = false
    })
}

function onCancel() {
  visible.value = false
}

defineExpose({ showParam })
</script>

<template>
  <el-dialog
    v-model="visible"
    class="spm-dialog"
    width="720px"
    :close-on-click-modal="false"
    append-to-body
    @close="onCancel"
  >
    <template #header>
      <div class="spm-head">
        <div class="spm-title">发起抓取 · 参数</div>
        <div class="spm-sub" :title="subTitle">{{ subTitle }}</div>
      </div>
    </template>

    <div class="spm-body">
      <div class="spm-toolbar">
        <label class="spm-all">
          <input v-model="all" type="checkbox" class="spm-checkbox" />
          <span>所有参数</span>
        </label>
        <span v-if="queue" class="spm-queue">
          <span class="spm-queue-label">测试队列</span>
          <span class="spm-queue-tag">{{ queue }}</span>
        </span>
        <span class="spm-login">
          <span class="spm-login-label">登陆</span>
          <div class="spm-seg">
            <button
              v-for="opt in loginOpts"
              :key="opt.value"
              type="button"
              :class="{ active: skip === opt.value }"
              @click="skip = opt.value"
            >{{ opt.label }}</button>
          </div>
        </span>
      </div>

      <div v-for="cfg in configKeys" :key="cfg" class="spm-config">
        <div class="spm-config-head">
          <span class="spm-config-id">{{ cfg }}</span>
          <span class="spm-config-count">{{ params[cfg].length }} 个参数</span>
        </div>
        <div
          v-for="(p, idx) in params[cfg]"
          :key="idx"
          class="spm-param"
          :class="{ off: !p.check }"
        >
          <el-switch v-model="p.check" size="small" />
          <span class="spm-param-name" :title="p.paramName">{{ p.paramName }}</span>
          <el-select
            v-model="p.curValues"
            multiple
            filterable
            allow-create
            default-first-option
            :disabled="all"
            placeholder="请选择或输入参数值"
            class="spm-select"
          >
            <el-option v-for="entry in p.showValues" :key="entry" :label="entry" :value="entry" />
          </el-select>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="spm-footer">
        <button class="rc-btn" type="button" @click="onCancel">取消</button>
        <button class="rc-btn primary" type="button" :disabled="loading" data-testid="spm-submit" @click="onSubmit">
          {{ loading ? '发送中…' : '发起抓取' }}
        </button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.spm-dialog :deep(.el-dialog) {
  --el-dialog-border-radius: 12px;
  border: 1px solid #dbe5f1;
  border-radius: 12px;
  max-width: calc(100vw - 32px);
  overflow: hidden;
  box-shadow: 0 24px 64px -22px rgba(15, 23, 42, 0.45);
}
.spm-dialog :deep(.el-dialog__header) {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--rc-border-soft);
  background: #fff;
  margin-right: 0;
}
.spm-dialog :deep(.el-dialog__body) {
  padding: 14px 20px 4px;
  max-height: calc(100vh - 230px);
  overflow-y: auto;
  background: #fbfdff;
}
.spm-dialog :deep(.el-dialog__footer) {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--rc-border-soft);
  background: #fff;
}
.spm-dialog :deep(.el-dialog__headerbtn) { top: 14px; }

/* ---- 头部 ---- */
.spm-head { display: flex; flex-direction: column; gap: 2px; }
.spm-title {
  color: var(--rc-text);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.2px;
  line-height: 1.3;
}
.spm-sub {
  color: var(--rc-muted);
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 560px;
}

.spm-body { min-width: 0; }

/* ---- 工具条 ---- */
.spm-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 9px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--rc-border);
  border-radius: 10px;
  background: #fff;
}
.spm-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--rc-text-2);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.spm-checkbox { width: 14px; height: 14px; margin: 0; accent-color: var(--rc-primary); cursor: pointer; }
.spm-queue { display: inline-flex; align-items: center; gap: 6px; }
.spm-queue-label { color: var(--rc-muted); font-size: 12px; }
.spm-queue-tag {
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--rc-warn-bg);
  color: var(--rc-warn);
  font-size: 12px;
  font-weight: 700;
}
.spm-login { display: inline-flex; align-items: center; gap: 8px; }
.spm-login-label { color: var(--rc-muted); font-size: 12px; }
.spm-seg {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.spm-seg button {
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-right: 1px solid var(--rc-border-soft);
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.spm-seg button:last-child { border-right: 0; }
.spm-seg button:hover { background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.spm-seg button.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }

/* ---- 配置分组卡片 ---- */
.spm-config {
  margin-bottom: 12px;
  border: 1px solid var(--rc-border);
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
}
.spm-config-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--rc-primary-bg);
  border-bottom: 1px solid var(--rc-border-soft);
}
.spm-config-head::before {
  content: '';
  flex: none;
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--rc-primary) 0%, var(--rc-cyan) 100%);
}
.spm-config-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--rc-primary-ink);
}
.spm-config-count {
  flex: none;
  margin-left: auto;
  padding: 0 7px;
  border-radius: 999px;
  background: #fff;
  color: var(--rc-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}

/* ---- 参数行 ---- */
.spm-param {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--rc-border-soft);
  transition: opacity 0.15s ease;
}
.spm-param:last-child { border-bottom: 0; }
.spm-param.off .spm-param-name,
.spm-param.off .spm-select { opacity: 0.55; }
.spm-param-name {
  flex: 0 0 150px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--rc-text-2);
  font-size: 13px;
  line-height: 1.4;
}
.spm-select {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 460px;
}
.spm-select :deep(.el-select__wrapper) {
  min-height: 30px;
  border-radius: 7px;
  box-shadow: 0 0 0 1px #d5e2f2 inset;
  padding: 2px 8px;
}
.spm-select :deep(.el-select__wrapper:hover) { box-shadow: 0 0 0 1px #bfdbfe inset; }
.spm-select :deep(.el-select__wrapper.is-focused) { box-shadow: 0 0 0 1px var(--rc-primary) inset, 0 0 0 3px #dbeafe; }
.spm-select :deep(.el-select__selection-text),
.spm-select :deep(.el-select__placeholder) { font-size: 12px; }
.spm-select :deep(.el-tag) { font-size: 12px; }

.spm-footer { display: flex; justify-content: flex-end; gap: 8px; }
.spm-footer .rc-btn:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
