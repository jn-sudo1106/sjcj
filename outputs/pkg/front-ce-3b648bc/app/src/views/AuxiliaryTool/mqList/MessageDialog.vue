<script setup lang="ts">
// 消息展示 —— 1:1 迁移旧 data-view `src/page/inst/MqList.vue` 里的 `<a-modal title="消息展示">`。
//
// 旧版行为：
//   · 行内「获取多条」 → handleFetch(row, 1, requeue=true) → 拿到消息后才 visibleContent = true
//   · 行内「删除一条」 → handleFetch(row, 1, requeue=false)
//   · 弹窗内「条数」+ [查询] → handleFetch(null, count, requeue=true)，作用在当前队列上
//   · 消息体是每条 payload 用 \n 拼起来；消息头取第一条的 properties（JSON 串）
//   · 队列没消息 → $message.info('队列xxx没有消息')，弹窗不打开
//
// 有意偏差：
//   1. 旧版「消息头」是个可编辑的 a-input，改完没有任何用处（没有提交/保存）——这里保持同样可编辑，
//      不擅自改成只读：行为 1:1，别顺手"优化"掉用户能改的输入框。
//   2. 旧版取消息用 `eval('(' + res + ')')`，解析失败直接抛到 onRejected，弹窗不弹只报错；
//      这里解析放在 api/mq.ts（parseMessages），解析不出数组按「没有消息」处理，不炸页面。
import { ref } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { fetchMessage } from '@/api/mq'

defineOptions({ name: 'MqMessageDialog' })

const visible = ref(false)
const loading = ref(false)
/** 当前队列：点「查询」重新取消息时用它（等价旧版 this.currentQueue） */
const queue = ref('')
const count = ref<string | number>(1)
const head = ref('')
const content = ref('')

/**
 * 打开并取消息。
 * @param param.queue   队列名
 * @param param.count   条数（行内入口固定 1）
 * @param param.requeue 取完是否放回队列（true=只看一眼 / false=真删）
 */
async function open(param: { queue: string; count: number | string; requeue: boolean }) {
  queue.value = param.queue
  count.value = param.count
  await load(param.requeue)
}

/** 等价旧 handleFetch：失败只报错不弹窗；没消息给一条 info */
async function load(requeue: boolean) {
  loading.value = true
  content.value = ''
  head.value = ''
  try {
    const messages = await fetchMessage({ queue: queue.value, count: count.value, requeue })
    if (!messages.length) {
      ElMessage.info(`队列${queue.value}没有消息`)
      return
    }
    content.value = messages.map((item) => item.payload ?? '').join('\n')
    head.value = JSON.stringify(messages[0]?.properties ?? {})
    visible.value = true
  } catch (error) {
    ElNotification.error({
      title: '获取消息失败',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    loading.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="消息展示"
    width="900px"
    top="20px"
    destroy-on-close
  >
    <el-form :inline="true" class="mq-msg-form" @submit.prevent>
      <el-form-item label="条数">
        <el-input v-model="count" placeholder="条数" class="mq-msg-count" @keyup.enter="load(true)" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" :loading="loading" @click="load(true)">查询</el-button>
      </el-form-item>
      <el-form-item label="队列" class="mq-msg-queue">{{ queue }}</el-form-item>
    </el-form>

    <el-form label-width="72px" class="mq-msg-body" @submit.prevent>
      <el-form-item label="消息头">
        <el-input v-model="head" />
      </el-form-item>
      <el-form-item label="消息体">
        <el-input v-model="content" type="textarea" :autosize="{ minRows: 10, maxRows: 20 }" />
      </el-form-item>
    </el-form>
  </el-dialog>
</template>

<style scoped>
.mq-msg-form {
  margin-bottom: 4px;
}
.mq-msg-form :deep(.el-form-item) {
  margin-bottom: 10px;
}
.mq-msg-count {
  width: 120px;
}
.mq-msg-queue {
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.mq-msg-body :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2);
}
.mq-msg-body :deep(.el-textarea__inner) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}
</style>
