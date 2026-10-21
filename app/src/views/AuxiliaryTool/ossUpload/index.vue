<script setup lang="ts">
// OSS 上传 —— 1:1 迁移旧 data-view `src/page/install/FileOss.vue`（旧路由 /file/oss）。
//
// 旧页面全貌：
//   左卡「OSS 文件上传」：选择文件（最多 5 个，按 名称+大小+类型+最后修改时间 判重）
//     · 有文件后展开「路径前缀」（默认 /qinlong/report/YYYYMMDD）+ 每个文件的独立路径
//       （默认 = 前缀 + UUID + 原扩展名，标「自动」；手改过就变「自定义」，可一键恢复自动）
//     · 每个文件下方给出预览地址（读取服务基础地址 + encodeURIComponent(fileId)）+ 复制
//     · 预览地址输入框（form.readBaseUrl，默认 http://syncoss.oneweigh.cn:9371/read-file?fileId=）
//     · [上传]（每个文件的 fileId 都合法才可点）+ [重置] + 进度文案
//     · 上传结果：总览（共 N / 成功 N / 失败 N）+ 逐条结果（fileId 复制、预览链接）
//   右卡「上传历史」：最多 50 条，时间 / 文件名 / fileId / 状态 / 打开链接
//
// 有意偏差：
//   1. 上传历史仍然只存内存（刷新即失）—— 旧版就是这样，没有历史接口，这里不自己造一个。
//   2. 旧版上传进度用 `message.loading({ key })` 顶一条常驻消息，Element Plus 没有 key 机制，
//      改成按钮 loading + 表单区一行进度文案 + 结束后一条汇总 toast。信息量不减。
//   3. 旧版 Authorization / contentType 是 data 里的隐藏字段（页面上没有输入框）：这里同样保留为
//      内部状态，认证值来自 api/oss.ts 的常量（旧页面硬编码的 admin:12345，按迁移决定原样保留）。
//   4. 旧版文件列表用 antd 自带列表（带删除按钮），这里 `show-file-list=false`、自己画一份，
//      因为要挂 fileId 编辑、预览地址、自动/自定义标记。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument, Delete, Refresh, Upload, View } from '@element-plus/icons-vue'
import { DEFAULT_AUTHORIZATION, DEFAULT_READ_BASE_URL, uploadOssFile } from '@/api/oss'
import { copyToClipboard } from '@/utils/clipboard'
import {
  buildAutoFileId,
  buildPreviewUrl,
  generateUuid,
  getDefaultPrefix,
  isValidFileId,
  joinPath,
} from './ossPath'

defineOptions({ name: 'OssUpload' })

const MAX_FILES = 5

/** 旧 form 里的三个字段（contentType / authorization 页面上没输入框，仅内部状态） */
const form = reactive({
  contentType: 'auto',
  authorization: DEFAULT_AUTHORIZATION,
  readBaseUrl: DEFAULT_READ_BASE_URL,
})

interface PickedFile {
  uid: number
  name: string
  raw: File
}

interface FileConfig {
  uid: number
  fileName: string
  uuid: string
  fileId: string
  /** true = 自动（前缀 + UUID），false = 用户手改过 */
  auto: boolean
}

interface UploadItem {
  success: boolean
  message: string
  fileId: string
  fileName: string
  previewUrl: string
}

interface HistoryRow {
  key: number
  time: string
  fileName: string
  fileId: string
  status: '成功' | '失败'
  message: string
  readUrl: string
}

const fileList = ref<PickedFile[]>([])
const fileConfigs = ref<FileConfig[]>([])
const pathPrefix = ref('')
const uploading = ref(false)
const uploadProgress = ref('')
const uploadResults = ref<UploadItem[]>([])
const uploadHistory = ref<HistoryRow[]>([])

onMounted(() => {
  pathPrefix.value = getDefaultPrefix()
})

/** 是否能点上传：有文件、每个文件都有合法 fileId（旧 canUpload，含"空数组 every 为 true"的坑） */
const canUpload = computed(() => {
  if (fileList.value.length === 0) return false
  if (fileConfigs.value.length === 0) return false
  return fileConfigs.value.every((config) => isValidFileId(config.fileId))
})

/** 旧 watch fileList：保留已有配置（只更新文件名），新文件生成 UUID 自动路径 */
watch(
  fileList,
  (list) => {
    fileConfigs.value = list.map((file) => {
      const existing = fileConfigs.value.find((config) => config.uid === file.uid)
      if (existing) return { ...existing, fileName: file.name }
      const uuid = generateUuid()
      return {
        uid: file.uid,
        fileName: file.name,
        uuid,
        fileId: buildAutoFileId(pathPrefix.value, uuid, file.name),
        auto: true,
      }
    })
  },
  { deep: true },
)

/** 旧 watch pathPrefix：改前缀时，所有「自动」文件的路径跟着走（UUID 不变） */
watch(pathPrefix, (prefix) => {
  fileConfigs.value.forEach((config) => {
    if (config.auto) config.fileId = buildAutoFileId(prefix, config.uuid, config.fileName)
  })
})

/** el-upload 的 on-change（auto-upload=false，所以这里就是"选中文件"） */
function onChange(uploadFile: { name?: string; raw?: File }) {
  if (!uploadFile?.raw) return
  const raw = uploadFile.raw
  if (fileList.value.length >= MAX_FILES) {
    ElMessage.warning(`最多只能上传${MAX_FILES}个文件`)
    return
  }
  const key = `${raw.name}_${raw.size}_${raw.type}_${raw.lastModified}`
  const duplicated = fileList.value.some(
    (file) => `${file.raw.name}_${file.raw.size}_${file.raw.type}_${file.raw.lastModified}` === key,
  )
  if (duplicated) {
    ElMessage.warning(`文件「${raw.name}」已在列表中，已忽略重复添加`)
    return
  }
  fileList.value = [...fileList.value, { uid: Date.now() + Math.random(), name: raw.name, raw }]
}

function removeFile(uid: number) {
  fileList.value = fileList.value.filter((file) => file.uid !== uid)
}

function onFileIdInput(index: number) {
  const config = fileConfigs.value[index]
  if (config) config.auto = false
}

function resetFileId(index: number) {
  const config = fileConfigs.value[index]
  if (!config) return
  config.fileId = buildAutoFileId(pathPrefix.value, config.uuid, config.fileName)
  config.auto = true
}

function previewOf(config: FileConfig): string {
  return buildPreviewUrl(form.readBaseUrl, config.fileId)
}

/** 旧 addHistory：时间 + 截断到 200 字的消息，最多留 50 条 */
function addHistory(fileId: string, fileName: string, status: '成功' | '失败', message: string) {
  uploadHistory.value.unshift({
    key: Date.now() + Math.random(),
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    fileName,
    fileId,
    status,
    message: message.length > 200 ? `${message.substring(0, 200)}...` : message,
    readUrl: form.readBaseUrl ? `${form.readBaseUrl.replace(/\/+$/, '')}${encodeURIComponent(fileId)}` : '',
  })
  if (uploadHistory.value.length > 50) uploadHistory.value = uploadHistory.value.slice(0, 50)
}

/** 旧 handleUpload：串行上传，每个文件独立 try-catch，一个失败不影响其它 */
async function handleUpload() {
  if (!fileList.value.length) {
    ElMessage.error('请选择要上传的文件')
    return
  }
  if (fileList.value.length > MAX_FILES) {
    ElMessage.error(`最多只能上传${MAX_FILES}个文件`)
    return
  }
  const invalid = fileConfigs.value.find((config) => !config.fileId.trim())
  if (invalid) {
    ElMessage.error('请为每个文件配置文件路径')
    return
  }
  // 先把所有路径严格校验一遍再开始：旧版是发一个校验一个，前几个已经传上去了才发现后面非法
  const invalidFile = fileConfigs.value.find((config) => !isValidFileId(config.fileId))
  if (invalidFile) {
    ElMessage.error(`文件「${invalidFile.fileName}」的 fileId 无效，请配置有效的上传路径（不能为空或纯 "/"，且需为完整文件路径）`)
    return
  }

  uploading.value = true
  uploadResults.value = []
  uploadProgress.value = `准备上传 ${fileList.value.length} 个文件...`
  try {
    for (let i = 0; i < fileList.value.length; i += 1) {
      const file = fileList.value[i]!
      const config = fileConfigs.value.find((item) => item.uid === file.uid)
      const fileId = (config?.fileId ?? joinPath(pathPrefix.value, file.name)).trim()
      uploadProgress.value = `正在上传第 ${i + 1}/${fileList.value.length} 个：${file.name}`

      const result = await uploadOssFile({
        file: file.raw,
        fileId,
        contentType: form.contentType,
        authorization: form.authorization,
      })
      const item: UploadItem = {
        success: result.success,
        message: result.message,
        fileId,
        fileName: file.name,
        previewUrl: result.success ? buildPreviewUrl(form.readBaseUrl, fileId) : '',
      }
      uploadResults.value.push(item)
      addHistory(item.fileId, item.fileName, item.success ? '成功' : '失败', item.message)
    }

    const successCount = uploadResults.value.filter((item) => item.success).length
    const failCount = uploadResults.value.filter((item) => !item.success).length
    if (failCount === 0) ElMessage.success(`全部上传成功 (${successCount}/${fileList.value.length})`)
    else if (successCount === 0) ElMessage.error(`全部上传失败 (${failCount}/${fileList.value.length})`)
    else ElMessage.warning(`部分上传成功 (${successCount}/${fileList.value.length})`)

    uploadProgress.value = ''
    fileList.value = []
  } catch (error) {
    ElMessage.error(`上传过程出错: ${error instanceof Error ? error.message : String(error)}`)
    uploadProgress.value = ''
  } finally {
    uploading.value = false
  }
}

function handleReset() {
  form.contentType = 'auto'
  fileList.value = []
  fileConfigs.value = []
  pathPrefix.value = getDefaultPrefix()
  uploadProgress.value = ''
  uploadResults.value = []
}
</script>

<template>
  <div class="oss-shell">
    <!-- 左：上传表单 -->
    <section class="oss-card">
      <header class="oss-card-head">OSS 文件上传</header>
      <div class="oss-card-body">
        <div class="oss-upload-row">
          <el-upload :auto-upload="false" :show-file-list="false" multiple :on-change="onChange">
            <el-button :icon="Upload">选择文件（最多 {{ MAX_FILES }} 个）</el-button>
          </el-upload>
          <span class="oss-hint">已选择 {{ fileList.length }}/{{ MAX_FILES }} 个文件</span>
        </div>

        <!-- 已选文件 + 每文件路径配置 -->
        <div v-if="fileList.length" class="oss-files">
          <div class="oss-prefix">
            <span class="oss-prefix-label">路径前缀</span>
            <el-input v-model="pathPrefix" placeholder="/qinlong/report/20260709" clearable />
          </div>
          <div class="oss-prefix-tip">
            所有文件以此前缀 + 自动生成的 UUID 作为 OSS 路径（默认不可读，避免同名覆盖），单个文件可单独修改
          </div>

          <div v-for="(config, index) in fileConfigs" :key="config.uid" class="oss-file">
            <div class="oss-file-head">
              <span class="oss-file-index">{{ index + 1 }}</span>
              <span class="oss-file-name" :title="config.fileName">{{ config.fileName }}</span>
              <el-tag :type="config.auto ? 'primary' : 'warning'" size="small">
                {{ config.auto ? '自动' : '自定义' }}
              </el-tag>
              <el-button link :icon="Delete" class="oss-file-del" @click="removeFile(config.uid)">移除</el-button>
            </div>

            <div class="oss-file-path">
              <el-input v-model="config.fileId" placeholder="/xxx/xxx/xx.txt" clearable @input="onFileIdInput(index)" />
              <el-tooltip content="恢复为自动路径" placement="top">
                <el-button :icon="Refresh" @click="resetFileId(index)" />
              </el-tooltip>
            </div>

            <div v-if="previewOf(config)" class="oss-preview">
              <span class="oss-preview-text" :title="previewOf(config)">{{ previewOf(config) }}</span>
              <el-button link :icon="CopyDocument" @click="copyToClipboard(previewOf(config), '预览地址')" />
            </div>
          </div>
        </div>

        <div class="oss-field">
          <span class="oss-field-label">预览地址</span>
          <el-input v-model="form.readBaseUrl" placeholder="文件读取基础地址" clearable />
        </div>

        <div class="oss-actions">
          <el-button type="primary" :loading="uploading" :disabled="!canUpload" @click="handleUpload">上传</el-button>
          <el-button @click="handleReset">重置</el-button>
          <span v-if="uploadProgress" class="oss-progress">{{ uploadProgress }}</span>
        </div>

        <!-- 上传结果 -->
        <div v-if="uploadResults.length" class="oss-results">
          <el-alert
            type="info"
            :closable="false"
            show-icon
            :title="`上传完成：共 ${uploadResults.length} 个文件，成功 ${uploadResults.filter((r) => r.success).length} 个，失败 ${uploadResults.filter((r) => !r.success).length} 个`"
          />
          <div class="oss-result-list">
            <div v-for="(result, index) in uploadResults" :key="index" class="oss-result">
              <el-alert
                :type="result.success ? 'success' : 'error'"
                :closable="false"
                show-icon
                :title="result.fileName"
                :description="result.message"
              />
              <div v-if="result.success" class="oss-result-detail">
                <div class="oss-result-line">
                  <span class="oss-result-label">fileId：</span>
                  <span class="oss-result-value">{{ result.fileId }}</span>
                  <el-button link :icon="CopyDocument" @click="copyToClipboard(result.fileId, 'fileId')" />
                </div>
                <div v-if="result.previewUrl" class="oss-result-line">
                  <a :href="result.previewUrl" target="_blank" rel="noopener noreferrer" class="oss-link">
                    <el-icon><View /></el-icon> 预览文件
                  </a>
                  <el-button link :icon="CopyDocument" @click="copyToClipboard(result.previewUrl, '预览地址')" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 右：上传历史（内存态，刷新即失 —— 旧版如此） -->
    <section class="oss-card oss-card-history">
      <header class="oss-card-head">上传历史</header>
      <div class="oss-card-body">
        <el-table v-if="uploadHistory.length" :data="uploadHistory" size="small" border max-height="420">
          <el-table-column prop="time" label="时间" width="150" />
          <el-table-column prop="fileName" label="文件名" width="140" show-overflow-tooltip />
          <el-table-column prop="fileId" label="fileId" min-width="200" show-overflow-tooltip />
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === '成功' ? 'success' : 'danger'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <a v-if="row.status === '成功' && row.readUrl" :href="row.readUrl" target="_blank" rel="noopener noreferrer" class="oss-link">
                打开
              </a>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="暂无上传记录" :image-size="60" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.oss-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}
.oss-card {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
  overflow: hidden;
}
.oss-card-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--rc-border-soft, #f1f5f9);
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text, #0f172a);
}
.oss-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.oss-upload-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.oss-hint {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.oss-files {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--rc-border, #e2e8f0);
}
.oss-prefix {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.oss-prefix-label {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.oss-prefix-tip {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  line-height: 1.5;
}
.oss-file {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-left: 3px solid var(--rc-primary, #2563eb);
  border-radius: var(--rc-radius-sm, 6px);
}
.oss-file-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.oss-file-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--rc-primary, #2563eb);
  color: #fff;
  font-size: 11px;
  flex: none;
}
.oss-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--rc-text, #0f172a);
}
.oss-file-del {
  font-size: 12px;
}
.oss-file-path {
  display: flex;
  gap: 6px;
  align-items: center;
}
.oss-preview {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--rc-border-soft, #f1f5f9);
  border-radius: 4px;
}
.oss-preview-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--rc-muted, #64748b);
}
.oss-field {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.oss-field-label {
  color: var(--rc-text-2, #475569);
  font-size: 12px;
}
.oss-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.oss-progress {
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
}
.oss-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--rc-border, #e2e8f0);
}
.oss-result-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.oss-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.oss-result-detail {
  padding: 6px 10px;
  background: var(--rc-border-soft, #f1f5f9);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.oss-result-line {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.oss-result-label {
  color: var(--rc-muted, #64748b);
  flex: none;
}
.oss-result-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.oss-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  text-decoration: none;
}
.oss-link:hover {
  text-decoration: underline;
}
@media (max-width: 1200px) {
  .oss-shell {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
