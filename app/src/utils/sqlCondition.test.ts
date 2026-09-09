// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { stripTrailingSemicolon } from './sqlCondition'
import { readSqlConditions, rememberSqlCondition } from './sqlConditionHistory'

afterEach(() => localStorage.clear())

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

// 2026-09-09：历史记录会被原样回填到查询框，存脏的等于把带分号的条件反复喂回来。
// 放在这里而不是 sqlConditionHistory.test.ts：那边与 components/SqlConditionEditor.test.ts
// 共用 jsdom 环境，多加用例会扰动那个组件用例的时序把它跑挂（实测）。这几条本就是在验
// stripTrailingSemicolon 落到历史记录上的效果，跟本文件同属一个主题。
describe('SQL 历史记录去掉末尾分号', () => {
  it('存进去时就削掉，读出来是可以直接用的条件', () => {
    rememberSqlCondition('sc-900', "K2 NOT LIKE '%weixin%';")
    expect(readSqlConditions('sc-900')).toEqual(["K2 NOT LIKE '%weixin%'"])
  })

  it('带分号与不带分号视为同一条，不会在列表里占两格', () => {
    rememberSqlCondition('sc-901', 'K1 IS NULL')
    rememberSqlCondition('sc-901', 'K1 IS NULL;')
    expect(readSqlConditions('sc-901')).toEqual(['K1 IS NULL'])
  })

  it('字符串字面量里的分号不受影响', () => {
    rememberSqlCondition('sc-902', "K2 LIKE '%;%'")
    expect(readSqlConditions('sc-902')).toEqual(["K2 LIKE '%;%'"])
  })
})
