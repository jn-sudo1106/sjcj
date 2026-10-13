<script setup lang="ts">
// 队列校验配置详情 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseDetail.vue`
// （QueueCheck.vue 的 `handleDetail` → `this.$refs.baseDetail.showDrawer(record, '队列校验配置')`）。
//
// 旧版行为：`a-descriptions size="small" :column="4" bordered`，逐列渲染 `record[col.dataIndex]`，
// 其中三类值走特殊口径——
//   · dataIndex === 'isDelete' → 全局过滤器 enableFilter（1→是[1] / 0→否[0]）
//   · dataIndex === 'state'    → 全局过滤器 stateFilter（C→正常 / E→出错 / L→处理中 …）
//   · type === 'textArea'      → textarea（只读）
//   · `col.fun`                → 自定义取值函数（MQ_CHECK 没有这样的列，留了同样的入口）
// 标题是 `队列校验配置 - 详情`（旧 showDrawer 把第二个入参拼上「 - 详情」）。
//
// 有意偏差：旧 BaseDetail 默认 placement='left'（左侧抽屉），宽度是 `min(850, max(500, 58% 视口))`。
// 新平台约定「详情类弹层统一右侧 el-drawer」（见 sourceCheck/SourceDetailDrawer.vue 的同款说明），
// 这里按新平台惯例放右侧；宽度用 CSS clamp 精确复刻旧版那条算法（500 下限 / 58vw / 850 上限），
// 不写死——MQ_CHECK 详情是 :column="4" 的 4 列描述表，固定窄宽会把标签挤坏。
// （sourceCheck 的详情抽屉写死 640px 是因为它只有两列结构，两者不同源，别照抄。）
import { computed } from 'vue'
import type { MqCheck } from '@/api'
import { detailColumns, enableText, stateText, type QueueColumn } from './columns'

defineOptions({ name: 'QueueDetailDrawer' })

const props = defineProps<{ modelValue: boolean; record: MqCheck | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const columns = computed<QueueColumn[]>(() => detailColumns())
const title = '队列校验配置 - 详情'

/** 逐列取值：对齐旧 BaseDetail 的展示分支。
 *  差异：旧版 default 分支直接渲染 `record[dataIndex]`（空值就是一片空白），这里统一兜底成 '—'。 */
function display(col: QueueColumn): string {
  const value = props.record ? (props.record as unknown as Record<string, unknown>)[col.dataIndex] : undefined
  if (col.dataIndex === 'isDelete') return enableText(value)
  if (col.dataIndex === 'state') return stateText(value == null ? '' : String(value))
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
    <div v-if="record" class="qd-body">
      <el-descriptions border :column="4" class="qd-desc">
        <el-descriptions-item
          v-for="col in columns"
          :key="col.dataIndex"
          :span="col.span ?? 2"
          :label="col.title"
        >
          <pre v-if="col.type === 'textArea'" class="qd-pre">{{ display(col) }}</pre>
          <span v-else :class="{ mono: col.dataIndex === 'queueId' }">{{ display(col) }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </div>
  </el-drawer>
</template>

<style scoped>
.qd-body {
  padding: 0 4px 16px;
}
.qd-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.qd-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
  font-size: 12px;
}
.mono {
  font-family: var(--rc-mono, monospace);
}
.qd-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
}
</style>
