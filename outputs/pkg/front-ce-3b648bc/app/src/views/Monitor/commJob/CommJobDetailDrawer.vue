<script setup lang="ts">
// 自定义告警（通用定时任务）详情 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseDetail.vue`
// （CommJobList.vue 的 `handleDetail` → `this.$refs.baseDetail.showDrawer(record, '队列校验配置')`）。
//
// 旧版行为：`a-descriptions size="small" :column="4" bordered`，逐列渲染 `record[col.dataIndex]`，
// 其中几类值走特殊口径（分支顺序与旧模板一致）——
//   · type === 'textArea'      → textarea（只读）      ← 先判
//   · dataIndex === 'isDelete' → 全局过滤器 enableFilter（1→是[1] / 0→否[0]）
//   · `col.fun`                → 自定义取值函数（COMM_JOB 的 isDelete 才配了 fun；
//                                因 isDelete 分支在前，fun 实际不会被用到，这里保留同样的入口）
//   · 其余                     → 直接渲染字段值
// 本页最后两个时间字段（下次运行 / 上次运行）在**列表里**走 timeago 相对时间，在详情里按旧版是原样绝对时间。
//
// 有意偏差（都在交付说明里单列）：
//   1. 抽屉标题：旧代码这里的第二个入参写的是 '队列校验配置'（从 QueueCheck.vue 复制过来的笔误，
//      定时任务详情挂着队列校验的标题）。这里改成 '自定义告警 - 详情'。
//   2. jobType 额外过一遍 jobTypeText（sql → 定时Job / sqlCheck → SQL-告警）。旧 BaseDetail 是通用组件，
//      不认 jobType 的 slot，详情里显示的是原始值 'sql'；这里与列表保持同一展示口径。
//   3. 旧 BaseDetail 默认 placement='left'（左侧抽屉），宽度是 `min(850, max(500, 58% 视口))`。
//      新平台约定「详情类弹层统一右侧 el-drawer」（同上一个迁移页 queueCheck 的处理），
//      宽度用 CSS clamp 精确复刻旧版那条算法。
//   4. 空值统一兜底成 '—'（旧版 default 分支空值就是一片空白）。
import { computed } from 'vue'
import type { CommJob } from '@/api'
import { detailColumns, enableText, jobTypeText, type CommJobColumn } from './columns'

defineOptions({ name: 'CommJobDetailDrawer' })

const props = defineProps<{ modelValue: boolean; record: CommJob | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const columns = computed<CommJobColumn[]>(() => detailColumns())
const title = '自定义告警 - 详情'

/** 逐列取值：对齐旧 BaseDetail 的展示分支（分支顺序也照抄） */
function display(col: CommJobColumn): string {
  const value = props.record ? (props.record as unknown as Record<string, unknown>)[col.dataIndex] : undefined
  if (col.dataIndex === 'isDelete') return enableText(value)
  if (col.dataIndex === 'jobType') return jobTypeText(value)
  if (col.fun && value != null) return col.fun(value)
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="title"
    direction="rtl"
    size="clamp(500px, 58vw, 850px)"
    class-name="rc-drawer"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div v-if="record" class="cjd-body">
      <el-descriptions border :column="4" class="cjd-desc">
        <el-descriptions-item
          v-for="col in columns"
          :key="col.dataIndex"
          :span="col.span ?? 2"
          :label="col.title"
        >
          <pre v-if="col.type === 'textArea'" class="cjd-pre">{{ display(col) }}</pre>
          <span v-else :class="{ mono: col.dataIndex === 'jobId' }">{{ display(col) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </div>
  </el-drawer>
</template>

<style scoped>
.cjd-body {
  padding: 0 4px 16px;
}
.cjd-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.cjd-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
  font-size: 12px;
}
.mono {
  font-family: var(--rc-mono, monospace);
}
.cjd-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
}
</style>
