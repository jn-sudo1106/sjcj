import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  NODE_CONFIGS,
  EDGE_CONFIGS,
  TEMPLATE_TO_NODE,
  defaultEdgeConfig,
  cloneConfig,
  isDecision,
  isParallel,
  type NodeConfig,
  type EdgeConfig,
  type CollectConfig,
} from '../views/FlowCanvas/flowModel'

// 画布布局常量（对齐原型：节点宽 210、居中 x=320、终端宽 150）
const CENTER = 320
const NODE_W = 210
const TERM_W = 150
const TERM_H = 36
const NODE_H = 108
const LOGIC_H = 140
const GAP = 30
const SIDE_OFFSET = 215 // 旁路节点相对主链左移/右移量 → 左列 x=0，右列 x=430

export const TERMINALS: Record<string, string> = { start: '开始', end: '完成 / 发布候选' }

interface BranchSeed {
  id: string
  side: 'left' | 'right'
  rowAnchor: string // 决定纵向位置的主链节点
  edgeFrom: string
  edgeTo: string
}

export interface PlacedPos { top: number; left: number; height: number }
export interface PlacedNode { id: string; cfg: NodeConfig; pos: PlacedPos; branch: boolean; side?: 'left' | 'right' }
export interface PlacedTerm { id: string; label: string; pos: PlacedPos }
export interface DropSlot { afterId: string; top: number }
export interface MainEdge { fromId: string; toId: string; d: string; rule: boolean; hasStep: boolean; label: string; lx: number; ly: number }
export interface BranchEdge { d: string }

export const useFlowStore = defineStore('flow', () => {
  // ---- 状态 ----
  const configs = reactive<Record<string, NodeConfig>>({})
  const edges = reactive<Record<string, EdgeConfig>>({})
  const main = ref<string[]>(['start', 'web-list', 'web-detail', 'ai-extract', 'rule', 'end'])
  const branches = reactive<BranchSeed[]>([
    { id: 'check', side: 'left', rowAnchor: 'ai-extract', edgeFrom: 'check', edgeTo: 'rule' },
    { id: 'mail', side: 'right', rowAnchor: 'ai-extract', edgeFrom: 'web-detail', edgeTo: 'mail' },
  ])

  const selectedId = ref<string>('web-list')
  const selectedEdgeFrom = ref<string | null>(null)
  const activeKind = ref<'node' | 'edge'>('node')
  const activeTab = ref<string>('source')
  let seq = 1

  // 种子配置（深拷贝，便于就地编辑）
  ;['web-list', 'web-detail', 'ai-extract', 'rule', 'check', 'mail'].forEach((k) => {
    configs[k] = cloneConfig(NODE_CONFIGS[k])
  })
  edges['web-list'] = JSON.parse(JSON.stringify(EDGE_CONFIGS['web-list']))

  // ---- 工具 ----
  function isTerm(id: string) {
    return id === 'start' || id === 'end'
  }
  function nodeHeight(id: string) {
    if (isTerm(id)) return TERM_H
    const cfg = configs[id]
    return cfg && (isDecision(cfg) || isParallel(cfg)) ? LOGIC_H : NODE_H
  }

  // ---- 布局（统一计算，供画布渲染） ----
  const layout = computed(() => {
    const mainPos: Record<string, PlacedPos> = {}
    let y = 0
    main.value.forEach((id) => {
      const h = nodeHeight(id)
      mainPos[id] = { top: y, left: isTerm(id) ? CENTER - TERM_W / 2 : CENTER - NODE_W / 2, height: h }
      y += h + GAP
    })
    const totalHeight = Math.max(560, y)

    const branchPos: Record<string, PlacedPos> = {}
    branches.forEach((b) => {
      const anchor = mainPos[b.rowAnchor]
      if (!anchor || !configs[b.id]) return
      branchPos[b.id] = {
        top: anchor.top,
        left: CENTER - NODE_W / 2 + (b.side === 'left' ? -SIDE_OFFSET : SIDE_OFFSET),
        height: NODE_H,
      }
    })

    const nodes: PlacedNode[] = []
    const terminals: PlacedTerm[] = []
    main.value.forEach((id) => {
      if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
      else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false })
    })
    branches.forEach((b) => {
      if (branchPos[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true, side: b.side })
    })

    // 主链插入点 + 连线
    const slots: DropSlot[] = []
    const mainEdges: MainEdge[] = []
    for (let i = 0; i < main.value.length - 1; i++) {
      const a = main.value[i]
      const b = main.value[i + 1]
      const aBottom = mainPos[a].top + mainPos[a].height
      const bTop = mainPos[b].top
      slots.push({ afterId: a, top: (aBottom + bTop) / 2 })
      const stepCfg = edges[a]
      mainEdges.push({
        fromId: a,
        toId: b,
        d: `M${CENTER} ${aBottom} L${CENTER} ${bTop}`,
        rule: Boolean(configs[b] && /规则/.test(configs[b].title)),
        hasStep: Boolean(stepCfg),
        label: stepCfg ? `⚙ ${stepCfg.title.split(' ')[0]}` : '',
        lx: CENTER + 118,
        ly: (aBottom + bTop) / 2,
      })
    }

    // 旁路 bezier 连线
    const branchEdges: BranchEdge[] = []
    branches.forEach((b) => {
      const bp = branchPos[b.id]
      const mainEnd = b.edgeFrom === b.id ? b.edgeTo : b.edgeFrom
      const mp = mainPos[mainEnd]
      if (!bp || !mp) return
      const branchMid = bp.top + bp.height / 2
      const mainMid = mp.top + mp.height / 2
      branchEdges.push({
        d:
          b.side === 'right'
            ? `M430 ${mainMid} C515 ${mainMid} 515 ${branchMid} 430 ${branchMid}`
            : `M210 ${mainMid} C125 ${mainMid} 125 ${branchMid} 210 ${branchMid}`,
      })
    })

    return { nodes, terminals, slots, mainEdges, branchEdges, totalHeight }
  })

  // ---- 选择 ----
  function select(id: string) {
    activeKind.value = 'node'
    selectedId.value = id
    selectedEdgeFrom.value = null
    const cfg = configs[id]
    activeTab.value = cfg?.collect ? 'source' : 'base'
  }
  function selectEdge(fromId: string) {
    if (!edges[fromId]) edges[fromId] = defaultEdgeConfig()
    activeKind.value = 'edge'
    selectedEdgeFrom.value = fromId
    activeTab.value = 'edge'
  }
  function setActiveTab(tab: string) {
    activeTab.value = tab
  }

  const selectedNode = computed<NodeConfig | undefined>(() => configs[selectedId.value])
  const selectedEdge = computed<EdgeConfig | undefined>(() =>
    selectedEdgeFrom.value ? edges[selectedEdgeFrom.value] : undefined,
  )

  // ---- 编辑动作 ----
  function insertAfter(prevId: string, template: string) {
    const srcKey = TEMPLATE_TO_NODE[template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    if (template === 'decision') cfg.kind = 'decision'
    if (template === 'parallel') cfg.kind = 'parallel'
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    const idx = main.value.indexOf(prevId)
    const at = idx < 0 ? main.value.length - 1 : idx + 1
    main.value.splice(at, 0, id)
    // 原 prev→next 的子步骤配置归属新的 new→next
    if (edges[prevId]) {
      edges[id] = edges[prevId]
      delete edges[prevId]
    }
    select(id)
    return id
  }
  function duplicate(id: string) {
    if (!configs[id]) return
    const cfg = cloneConfig(configs[id])
    cfg.title = cfg.title.replace(/（复制）$/, '') + '（复制）'
    const newId = `${id}-copy-${seq++}`
    configs[newId] = cfg
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx + 1, 0, newId)
    select(newId)
  }
  function move(id: string, dir: -1 | 1) {
    const i = main.value.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 1 || j > main.value.length - 2) return
    const next = [...main.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    main.value = next
    select(id)
  }
  // 拖拽重排：把主链节点 id 移动到 afterId 之后（保持首尾终端不动）
  function moveTo(id: string, afterId: string) {
    if (id === afterId) return
    const i = main.value.indexOf(id)
    if (i < 1 || i > main.value.length - 2) return // 仅主链非终端节点可拖移
    const arr = main.value.filter((x) => x !== id)
    const at = arr.indexOf(afterId)
    if (at < 0) return
    arr.splice(at + 1, 0, id)
    main.value = arr
    select(id)
  }
  function toggleDisabled(id: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.disabled = !cfg.disabled
    select(id)
  }
  function remove(id: string) {
    const idx = main.value.indexOf(id)
    if (idx >= 0) {
      main.value.splice(idx, 1)
      delete edges[id]
    } else {
      const bi = branches.findIndex((b) => b.id === id)
      if (bi >= 0) branches.splice(bi, 1)
    }
    delete configs[id]
    const fallback = main.value.find((m) => !isTerm(m))
    if (fallback) select(fallback)
  }
  function setTitle(id: string, title: string) {
    const cfg = configs[id]
    if (cfg) cfg.title = title || '未命名节点'
  }

  // ---- 节点字段编辑 ----
  function patchCollect(id: string, patch: Partial<CollectConfig>) {
    const c = configs[id]
    if (c?.collectCfg) Object.assign(c.collectCfg, patch)
  }
  function setBaseRow(id: string, index: number, value: string) {
    const c = configs[id]
    if (c && c.base[index]) c.base[index][1] = value
  }
  function setFieldRow(id: string, index: number, value: string) {
    const c = configs[id]
    if (c && c.fields[index]) c.fields[index][1] = value
  }

  // ---- 连线（子步骤）编辑 ----
  function setEdgeRow(fromId: string, index: number, value: string) {
    const e = edges[fromId]
    if (e && e.rows[index]) e.rows[index][1] = value
  }
  function setEdgeOutcols(fromId: string, value: string) {
    const e = edges[fromId]
    if (e) e.outcols = value
  }
  function setEdgeEnabled(fromId: string, value: boolean) {
    const e = edges[fromId]
    if (e) e.enabled = value
  }
  function addEdgeContext(fromId: string, value: string) {
    const e = edges[fromId]
    if (e && value) e.context.push(value)
  }
  function removeEdgeContext(fromId: string, index: number) {
    const e = edges[fromId]
    if (e) e.context.splice(index, 1)
  }

  return {
    configs, edges, main, branches,
    selectedId, selectedEdgeFrom, activeKind, activeTab,
    layout, selectedNode, selectedEdge,
    isTerm,
    select, selectEdge, setActiveTab,
    insertAfter, duplicate, move, moveTo, toggleDisabled, remove, setTitle,
    patchCollect, setBaseRow, setFieldRow,
    setEdgeRow, setEdgeOutcols, setEdgeEnabled, addEdgeContext, removeEdgeContext,
  }
})
