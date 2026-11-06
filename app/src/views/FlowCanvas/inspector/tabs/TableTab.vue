<script setup lang="ts">
// 表配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 0804 S2-2 拍板：规则节点的表/字段绑定从编排配置搬回这里，跟其他节点共用同一个 Tab——
// 规则名称 = 节点名称（不再单独输入）；绑完输入/输出表与字段后即可进编排配置 Tab。
// 非规则节点内容：输出表管理（采集类固定/可选）+ 非采集类产物明细三元表 + 表结构编辑弹窗。
// 规则节点表配置的保存按钮已移除；生成脚本使用节点已保存的 configId，表配置只负责绑表/字段。
// 2026-09-18：翻译助手 / 打标签 / 摘要 / 音频转文字 / 视频转音频并入规则式表/字段绑定（isRuleLike），绑定内容存 execCfg 而非 ruleCfg。
// 2026-09-22：OCR 抓取并入同一套绑定（用户口径：表配置跟翻译助手一致）。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import {
  collectorCapabilityOf, isRuleNode, isRuleLikeNode, isPdfNode, isMonitorNode, isDataValidationNode, makeDefaultRuleOrchestration, makeDefaultExecConfig,
  fieldOptionsFromTableOrOutput,
  type NodeConfig, type TripleField,
} from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, type EntryType, type RuleOrchestration } from '@/api'
import { useRuleTableFields } from '@/composables/useRuleTableFields'
import { usePresetTables } from '@/composables/usePresetTables'
import TableEditDialog from '../TableEditDialog.vue'
import RuleTableFieldBinder from '../RuleTableFieldBinder.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'
import { mergeEntryTypesPreservingFields } from '@/composables/useEntryTableFieldsCache'
import { inputFieldSelection, inputFieldTokens } from '@/utils/flow/inputFieldSelection'
import SubTableOutputGroup from '../SubTableOutputGroup.vue'
import { outputModeOf, readOutputTableConfig, subTableOf, withSubTable } from '@/utils/flow/multiTableOutput'

const props = defineProps<{ templateDefaults?: boolean }>()
const flow = useFlowStore()
const { tables, ensureTableFields } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)
const inputReferenceWarning = ref('')
watch(id, () => { inputReferenceWarning.value = '' })

function inputTableChangeAllowed(tableId: string) {
  const current = flow.effectiveInputTableFor(id.value)
  if (tableId === current) return true
  const hasFields = inputFieldTokens(cfg.value).length || cfg.value?.taskCfg?.contextMap?.length
  if (hasFields) {
    inputReferenceWarning.value = '请先清除已选输入字段，再切换输入表，避免原字段绑定到新表。'
    return false
  }
  inputReferenceWarning.value = ''
  return true
}

const isRule = computed(() => (cfg.value ? isRuleNode(cfg.value) : false))
const isMonitor = computed(() => (cfg.value ? isMonitorNode(cfg.value) : false))
const isDataValidation = computed(() => (cfg.value ? isDataValidationNode(cfg.value) : false))
// 翻译助手 / 打标签 / 摘要 / 音频转文字 / 视频转音频 / OCR 抓取（2026-09-18、09-22）：与规则处理共用同一套表/字段绑定表单；绑定内容仍存 execCfg
// （不能写进 ruleCfg——那会把它们误判成规则节点，编排配置整个串位），
// 入出参的步骤持久化口径与规则节点一致（stepPersist 按 isRuleLikeNode 走同一套 context 写入）。
const isRuleLike = computed(() => (cfg.value ? isRuleLikeNode(cfg.value) : false))
// PDF 抓取（2026-09-29）：表配置渲染成规则式的入参/出参字段绑定（RuleTableFieldBinder），
// 绑定内容落 execCfg——与翻译/打标签同一存储位；落库仍走采集类口径（nodeType 不变、context 取 taskCfg）。
const isPdf = computed(() => (cfg.value ? isPdfNode(cfg.value) : false))
const ruleStyled = computed(() => isRuleLike.value || isPdf.value)

// ---- 规则/翻译/打标签/摘要/音视频处理节点：表/字段绑定（0804 拍板：搬回表配置；2026-09-18 并入 isRuleLike） ----
const ruleCfg = computed<RuleOrchestration>(() => ({
  ...(isRule.value ? makeDefaultRuleOrchestration() : makeDefaultExecConfig()),
  ...(isRule.value ? cfg.value?.ruleCfg : cfg.value?.execCfg),
  name: cfg.value?.title ?? '',
}))
function patchRule(p: Partial<RuleOrchestration>, restoring = false) {
  if (p.inputTableId !== undefined && !inputTableChangeAllowed(p.inputTableId)) return
  // 规则处理写 ruleCfg；其余规则式节点写 execCfg（共用同一个绑定组件，落点按节点类型分）
  if (isRule.value) flow.patchRuleConfig(id.value, p)
  else flow.patchExecConfig(id.value, p)
  // 用户清空后不再用旧 context 恢复勾选，也不能在换表时将旧 K 列套进新表。
  // 只读回显保持旧 token，不在元数据加载时改写持久化字段。
  if (p.inputFields && !restoring) {
    const columns = new Map(inputFieldOptions.value.map((field) => [field.itemCode, field.columnName || field.itemCode]))
    flow.patchTaskConfig(id.value, { contextMap: p.inputFields.map((code) => columns.get(code) ?? code) })
  }
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
    if (!ruleStyled.value || !id.value) return
    const patch: Partial<RuleOrchestration> = {}
    const inputFields = restoreFieldsFromColumns(ruleCfg.value.inputFields, contextMap, inOpts)
    if (inputFields) patch.inputFields = inputFields
    if (!isMonitor.value) {
      const outputFields = restoreFieldsFromColumns(ruleCfg.value.outputFields, outColumns, outOpts)
      if (outputFields) patch.outputFields = outputFields
    }
    if (Object.keys(patch).length) patchRule(patch, true)
  },
  { immediate: true },
)

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))
const showMultiTableOutput = computed(() => !!cc.value && nodeCapability.value?.kind !== 'login' && nodeCapability.value?.outputMode !== 'fixed')

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
const inputSelection = computed(() => inputFieldSelection(cfg.value, inputTableFields.value))
const selectedInputFieldProps = computed(() => inputSelection.value.selected)
function isInputFieldSelected(prop: string): boolean {
  return selectedInputFieldProps.value.includes(prop)
}
function toggleInputField(prop: string) {
  const current = new Set(selectedInputFieldProps.value)
  if (current.has(prop)) current.delete(prop)
  else current.add(prop)
  writeInputFields([...current, ...inputSelection.value.unknown])
}
function writeInputFields(fields: string[]) {
  flow.setInputFields(id.value, fields, inputTableFields.value)
}
/**
 * 只看已选（2026-09-23，用户：「字段确实有点多」）。默认开：勾选墙只铺已选的字段。
 * 一个没选时自动显示全部（不然墙是空的）；全选时两种模式一样，切换按钮也就不出现。
 */
const inputOnlySelected = ref(true)
const inputPartiallySelected = computed(() =>
  selectedInputFieldProps.value.length > 0 && selectedInputFieldProps.value.length < inputTableFields.value.length)
const visibleInputFields = computed(() => (inputOnlySelected.value && inputPartiallySelected.value
  ? inputTableFields.value.filter((f) => isInputFieldSelected(f.prop))
  : inputTableFields.value))
/**
 * 空勾选有两种语义（2026-11-04 F2 收口）：未指定＝保存时沿用旧 context；明确清空＝落 null。
 * 展示成一个空墙，用户分不出来，所以按 `inputSelection.specified` 给不同提示。
 */
const inputFieldsHint = computed(() => {
  const { selected, unknown, specified } = inputSelection.value
  if (!specified) return '未指定输入字段：保存时沿用该步骤原有的上下文来源；勾选后按勾选传递。'
  if (!selected.length && !unknown.length) return '已清空输入字段：保存后该步骤的上下文来源为空，不再沿用旧列。'
  return '勾选字段随任务传递，按勾选顺序写入 context。'
})
function selectAllInputFields() {
  writeInputFields([...inputTableFields.value.map((f) => f.prop), ...inputSelection.value.unknown])
}
function clearAllInputFields() {
  writeInputFields([])
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
      // 支持按表 ID 搜（纯数字时 ID + 名称两路合并），见 entryApi.searchTables
      const list = await entryApi.searchTables(keyword, 30)
      if (seq !== requestSeq) return // 有更新的搜索已发出，丢弃这次的结果
      results.value = list
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
  if (!inputTableChangeAllowed(v)) return
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
// 常用默认表快捷选择（同事 e1f9290 加的，跟本文件其余的 0805 改造无关）。
// 0903 欠账 A2：原来这四个 ID（2103330/2101001/2102157/2103300）**在真实后端一个都不存在**
// ——它们是 mock 里的 ID，这功能从来只在 mock 下成立。点一下会把输出表设成无效 ID、
// 出参变「共 0 个可选」，界面还不报错。2026-09-05 换成下面这四张真实表。
//
// 名单仍是硬编码，所以**校验没有撤掉**（composables/usePresetTables.ts）：渲染前逐个问
// 后端这张表在不在，只留存在的，一个不剩就整行不显示。换个环境这些 ID 同样可能失效，
// 有校验兜着就不会再出现"点了没反应还不报错"。
const DEFAULT_PRESET_TABLES = [
  // 前两张按实际用量定（2026-09-05 抽 11998 个源统计 entryTypeId）：
  // 通用新闻表 6481 个源、公众号文章 5439 个，两张占 99.3%，断层明显。
  // 后两张是业务指定的资源表（用户 2026-09-05 点名）。四张都已逐个校验存在且有字段。
  { name: '通用新闻表', tableId: '900' },
  { name: '公众号文章', tableId: '6200029' },
  { name: '附件资源表', tableId: '6200020' },
  { name: '图片资源文件表', tableId: '6200005' },
]
const { availablePresets } = usePresetTables(DEFAULT_PRESET_TABLES)

// 输出字段选择（2026-10-10 恢复）：就是旧平台步骤编辑里的「出参列 (OutContext)」，
// 落 taskCfg.outColumns → 步骤 outContext，作为统一编辑入口；任务配置不再重复提供出参列。
// 口径跟旧平台：空 = 默认全部字段。后端存物理列名（K1…），这里按字段展示：
// 读时列名 / 字段名都认，写时换回列名（表里没有列名才写字段名）。
watch(nodeTableId, (tid) => ensureTableFields(tid), { immediate: true })
const outputTableFields = computed(() => nodeTableId.value
  ? fieldOptionsFromTableOrOutput(nodeTableId.value, tables.value, cfg.value?.output)
  : [])
const selectedOutputFieldProps = computed<string[]>(() => {
  const saved = cfg.value?.taskCfg?.outColumns ?? []
  const propByToken = new Map<string, string>()
  for (const f of outputTableFields.value) {
    propByToken.set(f.prop, f.prop)
    if (f.columnName) propByToken.set(f.columnName, f.prop)
  }
  return [...new Set(saved.map((token) => propByToken.get(token)).filter((p): p is string => !!p))]
})
function isOutputFieldSelected(prop: string): boolean {
  return selectedOutputFieldProps.value.includes(prop)
}
function writeOutputFields(props: string[]) {
  const columnByProp = new Map(outputTableFields.value.map((f) => [f.prop, f.columnName || f.prop]))
  flow.patchTaskConfig(id.value, { outColumns: props.map((p) => columnByProp.get(p) ?? p) })
}
function toggleOutputField(prop: string) {
  const current = new Set(selectedOutputFieldProps.value)
  if (current.has(prop)) current.delete(prop)
  else current.add(prop)
  // 保持表字段顺序，跟旧平台按列顺序拼 outContext 一致
  writeOutputFields(outputTableFields.value.map((f) => f.prop).filter((p) => current.has(p)))
}
function selectAllOutputFields() {
  writeOutputFields(outputTableFields.value.map((f) => f.prop))
}
function clearOutputFields() {
  writeOutputFields([])
}

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
// 1106 W5：单表 / 多表（写入方式）。状态一律从 structuredConfigValue 推导，只有「切到多表但还没选副表」是本组件本地态。
const outputModeState = computed(() => outputModeOf(structuredConfigValue.value))
const multiRequested = ref(false)
const multiActive = computed(() => outputModeState.value !== 'single' || multiRequested.value)
watch(() => outputModeState.value, (mode) => { multiRequested.value = mode !== 'single' })
watch(id, () => { multiRequested.value = false })
function subTableLabel(): string {
  const tableId = String(subTableOf(readOutputTableConfig(structuredConfigValue.value).config)?.entryTypeId ?? '')
  if (!tableId) return ''
  const table = tables.value.find((item) => item.tableId === tableId)
  return table ? `${table.name || table.tableName} · ${tableId}` : `数据表 #${tableId}`
}
async function setOutputMode(mode: 'single' | 'multi') {
  if (mode === 'multi') { multiRequested.value = true; return }
  multiRequested.value = false
  if (outputModeState.value === 'single') return
  const name = subTableLabel()
  try {
    await ElMessageBox.confirm(`切回单表会移除已配置的副表「${name}」，确定吗？`, '切回单表', { type: 'warning', confirmButtonText: '确认移除', cancelButtonText: '取消' })
  } catch {
    multiRequested.value = true
    return
  }
  const { config } = readOutputTableConfig(structuredConfigValue.value)
  flow.setStructuredConfig(id.value, withSubTable(config ?? {}, undefined))
}
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
  tables.value = mergeEntryTypesPreservingFields(tables.value, (await entryApi.entryPaged({ size: 100 })).list)
  if (id.value) {
    if (cc.value) flow.patchCollect(id.value, { outputTable: tableId })
    else flow.setOutputTable(id.value, tableId)
  }
}

</script>

<template>
  <div v-if="inputReferenceWarning" class="rc-help input-field-warning" role="status" data-testid="input-reference-warning">{{ inputReferenceWarning }}</div>
  <template v-if="ruleStyled">
    <RuleTableFieldBinder
      :model-value="ruleCfg"
      :input-field-options="inputFieldOptions"
      :output-field-options="outputFieldOptions"
      :hide-output="isMonitor || isDataValidation"
      @update:model-value="patchRule"
    />
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
          <label>输入字段选择（{{ inputSelection.specified ? `已选中 ${selectedInputFieldProps.length} / ${inputTableFields.length} 个字段` : '未指定' }}）</label>
          <div class="rc-field-actions">
            <button v-if="inputPartiallySelected" type="button" class="rc-text-btn" data-testid="toggle-only-selected-input-fields" @click="inputOnlySelected = !inputOnlySelected">{{ inputOnlySelected ? `显示全部 ${inputTableFields.length} 个` : '只看已选' }}</button>
            <button type="button" class="rc-text-btn" data-testid="select-all-input-fields" @click="selectAllInputFields">全选</button>
            <button type="button" class="rc-text-btn" data-testid="clear-all-input-fields" @click="clearAllInputFields">清空</button>
          </div>
        </div>
        <div class="rc-tag-row" data-testid="input-fields-list">
          <span
            v-for="f in visibleInputFields"
            :key="f.prop"
            class="rc-tag"
            :class="{ on: isInputFieldSelected(f.prop) }"
            @click="toggleInputField(f.prop)"
          >
            <input type="checkbox" :checked="isInputFieldSelected(f.prop)" :aria-label="`选择输入字段 ${f.desc || f.prop}`" class="rc-tag-check" @click.stop="toggleInputField(f.prop)" />
            <span class="rc-tag-text">{{ f.prop }} {{ f.desc ? `· ${f.desc}` : '' }}</span>
          </span>
        </div>
        <div class="rc-help" data-testid="input-fields-state-hint">{{ inputFieldsHint }}</div>
      </div>
      <div v-if="inputSelection.unknown.length" class="rc-help input-field-warning" data-testid="unknown-input-fields">
        {{ inputTableFields.length ? '未找到的输入字段' : '待解析的输入字段' }}：
        <span v-for="token in inputSelection.unknown" :key="token" class="unknown-input-field">
          {{ token }}
          <button type="button" class="rc-text-btn" :aria-label="`移除输入字段 ${token}`" @click="writeInputFields([...selectedInputFieldProps, ...inputSelection.unknown.filter((item) => item !== token)])">移除</button>
        </span>
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
        <button v-if="!props.templateDefaults" class="rc-input-btn" type="button" @click="openEditTable">查看/编辑表</button>
        <button v-if="!props.templateDefaults" class="rc-input-btn" type="button" @click="openNewTable">新建表</button>
      </div>
      <div v-if="availablePresets.length" class="rc-preset-tables" data-testid="table-presets">
        <span class="rc-preset-label">常用默认表：</span>
        <button
          v-for="preset in availablePresets"
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
    <!-- 输出字段选择 = 旧平台「出参列 (OutContext)」，空即默认全部，落步骤 outContext。 -->
    <div v-if="outputTableFields.length" class="rc-field">
      <div class="rc-field-header">
        <label>输出字段选择（已选中 {{ selectedOutputFieldProps.length }} / {{ outputTableFields.length }} 个字段，不选默认全部字段）</label>
        <div class="rc-field-actions">
          <button type="button" class="rc-text-btn" data-testid="select-all-fields" @click="selectAllOutputFields">全选</button>
          <button type="button" class="rc-text-btn" data-testid="clear-all-fields" @click="clearOutputFields">清空</button>
        </div>
      </div>
      <div class="rc-tag-row" data-testid="output-fields-list">
        <span
          v-for="f in outputTableFields"
          :key="f.prop"
          class="rc-tag"
          :class="{ on: isOutputFieldSelected(f.prop) }"
          @click="toggleOutputField(f.prop)"
        >
          <input type="checkbox" :checked="isOutputFieldSelected(f.prop)" class="rc-tag-check" @click.stop="toggleOutputField(f.prop)" />
          <span class="rc-tag-text">{{ f.prop }} {{ f.desc ? `· ${f.desc}` : '' }}</span>
        </span>
      </div>
      <div class="rc-help">即旧平台的「出参列 (OutContext)」：勾选的字段传给后续步骤；不选默认全部字段。</div>
    </div>
    <!-- 1106 W5：写入方式（单表默认 / 多表 = 多一套副表配置）。单表时不写 table.subs，报文与现状一致。 -->
    <div v-if="showMultiTableOutput" class="rc-field">
      <label>写入方式</label>
      <div class="rc-segment" data-testid="output-mode-segment">
        <button type="button" :class="{ active: !multiActive }" @click="setOutputMode('single')">单表</button>
        <button type="button" :class="{ active: multiActive }" @click="setOutputMode('multi')">多表</button>
      </div>
      <div class="rc-help">{{ multiActive ? '上方输出表照写；再加一套副表配置，写它的字段。' : '只写上方这张输出表。要同时写一张副表时切到「多表」。' }}</div>
    </div>
    <SubTableOutputGroup
      v-if="showMultiTableOutput && multiActive"
      :model-value="structuredConfigValue" :main-table-id="nodeTableId" :tables="tables"
      @update:model-value="flow.setStructuredConfig(id, $event)"
    />
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
    <!-- 结构化配置 + 正文规则（0804 S3-1）：不透明文本，具体 schema 由执行端解释。
         **名称保持「结构化配置」**（2026-08-28 确认）：旧平台 column.config.js 里 codeRule 的 title 就是它，
         0824-00 §6.3 计划改成「入库配置」的方向是反的——字段展示名跟旧平台走，改了反而对不上。 -->
    <details v-if="showMultiTableOutput" class="table-advanced">
      <summary>高级配置</summary>
      <div class="rc-field">
        <label>结构化配置</label>
        <textarea class="rc-input" rows="3" placeholder='{"globals":["列ID"]}' :value="structuredConfigValue" @input="onStructuredConfig"></textarea>
      </div>
    </details>
    <div v-else class="rc-field">
      <label><span>结构化配置</span></label>
      <textarea class="rc-input" rows="2" placeholder='{"globals":["列ID"]}' :value="structuredConfigValue" @input="onStructuredConfig"></textarea>
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

    <TableEditDialog v-if="!props.templateDefaults" v-model:open="tableDlg.open" :table-id="tableDlg.tableId" @saved="onTableSaved" />
  </template>
</template>

<style scoped>
/* 字段名按「小标题」呈现（2026-11-05，1105 会议）：12px/600/#334155，层级向「参数配置」区块看齐；
   四个 Tab 各自 scoped 覆盖了同一份规则（ConfigTab / TableTab / TaskTab / RuleOrchestrationTab），改这里记得同步。 */
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 14px; }
.rc-field label { display: block; color: #334155; font-size: 12px; font-weight: 600; margin-bottom: 6px; letter-spacing: .01em; }
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
.input-field-warning { color: var(--rc-warn); margin-bottom: 8px; }
.unknown-input-field { display: inline-flex; align-items: baseline; gap: 4px; margin-right: 8px; }
.table-advanced { margin: 10px 0; color: var(--rc-muted); font-size: 11px; }
.table-advanced summary { cursor: pointer; margin-bottom: 8px; }
</style>
