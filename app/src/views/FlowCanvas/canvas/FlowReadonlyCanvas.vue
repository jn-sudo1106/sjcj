<script lang="ts">
// 模块级计数器：同页可能同时挂多个只读画布，<marker> id 必须实例唯一（同 FlowBoard / ProcessNodeRail 的做法）
let readonlyCanvasSeq = 0
</script>

<script setup lang="ts">
/**
 * 只读流程画布（2026-10-31，流程选择弹窗的预览）：外观与流程工作区画布（FlowBoard）一致——
 * 同一套纵向布局（flowModel.verticalLayout）、同样的节点卡片、分支条件和表血缘标注；
 * 没有任何编辑入口（插入「+」、拖拽、右键菜单、删除、孤儿关联、XML）。
 *
 * 不用 FlowBoard 本体：它读写全局 flow store，而选择弹窗也会出现在画布页的网站详情里，
 * 那里 store 绑着自动保存，把预览的流程读进 store 有被写进当前源的风险。这里只吃传入的定义。
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { entryApi } from '@/api'
import {
  conditionGroupIsSet,
  conditionGroupLabel,
  effectiveInputTable,
  effectiveOutputTable,
  isDataNode,
  nodeClassFor,
  nodeEntryCondition,
  nodeOutputTable,
  nodeTypeLabel,
  type BranchSeed,
  type FlowBranchGroup,
  type NodeConfig,
} from './flowModel'
import { buildVerticalLayout } from './flowModel.verticalLayout'
import { nodeStatusOf } from './nodeStatus'
import { isWritableStepId } from '@/utils/flow/stepPersist'

export interface ReadonlyFlowDef {
  main: string[]
  branches: BranchSeed[]
  configs: Record<string, NodeConfig>
  branchGroups: FlowBranchGroup[]
}

const props = withDefaults(defineProps<{ def: ReadonlyFlowDef; selected?: string }>(), { selected: '' })
const emit = defineEmits<{ select: [nodeId: string] }>()

const markerPrefix = `rc-ro-arrow-${++readonlyCanvasSeq}`
const scrollEl = ref<HTMLElement | null>(null)
/** 主链居中于画布宽度：流程比预览区宽时，把横向滚动条放到中间，默认就能看到主链（同 FlowBoard.centerCanvas） */
async function centerCanvas() {
  await nextTick()
  const el = scrollEl.value
  if (el) el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2)
}
onMounted(() => void centerCanvas())
watch(() => props.def, () => void centerCanvas())
const layout = computed(() => buildVerticalLayout(props.def.main, props.def.branches, props.def.configs, props.def.branchGroups))
const inputTableOf = (id: string) => effectiveInputTable(props.def.main, props.def.branches, props.def.configs, id, props.def.branchGroups)

// 表 ID → 名称（与 FlowBoard 同口径：卡片带 ID，连线小字只显示名称）
const tableNames = reactive<Record<string, string>>({})
const pendingTables = new Set<string>()
function tableLabel(tableId: string, withId = false): string {
  if (!tableNames[tableId] && !pendingTables.has(tableId)) {
    pendingTables.add(tableId)
    entryApi.entryDetail(tableId)
      .then((detail) => { tableNames[tableId] = detail ? (detail.name || detail.tableName) : tableId })
      .catch(() => { tableNames[tableId] = tableId })
  }
  const name = tableNames[tableId] || tableId
  return withId && name !== tableId ? `${name} (${tableId})` : name
}
function edgeTableTag(fromId: string, toId: string): string {
  const fromCfg = props.def.configs[fromId]
  const toCfg = props.def.configs[toId]
  const out = fromCfg ? effectiveOutputTable(fromCfg) : ''
  const inp = toCfg ? inputTableOf(toId) : ''
  if (!out && !inp) return ''
  return `${out ? tableLabel(out) : '?'} → ${inp ? tableLabel(inp) : '?'}`
}
function tableChip(cfg: NodeConfig, id: string): { label: string; title: string; unset: boolean } | null {
  const inp = inputTableOf(id)
  const out = nodeOutputTable(cfg)
  if (!inp && !out) return null
  if (out) {
    const outLabel = tableLabel(out, true)
    if (!inp) return { label: outLabel, title: `输出表 ${outLabel}`, unset: false }
    const inpLabel = tableLabel(inp, true)
    return { label: `${inpLabel} → ${outLabel}`, title: `输入表 ${inpLabel} → 输出表 ${outLabel}`, unset: false }
  }
  const inpLabel = tableLabel(inp, true)
  if (cfg.collectCfg) return { label: `${inpLabel} → ?`, title: `输入表 ${inpLabel} · 尚未设置输出表`, unset: true }
  return { label: inpLabel, title: `输入表 ${inpLabel} · 输出表未显式设置，默认继承输入表`, unset: false }
}
function footFor(cfg: NodeConfig) {
  const { configured, left, missing } = nodeStatusOf(cfg)
  const right = cfg.disabled ? '数据在此节点不处理' : cfg.collect ? '源配置' : isDataNode(cfg) ? '待发起抓取' : '待配置'
  return {
    left,
    right,
    hint: missing.length ? `还缺：${missing.join('、')}` : '',
    warn: cfg.disabled || ((cfg.collect || isDataNode(cfg)) && !configured),
  }
}
function nodeCondText(cfg: NodeConfig): string {
  const group = nodeEntryCondition(cfg)
  return group && conditionGroupIsSet(group) ? conditionGroupLabel(group) : ''
}
function branchColText(br: { label: string; chain: string[] }): string {
  const head = br.chain[0]
  const headCond = head ? conditionGroupLabel(nodeEntryCondition(props.def.configs[head])) : ''
  return headCond || br.label
}
</script>

<template>
  <div ref="scrollEl" class="frc-scroll" data-testid="flow-readonly-canvas">
    <div class="rc-flow" :style="{ height: layout.totalHeight + 'px', width: layout.width + 'px' }">
      <svg :width="layout.width" :height="layout.totalHeight" :viewBox="`0 0 ${layout.width} ${layout.totalHeight}`" aria-hidden="true">
        <defs>
          <marker :id="markerPrefix" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0 0.6L7.4 4L0 7.4L1.8 4Z" fill="#94a3b8" />
          </marker>
          <marker :id="`${markerPrefix}-fan`" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0 0.6L7.4 4L0 7.4L1.8 4Z" fill="#f59e0b" />
          </marker>
          <marker :id="`${markerPrefix}-rule`" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0 0.6L7.4 4L0 7.4L1.8 4Z" fill="#60a5fa" />
          </marker>
        </defs>
        <path v-for="(e, i) in layout.mainEdges" :key="'m' + i" class="rc-edge" :class="{ rule: e.rule }" :d="e.d" :marker-end="e.rule ? `url(#${markerPrefix}-rule)` : `url(#${markerPrefix})`" />
        <path v-for="(e, i) in layout.branchEdges" :key="'b' + i" class="rc-edge" :d="e.d" :marker-end="`url(#${markerPrefix})`" />
        <path v-for="(e, i) in layout.fanOutEdges" :key="'f' + i" class="rc-edge fan-out" :d="e.d" :marker-end="`url(#${markerPrefix}-fan)`" />
      </svg>

      <div v-for="t in layout.terminals" :key="t.id" class="rc-term" :style="{ left: t.pos.left + 'px', top: t.pos.top + 'px' }">{{ t.label }}</div>

      <template v-for="(e, i) in layout.mainEdges" :key="'l' + i">
        <div v-if="edgeTableTag(e.fromId, e.toId)" class="rc-edge-table-tag" :style="{ left: e.lx + 'px', top: e.ly + 'px' }">{{ edgeTableTag(e.fromId, e.toId) }}</div>
      </template>

      <template v-for="(col, ownerId) in layout.fanOutColMeta" :key="'col-' + ownerId">
        <template v-for="br in col.branches" :key="'coltag-' + br.id">
          <div
            v-if="branchColText(br)"
            class="rc-fanout-col-tag"
            :title="branchColText(br)"
            :style="{ left: br.colX + 'px', top: (br.labelTop ?? (br.top - 16)) + 'px' }"
          >{{ branchColText(br) }}</div>
        </template>
      </template>

      <div
        v-for="n in layout.nodes"
        :key="n.id"
        class="rc-flow-node"
        :class="[nodeClassFor(n.cfg), { 'disabled-node': n.cfg.disabled, active: selected === n.id }]"
        :style="{ left: n.pos.left + 'px', top: n.pos.top + 'px' }"
        data-testid="flow-readonly-node"
        @click="emit('select', n.id)"
      >
        <div class="rc-node-meta">
          <div class="rc-node-type">{{ nodeTypeLabel(n.cfg) }}</div>
          <div class="rc-node-meta-end">
            <span v-if="n.cfg.disabled" class="rc-node-plan">已停止</span>
            <span v-else-if="n.cfg.planned" class="rc-node-plan">规划中</span>
            <span v-if="isWritableStepId(n.id)" class="rc-node-stepid" :title="`步骤 ID ${n.id}`">#{{ n.id }}</span>
          </div>
        </div>
        <div class="rc-node-title" :title="n.cfg.title">{{ n.cfg.title }}</div>
        <div v-if="tableChip(n.cfg, n.id)" class="rc-node-table" :class="{ unset: tableChip(n.cfg, n.id)!.unset }" :title="tableChip(n.cfg, n.id)!.title">⊞ {{ tableChip(n.cfg, n.id)!.label }}</div>
        <div class="rc-node-foot">
          <span v-if="nodeCondText(n.cfg)" class="rc-node-cond" :title="nodeCondText(n.cfg)">条件</span>
          <span class="rc-chip" :class="{ warn: footFor(n.cfg).warn, ok: footFor(n.cfg).left === '运行' }" :title="footFor(n.cfg).hint">{{ footFor(n.cfg).left }}</span>
          <span>{{ footFor(n.cfg).right }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 以下与 FlowBoard.vue 的画布 / 节点卡片样式一致（去掉了编辑控件相关的规则） */
.frc-scroll { height: 100%; overflow: auto; background-color: #f7f9fc; background-image: radial-gradient(#dfe7f2 0.8px, transparent 0.8px); background-size: 22px 22px; }
.rc-flow { position: relative; margin: 24px auto; }
.rc-flow svg { position: absolute; inset: 0; pointer-events: none; }
.rc-edge { fill: none; stroke: #94a3b8; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.rc-edge.rule { stroke: #60a5fa; stroke-dasharray: 5 4; }
.rc-edge.fan-out { stroke: #f59e0b; stroke-width: 1.5; }
.rc-fanout-col-tag { position: absolute; transform: translateX(-50%); max-width: 200px; box-sizing: border-box; text-align: center; font-size: 10px; font-weight: 500; color: #475569; pointer-events: none; z-index: 22; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-term { position: absolute; width: 150px; height: 36px; box-sizing: border-box; border: 1px solid var(--rc-border); border-radius: 18px; background: #fff; color: var(--rc-text-2); display: flex; align-items: center; justify-content: center; font-weight: 600; box-shadow: 0 2px 8px -5px rgba(15, 23, 42, 0.2); }
.rc-edge-table-tag { position: absolute; transform: translate(-50%, 0); font-size: 9px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; pointer-events: none; z-index: 21; }
.rc-flow-node { position: absolute; display: flex; flex-direction: column; box-sizing: border-box; width: 210px; height: 108px; padding: 10px 12px; border: 1px solid var(--rc-border); border-radius: 10px; background: #fff; box-shadow: 0 4px 14px -10px rgba(15, 23, 42, 0.35); overflow: hidden; cursor: pointer; transition: border-color 0.12s, box-shadow 0.12s; }
.rc-flow-node:hover { border-color: #bfdbfe; }
.rc-flow-node.active { border-color: var(--rc-primary); box-shadow: 0 0 0 2px #dbeafe, 0 10px 22px -12px rgba(37, 99, 235, 0.5); }
.rc-flow-node.rule-node { border-color: #bfdbfe; background: #fbfdff; }
.rc-flow-node.check-node { border-color: #fed7aa; background: #fffaf0; }
.rc-flow-node.mail-node { border-color: #d9f99d; background: #fcfff7; }
.rc-flow-node.planned { border-style: dashed; opacity: 0.72; }
.rc-flow-node.disabled-node { opacity: 0.48; filter: saturate(0.72); }
.rc-node-title { margin-top: 4px; font-size: 13px; font-weight: 700; color: var(--rc-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-node-type { font-size: 10px; color: var(--rc-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.rc-node-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 18px; }
.rc-node-meta-end { display: flex; align-items: center; gap: 4px; flex: none; }
.rc-node-stepid { flex: none; padding: 1px 6px; border-radius: 5px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font: 600 10px/14px ui-monospace, SFMono-Regular, Menlo, monospace; }
.rc-node-plan { flex: none; font-size: 9px; color: var(--rc-faint); border: 1px solid var(--rc-border); background: #f8fafc; border-radius: 5px; padding: 1px 5px; }
.rc-node-table { margin-top: 6px; font-size: 10px; color: var(--rc-faint); font-family: var(--rc-mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-node-table.unset { color: var(--rc-warn, #d98b25); }
.rc-node-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: auto; padding-top: 6px; color: var(--rc-muted); font-size: 10px; min-width: 0; }
.rc-node-foot > span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-node-cond { display: inline-block; padding: 1px 6px; border-radius: 5px; background: #fef3c7; color: #b45309; font-size: 10px; line-height: 16px; white-space: nowrap; flex: none; }
.rc-chip { padding: 1px 6px; border-radius: 5px; background: #f1f5f9; color: var(--rc-muted); }
.rc-chip.ok { background: var(--rc-ok-bg); color: var(--rc-ok); }
.rc-chip.warn { background: var(--rc-warn-bg); color: var(--rc-warn); }
</style>
