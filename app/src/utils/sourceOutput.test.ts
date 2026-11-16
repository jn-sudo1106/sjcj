import { describe, expect, it } from 'vitest'
import type { SourceOutputTable } from '@/api'
import { sourceOutputTablesFromLegacy } from '@/api/legacyAdapters'
import { migrateHiddenColumns } from '@/api/sourceViews'
import { isDetailTable, outputCountText, shortDateTime, stepsText, summarizeSourceOutput } from './sourceOutput'

const table = (patch: Partial<SourceOutputTable>): SourceOutputTable => ({
  entryTypeId: '1', entryTypeName: '表', tableName: 'tb_x', dataCount: 0, steps: [], ...patch,
})

describe('sourceOutputTablesFromLegacy（queryStepDetail → 按表去重）', () => {
  it('真实 ROOT 带输出表时计入（单步流程靠入口写主表），stepId 0 虚拟根跳过', () => {
    const tables = sourceOutputTablesFromLegacy({ list: [
      { stepId: 0, stepName: '虚拟根', outEntry: 5, dataCnt: 1 },
      { stepId: 41280, stepName: '入口', isRoot: 1, outEntry: 2102149, tableName: 'sense_data.TB_KALISHI_TRADES', entryTypeName: 'kalishi_trades', dataCnt: 9, lastInsert: '2026-11-16 10:00:00' },
    ] })
    expect(tables.map((t) => t.entryTypeId)).toEqual(['2102149'])
    expect(summarizeSourceOutput(tables)).toMatchObject({ kind: 'ok', lastInsertAt: '2026-11-16 10:00:00' })
  })

  it('跳过无输出表步骤，同一张表合并步骤，按首个步骤排序，去掉 sense_data. 前缀', () => {
    const tables = sourceOutputTablesFromLegacy({ list: [
      { stepId: 0, stepName: '入口', isRoot: 1, outEntry: null, dataCnt: -2 },
      { stepId: 105, stepName: '详情解析', outEntry: 6200005, tableName: 'sense_data.tb_csxxdt', entryTypeName: '详情表', dataCnt: 158, lastInsert: '2026-11-14 04:11:00' },
      { stepId: 101, stepName: '下载', outEntry: 6200023, tableName: 'sense_data.tb_source_code', entryTypeName: '源码表', dataCnt: 4049, lastInsert: '2026-11-16 09:11:00' },
      { stepId: 103, stepName: '列表解析', outEntry: 6200005, tableName: 'sense_data.tb_csxxdt', entryTypeName: '详情表', dataCnt: 158, lastInsert: '2026-11-14 04:11:00' },
      { stepId: 107, stepName: '没输出', outEntry: null },
    ], total: 5 })
    expect(tables.map((t) => t.entryTypeId)).toEqual(['6200023', '6200005'])
    expect(tables[1]).toMatchObject({ tableName: 'tb_csxxdt', dataCount: 158, lastInsertAt: '2026-11-14 04:11:00' })
    expect(tables[1]!.steps.map((s) => s.stepId)).toEqual(['103', '105'])
  })

  it('兼容数组 / {data} 外壳；时间戳转字符串；缺 dataCnt 记 0、缺表定义写「表:ID」', () => {
    const ts = new Date(2026, 10, 14, 4, 11, 0).getTime()
    const [only] = sourceOutputTablesFromLegacy({ code: 0, data: [{ stepId: 2, outEntry: 9, lastInsert: ts }] })
    expect(only).toMatchObject({ entryTypeName: '表:9', dataCount: 0, lastInsertAt: '2026-11-14 04:11:00' })
    expect(sourceOutputTablesFromLegacy([{ stepId: 3, outEntry: 1, dataCnt: -1 }])[0]!.dataCount).toBe(-1)
    expect(sourceOutputTablesFromLegacy(null)).toEqual([])
  })
})

describe('summarizeSourceOutput（详情表认定）', () => {
  it('源码表、附件表按 ID 或物理表名排除', () => {
    expect(isDetailTable(table({ entryTypeId: '6200023' }))).toBe(false)
    expect(isDetailTable(table({ entryTypeId: '88', tableName: 'TB_FJZYB' }))).toBe(false)
    expect(isDetailTable(table({ entryTypeId: '88', tableName: 'sense_data.tb_source_code' }))).toBe(false)
    expect(isDetailTable(table({ entryTypeId: '88', tableName: 'tb_csxxdt' }))).toBe(true)
  })

  it('只有源码表 = 无详情表；多张详情表取最近入库最晚的一张', () => {
    expect(summarizeSourceOutput([table({ entryTypeId: '6200023', lastInsertAt: '2026-11-16 09:00:00' })])).toEqual({ kind: 'none' })
    const older = table({ entryTypeId: 'a', lastInsertAt: '2026-11-10 00:00:00', dataCount: 3 })
    const newer = table({ entryTypeId: 'b', lastInsertAt: '2026-11-12 00:00:00', dataCount: 3 })
    expect(summarizeSourceOutput([older, newer])).toEqual({ kind: 'ok', table: newer, lastInsertAt: '2026-11-12 00:00:00', basis: 'latest' })
  })

  it('统计异常的表不参与取最晚；都异常 = error，能统计但没入库 = never', () => {
    const broken = table({ entryTypeId: 'a', dataCount: -1, lastInsertAt: '2026-11-15 00:00:00' })
    const ok = table({ entryTypeId: 'b', dataCount: 1, lastInsertAt: '2026-11-01 00:00:00' })
    expect(summarizeSourceOutput([broken, ok])).toMatchObject({ kind: 'ok', table: ok })
    expect(summarizeSourceOutput([broken])).toEqual({ kind: 'error', table: broken, basis: 'latest' })
    const empty = table({ entryTypeId: 'c', dataCount: 0 })
    expect(summarizeSourceOutput([broken, empty])).toEqual({ kind: 'never', table: empty, basis: 'latest' })
  })

  it('主表不是源码表：只看主表，旁边更新的 copy 表盖不住主表停更（301276538 雪球组合）', () => {
    const main = table({ entryTypeId: '2100144', tableName: 'TB_XQZH', dataCount: 5000, lastInsertAt: '2025-10-30 18:27:36' })
    const copy = table({ entryTypeId: '2102106', tableName: 'tb_xqzh_tc_new2', dataCount: 76, lastInsertAt: '2025-12-09 21:49:16' })
    expect(summarizeSourceOutput([main, copy], '2100144')).toEqual({ kind: 'ok', table: main, lastInsertAt: '2025-10-30 18:27:36', basis: 'main' })
    // 主表统计异常 / 未入库也如实报，不退回别的表
    expect(summarizeSourceOutput([{ ...main, dataCount: -1 }, copy], '2100144')).toMatchObject({ kind: 'error', basis: 'main' })
    expect(summarizeSourceOutput([{ ...main, lastInsertAt: undefined, dataCount: 0 }, copy], '2100144')).toMatchObject({ kind: 'never', basis: 'main' })
  })

  it('主表是源码表 / 流程没写主表：退回取其余输出表最晚的一张', () => {
    const code = table({ entryTypeId: '6200023', tableName: 'tb_source_code', lastInsertAt: '2026-11-16 09:00:00', dataCount: 9 })
    const detail = table({ entryTypeId: '6200005', tableName: 'tb_csxxdt', lastInsertAt: '2026-11-14 04:11:00', dataCount: 3 })
    expect(summarizeSourceOutput([code, detail], '6200023')).toMatchObject({ kind: 'ok', table: detail, basis: 'latest' })
    expect(summarizeSourceOutput([detail], '999')).toMatchObject({ kind: 'ok', table: detail, basis: 'latest' })
  })

  it('展示文字', () => {
    expect(outputCountText(-1)).toBe('统计异常')
    expect(outputCountText(-2)).toBe('表未定义')
    expect(outputCountText(4049)).toBe((4049).toLocaleString())
    expect(shortDateTime('2026-11-14 04:11:22', new Date(2026, 10, 16))).toBe('11-14 04:11')
    expect(shortDateTime('2025-10-30 18:27:36', new Date(2026, 10, 16))).toBe('2025-10-30')
    expect(shortDateTime(undefined)).toBe('—')
    expect(stepsText([])).toBe('—')
    expect(stepsText([{ stepId: '1', stepName: '列表解析' }, { stepId: '2', stepName: '详情' }])).toBe('列表解析 等 2 个')
  })
})

describe('migrateHiddenColumns', () => {
  it('旧视图隐藏的「成功」→「产出」，去重，其它不动', () => {
    expect(migrateHiddenColumns(['url', 'success', 'output'])).toEqual(['url', 'output'])
  })
})
