<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { dataApi, type DataTableMeta, type RowQuery, type SummaryRow } from '../../api'

const props = defineProps<{
  modelValue: boolean
  tableMeta: DataTableMeta | null
  buildQuery: () => RowQuery
  /** 当前筛选命中行数，给用户预期；打开抽屉不发请求（大表会崩） */
  hitCount?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const fields = computed(() => props.tableMeta?.fields ?? [])
const summaryFields = ref<string[]>([])
const state = reactive<{ loading: boolean; rows: SummaryRow[] }>({ loading: false, rows: [] })

watch(() => props.modelValue, (v) => {
  if (!v) return
  summaryFields.value = []
  state.rows = []
})

const resultColumns = computed(() => summaryFields.value.filter((f) => f !== 'CNT'))
const coverage = computed(() => state.rows.reduce((sum, r) => sum + (r.CNT || 0), 0))

async function onSummary() {
  if (!summaryFields.value.length) {
    ElMessage.error('请至少选择一列作为统计列')
    return
  }
  state.loading = true
  try {
    state.rows = await dataApi.summaryData(props.buildQuery(), summaryFields.value)
  } catch (error) {
    ElMessage.error(`统计失败:${error instanceof Error ? error.message : String(error)}`)
  } finally {
    state.loading = false
  }
}
function onClear() {
  state.rows = []
  summaryFields.value = []
}
// 统计导出（方案 §7 开放项 1）：xlsx 依赖未拍板，降级 CSV，文件名口径不变
// CSV 转义遵循 RFC 4180：值含逗号/引号/换行时用双引号包裹，内部双引号转义为 ""
function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
function onExportCsv() {
  const cols = [...resultColumns.value, 'CNT']
  const lines = [cols.map(csvEscape).join(','), ...state.rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const tableName = (props.tableMeta?.tableName ?? '').split('.').pop() ?? ''
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const a = document.createElement('a')
  a.href = url
  a.download = `表字段_统计-${tableName}_${ymd}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <el-drawer v-model="visible" title="统计" size="900px">
    <p v-if="hitCount != null" class="sd-hit" data-testid="summary-hit-count">当前条件命中 {{ hitCount }} 行</p>
    <el-select v-model="summaryFields" multiple filterable placeholder="选择统计列，选完再点统计" style="width: 100%" data-testid="summary-fields">
      <el-option v-for="f in fields" :key="f.columnName" :label="`${f.desc}(${f.columnName})`" :value="f.columnName!" />
    </el-select>
    <div class="sd-toolbar">
      <button class="rc-btn primary" type="button" @click="onSummary">统计</button>
      <button class="rc-btn" type="button" @click="onClear">清空</button>
      <button class="rc-btn" type="button" :disabled="!state.rows.length" @click="onExportCsv">导出CSV</button>
    </div>
    <div v-if="state.rows.length" class="sd-tags">
      <span class="rc-mini-card">统计列:{{ resultColumns.join(',') }}</span>
      <span class="rc-mini-card">结果行数:{{ state.rows.length }}</span>
      <span class="rc-mini-card">覆盖数据量:{{ coverage }}</span>
    </div>
    <el-table v-loading="state.loading" :data="state.rows" style="width: 100%; margin-top: 12px">
      <el-table-column v-for="c in resultColumns" :key="c" :prop="c" :label="c" sortable />
      <el-table-column prop="CNT" label="CNT" sortable />
    </el-table>
  </el-drawer>
</template>

<style scoped>
.sd-hit { margin: 0 0 10px; color: var(--rc-muted); font-size: 12px; }
.sd-toolbar {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.sd-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
</style>
