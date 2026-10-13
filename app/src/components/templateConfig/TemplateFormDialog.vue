<script setup lang="ts">
// 模板配置通用编辑弹窗（schema 驱动）—— 交互 1:1 对齐旧 ai-chat-view `src/demo/SqlTempEditModal.vue`：
// 外部用 ref 调 open(record) / open()，保存成功后 emit('saved') 让列表页回查第一页。
//
// 与旧版的三处有意偏差（都是旧版缺陷，交付说明里单列）：
// 1. 旧版 submit 不看校验结果，模板名称为空照样提交、照样提示「提交成功」；这里 required 直接拦下。
// 2. 旧版编辑时把整行（含 createTime/updateTime/delFlag）原样 POST 回去；只提交表单字段 + id 更干净。
// 3. 旧版保存失败固定提示「提交失败」，把后端的 msg 丢了；这里直接展示后端原文（实测增量更新报的就是真因）。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { TemplateRow } from '@/api/types/template'
import type { TemplateField, TemplateListApi } from './types'

const props = withDefaults(
  defineProps<{
    fields: TemplateField[]
    api: TemplateListApi
    addTitle: string
    editTitle: string
    /** 新增态的默认值（旧 SqlTempEditModal 打开新增即 status:'0'） */
    defaults?: Record<string, unknown>
  }>(),
  { defaults: () => ({}) },
)

const emit = defineEmits<{ (e: 'saved', payload: { mode: 'add' | 'edit'; id?: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const recordId = ref<number | undefined>()
const form = reactive<Record<string, any>>({})

const title = computed(() => (recordId.value == null ? props.addTitle : props.editTitle))

/** 打开弹窗：传 record = 编辑（带 id），不传 = 新增（用 defaults 起步）。 */
function open(record?: Record<string, unknown> | null) {
  Object.keys(form).forEach((key) => delete form[key])
  recordId.value = record?.id == null ? undefined : Number(record.id)
  props.fields.forEach((field) => {
    // 后端给的 null/undefined 归一成空串，否则输入框显示成 "null"
    form[field.prop] = record?.[field.prop] ?? ''
  })
  if (recordId.value == null) Object.assign(form, props.defaults)
  if (recordId.value != null) form.id = recordId.value
  visible.value = true
}

function close() {
  visible.value = false
}

async function submit() {
  const missing = props.fields.find((field) => field.required && String(form[field.prop] ?? '').trim() === '')
  if (missing) {
    ElMessage.warning(`请填写${missing.label}`)
    return
  }
  const payload: Record<string, unknown> = {}
  props.fields.forEach((field) => {
    payload[field.prop] = form[field.prop]
  })
  if (recordId.value != null) payload.id = recordId.value

  saving.value = true
  try {
    await props.api.save(payload as Partial<TemplateRow>)
    ElMessage.success('提交成功')
    visible.value = false
    emit('saved', { mode: recordId.value == null ? 'add' : 'edit', id: recordId.value })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '提交失败')
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
    width="900px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="tpl-dialog"
  >
    <el-form class="tpl-form" label-width="130px" @submit.prevent>
      <el-form-item v-for="field in fields" :key="field.prop" :label="field.label" :required="field.required">
        <el-input v-if="!field.type || field.type === 'input'" v-model="form[field.prop]" :placeholder="field.placeholder || '请输入'" clearable />
        <el-input
          v-else-if="field.type === 'textarea'"
          v-model="form[field.prop]"
          type="textarea"
          :rows="field.rows ?? 3"
          :placeholder="field.placeholder || '请输入'"
          resize="vertical"
        />
        <el-select v-else-if="field.type === 'select'" v-model="form[field.prop]" :placeholder="field.placeholder || '请选择'">
          <el-option v-for="opt in field.options ?? []" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <!-- radio：旧版「状态」用 a-radio-group（启用/禁用两项都摆在眼前），这里不换成开关 -->
        <el-radio-group v-else v-model="form[field.prop]">
          <el-radio v-for="opt in field.options ?? []" :key="opt.value" :value="opt.value">{{ opt.label }}</el-radio>
        </el-radio-group>
        <div v-if="field.tip" class="tpl-field-tip">{{ field.tip }}</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线：弹窗正文自己滚、footer 常驻，不整页滚（滚动容器约定见 AGENTS.md） */
.tpl-dialog :deep(.el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.tpl-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.tpl-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.tpl-field-tip {
  margin-top: 2px;
  color: var(--rc-muted, #94a3b8);
  font-size: 11px;
  line-height: 1.5;
}
</style>
