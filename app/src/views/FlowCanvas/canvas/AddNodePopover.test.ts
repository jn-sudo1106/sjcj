// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import AddNodePopover from './AddNodePopover.vue'

describe('AddNodePopover', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })
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

  it('节点项可拖拽，并输出待插入的模板类型', async () => {
    const wrapper = mount(AddNodePopover, { props: { x: 100, y: 100 } })
    const browserItem = wrapper.findAll('.anp-item').find((item) => item.text().includes('浏览器抓取'))!

    await browserItem.trigger('dragstart')

    expect(browserItem.attributes('draggable')).toBe('true')
    expect(wrapper.emitted('dragstart')?.[0]?.[1]).toBe('browser-html')
  })

  it('点选条目时 pick 发出的是模板字符串（不是条目对象），新增节点才会落到正确模板', async () => {
    const wrapper = mount(AddNodePopover, { props: { x: 100, y: 100 } })

    // 文件下载行（字典映射后徽标为 95）：pick 载荷必须是 'file'，绝不能是条目对象——
    // 否则 TEMPLATE_TO_NODE[对象] 查不到，新增节点会回落 web-list 种子（标题「公告列表抓取」）。
    const fileItem = wrapper.findAll('.anp-item').find((item) => item.text().includes('文件下载'))!
    await fileItem.trigger('click')
    expect(wrapper.emitted('pick')?.[0]?.[0]).toBe('file')

    const webItem = wrapper.findAll('.anp-item').find((item) => item.text().includes('网页抓取'))!
    await webItem.trigger('click')
    expect(wrapper.emitted('pick')?.[1]?.[0]).toBe('web')
  })

  it('节点库中不再包含通用的「数据处理」节点类型（PROC 已去除）', () => {
    const wrapper = mount(AddNodePopover, { props: { x: 100, y: 100 } })
    const items = wrapper.findAll('.anp-item')
    const itemNames = items.map((item) => item.find('.anp-item-text b').text())
    const badges = wrapper.findAll('.anp-item-icon').map((item) => item.text())

    expect(itemNames).not.toContain('数据处理')
    expect(badges).not.toContain('PROC')
  })

  it('采集类条目按类型编号排序：「文件下载」(95) 紧跟「网页抓取」(90) 之后', () => {
    const wrapper = mount(AddNodePopover, { props: { x: 100, y: 100 } })
    const itemNames = wrapper.findAll('.anp-item').map((item) => item.text())
    const webIndex = itemNames.findIndex((t) => t.includes('网页抓取'))
    const fileIndex = itemNames.findIndex((t) => t.includes('文件下载'))
    expect(webIndex).toBeGreaterThanOrEqual(0)
    expect(fileIndex).toBe(webIndex + 1)
  })
})
