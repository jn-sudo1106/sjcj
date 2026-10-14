<script setup lang="ts">
// 分词配置编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/modal/WordSegmentConfigEditor.vue`）。
//
// 旧口径：
// · 三个字段：类型（type）、内容（content）、分词类型（token），都是纯文本输入，没有下拉、没有置灰；
// · 只有「编辑」有入口 —— 旧列表的 showAdd 没绑任何按钮，所以这个弹窗只实现编辑（见列表页偏差 1）；
// · 修改 POST /poc/word-segment-config/update（body 带 id），与新增不是同一个端点。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版提交不看校验，三个字段留空也能存进库（存进去就是一条匹配不上的空词条）；
//    这里三个必填直接拦下（同 sql 模板、表模板、自动补全、数据索引同步的修正先例）。
// 2. 旧版编辑时 `this.form = data` 把整行（含 createTime/updateTime/status）原样 POST 回去；
//    这里只提交三个表单字段 + id，**不重发 status**（启停是 /status 端点的事），
//    同数据字典 / 数据索引同步的先例。旧版把行对象本身当表单，改一半取消也会污染表格那一行，这里不会。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { wordSegmentApi } from '@/api/templateConfig'
import type { WordSegmentConfig } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { id: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({
  type: '',
  content: '',
  token: '',
})

/** 打开弹窗：分词配置只有编辑入口，record 必给 */
function open(record: WordSegmentConfig) {
  recordId.value = record.id == null ? undefined : Number(record.id)
  form.type = record.type == null ? '' : String(record.type)
  form.content = record.content == null ? '' : String(record.content)
  form.token = record.token == null ? '' : String(record.token)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (recordId.value == null) return
  if (!form.type.trim()) {
    ElMessage.warning('请填写类型')
    return
  }
  if (!form.content.trim()) {
    ElMessage.warning('请填写内容')
    return
  }
  if (!form.token.trim()) {
    ElMessage.warning('请填写分词类型')
    return
  }

  saving.value = true
  try {
    await wordSegmentApi.update({
      id: recordId.value,
      type: form.type,
      content: form.content,
      token: form.token,
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
    class="ws-edit-dialog"
  >
    <el-form class="ws-edit-form" label-width="90px" @submit.prevent>
      <el-form-item label="类型" required>
        <el-input v-model="form.type" placeholder="请输入" class="ws-field" />
      </el-form-item>
      <el-form-item label="内容" required>
        <el-input v-model="form.content" placeholder="请输入" class="ws-field" />
      </el-form-item>
      <el-form-item label="分词类型" required>
        <el-input v-model="form.token" placeholder="请输入" class="ws-field" />
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
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 DataIndexSyncEditDialog）。 */
:global(.ws-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.ws-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.ws-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.ws-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.ws-field {
  width: 100%;
}
</style>
