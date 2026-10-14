// 指标结果页的列定义 —— 与 indicatorsList 不同，这一页的列是「字段驱动的」：
// 表格动态列按当前数据表的必填字段生成（截断到前 12 个），编辑/详情用全量。
// 这一层守的是「必填/非必填怎么分流、12 截断按谁的序号、url 列怎么判、宽度怎么算」。
import { describe, expect, it } from 'vitest'
import {
  ENTRY_DETAIL_BASE,
  ENTRY_DETAIL_DATA,
  ENTRY_OTHER_COLS,
  buildDynamicColumns,
  buildEditColumns,
  buildOtherColumns,
  fieldsToEntryItems,
  sourceDetailColumns,
  type EntryItem,
} from './columns'

/** 造一个归一化后的字段（旧 entryType.items 的一行） */
function item(columnName: string, itemName: string, over: Partial<EntryItem> = {}): EntryItem {
  return { columnName, itemName, dataType: 'string', required: true, ...over }
}

describe('indicatorsResult · fieldsToEntryItems（DataTableMeta.fields → 旧 entryType.items）', () => {
  it('字段名映射：desc→itemName / type→dataType / columnName 与 required 同名保留', () => {
    const items = fieldsToEntryItems([
      { columnName: 'K1', desc: '标题', type: 'string', required: true },
      { columnName: 'K2', desc: '发布日期', type: 'date', required: false },
    ])
    expect(items).toEqual([
      { columnName: 'K1', itemName: '标题', dataType: 'string', required: true },
      { columnName: 'K2', itemName: '发布日期', dataType: 'date', required: false },
    ])
  })

  it('缺 columnName 的字段被丢掉（没有物理列名就画不出列）；缺失字段按空串/空值兜底', () => {
    const items = fieldsToEntryItems([
      { columnName: '', desc: '无列名' },
      { desc: '只有中文名' },
      { columnName: 'K9' },
    ])
    expect(items).toEqual([{ columnName: 'K9', itemName: '', dataType: '', required: false }])
  })

  it('fields 为 undefined / 空数组时返回空数组（不抛）', () => {
    expect(fieldsToEntryItems(undefined)).toEqual([])
    expect(fieldsToEntryItems([])).toEqual([])
  })
})

describe('indicatorsResult · buildDynamicColumns（旧 columns() / allColumns()）', () => {
  it('标题是「中文名-列名」，dataIndex 就是物理列名', () => {
    const cols = buildDynamicColumns([item('K1', '标题'), item('K2', '指标编码')])
    expect(cols.map((c) => c.title)).toEqual(['标题-K1', '指标编码-K2'])
    expect(cols.map((c) => c.dataIndex)).toEqual(['K1', 'K2'])
  })

  it('只取必填字段（非必填留给编辑弹窗的 otherCols）', () => {
    const cols = buildDynamicColumns([
      item('K1', '标题', { required: true }),
      item('K2', '备注', { required: false }),
    ])
    expect(cols.map((c) => c.dataIndex)).toEqual(['K1'])
  })

  it('limit=12 按**字段下标**截断（旧 `for (i…) { if (i >= 12) break }`），不是「前 12 个必填」', () => {
    // 第 3 个字段非必填：它占掉一个下标，但不产出列
    const items = Array.from({ length: 14 }, (_, i) =>
      item(`K${i + 1}`, `字段${i + 1}`, { required: i !== 2 }))
    const cols = buildDynamicColumns(items, 12)
    // 下标 0..11 里去掉第 2 个（非必填）→ 11 列；下标 12、13 被 break 掉
    expect(cols).toHaveLength(11)
    expect(cols.map((c) => c.dataIndex)).not.toContain('K13')
    expect(cols.map((c) => c.dataIndex)).not.toContain('K14')
  })

  it('limit=0 表示不限（= 旧 allColumns()：编辑弹窗用全量）', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`K${i + 1}`, `字段${i + 1}`))
    expect(buildDynamicColumns(items, 0)).toHaveLength(20)
    expect(buildDynamicColumns(items, 12)).toHaveLength(12)
  })

  it('宽度规则：默认 120、名字带「区间/时间/日期/周期」算 140，统一再乘 0.9', () => {
    const cols = buildDynamicColumns([
      item('K1', '标题'),
      item('K2', '发布日期'),
      item('K3', '统计周期'),
      item('K4', '时间区间'),
    ])
    expect(cols.map((c) => c.width)).toEqual([108, 126, 126, 126])
  })

  it('url 列：dataType=url 或字段名含 url → 不加宽度、url=true、slot=dataUrl', () => {
    const cols = buildDynamicColumns([
      item('K1', '正文链接', { dataType: 'url' }),
      item('K2', 'URL地址', { dataType: 'string' }),
      item('K3', '标题', { dataType: 'string' }),
    ])
    expect(cols.map((c) => c.url)).toEqual([true, true, false])
    expect(cols.map((c) => c.slot)).toEqual(['dataUrl', 'dataUrl', 'data'])
    expect(cols[0].width).toBeUndefined()
    expect(cols[2].width).toBe(108)
  })
})

describe('indicatorsResult · 编辑 / 详情列集合（旧 editCols / otherCols）', () => {
  it('otherCols = 非必填字段（标题就是中文名，不带列名后缀）+ 7 个固定表信息列', () => {
    const cols = buildOtherColumns([
      item('K1', '标题', { required: true }),
      item('K2', '备注', { required: false }),
    ])
    expect(cols.map((c) => c.title)).toEqual([
      '备注', '任务', '父ID', '文件ID', '版本', '任务ID', '父ID', '更新次数',
    ])
  })

  it('7 个固定表信息列沿用旧 baseOtherCols 的原样（含重复的「父ID/任务」——旧配置就是这么抄的）', () => {
    expect(ENTRY_OTHER_COLS.map((c) => `${c.dataIndex}:${c.title}`)).toEqual([
      'DETAIL_ID:任务', 'PARENT_ID:父ID', 'FILE_ID:文件ID', 'SEQ:版本',
      'DETAIL_ID:任务ID', 'PARENT_ID:父ID', 'TIMES:更新次数',
    ])
    expect(ENTRY_OTHER_COLS.every((c) => c.noEdit)).toBe(true)
  })

  it('editCols = 全量必填动态列（不截断）+ 非必填字段，7 个表信息列被 noEdit 剔除', () => {
    const items = [
      item('K1', '标题'),
      item('K2', '备注', { required: false }),
      ...Array.from({ length: 15 }, (_, i) => item(`K${i + 10}`, `字段${i + 10}`)),
    ]
    const titles = buildEditColumns(items).map((c) => c.title)
    expect(titles).toContain('标题-K1')
    expect(titles).toContain('备注')
    expect(titles).toContain('字段24-K24') // 必填列不截断
    expect(titles).not.toContain('任务') // ENTRY_OTHER_COLS 全在 editCols 之外
  })
})

describe('indicatorsResult · 详情抽屉列集（旧 ENTRY_DETAIL.base / ENTRY_DETAIL.data）', () => {
  it('ENTRY_DETAIL.base 16 个系统列，标题与顺序 1:1', () => {
    expect(ENTRY_DETAIL_BASE.map((c) => c.title)).toEqual([
      '数据ID', '源ID', '源名称', '文件ID', '类型ID', '类型名', '父ID', '任务ID',
      'updateDt', 'createDt', '版本', '总次数', '序号', '抓取日期', '原始', '子数据量',
    ])
  })

  it('ENTRY_DETAIL.data 5 列（主列表与子表共用）', () => {
    expect(ENTRY_DETAIL_DATA.map((c) => c.title)).toEqual([
      '字段ID', '字段编码', '字段注释', '列名', '字段值',
    ])
  })

  it('旧 link 模板原样保留（$VAL$ 占位由抽屉运行时替换）', () => {
    const byIndex = Object.fromEntries(ENTRY_DETAIL_BASE.map((c) => [c.dataIndex, c.link]))
    expect(byIndex.sourceId).toBe('/source/source-list?sourceId=$VAL$')
    expect(byIndex.fileId).toBe('/inst/file-list?fileId=$VAL$')
    expect(byIndex.entryTypeId).toBe('/config/entry-type?entryTypeId=$VAL$')
    expect(byIndex.detailId).toBe('/inst/task-list?taskId=$VAL$')
  })
})

describe('indicatorsResult · 源详情列集（旧 SOURCE.BASE + SOURCE.OTHER 的 !noDetail 部分）', () => {
  it('去掉 3 个 noDetail 列（数据 / 定时 / 步骤）', () => {
    const titles = sourceDetailColumns().map((c) => c.title)
    expect(titles).not.toContain('数据')
    expect(titles).not.toContain('定时')
    expect(titles).not.toContain('步骤')
  })

  it('dataIndex 用新适配层的字段名（不是旧列配置的原始列名）', () => {
    const indexes = sourceDetailColumns().map((c) => c.dataIndex)
    // 旧 sourceUrl→url / dataCnt→dataCount / entryTypeId→mainTable / keepLast→resume …
    expect(indexes).toContain('url')
    expect(indexes).toContain('dataCount')
    expect(indexes).toContain('mainTable')
    expect(indexes).toContain('resume')
    expect(indexes).not.toContain('sourceUrl')
    expect(indexes).not.toContain('entryTypeId')
  })

  it('remark 是 textArea（可写），但 save 不在列上——由 SourceDetailDialog 注入', () => {
    const remark = sourceDetailColumns().find((c) => c.dataIndex === 'remark')
    expect(remark?.type).toBe('textArea')
    expect(remark?.save).toBeUndefined()
  })

  it('两个布尔归一列用 fun 显示「是[1]/否[0]」（旧 enableFilter 文案）', () => {
    const resume = sourceDetailColumns().find((c) => c.dataIndex === 'resume')
    const disabled = sourceDetailColumns().find((c) => c.dataIndex === 'disabled')
    expect(resume?.fun?.(true)).toBe('是[1]')
    expect(resume?.fun?.(false)).toBe('否[0]')
    expect(disabled?.fun?.(true)).toBe('是[1]')
    expect(disabled?.fun?.(false)).toBe('否[0]')
  })
})
