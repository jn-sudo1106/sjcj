<script setup lang="ts">
// 表配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 0804 S2-2 拍板：规则节点的表/字段绑定从编排配置搬回这里，跟其他节点共用同一个 Tab——
// 规则名称 = 节点名称（不再单独输入）；点「保存并配置编排」校验通过后落业务规则并自动切到编排配置 Tab，
// 与其他节点「选完表字段才能进编排配置」的统一时序对齐（见开发方案 §2.2）。
// 非规则节点内容：输出表管理（采集类固定/可选）+ 非采集类产物明细三元表 + 表结构编辑弹窗；
// 0804 S3-3 追加：非规则节点也需要在「生成配置」前落一条 vrule compose 记录换数字 ruleId
// （isVruleNumericRuleId 约束，见 RuleOrchestrationTab.vue），跟规则节点同一套 orchestrationSaveMeta，
// 只是 targetTable 传空——采集节点没有 vrule 输入表，S3-2 §9.2-2 已实测确认后端接受空 targetTable。
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import {
  collectorCapabilityOf, isRuleNode, makeDefaultRuleOrchestration, makeDefaultExecConfig,
  fieldOptionsFromTableOrOutput,
  type NodeConfig, type TripleField,
} from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, ruleApi, type RuleOrchestration } from '@/api'
import { RULE_DATA_SOURCE } from '@/constants/rule'
import { validateTableBinding } from '@/utils/flow/ruleOrchestration'
import { useRuleTableFields } from '@/composables/useRuleTableFields'
import TableEditDialog from '../TableEditDialog.vue'
import RuleTableFieldBinder from '../RuleTableFieldBinder.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'

const flow = useFlowStore()
const { tables } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)

const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))

// ---- 规则节点：表/字段绑定（0804 拍板：搬回表配置） ----
const ruleCfg = computed<RuleOrchestration>(() => ({
  ...makeDefaultRuleOrchestration(),
  ...cfg.value?.ruleCfg,
  name: cfg.value?.title ?? '',
}))
function patchRule(p: Partial<RuleOrchestration>) {
  flow.patchRuleConfig(id.value, p)
}
const { inputFieldOptions, outputFieldOptions } = useRuleTableFields(ruleCfg)

const savingRule = ref(false)
async function onSaveRuleMeta() {
  const error = !cfg.value?.title?.trim() ? '请先在「节点配置」填写节点名称' : validateTableBinding(ruleCfg.value)
  if (error) {
    ElMessage.warning(error)
    return
  }
  savingRule.value = true
  try {
    const res = await ruleApi.orchestrationSaveMeta(ruleCfg.value)
    patchRule({ mode: 'ref', ruleId: res.ruleId })
    // 表相关字段同步到 NodeConfig（0801 方案 §4.6）：节点侧存 tableId，不是物理表名
    if (ruleCfg.value.inputTableId) flow.setInputTable(id.value, ruleCfg.value.inputTableId)
    if (ruleCfg.value.outputTableId) flow.setOutputTable(id.value, ruleCfg.value.outputTableId)
    ElMessage.success(res.message || '业务规则已保存')
    flow.setActiveTab('orchestration')
  } catch (e) {
    ElMessage.error(`保存业务规则失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    savingRule.value = false
  }
}

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// ---- 非规则节点：统一输入表/输入字段配置（0806） ----
const ownInputTableId = computed(() => cc.value?.inputTable || cfg.value?.inputTable || '')
const effectiveInputTableId = computed(() => (id.value ? flow.effectiveInputTableFor(id.value) : ''))
const inputTableId = computed(() => ownInputTableId.value || effectiveInputTableId.value)
const inputTableLabel = computed(() => effectiveInputTableId.value
  ? `自动 · 继承上游（${effectiveInputTableId.value}）`
  : '自动 · 无上游输入表')
const inputTableFields = computed(() => inputTableId.value
  ? fieldOptionsFromTableOrOutput(inputTableId.value, tables.value, cfg.value?.output)
  : [])
const savedInputFields = computed<string[] | undefined>(() => cfg.value?.inputFields)
const selectedInputFieldProps = computed<string[]>(() => {
  const allProps = inputTableFields.value.map((f) => f.prop)
  return savedInputFields.value === undefined ? allProps : savedInputFields.value
})
function isInputFieldSelected(prop: string): boolean {
  return selectedInputFieldProps.value.includes(prop)
}
function toggleInputField(prop: string) {
  const current = new Set(selectedInputFieldProps.value)
  if (current.has(prop)) current.delete(prop)
  else current.add(prop)
  flow.setInputFields(id.value, [...current])
}
function selectAllInputFields() {
  flow.setInputFields(id.value, inputTableFields.value.map((f) => f.prop))
}
function clearAllInputFields() {
  flow.setInputFields(id.value, [])
}
function onInputTableChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value
  if (cc.value) flow.patchCollect(id.value, { inputTable: value })
  else flow.setInputTable(id.value, value)
  flow.resetInputFields(id.value)
}

// 当前节点输出表（统一口径：采集类取 collectCfg.outputTable，非采集类取 cfg.outputTable）
const nodeTableId = computed(() => cc.value?.outputTable || cfg.value?.outputTable || '')
const currentDedupMode = computed<'source' | 'table'>(() => cc.value?.dedupMode || cfg.value?.dedupMode || 'source')
const DEFAULT_PRESET_TABLES = [
  { name: '资讯列表', tableId: '2103330' },
  { name: '资源表', tableId: '2101001' },
  { name: '评论交互表', tableId: '2102157' },
  { name: '社交舆情表', tableId: '2103300' },
]

// 当前节点输出表的全部候选字段
const outputTableFields = computed(() =>
  fieldOptionsFromTableOrOutput(nodeTableId.value, tables.value, cfg.value?.output),
)

// 存储在节点上的已选字段列表（若未自定义则默认为全部字段）
const savedOutFields = computed<string[] | undefined>(() =>
  cc.value?.outFields ?? cfg.value?.outFields ?? cfg.value?.taskCfg?.outColumns,
)

// 当前实际生效的已选字段 ID 集合（默认包含全部字段）
const selectedFieldProps = computed<string[]>(() => {
  const allProps = outputTableFields.value.map((f) => f.prop)
  if (!savedOutFields.value) return allProps
  return savedOutFields.value
})

function isFieldSelected(prop: string): boolean {
  return selectedFieldProps.value.includes(prop)
}

function updateOutFields(propsList: string[]) {
  flow.setOutFields(id.value, propsList)
}

function toggleOutputField(prop: string) {
  const current = new Set(selectedFieldProps.value)
  if (current.has(prop)) {
    current.delete(prop)
  } else {
    current.add(prop)
  }
  updateOutFields(Array.from(current))
}

function selectAllFields() {
  updateOutFields(outputTableFields.value.map((f) => f.prop))
}

function clearAllFields() {
  updateOutFields([])
}

function selectPresetTable(tableId: string) {
  if (nodeCapability.value?.outputMode === 'fixed') return
  if (cc.value) flow.patchCollect(id.value, { outputTable: tableId })
  else flow.setOutputTable(id.value, tableId)
}

function onOutputTableChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  if (cc.value) flow.patchCollect(id.value, { outputTable: v })
  else flow.setOutputTable(id.value, v)
}
function onDedupModeChange(mode: 'source' | 'table') {
  if (cc.value) flow.patchCollect(id.value, { dedupMode: mode })
  else flow.setDedupMode(id.value, mode)
}

function onTripleCell(field: TripleField, i: number, col: 0 | 1 | 2, e: Event) {
  flow.setTripleCell(id.value, field, i, col, (e.target as HTMLInputElement).value)
}

// 结构化配置（入库配置）/ 正文规则（0804 S3-1）：非规则节点走 store 的双轨 setter（采集类写
// collectCfg，非采集类写 NodeConfig 顶层，两边取哪边由 setStructuredConfig 内部判断，本组件不用分支）。
const structuredConfigValue = computed(() => cc.value?.structuredConfig ?? cfg.value?.structuredConfig ?? '')
const contentRulesValue = computed(() => cc.value?.contentRules ?? cfg.value?.contentRules ?? '')
function onStructuredConfig(e: Event) {
  flow.setStructuredConfig(id.value, (e.target as HTMLTextAreaElement).value)
}
function onContentRules(e: Event) {
  flow.setContentRules(id.value, (e.target as HTMLTextAreaElement).value)
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

// ---- 非规则节点：编排配置准备（0804 S3-3）----
const execCfg = computed<RuleOrchestration>(() => ({
  ...makeDefaultExecConfig(),
  ...cfg.value?.execCfg,
  name: cfg.value?.title ?? '',
}))
function patchExec(p: Partial<RuleOrchestration>) {
  flow.patchExecConfig(id.value, p)
}
const savingExec = ref(false)
async function onSaveExecMeta() {
  if (!cfg.value?.title?.trim()) {
    ElMessage.warning('请先在「节点配置」填写节点名称')
    return
  }
  savingExec.value = true
  try {
    const res = await ruleApi.orchestrationSaveMeta({
      ...execCfg.value,
      dataSource: RULE_DATA_SOURCE,
      inputTable: '',
      outputTable: nodeTableId.value,
    })
    patchExec({ mode: 'ref', ruleId: res.ruleId })
    ElMessage.success(res.message || '编排配置已保存')
    flow.setActiveTab('orchestration')
  } catch (e) {
    ElMessage.error(`保存失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    savingExec.value = false
  }
}
</script>

<template>
  <template v-if="isRule">
    <RuleTableFieldBinder
      :model-value="ruleCfg"
      :input-field-options="inputFieldOptions"
      :output-field-options="outputFieldOptions"
      @update:model-value="patchRule"
    />
    <div class="rc-actions-row">
      <button class="rc-btn primary" type="button" :disabled="savingRule" @click="onSaveRuleMeta">
        {{ savingRule ? '保存中...' : '保存并配置编排' }}
      </button>
    </div>
  </template>

  <template v-else>
    <template v-if="nodeCapability?.kind !== 'login'">
      <div class="rc-field"><label>输入表</label>
        <select class="rc-select" :value="ownInputTableId" @change="onInputTableChange">
          <option value="">{{ inputTableLabel }}</option>
          <option v-if="ownInputTableId && !tables.some((t) => t.tableId === ownInputTableId)" :value="ownInputTableId">{{ ownInputTableId }}（当前配置）</option>
          <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
        </select>
        <div v-if="!effectiveInputTableId" class="rc-help">暂无有效输入表；可显式选择输入表，或先配置上游输出表。</div>
      </div>
      <div v-if="inputTableFields.length" class="rc-field">
        <div class="rc-field-header">
          <label>输入字段选择（已选中 {{ selectedInputFieldProps.length }} / {{ inputTableFields.length }} 个字段，默认包含全部字段）</label>
          <div class="rc-field-actions">
            <button type="button" class="rc-text-btn" data-testid="select-all-input-fields" @click="selectAllInputFields">全选</button>
            <button type="button" class="rc-text-btn" data-testid="clear-all-input-fields" @click="clearAllInputFields">清空</button>
          </div>
        </div>
        <div class="rc-tag-row" data-testid="input-fields-list">
          <span
            v-for="f in inputTableFields"
            :key="f.prop"
            class="rc-tag"
            :class="{ on: isInputFieldSelected(f.prop) }"
            @click="toggleInputField(f.prop)"
          >
            <input type="checkbox" :checked="isInputFieldSelected(f.prop)" class="rc-tag-check" @click.stop="toggleInputField(f.prop)" />
            <span class="rc-tag-text">{{ f.prop }} {{ f.desc ? `· ${f.desc}` : '' }}</span>
          </span>
        </div>
      </div>
    </template>
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
      <div class="rc-preset-tables" data-testid="table-presets">
        <span class="rc-preset-label">常用默认表：</span>
        <button
          v-for="preset in DEFAULT_PRESET_TABLES"
          :key="preset.tableId"
          type="button"
          class="rc-preset-chip"
          :class="{ active: nodeTableId === preset.tableId }"
          :disabled="nodeCapability?.outputMode === 'fixed'"
          @click="selectPresetTable(preset.tableId)"
        >
          {{ preset.name }} ({{ preset.tableId }})
        </button>
      </div>
    </div>
    <div class="rc-field">
      <label>去重方式</label>
      <div class="rc-segment" data-testid="table-dedup-segment">
        <button type="button" :class="{ active: currentDedupMode !== 'table' }" @click="onDedupModeChange('source')">源内去重</button>
        <button type="button" :class="{ active: currentDedupMode === 'table' }" @click="onDedupModeChange('table')">表内去重</button>
      </div>
      <div class="rc-help">源内去重：仅在当前采集源范围内对落库数据去重；表内去重：跨源在整张数据表范围内全局去重。</div>
    </div>
    <!-- 输出字段选择（默认全选） -->
    <div v-if="outputTableFields.length" class="rc-field">
      <div class="rc-field-header">
        <label>输出字段选择（已选中 {{ selectedFieldProps.length }} / {{ outputTableFields.length }} 个字段，默认包含全部字段）</label>
        <div class="rc-field-actions">
          <button type="button" class="rc-text-btn" data-testid="select-all-fields" @click="selectAllFields">全选</button>
          <button type="button" class="rc-text-btn" data-testid="clear-all-fields" @click="clearAllFields">清空</button>
        </div>
      </div>
      <div class="rc-tag-row" data-testid="output-fields-list">
        <span
          v-for="f in outputTableFields"
          :key="f.prop"
          class="rc-tag"
          :class="{ on: isFieldSelected(f.prop) }"
          @click="toggleOutputField(f.prop)"
        >
          <input type="checkbox" :checked="isFieldSelected(f.prop)" class="rc-tag-check" @click.stop="toggleOutputField(f.prop)" />
          <span class="rc-tag-text">{{ f.prop }} {{ f.desc ? `· ${f.desc}` : '' }}</span>
        </span>
      </div>
      <div class="rc-help">勾选落库并保留在输出表中的字段列，未勾选字段落库时忽略；默认选中全部字段。</div>
    </div>
    <!-- 结构化配置（入库配置）+ 正文规则（0804 S3-1）：不透明文本，具体 schema 由执行端解释 -->
    <div class="rc-field"><label>结构化配置（入库配置）</label>
      <textarea class="rc-input" rows="2" placeholder="按输出表字段配置入库规则" :value="structuredConfigValue" @input="onStructuredConfig"></textarea>
    </div>
    <div class="rc-field"><label>正文规则</label>
      <textarea class="rc-input" rows="2" placeholder="按输出字段配置处理规则，一行一条，如 content=trim" :value="contentRulesValue" @input="onContentRules"></textarea>
    </div>
    <!-- 编排配置准备（0804 S3-3）：先落一条 vrule compose 记录换数字 ruleId，才能在「编排配置」生成抓取配置 -->
    <div class="rc-actions-row">
      <button class="rc-btn primary" type="button" :disabled="savingExec" @click="onSaveExecMeta">
        {{ savingExec ? '保存中...' : '保存并配置编排' }}
      </button>
    </div>
    <!-- 非采集类的产物明细表（采集类的产物即上方所选输出表，不重复维护一份 output 三元表） -->
    <template v-if="!cc">
      <table class="rc-mini-table rc-edit-table">
        <thead><tr><th>产物</th><th>类型</th><th>说明</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in cfg?.output ?? []" :key="i">
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

    <TableEditDialog v-model:open="tableDlg.open" :table-id="tableDlg.tableId" @saved="onTableSaved" />
  </template>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; font-family: inherit; resize: vertical; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input[disabled] { background: #f8fafc; color: var(--rc-faint); }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-select.grow { border-radius: 7px 0 0 7px; flex: 1; }
.rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:last-child { border-radius: 0 7px 7px 0; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-mini-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.rc-mini-table th { text-align: left; color: var(--rc-muted); font-weight: 600; padding: 6px 5px; border-bottom: 1px solid #eef2f7; }
.rc-mini-table td { padding: 7px 5px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text-2); }
.rc-edit-table th:last-child, .rc-edit-table td:last-child { width: 26px; padding: 4px 2px; }
.rc-cell-input { width: 100%; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 11px; padding: 4px 5px; outline: none; }
.rc-cell-input:hover { border-color: #dbe3ee; }
.rc-cell-input:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 2px #dbeafe; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.rc-actions-row { display: flex; gap: 8px; margin-top: 12px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; background: transparent; color: var(--rc-text-2); font-size: 11px; padding: 5px 12px; cursor: pointer; }
.rc-segment button.active { background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }

.rc-preset-tables { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.rc-preset-label { font-size: 11px; color: var(--rc-muted); font-weight: 600; }
.rc-preset-chip {
  padding: 3px 8px;
  border: 1px solid #d5e2f2;
  border-radius: 5px;
  background: #f8fafc;
  color: var(--rc-text-2);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  font-family: inherit;
}
.rc-preset-chip:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #eff6ff;
  color: var(--rc-primary-ink);
}
.rc-preset-chip.active {
  border-color: var(--rc-primary);
  background: var(--rc-primary-bg);
  color: var(--rc-primary-ink);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--rc-primary);
}
.rc-preset-chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.rc-field-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.rc-field-header label { margin-bottom: 0; }
.rc-field-actions { display: flex; gap: 8px; }
.rc-text-btn { border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; font-weight: 600; cursor: pointer; padding: 0; }
.rc-text-btn:hover { text-decoration: underline; }
.rc-tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.rc-tag { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border: 1px solid #d5e2f2; border-radius: 6px; background: #f8fafc; color: var(--rc-text-2); font-size: 11px; cursor: pointer; user-select: none; transition: all 0.12s ease; }
.rc-tag:hover { border-color: #93c5fd; background: #eff6ff; }
.rc-tag.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 600; }
.rc-tag-check { margin: 0; cursor: pointer; accent-color: var(--rc-primary); }
</style>
