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
  /* 验证码区高度；各断点只改这个变量 */
  --captcha-h: 66px;
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: calc(var(--captcha-h) + 2px);
  margin-left: 38px;
  padding: 0;
  border: 1px solid #d7dee9;
  border-right: 0;
  border-radius: 7px 0 0 7px;
  overflow: hidden;
  /* 浅灰底：验证码图自带的灰白渐变底与它衔接，图上下留出的空白不显得是一块白框 */
  background: #e5e7eb;
  cursor: pointer;
}

.lg-captcha-img:focus-visible {
  outline: 0;
}

.lg-captcha-img img {
  /* 原图 200×50，四周有 1~2px 绿色细边。元素尺寸跟着图走（宽占满、按比例定高，太高时按高度收），
     元素边缘就是图的边缘，clip-path 按元素高度的 4%（≈原图 2px）裁掉上下绿边，框宽窄都成立。
     仍保证数字完整：cover 会放大后上下裁掉数字（a8fb55e 修的就是这个）。 */
  display: block;
  width: 100%;
  height: auto;
  max-height: 100%;
  object-fit: contain;
  clip-path: inset(4% 0);
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

  .lg-captcha-img {
    --captcha-h: clamp(54px, 4.7vw, 60px);
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

  .lg-captcha-img {
    --captcha-h: 56px;
  }
}

@media (max-height: 900px) and (min-width: 1501px) {
  .lg-captcha-row {
    grid-template-columns: minmax(0, 52%) minmax(0, 1fr) 50px;
  }

  .lg-captcha-img {
    margin-left: 20px;
  }

  .lg-captcha-img {
    --captcha-h: 56px;
  }

  .lg-captcha-refresh {
    min-width: 50px;
    font-size: 21px;
  }
}
</style>
