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
  makeSiteBlankTemplate,
  makeStandardFlow,
  buildHorizontalLayout,
  buildSourceSeed,
  emptyTripleRow,
  makeDefaultRuleOrchestration,
  normalizeNodeConfigs,
  setTripleValue,
  TERMINALS,
  type NodeConfig,
  type CollectConfig,
  type OutputAdvanced,
  type ConditionGroup,
  type TaskConfig,
  type TripleField,
  type BranchSeed,
  type FlowBranch,
  type FlowBranchGroup,
  type FlowDef,
} from '../views/FlowCanvas/flowModel'
import type { RuleOrchestration, Source, Site, Step } from '../api'

export { TERMINALS }

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
  // ---- 状态 ----
  const configs = reactive<Record<string, NodeConfig>>({})
  // 默认空白画布（M5.5）：首次进入为干净的 开始 → 完成；标准链路 / 预置意图经「＋ 新建流程」载入
  const main = ref<string[]>(['start', 'end'])
  const branches = reactive<BranchSeed[]>([])
  // 决策/分头节点的分支段（0707 优化·Phase6）：与 BranchSeed 旁路挂靠并存，不互相替代。
  const branchGroups = reactive<FlowBranchGroup[]>([])
  // 分支 id 自增序列（0707 Phase6）：保证同一 FlowDef 内 FlowBranch.id 不重复
  let branchSeq = 1

  const flowId = ref('flow-default')
  const flowName = ref('未命名流程')
  const sourceCtx = ref<Source | null>(null)
  // 源级配置（0706 优化·源/节点配置分层）：sourceCtx 保留作只读上下文（是否绑定持久化源，驱动 UI 的「源模式」），
  // sourceCfg 是可编辑副本，供源信息编辑抽屉读写；load() 统一从 FlowDef.source 灌入，二者内容随加载同步、写入路径各自独立。
  const sourceCfg = ref<Source | null>(null)
  // 网站态上下文（0707 优化·Phase4）：与 sourceCtx 互斥——画布当前编排对象要么是某个子源（sourceCtx），
  // 要么是某个网站的统一流程模板（siteCtx），二者不会同时非空。网站模板不实际运行，没有 sourceCfg 概念。
  const siteCtx = ref<Site | null>(null)
  const selectedId = ref<string>('')
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
            chain: b.chain, // 0707 Phase6：fanOutEdges 渲染时需要 br.chain 引用原始 chain 节点序列
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
      // 0707 优化·Phase6·补（6.4 fan-in）：owner(决策/分头)->汇合点 不画主链直线--它会笔直穿过下方
      // fan-out 列区域与分支列重叠（奇数列时中间列恰落在 CENTER）；该对的插入点改放到汇合点正上方
      // bTop-GAP/2（与普通 gap 的 slot 几何一致、落在 fan-in 收拢处）。fan-in 收拢线见下方 fanOutEdges。
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
      }
      // 0707 优化·Phase6·补（6.4 fan-in 收拢）：各列末节点底部 -> 汇合点（owner 的下一个主链节点）顶部，
      // 与 owner->列首 的 fan-out 曲线对称。此前漏建：分支链视觉上悬空、owner->汇合 的主链直线穿过 fan-out 区域。
      // 空 chain 分支暂不补收拢--直达斜线已表达"直达汇合"语义，留作后续细化（小残差，不阻断）。
      const mergeId = main.value[main.value.indexOf(id) + 1]
      const mergePos = mergeId ? mainPos[mergeId] : undefined
      if (mergePos) {
        const mergeCx = CENTER
        const mergeTop = mergePos.top
        for (const br of meta.branches) {
          if (!br.chain.length) continue
          const lastId = br.chain[br.chain.length - 1]
          const lastPos = fanOutPos[lastId]
          if (!lastPos) continue
          const lastCx = lastPos.left + NODE_W / 2
          const lastBottom = lastPos.top + lastPos.height
          fanOutEdges.push({
            d: `M${lastCx} ${lastBottom} C${lastCx} ${(lastBottom + mergeTop) / 2} ${mergeCx} ${(lastBottom + mergeTop) / 2} ${mergeCx} ${mergeTop}`,
          })
        }
      }
    }

    return { nodes, terminals, slots, mainEdges, branchEdges, fanOutEdges, fanOutColMeta, totalHeight }
  })

  // ---- 横向布局：供结果视图顶部节点条使用（纯函数版见 flowModel.buildHorizontalLayout，分屏对比 Phase 5 复用同一算法；
//   0707 优化·Phase6 扩展：同步支持决策/分头节点的 chain 节点平铺在 owner 下方一行） ----
  const horizontalLayout = computed(() => buildHorizontalLayout(main.value, branches, configs, branchGroups))

  // ---- 选择 ----
  function select(id: string) {
    selectedId.value = id
    // 顶层 Tab 不再按节点类型派生步骤/子页（0706 调整4：去步进器，四 Tab 统一为 config/task/table/ai）
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
    // 新插入节点：名称取节点类型名，不继承种子模板的具体标题
    const typeName = TEMPLATE_TO_NAME[template]
    if (typeName) cfg.title = typeName
    // 采集类节点：抓取类型 = 节点类型；其余具体配置清空待填（源级字段不在节点上，见 sourceCfg）
    if (cfg.collectCfg) {
      cfg.collectCfg.snatchType = TEMPLATE_TO_SNATCH[template] ?? cfg.collectCfg.snatchType
      cfg.collectCfg.url = ''
      cfg.collectCfg.outputTable = ''
      cfg.collectCfg.inputParams = []
    }
    // 非采集数据类节点：默认继承上游节点的输出表（0701 问题二，Q1/Q2 口径：处理类步骤与上游同表）
    if (!cfg.collectCfg && isDataNode(cfg) && !cfg.outputTable) {
      cfg.outputTable = upstreamOutputTable(prevId)
    }
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    const idx = main.value.indexOf(prevId)
    // 0707 优化·Phase6 修复：保持主链 'start' 必须在最前 / 'end' 必须在最后的约束
    // - prevId === 'end'：插在 'end' 之前（idx），不在之后（避免跑出主链尾）
    // - prevId === 'start'：插在 'start' 之后（idx + 1）
    // - 其他节点：插在 prevId 之后（idx + 1）
    // - 找不到 prevId：默认插在 'end' 之前
    const at = prevId === 'end' ? idx : (idx < 0 ? main.value.length - 1 : idx + 1)
    main.value.splice(at, 0, id)
    // 0707 优化·Phase6：决策/分头节点插入主链时，自动创建默认 FlowBranchGroup（决策 IF+ELSE、分头 2 分支）
    if (template === 'decision') ensureBranchGroup(id, 'decision')
    else if (template === 'parallel') ensureBranchGroup(id, 'parallel')
    select(id)
    touch()
    return id
  }
  // 分支 chain 内从后往前找最近一个有输出表的节点，均无则回退 owner 节点（chain 的隐式上游）
  function upstreamOutputTableInBranch(ownerId: string, branch: FlowBranch): string {
    for (let i = branch.chain.length - 1; i >= 0; i--) {
      const c = configs[branch.chain[i]]
      if (c) {
        const t = nodeOutputTable(c)
        if (t) return t
      }
    }
    // owner 是决策/分头逻辑节点，本身不产表；取"流入" owner 的上游数据（= owner 的有效输入表）
    return effectiveInputTableFor(ownerId)
  }
  /** 把新节点插入决策/分头分支的 chain 末尾（0707 优化·Phase6·补：FlowBoard fan-out 列「+」入口）：
   *  与 insertAfter 共用节点创建口径，但不动 main，改用 insertInBranch 挂进 chain；
   *  逻辑类模板（决策/分头）不允许嵌套进 chain，AddNodePopover 已在分支场景隐藏「逻辑」分组，这里再兜底拒绝一次。 */
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
      cfg.collectCfg.outputTable = ''
      cfg.collectCfg.inputParams = []
    }
    if (!cfg.collectCfg && isDataNode(cfg) && !cfg.outputTable) {
      cfg.outputTable = upstreamOutputTableInBranch(ownerId, branch)
    }
    const id = `${srcKey}-${seq++}`
    configs[id] = cfg
    if (!insertInBranch(ownerId, branchId, id)) {
      delete configs[id]
      return null
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
    } else {
      const bi = branches.findIndex((b) => b.id === id)
      if (bi >= 0) branches.splice(bi, 1)
    }
    // 0707 优化·Phase6：无论节点在 main/BranchSeed/chain 还是三处都有，都从 branchGroups.chain 摘除（idempotent）
    detachFromBranches(id)
    // 若 id 是决策/分头节点的 owner，连带删整组 FlowBranchGroup（chain 内节点一并从 configs 清理）
    if (branchGroups.some((bg) => bg.ownerId === id)) {
      removeBranchGroup(id)
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
  // 非采集节点输入表（0701 问题五）：空字符串 = 清空覆盖，回到自动继承上游输出表
  function setInputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.inputTable = tableId
    touch()
  }
  function setEntryCondition(id: string, cond: ConditionGroup | undefined) {
    const c = configs[id]
    if (!c) return
    const target = c.collectCfg ?? c
    if (cond) target.entryCondition = cond
    else delete target.entryCondition
    touch()
  }
  // 节点任务队列（0706 调整4：队列归属统一收在 taskCfg，采集/非采集节点共用同一份任务配置）
  function setTaskQueue(id: string, value: string) {
    patchTaskConfig(id, { queue: value })
  }
  // 任务级配置整体读写（队列/URL规则/拼接逻辑/触发条件，0706 调整4「任务配置」独立 Tab）
  function patchTaskConfig(id: string, patch: Partial<TaskConfig>) {
    const c = configs[id]
    if (!c) return
    c.taskCfg = { queue: '', urlRule: '', joinLogic: '', ...c.taskCfg, ...patch }
    touch()
  }

  // ---- 决策/分头分支段操作（0707 优化·Phase6）----
  /** 给指定 ownerId 创建默认 FlowBranchGroup（决策 IF+ELSE、分头 2 分支）；
   *  已有则返回已有组，不覆盖；用于 insertAfter 自动创建 + 手工初始化 */
  function ensureBranchGroup(ownerId: string, kind: 'decision' | 'parallel'): FlowBranchGroup | null {
    const existing = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (existing) return existing
    if (kind === 'decision') {
      const g: FlowBranchGroup = {
        ownerId,
        branches: [
          { id: `${ownerId}-b-if-${branchSeq++}`, label: 'IF', condition: undefined, chain: [] },
          { id: `${ownerId}-b-else-${branchSeq++}`, label: 'ELSE', condition: undefined, chain: [] },
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
  /** 追加一条 ELIF 分支（决策场景，分头拒绝）；插入到 ELSE 之前 */
  function addBranch(ownerId: string): FlowBranch | null {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return null
    const cfg = configs[ownerId]
    if (!cfg || cfg.kind !== 'decision') return null
    // 非 ELSE 分支数 = g.branches.length - 1，新 ELIF 命名按"非 ELSE 序号"
    const elifIndex = g.branches.length - 1
    const elif: FlowBranch = {
      id: `${ownerId}-b-elif-${branchSeq++}`,
      label: `ELIF-${elifIndex}`,
      condition: undefined,
      chain: [],
    }
    g.branches.splice(elifIndex, 0, elif)
    touch()
    return elif
  }
  /** 删除一条分支：ELSE 不可删；chain 非空拒绝（用户需先清理子链）；删到 1 条拒绝。
   *  返回 {ok, reason}，UI 据此给 inline 提示。 */
  function removeBranch(ownerId: string, branchId: string): { ok: boolean; reason?: string } {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return { ok: false, reason: '未找到 FlowBranchGroup' }
    const idx = g.branches.findIndex((b) => b.id === branchId)
    if (idx < 0) return { ok: false, reason: '未找到分支' }
    const branch = g.branches[idx]
    if (branch.chain.length > 0) {
      return { ok: false, reason: `分支内还有 ${branch.chain.length} 个节点，请先移除` }
    }
    const cfg = configs[ownerId]
    const isDecisionNode = !!cfg && cfg.kind === 'decision'
    if (isDecisionNode && idx === g.branches.length - 1) {
      return { ok: false, reason: 'ELSE 不可删除' }
    }
    if (g.branches.length <= 2) {
      return { ok: false, reason: '至少保留 2 条分支' }
    }
    g.branches.splice(idx, 1)
    touch()
    return { ok: true }
  }
  /** 把 configs 里已存在的节点挂到指定分支 chain；默认追加到末尾，可指定 index 插入。
   *  重复挂载同一节点会被拒绝（避免数据不一致）。 */
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
    touch()
    return true
  }
  /** 分支内节点上下移（边界外不操作） */
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
    touch()
    return true
  }
  /** 分支顺序上下移（不改变分支内 chain 节点顺序） */
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
    touch()
    return true
  }
  /** owner 节点被删除时，删除整组 FlowBranchGroup；chain 内节点也一并从 configs 清理（0707 Phase6 边界）。
   *  注：chain 内节点不在 main/branches/其他 chain 中引用（BranchEditor 挂节点时会同步），故清理 configs 即可。 */
  function removeBranchGroup(ownerId: string) {
    const i = branchGroups.findIndex((bg) => bg.ownerId === ownerId)
    if (i < 0) return
    const g = branchGroups[i]
    const orphans = new Set(g.branches.flatMap((b) => b.chain))
    for (const orphan of orphans) delete configs[orphan]
    branchGroups.splice(i, 1)
  }
  /** 删节点时，从所有 FlowBranchGroup 的 chain 里摘除（0707 Phase6 易漏边界） */
  function detachFromBranches(nodeId: string) {
    for (const g of branchGroups) {
      for (const b of g.branches) {
        const i = b.chain.indexOf(nodeId)
        if (i >= 0) b.chain.splice(i, 1)
      }
    }
  }
  /** 给指定分支重命名 */
  function setBranchLabel(ownerId: string, branchId: string, label: string) {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const branch = g.branches.find((b) => b.id === branchId)
    if (!branch) return false
    branch.label = label || branch.label
    touch()
    return true
  }
  /** 给指定分支设置条件（IF/ELIF）；ELSE 拒绝（应保持 condition = undefined） */
  function setBranchCondition(ownerId: string, branchId: string, cond: ConditionGroup | undefined): boolean {
    const g = branchGroups.find((bg) => bg.ownerId === ownerId)
    if (!g) return false
    const branch = g.branches.find((b) => b.id === branchId)
    if (!branch) return false
    if (branch.condition === undefined && idxOfElse(g) === g.branches.indexOf(branch)) {
      // ELSE 不可设条件（语义：按序匹配兜底）
      return false
    }
    branch.condition = cond
    touch()
    return true
  }
  function idxOfElse(g: FlowBranchGroup): number {
    // ELSE = 决策场景最后一条（condition 始终为 undefined 且不在前面 IF/ELIF 中）；
    // 用"最后一条 + condition === undefined"识别，避免依赖 label 文案
    if (g.branches.length === 0) return -1
    const last = g.branches.length - 1
    return g.branches[last].condition === undefined ? last : -1
  }

  // 源级配置整体读写（0706 优化·源/节点配置分层）：首次编辑时懒创建草稿，供新建/空白流程也能编辑源信息
  function patchSource(patch: Partial<Source>) {
    if (!sourceCfg.value) {
      sourceCfg.value = { sourceId: '', name: '', url: '', configId: '', mainTable: '', owner: '', state: 'C' }
    }
    Object.assign(sourceCfg.value, patch)
    touch()
  }
  // 产物高级配置（原「落表输出」节点能力，全节点通用；0701 问题四）
  function patchOutputAdvanced(id: string, patch: Partial<OutputAdvanced>) {
    const c = configs[id]
    if (!c) return
    c.outputAdvanced = { writeMode: 'upsert', dedupeKey: '', failPolicy: '阻断并记录', ...c.outputAdvanced, ...patch }
    touch()
  }

  function patchRuleConfig(id: string, patch: Partial<RuleOrchestration>) {
    const c = configs[id]
    if (!c) return
    c.ruleCfg = { ...makeDefaultRuleOrchestration(), ...c.ruleCfg, ...patch }
    touch()
  }

  // ---- inmap / params / output 三列表格行级编辑（0707 Phase 7A：对象结构，保留旧 API 名称）----
  function setTripleCell(id: string, field: TripleField, rowIndex: number, colIndex: 0 | 1 | 2, value: string) {
    const c = configs[id]
    const row = c?.[field]?.[rowIndex]
    if (row) setTripleValue(field, row, colIndex, value)
    touch()
  }
  function addTripleRow(id: string, field: TripleField) {
    const c = configs[id]
    if (!c) return
    if (field === 'inmap') c.inmap.push(emptyTripleRow(field) as never)
    else c[field].push(emptyTripleRow(field) as never)
    touch()
  }
  function removeTripleRow(id: string, field: TripleField, rowIndex: number) {
    const c = configs[id]
    if (c) c[field].splice(rowIndex, 1)
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
      updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      source: sourceCfg.value ? (JSON.parse(JSON.stringify(sourceCfg.value)) as Source) : undefined,
      // 0707 优化·Phase6：分支段（决策/分头）写入 FlowDef；空数组也写出，便于读取侧判空。
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
    // 0707 优化·Phase6：分支段加载；旧 FlowDef 不带 branchGroups 视为空数组。
    branchGroups.splice(0, branchGroups.length, ...((JSON.parse(JSON.stringify(def.branchGroups ?? [])) as FlowBranchGroup[])))
    const first = main.value.find((m) => !isTerm(m))
    if (first) select(first)
    else {
      selectedId.value = ''
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

  // 源 → 画布：把源的子步骤编译为画布节点（首步当列表，其余当详情）。
  // 种子构造用纯函数 buildSourceSeed（flowModel.ts），分屏对比 Phase 5 的第二栏独立复用同一构造逻辑，不经过本 store。
  // persistedDef（0707 优化·Phase4）：调用方若已查到该源自己保存过的 FlowDef（含网站同步覆盖写入的），
  // 优先加载它而不是重新按 Step 拼一份通用模板——否则子源单独改过的流程 / 网站同步覆盖的结果重进画布都会被冲掉。
  function loadFromSource(source: Source, steps: Step[], persistedDef?: FlowDef | null) {
    // 存克隆而非引用（0706 Phase4 修复）：mock 按引用返回内部数据，若 sourceCtx 与之共享对象，
    // mock 侧的原始变更会绕过响应式代理静默改值，导致后续同值代理赋值不触发更新、摘要头保存后不刷新
    siteCtx.value = null
    sourceCtx.value = JSON.parse(JSON.stringify(source)) as Source
    // needLogin 未显式设置时按是否已绑登录凭据回填（与旧行为对齐：有凭据引用即视为登录态源）
    const sourceForCfg: Source = { ...source, needLogin: source.needLogin ?? Boolean(source.credentialRef) }
    if (persistedDef) {
      load({ ...persistedDef, id: source.sourceId, source: sourceForCfg })
      return
    }
    const seed = buildSourceSeed(source, steps)
    load({
      id: source.sourceId,
      name: source.name,
      version: `source-v${source.version ?? 1}`,
      main: seed.main,
      branches: seed.branches,
      configs: seed.configs,
      updatedAt: source.updatedAt || '',
      source: sourceForCfg,
    })
  }
  function clearSourceCtx() {
    sourceCtx.value = null
    sourceCfg.value = null
  }

  // 网站态：加载/新建网站统一流程模板（0707 优化·Phase4）。def 为空 = 该网站还没保存过模板，起一个空白流程。
  // 模板落库沿用既有 flow/save·load 契约，id = `site:${siteId}`（画布保存按钮天然写对地方，不必新增专属持久化）。
  function startSiteFlow(site: Site, def?: FlowDef | null) {
    sourceCtx.value = null
    sourceCfg.value = null
    siteCtx.value = JSON.parse(JSON.stringify(site)) as Site
    load(def ?? makeSiteBlankTemplate(site))
  }
  function clearSiteCtx() {
    siteCtx.value = null
  }

  // 空白模板 → 有源草稿画布（0707 Phase3.1）：过闸创建后用户先进入编排工作区，
  // 再手工用「+」添加步骤，或用空白画布引导卡「智能生成流程」；不自动塞首节点，sourceCtx/sourceCfg 只提供源上下文和摘要头编辑入口。
  function startDraftSource(source: Source) {
    const draft = JSON.parse(JSON.stringify(source)) as Source
    siteCtx.value = null
    sourceCtx.value = draft
    load({
      id: source.sourceId,
      name: source.name || '未命名采集源',
      version: 'draft-0.1',
      main: ['start', 'end'],
      branches: [],
      configs: {},
      updatedAt: source.updatedAt || '',
      source: draft,
    })
    sourceCtx.value = draft
  }

  // 发布门禁：空链路 / 采集节点缺 URL·输出表 / 数据类节点缺输出表 不可发布。
  // 数据类口径（0701 问题二/四）：逻辑控制（决策/分头）与通知类（邮件/告警）、指标引用不产数据行，不要求输出表。
  // 输入表口径（0701 问题五）：从第 2 个数据节点起，输入表为空且无上游可继承（含自动继承）则拦截；首节点无需输入表。
  // 主链 + 旁路节点走同一套校验（0701 问题三 B 旁路节点也参与门禁）。
  // 0707 优化·Phase6 扩展：chain 节点也走同一套（数据类/输入表/输出表）校验；
  // 决策/分头分支段校验：决策至少 1 条非 ELSE 分支（IF 或 ELIF），IF/ELIF 必须有 condition。
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
      if (c.collectCfg) {
        if (!c.collectCfg.url) errs.push(`「${c.title}」缺少源 URL`)
        if (!c.collectCfg.outputTable) errs.push(`「${c.title}」缺少输出表`)
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
    })
    // 0707 优化·Phase6：决策/分头分支段校验
    for (const bg of d.branchGroups ?? []) {
      const ownerCfg = d.configs[bg.ownerId]
      if (!ownerCfg) continue
      if (ownerCfg.kind === 'decision') {
        // ELSE = 决策场景最后一条（condition 始终 undefined）；非 ELSE 数 = branches.length - 1
        const nonElseCount = bg.branches.length - 1
        if (nonElseCount < 1) {
          errs.push(`「${ownerCfg.title}」决策至少需要 1 条非 ELSE 分支（IF/ELIF）`)
        }
        // IF/ELIF（非最后一条）必须有 condition
        for (let i = 0; i < bg.branches.length - 1; i++) {
          const b = bg.branches[i]
          if (!conditionGroupIsSet(b.condition)) {
            errs.push(`「${ownerCfg.title}」第 ${i + 1} 条分支（${b.label}）缺少条件`)
          }
        }
      } else if (ownerCfg.kind === 'parallel') {
        // 分头节点：condition 忽略；只校验分支数 ≥2
        if (bg.branches.length < 2) {
          errs.push(`「${ownerCfg.title}」分头节点至少需要 2 条分支`)
        }
      }
    }
    return errs
  }

  return {
    configs, main, branches, branchGroups,
    flowId, flowName, sourceCtx, sourceCfg, siteCtx, dirty,
    selectedId, activeTab,
    layout, horizontalLayout, selectedNode,
    isTerm,
    effectiveInputTableFor, isFirstMainNodeId,
    select, setActiveTab,
    insertAfter, addNodeToBranch, duplicate, move, moveTo, toggleDisabled, remove, setTitle,
    patchCollect, setBaseRow, setFieldRow, setOutputTable, setInputTable, setEntryCondition, setTaskQueue, patchTaskConfig, patchOutputAdvanced, patchSource,
    patchRuleConfig,
    setTripleCell, addTripleRow, removeTripleRow,
    // 0707 优化·Phase6：决策/分头分支段操作
    ensureBranchGroup, addBranch, removeBranch, insertInBranch, moveInBranch, moveBranch, removeBranchGroup, detachFromBranches, setBranchLabel, setBranchCondition,
    serialize, load, setFlowName, newFlow, loadFromSource, startDraftSource, clearSourceCtx, startSiteFlow, clearSiteCtx, validateFlow, markSaved,
  }
})
