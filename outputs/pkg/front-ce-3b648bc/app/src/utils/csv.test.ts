import { describe, expect, it } from 'vitest'
import { csvCell, csvDateTag, toCsv } from './csv'

describe('csvCell', () => {
  it('含逗号/引号/换行时加引号，内部引号翻倍', () => {
    expect(csvCell('普通')).toBe('普通')
    expect(csvCell('含,逗号')).toBe('"含,逗号"')
    expect(csvCell('含"引号')).toBe('"含""引号"')
    expect(csvCell('含\n换行')).toBe('"含\n换行"')
  })

  it('空值导成空字符串，不写出 null/undefined 字样', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(0)).toBe('0')
  })

  // 源名称是用户可改的自由文本，一个叫 `=cmd|...` 的源就能让打开这份表的人中招
  it('以 = + - @ 开头的值前面补单引号，防 Excel 当公式执行', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+86')).toBe("'+86")
    expect(csvCell('-x')).toBe("'-x")
    expect(csvCell('@x')).toBe("'@x")
    // 补完之后若还含逗号，照常加引号
    expect(csvCell('=a,b')).toBe('"\'=a,b"')
  })
})

describe('toCsv', () => {
  it('带 BOM 与 CRLF——少了 BOM，Excel 按本地编码打开会让中文列名乱码', () => {
    const csv = toCsv(['源 ID', '源名称'], [['430016589', '传智教育']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toBe('﻿源 ID,源名称\r\n430016589,传智教育')
  })

  it('没有数据行时只输出表头', () => {
    expect(toCsv(['a', 'b'], [])).toBe('﻿a,b')
  })
})

describe('csvDateTag', () => {
  it('补零到 8 位', () => {
    expect(csvDateTag(new Date(2026, 8, 1))).toBe('20260901')
    expect(csvDateTag(new Date(2026, 11, 25))).toBe('20261225')
  })
})
