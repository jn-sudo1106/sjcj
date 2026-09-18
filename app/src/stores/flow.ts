// stores/flow.ts - 流程核心状态（P2-1 · stores/flow.ts 拆分）
// 职责：configs/main/branches/branchGroups + 节点 CRUD + 分支操作 + 布局计算 + serialize/load
// 组合 source.ts 和 node.ts 保持 API 不变
import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { applyConfigToNode } from '@/utils/flow/nodeConfigPayload'
import { hasRealBranches } from '@/utils/flow/stepPersist'
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
  isRuleNode,
  isMonitorNode,
  isDataValidationNode,
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
  applyStepDetails as applyStepDetailsToConfigs,
} from '@/views/FlowCanvas/canvas/flowModel'
import { extractUrlParamIds, hasFragmentParams } from '@/utils/flow/urlParams'
import {
  composeTemplateFlow,
  extractTemplateNodeBindings,
} from '@/utils/flow/flowTemplates'
import type { FlowRecord, Source, Site, Step } from '../api'
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
  // 双层脏状态（0824-00 §5.4）：configDirty 归「保存节点配置」，flowDirty 归步骤自动保存
  const configDirty = computed(() => nodeStore.configDirty)
  const flowDirty = computed(() => nodeStore.flowDirty)
  const flowRev = computed(() => nodeStore.flowRev)
  const dirtyConfigNodes = computed(() => nodeStore.dirtyConfigNodes)

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

  // S6-3（方案 §4.4）：删节点待清理资源清单——本期只收集不真删，见 remove() 里的调用点。
  // scriptPath 对应脚本/配置文件（MinIO），configId 对应当前节点绑定的配置。
  interface NodeCleanupResource {
    nodeId: string
    nodeTitle: string
    scriptPath?: string
    configId?: string
  }
  const pendingCleanup = ref<NodeCleanupResource[]>([])
  function collectCleanupResources(id: string, cfg: NodeConfig | undefined): NodeCleanupResource | null {
    if (!cfg) return null
    const scriptPath = cfg.ruleCfg?.scriptPath || cfg.execCfg?.scriptPath || undefined
    const configId = cfg.configId || undefined
    if (!scriptPath && !configId) return null
    return { nodeId: id, nodeTitle: cfg.title, scriptPath, configId }
  }

  // 绑定 flow store 到 node store（供节点编辑函数访问 configs/main）
  nodeStore.bindFlowStore(configs, () => main.value, (id) => effectiveInputTableFor(id))

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

  /** 旧平台「添加后续步骤 → 规则处理」：名称 `{前置配置ID}-{类型名}`，规则 ID 默认 -1，输入表继承上游。
   *  typeName 取模板名（TEMPLATE_TO_NAME）：规则处理→「规则处理」、数据监控→「数据监控」，
   *  不再硬编码「规则处理」——monitor 复用 rule 种子（TEMPLATE_TO_NODE.monitor='rule'）也会走进本函数，
   *  硬编码会把「数据监控」节点名顶成「规则处理」。 */
  function applyRuleStepDefaults(cfg: NodeConfig, prevId: string, upstreamTable: string, typeName = '规则处理') {
    const prevConfigId = configs[prevId]?.configId
    if (prevConfigId) {
      cfg.title = `${prevConfigId}-${typeName}`
      cfg.configName = cfg.title
    }
    if (!cfg.itemId) cfg.itemId = '-1'
    // 适用源（步骤 sourceId）默认 `-1` = 该配置下所有源（2026-09-04 会上提出）。
    // 本函数只在规则处理 / 数据监控节点上调用，这类步骤本来就不该绑死在某一个源上；
    // 之前默认的是**当前源**，等于新建出来就锁死了。
    // 只是默认值——用户在节点上改过就不动（`=== undefined` 的判断），
    // 写入侧也一律以 `cfg.stepSourceId` 为准，不在那边写死（见 stepPersist.mergeStepForWrite）。
    if (cfg.stepSourceId === undefined) cfg.stepSourceId = '-1'
    if (upstreamTable) {
      cfg.inputTable = cfg.inputTable || upstreamTable
      if (cfg.ruleCfg && !cfg.ruleCfg.inputTableId) cfg.ruleCfg.inputTableId = upstreamTable
    }
  }

  // ---- 编辑动作 ----
  function insertAfter(prevId: string, template: string) {
    const srcKey = TEMPLATE_TO_NODE[template] || 'web-list'
    const cfg = cloneConfig(NODE_CONFIGS[srcKey])
    if (template === 'decision') cfg.kind = 'decision'
    if (template === 'parallel') cfg.kind = 'parallel'
    cfg.template = template
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    // 配置名 = 节点名（0828 D08/P4）：新节点直接带上，用户不必为"起名"多点一次。
    // 模板里可能带着上一份配置的身份，连 configId 一起清干净——新节点是新建态。
    delete cfg.configId
    cfg.configName = cfg.title
    if (template === 'rule' || srcKey === 'rule') applyRuleStepDefaults(cfg, prevId, upstreamOutputTable(prevId), typeName)
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
    nodeStore.touchFlow()
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
    cfg.template = template
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    // 配置名 = 节点名（0828 D08/P4）：新节点直接带上，用户不必为"起名"多点一次。
    // 模板里可能带着上一份配置的身份，连 configId 一起清干净——新节点是新建态。
    delete cfg.configId
    cfg.configName = cfg.title
    if (template === 'rule' || srcKey === 'rule') {
      const prevInBranch = branch.chain.at(-1) || ownerId
      applyRuleStepDefaults(cfg, prevInBranch, upstreamOutputTableInBranch(ownerId, branch), typeName)
    }
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
    nodeStore.touchFlow()
    return id
  }

  function duplicateNode(id: string) {
    const src = configs[id]
    if (!src) return
    const cfg = JSON.parse(JSON.stringify(src)) as NodeConfig
    // 副本不得继承原节点的 configId：一个节点只能引用一个配置，两个节点引用同一份配置时，
    // 在副本上改字段再保存就是在改原件（0828 D02「复制节点 = 新增一套配置」）。
    // 这里只保证"绝不指向原配置"；真正复制出一份新配置由调用方的 useDuplicateNode 异步完成。
    // 配置名跟新节点名走，不沿用原配置名（否则「当前配置」条会显示成原件的名字）。
    delete cfg.configId
    cfg.configName = cfg.title
    const newId = `${id.split('-')[0]}-${seq++}`
    configs[newId] = cfg
    const idx = main.value.indexOf(id)
    if (idx >= 0) main.value.splice(idx + 1, 0, newId)
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    select(newId)
    nodeStore.touchFlow()
  }

  /**
   * 复制节点。**返回新节点 id**，调用方据此接着复制配置（见 useDuplicateNode）。
   *
   * 副本**不继承 configId**：`cloneConfig` 是整体深拷贝，原来把 configId 一起带走了，
   * 结果两个节点引用同一份配置——在副本上改一个字段再保存，改的是原件。
   * 配置名改成新节点名（标题已加「（复制）」），不沿用原配置名。
   * 0828 D02 把「复制节点」定为唯一的复用手段，这条路径会被高频触发，必须在 store 这一层就断干净：
   * 即使后续 config/copyAll 失败，副本也只会停在"未绑定配置"，不会污染原配置。
   */
  function duplicate(id: string): string | undefined {
    if (!configs[id]) return undefined
    const cfg = cloneConfig(configs[id])
    cfg.title = cfg.title.replace(/（复制）$/, '') + '（复制）'
    delete cfg.configId
    cfg.configName = cfg.title
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
    nodeStore.touchFlow()
    return newId
  }

  /**
   * 把 config/copyAll 复制出来的新配置绑到副本节点上。
   * 内容不用回写——copyAll 是后端整条复制，服务端那份与副本节点当前内容一致，所以直接清配置脏标。
   */
  function bindCopiedConfig(id: string, configId: string, configName: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.configId = configId
    cfg.configName = configName
    nodeStore.markConfigSaved(id)
    nodeStore.touchFlow()
  }

  function move(id: string, dir: -1 | 1) {
    const i = main.value.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 1 || j > main.value.length - 2) return
    const next = [...main.value]
    ;[next[i], next[j]] = [next[j], next[i]]
    main.value = next
    select(id)
    nodeStore.touchFlow()
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
    nodeStore.touchFlow()
  }

  function toggleDisabled(id: string) {
    const cfg = configs[id]
    if (!cfg) return
    cfg.disabled = !cfg.disabled
    select(id)
    nodeStore.touchFlow()
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
    nodeStore.touchFlow()
    return true
  }

  function removeBranchGroup(ownerId: string) {
    const i = branchGroups.findIndex((bg) => bg.ownerId === ownerId)
    if (i < 0) return
    const g = branchGroups[i]
    const orphans = new Set(g.branches.flatMap((b) => b.chain))
    for (const orphan of orphans) delete configs[orphan]
    branchGroups.splice(i, 1)
    nodeStore.touchFlow()
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
    // S6-3（方案 §4.4）：删节点语义上该连带清理它的业务规则/编排记录 + 脚本文件，但技术指导明确
    // "你暂时别删吧……后面删的时候你到底要删的时候你再删"——后端删除接口还没就绪验证过，本期只收集
    // "如果要清理，该清理什么"这份清单（scriptPath / configId），不真的调任何删除接口。
    const cleanup = collectCleanupResources(id, configs[id])
    if (cleanup) {
      pendingCleanup.value = [...pendingCleanup.value, cleanup]
      // eslint-disable-next-line no-console
      console.info('[TODO S6-3] 节点删除待清理资源（本期不真删，见方案 §4.4，后端接口就绪后再接）：', cleanup)
    }
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
    // 清理运行时态，避免删除正在运行/已完成的节点后 runtime.nodeStates 残留脏数据
    useRuntimeStore().clearNodeStates([id])
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    // 清理运行时态，避免删除正在运行/已完成的节点后 runtime.nodeStates 残留脏数据
    useRuntimeStore().clearNodeStates([id])
    nodeStore.touchFlow()
  }

  /**
   * 改节点名。**配置名跟着走**（0828 D08/P4：配置名 = 节点名）。
   *
   * 「跟不跟」不额外存标记，用**当前配置名是否还等于旧节点名**判断：
   * 相等（或为空）说明用户没单独改过配置名，跟着更新；一旦用户单独改过配置名就自动脱钩，
   * 之后改节点名不再覆盖他填的名字。
   */
  function setTitle(id: string, title: string) {
    const c = configs[id]
    // 允许输入框在编辑过程中暂时为空；保存/发布前由 validateFlow 统一校验，
    // 不能在每次 input 时回填“未命名节点”导致最后一个字无法删除。
    if (c) {
      const followed = !c.configName || c.configName === c.title
      c.title = title
      if (followed) c.configName = title
    }
    nodeStore.touchFlow()
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
    nodeStore.touchFlow()
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
    nodeStore.touchFlow()
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
    nodeStore.touchFlow()
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
    nodeStore.touchFlow()
    return true
  }

  function setBranchLabel(ownerId: string, branchId: string, label: string): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const branch = g.branches.find((b) => b.id === branchId)
    if (!branch) return false
    branch.label = label || branch.label
    nodeStore.touchFlow()
    return true
  }

  function setBranchCondition(ownerId: string, branchId: string, cond: ConditionGroup | undefined): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    const branch = g?.branches.find((b) => b.id === branchId)
    if (!branch) return false
    branch.condition = cond
    nodeStore.touchFlow()
    return true
  }

  // ---- 流程定义 序列化 / 加载 ----
  function serialize(options: { includeLoginPasswords?: boolean } = {}): FlowDef {
    const defaultQueue =
      `${sourceCfg.value?.sourceId || siteCtx.value?.siteId || sourceCtx.value?.siteId || flowId.value}_main`
    const outConfigs = JSON.parse(JSON.stringify(configs)) as Record<string, NodeConfig>
    Object.values(outConfigs).forEach((c) => {
      if (!isDataNode(c)) return
      if (!c.taskCfg) c.taskCfg = { queue: '', urlRule: '' }
      if (!c.taskCfg.queue) c.taskCfg.queue = defaultQueue
    })
    if (!options.includeLoginPasswords) {
      Object.values(outConfigs).forEach((c) => {
        if (!c.collectCfg) return
        Reflect.deleteProperty(c.collectCfg, 'password')
        c.collectCfg.loginConfigs?.forEach((config) => Reflect.deleteProperty(config, 'loginPwd'))
      })
    }
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

  /**
   * 绑定已有配置（0824-00 §5.3）：把配置正文覆盖到节点，流程字段（节点名称/源 URL/进入条件）保持不动。
   * 内容来自后端已保存的配置，所以只置流程脏（节点的 configId 变了），不置配置脏。
   */
  function bindExistingConfig(id: string, config: import('@/api').Config) {
    const cfg = configs[id]
    if (!cfg) return
    applyConfigToNode(cfg, config)
    nodeStore.markConfigSaved(id)
    nodeStore.touchFlow()
  }

  /**
   * configDetail 异步回填（2026-08-28）：画布先用 nextConfigPaged 的裸步骤画出来，
   * 补充字段随后打回。这是**回读**不是用户改动，所以不置任何脏标。
   * 返回被重建的节点（登录语义改变了模板路由），调用方据此决定要不要修选中态。
   */
  function applyStepDetails(steps: Step[]): string[] {
    if (!sourceCfg.value) return []
    sourceStore.rememberSteps(steps, 'merge')
    return applyStepDetailsToConfigs(configs, sourceCfg.value, steps)
  }

  /** 新建步骤落库后，把本地草稿 id 换成后端分配的 itemConfig。 */
  function rebindNodeId(from: string, to: string): boolean {
    if (!from || !to || from === to || !configs[from] || configs[to]) return false
    configs[to] = configs[from]
    delete configs[from]
    const i = main.value.indexOf(from)
    if (i >= 0) main.value[i] = to
    for (const g of branchGroups) {
      if (g.ownerId === from) g.ownerId = to
      for (const b of g.branches) {
        const j = b.chain.indexOf(from)
        if (j >= 0) b.chain[j] = to
      }
    }
    for (const b of branches) {
      if (b.id === from) b.id = to
    }
    if (selectedId.value === from) selectedId.value = to
    sourceStore.renameStepSnapshot(from, to)
    return true
  }

  /** 保存配置：清该节点的 config 脏标，并把流程置脏（配置内容变了，流程需要重新提交） */
  function markNodeConfigSaved(id: string) {
    nodeStore.markConfigSaved(id)
    nodeStore.touchFlow()
  }

  function load(def: FlowDef) {
    flowId.value = def.id
    flowName.value = def.name
    Object.keys(configs).forEach((k) => delete configs[k])
    Object.assign(configs, normalizeNodeConfigs(JSON.parse(JSON.stringify(def.configs)) as Record<string, NodeConfig>))
    branches.splice(0, branches.length, ...(JSON.parse(JSON.stringify(def.branches)) as BranchSeed[]))
    main.value = [...def.main]
    sourceCfg.value = def.source ? (JSON.parse(JSON.stringify(def.source)) as Source) : null
    // 0806：历史流程的 Source/TaskConfig 定时字段仍需迁移，但不再把登录节点当作采集起点。
    const firstNodeId = main.value.find((nodeId) => {
      const cfg = configs[nodeId]
      return !!cfg?.collectCfg && collectorCapabilityOf(cfg)?.kind !== 'login'
    })
    const legacySchedule = sourceCfg.value
    if (firstNodeId && legacySchedule && configs[firstNodeId].collectCfg) {
      const firstCollect = configs[firstNodeId].collectCfg
      const firstTask = configs[firstNodeId].taskCfg as (TaskConfig & { scheduleType?: string; scheduleTime?: string; weekdays?: number[]; cron?: string }) | undefined
      firstCollect.scheduleType = legacySchedule.scheduleType ?? firstTask?.scheduleType ?? firstCollect.scheduleType
      firstCollect.scheduleTime = legacySchedule.scheduleTime ?? firstTask?.scheduleTime ?? firstCollect.scheduleTime
      firstCollect.weekdays = legacySchedule.weekdays ?? firstTask?.weekdays ?? firstCollect.weekdays
      firstCollect.cron = legacySchedule.cron ?? firstTask?.cron ?? firstCollect.cron
      configs[firstNodeId].schedule = {
        scheduleType: firstCollect.scheduleType,
        scheduleTime: firstCollect.scheduleTime,
        weekdays: firstCollect.weekdays,
        cron: firstCollect.cron,
      }
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

  /**
   * 应用一个流程模板到当前源：复制模板的节点，并把**模板里的那套配置复制出一套新的**给本源
   * （0903 H03——「新增配置」的确切含义是复制，不是凭空建空配置，也不是引用模板的配置）。
   *
   * 这是「选流程模板」的**唯一实现**，两个调用方共用：
   *   ① 源画布顶部的「切换流程模板」（`CanvasHeader.vue`）
   *   ② 新建源时选模板（Y8-C，待做）
   *
   * 0903 设计方案初稿一度要求删掉画布头那个入口、连带清理这个方法——**已推翻**，勿删。
   */
  function applyTemplate(template: FlowRecord): { retained: number; cleared: number } | null {
    const result = sourceStore.applyTemplate(template, configs)
    if (!result) {
      console.warn('[flow] applyTemplate skipped: sourceStore.applyTemplate returned null', { template })
      return null
    }
    const source = sourceCfg.value ?? sourceCtx.value
    if (!source) {
      console.warn('[flow] applyTemplate skipped: no source bound', { template })
      return null
    }
    const composed = composeTemplateFlow(template, source, source.nodeBindings ?? {})
    applyParamSourceUrlToFirstCollectNode(composed.main, composed.configs, source)
    load(composed)
    sourceCtx.value = JSON.parse(JSON.stringify(source)) as Source
    nodeStore.touchFlow()
    return result
  }

  /**
   * 这个源的真实步骤里是否有分支（两个及以上步骤的 lastStep 指向同一个前置）。
   *
   * 画布目前把子步骤一律拍成直线（buildSourceSeed 的 branches 恒为 []），所以这个值为 true 时
   * **画布展示的顺序不是真实拓扑**。两个用处：
   *   ① 自动保存据此冻结 lastStep 回写（useStepWrite，0903 YB-A 止血）
   *   ② 画布头据此显示只读提示，让用户知道看到的是拍平后的样子
   * 分支拓扑还原见 YB-B；那之后这个开关应当随之退役。
   */
  const hasBranchedSteps = computed(() => hasRealBranches(sourceStore.stepSnapshots))

  function setFlowName(name: string) {
    sourceStore.setFlowName(name)
    nodeStore.touchFlow()
  }

  function patchSource(patch: Partial<Source>) {
    sourceStore.patchSource(patch)
    // 源 URL 的真值只有一份，在源上；每个采集节点里的 collectCfg.url 是 buildNodeForStep 复制去的
    // 显示副本（0824-11 §1.1b）。改了源就把副本同步过去，否则画布/发抓取/XML 读到的还是旧值。
    // 参数源的首节点 URL 由下面 applyParamSourceUrlToFirstCollectNode 再覆盖一次，顺序不能反。
    if (patch.url !== undefined) {
      Object.values(configs).forEach((cfg) => {
        if (cfg.collectCfg) cfg.collectCfg.url = patch.url ?? ''
      })
    }
    applyParamSourceUrlToFirstCollectNode(main.value, configs, sourceCfg.value)
    nodeStore.touchFlow()
  }

  function patchSourceCtx(patch: Partial<Source>) {
    sourceStore.patchSourceCtx(patch)
  }

  /** 回填源的定时 cron（来自 job 表）。见 sourceStore.applySourceSchedule——**不置脏**。 */
  function applySourceSchedule(cron: string) {
    sourceStore.applySourceSchedule(cron)
  }

  function resetAllContext() {
    sourceStore.resetAllContext()
  }

  /**
   * 判断节点是否存在结构上的上游业务节点。
   * 这不是“首节点业务规则”：它只用于区分“链路断裂”与“流程入口本来就没有输入表”。
   */
  function hasUpstreamNode(def: FlowDef, id: string): boolean {
    const idx = def.main.indexOf(id)
    if (idx >= 0) return def.main.slice(0, idx).some((pid) => !!def.configs[pid] && !isTerm(pid))
    const side = def.branches.find((item) => item.id === id)
    if (side) return !!def.configs[side.rowAnchor]
    for (const group of def.branchGroups ?? []) {
      for (const branch of group.branches) {
        const chainIndex = branch.chain.indexOf(id)
        if (chainIndex < 0) continue
        return chainIndex > 0 || !!def.configs[group.ownerId]
      }
    }
    return false
  }

  // 发布门禁
  function validateFlow(def?: FlowDef): string[] {
    const d = def ?? serialize({ includeLoginPasswords: true })
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
      if (!c.title.trim()) errs.push('节点名称不能为空')
      const capability = collectorCapabilityOf(c)
      if (c.collectCfg && !c.disabled) {
        if (!c.collectCfg.url) errs.push(`「${c.title}」缺少源 URL`)
          if (capability?.kind !== 'login' && !c.collectCfg.outputTable) errs.push(`「${c.title}」缺少输出表`)
          if (capability?.kind === 'login') {
            const configs = c.collectCfg.loginConfigs?.length
              ? c.collectCfg.loginConfigs
              : (c.collectCfg.account || c.collectCfg.loginUrl
                ? [{
                  id: 'legacy-default',
                  loginUrl: c.collectCfg.loginUrl || '',
                  loginName: c.collectCfg.account || '',
                  loginPwd: '',
                  newLoginConfig: '1' as const,
                  authConfig: '',
                  enabled: true,
                }]
                : [])
            const enabledConfigs = configs.filter((config) => config.enabled)
            if (!enabledConfigs.length) errs.push(`「${c.title}」至少需要一个启用的登录配置`)
            const invalidConfig = configs.find((config) => config.newLoginConfig === '0'
              ? !config.authConfig.trim()
              : !config.loginUrl.trim() || !config.loginName.trim() || !config.loginPwd.trim())
            if (invalidConfig) errs.push(`「${c.title}」登录配置的登录 URL、用户名、密码或已有登录模板不能为空`)
            const defaultId = c.collectCfg.defaultLoginConfigId
            if (enabledConfigs.length && !enabledConfigs.some((config) => config.id === defaultId)) {
              errs.push(`「${c.title}」请选择一个启用的默认登录配置`)
            }
          }
        if (capability?.kind === 'web' && hasFragmentParams(c.collectCfg.url)) {
          errs.push(`「${c.title}」URL 参数写在 # 片段里，普通网页抓取读不到，请改用浏览器抓取节点`)
        }
        const paramIds = extractUrlParamIds(c.collectCfg.url)
        const refs = c.collectCfg.urlParamRefs ?? []
        const unbound = paramIds.filter((pid) => !refs.includes(pid))
        if (unbound.length) errs.push(`「${c.title}」URL 参数 ${unbound.join('、')} 尚未绑定到参数配置`)
        const unresolved = paramIds.filter((pid) => refs.includes(pid) && !c.collectCfg?.urlParamValues?.[pid])
        if (unresolved.length) errs.push(`「${c.title}」URL 参数 ${unresolved.join('、')} 还没有选定取值`)
      } else if (!c.disabled && isRuleNode(c)) {
        // 规则处理节点走独立校验（0801 方案 §9.1）：默认输出表=输入表，NodeConfig.outputTable
        // 未显式指定时留空是正常状态，不能套用其他数据节点「缺少输出表」那条通用检查。
        const ruleCfg = c.ruleCfg
        if (!ruleCfg || !c.configId) {
          errs.push(`「${c.title}」请先保存表配置`)
        } else {
          if (!ruleCfg.inputFields?.length) errs.push(`「${c.title}」缺少入参字段`)
          if (!isMonitorNode(c) && !isDataValidationNode(c) && !ruleCfg.outputFields?.length) errs.push(`「${c.title}」缺少出参字段`)
          if (!ruleCfg.script?.trim()) errs.push(`「${c.title}」尚未生成规则脚本`)
        }
      } else if (!c.disabled && isDataNode(c) && !c.outputTable) {
        errs.push(`「${c.title}」缺少输出表`)
      }
      const effectiveInput = effectiveInputTable(d.main, d.branches, d.configs, nid, d.branchGroups ?? [])
      if (
        !c.disabled &&
        isDataNode(c) &&
        capability?.kind !== 'login' &&
        hasUpstreamNode(d, nid) &&
        !effectiveInput
      ) {
        errs.push(`「${c.title}」缺少输入表`)
      }
      if (effectiveInput) {
        const ownTaskParamRefs = new Set(c.collectCfg?.urlParamRefs ?? [])
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
    // S6-3：删节点待清理资源清单（本期只收集不真删，见方案 §4.4）
    pendingCleanup,
    // 代理状态（保持 API 不变）
    flowId,
    flowName,
    sourceCtx,
    sourceCfg,
    siteCtx,
    selectedId,
    activeTab,
    dirty,
    configDirty,
    flowDirty,
    flowRev,
    dirtyConfigNodes,
    bindExistingConfig,
    applyStepDetails,
    rebindNodeId,
    markNodeConfigSaved,
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
    bindCopiedConfig,
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
    hasBranchedSteps,
    applyTemplate,
    setFlowName,
    patchSource,
    patchSourceCtx,
    applySourceSchedule,
    resetAllContext,
    // 发布门禁
    validateFlow,
    // 代理 node store 的操作
    touch: () => nodeStore.touchFlow(),
    markSaved: () => nodeStore.markSaved(),
    markFlowSaved: () => nodeStore.markFlowSaved(),
    setTripleCell: (id: string, field: TripleField, rowIndex: number, colIndex: 0 | 1 | 2, value: string) => nodeStore.setTripleCell(id, field, rowIndex, colIndex, value),
    addTripleRow: (id: string, field: TripleField) => nodeStore.addTripleRow(id, field),
    removeTripleRow: (id: string, field: TripleField, rowIndex: number) => nodeStore.removeTripleRow(id, field, rowIndex),
    patchCollect: (id: string, patch: Partial<CollectConfig>) => nodeStore.patchCollect(id, patch),
    patchTaskConfig: (id: string, patch: Partial<TaskConfig>) => nodeStore.patchTaskConfig(id, patch),
    patchSchedule: (id: string, patch: Partial<import('@/views/FlowCanvas/canvas/flowModel').CollectorSchedule>) => nodeStore.patchSchedule(id, patch),
    patchRuleConfig: (id: string, patch: Partial<RuleOrchestration>) => nodeStore.patchRuleConfig(id, patch),
    patchExecConfig: (id: string, patch: Partial<RuleOrchestration>) => nodeStore.patchExecConfig(id, patch),
    setMonitorMethods: (id: string, methods: string[]) => nodeStore.setMonitorMethods(id, methods),
    setMonitorAlertConfig: (id: string, config: import('@/views/FlowCanvas/canvas/flowModel').MonitorAlertConfig) => nodeStore.setMonitorAlertConfig(id, config),
    setOutputTable: (id: string, tableId: string) => nodeStore.setOutputTable(id, tableId),
    setDedupMode: (id: string, mode: 'source' | 'table') => nodeStore.setDedupMode(id, mode),
    setOutFields: (id: string, fields: string[]) => nodeStore.setOutFields(id, fields),
    setInputTable: (id: string, tableId: string) => nodeStore.setInputTable(id, tableId),
    setInputFields: (id: string, fields: string[]) => nodeStore.setInputFields(id, fields),
    resetInputFields: (id: string) => nodeStore.resetInputFields(id),
    setTaskQueue: (id: string, value: string) => nodeStore.setTaskQueue(id, value),
    setStructuredConfig: (id: string, value: string) => nodeStore.setStructuredConfig(id, value),
    setContentRules: (id: string, value: string) => nodeStore.setContentRules(id, value),
    setConfigName: (id: string, name: string) => nodeStore.setConfigName(id, name),
    setConfigUrl: (id: string, url: string) => nodeStore.setConfigUrl(id, url),
    hydrateConfigUrl: (id: string, url: string) => nodeStore.hydrateConfigUrl(id, url),
    setItemId: (id: string, itemId: string) => nodeStore.setItemId(id, itemId),
    setStepSourceId: (id: string, sourceId: string) => nodeStore.setStepSourceId(id, sourceId),
    setEntryCondition: (id: string, cond: ConditionGroup | undefined) => nodeStore.setEntryCondition(id, cond),
    setNodeDisabled: (id: string, disabled: boolean) => nodeStore.setNodeDisabled(id, disabled),
    setBaseRow: (id: string, index: number, value: string) => nodeStore.setBaseRow(id, index, value),
    setFieldRow: (id: string, index: number, value: string) => nodeStore.setFieldRow(id, index, value),
  }
})
