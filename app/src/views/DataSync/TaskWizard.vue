<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import md5 from 'md5'
import { useAuthStore } from '@/stores/auth'
import {
  DATABASE_TYPE_LABELS, WATERMARK_COLUMN, generateSyncSql, isSinkTarget, mapEntityCopyColumns,
  mapSyncColumns, renderSinkDefaults, sanitizeSinkOptions, sinkOptionsProblem, submitSyncColumns, syncApi,
  type SyncColumnMap, type SyncCustomer, type SyncDatabase, type SyncSinkOptions, type SyncTable,
} from '@/api/dataSync'
import SinkOptionsPanel from './SinkOptionsPanel.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
const step = ref(0)
const busy = ref(false)
const loading = ref(false)
const customers = ref<SyncCustomer[]>([])
const targets = ref<SyncDatabase[]>([])
const fileTargets = ref<SyncDatabase[]>([])
const tables = ref<SyncTable[]>([])
// 选完客户时拿到的那页表，是没输入关键词时的候选来源
const baseTables = ref<SyncTable[]>([])
const tableLoading = ref(false)
// 已选那张表要能留进选项，见 withSelected
const selectedTable = ref<SyncTable>()
const columns = ref<SyncColumnMap[]>([])
const originalColumns = ref<SyncColumnMap[]>([])
const entityCopy = ref(false)
// 实体配置：独立开关，勾选后额外同步 cfg_entry_type、cfg_entry_item 两张表
const entryConfig = ref(false)
const taskList = ref<Array<{ taskName: string; cron: string; fromSql: string; type?: string }>>([])
// CK / ES 目标端参数：其它目标类型保持 null，提交时不带该字段，服务端走默认渲染分支
const sinkOptions = ref<SyncSinkOptions | null>(null)
const form = reactive<Record<string, any>>({
  customerId: admin.value ? '' : auth.info?.id ?? '',
  sourceDatabase: 1,
  sourceDatabaseType: 1,
  sourceFileDatabaseType: 1,
  sourceSchema: 'sense_data',
  sourceCode: 'source_mysql_source',
  sourceFileCode: 'minio',
  sourceTable: '',
  sourceTableComment: '',
  entryTypeId: '',
  targetDatabase: '',
  targetDatabaseType: '',
  targetSourceCode: '',
  targetSchema: '',
  targetTable: '',
  targetFileDatabase: '',
  targetFileDatabaseType: '',
  targetFileSourceCode: '',
  targetFileSchema: '',
  fileSyncFlag: false,
  clientId: '',
  syncType: '1',
})

async function loadCustomerOptions() {
  if (!form.customerId) return
  loading.value = true
  try {
    const [dbs, files, sourceTables] = await Promise.all([
      syncApi.customerDatabases(form.customerId, 0),
      syncApi.customerDatabases(form.customerId, 1),
      syncApi.tables(form.customerId),
    ])
    targets.value = dbs ?? []
    fileTargets.value = files ?? []
    tables.value = sourceTables ?? []
    const requestedTable = String(route.query.tableName ?? '').toLowerCase()
    let matched = tables.value.find((item) => item.tableName.toLowerCase() === requestedTable)
    // 接口只回前 10 条：深链带的表不在这一页就按表名再捞一次，并补进选项供 selectTable 取用
    if (requestedTable && !matched) {
      matched = ((await syncApi.tables(form.customerId, requestedTable)) ?? [])
        .find((item) => item.tableName.toLowerCase() === requestedTable)
      if (matched) tables.value = [matched, ...tables.value]
    }
    // 这页列表留作底：关键词清空时直接回给它，不再打一次空关键词的查询
    baseTables.value = tables.value
    if (matched) { form.entryTypeId = matched.entryTypeId; selectTable(matched.entryTypeId) }
  } catch (error) {
    ElMessage.error(String(error))
  } finally {
    loading.value = false
  }
}

watch(() => form.customerId, () => {
  form.entryTypeId = ''
  form.sourceTable = ''
  form.targetDatabase = ''
  form.targetFileDatabase = ''
  form.targetTable = ''
  targets.value = []
  fileTargets.value = []
  tables.value = []
  baseTables.value = []
  selectedTable.value = undefined
  void loadCustomerOptions()
})

onMounted(async () => {
  if (admin.value) {
    try { customers.value = await syncApi.customers() ?? [] }
    catch (error) { ElMessage.error(String(error)) }
  } else {
    await loadCustomerOptions()
  }
})

// 目标端类型决定面板是否存在，切类型必须重置成默认，别带着上一个目标端的参数提交
watch(() => form.targetDatabaseType, () => {
  sinkOptions.value = renderSinkDefaults(form.targetDatabaseType, columns.value)
})

function selectTable(id: string | number) {
  const table = tables.value.find((item) => String(item.entryTypeId) === String(id))
  if (!table) return
  selectedTable.value = table
  // 物理表名按配置原样使用：MySQL 在 Linux 上区分大小写，cfg_entry_type 里存的是 sense_data.TB_XXX，
  // 转小写后 SHOW CREATE TABLE 和同步取数都会报「表不存在」
  form.sourceTable = table.tableName
  form.sourceTableComment = table.typeName
  form.targetTable = targetTableOf(form.sourceTable)
  columns.value = []
}

/** 目标表名沿用旧口径：去掉源 schema 与 tb_ 前缀后转小写 */
function targetTableOf(sourceTable: string): string {
  const schemaPrefix = new RegExp(`^${String(form.sourceSchema)}\\.`, 'i')
  return sourceTable.replace(schemaPrefix, '').replace(/tb_/gi, '').toLowerCase()
}

/** 远程搜索会整页换掉选项，已选那张得留在首位，否则标签退化成裸 entryTypeId、中文名丢失 */
function withSelected(list: SyncTable[]) {
  const kept = selectedTable.value
  return kept && !list.some((item) => String(item.entryTypeId) === String(kept.entryTypeId))
    ? [kept, ...list]
    : list
}

/** 源数据表按表名走服务端 LIKE：接口只回前 10 条，前端过滤搜不到没进首页的表 */
let tableSeq = 0
async function searchTables(name: string) {
  const keyword = name.trim()
  if (!keyword) {
    // 没输入就不打后台：el-select 展开下拉、清空关键词都会回调一次 ''，每次都发等于一轮无意义的 LIKE '%%'
    // 序号照样递增，作废还在飞的关键词请求，否则它的结果会盖回这份底表；转圈也在这里收掉
    tableSeq++
    tableLoading.value = false
    tables.value = withSelected(baseTables.value)
    return
  }
  const seq = ++tableSeq
  tableLoading.value = true
  try {
    const fresh = (await syncApi.tables(form.customerId, keyword)) ?? []
    if (seq !== tableSeq) return
    tables.value = withSelected(fresh)
  } catch (error) {
    if (seq !== tableSeq) return
    ElMessage.error(String(error))
  } finally {
    if (seq === tableSeq) tableLoading.value = false
  }
}

function selectTarget(id: string | number) {
  const target = targets.value.find((item) => String(item.id) === String(id))
  if (!target) return
  form.targetSchema = target.dbSchema
  form.targetSourceCode = target.sourceCode
  form.targetDatabaseType = target.databaseType
  form.clientId = target.appId
}

function selectFileTarget(id: string | number) {
  const target = fileTargets.value.find((item) => String(item.id) === String(id))
  if (!target) return
  form.targetFileSchema = target.dbSchema
  form.targetFileSourceCode = target.sourceCode
  form.targetFileDatabaseType = target.databaseType
}

async function nextTable() {
  // 逐项报出到底缺哪一项：整句「请选择客户、源表和目标数据库」在只缺一项时等于没提示，
  // 而且非管理员看不到客户行，被要求「选客户」时根本无从下手
  const missing: string[] = []
  if (!form.customerId) missing.push(admin.value ? '客户 / 环境' : '登录会话里的客户 ID（请重新登录）')
  if (!form.entryTypeId) missing.push('源数据表')
  if (!form.targetDatabase) missing.push('目标数据库')
  if (!String(form.targetTable ?? '').trim()) missing.push('目标表名称')
  if (form.fileSyncFlag && !form.targetFileDatabase) missing.push('目标文件库')
  if (missing.length) {
    ElMessage.warning(`请完成：${missing.join('、')}`)
    return
  }
  loading.value = true
  try {
    const description = await syncApi.tableColumns(form.entryTypeId)
    columns.value = mapSyncColumns(description ?? [])
    originalColumns.value = columns.value.map((item) => ({ ...item }))
    if (!columns.value.length) {
      ElMessage.warning('源表没有可映射的字段')
      return
    }
    // 默认水位列来自列映射，要在列拿到之后再种一次
    sinkOptions.value = renderSinkDefaults(form.targetDatabaseType, columns.value)
    // 「同步实体」是开着换的表，列要立刻跟着换成物理列全集，否则提交的仍是配置字段
    if (entityCopy.value && !(await applyEntityCopy())) return
    step.value = 1
  } catch (error) {
    ElMessage.error(String(error))
  } finally { loading.value = false }
}

/** 同步实体：列换成源表物理列全集，末尾保证水位列。返回 false 表示这表做不了同步实体 */
async function applyEntityCopy(): Promise<boolean> {
  const physical = await syncApi.physicalColumns(form.sourceTable)
  const rows = mapEntityCopyColumns(physical ?? [], originalColumns.value)
  if (!rows.some((item) => item.targetColumn.toLowerCase() === WATERMARK_COLUMN)) {
    ElMessage.error(`源表 ${form.sourceTable} 既没有 UPDATE_DT 也没有 ${WATERMARK_COLUMN} 列，`
      + '同步实体无法确定增量水位')
    return false
  }
  columns.value = rows
  // 不动 originalColumns：它是「配置字段」那份基线，关掉开关要能退回去
  return true
}

function toggleEntityCopy() {
  if (!entityCopy.value) {
    columns.value = originalColumns.value.map((item) => ({ ...item }))
    return
  }
  loading.value = true
  void applyEntityCopy().then((ok) => {
    if (!ok) entityCopy.value = false
  }).catch((error) => {
    entityCopy.value = false
    ElMessage.error(String(error))
  }).finally(() => { loading.value = false })
}

function addColumn() {
  columns.value.push({ key: `new-${Date.now()}`, no: columns.value.length + 1, sourceColumn: '',
    targetColumn: '', targetColumnType: 'varchar', typeLength: '', remark: '', defaultValue: '',
    distinct: false, fileColumn: '' })
}

function taskCron(): string {
  const hash = md5(form.sourceTable)
  return `${parseInt(hash.slice(8, 16), 16) % 60} ${parseInt(hash.slice(0, 8), 16) % 60} 0/1 * * ?`
}

function nextColumns() {
  if (!columns.value.length || columns.value.some((item) => !item.targetColumn.trim() || !item.targetColumnType.trim())) {
    ElMessage.warning('请为每个字段设置目标列名和数据类型')
    return
  }
  // CK / ES 的目标端参数在这里挡一次，别让整条提交打到服务端才报错
  if (isSinkTarget(form.targetDatabaseType)) {
    const problem = sinkOptionsProblem(sanitizeSinkOptions(sinkOptions.value, form.targetDatabaseType), columns.value)
    if (problem) {
      ElMessage.warning(problem)
      return
    }
  }
  if (!taskList.value.length) {
    taskList.value = [{
      taskName: `${form.sourceTableComment || form.sourceTable}同步任务`,
      cron: taskCron(),
      fromSql: generateSyncSql(form.sourceTable, columns.value),
    }]
    if (form.fileSyncFlag) taskList.value.push({
      type: 'file', taskName: `表{${form.sourceTable}}-文件同步任务`,
      cron: '0 1 1 * * ?', fromSql: generateSyncSql(form.sourceTable, columns.value, true),
    })
  }
  step.value = 2
}

function addTask() {
  if (taskList.value.length >= 3) return ElMessage.warning('最多可以增加 3 个任务')
  taskList.value.push({ taskName: `${form.sourceTableComment}同步任务${taskList.value.length + 1}`,
    cron: taskCron(), fromSql: generateSyncSql(form.sourceTable, columns.value) })
}

async function submit() {
  // el-button 的 disabled 要等一次渲染才生效，同一轮里连点两下会漏进来 → 落两条一样的任务
  if (busy.value) return
  if (taskList.value.some((task) => !task.taskName.trim() || !task.cron.trim() || !task.fromSql.trim())) {
    ElMessage.warning('请填写每个任务的名称、定时策略和 SQL 模板')
    return
  }
  busy.value = true
  try {
    // 旧 Step1→Step2→Step3→SourceBuildForm.commitAll 的最终提交结构。
    await syncApi.saveTask({ ...form, entityCopy: entityCopy.value, entryConfig: entryConfig.value,
      columnMapList: submitSyncColumns(columns.value), taskList: taskList.value,
      sinkOptions: sanitizeSinkOptions(sinkOptions.value, form.targetDatabaseType),
      params: [] })
    ElMessage.success('同步任务创建成功')
    step.value = 3
  } catch (error) { ElMessage.error(String(error)) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="sync-wizard">
    <div class="sync-wizard-head">
      <div><h2>新建数据同步</h2><p>选择现有数据表，配置目标环境及同步任务</p></div>
      <el-button @click="router.push('/sync')">返回任务列表</el-button>
    </div>
    <el-steps :active="step" finish-status="success" class="sync-steps">
      <el-step title="同步表配置" /><el-step title="目标表配置" />
      <el-step title="同步任务配置" /><el-step title="完成" />
    </el-steps>

    <div v-if="step === 0" v-loading="loading" class="sync-wizard-body">
      <!-- 左列目标端、右列源端，同一行是同一项配置的两端；源端没有对应项就留空占位 -->
      <el-form label-position="top" class="sync-grid">
        <template v-if="admin">
          <el-form-item label="客户 / 环境"><el-select v-model="form.customerId" filterable placeholder="选择客户">
            <el-option v-for="item in customers" :key="item.id" :label="item.customerName" :value="item.id" />
          </el-select></el-form-item>
          <div class="sync-cell-blank" />
        </template>
        <el-form-item label="目标数据库类型"><el-input :model-value="DATABASE_TYPE_LABELS[Number(form.targetDatabaseType)] || ''" disabled /></el-form-item>
        <el-form-item label="源数据库类型"><el-select v-model="form.sourceDatabaseType" disabled><el-option label="MySQL" :value="1" /></el-select></el-form-item>
        <el-form-item label="目标数据库"><el-select v-model="form.targetDatabase" filterable placeholder="选择目标环境数据库" @change="selectTarget">
          <el-option v-for="item in targets" :key="item.id" :value="item.id" :label="`${item.name} [${item.sourceCode}] ${item.dbSchema}`" />
        </el-select></el-form-item>
        <el-form-item label="源数据库"><el-input model-value="127.0.0.1" disabled /></el-form-item>
        <el-form-item label="目标 Schema"><el-input v-model="form.targetSchema" /></el-form-item>
        <el-form-item label="源 Schema"><el-input v-model="form.sourceSchema" disabled /></el-form-item>
        <el-form-item label="目标表名称"><el-input v-model="form.targetTable" /></el-form-item>
        <el-form-item label="源数据表"><el-select v-model="form.entryTypeId" filterable remote reserve-keyword
          :remote-method="searchTables" :loading="tableLoading" placeholder="输入表名搜索" @change="selectTable">
          <el-option v-for="item in tables" :key="item.entryTypeId" :value="item.entryTypeId" :label="`${item.tableName} [${item.typeName}]`" />
        </el-select></el-form-item>
        <el-form-item label="同步文件"><el-switch v-model="form.fileSyncFlag" /></el-form-item>
        <div class="sync-cell-blank" />
        <template v-if="form.fileSyncFlag">
          <el-form-item label="目标文件库"><el-select v-model="form.targetFileDatabase" filterable placeholder="选择目标文件库" @change="selectFileTarget">
            <el-option v-for="item in fileTargets" :key="item.id" :value="item.id" :label="`${item.name} [${item.targetSourceCode || item.sourceCode}]`" />
          </el-select></el-form-item>
          <el-form-item label="源文件库类型"><el-input model-value="MinIO" disabled /></el-form-item>
        </template>
      </el-form>
      <div class="sync-actions"><el-button type="primary" :loading="loading" @click="nextTable">下一步</el-button></div>
    </div>

    <div v-else-if="step === 1" class="sync-wizard-body">
      <div class="sync-row"><el-button type="primary" @click="addColumn">增加列</el-button><span>同步实体</span><el-switch v-model="entityCopy" @change="toggleEntityCopy" /><span>实体配置</span><el-switch v-model="entryConfig" /></div>
      <el-table :data="columns" border class="sync-map-table">
        <el-table-column type="index" label="#" width="54" />
        <el-table-column label="源列名" min-width="145"><template #default="{ row }"><el-input v-model="row.sourceColumn" /></template></el-table-column>
        <el-table-column label="目标列名" min-width="145"><template #default="{ row }"><el-input v-model="row.targetColumn" /></template></el-table-column>
        <el-table-column label="数据类型" min-width="130"><template #default="{ row }"><el-select v-model="row.targetColumnType" allow-create filterable>
          <el-option v-for="type in ['varchar', 'int', 'bigint', 'datetime', 'text', 'longtext']" :key="type" :value="type" :label="type" />
        </el-select></template></el-table-column>
        <el-table-column label="长度" width="90"><template #default="{ row }"><el-input v-model="row.typeLength" /></template></el-table-column>
        <el-table-column label="备注" min-width="135"><template #default="{ row }"><el-input v-model="row.remark" /></template></el-table-column>
        <el-table-column label="去重" width="68"><template #default="{ row }"><el-checkbox v-model="row.distinct" /></template></el-table-column>
        <el-table-column v-if="form.fileSyncFlag" label="文件列" min-width="140"><template #default="{ row }"><el-select v-model="row.fileColumn" clearable>
          <el-option v-for="item in ['source_id', 'file_name', 'file_path', 'file_size', 'file_md5', 'origin_update_time']" :key="item" :value="item" :label="item" />
        </el-select></template></el-table-column>
        <el-table-column label="默认值" min-width="120"><template #default="{ row }"><el-input v-model="row.defaultValue" /></template></el-table-column>
        <el-table-column label="操作" width="75"><template #default="{ $index }"><el-button link type="danger" @click="columns.splice($index, 1)">删除</el-button></template></el-table-column>
      </el-table>
      <SinkOptionsPanel v-if="isSinkTarget(form.targetDatabaseType)" :key="form.targetDatabaseType"
        v-model="sinkOptions" :database-type="Number(form.targetDatabaseType)" :columns="columns"
        :target-schema="form.targetSchema" :target-table="form.targetTable" />
      <div class="sync-actions"><el-button @click="step = 0">上一步</el-button><el-button type="primary" @click="nextColumns">下一步</el-button></div>
    </div>

    <div v-else-if="step === 2" class="sync-wizard-body">
      <el-form label-position="top" class="sync-single-form">
        <el-form-item label="同步任务类型"><el-radio-group v-model="form.syncType"><el-radio-button value="1">SQL 查询</el-radio-button></el-radio-group></el-form-item>
        <div v-for="(task, index) in taskList" :key="index" class="sync-task-config">
          <div class="sync-row"><strong>{{ task.type === 'file' ? '文件同步任务' : `同步任务 ${index + 1}` }}</strong><el-button v-if="taskList.length > 1" link type="danger" @click="taskList.splice(index, 1)">删除任务</el-button></div>
          <el-form-item label="任务名称"><el-input v-model="task.taskName" /></el-form-item>
          <el-form-item label="同步定时策略（Cron）"><el-input v-model="task.cron" /></el-form-item>
          <el-form-item label="SQL 模板"><el-input v-model="task.fromSql" type="textarea" :rows="6" /></el-form-item>
        </div>
        <div class="sync-actions"><el-button :disabled="taskList.length >= 3" @click="addTask">增加任务</el-button></div>
      </el-form>
      <div class="sync-actions"><el-button @click="step = 1">上一步</el-button><el-button type="primary" :loading="busy" @click="submit">提交</el-button></div>
    </div>

    <el-result v-else icon="success" title="同步任务已创建" sub-title="可以在任务列表查看、执行和管理同步任务">
      <template #extra><el-button type="primary" @click="router.push('/sync')">查看任务列表</el-button></template>
    </el-result>
  </div>
</template>

<style scoped>
.sync-wizard { padding: 20px; background: #fff; border: 1px solid #e5eaf2; border-radius: 12px; min-height: 100%; }
.sync-wizard-head, .sync-row, .sync-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sync-wizard-head h2 { margin: 0; font-size: 19px; }.sync-wizard-head p { margin: 4px 0 0; color: #64748b; font-size: 13px; }
.sync-steps { margin: 26px 0; }.sync-wizard-body { max-width: 1280px; margin: 0 auto; }.sync-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 22px; max-width: 900px; margin: 0 auto; }
.sync-grid :deep(.el-select), .sync-grid :deep(.el-input) { width: 100%; }.sync-cell-blank { min-height: 32px; }.sync-row { justify-content: flex-start; margin-bottom: 12px; }
.sync-actions { justify-content: center; margin-top: 18px; }.sync-map-table { width: 100%; }.sync-single-form { max-width: 900px; margin: 0 auto; }.sync-task-config { border-top: 1px solid #e5eaf2; padding: 16px 0; }
@media (max-width: 760px) { .sync-grid { grid-template-columns: 1fr; } }
</style>
