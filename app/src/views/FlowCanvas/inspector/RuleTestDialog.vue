<script setup lang="ts">
// 全屏测试台（L3 弹层，0801 方案 §6.5，拍板 #12）：常态 372px / 展开 680px / 60vw 都放不下
// 「ENTRY_ID + 14 个入参列」的左右分栏，必须走全屏 Dialog。
//
// 相对旧系统的七项改动（对应旧问题见方案 §3.1）：
//   A. 砍掉二级「测试数据」弹窗，左栏直接是数据列表
//   B. 点行即选中即回填，无需二次确认
//   C. 左栏列 = 入参字段（itemName 表头，columnName 取值），不是物理列名
//   D. 筛选走 dataApi.rowQueryPaged 的 sql 条件（简单输入框，会议 20:51/22:41）
//   E. 右栏入参可改：只进本次 params，切换行即重置，不写库（会议 20:51，严禁 data/rowUpdate）
//   F. 出参按字段纵向、多条记录横向铺开（一条输入可产出多条输出，方案 §4.4）
//   G.「查看详情」= 看选中行全部原始列，按需弹层（会议 24:02，拍板 #10）
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, ruleApi, type DataRow, type RuleFieldOption, type RuleOrchestrationTestResult } from '@/api'
import { mapRowToInputFields } from '@/utils/flow/ruleOrchestration'

const props = defineProps<{
  open: boolean
  ruleId?: string
  script: string
  inputTable: string
  inputTableId: string
  inputFields: string[]
  outputFields: string[]
  fields: RuleFieldOption[]
}>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

function close() {
  emit('update:open', false)
}

const PAGE_SIZE = 20
const keyword = ref('')
const page = ref(1)
const rows = ref<DataRow[]>([])
const total = ref(0)
const loading = ref(false)

async function loadRows() {
  if (!props.inputTableId) return
  loading.value = true
  try {
    const res = await dataApi.rowQueryPaged({ tableId: props.inputTableId, page: page.value, size: PAGE_SIZE, sql: keyword.value.trim() || undefined })
    rows.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}
function onSearch() {
  page.value = 1
  void loadRows()
}
function onPageChange(p: number) {
  page.value = p
  void loadRows()
}
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

// 入参字段按 seq 排序展示（负数系统字段本就不会出现在 inputFields 里，见 §4.3 RuleFieldOption.seq 注释）
const inputFieldOptions = computed(() =>
  props.inputFields.map((code) => props.fields.find((f) => f.itemCode === code) ?? { itemCode: code, itemName: code }),
)
function fieldLabel(code: string) {
  return props.fields.find((f) => f.itemCode === code)?.itemName ?? code
}

const selectedRow = ref<DataRow | null>(null)
const paramValues = ref<Record<string, string>>({})
const result = ref<RuleOrchestrationTestResult | null>(null)
const detailOpen = ref(false)

function selectRow(row: DataRow) {
  selectedRow.value = row
  paramValues.value = mapRowToInputFields(row.values ?? {}, props.inputFields, props.fields)
  result.value = null
}
function onParamInput(code: string, e: Event) {
  paramValues.value = { ...paramValues.value, [code]: (e.target as HTMLInputElement).value }
}

const testing = ref(false)
async function onExecute() {
  if (!selectedRow.value) {
    ElMessage.warning('请先在左侧选中一行数据')
    return
  }
  testing.value = true
  try {
    result.value = await ruleApi.orchestrationTest({
      ruleId: props.ruleId,
      script: props.script,
      inputTable: props.inputTable,
      inputFields: props.inputFields,
      outputFields: props.outputFields,
      // 左栏单选（会议 20:51），rows 恒为 1 条；严禁改源数据，改值只进这里的 params
      rows: [paramValues.value],
    })
    if (!result.value.success) ElMessage.warning(result.value.error || '测试未通过')
  } finally {
    testing.value = false
  }
}

// 出参：一条输入可产出多条输出（0801 方案 §4.4），按字段纵向、记录横向铺开
const outputRowKeys = computed(() => {
  const keys = new Set<string>()
  for (const output of result.value?.outputs ?? []) Object.keys(output).forEach((k) => keys.add(k))
  return [...keys]
})
function outputCell(index: number, key: string) {
  const v = result.value?.outputs?.[index]?.[key]
  return v == null ? '—' : String(v)
}

watch(() => props.open, (v) => {
  if (!v) return
  keyword.value = ''
  page.value = 1
  selectedRow.value = null
  paramValues.value = {}
  result.value = null
  void loadRows()
})
</script>

<template>
  <el-dialog :model-value="open" title="测试脚本" width="90vw" top="5vh" :close-on-click-modal="false" @update:model-value="close">
    <div class="rtd-head">输入表 {{ inputTable }} · 共 {{ total }} 行</div>
    <div class="rtd-body">
      <div class="rtd-col rtd-col-left">
        <div class="rtd-search">
          <input class="rc-input" v-model="keyword" placeholder="筛选（SQL 条件，如 K1='2025'）" @keyup.enter="onSearch" />
          <button class="rc-btn" type="button" @click="onSearch">查询</button>
        </div>
        <div v-if="loading" class="rc-help">加载中...</div>
        <div v-else class="rtd-rows">
          <label v-for="row in rows" :key="row.dataId" class="rtd-row" :class="{ active: selectedRow?.dataId === row.dataId }">
            <input type="radio" name="rtd-row" :checked="selectedRow?.dataId === row.dataId" @change="selectRow(row)" />
            <span class="rtd-row-id">{{ row.dataId }}</span>
            <span
              v-for="opt in inputFieldOptions" :key="opt.itemCode" class="rtd-row-cell"
              :title="mapRowToInputFields(row.values ?? {}, [opt.itemCode], fields)[opt.itemCode] || ''"
            >{{ mapRowToInputFields(row.values ?? {}, [opt.itemCode], fields)[opt.itemCode] || '—' }}</span>
          </label>
          <div v-if="!rows.length" class="rc-help">无匹配数据</div>
        </div>
        <div class="rtd-pager">
          <button class="rc-btn" type="button" :disabled="page <= 1" @click="onPageChange(page - 1)">‹</button>
          <span>{{ page }} / {{ totalPages }}</span>
          <button class="rc-btn" type="button" :disabled="page >= totalPages" @click="onPageChange(page + 1)">›</button>
        </div>
      </div>

      <div class="rtd-col rtd-col-right">
        <div class="rtd-right-head">
          <b>入参（{{ inputFields.length }}）</b>
          <div class="rtd-right-actions">
            <button class="rc-btn" type="button" :disabled="!selectedRow" @click="detailOpen = true">查看详情</button>
            <button class="rc-btn primary" type="button" :disabled="!selectedRow || testing" @click="onExecute">
              {{ testing ? '执行中...' : '执行' }}
            </button>
          </div>
        </div>
        <div v-if="!selectedRow" class="rc-help">请先在左侧选中一行数据</div>
        <template v-else>
          <div class="rtd-param-list">
            <div v-for="code in inputFields" :key="code" class="rtd-param-row">
              <label>{{ fieldLabel(code) }}</label>
              <input class="rc-input" :value="paramValues[code] ?? ''" :title="paramValues[code] ?? ''" @input="onParamInput(code, $event)" />
            </div>
          </div>

          <div class="rtd-result-head">
            <b>出参结果</b>
            <span v-if="result">⏱{{ result.executionTime.toFixed(2) }}s · {{ result.outputs?.length ?? 0 }} 条</span>
          </div>
          <div v-if="result && !result.success" class="rc-help rtd-error">{{ result.error || '测试未通过' }}</div>
          <div v-if="result?.outputs?.length" class="rtd-output-wrap">
            <table class="rtd-output-table">
              <thead>
                <tr>
                  <th>出参字段</th>
                  <th v-for="(_, i) in result.outputs" :key="i">记录{{ i + 1 }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="key in outputRowKeys" :key="key">
                  <td>{{ fieldLabel(key) }}</td>
                  <td v-for="(_, i) in result.outputs" :key="i" :title="outputCell(i, key)">{{ outputCell(i, key) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>

    <el-dialog v-model="detailOpen" title="数据详情" width="640px" append-to-body>
      <div v-if="selectedRow" class="rtd-detail">
        <div class="rtd-detail-row"><b>数据 ID</b><span>{{ selectedRow.dataId }}</span></div>
        <div v-for="(v, k) in selectedRow.values ?? {}" :key="k" class="rtd-detail-row">
          <b>{{ k }}</b><span>{{ v == null ? '—' : String(v) }}</span>
        </div>
      </div>
    </el-dialog>
  </el-dialog>
</template>

<style scoped>
.rtd-head { color: var(--rc-faint); font-size: 12px; margin-bottom: 10px; }
.rtd-body { display: grid; grid-template-columns: minmax(320px, 1fr) minmax(360px, 1fr); gap: 16px; height: 68vh; }
.rtd-col { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid #eef2f7; border-radius: 8px; padding: 10px; overflow: hidden; }
.rtd-search { display: flex; gap: 8px; margin-bottom: 8px; }
.rtd-search .rc-input { flex: 1; }
.rtd-rows { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 4px; }
.rtd-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.rtd-row:hover { background: #f8fafc; }
.rtd-row.active { background: var(--rc-primary-bg); }
.rtd-row-id { color: var(--rc-faint); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; flex-shrink: 0; padding-right: 8px; border-right: 1px solid #eef2f7; }
.rtd-row-cell { flex: 1; min-width: 0; color: var(--rc-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rtd-pager { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 8px; font-size: 12px; color: var(--rc-text-2); }
.rtd-right-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.rtd-right-actions { display: flex; gap: 8px; }
.rtd-param-list { flex: 0 0 auto; max-height: 34vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.rtd-param-row { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 8px; }
.rtd-param-row label { font-size: 12px; color: var(--rc-muted); }
.rtd-result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; color: var(--rc-text-2); }
.rtd-error { color: #b91c1c; }
.rtd-output-wrap { max-width: 100%; overflow-x: auto; }
.rtd-output-table { border-collapse: collapse; font-size: 12px; table-layout: auto; }
.rtd-output-table th, .rtd-output-table td { border: 1px solid #eef2f7; padding: 6px 8px; text-align: left; white-space: nowrap; }
.rtd-output-table th { background: #f8fafc; color: var(--rc-text-2); }
.rtd-output-table th:first-child, .rtd-output-table td:first-child { position: sticky; left: 0; background: #fff; font-weight: 600; color: var(--rc-text); }
.rtd-output-table th:first-child { background: #f8fafc; }
.rtd-output-table td:not(:first-child) { max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
.rtd-detail { display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow: auto; }
.rtd-detail-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
.rtd-detail-row b { color: var(--rc-text); flex-shrink: 0; }
.rtd-detail-row span { color: var(--rc-text-2); text-align: right; word-break: break-all; }
.rc-input { border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; box-sizing: border-box; width: 100%; overflow: hidden; text-overflow: ellipsis; }
.rc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-help { color: var(--rc-faint); font-size: 11px; line-height: 1.5; }
</style>
