<script setup lang="ts">
// 规则处理节点「新增业务规则」表/字段绑定（0801 方案 §6.3/§7.2；0803 改造：表来源换成 vrule 跨租户搜索）。
// 采集中心自己的实体表注册表在真实环境里近乎空（实测仅 2 条），规则真正引用的 sense_data 表在 vrule 那边，
// 但 news-getTableList 按租户分域、没有「查全部」的接口——本组件直接调 ruleApi.orchestrationTableSearch
// （内部按数据源查全部真实租户、逐个查表合并去重），输入即搜索，不再依赖父级预加载的 tables 列表。
// 字段列表（入参/出参）仍由父级 RuleOrchestrationTab 传入——它同时要给「查看业务编排」的只读摘要显示字段名，
// 缓存逻辑放父级更省一次重复请求。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ruleApi, type RuleDataSource, type RuleFieldOption, type RuleOrchestration, type RuleOrchestrationItem, type RuleTableOption } from '@/api'
import { isSystemField } from '@/utils/flow/ruleOrchestration'

type BinderModel = Pick<
  RuleOrchestration,
  'dataSource' | 'name' | 'inputTable' | 'inputTableId' | 'outputTable' | 'outputTableId' | 'inputFields' | 'outputFields' | 'userCode'
>

// 规则名称支持模糊搜索已有规则并引用（0803 会议）：全新态和「修改表字段」编辑态都开放——
// 后者选中已有项等于中途反悔换成引用别的规则（复用同一套 select-existing + 表冲突确认逻辑）。
const props = defineProps<{
  modelValue: BinderModel
  ruleOptions?: RuleOrchestrationItem[]
  inputFieldOptions: RuleFieldOption[]
  outputFieldOptions: RuleFieldOption[]
}>()
const emit = defineEmits<{ 'update:modelValue': [BinderModel]; 'select-existing': [ruleId: string] }>()

const DEFAULT_PRESET_TABLES = [
  { name: '资讯列表', tableId: '2103330' },
  { name: '资源表', tableId: '2101001' },
  { name: '评论交互表', tableId: '2102157' },
  { name: '社交舆情表', tableId: '2103300' },
]

const DATA_SOURCES: { value: RuleDataSource; label: string }[] = [
  { value: 'dp-news', label: '资讯库' },
  { value: 'dp-wwdata', label: '采集库' },
  { value: 'dp-swdata', label: '申万库' },
]

function patch(p: Partial<BinderModel>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}

// 系统固定字段（seq < 0）默认不进可选池；已选中的仍保留在已选 tag，避免静默丢字段
const showSystemFields = ref(false)
function selectableFields(all: RuleFieldOption[]): RuleFieldOption[] {
  if (showSystemFields.value) return all
  return all.filter((f) => !isSystemField(f))
}
const inputFieldPool = computed(() => selectableFields(props.inputFieldOptions))
const outputFieldPool = computed(() => selectableFields(props.outputFieldOptions))

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// 表搜索（跨租户，0803）：输入表/输出表各自独立的搜索态，避免共用一份状态时互相打断。
// REVIEW-2026-08-04 P1 #3：每次 runSearch 创建新 AbortController；新 search 触发时主动 abort 旧 controller，
// 让"快速连打字"场景下旧请求的网络层真正被中断（不是仅靠 requestSeq 丢弃结果）。
// AbortError 不弹错——主动取消是预期行为，error 兜底只针对真实失败。
function useTableSearch() {
  const results = ref<RuleTableOption[]>([])
  const loading = ref(false)
  const selected = ref<RuleTableOption | null>(null)
  let requestSeq = 0
  let inflight: AbortController | null = null
  async function runSearch(dataSource: string | undefined, keyword: string) {
    if (!dataSource) return
    // 主动取消上一轮正在飞的请求（不只是丢弃结果，还要把 fetch 也 abort 掉）
    if (inflight) inflight.abort()
    const controller = new AbortController()
    inflight = controller
    const seq = ++requestSeq
    loading.value = true
    try {
      const list = await ruleApi.orchestrationTableSearch(dataSource, keyword, controller.signal)
      if (seq !== requestSeq) return // 有更新的搜索已发出，丢弃这次的结果
      results.value = list
    } catch (e) {
      if (seq !== requestSeq) return
      // 主动取消不弹错——是预期行为；区分靠 error.name
      if ((e as Error)?.name === 'AbortError') return
      ElMessage.error(`搜索表失败：${(e as Error)?.message ?? String(e)}`)
    } finally {
      if (seq === requestSeq) {
        loading.value = false
        if (inflight === controller) inflight = null
      }
    }
  }
  const debouncedSearch = debounce(runSearch, 300)
  // 渲染用列表：把当前已选项也并进去，保证下拉重新打开、或搜索结果不包含已选项时控件仍能正确回显 label
  const renderOptions = computed(() => {
    if (!selected.value) return results.value
    if (results.value.some((t) => t.tableId === selected.value!.tableId)) return results.value
    return [selected.value, ...results.value]
  })
  return { results, loading, selected, runSearch, debouncedSearch, renderOptions }
}
const inputTableSearch = useTableSearch()
const outputTableSearch = useTableSearch()

function onInputTableFilter(query: string) {
  inputTableSearch.debouncedSearch(props.modelValue.dataSource, query)
}
function onInputTableVisible(open: boolean) {
  if (open && !inputTableSearch.results.value.length) void inputTableSearch.runSearch(props.modelValue.dataSource, '')
}
function onOutputTableFilter(query: string) {
  outputTableSearch.debouncedSearch(props.modelValue.dataSource, query)
}
function onOutputTableVisible(open: boolean) {
  if (open && !outputTableSearch.results.value.length) void outputTableSearch.runSearch(props.modelValue.dataSource, '')
}
function tableOptionLabel(t: RuleTableOption) {
  return `${t.tableName} · ${t.dbTableName}`
}

function onDataSourceChange(value: RuleDataSource) {
  // 切换数据源清空表/字段重选——不同数据源下的租户、表都不是同一批
  patch({
    dataSource: value, inputTable: '', inputTableId: '', outputTable: '', outputTableId: '',
    inputFields: [], outputFields: [], userCode: undefined,
  })
  inputTableSearch.results.value = []
  inputTableSearch.selected.value = null
  outputTableSearch.results.value = []
  outputTableSearch.selected.value = null
}
// 规则名称 combobox：value 用规则名文本本身（而非 ruleId），这样未匹配到已有项时控件仍能正常回显
// 当前草稿名；匹配到已有项则不在本组件内直接改名，交给父级 select-existing 去异步拉详情后再落地。
const nameKeyword = ref('')
function onNameFilter(query: string) {
  nameKeyword.value = query
}
function onNameSelectVisible(open: boolean) {
  if (open) nameKeyword.value = ''
}
const filteredRuleOptions = computed(() => {
  const kw = nameKeyword.value.trim().toLowerCase()
  const all = props.ruleOptions ?? []
  if (!kw) return all
  return all.filter((o) => o.name.toLowerCase().includes(kw))
})
function ruleOptionLabel(o: RuleOrchestrationItem) {
  return o.enabled === false ? `${o.name}（已停用）` : o.name
}
function onNameSelect(value: string) {
  const matched = (props.ruleOptions ?? []).find((o) => o.name === value)
  if (matched) {
    emit('select-existing', matched.ruleId)
    return
  }
  patch({ name: value })
}
function onInputTableId(tableId: string | undefined | null) {
  const id = tableId ?? ''
  const table = inputTableSearch.renderOptions.value.find((t) => t.tableId === id)
  inputTableSearch.selected.value = table ?? null
  // 输入表决定这条规则归属的租户（userCode）——发 saveMeta 时要用它，而不是登录账号，
  // 保证规则的租户和它引用的表所属租户一致（0803 追加，见 RuleOrchestration.userCode 注释）。
  patch({ inputTableId: id, inputTable: table?.dbTableName ?? '', inputFields: [], userCode: table?.ownerUserCode })
}
function onOutputTableId(tableId: string | undefined | null) {
  const id = tableId ?? ''
  const table = outputTableSearch.renderOptions.value.find((t) => t.tableId === id)
  outputTableSearch.selected.value = table ?? null
  patch({ outputTableId: id, outputTable: table?.dbTableName ?? '', outputFields: [] })
}

function toggleField(kind: 'input' | 'output', code: string) {
  const key = kind === 'input' ? 'inputFields' : 'outputFields'
  const current = props.modelValue[key] ?? []
  const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
  patch({ [key]: next } as Partial<BinderModel>)
}

// 入参/出参默认折叠，只显示已选 + 展开入口（拍板 #15）：字段数量多时避免把表单撑得很长
const inputExpanded = ref(false)
const outputExpanded = ref(false)
</script>

<template>
  <div class="rc-field"><label>数据源 *</label>
    <div class="rc-segment">
      <button
        v-for="ds in DATA_SOURCES" :key="ds.value" type="button"
        :class="{ active: modelValue.dataSource === ds.value }"
        @click="onDataSourceChange(ds.value)"
      >{{ ds.label }}</button>
    </div>
  </div>

  <div class="rc-field"><label>规则名称 *</label>
    <el-select
      class="rc-table-select"
      :model-value="modelValue.name || undefined"
      filterable
      allow-create
      default-first-option
      placeholder="搜索已有规则引用，或输入新名称新建"
      :filter-method="onNameFilter"
      @change="onNameSelect"
      @visible-change="onNameSelectVisible"
    >
      <el-option v-for="o in filteredRuleOptions" :key="o.ruleId" :label="ruleOptionLabel(o)" :value="o.name" />
    </el-select>
  </div>

  <div class="rc-field"><label>输入表 *</label>
    <el-select
      class="rc-table-select"
      :model-value="modelValue.inputTableId || undefined"
      filterable
      remote
      clearable
      :remote-method="onInputTableFilter"
      :loading="inputTableSearch.loading.value"
      placeholder="输入关键词跨租户搜索表，如 email、公告…"
      @update:model-value="onInputTableId"
      @visible-change="onInputTableVisible"
    >
      <el-option
        v-for="t in inputTableSearch.renderOptions.value"
        :key="t.tableId"
        :label="tableOptionLabel(t)"
        :value="t.tableId"
      />
    </el-select>
    <div class="rc-help">跨全部真实租户合并搜索，不需要额外选择租户——选中表后规则自动归属这张表所在的租户</div>
  </div>

  <div class="rc-field"><label>输出表（可选，默认使用输入表）</label>
    <el-select
      class="rc-table-select"
      :model-value="modelValue.outputTableId || undefined"
      filterable
      remote
      clearable
      :remote-method="onOutputTableFilter"
      :loading="outputTableSearch.loading.value"
      placeholder="默认 = 输入表；可输入筛选"
      @update:model-value="onOutputTableId"
      @visible-change="onOutputTableVisible"
    >
      <el-option
        v-for="t in outputTableSearch.renderOptions.value"
        :key="t.tableId"
        :label="tableOptionLabel(t)"
        :value="t.tableId"
      />
    </el-select>
    <div class="rc-preset-tables" data-testid="rule-table-presets">
      <span class="rc-preset-label">常用默认表：</span>
      <button
        v-for="preset in DEFAULT_PRESET_TABLES"
        :key="preset.tableId"
        type="button"
        class="rc-preset-chip"
        :class="{ active: modelValue.outputTableId === preset.tableId }"
        @click="onOutputTableId(preset.tableId)"
      >
        {{ preset.name }} ({{ preset.tableId }})
      </button>
    </div>
  </div>

  <div class="rc-field"><label>入参字段 *</label>
    <div v-if="!modelValue.inputTableId" class="rc-readonly-hint">请先选择输入表</div>
    <template v-else>
      <div class="rc-tag-row">
        <span v-if="!modelValue.inputFields?.length" class="rc-readonly-hint rc-tag-empty">未选择</span>
        <span v-for="code in modelValue.inputFields" :key="code" class="rc-tag on" @click="toggleField('input', code)">
          {{ inputFieldOptions.find((f) => f.itemCode === code)?.itemName ?? code }} ×
        </span>
        <button class="rc-tag-toggle" type="button" @click="inputExpanded = !inputExpanded">
          {{ inputExpanded ? '▾ 收起' : `▸ 共 ${inputFieldPool.length} 个可选` }}
        </button>
        <button class="rc-tag-toggle" type="button" @click="showSystemFields = !showSystemFields">
          {{ showSystemFields ? '隐藏系统字段' : '显示系统字段' }}
        </button>
      </div>
      <div v-if="inputExpanded" class="rc-tag-row rc-tag-pool">
        <span
          v-for="f in inputFieldPool" :key="f.itemCode"
          class="rc-tag" :class="{ on: modelValue.inputFields?.includes(f.itemCode) }"
          @click="toggleField('input', f.itemCode)"
        >{{ f.itemName }}</span>
      </div>
    </template>
  </div>

  <div class="rc-field"><label>出参字段 *</label>
    <div v-if="!modelValue.inputTableId" class="rc-readonly-hint">请先选择输入表</div>
    <template v-else>
      <div class="rc-tag-row">
        <span v-if="!modelValue.outputFields?.length" class="rc-readonly-hint rc-tag-empty">未选择</span>
        <span v-for="code in modelValue.outputFields" :key="code" class="rc-tag on" @click="toggleField('output', code)">
          {{ outputFieldOptions.find((f) => f.itemCode === code)?.itemName ?? code }} ×
        </span>
        <button class="rc-tag-toggle" type="button" @click="outputExpanded = !outputExpanded">
          {{ outputExpanded ? '▾ 收起' : `▸ 共 ${outputFieldPool.length} 个可选` }}
        </button>
      </div>
      <div v-if="outputExpanded" class="rc-tag-row rc-tag-pool">
        <span
          v-for="f in outputFieldPool" :key="f.itemCode"
          class="rc-tag" :class="{ on: modelValue.outputFields?.includes(f.itemCode) }"
          @click="toggleField('output', f.itemCode)"
        >{{ f.itemName }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-table-select { width: 100%; }
.rc-table-select :deep(.el-select__wrapper) {
  min-height: 32px;
  border-radius: 7px;
  box-shadow: 0 0 0 1px #dbe3ee inset;
  font-size: 12px;
}
.rc-table-select :deep(.el-select__wrapper.is-focused) {
  box-shadow: 0 0 0 1px #60a5fa inset, 0 0 0 3px #dbeafe;
}
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 4px; }
.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.rc-tag-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rc-tag-empty { padding: 4px 8px; }
.rc-tag { display: inline-flex; align-items: center; padding: 4px 9px; border: 1px solid #dbe3ee; border-radius: 999px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; user-select: none; }
.rc-tag:hover { border-color: #bfdbfe; }
.rc-tag.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 600; }
.rc-tag-toggle { border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; font-weight: 600; cursor: pointer; padding: 4px 2px; }
.rc-tag-toggle:hover { text-decoration: underline; }
.rc-tag-pool { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--rc-border-soft); }

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
</style>
