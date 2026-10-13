<script setup lang="ts">
/**
 * 卡片骨架屏：替代 el-card 上的 v-loading 转圈。
 *
 * 用法是「包住真实内容」——loading 时渲染 #template 里的骨架，结束后渲染默认插槽，
 * 这样两种状态共用同一块占位，卡片高度不会跳。
 *
 * 注意：骨架的流光动画类 `.el-skeleton.is-animated .el-skeleton__item` 必须挂在 el-skeleton 上，
 * 所以 el-skeleton-item 不能脱离外层 el-skeleton 单独使用。
 */
withDefaults(
  defineProps<{
    /** 是否显示骨架 */
    loading?: boolean
    /** metric = 复刻指标卡（32px 图标 + 标签/数值/脚注三行）；chart = 复刻图表区整块 */
    variant?: 'metric' | 'chart'
    /** variant=chart 时的骨架高度（px），应与真实图表区高度接近以避免跳动 */
    height?: number
  }>(),
  { loading: true, variant: 'metric', height: 240 },
)
</script>

<template>
  <el-skeleton :loading="loading" animated>
    <template #template>
      <div v-if="variant === 'chart'" class="cs-chart" :style="{ height: `${height}px` }">
        <el-skeleton-item variant="rect" class="cs-rect" />
      </div>
      <div v-else class="cs-metric">
        <el-skeleton-item variant="circle" class="cs-icon" />
        <div class="cs-main">
          <el-skeleton-item variant="text" class="cs-line cs-label" />
          <el-skeleton-item variant="text" class="cs-line cs-value" />
          <el-skeleton-item variant="text" class="cs-line cs-footer" />
        </div>
      </div>
    </template>
    <slot />
  </el-skeleton>
</template>

<style scoped>
/* 指标卡骨架：与 .ts-metric 同构（图标 32px + 右侧三行） */
.cs-metric {
  display: flex;
  align-items: flex-start;
}
.cs-icon {
  width: 32px;
  height: 32px;
  flex: none;
  margin-right: 10px;
}
.cs-main {
  min-width: 0;
  flex: 1;
}
.cs-line {
  display: block;
}
.cs-label {
  width: 42%;
  height: 12px;
}
.cs-value {
  width: 58%;
  height: 24px;
  margin-top: 10px;
}
.cs-footer {
  width: 76%;
  height: 11px;
  margin-top: 10px;
}

/* 图表卡骨架：一整块矩形占住图表位置 */
.cs-chart {
  display: flex;
}
.cs-rect {
  width: 100%;
  height: 100%;
}
</style>
