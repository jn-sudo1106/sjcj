<script setup lang="ts">
// 提示词配置编辑弹窗（1:1 对齐旧 ai-chat-view `src/demo/modal/ChatFlowStepEditor.vue`）。
//
// 旧口径：
// · 16 个可编辑字段，控件形态只有三种：文本输入框（14 个）、模板定义（唯一的 a-textarea）、
//   重试次数（唯一的 a-input-number）；标签文字照旧弹窗逐项抄。
// · 「状态」在旧弹窗里是注释掉的（旧文件 121-127 行），改状态只能走列表的启停 → 这里同样不给入口，
//   新增也不替后端补 status（旧 add 提交的 form.status 一直是 undefined）。
// · 新增走 chatFlowStepAdd（POST /poc/chat-flow-step）、编辑走 chatFlowStepUpdate
//   （POST /poc/chat-flow-step/update），**两个端点**，由 api 层按有无 id 路由。
// · 弹窗宽 800px（旧 a-modal width="800px"）。
//
// 与旧版的有意偏差（旧版缺陷或项目约定，交付说明单列）：
// 1. 旧版提交完全不看校验，步骤编码留空也能存进库，存进去的是一条永远不会被 nextStepCode 命中的步骤。
//    这里拦两个必填（步骤编码 / 流程编码），同 sql 模板、问句改写的修正先例。
// 2. 旧版编辑时把整行（含 createTime/updateTime/status）原样 POST 回去；只提交表单字段 + id。
// 3. 16 个字段单列排下来在 13.6 寸屏上要滚两三屏，这里排成两列（模板定义跨整行），
//    弹窗主体仍是唯一一个滚动容器（AGENTS.md 滚动容器约定）。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { chatFlowStepApi } from '@/api/templateConfig'
import type { ChatFlowStep } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()

const textKeys = [
  'stepCode',
  'flowCode',
  'stepName',
  'dictCodes',
  'inputParams',
  'execCond',
  'stepAction',
  'systemPrompt',
  'templateDef',
  'cleanRule',
  'checkRule',
  'outputParams',
  'nextStepCode',
  'var1',
  'var2',
] as const

const form = reactive<Record<(typeof textKeys)[number], string>>({
  stepCode: '',
  flowCode: '',
  stepName: '',
  dictCodes: '',
  inputParams: '',
  execCond: '',
  stepAction: '',
  systemPrompt: '',
  templateDef: '',
  cleanRule: '',
  checkRule: '',
  outputParams: '',
  nextStepCode: '',
  var1: '',
  var2: '',
})
/** 重试次数：旧弹窗唯一的数字输入，留空即 undefined（旧 add 也是原样提交 undefined） */
const retryCount = ref<number | undefined>()

const title = computed(() => (recordId.value == null ? '新增' : '编辑'))

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增 */
function open(record?: ChatFlowStep | null) {
  recordId.value = record?.id == null ? undefined : Number(record.id)
  for (const key of textKeys) {
    const value = record?.[key]
    form[key] = value == null ? '' : String(value)
  }
  const rawRetry = record?.retryCount
  // 空串要当「未填」：Number('') 是 0，会把留空静默存成重试 0 次
  retryCount.value = rawRetry == null || rawRetry === '' ? undefined : Number(rawRetry)
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  if (!form.stepCode.trim()) {
    ElMessage.warning('请填写步骤编码')
    return
  }
  if (!form.flowCode.trim()) {
    ElMessage.warning('请填写流程编码')
    return
  }
  const payload: Partial<ChatFlowStep> = {
    ...form,
    stepCode: form.stepCode.trim(),
    flowCode: form.flowCode.trim(),
    retryCount: retryCount.value,
  }
  if (recordId.value != null) payload.id = recordId.value

  saving.value = true
  try {
    await chatFlowStepApi.save(payload)
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
    class="cfs-edit-dialog"
  >
    <el-form class="cfs-edit-form" label-width="100px" @submit.prevent>
      <el-form-item label="步骤编码" required>
        <el-input v-model="form.stepCode" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="流程编码" required>
        <el-input v-model="form.flowCode" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="步骤名称">
        <el-input v-model="form.stepName" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="引用字典编码">
        <el-input v-model="form.dictCodes" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="入参定义">
        <el-input v-model="form.inputParams" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="执行条件">
        <el-input v-model="form.execCond" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="步骤动作">
        <el-input v-model="form.stepAction" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="下一步编码">
        <el-input v-model="form.nextStepCode" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="重试次数">
        <el-input-number v-model="retryCount" :min="0" controls-position="right" class="cfs-field" />
      </el-form-item>
      <el-form-item label="变量1">
        <el-input v-model="form.var1" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="变量2">
        <el-input v-model="form.var2" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="结果清洗规则">
        <el-input v-model="form.cleanRule" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="结果校验规则">
        <el-input v-model="form.checkRule" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="输出字段">
        <el-input v-model="form.outputParams" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <!-- 两个长文本放在最后：系统prompt 旧版是单行输入框，模板定义是旧版唯一的文本域 -->
      <el-form-item label="系统prompt">
        <el-input v-model="form.systemPrompt" placeholder="请输入" class="cfs-field" />
      </el-form-item>
      <el-form-item label="模板定义" class="cfs-item--full">
        <el-input v-model="form.templateDef" type="textarea" :rows="4" placeholder="请输入" resize="vertical" />
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
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 QuestionDicEditDialog）。 */
:global(.cfs-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.cfs-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
/* 16 个字段两列排布；模板定义跨整行，纵向仍只有一个滚动容器 */
.cfs-edit-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
}
.cfs-item--full {
  grid-column: 1 / -1;
}
.cfs-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.cfs-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.cfs-field {
  width: 100%;
}
</style>
