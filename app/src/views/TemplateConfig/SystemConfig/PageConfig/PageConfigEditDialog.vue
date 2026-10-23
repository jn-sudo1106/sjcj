<script setup lang="ts">
// 页面配置编辑弹窗（1:1 对齐旧 ai-chat-view `src/system/config/modules/SysPageConfigEditor.vue`）。
//
// 旧口径：
// · 只有「编辑」有入口 —— 旧列表的 showAdd（doEdit('', false) 新增分支）没有任何按钮绑定、
//   且新增分支的提交请求整段被注释掉，是死代码，所以本弹窗只实现编辑（新增走批量弹窗）；
// · 表单只有一个「内容」文本域（类型输入框在旧弹窗里被注释掉）；
// · 修改 POST /poc/system/page-config/update（body 带 id）。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版提交不看校验，内容留空也能存进库；这里必填直接拦下（同分词 / 数据字典的修正先例）。
// 2. 旧版编辑时 `this.form = data` 把整行（含 createTime/updateTime/status）原样 POST 回去；
//    这里只提交 id + content，**不重发 status**（启停是 /status 端点的事），同分词先例。
//    旧版把行对象本身当表单，改一半取消也会污染表格那一行，这里不会。
// 3. 旧版按 `res.code === 0` 严格判成功，而旧 request.js 拦截器只按 `res.code !== '0'` 拒（信封 code
//    回字符串 '0' 时旧版成功路径反而会弹「操作失败」）；新 client.ts 对业务失败统一 throw，
//    这里按请求是否抛错判定，不再比对 code。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { pageConfigApi } from '@/api/templateConfig'
import type { SysPageConfig } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { id: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({
  content: '',
})

/** 打开弹窗：页面配置只有编辑入口，record 必给 */
function open(record: SysPageConfig) {
  recordId.value = record.id == null ? undefined : Number(record.id)
  form.content = record.content == null ? '' : String(record.content)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (recordId.value == null) return
  if (!form.content.trim()) {
    ElMessage.warning('请填写内容')
    return
  }

  saving.value = true
  try {
    await pageConfigApi.update({
      id: recordId.value,
      content: form.content,
    })
    ElMessage.success('操作成功')
    visible.value = false
    emit('saved', { id: recordId.value })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    saving.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑"
    width="800px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="sc-page-edit-dialog"
  >
    <el-form class="sc-page-edit-form" label-width="90px" @submit.prevent>
      <el-form-item label="内容" required>
        <el-input v-model="form.content" type="textarea" :rows="4" placeholder="请输入" class="sc-page-field" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线（AGENTS.md 弹窗适配 + 滚动容器约定）：el-dialog 是 append-to-body 的 teleport，
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 WordSegment 弹窗）。 */
:global(.sc-page-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.sc-page-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.sc-page-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.sc-page-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.sc-page-field {
  width: 100%;
}
</style>
