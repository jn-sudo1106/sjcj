<script setup lang="ts">
// 数据同步「SQL 执行 / 建表 SQL」两页（1008-10，按原型 1:1 还原，2026-10-09 版）。
// 两页共用一个面板：差异在列、新增弹窗字段（建表多「关联同步任务 ID」）与接口。
//
// 接口（《SQL 执行与建表任务 管理接口文档》第二版）：
//   SQL 执行：POST /sql-execute/page、/sql-execute/add
//   建表 SQL：POST /table-definition/page、/table-definition/add
//
// 原型已定口径：
//   - 按客户筛选后端已加；客户下拉沿用同步任务/日志页做法（admin 可切换，普通账号固定自己的客户）
//   - 权限暂不处理：新增不限角色，靠二次确认兜底
//   - 状态不反映成败（status 全是 3，报错在 result）→「执行结果」列按 result 区分成功/失败
//   - 数据源编码候选项来自「环境配置 → 数据源配置」该客户端（appId）的数据源，可手动输入
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { View } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { syncApi, type SyncClient, type SyncCustomer, type SyncSqlStatus, type SyncSqlTask, type SyncTableTask } from '@/api/dataSync'
import { copyToClipboard } from '@/utils/clipboard'

const props = defineProps<{ page: 'sql' | 'table' }>()
const isTable = computed(() => props.page === 'table')

// ---- 客户 / 客户端（沿用同步任务页做法：admin 可切换，普通账号固定自己的客户）----
const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
const customers = ref<SyncCustomer[]>([])
const clients = ref<SyncClient[]>([])
const customerNames = ref(new Map<string, string>())
const filter = reactive({ customerId: admin.value ? '' : String(auth.info?.id ?? ''), clientId: '', sourceCode: '', taskId: '', status: '' })

// 状态收敛为两种（10-12 实测后端 sql-execute/table-definition 全量数据只有 status=3「执行完成」，
// status=0「待执行」为新增后未执行时定义；1 可执行 / 2 执行中 / 5 执行异常当前无数据，不展示）。
// 兜底：万一后端仍有存量其它状态，标签按「执行完成」处理不显示错字。
const STATUS_OPTIONS: { value: string; label: string; cls: string }[] = [
  { value: '0', label: '待执行', cls: 's0' },
  { value: '3', label: '执行完成', cls: 's3' },
]
const statusLabel = (s?: SyncSqlStatus) => STATUS_OPTIONS.find((o) => o.value === String(s))?.label ?? '执行完成'
const statusCls = (s?: SyncSqlStatus) => STATUS_OPTIONS.find((o) => o.value === String(s))?.cls ?? 's3'

async function loadClients() {
  // 表格客户端列需要显示全部客户端名（原型 CLIENTS 是全量），筛选才按客户联动。
  // admin 无 customerId 时全量拉（pageSize 100 足够展示）；非 admin 固定自己的客户。
  try {
    const res = await syncApi.clients(filter.customerId
      ? { customerId: filter.customerId, pageNo: 1, pageSize: 100 }
      : { pageNo: 1, pageSize: 100 })
    clients.value = res?.list ?? []
  } catch { clients.value = [] }
}
async function loadCustomers() {
  try {
    customers.value = await syncApi.customers() ?? []
    customerNames.value = new Map(customers.value.map((c) => [String(c.id), c.customerName]))
  } catch { customers.value = []; customerNames.value = new Map() }
}
watch(() => filter.customerId, () => { filter.clientId = ''; void loadClients(); pageNo.value = 1; void load() })

// ---- 列表 ----
const rows = ref<(SyncSqlTask | SyncTableTask)[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const base = {
      pageNo: pageNo.value,
      pageSize: pageSize.value,
      customerId: filter.customerId || undefined,
      clientId: filter.clientId || undefined,
      sourceCode: filter.sourceCode.trim() || undefined,
      status: filter.status === '' ? undefined : Number(filter.status) as SyncSqlStatus,
    }
    if (isTable.value) {
      const res = await syncApi.tablePage({ ...base, taskId: filter.taskId.trim() || undefined })
      rows.value = res?.list ?? []
      total.value = res?.total ?? 0
    } else {
      const res = await syncApi.sqlPage(base)
      rows.value = res?.list ?? []
      total.value = res?.total ?? 0
    }
  } catch (e) {
    rows.value = []
    total.value = 0
    error.value = `加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}
function reset() {
  const customerId = admin.value ? '' : String(auth.info?.id ?? '')
  const customerChanged = customerId !== filter.customerId
  Object.assign(filter, { customerId, clientId: '', sourceCode: '', taskId: '', status: '' })
  pageNo.value = 1
  // 客户变了由 filter.customerId 的 watch 重拉客户端和列表，这里不再重复请求
  if (!customerChanged) void load()
}
function onPageSizeChange() { pageNo.value = 1; void load() }
function onPageChange(p: number) { pageNo.value = p; void load() }

// 客户端单元格（原型 1:1：名称 + 客户名·#ID；配置里没有 → #ID + 提示）
const clientName = (id: unknown) => clients.value.find((c) => String(c.id) === String(id))?.clientName
function clientCustomerName(id: unknown) {
  const c = clients.value.find((x) => String(x.id) === String(id))
  if (!c) return ''
  return customerNames.value.get(String(c.customerId)) || `客户 #${c.customerId}`
}

// 执行结果（原型 resultOf 1:1）
function resultOf(r: string | null | undefined) {
  if (r == null || r === '') return { cls: 'res-none', text: '—', full: '' }
  if (r === 'success') return { cls: 'res-ok', text: '成功', full: r }
  if (/exception|error|ORA-|bad SQL/i.test(r)) return { cls: 'res-err', text: '失败：' + r.replace(/^StatementCallback;\s*/, ''), full: r }
  return { cls: 'res-none', text: r, full: r }
}
// SQL 内容单行省略（原型 firstLine：多行合并为一行）
const firstLine = (s?: string) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean).join(' ')

// ---- 详情抽屉（右侧 el-drawer，实体详情长期约定）----
const detail = ref<(SyncSqlTask | SyncTableTask) | null>(null)
function openDetail(row: SyncSqlTask | SyncTableTask) { detail.value = row }
const detailTitle = computed(() => {
  if (!detail.value) return ''
  return `${isTable.value ? '建表任务' : 'SQL 执行任务'} #${detail.value.id}`
})
const detailClient = computed(() => {
  const id = detail.value?.clientId
  if (id == null) return '—'
  const name = clientName(id)
  return name ? `${name}（${clientCustomerName(id)} · #${id}）` : `#${id}`
})
function copySql() {
  // 复制统一走 utils/clipboard（2026-09-22 约定：组件不直接调 navigator.clipboard）
  void copyToClipboard(detail.value?.content ?? '', 'SQL')
}

// ---- 新增弹窗（居中 dialog：选择/新增操作型内容，符合详情弹层约定）----
const addOpen = ref(false)
const addForm = reactive({ clientId: '', sourceCode: '', taskId: '', content: '' })
const sourceOptions = ref<string[]>([])
const saving = ref(false)

// 数据源候选项：拉该客户端所属客户的全部数据源，按 appId（客户端）过滤；没有配置 → 显示「（该客户端没有配置数据源）」
// 客户取客户端自己的 customerId：admin 选「全部客户」时筛选栏没有客户，也要有候选
async function loadSourceOptions(clientId: string) {
  sourceOptions.value = []
  const customerId = clients.value.find((c) => String(c.id) === clientId)?.customerId ?? filter.customerId
  if (!clientId || !customerId) return
  try {
    const res = await syncApi.databases({ pageNo: 1, pageSize: 100, customerId })
    sourceOptions.value = [...new Set((res?.list ?? []).filter((d) => String(d.appId) === String(clientId)).map((d) => d.sourceCode).filter(Boolean))] as string[]
  } catch { sourceOptions.value = [] }
}
function openAdd() {
  Object.assign(addForm, { clientId: '', sourceCode: '', taskId: '', content: '' })
  sourceOptions.value = []
  addOpen.value = true
}
watch(() => addForm.clientId, (id) => {
  addForm.sourceCode = ''
  void loadSourceOptions(id)
})
function submitAdd() {
  if (!addForm.clientId) { ElMessage.warning('请选择客户端'); return }
  if (!addForm.sourceCode) { ElMessage.warning('请选择或输入数据源编码'); return }
  if (!addForm.content.trim()) { ElMessage.warning(isTable.value ? '请填写建表 / DDL SQL' : '请填写待执行 SQL'); return }
  confirmOpen.value = true
}
const confirmOpen = ref(false)
async function doConfirmAdd() {
  if (saving.value) return
  saving.value = true
  try {
    const input = { clientId: Number(addForm.clientId), sourceCode: addForm.sourceCode.trim(), content: addForm.content.trim() }
    const res = isTable.value
      ? await syncApi.tableAdd({ ...input, taskId: addForm.taskId.trim() ? Number(addForm.taskId) : undefined })
      : await syncApi.sqlAdd(input)
    ElMessage.success(`已下发，任务 #${res.data}`)
    confirmOpen.value = false
    addOpen.value = false
    pageNo.value = 1
    void load()
  } catch (e) {
    ElMessage.error(`下发失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}
const confirmClientText = computed(() => {
  const id = addForm.clientId
  if (!id) return '（未选择）'
  const name = clientName(id)
  return name ? `${name} · #${id}` : `#${id}`
})

// 挂载 / 切页
watch(() => props.page, () => { pageNo.value = 1; void load() }, { immediate: true })
void loadCustomers()
void loadClients()
</script>

<template>
  <div class="stt">
    <div class="stt-toolbar">
      <el-select v-if="admin" v-model="filter.customerId" clearable placeholder="全部客户" class="stt-ctl stt-w-cust" data-testid="stt-customer">
        <el-option v-for="item in customers" :key="item.id" :value="String(item.id)" :label="`${item.customerName} · #${item.id}`" />
      </el-select>
      <el-select v-model="filter.clientId" clearable placeholder="全部客户端" class="stt-ctl stt-w-client" data-testid="stt-client" @clear="pageNo = 1; load()">
        <el-option v-for="item in clients" :key="item.id" :value="String(item.id)" :label="`${item.clientName} · #${item.id}`" />
      </el-select>
      <!-- type=search 让 Chromium 内核在框内给出清除叉；这页沿用原型里的原生控件，不换 el-input -->
      <input v-model="filter.sourceCode" type="search" class="stt-input stt-w-code" placeholder="数据源编码（模糊）" data-testid="stt-source" @keyup.enter="pageNo = 1; load()" @search="pageNo = 1; load()" />
      <input v-if="isTable" v-model="filter.taskId" type="search" class="stt-input stt-w-task" placeholder="任务 ID" data-testid="stt-taskid" @keyup.enter="pageNo = 1; load()" @search="pageNo = 1; load()" />
      <el-select v-model="filter.status" clearable placeholder="全部状态" class="stt-ctl stt-w-status" data-testid="stt-status" @clear="pageNo = 1; load()">
        <el-option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value" :label="o.label" />
      </el-select>
      <button class="stt-btn primary" type="button" data-testid="stt-query" @click="pageNo = 1; load()">查询</button>
      <button class="stt-btn" type="button" data-testid="stt-reset" @click="reset">重置</button>
      <span class="stt-grow"></span>
      <button class="stt-icon-btn" type="button" title="刷新" aria-label="刷新" data-testid="stt-refresh" @click="load">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
      </button>
      <button class="stt-btn primary" type="button" data-testid="stt-add" @click="openAdd">{{ isTable ? '+ 新增建表任务' : '+ 新增 SQL 任务' }}</button>
    </div>

    <div class="stt-table-wrap" v-loading="loading">
      <table class="stt-table">
        <thead>
          <tr>
            <th style="width: 56px">ID</th>
            <th style="width: 160px">客户端</th>
            <th v-if="isTable" style="width: 72px">任务 ID</th>
            <th style="width: 150px">数据源编码</th>
            <th>{{ isTable ? '建表 SQL' : 'SQL 内容' }}</th>
            <th style="width: 84px">状态</th>
            <th :style="isTable ? 'width: 150px' : 'width: 110px'">执行结果</th>
            <th v-if="!isTable" style="width: 120px">备注</th>
            <th :style="!isTable ? 'width: 100px' : 'width: 100px'">{{ isTable ? '更新时间' : '创建时间' }}</th>
            <th style="width: 56px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="String(r.id)">
            <td>{{ r.id }}</td>
            <td>
              <template v-if="clientName(r.clientId)">
                <div class="stt-ellipsis">{{ clientName(r.clientId) }}</div>
                <div class="stt-sub stt-ellipsis">{{ clientCustomerName(r.clientId) }} · #{{ r.clientId }}</div>
              </template>
              <template v-else>
                <div>#{{ r.clientId }}</div>
                <div class="stt-sub">客户端配置里没有</div>
              </template>
            </td>
            <td v-if="isTable"><button class="stt-link" type="button">{{ (r as SyncTableTask).taskId ?? '—' }}</button></td>
            <td><span class="stt-sql">{{ r.sourceCode }}</span></td>
            <td><div class="stt-sql stt-ellipsis" :title="firstLine(r.content)">{{ firstLine(r.content) }}</div></td>
            <td><span class="stt-tag" :class="statusCls(r.status)">{{ statusLabel(r.status) }}</span></td>
            <td>
              <div class="stt-ellipsis" :class="resultOf(r.result).cls" :title="resultOf(r.result).full">{{ resultOf(r.result).text }}</div>
            </td>
            <td v-if="!isTable"><div class="stt-ellipsis">{{ r.remark || '—' }}</div></td>
            <td>{{ (isTable ? r.updateTime : r.createTime) || '—' }}</td>
            <td>
              <el-tooltip content="详情" placement="top"><span class="rc-op-icon" data-testid="stt-detail" aria-label="详情" @click="openDetail(r)"><el-icon :size="15"><View /></el-icon></span></el-tooltip>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td colspan="9" class="stt-empty">{{ error || '没有数据' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="stt-pager">
      <span>共 {{ total }} 条</span>
      <select class="stt-page-size" :value="pageSize" data-testid="stt-page-size" @change="pageSize = Number(($event.target as HTMLSelectElement).value); onPageSizeChange()">
        <option :value="20">20 条/页</option>
        <option :value="50">50 条/页</option>
      </select>
      <el-pagination
        v-model:current-page="pageNo"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        size="small"
        background
        @current-change="onPageChange"
      />
    </div>

    <!-- 详情抽屉（原型 1:1：字段描述 + SQL 内容 + 复制 + 执行结果） -->
    <el-drawer :model-value="!!detail" :title="detailTitle" size="640px" append-to-body @close="detail = null">
      <div v-if="detail" class="stt-desc">
        <div class="stt-desc-k">客户端</div>
        <div>{{ detailClient }}</div>
        <template v-if="isTable">
          <div class="stt-desc-k">同步任务 ID</div>
          <div>{{ (detail as SyncTableTask).taskId ?? '—' }}</div>
        </template>
        <div class="stt-desc-k">数据源编码</div>
        <div><span class="stt-sql">{{ detail.sourceCode }}</span></div>
        <div class="stt-desc-k">状态</div>
        <div><span class="stt-tag" :class="statusCls(detail.status)">{{ statusLabel(detail.status) }}</span></div>
        <template v-if="!isTable">
          <div class="stt-desc-k">备注</div>
          <div>{{ detail.remark || '—' }}</div>
        </template>
        <div class="stt-desc-k">创建时间</div>
        <div>{{ detail.createTime || '—' }}</div>
        <div class="stt-desc-k">更新时间</div>
        <div>{{ detail.updateTime || '—' }}</div>
      </div>
      <template v-if="detail">
        <div class="stt-block-title">{{ isTable ? '建表 SQL' : 'SQL 内容' }}<button class="stt-link" type="button" data-testid="stt-copy" @click="copySql">复制</button></div>
        <pre class="stt-code">{{ detail.content }}</pre>
        <div class="stt-block-title">执行结果</div>
        <pre class="stt-code" :class="resultOf(detail.result).cls === 'res-ok' ? 'ok' : resultOf(detail.result).cls === 'res-err' ? 'err' : ''">{{ detail.result ?? '客户端还没有回写结果' }}</pre>
      </template>
    </el-drawer>

    <!-- 新增弹窗（原型 1:1：提示语 + 客户端 + 数据源编码 + 任务ID(建表) + SQL 文本域） -->
    <el-dialog :model-value="addOpen" :title="isTable ? '新增建表任务' : '新增 SQL 执行任务'" width="620px" append-to-body @close="addOpen = false">
      <div class="stt-alert warn">提交后服务端会推送给客户端，在所选数据源上<b>直接执行</b>，不能撤回。客户端不在线时，等它上线后再执行。</div>
      <div class="stt-field"><label><span class="stt-req">*</span>客户端</label>
        <el-select v-model="addForm.clientId" placeholder="选择客户端" class="stt-ctl-full" data-testid="stt-add-client">
          <el-option v-for="item in clients" :key="item.id" :value="String(item.id)" :label="`${item.clientName} · #${item.id}`" />
        </el-select>
      </div>
      <div class="stt-field"><label><span class="stt-req">*</span>数据源编码</label>
        <el-select v-model="addForm.sourceCode" filterable allow-create default-first-option placeholder="先选客户端" class="stt-ctl-full" data-testid="stt-add-source">
          <el-option v-if="!sourceOptions.length && addForm.clientId" value="__none__" label="（该客户端没有配置数据源）" disabled />
          <el-option v-for="code in sourceOptions" :key="code" :value="code" :label="code" />
        </el-select>
        <div class="stt-hint">候选项来自「环境配置 → 数据源配置」中该客户端的数据源；不在列表里可以手动输入。</div>
      </div>
      <div v-if="isTable" class="stt-field"><label>关联同步任务 ID</label>
        <input v-model="addForm.taskId" class="stt-input" placeholder="可不填；独立建表时留空" data-testid="stt-add-taskid" />
        <div class="stt-hint">填了以后，可以在建表 SQL 列表里按任务 ID 查到这条记录。</div>
      </div>
      <div class="stt-field"><label><span class="stt-req">*</span>{{ isTable ? '建表 / DDL SQL' : '待执行 SQL' }}</label>
        <textarea v-model="addForm.content" class="stt-textarea" :placeholder="isTable ? 'create table t_order (id bigint primary key, status tinyint);' : 'update t_order set status = 1 where id = 10;'" spellcheck="false" data-testid="stt-add-sql"></textarea>
      </div>
      <template #footer>
        <el-button @click="addOpen = false">取消</el-button>
        <el-button type="primary" data-testid="stt-add-submit" @click="submitAdd">提交</el-button>
      </template>
    </el-dialog>

    <!-- 二次确认（原型 1:1：小弹窗，显示客户端 / 数据源 / SQL，确认下发） -->
    <el-dialog :model-value="confirmOpen" title="确认下发执行" width="460px" append-to-body @close="confirmOpen = false">
      <div class="stt-confirm-note">将在以下数据源上直接执行，执行后不能撤回：</div>
      <div class="stt-confirm-row">
        <span class="stt-confirm-k">客户端</span><span>{{ confirmClientText }}</span>
        <span class="stt-confirm-k">数据源</span><span class="stt-sql">{{ addForm.sourceCode || '（未选择）' }}</span>
        <span class="stt-confirm-k">SQL</span><span class="stt-sql stt-ellipsis">{{ firstLine(addForm.content) || '（未填写）' }}</span>
      </div>
      <template #footer>
        <el-button @click="confirmOpen = false">返回修改</el-button>
        <el-button type="danger" :loading="saving" data-testid="stt-confirm-submit" @click="doConfirmAdd">确认下发</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.stt-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.stt-grow { flex: 1; }
.stt-ctl { height: 32px; }
.stt-w-cust { width: 150px; }
.stt-w-client { width: 200px; }
.stt-w-code { width: 170px; }
.stt-w-task { width: 110px; }
.stt-w-status { width: 120px; }
.stt-input { height: 32px; border: 1px solid #dcdfe6; border-radius: 6px; padding: 0 10px; background: #fff; font: inherit; color: inherit; box-sizing: border-box; }
.stt-btn { height: 32px; padding: 0 14px; border: 1px solid #dcdfe6; border-radius: 6px; background: #fff; cursor: pointer; white-space: nowrap; color: var(--rc-text, #0f172a); font-size: 13px; }
.stt-btn:hover { border-color: #2563eb; color: #2563eb; }
.stt-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.stt-btn.primary:hover { background: #1d4ed8; color: #fff; }
.stt-icon-btn { width: 32px; height: 32px; padding: 0; display: inline-grid; place-items: center; border: 1px solid #dcdfe6; border-radius: 6px; background: #fff; cursor: pointer; color: var(--rc-text, #0f172a); }
.stt-icon-btn:hover { color: #2563eb; border-color: #2563eb; }
.stt-link { border: 0; background: none; color: #2563eb; cursor: pointer; padding: 0; font-size: 13px; }
.stt-link:hover { text-decoration: underline; }
.stt-table-wrap { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.stt-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
.stt-table th { background: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 9px 10px; border-bottom: 1px solid #eef2f7; white-space: nowrap; }
.stt-table td { padding: 9px 10px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
.stt-table tr:last-child td { border-bottom: 0; }
.stt-table tbody tr:hover { background: #f8fbff; }
.stt-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stt-sql { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: #334155; }
.stt-sub { color: #94a3b8; font-size: 12px; }
.stt-tag { display: inline-block; padding: 0 7px; line-height: 20px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
.stt-tag.s0 { background: #fffbeb; color: #d97706; }
.stt-tag.s1 { background: #eff6ff; color: #2563eb; }
.stt-tag.s2 { background: #eff6ff; color: #2563eb; }
.stt-tag.s3 { background: #f1f5f9; color: #475569; }
.stt-tag.s5 { background: #fef2f2; color: #dc2626; }
.res-ok { color: #16a34a; }
.res-err { color: #dc2626; }
.res-none { color: #94a3b8; }
.stt-empty { padding: 36px; text-align: center; color: #94a3b8; }
.stt-pager { display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 12px; color: #475569; }
.stt-page-size { height: 28px; border: 1px solid #dcdfe6; border-radius: 6px; background: #fff; }
.stt-desc { display: grid; grid-template-columns: 96px 1fr; border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
.stt-desc > div { padding: 8px 10px; border-bottom: 1px solid #eef2f7; font-size: 13px; }
.stt-desc > div:nth-last-child(-n+2) { border-bottom: 0; }
.stt-desc-k { background: #f8fafc; color: #475569; }
.stt-block-title { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 6px; font-weight: 600; font-size: 13px; }
.stt-code { margin: 0 0 14px; padding: 12px; background: #0f172a; color: #e2e8f0; border-radius: 8px; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
.stt-code.err { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.stt-code.ok { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.stt-alert { padding: 9px 12px; border-radius: 8px; margin-bottom: 14px; font-size: 13px; }
.stt-alert.warn { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.stt-field { margin-bottom: 14px; }
.stt-field label { display: block; margin-bottom: 6px; color: #475569; font-size: 13px; }
.stt-field label .stt-req { color: #dc2626; margin-right: 2px; }
.stt-ctl-full { width: 100%; }
.stt-textarea { width: 100%; height: 180px; padding: 8px 10px; border: 1px solid #dcdfe6; border-radius: 6px; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; box-sizing: border-box; }
.stt-hint { margin-top: 4px; color: #94a3b8; font-size: 12px; }
.stt-confirm-note { font-size: 13px; }
.stt-confirm-row { display: grid; grid-template-columns: 76px 1fr; gap: 4px 8px; margin-top: 10px; font-size: 13px; }
.stt-confirm-row .stt-confirm-k { color: #94a3b8; }
</style>
