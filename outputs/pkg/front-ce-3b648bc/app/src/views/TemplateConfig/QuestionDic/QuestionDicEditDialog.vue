<script setup lang="ts">
// 问句改写编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/modal/QuestionDicEditor.vue`）。
//
// 旧口径：
// · 五个字段：阶段（stepCode 下拉）、类型（type 下拉）、接收条件 / 内容 / 目标内容（三个文本域）；
// · 「状态」在旧弹窗里是注释掉的，改状态只能走列表的启停；
// · 新增固定带 tag: ''、status: '0'（旧 form 初始值），提交走 questionDicAdd（POST /poc/question-dic）；
// · 编辑走 questionDicUpdate（POST /poc/question-dic/update），与新增不是同一个端点。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版提交不看校验：阶段、类型留空也能存进库，存进去的是一条永远不会生效的改写规则。
//    这里三个必填（阶段 / 类型 / 内容）直接拦下（同 sql 模板、表模板、自动补全的修正先例）。
// 2. 旧版编辑时把整行（含 createTime/updateTime/delFlag）原样 POST 回去；只提交表单字段 + id。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { questionDicApi } from '@/api/templateConfig'
import type { QuestionDic } from '@/api/types/template'
import { QUESTION_DIC_STEP_OPTIONS, QUESTION_DIC_TYPE_OPTIONS } from './options'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const form = reactive({ stepCode: '', type: '', receiveRule: '', content: '', targetContent: '' })

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增 */
function open(record?: QuestionDic | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  form.stepCode = record?.stepCode == null ? '' : String(record.stepCode)
  form.type = record?.type == null ? '' : String(record.type)
  form.receiveRule = record?.receiveRule == null ? '' : String(record.receiveRule)
  form.content = record?.content == null ? '' : String(record.content)
  form.targetContent = record?.targetContent == null ? '' : String(record.targetContent)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.stepCode) {
    ElMessage.warning('请选择阶段')
    return
  }
  if (!form.type) {
    ElMessage.warning('请选择类型')
    return
  }
  if (!form.content.trim()) {
    ElMessage.warning('请填写内容')
    return
  }
  const payload: Partial<QuestionDic> = {
    stepCode: form.stepCode,
    type: form.type,
    receiveRule: form.receiveRule,
    content: form.content,
    targetContent: form.targetContent,
    // 旧 form 初始值：标签字段没入口，恒为空串（列表列也是注释掉不展示的）
    tag: '',
  }
  if (recordId.value == null) {
    payload.status = '0'
  } else {
    payload.id = recordId.value
  }

  saving.value = true
  try {
    await questionDicApi.save(payload)
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
    class="qd-edit-dialog"
  >
    <el-form class="qd-edit-form" label-width="90px" @submit.prevent>
      <el-form-item label="阶段" required>
        <el-select v-model="form.stepCode" placeholder="请选择" class="qd-field">
          <el-option v-for="option in QUESTION_DIC_STEP_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="类型" required>
        <el-select v-model="form.type" placeholder="请选择" class="qd-field">
          <el-option v-for="option in QUESTION_DIC_TYPE_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="接收条件">
        <el-input v-model="form.receiveRule" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="内容" required>
        <el-input v-model="form.content" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
      </el-form-item>
      <el-form-item label="目标内容">
        <el-input v-model="form.targetContent" type="textarea" :rows="3" placeholder="请输入" resize="vertical" />
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
:global(.qd-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.qd-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.qd-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.qd-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.qd-field {
  width: 100%;
}
</style>
