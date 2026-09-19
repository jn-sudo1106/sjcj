import { describe, expect, it } from 'vitest'
import { mockCkSourceList, mockCkSourcePage, mockCkSourceInsert, mockCkSourceUpdate } from './monitor'

// ck_source mock 的往返语义要和 syncMonitorCkSource 的调用序列一致：
// list 按 sourceId 查存在性 → 无则 insert（回自增 id）→ 有则 update（null 字段保留原列值）。
describe('ck_source 监控源配置 mock（数据监控节点保存同步）', () => {
  it('list 按 sourceId 过滤：没有记录返回空数组（走 insert 分支）', () => {
    expect(mockCkSourceList({ sourceId: '404' })).toEqual([])
  })

  it('insert 返回自增主键，之后 list 能查到', () => {
    const id = mockCkSourceInsert({ sourceId: 9009, name: '数据监控', schedule: '0 * * * *', tableName: 't_monitor', checkConf: '{}', state: 'E' })
    expect(typeof id).toBe('number')
    const rows = mockCkSourceList({ sourceId: '9009' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(id)
    expect(rows[0].name).toBe('数据监控')
  })

  it('update 命中 sourceId 才返回 true，且未传字段保留旧值（后端 null 列保留语义）', () => {
    mockCkSourceInsert({ sourceId: 9010, name: '旧名', schedule: '*/5 * * * *', tableName: 't_old', checkConf: '{"v":1}', state: 'E' })
    const hit = mockCkSourceUpdate({ sourceId: 9010, name: '新名' })
    expect(hit).toBe(true)
    const rows = mockCkSourceList({ sourceId: '9010' })
    expect(rows[0].name).toBe('新名')
    expect(rows[0].schedule).toBe('*/5 * * * *') // 未传 → 保留
    expect(rows[0].tableName).toBe('t_old')
    expect(mockCkSourceUpdate({ sourceId: 999999999 })).toBe(false) // 未命中
  })

  it('page 与真实后端同口径：主键倒序、name 筛选、按 pageNum/pageSize 切页', () => {
    mockCkSourceInsert({ sourceId: 9020, name: '日增量监控', checkConf: '{}', state: 'E' })
    mockCkSourceInsert({ sourceId: 9021, name: '日达标监控', checkConf: '{}', state: 'E' })
    mockCkSourceInsert({ sourceId: 9022, name: '月报监控', checkConf: '{}', state: 'E' })

    const first = mockCkSourcePage({ pageNum: 1, pageSize: 2 })
    expect(first.total).toBeGreaterThanOrEqual(3)
    expect(first.pageNum).toBe(1)
    expect(first.list).toHaveLength(2)
    // 主键倒序：id 大的排前面
    expect(first.list[0].id).toBeGreaterThan(first.list[1].id)

    const filtered = mockCkSourcePage({ pageNum: 1, pageSize: 10, name: '日增' })
    expect(filtered.list.every((row) => row.name?.includes('日增'))).toBe(true)

    // sourceId 筛选与空结果
    const bySource = mockCkSourcePage({ pageNum: 1, pageSize: 10, sourceId: '9021' })
    expect(bySource.list.every((row) => String(row.sourceId) === '9021')).toBe(true)
    const empty = mockCkSourcePage({ pageNum: 1, pageSize: 10, sourceId: '999999999' })
    expect(empty.total).toBe(0)
    expect(empty.pages).toBe(0)
    expect(empty.list).toEqual([])
  })
})
