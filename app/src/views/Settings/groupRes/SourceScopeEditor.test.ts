// 源数据权限范围编辑器：钉住「双栏对齐 + 已选标记 + 全选/清空/整目录」这套交互口径，
// 以及几条容易回退的规则（覆盖态禁用快捷动作、整目录收掉子级选择、回显目录最小化）。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

vi.mock('@/api/groupSourceScope', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    listScopeCategories: vi.fn(async () => [
      { id: 'd1', name: '业务分类', parentId: null, level: 1, directCount: 0, subtreeCount: 16, hasChildren: true },
      { id: 'd1a', name: 'ctrip', parentId: 'd1', level: 2, directCount: 10, subtreeCount: 10, hasChildren: false },
      { id: 'd1b', name: 'pufa', parentId: 'd1', level: 2, directCount: 6, subtreeCount: 6, hasChildren: false },
      { id: 'd2', name: '财经资讯', parentId: null, level: 1, directCount: 26, subtreeCount: 26, hasChildren: false },
    ]),
    listCategorySources: vi.fn(async (id: string) => ({
      total: id === 'd1a' ? 3 : 0,
      list: id === 'd1a'
        ? [{ id: 's1', name: '源一' }, { id: 's2', name: '源二' }, { id: 's3', name: '源三' }]
        : [],
    })),
  }
})

import SourceScopeEditor from './SourceScopeEditor.vue'
import { listCategorySources, listScopeCategories } from '@/api/groupSourceScope'
import type { SourceGrant } from '@/api/groupSourceScope'

const grant = (over: Partial<SourceGrant> = {}): SourceGrant => ({ dirIds: [], sourceIds: [], ...over })

async function mountEditor(props: Partial<{ grant: SourceGrant; kind: 'accept' | 'reject'; disabled: boolean }> = {}) {
  const wrapper = mount(SourceScopeEditor, {
    props: { grant: grant(), kind: 'accept', ...props },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  return wrapper
}
type EditorWrapper = Awaited<ReturnType<typeof mountEditor>>

const dirRow = (wrapper: EditorWrapper, id: string) =>
  wrapper.find(`[data-dir="${id}"]`)
const srcRow = (wrapper: EditorWrapper, id: string) =>
  wrapper.find(`[data-src="${id}"]`)
const pill = (wrapper: EditorWrapper, id: string) =>
  wrapper.find(`[data-dir-pill="${id}"]`)
const headBtn = (wrapper: EditorWrapper, testid: string) =>
  wrapper.find(`[data-testid="${testid}"]`)
const emittedGrant = (wrapper: EditorWrapper): SourceGrant =>
  wrapper.emitted('update:grant')!.at(-1)![0] as SourceGrant

beforeEach(() => {
  vi.mocked(listScopeCategories).mockClear()
  vi.mocked(listCategorySources).mockClear()
})

describe('SourceScopeEditor', () => {
  it('挂载即一次拉全量目录，并自动聚焦第一个有直属源的目录去取源', async () => {
    const wrapper = await mountEditor()
    expect(listScopeCategories).toHaveBeenCalledTimes(1)
    expect(dirRow(wrapper, 'd1').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sse-focus-dir"]').text()).toContain('ctrip')
    expect(listCategorySources).toHaveBeenCalledWith('d1a', expect.objectContaining({ allSub: false }))
  })

  it('点目录行=聚焦并取该目录的源；已有选择原样保留（不会冲掉回显）', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['d2'], sourceIds: ['s1'] }) })
    await dirRow(wrapper, 'd1b').trigger('click')
    await flushPromises()
    expect(listCategorySources).toHaveBeenCalledWith('d1b', expect.anything())
    expect(dirRow(wrapper, 'd2').classes()).toContain('sel')
    expect(dirRow(wrapper, 'd1b').classes()).toContain('focus')
  })

  it('整目录胶囊：选中=实心带勾、再点取消；子目录不会残留在选择里', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['d1a'] }) })
    await pill(wrapper, 'd1').trigger('click')
    const next = emittedGrant(wrapper)
    expect(next.dirIds).toEqual(['d1'])

    const wrapper2 = await mountEditor({ grant: grant({ dirIds: ['d1'] }) })
    expect(dirRow(wrapper2, 'd1').classes()).toContain('sel')
    expect(pill(wrapper2, 'd1').text()).toContain('✓')
  })

  it('被整目录覆盖的目录：其源行标「随整目录」且不可点，全选/清空禁用', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['d1'] }) })
    await dirRow(wrapper, 'd1a').trigger('click')
    await flushPromises()
    expect(srcRow(wrapper, 's1').classes()).toContain('cov')
    expect(wrapper.find('[data-src-pill="s1"]').text()).toContain('随整目录')
    expect(headBtn(wrapper, 'sse-select-all').attributes('disabled')).toBeDefined()
    expect(headBtn(wrapper, 'sse-clear').attributes('disabled')).toBeDefined()
  })

  it('全选本目录源=一次并入该目录全部源 ID；清空=按目录移除且不动其它目录与整目录选择', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['d2'], sourceIds: ['other'] }) })
    await headBtn(wrapper, 'sse-select-all').trigger('click')
    expect(emittedGrant(wrapper).sourceIds.sort()).toEqual(['other', 's1', 's2', 's3'])

    // 组件只 emit，选择结果由父级回灌（v-model）；回灌后左栏该目录徽标变成 已选/总数
    await wrapper.setProps({ grant: grant({ dirIds: ['d2'], sourceIds: ['other', 's1', 's2', 's3'] }) })
    expect(dirRow(wrapper, 'd1a').find('.badge').text()).toBe('3/3')

    await wrapper.setProps({ grant: grant({ dirIds: ['d2'], sourceIds: ['other', 's1', 's2'] }) })
    await headBtn(wrapper, 'sse-clear').trigger('click')
    expect(emittedGrant(wrapper).sourceIds).toEqual(['other'])
    expect(emittedGrant(wrapper).dirIds).toEqual(['d2'])
  })

  it('清空按钮带条数、已选满时禁用全选（对齐原型的状态机）', async () => {
    const wrapper = await mountEditor({ grant: grant({ sourceIds: ['s1'] }) })
    expect(headBtn(wrapper, 'sse-clear').text()).toContain('(1)')
    await wrapper.setProps({ grant: grant({ sourceIds: ['s1', 's2', 's3'] }) })
    expect(headBtn(wrapper, 'sse-select-all').attributes('disabled')).toBeDefined()
  })

  it('目录搜索只过滤目录并自动带出父链；命中为空时给空态', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="sse-dir-kw"]').setValue('pu')
    expect(dirRow(wrapper, 'd1').exists()).toBe(true)
    expect(dirRow(wrapper, 'd1b').exists()).toBe(true)
    expect(dirRow(wrapper, 'd1a').exists()).toBe(false)
    await wrapper.find('[data-testid="sse-dir-kw"]').setValue('zzz')
    expect(wrapper.find('.sse-empty').text()).toContain('无匹配目录')
  })

  it('源搜索在本目录内过滤；回显的展开目录按目录树收敛成最小集', async () => {
    const wrapper = await mountEditor({ grant: grant({ sourceIds: ['s2'] }) })
    await wrapper.find('[data-testid="sse-src-kw"]').setValue('源三')
    expect(srcRow(wrapper, 's3').exists()).toBe(true)
    expect(srcRow(wrapper, 's1').exists()).toBe(false)

    // 存量 STRUCT 规则回显的是展开后的全量目录（remarks.roots 缺失），不能把每个后代都显示成已选整目录
    const wrapper2 = await mountEditor({ grant: grant({ dirIds: ['d1', 'd1a', 'd1b'] }) })
    expect(emittedGrant(wrapper2).dirIds).toEqual(['d1'])
  })

  it('disabled 时所有写操作控件禁用（非 admin 只能看）', async () => {
    const wrapper = await mountEditor({ disabled: true })
    expect(headBtn(wrapper, 'sse-whole').attributes('disabled')).toBeDefined()
    expect(pill(wrapper, 'd1').attributes('disabled')).toBeDefined()
  })

  it('支持全部展开与全部折叠目录树', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="sse-collapse-all"]').trigger('click')
    await flushPromises()
    expect(dirRow(wrapper, 'd1a').exists()).toBe(false)

    await wrapper.find('[data-testid="sse-expand-all"]').trigger('click')
    await flushPromises()
    expect(dirRow(wrapper, 'd1a').exists()).toBe(true)
  })

  it('源列表超出单次渲染上限时支持加载更多', async () => {
    const manySources = Array.from({ length: 250 }, (_, i) => ({ id: `s_${i + 1}`, name: `源${i + 1}` }))
    vi.mocked(listCategorySources).mockResolvedValueOnce({ total: 250, list: manySources })
    const wrapper = await mountEditor()
    await dirRow(wrapper, 'd1a').trigger('click')
    await flushPromises()

    const loadMoreBtn = wrapper.find('[data-testid="sse-load-more"]')
    expect(loadMoreBtn.exists()).toBe(true)
    expect(loadMoreBtn.text()).toContain('加载更多 (50)')

    await loadMoreBtn.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sse-load-more"]').exists()).toBe(false)
  })
})
