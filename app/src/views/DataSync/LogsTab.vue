<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { View } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { syncApi, type SyncClient, type SyncCustomer, type SyncLog, type SyncStatistic, type SyncTask } from '@/api/dataSync'

const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
const customers = ref<SyncCustomer[]>([])
const clients = ref<SyncClient[]>([])
const taskChoices = ref<SyncTask[]>([])
const logs = ref<SyncLog[]>([])
const stats = ref<SyncStatistic[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)
const active = ref<'logs' | 'stats'>('logs')
const loading = ref(false)
const loadError = ref('')
// 默认查当天（10-12 优化）：开始 00:00:00 ~ 结束 23:59:59，与数据查看页时间范围口径一致
function todayRange(): { startTime: string; endTime: string } {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { startTime: `${date} 00:00:00`, endTime: `${date} 23:59:59` }
}
function defaultFilter() {
  return { customerId: admin.value ? '' : String(auth.info?.id ?? ''), clientId: '', schemaName: '',
    taskIdSet: [] as Array<string | number>, status: '', type: '', ...todayRange() }
}
const filter = reactive(defaultFilter())
const detail = ref<SyncStatistic | null>(null)
const detailOpen = ref(false)

function params() { return { ...filter, pageNo: pageNo.value, pageSize: pageSize.value } }
async function load() {
  loading.value = true
  try {
    if (active.value === 'logs') {
      const res = await syncApi.logs(params()); logs.value = res.list ?? []; total.value = res.total ?? 0
    } else {
      const res = await syncApi.statistics(params()); stats.value = res.list ?? []; total.value = res.total ?? 0
    }
    loadError.value = ''
  } catch (error) { loadError.value = String(error); logs.value = []; stats.value = []; total.value = 0; ElMessage.error(loadError.value) }
  finally { loading.value = false }
}

async function loadClients() {
  clients.value = []; filter.clientId = ''
  if (!filter.customerId) return
  try { clients.value = (await syncApi.clients({ customerId: filter.customerId, pageNo: 1, pageSize: 100 })).list ?? [] }
  catch (error) { ElMessage.error(String(error)) }
}
async function searchTasks(name: string) {
  if (!name.trim()) { taskChoices.value = []; return }
  try { taskChoices.value = (await syncApi.taskChoices({ name, customerId: filter.customerId, clientId: filter.clientId })).slice(0, 30) }
  catch (error) { ElMessage.error(String(error)) }
}
function search() { pageNo.value = 1; void load() }
function reset() {
  Object.assign(filter, defaultFilter())
  search()
}
watch(() => filter.customerId, () => { void loadClients(); search() })
watch(active, search)
onMounted(async () => {
  if (admin.value) {
    try { customers.value = await syncApi.customers() ?? [] }
    catch (error) { ElMessage.error(String(error)) }
  }
  await Promise.all([loadClients(), load()])
})

function duration(row: SyncLog) {
  if (row.status !== 3 || !row.beginTime || !row.endTime) return ''
  const seconds = Math.max(0, Math.round((Date.parse(row.endTime) - Date.parse(row.beginTime)) / 1000))
  if (!Number.isFinite(seconds)) return ''
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
function statusLabel(row: SyncLog) {
  if (row.remark || row.status === 5) return '任务异常'
  return ({ 1: '开始运行', 2: '运行中', 3: '运行完成', 4: '任务中断' } as Record<number, string>)[row.status ?? 0] ?? '未知'
}
</script>

<template>
  <div class="sync-panel">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="sync-alert" />
    <div class="sync-filter">
      <el-select v-if="admin" v-model="filter.customerId" clearable placeholder="全部客户" class="sync-input"><el-option v-for="item in customers" :key="item.id" :value="String(item.id)" :label="item.customerName" /></el-select>
      <el-select v-model="filter.clientId" clearable placeholder="全部客户端" class="sync-input"><el-option v-for="item in clients" :key="item.id" :value="String(item.id)" :label="item.clientName" /></el-select>
      <el-input v-model="filter.schemaName" placeholder="DB 名称" class="sync-input" @keyup.enter="search" />
      <el-select v-model="filter.taskIdSet" multiple filterable remote :remote-method="searchTasks" placeholder="任务名称" class="sync-input wide"><el-option v-for="item in taskChoices" :key="item.id" :value="item.id" :label="item.taskName" /></el-select>
      <el-select v-model="filter.status" placeholder="任务状态" class="sync-input"><el-option value="" label="全部状态" /><el-option value="2" label="运行中" /><el-option value="3" label="运行完成" /><el-option value="5" label="运行异常" /></el-select>
      <el-select v-model="filter.type" placeholder="任务类型" class="sync-input"><el-option value="" label="全部类型" /><el-option value="1" label="定时同步" /><el-option value="2" label="手动同步" /></el-select>
      <el-date-picker v-model="filter.startTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="开始时间" class="sync-time" />
      <el-date-picker v-model="filter.endTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="结束时间" class="sync-time" />
      <div class="sync-filter-actions">
        <el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button><el-button @click="load">刷新</el-button>
      </div>
    </div>
    <el-tabs v-model="active">
      <el-tab-pane label="任务日志" name="logs" /><el-tab-pane label="统计日志" name="stats" />
    </el-tabs>
    <el-table v-if="active === 'logs'" v-loading="loading" :data="logs" border>
      <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="taskId" label="任务 ID" width="100" />
      <el-table-column prop="taskName" label="任务名称" min-width="180" show-overflow-tooltip />
      <el-table-column label="任务类型" width="90"><template #default="{ row }">{{ String(row.type) === '1' ? '定时同步' : '手动同步' }}</template></el-table-column>
      <el-table-column prop="totalNumber" label="应同步" width="85" /><el-table-column prop="currentNo" label="已同步" width="85" />
      <el-table-column prop="insertNum" label="新增" width="75" /><el-table-column prop="updateNum" label="更新" width="75" />
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.remark || row.status === 5 ? 'danger' : row.status === 3 ? 'success' : 'info'" size="small">{{ statusLabel(row) }}</el-tag></template></el-table-column>
      <el-table-column label="耗时" width="110"><template #default="{ row }">{{ duration(row) }}</template></el-table-column>
      <el-table-column prop="beginTime" label="开始时间" width="170" /><el-table-column prop="endTime" label="完成时间" width="170" />
      <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
    </el-table>
    <el-table v-else v-loading="loading" :data="stats" border>
      <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="taskId" label="任务 ID" width="100" />
      <el-table-column prop="taskName" label="任务名称" min-width="190" /><el-table-column prop="sourceNum" label="源表数量" width="110" /><el-table-column prop="targetNum" label="目标表数量" width="110" />
      <el-table-column prop="sourceSql" label="源表统计 SQL" min-width="220" show-overflow-tooltip /><el-table-column prop="targetSql" label="目标表统计 SQL" min-width="220" show-overflow-tooltip />
      <el-table-column prop="createTime" label="创建时间" width="170" /><el-table-column label="操作" width="60"><template #default="{ row }"><el-tooltip content="详情" placement="top"><span class="rc-op-icon" data-testid="log-detail" aria-label="详情" @click="detail = row; detailOpen = true"><el-icon :size="15"><View /></el-icon></span></el-tooltip></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="pageNo" v-model:page-size="pageSize" class="sync-pagination" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    <el-drawer v-model="detailOpen" title="统计日志详情" size="min(650px, 94vw)"><el-descriptions v-if="detail" :column="1" border>
      <el-descriptions-item label="任务">{{ detail.taskName }}</el-descriptions-item><el-descriptions-item label="源表数量">{{ detail.sourceNum }}</el-descriptions-item><el-descriptions-item label="目标表数量">{{ detail.targetNum }}</el-descriptions-item>
      <el-descriptions-item label="源表统计 SQL"><pre>{{ detail.sourceSql }}</pre></el-descriptions-item><el-descriptions-item label="目标表统计 SQL"><pre>{{ detail.targetSql }}</pre></el-descriptions-item>
    </el-descriptions></el-drawer>
  </div>
</template>

<style scoped>
.sync-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }.sync-alert { margin-bottom: 12px; }.sync-input { width: 115px; }.sync-input.wide { width: 165px; }.sync-time { width: 150px; }.sync-filter-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }.sync-pagination { justify-content: flex-end; margin-top: 14px; }pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
</style>
