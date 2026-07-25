<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../../stores/flow'
import { useUiStore } from '../../../stores/ui'
import {
  WEB_KIND_OPTIONS, decisionOrParallelKind, fieldOptionsFromTableOrOutput, nodeEntryCondition, nodeTaskQueue,
  makeDefaultRuleOrchestration, collectorCapabilityOf,
  type CollectConfig, type ConditionGroup, type NodeConfig, type TaskParamValue, type TripleField, type WebKind,
} from '@/views/FlowCanvas/canvas/flowModel'
import ConditionRow from './ConditionRow.vue'
import BranchEditor from './BranchEditor.vue'
import CollectorSettings, { type CollectorRuntimeSettings } from './CollectorSettings.vue'
import UrlParamEditor from './UrlParamEditor.vue'
import ParamSourceEditor, { type ParamSourceModel } from '@/views/FlowCanvas/ParamSourceEditor.vue'
import EditParamSourceDialog from '@/views/FlowCanvas/EditParamSourceDialog.vue'
import { nodeInspectorTabs } from './nodeInspectorTabs'
import {
  entryApi, paramApi, ruleApi,
  type EntryType, type Param, type RuleGroup, type Rule, type SharedConfig,
  type RuleOrchestration, type RuleOrchestrationItem, type RuleOrchestrationTestResult,
} from '../../../api'
import TableEditDialog from './TableEditDialog.vue'
import NodeAiChat from './NodeAiChat.vue'

const flow = useFlowStore()
const ui = useUiStore()
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const tab = computed<string>(() => flow.activeTab)
const cc = computed<CollectConfig | undefined>(() => cfg.value?.collectCfg)

const statusText = computed(() => (cfg.value?.disabled ? '已停止' : (cfg.value?.status ?? '')))
const statusClass = computed(() => (cfg.value?.disabled || cfg.value?.planned ? 'warn' : 'ok'))

// 顶层 Tab：普通节点在表配置与任务配置间独立展示参数配置；
// 决策/分头节点不产表也不需要任务/AI 编排，只显示「分支配置」一个 Tab 承载 BranchEditor。
const isDecisionOrParallel = computed(() => !!cfg.value && decisionOrParallelKind(cfg.value) !== undefined)
const TOP_TABS = computed(() => nodeInspectorTabs(cfg.value))

// 资产联动数据
const tables = ref<EntryType[]>([])
const params = ref<Param[]>([])
const ruleGroups = ref<RuleGroup[]>([])
const rules = ref<Rule[]>([])
const sharedCfgs = ref<SharedConfig[]>([])
const ruleOrchestrations = ref<RuleOrchestrationItem[]>([])
const isRule = computed(() => /规则/.test(cfg.value?.title ?? ''))

// 规则相关数据只在真的选中过规则节点时才拉，拉过一次后缓存，切别的规则节点不重复拉。
// NodeInspector 只 mount 一次（index.vue 里没给 :key），isRule 会随选中节点变化，
// 不能只在 onMounted 判断一次——否则打开画布时没恰好选中规则节点，规则数据就永远加载不出来。
const rulesLoaded = ref(false)
function loadRuleAssets() {
  if (rulesLoaded.value) return
  rulesLoaded.value = true
  void Promise.allSettled([
    ruleApi.ruleGroups().then(r => ruleGroups.value = r),
    ruleApi.rulePaged({ size: 100 }).then(r => rules.value = r.list),
    ruleApi.sharedConfigs().then(r => sharedCfgs.value = r),
    ruleApi.orchestrationPaged({ size: 100 }).then(r => ruleOrchestrations.value = r.list),
  ])
}
watch(isRule, (v) => { if (v) loadRuleAssets() })

onMounted(async () => {
  if (isRule.value) loadRuleAssets()
  await Promise.allSettled([
    entryApi.entryPaged({ size: 100 }).then(r => tables.value = r.list),
    paramApi.paramPaged({ size: 100 }).then(r => params.value = r.list),
  ])
})

// 采集节点运行设置（0711 R5）：代理/断点续爬/登录迁到节点级；缺省读一次 Source 同名旧字段兜底展示（1:1+fallback）
const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))
const runtimeSettings = computed<CollectorRuntimeSettings>(() => {
  const s = flow.sourceCfg
  return {
    useProxy: cc.value?.useProxy ?? s?.useProxy,
    resume: cc.value?.resume ?? s?.resume,
    needLogin: cc.value?.needLogin ?? s?.needLogin,
    loginUrl: cc.value?.loginUrl ?? s?.loginUrl,
    account: cc.value?.account ?? s?.account,
    credentialRef: cc.value?.credentialRef ?? s?.credentialRef,
    scheduleType: cc.value?.scheduleType ?? s?.scheduleType,
    scheduleTime: cc.value?.scheduleTime ?? s?.scheduleTime,
    weekdays: cc.value?.weekdays ?? s?.weekdays,
    cron: cc.value?.cron ?? s?.cron,
  }
})
function onRuntimeSettingsChange(patch: Partial<CollectorRuntimeSettings>) {
  flow.patchCollect(id.value, patch)
}
// URL 参数：节点绑定关系与子源级取值覆盖分开保存。
function onUrlParamRefsChange(refs: string[]) {
  flow.patchCollect(id.value, { urlParamRefs: refs })
}
function onUrlParamValuesChange(values: Record<string, string>) {
  flow.patchCollect(id.value, { urlParamValues: values })
}
// 参数源（0721 会议 T5）：源本身就是"多值组合展开成 N 个 URL"的语义，节点级「当前子源取值」单值下拉
// 跟这个语义冲突（选一个值没有意义），改成只读摘要（复用加源那套 ParamSourceEditor，readonly 态）
// + 编辑入口，真正编辑在源级弹窗里改，避免源级配置分散到节点上两处维护。
const isParamSource = computed(() => flow.sourceCfg?.kind === 'param')
const paramSourceModel = computed<ParamSourceModel>(() => ({
  baseUrl: flow.sourceCfg?.baseUrl ?? '',
  urlTemplate: flow.sourceCfg?.urlTemplate ?? '',
  refs: flow.sourceCfg?.paramRefs ?? [],
}))
const editParamSourceOpen = ref(false)

// 当前节点输出表（统一口径：采集类取 collectCfg.outputTable，非采集类取 cfg.outputTable）
const nodeTableId = computed(() => cc.value?.outputTable || cfg.value?.outputTable || '')
function onOutputTableChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (cc.value) flow.patchCollect(id.value, { outputTable: v })
  else flow.setOutputTable(id.value, v)
}

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
const isFirstCollectorNode = computed(() => !!cc.value && flow.main.find((nodeId: string) => !!flow.configs[nodeId]?.collectCfg) === id.value)

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

// 输入表 schema 字段清单：字段下拉取有效输入表（自动继承或显式覆盖）的 schema；
// 首节点没有输入表，改取本节点输出表——首节点输出表即下一节点的输入表，效果等价于在下一节点设同样条件。
// 若继承的是上游子步骤临时表，实体表清单可能查不到 schema，此时回退到上游节点 output 产物字段。
// 该清单复用于「进入条件」与「任务 URL 来源字段」的字段下拉。
const inputTableFields = computed(() => {
  const tid = isFirstDataNode.value ? nodeTableId.value : (ownInputTable.value || effectiveInputTableId.value)
  return fieldOptionsFromTableOrOutput(tid, tables.value, isFirstDataNode.value ? cfg.value?.output : prevNode.value?.output)
})
const outputTableFields = computed(() =>
  fieldOptionsFromTableOrOutput(nodeTableId.value, tables.value, cfg.value?.output),
)
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

// ---- 输入映射「来源」下拉建议（Phase 3.1）：取主链路上一个节点的产物字段 ----
const inmapSourceOptions = computed(() => {
  const p = prevNode.value
  if (!p) return []
  return p.output.map((row) => `← ${p.title}.${row.name}`)
})
function onTripleCell(field: TripleField, i: number, col: 0 | 1 | 2, e: Event) {
  flow.setTripleCell(id.value, field, i, col, (e.target as HTMLInputElement).value)
}

// ---- 规则处理节点：规则引擎编排面板（0707 Phase 9）----
const rulePromptOpen = ref(false)
const ruleGenerating = ref(false)
const ruleTesting = ref(false)
const ruleSaving = ref(false)
const ruleTestContent = ref('某地产公司发布重大事项公告')
const ruleTestResult = ref<RuleOrchestrationTestResult | null>(null)
const ruleCfg = computed<RuleOrchestration>(() => ({ ...makeDefaultRuleOrchestration(), ...cfg.value?.ruleCfg }))
const ruleTestResultText = computed(() =>
  ruleTestResult.value ? JSON.stringify(ruleTestResult.value.result ?? { error: ruleTestResult.value.error }, null, 2) : '',
)
function patchRuleCfg(patch: Partial<RuleOrchestration>) {
  flow.patchRuleConfig(id.value, patch)
  ruleTestResult.value = null
}
function onRuleModeChange(mode: RuleOrchestration['mode']) {
  patchRuleCfg({ mode })
}
function onRuleRefChange(e: Event) {
  const ruleId = (e.target as HTMLSelectElement).value
  const item = ruleOrchestrations.value.find((r) => r.ruleId === ruleId)
  if (!item) return
  patchRuleCfg({
    mode: 'ref',
    ruleId: item.ruleId,
    name: item.name,
    describe: item.describe,
    script: item.script,
    scriptPath: item.scriptPath,
    enabled: item.enabled,
  })
}
function onRuleDescribeChange(e: Event) {
  patchRuleCfg({ describe: (e.target as HTMLTextAreaElement).value })
}
function onRulePromptChange(e: Event) {
  patchRuleCfg({ systemPrompt: (e.target as HTMLTextAreaElement).value })
}
function onRuleTestContentChange(e: Event) {
  ruleTestContent.value = (e.target as HTMLTextAreaElement).value
}
async function onGenerateRuleScript() {
  if (!ruleCfg.value.describe.trim()) {
    ElMessage.warning('请先填写规则需求描述')
    return
  }
  ruleGenerating.value = true
  try {
    const res = await ruleApi.orchestrationGenerate(ruleCfg.value.describe, ruleCfg.value.systemPrompt)
    patchRuleCfg({ mode: 'new', script: res.script, scriptPath: res.scriptPath })
    ElMessage.success('脚本已生成')
  } finally {
    ruleGenerating.value = false
  }
}
async function onTestRuleScript() {
  if (!ruleCfg.value.script?.trim()) {
    ElMessage.warning('请先生成或选择脚本')
    return
  }
  ruleTesting.value = true
  try {
    const res = await ruleApi.orchestrationTest(ruleCfg.value.script, { content: ruleTestContent.value })
    ruleTestResult.value = res
    if (res.success) ElMessage.success('测试通过')
    else ElMessage.warning(res.error || '测试未通过')
  } finally {
    ruleTesting.value = false
  }
}
async function onSaveRuleScript() {
  if (!ruleCfg.value.script?.trim()) {
    ElMessage.warning('请先生成或选择脚本')
    return
  }
  try {
    await ElMessageBox.confirm('保存后将把当前规则编排绑定到该规则处理节点，是否继续？', '保存规则脚本', {
      type: 'warning',
      confirmButtonText: '确认保存',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  ruleSaving.value = true
  try {
    const res = await ruleApi.orchestrationSave(ruleCfg.value)
    patchRuleCfg({ mode: 'ref', ruleId: res.ruleId, scriptPath: res.scriptPath })
    ruleOrchestrations.value = (await ruleApi.orchestrationPaged({ size: 100 })).list
    ElMessage.success(res.message || '规则脚本已保存')
  } finally {
    ruleSaving.value = false
  }
}

// ---- 数据表编辑弹窗（T2）----
const tableDlg = reactive<{ open: boolean; tableId: string }>({ open: false, tableId: '' })
function openNewTable() {
  tableDlg.tableId = ''
  tableDlg.open = true
}
function openEditTable() {
  if (!nodeTableId.value) {
    ElMessage.info('请先选择一个输出表，或点「＋」新建')
    return
  }
  tableDlg.tableId = nodeTableId.value
  tableDlg.open = true
}
async function onTableSaved(tableId: string) {
  tables.value = (await entryApi.entryPaged({ size: 100 })).list
  if (id.value) {
    if (cc.value) flow.patchCollect(id.value, { outputTable: tableId })
    else flow.setOutputTable(id.value, tableId)
  }
}

function onTitle(e: Event) {
  flow.setTitle(id.value, (e.target as HTMLInputElement).value)
}
function setCC(key: string, e: Event) {
  const t = e.target as HTMLInputElement
  const val: string | boolean = t.type === 'checkbox' ? t.checked : t.value
  flow.patchCollect(id.value, { [key]: val } as Partial<CollectConfig>)
}
const isAppCollect = computed(() => Boolean(cc.value && /APP/.test(`${cfg.value?.title ?? ''}${cfg.value?.sub ?? ''}${cc.value.snatchType}`)))
const appPackageRowIndex = computed(() => cfg.value?.base.findIndex((row: [string, string]) => row[0] === '包名') ?? -1)
const appPackageName = computed(() => {
  const row = cfg.value?.base[appPackageRowIndex.value]
  return row?.[1] ?? ''
})
const collectUrlLabel = computed(() => (isAppCollect.value ? '接口地址' : '源 URL'))
const collectUrlPlaceholder = computed(() => (isAppCollect.value ? '如 https://m.example.com/api/list?page=${page}' : '如 https://example.com/list?page=${page}'))
function onAppPackageChange(e: Event) {
  if (appPackageRowIndex.value < 0) return
  flow.setBaseRow(id.value, appPackageRowIndex.value, (e.target as HTMLInputElement).value)
}
function onWebKind(e: Event) {
  flow.patchCollect(id.value, { webKind: (e.target as HTMLSelectElement).value as WebKind })
}
</script>

<template>
  <div class="rc-inspector">
    <template v-if="cfg">
    <div class="rc-insp-head">
      <div>
        <div class="rc-insp-title">{{ cfg.title }}</div>
        <div class="rc-insp-sub">{{ cfg.sub }}</div>
      </div>
      <div class="rc-insp-head-right">
        <button
          class="rc-insp-expand"
          type="button"
          :title="ui.inspectorExpanded ? '还原配置区宽度' : '展开配置区，便于编辑表配置'"
          @click="ui.toggleInspectorExpanded()"
        >{{ ui.inspectorExpanded ? '⊟ 还原' : '⛶ 展开' }}</button>
        <!-- 节点启停开关（0710 会议 D5）：停用=数据流经此节点时跳过不处理；逐节点验证通过后全开再定时跑 -->
        <label class="ni-enable-switch" :title="cfg.disabled ? '节点已停用：数据在此节点不处理，点击启用' : '节点运行中：点击停用（数据将跳过此节点）'">
          <input type="checkbox" :checked="!cfg.disabled" @change="flow.setNodeDisabled(id, !($event.target as HTMLInputElement).checked)" />
          <span>{{ cfg.disabled ? '已停用' : '启用中' }}</span>
        </label>
        <span class="rc-status" :class="statusClass">{{ statusText }}</span>
      </div>
    </div>

    <!-- 顶层 Tab：节点配置 / 表配置 / 参数配置 / 任务配置 / AI 对话；保持在视口里不被滚动条挤出 -->
    <div class="rc-top-tabs">
      <button
        v-for="t in TOP_TABS"
        :key="t[0]"
        type="button"
        class="rc-top-tab"
        :class="{ active: tab === t[0] }"
        @click="flow.setActiveTab(t[0])"
      >{{ t[1] }}</button>
    </div>

    <div class="rc-inspector-body">
      <template v-if="tab === 'ai'">
        <NodeAiChat :key="id" />
      </template>

      <!-- 任务配置：首节点只维护队列；后续节点从输入表取任务参数/上下文，并声明出参列。 -->
      <template v-else-if="tab === 'task'">
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
            <select class="rc-select" :value="cfg.taskCfg?.urlSourceField ?? ''" @change="onTaskUrlSourceFieldChange">
              <option value="">选择字段（上一步属性）</option>
              <option v-for="f in inputTableFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
            </select>
          </div>
          <div class="rc-field"><label>任务 URL 规则</label>
            <input class="rc-input" :value="cfg.taskCfg?.urlRule ?? ''" placeholder="如 $VAL$（默认从来源字段取值，支持动态函数）" @input="onTaskUrlRuleChange" />
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

      <template v-else-if="tab === 'table'">
        <!-- 表配置：保留输出表管理入口，表结构通过「查看/编辑表」查看维护 -->
        <div class="rc-field"><label>输出表{{ nodeCapability?.outputMode === 'fixed' ? `（固定 · ${nodeCapability.label}，不可更改）` : (cc ? '' : '（本节点处理结果落此表，默认继承上游节点；结果视图可查数据）') }}</label>
          <div class="rc-input-group">
            <select class="rc-select grow" :value="nodeTableId" :disabled="nodeCapability?.outputMode === 'fixed'" @change="onOutputTableChange">
              <option v-if="!cc" value="" disabled>请选择输出表</option>
              <!-- 源步骤回填的表可能不在实体表清单里，补一个当前值选项避免下拉显示为空 -->
              <option v-if="nodeTableId && !tables.some((t) => t.tableId === nodeTableId)" :value="nodeTableId">{{ nodeTableId }}（来自源步骤）</option>
              <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
            </select>
            <button class="rc-input-btn" type="button" @click="openEditTable">查看/编辑表</button>
            <button class="rc-input-btn" type="button" @click="openNewTable">新建表</button>
          </div>
        </div>
        <!-- 非采集类的产物明细表（采集类的产物即上方所选输出表，不重复维护一份 output 三元表） -->
        <template v-if="!cc">
          <table class="rc-mini-table rc-edit-table">
            <thead><tr><th>产物</th><th>类型</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in cfg.output" :key="i">
                <td><input class="rc-cell-input" :value="row.name" @input="onTripleCell('output', i, 0, $event)" /></td>
                <td><input class="rc-cell-input" :value="row.type" @input="onTripleCell('output', i, 1, $event)" /></td>
                <td><input class="rc-cell-input" :value="row.desc" @input="onTripleCell('output', i, 2, $event)" /></td>
                <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'output', i)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'output')">+ 添加行</button>
          <div class="rc-help">输出进入实体表/原始文件/规则 Trace/邮件审计，经 run_id 供 Skill Run 追溯。</div>
        </template>

      </template>

      <!-- 参数配置独立于节点与任务配置：绑定全局参数，URL token 只标识参数插入位置。 -->
      <template v-else-if="tab === 'params'">
        <template v-if="cc && nodeCapability?.supportsUrlParams">
          <template v-if="isParamSource && isFirstCollectorNode">
            <ParamSourceEditor :model-value="paramSourceModel" readonly />
            <button class="rc-btn" type="button" style="margin-top: 8px" @click="editParamSourceOpen = true">编辑参数子源</button>
          </template>
          <template v-else>
            <!-- 参数子源的 urlTemplate 只灌给主链首个采集节点（applyParamSourceUrlToFirstCollectNode），
                 其余节点该走各自的 UrlParamEditor；这里提示一下避免用户以为参数子源摘要该出现在这。 -->
            <div v-if="isParamSource" class="rc-readonly-hint" style="margin-bottom: 8px">
              本源为参数子源，URL 模板在首个采集节点生效；本节点的 URL 参数按下方单独配置。
            </div>
            <UrlParamEditor
              :url="cc.url"
              :param-refs="cc.urlParamRefs ?? []"
              :param-values="cc.urlParamValues ?? {}"
              :warn-fragment="nodeCapability?.kind === 'web'"
              @update:param-refs="onUrlParamRefsChange"
              @update:param-values="onUrlParamValuesChange"
            />
          </template>
        </template>
        <div v-else class="rc-readonly-hint">当前节点不支持 URL 参数配置。</div>
      </template>

      <!-- 节点配置：单屏纵向分组，无步进器 / 无子 Tab（0706 调整4）；
           决策/分头节点直接交给 BranchEditor 接管（0707 优化·Phase6） -->
      <template v-else>
        <BranchEditor v-if="isDecisionOrParallel && id" :owner-id="id" :key="id" />
        <template v-else>
        <div class="rc-field"><label>节点名称</label><input class="rc-input" :value="cfg.title" @input="onTitle" /></div>

        <!-- 采集类专属：源 URL / 网页类型（详情状态由网页类型自动推导） -->
        <template v-if="cc">
          <div v-if="isAppCollect" class="rc-field"><label>APP 包名</label>
            <input class="rc-input" :value="appPackageName" placeholder="如 com.example.app" @input="onAppPackageChange" />
          </div>
          <div class="rc-field"><label>{{ collectUrlLabel }}</label>
            <div class="rc-input-group">
              <input class="rc-input" :value="cc.url" :placeholder="collectUrlPlaceholder" @input="setCC('url', $event)" />
              <button class="rc-input-action" type="button" title="复制" @click="ElMessage.info('复制链接（演示）')">复制</button>
              <button class="rc-input-action" type="button" title="打开" @click="ElMessage.info('打开链接（演示）')">↗</button>
            </div>
          </div>
          <div v-if="!isAppCollect" class="rc-field"><label>网页类型</label>
            <select class="rc-select" :value="cc.webKind" @change="onWebKind">
              <option v-for="kind in WEB_KIND_OPTIONS" :key="kind.value" :value="kind.value">
                {{ kind.label }} · {{ kind.desc }}
              </option>
            </select>
          </div>
          <!-- 运行设置（0711 R5）：代理/断点续爬/登录，节点级配置、默认折叠 -->
          <CollectorSettings :model-value="runtimeSettings" :capability="nodeCapability" :show-schedule="isFirstCollectorNode" @update:model-value="onRuntimeSettingsChange" />
        </template>

        <!-- 输入映射：只保留给处理/规则/AI 等非采集节点，采集节点避免与源配置和表配置重复 -->
        <template v-if="!cc">
          <div class="ni-section-title">输入映射</div>
          <table class="rc-mini-table rc-edit-table">
            <thead><tr><th>目标入参</th><th>来源</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in cfg.inmap" :key="i">
                <td><input class="rc-cell-input" :value="row.name" @input="onTripleCell('inmap', i, 0, $event)" /></td>
                <td><input class="rc-cell-input" list="ni-inmap-src" :value="row.from" @input="onTripleCell('inmap', i, 1, $event)" /></td>
                <td><input class="rc-cell-input" :value="row.desc" @input="onTripleCell('inmap', i, 2, $event)" /></td>
                <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'inmap', i)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <datalist id="ni-inmap-src">
            <option v-for="opt in inmapSourceOptions" :key="opt" :value="opt" />
          </datalist>
          <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'inmap')">+ 添加行</button>
          <div class="rc-help">把上游节点输出字段映射到本节点入参（对应采集平台"上一步属性"、AI 提取"输出映射"）。← 表示取自上游；"来源"输入框下拉建议取自上一节点的产物字段。</div>
        </template>

        <template v-if="!cc && isRule">
          <div class="ni-section-title">规则编排</div>
          <div class="rc-field"><label>规则来源</label>
            <div class="rc-segment">
              <button type="button" :class="{ active: ruleCfg.mode === 'ref' }" @click="onRuleModeChange('ref')">引用已有规则</button>
              <button type="button" :class="{ active: ruleCfg.mode === 'new' }" @click="onRuleModeChange('new')">新建编排</button>
            </div>
          </div>

          <div v-if="ruleCfg.mode === 'ref'" class="rc-field"><label>已有规则编排</label>
            <select class="rc-select" :value="ruleCfg.ruleId ?? ''" @change="onRuleRefChange">
              <option value="">选择规则编排</option>
              <option v-for="r in ruleOrchestrations" :key="r.ruleId" :value="r.ruleId">
                {{ r.ruleId }} · {{ r.name }}{{ r.enabled ? '' : '（停用）' }}
              </option>
            </select>
          </div>

          <div class="rc-field"><label>规则需求描述</label>
            <textarea
              class="rc-input rc-textarea"
              :readonly="ruleCfg.mode === 'ref'"
              :value="ruleCfg.describe"
              placeholder="描述规则处理逻辑，如 content 中包含地产二字时，tags 返回房地产"
              @input="onRuleDescribeChange"
            />
          </div>

          <div class="ni-adv">
            <button class="ni-adv-toggle" type="button" @click="rulePromptOpen = !rulePromptOpen">
              {{ rulePromptOpen ? '▾' : '▸' }} 系统提示词
            </button>
            <div v-if="rulePromptOpen" class="ni-adv-body">
              <textarea
                class="rc-input rc-textarea"
                :readonly="ruleCfg.mode === 'ref'"
                :value="ruleCfg.systemPrompt ?? ''"
                @input="onRulePromptChange"
              />
            </div>
          </div>

          <div class="rc-actions-row">
            <button class="rc-btn primary" type="button" :disabled="ruleGenerating || ruleCfg.mode === 'ref'" @click="onGenerateRuleScript">
              {{ ruleGenerating ? '生成中...' : '生成脚本' }}
            </button>
          </div>

          <div class="rc-list ni-rule-meta">
            <div class="rc-list-row"><b>脚本路径</b><span>{{ ruleCfg.scriptPath || '未生成' }}</span></div>
          </div>
          <textarea class="rc-code-box" readonly :value="ruleCfg.script || '生成脚本后展示 Python 预览；引用已有规则时展示已保存脚本。'" />

          <div class="ni-section-title">测试脚本</div>
          <div class="rc-field"><label>测试 content</label>
            <textarea class="rc-input rc-textarea" :value="ruleTestContent" @input="onRuleTestContentChange" />
          </div>
          <div class="rc-actions-row">
            <button class="rc-btn" type="button" :disabled="ruleTesting" @click="onTestRuleScript">
              {{ ruleTesting ? '测试中...' : '测试脚本' }}
            </button>
            <button class="rc-btn primary" type="button" :disabled="ruleSaving" @click="onSaveRuleScript">
              {{ ruleSaving ? '保存中...' : '保存脚本' }}
            </button>
          </div>
          <pre v-if="ruleTestResult" class="ni-json-box">{{ ruleTestResultText }}</pre>
        </template>

        <!-- 非采集类专属：原「基础/输入映射/参数/试跑」四子页，合并为单屏纵向分组（0706 调整4） -->
        <template v-if="!cc && !isRule">
          <div v-if="cfg.planned" class="rc-drawer show">规划中节点：OCR / AI 提取 / 发邮件仍待执行器确认。配置可先草拟，发起抓取与上线需等待能力就绪。</div>

          <div v-for="(row, i) in cfg.base" :key="row[0]" class="rc-field">
            <label>{{ row[0] }}</label>
            <input class="rc-input" :value="row[1]" @input="flow.setBaseRow(id, i, ($event.target as HTMLInputElement).value)" />
          </div>
          <div v-for="(row, i) in cfg.fields" :key="row[0]" class="rc-field">
            <label>{{ row[0] }}</label>
            <input class="rc-input" :value="row[1]" @input="flow.setFieldRow(id, i, ($event.target as HTMLInputElement).value)" />
          </div>
          <div class="rc-help">字段随节点类型变化：网页抓取呈现源/配置/子步骤；规则处理呈现规则组/表达式/共享配置。</div>
          <div class="rc-actions-row"><button class="rc-btn" type="button" @click="flow.duplicate(id)">复制节点</button></div>

          <div class="ni-section-title">参数</div>
          <table class="rc-mini-table rc-edit-table">
            <thead><tr><th>字段/参数</th><th>类型</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in cfg.params" :key="i">
                <td><input class="rc-cell-input" :value="row.name" @input="onTripleCell('params', i, 0, $event)" /></td>
                <td><input class="rc-cell-input" :value="row.type" @input="onTripleCell('params', i, 1, $event)" /></td>
                <td><input class="rc-cell-input" :value="row.desc" @input="onTripleCell('params', i, 2, $event)" /></td>
                <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'params', i)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'params')">+ 添加行</button>
          <div class="rc-help">参数来自采集平台列表、日期或序列；发任务时弹出填写，并进入运行记录供审计与重跑。</div>

          <div class="ni-section-title">发起抓取信息</div>
          <div class="rc-list">
            <div class="rc-list-row"><b>发起抓取输入</b><span>使用最近 10 条样本</span></div>
            <div class="rc-list-row"><b>执行器</b><span>{{ cfg.planned ? '待执行器确认' : '采集平台青龙 + 规则引擎' }}</span></div>
            <div class="rc-list-row"><b>执行方式</b><span>异步：发任务 → 轮询 L/C/E</span></div>
            <div class="rc-list-row"><b>最近结果</b><span>成功 8 / 失败 1 / 待复核 1</span></div>
          </div>
          <div class="rc-actions-row"><button class="rc-btn" type="button" @click="ElMessage.info('查看日志（演示占位）')">查看日志</button></div>
        </template>
        </template>
      </template>

      <!-- 常驻操作栏已整体移除（0710 会议 C3+D3）：保存收敛到顶部唯一入口；试跑收敛为顶部整链试跑（保存后可用），
           "是否子节点/单节点试跑"这类散落的发起入口按会议结论不再保留 -->
    </div>
    </template>

    <template v-else>
      <div class="rc-insp-head">
        <div>
          <div class="rc-insp-title">未选择节点</div>
          <div class="rc-insp-sub">点击画布节点查看 / 编辑配置</div>
        </div>
      </div>
      <div class="rc-inspector-body">
        <div class="rc-help">当前画布为空或未选择节点。用画布中间的「智能推荐模板」起草链路，或点击连线上的「＋」手工添加步骤。</div>
      </div>
    </template>

    <TableEditDialog v-model:open="tableDlg.open" :table-id="tableDlg.tableId" @saved="onTableSaved" />
    <EditParamSourceDialog v-model="editParamSourceOpen" />
  </div>
</template>

<style scoped>
.rc-inspector { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.rc-insp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.ni-enable-switch { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--rc-text-2); cursor: pointer; white-space: nowrap; }
.ni-enable-switch input { cursor: pointer; }
.rc-insp-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-insp-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.rc-insp-head-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.ni-adv { margin-top: 12px; border-top: 1px dashed var(--rc-border-soft); padding-top: 8px; }
.ni-adv-toggle { border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 0; }
.ni-adv-toggle:hover { color: var(--rc-primary-ink); }
.ni-adv-body { margin-top: 8px; }
.ni-section-title { margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; font-weight: 700; }
.rc-insp-expand { border: 1px solid #d5e2f2; background: #fff; color: var(--rc-text-2); border-radius: 6px; font-size: 11px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.rc-insp-expand:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-inspector-body { padding: 12px; overflow: auto; flex: 1 1 auto; min-height: 0; }

/* 顶层四 Tab（0706 调整4 · 0707 微调：节点配置 / 表配置 / 任务配置 / AI 对话） */
.rc-top-tabs { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--rc-border); border-radius: 9px; background: #f1f5f9; margin-bottom: 12px; }
.rc-top-tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 4px; color: var(--rc-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-top-tab.active { background: #fff; color: var(--rc-primary-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
.rc-top-tab:hover:not(.active) { color: var(--rc-primary-ink); }

.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-textarea { min-height: 74px; resize: vertical; line-height: 1.5; }
.rc-help-inline { margin-top: 5px; color: var(--rc-muted); font-size: 11px; line-height: 1.4; }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-input { border-radius: 7px 0 0 7px; }
.rc-input-group .rc-select.grow { border-radius: 7px 0 0 7px; flex: 1; }
.rc-input-action { min-width: 36px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.rc-input-action:last-child { border-radius: 0 7px 7px 0; }
.rc-input-action:hover { background: var(--rc-primary-bg); }
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:last-child { border-radius: 0 7px 7px 0; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-actions-row { display: flex; gap: 8px; margin-top: 12px; }
.rc-actions-row .rc-btn { height: 32px; padding: 0 11px; font-size: 12px; }
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.ni-task-param-list { display: grid; gap: 8px; }
.ni-task-param-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 8px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; }
.ni-task-param-row b { color: var(--rc-text-2); font-size: 12px; }
.ni-task-field-list { display: grid; gap: 6px; margin-bottom: 6px; }
.ni-task-field-row { display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; gap: 6px; }

.rc-checks { display: flex; gap: 16px; padding: 4px 0; }
.rc-check { display: inline-flex; align-items: center; gap: 6px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }

.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }

.rc-file-upload { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding: 8px 9px; border: 1px dashed #cbd5e1; background: #f8fafc; border-radius: 7px; color: var(--rc-muted); font-size: 11px; }
.rc-file-upload .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }

.rc-dir-picker { border: 1px solid #dbe3ee; border-radius: 8px; overflow: hidden; background: #fff; }
.rc-dir-top { display: flex; align-items: center; gap: 6px; padding: 7px; border-bottom: 1px solid #eef2f7; background: #fbfdff; }
.rc-dir-top .rc-btn { height: 30px; padding: 0 10px; font-size: 12px; flex: none; }
.rc-dir-tree { max-height: 104px; overflow: auto; padding: 6px 8px; color: var(--rc-text-2); font-size: 11px; line-height: 1.9; }
.rc-dir-node.active { color: var(--rc-primary-ink); font-weight: 700; }


.rc-mini-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.rc-mini-table th { text-align: left; color: var(--rc-muted); font-weight: 600; padding: 6px 5px; border-bottom: 1px solid #eef2f7; }
.rc-mini-table td { padding: 7px 5px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text-2); }
.rc-edit-table th:last-child, .rc-edit-table td:last-child { width: 26px; padding: 4px 2px; }
.rc-cell-input { width: 100%; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 11px; padding: 4px 5px; outline: none; }
.rc-cell-input:hover { border-color: #dbe3ee; }
.rc-cell-input:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 2px #dbeafe; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }

.rc-tagchips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.rc-tagchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 7px; border-radius: 6px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-tagchip i { cursor: pointer; font-style: normal; opacity: 0.7; }
.rc-tagchip i:hover { opacity: 1; }

.rc-cred { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; font-size: 12px; color: var(--rc-text-2); }
.rc-cred-empty { color: var(--rc-faint); }

.rc-list { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.rc-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-top: 1px solid #eef2f7; font-size: 11px; color: var(--rc-text-2); }
.rc-list-row:first-child { border-top: 0; }
.rc-list-row b { color: var(--rc-text); font-weight: 600; }
.ni-rule-meta { margin: 10px 0 8px; }
.ni-rule-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-code-box, .ni-json-box { width: 100%; min-height: 112px; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #0f172a; color: #dbeafe; font-size: 11px; line-height: 1.55; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 10px; overflow: auto; resize: vertical; }
.ni-json-box { min-height: 70px; margin-top: 10px; background: #f8fafc; color: var(--rc-text); }

.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-drawer { margin-bottom: 12px; padding: 10px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: #1e40af; border-radius: 8px; font-size: 11px; line-height: 1.55; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
