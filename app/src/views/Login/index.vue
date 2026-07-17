<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, Hide, Lock, Refresh, User, View } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { encPassword, getCodeImg, type LoginParams } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'
import companyLogo from '../../assets/brand/company-logo.png'
import loginHero from '../../assets/brand/login-hero.png'

// 登录页：交互与旧 data-view views/user/Login.vue 一致（账号/密码/图片验证码、点击刷新、
// 失败显示后端文案并 1s 后换码、Enter 提交）；视觉按 2026-07-17 客户样例稿（品牌栏 + 左插画 + 右卡片）。

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

// 旧代码在 loginSuccess/requestFailed 里安排的延迟刷码，组件卸载后不应再执行
let refreshTimer: ReturnType<typeof setTimeout> | undefined

async function getCode() {
  try {
    const res = await getCodeImg()
    // 服务端实际返回 JPEG，但旧代码硬编码 gif 前缀且浏览器兼容，保持原样（计划 §1.5.4）
    codeUrl.value = 'data:image/gif;base64,' + res.data.img
    uid.value = res.data.uid
  } catch (e) {
    errorMsg.value = (e as Error).message || '验证码获取失败'
  }
}

// 旧 handleUsernameOrEmail：命中邮箱正则按 email 字段提交，否则按 username
const emailRegex = /^([a-zA-Z0-9_-])+@([a-zA-Z0-9_-])+((\.[a-zA-Z0-9_-]{2,3}){1,2})$/

async function handleSubmit() {
  // 请求中再触发 submit（如 Enter 连按）直接忽略，保证只发一次登录请求；
  // 与旧代码一致，先置 loading 再校验，堵住并发 submit 都穿过校验的缝隙
  if (loading.value) return
  loading.value = true
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) {
    loading.value = false
    return
  }
  const params: LoginParams = {
    [emailRegex.test(form.username) ? 'email' : 'username']: form.username,
    // 双 MD5：md5(md5(原始输入账号 + 明文密码) + '-' + uid)，账号用输入原值
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
    // 旧 requestFailed：失败后约 1s 刷新验证码
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => void getCode(), 1000)
  } finally {
    loading.value = false
  }
}

onMounted(() => void getCode())
</script>

<template>
  <div class="lg-page">
    <header class="lg-topbar">
      <img class="lg-logo" :src="companyLogo" alt="" />
      <strong>智能采集中心</strong>
    </header>

    <div class="lg-body">
      <section class="lg-hero" aria-label="智能采集中心">
        <div class="lg-hero-copy">
          <h1>智能采集中心</h1>
          <p>高效采集 · 智能解析 · 数据驱动未来</p>
          <span aria-hidden="true"></span>
        </div>
        <img :src="loginHero" alt="智能采集中心数据安全与分析平台插画" />
      </section>

      <div class="lg-card">
        <h1>欢迎登录</h1>
        <p class="lg-sub">登录智能采集中心，开启高效采集之旅</p>

        <el-alert v-if="errorMsg" class="lg-error" type="error" :title="errorMsg" show-icon :closable="false" />

        <!-- el-form 自身渲染 <form>：submit 监听从这里透传，按钮放在表单内保证 Enter 隐式提交 -->
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
            <div class="lg-captcha-row">
              <el-input v-model="form.code" placeholder="请输入验证码" :prefix-icon="CircleCheck" />
              <button v-if="codeUrl" class="lg-captcha-img" type="button" title="点击刷新验证码" @click="getCode">
                <img :src="codeUrl" alt="验证码" />
              </button>
              <div v-else class="lg-captcha-img lg-captcha-empty">加载中</div>
              <button class="lg-captcha-refresh" type="button" aria-label="刷新验证码" @click="getCode">
                <el-icon><Refresh /></el-icon>
              </button>
            </div>
          </el-form-item>

          <el-button class="lg-submit" type="primary" native-type="submit" :loading="loading">登 录</el-button>
        </el-form>
      </div>
    </div>

    <footer class="lg-footer">
      <nav>
        <a href="_self">帮助中心</a>
        <span>|</span>
        <a href="_self">隐私政策</a>
        <span>|</span>
        <a href="_self">服务条款</a>
      </nav>
      <p>Copyright © 智能采集中心 版权所有</p>
    </footer>
  </div>
</template>

<style scoped>
.lg-page {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(60% 42% at 46% 100%, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.7) 45%, transparent 78%),
    radial-gradient(
      48% 52% at 24% 49%,
      #fff 0%,
      rgba(255, 255, 255, 0.98) 58%,
      rgba(255, 255, 255, 0.72) 78%,
      transparent 100%
    ),
    linear-gradient(135deg, #f1f4fa 0%, #eef1f9 48%, #e7edf8 100%);
}

.lg-topbar {
  position: absolute;
  z-index: 2;
  top: 34px;
  left: 32px;
  display: flex;
  align-items: center;
  gap: 15px;
}

.lg-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
  mix-blend-mode: multiply;
  transform: scale(1.28);
}

.lg-topbar strong {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #0a2450;
}

.lg-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(520px, 1fr) 648px;
  align-items: center;
  gap: 26px;
  width: min(100%, 1528px);
  margin: 0 auto;
  padding: 105px 57px 133px 32px;
}

.lg-hero {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  padding-top: 91px;
  transform: translateX(-61px);
}

.lg-hero-copy {
  position: relative;
  z-index: 1;
  text-align: center;
}

.lg-hero-copy h1 {
  margin: 0;
  color: #0b2856;
  font-size: 42px;
  line-height: 1.25;
  font-weight: 700;
  letter-spacing: 3px;
}

.lg-hero-copy p {
  margin: 19px 0 0;
  color: #5a6b88;
  font-size: 18px;
  line-height: 1.5;
  letter-spacing: 0.5px;
}

.lg-hero-copy span {
  display: block;
  width: 38px;
  height: 5px;
  margin: 20px auto 0;
  border-radius: 999px;
  background: #2f74ee;
}

.lg-hero > img {
  width: min(100%, 752px);
  height: 500px;
  margin-top: -12px;
  mix-blend-mode: multiply;
  object-fit: cover;
  object-position: center 48%;
  user-select: none;
  pointer-events: none;
}

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

.lg-captcha-row {
  display: grid;
  grid-template-columns: minmax(0, 270px) minmax(0, 1fr) 55px;
  width: 100%;
}

.lg-captcha-row .el-input {
  min-width: 0;
}

.lg-captcha-img {
  position: relative;
  z-index: 1;
  min-width: 0;
  margin-left: 38px;
  padding: 0;
  border: 1px solid #d7dee9;
  border-right: 0;
  border-radius: 7px 0 0 7px;
  overflow: hidden;
  background: #f8fafc;
  cursor: pointer;
}

.lg-captcha-img:focus-visible {
  outline: 0;
}

.lg-captcha-img img {
  display: block;
  width: 100%;
  height: 66px;
  clip-path: inset(2px 0);
  object-fit: cover;
}

.lg-captcha-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--rc-faint);
  font-size: 12px;
  cursor: default;
}

.lg-captcha-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 55px;
  padding: 0;
  border: 1px solid #d7dee9;
  border-radius: 0 7px 7px 0;
  background: rgba(255, 255, 255, 0.82);
  color: #7d8da8;
  font-size: 23px;
  cursor: pointer;
}

.lg-captcha-refresh:hover {
  color: #2f74ee;
  border-color: #b9c7db;
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

.lg-footer {
  position: absolute;
  z-index: 2;
  bottom: 45px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  color: #596983;
  font-size: 16px;
  white-space: nowrap;
}

.lg-footer nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
}

.lg-footer nav span {
  color: #9ba7ba;
}

.lg-footer a {
  color: #52627c;
  text-decoration: none;
}

.lg-footer a:hover {
  color: #2f74ee;
}

.lg-footer p {
  margin: 16px 0 0;
}

@media (max-width: 1500px) {
  .lg-topbar {
    top: 28px;
    left: 28px;
    gap: 12px;
  }

  .lg-logo {
    width: 34px;
    height: 34px;
  }

  .lg-topbar strong {
    font-size: clamp(22px, 2.2vw, 26px);
  }

  .lg-body {
    grid-template-columns: minmax(360px, 1fr) clamp(480px, 44vw, 620px);
    gap: clamp(18px, 2vw, 26px);
    padding: clamp(78px, 10vh, 96px) 30px clamp(88px, 12vh, 110px);
  }

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

  .lg-captcha-row {
    grid-template-columns: minmax(0, 52%) minmax(0, 1fr) 50px;
  }

  .lg-captcha-img {
    margin-left: clamp(16px, 2vw, 24px);
  }

  .lg-captcha-img img {
    height: clamp(54px, 4.7vw, 60px);
  }

  .lg-captcha-refresh {
    min-width: 50px;
    font-size: 21px;
  }

  .lg-submit {
    height: clamp(56px, 4.8vw, 62px);
    margin-top: clamp(8px, 1.5vh, 14px);
    font-size: 18px;
  }

  .lg-hero-copy h1 {
    font-size: clamp(30px, 3vw, 36px);
  }

  .lg-hero-copy p {
    margin-top: 14px;
    font-size: 16px;
  }

  .lg-hero-copy span {
    height: 4px;
    margin-top: 16px;
  }

  .lg-hero {
    padding-top: clamp(46px, 7vh, 66px);
    transform: translateX(-20px);
  }

  .lg-hero > img {
    width: min(100%, 640px);
    height: clamp(340px, 45vh, 430px);
    margin-top: -6px;
  }

  .lg-footer {
    bottom: clamp(24px, 4vh, 38px);
    font-size: 14px;
  }

  .lg-footer p {
    margin-top: 12px;
  }
}

@media (max-width: 960px) {
  .lg-page {
    height: auto;
    min-height: 100vh;
    overflow: auto;
  }

  .lg-topbar {
    top: 24px;
    left: 24px;
  }

  .lg-logo {
    width: 32px;
    height: 32px;
  }

  .lg-topbar strong {
    font-size: 22px;
  }

  .lg-body {
    display: flex;
    justify-content: center;
    padding: 88px 20px 116px;
  }

  .lg-hero {
    display: none;
    transform: none;
  }

  .lg-card {
    width: min(100%, 500px);
  }
}

@media (max-width: 560px) {
  .lg-topbar {
    top: 20px;
    left: 20px;
  }

  .lg-body {
    align-items: flex-start;
    padding: 88px 12px 128px;
  }

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

  .lg-captcha-row {
    grid-template-columns: minmax(0, 1fr) 110px 44px;
  }

  .lg-captcha-row :deep(.el-input__wrapper) {
    padding-inline: 14px;
  }

  .lg-captcha-row :deep(.el-input__prefix) {
    margin-right: 8px;
  }

  .lg-captcha-row :deep(.el-input__inner) {
    font-size: 15px;
  }

  .lg-captcha-img {
    margin-left: 8px;
  }

  .lg-captcha-img img {
    height: 56px;
  }

  .lg-submit {
    height: 58px;
    margin-top: 10px;
  }

  .lg-footer {
    bottom: 24px;
    font-size: 12px;
  }

  .lg-footer nav {
    gap: 12px;
  }

  .lg-footer p {
    margin-top: 10px;
  }
}

@media (max-height: 900px) and (min-width: 1501px) {
  .lg-topbar {
    top: 26px;
    left: 28px;
    gap: 12px;
  }

  .lg-logo {
    width: 34px;
    height: 34px;
  }

  .lg-topbar strong {
    font-size: 24px;
  }

  .lg-body {
    grid-template-columns: minmax(520px, 1fr) 560px;
    gap: 24px;
    width: min(100%, 1420px);
    padding: 74px 57px 180px 32px;
  }

  .lg-hero {
    padding-top: 48px;
    transform: translateX(-40px);
  }

  .lg-hero-copy h1 {
    font-size: 36px;
  }

  .lg-hero-copy p {
    margin-top: 14px;
    font-size: 16px;
  }

  .lg-hero-copy span {
    height: 4px;
    margin-top: 16px;
  }

  .lg-hero > img {
    width: min(100%, 650px);
    height: 400px;
    margin-top: -6px;
  }

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

  .lg-captcha-row {
    grid-template-columns: minmax(0, 52%) minmax(0, 1fr) 50px;
  }

  .lg-captcha-img {
    margin-left: 20px;
  }

  .lg-captcha-img img {
    height: 56px;
  }

  .lg-captcha-refresh {
    min-width: 50px;
    font-size: 21px;
  }

  .lg-submit {
    height: 58px;
    margin-top: 10px;
    font-size: 18px;
  }

  .lg-footer {
    bottom: 18px;
    font-size: 14px;
  }

  .lg-footer nav {
    gap: 22px;
  }

  .lg-footer p {
    margin-top: 10px;
  }
}
</style>
