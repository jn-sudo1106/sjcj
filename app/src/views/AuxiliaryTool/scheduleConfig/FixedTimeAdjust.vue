<script setup lang="ts">
// 固定时间点调整 —— 旧 `page/config/modules/FixedTimeAdjust.vue` 的 1:1 移植。
//
// 当表达式（6~7 段 spring cron）里的 分/时/日 段是**固定数字**时，直接给个数字框改它，
// 其余段原样保留（第 7 段「年」也不动）。循环(0/30)、区间(8-18)、指定(1,3,5) 这些结构不提供调整，
// @秒数 格式整块不渲染 —— 与旧版判据一致。
import { computed } from 'vue'

const props = defineProps<{ cron?: string }>()
const emit = defineEmits<{ (e: 'change', value: string): void }>()

/** 表达式拆段；@秒数 与空串当作没有可调段 */
const parts = computed<string[]>(() => {
  const text = String(props.cron ?? '').trim()
  if (!text || /^@\d+$/.test(text)) return []
  return text.split(/\s+/).filter(Boolean)
})

/** 固定数字段：索引 1=分 2=时 3=日（旧版 ranges 表） */
const SEG_RANGES: Record<number, [number, number]> = { 1: [0, 59], 2: [0, 23], 3: [1, 31] }

const fixedSegs = computed<Record<number, number>>(() => {
  const out: Record<number, number> = {}
  const list = parts.value
  if (list.length < 6) return out
  Object.keys(SEG_RANGES).forEach((key) => {
    const index = Number(key)
    const raw = list[index]
    const [min, max] = SEG_RANGES[index]!
    if (raw !== undefined && /^\d{1,2}$/.test(raw) && Number(raw) >= min && Number(raw) <= max) {
      out[index] = Number(raw)
    }
  })
  return out
})

const showAdjust = computed(() => Object.keys(fixedSegs.value).length > 0)

const LABELS: Record<number, string> = { 1: '分', 2: '时', 3: '日' }

function setSeg(index: number, value: number | undefined) {
  if (value === undefined || value === null) return
  const next = parts.value.slice(0, 7)
  next[index] = String(value)
  emit('change', next.join(' '))
}
</script>

<template>
  <div v-if="showAdjust" class="fta">
    <span class="fta-title">固定时间点调整</span>
    <template v-for="(value, key) in fixedSegs" :key="key">
      <span class="fta-label">{{ LABELS[Number(key)] }}</span>
      <el-input-number
        :model-value="value"
        :min="SEG_RANGES[Number(key)]![0]"
        :max="SEG_RANGES[Number(key)]![1]"
        :precision="0"
        :controls="false"
        class="fta-num"
        @update:model-value="(v: number | undefined) => setSeg(Number(key), v)"
      />
    </template>
    <span class="fta-tip">调整后实时回写完整表达式，其余段保持不变</span>
  </div>
</template>

<style scoped>
.fta {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  padding: 4px 8px;
  background: var(--rc-border-soft, #f8fafc);
  border: 1px dashed var(--rc-border, #e2e8f0);
  border-radius: 4px;
  font-size: 12px;
}
.fta-title {
  margin-right: 4px;
  color: var(--rc-primary, #2563eb);
  font-weight: 500;
}
.fta-label {
  margin: 0 2px 0 8px;
  color: var(--rc-text-2, #475569);
}
.fta-tip {
  margin-left: 10px;
  color: var(--rc-muted, #64748b);
}
.fta-num {
  width: 64px;
}
</style>
