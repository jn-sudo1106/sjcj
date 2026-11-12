// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { OverviewPanorama } from '../../api/types'
import AssetFlow from './AssetFlow.vue'

const panorama: OverviewPanorama = {
  total: 7,
  sourceCount: 38,
  error: 4,
  unclassified: 0,
  branches: [
    {
      id: '/基金类', label: '基金类', total: 2, sourceCount: 5, error: 1,
      children: [
        { id: '/基金类/支付宝评论', label: '支付宝评论', total: 1, sourceCount: 3, error: 1 },
        { id: '/基金类/天天基金', label: '天天基金', total: 1, sourceCount: 2, error: 0 },
        { id: '/基金类/雪球', label: '雪球', total: 0, sourceCount: 0, error: 0 },
      ],
    },
    {
      id: '/股票类', label: '股票类', total: 3, sourceCount: 29, error: 2,
      children: [
        { id: '/股票类/公告', label: '公告', total: 2, sourceCount: 27, error: 2 },
        { id: '/股票类/行情', label: '行情', total: 1, sourceCount: 2, error: 0 },
      ],
    },
    {
      id: '/舆情类', label: '舆情类', total: 2, sourceCount: 4, error: 1,
      children: [
        { id: '/舆情类/微博', label: '微博', total: 0, sourceCount: 0, error: 0 },
        { id: '/舆情类/新闻', label: '新闻', total: 1, sourceCount: 2, error: 0 },
        { id: '/舆情类/__unclassified__', label: '未细分', total: 1, sourceCount: 2, error: 1 },
      ],
    },
  ],
}

describe('AssetFlow', () => {
  it('按实际分类树展示一级和二级分支', () => {
    const wrapper = mount(AssetFlow, { props: { panorama } })

    expect(wrapper.findAll('[data-panorama-branch]')).toHaveLength(3)
    expect(wrapper.findAll('[data-panorama-child]')).toHaveLength(8)
    expect(wrapper.text()).toContain('基金类')
    expect(wrapper.text()).toContain('支付宝评论')
    expect(wrapper.text()).toContain('2 个网站')
    expect(wrapper.text()).toContain('5 个源')
    expect(wrapper.text()).not.toContain('第三方平台')
  })

  it('点击一级分支时发出分类路径', async () => {
    const wrapper = mount(AssetFlow, { props: { panorama } })

    await wrapper.get('[data-panorama-branch="/基金类"]').trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['/基金类'])
  })

  it('没有分类分支时展示空状态', () => {
    const wrapper = mount(AssetFlow, {
      props: { panorama: { ...panorama, total: 0, sourceCount: 0, error: 0, branches: [] } },
    })

    expect(wrapper.text()).toContain('暂无采集网站')
  })

  it('一级类型超过四个时换行并扩展沙盘高度', () => {
    const extraBranch = (id: string) => ({
      id,
      label: id.replace('/', ''),
      total: 1,
      sourceCount: 2,
      error: 0,
      children: [],
    })
    const wrapper = mount(AssetFlow, {
      props: { panorama: { ...panorama, branches: [...panorama.branches, extraBranch('/政务类'), extraBranch('/电商类')] } },
    })

    expect(wrapper.findAll('[data-panorama-branch]')).toHaveLength(5)
    expect(wrapper.get('.af-branches').attributes('style')).toContain('repeat(4, minmax(0, 1fr))')
    expect(wrapper.get('.af-stage').attributes('style')).toContain('min-height: 440px')
  })
})
