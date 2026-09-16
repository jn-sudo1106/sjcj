// stores/node.ts - 节点状态辅助（P2-1 · stores/flow.ts 拆分）
// 职责：selectedId/activeTab + dirty 标记 + 节点字段编辑（三列表格/采集/任务/规则 patch）
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  emptyTripleRow,
  setTripleValue,
  collectorCapabilityOf,
  makeDefaultRuleOrchestration,
  makeDefaultExecConfig,
  type NodeConfig,
  type CollectConfig,
  type CollectorSchedule,
  type ConditionGroup,
  type MonitorAlertConfig,
  type TaskConfig,
  type TripleField,
  type RuleOrchestration,
} from '@/views/FlowCanvas/canvas/flowModel'

export const useNodeStore = defineStore('node', () => {
  // ---- 节点选择状态 ----
  const selectedId = ref<string>('')
  const activeTab = ref<string>('config')

  // ---- 双层未保存标记（0824-00 §5.4）----
  // 节点配置表单改动 → configDirty，按节点记，由「保存节点配置」逐节点清；
  // 节点增删/移动/连线/换配置/流程名/进入条件 → flowDirty，由步骤自动保存清。
  // dirty 保留为两者并集：发起抓取门槛、模板页恢复等老调用点语义不变。
  const dirtyConfigNodes = ref<string[]>([])
  const flowDirty = ref(false)
  /** 每次 touchFlow 自增。自动保存要靠它重开防抖：flowDirty 已经是 true 时再改不会触发 watch。 */
  const flowRev = ref(0)
  const configDirty = computed(() => dirtyConfigNodes.value.length > 0)
  const dirty = computed({
    get: () => configDirty.value || flowDirty.value,
    set: (v) => {
      if (v) flowDirty.value = true
      else {
        dirtyConfigNodes.value = []
        flowDirty.value = false
      }
    },
  })
  function touchConfig(id: string) {
    if (!dirtyConfigNodes.value.includes(id)) dirtyConfigNodes.value.push(id)
  }
  function touchFlow() {
    flowDirty.value = true
    flowRev.value += 1
  }
  /** 旧签名保留：现存调用点（flow store 的拓扑/流程名/源字段动作）都是流程级 */
  function touch() {
    touchFlow()
  }
  function markConfigSaved(id: string) {
    dirtyConfigNodes.value = dirtyConfigNodes.value.filter((nodeId) => nodeId !== id)
  }
  function markSaved() {
    dirtyConfigNodes.value = []
    flowDirty.value = false
  }
  function markFlowSaved() {
    flowDirty.value = false
  }

  // 这些需要从 flow store 获取
  let configs: Record<string, NodeConfig> = {}

  function bindFlowStore(flowConfigs: Record<string, NodeConfig>, flowMainGetter: () => string[], inputTableGetter?: (id: string) => string) {
    configs = flowConfigs
    void flowMainGetter
    void inputTableGetter
  }

  // ---- 节点字段编辑（三列表格）----
  function setTripleCell(id: string, field: TripleField, rowIndex: number, colIndex: 0 | 1 | 2, value: string) {
    const c = configs[id]
    const row = c?.[field]?.[rowIndex]
    if (row) setTripleValue(field, row, colIndex, value)
    touchConfig(id)
  }

  function addTripleRow(id: string, field: TripleField) {
    const c = configs[id]
    if (!c) return
    if (field === 'inmap') c.inmap.push(emptyTripleRow(field) as never)
    else c[field].push(emptyTripleRow(field) as never)
    touchConfig(id)
  }

  function removeTripleRow(id: string, field: TripleField, rowIndex: number) {
    const c = configs[id]
    if (c) c[field].splice(rowIndex, 1)
    touchConfig(id)
  }

  // ---- 节点级 patch（采集/任务/规则）----
  function patchCollect(id: string, patch: Partial<CollectConfig>) {
    const c = configs[id]
    if (!c?.collectCfg) return
    const next = { ...patch }
    if (next.webKind) next.isDetail = next.webKind === 'detail'
    else if (next.isDetail) next.webKind = 'detail'
    else if (next.isDetail === false && c.collectCfg.webKind === 'detail') next.webKind = 'list'
    // 固定产物类型节点的输出表不可覆盖（0711 T5：UI 只读不是唯一防线，store 写函数也要挡）
    if ('outputTable' in next) {
      const cap = collectorCapabilityOf(c)
      if (cap?.outputMode === 'fixed') next.outputTable = cap.fixedOutputTable ?? c.collectCfg.outputTable
    }
    if ('loginConfigs' in next) {
      const seen = new Set<string>()
      next.loginConfigs = (next.loginConfigs ?? []).map((item, index) => ({
        id: item.id?.trim() || `login-${index + 1}`,
        loginUrl: item.loginUrl?.trim() || '',
        loginName: item.loginName?.trim() || '',
        loginPwd: item.loginPwd?.trim() || '',
        newLoginConfig: item.newLoginConfig === '0' ? '0' as const : '1' as const,
        authConfig: item.authConfig?.trim() || '',
        enabled: item.enabled !== false,
      })).filter((item) => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      const preferred = next.defaultLoginConfigId
      next.defaultLoginConfigId = next.loginConfigs.some((item) => item.id === preferred && item.enabled)
        ? preferred
        : next.loginConfigs.find((item) => item.enabled)?.id

      const selected = next.loginConfigs.find((item) => item.id === next.defaultLoginConfigId)
      next.loginUrl = selected?.loginUrl ?? (next.loginConfigs.length ? c.collectCfg.loginUrl : '')
      next.account = selected?.loginName ?? (next.loginConfigs.length ? c.collectCfg.account : '')
    }
    Object.assign(c.collectCfg, next)
    if ('urlParamRefs' in next && c.taskCfg?.paramValues) {
      const allowed = new Set(c.collectCfg.urlParamRefs ?? [])
      c.taskCfg.paramValues = c.taskCfg.paramValues.filter((item) => allowed.has(item.paramId))
    }
    touchConfig(id)
  }

  function patchTaskConfig(id: string, patch: Partial<TaskConfig>) {
    const c = configs[id]
    if (!c) return
    const next = { ...patch }
    // 任务参数由当前节点的参数配置决定；只接受这些参数的取值映射，不能混入其他节点参数。
    if ('paramValues' in next) {
      const ownParamRefs = new Set(c.collectCfg?.urlParamRefs ?? [])
      const seen = new Set<string>()
      next.paramValues = (next.paramValues ?? []).filter((item) => {
        if (!ownParamRefs.has(item.paramId) || seen.has(item.paramId)) return false
        seen.add(item.paramId)
        return true
      }).map((item) => ({ paramId: item.paramId, fieldId: item.fieldId ?? '', valueExpr: item.valueExpr ?? '' }))
    }
    if ('contextMap' in next) next.contextMap = [...new Set((next.contextMap ?? []).filter(Boolean))]
    if ('outColumns' in next) next.outColumns = [...new Set((next.outColumns ?? []).filter(Boolean))]
    // 固定产物类型节点的队列不可覆盖（0711 T5，与 patchCollect 的输出表防线同一口径）
    if ('queue' in next) {
      const cap = collectorCapabilityOf(c)
      if (cap?.queueMode === 'fixed') next.queue = cap.fixedQueue ?? c.taskCfg?.queue ?? ''
    }
    // 0806：上下文来源/任务参数/出参列不再按主链位置或当前输入表清空。
    // 无有效输入表时由 UI 禁用候选并在发布/运行时提示，但不能在一次 patch 中丢失用户已经保存的配置。
    const taskCfg = { queue: '', urlRule: '', ...c.taskCfg, ...next }
    c.taskCfg = taskCfg
    touchConfig(id)
  }

  function patchSchedule(id: string, patch: Partial<CollectorSchedule>) {
    const c = configs[id]
    if (!c) return
    c.schedule = { ...c.schedule, ...patch }
    touchConfig(id)
  }

  function setOutputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.outputTable = tableId
    touchConfig(id)
  }

  function setDedupMode(id: string, mode: 'source' | 'table') {
    const c = configs[id]
    if (!c) return
    if (c.collectCfg) c.collectCfg.dedupMode = mode
    else c.dedupMode = mode
    touchConfig(id)
  }

  function setOutFields(id: string, fields: string[]) {
    const c = configs[id]
    if (!c) return
    const unique = [...new Set(fields.filter(Boolean))]
    if (c.collectCfg) c.collectCfg.outFields = unique
    else c.outFields = unique
    if (!c.taskCfg) c.taskCfg = { queue: '', urlRule: '' }
    c.taskCfg.outColumns = unique
    touchConfig(id)
  }

  function setInputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) {
      c.inputTable = tableId
      if (!c.ruleCfg) delete c.inputFields
    }
    touchConfig(id)
  }

  function setInputFields(id: string, fields: string[]) {
    const c = configs[id]
    if (!c) return
    c.inputFields = [...new Set(fields.filter(Boolean))]
    touchConfig(id)
  }

  function resetInputFields(id: string) {
    const c = configs[id]
    if (!c) return
    delete c.inputFields
    touchConfig(id)
  }

  function setTaskQueue(id: string, value: string) {
    patchTaskConfig(id, { queue: value })
  }

  // 结构化配置/正文规则（0804 S3-1）：采集类写 collectCfg，非采集类写 NodeConfig 顶层——
  // 跟 setEntryCondition 同一个"哪边有 collectCfg 就写哪边"套路，调用方不用自己分支。
  function setStructuredConfig(id: string, value: string) {
    const c = configs[id]
    if (!c) return
    const target = c.collectCfg ?? c
    // 空字符串表示用户明确清空；undefined 才表示该字段尚未回填、保存时应保留后端原值。
    target.structuredConfig = value
    touchConfig(id)
  }
  function setContentRules(id: string, value: string) {
    const c = configs[id]
    if (!c) return
    const target = c.collectCfg ?? c
    target.contentRules = value
    touchConfig(id)
  }

  function setEntryCondition(id: string, cond: ConditionGroup | undefined) {
    const c = configs[id]
    if (!c) return
    const target = c.collectCfg ?? c
    if (cond) target.entryCondition = cond
    else delete target.entryCondition
    // 进入条件在步骤上（0828 §2.7 / D20），不是配置。置 flowDirty 才能进自动保存。
    touchFlow()
  }

  /** 配置名称（config-meta）：新增/复制时与节点名一致；改已有配置的名字等于改共享配置名 */
  function setConfigName(id: string, name: string) {
    const c = configs[id]
    if (!c) return
    c.configName = name
    touchConfig(id)
  }

  /** 配置 URL（旧 configUrl）：改已有配置的 URL 等于改共享配置 */
  function setConfigUrl(id: string, url: string) {
    const c = configs[id]
    if (!c) return
    c.configUrl = url
    touchConfig(id)
  }

  /** 规则 ID / 任务 URL 来源字段（步骤 itemId）。落在步骤上，走自动保存。 */
  function setItemId(id: string, itemId: string) {
    const c = configs[id]
    if (!c) return
    c.itemId = itemId.trim() || '-1'
    touchFlow()
  }

  /** 适用源（步骤 sourceId）。-1 = 该配置下所有源。落在步骤上，走自动保存。 */
  function setStepSourceId(id: string, sourceId: string) {
    const c = configs[id]
    if (!c) return
    c.stepSourceId = sourceId.trim()
    touchFlow()
  }

  /** 从 config/configDetail 回填配置 URL。这是读，不是用户改动，不置脏。
   *  已有非空值不覆盖；空字符串视为还没取到，允许用详情里的真值补上。 */
  function hydrateConfigUrl(id: string, url: string) {
    const c = configs[id]
    if (!c || c.configUrl) return
    c.configUrl = url
  }

  function setNodeDisabled(id: string, disabled: boolean) {
    const c = configs[id]
    if (!c) return
    c.disabled = disabled
    touchFlow()
  }

  function setBaseRow(id: string, index: number, value: string) {
    const c = configs[id]
    if (c && c.base[index]) c.base[index][1] = value
    touchConfig(id)
  }

  function setFieldRow(id: string, index: number, value: string) {
    const c = configs[id]
    if (c && c.fields[index]) c.fields[index][1] = value
    touchConfig(id)
  }

  function patchRuleConfig(id: string, patch: Partial<RuleOrchestration>) {
    const c = configs[id]
    if (!c) return
    c.ruleCfg = { ...makeDefaultRuleOrchestration(), ...c.ruleCfg, ...patch }
    touchConfig(id)
  }

  /** 非规则节点的编排配置（0804 S3-3）：与 patchRuleConfig 同款，写 execCfg 而不是 ruleCfg */
  function patchExecConfig(id: string, patch: Partial<RuleOrchestration>) {
    const c = configs[id]
    if (!c) return
    c.execCfg = { ...makeDefaultExecConfig(), ...c.execCfg, ...patch }
    touchConfig(id)
  }

  /** 数据监控节点「监控方法」多选值（2026-09-01）：落在节点上，走配置脏标记（后续随节点配置写入通路持久化）。 */
  function setMonitorMethods(id: string, methods: string[]) {
    const c = configs[id]
    if (!c) return
    c.monitorMethods = [...new Set(methods.filter(Boolean))]
    touchConfig(id)
  }

  /** 数据监控节点告警配置快照：落在节点配置上，保存 ck_source.check_conf 时读取。 */
  function setMonitorAlertConfig(id: string, config: MonitorAlertConfig) {
    const c = configs[id]
    if (!c) return
    c.alertConfig = JSON.parse(JSON.stringify(config)) as MonitorAlertConfig
    touchConfig(id)
  }

  return {
    // 状态
    selectedId,
    activeTab,
    dirty,
    configDirty,
    flowDirty,
    flowRev,
    dirtyConfigNodes,
    // 操作
    touch,
    touchConfig,
    touchFlow,
    markConfigSaved,
    markSaved,
    markFlowSaved,
    setTripleCell,
    addTripleRow,
    removeTripleRow,
    patchCollect,
    patchTaskConfig,
    patchSchedule,
    patchRuleConfig,
    patchExecConfig,
    setMonitorMethods,
    setMonitorAlertConfig,
    setOutputTable,
    setDedupMode,
    setOutFields,
    setInputTable,
    setInputFields,
    resetInputFields,
    setTaskQueue,
    setStructuredConfig,
    setContentRules,
    setConfigName,
    setConfigUrl,
    hydrateConfigUrl,
    setItemId,
    setStepSourceId,
    setEntryCondition,
    setNodeDisabled,
    setBaseRow,
    setFieldRow,
    bindFlowStore,
  }
})
