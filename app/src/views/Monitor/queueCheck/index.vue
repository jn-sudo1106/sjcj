<script setup lang="ts">
// 队列告警 —— 1:1 迁移旧 data-view `src/page/config/QueueCheck.vue`（路由 /config/queue-check）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   搜索栏：队列名(query.queue) / ID(query.queueId) / 描述(query.name) / 状态(query.enable: ''|'0'|'1'|'-1')
//           + [查询] [重置]
//   操作条：增加告警（无禁用态）+ 竖分割线 + 「更多..」下拉（未勾选时置灰，勾选后可用）
//   批量：下拉菜单三项 启用(enable=0) / 禁用(enable=1) / 删除
//   表格：MQ_CHECK.base 9 列（队列名 / 状态 / 执行结果 / 描述 / 队列积压超过 / 消费者数低于 /
//         消费速率低于 / 消费速率高于 / 操作），行内操作 = 详情 + 编辑
//   分页：默认 20，可选 10/20/40/100/200，显示总条数 + 快速跳页
//   弹窗：base-edit-modal（新增 title「新增数据」预填 queueName+isDelete=0 / 编辑）、base-detail-drawer
//   接口：pagedQueueCheck / addQueueCheck / updateQueueCheck / deleteQueueCheck / changeQueueCheckEnable
//         （5 条全部走真实接口，见 api/queueCheck.ts）
//
// 有意偏差（都在交付说明里单列）：
//   1. 不迁死代码：`快速生成数据集`（模板 v-if 依赖 this.sourceId/this.entryTypeId，而这两个
//      **不是 props 也没定义**，且 handleGenDataset 方法根本不存在 → 旧版这个按钮永远不渲染）；
//      MeasureShow / MeasureAdd / Prompt（模板里只挂了 Prompt，从未 show 过）；
//      idSlot / msgSlot / lastDateSlot（MQ_CHECK 里没有对应列，antd 的 slot 只是摆设）；
//      showLogModal（$refs.logModal 不存在）；resetSearchForm / handleSearch / handleReset /
//      handleCloseCurrentTab / handleOpenTab（未接线）。
//   2. 首屏不再"自动选中第一行"：旧 loadData 里写的是 `selectedRowKeys = [oriData[0].datasetId]`，
//      而队列记录上没有 datasetId（那是数据集页的字段）→ 实际一个都没勾中，却让"更多"下拉出现、
//      点删除会发出空 ids。这里不做任何自动勾选，勾选完全由用户操作触发（与 sourceCheck 一致）。
//   3. 表头排序是**服务端**排序：旧列上的 `sorter: true` 经旧 s-table（components/Table/index.js:143-148）
//      转成 sortField / sortOrder 随 GET 发出去，值用 antd 原生的 'ascend' / 'descend'。
//      新版用 el-table 的 `sortable="custom"`——它只渲染表头箭头 + 抛 sort-change，**不排当前页**，
//      排序仍由后端做（'ascending'/'descending' 在 onSortChange 里映射回 ascend/descend），与旧版同源。
//      唯一差别：旧 s-table 的 refresh(false) 是 `loadData()` 不带 sorter，任何操作刷新后排序会被悄悄丢
//      （表头箭头还在、数据已经不排了）；这里把排序并进 load 的固定参数，刷新后保持排序，修掉这个不一致。
//   4. 批量操作 1:1 复刻旧版 a-dropdown「更多..」（hover 展开，菜单项 启用/禁用/删除
//      与图标 thunderbolt/disconnect/scissor 一一对应）。唯一差别：旧版 `v-if="selectedRowKeys.length > 0"`
//      是勾选后才出现，这里按用户要求常显、未勾选时置灰。确认框统一用平台 confirmDanger
//      （旧版删除走 $confirm，启用/禁用直连接口 + $notification 报错）。
//   5. 筛选框变化**不自动查询**（旧页面也是要点「查询」才发请求）；「重置」只清空条件，不回查（同旧版）。
//      细节差异：「重置」后状态框停在「全部」而不是旧版那种空 placeholder（旧版 `queryParam = {}`
//      会把 enable 变成 undefined），两者在接口上等价——都是不带 enable 条件。
//   6. 状态列色调按 stateFilter 的语义细分（E→出错红 / C→正常 / L→处理中 / 其它→灰），
//      旧版是「E 红、其余一律蓝」；文案仍走同一个 stateFilter，只是颜色更细。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type TableInstance } from 'element-plus'
import { Search, Plus, Refresh, Setting, ArrowDown, Lightning, SwitchButton, Scissor } from '@element-plus/icons-vue'
import type { MqCheck } from '@/api'
import {
  pagedQueueCheck,
  changeQueueCheckEnable,
  deleteQueueCheck,
} from '@/api/queueCheck'
import StatusTag from '@/components/StatusTag.vue'
import { confirmDanger } from '@/utils/confirmDanger'
import { MQ_CHECK_BASE, stateText } from './columns'
import QueueEditDialog from './QueueEditDialog.vue'
import QueueDetailDrawer from './QueueDetailDrawer.vue'

defineOptions({ name: 'QueueCheck' })

// ---- 查询条件（草稿 → 执行 两态：筛选项变化不自动查，点「查询」才发请求）----
const form = reactive({
  queue: '',    // 队列名
  queueId: '',  // ID
  name: '',     // 描述
  enable: '',   // '' 全部 / '0' 在用 / '1' 停用 / '-1' 历史删除的
})
/** 已「执行」的筛选条件。分页单独管——旧 pagedQueueCheck 只发筛选字段 + page/limit。 */
const filters = reactive({ queue: '', queueId: '', name: '', enable: '' })

/** 表头排序（服务端口径，与旧 s-table 一致：field = 列 dataIndex，order = 'ascend' | 'descend'）。
 *  空字符串表示「未排序」——两个键都不会出现在请求参数里（旧版无排序时正是如此）。 */
const sort = reactive({ field: '', order: '' })

// ---- 列表状态 ----
const rows = ref<MqCheck[]>([])
const total = ref(0)
const loading = ref(false)
/** 勾选集合用 queueId（旧 s-table 的 rowKey 就是 record.queueId） */
const selected = ref<string[]>([])
const page = ref(1)
const size = ref(20) // 旧 s-table 的 pagination.defaultPageSize

async function load() {
  loading.value = true
  try {
    const res = await pagedQueueCheck({
      queue: filters.queue,
      queueId: filters.queueId,
      name: filters.name,
      enable: filters.enable,
      page: page.value,
      limit: size.value,
      // 表头有排序时才带上这两个键（旧 s-table 无排序时参数里根本没有 sortField/sortOrder）
      ...(sort.field && sort.order ? { sortField: sort.field, sortOrder: sort.order } : {}),
    })
    rows.value = res.list
    total.value = res.total
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载队列告警列表失败')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  filters.queue = form.queue.trim()
  filters.queueId = form.queueId.trim()
  filters.name = form.name.trim()
  filters.enable = form.enable
  page.value = 1
  void load()
}

/** 旧「重置」按钮：`queryParam = {}` —— 只清条件，不发请求（下一次查询才生效） */
function resetQuery() {
  form.queue = ''
  form.queueId = ''
  form.name = ''
  form.enable = ''
}

// ---- 批量操作（旧版：勾选后点「更多..」下拉 → 启用 / 禁用 / 删除）----
const tableRef = ref<TableInstance>()

function onSelectionChange(selection: MqCheck[]) {
  selected.value = selection.map((row) => row.queueId)
}

/** 旧版每批操作后 `selectedRowKeys = []`（受控 rowSelection，表格勾选会同步清空）。
 *  el-table 的勾选由内部 store 管，光清数组会出现「按钮已禁用、复选框还勾着」，故一并 clearSelection。 */
function clearSelection() {
  selected.value = []
  tableRef.value?.clearSelection()
}

async function batchEnable(enable: boolean) {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  // ⚠️ 「清勾选 + 刷新」必须写在 run 里：confirmDanger 在用户取消时是**正常 return**（不抛错），
  // 写在 await 之后的话，点「取消」也会把勾选清掉并白刷一次列表。旧版这步写在 .then 里，
  // 取消 / 失败都不到这里，口径一致。
  await confirmDanger(
    enable ? '批量启用' : '批量禁用',
    `将${enable ? '启用' : '禁用'}选中的 ${ids.length} 条队列告警配置，确认执行？`,
    async () => {
      const res = (await changeQueueCheckEnable(ids, enable)) as { message?: string }
      clearSelection()
      void load()
      return res
    },
  )
}
async function batchDelete() {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  // 旧版确认文案：'是否确认要删除以下告警配置:' + size；同样只在确认且成功后才清勾选 + 刷新
  await confirmDanger(
    '提示',
    `是否确认要删除以下告警配置：${ids.length}`,
    async () => {
      const res = (await deleteQueueCheck(ids)) as { message?: string }
      clearSelection()
      void load()
      return res
    },
  )
}

/** 「更多..」下拉派发：command 与菜单项一一对应（旧 batchChangeEnable(0)/batchChangeEnable(1)/batchDelete） */
function onBatchCommand(command: string) {
  if (command === 'enable') void batchEnable(true)
  else if (command === 'disable') void batchEnable(false)
  else if (command === 'delete') void batchDelete()
}

// ---- 表头排序（服务端）----
/** el-table 的 sortable="custom" 只出箭头 + 抛这个事件，真正的排序由后端做。
 *  order 的映射：'ascending' → antd 的 'ascend'、'descending' → 'descend'（旧 s-table 原样透传这两个值）。
 *  第三下点击取消排序时 order 为 null → 两个参数都不发，回到后端默认顺序。
 *  排序变化**不重置页码**（旧 s-table 把当前 pagination 一起回传，页码保持不动）。 */
function onSortChange(payload: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  sort.field = payload.order && payload.prop ? payload.prop : ''
  sort.order = payload.order === 'ascending' ? 'ascend' : payload.order === 'descending' ? 'descend' : ''
  void load()
}

// ---- 分页（旧 s-table：共N条 + 快速跳页）----
function onPageChange(p: number) {
  page.value = p
  void load()
}
function onSizeChange(s: number) {
  size.value = s
  page.value = 1
  void load()
}

// ---- 子组件 ----
const editDialogRef = ref<InstanceType<typeof QueueEditDialog>>()
const detailVisible = ref(false)
const detailRecord = ref<MqCheck | null>(null)

/** 旧 handleAdd：把查询框里的队列名带进新增弹窗，并预置 isDelete=0。
 *  查询框没填时传 undefined（旧版 queryParam.queue 初值就是 undefined，JSON.stringify 会把这个键丢掉）。 */
function openAdd() {
  editDialogRef.value?.openDialog(null, { queueName: form.queue || undefined, isDelete: 0 })
}
function onSaved() {
  void load()
}
function openEdit(row: MqCheck) {
  editDialogRef.value?.openDialog(row)
}
function openDetail(row: MqCheck) {
  detailRecord.value = row
  detailVisible.value = true
}

/** 状态列色调：旧版只有「E 红 / 其余蓝」，这里按 stateFilter 的语义细分（E 出错 / C 正常 / L 处理中） */
function stateTone(state: string): 'err' | 'ok' | 'run' | 'muted' {
  if (state === 'E') return 'err'
  if (state === 'C') return 'ok'
  if (state === 'L') return 'run'
  return 'muted'
}

onMounted(() => void load())
</script>

<template>
  <div class="qc-shell" v-loading="loading">
    <div class="qc-head">
      <div class="qc-title">队列告警</div>
      <div class="qc-sub">按队列名、ID、描述与状态筛选队列校验配置，支持批量启停与删除。</div>
    </div>

    <!-- 筛选表单（对齐旧 a-form layout="inline" + a-row 栅格；改条件不自动查，点「查询」才发请求） -->
    <el-form :inline="true" class="qc-filter-form" size="small">
      <el-row :gutter="8" class="qc-filter-row">
        <el-col :md="4" :sm="24">
          <el-form-item label="队列名">
            <el-input v-model="form.queue" placeholder="队列名" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="ID">
            <el-input v-model="form.queueId" placeholder="ID" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="描述">
            <el-input v-model="form.name" placeholder="描述" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="状态">
            <el-select v-model="form.enable" placeholder="请选择">
              <el-option label="全部" value="" />
              <el-option label="在用" value="0" />
              <el-option label="停用" value="1" />
              <el-option label="历史删除的" value="-1" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
            <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <!-- 操作条：旧版 .operation —— 增加告警 + 竖分割线 + 「更多..」下拉（hover 展开，未勾选时置灰） -->
    <div class="qc-op-bar">
      <el-button type="danger" :icon="Plus" @click="openAdd">增加告警</el-button>
      <el-divider direction="vertical" class="qc-op-divider-v" />
      <!-- 批量操作下拉：菜单项与图标 1:1 对齐旧 a-dropdown（thunderbolt / disconnect / scissor）。
           旧版是「勾选后才出现」，这里按用户要求常显、未勾选时置灰，避免按钮忽隐忽现 -->
      <el-dropdown class="qc-more" :disabled="!selected.length" @command="onBatchCommand">
        <el-button :icon="Setting" :disabled="!selected.length">
          更多..
          <el-icon class="qc-more-arrow"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="enable" :icon="Lightning">启用</el-dropdown-item>
            <el-dropdown-item command="disable" :icon="SwitchButton">禁用</el-dropdown-item>
            <el-dropdown-item command="delete" :icon="Scissor">删除</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 表格：列定义来自 allColumns.MQ_CHECK.base（标题/对齐/顺序 1:1）。
         列宽自适应：文本列走 min-width（吃满剩余空间），数值/状态/操作列走固定 width。
         开关：有 minWidth 的列不传 width，交给 el-table 分配。
         表头排序：col.sorter 的列挂 sortable="custom"（= 旧 sorter: true），箭头由 el-table 画，
         排序交给后端（@sort-change → sortField/sortOrder），所以不传 default-sort。 -->
    <el-table
      ref="tableRef"
      :data="rows"
      border
      size="small"
      :row-key="(r: MqCheck) => r.queueId"
      @selection-change="onSelectionChange"
      @sort-change="onSortChange"
    >
      <el-table-column type="selection" width="40" />
      <el-table-column
        v-for="col in MQ_CHECK_BASE"
        :key="col.dataIndex"
        :label="col.title"
        :prop="col.dataIndex"
        :width="col.minWidth ? undefined : col.width"
        :min-width="col.minWidth"
        :align="col.align ?? 'left'"
        :sortable="col.sorter ? 'custom' : false"
        :show-overflow-tooltip="col.dataIndex === 'queueDesc' || col.dataIndex === 'lastMsg'"
      >
        <template #default="{ row }">
          <!-- 队列名：旧 nameSlot —— 在用=可点链接；停用=红标签带 [禁用]-；历史删除=?+标签；都点开详情 -->
          <span v-if="col.dataIndex === 'queueName'" class="qc-name">
            <el-tooltip :content="String(row.queueName ?? '')" placement="top-start">
              <div class="qc-name-inner">
                <a v-if="row.isDelete === 0" class="qc-link" @click="openDetail(row)">{{ row.queueName }}</a>
                <el-tag v-else-if="row.isDelete === 1" type="danger" size="small" class="qc-tag" @click="openDetail(row)">
                  [禁用]-{{ row.queueName }}
                </el-tag>
                <span v-else class="qc-history">
                  <span class="qc-warn">!</span>
                  <el-tag size="small" class="qc-tag" @click="openDetail(row)">{{ row.queueName }}</el-tag>
                </span>
              </div>
            </el-tooltip>
          </span>

          <!-- 状态：旧 stateSlot —— 出错(E) 红 / 其余蓝 -->
          <StatusTag
            v-else-if="col.dataIndex === 'state'"
            :text="stateText(row.state)"
            :tone="stateTone(row.state)"
          />

          <!-- 操作：旧 actionSlot —— 详情 | 编辑 -->
          <span v-else-if="col.dataIndex === 'action'" class="qc-actions">
            <span class="qc-op-link" @click="openDetail(row)">详情</span>
            <span class="qc-op-divider">|</span>
            <span class="qc-op-link" @click="openEdit(row)">编辑</span>
          </span>

          <!-- 其余列（含执行结果 lastMsg）：直接显示字段值；长文本的「单行省略 + 悬停看全文」
               统一交给列上的 show-overflow-tooltip，不再自定义 .qc-msg（否则会和 el-table 的
               溢出处理叠加，且 hover 看不到被截掉的全文） -->
          <span v-else>{{ row[col.dataIndex as keyof MqCheck] }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页：默认 20，可选 10/20/40/100/200，共N条 + 快速跳页（旧 s-table pagination 口径） -->
    <div class="qc-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <QueueEditDialog ref="editDialogRef" @saved="onSaved" />
    <QueueDetailDrawer v-model="detailVisible" :record="detailRecord" />
  </div>
</template>

<style scoped>
.qc-shell {
  display: flex;
  flex-direction: column;
  height: fit-content;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
  overflow: hidden;
}
.qc-head {
  margin-bottom: 2px;
}
.qc-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--rc-text, #0f172a);
}
.qc-sub {
  margin-top: 4px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
/* 筛选表单：对齐旧 a-form layout="inline" 的栅格宽度比例 */
.qc-filter-form {
  margin-bottom: 0;
}
.qc-filter-row {
  width: 100%;
}
.qc-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.qc-filter-form :deep(.el-select),
.qc-filter-form :deep(.el-input) {
  width: 100%;
}
.qc-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
/* 按钮组不撑满 col */
.qc-filter-form .el-col:last-child :deep(.el-form-item) {
  width: auto;
}
.qc-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 旧 .operation：按钮之间 margin-left:8px；竖分割线与之等高 */
.qc-op-divider-v {
  height: 1.2em;
  margin: 0;
}
.qc-more-arrow {
  margin-left: 4px;
  vertical-align: -0.15em;
}
/* 队列名：旧版是 div max-width:200px + 省略 + popover 全文；列宽自适应后内容区跟着列宽走，
   旧列宽只有 150 所以 200px 上限本来就撑不满，现在列会更宽，故改为 100% 免得右侧留白 */
.qc-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
}
.qc-name-inner {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-all;
}
.qc-link,
.qc-op-link {
  color: var(--rc-primary, #2563eb);
  cursor: pointer;
  font-size: 12px;
}
.qc-link:hover,
.qc-op-link:hover {
  text-decoration: underline;
}
.qc-tag {
  cursor: pointer;
}
.qc-history {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.qc-warn {
  color: var(--rc-error, #dc2626);
  font-weight: 700;
}
.qc-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.qc-op-divider {
  color: var(--rc-faint, #94a3b8);
}
.qc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
