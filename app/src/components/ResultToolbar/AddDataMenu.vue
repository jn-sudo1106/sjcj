<script setup lang="ts">
// 「新增 ▾」：手工录入 / Excel 导入。源数据视图与数据中心共用同一个入口（1008-07），
// 菜单项与 data-testid 以源数据视图为准，避免两边的新增入口再分叉。
defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ manual: []; import: [] }>()
</script>

<template>
  <el-dropdown trigger="click">
    <button class="rc-btn" :class="{ 'is-compact': compact }" type="button" data-testid="data-add">新增 ▾</button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item data-testid="data-add-manual" @click="emit('manual')">手工录入</el-dropdown-item>
        <el-dropdown-item data-testid="data-add-import" @click="emit('import')">Excel 导入</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
/* 紧凑尺寸跟 ResultView 工具条一致（那边的 .ctx-summary .rc-btn 是 scoped，管不到子组件里的按钮） */
.rc-btn.is-compact { height: 28px; padding: 0 10px; font-size: 12px; }
</style>
