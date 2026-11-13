<script lang="ts">
// 模块级共享计数器（实例间唯一）：**不能**放进 `<script setup>`——setup 每个实例都重跑，
// 放里面等于每实例重置为 0，id 永远算出 pnr-arrow-1，"多实例唯一"就是空的（0926 REVIEW F1）。
let railSeq = 0
</script>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { entryApi } from '@/api'
import {
  effectiveOutputTable,
  iconFor,
  nodeInputTable,
  nodeOutputTable,
  nodeTaskQueue,
  type HorizontalLayout,
} from '@/views/FlowCanvas/canvas/flowModel'

type RailNode = HorizontalLayout['nodes'][number]

// 同页可能同时挂多个节点条（分屏对比 / 数据查看抽屉），`<marker>` 的 id 必须唯一——
// 重复 id 时后挂的实例会解析到先挂实例的 marker，先挂实例一旦卸载箭头就集体消失。
const arrowId = `pnr-arrow-${++railSeq}`

const props = withDefaults(defineProps<{
  layout: HorizontalLayout
  modelValue?: string
  selectable?: (nodeId: string) => boolean
  /** 运行状态由任务/数据查看等只读视图提供；画布编辑态不传。 */
  nodeStates?: Record<string, string | undefined>
  /** 节点队列映射（0917-03）：任务/数据视图若已知运行时队列可传入，优先展示 */
  nodeQueues?: Record<string, string | undefined>
  /** 节点表名映射（tableId 或 nodeId → 表名），若未传入由组件内部按 tableId 异步加载缓存 */
  tableNames?: Record<string, string | undefined>
  /** 本次不发后续的节点（0917-06）：半透明 + 角标，一眼看出这次不跑哪些 */
  skipped?: string[]
}>(), {
  modelValue: '',
  selectable: () => true,
  nodeStates: () => ({}),
  nodeQueues: () => ({}),
  tableNames: () => ({}),
  skipped: () => [],
})
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

function queueForNode(node: RailNode): string {
  return props.nodeQueues?.[node.id] || nodeTaskQueue(node.cfg) || ''
}

function tableIdForNode(node: RailNode): string {
  const ruleId = node.cfg.ruleCfg?.outputTableId || node.cfg.ruleCfg?.inputTableId
  if (ruleId) return ruleId
  return effectiveOutputTable(node.cfg) || nodeOutputTable(node.cfg) || nodeInputTable(node.cfg) || ''
}

function badgeText(node: RailNode): string {
  const tid = tableIdForNode(node)
  if (tid) return tid
  return iconFor(node.cfg)
}

function badgeTitle(node: RailNode): string {
  const tid = tableIdForNode(node)
  if (tid) return `表 ID: ${tid}`
  return iconFor(node.cfg)
}

const tableDetailCache = reactive<Record<string, { name?: string; tableName?: string }>>({})
const tableDetailPending = new Set<string>()

function ensureTableDetail(tableId: string) {
  if (!tableId || tableDetailCache[tableId] || tableDetailPending.has(tableId)) return
  tableDetailPending.add(tableId)
  entryApi.entryDetail(tableId)
    .then((detail) => {
      if (detail) {
        tableDetailCache[tableId] = {
          name: detail.name,
          tableName: detail.tableName,
        }
      }
    })
    .catch(() => {
      tableDetailCache[tableId] = {}
    })
}

watch(
  () => props.layout?.nodes,
  (nodes) => {
    if (!nodes) return
    for (const node of nodes) {
      const tid = tableIdForNode(node)
      if (tid && !props.tableNames?.[tid] && !props.tableNames?.[node.id]) {
        ensureTableDetail(tid)
      }
    }
  },
  { immediate: true, deep: true },
)

function tableNameForNode(node: RailNode): string {
  const tid = tableIdForNode(node)
  if (tid && props.tableNames?.[tid]) return props.tableNames[tid]!
  if (props.tableNames?.[node.id]) return props.tableNames[node.id]!
  const ruleTableName = node.cfg.ruleCfg?.outputTable || node.cfg.ruleCfg?.inputTable
  if (ruleTableName && ruleTableName !== tid) return ruleTableName
  if (tid && tableDetailCache[tid]) {
    const detail = tableDetailCache[tid]
    const name = detail.name?.trim()
    const rawTableName = detail.tableName?.trim()
    if (name && !name.startsWith('表-')) return name
    if (rawTableName) return rawTableName
  }
  return ''
}

function displayTableName(node: RailNode): string {
  const name = tableNameForNode(node)
  return name.replace(/^sense_data\./i, '')
}

function queueSub(node: RailNode): string {
  const queue = queueForNode(node)
  const table = displayTableName(node)
  if (queue && queue !== table) return queue
  return ''
}


function nodeTitle(node: RailNode): string {
  const tid = tableIdForNode(node)
  const rawTable = tableNameForNode(node)
  const queue = queueForNode(node)
  const sub = node.cfg.sub
  const title = node.cfg.title

  if (rawTable) {
    const tablePart = tid ? `表: ${tid} · ${rawTable}` : `表: ${rawTable}`
    const queuePart = queue && queue !== rawTable ? ` · 队列: ${queue}` : ''
    return `${title} (${tablePart}${queuePart})`
  }

  if (queue && sub && queue !== sub) {
    return `${title} (${sub} · ${queue})`
  }
  if (queue) {
    return `${title} (${queue})`
  }
  if (sub) {
    return `${title} (${sub})`
  }
  return title
}
</script>

<template>
  <div class="pnr" :style="railStyle">
    <svg class="pnr-edges" :viewBox="`0 0 ${layout.totalWidth} ${layout.totalHeight}`" aria-hidden="true">
      <defs>
        <marker :id="arrowId" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0L6 3L0 6Z" class="pnr-arrow" />
        </marker>
      </defs>
      <path v-for="(edge, index) in layout.mainEdges" :key="`m-${index}`" :d="edge.d" class="pnr-edge" :marker-end="`url(#${arrowId})`" />
      <path v-for="(edge, index) in layout.branchEdges" :key="`b-${index}`" :d="edge.d" class="pnr-edge" :class="{ branch: edge.dashed }" :marker-end="`url(#${arrowId})`" />
    </svg>
    <button
      v-for="node in layout.nodes"
      :key="node.id"
      class="pnr-node"
      :class="{ active: modelValue === node.id, disabled: !selectable(node.id), skipped: isSkipped(node.id) }"
      type="button"
      :data-node-id="node.id"
      :data-testid="`rail-node-${node.id}`"
      :title="nodeTitle(node)"
      :style="{ left: `${node.pos.left}px`, top: `${node.pos.top}px`, width: `${node.pos.width}px`, height: `${node.pos.height}px` }"
      @click="pick(node.id)"
      @contextmenu="onNodeMenu($event, node.id)"
    >
      <span class="pnr-node-icon" :title="badgeTitle(node)">{{ badgeText(node) }}</span>
      <span class="pnr-node-text">
        <b>{{ node.cfg.title }}</b>
        <small v-if="displayTableName(node)" class="pnr-node-sub pnr-node-table">{{ displayTableName(node) }}</small>
        <small v-if="queueSub(node)" class="pnr-node-sub pnr-node-queue">{{ queueSub(node) }}</small>
        <small v-else-if="!displayTableName(node) && node.cfg.sub" class="pnr-node-sub">{{ node.cfg.sub }}</small>
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
.pnr-node { position: absolute; z-index: 1; display: flex; align-items: center; gap: 8px; box-sizing: border-box; padding: 5px 8px; border: 1px solid #d6e1ed; border-radius: 8px; background: #fff; color: #334155; cursor: pointer; text-align: left; transition: border-color .15s, box-shadow .15s, background .15s; }
.pnr-node:hover:not(.disabled):not(.active) { border-color: #bfdbfe; box-shadow: 0 4px 12px -8px rgba(37, 99, 235, .45); }
.pnr-node.active { border-color: #2563eb; background: #f8fbff; box-shadow: 0 0 0 1px #bfdbfe; }
.pnr-node.disabled { cursor: default; opacity: .62; }
/* 本次不发（0917-06）：虚线边 + 淡化文字，但**不跟「已停用」同色**——
   那个是落库的配置状态，这个只影响这一次发送 */
.pnr-node.skipped { border-style: dashed; border-color: #f59e0b; background: #fffbeb; }
.pnr-node.skipped .pnr-node-text { opacity: .6; }
.pnr-node-skip { position: absolute; top: -8px; left: 8px; padding: 0 5px; border-radius: 4px; background: #f59e0b; color: #fff; font-size: 10px; line-height: 15px; white-space: nowrap; }
.pnr-node-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; width: auto; max-width: 58px; padding: 0 4px; box-sizing: border-box; height: 28px; border-radius: 7px; background: #eff6ff; color: #2563eb; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pnr-node-text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; line-height: 1.25; justify-content: center; }
.pnr-node b, .pnr-node small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pnr-node b { font-size: 12px; font-weight: 700; color: #1e293b; }
.pnr-node small { color: #64748b; font-size: 10px; }
.pnr-node small.pnr-node-queue { color: #94a3b8; font-family: var(--rc-mono, monospace); }
.pnr-node-state { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #94a3b8; }
.pnr-node-state.state-C { background: #16a34a; }
.pnr-node-state.state-L { background: #2563eb; }
.pnr-node-state.state-E { background: #dc2626; }
.pnr-node-state.state-D { background: #94a3b8; }
.pnr-node-final { position: absolute; top: -9px; right: 7px; padding: 1px 6px; border: 1px solid #86efac; border-radius: 5px; background: #f0fdf4; color: #15803d; font-size: 9px; font-weight: 700; line-height: 1.35; }
</style>
