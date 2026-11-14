import { describe, expect, it } from 'vitest'
import {
  mockCkSourceList,
  mockCkSourcePage,
  mockCkSourceInsert,
  mockCkSourceUpdate,
  mockSourceCheckAdd,
  mockSourceCheckUpdate,
} from './monitor'

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

// source/check/add|update 与画布/源视图同源：都落 CK_SOURCE_STORE（monitor/ckSourceList 读它），
// 否则「画布同步一次、新建一次」会表现为同一源重复建行。
describe('源检查新增/修改 mock（写 CK_SOURCE_STORE）', () => {
  it('新增写入 CK_SOURCE_STORE：ckSourceList 能查到完整行且 id 自增', () => {
    const created = mockSourceCheckAdd({
      sourceId: 9101,
      name: '日增量监控',
      schedule: '0 0 * * * ?',
      tableName: 't_monitor',
      checkConf: '{"v":2}',
    })

    const rows = mockCkSourceList({ sourceId: '9101' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(created.id)
    expect(rows[0]).toMatchObject({
      sourceId: 9101,
      name: '日增量监控',
      schedule: '0 0 * * * ?',
      tableName: 't_monitor',
      checkConf: '{"v":2}',
      state: 'C',
      isDelete: 0,
    })
    // 字段完整：createDt 走 ISO 契约、ver 有初始值
    expect(rows[0].createDt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    expect(rows[0].ver).toBeGreaterThan(0)
  })

  it('新增后再次 update 回写同一条：不新增行，列表仍只有一条且内容更新', () => {
    const created = mockSourceCheckAdd({ sourceId: 9102, name: '旧名' })
    expect(mockCkSourceList({ sourceId: '9102' })).toHaveLength(1)

    expect(mockSourceCheckUpdate({ id: created.id, name: '新名' })).toMatchObject({ ok: true })
    const afterFirst = mockCkSourceList({ sourceId: '9102' })
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0].name).toBe('新名')
    // mockCkSourceList 返回的是内存行引用，先记下版本快照再保存
    const firstVer = afterFirst[0].ver ?? 0

    // 连续保存（画布再次同步）依旧只改同一条，不会多出行
    expect(mockSourceCheckUpdate({ id: created.id, schedule: '*/10 * * * *' })).toMatchObject({ ok: true })
    const afterSecond = mockCkSourceList({ sourceId: '9102' })
    expect(afterSecond).toHaveLength(1)
    expect(afterSecond[0].schedule).toBe('*/10 * * * *')
    expect(afterSecond[0].ver).toBeGreaterThan(firstVer)
  })
})
