import { describe, expect, it } from 'vitest'
import { mockCkSourceList, mockCkSourceInsert, mockCkSourceUpdate } from './monitor'

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
})
