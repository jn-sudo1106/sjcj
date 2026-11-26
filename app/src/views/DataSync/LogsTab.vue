<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { View } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { syncApi, type SyncClient, type SyncCustomer, type SyncFileRecord, type SyncLog, type SyncSnapshotLog, type SyncStatistic, type SyncTask } from '@/api/dataSync'

const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
const customers = ref<SyncCustomer[]>([])
const clients = ref<SyncClient[]>([])
const taskChoices = ref<SyncTask[]>([])
const logs = ref<SyncLog[]>([])
const stats = ref<SyncStatistic[]>([])
const fileLogs = ref<SyncFileRecord[]>([])
const snapshotLogs = ref<SyncSnapshotLog[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)
// 客户端候选与名称映射一次取全的量（日志分页只 10 条，候选反而需要更大的范围）
const CLIENT_MAP_SIZE = 500
const active = ref<'logs' | 'stats' | 'files' | 'snapshots'>('logs')
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
    sourceTable: '', fileName: '', taskIdSet: [] as Array<string | number>, status: '', type: '', ...todayRange() }
}
const filter = reactive(defaultFilter())
const detail = ref<SyncStatistic | null>(null)
const detailOpen = ref(false)
const fileDetail = ref<SyncFileRecord | null>(null)
const fileDetailOpen = ref(false)
const snapshotDetail = ref<SyncSnapshotLog | null>(null)
const snapshotDetailOpen = ref(false)

const statusOptions = computed(() => (
  active.value === 'snapshots'
    ? [
        { value: '0', label: '未开始' },
        { value: '1', label: '文件生成中' },
        { value: '2', label: '文件生成完成' },
        { value: '3', label: '文件同步中' },
        { value: '4', label: '文件同步完成' },
        { value: '5', label: '异常' },
      ]
    : [
        { value: '2', label: '运行中' },
        { value: '3', label: '运行完成' },
        { value: '5', label: '运行异常' },
      ]
))

function params() {
  const p: Record<string, unknown> = { ...filter, pageNo: pageNo.value, pageSize: pageSize.value }
  if (active.value === 'files') {
    p.schemaName = ''
    delete p.fileName
  } else if (active.value === 'snapshots') {
    p.schemaName = ''
    p.sourceTable = ''
  } else {
    p.sourceTable = ''
    delete p.fileName
  }
  return p
}
async function load() {
  loading.value = true
  try {
    if (active.value === 'logs') {
      const res = await syncApi.logs(params()); logs.value = res.list ?? []; total.value = res.total ?? 0
    } else if (active.value === 'stats') {
      const res = await syncApi.statistics(params()); stats.value = res.list ?? []; total.value = res.total ?? 0
    } else if (active.value === 'files') {
      const res = await syncApi.fileLogs(params()); fileLogs.value = res.list ?? []; total.value = res.total ?? 0
    } else {
      const res = await syncApi.snapshotLogs(params()); snapshotLogs.value = res.list ?? []; total.value = res.total ?? 0
    }
    loadError.value = ''
  } catch (error) { loadError.value = String(error); logs.value = []; stats.value = []; fileLogs.value = []; snapshotLogs.value = []; total.value = 0; ElMessage.error(loadError.value) }
  finally { loading.value = false }
}

async function loadClients() {
  clients.value = []; filter.clientId = ''
  // 不选客户 = 全部客户，客户端候选也要跟着给全量，否则清掉客户筛选后这个下拉直接空了
  try {
    clients.value = (await syncApi.clients(filter.customerId
      ? { customerId: filter.customerId, pageNo: 1, pageSize: CLIENT_MAP_SIZE }
      : { pageNo: 1, pageSize: CLIENT_MAP_SIZE })).list ?? []
  }
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
watch(active, (next, prev) => {
  if ((next === 'snapshots') !== (prev === 'snapshots')) {
    filter.status = ''
  }
  search()
})
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

function clientName(clientId?: number | string) {
  if (clientId == null) return ''
  const c = clients.value.find((item) => String(item.id) === String(clientId))
  return c ? c.clientName : String(clientId)
}

function fileStatusLabel(row: SyncFileRecord) {
  if (row.remark && (row.status === 5 || row.status === -1)) return row.status === -1 ? '文件不存在' : '同步失败'
  const map: Record<number, string> = {
    0: '待执行',
    1: '下载中',
    2: '已下载',
    3: '上传中',
    4: '同步完成',
    5: '同步失败',
    [-1]: '文件不存在',
  }
  return row.status !== undefined && map[row.status] ? map[row.status] : '未知'
}

function fileStatusTagType(row: SyncFileRecord): 'success' | 'warning' | 'danger' | 'info' {
  if (row.status === 4) return 'success'
  if (row.status === 5 || row.status === -1) return 'danger'
  if (row.status === 1 || row.status === 2 || row.status === 3) return 'warning'
  return 'info'
}

function formatBytes(bytes?: number) {
  if (bytes == null || isNaN(bytes)) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fileDuration(row: SyncFileRecord) {
  const start = row.downloadStartTime || row.uploadStartTime
  const end = row.uploadEndTime || row.downloadEndTime
  if (!start || !end) return '-'
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000))
  if (!Number.isFinite(seconds)) return '-'
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function snapshotStatusLabel(row: SyncSnapshotLog) {
  const map: Record<number, string> = {
    0: '未开始',
    1: '文件生成中',
    2: '文件生成完成',
    3: '文件同步中',
    4: '文件同步完成',
    5: '异常',
  }
  return row.status !== undefined && map[row.status] ? map[row.status] : '未知'
}

function snapshotStatusTagType(row: SyncSnapshotLog): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  if (row.status === 4) return 'success'
  if (row.status === 5) return 'danger'
  if (row.status === 1 || row.status === 3) return 'warning'
  if (row.status === 2) return 'primary'
  return 'info'
}

function formatSnapshotParams(raw?: string) {
  if (!raw) return '-'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}
</script>

<template>
  <div class="sync-panel">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="sync-alert" />
    <div class="sync-filter">
      <el-select v-if="admin" v-model="filter.customerId" clearable placeholder="全部客户" class="sync-input"><el-option v-for="item in customers" :key="item.id" :value="String(item.id)" :label="item.customerName" /></el-select>
      <el-select v-model="filter.clientId" clearable placeholder="全部客户端" class="sync-input" @clear="search"><el-option v-for="item in clients" :key="item.id" :value="String(item.id)" :label="item.clientName" /></el-select>
      <el-input v-if="active === 'files'" v-model="filter.sourceTable" clearable placeholder="源表" class="sync-input" @keyup.enter="search" @clear="search" />
      <el-input v-else-if="active === 'snapshots'" v-model="filter.fileName" clearable placeholder="快照文件名" class="sync-input" @keyup.enter="search" @clear="search" />
      <el-input v-else v-model="filter.schemaName" clearable placeholder="DB 名称" class="sync-input" @keyup.enter="search" @clear="search" />
      <el-select v-model="filter.taskIdSet" multiple filterable remote clearable :remote-method="searchTasks" placeholder="任务名称" class="sync-input wide" @clear="search"><el-option v-for="item in taskChoices" :key="item.id" :value="item.id" :label="item.taskName" /></el-select>
      <el-select v-model="filter.status" clearable placeholder="全部状态" class="sync-input" @clear="search"><el-option v-for="opt in statusOptions" :key="opt.value" :value="opt.value" :label="opt.label" /></el-select>
      <el-select v-model="filter.type" clearable placeholder="全部类型" class="sync-input" @clear="search"><el-option value="1" label="定时同步" /><el-option value="2" label="手动同步" /></el-select>
      <el-date-picker v-model="filter.startTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="开始时间" class="sync-time" />
      <el-date-picker v-model="filter.endTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="结束时间" class="sync-time" />
      <div class="sync-filter-actions">
        <el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button><el-button @click="load">刷新</el-button>
      </div>
    </div>
    <el-tabs v-model="active">
      <el-tab-pane label="任务日志" name="logs" /><el-tab-pane label="统计日志" name="stats" /><el-tab-pane label="文件同步列表" name="files" /><el-tab-pane label="文件快照表" name="snapshots" />
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
    <el-table v-else-if="active === 'stats'" v-loading="loading" :data="stats" border>
      <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="taskId" label="任务 ID" width="100" />
      <el-table-column prop="taskName" label="任务名称" min-width="190" /><el-table-column prop="sourceNum" label="源表数量" width="110" /><el-table-column prop="targetNum" label="目标表数量" width="110" />
      <el-table-column prop="sourceSql" label="源表统计 SQL" min-width="220" show-overflow-tooltip /><el-table-column prop="targetSql" label="目标表统计 SQL" min-width="220" show-overflow-tooltip />
      <el-table-column prop="createTime" label="创建时间" width="170" /><el-table-column label="操作" width="60"><template #default="{ row }"><el-tooltip content="详情" placement="top"><span class="rc-op-icon" data-testid="log-detail" aria-label="详情" @click="detail = row; detailOpen = true"><el-icon :size="15"><View /></el-icon></span></el-tooltip></template></el-table-column>
    </el-table>
    <el-table v-else-if="active === 'files'" v-loading="loading" :data="fileLogs" border>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="客户端" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ clientName(row.clientId) }}</template></el-table-column>
      <el-table-column prop="fileName" label="文件名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="sourceTable" label="源表" min-width="140" show-overflow-tooltip />
      <el-table-column prop="filePath" label="源文件路径" min-width="200" show-overflow-tooltip />
      <el-table-column prop="targetUrl" label="目标路径" min-width="200" show-overflow-tooltip />
      <el-table-column label="文件大小" width="100"><template #default="{ row }">{{ formatBytes(row.fileSize) }}</template></el-table-column>
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="fileStatusTagType(row)" size="small">{{ fileStatusLabel(row) }}</el-tag></template></el-table-column>
      <el-table-column label="耗时" width="100"><template #default="{ row }">{{ fileDuration(row) }}</template></el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="170" />
      <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作" width="60" fixed="right"><template #default="{ row }"><el-tooltip content="详情" placement="top"><span class="rc-op-icon" data-testid="file-detail" aria-label="详情" @click="fileDetail = row; fileDetailOpen = true"><el-icon :size="15"><View /></el-icon></span></el-tooltip></template></el-table-column>
    </el-table>
    <el-table v-else v-loading="loading" :data="snapshotLogs" border>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column label="客户端" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ clientName(row.clientId) }}</template></el-table-column>
      <el-table-column prop="taskId" label="任务 ID" width="100" />
      <el-table-column label="任务名称" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.taskName || '-' }}</template></el-table-column>
      <el-table-column prop="sourceCode" label="源编码" min-width="120" show-overflow-tooltip />
      <el-table-column prop="fileName" label="快照文件名" min-width="220" show-overflow-tooltip />
      <el-table-column prop="totalNum" label="数据行数" width="100" />
      <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="snapshotStatusTagType(row)" size="small">{{ snapshotStatusLabel(row) }}</el-tag></template></el-table-column>
      <el-table-column prop="createTime" label="创建时间" width="170" />
      <el-table-column prop="updateTime" label="更新时间" width="170" />
      <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
      <el-table-column label="操作" width="60" fixed="right"><template #default="{ row }"><el-tooltip content="详情" placement="top"><span class="rc-op-icon" data-testid="snapshot-detail" aria-label="详情" @click="snapshotDetail = row; snapshotDetailOpen = true"><el-icon :size="15"><View /></el-icon></span></el-tooltip></template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="pageNo" v-model:page-size="pageSize" class="sync-pagination" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />
    <el-drawer v-model="detailOpen" title="统计日志详情" size="min(650px, 94vw)"><el-descriptions v-if="detail" :column="1" border>
      <el-descriptions-item label="任务">{{ detail.taskName }}</el-descriptions-item><el-descriptions-item label="源表数量">{{ detail.sourceNum }}</el-descriptions-item><el-descriptions-item label="目标表数量">{{ detail.targetNum }}</el-descriptions-item>
      <el-descriptions-item label="源表统计 SQL"><pre>{{ detail.sourceSql }}</pre></el-descriptions-item><el-descriptions-item label="目标表统计 SQL"><pre>{{ detail.targetSql }}</pre></el-descriptions-item>
    </el-descriptions></el-drawer>
    <el-drawer v-model="fileDetailOpen" title="文件同步详情" size="min(650px, 94vw)"><el-descriptions v-if="fileDetail" :column="1" border>
      <el-descriptions-item label="ID">{{ fileDetail.id }}</el-descriptions-item>
      <el-descriptions-item label="客户端">{{ clientName(fileDetail.clientId) }} (ID: {{ fileDetail.clientId }})</el-descriptions-item>
      <el-descriptions-item label="文件名称">{{ fileDetail.fileName || '-' }}</el-descriptions-item>
      <el-descriptions-item label="源表">{{ fileDetail.sourceTable || '-' }}</el-descriptions-item>
      <el-descriptions-item label="源编码">{{ fileDetail.sourceCode || '-' }}</el-descriptions-item>
      <el-descriptions-item label="目标编码">{{ fileDetail.targetCode || '-' }}</el-descriptions-item>
      <el-descriptions-item label="源文件路径"><pre>{{ fileDetail.filePath || '-' }}</pre></el-descriptions-item>
      <el-descriptions-item label="目标路径 / URL"><pre>{{ fileDetail.targetUrl || '-' }}</pre></el-descriptions-item>
      <el-descriptions-item label="路径映射规则">{{ fileDetail.pathMapRule || '-' }}</el-descriptions-item>
      <el-descriptions-item label="文件大小">{{ formatBytes(fileDetail.fileSize) }}<span v-if="fileDetail.fileSize != null"> ({{ fileDetail.fileSize }} 字节)</span></el-descriptions-item>
      <el-descriptions-item label="MD5">{{ fileDetail.fileMd5 || '-' }}</el-descriptions-item>
      <el-descriptions-item label="状态"><el-tag :type="fileStatusTagType(fileDetail)" size="small">{{ fileStatusLabel(fileDetail) }}</el-tag></el-descriptions-item>
      <el-descriptions-item label="下载时间">{{ fileDetail.downloadStartTime || '-' }} ~ {{ fileDetail.downloadEndTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="上传时间">{{ fileDetail.uploadStartTime || '-' }} ~ {{ fileDetail.uploadEndTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="远程更新时间">{{ fileDetail.originUpdateTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ fileDetail.createTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="更新时间">{{ fileDetail.updateTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="备注"><pre>{{ fileDetail.remark || '-' }}</pre></el-descriptions-item>
    </el-descriptions></el-drawer>
    <el-drawer v-model="snapshotDetailOpen" title="文件快照详情" size="min(650px, 94vw)"><el-descriptions v-if="snapshotDetail" :column="1" border>
      <el-descriptions-item label="ID">{{ snapshotDetail.id }}</el-descriptions-item>
      <el-descriptions-item label="客户端">{{ clientName(snapshotDetail.clientId) }} (ID: {{ snapshotDetail.clientId }})</el-descriptions-item>
      <el-descriptions-item label="任务 ID">{{ snapshotDetail.taskId ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="任务名称">{{ snapshotDetail.taskName || '-' }}</el-descriptions-item>
      <el-descriptions-item label="源编码">{{ snapshotDetail.sourceCode || '-' }}</el-descriptions-item>
      <el-descriptions-item label="快照文件名"><pre>{{ snapshotDetail.fileName || '-' }}</pre></el-descriptions-item>
      <el-descriptions-item label="数据行数">{{ snapshotDetail.totalNum ?? '-' }}</el-descriptions-item>
      <el-descriptions-item label="状态"><el-tag :type="snapshotStatusTagType(snapshotDetail)" size="small">{{ snapshotStatusLabel(snapshotDetail) }}</el-tag></el-descriptions-item>
      <el-descriptions-item label="分片参数"><pre>{{ formatSnapshotParams(snapshotDetail.params) }}</pre></el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ snapshotDetail.createTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="更新时间">{{ snapshotDetail.updateTime || '-' }}</el-descriptions-item>
      <el-descriptions-item label="备注"><pre>{{ snapshotDetail.remark || '-' }}</pre></el-descriptions-item>
    </el-descriptions></el-drawer>
  </div>
</template>

<style scoped>
.sync-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }.sync-alert { margin-bottom: 12px; }.sync-input { width: 115px; }.sync-input.wide { width: 165px; }.sync-time { width: 150px; }.sync-filter-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }.sync-pagination { justify-content: flex-end; margin-top: 14px; }pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
</style>
