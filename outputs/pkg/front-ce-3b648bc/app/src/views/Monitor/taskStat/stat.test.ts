// 任务统计的纯计算层（旧 page/inst/TaskStat.vue 的 computed / methods 里与 UI 无关的那些）。
// 这一层守的是合并口径与图形数据整形：两路口径不一致时的兜底、环图切片和=100%、30 天截断，
// 都是"看着没问题、错了很难发现"的地方。
import { describe, expect, it } from 'vitest'
import {
  PIE_STATES,
  alertRowsOf,
  clampRange30,
  dayStart,
  errorBarData,
  errorColor,
  filteredRowsOf,
  fmtDate,
  fmtDateTag,
  fmtDateTime,
  fmtMonthDay,
  fmtTimeTag,
  groupLabel,
  keyOf,
  mergeRows,
  percentOf,
  pieSlices,
  progressOf,
  quickRange,
  rateActiveOf,
  thresholdOf,
  topBarData,
  toNum,
  type RawStatRow,
  type StatRow,
} from './stat'

describe('stat · 合并两路响应（旧 mergeRows）', () => {
  const total: RawStatRow[] = [
    { sourceId: '161725', cnt: 1000 },
    { sourceId: '161801', cnt: 60 },
    { sourceId: '161900', cnt: 30 },
  ]
  const errs: RawStatRow[] = [
    { sourceId: '161725', cnt: 100 },
    { sourceId: '161801', cnt: 60 },
  ]

  it('以总数为准逐行取值，错误率 = ERROR/任务数 保留 2 位', () => {
    const rows = mergeRows(total, errs)
    expect(rows.map((r) => [r.sourceId, r.cnt, r.errorCnt, r.errorRate])).toEqual([
      ['161725', 1000, 100, 10],
      ['161801', 60, 60, 100],
      ['161900', 30, 0, 0],
    ])
  })

  it('排序：任务数降序，其次 ERROR 数降序', () => {
    const rows = mergeRows(
      [
        { sourceId: 'a', cnt: 10 },
        { sourceId: 'b', cnt: 10 },
        { sourceId: 'c', cnt: 20 },
      ],
      [
        { sourceId: 'a', cnt: 1 },
        { sourceId: 'b', cnt: 5 },
      ],
    )
    expect(rows.map((r) => r.sourceId)).toEqual(['c', 'b', 'a'])
  })

  it('只出现在 ERROR 路里的分组也补进来（cnt=errorCnt、错误率 100）', () => {
    const rows = mergeRows([{ sourceId: '161725', cnt: 100 }], [{ sourceId: '161725', cnt: 10 }, { sourceId: '999', cnt: 7 }])
    const extra = rows.find((r) => r.sourceId === '999')!
    expect([extra.cnt, extra.errorCnt, extra.errorRate]).toEqual([7, 7, 100])
  })

  it('cnt = 0 时错误率为 0（不做除零）', () => {
    const rows = mergeRows([{ sourceId: 'x', cnt: 0 }], [])
    expect(rows[0].errorRate).toBe(0)
  })

  it('缺失的那一维落成 null（来源/配置都可能被后端省略）', () => {
    const rows = mergeRows([{ cnt: 5 }], [])
    expect(rows[0].sourceId).toBeNull()
    expect(rows[0].configId).toBeNull()
  })
})

describe('stat · 分组键与标签', () => {
  it('keyOf 用 s-/c- 占位缺失的那一维', () => {
    expect(keyOf({ sourceId: '1', configId: '2' })).toBe('s1_c2')
    expect(keyOf({ sourceId: null, configId: '2' })).toBe('s-_c2')
    expect(keyOf({ sourceId: '1', configId: undefined })).toBe('s1_c-')
  })

  it('groupLabel 按当前维度出标签（缺失显示 -）', () => {
    const row = { sourceId: '161725', configId: '70598' }
    expect(groupLabel(row, 'source')).toBe('源#161725')
    expect(groupLabel(row, 'config')).toBe('配置#70598')
    expect(groupLabel(row, 'both')).toBe('源161725/配置70598')
    expect(groupLabel({ sourceId: null, configId: null }, 'both')).toBe('源-/配置-')
  })
})

describe('stat · 占比 / 配色 / 阈值', () => {
  it('percentOf 保留 2 位，分母为 0 时返回 0', () => {
    expect(percentOf(250, 1000)).toBe(25)
    expect(percentOf(1, 3)).toBe(33.33)
    expect(percentOf(1, 0)).toBe(0)
  })

  it('percentOf 兜底异常输入：占比上限 100，非有限值/负数一律 0', () => {
    // 后端口径不一致时单组 cnt 有可能大于合计（进度条不能画出 >100 的值）
    expect(percentOf(1200, 1000)).toBe(100)
    expect(percentOf(Number.NaN, 1000)).toBe(0)
    expect(percentOf(10, Number.NaN)).toBe(0)
    expect(percentOf(-5, 1000)).toBe(0)
  })

  it('progressOf：el-progress 的 percentage 只收 0~100 的有限数值', () => {
    expect(progressOf(0)).toBe(0)
    expect(progressOf(33.33)).toBe(33.33)
    expect(progressOf(100)).toBe(100)
    // 越界 → 夹到边界（不报警、不画空条）
    expect(progressOf(250)).toBe(100)
    expect(progressOf(-1)).toBe(0)
    // 非有限值 → 0（百分比位置留空比显示 NaN 条好）
    expect(progressOf(Number.NaN)).toBe(0)
    expect(progressOf(Number.POSITIVE_INFINITY)).toBe(0)
    expect(progressOf(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('errorColor 三档：>20 红、>5 黄、其余绿（旧页色值）', () => {
    expect(errorColor(100)).toBe('#f5222d')
    expect(errorColor(21)).toBe('#f5222d')
    expect(errorColor(20)).toBe('#faad14')
    expect(errorColor(6)).toBe('#faad14')
    expect(errorColor(5)).toBe('#52c41a')
    expect(errorColor(0)).toBe('#52c41a')
  })

  it('thresholdOf：未填/非法按 100，否则取 0~100 整数', () => {
    expect(thresholdOf('')).toBe(100)
    expect(thresholdOf(null as unknown as string)).toBe(100)
    expect(thresholdOf('abc')).toBe(100)
    expect(thresholdOf(80)).toBe(80)
    expect(thresholdOf(80.9)).toBe(80)
    expect(thresholdOf(150)).toBe(100)
    expect(thresholdOf(-5)).toBe(0)
  })

  it('rateActiveOf：空/未定义 = 未开启；0 也算开启（0 是合法阈值）', () => {
    expect(rateActiveOf('')).toBe(false)
    expect(rateActiveOf(undefined as unknown as string)).toBe(false)
    expect(rateActiveOf(0)).toBe(true)
    expect(rateActiveOf(100)).toBe(true)
  })

  it('alertRowsOf 只收「有 ERROR 且错误率 ≥ 阈值」的分组', () => {
    const rows = [
      { sourceId: 'a', configId: null, cnt: 10, errorCnt: 10, errorRate: 100 },
      { sourceId: 'b', configId: null, cnt: 10, errorCnt: 5, errorRate: 50 },
      { sourceId: 'c', configId: null, cnt: 10, errorCnt: 0, errorRate: 0 },
    ] as StatRow[]
    expect(alertRowsOf(rows, 100).map((r) => r.sourceId)).toEqual(['a'])
    expect(alertRowsOf(rows, 50).map((r) => r.sourceId)).toEqual(['a', 'b'])
    // 0% 的分组即使阈值是 0 也不进（必须有 ERROR 才算重点关注）
    expect(alertRowsOf(rows, 0).map((r) => r.sourceId)).toEqual(['a', 'b'])
  })

  it('filteredRowsOf：未开启原样返回；开启后按错误率降序、其次任务数降序', () => {
    const rows = [
      { sourceId: 'a', configId: null, cnt: 100, errorCnt: 100, errorRate: 100 },
      { sourceId: 'b', configId: null, cnt: 200, errorCnt: 200, errorRate: 100 },
      { sourceId: 'c', configId: null, cnt: 300, errorCnt: 90, errorRate: 30 },
    ] as StatRow[]
    expect(filteredRowsOf(rows, '')).toBe(rows)
    expect(filteredRowsOf(rows, 100).map((r) => r.sourceId)).toEqual(['b', 'a'])
  })
})

describe('stat · 图形数据整形', () => {
  it('pieSlices：关键状态 + 其他，占比分母取切片总和，过滤 0 值并按数量降序', () => {
    const slices = pieSlices({ E: 100, C: 700, AC: 200, W1: 0, W: 0, L: 0 }, 1090)
    expect(slices.map((s) => s.label)).toEqual(['C COMPLETE', 'AC 自动完成', 'E ERROR', '其他'])
    expect(slices.map((s) => s.value)).toEqual([700, 200, 100, 90])
    expect(slices.reduce((sum, s) => Math.round(sum + s.percent * 10000), 0)).toBe(10000)
  })

  it('pieSlices：关键状态合计已超过总数时「其他」不出现（不出现负数切片）', () => {
    const slices = pieSlices({ E: 100, C: 1000 }, 500)
    expect(slices.some((s) => s.label === '其他')).toBe(false)
    expect(slices.reduce((sum, s) => Math.round(sum + s.percent * 10000), 0)).toBe(10000)
  })

  it('pieSlices：全 0 时返回空数组（页面据此显示空态）', () => {
    expect(pieSlices({ E: 0, C: 0 }, 0)).toEqual([])
  })

  it('PIE_STATES 是环图单列的状态（顺序与旧页一致）', () => {
    expect(PIE_STATES).toEqual(['E', 'C', 'AC', 'W1', 'W', 'L'])
  })

  it('topBarData 直接取前 10（不排序）；errorBarData 先按 ERROR 降序再取前 10 且排除 0', () => {
    const rows: StatRow[] = Array.from({ length: 12 }, (_, i) => ({
      sourceId: `s${i}`,
      configId: null,
      cnt: 100 - i,
      errorCnt: i,
      errorRate: i,
    }))
    expect(topBarData(rows, 'source')).toHaveLength(10)
    expect(topBarData(rows, 'source')[0].label).toBe('源#s0')
    const errors = errorBarData(rows, 'source')
    expect(errors[0]).toEqual({ label: '源#s11', value: 11 })
    expect(errors.some((i) => i.value === 0)).toBe(false)
  })
})

describe('stat · 时间口径（旧页用 moment，这里用原生 Date 复刻）', () => {
  it('格式化：日期 / 日期时间 / MM-DD / 文件名标签', () => {
    const d = new Date(2026, 9, 3, 8, 5, 6)
    expect(fmtDate(d)).toBe('2026-10-03')
    expect(fmtDateTime(d)).toBe('2026-10-03 08:05:06')
    expect(fmtMonthDay(d)).toBe('10-03')
    expect(fmtDateTag(d)).toBe('20261003')
    expect(fmtTimeTag(d)).toBe('080506')
  })

  it('clampRange30：≤30 天原样返回；超出时结束时间截断到「开始日 +29 天 23:59:59」', () => {
    expect(clampRange30('2026-10-01 00:00:00', '2026-10-30 23:59:59')).toEqual({
      range: ['2026-10-01 00:00:00', '2026-10-30 23:59:59'],
      clamped: false,
    })
    const out = clampRange30('2026-10-01 00:00:00', '2026-12-01 12:00:00')
    expect(out.clamped).toBe(true)
    expect(out.range).toEqual(['2026-10-01 00:00:00', '2026-10-30 23:59:59'])
  })

  it('clampRange30：解不出的字符串原样返回、不截断（不猜）', () => {
    expect(clampRange30('x', '2026-12-01 00:00:00')).toEqual({ range: ['x', '2026-12-01 00:00:00'], clamped: false })
  })

  it('quickRange：今天/昨天给 date，近7天/近30天给范围（含首尾）', () => {
    const today = fmtDate(dayStart())
    expect(quickRange('today').date).toBe(today)
    const y = new Date(dayStart().getTime() - 86_400_000)
    expect(quickRange('yesterday').date).toBe(fmtDate(y))
    const w = quickRange('7d').range!
    expect(w[1].slice(0, 10)).toBe(today)
    expect(w[1].endsWith('23:59:59')).toBe(true)
    expect(w[0].endsWith('00:00:00')).toBe(true)
    // 含首尾共 7 天：从「今天 -6 天」的 0 点起
    expect(w[0].slice(0, 10)).toBe(fmtDate(new Date(dayStart().getTime() - 6 * 86_400_000)))
    expect(quickRange('30d').range![0].slice(0, 10)).toBe(fmtDate(new Date(dayStart().getTime() - 29 * 86_400_000)))
  })

  it('toNum：null/undefined 一律 0（后端的 cnt 可能是 null）', () => {
    expect(toNum(null)).toBe(0)
    expect(toNum(undefined)).toBe(0)
    expect(toNum('12')).toBe(12)
    expect(toNum(0)).toBe(0)
  })

  it('toNum：解不出来的串/非有限值也折成 0（避免 NaN 渗透成「NaN%」与非法 percentage）', () => {
    expect(toNum('null')).toBe(0)
    expect(toNum('--')).toBe(0)
    expect(toNum(Number.NaN)).toBe(0)
    expect(toNum(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
