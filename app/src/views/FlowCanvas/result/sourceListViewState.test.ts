// 源列表「视图状态」（2026-10-12「我的视图」）：状态 ↔ sourcePaged 参数、比较、摘要。
import { describe, expect, it } from 'vitest'
import { blankSourceListViewState, describeViewState, sameViewState, viewStateFilter, type SourceListViewState } from './sourceListViewState'

const st = (patch: Partial<SourceListViewState>): SourceListViewState => ({ ...blankSourceListViewState(), ...patch })

describe('viewStateFilter', () => {
  it('条件 / 网站 / 来源组 / 状态 / 标签 / 数据量 / 排序转成 sourcePaged 参数，口径同源列表', () => {
    const q = viewStateFilter(st({
      conditions: [{ field: 'name', op: 'like', value: '公告' }, { field: 'flowId', op: 'eq', value: '14003200' }],
      site: '125', sourceGroup: '3', status: 'E', tag: '宏观', countMax: '0', sortField: 'DATA_CNT', sortDirection: 'desc',
    }))
    expect(q).toMatchObject({ name: '公告', flowId: '14003200', siteIds: '125', sourceGroupId: '3', state: 'E', enable: '0', count: 0, field: 'DATA_CNT', sorted: -1, type: 'DESC' })
    expect(q.tags).toHaveLength(1)
  })

  it('全部状态 / 已停用 / 空数据量 / 不排序', () => {
    expect(viewStateFilter(st({}))).toMatchObject({ state: undefined, enable: undefined, count: undefined, field: undefined, sorted: undefined, tags: [] })
    expect(viewStateFilter(st({ status: 'disabled' }))).toMatchObject({ state: undefined, enable: '1' })
  })
})

describe('sameViewState', () => {
  it('空条件行、首尾空格、隐藏列顺序不算差异；改了条件 / 每页条数算差异', () => {
    const a = st({ conditions: [{ field: 'sourceIds', op: 'eq', value: '' }], hiddenColumns: ['url', 'tags'] })
    const b = st({ conditions: [], hiddenColumns: ['tags', 'url'] })
    expect(sameViewState(a, b)).toBe(true)
    expect(sameViewState(st({ conditions: [{ field: 'name', op: 'like', value: '公告 ' }] }), st({ conditions: [{ field: 'name', op: 'like', value: '公告' }] }))).toBe(true)
    expect(sameViewState(a, st({ status: 'E' }))).toBe(false)
    expect(sameViewState(a, st({ pageSize: 50 }))).toBe(false)
  })
})

describe('describeViewState', () => {
  it('条件摘要，网站 / 来源组换成名称', () => {
    const parts = describeViewState(st({
      conditions: [{ field: 'remark', op: 'notEmpty', value: '' }, { field: 'name', op: 'like', value: '公告' }],
      site: '125', sourceGroup: '3', status: 'E', countMax: '5',
    }), { site: () => '国家统计局', group: () => 'twitter1' })
    expect(parts).toEqual(['备注非空', '源名称包含「公告」', '网站 = 国家统计局', '来源组 = twitter1', '状态 = 异常', '数据量 ≤ 5'])
    expect(describeViewState(st({}))).toEqual([])
  })
})
