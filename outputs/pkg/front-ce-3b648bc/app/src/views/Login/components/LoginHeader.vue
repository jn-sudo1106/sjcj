<script setup lang="ts">
// 登录页头部（P3 收尾 · Login 拆分）
// 职责：左上角品牌 logo + 应用名
import companyLogo from '@/assets/brand/company-logo.png'
</script>

<template>
  <header class="lg-topbar">
    <img class="lg-logo" :src="companyLogo" alt="" />
    <strong>智能采集中心</strong>
  </header>
</template>

<style scoped>
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
}

@media (max-width: 960px) {
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
}

@media (max-width: 560px) {
  .lg-topbar {
    top: 20px;
    left: 20px;
  }
}
</style>
