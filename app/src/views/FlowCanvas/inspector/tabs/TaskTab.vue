<script setup lang="ts">
// 任务配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：输入表（首步骤无）→ 进入条件 → 队列归属 → 任务 URL 来源/规则 → 任务参数取值 → 上下文来源 → 出参列。
// 行为与原 NodeInspector 内联实现 1:1，仅物理搬迁；共享资产 tables/params 经 useNodeInspectorAssets 注入。
import { computed } from 'vue'
import { useFlowStore } from '@/stores/flow'
import {
  fieldOptionsFromTableOrOutput, nodeEntryCondition, nodeTaskQueue, collectorCapabilityOf,
  type ConditionGroup, type NodeConfig, type TaskParamValue,
} from '@/views/FlowCanvas/canvas/flowModel'
import ConditionRow from '../ConditionRow.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'

const flow = useFlowStore()
const { tables, params } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// ---- 输入表（0701 问题五）：从第 2 个步骤起有输入表，空 = 自动继承上游输出表 ----
const isFirstDataNode = computed(() => (id.value ? flow.isFirstMainNodeId(id.value) : false))
const effectiveInputTableId = computed(() => (id.value ? flow.effectiveInputTableFor(id.value) : ''))
const ownInputTable = computed(() => cc.value?.inputTable ?? cfg.value?.inputTable ?? '')
const inputTableAutoLabel = computed(() =>
  effectiveInputTableId.value ? `自动 · 继承上游（${effectiveInputTableId.value}）` : '自动 · 无上游可继承',
)
function onInputTableChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (cc.value) flow.patchCollect(id.value, { inputTable: v })
  else flow.setInputTable(id.value, v)
}

// 当前节点输出表（统一口径：采集类取 collectCfg.outputTable，非采集类取 cfg.outputTable）
const nodeTableId = computed(() => cc.value?.outputTable || cfg.value?.outputTable || '')

const prevNode = computed<NodeConfig | undefined>(() => {
  const idx = flow.main.indexOf(id.value)
  for (let i = idx - 1; i >= 0; i--) {
    const pid = flow.main[i]
    if (pid === 'start') return undefined
    const c = flow.configs[pid]
    if (c) return c
  }
  return undefined
})

// 输入表 schema 字段清单：首节点取本节点输出表，其余取有效输入表；继承临时表查不到 schema 时回退上游 output。
const inputTableFields = computed(() => {
  const tid = isFirstDataNode.value ? nodeTableId.value : (ownInputTable.value || effectiveInputTableId.value)
  return fieldOptionsFromTableOrOutput(tid, tables.value, isFirstDataNode.value ? cfg.value?.output : prevNode.value?.output)
})
const outputTableFields = computed(() =>
  fieldOptionsFromTableOrOutput(nodeTableId.value, tables.value, cfg.value?.output),
)

// 任务配置独立于已退役的配置功能；队列未填时按当前子源自动生成。
const ownTaskQueue = computed(() => (cfg.value ? nodeTaskQueue(cfg.value) : ''))
const taskQueueFallback = computed(() => {
  const sc = flow.sourceCfg
  return sc?.sourceId ? `${sc.sourceId}_main` : ''
})
function onTaskQueueChange(e: Event) {
  flow.setTaskQueue(id.value, (e.target as HTMLInputElement).value)
}
function onTaskUrlSourceFieldChange(e: Event) {
  flow.patchTaskConfig(id.value, { urlSourceField: (e.target as HTMLSelectElement).value })
}
function onTaskUrlRuleChange(e: Event) {
  flow.patchTaskConfig(id.value, { urlRule: (e.target as HTMLInputElement).value })
}

// 任务参数由当前节点「参数配置」绑定，不再另行选择参数；这里只配置每个参数的取值来源。
const availableTaskParamRefs = computed<string[]>(() => [...new Set(cc.value?.urlParamRefs ?? [])])
const taskParamValues = computed<TaskParamValue[]>(() => {
  const saved = new Map((cfg.value?.taskCfg?.paramValues ?? []).map((item) => [item.paramId, item]))
  return availableTaskParamRefs.value.map((paramId) => ({ paramId, fieldId: '', valueExpr: '', ...(saved.get(paramId) ?? {}) }))
})
function taskParamLabel(paramId: string) {
  const param = params.value.find((item) => item.paramId === paramId)
  return param ? `[${paramId}] ${param.name}` : `[${paramId}]`
}
function onTaskParamValueChange(paramId: string, key: 'fieldId' | 'valueExpr', e: Event) {
  const value = (e.target as HTMLInputElement | HTMLSelectElement).value
  flow.patchTaskConfig(id.value, {
    paramValues: taskParamValues.value.map((item) => item.paramId === paramId ? { ...item, [key]: value } : item),
  })
}

type TaskFieldList = 'contextMap' | 'outColumns'
function taskFieldList(key: TaskFieldList) {
  return cfg.value?.taskCfg?.[key] ?? []
}
function taskFieldOptions(key: TaskFieldList) {
  return key === 'contextMap' ? inputTableFields.value : outputTableFields.value
}
function onTaskFieldChange(key: TaskFieldList, index: number, e: Event) {
  const fields = [...taskFieldList(key)]
  fields[index] = (e.target as HTMLSelectElement).value
  flow.patchTaskConfig(id.value, { [key]: fields })
}
function addTaskField(key: TaskFieldList) {
  const current = taskFieldList(key)
  const next = taskFieldOptions(key).find((field) => !current.includes(field.prop))
  if (next) flow.patchTaskConfig(id.value, { [key]: [...current, next.prop] })
}
function removeTaskField(key: TaskFieldList, index: number) {
  flow.patchTaskConfig(id.value, { [key]: taskFieldList(key).filter((_: string, itemIndex: number) => itemIndex !== index) })
}
function canAddTaskField(key: TaskFieldList) {
  return taskFieldOptions(key).some((field) => !taskFieldList(key).includes(field.prop))
}

const entryCondition = computed<ConditionGroup | undefined>(() => (cfg.value ? nodeEntryCondition(cfg.value) : undefined))
function onEntryConditionChange(cond: ConditionGroup | undefined) {
  flow.setEntryCondition(id.value, cond)
}
</script>

<template>
  <!-- 任务配置：首节点只维护队列；后续节点从输入表取任务参数/上下文，并声明出参列。 -->
  <div class="rc-field"><label>输入表</label>
    <div v-if="isFirstDataNode" class="rc-readonly-hint">无 · 首步骤任务来自源 URL / 初始队列</div>
    <select v-else class="rc-select" :value="ownInputTable" @change="onInputTableChange">
      <option value="">{{ inputTableAutoLabel }}</option>
      <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
    </select>
  </div>
  <ConditionRow v-if="!isFirstDataNode" integrated :condition="entryCondition" :fields="inputTableFields" @change="onEntryConditionChange" />
  <!-- 队列归属对首节点同样展示（0710 会议 D1：首节点无输入表但有队列，未填时保存/试跑自动写入默认队列名） -->
  <div class="rc-field"><label>队列归属{{ nodeCapability?.queueMode === 'fixed' ? `（固定 · ${nodeCapability.label}）` : '' }}</label>
    <input
      class="rc-input"
      :value="ownTaskQueue"
      :disabled="nodeCapability?.queueMode === 'fixed'"
      :placeholder="taskQueueFallback ? `自动 · ${taskQueueFallback}` : '手动填写队列名'"
      @input="onTaskQueueChange"
    />
  </div>
  <template v-if="!isFirstDataNode">
    <div class="rc-field"><label>任务 URL 来源字段</label>
      <select class="rc-select" :value="cfg?.taskCfg?.urlSourceField ?? ''" @change="onTaskUrlSourceFieldChange">
        <option value="">选择字段（上一步属性）</option>
        <option v-for="f in inputTableFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
      </select>
    </div>
    <div class="rc-field"><label>任务 URL 规则</label>
      <input class="rc-input" :value="cfg?.taskCfg?.urlRule ?? ''" placeholder="如 $VAL$（默认从来源字段取值，支持动态函数）" @input="onTaskUrlRuleChange" />
    </div>
  </template>
  <template v-if="!isFirstDataNode">
    <div class="rc-field">
      <label>任务参数取值</label>
      <div v-if="availableTaskParamRefs.length" class="ni-task-param-list">
        <div v-for="item in taskParamValues" :key="item.paramId" class="ni-task-param-row">
          <b>{{ taskParamLabel(item.paramId) }}</b>
          <select class="rc-select" :value="item.fieldId" @change="onTaskParamValueChange(item.paramId, 'fieldId', $event)">
            <option value="">取值字段（输入表）</option>
            <option v-for="f in inputTableFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
          </select>
          <input class="rc-input" :value="item.valueExpr" placeholder="值函数（可选，如 trim($VAL$)）" @input="onTaskParamValueChange(item.paramId, 'valueExpr', $event)" />
        </div>
      </div>
      <div v-else class="rc-readonly-hint">请先在当前节点的参数配置中绑定参数。</div>
    </div>
    <div class="rc-field"><label>上下文来源</label>
      <div v-if="taskFieldList('contextMap').length" class="ni-task-field-list">
        <div v-for="(fieldId, index) in taskFieldList('contextMap')" :key="`${fieldId}-${index}`" class="ni-task-field-row">
          <select class="rc-select" :value="fieldId" @change="onTaskFieldChange('contextMap', index, $event)">
            <option v-for="f in inputTableFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
          </select>
          <button class="rc-row-del" type="button" title="删除字段" @click="removeTaskField('contextMap', index)">×</button>
        </div>
      </div>
      <button class="rc-btn" type="button" :disabled="!canAddTaskField('contextMap')" @click="addTaskField('contextMap')">+ 添加字段</button>
      <div class="rc-help">添加需要随任务传递的输入表字段。</div>
    </div>
    <div class="rc-field"><label>出参列</label>
      <div v-if="taskFieldList('outColumns').length" class="ni-task-field-list">
        <div v-for="(fieldId, index) in taskFieldList('outColumns')" :key="`${fieldId}-${index}`" class="ni-task-field-row">
          <select class="rc-select" :value="fieldId" @change="onTaskFieldChange('outColumns', index, $event)">
            <option v-for="f in outputTableFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
          </select>
          <button class="rc-row-del" type="button" title="删除字段" @click="removeTaskField('outColumns', index)">×</button>
        </div>
      </div>
      <button class="rc-btn" type="button" :disabled="!canAddTaskField('outColumns')" @click="addTaskField('outColumns')">+ 添加字段</button>
      <div class="rc-help">添加当前节点输出表中需要保留给后续步骤的字段。</div>
    </div>
  </template>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.ni-task-param-list { display: grid; gap: 8px; }
.ni-task-param-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 8px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; }
.ni-task-param-row b { color: var(--rc-text-2); font-size: 12px; }
.ni-task-field-list { display: grid; gap: 6px; margin-bottom: 6px; }
.ni-task-field-row { display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; gap: 6px; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
</style>
