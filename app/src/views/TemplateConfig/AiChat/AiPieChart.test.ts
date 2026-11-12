// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiPieChart from './AiPieChart.vue'
import type { PieSlice } from '@/api/aiChat'

describe('AI 智能问数 · AiPieChart.vue', () => {
  const sampleSlices: PieSlice[] = [
    { label: 'HTTP 403 阻断', value: 412, displayValue: '412 次 (32.8%)', color: '#dc2626', tone: 'err' },
    { label: '连接重置 (ConnectionReset)', value: 447, displayValue: '447 次 (35.6%)', color: '#ea580c', tone: 'orange' },
    { label: '响应超时 (SocketTimeout)', value: 396, displayValue: '396 次 (31.6%)', color: '#f59e0b', tone: 'amber' },
  ]

  it('正确渲染 SVG 环形切片与右侧图例列表', () => {
    const wrapper = mount(AiPieChart, {
      props: {
        slices: sampleSlices,
        centerLabel: '总异常样本',
        centerValue: '1,255 次',
      },
    })

    expect(wrapper.find('[data-testid="rc-pie-container"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rc-pie-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="rc-pie-legend"]').exists()).toBe(true)

    const slices = wrapper.findAll('.rc-pie-slice')
    expect(slices).toHaveLength(3)

    const legendRows = wrapper.findAll('.rc-pie-legend-row')
    expect(legendRows).toHaveLength(3)
    expect(legendRows[0].text()).toContain('HTTP 403 阻断')
    expect(legendRows[0].text()).toContain('412 次 (32.8%)')
  })

  it('默认状态下中心展示 centerValue 与 centerLabel', () => {
    const wrapper = mount(AiPieChart, {
      props: {
        slices: sampleSlices,
        centerLabel: '总异常样本',
        centerValue: '1,255 次',
      },
    })

    const mainText = wrapper.find('.rc-pie-center-main').text()
    const bottomText = wrapper.find('.rc-pie-center-bottom').text()

    expect(mainText).toBe('1,255 次')
    expect(bottomText).toBe('总异常样本')
  })

  it('当未传 centerValue 时，自动计算切片总和', () => {
    const wrapper = mount(AiPieChart, {
      props: {
        slices: [
          { label: '分类A', value: 100 },
          { label: '分类B', value: 200 },
        ],
      },
    })

    const mainText = wrapper.find('.rc-pie-center-main').text()
    expect(mainText).toBe('300')
  })

  it('鼠标悬停在扇区上触发联动，动态更新中心文案与高亮样式', async () => {
    const wrapper = mount(AiPieChart, {
      props: {
        slices: sampleSlices,
      },
    })

    const slices = wrapper.findAll('.rc-pie-slice')
    expect(slices).toHaveLength(3)

    // 悬停在第 1 个扇区 (HTTP 403 阻断)
    await slices[0].trigger('mouseenter')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-pie-center-top').text()).toBe('HTTP 403 阻断')
    expect(wrapper.find('.rc-pie-center-main').text()).toContain('%')
    expect(wrapper.find('.rc-pie-center-bottom').text()).toBe('412 次 (32.8%)')
    expect(slices[0].classes()).toContain('active')

    // 鼠标移出后恢复默认
    await slices[0].trigger('mouseleave')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-pie-center-top').exists()).toBe(false)
  })

  it('鼠标悬停在图例行上同样支持双向高亮与中心详情联动', async () => {
    const wrapper = mount(AiPieChart, {
      props: {
        slices: sampleSlices,
      },
    })

    const legendRows = wrapper.findAll('.rc-pie-legend-row')
    await legendRows[1].trigger('mouseenter')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.rc-pie-center-top').text()).toBe('连接重置 (ConnectionReset)')
    expect(legendRows[1].classes()).toContain('active')

    await legendRows[1].trigger('mouseleave')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rc-pie-center-top').exists()).toBe(false)
  })
})
