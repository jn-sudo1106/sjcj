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
import type { Source, Step } from '../api'

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

// 横向布局（结果视图节点条用）
export interface HPlacedPos { left: number; top: number; width: number; height: number }
export interface HPlacedNode { id: string; cfg: NodeConfig; pos: HPlacedPos; branch: boolean }
export interface HPlacedTerm { id: string; label: string; pos: HPlacedPos }
export interface HEdge { d: string; rule: boolean }

export const useFlowStore = defineStore('flow', () => {
  // ---- 状态 ----
  const configs = reactive<Record<string, NodeConfig>>({})
  const edges = reactive<Record<string, EdgeConfig>>({})
  // 默认空白画布（M5.5）：首次进入为干净的 开始 → 完成；标准链路 / 预置意图经「＋ 新建流程」载入
  const main = ref<string[]>(['start', 'end'])
  const branches = reactive<BranchSeed[]>([])

  const flowId = ref('flow-default')
  const flowName = ref('未命名流程')
  const sourceCtx = ref<Source | null>(null)
  const selectedId = ref<string>('')
  const selectedEdgeFrom = ref<string | null>(null)
  const activeKind = ref<'node' | 'edge'>('node')
  const activeTab = ref<string>('base')
  let seq = 1

  // ---- 未保存改动标记（B3）：load() 时清零，其余编辑动作调用 touch() 置脏 ----
  const dirty = ref(false)
  function touch() {
    dirty.value = true
  }
  function markSaved() {
    dirty.value = false
  }

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

  // ---- 横向布局：供结果视图顶部节点条使用 ----
  const horizontalLayout = computed(() => {
    const HNODE_W = 132
    const HNODE_H = 60
    const HTERM_W = 92
    const HTERM_H = 30
    const HGAP = 22
    const HBRANCH_DY = 86 // 旁路相对主链上下偏移
    const PAD_X = 16
    const PAD_Y = 10
    // 主链顶对齐：仅当有"上方旁路"时才在主链上方留空，否则贴顶；下方旁路向下扩展高度
    const hasAbove = branches.some((b) => b.side === 'left')
    const hasBelow = branches.some((b) => b.side === 'right')
    const axisY = (hasAbove ? HBRANCH_DY : PAD_Y) + HNODE_H / 2

    const mainPos: Record<string, HPlacedPos> = {}
    let x = PAD_X
    main.value.forEach((id) => {
      const isT = isTerm(id)
      const w = isT ? HTERM_W : HNODE_W
      const h = isT ? HTERM_H : HNODE_H
      mainPos[id] = { left: x, top: axisY - h / 2, width: w, height: h }
      x += w + HGAP
    })
    const totalWidth = Math.max(640, x + PAD_X - HGAP)
    const totalHeight = (hasBelow ? axisY + HBRANCH_DY + HNODE_H / 2 : axisY + HNODE_H / 2) + PAD_Y

    const branchPos: Record<string, HPlacedPos> = {}
    branches.forEach((b) => {
      const anchor = mainPos[b.rowAnchor]
      if (!anchor || !configs[b.id]) return
      branchPos[b.id] = {
        left: anchor.left,
        top: b.side === 'left' ? axisY - HBRANCH_DY - HNODE_H / 2 : axisY + HBRANCH_DY - HNODE_H / 2,
        width: HNODE_W,
        height: HNODE_H,
      }
    })

    const nodes: HPlacedNode[] = []
    const terminals: HPlacedTerm[] = []
    main.value.forEach((id) => {
      if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
      else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false })
    })
    branches.forEach((b) => {
      if (branchPos[b.id] && configs[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true })
    })

    // 主链横向连线
    const mainEdges: HEdge[] = []
    for (let i = 0; i < main.value.length - 1; i++) {
      const a = mainPos[main.value[i]]
      const b = mainPos[main.value[i + 1]]
      if (!a || !b) continue
      mainEdges.push({
        d: `M${a.left + a.width} ${axisY} L${b.left} ${axisY}`,
        rule: Boolean(configs[main.value[i + 1]] && /规则/.test(configs[main.value[i + 1]].title)),
      })
    }

    // 旁路 bezier
    const branchEdges: HEdge[] = []
    branches.forEach((b) => {
      const bp = branchPos[b.id]
      const mainEnd = b.edgeFrom === b.id ? b.edgeTo : b.edgeFrom
      const mp = mainPos[mainEnd]
      if (!bp || !mp) return
      const bx = bp.left + bp.width / 2
      const by = b.side === 'left' ? bp.top + bp.height : bp.top
      const mx = mp.left + mp.width / 2
      const my = axisY
      branchEdges.push({ d: `M${mx} ${my} C${mx} ${(my + by) / 2} ${bx} ${(my + by) / 2} ${bx} ${by}`, rule: false })
    })

    return { nodes, terminals, mainEdges, branchEdges, totalWidth, totalHeight, axisY }
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
    touch()
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
    touch()
  }
  function move(id: string, dir: -1 | 1) {
    const i = main.value.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 1 || j > main.value.length - 2) return
    const next = [...main.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    main.value = next
    select(id)
    touch()
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
    touch()
  }
  function toggleDisabled(id: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.disabled = !cfg.disabled
    select(id)
    touch()
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
    touch()
  }
  function setTitle(id: string, title: string) {
    const cfg = configs[id]
    if (cfg) cfg.title = title || '未命名节点'
    touch()
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
    touch()
  }
  function setBaseRow(id: string, index: number, value: string) {
    const c = configs[id]
    if (c && c.base[index]) c.base[index][1] = value
    touch()
  }
  function setFieldRow(id: string, index: number, value: string) {
    const c = configs[id]
    if (c && c.fields[index]) c.fields[index][1] = value
    touch()
  }
  function setOutputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.outputTable = tableId
    touch()
  }

  // ---- inmap / params / output 三列表格行级编辑（Phase 3）----
  type TripleField = 'inmap' | 'params' | 'output'
  function setTripleCell(id: string, field: TripleField, rowIndex: number, colIndex: 0 | 1 | 2, value: string) {
    const c = configs[id]
    const row = c?.[field]?.[rowIndex]
    if (row) row[colIndex] = value
    touch()
  }
  function addTripleRow(id: string, field: TripleField) {
    const c = configs[id]
    if (c) (c[field] as [string, string, string][]).push(['', '', ''])
    touch()
  }
  function removeTripleRow(id: string, field: TripleField, rowIndex: number) {
    const c = configs[id]
    if (c) c[field].splice(rowIndex, 1)
    touch()
  }

  // ---- 连线（子步骤）编辑 ----
  function setEdgeRow(fromId: string, index: number, value: string) {
    const e = edges[fromId]
    if (e && e.rows[index]) e.rows[index][1] = value
    touch()
  }
  // 出参列多选（Phase 4.1）：勾选/取消勾选步骤输出表的某个字段
  function toggleEdgeOutcol(fromId: string, prop: string) {
    const e = edges[fromId]
    if (!e) return
    const idx = e.outcols.indexOf(prop)
    if (idx >= 0) e.outcols.splice(idx, 1)
    else e.outcols.push(prop)
    touch()
  }
  // 选中实体表时同步 rows 文本（向后兼容旧的自由文本展示）；清空选择时不覆盖已有文本。
  function setEdgeTable(fromId: string, field: 'inputTableId' | 'outputTableId', tableId: string, label: string) {
    const e = edges[fromId]
    if (!e) return
    const rowIndex = field === 'inputTableId' ? 1 : 4
    if (field === 'inputTableId') e.inputTableId = tableId || undefined
    else e.outputTableId = tableId || undefined
    if (tableId && e.rows[rowIndex]) e.rows[rowIndex][1] = label
    touch()
  }
  function setEdgeEnabled(fromId: string, value: boolean) {
    const e = edges[fromId]
    if (e) e.enabled = value
    touch()
  }
  function addEdgeContext(fromId: string, value: string) {
    const e = edges[fromId]
    if (e && value) e.context.push(value)
    touch()
  }
  function removeEdgeContext(fromId: string, index: number) {
    const e = edges[fromId]
    if (e) e.context.splice(index, 1)
    touch()
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
    dirty.value = false
  }
  function setFlowName(name: string) {
    flowName.value = name || '未命名流程'
    touch()
  }

  // 新建流程：空白（开始→完成）或标准链路模板（= 公告规则采集 Demo）
  function newFlow(kind: 'blank' | 'standard' = 'blank') {
    sourceCtx.value = null
    load(kind === 'standard' ? makeStandardFlow() : makeBlankFlow())
  }

  // 源 → 画布：把源的子步骤编译为画布节点（首步当列表，其余当详情）
  function loadFromSource(source: Source, steps: Step[]) {
    sourceCtx.value = source
    const seedConfigs: Record<string, NodeConfig> = {}
    const seedMain: string[] = ['start']
    steps.forEach((step, i) => {
      const templateKey = i === 0 ? 'web-list' : 'web-detail'
      const cfg = cloneConfig(NODE_CONFIGS[templateKey])
      cfg.title = step.name || (i === 0 ? '列表抓取' : '详情解析')
      if (cfg.collectCfg) {
        cfg.collectCfg.sourceName = source.name
        cfg.collectCfg.url = source.url
        cfg.collectCfg.outputTable = step.outputTable || source.mainTable || ''
        cfg.collectCfg.configId = step.configId || source.configId
        cfg.collectCfg.tags = source.tags?.join(', ') || ''
        cfg.collectCfg.category = source.categoryPath || ''
        cfg.collectCfg.dirId = source.dirId || ''
        cfg.collectCfg.resume = source.resume ?? cfg.collectCfg.resume
        cfg.collectCfg.credentialRef = source.credentialRef || ''
        cfg.collectCfg.needLogin = Boolean(source.credentialRef)
        cfg.collectCfg.isLogin = Boolean(source.credentialRef)
      }
      cfg.disabled = !step.enabled
      seedConfigs[step.stepId] = cfg
      seedMain.push(step.stepId)
    })
    seedMain.push('end')
    // 演示：名字含「规则」的源追加一个旁路「规则处理」节点（非数据节点，结果视图下不可点）
    const branchSeeds: BranchSeed[] = []
    if (/规则/.test(source.name) && steps.length > 0) {
      const lastStepId = steps[steps.length - 1].stepId
      const ruleId = `${source.sourceId}-rule-demo`
      const ruleCfg = cloneConfig(NODE_CONFIGS.rule)
      ruleCfg.title = '规则处理'
      delete ruleCfg.collectCfg
      seedConfigs[ruleId] = ruleCfg
      branchSeeds.push({ id: ruleId, side: 'right', rowAnchor: lastStepId, edgeFrom: lastStepId, edgeTo: ruleId })
    }
    load({
      id: source.sourceId,
      name: source.name,
      version: `source-v${source.version ?? 1}`,
      main: seedMain,
      branches: branchSeeds,
      configs: seedConfigs,
      edges: {},
      updatedAt: source.updatedAt || '',
    })
  }
  function clearSourceCtx() {
    sourceCtx.value = null
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
    flowId, flowName, sourceCtx, dirty,
    selectedId, selectedEdgeFrom, activeKind, activeTab,
    layout, horizontalLayout, selectedNode, selectedEdge,
    isTerm,
    select, selectEdge, setActiveTab,
    insertAfter, duplicate, move, moveTo, toggleDisabled, remove, setTitle,
    patchCollect, setBaseRow, setFieldRow, setOutputTable,
    setTripleCell, addTripleRow, removeTripleRow,
    setEdgeRow, toggleEdgeOutcol, setEdgeEnabled, setEdgeTable, addEdgeContext, removeEdgeContext,
    serialize, load, setFlowName, newFlow, loadFromSource, clearSourceCtx, validateFlow, markSaved,
  }
})
