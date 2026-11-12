<script setup lang="ts">
// 状态标签组件（P3-1 业务组件沉淀 · plan §F.1/F.2）
//
// 替代散落的 `<span class="rc-status">` 模式（20 个文件实测复用面，plan 估 17）
// 两种用法：
//   1. 状态码自动推断：<StatusTag state="L" />  → 处理中（蓝）
//   2. 显式文本+色调：<StatusTag text="外部变更" tone="warn" />  → 自定义文本
//
// Props:
//   state: 'L' | 'C' | 'E' | 'disabled' | string   状态码（state 与 text 至少传一个）
//   text?: string                                  显式文本（优先级高于 state 推断）
//   tone?: 'ok' | 'err' | 'warn' | 'run' | 'muted'  色调
//                                                      显式传值时强制使用；不传时从 state 推断
//   size?: 'sm' | 'md'                              默认 'sm'
//   showIcon?: boolean                              默认 true
//
// 5 种 tone 颜色取自 design/tokens.css（--rc-ok / --rc-error / --rc-primary-bg 等）
import { computed } from 'vue'

type Tone = 'ok' | 'err' | 'warn' | 'run' | 'muted'

const props = withDefaults(defineProps<{
  state?: string
  text?: string
  tone?: Tone
  size?: 'sm' | 'md'
  showIcon?: boolean
}>(), {
  state: '',
  text: '',
  tone: undefined,
  size: 'sm',
  showIcon: true,
})

// state → { tone, text, icon } 推断表
// 覆盖项目里常用的状态码（RunState / RuleState / 业务自定义）
const META_BY_STATE: Record<string, { tone: Tone; text: string; icon: string }> = {
  L: { tone: 'run', text: '处理中', icon: '⟳' },
  C: { tone: 'ok', text: '完成', icon: '✓' },
  E: { tone: 'err', text: '出错', icon: '✕' },
  pending: { tone: 'warn', text: '待确认', icon: '?' },
  warn: { tone: 'warn', text: '需关注', icon: '!' },
  disabled: { tone: 'muted', text: '停用', icon: '—' },
  enabled: { tone: 'ok', text: '启用', icon: '✓' },
  published: { tone: 'ok', text: '已发布', icon: '✓' },
  draft: { tone: 'warn', text: '草稿', icon: '✎' },
  deprecated: { tone: 'muted', text: '已弃用', icon: '—' },
  pass: { tone: 'ok', text: '通过', icon: '✓' },
  fail: { tone: 'err', text: '失败', icon: '✕' },
  ready: { tone: 'ok', text: '就绪', icon: '✓' },
  building: { tone: 'warn', text: '构建中', icon: '⟳' },
  stale: { tone: 'warn', text: '已过期', icon: '!' },
}

const meta = computed(() => {
  // 显式传 text + tone 时，直接用
  if (props.text && props.tone) {
    return { tone: props.tone, text: props.text, icon: '' }
  }
  // state 推断
  if (props.state && META_BY_STATE[props.state]) {
    const m = META_BY_STATE[props.state]
    return { tone: props.tone ?? m.tone, text: props.text || m.text, icon: m.icon }
  }
  // 退化：只传 tone 时用 tone + text
  if (props.tone) {
    return { tone: props.tone, text: props.text || '—', icon: '' }
  }
  // 终极退化：state 不在 META_BY_STATE 且没显式传 text/tone → 显示「未知」
  // （不直接 echo state 原文，避免 state='unknown-state' 这种被展示给用户）
  return { tone: 'muted' as Tone, text: props.text || '未知', icon: '?' }
})
</script>

<template>
  <span class="rc-status" :class="[meta.tone, size]">
    <span v-if="showIcon && meta.icon" class="rc-status-icon">{{ meta.icon }}</span>
    {{ meta.text }}
  </span>
</template>

<style scoped>
.rc-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-radius: 4px;
  line-height: 18px;
  font-size: 11px;
  font-weight: 600;
}
.rc-status.sm { font-size: 11px; line-height: 18px; }
.rc-status.md { font-size: 12px; line-height: 22px; padding: 0 8px; }

.rc-status.run   { color: var(--rc-primary-ink, #1d4ed8); background: var(--rc-primary-bg, #eff6ff); }
.rc-status.ok    { color: var(--rc-ok, #15803d);       background: var(--rc-ok-bg, #f0fdf4); }
.rc-status.err   { color: var(--rc-error, #dc2626);     background: var(--rc-error-bg, #fef2f2); }
.rc-status.warn  { color: #b45309;                       background: #fef3c7; }
.rc-status.muted { color: var(--rc-muted, #64748b);     background: var(--rc-border-soft, #f1f5f9); }

.rc-status-icon { font-size: 11px; line-height: 1; }
</style>
