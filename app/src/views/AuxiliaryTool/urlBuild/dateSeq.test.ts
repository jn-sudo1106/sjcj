// 时间序列生成回归 —— 这段是拿 moment 的行为手写复刻的（新项目没有 moment/dayjs），
// 最容易出错的是三件事：月初/月末取值、月份推进的月末收敛、以及纯日期串被 UTC 解析导致的错位。
import { describe, expect, it } from 'vitest'
import { addUnit, buildIntSeq, buildTimeSeq, diffUnit, formatDate, parseDate } from './dateSeq'

describe('parseDate / formatDate', () => {
  it('纯日期串按本地时间解析，不会被 UTC 挪一天', () => {
    expect(formatDate(parseDate('2026-01-01'), 'YYYY-MM-DD')).toBe('2026-01-01')
    expect(formatDate(parseDate('2026-12-31'), 'YYYY-MM-DD')).toBe('2026-12-31')
  })

  it('支持 moment 的 token 子集', () => {
    const date = new Date(2026, 0, 5, 8, 9, 7)
    expect(formatDate(date, 'YYYY/MM/DD')).toBe('2026/01/05')
    expect(formatDate(date, 'YY-M-D H:m:s')).toBe('26-1-5 8:9:7')
    expect(formatDate(date, 'HH:mm:ss')).toBe('08:09:07')
  })

  it('解析不出来给空串，不抛错', () => {
    expect(formatDate(parseDate(''), 'YYYY-MM-DD')).toBe('')
    expect(buildTimeSeq({ start: '', end: '2026-01-01', step: 1, unit: 'days' })).toEqual([])
  })
})

describe('addUnit / diffUnit', () => {
  it('按月推进时对月末做收敛（1-31 + 1 月 = 2-28）', () => {
    expect(formatDate(addUnit(parseDate('2026-01-31'), 1, 'months'), 'YYYY-MM-DD')).toBe('2026-02-28')
    expect(formatDate(addUnit(parseDate('2026-01-31'), 2, 'months'), 'YYYY-MM-DD')).toBe('2026-03-31')
  })

  it('diffUnit 与 moment.diff(end, unit) 同符号：起点早于终点为负', () => {
    expect(diffUnit(parseDate('2026-01-01'), parseDate('2026-01-05'), 'days')).toBe(-4)
    expect(diffUnit(parseDate('2026-01-01'), parseDate('2026-04-01'), 'months')).toBe(-3)
    expect(diffUnit(parseDate('2026-04-01'), parseDate('2026-01-01'), 'months')).toBe(3)
  })
})

describe('buildTimeSeq', () => {
  const base = { start: '2026-01-15', end: '2026-04-15', step: 1, unit: 'months' as const }

  it('月初 / 月末 / 月初~月末 / 每月固定日', () => {
    expect(buildTimeSeq({ ...base, mode: 1 })).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ])
    expect(buildTimeSeq({ ...base, mode: 2 })).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
    expect(buildTimeSeq({ ...base, mode: 3 })).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ])
    expect(buildTimeSeq({ ...base, mode: 4 })[0]).toBe('2026-01-01 , 2026-01-31')
  })

  it('按日推进时按 step 跳，且不受 mode 影响', () => {
    expect(
      buildTimeSeq({ start: '2026-01-01', end: '2026-01-05', step: 2, unit: 'days', mode: 2 }),
    ).toEqual(['2026-01-01', '2026-01-03', '2026-01-05'])
  })

  it('自定义输出格式生效', () => {
    expect(
      buildTimeSeq({ start: '2026-01-01', end: '2026-02-01', step: 1, unit: 'months', mode: 1, format: 'YYYY/MM' }),
    ).toEqual(['2026/01', '2026/02'])
  })
})

describe('buildIntSeq', () => {
  it('闭区间 + 步长（旧 buildSeq）', () => {
    expect(buildIntSeq(1, 5, 1)).toEqual([1, 2, 3, 4, 5])
    expect(buildIntSeq('1', '2', '0.5')).toEqual([1, 1.5, 2])
  })

  it('步长非正数 / 非数字 → 空数组（旧版会死循环）', () => {
    expect(buildIntSeq(1, 5, 0)).toEqual([])
    expect(buildIntSeq('a', 'b', 1)).toEqual([])
  })
})
