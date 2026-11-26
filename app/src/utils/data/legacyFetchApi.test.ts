import { describe, expect, it } from 'vitest'
import { buildQueryServiceMore } from '@/api'
import { buildQueryServiceUrl } from './legacyFetchApi'

const env = { restBase: 'http://h/rest/', appId: 'dev', appKey: 'dev1' }

// 2026-11-26「条件没带到 api 里面」：取数 API 要和表格查询是同一批数据（186 实测 qs 认 more）
describe('取数 API 按条件分页查询', () => {
  it('SQL 条件进 more，去掉末尾分号（qs 对分号报非法注入）', () => {
    expect(buildQueryServiceMore({ sql: "K11 = '1';" })).toBe("K11 = '1'")
  })

  it('状态 / ID 折进 more，SQL 加括号隔开 OR', () => {
    expect(buildQueryServiceMore({ state: 'C,AC', dataId: '1 2', sql: 'K1=1 OR K2=2' }))
      .toBe("ENTRY_ID in (1,2) AND STATE in ('C','AC') AND (K1=1 OR K2=2)")
  })

  it('无条件时不给条件地址', () => {
    expect(buildQueryServiceMore({})).toBeUndefined()
    expect(buildQueryServiceUrl({ tableId: '2102205', more: undefined }, env)).toBe('')
  })

  it('地址带上编码后的 more 与分页', () => {
    expect(buildQueryServiceUrl({ tableId: '2102205', sourceId: '491000039', more: "K11 = '1'" }, env))
      .toBe("http://h/rest/api/v1/data/qs?appId=dev&appKey=dev1&type=2102205&sourceId=491000039&more=K11%20%3D%20'1'&page=1&size=20")
  })
})
