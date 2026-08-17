// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CategoryTreePicker from './CategoryTreePicker.vue'
import { sourceApi, type SourceCategory } from '@/api'

const categories: SourceCategory[] = [{
  id: 'fund', name: '基金类', count: 2, children: [
    { id: 'fund-comment', name: '支付宝评论', count: 1 },
  ],
}]

describe('CategoryTreePicker', () => {
  it('点击二级分类会写回选择值', async () => {
    vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue(categories)
    const wrapper = mount(CategoryTreePicker, {
      props: { modelValue: { category: '', categoryPath: '' } },
    })
    await flushPromises()

    await wrapper.findAll('[role="radio"]')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([{ dirId: 'fund-comment', category: '支付宝评论', categoryPath: 'fund-comment' }])
  })

  it('首屏只有根分类时，展开会按 parentId 懒加载子分类', async () => {
    const sourceCategories = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => (
      parentId ? [{ id: 'fund-comment', name: '支付宝评论', count: 1 }] : [{ id: 'fund', name: '基金类' }]
    ))
    const wrapper = mount(CategoryTreePicker, {
      props: { modelValue: { category: '', categoryPath: '' } },
    })
    await flushPromises()

    await wrapper.find('.ctp-toggle').trigger('click')
    await flushPromises()

    expect(sourceCategories).toHaveBeenLastCalledWith('fund')
    expect(wrapper.text()).toContain('支付宝评论')
  })

  it('分类计数缺失时不展示空括号', async () => {
    vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([{ id: 'fund', name: '基金类' }])
    const wrapper = mount(CategoryTreePicker, {
      props: { modelValue: { category: '', categoryPath: '' } },
    })
    await flushPromises()

    expect(wrapper.text()).not.toContain('（）')
  })
})
