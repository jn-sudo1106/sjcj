<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { metricApi, type Dataset, type Measure } from '../../api'
import { useUiStore } from '../../stores/ui'

const ui = useUiStore()

const datasets = ref<Dataset[]>([])
const activeDataset = ref('')
const measures = ref<Measure[]>([])
const selected = ref<Measure | null>(null)
const stats = reactive({ datasets: 0, measures: 0, canvasRefs: 0, sqlPending: 0 })

async function loadMeasures() {
  measures.value = await metricApi.measures(activeDataset.value || undefined)
  selected.value = measures.value[0] ?? null
}
watch(activeDataset, loadMeasures)

function dsMeta(s: string) {
  if (s === 'ready') return { cls: 'ok', text: '就绪' }
  if (s === 'building') return { cls: 'run', text: '构建中' }
  return { cls: 'warn', text: '待更新' }
}
function gateMeta(g: string) {
  if (g === 'pass') return { cls: 'ok', text: '可发布' }
  if (g === 'warn') return { cls: 'warn', text: '待校验' }
  return { cls: 'err', text: '未通过' }
}
const selectedDataset = computed(() => datasets.value.find((d) => d.datasetId === selected.value?.datasetId) ?? null)

onMounted(async () => {
  datasets.value = await metricApi.datasets()
  Object.assign(stats, await metricApi.metricStats())
  await loadMeasures()
  ui.registerAction('新建指标', () => ElMessage.info('新建指标：演示环境占位'))
  ui.registerAction('批量维护', () => ElMessage.info('批量维护：演示环境占位'))
  ui.registerAction('口径校验', () =>
    ElMessage({ type: stats.sqlPending ? 'warning' : 'success', message: `口径校验：${stats.sqlPending} 项 SQL 白名单 / 门禁待处理` }),
  )
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="mc-layout">
    <!-- 数据集层 -->
    <div class="rc-card mc-ds">
      <div class="rc-card-head">
        <div>
          <div class="rc-card-title">数据集</div>
          <div class="rc-card-sub">dataset 层 · 来源表与字段范围</div>
        </div>
      </div>
      <div class="mc-ds-scroll">
        <div class="rc-tree-row" :class="{ active: activeDataset === '' }" @click="activeDataset = ''">
          <span>全部数据集</span><span class="rc-count">{{ datasets.length }}</span>
        </div>
        <button
          v-for="d in datasets"
          :key="d.datasetId"
          class="mc-ds-item"
          :class="{ active: activeDataset === d.datasetId }"
          type="button"
          @click="activeDataset = d.datasetId"
        >
          <div class="mc-ds-top">
            <strong>{{ d.name }}</strong>
            <span class="rc-status" :class="dsMeta(d.state).cls">{{ dsMeta(d.state).text }}</span>
          </div>
          <div class="muted mc-ds-tb">{{ d.sourceTable }}</div>
          <div class="muted">{{ d.fields.length }} 字段 · 更新 {{ d.updatedAt }}</div>
        </button>
      </div>
    </div>

    <!-- 指标层 -->
    <div class="rc-card mc-main">
      <div class="rc-metric-grid mc-kpis">
        <div class="rc-metric"><span>指标数据集</span><b>{{ stats.datasets }}</b></div>
        <div class="rc-metric"><span>指标定义</span><b>{{ stats.measures }}</b></div>
        <div class="rc-metric"><span>画布引用</span><b>{{ stats.canvasRefs }}</b></div>
        <div class="rc-metric"><span>SQL 白名单待审批</span><b class="danger">{{ stats.sqlPending }}</b></div>
      </div>
      <div class="rc-table-scroll mc-table">
        <table class="rc-data-table">
          <thead>
            <tr>
              <th>指标</th>
              <th style="width: 80px">周期</th>
              <th style="width: 110px">负责人</th>
              <th style="width: 80px">画布引用</th>
              <th style="width: 88px">门禁</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in measures" :key="m.measureId" :class="{ active: selected?.measureId === m.measureId }" @click="selected = m">
              <td>
                <button class="mc-name" type="button">{{ m.name }}</button>
                <div class="muted mc-caliber">{{ m.caliber }}</div>
              </td>
              <td>{{ m.cycle }}</td>
              <td>{{ m.owner }}</td>
              <td>{{ m.canvasRefs }}</td>
              <td><span class="rc-status" :class="gateMeta(m.gate).cls">{{ gateMeta(m.gate).text }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 指标详情 + 回溯 -->
    <div class="rc-card mc-detail">
      <div class="rc-card-head">
        <div class="rc-card-title">指标详情</div>
      </div>
      <div v-if="selected" class="rc-detail">
        <div class="mc-d-title">{{ selected.name }}</div>
        <dl class="rc-kv">
          <dt>来源数据集</dt><dd>{{ selectedDataset?.name || selected.datasetId }}</dd>
          <dt>周期</dt><dd>{{ selected.cycle }}</dd>
          <dt>负责人</dt><dd>{{ selected.owner }}</dd>
          <dt>画布引用</dt><dd>{{ selected.canvasRefs }} 处</dd>
        </dl>

        <div class="mc-section">轻编辑器（只读预览）</div>
        <dl class="rc-kv">
          <dt>聚合</dt><dd>{{ selected.caliber }}</dd>
          <dt>维度</dt><dd>{{ selectedDataset?.fields.slice(0, 2).join('、') || '—' }}</dd>
          <dt>过滤</dt><dd>—</dd>
        </dl>

        <div class="mc-section">发布门禁</div>
        <div class="mc-gates">
          <div class="mc-gate"><span>来源表字段存在</span><span class="rc-status ok">通过</span></div>
          <div class="mc-gate">
            <span>SQL 条件白名单</span>
            <span class="rc-status" :class="gateMeta(selected.gate).cls">{{ gateMeta(selected.gate).text }}</span>
          </div>
          <div class="mc-gate"><span>结果回溯</span><span class="rc-status ok">通过</span></div>
        </div>

        <div class="mc-section">结果回溯链路</div>
        <div class="mc-chain">
          <span class="mc-chip">{{ selectedDataset?.name }}</span>
          <i>→</i>
          <span class="mc-chip">{{ selectedDataset?.sourceTable }}</span>
          <i>→</i>
          <span class="mc-chip">采集源</span>
          <i>→</i>
          <span class="mc-chip">运行任务</span>
        </div>
        <div class="rc-mini-card">回溯口径：dataset → table → source → task；点链路在二期跳转运行记录定位。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mc-layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 340px;
  gap: 12px;
}
.mc-ds, .mc-main, .mc-detail {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 168px);
  min-height: 560px;
}
.mc-ds-scroll {
  flex: 1;
  overflow: auto;
  padding: 10px;
}
.rc-tree-row {
  cursor: pointer;
}
.mc-ds-item {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.mc-ds-item.active {
  border-color: var(--rc-primary);
  box-shadow: var(--rc-glow-blue);
}
.mc-ds-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.mc-ds-top strong {
  font-size: 13px;
  color: var(--rc-text);
}
.mc-ds-tb {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  margin-bottom: 2px;
}
.mc-kpis {
  padding: 14px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.mc-table {
  flex: 1;
}
.rc-data-table tbody tr {
  cursor: pointer;
}
.mc-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.mc-caliber {
  margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-detail .rc-detail {
  overflow: auto;
}
.mc-d-title {
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 700;
  color: var(--rc-text);
}
.mc-section {
  margin: 16px 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--rc-text);
}
.mc-gates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mc-gate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--rc-text-2);
}
.mc-chain {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.mc-chain i {
  color: var(--rc-faint);
  font-style: normal;
}
.mc-chip {
  padding: 4px 10px;
  border: 1px solid var(--rc-border);
  border-radius: 999px;
  background: var(--rc-primary-bg);
  color: var(--rc-primary-ink);
  font-size: 12px;
}

@media (max-width: 1240px) {
  .mc-layout {
    grid-template-columns: 1fr;
  }
  .mc-ds, .mc-main, .mc-detail {
    height: auto;
  }
}
</style>
