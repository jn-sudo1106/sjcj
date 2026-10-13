<script setup lang="ts">
// 通用输入弹窗 —— 1:1 迁移旧 data-view `src/page/base/comm/Prompt.vue`
// （DatasetList.vue 用它做「立即执行(手工设ID)」的 FROM_ID 输入）。
//
// 旧版行为逐条对齐：
//   · `show(config, yes)`：`config = { width, title, cols }`，cols 每项 `{ title, span, dataIndex, defaultValue }`；
//     打开时把每个字段置成 `defaultValue`（旧版 `$set(form, dataIndex, defaultValue)`）。
//   · 弹窗体是 `a-descriptions bordered size="small" :column="4"`（span 与列定义同一口径）。
//   · 控件只有两种：`type === 'textArea'` → textarea，否则普通 input。
//   · 点确定把整个 form 交给回调；回调返回真值则**保持打开**，否则关闭（旧 handleOk 的分支）。
//     新版用 `@confirm` 事件 + `close()` 复刻：父组件拿到 form 自己处理，处理完不用回呼。
//
// 有意偏差：旧版 `width` 默认 300、`title` 默认「请输入」，这里保持同样的默认值；
// 但宽度按新平台的 `px` 直传（旧 a-modal 的 width 也是 px，口径一致）。
import { computed, reactive, ref } from 'vue'

export interface PromptCol {
  title: string
  dataIndex: string
  span?: number
  defaultValue?: unknown
  type?: 'textArea'
}

export interface PromptConfig {
  title?: string
  width?: number
  cols: PromptCol[]
}

defineOptions({ name: 'PromptDialog' })

const emit = defineEmits<{ (e: 'confirm', form: Record<string, unknown>): void }>()

const open = ref(false)
const title = ref('请输入')
const width = ref(300)
const cols = ref<PromptCol[]>([])
const form = reactive<Record<string, unknown>>({})

const widthPx = computed(() => `${width.value}px`)

/** 旧 `show(config, yes)`：先按 cols 把 form 逐字段置成 defaultValue，再显示 */
function show(config: PromptConfig) {
  cols.value = config.cols ?? []
  if (config.title) title.value = config.title
  else title.value = '请输入'
  width.value = config.width || 300
  Object.keys(form).forEach((key) => delete form[key])
  cols.value.forEach((col) => {
    form[col.dataIndex] = col.defaultValue
  })
  open.value = true
}

function close() {
  open.value = false
}

function onOk() {
  emit('confirm', { ...form })
  close()
}

const textVal = (key: string): string => (form[key] == null ? '' : String(form[key]))

defineExpose({ show, close })
</script>

<template>
  <el-dialog
    v-model="open"
    :title="title"
    :width="widthPx"
    destroy-on-close
    :close-on-click-modal="false"
    append-to-body
  >
    <el-descriptions border :column="4" size="small" class="pd-desc">
      <el-descriptions-item
        v-for="col in cols"
        :key="col.dataIndex"
        :label="col.title"
        :span="col.span ?? 2"
      >
        <el-input
          v-if="col.type === 'textArea'"
          :model-value="textVal(col.dataIndex)"
          type="textarea"
          :rows="3"
          @update:model-value="(v: string) => (form[col.dataIndex] = v)"
        />
        <el-input
          v-else
          :model-value="textVal(col.dataIndex)"
          @update:model-value="(v: string) => (form[col.dataIndex] = v)"
        />
      </el-descriptions-item>
    </el-descriptions>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="onOk">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.pd-desc :deep(.el-descriptions__label) {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.pd-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
}
</style>
