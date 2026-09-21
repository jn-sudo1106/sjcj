<script setup lang="ts">
import { computed } from 'vue'
import { iconFor, type HorizontalLayout } from '@/views/FlowCanvas/canvas/flowModel'

const props = withDefaults(defineProps<{
  layout: HorizontalLayout
  modelValue?: string
  selectable?: (nodeId: string) => boolean
  /** 运行状态由任务/数据查看等只读视图提供；画布编辑态不传。 */
  nodeStates?: Record<string, string | undefined>
  /** 本次不发后续的节点（0917-06）：半透明 + 角标，一眼看出这次不跑哪些 */
  skipped?: string[]
}>(), { modelValue: '', selectable: () => true, nodeStates: () => ({}), skipped: () => [] })
const emit = defineEmits<{
  'update:modelValue': [nodeId: string]
  /**
   * 节点右键（0917-06 / 0917-08，2026-09-21 用户定）。
   * **菜单内容由各视图自己渲染**：这条轨道被数据 / 文件 / 任务 / 监控四个视图复用，
   * 「发起抓取」「本次不发后续」只对数据视图有意义，轨道不该知道菜单里有什么。
   */
  'node-menu': [payload: { nodeId: string; x: number; y: number }]
}>()
const isSkipped = (nodeId: string) => props.skipped.includes(nodeId)
function onNodeMenu(ev: MouseEvent, nodeId: string) {
  ev.preventDefault()
  ev.stopPropagation()
  emit('node-menu', { nodeId, x: ev.clientX, y: ev.clientY })
}

const railStyle = computed(() => ({ width: `${props.layout.totalWidth}px`, height: `${props.layout.totalHeight}px` }))
const finalNodeId = computed(() => props.layout.nodes.filter((node) => !node.branch).at(-1)?.id)
function pick(nodeId: string) {
  if (props.selectable(nodeId)) emit('update:modelValue', nodeId)
}
function stateText(state?: string) {
  return state === 'E' ? '异常' : state === 'L' ? '运行中' : state === 'C' ? '完成' : state === 'D' ? '已停用' : ''
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
      :class="{ active: modelValue === node.id, disabled: !selectable(node.id), skipped: isSkipped(node.id) }"
      type="button"
      :data-node-id="node.id"
      :data-testid="`rail-node-${node.id}`"
      :style="{ left: `${node.pos.left}px`, top: `${node.pos.top}px`, width: `${node.pos.width}px`, height: `${node.pos.height}px` }"
      @click="pick(node.id)"
      @contextmenu="onNodeMenu($event, node.id)"
    >
      <span class="pnr-node-icon">{{ iconFor(node.cfg) }}</span>
      <span class="pnr-node-text">
        <b>{{ node.cfg.title }}</b>
        <small v-if="node.cfg.sub" class="pnr-node-sub">{{ node.cfg.sub }}</small>
      </span>
      <span v-if="nodeStates[node.id]" class="pnr-node-state" :class="`state-${nodeStates[node.id]}`" :title="stateText(nodeStates[node.id])" :aria-label="stateText(nodeStates[node.id])" />
      <span v-if="node.id === finalNodeId" class="pnr-node-final">最终结果</span>
      <!-- 本次不发：角标而不是把节点整个灰掉——灰掉会跟「已停用」（落库的那个）看着一样 -->
      <span v-if="isSkipped(node.id)" class="pnr-node-skip" data-testid="rail-node-skip-badge" title="本次不发后续任务（右键可恢复）">本次不发</span>
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
/* 本次不发（0917-06）：虚线边 + 淡化文字，但**不跟「已停用」同色**——
   那个是落库的配置状态，这个只影响这一次发送 */
.pnr-node.skipped { border-style: dashed; border-color: #f59e0b; background: #fffbeb; }
.pnr-node.skipped .pnr-node-text { opacity: .6; }
.pnr-node-skip { position: absolute; top: -8px; left: 8px; padding: 0 5px; border-radius: 4px; background: #f59e0b; color: #fff; font-size: 10px; line-height: 15px; white-space: nowrap; }
.pnr-node-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 7px; background: #eff6ff; color: #2563eb; font-size: 12px; font-weight: 700; }
.pnr-node-text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; line-height: 1.25; }
.pnr-node b, .pnr-node small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pnr-node b { font-size: 12px; font-weight: 700; }
.pnr-node small { color: #94a3b8; font-family: var(--rc-mono, monospace); font-size: 10px; }
.pnr-node-state { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #94a3b8; }
.pnr-node-state.state-C { background: #16a34a; }
.pnr-node-state.state-L { background: #2563eb; }
.pnr-node-state.state-E { background: #dc2626; }
.pnr-node-state.state-D { background: #94a3b8; }
.pnr-node-final { position: absolute; top: -9px; right: 7px; padding: 1px 6px; border: 1px solid #86efac; border-radius: 5px; background: #f0fdf4; color: #15803d; font-size: 9px; font-weight: 700; line-height: 1.35; }
</style>
