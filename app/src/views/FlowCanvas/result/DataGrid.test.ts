// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DataGrid from './DataGrid.vue'

// 按表头文字定位单元格：ENTRY_ID / SOURCE_ID 两个身份合成列固定占最前面，
// 用 nth-child 写死列序号的断言会随它们的显隐而碎（0819 N1-5）。
function cellByHeader(wrapper: ReturnType<typeof mount>, header: string): string {
  const idx = wrapper.findAll('thead th').findIndex((th) => th.text() === header)
  if (idx < 0) throw new Error(`表头里没有「${header}」列`)
  return wrapper.findAll('tbody tr:first-child td')[idx].text()
}

describe('DataGrid', () => {
  it('全站范围传入源映射时显示所属源名称', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { name: '数据 A' } }],
        sourceNames: { s1: '源 A' },
      },
      global: { stubs: { ElDropdown: true } },
    })

    expect(wrapper.text()).toContain('所属源')
    expect(wrapper.text()).toContain('源 A')
  })

  it('按 columnName 取值，不是按 prop——旧平台行数据的 key 是物理列名（K1/K2...），跟 tableMeta 的逻辑字段名 prop 不是一回事（真实 bug，2026-08-14 生产环境实测：详情和表格所有字段都显示"—"，不是接口没数据）', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'title', columnName: 'K1', type: 'string', desc: '标题' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { K1: '真实标题' } }],
      },
      global: { stubs: { ElDropdown: true } },
    })

    // "状态"列本来就没传 state，会正常显示"—"，只断言标题格自己不是"—"
    expect(cellByHeader(wrapper, 'title')).toBe('真实标题')
  })

  it('ENTRY_ID / SOURCE_ID 两个身份列默认可见——旧平台各表 schema 不声明它们，不补出来就既看不出数据 ID 也看不出属于哪个源（0819 会议 08:16 / 09:44）', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: '430016500', acceptState: 'accepted', values: { name: '数据 A' } }],
      },
      global: { stubs: { ElDropdown: true } },
    })

    expect(cellByHeader(wrapper, 'ENTRY_ID')).toBe('d1')
    expect(cellByHeader(wrapper, 'SOURCE_ID')).toBe('430016500')
  })

  it('没有 columnName 时（比如兜底推断出的 meta）退回用 prop 取值', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'K1', type: 'string', desc: 'K1' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { K1: '推断出的值' } }],
      },
      global: { stubs: { ElDropdown: true } },
    })

    expect(wrapper.text()).toContain('推断出的值')
  })

  it('不传 selectable 时不渲染勾选列（不影响现有用法）', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { name: 'A' } }],
      },
      global: { stubs: { ElDropdown: true } },
    })

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('selectable 时点击行勾选框会 emit update:selectedIds，点表头全选/取消全选', async () => {
    const rows = [
      { dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const, values: {} },
      { dataId: 'd2', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const, values: {} },
    ]
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 2, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows,
        selectable: true,
        selectedIds: [],
      },
      global: { stubs: { ElDropdown: true } },
    })

    const rowChecks = wrapper.findAll('.dg-select input[type="checkbox"]')
    expect(rowChecks).toHaveLength(2)
    await rowChecks[0].setValue(true)
    expect(wrapper.emitted('update:selectedIds')?.[0]).toEqual([['d1']])

    // 表头全选：基于当前 props（尚未回填 d1），应该发出全部行的 id
    const headCheck = wrapper.find('thead input[type="checkbox"]')
    await headCheck.setValue(true)
    expect(wrapper.emitted('update:selectedIds')?.[1]).toEqual([['d1', 'd2']])
  })

  it('点击勾选框不触发 row-click（详情不应该被顺带打开）', async () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: {} }],
        selectable: true,
        selectedIds: [],
      },
      global: { stubs: { ElDropdown: true } },
    })

    await wrapper.find('.dg-select input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('row-click')).toBeUndefined()
  })
})
