<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { type SourceCheckLog } from '@/api'
import { pagedCheckJobLogs } from '@/api/monitor'
const props = defineProps<{
  sourceId: string
  jobId?: string
}>()
const open = ref(false)
const rows = ref<SourceCheckLog[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(20)
const stateFilter = ref('')
const nameFilter = ref('')
const titleName = ref('')

const filters = reactive({
  sourceId: props.sourceId,
  jobId: props.jobId,
  state: '',
  name: '',
})

async function load() {
  if (!filters.sourceId) { rows.value = []; total.value = 0; return }
  loading.value = true
  try {
    // 入参逐字段对齐旧 api/monitor.js 的 pagedCheckJobLogs（sourceId/jobId/state/name + page/limit）
    const res = await pagedCheckJobLogs({
      sourceId: filters.sourceId,
      jobId: filters.jobId,
      state: filters.state || undefined,
      name: filters.name || undefined,
      page: page.value,
      limit: size.value,
    })
    rows.value = res.list
    total.value = res.total
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载日志失败')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}
function runQuery() {
  filters.state = stateFilter.value
  filters.name = nameFilter.value.trim()
  page.value = 1
  void load()
}
function reset() {
  stateFilter.value = ''
  nameFilter.value = ''
  runQuery()
}

// 对外：让父组件可以打开抽屉
defineExpose({
  show(sourceId: string, jobId?: string, monitorName?: string) {
    filters.sourceId = sourceId
    filters.jobId = jobId
    nameFilter.value = ''
    stateFilter.value = ''
    filters.name = ''
    filters.state = ''
    page.value = 1
    titleName.value = monitorName || ''
    open.value = true
    void load()
  },
})

function stateClass(state: string) {
  return state === 'E' ? 'sc-log-err' : 'sc-log-ok'
}
</script>

<template>
  <el-drawer
    v-model="open"
    :title="titleName ? `校验历史日志 · ${titleName}` : '校验历史日志'"
    direction="rtl"
    size="75%"
    destroy-on-close
    v-loading="loading"
  >
    <!-- 轻量筛选 -->
    <div class="cl-filters">
      <span class="cl-field">源: <span class="mono">{{ filters.sourceId }}</span></span>
      <el-select v-model="stateFilter" class="cl-select" size="small" clearable placeholder="状态（全部）">
        <el-option label="告警" value="E" />
        <el-option label="正常" value="C" />
      </el-select>
      <el-input v-model="nameFilter" class="cl-name" size="small" placeholder="日志名 / 内容" clearable @keyup.enter="runQuery" />
      <button class="rc-btn primary" type="button" @click="runQuery">查询</button>
      <button class="rc-btn" type="button" @click="reset">重置</button>
    </div>

    <el-table :data="rows" border stripe size="small" row-key="logId" class="cl-table">
      <el-table-column label="时间" width="170" prop="createDt" class-name="mono-cell" />
      <el-table-column label="消息" min-width="300" prop="logMsg" show-overflow-tooltip>
        <template #default="{ row }">
          <span :class="stateClass(row.state)">{{ row.logMsg }}</span>
        </template>
      </el-table-column>
      <el-table-column label="名称" width="180" prop="name" show-overflow-tooltip />
      <el-table-column label="状态" width="80" align="center" prop="state">
        <template #default="{ row }">
          <span :class="row.state === 'E' ? 'sc-badge sc-badge-err' : 'sc-badge sc-badge-ok'">
            {{ row.state === 'E' ? '告警' : row.state === 'C' ? '正常' : row.state }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90" prop="logType" />
      <el-table-column label="表名" min-width="160" prop="tableName" show-overflow-tooltip />
      <el-table-column label="源" width="110" prop="sourceId" class-name="mono-cell" />
    </el-table>

    <div class="sc-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 30, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="load"
        @size-change="() => { page = 1; load() }"
      />
    </div>
  </el-drawer>
</template>

<style scoped>
.cl-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.cl-field {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.cl-select {
  width: 120px;
  height: 28px;
}
.cl-name {
  width: 180px;
}
.cl-table {
  width: 100%;
}
.mono-cell {
  font-family: var(--rc-mono, monospace);
  font-size: 11px;
}
.mono {
  font-family: var(--rc-mono, monospace);
}
.sc-pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.sc-log-err {
  color: var(--rc-error, #dc2626);
}
.sc-log-ok {
  color: var(--rc-ok, #15803d);
}
.sc-badge {
  display: inline-flex;
  align-items: center;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
}
.sc-badge-err {
  color: var(--rc-error, #dc2626);
  background: #fef2f2;
}
.sc-badge-ok {
  color: var(--rc-ok, #15803d);
  background: #f0fdf4;
}
</style>
