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
  /* 验证码区高度与它左侧的间距；各断点只改这两个变量 */
  --captcha-h: 66px;
  --captcha-gap: 16px;
  /* 验证码列宽 = 图裁边后的可见宽度：原图 4:1，上下各裁 4%、左右各裁 1.5%，
     可见区高度等于框高时，可见宽 = 框高 × 4/0.92 × 0.97 ≈ 框高 × 4.217；输入框占剩余宽度 */
  --captcha-col: calc(var(--captcha-h) * 4.217 + var(--captcha-gap));
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--captcha-col) 55px;
  width: 100%;
}

.lg-captcha-row .el-input {
  min-width: 0;
}

.lg-captcha-img {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: calc(var(--captcha-h) + 2px);
  margin-left: var(--captcha-gap);
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
  /* 原图 200×50，四周有 1~2px 绿色细边，左右还有一段空底。元素始终保持 4:1（与图片内容重合），
     clip-path 裁掉上下各 4%（≈2px 绿边）、左右各 1.5%。
     宽度取「裁边后高度正好等于框高」的尺寸（框高 / 0.92 × 4），裁掉的部分正好落在框外，框里只剩验证码；
     框比这个窄时（手机）退到 103.1% 框宽，即裁边后可见宽度等于框宽，数字左右不会被裁。
     不用 cover：cover 会按框宽放大、上下裁掉数字（a8fb55e 修的就是这个）。 */
  display: block;
  flex: none;
  width: min(calc(var(--captcha-h) * 4 / 0.92), 103.1%);
  height: auto;
  aspect-ratio: 4 / 1;
  clip-path: inset(4% 1.5%);
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
    --captcha-h: clamp(54px, 4.7vw, 60px);
    --captcha-gap: clamp(10px, 1.2vw, 16px);
    grid-template-columns: minmax(0, 1fr) var(--captcha-col) 50px;
  }

  .lg-captcha-refresh {
    min-width: 50px;
    font-size: 21px;
  }
}

@media (max-width: 560px) {
  .lg-captcha-row {
    /* 手机：框与输入框同高（56 + 2），宽度最多占 45%，图按框宽缩放（数字完整，上下留浅灰底） */
    --captcha-h: 56px;
    --captcha-gap: 8px;
    grid-template-columns: minmax(0, 1fr) min(var(--captcha-col), 45%) 44px;
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

}

@media (max-height: 900px) and (min-width: 1501px) {
  .lg-captcha-row {
    --captcha-h: 56px;
    grid-template-columns: minmax(0, 1fr) var(--captcha-col) 50px;
  }

  .lg-captcha-refresh {
    min-width: 50px;
    font-size: 21px;
  }
}
</style>
