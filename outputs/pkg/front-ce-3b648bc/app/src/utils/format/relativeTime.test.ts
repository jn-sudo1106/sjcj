import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { timeAgo } from './relativeTime'

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-07T12:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('空值给「—」', () => {
    expect(timeAgo(undefined)).toBe('—')
    expect(timeAgo(null)).toBe('—')
    expect(timeAgo('')).toBe('—')
  })

  it('后端空格分隔时间戳按天数给「N 天前」', () => {
    expect(timeAgo('2026-08-26 12:00:00')).toBe('12 天前')
    expect(timeAgo('2026-08-31 10:22:31')).toBe('7 天前')
  })

  it('分钟 / 小时 / 月 / 年 粒度', () => {
    expect(timeAgo('2026-09-07 11:30:00')).toBe('30 分钟前')
    expect(timeAgo('2026-09-07 06:00:00')).toBe('6 小时前')
    expect(timeAgo('2026-06-07 12:00:00')).toBe('3 个月前')
    expect(timeAgo('2024-09-07 12:00:00')).toBe('2 年前')
  })

  it('刚刚 / 未来时间 / 非法值', () => {
    expect(timeAgo('2026-09-07 11:59:30')).toBe('刚刚')
    expect(timeAgo('2027-01-01 00:00:00')).toBe('2027-01-01 00:00:00')
    expect(timeAgo('not-a-date')).toBe('not-a-date')
  })
})
