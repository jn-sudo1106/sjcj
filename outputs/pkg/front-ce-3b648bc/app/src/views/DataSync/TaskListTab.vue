<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Promotion, Setting, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import {
  isSinkTarget, parseSinkOptions, sanitizeSinkOptions, sinkOptionsProblem, syncApi,
  type SyncClient, type SyncCustomer, type SyncDatabase, type SyncSinkDetail, type SyncSinkOptions,
  type SyncTask, type SyncTaskConfig,
} from '@/api/dataSync'
import SinkOptionsPanel from './SinkOptionsPanel.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
const customers = ref<SyncCustomer[]>([])
const clients = ref<SyncClient[]>([])
const customerNames = ref(new Map<string, string>())
const clientNames = ref(new Map<string, string>())
const tasks = ref<SyncTask[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref('')
const pageNo = ref(1)
const pageSize = ref(10)
// 名称映射用的客户端上限：一次取全，任务分页只 10 条，映射表反而需要更大的范围
const CLIENT_MAP_SIZE = 500
const selected = ref<SyncTask[]>([])
const filter = reactive({ customerId: admin.value ? '' : String(auth.info?.id ?? ''), clientId: '', taskName: '',
  sourceTableName: String(route.query.tableName ?? ''), targetTableName: '', taskStatus: '', taskIdStr: '' })
const detailOpen = ref(false)
const detailEdit = ref(false)
const detailLoading = ref(false)
const detailSaving = ref(false)
const detail = ref<SyncTaskConfig | null>(null)
const sinkInfo = ref<SyncSinkDetail | null>(null)
const sinkOptions = ref<SyncSinkOptions | null>(null)
const sinkType = computed(() => Number(sinkInfo.value?.targetDatabaseType ?? 0))
const sinkColumns = computed(() => sinkInfo.value?.columnMapList ?? [])
const runOpen = ref(false)
const runTargets = ref<SyncTask[]>([])
const runType = ref<'time' | 'id'>('time')
const runParams = reactive({ startId: 1, endId: undefined as number | undefined, startTime: '', endTime: '' })
const copyOpen = ref(false)
const copyTargets = ref<SyncDatabase[]>([])
const databaseIds = ref<Array<string | number>>([])
const copyTableFlag = ref(true)
const deleteOpen = ref(false)
const deleteTarget = ref<SyncTask | null>(null)
// 目标表处理方式：0 不处理 / 1 备份表 / 2 删除表（后端 DeleteTaskDTO.tableOperation）
const deleteTableOperation = ref<'0' | '1' | '2'>('0')
const deleteBusy = ref(false)

// 抽屉里逐段展示的 SQL，顺序即客户端执行顺序（前置/后置对目标库，可为空）
type SqlField = 'startSql' | 'beforeSql' | 'fromSql' | 'conditionSql' | 'insertSql' | 'updateSql' | 'afterSql'
const SQL_FIELDS: SqlField[] = ['startSql', 'beforeSql', 'fromSql', 'conditionSql', 'insertSql', 'updateSql', 'afterSql']
const SQL_FIELD_LABELS: Record<SqlField, string> = {
  startSql: '查询目标数据起始 SQL', beforeSql: '前置 SQL（针对目标数据库）', fromSql: '查询源数据 SQL',
  conditionSql: '条件 SQL', insertSql: '保存数据 SQL', updateSql: '更新数据 SQL',
  afterSql: '后置 SQL（针对目标数据库）',
}

async function load() {
  loading.value = true
  try {
    const taskIds = filter.taskIdStr.trim() ? filter.taskIdStr.split(',').map((id) => id.trim()).filter(Boolean) : undefined
    const res = await syncApi.tasks({ ...filter, enable: '0', taskType: '', pageNo: pageNo.value,
      pageSize: pageSize.value, taskIds })
    tasks.value = res.list ?? []
    total.value = res.total ?? 0
    loadError.value = ''
  } catch (error) { loadError.value = String(error); tasks.value = []; total.value = 0; ElMessage.error(loadError.value) }
  finally { loading.value = false }
}

async function loadClients() {
  clients.value = []
  clientNames.value = new Map()
  filter.clientId = ''
  try {
    // admin 未选客户时要按全量客户端建名称映射，否则跨客户的任务只能显示 #ID
    const res = await syncApi.clients(filter.customerId
      ? { customerId: filter.customerId, pageNo: 1, pageSize: CLIENT_MAP_SIZE }
      : { pageNo: 1, pageSize: CLIENT_MAP_SIZE })
    clients.value = res.list ?? []
    clientNames.value = new Map(clients.value.map((item) => [String(item.id), item.clientName]))
  } catch (error) { ElMessage.error(String(error)) }
}

async function loadCustomers() {
  try {
    // 非 admin 不走 /customer/all（那会把其它客户名称发给无关账号），只取自己所属客户
    const list = admin.value
      ? (await syncApi.customers()) ?? []
      : (await syncApi.customerPage({ customerId: filter.customerId, pageNo: 1, pageSize: 10 })).list ?? []
    customers.value = list
    customerNames.value = new Map(list.map((item) => [String(item.id), item.customerName]))
  } catch (error) { ElMessage.error(String(error)) }
}

const ownerName = (names: Map<string, string>, id: unknown) => {
  const key = String(id ?? '')
  if (!key) return '—'
  return names.get(key) || `#${key}`
}

watch(() => filter.customerId, () => { void loadClients(); pageNo.value = 1; void load() })
onMounted(async () => {
  await Promise.all([loadCustomers(), loadClients(), load()])
})

function search() { pageNo.value = 1; void load() }
function reset() {
  Object.assign(filter, { customerId: admin.value ? '' : String(auth.info?.id ?? ''), clientId: '',
    taskName: '', sourceTableName: '', targetTableName: '', taskStatus: '', taskIdStr: '' })
  search()
}

async function openDetail(row: SyncTask, editable: boolean) {
  detailOpen.value = true
  detailEdit.value = editable
  detail.value = null
  sinkInfo.value = null
  sinkOptions.value = null
  detailLoading.value = true
  try {
    // 回显数据来自服务端真源 extend_config，不是从已有 SQL 反推；老后端没有这个接口时只退掉参数面板，明细照常看
    const [config, sink] = await Promise.all([syncApi.taskDetail(row.id), syncApi.sinkDetail(row.id).catch(() => null)])
    detail.value = { ...config, taskName: row.taskName, syncType: String(row.syncType) }
    sinkInfo.value = sink
    sinkOptions.value = sink ? parseSinkOptions(sink.sinkOptions, sink.targetDatabaseType, sink.columnMapList ?? []) : null
  } catch (error) { ElMessage.error(String(error)); detailOpen.value = false }
  finally { detailLoading.value = false }
}

async function saveDetail() {
  if (!detail.value) return
  if (!detail.value.taskName || !detail.value.cron || !detail.value.fromSql || !detail.value.startSql ||
      !detail.value.conditionSql || !detail.value.insertSql || !detail.value.updateSql) {
    ElMessage.warning('请填写任务名称、定时策略和除前后置外的全部 SQL')
    return
  }
  if (isSinkTarget(sinkType.value)) {
    const options = sanitizeSinkOptions(sinkOptions.value, sinkType.value)
    const problem = sinkOptionsProblem(options, sinkColumns.value)
    if (problem) { ElMessage.warning(problem); return }
    if (options) detail.value.sinkOptions = options
  }
  detailSaving.value = true
  try { await syncApi.saveTaskDetail(detail.value); ElMessage.success('保存成功'); detailOpen.value = false; await load() }
  catch (error) { ElMessage.error(String(error)) }
  finally { detailSaving.value = false }
}

async function action(ids: Array<string | number>, type: 'start' | 'stop') {
  try {
    await ElMessageBox.confirm(`确定${type === 'start' ? '开启' : '关闭'} ${ids.length} 个同步任务？`, '确认操作', { type: 'warning' })
    if (type === 'start') await syncApi.start(ids)
    else await syncApi.stop(ids)
    ElMessage.success('操作成功')
    await load()
  } catch (error) { if (error !== 'cancel') ElMessage.error(String(error)) }
}

function openRun(rows: SyncTask[]) {
  if (!rows.length) return
  runTargets.value = rows
  runType.value = 'time'
  runParams.startId = 1; runParams.endId = undefined; runParams.startTime = ''; runParams.endTime = ''
  runOpen.value = true
}

async function run(withParams: boolean) {
  const rows = withParams ? runTargets.value : selected.value
  if (!rows.length) return
  const params: Record<string, unknown> = {}
  if (withParams) {
    if (runType.value === 'time') {
      if (!runParams.startTime || !runParams.endTime || runParams.startTime > runParams.endTime) {
        ElMessage.warning('请选择有效的开始和结束时间'); return
      }
      params.startTime = runParams.startTime; params.endTime = runParams.endTime
    } else {
      if (runParams.endId !== undefined && runParams.endId < runParams.startId) {
        ElMessage.warning('结束 ID 不能小于开始 ID'); return
      }
      params.startId = runParams.startId; params.endId = runParams.endId
    }
  }
  try {
    await syncApi.run(rows.map((row) => ({ taskId: row.id, clientId: row.clientId })), params)
    ElMessage.success('执行成功')
    runOpen.value = false
    await load()
  } catch (error) { ElMessage.error(String(error)) }
}

async function runNow(row: SyncTask) {
  try {
    await ElMessageBox.confirm(`立即执行“${row.taskName}”？`, '确认执行', { type: 'warning' })
    await syncApi.run([{ taskId: row.id, clientId: row.clientId }])
    ElMessage.success('执行成功')
    await load()
  } catch (error) { if (error !== 'cancel') ElMessage.error(String(error)) }
}

async function openCopy() {
  if (!selected.value.length) return
  try {
    const res = await syncApi.databases({ pageNo: 1, pageSize: 100, customerId: filter.customerId })
    copyTargets.value = res.list ?? []
    databaseIds.value = []
    copyTableFlag.value = true
    copyOpen.value = true
  } catch (error) { ElMessage.error(String(error)) }
}

async function copy() {
  if (!databaseIds.value.length) return
  try {
    await syncApi.copy(selected.value.map((row) => row.id), databaseIds.value, copyTableFlag.value)
    ElMessage.success('复制任务成功')
    copyOpen.value = false
    await load()
  } catch (error) { ElMessage.error(String(error)) }
}

function remove(row: SyncTask) {
  deleteTarget.value = row
  deleteTableOperation.value = '0'
  deleteOpen.value = true
}

async function confirmRemove() {
  const row = deleteTarget.value
  if (!row || deleteBusy.value) return
  deleteBusy.value = true
  try {
    await syncApi.remove(row.id, row.clientId, row.targetTableName,
      deleteTableOperation.value === '0' ? undefined : deleteTableOperation.value)
    ElMessage.success('删除成功')
    deleteOpen.value = false
    await load()
  } catch (error) { ElMessage.error(String(error)) }
  finally { deleteBusy.value = false }
}
</script>

<template>
  <div class="sync-panel">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="sync-alert" />
    <div class="sync-filter">
      <el-select v-if="admin" v-model="filter.customerId" clearable placeholder="全部客户" class="sync-filter-input"><el-option v-for="item in customers" :key="item.id" :value="String(item.id)" :label="item.customerName" /></el-select>
      <el-select v-model="filter.clientId" clearable placeholder="全部客户端" class="sync-filter-input" @clear="search"><el-option v-for="item in clients" :key="item.id" :value="String(item.id)" :label="item.clientName" /></el-select>
      <el-input v-model="filter.taskName" clearable placeholder="任务名称" class="sync-filter-input" @keyup.enter="search" @clear="search" />
      <el-input v-model="filter.sourceTableName" clearable placeholder="源表名称" class="sync-filter-input" @keyup.enter="search" @clear="search" />
      <el-input v-model="filter.targetTableName" clearable placeholder="目标表名称" class="sync-filter-input" @keyup.enter="search" @clear="search" />
      <el-select v-model="filter.taskStatus" clearable placeholder="全部状态" class="sync-filter-input" @clear="search"><el-option value="0" label="已启用" /><el-option value="1" label="已暂停" /></el-select>
      <el-input v-model="filter.taskIdStr" clearable placeholder="任务 ID，逗号分隔" class="sync-filter-input" @keyup.enter="search" @clear="search" />
      <div class="sync-filter-actions">
        <el-button type="primary" @click="search">查询</el-button><el-button @click="reset">重置</el-button>
      </div>
    </div>
    <div class="sync-toolbar">
      <el-button type="primary" @click="router.push('/sync/create')">新建同步</el-button>
      <template v-if="selected.length">
        <el-button @click="openRun(selected)">批量参数执行（{{ selected.length }}）</el-button>
        <el-button @click="action(selected.map((row) => row.id), 'start')">批量开启</el-button>
        <el-button @click="action(selected.map((row) => row.id), 'stop')">批量关闭</el-button>
        <el-button @click="openCopy">复制到目标数据源</el-button>
      </template>
      <el-button class="sync-refresh" @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="tasks" row-key="id" border @selection-change="selected = $event">
      <el-table-column type="selection" width="48" />
      <el-table-column prop="id" label="ID" width="85" />
      <el-table-column prop="taskName" label="任务名称" min-width="190" show-overflow-tooltip><template #default="{ row }"><el-button link type="primary" @click="openDetail(row, false)">{{ row.taskName }}</el-button></template></el-table-column>
      <el-table-column label="客户" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ ownerName(customerNames, row.customerId) }}</template></el-table-column>
      <el-table-column label="客户端" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ ownerName(clientNames, row.clientId) }}</template></el-table-column>
      <el-table-column prop="sourceTable" label="源表" min-width="170" show-overflow-tooltip />
      <el-table-column prop="targetTableName" label="目标表" min-width="150" show-overflow-tooltip />
      <el-table-column label="方式" width="75"><template #default="{ row }">{{ Number(row.syncType) === 1 ? 'SQL' : 'CDC' }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="Number(row.status) === 0 ? 'success' : 'info'" size="small">{{ Number(row.status) === 0 ? '运行中' : '已暂停' }}</el-tag></template></el-table-column>
      <el-table-column prop="cron" label="同步频率" min-width="140" show-overflow-tooltip />
      <el-table-column prop="lastSyncTime" label="最后同步成功" min-width="165" />
      <el-table-column label="操作" width="160" fixed="right"><template #default="{ row }">
        <div class="rc-actions">
          <el-tooltip content="编辑" placement="top"><span class="rc-op-icon" data-testid="task-edit" aria-label="编辑" @click="openDetail(row, true)"><el-icon :size="15"><Edit /></el-icon></span></el-tooltip>
          <el-tooltip v-if="Number(row.status) === 0 && Number(row.syncType) === 1" content="立即执行" placement="top"><span class="rc-op-icon" data-testid="task-run" aria-label="立即执行" @click="runNow(row)"><el-icon :size="15"><Promotion /></el-icon></span></el-tooltip>
          <el-tooltip v-if="Number(row.status) === 0 && Number(row.syncType) === 1" content="参数执行" placement="top"><span class="rc-op-icon" data-testid="task-run-params" aria-label="参数执行" @click="openRun([row])"><el-icon :size="15"><Setting /></el-icon></span></el-tooltip>
          <el-tooltip v-if="Number(row.status) === 0" content="关闭任务" placement="top"><span class="rc-op-icon" data-testid="task-stop" aria-label="关闭任务" @click="action([row.id], 'stop')"><el-icon :size="15"><VideoPause /></el-icon></span></el-tooltip>
          <template v-else>
            <el-tooltip content="开启任务" placement="top"><span class="rc-op-icon" data-testid="task-start" aria-label="开启任务" @click="action([row.id], 'start')"><el-icon :size="15"><VideoPlay /></el-icon></span></el-tooltip>
            <el-tooltip content="删除任务" placement="top"><span class="rc-op-icon is-danger" data-testid="task-delete" aria-label="删除任务" @click="remove(row)"><el-icon :size="15"><Delete /></el-icon></span></el-tooltip>
          </template>
        </div>
      </template></el-table-column>
    </el-table>
    <el-pagination v-model:current-page="pageNo" v-model:page-size="pageSize" class="sync-pagination" :total="total" :page-sizes="[10, 20, 50]" layout="total, sizes, prev, pager, next" @change="load" />

    <el-drawer v-model="detailOpen" title="任务配置明细" size="min(720px, 94vw)" :destroy-on-close="true">
      <div v-loading="detailLoading" class="sync-detail">
        <el-form v-if="detail" :model="detail" label-position="top">
          <el-form-item label="同步任务类型"><el-input model-value="SQL 查询" disabled /></el-form-item>
          <el-form-item label="同步任务名称"><el-input v-model="detail.taskName" :disabled="!detailEdit" /></el-form-item>
          <el-form-item label="同步定时策略"><el-input v-model="detail.cron" :disabled="!detailEdit" /></el-form-item>
          <!-- 编码只读：它决定同步两端连哪个库，列映射与建表产物都是按原来那端生成的，这里改了会让两边对不上 -->
          <el-form-item label="源数据源编码"><el-input v-model="detail.sourceCode" disabled /></el-form-item>
          <el-form-item label="目标数据源编码"><el-input v-model="detail.targetSourceCode" disabled /></el-form-item>
          <el-form-item v-for="field in SQL_FIELDS" :key="field" :label="SQL_FIELD_LABELS[field]">
            <el-input v-model="detail[field]" type="textarea" :rows="4" :disabled="!detailEdit" />
          </el-form-item>
        </el-form>
        <SinkOptionsPanel v-if="detail && detailEdit && isSinkTarget(sinkType)" :key="String(sinkInfo?.taskId)"
          v-model="sinkOptions" :database-type="sinkType" :columns="sinkColumns" table-exists
          :target-schema="sinkInfo?.targetSchema ?? ''" :target-table="sinkInfo?.targetTable ?? ''" />
      </div>
      <template #footer><el-button @click="detailOpen = false">关闭</el-button><el-button v-if="detailEdit" type="primary" :loading="detailSaving" @click="saveDetail">保存</el-button></template>
    </el-drawer>

    <el-dialog v-model="runOpen" title="任务参数" width="min(620px, 94vw)">
      <el-radio-group v-model="runType"><el-radio value="time">按时间同步</el-radio><el-radio value="id">按 ID 同步</el-radio></el-radio-group>
      <div class="sync-dialog-grid">
        <template v-if="runType === 'time'"><el-date-picker v-model="runParams.startTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="开始时间" /><el-date-picker v-model="runParams.endTime" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="结束时间" /></template>
        <template v-else><el-input-number v-model="runParams.startId" :min="1" /><el-input-number v-model="runParams.endId" :min="1" placeholder="结束 ID" /></template>
      </div>
      <template #footer><el-button @click="runOpen = false">取消</el-button><el-button type="primary" @click="run(true)">执行</el-button></template>
    </el-dialog>

    <el-dialog v-model="copyOpen" title="复制任务到目标数据源" width="min(600px, 94vw)">
      <el-form label-position="top"><el-form-item label="目标数据源"><el-select v-model="databaseIds" multiple filterable style="width:100%" placeholder="请选择目标数据源">
        <el-option v-for="item in copyTargets" :key="item.id" :value="item.id" :label="`${item.name} [${item.dbSchema}]`" />
      </el-select></el-form-item><el-form-item label="创建新表"><el-checkbox v-model="copyTableFlag">在目标数据源创建新表</el-checkbox></el-form-item></el-form>
      <template #footer><el-button @click="copyOpen = false">取消</el-button><el-button type="primary" :disabled="!databaseIds.length" @click="copy">确认复制</el-button></template>
    </el-dialog>

    <el-dialog v-model="deleteOpen" :title="`删除任务“${deleteTarget?.taskName ?? ''}”`" width="min(480px, 94vw)">
      <p class="sync-delete-target">目标表：{{ deleteTarget?.targetTableName || '-' }}</p>
      <el-form label-position="top">
        <el-form-item label="目标表处理方式">
          <el-select v-model="deleteTableOperation" data-testid="delete-table-operation" style="width:100%">
            <el-option value="0" label="不处理（只删任务，不动目标表）" />
            <el-option value="1" label="备份表后删除" />
            <el-option value="2" label="删除目标表" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deleteOpen = false">取消</el-button>
        <el-button type="danger" :loading="deleteBusy" data-testid="delete-confirm" @click="confirmRemove">确认删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.sync-panel { min-height: 0; }.sync-alert { margin-bottom: 12px; }.sync-filter, .sync-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }.sync-filter-input { width: 160px; }.sync-toolbar { padding-top: 2px; }.sync-filter-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }.sync-refresh { margin-left: auto; }.sync-pagination { justify-content: flex-end; margin-top: 14px; }.sync-detail { padding-right: 10px; }.sync-dialog-grid { display: flex; flex-wrap: wrap; gap: 12px; }.sync-delete-target { margin: 0 0 14px; color: #64748b; font-size: 13px; }
</style>
