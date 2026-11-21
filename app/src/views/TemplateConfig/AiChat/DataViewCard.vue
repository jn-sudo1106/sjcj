<script setup lang="ts">
// 图表/明细数据卡：趋势柱状、占比饼图、明细数据表三视图 + 导出。
// 从对话页拆出以便按需加载（首条含 chartData 的消息出现再拉取本组件）。
import { computed, ref, watch } from 'vue'
import { Download } from '@element-plus/icons-vue'
import type { ChatMessage, PieSlice } from '@/api/aiChat'
import AiPieChart from './AiPieChart.vue'

type DataView = 'chart' | 'pie' | 'table'

const props = defineProps<{
  chartData: NonNullable<ChatMessage['chartData']>
  kpis?: ChatMessage['kpis']
  view: DataView
}>()

const emit = defineEmits<{
  (e: 'update:view', view: DataView): void
  (e: 'export', format: 'excel' | 'csv'): void
}>()

// 明细表分页渲染：千行结果不再一次性铺 DOM；导出仍走全量（由父级处理）
const TABLE_PAGE_SIZE = 100
const tablePage = ref(1)
const totalRows = computed(() => props.chartData.tableRows?.length ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / TABLE_PAGE_SIZE)))
const pagedRows = computed(() => {
  const rows = props.chartData.tableRows ?? []
  if (rows.length <= TABLE_PAGE_SIZE) return rows
  const start = (tablePage.value - 1) * TABLE_PAGE_SIZE
  return rows.slice(start, start + TABLE_PAGE_SIZE)
})
watch(
  () => props.chartData,
  () => {
    tablePage.value = 1
  },
)
function goTablePage(page: number) {
  tablePage.value = Math.min(Math.max(1, page), totalPages.value)
}

function getSlices(): PieSlice[] {
  if (props.chartData.slices && props.chartData.slices.length > 0) {
    return props.chartData.slices
  }
  if (!props.chartData.bars || props.chartData.bars.length === 0) return []
  return props.chartData.bars.map((bar) => {
    const cleanLabel = bar.label.replace(/^\d+\.\s*/, '').split('(')[0].trim() || bar.label
    return {
      label: cleanLabel,
      value: bar.value,
      displayValue: bar.displayValue,
      color:
        bar.color === 'red' ? '#dc2626'
        : bar.color === 'orange' ? '#ea580c'
        : bar.color === 'green' ? '#16a34a'
        : '#2563eb',
      tone:
        bar.color === 'red' ? 'err'
        : bar.color === 'green' ? 'ok'
        : bar.color === 'orange' ? 'amber'
        : 'primary',
    }
  })
}

const pieCenter = computed(() => {
  if (props.kpis && props.kpis.length > 0) {
    return { value: props.kpis[0].value, label: props.kpis[0].label }
  }
  const sum = getSlices().reduce((acc, s) => acc + (Number(s.value) || 0), 0)
  return {
    value: sum > 0 ? (sum >= 1000 ? sum.toLocaleString() : String(sum)) : '',
    label: '样本总计',
  }
})
</script>

<template>
  <div class="rc-dataview-card">
    <div class="rc-dataview-head">
      <span class="rc-dataview-title">
        {{ view === 'pie' ? (chartData.pieTitle || '🥧 数据占比分布') : chartData.title }}
      </span>
      <div class="rc-dataview-actions">
        <!-- 分段控件替代 radio-group，更轻量（原型设计说明 ③） -->
        <div class="rc-segmented" role="tablist" data-testid="rc-dataview-segmented">
          <button
            v-for="opt in [
              { value: 'chart', label: '趋势图表' },
              { value: 'pie', label: '占比饼图' },
              { value: 'table', label: '明细数据表' },
            ]"
            :key="opt.value"
            type="button"
            class="rc-segmented-item"
            :class="{ active: view === opt.value }"
            role="tab"
            :aria-selected="view === opt.value"
            @click="emit('update:view', opt.value as 'chart' | 'pie' | 'table')"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- 趋势柱状视图 -->
    <div v-if="view === 'chart'" class="rc-chart-view">
      <div v-for="(bar, bidx) in chartData.bars" :key="bidx" class="rc-chart-item">
        <div class="rc-bar-header">
          <span class="rc-bar-title" :class="bar.color || 'warn'">{{ bar.label }}</span>
          <span class="rc-bar-val" :class="bar.color || 'warn'">{{ bar.displayValue }}</span>
        </div>
        <div class="rc-bar-track">
          <div
            class="rc-bar-fill"
            :class="bar.color || 'orange'"
            :style="{ width: `${Math.min(100, bar.value)}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 占比饼图视图 -->
    <div v-else-if="view === 'pie'" class="rc-pie-view">
      <AiPieChart
        :slices="getSlices()"
        :center-label="pieCenter.label"
        :center-value="pieCenter.value"
      />
    </div>

    <!-- 明细表格视图 -->
    <div v-else class="rc-table-view">
      <div class="rc-table-meta-bar">
        <span class="rc-table-records-count">共 {{ totalRows }} 条明细记录</span>
        <div class="rc-table-quick-export">
          <el-button
            size="small"
            link
            type="primary"
            data-testid="rc-table-export-excel"
            @click="emit('export', 'excel')"
          >
            <el-icon><Download /></el-icon>
            导出 Excel
          </el-button>
          <span class="rc-table-divider">|</span>
          <el-button
            size="small"
            link
            type="primary"
            data-testid="rc-table-export-csv"
            @click="emit('export', 'csv')"
          >
            <el-icon><Download /></el-icon>
            导出 CSV
          </el-button>
        </div>
      </div>
      <div class="rc-table-scroll-wrapper">
        <table class="rc-preview-table" data-testid="rc-preview-table">
          <thead>
            <tr>
              <th v-for="col in chartData.tableColumns" :key="col.prop">{{ col.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ridx) in pagedRows" :key="ridx">
              <td
                v-for="col in chartData.tableColumns"
                :key="col.prop"
                :class="{
                  'text-red': col.prop === 'fail',
                  'text-warn': col.prop === 'reason',
                }"
              >
                {{ row[col.prop] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="totalPages > 1" class="rc-table-pager" data-testid="rc-table-pager">
        <el-button size="small" :disabled="tablePage <= 1" @click="goTablePage(tablePage - 1)">
          上一页
        </el-button>
        <span class="rc-table-pager-info">第 {{ tablePage }} / {{ totalPages }} 页</span>
        <el-button size="small" :disabled="tablePage >= totalPages" @click="goTablePage(tablePage + 1)">
          下一页
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rc-dataview-card {
  margin-top: 12px;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: 10px;
  background: var(--rc-surface, #ffffff);
  padding: 14px 16px;
}
.rc-dataview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.rc-dataview-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text-1, #1e293b);
}
.rc-dataview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
/* 分段控件（原型设计说明 ③） */
.rc-segmented {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--rc-fill, #f1f5f9);
  border: 1px solid var(--rc-border-soft, #e2e8f0);
}
.rc-segmented-item {
  border: none;
  background: transparent;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
  line-height: 1;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.rc-segmented-item:hover {
  color: var(--rc-text-1, #1e293b);
}
.rc-segmented-item.active {
  background: var(--rc-surface, #ffffff);
  color: var(--rc-primary, #2563eb);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}
.rc-chart-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rc-bar-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}
.rc-bar-title {
  color: var(--rc-text-2, #475569);
}
.rc-bar-val {
  font-weight: 600;
}
.rc-bar-track {
  height: 8px;
  border-radius: 4px;
  background: var(--rc-fill, #f1f5f9);
  overflow: hidden;
}
.rc-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: #2563eb;
  transition: width 0.3s ease;
}
.rc-bar-fill.red { background: #dc2626; }
.rc-bar-fill.orange { background: #ea580c; }
.rc-bar-fill.green { background: #16a34a; }
.rc-bar-fill.cyan { background: #06b6d4; }
.rc-bar-fill.indigo { background: #6366f1; }
.rc-bar-fill.purple { background: #8b5cf6; }
.rc-bar-fill.primary { background: #2563eb; }
.rc-bar-title.red, .rc-bar-val.red { color: #dc2626; }
.rc-bar-title.orange, .rc-bar-val.orange { color: #ea580c; }
.rc-bar-title.green, .rc-bar-val.green { color: #16a34a; }
.rc-bar-title.warn, .rc-bar-val.warn { color: #d97706; }
.rc-pie-view {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}
.rc-table-meta-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.rc-table-records-count {
  font-size: 12px;
  color: var(--rc-muted, #64748b);
}
.rc-table-quick-export {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rc-table-divider {
  color: var(--rc-border, #e2e8f0);
}
.rc-table-scroll-wrapper {
  overflow: auto;
  max-height: 420px;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: 8px;
}
.rc-table-scroll-wrapper::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.rc-table-scroll-wrapper::-webkit-scrollbar-track {
  background: var(--rc-fill, #f1f5f9);
}
.rc-table-scroll-wrapper::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 4px;
}
.rc-table-scroll-wrapper::-webkit-scrollbar-thumb:hover {
  background: #64748b;
}
.rc-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.rc-preview-table th {
  position: sticky;
  top: 0;
  background: var(--rc-fill, #f8fafc);
  color: var(--rc-text-2, #475569);
  font-weight: 600;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border, #e2e8f0);
  text-align: left;
  white-space: nowrap;
}
.rc-preview-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--rc-border-soft, #f1f5f9);
  color: var(--rc-text-1, #334155);
}
.rc-preview-table tbody tr:hover {
  background: var(--rc-primary-bg, #f0f7ff);
}
.rc-preview-table .text-red {
  color: #dc2626;
  font-weight: 600;
}
.rc-preview-table .text-warn {
  color: #d97706;
}
.rc-table-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
}
.rc-table-pager-info {
  font-size: 12px;
  color: var(--rc-muted, #64748b);
}
</style>