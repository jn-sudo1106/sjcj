<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Delete, Edit, Hide, Key, Refresh, View } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { copyToClipboard } from '@/utils/clipboard'
import {
  DATABASE_TYPE_LABELS, syncApi,
  type SyncClient, type SyncClientSecret, type SyncCustomer, type SyncCustomerSecret, type SyncDatabase,
} from '@/api/dataSync'

const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
// 下拉候选（全量未删客户）与客户表格（分页）分开，否则切到客户页签会把下拉压成一页
const customerOptions = ref<SyncCustomer[]>([])
const customerRows = ref<SyncCustomer[]>([])
/** 已展开明文的客户行：key = 客户 id，值 = 接口取回的明文。只存组件内存，收起、刷新或换页即丢弃 */
const revealed = ref<Record<string, string>>({})
const clients = ref<SyncClient[]>([])
const databases = ref<SyncDatabase[]>([])
type TabKey = 'customers' | 'clients' | 'databases'
const active = ref<TabKey>('customers')
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const loadError = ref('')
// 名称映射用的客户端上限：一次取全，否则跨客户的行只能显示 #ID
const CLIENT_MAP_SIZE = 500
const filter = reactive({ customerId: admin.value ? '' : String(auth.info?.id ?? '') })

async function loadCustomers() {
  try {
    // 非 admin 不走 /customer/all（那会把其它客户名单发给无关账号），只取自己所属客户
    customerOptions.value = admin.value
      ? (await syncApi.customers()) ?? []
      : (await syncApi.customerPage({ customerId: filter.customerId, pageNo: 1, pageSize: 10 })).list ?? []
  }
  catch (error) { ElMessage.error(String(error)) }
}

// ---- 归属名称解析：客户端/客户是按 ID 存的，页面上要落到名称 ----
// 列表按 ID 显示名称用的全量客户端映射；186 实测存量里有 customerId=1、appId=0/10005 这类指向已删对象的行，
// 所以取不到名称时保留 #ID 并说明原因，不能只把裸 ID 顶到界面上让人以为显示坏了。
const clientNameById = ref(new Map<string, string>())
async function refreshClientMap() {
  try {
    const res = await syncApi.clients(filter.customerId
      ? { customerId: filter.customerId, pageNo: 1, pageSize: CLIENT_MAP_SIZE }
      : { pageNo: 1, pageSize: CLIENT_MAP_SIZE })
    clientNameById.value = new Map((res.list ?? []).map((item) => [String(item.id), item.clientName]))
  } catch { clientNameById.value = new Map() }
}

function clientLabel(appId: unknown) {
  const key = String(appId ?? '')
  if (!key || key === '0') return '未归属'
  return clientNameById.value.get(key) || `#${key}`
}

function customerLabel(customerId: unknown) {
  const key = String(customerId ?? '')
  if (!key) return '—'
  return customerOptions.value.find((item) => String(item.id) === key)?.customerName || `#${key}`
}

/** 下拉候选 = 现有名单 + 当前值不在名单里时的兜底项（locked，选不中，只为把裸 ID 换成能说清原因的文字） */
function customerChoices(selected: string | number) {
  const key = String(selected ?? '')
  const list = customerOptions.value.map((item) => ({ id: String(item.id), customerName: item.customerName, locked: false }))
  if (key && !list.some((item) => item.id === key)) {
    list.unshift({ id: key, customerName: `客户 #${key}（不在客户名单里，需重新选择）`, locked: true })
  }
  return list
}

function clientChoices(selected: string | number) {
  const key = String(selected ?? '')
  const list = formClients.value.map((item) => ({ id: String(item.id), clientName: item.clientName, locked: false }))
  if (key && !list.some((item) => item.id === key)) {
    const label = key === '0' ? '未归属客户端（需选择归属）' : `客户端 #${key}（不属于该客户或已删除，需重新选择）`
    list.unshift({ id: key, clientName: label, locked: true })
  }
  return list
}
async function load() {
  loading.value = true
  // 每次重新取列表都丢弃已展开的明文：列表数据可能已变，留着旧明文会显示成上一轮的值
  revealed.value = {}
  // 客户页签不显示归属名称，省掉一次全量客户端查询
  if (active.value !== 'customers') void refreshClientMap()
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

async function changeSwitch(row: SyncClient, column: 'timingSync' | 'fileSync', enabled: boolean) {
  try { await syncApi.setClientSwitch(row.id, column, enabled); row[column] = enabled ? 'on' : 'off'; ElMessage.success('已更新') }
  catch (error) { ElMessage.error(String(error)); await load() }
}
function databaseType(value: number) { return DATABASE_TYPE_LABELS[value] ?? String(value) }
// 开关列只认 on/off；存量里的 '1'/'0'/空按 DDL 注释「0 关 1 开」归一，避免编辑保存时把「开」写成「关」
function switchOn(value: string | undefined) { return value === 'on' || value === '1' ? 'on' : 'off' }

// ---- 新增/编辑：客户 ----
const customerForm = reactive({ visible: false, saving: false, editing: false, id: '' as string | number, customerName: '', secretKey: '' })
function openCustomer(row?: SyncCustomer) {
  // secretKey 一律不回填：列表下来的是掩码，把 CUST••••••EY-5 顶回输入框再提交会把真密钥覆盖成打码串
  Object.assign(customerForm, { visible: true, saving: false, editing: !!row, id: row?.id ?? '', customerName: row?.customerName ?? '', secretKey: '' })
}
async function submitCustomer() {
  if (customerForm.id === '' || !String(customerForm.id).trim()) { ElMessage.warning('客户ID由现场分配，必须填写'); return }
  if (!customerForm.customerName.trim()) { ElMessage.warning('请填写客户名称'); return }
  const secretKey = customerForm.secretKey.trim()
  if (secretKey) {
    const reason = illegalKeyReason(secretKey)
    if (reason) { ElMessage.warning(`密钥不可用：${reason}`); return }
  }
  customerForm.saving = true
  try {
    // 留空就完全不带上这个键，服务端按「不改动」处理（新增时由服务端生成一份）
    await syncApi.saveCustomer({ id: customerForm.id, customerName: customerForm.customerName.trim(), ...(secretKey ? { secretKey } : {}) })
    ElMessage.success(customerForm.editing ? '已保存' : '已新增客户')
    customerForm.visible = false
    await loadCustomers()
    await load()
  } catch (error) { ElMessage.error(String(error)) } finally { customerForm.saving = false }
}

// ---- 客户密钥（sk）取用：列表只有掩码，明文按行取、按需复制 ----
async function toggleReveal(row: SyncCustomer) {
  const key = String(row.id)
  if (revealed.value[key]) { delete revealed.value[key]; return }
  try {
    const rsp = await syncApi.customerSecret(row.id)
    revealed.value[key] = rsp?.secretKey ?? ''
  } catch (error) { ElMessage.error(String(error)) }
}
async function copyCustomerSecret(row: SyncCustomer) {
  const key = String(row.id)
  let plain = revealed.value[key]
  if (!plain) {
    try { plain = (await syncApi.customerSecret(row.id))?.secretKey ?? '' }
    catch (error) { ElMessage.error(String(error)); return }
    revealed.value[key] = plain
  }
  await copyToClipboard(plain, '客户密钥')
}
function customerSecretHint(row: SyncCustomer): string {
  const plain = revealed.value[String(row.id)]
  // 明文在手上才谈得上形态是否合法；只有掩码时判不出来，不能拿掩码去凑结论
  if (!plain) return ''
  return illegalKeyReason(plain)
}
/**
 * 与同步客户端 SecretKeyConfig 同口径的输入预检（能 Base64 解出、解码后 16/24/32 字节），
 * 只为把错误提前到输入框与列表角标；服务端保存时仍按同一规则复核，这里不替代它。
 */
function illegalKeyReason(value: string): string {
  let decoded: string
  try { decoded = atob(value) }
  catch { return '不是合法 Base64 密钥，可留空由服务端生成' }
  return [16, 24, 32].includes(decoded.length) ? '' : `解码后是 ${decoded.length} 字节，AES 密钥只支持 16/24/32 字节`
}

// ---- 新增/编辑：客户端 ----
const clientForm = reactive({
  visible: false, saving: false, editing: false, id: null as string | number | null,
  customerId: '' as string | number, clientName: '', timingSync: 'off', fileSync: 'off', extendConfig: '',
})
function openClient(row?: SyncClient) {
  Object.assign(clientForm, {
    visible: true, saving: false, editing: !!row, id: row?.id ?? null,
    // 一律取成字符串：候选项 value 也是字符串，两边类型不一致时 el-select 会把裸 ID 顶到界面上
    customerId: row?.customerId != null ? String(row.customerId) : (filter.customerId || ''), clientName: row?.clientName ?? '',
    timingSync: switchOn(row?.timingSync), fileSync: switchOn(row?.fileSync),
    extendConfig: row?.extendConfig ?? '',
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
      extendConfig: clientForm.extendConfig.trim(),
    })
    clientForm.visible = false
    // 新增才带回明文密钥；编辑时 secretKey 为空，直接刷新列表
    if (res?.secretKey) showClientSecret(res)
    await load()
  } catch (error) { ElMessage.error(String(error)) } finally { clientForm.saving = false }
}

// ---- 密钥：只在新增与重置的响应里出现一次（客户端那份参与签名，客户那份当前只做登记） ----
const secret = reactive({
  visible: false, kind: 'client' as 'client' | 'customer',
  id: '' as string | number, name: '', secretKey: '',
})
function showClientSecret(rsp: SyncClientSecret) {
  Object.assign(secret, { visible: true, kind: 'client', id: rsp.id, name: rsp.clientName, secretKey: rsp.secretKey ?? '' })
}
function showCustomerSecret(rsp: SyncCustomerSecret) {
  Object.assign(secret, { visible: true, kind: 'customer', id: rsp.id, name: rsp.customerName, secretKey: rsp.secretKey ?? '' })
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
    if (rsp?.secretKey) showClientSecret(rsp)
    await load()
  } catch (error) { ElMessage.error(String(error)) }
}

/**
 * 生成/重置客户密钥。建客户时 secret_key 只是为满足 NOT NULL 的占位值，这里换成一份新的；
 * 客户密钥没有校验方消费，所以不会让在线客户端签名失败，与客户端密钥的口径不同
 */
async function resetCustomerSecret(row: SyncCustomer) {
  try {
    await ElMessageBox.confirm(
      `客户「${row.customerName}」建号时的占位密钥会被替换，旧值立即作废。客户密钥当前不参与签名，重置不影响在线客户端。确认生成新密钥？`,
      '生成/重置客户密钥', { type: 'warning', confirmButtonText: '生成' })
  } catch { return }
  try {
    const rsp = await syncApi.resetCustomerSecret(row.id)
    if (rsp?.secretKey) showCustomerSecret(rsp)
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
    visible: false, saving: false, editing: !!row, id: row?.id ?? null,
    customerId: row?.customerId != null ? String(row.customerId) : (filter.customerId || ''),
    appId: row?.appId != null ? String(row.appId) : '',
    name: row?.name ?? '', sourceCode: row?.sourceCode ?? '', databaseType: row?.databaseType ?? 1,
    dbSchema: row?.dbSchema ?? '', type: Number(row?.type ?? 0), remark: row?.remark ?? '',
  })
  // 先取到该客户下的客户端再开弹窗：否则回填的 appId 在候选里找不到，会闪一下「已删除」的兜底文案
  await loadFormClients(databaseForm.customerId)
  databaseForm.visible = true
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
        <el-table-column prop="id" label="客户 ID" width="110" />
        <el-table-column prop="customerName" label="客户名称" width="220" show-overflow-tooltip />
        <el-table-column label="密钥 (sk)" min-width="260">
          <template #default="{ row }">
            <div class="conn-secret">
              <span v-if="!row.secretKey" class="conn-secret-none">未设置</span>
              <template v-else>
                <span class="conn-secret-value" :class="{ 'is-plain': revealed[row.id] }">{{ revealed[row.id] || row.secretKey }}</span>
                <el-tooltip v-if="customerSecretHint(row)" :content="customerSecretHint(row)" placement="top"><span class="conn-secret-warn">非 AES 密钥</span></el-tooltip>
                <el-tooltip :content="revealed[row.id] ? '隐藏明文' : '查看明文'" placement="top"><span class="rc-op-icon" data-testid="conn-customer-secret-toggle" :aria-label="revealed[row.id] ? '隐藏明文' : '查看明文'" @click="toggleReveal(row)"><el-icon :size="15"><Hide v-if="revealed[row.id]" /><View v-else /></el-icon></span></el-tooltip>
                <el-tooltip content="复制密钥" placement="top"><span class="rc-op-icon" data-testid="conn-customer-secret-copy" aria-label="复制密钥" @click="copyCustomerSecret(row)"><el-icon :size="15"><CopyDocument /></el-icon></span></el-tooltip>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="createTime" label="创建时间" width="170" /><el-table-column prop="updateTime" label="更新时间" width="170" />
        <el-table-column v-if="admin" label="操作" width="110"><template #default="{ row }">
          <div class="rc-actions">
            <el-tooltip content="编辑" placement="top"><span class="rc-op-icon" data-testid="conn-customer-edit" aria-label="编辑" @click="openCustomer(row)"><el-icon :size="15"><Edit /></el-icon></span></el-tooltip>
            <el-tooltip content="生成/重置客户密钥" placement="top"><span class="rc-op-icon" data-testid="conn-customer-reset-secret" aria-label="生成/重置客户密钥" @click="resetCustomerSecret(row)"><el-icon :size="15"><Key /></el-icon></span></el-tooltip>
            <el-tooltip content="删除" placement="top"><span class="rc-op-icon is-danger" data-testid="conn-customer-delete" aria-label="删除" @click="removeCustomer(row)"><el-icon :size="15"><Delete /></el-icon></span></el-tooltip>
          </div>
        </template></el-table-column>
      </el-table>
    </div>
    <div v-else-if="active === 'clients'" class="sync-table-wrap">
      <el-table v-loading="loading" :data="clients">
        <el-table-column prop="id" label="ID" width="80" /><el-table-column label="客户" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ customerLabel(row.customerId) }}</template></el-table-column>
        <el-table-column prop="clientName" label="应用名称" min-width="160" />
        <el-table-column v-for="item in [{ key: 'timingSync', label: '数据同步' }, { key: 'fileSync', label: '文件同步' }] as const" :key="item.key" :label="item.label" width="115">
          <template #default="{ row }"><el-switch :model-value="row[item.key] === 'on'" @change="(val: boolean) => changeSwitch(row, item.key, val)" /><span class="sync-state">{{ row[item.key] === 'on' ? '开启' : '关闭' }}</span></template>
        </el-table-column>
        <el-table-column prop="extendConfig" label="扩展参数" min-width="180" show-overflow-tooltip />
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
        <el-table-column label="客户" min-width="120" show-overflow-tooltip><template #default="{ row }">{{ customerLabel(row.customerId) }}</template></el-table-column>
        <el-table-column label="归属客户端" min-width="130" show-overflow-tooltip><template #default="{ row }">{{ clientLabel(row.appId) }}</template></el-table-column>
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
        <el-form-item label="密钥 (sk)">
          <el-input v-model="customerForm.secretKey" maxlength="100" data-testid="conn-customer-secret-input"
            :placeholder="customerForm.editing ? '留空则不修改当前密钥' : '留空由服务端生成'" />
          <p class="sync-tip">要现场指定就填完整值：需能 Base64 解出、且解码后是 16/24/32 字节（与同步客户端装载 <code>client.secret</code> 的校验同口径），否则保存会被拒。列表里显示的是掩码，不能原样填回来。</p>
        </el-form-item>
      </el-form>
      <p class="sync-tip">客户 ID 不是自增号，由现场按上游组织的 group_id 指定；同一 ID 若已被删除过则不可复用。</p>
      <template #footer><el-button @click="customerForm.visible = false">取消</el-button><el-button type="primary" :loading="customerForm.saving" @click="submitCustomer">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="clientForm.visible" :title="clientForm.editing ? '编辑客户端' : '新增客户端'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="所属客户">
          <el-select v-model="clientForm.customerId" filterable :disabled="clientForm.editing" placeholder="选择客户" style="width:100%">
            <el-option v-for="item in customerChoices(clientForm.customerId)" :key="item.id" :value="item.id" :label="item.customerName" :disabled="item.locked" />
          </el-select>
        </el-form-item>
        <el-form-item label="客户端名称"><el-input v-model="clientForm.clientName" maxlength="50" /></el-form-item>
        <el-form-item label="数据同步"><el-switch v-model="clientForm.timingSync" active-value="on" inactive-value="off" /></el-form-item>
        <el-form-item label="文件同步"><el-switch v-model="clientForm.fileSync" active-value="on" inactive-value="off" /></el-form-item>
        <el-form-item label="扩展参数"><el-input v-model="clientForm.extendConfig" type="textarea" :rows="2" maxlength="500" /></el-form-item>
      </el-form>
      <p class="sync-tip">开关只写 on/off；客户端把配置值转小写后与 off 比较，写 0/1 会读成常开，留空则取值时直接空指针。</p>
      <template #footer><el-button @click="clientForm.visible = false">取消</el-button><el-button type="primary" :loading="clientForm.saving" @click="submitClient">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="databaseForm.visible" :title="databaseForm.editing ? '编辑数据源' : '新增数据源'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="所属客户">
          <el-select v-model="databaseForm.customerId" filterable :disabled="databaseForm.editing" placeholder="选择客户" style="width:100%" @change="changeFormCustomer">
            <el-option v-for="item in customerChoices(databaseForm.customerId)" :key="item.id" :value="item.id" :label="item.customerName" :disabled="item.locked" />
          </el-select>
        </el-form-item>
        <el-form-item label="归属客户端">
          <el-select v-model="databaseForm.appId" filterable placeholder="选择客户端" style="width:100%">
            <el-option v-for="item in clientChoices(databaseForm.appId)" :key="item.id" :value="item.id" :label="item.clientName" :disabled="item.locked" />
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

    <el-dialog v-model="secret.visible" :title="secret.kind === 'client' ? '客户端签名密钥' : '客户密钥'" width="520px">
      <p class="sync-tip">密钥只在本次响应里明文出现一次，关掉就再也拿不到，丢失只能重新生成。请立即抄走或复制。</p>
      <el-form label-width="110px">
        <el-form-item :label="secret.kind === 'client' ? '客户端名称' : '客户名称'"><span>{{ secret.name }}</span></el-form-item>
        <el-form-item v-if="secret.kind === 'client'" label="client.id"><code class="sync-code">client.id={{ secret.id }}</code></el-form-item>
        <el-form-item v-else label="客户 ID"><code class="sync-code">{{ secret.id }}</code></el-form-item>
        <el-form-item :label="secret.kind === 'client' ? 'client.key' : '客户密钥'">
          <el-input :model-value="secret.secretKey" readonly type="textarea" :rows="2" data-testid="secret-value" />
          <el-button link type="primary" data-testid="secret-copy" @click="copySecret">复制密钥</el-button>
        </el-form-item>
      </el-form>
      <p v-if="secret.kind === 'client'" class="sync-tip">把上面两行写进客户端的 <code>application-*.properties</code>，新增客户端需启动、改过密钥的客户端需重启后才会生效。</p>
      <p v-else class="sync-tip">客户密钥当前没有校验方消费（签名只认客户端那份密钥），生成后先登记留存；重置它不影响在线客户端。</p>
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
/* 客户密钥单元格：默认显示服务端下发的掩码，展开明文后换成可读配色；图标沿用 rc-op-icon 的热区尺寸 */
.conn-secret { display: flex; align-items: center; gap: 4px; min-width: 0; }
.conn-secret-none { color: #94a3b8; font-size: 12px; }
.conn-secret-value { max-width: 110px; padding: 2px 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #f1f5f9; border-radius: 4px; color: #475569; font-family: ui-monospace, Consolas, monospace; font-size: 12px; letter-spacing: .2px; }
.conn-secret .rc-op-icon { flex: none; width: 20px; height: 20px; }
.conn-secret-value.is-plain { background: #ecfeff; color: #0f172a; }
.conn-secret-warn { flex: none; padding: 1px 5px; border: 1px solid #fde68a; border-radius: 3px; background: #fffbeb; color: #b45309; font-size: 11px; cursor: default; }
</style>
