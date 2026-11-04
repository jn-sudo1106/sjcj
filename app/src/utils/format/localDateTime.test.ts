import { describe, expect, it } from 'vitest'

import { localDateTime } from './localDateTime'

describe('localDateTime', () => {
  it('服务端 yyyy-MM-dd HH:mm:ss 原样展示，不做时区换算', () => {
    expect(localDateTime('2026-11-03 10:00:00')).toBe('2026-11-03 10:00:00')
    expect(localDateTime(' 2026-11-03 10:00:00 ')).toBe('2026-11-03 10:00:00')
  })

  it('带时区的 ISO 串按浏览器本地时间格式化', () => {
    const iso = '2026-11-03T02:00:00Z'
    const shown = localDateTime(iso)
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    const expected = new Date(iso)
    const pad = (value: number) => String(value).padStart(2, '0')
    expect(shown).toBe(
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())} `
      + `${pad(expected.getHours())}:${pad(expected.getMinutes())}:${pad(expected.getSeconds())}`,
    )
  })

  it('空值显示占位符，无法解析的值原样返回', () => {
    expect(localDateTime()).toBe('—')
    expect(localDateTime('')).toBe('—')
    expect(localDateTime('暂未处理')).toBe('暂未处理')
  })
})