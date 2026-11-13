<script setup lang="ts">
// cron 组装器（1:1 迁移旧 data-view `src/components/Cron/Cron.vue`）：
// 6 个字段 tab（秒/分/时/日/月/周）+ 一行预览表格（秒/分钟/小时/天/月/周/表达式）。
//
// 旧版要点：
// - 六个字段各自 v-model 成字符串，拼装时逐字段兜底：`second || '*'` … `week || '?'`。
//   所以「指定」一项都不勾（字段成空串）时，落到 `*` 而不是空。
// - 日与周只能设置其中之一：旧版由 DayTab/WeekTab 各自的 `disableChoice` 决定——被锁的一方
//   直接把 `?` emit 出来。这里同样用 computed 推出锁定态、交给 CronField 的 `excluded` 去 emit。
// - 初始值 second='0' minute='0' hour='*' day='*' month='*' week='?' → `0 0 * * * ?`。
//   外部传入空串时**不覆盖**这组默认值（旧 formatValue 开头就 `if (!this.cronValue) return`），
//   效果是打开弹窗就会把表达式补成 `0 0 * * * ?`。
import { computed, ref, watch } from 'vue'
import CronField from './CronField.vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const active = ref('second')
const second = ref('0')
const minute = ref('0')
const hour = ref('*')
const day = ref('*')
const month = ref('*')
const week = ref('?')

const WEEK_OPTIONS = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
]

const cronValue = computed(() =>
  [second.value || '*', minute.value || '*', hour.value || '*', day.value || '*', month.value || '*', week.value || '?'].join(' '),
)

// 日/周互斥（旧 DayTab.disableChoice / WeekTab.disableChoice）
const weekExcluded = computed(() => Boolean(day.value) && day.value !== '?')
const dayExcluded = computed(() => Boolean(week.value) && week.value !== '?')

const rows = computed(() => [
  {
    second: second.value,
    minute: minute.value,
    hour: hour.value,
    day: day.value,
    month: month.value,
    week: week.value,
    cron: cronValue.value,
  },
])

/** 表达式 → 六个字段（旧 Cron.formatValue） */
function format(value: string) {
  if (!value) return
  const parts = String(value)
    .split(' ')
    .filter((item) => !!item)
  if (!parts.length) return
  const slots = [second, minute, hour, day, month, week]
  slots.forEach((slot, i) => {
    if (parts.length > i) slot.value = parts[i]
  })
}

watch(
  () => props.modelValue,
  (v) => {
    if (v === cronValue.value) return
    format(v)
  },
  { immediate: true },
)

watch(cronValue, (v) => emit('update:modelValue', v), { immediate: true })
</script>

<template>
  <div class="cb">
    <el-tabs v-model="active" class="cb-tabs">
      <el-tab-pane label="秒" name="second">
        <CronField v-model="second" unit="秒" :min="0" :max="59" />
      </el-tab-pane>
      <el-tab-pane label="分" name="minute">
        <CronField v-model="minute" unit="分" :min="0" :max="59" />
      </el-tab-pane>
      <el-tab-pane label="时" name="hour">
        <CronField v-model="hour" unit="时" :min="0" :max="23" />
      </el-tab-pane>
      <el-tab-pane label="日" name="day">
        <CronField v-model="day" unit="日" :min="1" :max="31" allow-not-set :excluded="dayExcluded" />
      </el-tab-pane>
      <el-tab-pane label="月" name="month">
        <CronField v-model="month" unit="月" :min="1" :max="12" />
      </el-tab-pane>
      <el-tab-pane label="周" name="week">
        <CronField
          v-model="week"
          unit="周"
          :min="0"
          :max="6"
          :items="WEEK_OPTIONS"
          :columns="6"
          :loop-start="2"
          allow-not-set
          :excluded="weekExcluded"
        />
      </el-tab-pane>
    </el-tabs>

    <el-table :data="rows" size="small" border class="cb-preview">
      <el-table-column prop="second" label="秒" align="center" />
      <el-table-column prop="minute" label="分钟" align="center" />
      <el-table-column prop="hour" label="小时" align="center" />
      <el-table-column prop="day" label="天" align="center" />
      <el-table-column prop="month" label="月" align="center" />
      <el-table-column prop="week" label="周" align="center" />
      <el-table-column prop="cron" label="表达式" min-width="180" />
    </el-table>
  </div>
</template>

<style scoped>
.cb-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}
.cb-tabs :deep(.el-tabs__content) {
  min-height: 268px;
  overflow: visible;
}
.cb-preview {
  margin-top: 12px;
}
</style>
