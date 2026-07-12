// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AddNodePopover from './AddNodePopover.vue'

describe('AddNodePopover', () => {
  it('英文节点类型码在徽标中显示为数字序号', () => {
    const wrapper = mount(AddNodePopover, {
      props: { x: 100, y: 100 },
    })

    const items = wrapper.findAll('.anp-item')
    const browserItem = items.find((item) => item.text().includes('浏览器抓取'))!
    const wechatItem = items.find((item) => item.text().includes('公众号抓取'))!
    const badges = wrapper.findAll('.anp-item-icon').map((item) => item.text())

    expect(browserItem.find('.anp-item-icon').text()).toMatch(/^\d+$/)
    expect(wechatItem.find('.anp-item-icon').text()).toMatch(/^\d+$/)
    expect(badges).not.toContain('BROWSER')
    expect(badges).not.toContain('WECHAT')
  })
})
