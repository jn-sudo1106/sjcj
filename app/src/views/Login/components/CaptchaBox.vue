<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'

defineProps<{
  codeUrl: string
}>()

const emit = defineEmits<{
  'refresh': []
}>()
</script>

<template>
  <div class="lg-captcha-row">
    <slot />
    <button v-if="codeUrl" class="lg-captcha-img" type="button" title="点击刷新验证码" @click="emit('refresh')">
      <img :src="codeUrl" alt="验证码" />
    </button>
    <div v-else class="lg-captcha-img lg-captcha-empty">加载中</div>
    <button class="lg-captcha-refresh" type="button" aria-label="刷新验证码" @click="emit('refresh')">
      <el-icon><Refresh /></el-icon>
    </button>
  </div>
</template>

<style scoped>
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
  z-index: 2;
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

@media (max-width: 1500px) {
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
}

@media (max-width: 560px) {
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
}

@media (max-height: 900px) and (min-width: 1501px) {
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
}
</style>
