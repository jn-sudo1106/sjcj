import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  NODE_CONFIGS,
  TEMPLATE_TO_NODE,
  TEMPLATE_TO_NAME,
  TEMPLATE_TO_SNATCH,
  defaultEdgeConfig,
  cloneConfig,
  isDecision,
  isParallel,
  makeBlankFlow,
  makeStandardFlow,
  type NodeConfig,
  type EdgeConfig,
  type CollectConfig,
  type BranchSeed,
  type FlowDef,
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
  // 默认空白画布（M5.5）：首次进入为干净的 开始 → 完成；标准链路 / 预置意图经「＋ 新建流程」载入
  const main = ref<string[]>(['start', 'end'])
  const branches = reactive<BranchSeed[]>([])

  const flowId = ref('flow-default')
  const flowName = ref('未命名流程')
  const selectedId = ref<string>('')
  const selectedEdgeFrom = ref<string | null>(null)
  const activeKind = ref<'node' | 'edge'>('node')
  const activeTab = ref<string>('base')
  let seq = 1

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
    // 新插入节点：名称取节点类型名，不继承种子模板的具体标题
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    // 采集类节点：源名称默认 = 节点名称，抓取类型 = 节点类型；其余具体配置清空待填
    if (cfg.collectCfg) {
      cfg.collectCfg.sourceName = cfg.title
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      cfg.collectCfg.configId = ''
      cfg.collectCfg.outputTable = ''
      cfg.collectCfg.inputParams = []
      cfg.collectCfg.tags = ''
    }
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
    if (!c?.collectCfg) return
    const next = { ...patch }
    if (next.webKind) next.isDetail = next.webKind === 'detail'
    else if (next.isDetail) next.webKind = 'detail'
    else if (next.isDetail === false && c.collectCfg.webKind === 'detail') next.webKind = 'list'
    Object.assign(c.collectCfg, next)
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

  // ---- 流程定义 序列化 / 加载 ----
  function serialize(): FlowDef {
    return {
      id: flowId.value,
      name: flowName.value,
      version: 'draft-0.3',
      main: [...main.value],
      branches: JSON.parse(JSON.stringify(branches)) as BranchSeed[],
      configs: JSON.parse(JSON.stringify(configs)) as Record<string, NodeConfig>,
      edges: JSON.parse(JSON.stringify(edges)) as Record<string, EdgeConfig>,
      updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
    }
  }
  function load(def: FlowDef) {
    flowId.value = def.id
    flowName.value = def.name
    Object.keys(configs).forEach((k) => delete configs[k])
    Object.assign(configs, JSON.parse(JSON.stringify(def.configs)))
    Object.keys(edges).forEach((k) => delete edges[k])
    Object.assign(edges, JSON.parse(JSON.stringify(def.edges)))
    branches.splice(0, branches.length, ...(JSON.parse(JSON.stringify(def.branches)) as BranchSeed[]))
    main.value = [...def.main]
    const first = main.value.find((m) => !isTerm(m))
    if (first) select(first)
    else {
      selectedId.value = ''
      selectedEdgeFrom.value = null
      activeKind.value = 'node'
    }
  }
  function setFlowName(name: string) {
    flowName.value = name || '未命名流程'
  }

  // 新建流程：空白（开始→完成）或标准链路模板（= 公告规则采集 Demo）
  function newFlow(kind: 'blank' | 'standard' = 'blank') {
    load(kind === 'standard' ? makeStandardFlow() : makeBlankFlow())
  }

  // 发布门禁（M5.5 极简版）：空链路 / 采集节点缺 URL·输出表 不可发布
  function validateFlow(def?: FlowDef): string[] {
    const d = def ?? serialize()
    const errs: string[] = []
    const nodeIds = d.main.filter((idv) => !isTerm(idv))
    if (!nodeIds.length) errs.push('流程为空：至少添加一个节点')
    nodeIds.forEach((nid) => {
      const c = d.configs[nid]
      if (!c?.collectCfg) return
      if (!c.collectCfg.url) errs.push(`「${c.title}」缺少源 URL`)
      if (!c.collectCfg.outputTable) errs.push(`「${c.title}」缺少输出表`)
    })
    return errs
  }

  return {
    configs, edges, main, branches,
    flowId, flowName,
    selectedId, selectedEdgeFrom, activeKind, activeTab,
    layout, selectedNode, selectedEdge,
    isTerm,
    select, selectEdge, setActiveTab,
    insertAfter, duplicate, move, moveTo, toggleDisabled, remove, setTitle,
    patchCollect, setBaseRow, setFieldRow,
    setEdgeRow, setEdgeOutcols, setEdgeEnabled, addEdgeContext, removeEdgeContext,
    serialize, load, setFlowName, newFlow, validateFlow,
  }
})
