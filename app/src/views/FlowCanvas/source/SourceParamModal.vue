<script setup lang="ts">
import { reactive, ref } from 'vue'
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
const sources = ref<{ sourceId: string }[]>([])

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
  srcs: { sourceId: string }[],
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
      include.push(`${cfg}_${p.paramId}`)
      const vs = p.curValues || []
      if (!vs.length) {
        hasError = true
        break
      }
      out[`${cfg}_${p.paramId}`] = vs.join(';')
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
        message: `发送成功, 本次发送${ids.length}${queue.value ? ', 队列:-' + queue.value : ''}, 返回值:-${res?.message || (res as { msg?: string }).msg || ''}`,
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
    title="参数"
    width="760px"
    :close-on-click-modal="false"
    @close="onCancel"
  >
    <div class="sp-toolbar">
      <el-checkbox v-model="all">所有参数</el-checkbox>
      <span v-if="queue" class="sp-queue">测试队列: <el-tag type="warning">{{ queue }}</el-tag></span>
      <span class="sp-login">
        登陆:
        <el-radio-group v-model="skip">
          <el-radio-button :value="0">[0]默认</el-radio-button>
          <el-radio-button :value="1">[1]不登陆</el-radio-button>
          <el-radio-button :value="2">[2]强制登陆</el-radio-button>
        </el-radio-group>
      </span>
    </div>

    <div v-for="cfg in configKeys" :key="cfg" class="sp-config">
      <div class="sp-config-id">{{ cfg }}</div>
      <div v-for="(p, idx) in params[cfg]" :key="idx" class="sp-param">
        <el-switch v-model="p.check" />
        <span class="sp-param-name">{{ p.paramName }}</span>
        <el-select
          v-model="p.curValues"
          multiple
          filterable
          allow-create
          default-first-option
          :disabled="all"
          placeholder="请选择或输入参数值"
          class="sp-select"
        >
          <el-option v-for="entry in p.showValues" :key="entry" :label="entry" :value="entry" />
        </el-select>
      </div>
    </div>

    <template #footer>
      <el-button @click="onCancel">取消</el-button>
      <el-button type="primary" :loading="loading" @click="onSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.sp-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.sp-config {
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px 12px;
}
.sp-config-id {
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}
.sp-param {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 6px 0;
}
.sp-param-name {
  width: 160px;
  flex: 0 0 auto;
  color: var(--el-text-color-regular);
}
.sp-select {
  flex: 1 1 auto;
  max-width: 420px;
}
</style>
