// cron 六段的解析 / 生成 —— 旧 `components/Cron` 那套可视化编辑器的核心逻辑，
// 从 7 个 antd 标签页 + 1 个 mixin 里提炼成纯函数，方便单测，也让 UI 层只剩渲染。
//
// 每段支持四种形态（对齐旧 mixin 的 TYPE_*）：
//   every   → `*`
//   notset  → `?`            （只有「日」「周」可选，两个互斥）
//   range   → `start-end`
//   loop    → `start/interval`（旧版 从 N 开始、每 interval 一次；`*/n` 会被解析成 0/n）
//   specify → `1,3,5`        （勾选项，升序拼接）
//
// ⚠️ 日/周互斥规则（旧版是靠 Day/Week 两个标签页互相 disabled 实现的）：
//    两个都给了具体值时不合法，这里**日优先**，把周强制成 `?`。
//    定这条是因为旧实现会让两个 watcher 互相触发（day 变 '?' → week 解禁 → 又变 '*'…），
//    收敛方向不确定；改成确定的优先级，行为可预期。

export type SegmentType = 'every' | 'notset' | 'range' | 'loop' | 'specify'

export interface SegmentState {
  type: SegmentType
  /** range 的起止 */
  start: number
  end: number
  /** loop 的起点与间隔 */
  loopStart: number
  interval: number
  /** specify 勾中的值 */
  list: number[]
}

export interface SegmentSpec {
  key: 'second' | 'minute' | 'hour' | 'day' | 'month' | 'week'
  label: string
  min: number
  max: number
  /** 「每秒 / 每分 / 每小时 / 每日 / 每月 / 每周」这种 every 态文案 */
  everyLabel: string
  /** 是否提供「不设置（?）」，只有日 / 周有 */
  allowNotSet: boolean
  /** 周段的显示名（周日…周六） */
  labels?: string[]
  /** range 起止的初始值 */
  rangeStart: number
  rangeEnd: number
  /** loop 起点的初始值 */
  loopStart: number
}

export const SEGMENT_SPECS: SegmentSpec[] = [
  { key: 'second', label: '秒', min: 0, max: 59, everyLabel: '每秒', allowNotSet: false, rangeStart: 0, rangeEnd: 59, loopStart: 0 },
  { key: 'minute', label: '分', min: 0, max: 59, everyLabel: '每分', allowNotSet: false, rangeStart: 0, rangeEnd: 59, loopStart: 0 },
  { key: 'hour', label: '时', min: 0, max: 23, everyLabel: '每小时', allowNotSet: false, rangeStart: 0, rangeEnd: 23, loopStart: 0 },
  { key: 'day', label: '日', min: 1, max: 31, everyLabel: '每日', allowNotSet: true, rangeStart: 1, rangeEnd: 31, loopStart: 1 },
  { key: 'month', label: '月', min: 1, max: 12, everyLabel: '每月', allowNotSet: false, rangeStart: 1, rangeEnd: 12, loopStart: 1 },
  {
    key: 'week',
    label: '周',
    min: 0,
    max: 6,
    everyLabel: '每周',
    allowNotSet: true,
    labels: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    rangeStart: 0,
    rangeEnd: 6,
    loopStart: 2,
  },
]

/** 一段的初始状态：every（旧版默认 `*`；日/周默认日 `*`、周 `?`） */
export function createSegment(spec: SegmentSpec): SegmentState {
  return {
    type: 'every',
    start: spec.rangeStart,
    end: spec.rangeEnd,
    loopStart: spec.loopStart,
    interval: 1,
    list: [],
  }
}

/** 解析一段（旧 mixin.parseProp）：认不出的一律回 every，绝不抛错 */
export function parseSegment(value: string | undefined | null, spec: SegmentSpec): SegmentState {
  const state = createSegment(spec)
  const text = String(value ?? '').trim()
  if (!text || text === '*') {
    state.type = 'every'
    return state
  }
  if (text.indexOf('?') >= 0) {
    state.type = spec.allowNotSet ? 'notset' : 'every'
    return state
  }
  if (text.indexOf('-') >= 0) {
    const [start, end] = text.split('-')
    state.type = 'range'
    state.start = Number.parseInt(start ?? '', 10)
    state.end = Number.parseInt(end ?? '', 10)
    if (!Number.isFinite(state.start)) state.start = spec.rangeStart
    if (!Number.isFinite(state.end)) state.end = spec.rangeEnd
    return state
  }
  if (text.indexOf('/') >= 0) {
    const [startText, intervalText] = text.split('/')
    state.type = 'loop'
    // 旧版 `value[0] === '*' ? 0 : parseInt(...)`，等价于「以 * 开头当 0」
    state.loopStart = String(startText ?? '').startsWith('*') ? 0 : Number.parseInt(startText ?? '', 10)
    state.interval = Number.parseInt(intervalText ?? '', 10)
    if (!Number.isFinite(state.loopStart)) state.loopStart = spec.loopStart
    if (!Number.isFinite(state.interval) || state.interval <= 0) state.interval = 1
    return state
  }
  if (text.indexOf(',') >= 0 || !Number.isNaN(Number(text))) {
    state.type = 'specify'
    state.list = text
      .split(',')
      .map((item) => Number.parseInt(item, 10))
      .filter((item) => Number.isFinite(item))
    return state
  }
  state.type = 'every'
  return state
}

/** 生成一段文本 */
export function composeSegment(state: SegmentState): string {
  switch (state.type) {
    case 'notset':
      return '?'
    case 'range':
      return `${state.start}-${state.end}`
    case 'loop':
      return `${state.loopStart}/${state.interval}`
    case 'specify':
      return [...state.list].sort((a, b) => a - b).join(',')
    case 'every':
    default:
      return '*'
  }
}

/** 六段状态 → 完整表达式（[秒 分 时 日 月 周]），日/周按「日优先」收敛 */
export function composeCron(states: SegmentState[]): string {
  const [second, minute, hour, day, month, week] = states
  if (!second || !minute || !hour || !day || !month || !week) return ''
  let dayText = composeSegment(day)
  let weekText = composeSegment(week)
  if (dayText === '') dayText = '?'
  if (weekText === '') weekText = '?'
  // 日与周不能同时是具体值：日优先，周回落到「不设置」
  if (dayText !== '?' && weekText !== '?') weekText = '?'
  return [composeSegment(second), composeSegment(minute), composeSegment(hour), dayText, composeSegment(month), weekText].join(' ')
}

/** 表达式 → 六段状态；段数不足按默认补（`*`，日/周为 `*` 与 `?`） */
export function parseCron(cron: string | undefined | null): SegmentState[] {
  const parts = String(cron ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return SEGMENT_SPECS.map((spec, index) => {
    const raw = parts[index]
    if (raw === undefined) {
      // 缺省：日给 '*'、周给 '?'（满足互斥），其余 '*'
      const fallback = spec.key === 'week' ? '?' : '*'
      return parseSegment(fallback, spec)
    }
    return parseSegment(raw, spec)
  })
}

/** 一段的中文描述（表格 / 摘要用） */
export function describeSegment(state: SegmentState, spec: SegmentSpec): string {
  switch (state.type) {
    case 'notset':
      return '不设置'
    case 'range':
      return `${state.start}${spec.label === '周' ? '' : ''} - ${state.end}`
    case 'loop':
      return `从 ${state.loopStart} 起每 ${state.interval}`
    case 'specify':
      return [...state.list].sort((a, b) => a - b).join('、') || '未选'
    case 'every':
    default:
      return spec.everyLabel
  }
}
