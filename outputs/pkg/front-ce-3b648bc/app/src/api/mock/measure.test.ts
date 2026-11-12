// 指标定义 mock 的读/写路径 —— 筛选口径（datasetId / sourceId / measureCode / enable→isDelete）、
// 表头排序（sortField + sortOrder='ascend'|'descend'）与 6 个写操作的内存表变更必须和后端契约一致，
// 否则本地 mock 演示会出现「点了表头箭头，数据顺序没变」「点了删除，刷新还在」这类假象。
//
// ⚠️ 写操作用例会**真的改内存表**（模块级 MEASURES），所以这里按「先读后写」的顺序组织，
// 且每个写用例只断言自己那一条记录的最终状态，不依赖内存表的绝对条数。
import { describe, expect, it } from 'vitest'
import {
  mockMeasureAdd,
  mockMeasureChangeEnable,
  mockMeasureCopy,
  mockMeasureDelete,
  mockMeasureDeletePhy,
  mockMeasureGenFromSource,
  mockMeasurePaged,
  mockMeasureUpdate,
} from './measure'
import { mockRegistry } from '../mock'

const rowOf = (measureId: number | string) =>
  mockMeasurePaged({ limit: 500 }).list.find((m) => String(m.measureId) === String(measureId))

describe('measure mock：分页与筛选', () => {
  it('默认按内存表原顺序返回全部', () => {
    const res = mockMeasurePaged({ page: 1, limit: 500 })
    expect(res.total).toBeGreaterThanOrEqual(12)
    expect(res.list[0].measureId).toBe(20001)
  })

  it('分页切片按 page/limit（旧 s-table 的 pageNo/pageSize 已在 api 层改名）', () => {
    const first = mockMeasurePaged({ page: 1, limit: 3 })
    const second = mockMeasurePaged({ page: 2, limit: 3 })
    expect(first.list).toHaveLength(3)
    expect(second.list[0].measureId).not.toBe(first.list[0].measureId)
  })

  it('enable 与 isDelete 同向：0=在用 / 1=停用 / -1=历史删除的 / 空=全部', () => {
    const all = mockMeasurePaged({ limit: 500 }).total
    const on = mockMeasurePaged({ enable: '0', limit: 500 }).total
    const off = mockMeasurePaged({ enable: '1', limit: 500 }).total
    const gone = mockMeasurePaged({ enable: '-1', limit: 500 }).total
    expect(on).toBeGreaterThan(0)
    expect(off).toBeGreaterThan(0)
    expect(gone).toBeGreaterThan(0)
    expect(on + off + gone).toBe(all)
    // 停用与在用互斥：20010 是停用（isDelete=1），20001 是在用（isDelete=0）
    const offIds = mockMeasurePaged({ enable: '1', limit: 500 }).list.map((m) => String(m.measureId))
    expect(offIds).toContain('20010')
    expect(offIds).not.toContain('20001')
  })

  it('datasetId / sourceId / measureCode 都是包含匹配（旧页四个筛选框的口径）', () => {
    expect(mockMeasurePaged({ datasetId: '1001', limit: 500 }).list.every((m) => String(m.datasetId) === '1001')).toBe(true)
    expect(mockMeasurePaged({ sourceId: '161725', limit: 500 }).list.every((m) => String(m.sourceId) === '161725')).toBe(true)
    const codes = mockMeasurePaged({ measureCode: 'A000', limit: 500 }).list.map((m) => String(m.measureCode))
    expect(codes.length).toBeGreaterThan(0)
    expect(codes.every((c) => c.includes('A000'))).toBe(true)
  })
})

describe('measure mock：表头排序', () => {
  it('measureId 支持 ascend / descend（列定义里只有这一列带 sorter）', () => {
    const asc = mockMeasurePaged({ sortField: 'measureId', sortOrder: 'ascend', limit: 500 }).list
    const desc = mockMeasurePaged({ sortField: 'measureId', sortOrder: 'descend', limit: 500 }).list
    expect(Number(asc[0].measureId)).toBeLessThan(Number(asc[asc.length - 1].measureId))
    expect(Number(desc[0].measureId)).toBeGreaterThan(Number(desc[desc.length - 1].measureId))
  })

  it('不认识的排序字段 / 方向一律忽略，保持内存表顺序', () => {
    const plain = mockMeasurePaged({ limit: 500 }).list.map((m) => m.measureId)
    const dirty = mockMeasurePaged({ sortField: 'measureName', sortOrder: 'ascend', limit: 500 }).list.map((m) => m.measureId)
    expect(dirty).toEqual(plain)
    const noDir = mockMeasurePaged({ sortField: 'measureId', sortOrder: 'x', limit: 500 }).list.map((m) => m.measureId)
    expect(noDir).toEqual(plain)
  })

  it('排序发生在 filter 出来的新数组上，不动内存表本身的顺序', () => {
    mockMeasurePaged({ sortField: 'measureId', sortOrder: 'descend', limit: 500 })
    expect(mockMeasurePaged({ page: 1, limit: 500 }).list[0].measureId).toBe(20001)
  })
})

describe('measure mock：写操作', () => {
  it('新增：落到内存表最前面，ID 自增，isDelete 归 0', () => {
    const before = mockMeasurePaged({ limit: 500 }).total
    const res = mockMeasureAdd({ measureCode: 'NEW001', measureName: '新指标', datasetId: 1001 }) as { id: number }
    expect(mockMeasurePaged({ limit: 500 }).total).toBe(before + 1)
    const row = rowOf(res.id)
    expect(row).toMatchObject({ measureCode: 'NEW001', measureName: '新指标', isDelete: 0 })
  })

  it('修改：只覆盖传了的字段，其余保持', () => {
    mockMeasureUpdate({ measureId: 20006, measureName: '成交量分钟聚合-改', unitDef: '{"nvl":"股"}' })
    const row = rowOf(20006)
    expect(row?.measureName).toBe('成交量分钟聚合-改')
    expect(row?.unitDef).toBe('{"nvl":"股"}')
    // 没传的字段保持原值
    expect(String(row?.measureCode)).toBe('D00041')
  })

  it('启停：enable=0 → isDelete 0；enable=1 → isDelete 1（同向，不是反的）', () => {
    mockMeasureChangeEnable({ ids: '20001,20002', enable: 1 })
    expect(Number(rowOf(20001)?.isDelete)).toBe(1)
    mockMeasureChangeEnable({ ids: '20001', enable: 0 })
    expect(Number(rowOf(20001)?.isDelete)).toBe(0)
  })

  it('复制：新 ID + 编码加 -C + 名称加 -副本，原记录不动', () => {
    const src = rowOf(20005)
    const res = mockMeasureCopy({ id: 20005 }) as { id: number; msg: string }
    const copy = rowOf(res.id)
    expect(copy).toBeTruthy()
    expect(copy?.measureCode).toBe(`${String(src?.measureCode)}-C`)
    expect(copy?.measureName).toBe(`${String(src?.measureName)}-副本`)
    expect(Number(copy?.isDelete)).toBe(0)
    // 原记录不动
    expect(rowOf(20005)?.measureCode).toBe(src?.measureCode)
  })

  it('删除：按 ids 物理移除（真实后端可能是逻辑删除，见文件头说明）', () => {
    const before = mockMeasurePaged({ limit: 500 }).total
    mockMeasureDelete({ ids: '20003' })
    expect(mockMeasurePaged({ limit: 500 }).total).toBe(before - 1)
    expect(rowOf(20003)).toBeUndefined()
  })

  it('物理删除：单个 id，找不到时返回 ok:false 而不是静默成功', () => {
    const total = mockMeasurePaged({ limit: 500 }).total
    const miss = mockMeasureDeletePhy({ id: 999999 }) as { ok: boolean }
    expect(miss.ok).toBe(false)
    expect(mockMeasurePaged({ limit: 500 }).total).toBe(total)
    const hit = mockMeasureDeletePhy({ id: 20008 }) as { ok: boolean }
    expect(hit.ok).toBe(true)
    expect(rowOf(20008)).toBeUndefined()
  })

  it('由源生成：落到内存表，sourceId 用传进来的值', () => {
    const res = mockMeasureGenFromSource({ sourceId: '161900', entryTypeId: '1004' }) as { id: number }
    expect(String(rowOf(res.id)?.sourceId)).toBe('161900')
  })
})

describe('measure mock：登记在契约清单里', () => {
  it('8 条端点都有专属 handler（endpoints.test 的 impl 一致性靠这里兜底）', () => {
    for (const path of [
      'measure/measurePaged', 'measure/add', 'measure/update', 'measure/delete',
      'measure/deleteMeasurePhy', 'measure/changeEnable', 'measure/copy', 'measure/genMeasureFromSource',
    ]) {
      expect(typeof mockRegistry[path], `${path} 缺 mock handler`).toBe('function')
    }
  })
})
