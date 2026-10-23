<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import md5 from 'md5'
import { useAuthStore } from '@/stores/auth'
import {
  WATERMARK_COLUMN, generateSyncSql, mapEntityCopyColumns, mapSyncColumns, renderSinkDefaults,
  sanitizeSinkOptions, sinkOptionsProblem, submitSyncColumns, syncApi,
  type SyncColumnMap, type SyncCustomer, type SyncDatabase,
} from '@/api/dataSync'
import type { EntryType } from '@/api'

const props = defineProps<{ modelValue: boolean; entry: EntryType | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; created: [] }>()

const router = useRouter()
const auth = useAuthStore()
// 管理员口径与向导一致（TaskWizard 按登录名判定，不是 roles）
const admin = computed(() => auth.info?.name === 'admin')

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const loading = ref(false)
const busy = ref(false)
const done = ref(false)
const customerOptions = ref<SyncCustomer[]>([])
const customerId = ref<number | string>(admin.value ? '' : (auth.info?.id ?? ''))
const ckTargets = ref<SyncDatabase[]>([])
const columns = ref<SyncColumnMap[]>([])
const baselineColumns = ref<SyncColumnMap[]>([])
const physical = ref<SyncColumnMap[]>([])
const entityCopy = ref(true)
const entryConfig = ref(false)
const form = reactive({
  targetDatabase: '' as number | string,
  targetSchema: '',
  taskName: '',
  cron: '',
})

// 物理表名按配置原样使用：MySQL 表名区分大小写，转小写后取数会指向不存在的表
const sourceTable = computed(() => props.entry?.tableName ?? '')
// 目标表名固定与源表同名（只去掉 schema 前缀，保留 tb_），不在弹窗里编辑；目标侧沿用旧口径小写
const targetTable = computed(() => (sourceTable.value.split('.').pop() ?? '').toLowerCase())

// 与向导 taskCron 同算法：md5(sourceTable) 取两段十六进制散列
function taskCron(): string {
  const hash = md5(sourceTable.value)
  return `${parseInt(hash.slice(8, 16), 16) % 60} ${parseInt(hash.slice(0, 8), 16) % 60} 0/1 * * ?`
}

/** 同步实体：列换成源表物理列全集，末尾保证水位列。返回 false 表示这表做不了同步实体（文案与向导逐字一致） */
function applyEntityCopy(): boolean {
  columns.value = mapEntityCopyColumns(physical.value, baselineColumns.value)
  if (!columns.value.some((item) => item.targetColumn.toLowerCase() === WATERMARK_COLUMN)) {
    ElMessage.error(`源表 ${sourceTable.value} 既没有 UPDATE_DT 也没有 ${WATERMARK_COLUMN} 列，`
      + '同步实体无法确定增量水位')
    return false
  }
  return true
}

function toggleEntityCopy() {
  if (!entityCopy.value) {
    columns.value = baselineColumns.value.map((item) => ({ ...item }))
    return
  }
  if (!applyEntityCopy()) entityCopy.value = false
}

function selectCkTarget(id: number | string) {
  const target = ckTargets.value.find((item) => String(item.id) === String(id))
  if (!target) return
  // 自动选中也要回写模型值，否则提交校验会当「未选目标库」拦下
  form.targetDatabase = target.id
  form.targetSchema = target.dbSchema
}

/** CK 目标库：customerDatabases(customerId, 0) 过滤 databaseType === 4；只有一个时自动选中 */
async function fetchCkTargets() {
  if (!customerId.value) { ckTargets.value = []; return }
  const dbs = (await syncApi.customerDatabases(customerId.value, 0)) ?? []
  ckTargets.value = dbs.filter((item) => Number(item.databaseType) === 4)
  const still = ckTargets.value.find((item) => String(item.id) === String(form.targetDatabase))
  if (still) {
    form.targetSchema = still.dbSchema
  } else if (ckTargets.value.length === 1) {
    selectCkTarget(ckTargets.value[0].id)
  } else {
    form.targetDatabase = ''
    form.targetSchema = ''
  }
}

/** 客户切换只重拉 CK 目标库；两份列是全局 cfg 表数据，与客户无关，不重拉 */
async function reloadCkTargets() {
  loading.value = true
  try {
    await fetchCkTargets()
  } catch (error) {
    ElMessage.error(String(error))
  } finally {
    loading.value = false
  }
}

function prefillForm(entry: EntryType) {
  form.taskName = `${entry.name || entry.tableName}同步CK任务`
  form.cron = taskCron()
}

async function loadAll() {
  const entry = props.entry
  if (!entry) return
  done.value = false
  entityCopy.value = true
  entryConfig.value = false
  columns.value = []
  baselineColumns.value = []
  physical.value = []
  form.targetDatabase = ''
  form.targetSchema = ''
  loading.value = true
  try {
    if (admin.value) {
      try {
        customerOptions.value = (await syncApi.customers()) ?? []
      } catch (error) {
        ElMessage.error(String(error))
      }
    }
    await fetchCkTargets()
    const configured = (await syncApi.tableColumns(entry.tableId)) ?? []
    baselineColumns.value = mapSyncColumns(configured)
    physical.value = (await syncApi.physicalColumns(entry.tableName)) ?? []
    applyEntityCopy()
    prefillForm(entry)
  } catch (error) {
    ElMessage.error(String(error))
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => { if (open) void loadAll() })
watch(customerId, () => { void reloadCkTargets() })

const watermarkMissing = computed(() =>
  entityCopy.value
  && columns.value.length > 0
  && !columns.value.some((item) => item.targetColumn.toLowerCase() === WATERMARK_COLUMN))

const blockedReason = computed(() => {
  if (admin.value && !customerId.value) return '请选择客户后再创建'
  if (!loading.value && ckTargets.value.length === 0) return '该客户没有 ClickHouse 目标库，请先在同步平台配置'
  if (watermarkMissing.value) {
    return `源表 ${sourceTable.value} 既没有 UPDATE_DT 也没有 ${WATERMARK_COLUMN} 列，同步实体无法确定增量水位`
  }
  return ''
})

const confirmDisabled = computed(() => loading.value || busy.value || !!blockedReason.value)

function gotoList() {
  visible.value = false
  router.push('/sync')
}

async function submit() {
  const entry = props.entry
  if (!entry) return
  // 校验顺序见设计文档 §六；el-button 的 disabled 要等一次渲染才生效，busy 兜住同轮连点
  if (busy.value) return
  if (admin.value && !customerId.value) {
    ElMessage.warning('请选择客户')
    return
  }
  if (!form.targetDatabase) {
    ElMessage.warning('请选择 ClickHouse 目标库')
    return
  }
  if (!columns.value.length) {
    ElMessage.warning('源表没有可映射的字段')
    return
  }
  if (!form.taskName.trim() || !form.cron.trim()) {
    ElMessage.warning('请填写任务名称和定时策略')
    return
  }
  const sink = sanitizeSinkOptions(renderSinkDefaults(4, columns.value), 4)
  const problem = sinkOptionsProblem(sink, columns.value)
  if (problem) {
    ElMessage.warning(problem)
    return
  }
  const target = ckTargets.value.find((item) => String(item.id) === String(form.targetDatabase))
  if (!target) {
    ElMessage.warning('请选择 ClickHouse 目标库')
    return
  }
  busy.value = true
  try {
    // 与向导最终提交同一契约（POST /task-overview/info），源端固定默认与向导 form 初始值一致
    await syncApi.saveTask({
      customerId: customerId.value,
      entryTypeId: entry.tableId,
      sourceTable: sourceTable.value,
      sourceTableComment: entry.name || entry.tableName,
      sourceCode: 'source_mysql_source',
      sourceSchema: 'sense_data',
      sourceDatabase: 1,
      sourceDatabaseType: 1,
      sourceFileCode: 'minio',
      syncType: '1',
      fileSyncFlag: false,
      targetDatabase: target.id,
      targetSourceCode: target.sourceCode,
      targetDatabaseType: 4,
      targetSchema: form.targetSchema,
      targetTable: targetTable.value,
      clientId: target.appId,
      entityCopy: entityCopy.value,
      entryConfig: entryConfig.value,
      columnMapList: submitSyncColumns(columns.value),
      sinkOptions: sink,
      taskList: [{
        taskName: form.taskName.trim(),
        cron: form.cron.trim(),
        fromSql: generateSyncSql(sourceTable.value, columns.value),
      }],
      params: [],
    })
    done.value = true
    emit('created')
  } catch (error) {
    ElMessage.error(String(error))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="快速同步" width="560px" append-to-body>
    <div v-loading="loading" class="qck-body">
      <el-result v-if="done" icon="success" title="同步任务已创建" sub-title="可以在任务列表查看、执行和管理同步任务" />
      <el-form v-else-if="entry" label-position="top" class="qck-form">
        <el-form-item v-if="admin" label="客户">
          <el-select v-model="customerId" filterable placeholder="选择客户" data-testid="qck-customer">
            <el-option v-for="item in customerOptions" :key="item.id" :label="item.customerName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="ClickHouse 目标库">
          <el-select v-model="form.targetDatabase" filterable placeholder="选择目标库" data-testid="qck-target" @change="selectCkTarget">
            <el-option v-for="item in ckTargets" :key="item.id" :value="item.id" :label="`${item.name} [${item.sourceCode}] ${item.dbSchema}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="目标 Schema"><el-input :model-value="form.targetSchema" disabled data-testid="qck-target-schema" /></el-form-item>
        <el-form-item label="目标表名称"><el-input :model-value="targetTable" disabled data-testid="qck-target-table" /></el-form-item>
        <el-form-item label="任务名称"><el-input v-model="form.taskName" /></el-form-item>
        <el-form-item label="同步定时策略（Cron）"><el-input v-model="form.cron" /></el-form-item>
        <div class="qck-switches">
          <el-switch v-model="entityCopy" data-testid="qck-entity-copy" @change="toggleEntityCopy" />
          <span>同步实体</span>
          <el-switch v-model="entryConfig" data-testid="qck-entry-config" />
          <span>实体配置</span>
        </div>
        <div v-if="blockedReason" class="qck-block" data-testid="qck-block">{{ blockedReason }}</div>
        <div class="qck-columns muted">列映射 {{ columns.length }} 列{{ entityCopy ? '（同步实体：物理列全集）' : '（配置字段）' }}</div>
      </el-form>
    </div>
    <template #footer>
      <template v-if="done">
        <el-button type="primary" data-testid="qck-goto-list" @click="gotoList">查看任务列表</el-button>
        <el-button data-testid="qck-close" @click="visible = false">关闭</el-button>
      </template>
      <template v-else>
        <el-button data-testid="qck-cancel" @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="confirmDisabled" :loading="busy" data-testid="qck-confirm" @click="submit">创建任务</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.qck-body { min-height: 160px; }
.qck-form :deep(.el-select), .qck-form :deep(.el-input) { width: 100%; }
.qck-switches { display: flex; align-items: center; gap: 8px; margin: 6px 0 10px; }
.qck-switches span { font-size: 12px; color: var(--rc-muted, #64748b); margin-right: 10px; }
.qck-block { margin: 6px 0 10px; padding: 8px 12px; border-radius: 6px; background: #fef3f2; border: 1px solid #fbc4c4; color: #c0392b; font-size: 12px; }
.qck-columns { font-size: 12px; }
</style>
