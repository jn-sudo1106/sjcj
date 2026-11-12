<script setup lang="ts">
// 流程图展开后右上角的收起按钮（0930-02），与源数据视图（ResultView 的 .rv-rail-icon-btn）同款。
// 展开时节点下拉 + 开合按钮（RailNodePicker）隐藏，收起只走这里；放进一个 position: relative 的容器里。
import { ArrowUp } from '@element-plus/icons-vue'

withDefaults(defineProps<{ testid?: string }>(), { testid: 'rail-collapse' })
const emit = defineEmits<{ collapse: [] }>()
</script>

<template>
  <button
    type="button"
    class="rcb"
    :data-testid="testid"
    title="收起流程图"
    aria-label="收起流程图"
    @click="emit('collapse')"
  ><el-icon :size="14"><ArrowUp /></el-icon></button>
</template>

<style scoped>
.rcb {
  position: absolute;
  top: 6px;
  right: 10px;
  z-index: 2;
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm);
  background: #fff;
  color: var(--rc-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.rcb:hover { border-color: var(--rc-primary); color: var(--rc-primary-ink); background: var(--rc-primary-bg); }
</style>
