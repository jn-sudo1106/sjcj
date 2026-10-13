<script setup lang="ts">
// 「我的视图」命名弹窗（2026-10-12）：新建 / 另存为 / 系统目录另存为 / 重命名共用。
// 提交由父级执行（调 sourceViewApi），失败时父级不关弹窗、把错误回填到 error，用户改名再试。
import { ref, watch } from 'vue'
import { SOURCE_VIEW_NAME_MAX } from '@/api/sourceViews'

const props = defineProps<{
  modelValue: boolean
  title: string
  initialName?: string
  /** 是否出「设为默认进入」勾选（重命名时不出） */
  showDefault?: boolean
  /** 条件摘要等说明 */
  summary?: string
  busy?: boolean
  error?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  submit: [payload: { name: string; isDefault: boolean }]
}>()

const name = ref('')
const isDefault = ref(false)
const localError = ref('')
watch(() => props.modelValue, (open) => {
  if (!open) return
  name.value = props.initialName ?? ''
  isDefault.value = false
  localError.value = ''
})

function submit() {
  const trimmed = name.value.trim()
  if (!trimmed || trimmed.length > SOURCE_VIEW_NAME_MAX) {
    localError.value = `视图名称需为 1–${SOURCE_VIEW_NAME_MAX} 个字`
    return
  }
  localError.value = ''
  emit('submit', { name: trimmed, isDefault: isDefault.value })
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="440px"
    style="max-width: calc(100vw - 32px)"
    append-to-body
    data-testid="save-view-dialog"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="svd-row">
      <label class="svd-label" for="svd-name">视图名称</label>
      <el-input
        id="svd-name"
        v-model="name"
        :maxlength="SOURCE_VIEW_NAME_MAX"
        placeholder="例如：广发 · 失败待处理"
        data-testid="save-view-name"
        @keyup.enter="submit"
      />
      <p class="svd-hint">1–{{ SOURCE_VIEW_NAME_MAX }} 个字，不能和自己已有的视图重名</p>
    </div>
    <el-checkbox v-if="showDefault" v-model="isDefault" data-testid="save-view-default">设为默认进入（打开源管理直接进入这个视图）</el-checkbox>
    <p v-if="summary" class="svd-hint svd-summary">{{ summary }}</p>
    <p v-if="localError || error" class="svd-error" data-testid="save-view-error">{{ localError || error }}</p>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="busy" data-testid="save-view-submit" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.svd-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.svd-label { font-size: 13px; color: var(--rc-text-2); }
.svd-hint { margin: 0; font-size: 12px; color: var(--rc-faint); }
.svd-summary { margin-top: 10px; line-height: 1.6; }
.svd-error { margin: 10px 0 0; font-size: 12px; color: var(--el-color-danger); }
</style>
