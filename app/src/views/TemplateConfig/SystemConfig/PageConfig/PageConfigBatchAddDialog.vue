<script setup lang="ts">
// 页面配置批量新增弹窗（1:1 对齐旧 ai-chat-view `src/system/config/SysPageConfigList.vue:81-91、213-236`）。
//
// 旧口径：
// · 一个文本域（占位「格式：内容;多条数据用换行」），一行一条；
// · 每行按英文逗号切开后**只取第 0 段**当 content（旧平台就是 `item.split(',')[0]`，逗号后面的内容直接丢弃）；
// · 提交 POST /poc/system/page-config/batch，body 是 **{content} 对象数组**；
// · 本域没有单条新增入口（旧弹窗 add 分支是死代码），这里是唯一的新增通道。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版不做 trim：`上海分行 ,xxx` 会把「上海分行 」（带空格）存进库；这里取第 0 段后 trim。
// 2. 旧版空行也解析成 {content:''} 发过去，且一行都没解析出来时（`if (list.length === 0) this.onCancel()`
//    后面没有 return）仍会把空数组 POST 给后端；这里跳过空白行、零有效行不发请求（同分词批量先例）。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { pageConfigApi } from '@/api/templateConfig'
import type { SysPageConfigBatchItem } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { count: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const content = ref('')

/** 一行 = 一条：取逗号前第 0 段并 trim，空白行跳过（旧版会原样发 {content:''}） */
const parsed = computed<SysPageConfigBatchItem[]>(() =>
  content.value
    .split('\n')
    .map((line) => ({ content: (line.split(',')[0] ?? '').trim() }))
    .filter((item) => item.content),
)

function open() {
  content.value = ''
  visible.value = true
}

function close() {
  visible.value = false
}

/** 解析小结（旧版没有任何回显） */
const hint = computed(() => `已解析 ${parsed.value.length} 条`)

async function submit() {
  const rows = parsed.value
  if (!rows.length) {
    ElMessage.warning('没有要新增的数据')
    return
  }
  saving.value = true
  try {
    await pageConfigApi.batchAdd(rows)
    ElMessage.success('操作成功')
    visible.value = false
    emit('saved', { count: rows.length })
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    saving.value = false
  }
}

defineExpose({ open, close })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="批量新增"
    width="800px"
    top="6vh"
    append-to-body
    :close-on-click-modal="false"
    class="sc-page-batch-dialog"
  >
    <el-form class="sc-page-batch-form" label-width="90px" @submit.prevent>
      <el-form-item label="数据">
        <el-input
          v-model="content"
          type="textarea"
          :rows="10"
          resize="vertical"
          placeholder="格式：内容;多条数据用换行"
        />
      </el-form-item>
    </el-form>
    <div class="sc-page-batch-hint">{{ hint }}</div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线（AGENTS.md 弹窗适配 + 滚动容器约定）：el-dialog 是 append-to-body 的 teleport，
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 WordSegment 弹窗）。 */
:global(.sc-page-batch-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.sc-page-batch-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.sc-page-batch-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
.sc-page-batch-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.sc-page-batch-hint {
  font-size: 12px;
  color: var(--rc-faint, #94a3b8);
  padding-left: 90px;
}
</style>
