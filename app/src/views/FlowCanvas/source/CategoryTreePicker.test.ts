// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CategoryTreePicker from './CategoryTreePicker.vue'
import { sourceApi, type SourceCategory } from '@/api'

const categories: SourceCategory[] = [{
  id: 'fund', name: '基金类', count: 2, children: [
    { id: 'fund-comment', name: '支付宝评论', count: 1 },
  ],
}]

describe('CategoryTreePicker', () => {
  afterEach(() => vi.restoreAllMocks())

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

  describe('搜索（子级默认懒加载，搜索前要拉全）', () => {
    // 财经资讯 → 媒体 → 中央级媒体；财经资讯 → 部委。首屏只有根
    const tree: Record<string, SourceCategory[]> = {
      root: [{ id: 'fin', name: '财经资讯' }],
      fin: [{ id: 'media', name: '媒体' }, { id: 'dept', name: '部委' }],
      media: [{ id: 'central', name: '中央级媒体' }],
      dept: [],
      central: [],
    }
    const mockTree = () => vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => tree[parentId ?? 'root'].map((n) => ({ ...n })))

    it('没展开过的子级也能搜到：输入关键词时先把所有未加载的分类拉全', async () => {
      const spy = mockTree()
      const wrapper = mount(CategoryTreePicker, { props: { modelValue: { category: '', categoryPath: '' } } })
      await flushPromises()
      expect(wrapper.text()).not.toContain('媒体')

      await wrapper.get('.ctp-search').setValue('媒体')
      await flushPromises()

      expect(wrapper.text()).toContain('财经资讯')
      expect(wrapper.text()).toContain('媒体')
      expect(wrapper.text()).toContain('中央级媒体')
      expect(wrapper.text()).not.toContain('部委')
      expect(wrapper.text()).not.toContain('无匹配分类')
      // 每个分类只拉一次：根、fin、media、dept、central
      expect(spy.mock.calls.map((c) => c[0] ?? 'root').sort()).toEqual(['central', 'dept', 'fin', 'media', 'root'])
    })

    it('拉全只做一次：再次输入关键词不重复请求', async () => {
      const spy = mockTree()
      const wrapper = mount(CategoryTreePicker, { props: { modelValue: { category: '', categoryPath: '' } } })
      await flushPromises()
      await wrapper.get('.ctp-search').setValue('媒')
      await flushPromises()
      const calls = spy.mock.calls.length
      await wrapper.get('.ctp-search').setValue('部委')
      await flushPromises()
      expect(spy.mock.calls.length).toBe(calls)
      expect(wrapper.text()).toContain('部委')
    })

    it('加载期间提示「正在加载」而不是「无匹配分类」', async () => {
      mockTree()
      const wrapper = mount(CategoryTreePicker, { props: { modelValue: { category: '', categoryPath: '' } } })
      await flushPromises()
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => { release = r })
      vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async () => { await gate; return [] })
      await wrapper.get('.ctp-search').setValue('不存在')
      await wrapper.vm.$nextTick()
      expect(wrapper.get('.ctp-empty').text()).toContain('正在加载')
      release()
      await flushPromises()
      expect(wrapper.get('.ctp-empty').text()).toContain('无匹配分类')
    })

    it('某个分类拉取失败：不记为已加载，下次输入关键词重试', async () => {
      let failMedia = true
      const spy = vi.spyOn(sourceApi, 'sourceCategories').mockImplementation(async (parentId?: string) => {
        if (parentId === 'media' && failMedia) throw new Error('超时')
        return tree[parentId ?? 'root'].map((n) => ({ ...n }))
      })
      const wrapper = mount(CategoryTreePicker, { props: { modelValue: { category: '', categoryPath: '' } } })
      await flushPromises()
      await wrapper.get('.ctp-search').setValue('中央')
      await flushPromises()
      expect(wrapper.text()).not.toContain('中央级媒体')

      failMedia = false
      await wrapper.get('.ctp-search').setValue('中央级')
      await flushPromises()
      expect(wrapper.text()).toContain('中央级媒体')
      expect(spy.mock.calls.filter((c) => c[0] === 'media').length).toBe(2)
    })
  })
})
