// 指标列表列定义 —— 对齐旧 data-view `src/config/column.config.js` 的 `MEASURE` 段。
// 这一层守的是「迁移时列有没有少、四个派生集合（表格 / 编辑 / 详情 / JSON 子编辑器）的口径有没有走样」。
import { describe, expect, it } from 'vitest'
import {
  MEASURE_BASE,
  MEASURE_JSON_DIM,
  MEASURE_JSON_VAL,
  MEASURE_OTHER,
  detailColumns,
  editColumns,
} from './columns'

describe('indicatorsList · 列定义（旧 allColumns.MEASURE）', () => {
  it('base 13 列，标题与顺序 1:1', () => {
    expect(MEASURE_BASE.map((c) => c.title)).toEqual([
      'ID', '编码[唯一]', '名称', '源ID', '类型', '数据集', '条件',
      '纬度', '值1', '值2', '单位', '启用', '操作',
    ])
  })

  it('other 只有「更新时间」1 列，且不进表格（表格列用的是 MEASURE_BASE）', () => {
    expect(MEASURE_OTHER.map((c) => c.title)).toEqual(['更新时间'])
    expect(MEASURE_BASE.map((c) => c.dataIndex)).not.toContain('updateDt')
  })

  it('表格列宽：文本列走 minWidth（自适应），数值/状态/操作列走固定 width', () => {
    const flexible = MEASURE_BASE.filter((c) => c.minWidth).map((c) => c.dataIndex)
    expect(flexible).toEqual([
      'measureCode', 'measureName', 'measureType', 'keyDef', 'dimDef', 'val1Def', 'val2Def', 'unitDef',
    ])
    for (const col of MEASURE_BASE) {
      // 二者只能给一个：同时给的话 el-table 认 width、minWidth 失效
      expect(
        col.width === undefined || col.minWidth === undefined,
        `${col.title} 同时给了 width(${col.width}) 与 minWidth(${col.minWidth})`,
      ).toBe(true)
      expect(
        col.width !== undefined || col.minWidth !== undefined,
        `${col.title} 既没有 width 也没有 minWidth`,
      ).toBe(true)
    }
  })

  it('只有 ID 一列可排序（旧 MEASURE.base 里唯一带 sorter 的列）', () => {
    expect(MEASURE_BASE.filter((c) => c.sorter).map((c) => c.dataIndex)).toEqual(['measureId'])
  })

  it('只有「操作」列 fixed: right —— 本页列总宽超出内容区，横向滚动时操作要始终可见', () => {
    expect(MEASURE_BASE.filter((c) => c.fixed).map((c) => c.dataIndex)).toEqual(['action'])
    // 编辑弹窗 / 详情抽屉不吃这个字段（它们只按 title/span/noEdit/noDetail 走）
    expect(editColumns().some((c) => c.fixed)).toBe(false)
    expect(detailColumns().some((c) => c.fixed)).toBe(false)
  })

  it('9 个插槽落在正确的列上（旧 scopedSlots：idSlot / nameSlot / jsonSlot / jsonDimSlot / actionSlot）', () => {
    const slots = MEASURE_BASE.filter((c) => c.slot).map((c) => `${c.dataIndex}:${c.slot}`)
    expect(slots).toEqual([
      'measureId:id',
      'measureName:name',
      'measureType:name',
      'keyDef:json',
      'dimDef:jsonDim',
      'val1Def:json',
      'val2Def:json',
      'unitDef:json',
      'action:action',
    ])
  })

  it('编辑字段 = base + other 去掉 noEdit（只去掉「操作」）', () => {
    expect(editColumns().map((c) => c.title)).toEqual([
      'ID', '编码[唯一]', '名称', '源ID', '类型', '数据集', '条件',
      '纬度', '值1', '值2', '单位', '启用', '更新时间',
    ])
    expect(editColumns().every((c) => !c.noEdit)).toBe(true)
  })

  it('详情字段 = base + other 去掉 noDetail（同样只去掉「操作」）', () => {
    const titles = detailColumns().map((c) => c.title)
    expect(titles).toHaveLength(13)
    expect(titles).not.toContain('操作')
    expect(titles).toContain('更新时间')
  })

  it('只读字段（旧 readonly → 编辑弹窗禁用）：只有 ID', () => {
    expect(MEASURE_BASE.filter((c) => c.readonly).map((c) => c.dataIndex)).toEqual(['measureId'])
  })

  it('本页列集不含 cron / json / textArea 类型（MEASURE 的 5 个 JSON 列走 json 子编辑器，不在主表单里）', () => {
    const types = [...MEASURE_BASE, ...MEASURE_OTHER].map((c) => c.type).filter(Boolean)
    expect(types).toEqual([])
  })
})

describe('indicatorsList · JSON 子编辑器列集（旧 MEASURE.json_dim / json_val）', () => {
  it('json_dim 8 列，标题与顺序 1:1', () => {
    expect(MEASURE_JSON_DIM.map((c) => c.title)).toEqual([
      '数据列-数据集列名（必选)', '类型（必选)', '预处理函数', '默认值(或固定值)', '原始日期格式',
      '目标日期格式', '范围: From天前(注1)', '范围: To天前(注1)',
    ])
  })

  it('json_val 4 列（前 4 列与 json_dim 同名同序；日期相关的 4 列只在纬度里）', () => {
    expect(MEASURE_JSON_VAL.map((c) => c.title)).toEqual([
      '数据列-数据集列名（必选)', '类型（必选)', '预处理函数', '默认值(或固定值)',
    ])
  })

  it('dataIndex 与旧配置一致（cols / type / clearRule / nvl / from / to / min / delay）', () => {
    expect(MEASURE_JSON_DIM.map((c) => c.dataIndex)).toEqual([
      'cols', 'type', 'clearRule', 'nvl', 'from', 'to', 'min', 'delay',
    ])
    expect(MEASURE_JSON_VAL.map((c) => c.dataIndex)).toEqual(['cols', 'type', 'clearRule', 'nvl'])
  })

  it('「数据列」是 ENTRY_COLUMNS 类型（旧 BaseEdit 的远程列下拉），「类型」是三选一下拉', () => {
    expect(MEASURE_JSON_DIM[0].type).toBe('ENTRY_COLUMNS')
    expect(MEASURE_JSON_VAL[0].type).toBe('ENTRY_COLUMNS')
    expect(MEASURE_JSON_DIM.find((c) => c.dataIndex === 'type')?.values?.map((v) => v.value))
      .toEqual(['date', 'num', 'string'])
    expect(MEASURE_JSON_VAL.find((c) => c.dataIndex === 'type')?.values?.map((v) => v.value))
      .toEqual(['date', 'num', 'string'])
  })

  it('纬度独有的两个下拉/数值列：目标日期格式（二选一）+ From/To 天前（int）', () => {
    expect(MEASURE_JSON_DIM.find((c) => c.dataIndex === 'to')?.values?.map((v) => v.value))
      .toEqual(['yyyy-MM-dd', ''])
    expect(MEASURE_JSON_DIM.find((c) => c.dataIndex === 'min')?.type).toBe('int')
    expect(MEASURE_JSON_DIM.find((c) => c.dataIndex === 'delay')?.type).toBe('int')
  })
})
