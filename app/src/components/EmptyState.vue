<script setup lang="ts">
// 空态占位组件（P3-1 业务组件沉淀 · plan §F.1/F.2）
//
// 替代散落的 empty pattern（3 个文件实测：Overview / TableView / SiteCardGrid）
// 三种用法：
//   1. 小提示：<EmptyState text="没有匹配的网站" />
//   2. 中等（标题+文本）：<EmptyState title="没有匹配的网站" text="调整筛选条件..." />
//   3. 大块（图标+标题+文本+操作）：<EmptyState icon="!" title="加载失败" text="..." action="重新加载" @action="onRetry" />
//
// Props:
//   icon?: string           大块模式图标字符（默认 '∅'），小/中模式不显示
//   title?: string          标题（中等/大块模式显示）
//   text: string            主文本（必填）
//   hint?: string           副文本（小灰字补充说明）
//   action?: string         操作按钮文字（不传则不显示按钮）
//   size?: 'sm' | 'md' | 'lg'  模式（默认 'md'，'sm' = 单行提示）
//
// Emits:
//   (e: 'action'): void       操作按钮点击
withDefaults(defineProps<{
  icon?: string
  title?: string
  text: string
  hint?: string
  action?: string
  size?: 'sm' | 'md' | 'lg'
}>(), {
  icon: '∅',
  title: '',
  hint: '',
  action: '',
  size: 'md',
})

const emit = defineEmits<{ (e: 'action'): void }>()
</script>

<template>
  <!-- sm 模式：单行小提示 -->
  <div v-if="size === 'sm'" class="empty-sm">
    {{ text }}
  </div>

  <!-- md 模式：标题 + 文本（无图标无按钮） -->
  <div v-else-if="size === 'md'" class="empty-md">
    <div v-if="title" class="empty-md-title">{{ title }}</div>
    <div class="empty-md-text">{{ text }}</div>
    <div v-if="hint" class="empty-md-hint">{{ hint }}</div>
  </div>

  <!-- lg 模式：图标 + 标题 + 文本 + 可选操作按钮 -->
  <div v-else class="empty-lg">
    <div class="empty-lg-icon">{{ icon }}</div>
    <div v-if="title" class="empty-lg-title">{{ title }}</div>
    <div class="empty-lg-text">{{ text }}</div>
    <button v-if="action" class="empty-lg-btn" type="button" @click="emit('action')">
      {{ action }}
    </button>
  </div>
</template>

<style scoped>
.empty-sm {
  text-align: center;
  color: var(--rc-faint);
  font-size: 12px;
  padding: 14px;
}

.empty-md {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 24px 16px;
  text-align: center;
}

.empty-md-title {
  color: var(--rc-text);
  font-size: 14px;
  font-weight: 600;
}

.empty-md-text {
  color: var(--rc-text-2);
  font-size: 13px;
  line-height: 1.5;
}

.empty-md-hint {
  margin-top: 4px;
  color: var(--rc-faint);
  font-size: 12px;
  line-height: 1.5;
}

.empty-lg {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 60px 20px;
  text-align: center;
}

.empty-lg-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fef2f2;
  color: #ef4444;
  font-size: 22px;
  font-weight: 800;
}

.empty-lg-title {
  margin-top: 8px;
  color: #0f1e46;
  font-size: 15px;
  font-weight: 700;
}

.empty-lg-text {
  color: var(--rc-text-2);
  font-size: 13px;
}

.empty-lg-btn {
  margin-top: 12px;
  height: 34px;
  padding: 0 20px;
  border: 1px solid #2563eb;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
}

.empty-lg-btn:hover {
  background: #1d4ed8;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.2);
}
</style>
