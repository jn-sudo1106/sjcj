<script setup lang="ts">
// 队列告警配置弹窗 —— 迁移旧 data-view `src/page/inst/MqList.vue` 里点「告警 / 告警规则」打开的
// `<queue-check-show>` → `@/page/config/QueueCheck`（整页被塞进一个 a-modal 里）。
//
// ⚠️ 为什么不直接复用新项目的 `views/Monitor/queueCheck`：那是队列告警模块的页面组件，跨模块 import
//    会把「辅助工具的 MQ 页」和「监控中心的队列告警」焊在一起（改一边炸两边）。按迁移约定，
//    mqList 需要什么就自己带一份，所以这里是**本目录内的**实现，只复用 api 层（@/api/queueCheck）。
//
// 旧版在弹窗里的行为（挨条对齐）：
//   · 打开时把当前队列名塞进查询条件（QueueCheck 的 `queue` prop → queryParam.queue）
//   · 查询条件：队列名 / ID / 描述 / 状态（全部 / 在用 / 停用 / 历史删除的）+ [查询] [重置]
//   · 操作条：增加告警（`queueName` 预填当前队列名、`isDelete=0`）+ 勾选后批量启用 / 禁用 / 删除
//   · 列表：MQ_CHECK.base 9 列 + 行内「编辑」；分页默认 20
//
// 有意偏差：
//   1. 旧版「更多..」是个 hover 下拉（启用/禁用/删除三合一）。弹窗里空间够，改成三个平铺按钮，
//      command 语义完全一致，少一次展开。未勾选时置灰。
//   2. 旧版打开时会把第一行自动塞进 selectedRowKeys（`oriData[0].datasetId`）——而队列告警记录上
//      根本没有 datasetId，实际一条都没勾中，却让删除按钮"看起来能用"、点下去发空 ids。
//      这里不做任何自动勾选（与 Monitor/queueCheck 的处理口径一致）。
//   3. 状态列色彩按语义细分（E 红 / C 绿 / L 橙 / 其它灰），旧版是「E 红、其余蓝」。
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import type { MqCheck } from '@/api'
import { changeQueueCheckEnable, deleteQueueCheck, pagedQueueCheck } from '@/api/queueCheck'
import QueueCheckEditDialog from './QueueCheckEditDialog.vue'

defineOptions({ name: 'MqQueueCheckDialog' })

/** 状态下拉哨兵：el-select 把空串当「没选」，选「全部」时框里会看不到字（同 Monitor/queueCheck） */
const ENABLE_ALL = '-1'
const ENABLE_DELETED = '-2'
const toApiEnable = (value: string): string =>
  value === ENABLE_ALL ? '' : value === ENABLE_DELETED ? '-1' : value

const visible = ref(false)
const loading = ref(false)
const rows = ref<MqCheck[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const selected = ref<string[]>([])

const form = ref({ queue: '', queueId: '', name: '', enable: ENABLE_ALL as string })
const filters = ref({ queue: '', queueId: '', name: '', enable: ENABLE_ALL as string })

const editDialogRef = ref<InstanceType<typeof QueueCheckEditDialog>>()

/** 旧 stateFilter：E 出错 / C 正常 / L 处理中 / AC 已审核 / W 待处理，其余原样 */
function stateText(value: string | undefined): string {
  switch (value) {
    case 'C':
      return '正常'
    case 'E':
      return '出错'
    case 'L':
      return '处理中'
    case 'AC':
      return '已审核'
    case 'W':
      return '待处理'
    default:
      return value ?? ''
  }
}
function stateTone(value: string | undefined): 'err' | 'ok' | 'run' | 'muted' {
  if (value === 'E') return 'err'
  if (value === 'C') return 'ok'
  if (value === 'L') return 'run'
  return 'muted'
}

async function load() {
  loading.value = true
  try {
    const res = await pagedQueueCheck({
      queue: filters.value.queue,
      queueId: filters.value.queueId,
      name: filters.value.name,
      enable: toApiEnable(filters.value.enable),
      page: page.value,
      limit: size.value,
    })
    rows.value = res.list
    total.value = res.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载队列告警配置失败')
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  filters.value = { ...form.value, queue: form.value.queue.trim() }
  page.value = 1
  void load()
}

/** 旧「重置」：`queryParam = {}` —— 只清条件不回查（下一次查询才生效）。这里额外保留当前队列名：
 *  弹窗是被某个队列点开的，重置成"全部队列"反而会让人看到别的队列的配置。 */
function resetQuery() {
  form.value = { queue: filters.value.queue, queueId: '', name: '', enable: ENABLE_ALL }
}

function onSelectionChange(selection: MqCheck[]) {
  selected.value = selection.map((row) => row.queueId)
}

async function batchEnable(enable: boolean) {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  try {
    await ElMessageBox.confirm(
      `将${enable ? '启用' : '禁用'}选中的 ${ids.length} 条队列告警配置，确认执行？`,
      enable ? '批量启用' : '批量禁用',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  try {
    await changeQueueCheckEnable(ids, enable)
    ElMessage.success('操作成功')
    selected.value = []
    void load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

async function batchDelete() {
  if (!selected.value.length) {
    ElMessage.error('请选择要操作的数据')
    return
  }
  const ids = [...selected.value]
  // 旧文案：'是否确认要删除以下告警配置:' + size
  try {
    await ElMessageBox.confirm(`是否确认要删除以下告警配置：${ids.length}`, '提示', {
      type: 'warning',
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await deleteQueueCheck(ids)
    ElMessage.success('删除队列告警配置成功')
    selected.value = []
    void load()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除队列告警配置失败')
  }
}

/** 旧 handleAdd：新增弹窗预填 queueName = 当前查询的队列名、isDelete = 0 */
function openAdd() {
  editDialogRef.value?.openDialog(null, {
    queueName: filters.value.queue || form.value.queue || undefined,
    isDelete: 0,
  })
}
function openEdit(row: MqCheck) {
  editDialogRef.value?.openDialog(row)
}

function onPageChange(value: number) {
  page.value = value
  void load()
}
function onSizeChange(value: number) {
  size.value = value
  page.value = 1
  void load()
}

/** 打开弹窗：按当前队列过滤，条件重置成"只看这个队列" */
function open(queueName: string) {
  form.value = { queue: queueName, queueId: '', name: '', enable: ENABLE_ALL }
  filters.value = { ...form.value }
  page.value = 1
  selected.value = []
  visible.value = true
  void load()
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`队列告警 · ${filters.queue || '全部队列'}`"
    width="min(1180px, calc(100vw - 120px))"
    top="5vh"
    destroy-on-close
  >
    <el-form :inline="true" class="qc-filter-form" @submit.prevent>
      <el-form-item label="队列名">
        <el-input v-model="form.queue" placeholder="队列名" clearable class="qc-ctl" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="ID">
        <el-input v-model="form.queueId" placeholder="ID" clearable class="qc-ctl" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="描述">
        <el-input v-model="form.name" placeholder="描述" clearable class="qc-ctl" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.enable" class="qc-ctl">
          <el-option label="全部" :value="ENABLE_ALL" />
          <el-option label="在用" value="0" />
          <el-option label="停用" value="1" />
          <el-option label="历史删除的" :value="ENABLE_DELETED" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="runQuery">查询</el-button>
        <el-button @click="resetQuery">重置</el-button>
      </el-form-item>
    </el-form>

    <div class="qc-op-bar">
      <el-button type="primary" :icon="Plus" @click="openAdd">增加告警</el-button>
      <el-divider direction="vertical" class="qc-op-divider-v" />
      <el-button :disabled="!selected.length" @click="batchEnable(true)">启用</el-button>
      <el-button :disabled="!selected.length" @click="batchEnable(false)">禁用</el-button>
      <el-button type="danger" :disabled="!selected.length" @click="batchDelete">删除</el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      border
      size="small"
      :row-key="(r: MqCheck) => r.queueId"
      empty-text="该队列还没有配置告警规则"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="40" />
      <el-table-column prop="queueName" label="队列名" min-width="180" show-overflow-tooltip />
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <span class="qc-state" :class="`is-${stateTone(row.state)}`">{{ stateText(row.state) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="lastMsg" label="执行结果" min-width="180" show-overflow-tooltip />
      <el-table-column prop="queueDesc" label="描述" width="120" align="center" show-overflow-tooltip />
      <el-table-column prop="maxSize" label="队列积压超过" width="110" align="center" />
      <el-table-column prop="minConsumer" label="消费者数低于" width="110" align="center" />
      <el-table-column prop="minRate" label="消费速率低于" width="110" align="center" />
      <el-table-column prop="maxRate" label="消费速率高于" width="110" align="center" />
      <el-table-column label="操作" width="90" align="center" fixed="right">
        <template #default="{ row }">
          <a class="qc-link" @click="openEdit(row)">编辑</a>
        </template>
      </el-table-column>
    </el-table>

    <div class="qc-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[10, 20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        size="small"
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <QueueCheckEditDialog ref="editDialogRef" @saved="load" />
  </el-dialog>
</template>

<style scoped>
.qc-filter-form :deep(.el-form-item) {
  margin-bottom: 10px;
  margin-right: 12px;
}
.qc-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
.qc-ctl {
  width: 160px;
}
.qc-op-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.qc-op-divider-v {
  height: 1.2em;
  margin: 0;
}
.qc-state {
  font-size: 12px;
}
.qc-state.is-err {
  color: var(--rc-error, #dc2626);
}
.qc-state.is-ok {
  color: var(--rc-ok, #15803d);
}
.qc-state.is-run {
  color: var(--rc-warn, #c2410c);
}
.qc-state.is-muted {
  color: var(--rc-faint, #94a3b8);
}
.qc-link {
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.qc-link:hover {
  text-decoration: underline;
}
.qc-pager {
  display: flex;
  justify-content: flex-end;
  padding: 8px 0 2px;
}
</style>
