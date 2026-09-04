<script setup lang="ts">
// 表配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 0804 S2-2 拍板：规则节点的表/字段绑定从编排配置搬回这里，跟其他节点共用同一个 Tab——
// 规则名称 = 节点名称（不再单独输入）；绑完输入/输出表与字段后即可进编排配置 Tab。
// 非规则节点内容：输出表管理（采集类固定/可选）+ 非采集类产物明细三元表 + 表结构编辑弹窗。
// 规则节点表配置的保存按钮已移除（换数字 ruleId 改在编排配置第一次生成脚本时
// 自动 orchestrationSaveMeta），表配置只负责绑表/字段。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import {
  collectorCapabilityOf, isRuleNode, isMonitorNode, makeDefaultRuleOrchestration,
  fieldOptionsFromTableOrOutput, MONITOR_METHODS,
  type NodeConfig, type TripleField,
} from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, type EntryType, type RuleOrchestration } from '@/api'
import { useRuleTableFields } from '@/composables/useRuleTableFields'
import TableEditDialog from '../TableEditDialog.vue'
import RuleTableFieldBinder from '../RuleTableFieldBinder.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import { mergeEntryTypesPreservingFields } from '@/composables/useEntryTableFieldsCache'

const flow = useFlowStore()
const { tables, ensureTableFields } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)

const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))
const isMonitor = computed(() => (cfg.value ? isMonitorNode(cfg.value) : false))

// ---- 数据监控节点：监控方法复选（2026-09-01，monitor 不落表/不出参，只绑输入表 + 选监控方法） ----
const monitorMethods = computed<string[]>(() => cfg.value?.monitorMethods ?? [])
function setMonitorMethods(values: string[]) {
  flow.setMonitorMethods(id.value, values ?? [])
}

// ---- 规则节点：表/字段绑定（0804 拍板：搬回表配置） ----
const ruleCfg = computed<RuleOrchestration>(() => ({
  ...makeDefaultRuleOrchestration(),
  ...cfg.value?.ruleCfg,
  name: cfg.value?.title ?? '',
}))
function patchRule(p: Partial<RuleOrchestration>) {
  flow.patchRuleConfig(id.value, p)
  if (p.inputTableId !== undefined) flow.setInputTable(id.value, p.inputTableId)
  if (p.outputTableId !== undefined) flow.setOutputTable(id.value, p.outputTableId)
}
const { inputFieldOptions, outputFieldOptions } = useRuleTableFields(ruleCfg)

/**
 * 回读时把步骤里的入/出参**还原回勾选状态**（2026-09-04 修）。
 *
 * 写：`mergeStepForWrite` 把 `ruleCfg.inputFields/outputFields`（**itemCode**）换成物理列名
 * 存进步骤的 `context`/`outContext`。读：`applyStepTaskFields` 只把它们放进 `taskCfg.contextMap`
 * / `outColumns`，**没有人再换回 itemCode 填到 ruleCfg** —— 于是刷新后勾选全空。
 *
 * 后果不是"少显示两行勾"，是**规则节点保存不了**：`validateTableBinding` 卡在
 * 「请至少选择 1 个入参字段」，`nodeInspectorTabs` 据此把「编排配置」整个 Tab 置灰。
 * 实测步骤 41672：后端 `context='K1,K2,K3'`、`outContext='K1,K2,K3'` 都在，
 * 前端 `inputFields`/`outputFields` 却都是 `[]`。
 *
 * 字段表是异步拉的，所以放在这里等 options 到位再补，且只在勾选为空时补——不覆盖用户的选择。
 */
function restoreFieldsFromColumns(
  saved: string[] | undefined,
  columns: string[] | undefined,
  options: { itemCode: string; columnName?: string }[],
): string[] | undefined {
  if (saved?.length || !columns?.length || !options.length) return undefined
  const byColumn = new Map(options.filter((f) => f.columnName).map((f) => [f.columnName as string, f.itemCode]))
  // 存进去的可能是列名，也可能是列名解析不到时回退写下的 itemCode（见 ruleStepContext），两种都认
  const known = new Set(options.map((f) => f.itemCode))
  const restored = columns
    .map((col) => byColumn.get(col) ?? (known.has(col) ? col : ''))
    .filter(Boolean)
  return restored.length ? restored : undefined
}
watch(
  [inputFieldOptions, outputFieldOptions, () => cfg.value?.taskCfg?.contextMap, () => cfg.value?.taskCfg?.outColumns],
  ([inOpts, outOpts, contextMap, outColumns]) => {
    if (!isRule.value || !id.value) return
    const patch: Partial<RuleOrchestration> = {}
    const inputFields = restoreFieldsFromColumns(ruleCfg.value.inputFields, contextMap, inOpts)
    if (inputFields) patch.inputFields = inputFields
    if (!isMonitor.value) {
      const outputFields = restoreFieldsFromColumns(ruleCfg.value.outputFields, outColumns, outOpts)
      if (outputFields) patch.outputFields = outputFields
    }
    if (Object.keys(patch).length) patchRule(patch)
  },
  { immediate: true },
)

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// ---- 非规则节点：统一输入表/输入字段配置（0806） ----
const ownInputTableId = computed(() => cc.value?.inputTable || cfg.value?.inputTable || '')
const effectiveInputTableId = computed(() => (id.value ? flow.effectiveInputTableFor(id.value) : ''))
const inputTableId = computed(() => ownInputTableId.value || effectiveInputTableId.value)
const inputTableLabel = computed(() => effectiveInputTableId.value
  ? `自动 · 继承上游（${effectiveInputTableId.value}）`
  : '自动 · 无上游输入表')
watch(inputTableId, (tid) => ensureTableFields(tid), { immediate: true })
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
// 表下拉支持输入搜索（0902）：生产表数量远超一屏，useNodeInspectorAssets 只预加载 100 张，
// 覆盖不了长尾——下拉里翻不到就以为表不存在。跟规则节点的表绑定（RuleTableFieldBinder.vue）
// 同一套做法：el-select filterable remote，按关键字查 entryApi.entryPaged，不再只认预加载列表。
// 没提成共享 composable——那边的 selected 还要带出业务名给 patch() 用，写法已经分叉，
// 强行合并会牵连一个已经跑通的文件，这里保持局部实现，两处独立演化。
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}
function useTableSearch() {
  const results = ref<EntryType[]>([])
  const loading = ref(false)
  let requestSeq = 0
  async function runSearch(keyword: string) {
    const seq = ++requestSeq
    loading.value = true
    try {
      const paged = await entryApi.entryPaged({ name: keyword || undefined, size: 30 })
      if (seq !== requestSeq) return // 有更新的搜索已发出，丢弃这次的结果
      results.value = paged.list
    } catch (e) {
      if (seq !== requestSeq) return
      ElMessage.error(`搜索表失败：${(e as Error)?.message ?? String(e)}`)
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }
  return { results, loading, runSearch, debouncedSearch: debounce(runSearch, 300) }
}
const inputTableSearch = useTableSearch()
const outputTableSearch = useTableSearch()

function tableOptionLabel(t: EntryType): string {
  return `${t.tableId} · ${t.tableName}`
}
/** 当前值不在这次搜索结果里也要有个选项，不然下拉一打开就看不到已选的表；
 *  预加载的 tables 里查得到就是正常 label，查不到才退化成裸 ID + 后缀说明（跟原来的
 *  「（当前配置）」「（来自源步骤）」兜底文案同一个语义，只是从散落的 <option v-if> 收成一个函数）。 */
function withCurrentOption(list: EntryType[], currentId: string, fallbackSuffix: string) {
  const searchOptions = list.map((t) => ({ tableId: t.tableId, label: tableOptionLabel(t) }))
  if (!currentId || searchOptions.some((o) => o.tableId === currentId)) return searchOptions
  const known = tables.value.find((t) => t.tableId === currentId)
  return [{ tableId: currentId, label: known ? tableOptionLabel(known) : `${currentId}（${fallbackSuffix}）` }, ...searchOptions]
}
const inputTableOptions = computed(() => withCurrentOption(inputTableSearch.results.value, ownInputTableId.value, '当前配置'))
function onInputTableFilter(keyword: string) {
  inputTableSearch.debouncedSearch(keyword)
}
function onInputTableVisible(open: boolean) {
  if (open && !inputTableSearch.results.value.length) void inputTableSearch.runSearch('')
}
function onInputTableId(value: string | undefined | null) {
  const v = value ?? ''
  if (cc.value) flow.patchCollect(id.value, { inputTable: v })
  else flow.setInputTable(id.value, v)
  flow.resetInputFields(id.value)
}

// 当前节点输出表（统一口径：采集类取 collectCfg.outputTable，非采集类取 cfg.outputTable）
const nodeTableId = computed(() => cc.value?.outputTable || cfg.value?.outputTable || '')
const currentDedupMode = computed<'source' | 'table'>(() => cc.value?.dedupMode || cfg.value?.dedupMode || 'source')

// 去重列（0828 D11）：会上指出「去重列丢了，要加回来」。
// 它不是一个独立字段——旧平台也是**派生**的：由输出表字段里勾了「去重」的那些聚合而成
// （旧 EntryTypeEdit.vue 的 loadInfo 就是这么拼 uniqueKey 的，见 api/legacyAdapters.ts:342，
// 配置详情接口本身不返回它）。所以这里只读展示，改要去「查看/编辑表」勾字段。
// 复用 useNodeInspectorAssets 已缓存的表字段，不额外发请求。
const dedupColumns = computed<string[]>(() => {
  const table = tables.value.find((t) => t.tableId === nodeTableId.value)
  return (table?.fields ?? []).filter((f) => f.dedup).map((f) => f.prop)
})
const DEFAULT_PRESET_TABLES = [
  { name: '资讯列表', tableId: '2103330' },
  { name: '资源表', tableId: '2101001' },
  { name: '评论交互表', tableId: '2102157' },
  { name: '社交舆情表', tableId: '2103300' },
]

// 输出字段勾选相关的 outputTableFields/savedOutFields/selectedFieldProps/toggleOutputField/
// selectAllFields/clearAllFields 随「输出字段选择」区块一并撤掉（原因见下方模板处注释）。
// flow.setOutFields 这个 store action 因此暂时没有调用方了，但没有删——outFields 还在
// NodeConfig 类型里仍保留这些字段；真实节点配置写入通路打通后再整体恢复。

function selectPresetTable(tableId: string) {
  if (nodeCapability.value?.outputMode === 'fixed') return
  if (cc.value) flow.patchCollect(id.value, { outputTable: tableId })
  else flow.setOutputTable(id.value, tableId)
}

const outputTableOptions = computed(() => withCurrentOption(outputTableSearch.results.value, nodeTableId.value, '来自源步骤'))
function onOutputTableFilter(keyword: string) {
  outputTableSearch.debouncedSearch(keyword)
}
function onOutputTableVisible(open: boolean) {
  if (open && !outputTableSearch.results.value.length) void outputTableSearch.runSearch('')
}
function onOutputTableId(value: string | undefined | null) {
  const v = value ?? ''
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

// 结构化配置 / 正文规则（0804 S3-1）：非规则节点走 store 的双轨 setter（采集类写
// collectCfg，非采集类写 NodeConfig 顶层，两边取哪边由 setStructuredConfig 内部判断，本组件不用分支）。
const structuredConfigValue = computed(() => cc.value?.structuredConfig ?? cfg.value?.structuredConfig ?? '')
const contentRulesValue = computed(() => cc.value?.contentRules ?? cfg.value?.contentRules ?? '')
// 空着时直接给出旧平台「配全局ID」模板，不用再点按钮填。后端已有 codeRule 时仍显示原值。
const GLOBAL_ID_TEMPLATE = '{"globals":["列ID"]}'
const structuredConfigDisplay = computed(() => structuredConfigValue.value.trim() || GLOBAL_ID_TEMPLATE)
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
  tables.value = mergeEntryTypesPreservingFields(tables.value, (await entryApi.entryPaged({ size: 100 })).list)
  if (id.value) {
    if (cc.value) flow.patchCollect(id.value, { outputTable: tableId })
    else flow.setOutputTable(id.value, tableId)
  }
}

</script>

<template>
  <template v-if="isRule">
    <RuleTableFieldBinder
      :model-value="ruleCfg"
      :input-field-options="inputFieldOptions"
      :output-field-options="outputFieldOptions"
      :hide-output="isMonitor"
      @update:model-value="patchRule"
    />
    <div v-if="isMonitor" class="rc-field" data-testid="monitor-methods-field">
      <label>监控方法</label>
      <el-select
        class="rc-table-select"
        :model-value="monitorMethods"
        multiple
        collapse-tags
        collapse-tags-tooltip
        clearable
        placeholder="选择监控方法"
        @update:model-value="setMonitorMethods"
      >
        <el-option v-for="m in MONITOR_METHODS" :key="m" :label="m" :value="m" />
      </el-select>
    </div>
  </template>

  <template v-else>
    <template v-if="nodeCapability?.kind !== 'login'">
      <div class="rc-field" data-testid="input-table-field"><label>输入表</label>
        <el-select
          class="rc-table-select"
          :model-value="ownInputTableId || undefined"
          filterable
          remote
          clearable
          :remote-method="onInputTableFilter"
          :loading="inputTableSearch.loading.value"
          :placeholder="inputTableLabel"
          @update:model-value="onInputTableId"
          @visible-change="onInputTableVisible"
        >
          <el-option v-for="t in inputTableOptions" :key="t.tableId" :label="t.label" :value="t.tableId" />
        </el-select>
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
      <div class="rc-input-group" data-testid="output-table-field">
        <el-select
          class="rc-table-select grow"
          :model-value="nodeTableId || undefined"
          filterable
          remote
          :disabled="nodeCapability?.outputMode === 'fixed'"
          :remote-method="onOutputTableFilter"
          :loading="outputTableSearch.loading.value"
          :placeholder="cc ? '请选择输出表' : '默认继承上游节点，可显式指定输出表'"
          @update:model-value="onOutputTableId"
          @visible-change="onOutputTableVisible"
        >
          <el-option v-for="t in outputTableOptions" :key="t.tableId" :label="t.label" :value="t.tableId" />
        </el-select>
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
    <!-- 去重列（0828 D11）：只读，来自输出表字段的「去重」勾选 -->
    <div class="rc-field">
      <label>去重列</label>
      <div class="rc-readonly-hint" data-testid="dedup-columns">
        {{ dedupColumns.length ? dedupColumns.join('、') : '—' }}
      </div>
      <div class="rc-help">
        {{ dedupColumns.length
          ? '按这些字段判断数据是否重复。'
          : (nodeTableId ? '当前输出表没有字段勾选「去重」，到「查看/编辑表」的字段表里勾选。' : '先选择输出表。') }}
      </div>
    </div>
    <!-- 「输出字段选择」（outFields）2026-08-26 撤掉：这个勾选没有任何后端通路——不在 item/next
         步骤写入 payload 里（stepToStepModifyPayload 无此 key），目前只会写进本地流程草稿。
         也就是说勾与不勾对真实抓取零影响，展示出来只会让人以为配置生效了。等节点配置的
         写入通路真的打通再恢复。
         注意：规则节点那套入参/出参字段绑定不受影响，第一次生成脚本时走 orchestrationSaveMeta →
         /vrule/api/custom-compose/save（live 且在生产写白名单里），是真生效的。 -->
    <!-- 结构化配置 + 正文规则（0804 S3-1）：不透明文本，具体 schema 由执行端解释。
         **名称保持「结构化配置」**（2026-08-28 确认）：旧平台 column.config.js 里 codeRule 的 title 就是它，
         0824-00 §6.3 计划改成「入库配置」的方向是反的——字段展示名跟旧平台走，改了反而对不上。 -->
    <div class="rc-field">
      <label><span>结构化配置</span></label>
      <textarea class="rc-input" rows="2" placeholder='{"globals":["列ID"]}' :value="structuredConfigDisplay" @input="onStructuredConfig"></textarea>
    </div>
    <div class="rc-field"><label>正文规则</label>
      <textarea class="rc-input" rows="2" placeholder="按输出字段配置处理规则，一行一条，如 content=trim" :value="contentRulesValue" @input="onContentRules"></textarea>
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
.rc-table-select { width: 100%; }
.rc-input-group .rc-table-select.grow { flex: 1; }
.rc-input-group .rc-table-select.grow :deep(.el-select__wrapper) { border-radius: 7px 0 0 7px; }
.rc-table-select :deep(.el-select__wrapper) {
  min-height: 32px;
  border-radius: 7px;
  box-shadow: 0 0 0 1px #dbe3ee inset;
  font-size: 12px;
}
.rc-table-select :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px #60a5fa inset, 0 0 0 3px #dbeafe;
}
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
