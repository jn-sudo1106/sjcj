import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  NODE_CONFIGS,
  TEMPLATE_TO_NODE,
  TEMPLATE_TO_NAME,
  TEMPLATE_TO_SNATCH,
  cloneConfig,
  isDecision,
  isParallel,
  isDataNode,
  nodeOutputTable,
  effectiveInputTable,
  isFirstMainNode,
  makeBlankFlow,
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
export interface MainEdge { fromId: string; toId: string; d: string; rule: boolean; lx: number; ly: number }
export interface BranchEdge { d: string }

export const useFlowStore = defineStore('flow', () => {
  // ---- 状态 ----
  const configs = reactive<Record<string, NodeConfig>>({})
  // 默认空白画布（M5.5）：首次进入为干净的 开始 → 完成；标准链路 / 预置意图经「＋ 新建流程」载入
  const main = ref<string[]>(['start', 'end'])
  const branches = reactive<BranchSeed[]>([])

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
        d:
          b.side === 'right'
            ? `M430 ${mainMid} C515 ${mainMid} 515 ${branchMid} 430 ${branchMid}`
            : `M210 ${mainMid} C125 ${mainMid} 125 ${branchMid} 210 ${branchMid}`,
      })
    })

    return { nodes, terminals, slots, mainEdges, branchEdges, totalHeight }
  })

  // ---- 横向布局：供结果视图顶部节点条使用（纯函数版见 flowModel.buildHorizontalLayout，分屏对比 Phase 5 复用同一算法） ----
  const horizontalLayout = computed(() => buildHorizontalLayout(main.value, branches, configs))

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
    return effectiveInputTable(main.value, branches, configs, id)
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
    const at = idx < 0 ? main.value.length - 1 : idx + 1
    main.value.splice(at, 0, id)
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
  // 非采集节点输入表（0701 问题五）：空字符串 = 清空覆盖，回到自动继承上游输出表
  function setInputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.inputTable = tableId
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
  // 节点进入条件（0701 问题十·方案B；0706 升级为多字段条件组）：undefined = 不限制
  function setEntryCondition(id: string, cond: ConditionGroup | undefined) {
    const c = configs[id]
    if (c) c.entryCondition = cond
    touch()
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
    load(
      def ?? {
        id: `site:${site.siteId}`,
        name: site.name,
        version: 'site-v1',
        main: ['start', 'end'],
        branches: [],
        configs: {},
        updatedAt: '',
      },
    )
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
  function validateFlow(def?: FlowDef): string[] {
    const d = def ?? serialize()
    const errs: string[] = []
    const mainIds = d.main.filter((idv) => !isTerm(idv))
    const branchIds = d.branches.map((b) => b.id).filter((id) => !isTerm(id))
    if (!mainIds.length) errs.push('流程为空：至少添加一个节点')
    const allIds = [...mainIds, ...branchIds]
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
        !effectiveInputTable(d.main, d.branches, d.configs, nid)
      ) {
        errs.push(`「${c.title}」缺少输入表`)
      }
    })
    return errs
  }

  return {
    configs, main, branches,
    flowId, flowName, sourceCtx, sourceCfg, siteCtx, dirty,
    selectedId, activeTab,
    layout, horizontalLayout, selectedNode,
    isTerm,
    effectiveInputTableFor, isFirstMainNodeId,
    select, setActiveTab,
    insertAfter, duplicate, move, moveTo, toggleDisabled, remove, setTitle,
    patchCollect, setBaseRow, setFieldRow, setOutputTable, setInputTable, setTaskQueue, patchTaskConfig, setEntryCondition, patchOutputAdvanced, patchSource,
    patchRuleConfig,
    setTripleCell, addTripleRow, removeTripleRow,
    serialize, load, setFlowName, newFlow, loadFromSource, startDraftSource, clearSourceCtx, startSiteFlow, clearSiteCtx, validateFlow, markSaved,
  }
})
