<script setup lang="ts">
// 任务配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：有效输入表摘要 → 任务 URL（来源字段 / 表达式）→ 进入条件 → 队列名称 → 参数绑定 → 任务参数取值。
// 任务 URL 来源字段 / 规则表达式在任务配置维护（2026-11-05 从「表配置字段用途」撤回，
// 恢复 2026-10-19 按旧平台 SourceStepCard 恢复编辑、10-21 对齐旧平台的旧口径：步骤 itemId / url）。
// 进入条件留在本 Tab（2026-08-28 确认）；入口文案按 0828 D20 改成「添加条件」，
// 落库仍在流程的步骤上（Step.condition，0824-11 §1.1）。
// 行为与原 NodeInspector 内联实现 1:1，仅物理搬迁；共享资产 tables/params 经 useNodeInspectorAssets 注入。
import { computed, ref, watch } from 'vue'
import { useFlowStore } from '@/stores/flow'
import {
  fieldOptionsFromTableOrOutput, isRuleLikeNode, isPdfNode, nodeEntryCondition, nodeTaskQueue, collectorCapabilityOf,
  type ConditionGroup, type NodeConfig, type TaskParamValue,
} from '@/views/FlowCanvas/canvas/flowModel'
import { inputFieldSelection } from '@/utils/flow/inputFieldSelection'
import { taskUrlFieldsApply, taskUrlSourceMissing, type TaskUrlScope } from '@/utils/flow/stepPersist'
import ConditionRow from '../ConditionRow.vue'
import ParamsTab from './ParamsTab.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import { useSourceStore } from '@/stores/source'

const props = defineProps<{ templateDefaults?: boolean }>()
const flow = useFlowStore()
const { tables, params, ensureTableFields } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)
// 沿用原参数 Tab 的适用范围；规则式、PDF 等节点的出入参继续在表配置中处理。
const showParameterFields = computed(() => !!cfg.value && !isRuleLikeNode(cfg.value) && !isPdfNode(cfg.value))

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
  const selected = inputFieldSelection(cfg.value, inputTableFields.value).selected
  return inputTableFields.value.filter((field) => selected.includes(field.prop))
})

// ---- 任务 URL 来源字段 / 规则表达式（2026-11-05 从节点配置 Tab 搬回任务配置 Tab）----
// 0804 当时删的是 urlSourceField / urlRule，那两个字段从没对上过后端；真值在步骤的 itemId / url 上，
// 而且有 `K2+'#need_upload_xq/xq/'` 这种拼标记给采集端用的写法，不只是带参数。
// 适用范围见 stepPersist 的 taskUrlFieldsApply（2026-10-21 对齐旧平台：采集类后续步含 PDF；首节点、规则类不显示）。
// 两项都落在步骤上，随画布自动保存。来源字段旧平台必填，新平台 10-21 定先不强制：没选只提示、照常保存。
const sourceStore = useSourceStore()
const taskUrlScope = computed<TaskUrlScope>(() => ({ main: flow.main, branches: flow.branches, configs: flow.configs, branchGroups: flow.branchGroups }))
const taskUrlInputTable = computed(() => (id.value ? flow.effectiveInputTableFor(id.value) : ''))
const showTaskUrl = computed(() => !!id.value && taskUrlFieldsApply(taskUrlScope.value, id.value, sourceStore.stepSnapshots[id.value]))
const taskUrlSourceUnset = computed(() => !!id.value && taskUrlSourceMissing(taskUrlScope.value, id.value, sourceStore.stepSnapshots[id.value]))
// 跟「运行设置」一样默认收起（用户 10-21），切节点回到收起
const taskUrlOpen = ref(false)
watch(id, () => { taskUrlOpen.value = false })
watch(() => (showTaskUrl.value ? taskUrlInputTable.value : ''), (tableId) => { if (tableId) ensureTableFields(tableId) }, { immediate: true })
const taskUrlFieldOptions = computed(() => (tables.value.find((t) => t.tableId === taskUrlInputTable.value)?.fields ?? [])
  .filter((f) => !!f.itemId)
  .map((f) => ({ value: String(f.itemId), label: `${f.desc || f.prop}${f.columnName ? `（${f.columnName}）` : ''}` })))
/** -1 是旧平台「未选」的占位 */
const taskUrlSourceValue = computed(() => (cfg.value?.itemId && cfg.value.itemId !== '-1' ? cfg.value.itemId : ''))
const unknownTaskUrlSource = computed(() => (taskUrlSourceValue.value && !taskUrlFieldOptions.value.some((o) => o.value === taskUrlSourceValue.value)
  ? taskUrlSourceValue.value : ''))
function onTaskUrlSource(e: Event) {
  flow.setTaskUrlSourceField(id.value, (e.target as HTMLSelectElement).value)
}
function onStepUrl(e: Event) {
  flow.setStepUrl(id.value, (e.target as HTMLInputElement).value)
}
// 任务配置独立于已退役的配置功能；队列未填时按当前源自动生成。
const ownTaskQueue = computed(() => (cfg.value ? nodeTaskQueue(cfg.value) : ''))
const taskQueueFallback = computed(() => {
  const sc = flow.sourceCfg
  return sc?.sourceId ? `${sc.sourceId}_main` : ''
})
function onTaskQueueChange(e: Event) {
  flow.setTaskQueue(id.value, (e.target as HTMLInputElement).value)
}
// 参数绑定与取值映射现在在同一个任务配置 Tab 内。
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
  <!-- 任务 URL（2026-11-05 从节点配置搬回任务配置；10-19 恢复、10-21 对齐旧平台）：采集类后续步含 PDF -->
  <div v-if="showTaskUrl" class="tu-wrap">
    <button class="tu-toggle" type="button" data-testid="task-url-toggle" @click="taskUrlOpen = !taskUrlOpen">
      {{ taskUrlOpen ? '▾' : '▸' }} 任务 URL（来源字段 / 表达式）<span v-if="taskUrlSourceUnset" class="task-url-unset">· 来源字段未选</span>
    </button>
    <div v-if="taskUrlOpen" class="tu-body">
      <div class="rc-field"><label>任务 URL 来源字段（来自输入表）</label>
        <select class="rc-select" :value="taskUrlSourceValue" data-testid="task-url-source" aria-label="任务 URL 来源字段" @change="onTaskUrlSource">
          <option value="">未选择</option>
          <option v-for="opt in taskUrlFieldOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          <option v-if="unknownTaskUrlSource" :value="unknownTaskUrlSource">#{{ unknownTaskUrlSource }}（输入表里没找到这个字段）</option>
        </select>
        <div v-if="taskUrlSourceUnset" class="rc-help task-url-unset" data-testid="task-url-source-unset">未选来源字段：$VAL$ 取不到值，下游任务可能没有 URL</div>
      </div>
      <div class="rc-field"><label>任务 URL 规则表达式</label>
        <input
          class="rc-input"
          :value="cfg?.stepUrl || '$VAL$'"
          placeholder="例如：$VAL$ 或 K2+'#need_upload_xq/xq/'"
          aria-label="任务 URL 规则表达式"
          data-testid="task-url-expr"
          @change="onStepUrl"
        />
        <div class="rc-help">默认 $VAL$ 从来源字段取值，支持系统动态函数与字符串拼接；留空保存为 $VAL$。</div>
      </div>
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
  <section v-if="showParameterFields" class="tt-params" aria-label="任务参数配置">
    <h3>参数配置</h3>
    <ParamsTab :template-defaults="props.templateDefaults" />
  </section>
  <div class="rc-field">
    <label>任务参数取值</label>
    <div v-if="!hasEffectiveInput" class="rc-readonly-hint">暂无有效输入表，当前参数取值为空。</div>
    <div v-else-if="availableTaskParamRefs.length" class="ni-task-param-list">
      <div v-for="item in taskParamValues" :key="item.paramId" class="ni-task-param-row">
        <b>{{ taskParamLabel(item.paramId) }}</b>
        <select class="rc-select" :value="item.fieldId" @change="onTaskParamValueChange(item.paramId, 'fieldId', $event)">
          <option value="">取值字段（输入表）</option>
          <option v-if="item.fieldId && !selectedInputFields.some((field) => field.prop === item.fieldId)" :value="item.fieldId">{{ item.fieldId }}（未加入输入或字段已失效）</option>
          <option v-for="f in selectedInputFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
        </select>
        <input class="rc-input" :value="item.valueExpr" placeholder="值函数（可选，如 trim($VAL$)）" @input="onTaskParamValueChange(item.paramId, 'valueExpr', $event)" />
      </div>
    </div>
    <div v-else class="rc-readonly-hint">请先在上方绑定参数。</div>
  </div>

</template>

<style scoped>
.tt-params { margin: 14px 0; padding: 12px 0; border-top: 1px solid var(--rc-border-soft); border-bottom: 1px solid var(--rc-border-soft); }
.tt-params h3 { margin: 0 0 10px; color: var(--rc-text-2); font-size: 12px; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
/* 任务 URL 折叠（2026-11-05 从节点配置搬回）：与 CollectorSettings 的「运行设置」同款 */
.task-url-unset { color: var(--rc-warn); }
.tu-wrap { margin-top: 4px; margin-bottom: 10px; }
.tu-toggle { display: block; border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 0; }
.tu-toggle:hover { color: var(--rc-primary-ink); }
.tu-body { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--rc-border-soft); }
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
