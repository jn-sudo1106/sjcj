// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSqlConditions, readSqlConditions, rememberSqlCondition } from './sqlConditionHistory'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('最近 SQL 条件', () => {
  it('按表持久化，最多十条；重复置顶，保留换行和字符串内空格', () => {
    for (let i = 0; i < 12; i++) rememberSqlCondition('900', `K1 = ${i}`)
    expect(readSqlConditions('900')).toHaveLength(10)
    expect(readSqlConditions('900')).not.toContain('K1 = 1')
    rememberSqlCondition('900', ' K1 = 5 ')
    expect(readSqlConditions('900')[0]).toBe('K1 = 5')
    expect(readSqlConditions('900').filter((sql) => sql === 'K1 = 5')).toHaveLength(1)
    const multiline = "K1 = 'a  b'\nAND K2 IS NULL"
    rememberSqlCondition('901', multiline)
    expect(readSqlConditions('901')).toEqual([multiline])
    clearSqlConditions('900')
    expect(readSqlConditions('900')).toEqual([])
    expect(readSqlConditions('901')).toEqual([multiline])
  })

  it('空表和空条件不保存，损坏或非数组存储按空列表处理', () => {
    rememberSqlCondition('', 'K1 = 1')
    rememberSqlCondition('900', '  ')
    expect(localStorage.length).toBe(0)
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValueOnce('{broken').mockReturnValueOnce('{}')
    expect(readSqlConditions('900')).toEqual([])
    expect(readSqlConditions('900')).toEqual([])
  })

  it('浏览器禁用存储或容量不足，不阻断查询和编辑', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('storage disabled') })
    }
    expect(readSqlConditions('900')).toEqual([])
    expect(() => rememberSqlCondition('900', 'K1 = 1')).not.toThrow()
    expect(() => clearSqlConditions('900')).not.toThrow()
  })
})
