<script setup lang="ts">

import { computed } from 'vue'
import type { CollectorSchedule } from '@/views/FlowCanvas/canvas/flowModel'
import { cronForSchedule, displaySchedule } from '@/utils/flow/scheduleCron'

const props = defineProps<{ modelValue: CollectorSchedule }>()
const emit = defineEmits<{ 'update:modelValue': [patch: Partial<CollectorSchedule>] }>()


const WEEKDAYS: [number, string][] = [[1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'], [5, '周五'], [6, '周六'], [7, '周日']]
const TRADING_DAYS = [1, 2, 3, 4, 5]

function patch(value: Partial<CollectorSchedule>) {
  emit('update:modelValue', value)
}
// cron 推导口径抽在 utils/flow/scheduleCron.ts（本组件显示、编排配置保存落库共用一份）。
/**
 * 控件显示用的那份策略（2026-09-18）。
 *
 * 此前模板直接绑 `props.modelValue.xxx`：**节点只有 cron、没有策略字段时，
 * 策略下拉和时间就是空的**，而下面的 cron 框因为走 cronForSchedule 的兜底显示着
 * `0 0 0 * * ?`——上面空、下面有值，看着像数据没同步过来（用户报的就是这个）。
 * displaySchedule 会先从 cron 反解，反解不出再退到同一套兜底，两边始终对得上。
 * 它只用于显示，不写回 store。
 */
const shown = computed(() => displaySchedule(props.modelValue))
const isCustomCron = computed(() => shown.value.scheduleType === '自定义 cron')
const cronValue = computed(() => (isCustomCron.value ? shown.value.cron ?? '' : cronForSchedule(shown.value)))
function patchWithCron(value: Partial<CollectorSchedule>) {
  const next = { ...props.modelValue, ...value }
  const normalized = next.scheduleType === '交易日定时' ? { ...value, weekdays: TRADING_DAYS } : value
  if (next.scheduleType === '交易日定时') next.weekdays = TRADING_DAYS
  patch(next.scheduleType === '自定义 cron' ? normalized : { ...normalized, cron: cronForSchedule(next) })
}
function onInput(key: 'scheduleType' | 'scheduleTime' | 'cron', e: Event) {
  patchWithCron({ [key]: (e.target as HTMLInputElement).value })
}
function toggleWeekday(day: number) {
  const weekdays = props.modelValue.weekdays ?? []
  patchWithCron({ weekdays: weekdays.includes(day) ? weekdays.filter((item) => item !== day) : [...weekdays, day].sort() })
}
// 这里原本有一个 `immediate: true` 的 watch，负责"scheduleType/时间变了就把 cron 重算回去"。
// 它是「节点没动却一直提示未保存」的根源（2026-09-10 实测）：cronFor 对空值全有兜底
// （scheduleType 缺省当「每天」、时间缺省当 0:0），所以**打开一个从没配过定时的节点**时，
// 它算出 "0 0 0 * * ?"、与存着的 undefined 不等，于是 immediate 那一轮就 patch 了一笔，
// 一路 flow.patchSchedule → touchConfig，把节点标成脏的。用户什么都没碰，底部却常驻
// 「节点配置有未保存修改」，切换编排对象还要被拦一次"改动将丢弃"。
//
// 删掉它不会让 cron 失同步：用户真正改动的两条路径（onInput / toggleWeekday）都走
// patchWithCron，那里本来就用 cronFor(next) 算好了 cron 一起提交。显示用的推导值走
// cronValue 这个 computed，本就不需要写回 store——把"显示值"写进数据，才是这个 bug 的本质。
</script>

<template>
  <div class="tss-wrap rc-field">
    <label>定时策略</label>
    <div class="rc-scheduler">
        <div class="rc-scheduler-head">
          <select class="rc-select" :value="shown.scheduleType" @change="onInput('scheduleType', $event)">
            <option v-for="item in ['交易日定时', '每天', '每小时', '每5分钟一次', '每周', '自定义 cron']" :key="item" :value="item">{{ item }}</option>
          </select>
          <input class="rc-input" type="time" :value="shown.scheduleTime" @input="onInput('scheduleTime', $event)" />
        </div>
        <div class="rc-weekdays">
          <span v-for="[day, label] in WEEKDAYS" :key="day" class="rc-day" :class="{ active: (shown.weekdays ?? []).includes(day) }" @click="toggleWeekday(day)">{{ label }}</span>
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
