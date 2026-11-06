<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Lock } from '@element-plus/icons-vue'

const router = useRouter()

function goHome() {
  router.push('/')
}
</script>

<template>
  <div class="error-page">
    <div class="error-card">
      <el-icon class="error-icon"><Lock /></el-icon>
      <h1 class="error-code">403</h1>
      <p class="error-title">暂无访问权限</p>
      <p class="error-desc">您当前的账号角色未被授予访问该资源的权限，请联系管理员分配</p>
      <el-button type="primary" size="large" @click="goHome">返回首页</el-button>
    </div>
  </div>
</template>

<style scoped>
.error-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80vh;
  padding: 24px;
}
.error-card {
  text-align: center;
  background: #ffffff;
  padding: 48px;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
  max-width: 480px;
  width: 100%;
}
.error-icon {
  font-size: 64px;
  color: #ef4444;
  margin-bottom: 16px;
}
.error-code {
  font-size: 48px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 12px;
  letter-spacing: -0.02em;
}
.error-title {
  font-size: 16px;
  font-weight: 600;
  color: #334155;
  margin: 0 0 8px;
}
.error-desc {
  font-size: 14px;
  color: #64748b;
  margin: 0 0 24px;
}
</style>
