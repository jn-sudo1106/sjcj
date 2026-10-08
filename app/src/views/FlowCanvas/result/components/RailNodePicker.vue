<script setup lang="ts">
// 流程节点轨道收起后的节点选择（0930-02）：下拉直接换节点，旁边一个流程图图标按钮开合流程图。
// 不用 ⌄ 箭头：紧挨着下拉框自带的 ⌄，两个箭头并排像是重复控件（2026-09-30 用户反馈）。
// 图标用 Share（节点连线图）而不是 Connection：源数据视图「按步骤查看」用的是 Connection，并排像重复按钮（2026-10-08 用户反馈）。
// 源数据 / 文件 / 任务视图、网站数据视图共用，四处长得一样。
// 此前收起态只有一个「展开流程 · 节点名」长按钮：节点名一长按钮就拉得很长，而且换节点必须先展开流程图。
import { computed } from 'vue'
import { Share } from '@element-plus/icons-vue'

const props = withDefaults(defineProps<{
  nodes: { id: string; title: string }[]
  modelValue: string
  open: boolean
  /** 有值时首项是「不按节点筛」（value 为空），如「全部节点」「全部文件」 */
  allLabel?: string
  disabled?: boolean
  toggleTestid?: string
}>(), { allLabel: undefined, disabled: false, toggleTestid: 'rail-toggle' })

const emit = defineEmits<{ 'update:modelValue': [id: string]; 'update:open': [open: boolean] }>()

const currentTitle = computed(() => props.nodes.find((n) => n.id === props.modelValue)?.title ?? props.allLabel ?? '')
</script>

<template>
  <span class="rnp">
    <select
      class="rnp-select"
      data-testid="rail-node-select"
      aria-label="流程节点"
      :value="modelValue"
      :title="currentTitle"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="allLabel !== undefined" value="">{{ allLabel }}</option>
      <option v-for="n in nodes" :key="n.id" :value="n.id">{{ n.title || n.id }}</option>
    </select>
    <button
      type="button"
      class="rnp-toggle"
      :class="{ open }"
      :data-testid="toggleTestid"
      :title="open ? '收起流程图' : '展开流程图'"
      :aria-label="open ? '收起流程图' : '展开流程图'"
      :aria-pressed="open"
      @click="emit('update:open', !open)"
    ><el-icon :size="15"><Share /></el-icon></button>
  </span>
</template>

<style scoped>
.rnp { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.rnp-select {
  height: 28px;
  width: 180px;
  padding: 0 8px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm);
  background: #fff;
  color: var(--rc-text);
  font-size: 12px;
  text-overflow: ellipsis;
  cursor: pointer;
}
.rnp-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; outline: none; }
.rnp-select:disabled { color: var(--rc-muted); background: #f8fafc; cursor: not-allowed; }
.rnp-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm);
  background: #fff;
  color: var(--rc-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.rnp-toggle:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); background: var(--rc-primary-bg); }
.rnp-toggle.open { border-color: #bfdbfe; color: var(--rc-primary); background: var(--rc-primary-bg); }
</style>
