<script setup lang="ts">
import { computed } from 'vue'
import type { Source, Step } from '@/api'
import { buildHorizontalLayout, buildSourceSeed, nodeTaskQueue } from '../canvas/flowModel'
import ProcessNodeRail from './ProcessNodeRail.vue'

const props = defineProps<{ source: Source; sourceIds?: string[]; nodes: Step[]; modelValue: string[]; disabled?: boolean; completedIds?: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>()
const steps = computed(() => Object.fromEntries(props.nodes.map(node => [node.stepId, node])))
const layout = computed(() => {
  const seed = buildSourceSeed(props.source, props.nodes)
  return buildHorizontalLayout(seed.main, seed.branches, seed.configs, seed.branchGroups, { includeTerminals: false })
})
function selectable(id: string) {
  const step = steps.value[id]
  return !props.disabled && !props.completedIds?.includes(id) && !!step && step.enabled !== false && /^[1-9]\d*$/.test(step.configId || '') && (!step.sourceId || ['0', '-1', ...(props.sourceIds || [props.source.sourceId])].includes(step.sourceId))
}
function select(ids: string[]) { emit('update:modelValue', ids.filter(selectable)) }
</script>

<template>
  <div class="generation-flow-picker">
    <div class="generation-flow-toolbar"><span>点击流程节点勾选生成代码；灰色节点不可选</span><button type="button" :disabled="disabled" @click="select(nodes.map(node => node.stepId))">全选节点</button><button type="button" :disabled="disabled || !modelValue.length" @click="emit('update:modelValue', [])">清空</button></div>
    <div class="generation-flow-canvas" aria-label="代码生成流程图">
      <ProcessNodeRail :layout="layout" :selected-ids="modelValue" :selectable="selectable" @update:selected-ids="select">
        <template #node-text="{ node }">
          <b>{{ node.cfg.title }}</b>
          <small>配置 {{ steps[node.id]?.configId || '未绑定' }}</small>
          <small v-if="completedIds?.includes(node.id)">已创建任务</small>
          <small v-else-if="steps[node.id]?.enabled === false">已停用</small>
          <small v-else-if="nodeTaskQueue(node.cfg)" :title="nodeTaskQueue(node.cfg)">{{ nodeTaskQueue(node.cfg) }}</small>
        </template>
      </ProcessNodeRail>
    </div>
  </div>
</template>

<style scoped>
.generation-flow-toolbar { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--rc-muted); flex-wrap: wrap; }
.generation-flow-toolbar span { flex: 1; }
.generation-flow-toolbar button { border: 0; padding: 3px 0; background: transparent; color: var(--el-color-primary); cursor: pointer; }
.generation-flow-toolbar button:disabled { color: var(--el-text-color-disabled); cursor: default; }
.generation-flow-canvas { overflow-x: auto; padding: 18px 8px 8px; border-radius: 6px; background: var(--el-fill-color-lighter); }
.generation-flow-canvas b, .generation-flow-canvas small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.generation-flow-canvas b { font-size: 12px; color: var(--el-text-color-primary); }
.generation-flow-canvas small { font-size: 10px; color: var(--el-text-color-secondary); }
</style>
