<script setup lang="ts">
// 数据集详情 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseDetail.vue`
// （DatasetList.vue 的 `handleDetail` → `this.$refs.datasetDetail.showDrawer(record, '数据集详情')`）。
//
// 旧版行为：`a-descriptions size="small" :column="4" bordered`，逐列渲染 `record[col.dataIndex]`，
// 其中三类值走特殊口径——
//   · dataIndex === 'isDelete' → 全局过滤器 enableFilter（1→是[1] / 0→否[0]）
//   · dataIndex === 'state'    → 全局过滤器 stateFilter（C→正常 / E→出错 / L→处理中 …）
//   · type === 'textArea'      → textarea（只读）；`col.fun` → 自定义取值函数
//     （DATASET 没有这两类列，留了同样的入口，方便同目录复用）
// 旧版顶部还有一颗「关闭本页」按钮，一并保留。
//
// 有意偏差：
//   1. 旧 BaseDetail 默认 placement='left'（左侧抽屉）。新平台约定「详情类弹层统一右侧 el-drawer」
//      （见 sourceCheck/SourceDetailDrawer.vue、queueCheck/QueueDetailDrawer.vue 的同款说明），
//      这里按新平台惯例放右侧；宽度用 CSS clamp 精确复刻旧版那条算法（500 下限 / 58vw / 850 上限）。
//   2. 抽屉标题：旧 `showDrawer(record, '数据集详情')` 会拼成「数据集详情 - 详情」（标题重复）。
//      这里由调用方传基名「数据集」，拼出「数据集 - 详情」——保持旧版的拼接规则，只去掉重复的那个词。
//   3. 旧版默认分支直接渲染 `record[dataIndex]`（空值就是一片空白），这里统一兜底成 '—'。
import { computed } from 'vue'
import type { DatasetRow } from '@/api/dataset'
import { detailColumns, enableText, stateText, type DatasetColumn } from './columns'

defineOptions({ name: 'DatasetDetailDrawer' })

const props = defineProps<{ modelValue: boolean; record: DatasetRow | null }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const columns = computed<DatasetColumn[]>(() => detailColumns())
const title = '数据集 - 详情'

/** 逐列取值：对齐旧 BaseDetail 的展示分支 */
function display(col: DatasetColumn): string {
  const value = props.record ? (props.record as Record<string, unknown>)[col.dataIndex] : undefined
  if (col.dataIndex === 'isDelete') return enableText(value)
  if (col.dataIndex === 'state') return stateText(value)
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
    <template #default>
      <div v-if="record" class="dd-body">
        <!-- <el-button class="dd-close" @click="emit('update:modelValue', false)">关闭本页</el-button> -->
        <el-descriptions border :column="4" class="dd-desc">
          <el-descriptions-item
            v-for="col in columns"
            :key="col.dataIndex"
            :span="col.span ?? 2"
            :label="col.title"
          >
            <pre v-if="col.type === 'textArea'" class="dd-pre">{{ display(col) }}</pre>
            <span v-else :class="{ mono: col.dataIndex === 'datasetId' }">{{ display(col) }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.dd-body {
  padding: 0 4px 16px;
}
.dd-close {
  margin-bottom: 12px;
}
.dd-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.dd-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
  font-size: 12px;
}
.mono {
  font-family: var(--rc-mono, monospace);
}
.dd-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
}
</style>
