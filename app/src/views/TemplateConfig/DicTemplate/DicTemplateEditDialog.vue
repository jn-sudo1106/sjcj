<script setup lang="ts">
// 自动补全编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/DicEditor.vue`）。
//
// 旧口径：
// · 字段只有「内容」content 与「简称」keyWords，两个都是多行文本域（类型选择是注释掉的）；
// · 新增固定带 type: 1、status: '0'（旧 doEdit 的写死值），编辑时不重发 status；
// · 新增走 dicAdd（POST /poc/dic）、编辑走 dicUpdate（POST /poc/dic/update），两个端点。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版提交不看内容，空词条也能存进库；这里「内容」必填直接拦下（同表模板弹窗的修正先例）。
// 2. 旧版编辑时把整行（含 createTime/updateTime）原样 POST 回去；只提交表单字段 + id。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { dicTemplateApi } from '@/api/templateConfig'
import type { DicTemplate } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ content: '', keyWords: '' })

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增 */
function open(record?: DicTemplate | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  form.content = record?.content == null ? '' : String(record.content)
  form.keyWords = record?.keyWords == null ? '' : String(record.keyWords)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.content.trim()) {
    ElMessage.warning('请填写内容')
    return
  }
  const payload: Partial<DicTemplate> = { content: form.content, keyWords: form.keyWords }
  if (recordId.value == null) {
    // 旧 DicEditor doEdit(false)：新增固定 type=1、status='0'
    payload.type = 1
    payload.status = '0'
  } else {
    payload.id = recordId.value
  }

  saving.value = true
  try {
    await dicTemplateApi.save(payload)
    ElMessage.success('操作成功')
    visible.value = false
    emit('saved', { mode: recordId.value == null ? 'add' : 'edit', id: recordId.value })
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
    :title="title"
    width="800px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="dt-edit-dialog"
  >
    <el-form class="dt-edit-form" label-width="70px" @submit.prevent>
      <el-form-item label="内容" required>
        <el-input v-model="form.content" type="textarea" :rows="4" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="简称">
        <el-input v-model="form.keyWords" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
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
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 TableTemplateEditDialog）。 */
:global(.dt-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.dt-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.dt-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.dt-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
</style>
