<script setup lang="ts">

import type { CollectorSchedule } from '@/views/FlowCanvas/canvas/flowModel'

const props = defineProps<{ modelValue: CollectorSchedule }>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<CollectorSchedule>] }>()


const WEEKDAYS: [number, string][] = [[1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'], [5, '周五'], [6, '周六'], [7, '周日']]

function patch(value: Partial<CollectorSchedule>) {
  emit('update:modelValue', value)
}
function onInput(key: 'scheduleType' | 'scheduleTime' | 'cron', e: Event) {
  patch({ [key]: (e.target as HTMLInputElement).value })
}
function toggleWeekday(day: number) {
  const weekdays = props.modelValue.weekdays ?? []
  patch({ weekdays: weekdays.includes(day) ? weekdays.filter((item) => item !== day) : [...weekdays, day].sort() })
}
</script>

<template>
  <div class="tss-wrap rc-field">
    <label>定时策略</label>
    <div class="rc-scheduler">
        <div class="rc-scheduler-head">
          <select class="rc-select" :value="modelValue.scheduleType" @change="onInput('scheduleType', $event)">
            <option v-for="item in ['交易日定时', '每天', '每小时', '每周', '自定义 cron']" :key="item" :value="item">{{ item }}</option>
          </select>
          <input class="rc-input" type="time" :value="modelValue.scheduleTime" @input="onInput('scheduleTime', $event)" />
        </div>
        <div class="rc-weekdays">
          <span v-for="[day, label] in WEEKDAYS" :key="day" class="rc-day" :class="{ active: (modelValue.weekdays ?? []).includes(day) }" @click="toggleWeekday(day)">{{ label }}</span>
        </div>
        <div class="rc-cron-preview"><span>cron 表达式</span><input class="rc-input slim cron" :value="modelValue.cron" @input="onInput('cron', $event)" /></div>
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
