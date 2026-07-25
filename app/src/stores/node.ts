// stores/node.ts - 节点状态辅助（P2-1 · stores/flow.ts 拆分）
// 职责：selectedId/activeTab + dirty 标记 + 节点字段编辑（三列表格/采集/任务/规则 patch）
import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  isFirstMainNode,
  emptyTripleRow,
  setTripleValue,
  collectorCapabilityOf,
  makeDefaultRuleOrchestration,
  type NodeConfig,
  type CollectConfig,
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
  let getMain: () => string[] = () => []

  function bindFlowStore(flowConfigs: Record<string, NodeConfig>, flowMainGetter: () => string[]) {
    configs = flowConfigs
    getMain = flowMainGetter
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
    const taskCfg = { queue: '', urlRule: '', ...c.taskCfg, ...next }
    if (isFirstMainNode(getMain(), configs, id)) {
      delete taskCfg.paramValues
      delete taskCfg.contextMap
      delete taskCfg.outColumns
      delete taskCfg.paramRefs
    }
    c.taskCfg = taskCfg
    touch()
  }

  function setOutputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.outputTable = tableId
    touch()
  }

  function setInputTable(id: string, tableId: string) {
    const c = configs[id]
    if (c) c.inputTable = tableId
    touch()
  }

  function setTaskQueue(id: string, value: string) {
    patchTaskConfig(id, { queue: value })
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
    patchRuleConfig,
    setOutputTable,
    setInputTable,
    setTaskQueue,
    setEntryCondition,
    setNodeDisabled,
    setBaseRow,
    setFieldRow,
    bindFlowStore,
  }
})
