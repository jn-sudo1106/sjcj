<script setup lang="ts">
// 「导出 ▾」：当前页 CSV / Excel / 取数 API。源数据视图与数据中心共用（1008-07）。
// 数据中心的「导出 Excel」在一级按钮上（0930-14D 定的），菜单里不再放，传 :show-excel="false"。
withDefaults(defineProps<{
  compact?: boolean
  pageDisabled?: boolean
  showExcel?: boolean
  excelLabel?: string
  /** 非空即禁用，同时作为该项的 title */
  excelReason?: string
  /** 可点时该项的 title */
  excelHint?: string
  apiDisabled?: boolean
  /** 触发按钮的 data-testid；页面上另有同名按钮（数据中心的一级「导出 Excel」）时改掉 */
  triggerTestid?: string
}>(), {
  showExcel: true,
  excelLabel: '导出当前源 Excel',
  excelReason: '',
  excelHint: '导出当前表中属于当前源的数据，保留状态筛选，不限当前页',
  triggerTestid: 'data-export',
})
const emit = defineEmits<{ 'export-page': []; 'export-excel': []; 'show-api': [] }>()
</script>

<template>
  <el-dropdown trigger="click">
    <button class="rc-btn" :class="{ 'is-compact': compact }" type="button" :data-testid="triggerTestid">导出 ▾</button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item data-testid="data-export-page" :disabled="pageDisabled" title="导出已查询的当前页全部字段" @click="emit('export-page')">导出当前页 CSV</el-dropdown-item>
        <el-dropdown-item v-if="showExcel" data-testid="data-export-excel" :disabled="!!excelReason" :title="excelReason || excelHint" @click="emit('export-excel')">{{ excelLabel }}</el-dropdown-item>
        <el-dropdown-item data-testid="data-export-api" :disabled="apiDisabled" @click="emit('show-api')">取数 API</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.rc-btn.is-compact { height: 28px; padding: 0 10px; font-size: 12px; }
</style>
