<script setup lang="ts">
// 批量导入数据弹窗 —— 迁移旧 data-view `src/page/config/upload/UploadData.vue`。
//
// 旧形态：550px 的 modal（`:footer="null"`，没有确定/取消按钮）+ 三个只读/可编辑的 ID 输入框
// + `a-upload-dragger` 拖拽选文件 + 「点击开始上传」按钮 + 一行结果文案。
// 上传走 `axios.post('/api/v1/entry/batch/uploadData', formData)`，formData 的字段名固定为
// `file / entryTypeId / sourceId / configId`。
//
// 新平台对应 `dataApi.importData({ file, tableId, sourceId, configId })`——它内部就是同一个
// multipart 端点（`entry/batch/uploadData`），字段名保持一致（见 api/index.ts 的 importEntryData）。
//
// 有意偏差（都在交付说明里单列）：
//   1. 旧 `handleUpload` 的 `if (!this.configId) { this.$message.error('请填入配置ID') }` **没有 return**，
//      提示完照样往下传，于是「没填配置ID」也会发一次注定失败的请求。这里补上 return：提示即拦下。
//   2. 旧 `axios.post(...)` 只有 `.then`、没有 `.catch`/`.finally` —— 网络失败时 uploading 会永久卡在
//      true，按钮一直是「处理中..」。这里补 try/catch/finally，失败也复位。
//   3. 旧 `handleCancel` 会 `$emit('refresh')`；本组件是自持 visible 的弹窗，改成向调用方抛 refresh 事件，
//      由 page 决定要不要刷新（旧 MeasureData 没有监听 dataUpload 的 refresh，等价于不刷新）。
//   4. `Result` 组件（ant-design-vue）在旧文件里 import 了但模板里没用（死 import），不迁。
//   5. 上传终点确认：`beforeUpload` 返回 false（阻止自动上传，改由按钮手动触发）—— 1:1 保留。
import { ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { dataApi } from '@/api'

defineOptions({ name: 'UploadDataDialog' })

const emit = defineEmits<{ (e: 'refresh'): void }>()

const visible = ref(false)
const uploading = ref(false)
const entryTypeId = ref('')
const sourceId = ref('')
const configId = ref('')
const fileName = ref('')
const file = ref<File | null>(null)
const result = ref('')

/** 旧 `showModal(entryTypeId, sourceId, configId)` */
function open(tableId: string, srcId: string, cfgId?: string | null) {
  entryTypeId.value = String(tableId ?? '')
  sourceId.value = String(srcId ?? '')
  configId.value = cfgId ? String(cfgId) : ''
  file.value = null
  fileName.value = ''
  result.value = ''
  uploading.value = false
  visible.value = true
}

/** 旧 `handleChange`：info.fileList.splice(length - 1) —— 只保留最后一个文件（单选语义） */
function onChange(uploadFile: { name?: string; raw?: File }) {
  if (!uploadFile?.raw) return
  file.value = uploadFile.raw
  fileName.value = uploadFile.name ?? uploadFile.raw.name
}

function clearFile() {
  file.value = null
  fileName.value = ''
}

async function handleUpload() {
  if (!configId.value) {
    ElMessage.error('请填入配置ID')
    return
  }
  if (!file.value) return
  uploading.value = true
  try {
    const res = await dataApi.importData({
      file: file.value,
      tableId: entryTypeId.value,
      sourceId: sourceId.value,
      configId: configId.value,
    })
    clearFile()
    if (res.success) {
      ElNotification.success({ message: res.message || '导入成功' })
      result.value = `[成功]上次处理结果:${res.message ?? ''}`
    } else {
      ElNotification.error({ message: res.message || '导入失败' })
      result.value = `[出错]上次处理结果:${res.message ?? ''}`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    ElNotification.error({ message })
    result.value = `[出错]上次处理结果:${message}`
  } finally {
    uploading.value = false
  }
}

function close() {
  visible.value = false
  emit('refresh')
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="批量导入数据"
    width="550px"
    top="100px"
    destroy-on-close
    class-name="rc-dialog udd-dialog"
    @closed="emit('refresh')"
  >
    <el-form label-width="110px" label-position="left">
      <el-form-item label="表ID:">
        <el-input v-model="entryTypeId" readonly />
      </el-form-item>
      <el-form-item label="源ID:">
        <el-input v-model="sourceId" readonly />
      </el-form-item>
      <el-form-item label="使用配置ID:">
        <el-input v-model="configId" />
      </el-form-item>
    </el-form>

    <!-- 旧 a-upload-dragger：before-upload 返回 false（不自动上传），由下方按钮手动触发 -->
    <el-upload
      drag
      :auto-upload="false"
      :show-file-list="false"
      :limit="1"
      :on-change="onChange"
    >
      <el-icon class="udd-icon"><UploadFilled /></el-icon>
      <div class="udd-text">{{ fileName || '选择本地文件, 或拖动到此框内' }}</div>
      <div class="udd-hint">支持EXCEL, 第一行支持K1-Kn, SOURCE_ID, CONFIG_ID, PARENT_ID等</div>
    </el-upload>

    <div class="udd-actions">
      <el-button
        type="primary"
        :disabled="!file"
        :loading="uploading"
        @click="handleUpload"
      >{{ uploading ? '处理中..' : '点击开始上传' }}</el-button>
    </div>

    <h1 v-if="result" class="udd-result">{{ result }}</h1>

    <template #footer>
      <el-button @click="close">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.udd-icon {
  font-size: 48px;
  color: #c0c4cc;
}
.udd-text {
  margin-top: 8px;
  color: #606266;
}
.udd-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}
.udd-actions {
  margin-top: 16px;
  text-align: center;
}
.udd-result {
  margin-top: 16px;
  font-size: 14px;
  text-align: center;
  word-break: break-all;
}
</style>
