<script setup lang="ts">
// 消费者列表 —— 1:1 迁移旧 data-view `src/page/inst/modules/MqConsumerList.vue`
// （旧 MqList 里的 `<mq-consumer-modal ref="consumerModal">`）。
//
// 旧版行为：
//   · 点队列行的「消费者」tag → showModal(queue) → 弹窗打开，查询条件 queue = 该队列名
//   · 弹窗里还能改「队列名称」再点 [查询] 重新拉（旧版就是让用户手改，虽然入口本来就是点行钻进来）
//   · 列表无分页，一次拉完；列 = 主机名(nodeName) / 预取(prefetch) / 未应答(messages_unacknowledged) /
//     派发(deliverRate) / 应答(ackRate) / 空闲时(idealSince)
//   · 拉取失败 → 报「获取详情失败」并**把弹窗关掉**（旧版 visible = false）
//
// 有意偏差：
//   1. 旧版表格挂了 rowSelection + alert（勾选提示条），但弹窗里一个批量按钮都没有 —— 纯摆设。
//      这里不迁，免得用户勾了半天找不到能干什么。
//   2. 列宽按 13.6 寸屏重排：主机名给 min-width 吃剩余空间，其余数值列固定宽。
import { ref } from 'vue'
import { ElNotification } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { queueConsumers, type MqConsumer } from '@/api/mq'

defineOptions({ name: 'MqConsumerDialog' })

const visible = ref(false)
const loading = ref(false)
const queue = ref('')
const rows = ref<MqConsumer[]>([])

async function load() {
  loading.value = true
  try {
    rows.value = await queueConsumers(queue.value.trim())
  } catch (error) {
    ElNotification.error({
      title: '获取详情失败',
      message: error instanceof Error ? error.message : String(error),
    })
    // 旧版对齐：拉不到就把弹窗关掉，不留一个空壳在那儿让人以为队列没消费者
    visible.value = false
    rows.value = []
  } finally {
    loading.value = false
  }
}

/** 等价旧 showModal(queue)：带上队列名并打开 */
async function open(queueName: string) {
  queue.value = queueName
  rows.value = []
  visible.value = true
  await load()
}

defineExpose({ open })
</script>

<template>
  <el-dialog v-model="visible" title="消费者列表" width="900px" top="20px" destroy-on-close>
    <el-form :inline="true" class="mq-con-form" @submit.prevent>
      <el-form-item label="队列名称">
        <el-input v-model="queue" placeholder="队列名称" class="mq-con-queue" @keyup.enter="load" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" :loading="loading" @click="load">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="rows" border size="small" empty-text="该队列当前没有消费者">
      <el-table-column prop="nodeName" label="主机名" min-width="180" show-overflow-tooltip />
      <el-table-column prop="prefetch" label="预取" width="100" align="right" />
      <el-table-column prop="messages_unacknowledged" label="未应答" width="100" align="right" />
      <el-table-column prop="deliverRate" label="派发" width="100" align="right" />
      <el-table-column prop="ackRate" label="应答" width="100" align="right" />
      <el-table-column prop="idealSince" label="空闲时" width="180" show-overflow-tooltip />
    </el-table>
  </el-dialog>
</template>

<style scoped>
.mq-con-form {
  margin-bottom: 2px;
}
.mq-con-form :deep(.el-form-item) {
  margin-bottom: 10px;
}
.mq-con-queue {
  width: 260px;
}
.mq-con-form :deep(.el-form-item__label) {
  font-size: 12px;
}
</style>
