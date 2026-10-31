<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, sourceApi } from '../../api'

const props = defineProps<{
  modelValue: boolean
  tableId: string
  sourceId: string
  initialConfigId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; uploaded: [] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})
const configId = ref('')
const selectedFile = ref<File | null>(null)
const inputRef = ref<HTMLInputElement>()
const loading = ref(false)
const configLoading = ref(false)
const result = ref<{ type: 'success' | 'error'; text: string } | null>(null)

watch([() => props.modelValue, () => props.tableId, () => props.sourceId], async ([open], _previous, onCleanup) => {
  let active = true
  onCleanup(() => { active = false })
  configLoading.value = false
  if (!open) return
  configId.value = props.initialConfigId ?? ''
  selectedFile.value = null
  result.value = null
  if (inputRef.value) inputRef.value.value = ''
  // 空表没有首行 CONFIG_ID，按已选源读取实际配置，避免 Excel 导入缺少必填参数。
  if (!configId.value && /^\d+$/.test(props.sourceId)) {
    configLoading.value = true
    try {
      const source = await sourceApi.sourceDetail(props.sourceId)
      if (!source) throw new Error('未找到所选源，请重新选择')
      if (active && source.configId && !['0', '-1'].includes(source.configId)) configId.value = source.configId
    } catch (error) {
      if (active) result.value = { type: 'error', text: `读取源配置失败：${error instanceof Error ? error.message : String(error)}，可手动填写配置 ID` }
    } finally {
      if (active) configLoading.value = false
    }
  }
})

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (file && !/\.(xlsx?|xls)$/i.test(file.name)) {
    ElMessage.error('仅支持 Excel 文件（.xls、.xlsx）')
    selectedFile.value = null
    input.value = ''
    return
  }
  selectedFile.value = file
  result.value = null
}

function openFilePicker() {
  inputRef.value?.click()
}

async function onUpload() {
  if (loading.value || configLoading.value) return
  if (!selectedFile.value) {
    ElMessage.error('请选择要导入的 Excel 文件')
    return
  }
  if (!configId.value.trim()) {
    ElMessage.error('请填写配置 ID')
    return
  }
  loading.value = true
  result.value = null
  try {
    const response = await dataApi.importData({
      file: selectedFile.value,
      tableId: props.tableId,
      sourceId: props.sourceId,
      configId: configId.value.trim(),
    })
    if (!response.success) {
      result.value = { type: 'error', text: response.message || '导入失败' }
      return
    }
    result.value = { type: 'success', text: response.message || '导入成功' }
    emit('uploaded')
  } catch (error) {
    result.value = { type: 'error', text: error instanceof Error ? error.message : String(error) }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="批量导入数据" width="560px" destroy-on-close>
    <el-form label-position="left" label-width="104px">
      <el-form-item label="表 ID"><el-input :model-value="tableId" readonly /></el-form-item>
      <el-form-item label="源 ID"><el-input :model-value="sourceId" readonly /></el-form-item>
      <el-form-item label="使用配置 ID" required><el-input v-model="configId" :disabled="configLoading || loading" :placeholder="configLoading ? '正在读取源配置…' : '请输入配置 ID'" /></el-form-item>
      <el-form-item label="Excel 文件" required>
        <div class="did-file">
          <input ref="inputRef" class="did-file-input" type="file" accept=".xls,.xlsx" @change="onFileChange">
          <button class="rc-btn did-file-button" type="button" @click="openFilePicker">选择本地文件</button>
          <span class="did-file-name" :class="{ 'is-empty': !selectedFile }" :title="selectedFile?.name">
            {{ selectedFile?.name || '未选择文件' }}
          </span>
        </div>
      </el-form-item>
    </el-form>
    <div class="did-hint">支持 Excel；第一行可使用 K1-Kn、SOURCE_ID、CONFIG_ID、PARENT_ID 等字段。</div>
    <el-alert v-if="result" class="did-result" :type="result.type" :closable="false" :title="result.text" show-icon />
    <template #footer>
      <button class="rc-btn" type="button" @click="visible = false">取消</button>
      <button class="rc-btn primary" type="button" :disabled="loading || configLoading || !selectedFile" @click="onUpload">
        {{ loading ? '处理中…' : '开始上传' }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.did-file { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; color: var(--rc-muted); font-size: 12px; }
.did-file-input { display: none; }
.did-file-button { flex: none; height: 32px; padding: 0 11px; font-size: 12px; }
.did-file-name { display: inline-flex; align-items: center; min-width: 0; width: 0; flex: 1; height: 32px; padding: 0 10px; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); background: #fff; color: var(--rc-text-2); }
.did-file-name.is-empty { color: var(--rc-faint); }
.did-hint { padding: 10px 12px; border-radius: var(--rc-radius-sm); background: #f8fafc; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.did-result { margin-top: 14px; }
</style>
