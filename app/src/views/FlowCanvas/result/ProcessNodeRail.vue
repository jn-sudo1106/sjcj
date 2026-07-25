<script setup lang="ts">
import { computed } from 'vue'
import { iconFor, type HorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'

const props = withDefaults(defineProps<{
  layout: HorizontalLayout
  modelValue?: string
  selectable?: (nodeId: string) => boolean
}>(), { modelValue: '', selectable: () => true })
const emit = defineEmits<{ 'update:modelValue': [nodeId: string] }>()

const railStyle = computed(() => ({ width: `${props.layout.totalWidth}px`, height: `${props.layout.totalHeight}px` }))
const finalNodeId = computed(() => props.layout.nodes.filter((node) => !node.branch).at(-1)?.id)
function pick(nodeId: string) {
  if (props.selectable(nodeId)) emit('update:modelValue', nodeId)
}
</script>

<template>
  <div class="pnr" :style="railStyle">
    <svg class="pnr-edges" :viewBox="`0 0 ${layout.totalWidth} ${layout.totalHeight}`" aria-hidden="true">
      <defs>
        <marker id="pnr-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L6 3L0 6Z" class="pnr-arrow" />
        </marker>
      </defs>
      <path v-for="(edge, index) in layout.mainEdges" :key="`m-${index}`" :d="edge.d" class="pnr-edge" marker-end="url(#pnr-arrow)" />
      <path v-for="(edge, index) in layout.branchEdges" :key="`b-${index}`" :d="edge.d" class="pnr-edge branch" marker-end="url(#pnr-arrow)" />
    </svg>
    <button
      v-for="node in layout.nodes"
      :key="node.id"
      class="pnr-node"
      :class="{ active: modelValue === node.id, disabled: !selectable(node.id) }"
      type="button"
      :data-node-id="node.id"
      :style="{ left: `${node.pos.left}px`, top: `${node.pos.top}px`, width: `${node.pos.width}px`, height: `${node.pos.height}px` }"
      @click="pick(node.id)"
    >
      <span class="pnr-node-icon">{{ iconFor(node.cfg) }}</span>
      <span class="pnr-node-text">
        <b>{{ node.cfg.title }}</b>
        <small v-if="node.cfg.sub" class="pnr-node-sub">{{ node.cfg.sub }}</small>
      </span>
      <span v-if="node.id === finalNodeId" class="pnr-node-final">最终结果</span>
    </button>
  </div>
</template>

<style scoped>
.pnr { position: relative; overflow: hidden; }
.pnr-edges { position: absolute; top: 0; left: 0; z-index: 0; width: 100%; height: 100%; overflow: visible; }
.pnr-edge { fill: none; stroke: #94a3b8; stroke-width: 1.5; }
.pnr-edge.branch { stroke-dasharray: 4 3; }
.pnr-arrow { fill: #94a3b8; }
.pnr-node { position: absolute; z-index: 1; display: flex; align-items: center; gap: 8px; box-sizing: border-box; padding: 7px 10px; border: 1px solid #d6e1ed; border-radius: 8px; background: #fff; color: #334155; cursor: pointer; text-align: left; transition: border-color .15s, box-shadow .15s, background .15s; }
.pnr-node:hover:not(.disabled):not(.active) { border-color: #bfdbfe; box-shadow: 0 4px 12px -8px rgba(37, 99, 235, .45); }
.pnr-node.active { border-color: #2563eb; background: #f8fbff; box-shadow: 0 0 0 1px #bfdbfe; }
.pnr-node.disabled { cursor: default; opacity: .62; }
.pnr-node-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: #eff6ff; color: #2563eb; font-size: 12px; font-weight: 700; }
.pnr-node-text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; line-height: 1.25; }
.pnr-node b, .pnr-node small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pnr-node b { font-size: 12px; font-weight: 700; }
.pnr-node small { color: #94a3b8; font-family: var(--rc-mono, monospace); font-size: 10px; }
.pnr-node-final { position: absolute; top: -9px; right: 7px; padding: 1px 6px; border: 1px solid #86efac; border-radius: 5px; background: #f0fdf4; color: #15803d; font-size: 9px; font-weight: 700; line-height: 1.35; }
</style>
