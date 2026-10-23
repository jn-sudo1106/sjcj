<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Key, Refresh } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { copyToClipboard } from '@/utils/clipboard'
import {
  DATABASE_TYPE_LABELS, syncApi,
  type SyncClient, type SyncClientSecret, type SyncCustomer, type SyncDatabase,
} from '@/api/dataSync'

const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
// 下拉候选（全量未删客户）与客户表格（分页）分开，否则切到客户页签会把下拉压成一页
const customerOptions = ref<SyncCustomer[]>([])
const customerRows = ref<SyncCustomer[]>([])
const clients = ref<SyncClient[]>([])
const databases = ref<SyncDatabase[]>([])
type TabKey = 'customers' | 'clients' | 'databases'
const active = ref<TabKey>('clients')
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const loadError = ref('')
const filter = reactive({ customerId: admin.value ? '' : String(auth.info?.id ?? '') })

async function loadCustomers() {
  if (!admin.value) return
  try { customerOptions.value = await syncApi.customers() ?? [] }
  catch (error) { ElMessage.error(String(error)) }
}
async function load() {
  loading.value = true
  try {
    const params = { customerId: filter.customerId, pageNo: pageNo.value, pageSize: pageSize.value }
    if (active.value === 'customers') {
      const res = await syncApi.customerPage({ ...params, customerName: '' })
      customerRows.value = res.list ?? []; total.value = res.total ?? 0
    } else if (active.value === 'clients') {
      const res = await syncApi.clients(params); clients.value = res.list ?? []; total.value = res.total ?? 0
    } else {
      const res = await syncApi.databases(params); databases.value = res.list ?? []; total.value = res.total ?? 0
    }
    loadError.value = ''
  } catch (error) { loadError.value = String(error); customerRows.value = []; clients.value = []; databases.value = []; total.value = 0; ElMessage.error(loadError.value) }
  finally { loading.value = false }
}
watch(() => filter.customerId, () => { pageNo.value = 1; void load() })
watch(active, () => { pageNo.value = 1; void load() })
onMounted(async () => {
  await loadCustomers()
  await load()
})

async function changeSwitch(row: SyncClient, column: 'timingSync' | 'fileSync' | 'realtimeSync', enabled: boolean) {
  try { await syncApi.setClientSwitch(row.id, column, enabled); row[column] = enabled ? 'on' : 'off'; ElMessage.success('已更新') }
  catch (error) { ElMessage.error(String(error)); await load() }
}
function databaseType(value: number) { return DATABASE_TYPE_LABELS[value] ?? String(value) }
// 开关列只认 on/off；存量里的 '1'/'0'/空按 DDL 注释「0 关 1 开」归一，避免编辑保存时把「开」写成「关」
function switchOn(value: string | undefined) { return value === 'on' || value === '1' ? 'on' : 'off' }

// ---- 新增/编辑：客户 ----
const customerForm = reactive({ visible: false, saving: false, editing: false, id: '' as string | number, customerName: '' })
function openCustomer(row?: SyncCustomer) {
  Object.assign(customerForm, { visible: true, saving: false, editing: !!row, id: row?.id ?? '', customerName: row?.customerName ?? '' })
}
async function submitCustomer() {
  if (customerForm.id === '' || !String(customerForm.id).trim()) { ElMessage.warning('客户ID由现场分配，必须填写'); return }
  if (!customerForm.customerName.trim()) { ElMessage.warning('请填写客户名称'); return }
  customerForm.saving = true
  try {
    await syncApi.saveCustomer({ id: customerForm.id, customerName: customerForm.customerName.trim() })
    ElMessage.success(customerForm.editing ? '已保存' : '已新增客户')
    customerForm.visible = false
    await loadCustomers()
    await load()
  } catch (error) { ElMessage.error(String(error)) } finally { customerForm.saving = false }
}

// ---- 新增/编辑：客户端 ----
const clientForm = reactive({
  visible: false, saving: false, editing: false, id: null as string | number | null,
  customerId: '' as string | number, clientName: '', timingSync: 'off', fileSync: 'off', realtimeSync: 'off',
  topics: '', extendConfig: '',
})
function openClient(row?: SyncClient) {
  Object.assign(clientForm, {
    visible: true, saving: false, editing: !!row, id: row?.id ?? null,
    customerId: row?.customerId ?? filter.customerId ?? '', clientName: row?.clientName ?? '',
    timingSync: switchOn(row?.timingSync), fileSync: switchOn(row?.fileSync), realtimeSync: switchOn(row?.realtimeSync),
    topics: row?.topics ?? '', extendConfig: row?.extendConfig ?? '',
  })
}
async function submitClient() {
  if (!clientForm.customerId) { ElMessage.warning('请选择所属客户'); return }
  if (!clientForm.clientName.trim()) { ElMessage.warning('请填写客户端名称'); return }
  clientForm.saving = true
  try {
    const res = await syncApi.saveClient({
      id: clientForm.id, customerId: clientForm.customerId, clientName: clientForm.clientName.trim(),
      timingSync: clientForm.timingSync as 'on' | 'off', fileSync: clientForm.fileSync as 'on' | 'off',
      realtimeSync: clientForm.realtimeSync as 'on' | 'off',
      topics: clientForm.topics.trim(), extendConfig: clientForm.extendConfig.trim(),
    })
    clientForm.visible = false
    // 新增才带回明文密钥；编辑时 secretKey 为空，直接刷新列表
    if (res?.secretKey) showSecret(res)
    await load()
  } catch (error) { ElMessage.error(String(error)) } finally { clientForm.saving = false }
}

// ---- 签名密钥：只在新增与重置的响应里出现一次 ----
const secret = reactive({ visible: false, id: '' as string | number, clientName: '', secretKey: '' })
function showSecret(rsp: SyncClientSecret) {
  Object.assign(secret, { visible: true, id: rsp.id, clientName: rsp.clientName, secretKey: rsp.secretKey ?? '' })
}
async function copySecret() {
  await copyToClipboard(secret.secretKey, '密钥')
}
async function resetSecret(row: SyncClient) {
  try {
    await ElMessageBox.confirm(
      `重置后客户端「${row.clientName}」的旧密钥立即失效，在线实例的下一次请求会签名失败，必须改完客户端配置并重启才恢复。确认重置？`,
      '重置签名密钥', { type: 'warning', confirmButtonText: '重置' })
  } catch { return }
  try {
    const rsp = await syncApi.resetClientSecret(row.id)
    if (rsp?.secretKey) showSecret(rsp)
    await load()
  } catch (error) { ElMessage.error(String(error)) }
}

// ---- 新增/编辑：客户数据源 ----
const RELATIONAL_TYPES = [1, 2, 3]
const databaseForm = reactive({
  visible: false, saving: false, editing: false, id: null as string | number | null,
  customerId: '' as string | number, appId: '' as string | number, name: '', sourceCode: '',
  databaseType: 1, dbSchema: '', type: 0, remark: '',
})
const formClients = ref<SyncClient[]>([])
async function openDatabase(row?: SyncDatabase) {
  Object.assign(databaseForm, {
    visible: true, saving: false, editing: !!row, id: row?.id ?? null,
    customerId: row?.customerId ?? filter.customerId ?? '', appId: row?.appId ?? '',
    name: row?.name ?? '', sourceCode: row?.sourceCode ?? '', databaseType: row?.databaseType ?? 1,
    dbSchema: row?.dbSchema ?? '', type: Number(row?.type ?? 0), remark: row?.remark ?? '',
  })
  await loadFormClients(databaseForm.customerId)
}
// appId 落库后会被当成任务归属的客户端id，只能从该客户下的客户端里选
async function loadFormClients(customerId: string | number) {
  formClients.value = []
  if (!customerId) return
  try {
    const res = await syncApi.clients({ customerId, pageNo: 1, pageSize: 200 })
    formClients.value = res.list ?? []
  } catch (error) { ElMessage.error(String(error)) }
}
// 客户下拉由选择框的 change 触发：编辑打开弹窗时也会改 customerId，用 watch 会把刚回填的归属客户端清掉
async function changeFormCustomer(value: string | number) {
  databaseForm.appId = ''
  await loadFormClients(value)
}
async function submitDatabase() {
  if (!databaseForm.customerId) { ElMessage.warning('请选择所属客户'); return }
  if (!databaseForm.appId) { ElMessage.warning('请选择归属客户端'); return }
  if (!databaseForm.name.trim() || !databaseForm.sourceCode.trim()) { ElMessage.warning('请填写数据源名称与编码'); return }
  if (RELATIONAL_TYPES.includes(databaseForm.databaseType) && !databaseForm.dbSchema.trim()) {
    ElMessage.warning('MySQL/PostgreSQL/Oracle 数据源必须填写 schema'); return
  }
  databaseForm.saving = true
  try {
    await syncApi.saveDatabase({
      id: databaseForm.id, customerId: databaseForm.customerId, appId: databaseForm.appId,
      name: databaseForm.name.trim(), sourceCode: databaseForm.sourceCode.trim(),
      databaseType: databaseForm.databaseType, dbSchema: databaseForm.dbSchema.trim(),
      type: databaseForm.type as 0 | 1, remark: databaseForm.remark.trim(),
    })
    ElMessage.success(databaseForm.editing ? '已保存' : '已新增数据源')
    databaseForm.visible = false
    await load()
  } catch (error) { ElMessage.error(String(error)) } finally { databaseForm.saving = false }
}

// ---- 删除：后端会拦下级占用与任务引用，提示按服务端原文展示 ----
async function confirmDelete(title: string, action: () => Promise<unknown>) {
  try { await ElMessageBox.confirm(title, '删除确认', { type: 'warning', confirmButtonText: '删除' }) }
  catch { return }
  try { await action(); ElMessage.success('已删除'); await loadCustomers(); await load() }
  catch (error) { ElMessage.error(String(error)) }
}
function removeCustomer(row: SyncCustomer) {
  void confirmDelete(`确认删除客户「${row.customerName}」（ID ${row.id}）？删除后其下不能再有客户端与数据源。`,
    () => syncApi.removeCustomers([row.id]))
}
function removeClient(row: SyncClient) {
  void confirmDelete(`确认删除客户端「${row.clientName}」（ID ${row.id}）？有任务或在线实例时会被拦下。`,
    () => syncApi.removeClients([row.id]))
}
function removeDatabase(row: SyncDatabase) {
  void confirmDelete(`确认删除数据源「${row.name}」（编码 ${row.sourceCode}）？仍被任务引用时会被拦下。`,
    () => syncApi.removeDatabases([row.id]))
}
</script>

<template>
  <div class="sync-panel">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="sync-alert" />
    <div class="sync-filter">
      <el-select v-if="admin" v-model="filter.customerId" clearable placeholder="全部客户" class="sync-filter-input"><el-option v-for="item in customerOptions" :key="item.id" :value="String(item.id)" :label="item.customerName" /></el-select>
      <div class="sync-filter-actions">
        <el-button class="sync-icon-btn" :icon="Refresh" title="刷新" aria-label="刷新" @click="load" />
        <el-button v-if="admin && active === 'customers'" type="primary" @click="openCustomer()">新增客户</el-button>
        <el-button v-if="admin && active === 'clients'" type="primary" @click="openClient()">新增客户端</el-button>
        <el-button v-if="admin && active === 'databases'" type="primary" @click="openDatabase()">新增数据源</el-button>
      </div>
    </div>
    <el-tabs v-model="active"><el-tab-pane label="客户配置" name="customers" /><el-tab-pane label="客户端配置" name="clients" /><el-tab-pane label="数据源配置" name="databases" /></el-tabs>
    <div v-if="active === 'customers'" class="sync-table-wrap">
      <el-table v-loading="loading" :data="customerRows">
        <el-table-column prop="id" label="客户 ID" width="120" /><el-table-column prop="customerName" label="客户名称" min-width="200" />
        <el-table-column v-if="admin" label="操作" width="80"><template #default="{ row }">
          <div class="rc-actions">
            <el-tooltip content="编辑" placement="top"><span class="rc-op-icon" data-testid="conn-customer-edit" aria-label="编辑" @click="openCustomer(row)"><el-icon :size="15"><Edit /></el-icon></span></el-tooltip>
            <el-tooltip content="删除" placement="top"><span class="rc-op-icon is-danger" data-testid="conn-customer-delete" aria-label="删除" @click="removeCustomer(row)"><el-icon :size="15"><Delete /></el-icon></span></el-tooltip>
          </div>
        </template></el-table-column>
      </el-table>
    </div>
    <div v-else-if="active === 'clients'" class="sync-table-wrap">
      <el-table v-loading="loading" :data="clients">
        <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="customerId" label="客户 ID" width="90" />
        <el-table-column prop="clientName" label="应用名称" min-width="160" />
        <el-table-column v-for="item in [{ key: 'timingSync', label: '定时同步' }, { key: 'fileSync', label: '文件同步' }, { key: 'realtimeSync', label: '实时同步' }] as const" :key="item.key" :label="item.label" width="115">
          <template #default="{ row }"><el-switch :model-value="row[item.key] === 'on'" @change="(val: boolean) => changeSwitch(row, item.key, val)" /><span class="sync-state">{{ row[item.key] === 'on' ? '开启' : '关闭' }}</span></template>
        </el-table-column>
        <el-table-column prop="topics" label="消息主题" min-width="160" show-overflow-tooltip /><el-table-column prop="extendConfig" label="扩展参数" min-width="180" show-overflow-tooltip />
        <el-table-column prop="updateTime" label="更新时间" width="170" />
        <el-table-column v-if="admin" label="操作" width="120"><template #default="{ row }">
          <div class="rc-actions">
            <el-tooltip content="编辑" placement="top"><span class="rc-op-icon" data-testid="conn-client-edit" aria-label="编辑" @click="openClient(row)"><el-icon :size="15"><Edit /></el-icon></span></el-tooltip>
            <el-tooltip content="重置签名密钥" placement="top"><span class="rc-op-icon" data-testid="conn-client-reset-secret" aria-label="重置签名密钥" @click="resetSecret(row)"><el-icon :size="15"><Key /></el-icon></span></el-tooltip>
            <el-tooltip content="删除" placement="top"><span class="rc-op-icon is-danger" data-testid="conn-client-delete" aria-label="删除" @click="removeClient(row)"><el-icon :size="15"><Delete /></el-icon></span></el-tooltip>
          </div>
        </template></el-table-column>
      </el-table>
    </div>
    <div v-else class="sync-table-wrap">
      <el-table v-loading="loading" :data="databases">
        <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="name" label="名称" min-width="150" /><el-table-column prop="sourceCode" label="数据源名称" min-width="180" />
        <el-table-column prop="appId" label="归属客户端" width="120" />
        <el-table-column prop="dbSchema" label="Schema" min-width="150" /><el-table-column label="数据库类型" width="120"><template #default="{ row }">{{ databaseType(row.databaseType) }}</template></el-table-column>
        <el-table-column label="类型" width="90"><template #default="{ row }">{{ Number(row.type) === 0 ? '数据库' : '文件库' }}</template></el-table-column>
        <el-table-column prop="updateTime" label="更新时间" width="170" />
        <el-table-column v-if="admin" label="操作" width="80"><template #default="{ row }">
          <div class="rc-actions">
            <el-tooltip content="编辑" placement="top"><span class="rc-op-icon" data-testid="conn-database-edit" aria-label="编辑" @click="openDatabase(row)"><el-icon :size="15"><Edit /></el-icon></span></el-tooltip>
            <el-tooltip content="删除" placement="top"><span class="rc-op-icon is-danger" data-testid="conn-database-delete" aria-label="删除" @click="removeDatabase(row)"><el-icon :size="15"><Delete /></el-icon></span></el-tooltip>
          </div>
        </template></el-table-column>
      </el-table>
    </div>
    <el-pagination v-model:current-page="pageNo" v-model:page-size="pageSize" class="sync-pagination" :total="total" :page-sizes="[10, 20, 50, 100]" size="small" background layout="total, sizes, prev, pager, next" @change="load" />

    <el-dialog v-model="customerForm.visible" :title="customerForm.editing ? '编辑客户' : '新增客户'" width="420px">
      <el-form label-width="90px">
        <el-form-item label="客户 ID">
          <el-input v-model="customerForm.id" :disabled="customerForm.editing" placeholder="现场分配，与 user 表 group_id 对齐" />
        </el-form-item>
        <el-form-item label="客户名称"><el-input v-model="customerForm.customerName" maxlength="50" /></el-form-item>
      </el-form>
      <p class="sync-tip">客户 ID 不是自增号，由现场按上游组织的 group_id 指定；同一 ID 若已被删除过则不可复用。</p>
      <template #footer><el-button @click="customerForm.visible = false">取消</el-button><el-button type="primary" :loading="customerForm.saving" @click="submitCustomer">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="clientForm.visible" :title="clientForm.editing ? '编辑客户端' : '新增客户端'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="所属客户">
          <el-select v-model="clientForm.customerId" filterable :disabled="clientForm.editing" placeholder="选择客户" style="width:100%">
            <el-option v-for="item in customerOptions" :key="item.id" :value="item.id" :label="item.customerName" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户端名称"><el-input v-model="clientForm.clientName" maxlength="50" /></el-form-item>
        <el-form-item label="定时同步"><el-switch v-model="clientForm.timingSync" active-value="on" inactive-value="off" /></el-form-item>
        <el-form-item label="文件同步"><el-switch v-model="clientForm.fileSync" active-value="on" inactive-value="off" /></el-form-item>
        <el-form-item label="实时同步"><el-switch v-model="clientForm.realtimeSync" active-value="on" inactive-value="off" /></el-form-item>
        <el-form-item label="消息主题"><el-input v-model="clientForm.topics" maxlength="100" placeholder="多个主题用逗号分隔" /></el-form-item>
        <el-form-item label="扩展参数"><el-input v-model="clientForm.extendConfig" type="textarea" :rows="2" maxlength="500" /></el-form-item>
      </el-form>
      <p class="sync-tip">开关只写 on/off；客户端把配置值转小写后与 off 比较，写 0/1 会读成常开，留空则取值时直接空指针。</p>
      <template #footer><el-button @click="clientForm.visible = false">取消</el-button><el-button type="primary" :loading="clientForm.saving" @click="submitClient">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="databaseForm.visible" :title="databaseForm.editing ? '编辑数据源' : '新增数据源'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="所属客户">
          <el-select v-model="databaseForm.customerId" filterable :disabled="databaseForm.editing" placeholder="选择客户" style="width:100%" @change="changeFormCustomer">
            <el-option v-for="item in customerOptions" :key="item.id" :value="item.id" :label="item.customerName" />
          </el-select>
        </el-form-item>
        <el-form-item label="归属客户端">
          <el-select v-model="databaseForm.appId" filterable placeholder="选择客户端" style="width:100%">
            <el-option v-for="item in formClients" :key="item.id" :value="item.id" :label="item.clientName" />
          </el-select>
        </el-form-item>
        <el-form-item label="数据源名称"><el-input v-model="databaseForm.name" maxlength="100" placeholder="页面展示用名称" /></el-form-item>
        <el-form-item label="数据源编码"><el-input v-model="databaseForm.sourceCode" maxlength="100" placeholder="客户端配置里的 spring.datasource.*.name" /></el-form-item>
        <el-form-item label="数据库类型">
          <el-select v-model="databaseForm.databaseType" style="width:100%">
            <el-option v-for="(label, value) in DATABASE_TYPE_LABELS" :key="value" :value="Number(value)" :label="label" />
          </el-select>
        </el-form-item>
        <el-form-item label="Schema"><el-input v-model="databaseForm.dbSchema" maxlength="20" :placeholder="RELATIONAL_TYPES.includes(databaseForm.databaseType) ? '关系型库必填' : 'ClickHouse / Elasticsearch 留空'" /></el-form-item>
        <el-form-item label="环境类型">
          <el-radio-group v-model="databaseForm.type"><el-radio :value="0">数据库</el-radio><el-radio :value="1">文件库</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="databaseForm.remark" type="textarea" :rows="2" maxlength="500" /></el-form-item>
      </el-form>
      <p class="sync-tip">归属客户端就是任务的所属客户端：建任务时按它反填，填错会让任务与统计挂到别的客户端上。</p>
      <template #footer><el-button @click="databaseForm.visible = false">取消</el-button><el-button type="primary" :loading="databaseForm.saving" @click="submitDatabase">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="secret.visible" title="客户端签名密钥" width="520px">
      <p class="sync-tip">密钥只在本次响应里明文出现一次，关掉就再也拿不到，丢失只能重置。请立即抄走或复制。</p>
      <el-form label-width="110px">
        <el-form-item label="客户端名称"><span>{{ secret.clientName }}</span></el-form-item>
        <el-form-item label="client.id"><code class="sync-code">client.id={{ secret.id }}</code></el-form-item>
        <el-form-item label="client.key">
          <el-input :model-value="secret.secretKey" readonly type="textarea" :rows="2" />
          <el-button link type="primary" @click="copySecret">复制密钥</el-button>
        </el-form-item>
      </el-form>
      <p class="sync-tip">把上面两行写进客户端的 <code>application-*.properties</code>，新增客户端需启动、改过密钥的客户端需重启后才会生效。</p>
      <template #footer><el-button @click="secret.visible = false">我已保存</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 页面骨架与配色对齐「建表 SQL」页（SqlTaskTab）：整宽、筛选栏右侧动作组、浅描边圆角表格、小号分页 */
.sync-panel { min-height: 0; }
.sync-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.sync-filter-input { width: 180px; }
.sync-filter-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.sync-icon-btn { width: 32px; padding: 0; }
.sync-alert { margin-bottom: 12px; }
.sync-state { margin-left: 6px; color: #64748b; font-size: 12px; }
.sync-table-wrap { overflow: hidden; border: 1px solid #eef2f7; border-radius: 8px; --el-table-border-color: #eef2f7; --el-table-header-bg-color: #f8fafc; --el-table-header-text-color: #475569; --el-table-row-hover-bg-color: #f8fbff; }
.sync-table-wrap :deep(.el-table) { font-size: 13px; }
.sync-pagination { justify-content: flex-end; margin-top: 14px; }
.sync-tip { margin: 6px 0; color: #64748b; font-size: 12px; line-height: 1.6; }
.sync-code { display: inline-block; padding: 4px 8px; background: #f1f5f9; border-radius: 4px; font-size: 12px; word-break: break-all; }
</style>
