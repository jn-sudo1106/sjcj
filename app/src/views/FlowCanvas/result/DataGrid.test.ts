// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DataGrid from './DataGrid.vue'

describe('DataGrid', () => {
  it('全站范围传入子源映射时显示所属子源名称', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { name: '数据 A' } }],
        sourceNames: { s1: '子源 A' },
      },
      global: { stubs: { ElDropdown: true } },
    })

    expect(wrapper.text()).toContain('所属子源')
    expect(wrapper.text()).toContain('子源 A')
  })
})
