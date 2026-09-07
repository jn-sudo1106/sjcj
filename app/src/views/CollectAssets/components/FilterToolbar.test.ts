// FilterToolbar 单元测试：分类筛选树形多选（多级目录数据 + 懒加载契约 + 勾选/清空回传）
// 背景：旧分类接口首屏只返回根节点，此前平铺下拉只展示一级目录；树化后子级按 parentId 懒加载，
// 多选复选框用 Element Plus 标准样式（与全站 el-checkbox 一致），父子独立勾选（check-strictly）。
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import FilterToolbar from './FilterToolbar.vue'
import { sourceApi, type SourceCategory } from '@/api'

const categories: SourceCategory[] = [
  { id: '/基金类', name: '基金类', count: 3, children: [
    { id: '/基金类/雪球', name: '雪球' },
  ] },
  { id: '/舆情类', name: '舆情类' }, // 无预取子级：展开走懒加载
]

function mountToolbar() {
  return mount(FilterToolbar, {
    props: {
      keyword: '',
      categoryFilter: [] as string[],
      tagFilter: '',
      stateFilter: 'all',
      sortBy: 'updated',
      categories,
      allTags: [],
      total: 0,
      stats: { total: 0, error: 0, notify: 0 },
      view: 'card',
    },
    global: { plugins: [ElementPlus] },
  })
}

describe('FilterToolbar 分类树（多选）', () => {
  it('分类筛选渲染为树形多选下拉：多级数据进树 + 懒加载 + 父子独立勾选', () => {
    const wrapper = mountToolbar()
    const treeSelect = wrapper.findComponent({ name: 'ElTreeSelect' })
    expect(treeSelect.exists()).toBe(true)
    // 两级数据原样进树（不是只取根节点再拼平铺选项）
    expect(treeSelect.props('data')).toEqual(categories)
    expect(typeof treeSelect.props('load')).toBe('function')
    // 多选；check-strictly：子级懒加载下级联勾选会漏掉未加载的孙级 ID
    expect(treeSelect.props('multiple')).toBe(true)
    expect(treeSelect.props('checkStrictly')).toBe(true)
  })

  it('展开未加载的节点按 parentId 拉子级；已有 children 的节点直接复用不发请求', async () => {
    const wrapper = mountToolbar()
    const load = wrapper.findComponent({ name: 'ElTreeSelect' }).props('load') as
      (node: { level: number; data: SourceCategory }, resolve: (nodes: SourceCategory[]) => void) => Promise<void> | void
    const spy = vi.spyOn(sourceApi, 'sourceCategories').mockResolvedValue([{ id: '/舆情类/微博', name: '微博' }])

    // 已有 children（列表页预取的一层）：直接 resolve，不请求
    const resolveCached = vi.fn()
    load({ level: 1, data: categories[0]! }, resolveCached)
    expect(resolveCached).toHaveBeenCalledWith(categories[0]!.children)
    expect(spy).not.toHaveBeenCalled()

    // 无 children：按 parentId 请求子级
    const resolveRemote = vi.fn()
    await load({ level: 1, data: categories[1]! }, resolveRemote)
    expect(spy).toHaveBeenCalledWith('/舆情类')
    expect(resolveRemote).toHaveBeenCalledWith([{ id: '/舆情类/微博', name: '微博' }])
    spy.mockRestore()
  })

  it('勾选分类回传 id 数组并触发查询；清空回传空数组', async () => {
    const wrapper = mountToolbar()
    const treeSelect = wrapper.findComponent({ name: 'ElTreeSelect' })

    await treeSelect.vm.$emit('update:modelValue', ['/基金类/雪球', '/舆情类'])
    expect(wrapper.emitted('update:categoryFilter')?.[0]).toEqual([['/基金类/雪球', '/舆情类']])
    expect(wrapper.emitted('filterChange')).toHaveLength(1)

    await treeSelect.vm.$emit('update:modelValue', [])
    expect(wrapper.emitted('update:categoryFilter')?.[1]).toEqual([[]])
    expect(wrapper.emitted('filterChange')).toHaveLength(2)
  })
})
