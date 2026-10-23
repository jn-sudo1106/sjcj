// 指标数据集列定义 —— 对齐旧 data-view `src/config/column.config.js` 的 `allColumns.DATASET`。
// 这一层守的是「迁移时列有没有少、派生集合的口径有没有走样」，以及两个旧全局过滤器的映射。
import { describe, expect, it } from 'vitest'
import {
  DATASET_ALL,
  DATASET_BASE,
  DATASET_OTHER,
  detailColumns,
  editColumns,
  enableText,
  stateText,
} from './columns'

describe('indicatorDataset · 列定义（旧 allColumns.DATASET）', () => {
  it('base 12 列，标题与顺序 1:1', () => {
    expect(DATASET_BASE.map((c) => c.title)).toEqual([
      '数据集ID', '数据集名称', '指标数', '表ID', '上次ID', '定时',
      '上次运行', '下次运行', '执行', '成功', '状态', '操作',
    ])
  })

  it('other 6 列，标题与顺序 1:1', () => {
    expect(DATASET_OTHER.map((c) => c.title)).toEqual([
      '源ID', 'SQL条件片断', '自定义查询SQL', '域名', '启用', 'ver',
    ])
  })

  it('表格列宽：文本列走 minWidth（自适应），其余走固定 width —— 不能全写死 width，否则表格撑不满容器', () => {
    const flexible = DATASET_BASE.filter((c) => c.minWidth)
    expect(flexible.map((c) => c.dataIndex)).toEqual(['datasetName', 'schedule'])
    for (const col of DATASET_BASE) {
      // 二者只能给一个：同时给的话 el-table 认 width、minWidth 失效（容器再宽右侧也留白）
      expect(
        col.width === undefined || col.minWidth === undefined,
        `${col.title} 同时给了 width(${col.width}) 与 minWidth(${col.minWidth})`,
      ).toBe(true)
      // 至少得给一个，否则该列宽度无从确定
      expect(
        col.width !== undefined || col.minWidth !== undefined,
        `${col.title} 既没有 width 也没有 minWidth`,
      ).toBe(true)
    }
  })

  it('7 个可排序列（旧 sorter：datasetId / measureCnt / entryTypeId / lastId / lastRun / nextRun / sourceId）', () => {
    const sortable = DATASET_ALL.filter((c) => c.sorter).map((c) => c.dataIndex)
    expect(sortable).toEqual(['datasetId', 'measureCnt', 'entryTypeId', 'lastId', 'lastRun', 'nextRun', 'sourceId'])
  })

  it('5 个插槽落在正确的列上（旧 idSlot / nameSlot / measureCntSlot / lastDateSlot / actionSlot）', () => {
    const slots = DATASET_BASE.filter((c) => c.slot).map((c) => `${c.dataIndex}:${c.slot}`)
    expect(slots).toEqual([
      'datasetId:id',
      'datasetName:name',
      'measureCnt:measureCnt',
      'lastRun:lastDate',
      'nextRun:lastDate',
      'action:action',
    ])
  })

  it('编辑字段 = 全部列去掉 noEdit（旧 editCols）', () => {
    expect(editColumns().map((c) => c.title)).toEqual([
      '数据集ID', '数据集名称', '表ID', '上次ID', '定时', '源ID', 'SQL条件片断', '自定义查询SQL',
    ])
    expect(editColumns().every((c) => !c.noEdit)).toBe(true)
  })

  it('详情字段 = 全部列去掉 noDetail（旧 detailCols，只去掉「操作」）', () => {
    const titles = detailColumns().map((c) => c.title)
    expect(titles).toHaveLength(17)
    expect(titles).not.toContain('操作')
    expect(titles).toContain('数据集ID')
    expect(titles).toContain('ver')
  })

  it('只读字段（旧 readonly → 表单禁用）：数据集ID / 表ID / 源ID', () => {
    expect(DATASET_ALL.filter((c) => c.readonly).map((c) => c.dataIndex)).toEqual([
      'datasetId', 'entryTypeId', 'sourceId',
    ])
  })

  it('定时列是 cron 类型（旧 type=cron → 表单里的「配定时」输入框）', () => {
    expect(DATASET_ALL.filter((c) => c.type === 'cron').map((c) => c.dataIndex)).toEqual(['schedule'])
  })
})

describe('indicatorDataset · 旧全局过滤器', () => {
  it('stateFilter：C→正常 / E→出错 / L→处理中 / AC→已审核 / W→待处理 / 其它原样', () => {
    expect(stateText('C')).toBe('正常')
    expect(stateText('E')).toBe('出错')
    expect(stateText('L')).toBe('处理中')
    expect(stateText('AC')).toBe('已审核')
    expect(stateText('W')).toBe('待处理')
    expect(stateText('X')).toBe('X')
    expect(stateText(undefined)).toBe('')
  })

  // isDelete 口径：0 = 启用 / 1 = 停用（列标题「启用」），文案沿用旧 filter 的「是/否」
  it('enableFilter：0→是[1] / 1→否[0] / 其它原样', () => {
    expect(enableText(0)).toBe('是[1]')
    expect(enableText(1)).toBe('否[0]')
    expect(enableText(-1)).toBe('-1')
    expect(enableText(null)).toBe('')
  })
})
