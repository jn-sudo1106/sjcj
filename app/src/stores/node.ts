// stores/node.ts - 节点状态辅助（P2-1 · stores/flow.ts 拆分）
// 职责：selectedId/activeTab + dirty 标记 + 节点字段编辑（三列表格/采集/任务/规则 patch）
import { ref } from 'vue'
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
  type TaskConfig,
  type TripleField,
  type RuleOrchestration,
} from '@/views/FlowCanvas/canvas/flowModel'

export const useNodeStore = defineStore('node', () => {
  // ---- 节点选择状态 ----
  const selectedId = ref<string>('')
  const activeTab = ref<string>('config')

  // ---- 未保存改动标记（B3）：load() 时清零，其余编辑动作调用 touch() 置脏 ----
  const dirty = ref(false)
  function touch() {
    dirty.value = true
  }
  function markSaved() {
    dirty.value = false
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
    touch()
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
    touch()
  }

  function patchSchedule(id: string, patch: Partial<CollectorSchedule>) {
    const c = configs[id]
    if (!c) return
    c.schedule = { ...c.schedule, ...patch }
    touch()
  }

  function setOutputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.outputTable = tableId
    touch()
  }

  function setDedupMode(id: string, mode: 'source' | 'table') {
    const c = configs[id]
    if (!c) return
    if (c.collectCfg) c.collectCfg.dedupMode = mode
    else c.dedupMode = mode
    touch()
  }

  function setOutFields(id: string, fields: string[]) {
    const c = configs[id]
    if (!c) return
    const unique = [...new Set(fields.filter(Boolean))]
    if (c.collectCfg) c.collectCfg.outFields = unique
    else c.outFields = unique
    if (!c.taskCfg) c.taskCfg = { queue: '', urlRule: '' }
    c.taskCfg.outColumns = unique
    touch()
  }

  function setInputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) {
      c.inputTable = tableId
      if (!c.ruleCfg) delete c.inputFields
    }
    touch()
  }

  function setInputFields(id: string, fields: string[]) {
    const c = configs[id]
    if (!c) return
    c.inputFields = [...new Set(fields.filter(Boolean))]
    touch()
  }

  function resetInputFields(id: string) {
    const c = configs[id]
    if (!c) return
    delete c.inputFields
    touch()
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
    target.structuredConfig = value || undefined
    touch()
  }
  function setContentRules(id: string, value: string) {
    const c = configs[id]
    if (!c) return
    const target = c.collectCfg ?? c
    target.contentRules = value || undefined
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

  function setNodeDisabled(id: string, disabled: boolean) {
    const c = configs[id]
    if (!c) return
    c.disabled = disabled
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

  function patchRuleConfig(id: string, patch: Partial<RuleOrchestration>) {
    const c = configs[id]
    if (!c) return
    c.ruleCfg = { ...makeDefaultRuleOrchestration(), ...c.ruleCfg, ...patch }
    touch()
  }

  /** 非规则节点的编排配置（0804 S3-3）：与 patchRuleConfig 同款，写 execCfg 而不是 ruleCfg */
  function patchExecConfig(id: string, patch: Partial<RuleOrchestration>) {
    const c = configs[id]
    if (!c) return
    c.execCfg = { ...makeDefaultExecConfig(), ...c.execCfg, ...patch }
    touch()
  }

  return {
    // 状态
    selectedId,
    activeTab,
    dirty,
    // 操作
    touch,
    markSaved,
    setTripleCell,
    addTripleRow,
    removeTripleRow,
    patchCollect,
    patchTaskConfig,
    patchSchedule,
    patchRuleConfig,
    patchExecConfig,
    setOutputTable,
    setDedupMode,
    setOutFields,
    setInputTable,
    setInputFields,
    resetInputFields,
    setTaskQueue,
    setStructuredConfig,
    setContentRules,
    setEntryCondition,
    setNodeDisabled,
    setBaseRow,
    setFieldRow,
    bindFlowStore,
  }
})
