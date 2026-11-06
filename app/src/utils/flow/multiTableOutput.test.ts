import { describe, expect, it } from 'vitest'
import { columnCodeOf, outputModeOf, readOutputTableConfig, subTableOf, withSubTable, writeOutputTableConfig } from './multiTableOutput'

describe('多表输出旧协议', () => {
  it('空配置可开始编辑，AUTO、非法 JSON 和未知结构保留为高级配置', () => {
    expect(readOutputTableConfig('')).toEqual({ config: {} })
    for (const text of ['AUTO', '{', '[]', '{"table":{"entryTypeId":900}}']) {
      expect(readOutputTableConfig(text).error).toContain('原内容已保留')
    }
  })

  it('可视化写入保留高级属性、映射扩展和更深层子表，不修改原对象', () => {
    const config = {
      globals: ['10'], once: ['20'], clearRules: { '10': 'trim' }, unknown: { keep: true },
      table: { entryTypeId: 900, keys: ['news'], colMap: [{ colId: '100', fromId: 'title', minRow: 2 }], subs: [
        { entryTypeId: 901, keys: ['files'], colMap: [], subs: [{ entryTypeId: 902, keys: ['more'], colMap: [] }] },
      ] },
    }
    const before = JSON.stringify(config)
    const read = readOutputTableConfig(before).config!
    const text = writeOutputTableConfig(read, { ...read.table!, keys: ['updated'] })
    expect(JSON.parse(text)).toEqual({ ...config, checkIds: [], table: { ...config.table, keys: ['updated'] } })
    expect(JSON.stringify(config)).toBe(before)
  })
})

describe('单表/多表模式判定（1106 W5）', () => {
  const base = { keys: ['news'], colMap: [] }
  it('无 subs = 单表；1 张 = 多表；≥2 张或含嵌套 = 超限只读', () => {
    expect(outputModeOf('')).toBe('single')
    expect(outputModeOf(JSON.stringify({ table: { entryTypeId: 900, ...base } }))).toBe('single')
    expect(outputModeOf(JSON.stringify({ table: { entryTypeId: 900, ...base, subs: [{ entryTypeId: 901, ...base }] } }))).toBe('multi')
    expect(outputModeOf(JSON.stringify({ table: { entryTypeId: 900, ...base, subs: [{ entryTypeId: 901, ...base }, { entryTypeId: 902, ...base }] } }))).toBe('overflow')
    expect(outputModeOf(JSON.stringify({ table: { entryTypeId: 900, ...base, subs: [{ entryTypeId: 901, ...base, subs: [{ entryTypeId: 902, ...base }] }] } }))).toBe('overflow')
    expect(outputModeOf('AUTO')).toBe('single')
  })

  it('subTableOf 只认「恰好 1 张」；withSubTable 增删副表时保留主表与未知属性', () => {
    const config = { globals: ['10'], unknown: { keep: true }, table: { entryTypeId: 900, ...base } }
    expect(subTableOf(config)).toBeUndefined()
    const text = withSubTable(config, { entryTypeId: 901, keys: ['files'], colMap: [] })
    const parsed = JSON.parse(text)
    expect(parsed).toMatchObject({ globals: ['10'], unknown: { keep: true }, table: { entryTypeId: 900, keys: ['news'], subs: [{ entryTypeId: 901 }] } })
    expect(subTableOf(JSON.parse(text))?.entryTypeId).toBe(901)
    const removed = JSON.parse(withSubTable(JSON.parse(text), undefined))
    expect(removed.table.subs).toBeUndefined()
    expect(removed.table.entryTypeId).toBe(900)
    expect(removed.unknown).toEqual({ keep: true })
  })

  it('columnCodeOf 优先 columnName，其次取 prop 的 -K<n> 后缀', () => {
    expect(columnCodeOf({ columnName: 'K2', prop: 'title-K1' })).toBe('K2')
    expect(columnCodeOf({ prop: 'feed_id-K3' })).toBe('K3')
    expect(columnCodeOf({ prop: 'title' })).toBe('')
  })
})
