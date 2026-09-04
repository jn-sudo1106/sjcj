// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RowDetailSubs from './RowDetailSubs.vue'
import type { EntrySubRow } from '@/api'

function sub(id: string, fieldCount = 2): EntrySubRow {
  return {
    row: { dataId: id, sourceId: 's1', values: {} } as never,
    showItems: Array.from({ length: fieldCount }, (_, i) => ({
      itemId: `${id}-${i}`, columnName: `K${i + 1}`, itemName: `字段${i + 1}`, value: `值${i + 1}`,
    })),
    tableId: '900',
    tableName: '通用新闻表',
  }
}

describe('RowDetailSubs（0904 下级数据面板）', () => {
  it('没有子行时整块不渲染——不留一个空面板占位', () => {
    const wrapper = mount(RowDetailSubs, { props: { subs: [] } })
    expect(wrapper.find('[data-testid="data-subs-panel"]').exists()).toBe(false)
  })

  // 会上原话：「如果它太多了，比如说 50 条，那你就攒攒攒的就麻烦了」。
  // 旧平台是把 N 条全展开成 N 张表；560px 的抽屉里会把本行字段整个挤没。
  it('默认整块折叠；展开后只自动展开第一条', async () => {
    const wrapper = mount(RowDetailSubs, { props: { subs: [sub('1'), sub('2'), sub('3')] } })

    expect(wrapper.text()).toContain('通用新闻表')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.findAll('[data-testid="data-subs-item"]')).toHaveLength(0)

    await wrapper.get('[data-testid="data-subs-toggle"]').trigger('click')
    expect(wrapper.findAll('[data-testid="data-subs-item"]')).toHaveLength(3)
    // 三条标题行都在，但只有第一条把字段摊开
    expect(wrapper.findAllComponents({ name: 'RowDetailFields' })).toHaveLength(1)
    expect(wrapper.text()).toContain('值1')
  })

  it('点子行标题逐条展开/收起', async () => {
    const wrapper = mount(RowDetailSubs, { props: { subs: [sub('1'), sub('2')] } })
    await wrapper.get('[data-testid="data-subs-toggle"]').trigger('click')

    await wrapper.findAll('[data-testid="data-subs-item"]')[1].trigger('click')
    expect(wrapper.findAllComponents({ name: 'RowDetailFields' })).toHaveLength(2)

    await wrapper.findAll('[data-testid="data-subs-item"]')[0].trigger('click')
    expect(wrapper.findAllComponents({ name: 'RowDetailFields' })).toHaveLength(1)
  })

  // 旧平台界面上写的是「本页展示子数据 3/6 条」——总数比带回来的多时必须说出来，
  // 否则用户会以为这就是全部
  it('详情只带回一部分时显示 N / 总数，并给「查看全部」出口', async () => {
    const wrapper = mount(RowDetailSubs, {
      props: { subs: [sub('1'), sub('2'), sub('3')], subsCnt: 6, canViewAll: true },
    })
    expect(wrapper.text()).toContain('3 / 6')

    await wrapper.get('[data-testid="data-subs-toggle"]').trigger('click')
    expect(wrapper.get('[data-testid="data-subs-partial"]').text()).toContain('共 6 条')
    await wrapper.get('[data-testid="data-subs-view-all"]').trigger('click')
    expect(wrapper.emitted('viewAll')).toHaveLength(1)
  })

  it('没有下钻能力时不给「查看全部」，避免点了没反应', async () => {
    const wrapper = mount(RowDetailSubs, {
      props: { subs: [sub('1')], subsCnt: 6, canViewAll: false },
    })
    await wrapper.get('[data-testid="data-subs-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="data-subs-partial"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="data-subs-view-all"]').exists()).toBe(false)
  })

  it('带回的就是全部时不显示分数，也没有"查看全部"', () => {
    const wrapper = mount(RowDetailSubs, { props: { subs: [sub('1'), sub('2')], subsCnt: 2 } })
    expect(wrapper.text()).not.toContain('/')
    expect(wrapper.find('[data-testid="data-subs-partial"]').exists()).toBe(false)
  })

  // 换行看详情时不能把上一行的展开状态带过来
  it('subs 变化后收起，不残留上一行的展开态', async () => {
    const wrapper = mount(RowDetailSubs, { props: { subs: [sub('1')] } })
    await wrapper.get('[data-testid="data-subs-toggle"]').trigger('click')
    expect(wrapper.findAll('[data-testid="data-subs-item"]')).toHaveLength(1)

    await wrapper.setProps({ subs: [sub('9')] })
    expect(wrapper.findAll('[data-testid="data-subs-item"]')).toHaveLength(0)
  })
})
