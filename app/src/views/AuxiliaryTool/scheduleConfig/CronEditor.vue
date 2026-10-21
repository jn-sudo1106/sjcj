<script setup lang="ts">
// cron 可视化编辑器 —— 旧 `components/Cron/Cron.vue` 的 1:1 复刻（六个标签页 + 底部表达式预览）。
//
// 旧版行为要点（照抄，别"优化"）：
//   · 挂载即解析 cronValue → 各段，并**立刻 emit 一次**组合结果（这就是 CronEditModal 里
//     要拿 editorReady 吞掉首次回调的原因）。
//   · 段值变化即时向上抛，没有"确定"按钮。
//   · 日与周互斥：一端有具体值，另一端整块置灰（旧 Day/Week 的 disableChoice）。
//
// 有意偏差：旧版是 7 个 antd 子组件各写一份模板；这里用六段通用组件 + 纯函数（cronSegments.ts）。
// 选项语义、取值区间、`?`/`*`/`a-b`/`a/b`/`1,3,5` 的生成规则完全一致。
import { computed, ref, watch } from 'vue'
import CronSegmentEditor from './CronSegmentEditor.vue'
import { SEGMENT_SPECS, composeCron, parseCron, type SegmentState } from './cronSegments'

const props = defineProps<{ cronValue?: string }>()
const emit = defineEmits<{ (e: 'change', value: string): void }>()

const segments = ref<SegmentState[]>(parseCron(props.cronValue))
const activeTab = ref<string>(SEGMENT_SPECS[0]?.key ?? 'second')

const composed = computed(() => composeCron(segments.value))

/** 外部值变化时重新解析；值没变就不动（避免打断用户正在调的段） */
watch(
  () => props.cronValue,
  (value) => {
    if (String(value ?? '') === composed.value) return
    segments.value = parseCron(value)
  },
)

/** 组合结果变化即上抛（immediate：挂载时也会抛一次，与旧版一致） */
watch(composed, (value) => emit('change', value), { immediate: true })

function onSegmentChange(index: number, value: SegmentState) {
  segments.value = segments.value.map((seg, i) => (i === index ? value : seg))
}

// 日/周互斥：日一旦不是「不设置」，周整块置灰；反之同理
const dayNotSet = computed(() => segments.value[3]?.type === 'notset')
const weekNotSet = computed(() => segments.value[5]?.type === 'notset')
const dayDisabled = computed(() => !weekNotSet.value)
const weekDisabled = computed(() => !dayNotSet.value)

function isDisabled(index: number): boolean {
  if (index === 3) return dayDisabled.value
  if (index === 5) return weekDisabled.value
  return false
}
</script>

<template>
  <div class="ce">
    <el-tabs v-model="activeTab" class="ce-tabs">
      <el-tab-pane v-for="(spec, index) in SEGMENT_SPECS" :key="spec.key" :label="spec.label" :name="spec.key">
        <CronSegmentEditor
          :model-value="segments[index]!"
          :spec="spec"
          :disabled="isDisabled(index)"
          @update:model-value="(value: SegmentState) => onSegmentChange(index, value)"
        />
      </el-tab-pane>
    </el-tabs>

    <!-- 旧版底部那张「秒 / 分钟 / 小时 / 天 / 月 / 周 / 表达式」表格 -->
    <div class="ce-summary">
      <span v-for="(spec, index) in SEGMENT_SPECS" :key="spec.key" class="ce-cell">
        <span class="ce-cell-label">{{ spec.label }}</span>
        <span class="ce-cell-value">{{ composed.split(' ')[index] }}</span>
      </span>
      <span class="ce-cell ce-cell-cron">
        <span class="ce-cell-label">表达式</span>
        <code class="ce-cron">{{ composed }}</code>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ce {
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius-sm, 6px);
  overflow: hidden;
  background: #fff;
}
.ce-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 10px;
}
.ce-tabs :deep(.el-tabs__item) {
  height: 34px;
  line-height: 34px;
  font-size: 13px;
}
.ce-tabs :deep(.el-tabs__content) {
  padding: 4px 10px 10px;
}
.ce-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  border-top: 1px solid var(--rc-border, #e2e8f0);
  background: var(--rc-border-soft, #f8fafc);
  font-size: 12px;
}
.ce-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-right: 1px solid var(--rc-border, #e2e8f0);
}
.ce-cell-cron {
  flex: 1;
  min-width: 220px;
  border-right: 0;
}
.ce-cell-label {
  color: var(--rc-muted, #64748b);
}
.ce-cell-value {
  color: var(--rc-text, #0f172a);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ce-cron {
  color: var(--rc-primary, #2563eb);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
