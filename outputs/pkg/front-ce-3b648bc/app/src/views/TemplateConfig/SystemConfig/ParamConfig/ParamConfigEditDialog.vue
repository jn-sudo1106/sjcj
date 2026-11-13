<script setup lang="ts">
// 参数设置编辑弹窗（1:1 对齐旧 ai-chat-view `src/system/config/modules/ConfigEditForm.vue`）。
//
// 旧口径：
// · 只有「修改」有入口（旧列表 handleAdd 指向不存在的 configAddForm ref，是死代码），
//   打开前先从 GET /poc/system/config/{configId} 拉详情回填表单（由列表页负责取数）；
// · 五个字段：参数编码 / 参数名称 / 参数值 / 是否内置参数（radio Y/N）/ 备注（textarea）；
// · 必填校验三条，文案「参数名称不能为空 / 参数编码不能为空 / 参数值不能为空」（el-form rules 照搬）；
// · 保存 POST /poc/system/config（saveConfig，body 整个表单含 id），成功提示「修改成功」。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版「是否内置参数」的选项数组 typeOptions 由父组件传入，但父组件从未加载字典、恒为空数组，
//    选项实际渲染不出来（只能保持详情带回的原值）；这里按旧语义补 是(Y)/否(N) 两个选项（见 options.ts）。
// 2. 旧版 rules 里挂了 checkConfigKeyUnique 自定义校验，但该校验方法本体在旧文件里已被注释掉、
//    且完整实现残留在没有任何 import 的 modules/ConfigForm.js 中 —— 旧版实际不会做编码唯一校验。
//    不迁这段死代码；若后端有唯一约束，冲突会由保存请求的 msg 直接透出。
// 3. 旧版提交不看请求错误（saveConfig 的 then 无 catch，失败静默）；这里失败透出后端 msg。
// 4. 旧版必填只挡空串，纯空白（'  '）能存进库；这里纯空白同样拦下。
//    ⚠️ 拦截不能只靠 rules 的 whitespace：Element Plus 2.14.2 实测 form.validate() 对
//    whitespace 规则**放行**（form-item 级校验会拒，但 reject 值不带 fields，form 级把它当通过吞掉），
//    连空串都可能放行。所以保存前先用旧文案手工 trim 校验兜底，rules 只负责 blur 时的红字提示
//    （与旧版 UI 一致），先例见分词/数据字典弹窗的同类兜底。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { systemConfigApi } from '@/api/templateConfig'
import type { SystemConfigParam } from '@/api/types/template'
import { SYSTEM_CONFIG_TYPE_OPTIONS } from './options'

const emit = defineEmits<{ (e: 'saved', payload: { id: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance | null>(null)
const recordId = ref<number | undefined>()

const form = reactive({
  configKey: '',
  configName: '',
  configValue: '',
  configType: 'Y',
  remark: '',
})

// 必填文案照旧 ConfigEditForm 的 rules（trigger blur，红字提示用）；实际拦截见 submit 的手工兜底
const rules: FormRules = {
  configName: [{ required: true, whitespace: true, message: '参数名称不能为空', trigger: 'blur' }],
  configKey: [{ required: true, whitespace: true, message: '参数编码不能为空', trigger: 'blur' }],
  configValue: [{ required: true, whitespace: true, message: '参数值不能为空', trigger: 'blur' }],
}

/** 打开弹窗：record 是列表页先走 detail() 拉回的详情（本弹窗只有编辑入口，record 必给） */
function open(record: SystemConfigParam) {
  recordId.value = record.id == null ? undefined : Number(record.id)
  form.configKey = record.configKey == null ? '' : String(record.configKey)
  form.configName = record.configName == null ? '' : String(record.configName)
  form.configValue = record.configValue == null ? '' : String(record.configValue)
  // 旧表单默认 'Y'；详情回了非空值则回填原值
  form.configType = record.configType == null || String(record.configType) === '' ? 'Y' : String(record.configType)
  form.remark = record.remark == null ? '' : String(record.remark)
  visible.value = true
  // 旧版每次打开都重置校验态（resetFields）；这里清掉上一次的红字
  formRef.value?.clearValidate()
}

function close() {
  visible.value = false
}

async function submit() {
  if (recordId.value == null) return
  // EP 2.14.2 的 form.validate() 连空白/空串都可能放行（见文件头偏差 4），先手工拦一遍
  if (!form.configName.trim()) {
    ElMessage.warning('参数名称不能为空')
    return
  }
  if (!form.configKey.trim()) {
    ElMessage.warning('参数编码不能为空')
    return
  }
  if (!form.configValue.trim()) {
    ElMessage.warning('参数值不能为空')
    return
  }
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    await systemConfigApi.save({
      id: recordId.value,
      configKey: form.configKey,
      configName: form.configName,
      configValue: form.configValue,
      configType: form.configType,
      remark: form.remark,
    })
    ElMessage.success('修改成功')
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
    title="修改参数"
    width="800px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="sc-param-edit-dialog"
  >
    <el-form ref="formRef" class="sc-param-edit-form" label-width="110px" :model="form" :rules="rules" @submit.prevent>
      <el-form-item label="参数编码" prop="configKey">
        <el-input v-model="form.configKey" placeholder="请输入" class="sc-param-field" />
      </el-form-item>
      <el-form-item label="参数名称" prop="configName">
        <el-input v-model="form.configName" placeholder="请输入" class="sc-param-field" />
      </el-form-item>
      <el-form-item label="参数值" prop="configValue">
        <el-input v-model="form.configValue" placeholder="请输入" class="sc-param-field" />
      </el-form-item>
      <el-form-item label="是否内置参数" prop="configType">
        <el-radio-group v-model="form.configType">
          <el-radio-button v-for="option in SYSTEM_CONFIG_TYPE_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="备注" prop="remark">
        <el-input v-model="form.remark" type="textarea" :rows="3" placeholder="请输入备注" class="sc-param-field" />
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
:global(.sc-param-edit-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.sc-param-edit-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.sc-param-edit-form :deep(.el-form-item) {
  margin-bottom: 14px;
}
.sc-param-edit-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.sc-param-field {
  width: 100%;
}
</style>
