<script setup lang="ts">
// 登录页底部（P3 收尾 · Login 拆分）
// 职责：帮助/隐私/服务条款链接 + 版权信息
</script>

<template>
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
</template>

<style scoped>
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
  .lg-footer {
    bottom: clamp(24px, 4vh, 38px);
    font-size: 14px;
  }

  .lg-footer p {
    margin-top: 12px;
  }
}

@media (max-width: 560px) {
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
  .lg-footer {
    bottom: 18px;
    font-size: 14px;
  }

  .lg-footer p {
    margin-top: 10px;
  }

  .lg-footer nav {
    gap: 22px;
  }
}
</style>
