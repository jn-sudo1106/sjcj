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

function mountToolbar(extra: Record<string, unknown> = {}) {
  return mount(FilterToolbar, {
    props: {
      keyword: '',
      categoryFilter: [] as string[],
      tagFilter: '',
      categories,
      allTags: [],
      total: 0,
      stats: { total: 0, error: 0, notify: 0 },
      view: 'card',
      ...extra,
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

  // 0924-03：分类维护迁到「系统设置 → 分类目录」，下拉底部不再有入口（Q3：直接删，不留跳转）
  it('全部分类下拉底部不再有「管理分类」入口', () => {
    const wrapper = mountToolbar()
    const treeSelect = wrapper.findComponent({ name: 'ElTreeSelect' })
    expect(treeSelect.vm.$slots.footer).toBeUndefined()
    expect(wrapper.text()).not.toContain('管理分类')
  })

})

// 0924-01：排序下拉、「全部状态」下拉去掉；「只看有异常源的网站」改由点「出错源」切换
describe('FilterToolbar · 0924-01 精简', () => {
  it('不再有排序下拉和状态下拉：下拉只剩分类树和标签', () => {
    const wrapper = mountToolbar()
    expect(wrapper.find('[data-testid="site-sort"]').exists()).toBe(false)
    // 分类树（el-tree-select）内部自带一个 ElSelect，所以按 placeholder 认
    const placeholders = wrapper.findAllComponents({ name: 'ElSelect' }).map((s) => s.props('placeholder'))
    expect(placeholders).toEqual(['全部分类', '全部标签'])
    expect(wrapper.text()).not.toContain('全部状态')
  })

  it('点「出错源」发 toggleErrorOnly；未选中时不可关闭', async () => {
    const wrapper = mountToolbar({ stats: { total: 10, error: 3, notify: 0 } })
    const tag = wrapper.get('[data-testid="stat-error-toggle"]')
    expect(tag.attributes('aria-pressed')).toBe('false')
    expect(tag.find('.el-tag__close').exists()).toBe(false)
    await tag.trigger('click')
    expect(wrapper.emitted('toggleErrorOnly')).toHaveLength(1)
  })

  it('选中态出现 ×，点 × 同样切回（且不重复触发）', async () => {
    const wrapper = mountToolbar({ stats: { total: 10, error: 3, notify: 0 }, errorOnly: true })
    const tag = wrapper.get('[data-testid="stat-error-toggle"]')
    expect(tag.attributes('aria-pressed')).toBe('true')
    await tag.get('.el-tag__close').trigger('click')
    expect(wrapper.emitted('toggleErrorOnly')).toHaveLength(1)
  })

  it('没有出错源时不显示；但选中态下即使为 0 也要留着，不然没法取消', () => {
    expect(mountToolbar().find('[data-testid="stat-error-toggle"]').exists()).toBe(false)
    expect(mountToolbar({ errorOnly: true }).find('[data-testid="stat-error-toggle"]').exists()).toBe(true)
  })
})
