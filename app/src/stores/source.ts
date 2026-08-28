// stores/source.ts - 源配置 + 上下文（P2-1 · stores/flow.ts 拆分）
// 职责：sourceCfg/sourceCtx/siteCtx 源级状态 + patchSource/loadFromSource 等源操作
// 0824 M1-5：本 store 只保留源/网站上下文，不持久化节点链副本。
// 节点配置草稿与流程结构由 flow store 持有；源 Store 只保存源及步骤快照。
// configMode/configName/configTopic/configStrategy 只用于历史回读，新流程不得新写。
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { Source, Site, Step } from '../api'
import type { FlowDef } from '@/views/FlowCanvas/canvas/flowModel'
import {
  makeSiteBlankTemplate,
  buildSourceSeed,
  type NodeConfig,
} from '@/views/FlowCanvas/canvas/flowModel'
import {
  extractTemplateNodeBindings,
  compatibleTemplateBindings,
} from '@/utils/flow/flowTemplates'
import type { FlowTemplate } from '../api'

export const useSourceStore = defineStore('source', () => {
  // ---- 源级状态 ----
  const flowId = ref('flow-default')
  const flowName = ref('未命名流程')
  const sourceCtx = ref<Source | null>(null)
  // 源级配置（0706 优化·源/节点配置分层）：sourceCtx 保留作只读上下文（是否绑定持久化源，驱动 UI 的「源模式」），
  // sourceCfg 是可编辑副本，供源信息编辑抽屉读写；load() 统一从 FlowDef.source 灌入，二者内容随加载同步、写入路径各自独立。
  const sourceCfg = ref<Source | null>(null)
  // 网站态上下文（0707 优化·Phase4）：与 sourceCtx 互斥——画布当前编排对象要么是某个源（sourceCtx），
  // 要么是某个网站的统一流程模板（siteCtx），二者不会同时非空。网站模板不实际运行，没有 sourceCfg 概念。
  // 唯一例外见 setSiteDisplayCtx（0714 会议 Task 3 网站详情页）：该场景 siteCtx 只作展示标记，
  // sourceCtx 仍指向内部代表源供数据查询，二者会同时非空。
  const siteCtx = ref<Site | null>(null)

  const NODE_COPY_KEYS = ['configs', 'definition', 'main', 'branches', 'branchGroups'] as const

  function withoutNodeCopies<T extends Record<string, unknown>>(patch: T): T {
    const next = { ...patch }
    for (const key of NODE_COPY_KEYS) delete next[key]
    return next
  }

  // ---- 源级操作 ----
  function patchSource(patch: Partial<Source>) {
    const clean = withoutNodeCopies(patch as Record<string, unknown>) as Partial<Source>
    if (!sourceCfg.value) {
      sourceCfg.value = { sourceId: '', name: '', url: '', configId: '', mainTable: '', owner: '', state: 'C' }
    }
    Object.assign(sourceCfg.value, clean)
  }

  // 源级上下文唯一写入口（0712 review m15）：源信息头（sourceCtx）与流程序列化层（sourceCfg）
  // 都吃同一份 patch，避免组件直接 Object.assign(flow.sourceCtx, ...) 绕过 action 层。
  // 序列化时只走 sourceCfg，所以 sourceCtx 的"只读上下文"语义在这里被打破为"双写但下游只读 sourceCfg"——
  // 这是 0706 优化·源/节点配置分层 的设计：写路径集中，serialize 走 sourceCfg 副本即可。
  function patchSourceCtx(patch: Partial<Source>) {
    if (!sourceCtx.value) return
    sourceCtx.value = { ...sourceCtx.value, ...withoutNodeCopies(patch as Record<string, unknown>) as Partial<Source> }
  }

  function resetAllContext() {
    sourceCtx.value = null
    sourceCfg.value = null
    siteCtx.value = null
  }

  function clearSourceCtx() {
    sourceCtx.value = null
    sourceCfg.value = null
  }

  function clearSiteCtx() {
    siteCtx.value = null
  }

  // 网站详情页（0714 会议 Task 3）：只做聚合查看，不是网站统一流程模板——画布内部会悄悄加载一个代表源
  // 到 sourceCtx（供 ResultView/FileView/TaskView 取得共享的节点/表结构），但用户看到的对象是"网站"。
  // 这里只设置 siteCtx 供顶部面包屑/动作栏识别为网站态展示，不像 startSiteFlow 那样重置画布或加载模板流程，
  // 因此与 sourceCtx 同时非空——是本文件顶部"二者互斥"注释里唯一的例外，仅用于该页面的展示层。
  function setSiteDisplayCtx(site: Site | null) {
    siteCtx.value = site
  }

  // 源 → 画布：把源的子步骤编译为画布节点（首步当列表，其余当详情）。
  // 种子构造用纯函数 buildSourceSeed（flowModel.ts），分屏对比 Phase 5 的第二栏独立复用同一构造逻辑，不经过本 store。
  // persistedDef（0707 优化·Phase4）：调用方若已查到该源自己保存过的 FlowDef（含网站同步覆盖写入的），
  // 优先加载它而不是重新按 Step 拼一份通用模板——否则源单独改过的流程 / 网站同步覆盖的结果重进画布都会被冲掉。
  function loadFromSource(source: Source, steps: Step[], persistedDef?: FlowDef | null) {
    // 存克隆而非引用（0706 Phase4 修复）：mock 按引用返回内部数据，若 sourceCtx 与之共享对象，
    // mock 侧的原始变更会绕过响应式代理静默改值，导致后续同值代理赋值不触发更新、摘要头保存后不刷新
    resetAllContext()
    sourceCtx.value = JSON.parse(JSON.stringify(source)) as Source
    // needLogin 未显式设置时按是否已绑登录凭据回填（与旧行为对齐：有凭据引用即视为登录态源）
    // 已绑定模板的版本与动态绑定随源 FlowDef 一起持久化；源列表的旧实体没有这些字段时，
    // 不能在这里覆盖掉存档里的绑定信息。
    const storedBinding = persistedDef?.source
    const sourceForCfg: Source = {
      ...source,
      needLogin: source.needLogin ?? Boolean(source.credentialRef),
      templateId: storedBinding?.templateId ?? source.templateId,
      templateVersion: storedBinding?.templateVersion ?? source.templateVersion,
      nodeBindings: storedBinding?.nodeBindings ?? source.nodeBindings,
    }
    // 注意：这里不直接调用 load()，而是返回配置供 flow store 加载
    // 避免循环依赖
    return {
      def: persistedDef
        ? { ...persistedDef, id: source.sourceId, source: sourceForCfg }
        : {
            id: source.sourceId,
            name: source.name,
            version: `source-v${source.version ?? 1}`,
            main: buildSourceSeed(source, steps).main,
            branches: buildSourceSeed(source, steps).branches,
            configs: buildSourceSeed(source, steps).configs,
            updatedAt: source.updatedAt || '',
            source: sourceForCfg,
          },
      sourceCtx: sourceCtx.value,
    }
  }

  // 网站态：加载/新建网站统一流程模板（0707 优化·Phase4）。def 为空 = 该网站还没保存过模板，起一个空白流程。
  // 模板落库沿用既有 flow/save·load 契约，id = `site:${siteId}`（画布保存按钮天然写对地方，不必新增专属持久化）。
  function startSiteFlow(site: Site, def?: FlowDef | null) {
    resetAllContext()
    siteCtx.value = JSON.parse(JSON.stringify(site)) as Site
    return def ?? makeSiteBlankTemplate(site)
  }

  // 空白模板 → 有源草稿画布（0707 Phase3.1）：过闸创建后用户先进入编排工作区，
  // 再手工用「+」添加步骤，或用空白画布引导卡「智能推荐模板」；不自动塞首节点，sourceCtx/sourceCfg 只提供源上下文和摘要头编辑入口。
  function startDraftSource(source: Source) {
    const draft = JSON.parse(JSON.stringify(source)) as Source
    siteCtx.value = null
    sourceCtx.value = draft
    return {
      id: source.sourceId,
      name: source.name || '未命名采集源',
      version: 'draft-0.1',
      main: ['start', 'end'],
      branches: [],
      configs: {},
      updatedAt: source.updatedAt || '',
      source: draft,
    }
  }

  /** 显式切换/升级模板：只按稳定 nodeId 继承同一模板的兼容绑定，绝不按节点名称猜测复用。 */
  function applyTemplate(
    template: FlowTemplate,
    configs: Record<string, NodeConfig>,
  ): { retained: number; cleared: number } | null {
    const source = sourceCfg.value ?? sourceCtx.value
    if (!source) return null
    const oldBindings = extractTemplateNodeBindings(configs)
    const sameTemplate = source.templateId === template.id
    const nodeBindings = sameTemplate
      ? compatibleTemplateBindings(oldBindings, template.definition)
      : {}
    const boundSource: Source = {
      ...(JSON.parse(JSON.stringify(source)) as Source),
      templateId: template.id,
      templateVersion: template.version,
      nodeBindings,
    }
    if (sourceCfg.value) Object.assign(sourceCfg.value, boundSource)
    if (sourceCtx.value) Object.assign(sourceCtx.value, boundSource)
    return {
      retained: Object.keys(nodeBindings).length,
      cleared: Object.keys(oldBindings).length - Object.keys(nodeBindings).length,
    }
  }

  function setFlowName(name: string) {
    flowName.value = name || '未命名流程'
  }

  return {
    // 状态
    flowId,
    flowName,
    sourceCtx,
    sourceCfg,
    siteCtx,
    // 操作
    patchSource,
    patchSourceCtx,
    resetAllContext,
    clearSourceCtx,
    clearSiteCtx,
    setSiteDisplayCtx,
    loadFromSource,
    startSiteFlow,
    startDraftSource,
    applyTemplate,
    setFlowName,
  }
})
