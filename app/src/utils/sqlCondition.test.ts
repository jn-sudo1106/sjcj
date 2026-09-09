import { describe, expect, it } from 'vitest'
import { stripTrailingSemicolon } from './sqlCondition'

describe('stripTrailingSemicolon', () => {
  it('去掉末尾分号——从数据库客户端复制来的语句常带着它，拼进 WHERE 片段就是语法错误', () => {
    expect(stripTrailingSemicolon("k2 NOT LIKE '%weixin%';")).toBe("k2 NOT LIKE '%weixin%'")
  })

  it('分号前后的空白、以及连着的多个分号一并削掉', () => {
    expect(stripTrailingSemicolon('K1 IS NULL  ;  ')).toBe('K1 IS NULL')
    expect(stripTrailingSemicolon('K1 IS NULL;;')).toBe('K1 IS NULL')
    expect(stripTrailingSemicolon('K1 IS NULL ; ; ')).toBe('K1 IS NULL')
  })

  it('字符串字面量里的分号原样保留——只削末尾，不做全局替换', () => {
    expect(stripTrailingSemicolon("K2 LIKE '%;%'")).toBe("K2 LIKE '%;%'")
    expect(stripTrailingSemicolon("K2 LIKE '%;%';")).toBe("K2 LIKE '%;%'")
    expect(stripTrailingSemicolon("K1 = 'a;b' AND K2 = 'c;d'")).toBe("K1 = 'a;b' AND K2 = 'c;d'")
  })

  it('没有分号时不动（含空字符串），末尾空白不误删', () => {
    expect(stripTrailingSemicolon('K1 IS NULL')).toBe('K1 IS NULL')
    expect(stripTrailingSemicolon('')).toBe('')
    expect(stripTrailingSemicolon('K1 IS NULL  ')).toBe('K1 IS NULL  ')
  })

  it('用户实际报的那条多行条件：只削尾分号，SUBSTRING_INDEX 里的括号与引号不受影响', () => {
    const sql = [
      "SOURCE_ID IN (SELECT DISTINCT SOURCE_ID FROM sense_db.cs_source WHERE category_id = '9009349')",
      "AND k24 !=''",
      'AND k17 <> 2',
      "AND k2 NOT LIKE '%weixin%'",
      "AND LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(TRIM(k6), '/', -1), '.', 1)) <> LOWER(TRIM(k23));",
    ].join('\n')
    const out = stripTrailingSemicolon(sql)
    expect(out.endsWith('LOWER(TRIM(k23))')).toBe(true)
    expect(out).toContain("'%weixin%'")
    expect(out).toContain("'/', -1")
  })
})
