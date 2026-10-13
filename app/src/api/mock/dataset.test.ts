// 指标数据集 mock 的读/写路径 —— 筛选口径（datasetId / sourceId / entryTypeId / enable→isDelete）、
// 表头排序（sortField + sortOrder='ascend'|'descend'）与 4 个写操作的内存表变更必须和后端契约一致，
// 否则本地 mock 演示会出现「点了表头箭头，数据顺序没变」「点了删除，刷新还在」这类假象。
//
// ⚠️ 写操作用例会**真的改内存表**（模块级 DATASETS），所以这里按「先读后写」的顺序组织，
// 且每个写用例只断言自己那一条记录的最终状态，不依赖内存表的绝对条数。
import { describe, expect, it } from 'vitest'
import {
  mockDatasetChangeEnable,
  mockDatasetCopy,
  mockDatasetDelete,
  mockDatasetGenFromSource,
  mockDatasetPaged,
  mockDatasetRunNow,
  mockDatasetUpdate,
} from './dataset'
import { mockRegistry } from '../mock'

const rowOf = (datasetId: number | string) =>
  mockDatasetPaged({ limit: 500 }).list.find((r) => String(r.datasetId) === String(datasetId))

describe('dataset mock：分页与筛选', () => {
  it('默认按内存表原顺序返回全部', () => {
    const res = mockDatasetPaged({ page: 1, limit: 500 })
    expect(res.total).toBeGreaterThanOrEqual(11)
    expect(res.list[0].datasetId).toBe(1001)
  })

  it('分页切片按 page/limit（旧 s-table 的 pageNo/pageSize 已在 api 层改名）', () => {
    const first = mockDatasetPaged({ page: 1, limit: 3 })
    const second = mockDatasetPaged({ page: 2, limit: 3 })
    expect(first.list).toHaveLength(3)
    expect(second.list[0].datasetId).not.toBe(first.list[0].datasetId)
  })

  it('enable 与 isDelete 同向：0=在用 / 1=停用 / -1=历史删除的 / 空=全部', () => {
    const all = mockDatasetPaged({ limit: 500 }).total
    const on = mockDatasetPaged({ enable: '0', limit: 500 }).total
    const off = mockDatasetPaged({ enable: '1', limit: 500 }).total
    const gone = mockDatasetPaged({ enable: '-1', limit: 500 }).total
    expect(on + off + gone).toBe(all)
    expect(mockDatasetPaged({ enable: '0', limit: 500 }).list.every((r) => Number(r.isDelete) === 0)).toBe(true)
    expect(mockDatasetPaged({ enable: '1', limit: 500 }).list.every((r) => Number(r.isDelete) === 1)).toBe(true)
    expect(mockDatasetPaged({ enable: '-1', limit: 500 }).list.every((r) => Number(r.isDelete) < 0)).toBe(true)
  })

  it('datasetId / sourceId / entryTypeId 按包含匹配', () => {
    expect(mockDatasetPaged({ datasetId: '1002', limit: 500 }).list.map((r) => r.datasetId)).toEqual([1002])
    expect(mockDatasetPaged({ sourceId: '161725', limit: 500 }).list.every((r) => r.sourceId === 161725)).toBe(true)
    expect(mockDatasetPaged({ entryTypeId: '1009', limit: 500 }).list.map((r) => r.datasetId)).toEqual([1009])
  })

  it('后端不认识的键（entryType / configId）不影响筛选 —— 旧页会把它们透传出去', () => {
    const base = mockDatasetPaged({ limit: 500 }).total
    expect(mockDatasetPaged({ entryType: '999', configId: '70598', limit: 500 }).total).toBe(base)
  })
})

describe('dataset mock：表头排序（服务端口径）', () => {
  it('数值列按数字大小排，不是按字符串（1009 > 1002，字符串比较不会反）', () => {
    const asc = mockDatasetPaged({ sortField: 'datasetId', sortOrder: 'ascend', limit: 500 })
    const ids = asc.list.map((r) => Number(r.datasetId))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(mockDatasetPaged({ sortField: 'datasetId', sortOrder: 'descend', limit: 500 }).list[0].datasetId).toBe(
      Math.max(...ids),
    )
  })

  it('measureCnt / lastId 也走数值排序（空值当 0）', () => {
    const asc = mockDatasetPaged({ sortField: 'measureCnt', sortOrder: 'ascend', limit: 500 })
    const values = asc.list.map((r) => Number(r.measureCnt) || 0)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('lastRun / nextRun 按字符串排，空值恒排最后（不被当成最小冒到前面）', () => {
    const asc = mockDatasetPaged({ sortField: 'lastRun', sortOrder: 'ascend', limit: 500 })
    const filled = asc.list.filter((r) => String(r.lastRun ?? ''))
    const blanks = asc.list.filter((r) => !String(r.lastRun ?? ''))
    expect(blanks.length).toBeGreaterThan(0)
    // 有值的都在无值的之前
    expect(asc.list.indexOf(blanks[0])).toBeGreaterThan(asc.list.indexOf(filled[filled.length - 1]))
    expect(filled.map((r) => String(r.lastRun))).toEqual(
      [...filled.map((r) => String(r.lastRun))].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('未知 sortField 或非法 sortOrder 时忽略排序（脏参数不影响演示）', () => {
    expect(mockDatasetPaged({ sortField: 'datasetName', sortOrder: 'ascend', limit: 500 }).list[0].datasetId).toBe(1001)
    expect(mockDatasetPaged({ sortField: 'datasetId', sortOrder: 'ASC', limit: 500 }).list[0].datasetId).toBe(1001)
    expect(mockDatasetPaged({ sortField: 'datasetId', limit: 500 }).list[0].datasetId).toBe(1001)
  })
})

describe('dataset mock：写操作', () => {
  it('修改只覆盖传了的字段，并刷新 updateDt', () => {
    const before = rowOf(1004)
    expect(before).toBeTruthy()
    const res = mockDatasetUpdate({ datasetId: 1004, datasetName: '行情快照数据集（改名）', schedule: '0 0 4 * * ?' })
    expect((res as { ok: boolean }).ok).toBe(true)
    const after = rowOf(1004)
    expect(after?.datasetName).toBe('行情快照数据集（改名）')
    expect(after?.schedule).toBe('0 0 4 * * ?')
    // 没传的字段不动
    expect(after?.sourceId).toBe(before?.sourceId)
    expect(after?.measureCnt).toBe(before?.measureCnt)
  })

  it('修改不存在的记录返回 ok:false（不抛错）', () => {
    expect((mockDatasetUpdate({ datasetId: 999999 }) as { ok: boolean }).ok).toBe(false)
  })

  it('启停：enable=0 → isDelete=0（在用）；enable=1 → isDelete=1（停用）', () => {
    mockDatasetChangeEnable({ ids: '1006', enable: 1 })
    expect(Number(rowOf(1006)?.isDelete)).toBe(1)
    mockDatasetChangeEnable({ ids: '1006', enable: 0 })
    expect(Number(rowOf(1006)?.isDelete)).toBe(0)
  })

  it('由源快速生成：新增一条数据集（指标数 0 / 状态 W / 在用）', () => {
    const before = mockDatasetPaged({ limit: 500 }).total
    const res = mockDatasetGenFromSource({ sourceId: 161725, entryTypeId: 1001 }) as { id: number }
    const after = mockDatasetPaged({ limit: 500 })
    expect(after.total).toBe(before + 1)
    const created = rowOf(res.id)
    expect(created?.sourceId).toBe(161725)
    expect(created?.entryTypeId).toBe(1001)
    expect(Number(created?.measureCnt)).toBe(0)
    expect(Number(created?.isDelete)).toBe(0)
  })

  it('制作副本：新 ID + 名称带「-副本」，指标数归零（指标挂在原数据集上）', () => {
    const source = rowOf(1004)
    expect(Number(source?.measureCnt)).toBeGreaterThan(0)
    const res = mockDatasetCopy({ id: 1004 }) as { id: number }
    expect(res.id).not.toBe(1004)
    const copy = rowOf(res.id)
    expect(String(copy?.datasetName)).toContain('-副本')
    expect(Number(copy?.measureCnt)).toBe(0)
    // 原记录不动
    expect(Number(rowOf(1004)?.measureCnt)).toBe(Number(source?.measureCnt))
  })

  it('删除：按 ids 物理移除（真实后端可能是逻辑删除，见文件头说明）', () => {
    const before = mockDatasetPaged({ limit: 500 }).total
    mockDatasetDelete({ ids: '1003' })
    expect(mockDatasetPaged({ limit: 500 }).total).toBe(before - 1)
    expect(rowOf(1003)).toBeUndefined()
  })

  it('立即执行：last 传了就是「从指定 ID 开始」，不传 / null 就是「从上次 ID」', () => {
    const fromId = mockDatasetRunNow({ ids: '1001,1002', last: 5000 }) as { message: string }
    expect(fromId.message).toContain('ID 5000')
    const fromLast = mockDatasetRunNow({ ids: '1001,1002', last: null }) as { message: string }
    expect(fromLast.message).toContain('上次 ID')
  })
})

describe('dataset mock：登记在契约清单里', () => {
  it('7 条真实路径都有专属 handler（endpoints.test 的 impl 一致性靠这里兜底）', () => {
    for (const path of [
      'dataset/dataSetPaged', 'dataset/updateDataSet', 'dataset/delete',
      'dataset/changeEnable', 'dataset/copy', 'dataset/genFromSource', 'dataset/runNow',
    ]) {
      expect(typeof mockRegistry[path], `${path} 缺 mock handler`).toBe('function')
    }
  })
})
