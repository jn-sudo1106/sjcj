<script setup lang="ts">
// MQ 队列 —— 1:1 迁移旧 data-view `src/page/inst/MqList.vue`（旧路由 /inst/mq-list）。
//
// 旧页面全貌（挨条对齐，别随手删）：
//   搜索栏：队列范围(queryParam.flag：''=-不限- / 'on'=非0队列，默认 'on') + 队列名称(queryParam.cond)
//           + 告警状态(queryParam.state：''=-不限- / 'E' 出错 / 'C' 正常 / 'NO' 未配置) + [查询]
//   表格：无分页，一次拉 1000 条（api/mq.ts 里说明）；列 = vhost / 队列名 / 可用 / 锁定 / 总量 /
//         生产 / 消费 / 应答 / 消费者 / 告警 / 告警规则 / 操作 共 12 列
//   行内操作：获取多条(requeue=true) / 删除一条(requeue=false) / 清空
//   弹窗：消费者列表 / 队列告警配置 / 消息展示
//   接口：queuesPaged / fetchMessage / purgeQueue / queueConsumers（见 api/mq.ts）
//
// 有意偏差（都写在交付说明里）：
//   1. 不迁死代码：`handleClear` + 「删除操作密码」弹窗（visibleClear 那条分支）在旧版里从没被打开过
//      ——模板挂着，但没有任何入口调用 handleClear；真正的清空走 handleClearNoAck → $confirm →
//      commitClear（key=当前小时数）。这里只保留后者。`lastDateSlot`（timeago）同样没有对应列：
//      旧 MQ_LIST 里根本没有 lastInsertDate 这一列。`handleEdit / handleDetail / updateCallback /
//      sendNext / onSelectChange / toggleAdvanced …` 全是脚手架残留，页面上没有入口。
//   2. 排序是**前端**排序：旧 MQ_LIST 的 sorter 是函数（`(a,b)=>a.name.localeCompare(b.name)`），
//      与 MQ_CHECK 的 `sorter: true`（服务端）不是一回事。新版用 el-table 默认的本地排序，
//      队列名额外用 localeCompare（与旧函数一致），其余数值列按 prop 比较。
//   3. 旧版「非0队列 / 告警状态」两个下拉的 -不限- 值是空串，el-select 会把空串当成「没选」而回退到
//      placeholder（见 Monitor/queueCheck 同款踩坑），故 UI 上用 'all' 哨兵，发请求前还原成 ''。
//   4. 通知文案去掉旧版调试后缀「获取失败AA / 清空队列失败AB」——那两个字母是开发期临时标记，
//      不是给用户看的。
//   5. 老页面挂在 /other-config 的「辅助工具」子路由下，可带 sourceId/configId/parentId/fileId 的
//      query 从别处钻进来（props 同名）。新项目这一屏是「辅助工具」的页内 tab，没有这种钻取入口，
//      所以不迁这 4 个 props / query 透传（迁了也是永远为空的死参数）。
//   6. 列表底部补一行「共 N 条」——旧版一次拉 1000 条却什么都不说，用户不知道到底有多少队列。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { BellFilled, Search } from '@element-plus/icons-vue'
import { listQueues, purgeQueue, type MqQueue, type MqRateDetail } from '@/api/mq'
import MessageDialog from './MessageDialog.vue'
import ConsumerDialog from './ConsumerDialog.vue'
import QueueCheckDialog from './QueueCheckDialog.vue'

defineOptions({ name: 'MqList' })

// ---- 查询条件（草稿 → 执行 两态：改条件不自动查，点「查询」才发请求，与旧版一致）----
/** el-select 的 UI 哨兵：空串会被判成「没选」，选「不限」时框里看不到字（同 QueueCheck 的 ENABLE_ALL） */
const ALL = 'all'
const toApiValue = (value: string): string => (value === ALL ? '' : value)

const form = reactive({ flag: 'on', cond: '', state: ALL })
const filters = reactive({ flag: 'on', cond: '', state: ALL })

// ---- 列表状态 ----
const rows = ref<MqQueue[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    rows.value = await listQueues({
      flag: toApiValue(filters.flag),
      cond: filters.cond,
      state: toApiValue(filters.state),
    })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载队列列表失败')
    rows.value = []
  } finally {
    loading.value = false
  }
}

function runQuery() {
  filters.flag = form.flag
  filters.cond = form.cond.trim()
  filters.state = form.state
  void load()
}

// ---- 排序（前端本地排序，见文件头偏差 2）----
/** 队列名用 localeCompare，与旧列定义里的 sorter 函数逐字一致 */
function sortByName(a: MqQueue, b: MqQueue): number {
  return String(a.name ?? '').localeCompare(String(b.name ?? ''))
}
/** 告警规则数可能缺失（未配置告警的队列后端不返 notifyCount），空值按 0 排 */
function sortByNotifyCount(a: MqQueue, b: MqQueue): number {
  return Number(a.notifyCount ?? 0) - Number(b.notifyCount ?? 0)
}

/** 速率列：`rate + '/s'`；后端没给 message_stats（队列从没流量）时留空，不显示 "undefined/s" */
function rateText(detail?: MqRateDetail): string {
  return detail && detail.rate !== undefined && detail.rate !== null ? `${detail.rate}/s` : ''
}

// ---- 弹窗 ----
const messageDialogRef = ref<InstanceType<typeof MessageDialog>>()
const consumerDialogRef = ref<InstanceType<typeof ConsumerDialog>>()
const checkDialogRef = ref<InstanceType<typeof QueueCheckDialog>>()

/** 旧 handleFetch(record, 1, true/false)：行内「获取多条 / 删除一条」 */
function openMessage(row: MqQueue, requeue: boolean) {
  void messageDialogRef.value?.open({ queue: row.name, count: 1, requeue })
}
/** 旧 handleOpenConsumer */
function openConsumers(row: MqQueue) {
  void consumerDialogRef.value?.open(row.name)
}
/** 旧 handleOpenNotify */
function openCheck(row: MqQueue) {
  void checkDialogRef.value?.open(row.name)
}

/** 旧 handleClearNoAck：确认 → commitClear（key = 当前小时数，后端拿它做操作校验） */
async function clearQueue(row: MqQueue) {
  try {
    await ElMessageBox.confirm(`是否确定清空队列：${row.name}，清空后无法恢复`, '警告', {
      type: 'warning',
      confirmButtonText: '确认清空',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await purgeQueue({ queue: row.name, key: new Date().getHours() })
    ElNotification.success({ title: '清空队列成功', message: row.name })
  } catch (error) {
    ElNotification.error({
      title: '清空队列失败',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="mq-shell">
    <!-- 筛选（对齐旧 a-form layout="inline" + a-row 栅格；改条件不自动查） -->
    <el-form :inline="true" class="mq-filter-form">
      <el-row :gutter="8" class="mq-filter-row">
        <el-col :md="4" :sm="24">
          <el-form-item label="队列范围">
            <el-select v-model="form.flag">
              <el-option label="不限" :value="ALL" />
              <el-option label="非0队列" value="on" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="队列名称">
            <el-input v-model="form.cond" placeholder="队列名关键字" clearable @keyup.enter="runQuery" />
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item label="告警状态">
            <el-select v-model="form.state">
              <el-option label="不限" :value="ALL" />
              <el-option label="出错" value="E" />
              <el-option label="正常" value="C" />
              <el-option label="未配置" value="NO" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :md="4" :sm="24">
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <el-table
      v-loading="loading"
      :data="rows"
      border
      size="small"
      empty-text="暂无队列数据"
      :row-key="(r: MqQueue) => r.vhost + r.name"
    >
      <el-table-column prop="vhost" label="vhost" width="90" show-overflow-tooltip />
      <!-- 队列名：旧 nameSlot —— 告警出错时前面带红点（旧 a-badge status="error"），其余原样 -->
      <el-table-column
        prop="name"
        label="队列名"
        min-width="200"
        sortable
        :sort-method="sortByName"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span class="mq-name">
            <span v-if="row.notifyState === 'E'" class="mq-dot" />{{ row.name }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="messages_ready" label="可用" width="80" align="right" sortable />
      <el-table-column prop="messages_unacknowledged" label="锁定" width="80" align="right" />
      <el-table-column prop="messages" label="总量" width="80" align="right" sortable />
      <!-- 生产 / 消费 / 应答：三组速率，旧列是 scopedSlots 取 message_stats.*.rate + '/s' -->
      <el-table-column label="生产" width="90" align="right">
        <template #default="{ row }">{{ rateText(row.message_stats?.publish_details) }}</template>
      </el-table-column>
      <el-table-column label="消费" width="90" align="right">
        <template #default="{ row }">{{ rateText(row.message_stats?.deliver_get_details) }}</template>
      </el-table-column>
      <el-table-column label="应答" width="90" align="right">
        <template #default="{ row }">{{ rateText(row.message_stats?.ack_details) }}</template>
      </el-table-column>
      <!-- 消费者：点开消费者列表 -->
      <el-table-column prop="consumers" label="消费者" width="100" align="center" sortable>
        <template #default="{ row }">
          <span class="mq-tag-click" @click="openConsumers(row)">
            <el-tag size="small">{{ row.consumers ?? 0 }}</el-tag>
          </span>
        </template>
      </el-table-column>
      <!-- 告警：旧 notifyStateSlot —— E 红铃铛 / C 且规则数>0 绿铃铛，点开告警配置 -->
      <el-table-column label="告警" width="70" align="center">
        <template #default="{ row }">
          <span class="mq-bell" @click="openCheck(row)">
            <el-icon v-if="row.notifyState === 'E'" :size="15" color="var(--rc-error, #dc2626)">
              <BellFilled />
            </el-icon>
            <el-icon
              v-else-if="Number(row.notifyCount ?? 0) > 0 && row.notifyState === 'C'"
              :size="15"
              color="var(--rc-ok, #15803d)"
            >
              <BellFilled />
            </el-icon>
          </span>
        </template>
      </el-table-column>
      <!-- 告警规则：旧 notifySlot —— 规则条数，点开告警配置 -->
      <el-table-column
        prop="notifyCount"
        label="告警规则"
        width="100"
        align="center"
        sortable
        :sort-method="sortByNotifyCount"
      >
        <template #default="{ row }">
          <span class="mq-tag-click" @click="openCheck(row)">
            <el-tag size="small">{{ row.notifyCount ?? '' }}</el-tag>
          </span>
        </template>
      </el-table-column>
      <!-- 操作：旧 actionSlot（旧模板尾随一个没有内容的 a-divider，这里不迁那条多余的竖线） -->
      <el-table-column label="操作" width="200" align="center">
        <template #default="{ row }">
          <div class="mq-actions">
            <a class="mq-link" @click="openMessage(row, true)">获取多条</a>
            <el-divider direction="vertical" class="mq-op-divider-v" />
            <a class="mq-link" @click="openMessage(row, false)">删除一条</a>
            <el-divider direction="vertical" class="mq-op-divider-v" />
            <a class="mq-link mq-link-danger" @click="clearQueue(row)">清空</a>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <div class="mq-footer">共 {{ rows.length }} 条</div>

    <MessageDialog ref="messageDialogRef" />
    <ConsumerDialog ref="consumerDialogRef" />
    <QueueCheckDialog ref="checkDialogRef" />
  </div>
</template>

<style scoped>
.mq-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
  overflow: hidden;
}
.mq-shell :deep(.el-table__header th) {
  color: var(--rc-text-2);
}
/* 筛选表单：对齐旧 a-form layout="inline" 的栅格宽度比例 */
.mq-filter-form {
  margin-bottom: 0;
}
.mq-filter-row {
  width: 100%;
}
.mq-filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
  margin-right: 0;
  width: 100%;
}
.mq-filter-form :deep(.el-select),
.mq-filter-form :deep(.el-input) {
  width: 100%;
}
.mq-filter-form :deep(.el-form-item__label) {
  font-size: 12px;
}
.mq-filter-form .el-col:last-child :deep(.el-form-item) {
  width: auto;
}
/* 队列名：告警出错时前面一个红点（旧 a-badge status="error" 的等效视觉；文字颜色保持原样） */
.mq-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mq-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rc-error, #dc2626);
}
.mq-tag-click {
  display: inline-flex;
  cursor: pointer;
}
.mq-bell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  min-height: 18px;
  cursor: pointer;
}
.mq-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.mq-link {
  color: var(--rc-primary, #2563eb);
  font-size: 12px;
  cursor: pointer;
}
.mq-link:hover {
  text-decoration: underline;
}
.mq-link-danger {
  color: var(--rc-error, #dc2626);
}
.mq-op-divider-v {
  height: 1em;
  margin: 0 4px;
}
.mq-footer {
  display: flex;
  justify-content: flex-end;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
</style>
