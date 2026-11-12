<script setup lang="ts">
// 任务实例详情 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseDetail.vue`
// （TaskInst.vue 的 `handleDetail` → `$refs.detail.showDrawer(record)`，不传 title）。
//
// 旧版行为：`a-descriptions size="small" :column="4" bordered`，逐列渲染 `record[col.dataIndex]`，
// 其中几类值走特殊口径（分支顺序与旧模板一致）——
//   · item.link / item.href / item.url → 链接（TASK_LIST 的列没配这几个，本页用不到）
//   · type === 'textArea'      → textarea（只读）        ← 先判
//   · dataIndex === 'isDelete' → 全局过滤器 enableFilter
//   · dataIndex === 'state'    → 全局过滤器 stateFilter（C→正常 / E→出错 / L→处理中 / AC→已审核 / W→待处理）
//   · `col.fun`                → 自定义取值函数
//   · 其余                     → 直接渲染字段值
//
// 有意偏差（都在交付说明里单列）：
//   1. 抽屉标题：旧版默认「详情」；这里改成「任务实例 - 详情」（与 Monitor 里 commJob 的抽屉标题口径一致）。
//   2. 旧 BaseDetail 默认 placement='left'（左侧抽屉），宽度 `min(850, max(500, 58% 视口))`。
//      新平台约定「详情类弹层统一右侧 el-drawer」（同 commJob / queueCheck 的处理），宽度用 CSS clamp 复刻。
//   3. 空值统一兜底成 '—'（旧版 default 分支空值就是一片空白）。
//   4. 旧列集里那个没有 title / dataIndex 的占位格子照样渲染成空格子（不显示 '—'）。
import { computed } from 'vue'
import type { TaskRow } from '@/api/taskList'
import { detailColumns, stateText, type TaskColumn } from './columns'

defineOptions({ name: 'TaskDetailDrawer' })

const props = defineProps<{ modelValue: boolean; record: TaskRow | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const columns = computed<TaskColumn[]>(() => detailColumns())
const title = '任务实例 - 详情'

/** 逐列取值：对齐旧 BaseDetail 的展示分支（分支顺序也照抄） */
function display(col: TaskColumn): string {
  const value = props.record ? (props.record as Record<string, unknown>)[col.dataIndex] : undefined
  if (col.dataIndex === 'state') return stateText(value)
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
    <div v-if="record" class="tld-body">
      <el-descriptions border :column="4" class="tld-desc">
        <el-descriptions-item
          v-for="col in columns"
          :key="col.dataIndex"
          :span="col.span ?? 2"
          :label="col.title"
        >
          <!-- 旧配置里的空占位格子：照旧渲染成空格子 -->
          <span v-if="col.dataIndex === 'blank_placeholder'" />
          <pre v-else-if="col.type === 'textArea'" class="tld-pre">{{ display(col) }}</pre>
          <span v-else :class="{ mono: col.dataIndex === 'taskId' }">{{ display(col) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </div>
  </el-drawer>
</template>

<style scoped>
.tld-body {
  padding: 0 4px 16px;
}
.tld-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.tld-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
  font-size: 12px;
}
.mono {
  font-family: var(--rc-mono, monospace);
}
.tld-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
}
</style>
