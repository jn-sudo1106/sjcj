<script setup lang="ts">
// 规则处理节点「新增业务规则」表/字段绑定（0801 方案 §6.3/§7.2）。
// 0805 改判（推翻 0803 的 vrule 单租户搜索）：用户指出采集中心自己的 entryType 和 vrule 那边其实是
// 同一份底层表注册表（entryTypeId/itemCode 编号空间共享，真机核对过 TB_NEWS_TAGS 两边 tableId 都是
// 2101991），两套查询没必要——改回跟其他节点表配置同源的 entryApi.entryPaged/entryDetail，
// 输入即搜索（按 name 关键字），不再依赖父级预加载的 tables 列表。
// 字段列表（入参/出参）仍由父级 RuleOrchestrationTab 传入——它同时要给「查看业务编排」的只读摘要显示字段名，
// 缓存逻辑放父级更省一次重复请求。
// 0804 拍板：所属库固定为采集库（不再可选，见 RULE_DATA_SOURCE）；命名沿用节点标题，
// 不再单独输入，「引用已有规则」能力一并砍掉（复用需求交给模板功能承接）。
// 入参字段默认全选；出参字段由用户明确勾选，避免新规则无意输出全部字段。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { entryApi, type EntryType, type RuleFieldOption, type RuleOrchestration } from '@/api'
import { isSystemField } from '@/utils/flow/ruleOrchestration'
import { usePresetTables } from '@/composables/usePresetTables'
import TableEditDialog from './TableEditDialog.vue'

type BinderModel = Pick<
  RuleOrchestration,
  'inputTable' | 'inputTableId' | 'outputTable' | 'outputTableId' | 'inputFields' | 'outputFields'
>

const props = defineProps<{
  modelValue: BinderModel
  inputFieldOptions: RuleFieldOption[]
  outputFieldOptions: RuleFieldOption[]
  /** 数据监控节点（2026-09-01）：隐藏「输出表」「出参字段」区块——monitor 不落表、不出参，只绑输入表/入参。 */
  hideOutput?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [Partial<BinderModel>] }>()

// 常用默认表快捷选择（同事 e1f9290 加的，跟本文件其余的 0805 改造无关）。
// 0903 欠账 A2：这四个 ID 全是硬编码，2026-09-05 实测**在真实后端一个都不存在**
// （config/entryType 一律回「未找到相关ID…」），是 mock 里的 ID。点一下会把输出表设成
// 无效 ID、出参变「共 0 个可选」，界面还不报错。改成渲染前逐个校验，只留真实存在的，
// 一个不剩就整行不显示——见 composables/usePresetTables.ts。
const DEFAULT_PRESET_TABLES = [
  { name: '资讯列表', tableId: '2103330' },
  { name: '资源表', tableId: '2101001' },
  { name: '评论交互表', tableId: '2102157' },
  { name: '社交舆情表', tableId: '2103300' },
]
const { availablePresets } = usePresetTables(DEFAULT_PRESET_TABLES)

// 只发真正改动的字段，不拿 props.modelValue 兜底铺满整个对象；父级会把 patch 合并到当前 store 状态。
function patch(p: Partial<BinderModel>) {
  emit('update:modelValue', p)
}

// 系统固定字段（seq < 0）默认不进可选池；已选中的仍保留在已选 tag，避免静默丢字段
const showSystemFields = ref(false)
function selectableFields(all: RuleFieldOption[]): RuleFieldOption[] {
  if (showSystemFields.value) return all
  return all.filter((f) => !isSystemField(f))
}
const inputFieldPool = computed(() => selectableFields(props.inputFieldOptions))
const outputFieldPool = computed(() => selectableFields(props.outputFieldOptions))
const allInputSelected = computed(() => inputFieldPool.value.length > 0 && inputFieldPool.value.every((f) => props.modelValue.inputFields?.includes(f.itemCode)))
const allOutputSelected = computed(() => outputFieldPool.value.length > 0 && outputFieldPool.value.every((f) => props.modelValue.outputFields?.includes(f.itemCode)))

// 折叠/展开按钮文案（收起已选字段那一排后，"选了多少个"这个信息只剩这一处能看到，展开态也不能丢）：
// 全选说"已全选 N 个"；部分选说"已选 x/N 个"；一个没选说"共 N 个可选"；展开时额外带上"收起"提示操作。
function fieldToggleLabel(expanded: boolean, allSelected: boolean, selectedCount: number, poolSize: number) {
  const countText = allSelected ? `已全选 ${poolSize} 个` : selectedCount > 0 ? `已选 ${selectedCount}/${poolSize} 个` : `共 ${poolSize} 个可选`
  return expanded ? `▾ 收起（${countText}）` : `▸ ${countText}`
}

// 入参字段默认全选（0804 拍板）：表选完、字段异步加载完成后自动勾满非系统字段，用户可以再手动取消。
// 触发条件只看"字段池非空 + 当前未选任何字段"，不额外记"是不是刚选的表"——
// 字段池一旦拉到手（父级按 tableId 缓存），这个 watch 源引用不再变化，之后用户清空选择也不会被重新勾上；
// 回读历史流程（inputFields 已有值）同样不会被覆盖，因为条件直接不成立。
watch(() => props.inputFieldOptions, (options) => {
  if (!options.length || props.modelValue.inputFields?.length) return
  const codes = selectableFields(options).map((f) => f.itemCode)
  if (codes.length) patch({ inputFields: codes })
})

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

// 表搜索：输入表/输出表各自独立的搜索态，避免共用一份状态时互相打断。
// entryApi.entryPaged 不支持外部 AbortSignal（跟其他节点表配置共用同一个内部 20s 超时的 request()），
// 用 requestSeq 丢弃过期结果即可防止旧搜索覆盖新结果——不是真正中断网络请求，但已足够安全。
function useTableSearch() {
  const results = ref<EntryType[]>([])
  const loading = ref(false)
  const selected = ref<EntryType | null>(null)
  let requestSeq = 0
  async function runSearch(keyword: string) {
    const seq = ++requestSeq
    loading.value = true
    try {
      const paged = await entryApi.entryPaged({ name: keyword || undefined, size: 20 })
      if (seq !== requestSeq) return // 有更新的搜索已发出，丢弃这次的结果
      results.value = paged.list
    } catch (e) {
      if (seq !== requestSeq) return
      ElMessage.error(`搜索表失败：${(e as Error)?.message ?? String(e)}`)
    } finally {
      if (seq === requestSeq) loading.value = false
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

// 回读历史流程：modelValue 里已经有 inputTableId/outputTableId，但 renderOptions 只认
// 「用户在这次会话里搜过/选过」的表——回显时 selected 还是初始的 null，el-select 找不到
// 对应 el-option 的 label，只能把裸 tableId 显示出来（就是「输入表」框里出现一串数字的原因）。
// 先用 modelValue 自带的物理表名兜底垫上，再异步查 entryDetail 换成带业务名的完整 label；
// 查询失败不影响可用性，兜底的物理表名已经比裸 ID 可读。
//
// 实测坑（2026-09-01）：只做上面这步还是会卡在兜底文案不动——tableId 没变时 <el-option> 的
// :key 不变，Vue 复用同一个 vnode，el-select 内部缓存的"当前选中项 label"不会跟着 label 属性的
// 新值重新取；下面两处 <el-option> 的 key 必须把 label 一起编进去，label 变了才会强制换新 vnode。
async function hydrateSelected(search: ReturnType<typeof useTableSearch>, tableId: string | undefined, fallbackName: string | undefined) {
  if (!tableId) {
    search.selected.value = null
    return
  }
  if (search.selected.value?.tableId === tableId) return
  search.selected.value = { tableId, tableName: fallbackName || tableId, fields: [] }
  try {
    const detail = await entryApi.entryDetail(tableId)
    if (detail && search.selected.value?.tableId === tableId) search.selected.value = detail
  } catch {
    // 保底的物理表名已经够用，查详情失败不打断编辑
  }
}
watch(() => props.modelValue.inputTableId, (id) => { void hydrateSelected(inputTableSearch, id, props.modelValue.inputTable) }, { immediate: true })
watch(() => props.modelValue.outputTableId, (id) => { void hydrateSelected(outputTableSearch, id, props.modelValue.outputTable) }, { immediate: true })

function onInputTableFilter(query: string) {
  inputTableSearch.debouncedSearch(query)
}
function onInputTableVisible(open: boolean) {
  if (open && !inputTableSearch.results.value.length) void inputTableSearch.runSearch('')
}
function onOutputTableFilter(query: string) {
  outputTableSearch.debouncedSearch(query)
}
function onOutputTableVisible(open: boolean) {
  if (open && !outputTableSearch.results.value.length) void outputTableSearch.runSearch('')
}
function tableOptionLabel(t: EntryType) {
  return `${t.name || t.tableName} · ${t.tableName}`
}

// 未显式选输出表时，占位文字直接展示会兑现成哪张表（跟 effectiveOutputTable 的口径一致），
// 而不是一句不指名道姓的说明——不然用户看不出"默认"具体指的是哪张表。
const outputTablePlaceholder = computed(() => {
  const input = inputTableSearch.selected.value
  return input ? `默认 = ${tableOptionLabel(input)}` : '默认 = 输入表；可输入筛选'
})

function onInputTableId(tableId: string | undefined | null) {
  const id = tableId ?? ''
  const table = inputTableSearch.renderOptions.value.find((t) => t.tableId === id)
  inputTableSearch.selected.value = table ?? null
  patch({ inputTableId: id, inputTable: table?.tableName ?? '', inputFields: [] })
}
function onOutputTableId(tableId: string | undefined | null) {
  const id = tableId ?? ''
  const table = outputTableSearch.renderOptions.value.find((t) => t.tableId === id)
  outputTableSearch.selected.value = table ?? null
  patch({ outputTableId: id, outputTable: table?.tableName ?? '', outputFields: [] })
}

// 新建表仅用于输出表：规则输入表必须选择已有表，避免在规则节点内创建孤立输入表。
// 建表本身走通用的实体表注册（entrySave），跟表配置共用同一个 TableEditDialog；
// 新表存进搜索结果并选中，不依赖下一次搜索能不能马上查到它。
const newTableDialog = reactive<{ open: boolean }>({ open: false })
function openNewTable() {
  newTableDialog.open = true
}
function injectCreatedTable(search: typeof outputTableSearch, entry: EntryType) {
  if (!search.results.value.some((t) => t.tableId === entry.tableId)) {
    search.results.value = [entry, ...search.results.value]
  }
}
async function onNewTableSaved(tableId: string) {
  const entry = await entryApi.entryDetail(tableId)
  injectCreatedTable(outputTableSearch, entry)
  onOutputTableId(tableId)
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
  <div class="rc-field"><label>输入表 *</label>
    <div class="rc-select-row">
      <el-select
        class="rc-table-select"
        :model-value="modelValue.inputTableId || undefined"
        filterable
        remote
        clearable
        :remote-method="onInputTableFilter"
        :loading="inputTableSearch.loading.value"
        placeholder="输入关键词搜索表，如 email、公告…"
        @update:model-value="onInputTableId"
        @visible-change="onInputTableVisible"
      >
        <el-option
          v-for="t in inputTableSearch.renderOptions.value"
          :key="`${t.tableId}:${tableOptionLabel(t)}`"
          :label="tableOptionLabel(t)"
          :value="t.tableId"
        />
      </el-select>
    </div>
  </div>

  <div class="rc-field"><label>入参字段 *</label>
    <div v-if="!modelValue.inputTableId" class="rc-readonly-hint">请先选择输入表</div>
    <template v-else>
      <div class="rc-tag-row">
        <!-- 展开时已选字段在下面的字段池里高亮，这里不再重复列一遍——避免字段多的时候占两排 -->
        <template v-if="!inputExpanded">
          <span v-if="!modelValue.inputFields?.length" class="rc-readonly-hint rc-tag-empty">未选择</span>
          <span v-for="code in modelValue.inputFields" :key="code" class="rc-tag on" @click="toggleField('input', code)">
            {{ inputFieldOptions.find((f) => f.itemCode === code)?.itemName ?? code }} ×
          </span>
        </template>
        <button class="rc-tag-toggle" type="button" @click="inputExpanded = !inputExpanded">
          {{ fieldToggleLabel(inputExpanded, allInputSelected, modelValue.inputFields?.length ?? 0, inputFieldPool.length) }}
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

  <div v-if="!hideOutput" class="rc-field"><label>输出表（可选，默认使用输入表）</label>
    <div class="rc-select-row">
      <el-select
        class="rc-table-select"
        :model-value="modelValue.outputTableId || undefined"
        filterable
        remote
        clearable
        :remote-method="onOutputTableFilter"
        :loading="outputTableSearch.loading.value"
        :placeholder="outputTablePlaceholder"
        @update:model-value="onOutputTableId"
        @visible-change="onOutputTableVisible"
      >
        <el-option
          v-for="t in outputTableSearch.renderOptions.value"
          :key="`${t.tableId}:${tableOptionLabel(t)}`"
          :label="tableOptionLabel(t)"
          :value="t.tableId"
        />
      </el-select>
      <button class="rc-input-btn" type="button" @click="openNewTable">＋ 新建表</button>
    </div>
    <div v-if="availablePresets.length" class="rc-preset-tables" data-testid="rule-table-presets">
      <span class="rc-preset-label">常用默认表：</span>
      <button
        v-for="preset in availablePresets"
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

  <div v-if="!hideOutput" class="rc-field"><label>出参字段 *</label>
    <div v-if="!modelValue.inputTableId" class="rc-readonly-hint">请先选择输入表</div>
    <template v-else>
      <div class="rc-tag-row">
        <!-- 展开时已选字段在下面的字段池里高亮，这里不再重复列一遍——避免字段多的时候占两排 -->
        <template v-if="!outputExpanded">
          <!-- 空态必须说清后果（0903）：出参字段默认不勾（会上口径「出参肯定就两三个，让他自己勾」），
               而保存节点配置时它是必填。两者相加 = 新建规则节点第一次保存**必然**被拦，
               而拦下来只有一个 3 秒就消失的 toast + 静默跳 tab，用户以为存上了、离开、节点就没了。
               在字段本身写明"不选就存不了"，比事后弹一次提示有用得多。 -->
          <span v-if="!modelValue.outputFields?.length" class="rc-readonly-hint rc-tag-empty rc-tag-required">未选择 · 至少选 1 个才能保存</span>
          <span v-for="code in modelValue.outputFields" :key="code" class="rc-tag on" @click="toggleField('output', code)">
            {{ outputFieldOptions.find((f) => f.itemCode === code)?.itemName ?? code }} ×
          </span>
        </template>
        <button class="rc-tag-toggle" type="button" @click="outputExpanded = !outputExpanded">
          {{ fieldToggleLabel(outputExpanded, allOutputSelected, modelValue.outputFields?.length ?? 0, outputFieldPool.length) }}
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

  <TableEditDialog v-model:open="newTableDialog.open" @saved="onNewTableSaved" />
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
.rc-select-row { display: flex; align-items: stretch; gap: 8px; }
.rc-select-row .rc-table-select { flex: 1; }
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.rc-tag-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rc-tag-required { color: #b91c1c; }
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
