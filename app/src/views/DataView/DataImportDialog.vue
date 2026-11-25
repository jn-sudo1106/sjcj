<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi, dataApi, sourceApi } from '../../api'

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
const configNote = ref('')
const selectedFile = ref<File | null>(null)
const inputRef = ref<HTMLInputElement>()
const loading = ref(false)
const configLoading = ref(false)
const result = ref<{ type: 'success' | 'error'; text: string } | null>(null)

// 后端 entry/batch/uploadData 只在 configId 非空时校验「配置的输出实体 == 目标表」，否则直接拒绝。
// 所以配置必须从**目标表**反查，不能照搬源的主配置：源的 CONFIG_ID 常是入口节点配置（ENTRY_TYPE_ID 为空），
// 拿它导入会一直报「传入的configId与实体ID不匹配」。留空则不关联配置，后端允许。
const isConfigId = (value: string) => /^\d+$/.test(value) && !['0', '-1'].includes(value)

async function configMatchesTable(id: string) {
  if (!isConfigId(id) || !props.tableId) return false
  const config = await configApi.configDetail(id)
  return String(config?.entryTypeId ?? '') === String(props.tableId)
}

/** 本表可用的配置（按 CONFIG_ID 倒序，取最新一个）。 */
async function pickTableConfig() {
  const page = await configApi.configPaged({ entryTypeId: props.tableId, page: 1, size: 50 })
  const hit = page.list.find(item => String(item.entryTypeId ?? '') === String(props.tableId) && isConfigId(item.configId))
  return hit?.configId ?? ''
}

watch([() => props.modelValue, () => props.tableId, () => props.sourceId], async ([open], _previous, onCleanup) => {
  let active = true
  onCleanup(() => { active = false })
  configLoading.value = false
  configNote.value = ''
  if (!open) return
  configId.value = ''
  selectedFile.value = null
  result.value = null
  if (inputRef.value) inputRef.value.value = ''
  configLoading.value = true
  try {
    // 1) 首行自带的配置只在属于本表时才用（空表没有首行，这里通常为空）
    const initial = (props.initialConfigId ?? '').trim()
    if (initial && await configMatchesTable(initial)) {
      if (active) configId.value = initial
      return
    }
    // 2) 源的配置同样要过本表校验，否则后端会拒绝整个上传
    if (/^\d+$/.test(props.sourceId)) {
      try {
        const source = await sourceApi.sourceDetail(props.sourceId)
        if (!source) throw new Error('未找到所选源，请重新选择')
        const fromSource = String(source.configId ?? '').trim()
        if (isConfigId(fromSource) && await configMatchesTable(fromSource)) {
          if (active) configId.value = fromSource
          return
        }
      } catch (error) {
        if (active) result.value = { type: 'error', text: `读取源配置失败：${error instanceof Error ? error.message : String(error)}，可手动填写配置 ID` }
      }
    }
    // 3) 退化到本表自己的配置；本表没有配置时留空，导入仍可进行（数据不关联配置）
    const fromTable = await pickTableConfig()
    if (!active) return
    if (fromTable) {
      configId.value = fromTable
      configNote.value = `已按目标表自动选择配置 ${fromTable}`
    } else {
      configNote.value = '本表暂无可用配置，可留空导入（数据不关联配置）'
    }
  } catch (error) {
    if (active) result.value = { type: 'error', text: `读取配置失败：${error instanceof Error ? error.message : String(error)}，可手动填写配置 ID` }
  } finally {
    if (active) configLoading.value = false
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
  if (configId.value.trim() && !isConfigId(configId.value.trim())) {
    ElMessage.error('配置 ID 只能是数字，或留空不关联配置')
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
      <el-form-item label="使用配置 ID">
        <div class="did-config">
          <el-input v-model="configId" :disabled="configLoading || loading" :placeholder="configLoading ? '正在读取本表配置…' : '可留空（数据不关联配置）'" />
          <div v-if="configNote" class="did-config-note">{{ configNote }}</div>
        </div>
      </el-form-item>
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
.did-config { width: 100%; min-width: 0; }
.did-config-note { margin-top: 4px; color: var(--rc-muted); font-size: 12px; line-height: 1.5; }
.did-file { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; color: var(--rc-muted); font-size: 12px; }
.did-file-input { display: none; }
.did-file-button { flex: none; height: 32px; padding: 0 11px; font-size: 12px; }
.did-file-name { display: inline-flex; align-items: center; min-width: 0; width: 0; flex: 1; height: 32px; padding: 0 10px; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); background: #fff; color: var(--rc-text-2); }
.did-file-name.is-empty { color: var(--rc-faint); }
.did-hint { padding: 10px 12px; border-radius: var(--rc-radius-sm); background: #f8fafc; color: var(--rc-muted); font-size: 12px; line-height: 1.6; }
.did-result { margin-top: 14px; }
</style>
