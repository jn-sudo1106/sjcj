<script setup lang="ts">
// 系统设置 → 分类目录（0924-03）。内容就是 CategoryManager，整页展示；
// 采集资产那边的分类下拉在进页面 / 切回 tab 时会静默重拉，这里改完不用通知它。
import CategoryManager from '@/components/category/CategoryManager.vue'
</script>

<template>
  <div class="st-category" data-testid="settings-category">
    <CategoryManager />
  </div>
</template>

<style scoped>
.st-category { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
