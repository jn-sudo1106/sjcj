import { describe, expect, it } from 'vitest'
import type { DataRow, DataTableMeta } from '@/api'
import { resultRowsCsv } from './exportRows'

describe('当前页数据导出', () => {
  it('使用物理字段值、补全身份列，转义逗号引号换行并保留零值', () => {
    const meta = { fields: [{ prop: 'title', columnName: 'K1', desc: '标题' }, { prop: 'K2', desc: '数量' }] } as DataTableMeta
    const csv = resultRowsCsv([{ dataId: '123', sourceId: '456', title: '', summary: '', acceptState: 'accepted', values: { K1: '中文,"标题"\n下一行', K2: 0 } } as DataRow], meta)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('标题-K1')
    expect(csv).toContain('"123","456"')
    expect(csv).toContain('"中文,""标题""\n下一行"')
    expect(csv).toContain('"0"')
  })
  it('表结构缺失时保留数据字段，并将公式内容按文本导出', () => {
    const csv = resultRowsCsv([{ dataId: '1', sourceId: '2', title: '', summary: '', acceptState: 'accepted', values: { K1: '=SUM(1,2)', K2: { a: 1 } } } as DataRow], null)
    expect(csv).toContain('"K1"')
    expect(csv).toContain("'=" )
    expect(csv).toContain('{""a"":1}')
  })
})
