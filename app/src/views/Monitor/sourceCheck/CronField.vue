<script setup lang="ts">
// cron 单字段编辑器（1:1 迁移旧 data-view `src/components/Cron/tabs/*` + `tabs/mixins/CronMixin.js`
// 的合并版：旧版 6 个 tab 组件除 min/max/单位/选项外完全同构，这里收成一个组件 + props）。
//
// 旧版口径（保持一致，别"顺手优化"）：
// - 五种模式：不设置 → `?`；每X → `*`；区间 → `start-end`；循环 → `start/interval`；
//   指定 → 逗号列表（升序）。日与周互斥时整块锁死并强制输出 `?`。
// - parseProp 识别顺序：空/`*` → 每X；含 `?` → 不设置；含 `-` → 区间；含 `/` → 循环；
//   含 `,` 或是纯数字 → 指定；其余落到 每X。
//   旧版还有 W/L 分支，但模板里的对应单选早已注释掉、value_c 也没有 case → 同样落到 `*`，
//   所以这里直接归到 每X，结果等价。
// - 指定项空选时输出空串（不是 `*`），由 CronBuilder 组装时再兜底成 `*`。
// - 周 tab 的「循环」行在旧版绑的是 valueRange.start（历史写法），这里保持同款绑定。
import { computed, ref, watch } from 'vue'

type FieldType = 'EVERY' | 'RANGE' | 'LOOP' | 'SPECIFY' | 'NOT_SET'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 单位文案：秒 / 分 / 时 / 日 / 月 / 周 */
    unit: string
    min: number
    max: number
    /** 指定项/周名选项；缺省按 min..max 生成数字项 */
    items?: { label: string; value: number }[]
    /** 指定项每行几个（旧版数字项 8 列、周 6 列） */
    columns?: number
    /** 日/周互斥：锁死并强制输出 `?` */
    excluded?: boolean
    /** 是否提供「不设置」选项（仅日/周） */
    allowNotSet?: boolean
    /** 循环项起始默认值（旧版周 tab 用 2，其余用 min） */
    loopStart?: number
  }>(),
  { items: undefined, columns: 8, excluded: false, allowNotSet: false, loopStart: undefined },
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const type = ref<FieldType>('EVERY')
// 旧版区间默认 min..max；循环默认 start = min（周为 2）、interval = 1
const range = ref({ start: props.min, end: props.max })
const loop = ref({ start: props.loopStart ?? props.min, interval: 1 })
const list = ref<number[]>([])

const gridItems = computed(
  () =>
    props.items ??
    Array.from({ length: props.max - props.min + 1 }, (_, i) => ({ label: String(props.min + i), value: props.min + i })),
)

/** 周 tab 的起止用带名称的下拉，其余用数字输入 */
const useSelect = computed(() => Array.isArray(props.items) && props.items.length > 0)
const isWeek = computed(() => props.unit === '周')

const loopStartBinding = computed({
  get: () => (isWeek.value ? range.value.start : loop.value.start),
  set: (v: number) => {
    if (isWeek.value) range.value.start = v
    else loop.value.start = v
  },
})

const fieldValue = computed(() => {
  if (props.excluded) return '?'
  switch (type.value) {
    case 'NOT_SET':
      return '?'
    case 'RANGE':
      return `${range.value.start}-${range.value.end}`
    case 'LOOP':
      return `${loopStartBinding.value}/${loop.value.interval}`
    case 'SPECIFY':
      return [...list.value].sort((a, b) => a - b).join(',')
    default:
      return '*'
  }
})

/** 表达式 → 内部状态（旧 parseProp） */
function parse(v: string) {
  const value = String(v ?? '')
  if (!value || value === '*') {
    type.value = 'EVERY'
    return
  }
  if (value.includes('?')) {
    type.value = 'NOT_SET'
    return
  }
  if (value.includes('-')) {
    type.value = 'RANGE'
    const parts = value.split('-')
    if (parts.length >= 2) {
      range.value.start = Number.parseInt(parts[0], 10)
      range.value.end = Number.parseInt(parts[1], 10)
    }
    return
  }
  if (value.includes('/')) {
    type.value = 'LOOP'
    const parts = value.split('/')
    if (parts.length >= 2) {
      loopStartBinding.value = parts[0] === '*' ? 0 : Number.parseInt(parts[0], 10)
      loop.value.interval = Number.parseInt(parts[1], 10)
    }
    return
  }
  if (value.includes(',') || !Number.isNaN(Number(value))) {
    type.value = 'SPECIFY'
    list.value = value
      .split(',')
      .map((item) => Number.parseInt(item, 10))
      .filter((n) => !Number.isNaN(n))
    return
  }
  type.value = 'EVERY'
}

watch(
  () => props.modelValue,
  (v) => {
    // 自己刚 emit 出去的值回流时不重解析，否则会把用户选到一半的状态打散
    if (v === fieldValue.value) return
    parse(v)
  },
  { immediate: true },
)

watch(fieldValue, (v) => emit('update:modelValue', v), { immediate: true })
</script>

<template>
  <div class="cf">
    <div v-if="allowNotSet" class="cf-item">
      <el-radio v-model="type" value="NOT_SET" :disabled="excluded">
        不设置
        <span class="cf-tip">日和周只能设置其中之一</span>
      </el-radio>
    </div>

    <div class="cf-item">
      <el-radio v-model="type" value="EVERY" :disabled="excluded">每{{ unit }}</el-radio>
    </div>

    <div class="cf-item cf-line">
      <el-radio v-model="type" value="RANGE" :disabled="excluded">区间：从</el-radio>
      <el-select
        v-if="useSelect"
        v-model="range.start"
        class="cf-sel"
        :disabled="type !== 'RANGE' || excluded"
      >
        <el-option v-for="it in gridItems" :key="it.value" :label="it.label" :value="it.value" />
      </el-select>
      <el-input-number
        v-else
        v-model="range.start"
        class="cf-num"
        :min="min"
        :max="max"
        :precision="0"
        :controls="false"
        :disabled="type !== 'RANGE' || excluded"
      />
      <span class="cf-text">至</span>
      <el-select
        v-if="useSelect"
        v-model="range.end"
        class="cf-sel"
        :disabled="type !== 'RANGE' || excluded"
      >
        <el-option v-for="it in gridItems" :key="it.value" :label="it.label" :value="it.value" />
      </el-select>
      <el-input-number
        v-else
        v-model="range.end"
        class="cf-num"
        :min="min"
        :max="max"
        :precision="0"
        :controls="false"
        :disabled="type !== 'RANGE' || excluded"
      />
      <span v-if="!useSelect" class="cf-text">{{ unit }}</span>
    </div>

    <div class="cf-item cf-line">
      <el-radio v-model="type" value="LOOP" :disabled="excluded">循环：从</el-radio>
      <el-select v-if="useSelect" v-model="loopStartBinding" class="cf-sel" :disabled="type !== 'LOOP' || excluded">
        <el-option v-for="it in gridItems" :key="it.value" :label="it.label" :value="it.value" />
      </el-select>
      <el-input-number
        v-else
        v-model="loop.start"
        class="cf-num"
        :min="min"
        :max="max"
        :precision="0"
        :controls="false"
        :disabled="type !== 'LOOP' || excluded"
      />
      <span class="cf-text">{{ useSelect ? '开始，间隔' : `${unit}开始，间隔` }}</span>
      <el-input-number
        v-model="loop.interval"
        class="cf-num"
        :min="min"
        :max="max"
        :precision="0"
        :controls="false"
        :disabled="type !== 'LOOP' || excluded"
      />
      <span class="cf-text">{{ useSelect ? '天' : unit }}</span>
    </div>

    <div class="cf-item cf-specify">
      <el-radio v-model="type" value="SPECIFY" :disabled="excluded">指定</el-radio>
      <el-checkbox-group
        v-model="list"
        class="cf-grid"
        :style="{ '--cf-cols': String(columns) }"
        :disabled="type !== 'SPECIFY' || excluded"
      >
        <el-checkbox v-for="it in gridItems" :key="it.value" :value="it.value">{{ it.label }}</el-checkbox>
      </el-checkbox-group>
    </div>
  </div>
</template>

<style scoped>
.cf {
  padding-left: 4px;
}
.cf-item:not(:last-child) {
  margin-bottom: 10px;
}
.cf-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.cf-tip {
  margin-left: 6px;
  color: var(--rc-faint, #94a3b8);
  font-size: 12px;
}
.cf-text {
  color: var(--rc-text-2, #334155);
  font-size: 13px;
  white-space: nowrap;
}
.cf-num {
  width: 74px;
}
.cf-sel {
  width: 110px;
}
.cf-specify {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.cf-grid {
  display: grid;
  grid-template-columns: repeat(var(--cf-cols, 8), minmax(52px, 1fr));
  gap: 0 4px;
  flex: 1;
  min-width: 0;
}
.cf-grid :deep(.el-checkbox) {
  margin-right: 0;
  height: 26px;
}
.cf :deep(.el-radio) {
  height: 28px;
  margin-right: 0;
}
</style>
