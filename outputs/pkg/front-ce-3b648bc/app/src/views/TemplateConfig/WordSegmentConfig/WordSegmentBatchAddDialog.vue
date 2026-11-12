<script setup lang="ts">
// 分词配置批量新增弹窗（1:1 对齐旧 ai-chat-view `src/demo/WordSegmentConfigList.vue:89-99、228-255`）。
//
// 旧口径：
// · 一个文本域，一行一条，每行 `类型,内容,分词类型` 三段（英文逗号分隔），多条数据用换行；
// · 提交 POST /poc/word-segment-config/batch，body 是 **{type,content,token} 对象数组**；
// · 本域没有单条新增入口，这里是唯一的新增通道（见列表页偏差 1）。
//
// 与旧版的有意偏差（旧版缺陷，交付说明单列）：
// 1. 旧版把格式不对的行**静默丢掉**（`item.split(',').length === 3` 不成立的行直接跳过），
//    一行都没解析出来时（`if (list.length === 0) this.onCancel()` 后面没有 return）还会把空数组 POST 给后端；
//    这里把非法行的行号报出来并拦住提交，让用户看得见丢的是哪几行。
// 2. 旧版段落里留空（如 `PERSON,,base`）照样发过去，这里要求三段都非空，算非法行。
// 3. 旧版每段不做 trim，`PERSON, 张宪 , base` 会把「 张宪 」（带空格）存成词条；这里每段 trim 后再发。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { wordSegmentApi } from '@/api/templateConfig'
import type { WordSegmentBatchItem } from '@/api/types/template'

const emit = defineEmits<{ (e: 'saved', payload: { count: number }): void }>()

const visible = ref(false)
const saving = ref(false)
const content = ref('')

/** 一行 = 一条：三段都非空才算有效，返回 [有效行, 非法行的行号（从 1 开始）] */
const parsed = computed<{ rows: WordSegmentBatchItem[]; invalidLines: number[] }>(() => {
  const rows: WordSegmentBatchItem[] = []
  const invalidLines: number[] = []
  content.value.split('\n').forEach((line, index) => {
    if (!line.trim()) return // 空行（含末尾换行）不算非法，旧版同样跳过
    const parts = line.split(',').map((part) => part.trim())
    if (parts.length !== 3 || parts.some((part) => !part)) {
      invalidLines.push(index + 1)
      return
    }
    rows.push({ type: parts[0]!, content: parts[1]!, token: parts[2]! })
  })
  return { rows, invalidLines }
})

function open() {
  content.value = ''
  visible.value = true
}

function close() {
  visible.value = false
}

/** 解析小结（旧版没有任何回显，非法行就这么被吞掉） */
const hint = computed(() => {
  const { rows, invalidLines } = parsed.value
  const base = `已解析 ${rows.length} 条`
  return invalidLines.length
    ? `${base}，${invalidLines.length} 行格式不对（第 ${invalidLines.join('、')} 行）`
    : base
})

async function submit() {
  const { rows, invalidLines } = parsed.value
  if (invalidLines.length) {
    ElMessage.warning(`第 ${invalidLines.join('、')} 行格式不对，每行需要「类型,内容,分词类型」三段（英文逗号分隔）`)
    return
  }
  if (!rows.length) {
    ElMessage.warning('没有要新增的数据')
    return
  }
  saving.value = true
  try {
    await wordSegmentApi.batchAdd(rows)
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
    class="ws-batch-dialog"
  >
    <el-form class="ws-batch-form" label-width="90px" @submit.prevent>
      <el-form-item label="数据">
        <el-input
          v-model="content"
          type="textarea"
          :rows="10"
          resize="vertical"
          placeholder="格式： 类型,内容,分词类型;多条数据用换行"
        />
      </el-form-item>
    </el-form>
    <div class="ws-batch-hint" :class="{ 'is-invalid': parsed.invalidLines.length > 0 }">{{ hint }}</div>
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 13.6 寸屏幕基线（AGENTS.md 弹窗适配 + 滚动容器约定）：el-dialog 是 append-to-body 的 teleport，
   自定义 class 落在 .el-dialog 上但拿不到本组件的 scope 属性，必须走 :global（同 DataIndexSyncEditDialog）。 */
:global(.ws-batch-dialog) {
  max-width: calc(100vw - 40px);
}
:global(.ws-batch-dialog .el-dialog__body) {
  max-height: 72vh;
  overflow: auto;
  padding-top: 8px;
}
.ws-batch-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
.ws-batch-form :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--rc-text-2, #475569);
}
.ws-batch-hint {
  font-size: 12px;
  color: var(--rc-faint, #94a3b8);
  padding-left: 90px;
}
.ws-batch-hint.is-invalid {
  color: var(--el-color-danger, #dc2626);
}
</style>
