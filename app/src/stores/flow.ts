// stores/flow.ts - 流程核心状态（P2-1 · stores/flow.ts 拆分）
// 职责：configs/main/branches/branchGroups + 节点 CRUD + 分支操作 + 布局计算 + serialize/load
// 组合 source.ts 和 node.ts 保持 API 不变
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  NODE_CONFIGS,
  TEMPLATE_TO_NODE,
  TEMPLATE_TO_NAME,
  TEMPLATE_TO_SNATCH,
  cloneConfig,
  conditionGroupLabel,
  conditionGroupIsSet,
  isDecision,
  isParallel,
  isDataNode,
  nodeOutputTable,
  effectiveInputTable,
  isFirstMainNode,
  makeBlankFlow,
  makeStandardFlow,
  buildHorizontalLayout,
  applyParamSourceUrlToFirstCollectNode,
  normalizeNodeConfigs,
  collectorCapabilityOf,
  TERMINALS,
  type NodeConfig,
  type CollectConfig,
  type ConditionGroup,
  type TaskConfig,
  type TripleField,
  type BranchSeed,
  type FlowBranch,
  type FlowBranchGroup,
  type FlowDef,
  type RuleOrchestration,
} from '@/views/FlowCanvas/canvas/flowModel'
import { extractUrlParamIds, hasFragmentParams } from '@/utils/flow/urlParams'
import {
  composeTemplateFlow,
  extractTemplateNodeBindings,
} from '@/utils/flow/flowTemplates'
import type { FlowTemplate, Source, Site, Step } from '../api'
import { useSourceStore } from './source'
import { useNodeStore } from './node'
import { useRuntimeStore } from './runtime'

// 画布布局常量（对齐原型：节点宽 210、居中 x=320、终端宽 150）
const CENTER = 320
const NODE_W = 210
const TERM_W = 150
const TERM_H = 36
const NODE_H = 108
const LOGIC_H = 140
const GAP = 30
const SIDE_OFFSET = 215 // 旁路节点相对主链左移/右移量 → 左列 x=0，右列 x=430

export interface PlacedPos { top: number; left: number; height: number }
export interface PlacedNode { id: string; cfg: NodeConfig; pos: PlacedPos; branch: boolean; side?: 'left' | 'right' }
export interface PlacedTerm { id: string; label: string; pos: PlacedPos }
export interface DropSlot { afterId: string; top: number }
/** 决策/分头节点的 fan-out 分支连线（0707 优化·Phase6）：owner 底边 → 每列首节点 + 列内节点连线。
 *  branchLabel / condLabel 仅首段（owner → 列首节点）携带，供画布在连线起点渲染分支名/条件摘要。 */
export interface FanOutEdge { d: string; branchLabel?: string; condLabel?: string }
/** fan-out 列 meta：用于 FlowBoard 渲染列头/列脚标签 */
export interface FanOutColMeta {
  ownerId: string
  branches: { id: string; label: string; condLabel: string; colX: number; top: number; height: number; chain: string[] }[]
}
export interface MainEdge { fromId: string; toId: string; d: string; rule: boolean; lx: number; ly: number }
export interface BranchEdge { d: string }

export const useFlowStore = defineStore('flow', () => {
  // 组合子 store
  const sourceStore = useSourceStore()
  const nodeStore = useNodeStore()

  // 代理 source store 的状态（保持 API 不变）
  const flowId = computed({
    get: () => sourceStore.flowId,
    set: (v) => { sourceStore.flowId = v },
  })
  const flowName = computed({
    get: () => sourceStore.flowName,
    set: (v) => { sourceStore.flowName = v },
  })
  const sourceCtx = computed({
    get: () => sourceStore.sourceCtx,
    set: (v) => { sourceStore.sourceCtx = v },
  })
  const sourceCfg = computed({
    get: () => sourceStore.sourceCfg,
    set: (v) => { sourceStore.sourceCfg = v },
  })
  const siteCtx = computed({
    get: () => sourceStore.siteCtx,
    set: (v) => { sourceStore.siteCtx = v },
  })

  // 代理 node store 的状态（保持 API 不变）
  const selectedId = computed({
    get: () => nodeStore.selectedId,
    set: (v) => { nodeStore.selectedId = v },
  })
  const activeTab = computed({
    get: () => nodeStore.activeTab,
    set: (v) => { nodeStore.activeTab = v },
  })
  const dirty = computed({
    get: () => nodeStore.dirty,
    set: (v) => { nodeStore.dirty = v },
  })

  // ---- 流程核心状态 ----
  const configs = reactive<Record<string, NodeConfig>>({})
  // 默认空白画布（M5.5）：首次进入为干净的 开始 → 完成；标准链路 / 预置意图经「＋ 新建流程」载入
  const main = ref<string[]>(['start', 'end'])
  const branches = reactive<BranchSeed[]>([])
  // 决策/分头节点的分支段（0707 优化·Phase6）：与 BranchSeed 旁路挂靠并存，不互相替代。
  const branchGroups = reactive<FlowBranchGroup[]>([])
  // 分支 id 自增序列（0707 Phase6）：保证同一 FlowDef 内 FlowBranch.id 不重复
  let branchSeq = 1
  let seq = 1

  // 绑定 flow store 到 node store（供节点编辑函数访问 configs/main）
  nodeStore.bindFlowStore(configs, () => main.value)

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
    const branchPos: Record<string, PlacedPos> = {}
    // 0707 优化·Phase6：决策/分头节点的 fan-out 列布局
    const fanOutPos: Record<string, PlacedPos> = {}
    const fanOutColMeta: Record<string, FanOutColMeta> = {}
    const fanOutEdges: FanOutEdge[] = []

    // 第一遍：算每个决策/分头节点的 fan-out 总高度（max chain）
    const fanOutHeight: Record<string, number> = {}
    for (const id of main.value) {
      const bg = branchGroups.find((g) => g.ownerId === id)
      if (!bg) continue
      let maxChainH = 0
      for (const b of bg.branches) {
        let ch = 0
        for (const nid of b.chain) ch += nodeHeight(nid) + GAP
        if (ch > 0) ch -= GAP
        if (ch > maxChainH) maxChainH = ch
      }
      fanOutHeight[id] = maxChainH
    }

    // 第二遍：分配 y 坐标（决策/分头节点预留下方 fan-out 空间）
    let y = 0
    main.value.forEach((id) => {
      if (isTerm(id)) {
        mainPos[id] = { top: y, left: CENTER - TERM_W / 2, height: TERM_H }
        y += TERM_H + GAP
        return
      }
      const cfg = configs[id]
      const baseH = nodeHeight(id)
      mainPos[id] = { top: y, left: CENTER - NODE_W / 2, height: baseH }
      const bg = branchGroups.find((g) => g.ownerId === id)
      if (bg && (cfg?.kind === 'decision' || cfg?.kind === 'parallel')) {
        // fan-out 区域：owner 节点下方 N 列
        const N = bg.branches.length
        const colGap = 16
        const totalWidth = N * NODE_W + Math.max(0, N - 1) * colGap
        const startCx = CENTER - totalWidth / 2 + NODE_W / 2
        const ownerBottom = y + baseH
        const fanOutTop = ownerBottom + GAP
        const fanOutH = fanOutHeight[id] || 0

        const cols: FanOutColMeta['branches'] = []
        bg.branches.forEach((b, i) => {
          const colCx = startCx + i * (NODE_W + colGap)
          const colLeft = colCx - NODE_W / 2
          let cy = fanOutTop
          let chainH = 0
          for (const nid of b.chain) {
            const h = nodeHeight(nid)
            fanOutPos[nid] = { top: cy, left: colLeft, height: h }
            cy += h + GAP
            chainH += h + GAP
          }
          if (chainH > 0) chainH -= GAP
          cols.push({
            id: b.id,
            label: b.label,
            condLabel: conditionGroupLabel(b.condition),
            colX: colCx,
            top: fanOutTop,
            height: chainH,
            chain: b.chain,
          })
        })
        fanOutColMeta[id] = { ownerId: id, branches: cols }

        // 推进 y：owner + GAP + fan-out 高度
        y = fanOutTop + fanOutH + GAP
      } else {
        y += baseH + GAP
      }
    })
    const totalHeight = Math.max(560, y)

    // 旁路挂靠（BranchSeed）
    branches.forEach((b) => {
      const anchor = mainPos[b.rowAnchor]
      if (!anchor || !configs[b.id]) return
      branchPos[b.id] = {
        top: anchor.top,
        left: CENTER - NODE_W / 2 + (b.side === 'left' ? -SIDE_OFFSET : SIDE_OFFSET),
        height: NODE_H,
      }
    })

    // 节点列表
    const nodes: PlacedNode[] = []
    const terminals: PlacedTerm[] = []
    main.value.forEach((id) => {
      if (isTerm(id)) terminals.push({ id, label: TERMINALS[id], pos: mainPos[id] })
      else if (configs[id]) nodes.push({ id, cfg: configs[id], pos: mainPos[id], branch: false })
    })
    // fan-out 节点
    for (const fid of Object.keys(fanOutPos)) {
      if (configs[fid]) nodes.push({ id: fid, cfg: configs[fid], pos: fanOutPos[fid], branch: true })
    }
    // 旁路挂靠
    branches.forEach((b) => {
      if (branchPos[b.id]) nodes.push({ id: b.id, cfg: configs[b.id], pos: branchPos[b.id], branch: true, side: b.side })
    })

    // 主链插入点 + 主链连线
    const slots: DropSlot[] = []
    const mainEdges: MainEdge[] = []
    for (let i = 0; i < main.value.length - 1; i++) {
      const a = main.value[i]
      const b = main.value[i + 1]
      if (!mainPos[a] || !mainPos[b]) continue
      const aBottom = mainPos[a].top + mainPos[a].height
      const bTop = mainPos[b].top
      if (fanOutColMeta[a]) {
        slots.push({ afterId: a, top: bTop - GAP / 2 })
        continue
      }
      slots.push({ afterId: a, top: (aBottom + bTop) / 2 })
      mainEdges.push({
        fromId: a,
        toId: b,
        d: `M${CENTER} ${aBottom} L${CENTER} ${bTop}`,
        rule: Boolean(configs[b] && /规则/.test(configs[b].title)),
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
        d: b.side === 'right'
          ? `M430 ${mainMid} C515 ${mainMid} 515 ${branchMid} 430 ${branchMid}`
          : `M210 ${mainMid} C125 ${mainMid} 125 ${branchMid} 210 ${branchMid}`,
      })
    })

    // 0707 优化·Phase6：fan-out 分支连线
    for (const id of main.value) {
      const meta = fanOutColMeta[id]
      if (!meta) continue
      const ownerCx = CENTER
      const ownerBottom = mainPos[id] ? mainPos[id].top + mainPos[id].height : 0
      for (const br of meta.branches) {
        if (!br.chain.length) {
          fanOutEdges.push({ d: `M${ownerCx} ${ownerBottom} L${br.colX} ${br.top}`, branchLabel: br.label, condLabel: br.condLabel })
          continue
        }
        const firstId = br.chain[0]
        const firstPos = fanOutPos[firstId]
        if (firstPos) {
          const firstCx = firstPos.left + NODE_W / 2
          const firstTop = firstPos.top
          fanOutEdges.push({
            d: `M${ownerCx} ${ownerBottom} C${ownerCx} ${(ownerBottom + firstTop) / 2} ${firstCx} ${(ownerBottom + firstTop) / 2} ${firstCx} ${firstTop}`,
            branchLabel: br.label,
            condLabel: br.condLabel,
          })
        }
        for (let i = 0; i < br.chain.length - 1; i++) {
          const aId = br.chain[i]
          const bId = br.chain[i + 1]
          const aPos = fanOutPos[aId]
          const bPos = fanOutPos[bId]
          if (!aPos || !bPos) continue
          const aCx = aPos.left + NODE_W / 2
          const aBottom = aPos.top + aPos.height
          const bCx = bPos.left + NODE_W / 2
          const bTop = bPos.top
          fanOutEdges.push({ d: `M${aCx} ${aBottom} L${bCx} ${bTop}` })
        }
        // fan-in 收拢：列尾 → 汇合点（owner 在主链上的下一个节点）
        const ownerIdx = main.value.indexOf(id)
        const convergeId = main.value[ownerIdx + 1]
        if (convergeId && mainPos[convergeId]) {
          const lastId = br.chain[br.chain.length - 1]
          const lastPos = fanOutPos[lastId]
          if (lastPos) {
            const lastCx = lastPos.left + NODE_W / 2
            const lastBottom = lastPos.top + lastPos.height
            const convergeCx = CENTER
            const convergeTop = mainPos[convergeId].top
            fanOutEdges.push({ d: `M${lastCx} ${lastBottom} C${lastCx} ${(lastBottom + convergeTop) / 2} ${convergeCx} ${(lastBottom + convergeTop) / 2} ${convergeCx} ${convergeTop}` })
          }
        }
      }
    }

    return {
      nodes,
      terminals,
      mainEdges,
      branchEdges,
      fanOutEdges,
      fanOutColMeta,
      slots,
      totalHeight,
    }
  })

  // 横向布局：供结果视图顶部节点条使用（纯函数版见 flowModel.buildHorizontalLayout，分屏对比 Phase 5 复用同一算法；
  // 这里保留 computed 版供画布内直接引用）
  const horizontalLayout = computed(() => buildHorizontalLayout(main.value, branches, configs, branchGroups))

  // ---- 选择 ----
  function select(id: string) {
    selectedId.value = id
    activeTab.value = 'config'
  }
  function setActiveTab(tab: string) {
    activeTab.value = tab
  }

  const selectedNode = computed<NodeConfig | undefined>(() => configs[selectedId.value])

  // 从 fromId 起沿主链向上找最近一个有输出表的节点（含 fromId 自身）
  function upstreamOutputTable(fromId: string): string {
    const idx = main.value.indexOf(fromId)
    for (let i = idx; i >= 0; i--) {
      const c = configs[main.value[i]]
      if (c) {
        const t = nodeOutputTable(c)
        if (t) return t
      }
    }
    return ''
  }

  // 节点有效输入表 / 是否主链首节点（0701 问题五）：委托 flowModel 纯函数，供 UI 与 validateFlow 共用
  function effectiveInputTableFor(id: string): string {
    return effectiveInputTable(main.value, branches, configs, id, branchGroups)
  }
  function isFirstMainNodeId(id: string): boolean {
    return isFirstMainNode(main.value, configs, id)
  }

  // ---- 编辑动作 ----
  function insertAfter(prevId: string, template: string) {
    const srcKey = TEMPLATE_TO_NODE[template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    if (template === 'decision') cfg.kind = 'decision'
    if (template === 'parallel') cfg.kind = 'parallel'
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    if (cfg.collectCfg) {
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      const cap = collectorCapabilityOf(cfg)
      cfg.collectCfg.outputTable = cap?.outputMode === 'fixed' ? (cap.fixedOutputTable ?? '') : ''
      cfg.collectCfg.inputParams = []
    }
    if (!cfg.collectCfg && isDataNode(cfg) && !cfg.outputTable) {
      cfg.outputTable = upstreamOutputTable(prevId)
    }
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    const idx = main.value.indexOf(prevId)
    const at = prevId === 'end' ? idx : (idx < 0 ? main.value.length - 1 : idx + 1)
    main.value.splice(at, 0, id)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    if (template === 'decision') ensureBranchGroup(id, 'decision')
    else if (template === 'parallel') ensureBranchGroup(id, 'parallel')
    select(id)
    nodeStore.touch()
    return id
  }

  function upstreamOutputTableInBranch(ownerId: string, branch: FlowBranch): string {
    for (let i = branch.chain.length - 1; i >= 0; i--) {
      const c = configs[branch.chain[i]]
      if (c) {
        const t = nodeOutputTable(c)
        if (t) return t
      }
    }
    return effectiveInputTableFor(ownerId)
  }

  function addNodeToBranch(ownerId: string, branchId: string, template: string): string | null {
    if (template === 'decision' || template === 'parallel') return null
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    const branch = g?.branches.find((b) => b.id === branchId)
    if (!branch) return null
    const srcKey = TEMPLATE_TO_NODE[template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    if (cfg.collectCfg) {
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      const cap = collectorCapabilityOf(cfg)
      cfg.collectCfg.outputTable = cap?.outputMode === 'fixed' ? (cap.fixedOutputTable ?? '') : ''
      cfg.collectCfg.inputParams = []
    }
    if (!cfg.collectCfg && isDataNode(cfg) && !cfg.outputTable) {
      cfg.outputTable = upstreamOutputTableInBranch(ownerId, branch)
    }
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    branch.chain.push(id)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    select(id)
    nodeStore.touch()
    return id
  }

  function duplicateNode(id: string) {
    const src = configs[id]
    if (!src) return
    const cfg = JSON.parse(JSON.stringify(src)) as NodeConfig
    const newId = `${id.split('-')[0]}-${seq++}`
    configs[newId] = cfg
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx + 1, 0, newId)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    select(newId)
    nodeStore.touch()
  }

  function duplicate(id: string) {
    if (!configs[id]) return
    const cfg = cloneConfig(configs[id])
    cfg.title = cfg.title.replace(/（复制）$/, '') + '（复制）'
    const newId = `${id}-copy-${seq++}`
    configs[newId] = cfg
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx + 1, 0, newId)
    const bg = branchGroups.find((g) => g.ownerId === id)
    if (bg) {
      const newBg: FlowBranchGroup = {
        ownerId: newId,
        branches: bg.branches.map((b) => ({
          ...b,
          id: `${newId}-b-${b.id.split('-b-')[1] ?? `copy-${branchSeq++}`}`,
          chain: [...b.chain],
        })),
      }
      branchGroups.push(newBg)
    }
    select(newId)
    nodeStore.touch()
  }

  function move(id: string, dir: -1 | 1) {
    const i = main.value.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 1 || j > main.value.length - 2) return
    const next = [...main.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    main.value = next
    select(id)
    nodeStore.touch()
  }

  function moveTo(id: string, afterId: string) {
    if (id === afterId) return
    const i = main.value.indexOf(id)
    if (i < 1 || i > main.value.length - 2) return
    const arr = main.value.filter((x) => x !== id)
    const at = arr.indexOf(afterId)
    if (at < 0) return
    arr.splice(at + 1, 0, id)
    main.value = arr
    select(id)
    nodeStore.touch()
  }

  function toggleDisabled(id: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.disabled = !cfg.disabled
    select(id)
    nodeStore.touch()
  }

  function insertInBranch(ownerId: string, branchId: string, newNodeId: string, index?: number): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const branch = g.branches.find((b) => b.id === branchId)
    if (!branch) return false
    if (!configs[newNodeId]) return false
    if (branch.chain.includes(newNodeId)) return false
    if (index === undefined || index < 0 || index > branch.chain.length) {
      branch.chain.push(newNodeId)
    } else {
      branch.chain.splice(index, 0, newNodeId)
    }
    nodeStore.touch()
    return true
  }

  function removeBranchGroup(ownerId: string) {
    const i = branchGroups.findIndex((bg) => bg.ownerId === ownerId)
    if (i < 0) return
    const g = branchGroups[i]
    const orphans = new Set(g.branches.flatMap((b) => b.chain))
    for (const orphan of orphans) delete configs[orphan]
    branchGroups.splice(i, 1)
  }

  function detachFromBranches(nodeId: string) {
    for (const g of branchGroups) {
      for (const b of g.branches) {
        const i = b.chain.indexOf(nodeId)
        if (i >= 0) b.chain.splice(i, 1)
      }
    }
  }

  function remove(id: string) {
    // 分支段 owner 本身被删：连带整组分支
    const bgIdx = branchGroups.findIndex((bg) => bg.ownerId === id)
    if (bgIdx >= 0) {
      removeBranchGroup(id)
    } else {
      // 删节点时，从所有 FlowBranchGroup 的 chain 里摘除
      detachFromBranches(id)
    }
    delete configs[id]
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx, 1)
    // 旁路挂靠
    const branchIdx = branches.findIndex((b) => b.id === id)
    if (branchIdx >= 0) branches.splice(branchIdx, 1)
    if (selectedId.value === id) {
      const first = main.value.find((m) => !isTerm(m))
      if (first) select(first)
      else selectedId.value = ''
    }
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    // 清理运行时态，避免删除正在运行/已完成的节点后 runtime.nodeStates 残留脏数据
    useRuntimeStore().clearNodeStates([id])
    nodeStore.touch()
  }

  function setTitle(id: string, title: string) {
    const c = configs[id]
    if (c) c.title = title || '未命名节点'
    nodeStore.touch()
  }

  // ---- 决策/分头分支段操作（0707 优化·Phase6）----
  function ensureBranchGroup(ownerId: string, kind: 'decision' | 'parallel'): FlowBranchGroup | null {
    const existing = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (existing) return existing
    if (kind === 'decision') {
      const g: FlowBranchGroup = {
        ownerId,
        branches: [
          { id: `${ownerId}-b-condition-${branchSeq++}`, label: '条件分支 1', condition: undefined, chain: [] },
        ],
      }
      branchGroups.push(g)
      return g
    }
    if (kind === 'parallel') {
      const g: FlowBranchGroup = {
        ownerId,
        branches: [
          { id: `${ownerId}-b-a-${branchSeq++}`, label: '路径A', condition: undefined, chain: [] },
          { id: `${ownerId}-b-b-${branchSeq++}`, label: '路径B', condition: undefined, chain: [] },
        ],
      }
      branchGroups.push(g)
      return g
    }
    return null
  }

  function addBranch(ownerId: string): FlowBranch | null {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return null
    const cfg = configs[ownerId]
    if (!cfg || cfg.kind !== 'decision') return null
    const branch: FlowBranch = {
      id: `${ownerId}-b-condition-${branchSeq++}`,
      label: `条件分支 ${g.branches.length + 1}`,
      condition: undefined,
      chain: [],
    }
    g.branches.push(branch)
    nodeStore.touch()
    return branch
  }

  function removeBranch(ownerId: string, branchId: string): { ok: boolean; reason?: string } {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return { ok: false, reason: '未找到 FlowBranchGroup' }
    const idx = g.branches.findIndex((b) => b.id === branchId)
    if (idx < 0) return { ok: false, reason: '未找到分支' }
    const branch = g.branches[idx]
    if (branch.chain.length > 0) {
      return { ok: false, reason: `分支内还有 ${branch.chain.length} 个节点，请先移除` }
    }
    const minBranches = configs[ownerId]?.kind === 'parallel' ? 2 : 1
    if (g.branches.length <= minBranches) {
      return { ok: false, reason: `至少保留 ${minBranches} 条分支` }
    }
    g.branches.splice(idx, 1)
    nodeStore.touch()
    return { ok: true }
  }

  function moveBranch(ownerId: string, branchId: string, direction: 'up' | 'down'): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const index = g.branches.findIndex((b) => b.id === branchId)
    if (index < 0) return false
    const j = index + (direction === 'up' ? -1 : 1)
    if (j < 0 || j >= g.branches.length) return false
    const next = [...g.branches]
    ;[next[index], next[j]] = [next[j], next[index]]
    g.branches = next
    nodeStore.touch()
    return true
  }

  function moveInBranch(ownerId: string, branchId: string, index: number, direction: 'up' | 'down'): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const branch = g.branches.find((b) => b.id === branchId)
    if (!branch) return false
    const j = index + (direction === 'up' ? -1 : 1)
    if (j < 0 || j >= branch.chain.length) return false
    const next = [...branch.chain]
    ;[next[index], next[j]] = [next[j], next[index]]
    branch.chain = next
    nodeStore.touch()
    return true
  }

  function setBranchLabel(ownerId: string, branchId: string, label: string): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const branch = g.branches.find((b) => b.id === branchId)
    if (!branch) return false
    branch.label = label || branch.label
    nodeStore.touch()
    return true
  }

  function setBranchCondition(ownerId: string, branchId: string, cond: ConditionGroup | undefined): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    const branch = g?.branches.find((b) => b.id === branchId)
    if (!branch) return false
    branch.condition = cond
    nodeStore.touch()
    return true
  }

  // ---- 流程定义 序列化 / 加载 ----
  function serialize(): FlowDef {
    const defaultQueue =
      `${sourceCfg.value?.sourceId || siteCtx.value?.siteId || sourceCtx.value?.siteId || flowId.value}_main`
    const outConfigs = JSON.parse(JSON.stringify(configs)) as Record<string, NodeConfig>
    Object.values(outConfigs).forEach((c) => {
      if (!isDataNode(c)) return
      if (!c.taskCfg) c.taskCfg = { queue: '', urlRule: '' }
      if (!c.taskCfg.queue) c.taskCfg.queue = defaultQueue
    })
    const outSource = sourceCfg.value ? (JSON.parse(JSON.stringify(sourceCfg.value)) as Source) : undefined
    if (outSource?.templateId) outSource.nodeBindings = extractTemplateNodeBindings(outConfigs)
    return {
      id: flowId.value,
      name: flowName.value,
      version: 'draft-0.3',
      main: [...main.value],
      branches: JSON.parse(JSON.stringify(branches)) as BranchSeed[],
      configs: outConfigs,
      updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      source: outSource,
      branchGroups: JSON.parse(JSON.stringify(branchGroups)) as FlowBranchGroup[],
    }
  }

  function load(def: FlowDef) {
    flowId.value = def.id
    flowName.value = def.name
    Object.keys(configs).forEach((k) => delete configs[k])
    Object.assign(configs, normalizeNodeConfigs(JSON.parse(JSON.stringify(def.configs)) as Record<string, NodeConfig>))
    branches.splice(0, branches.length, ...(JSON.parse(JSON.stringify(def.branches)) as BranchSeed[]))
    main.value = [...def.main]
    sourceCfg.value = def.source ? (JSON.parse(JSON.stringify(def.source)) as Source) : null
    const firstDataNodeId = main.value.find((nodeId) => !!configs[nodeId] && !isTerm(nodeId))
    if (firstDataNodeId) {
      const firstTask = configs[firstDataNodeId].taskCfg
      if (firstTask) {
        delete firstTask.paramValues
        delete firstTask.contextMap
        delete firstTask.outColumns
        delete firstTask.paramRefs
      }
    }
    const firstNodeId = main.value.find((nodeId) => !!configs[nodeId]?.collectCfg)
    const legacySchedule = sourceCfg.value
    if (firstNodeId && legacySchedule && configs[firstNodeId].collectCfg) {
      const firstCollect = configs[firstNodeId].collectCfg
      const firstTask = configs[firstNodeId].taskCfg as (TaskConfig & { scheduleType?: string; scheduleTime?: string; weekdays?: number[]; cron?: string }) | undefined
      firstCollect.scheduleType = legacySchedule.scheduleType ?? firstTask?.scheduleType ?? firstCollect.scheduleType
      firstCollect.scheduleTime = legacySchedule.scheduleTime ?? firstTask?.scheduleTime ?? firstCollect.scheduleTime
      firstCollect.weekdays = legacySchedule.weekdays ?? firstTask?.weekdays ?? firstCollect.weekdays
      firstCollect.cron = legacySchedule.cron ?? firstTask?.cron ?? firstCollect.cron
      delete legacySchedule.scheduleType
      delete legacySchedule.scheduleTime
      delete legacySchedule.weekdays
      delete legacySchedule.cron
      if (firstTask) {
        delete firstTask.scheduleType
        delete firstTask.scheduleTime
        delete firstTask.weekdays
        delete firstTask.cron
      }
    }
    branchGroups.splice(0, branchGroups.length, ...((JSON.parse(JSON.stringify(def.branchGroups ?? [])) as FlowBranchGroup[])))

    seq = Math.max(1, ...Object.keys(configs).map((k) => Number(/-(\d+)$/.exec(k)?.[1]) || 0)) + 1
    branchSeq = Math.max(1, ...branchGroups.flatMap((g) => g.branches.map((b) => Number(/-(?:b-(?:condition|a|b)|elif|if|else)-(\d+)$/.exec(b.id)?.[1]) || 0))) + 1

    const first = main.value.find((m) => !isTerm(m))
    if (first) select(first)
    else {
      selectedId.value = ''
    }
    activeTab.value = 'config'
    nodeStore.markSaved()
  }

  function newFlow(kind: 'blank' | 'standard' = 'blank') {
    sourceStore.resetAllContext()
    load(kind === 'standard' ? makeStandardFlow() : makeBlankFlow())
  }

  function loadFromSource(source: Source, steps: Step[], persistedDef?: FlowDef | null) {
    const result = sourceStore.loadFromSource(source, steps, persistedDef)
    if (result) {
      sourceCtx.value = result.sourceCtx
      load(result.def)
    }
  }

  function clearSourceCtx() {
    sourceStore.clearSourceCtx()
  }

  function startSiteFlow(site: Site, def?: FlowDef | null) {
    const flowDef = sourceStore.startSiteFlow(site, def)
    sourceCtx.value = null
    load(flowDef)
    activeTab.value = 'config'
  }

  function clearSiteCtx() {
    sourceStore.clearSiteCtx()
  }

  function setSiteDisplayCtx(site: Site | null) {
    sourceStore.setSiteDisplayCtx(site)
  }

  function startDraftSource(source: Source) {
    const flowDef = sourceStore.startDraftSource(source)
    sourceCtx.value = flowDef.source ? (JSON.parse(JSON.stringify(flowDef.source)) as Source) : null
    load(flowDef)
  }

  function applyTemplate(template: FlowTemplate): { retained: number; cleared: number } | null {
    const result = sourceStore.applyTemplate(template, configs)
    if (!result) return null
    const source = sourceCfg.value ?? sourceCtx.value
    if (!source) return null
    const composed = composeTemplateFlow(template, source, source.nodeBindings ?? {})
    applyParamSourceUrlToFirstCollectNode(composed.main, composed.configs, source)
    load(composed)
    sourceCtx.value = JSON.parse(JSON.stringify(source)) as Source
    nodeStore.touch()
    return result
  }

  function setFlowName(name: string) {
    sourceStore.setFlowName(name)
    nodeStore.touch()
  }

  function patchSource(patch: Partial<Source>) {
    sourceStore.patchSource(patch)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    nodeStore.touch()
  }

  function patchSourceCtx(patch: Partial<Source>) {
    sourceStore.patchSourceCtx(patch)
  }

  function resetAllContext() {
    sourceStore.resetAllContext()
  }

  // 发布门禁
  function validateFlow(def?: FlowDef): string[] {
    const d = def ?? serialize()
    const errs: string[] = []
    const mainIds = d.main.filter((idv) => !isTerm(idv))
    const branchIds = d.branches.map((b) => b.id).filter((id) => !isTerm(id))
    const chainIds: string[] = []
    for (const bg of d.branchGroups ?? []) {
      for (const b of bg.branches) {
        for (const nid of b.chain) {
          if (!isTerm(nid) && !chainIds.includes(nid)) chainIds.push(nid)
        }
      }
    }
    if (!mainIds.length) errs.push('流程为空：至少添加一个节点')
    const allIds = [...mainIds, ...branchIds, ...chainIds]
    allIds.forEach((nid) => {
      const c = d.configs[nid]
      if (!c) return
      if (c.collectCfg && !c.disabled) {
        if (!c.collectCfg.url) errs.push(`「${c.title}」缺少源 URL`)
        if (!c.collectCfg.outputTable) errs.push(`「${c.title}」缺少输出表`)
        const cap = collectorCapabilityOf(c)
        if (cap?.kind === 'web' && hasFragmentParams(c.collectCfg.url)) {
          errs.push(`「${c.title}」URL 参数写在 # 片段里，普通网页抓取读不到，请改用浏览器抓取节点`)
        }
        const paramIds = extractUrlParamIds(c.collectCfg.url)
        const refs = c.collectCfg.urlParamRefs ?? []
        const unbound = paramIds.filter((pid) => !refs.includes(pid))
        if (unbound.length) errs.push(`「${c.title}」URL 参数 ${unbound.join('、')} 尚未绑定到参数配置`)
        const unresolved = paramIds.filter((pid) => refs.includes(pid) && !c.collectCfg?.urlParamValues?.[pid])
        if (unresolved.length) errs.push(`「${c.title}」URL 参数 ${unresolved.join('、')} 还没有选定取值`)
      } else if (!c.disabled && isDataNode(c) && !c.outputTable) {
        errs.push(`「${c.title}」缺少输出表`)
      }
      if (
        !c.disabled &&
        isDataNode(c) &&
        !isFirstMainNode(d.main, d.configs, nid) &&
        !effectiveInputTable(d.main, d.branches, d.configs, nid, d.branchGroups ?? [])
      ) {
        errs.push(`「${c.title}」缺少输入表`)
      }
      if (!isFirstMainNode(d.main, d.configs, nid)) {
        const ownTaskParamRefs = new Set(c.collectCfg?.urlParamRefs ?? [])
        const taskTokens = extractUrlParamIds(c.taskCfg?.urlRule ?? '')
        const unavailableTaskParams = taskTokens.filter((pid) => !ownTaskParamRefs.has(pid))
        if (unavailableTaskParams.length) errs.push(`「${c.title}」任务 URL 参数 ${unavailableTaskParams.join('、')} 未绑定到当前节点参数配置`)

        const paramValues = c.taskCfg?.paramValues ?? []
        const invalidTaskValues = paramValues.filter((item) => !ownTaskParamRefs.has(item.paramId)).map((item) => item.paramId)
        if (invalidTaskValues.length) errs.push(`「${c.title}」任务参数 ${invalidTaskValues.join('、')} 未绑定到当前节点`)
        const valueByParam = new Map(paramValues.map((item) => [item.paramId, item]))
        const missingValues = [...ownTaskParamRefs].filter((paramId) => {
          const value = valueByParam.get(paramId)
          return !value || (!value.fieldId && !value.valueExpr)
        })
        if (missingValues.length) errs.push(`「${c.title}」任务参数 ${missingValues.join('、')} 缺少取值字段或值函数`)
      }
    })
    // 决策/分头分支段校验
    for (const bg of d.branchGroups ?? []) {
      const ownerCfg = d.configs[bg.ownerId]
      if (!ownerCfg) continue
      if (ownerCfg.kind === 'decision') {
        if (bg.branches.length < 1) {
          errs.push(`「${ownerCfg.title}」决策至少需要 1 条条件分支`)
        }
        for (let i = 0; i < bg.branches.length; i++) {
          const b = bg.branches[i]
          if (!conditionGroupIsSet(b.condition)) {
            errs.push(`「${ownerCfg.title}」第 ${i + 1} 条分支（${b.label}）缺少条件`)
          }
        }
      } else if (ownerCfg.kind === 'parallel') {
        if (bg.branches.length < 2) {
          errs.push(`「${ownerCfg.title}」分头节点至少需要 2 条分支`)
        }
      }
    }
    return errs
  }

  return {
    // 流程核心状态
    configs,
    main,
    branches,
    branchGroups,
    // 代理状态（保持 API 不变）
    flowId,
    flowName,
    sourceCtx,
    sourceCfg,
    siteCtx,
    selectedId,
    activeTab,
    dirty,
    selectedNode,
    // 布局
    layout,
    horizontalLayout,
    // 选择
    select,
    setActiveTab,
    // 节点有效输入表
    effectiveInputTableFor,
    isFirstMainNodeId,
    // 编辑动作
    insertAfter,
    addNodeToBranch,
    duplicateNode,
    duplicate,
    move,
    moveTo,
    toggleDisabled,
    remove,
    setTitle,
    insertInBranch,
    // 分支操作
    ensureBranchGroup,
    addBranch,
    removeBranch,
    removeBranchGroup,
    detachFromBranches,
    moveBranch,
    moveInBranch,
    setBranchLabel,
    setBranchCondition,
    // 序列化/加载
    serialize,
    load,
    newFlow,
    loadFromSource,
    clearSourceCtx,
    startSiteFlow,
    clearSiteCtx,
    setSiteDisplayCtx,
    startDraftSource,
    applyTemplate,
    setFlowName,
    patchSource,
    patchSourceCtx,
    resetAllContext,
    // 发布门禁
    validateFlow,
    // 代理 node store 的操作
    touch: () => nodeStore.touch(),
    markSaved: () => nodeStore.markSaved(),
    setTripleCell: (id: string, field: TripleField, rowIndex: number, colIndex: 0 | 1 | 2, value: string) => nodeStore.setTripleCell(id, field, rowIndex, colIndex, value),
    addTripleRow: (id: string, field: TripleField) => nodeStore.addTripleRow(id, field),
    removeTripleRow: (id: string, field: TripleField, rowIndex: number) => nodeStore.removeTripleRow(id, field, rowIndex),
    patchCollect: (id: string, patch: Partial<CollectConfig>) => nodeStore.patchCollect(id, patch),
    patchTaskConfig: (id: string, patch: Partial<TaskConfig>) => nodeStore.patchTaskConfig(id, patch),
    patchRuleConfig: (id: string, patch: Partial<RuleOrchestration>) => nodeStore.patchRuleConfig(id, patch),
    setOutputTable: (id: string, tableId: string) => nodeStore.setOutputTable(id, tableId),
    setInputTable: (id: string, tableId: string) => nodeStore.setInputTable(id, tableId),
    setTaskQueue: (id: string, value: string) => nodeStore.setTaskQueue(id, value),
    setEntryCondition: (id: string, cond: ConditionGroup | undefined) => nodeStore.setEntryCondition(id, cond),
    setNodeDisabled: (id: string, disabled: boolean) => nodeStore.setNodeDisabled(id, disabled),
    setBaseRow: (id: string, index: number, value: string) => nodeStore.setBaseRow(id, index, value),
    setFieldRow: (id: string, index: number, value: string) => nodeStore.setFieldRow(id, index, value),
  }
})
