<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, Hide, Lock, User, View } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { encPassword, getCodeImg, type LoginParams } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import CaptchaBox from './CaptchaBox.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const formRef = ref<FormInstance>()
const form = reactive({ username: '', password: '', code: '' })
const rules: FormRules = {
  username: [{ required: true, message: '请输入帐户名或邮箱地址', trigger: 'change' }],
  password: [{ required: true, message: '请输入密码', trigger: 'change' }],
  code: [{ required: true, message: '请输入验证码', trigger: 'change' }],
}

const codeUrl = ref('')
const uid = ref('')
const loading = ref(false)
const errorMsg = ref('')
const passwordVisible = ref(false)

let refreshTimer: ReturnType<typeof setTimeout> | undefined

async function getCode() {
  try {
    const res = await getCodeImg()
    codeUrl.value = 'data:image/gif;base64,' + res.data.img
    uid.value = res.data.uid
  } catch (e) {
    errorMsg.value = (e as Error).message || '验证码获取失败'
  }
}

const emailRegex = /^([a-zA-Z0-9_-])+@([a-zA-Z0-9_-])+((\.[a-zA-Z0-9_-]{2,3}){1,2})$/

async function handleSubmit() {
  if (loading.value) return
  loading.value = true
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) {
    loading.value = false
    return
  }
  const params: LoginParams = {
    [emailRegex.test(form.username) ? 'email' : 'username']: form.username,
    password: encPassword(encPassword(form.username, form.password), '-' + uid.value),
    code: form.code,
  } as LoginParams
  try {
    await auth.login(params)
    errorMsg.value = ''
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    await router.push(redirect || '/overview')
  } catch (e) {
    errorMsg.value = (e as Error).message || '登录异常,请稍后再说'
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void getCode(), 1000)
  } finally {
    loading.value = false
  }
}

onMounted(() => void getCode())
onUnmounted(() => clearTimeout(refreshTimer))
</script>

<template>
  <div class="lg-card">
    <h1>欢迎登录</h1>
    <p class="lg-sub">登录智能采集中心，开启高效采集之旅</p>

    <el-alert v-if="errorMsg" class="lg-error" type="error" :title="errorMsg" show-icon :closable="false" />

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      size="large"
      hide-required-asterisk
      @submit.prevent="handleSubmit"
    >
      <el-form-item prop="username">
        <el-input v-model="form.username" placeholder="请输入账号" :prefix-icon="User" autocomplete="username" />
      </el-form-item>
      <el-form-item prop="password">
        <el-input
          v-model="form.password"
          :type="passwordVisible ? 'text' : 'password'"
          placeholder="请输入密码"
          :prefix-icon="Lock"
          autocomplete="current-password"
        >
          <template #suffix>
            <button
              class="lg-password-toggle"
              type="button"
              :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
              @click="passwordVisible = !passwordVisible"
            >
              <el-icon><View v-if="passwordVisible" /><Hide v-else /></el-icon>
            </button>
          </template>
        </el-input>
      </el-form-item>
      <el-form-item prop="code">
        <CaptchaBox :code-url="codeUrl" @refresh="getCode">
          <el-input v-model="form.code" placeholder="验证码" :prefix-icon="CircleCheck" />
        </CaptchaBox>
      </el-form-item>

      <el-button class="lg-submit" type="primary" native-type="submit" :loading="loading">登 录</el-button>
    </el-form>
  </div>
</template>

<style scoped>
.lg-card {
  width: 648px;
  min-height: 646px;
  padding: 62px 61px 58px;
  border: 1px solid rgba(255, 255, 255, 0.82);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.93);
  box-shadow: 0 18px 50px rgba(46, 83, 140, 0.1);
  backdrop-filter: blur(12px);
}

.lg-card h1 {
  margin: 0;
  text-align: center;
  font-size: 30px;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: 1px;
  color: #0a2450;
}

.lg-sub {
  margin: 12px 0 50px;
  text-align: center;
  font-size: 17px;
  line-height: 1.6;
  color: #63738d;
}

.lg-error {
  margin: -34px 0 16px;
}

.lg-card :deep(.el-form-item) {
  margin-bottom: 28px;
}

.lg-card :deep(.el-input__wrapper) {
  min-height: 68px;
  padding: 1px 20px;
  border-radius: 7px;
  box-shadow: 0 0 0 1px #d7dee9 inset;
  background: rgba(255, 255, 255, 0.78);
}

.lg-card :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #b9c7db inset;
}

.lg-card :deep(.el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px #5289ed inset,
    0 0 0 3px rgba(47, 116, 238, 0.1);
}

.lg-card :deep(.el-input__inner) {
  color: #23395f;
  font-size: 17px;
}

.lg-card :deep(.el-input__inner::placeholder) {
  color: #8795ae;
}

.lg-card :deep(.el-input__prefix),
.lg-card :deep(.el-input__suffix) {
  color: #7d8da8;
  font-size: 25px;
}

.lg-card :deep(.el-input__prefix) {
  margin-right: 13px;
}

.lg-password-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: inherit;
  cursor: pointer;
}

.lg-submit {
  width: 100%;
  height: 70px;
  margin-top: 20px;
  border: 0;
  border-radius: 7px;
  background: linear-gradient(180deg, #3f80f3 0%, #2164e8 100%);
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.18);
  font-size: 21px;
  font-weight: 500;
  letter-spacing: 13px;
}

.lg-submit:hover,
.lg-submit:focus {
  background: linear-gradient(180deg, #4a8af7 0%, #2a6bec 100%);
}

@media (max-width: 1500px) {
  .lg-card {
    width: 100%;
    min-height: 0;
    padding: clamp(34px, 4vh, 44px) clamp(36px, 4vw, 52px) clamp(32px, 4vh, 42px);
  }

  .lg-card h1 {
    font-size: clamp(26px, 2.4vw, 30px);
  }

  .lg-sub {
    margin: 10px 0 clamp(28px, 4vh, 38px);
    font-size: clamp(15px, 1.4vw, 17px);
  }

  .lg-card :deep(.el-form-item) {
    margin-bottom: clamp(18px, 2.4vh, 24px);
  }

  .lg-card :deep(.el-input__wrapper) {
    min-height: clamp(56px, 4.8vw, 62px);
    padding-inline: clamp(14px, 1.5vw, 18px);
  }

  .lg-card :deep(.el-input__inner) {
    font-size: 16px;
  }

  .lg-card :deep(.el-input__prefix),
  .lg-card :deep(.el-input__suffix) {
    font-size: 23px;
  }

  .lg-card :deep(.el-input__prefix) {
    margin-right: 10px;
  }

  .lg-submit {
    height: clamp(56px, 4.8vw, 62px);
    margin-top: clamp(8px, 1.5vh, 14px);
    font-size: 18px;
  }
}

@media (max-width: 960px) {
  .lg-card {
    width: min(100%, 500px);
  }
}

@media (max-width: 560px) {
  .lg-card {
    width: 100%;
    min-height: 0;
    padding: 36px 22px 30px;
    border-radius: 14px;
  }

  .lg-sub {
    margin-bottom: 34px;
    font-size: 14px;
  }

  .lg-card :deep(.el-input__wrapper) {
    min-height: 58px;
  }

  .lg-submit {
    height: 58px;
    margin-top: 10px;
  }
}

@media (max-height: 900px) and (min-width: 1501px) {
  .lg-card {
    width: 560px;
    min-height: 0;
    padding: 36px 44px 34px;
  }

  .lg-card h1 {
    font-size: 28px;
  }

  .lg-sub {
    margin: 10px 0 32px;
    font-size: 16px;
  }

  .lg-card :deep(.el-form-item) {
    margin-bottom: 20px;
  }

  .lg-card :deep(.el-input__wrapper) {
    min-height: 58px;
    padding-inline: 18px;
  }

  .lg-card :deep(.el-input__inner) {
    font-size: 16px;
  }

  .lg-card :deep(.el-input__prefix),
  .lg-card :deep(.el-input__suffix) {
    font-size: 23px;
  }

  .lg-card :deep(.el-input__prefix) {
    margin-right: 10px;
  }

  .lg-submit {
    height: 58px;
    margin-top: 10px;
    font-size: 18px;
  }
}
</style>
