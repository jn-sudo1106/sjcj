<script setup lang="ts">
// 任务配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：有效输入表摘要 → 进入条件 → 队列名称 → 任务参数取值 → 上下文来源。
// 进入条件留在本 Tab（2026-08-28 确认）；入口文案按 0828 D20 改成「添加条件」，
// 落库仍在流程的步骤上（Step.condition，0824-11 §1.1）。
// 「任务 URL 来源字段/规则」已删除（0804 拍板：当时保留是为了传参，现在在参数位置拼接即可，见开发方案 §2.3）。
// 行为与原 NodeInspector 内联实现 1:1，仅物理搬迁；共享资产 tables/params 经 useNodeInspectorAssets 注入。
import { computed, watch } from 'vue'
import { useFlowStore } from '@/stores/flow'
import {
  fieldOptionsFromTableOrOutput, isRuleNode, nodeEntryCondition, nodeTaskQueue, collectorCapabilityOf,
  type ConditionGroup, type NodeConfig, type TaskParamValue,
} from '@/views/FlowCanvas/canvas/flowModel'
import ConditionRow from '../ConditionRow.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'

const flow = useFlowStore()
const { tables, params, ensureTableFields } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)
const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// ---- 输入表：显式配置优先，否则继承上游；是否有输入不再由节点位置决定 ----
const effectiveInputTableId = computed(() => (id.value ? flow.effectiveInputTableFor(id.value) : ''))
const hasEffectiveInput = computed(() => Boolean(effectiveInputTableId.value))
const ownInputTable = computed(() => cc.value?.inputTable ?? cfg.value?.inputTable ?? '')

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

// 输入表 schema 字段清单：显式输入表优先，其次取有效输入表；继承临时表查不到 schema 时回退上游 output。
const inputTableId = computed(() => ownInputTable.value || effectiveInputTableId.value)
watch(inputTableId, (tid) => ensureTableFields(tid), { immediate: true })
const inputTableFields = computed(() =>
  fieldOptionsFromTableOrOutput(inputTableId.value, tables.value, prevNode.value?.output ?? cfg.value?.output))
const selectedInputFields = computed(() => {
  const selected = cfg.value?.inputFields
  return selected === undefined ? inputTableFields.value : inputTableFields.value.filter((field) => selected.includes(field.prop))
})
// 任务配置独立于已退役的配置功能；队列未填时按当前源自动生成。
const ownTaskQueue = computed(() => (cfg.value ? nodeTaskQueue(cfg.value) : ''))
const taskQueueFallback = computed(() => {
  const sc = flow.sourceCfg
  return sc?.sourceId ? `${sc.sourceId}_main` : ''
})
function onTaskQueueChange(e: Event) {
  flow.setTaskQueue(id.value, (e.target as HTMLInputElement).value)
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

// 「出参列」（outColumns）2026-08-27 拍板搬到参数配置 Tab，这里只剩「上下文来源」（contextMap）。
// 两者取值来源本来就不同：上下文来源取输入表字段，出参列取输出表字段——放在一起容易被误当成一类。
//
// 2026-08-28 对齐旧平台（旧 SourceStep.vue「上下文来源」+ page/base/EntryItemMultiSelect.vue）：
//   ① 候选取**输入表全部字段**，不按表配置的勾选过滤——旧平台直接 queryEntryType(表).items；
//   ② 一个**多选下拉**一次选完，不再是"每行一个 select + 添加/删除按钮"；
//   ③ 选项文案 `[K1] - 标题 - [title]`（columnName / itemName / itemCode 三段）；
//   ④ 存 **columnName**（旧平台 `item.join(',')` 存的就是 columnName），不是 prop。
// ④ 现在改零代价：步骤写接口还没实现，contextMap 从没落过库；等 W9 接了再改就要写迁移。
const contextMap = computed<string[]>(() => cfg.value?.taskCfg?.contextMap ?? [])
function onContextMapChange(next: string[]) {
  flow.patchTaskConfig(id.value, { contextMap: next })
}
/** 选项文案照抄旧平台 EntryItemMultiSelect：`[columnName] - 展示名 - [编码]` */
function contextOptionLabel(f: { prop: string; desc: string; columnName?: string }) {
  const column = f.columnName || f.prop
  const code = f.prop.replace(/-K\d+$/, '')
  return `[${column}] - ${f.desc || code} - [${code}]`
}
/** 候选的值 = columnName；表里查不到 columnName 时退回 prop，至少不丢这一项 */
function contextOptionValue(f: { prop: string; columnName?: string }) {
  return f.columnName || f.prop
}

const entryCondition = computed<ConditionGroup | undefined>(() => (cfg.value ? nodeEntryCondition(cfg.value) : undefined))
function onEntryConditionChange(cond: ConditionGroup | undefined) {
  flow.setEntryCondition(id.value, cond)
}

</script>

<template>
  <!-- 任务配置：所有业务节点统一展示输入/任务字段；无有效输入时由字段候选空态表达。 -->
  <div class="rc-field"><label>有效输入表</label>
    <div class="rc-readonly-hint">
      {{ effectiveInputTableId ? `${ownInputTable ? '显式' : '继承'} · ${effectiveInputTableId}` : '暂无有效输入表，请先到「表配置」选择输入表或配置上游输出表。' }}
    </div>
  </div>
  <ConditionRow v-if="hasEffectiveInput" integrated :condition="entryCondition" :fields="inputTableFields" @change="onEntryConditionChange" />
  <!-- 队列名称（0824-00 §6.6 改名，旧字段 topic）对所有采集节点展示；固定产物节点仍由能力模型锁定。 -->
  <div class="rc-field"><label>队列名称{{ nodeCapability?.queueMode === 'fixed' ? `（固定 · ${nodeCapability.label}）` : '' }}</label>
    <input
      class="rc-input"
      :value="ownTaskQueue"
      :disabled="nodeCapability?.queueMode === 'fixed'"
      :placeholder="taskQueueFallback ? `自动 · ${taskQueueFallback}` : '手动填写队列名'"
      @input="onTaskQueueChange"
    />
  </div>
  <div class="rc-field">
    <label>任务参数取值</label>
    <div v-if="!hasEffectiveInput" class="rc-readonly-hint">暂无有效输入表，当前参数取值为空。</div>
    <div v-else-if="availableTaskParamRefs.length" class="ni-task-param-list">
      <div v-for="item in taskParamValues" :key="item.paramId" class="ni-task-param-row">
        <b>{{ taskParamLabel(item.paramId) }}</b>
        <select class="rc-select" :value="item.fieldId" @change="onTaskParamValueChange(item.paramId, 'fieldId', $event)">
          <option value="">取值字段（输入表）</option>
          <option v-for="f in selectedInputFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
        </select>
        <input class="rc-input" :value="item.valueExpr" placeholder="值函数（可选，如 trim($VAL$)）" @input="onTaskParamValueChange(item.paramId, 'valueExpr', $event)" />
      </div>
    </div>
    <div v-else class="rc-readonly-hint">请先在当前节点的参数配置中绑定参数。</div>
  </div>
  <!-- 规则节点不显示这一栏（2026-09-04 会上）：它的入参在「表配置」里选，
       这里再来一个「入参来源」是同一件事的第二个入口，两处能填出不一致的值。
       写入侧也已经统一——规则节点的 context 取自 ruleCfg.inputFields（见 stepPersist）。 -->
  <div v-if="!isRule" class="rc-field"><label>上下文来源</label>
    <el-select
      :model-value="contextMap"
      multiple
      filterable
      collapse-tags
      collapse-tags-tooltip
      :disabled="!hasEffectiveInput"
      :placeholder="hasEffectiveInput ? '请选择列' : '暂无有效输入表'"
      style="width: 100%"
      data-testid="context-map-select"
      @update:model-value="onContextMapChange"
    >
      <el-option
        v-for="f in inputTableFields"
        :key="contextOptionValue(f)"
        :label="contextOptionLabel(f)"
        :value="contextOptionValue(f)"
      />
    </el-select>
  </div>
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
