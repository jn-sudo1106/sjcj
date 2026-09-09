<script setup lang="ts">

import { computed, watch } from 'vue'
import type { CollectorSchedule } from '@/views/FlowCanvas/canvas/flowModel'

const props = defineProps<{ modelValue: CollectorSchedule }>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<CollectorSchedule>] }>()


const WEEKDAYS: [number, string][] = [[1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'], [5, '周五'], [6, '周六'], [7, '周日']]
const TRADING_DAYS = [1, 2, 3, 4, 5]

function patch(value: Partial<CollectorSchedule>) {
  emit('update:modelValue', value)
}
function normalizeTime(time?: string): [number, number] {
  const [hour, minute] = String(time || '').split(':').map((item) => Number(item))
  return [
    Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 0,
    Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  ]
}
function cronFor(settings: CollectorSchedule): string {
  const type = settings.scheduleType || '每天'
  if (type === '自定义 cron') return settings.cron ?? ''
  const [hour, minute] = normalizeTime(settings.scheduleTime)
  if (type === '每5分钟一次') return '0 */5 * * * ?'
  if (type === '每小时') return `0 ${minute} * * * ?`
  if (type === '每周') {
    const weekdays = settings.weekdays?.length ? settings.weekdays : [1]
    return `0 ${minute} ${hour} ? * ${weekdays.join(',')}`
  }
  if (type === '交易日定时') return `0 ${minute} ${hour} ? * 1-5`
  return `0 ${minute} ${hour} * * ?`
}
const isCustomCron = computed(() => props.modelValue.scheduleType === '自定义 cron')
const cronValue = computed(() => isCustomCron.value ? props.modelValue.cron ?? '' : cronFor(props.modelValue))
function patchWithCron(value: Partial<CollectorSchedule>) {
  const next = { ...props.modelValue, ...value }
  const normalized = next.scheduleType === '交易日定时' ? { ...value, weekdays: TRADING_DAYS } : value
  if (next.scheduleType === '交易日定时') next.weekdays = TRADING_DAYS
  patch(next.scheduleType === '自定义 cron' ? normalized : { ...normalized, cron: cronFor(next) })
}
function onInput(key: 'scheduleType' | 'scheduleTime' | 'cron', e: Event) {
  patchWithCron({ [key]: (e.target as HTMLInputElement).value })
}
function toggleWeekday(day: number) {
  const weekdays = props.modelValue.weekdays ?? []
  patchWithCron({ weekdays: weekdays.includes(day) ? weekdays.filter((item) => item !== day) : [...weekdays, day].sort() })
}
watch(
  () => [props.modelValue.scheduleType, props.modelValue.scheduleTime, props.modelValue.weekdays?.join(',')] as const,
  () => {
    if (isCustomCron.value) return
    const cron = cronFor(props.modelValue)
    if (cron !== props.modelValue.cron) patch({ cron })
  },
  { immediate: true },
)
</script>

<template>
  <div class="tss-wrap rc-field">
    <label>定时策略</label>
    <div class="rc-scheduler">
        <div class="rc-scheduler-head">
          <select class="rc-select" :value="modelValue.scheduleType" @change="onInput('scheduleType', $event)">
            <option v-for="item in ['交易日定时', '每天', '每小时', '每5分钟一次', '每周', '自定义 cron']" :key="item" :value="item">{{ item }}</option>
          </select>
          <input class="rc-input" type="time" :value="modelValue.scheduleTime" @input="onInput('scheduleTime', $event)" />
        </div>
        <div class="rc-weekdays">
          <span v-for="[day, label] in WEEKDAYS" :key="day" class="rc-day" :class="{ active: (modelValue.weekdays ?? []).includes(day) }" @click="toggleWeekday(day)">{{ label }}</span>
        </div>
        <div class="rc-cron-preview"><span>cron 表达式</span><input class="rc-input slim cron" :value="cronValue" :readonly="!isCustomCron" @input="onInput('cron', $event)" /></div>
    </div>
  </div>
</template>

<style scoped>
.tss-wrap { margin-bottom: 12px; }
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-scheduler { border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; overflow: hidden; }
.rc-scheduler-head { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px; border-bottom: 1px solid #eef2f7; background: #fbfdff; }
.rc-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; padding: 8px; }
.rc-day { display: flex; align-items: center; justify-content: center; height: 26px; border: 1px solid var(--rc-border); border-radius: 6px; color: var(--rc-muted); background: #fff; font-size: 10px; cursor: pointer; }
.rc-day.active { border-color: #93c5fd; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }
.rc-cron-preview { display: flex; align-items: center; gap: 8px; padding: 8px; border-top: 1px solid #eef2f7; background: #fff; }
.rc-cron-preview span { color: var(--rc-muted); font-size: 11px; flex: none; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-input.slim { height: 30px; padding: 0 9px; }
.rc-input.cron { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
