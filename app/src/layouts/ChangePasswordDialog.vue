<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { changePassword, encPassword } from '../api/auth'
import { useAuthStore } from '../stores/auth'

// 修改密码弹窗：交互与文案 1:1 迁移旧 components/tools/UserMenu.vue（计划 §11）；
// 哈希入参必须用 auth store 的 name（旧 nickname = user-info 的 name），不是登录账号输入值。

const visible = defineModel<boolean>({ required: true })

const auth = useAuthStore()
const formRef = ref<FormInstance>()
const form = reactive({ oldPwd: '', newPwd: '', newPwd2: '' })
const loading = ref(false)

// 旧规则：newPwd2 无 required，仅一致性校验（新密码已填、确认为空时同样报不一致）
const rules: FormRules = {
  oldPwd: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPwd: [{ required: true, message: '请输入新密码', trigger: 'blur' }],
  newPwd2: [
    {
      validator: (_rule, _value, callback) => {
        if (form.newPwd !== form.newPwd2) {
          callback(new Error('两次输入的密码不相同'))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ],
}

function resetForm() {
  form.oldPwd = ''
  form.newPwd = ''
  form.newPwd2 = ''
  formRef.value?.clearValidate()
}

function handleCancel() {
  visible.value = false
  // @close 会触发 resetForm，无需重复调用
}

async function handleSubmit() {
  if (loading.value) return
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    // 旧 submitChangePwd：md5(nickname + 明文)，单层、无盐
    await changePassword(encPassword(auth.name, form.oldPwd), encPassword(auth.name, form.newPwd))
    ElMessage.success('密码修改成功')
    visible.value = false
    resetForm()
  } catch (e) {
    // 旧文案：修改密码出错, 原因: <err>；弹窗保持打开
    ElMessage.error('修改密码出错, 原因: ' + ((e as Error).message || e))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="cpwd-dialog"
    title="修改密码"
    width="520px"
    :close-on-click-modal="false"
    @close="resetForm"
  >
    <el-form
      ref="formRef"
      class="cpwd-form"
      :model="form"
      :rules="rules"
      label-width="90px"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="原密码" prop="oldPwd">
        <el-input v-model="form.oldPwd" type="password" autocomplete="current-password" />
      </el-form-item>
      <el-form-item label="新密码" prop="newPwd">
        <el-input v-model="form.newPwd" type="password" autocomplete="new-password" />
      </el-form-item>
      <el-form-item label="确认密码" prop="newPwd2">
        <el-input v-model="form.newPwd2" type="password" autocomplete="new-password" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="handleCancel">取 消</el-button>
      <el-button type="primary" :loading="loading" @click="handleSubmit">确 定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 保留原有横向布局，压缩密码表单的纵向间距。 */
.cpwd-form {
  max-width: 400px;
  margin: 0 auto;
}

.cpwd-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.cpwd-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.cpwd-form :deep(.el-input__wrapper) {
  min-height: 36px;
}

.cpwd-dialog :deep(.el-dialog__body) {
  padding-top: 16px;
  padding-bottom: 16px;
}

.cpwd-dialog :deep(.el-dialog__footer) {
  padding-top: 12px;
  padding-bottom: 16px;
}
</style>
