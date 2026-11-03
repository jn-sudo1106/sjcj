// 源数据权限范围编辑器。
// 这里 mock 到最底层的 @/api（sourceCategories / sourcePaged），所以 api/sourceDirs 的真逻辑
//（两套目录的根层口径、-1/-2 特殊根过滤、搜索结果按 kind 归类、模块级缓存）也一并被跑到。
//
// 钉住的口径（2026-11-02 改）：cfg_category 一张表里两套目录，取源方式不同 ——
// 系统目录是源上的单个 CATEGORY_ID，业务目录的成员只在 cfg_category_source_bind。
// 编辑器必须按 kind 走 sourcePaged 的 directory{includeDescendants}，
// 否则业务目录（如「产业数据」）点进去永远是空的，用户会以为该目录没有源。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const sysRoots = [
    { id: '-1', name: '视图目录', parentId: '' },
    { id: '-2', name: '业务分类', parentId: '' },
    { id: 's1', name: '财经', parentId: '' },
    { id: 's2', name: '政经', parentId: '' },
  ]
  const bizRoots = [
    { id: '9001', name: '产业数据', parentId: '-2' },
    { id: '9002', name: '公众号', parentId: '-2' },
  ]
  const kids: Record<string, { id: string; name: string; parentId: string }[]> = {
    s1: [{ id: 's1a', name: '上市公司', parentId: 's1' }],
    '9001': [{ id: '9011', name: '汽车', parentId: '9001' }],
  }
  // 业务目录里 9001 的源在关系表；includeDescendants=true 时后端连子目录 9011 的成员一起给
  const sources: Record<string, { id: string; name: string }[]> = {
    'biz:9001': [{ id: 'b1', name: '产业源一' }, { id: 'b2', name: '产业源二' }, { id: 'b3', name: '汽车资讯' }],
    'biz:9011': [{ id: 'b3', name: '汽车资讯' }],
    'biz:9002': [{ id: 'b4', name: '财联社电头' }],
    'sys:s1': [{ id: 'x1', name: '财经网' }],
    'sys:s1a': [{ id: 'x2', name: '上交所公告' }],
    'sys:s2': [],
  }
  return {
    ...actual,
    sourceApi: {
      ...(actual as { sourceApi: Record<string, unknown> }).sourceApi,
      sourceCategories: vi.fn(async (parentId?: string) => {
        if (parentId === undefined) return sysRoots
        if (parentId === '-2') return bizRoots
        return kids[parentId] ?? []
      }),
      categoryById: vi.fn(async () => null),
      searchCategories: vi.fn(async (keyword: string) => [
        { id: '9011', name: keyword, parentId: '9001', path: '-2,9001,' },
        { id: 's1a', name: `${keyword}系统`, parentId: 's1', path: 's1,' },
      ]),
      sourcePaged: vi.fn(async (p?: Record<string, unknown>) => {
        const directory = p?.directory as { kind: string; selections: { id: string }[] } | undefined
        const rows = directory ? sources[`${directory.kind}:${directory.selections[0]?.id}`] ?? [] : []
        return { total: rows.length, list: rows.map((row) => ({ sourceId: row.id, name: row.name })) }
      }),
    },
  }
})

import SourceScopeEditor from './SourceScopeEditor.vue'
import { sourceApi } from '@/api'
import { resetSourceDirCache } from '@/api/sourceDirs'
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

const dirRow = (wrapper: EditorWrapper, id: string) => wrapper.find(`[data-dir="${id}"]`)
const srcRow = (wrapper: EditorWrapper, id: string) => wrapper.find(`[data-src="${id}"]`)
/** 勾选框是原生 input（同源管理左侧一致），checked / indeterminate 直接读 DOM 属性 */
const dirCheck = (wrapper: EditorWrapper, id: string) => wrapper.find<HTMLInputElement>(`[data-dir-check="${id}"]`)
const srcCheck = (wrapper: EditorWrapper, id: string) => wrapper.find<HTMLInputElement>(`[data-src-check="${id}"]`)
const headBtn = (wrapper: EditorWrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`)
const emittedGrant = (wrapper: EditorWrapper): SourceGrant =>
  wrapper.emitted('update:grant')!.at(-1)![0] as SourceGrant
/** 展开某一层子级（懒加载，箭头没开才点；勾选父级时组件已经替用户展开了） */
async function expand(wrapper: EditorWrapper, id: string) {
  const caret = dirRow(wrapper, id).find('.caret.btn')
  if (!caret.classes('open')) await caret.trigger('click')
  await flushPromises()
}

const lastDirectory = () => vi.mocked(sourceApi.sourcePaged).mock.calls.at(-1)?.[0] as {
  directory: { kind: string; mode: string; selections: { id: string; includeDescendants: boolean }[] }
}
beforeEach(() => {
  // api/sourceDirs 的树缓存是模块级的，不清会把上一个用例的目录结构带进来
  resetSourceDirCache()
  vi.mocked(sourceApi.sourceCategories).mockClear()
  vi.mocked(sourceApi.sourcePaged).mockClear()
  vi.mocked(sourceApi.searchCategories).mockClear()
})

describe('SourceScopeEditor', () => {
  it('默认进业务目录，取源按 directory{kind:biz,includeDescendants:true} 走关系表口径', async () => {
    const wrapper = await mountEditor()

    expect(headBtn(wrapper, 'sse-kind-biz').classes()).toContain('on')
    expect(dirRow(wrapper, '9001').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sse-focus-dir"]').text()).toContain('产业数据')
    // 子目录 9011 的成员 b3 也在列表里：这就是「业务分类查不到源」修完的样子
    expect(srcRow(wrapper, 'b3').exists()).toBe(true)
    expect(lastDirectory().directory).toEqual({ kind: 'biz', mode: 'selected', selections: [{ id: '9001', includeDescendants: true }] })
  })

  it('切到系统目录：特殊根 -1/-2 不进列表，取源换成 kind=sys', async () => {
    const wrapper = await mountEditor()
    await headBtn(wrapper, 'sse-kind-sys').trigger('click')
    await flushPromises()

    const labels = wrapper.findAll('[data-dir]').map((row) => row.text())
    expect(labels).toEqual(['财经', '政经'])
    await dirRow(wrapper, 's1').trigger('click')
    await flushPromises()
    expect(lastDirectory().directory.kind).toBe('sys')
    expect(srcRow(wrapper, 'x1').exists()).toBe(true)
  })

  it('勾选目录=写入 dirIds；父级已授权时自动展开，展开出来的子级勾选框禁用', async () => {
    const wrapper = await mountEditor()
    await dirCheck(wrapper, '9001').setValue(true)
    expect(emittedGrant(wrapper).dirIds).toEqual(['9001'])

    // 真实页面是 v-model 回灌的，用例照着把选择结果喂回去；子级行是勾上时自动取回来展开的
    await wrapper.setProps({ grant: grant({ dirIds: ['9001'] }) })
    await vi.waitFor(() => {
      expect(dirCheck(wrapper, '9011').attributes('disabled')).toBeDefined()
    }, { timeout: 2000, interval: 20 })
  })

  it('存量规则父级与子级都存着时，展开子级把冗余的子级条目收敛掉', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9001', '9011'] }) })
    await expand(wrapper, '9001')
    expect(emittedGrant(wrapper).dirIds).toEqual(['9001'])
  })

  it('三态：只勾满一部分显示半选，子树全覆盖才显示勾', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9011'] }) })
    await expand(wrapper, '9001')
    // 子目录的成员要看得到才算数：没取过 9011 的源时，不敢替它说「父级也全覆盖了」
    await dirRow(wrapper, '9011').trigger('click')
    await flushPromises()
    expect(dirCheck(wrapper, '9001').element.indeterminate).toBe(true)
    expect(dirCheck(wrapper, '9001').element.checked).toBe(false)

    // 父目录自己的两个源也单独选上 → 子树全覆盖 → 父级显示勾
    await wrapper.setProps({ grant: grant({ dirIds: ['9011'], sourceIds: ['b1', 'b2'] }) })
    expect(dirCheck(wrapper, '9001').element.checked).toBe(true)
    expect(dirRow(wrapper, '9001').classes()).toContain('sel')
  })

  it('点勾满的父级=整棵子树一起取消（目录条目与子树里单独选中的源都不留）', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9011'], sourceIds: ['b1', 'b2'] }) })
    await expand(wrapper, '9001')
    await dirRow(wrapper, '9011').trigger('click')
    await flushPromises()
    expect(dirCheck(wrapper, '9001').element.checked).toBe(true)

    await dirCheck(wrapper, '9001').setValue(false)
    const next = emittedGrant(wrapper)
    expect(next.dirIds).toEqual([])
    expect(next.sourceIds).toEqual([])
  })

  it('被上级目录覆盖时：源行显示已勾选且禁用，全选/清空禁用、点行不改选择', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9001'] }) })
    await expand(wrapper, '9001')
    await dirRow(wrapper, '9011').trigger('click')
    await flushPromises()

    expect(srcRow(wrapper, 'b3').classes()).toContain('cov')
    expect(srcCheck(wrapper, 'b3').element.checked).toBe(true)
    expect(srcCheck(wrapper, 'b3').attributes('disabled')).toBeDefined()
    expect(headBtn(wrapper, 'sse-select-all').attributes('disabled')).toBeDefined()
    expect(headBtn(wrapper, 'sse-clear').attributes('disabled')).toBeDefined()

    await srcRow(wrapper, 'b3').trigger('click')
    expect(wrapper.emitted('update:grant')).toBeUndefined()
  })

  it('源行是三列（勾选框 / 源 ID / 源名称），点勾选框=单独加入且不动目录勾选', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9002'] }) })
    const row = srcRow(wrapper, 'b1')
    expect(row.find('input[type=checkbox]').exists()).toBe(true)
    expect(row.find('.col-id').text()).toBe('#b1')
    expect(row.find('.col-nm').text()).toBe('产业源一')
    expect(row.findAll('button')).toHaveLength(0)

    await srcCheck(wrapper, 'b1').setValue(true)
    const next = emittedGrant(wrapper)
    expect(next.dirIds).toEqual(['9002'])
    expect(next.sourceIds).toEqual(['b1'])
  })

  // 右栏的源筛选：报源 ID 也要能定位到（源 ID 就是列表那一列），大小写不敏感
  it('源搜索按名称或源 ID 过滤', async () => {
    const wrapper = await mountEditor()
    const kw = wrapper.find('[data-testid="sse-src-kw"]')

    await kw.setValue('b2')
    expect(wrapper.findAll('[data-src]').map((row) => row.attributes('data-src'))).toEqual(['b2'])

    await kw.setValue('B3')
    expect(wrapper.findAll('[data-src]').map((row) => row.attributes('data-src'))).toEqual(['b3'])

    await kw.setValue('产业源')
    expect(wrapper.findAll('[data-src]').map((row) => row.attributes('data-src'))).toEqual(['b1', 'b2'])

    await kw.setValue('不存在')
    expect(wrapper.find('.sse-empty').text()).toBe('无匹配源')
  })

  it('全选=并入本目录含子级的全部源；清空=按目录移除且不动目录勾选与其它目录的源', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9002'], sourceIds: ['other'] }) })
    await headBtn(wrapper, 'sse-select-all').trigger('click')
    expect(emittedGrant(wrapper).sourceIds.sort()).toEqual(['b1', 'b2', 'b3', 'other'])

    await wrapper.setProps({ grant: grant({ dirIds: ['9002'], sourceIds: ['other', 'b1', 'b2'] }) })
    expect(headBtn(wrapper, 'sse-clear').text()).toContain('清空 (2)')
    await headBtn(wrapper, 'sse-clear').trigger('click')
    expect(emittedGrant(wrapper).sourceIds).toEqual(['other'])
    expect(emittedGrant(wrapper).dirIds).toEqual(['9002'])
  })

  it('左栏搜索跨层级，但只留当前这套目录的命中', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="sse-dir-kw"]').setValue('汽车')
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-dir]').map((row) => row.attributes('data-dir'))).toEqual(['9011'])
    }, { timeout: 4000, interval: 30 })

    await headBtn(wrapper, 'sse-kind-sys').trigger('click')
    await wrapper.find('[data-testid="sse-dir-kw"]').setValue('上市公司')
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-dir]').map((row) => row.attributes('data-dir'))).toEqual(['s1a'])
    }, { timeout: 4000, interval: 30 })
  })

  it('业务目录还没有目录时退到系统目录，不把左栏留空', async () => {
    // 只影响这两次取根层的调用，别把默认实现换掉（会串到后面的用例）
    vi.mocked(sourceApi.sourceCategories)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 's1', name: '财经', parentId: '' }])
    const wrapper = await mountEditor()
    expect(headBtn(wrapper, 'sse-kind-sys').classes()).toContain('on')
    expect(dirRow(wrapper, 's1').exists()).toBe(true)
  })

  it('disabled 时所有写操作控件禁用（非 admin 只能看）', async () => {
    const wrapper = await mountEditor({ disabled: true })
    expect(dirCheck(wrapper, '9001').attributes('disabled')).toBeDefined()
    expect(srcCheck(wrapper, 'b1').attributes('disabled')).toBeDefined()
    expect(headBtn(wrapper, 'sse-select-all').attributes('disabled')).toBeDefined()
    expect(headBtn(wrapper, 'sse-clear').attributes('disabled')).toBeDefined()
  })

  it('源列表超出单次渲染上限时支持加载更多', async () => {
    // 这一条直接给 sourcePaged 的返回形状（sourceId/name），因为被测的是渲染分页而不是映射层
    const many = Array.from({ length: 250 }, (_, i) => ({ sourceId: `s_${i + 1}`, name: `源${i + 1}` }))
    vi.mocked(sourceApi.sourcePaged).mockResolvedValueOnce({ total: 250, list: many } as never)
    const wrapper = await mountEditor()

    const loadMoreBtn = headBtn(wrapper, 'sse-load-more')
    expect(loadMoreBtn.exists()).toBe(true)
    expect(loadMoreBtn.text()).toContain('加载更多 (50)')

    await loadMoreBtn.trigger('click')
    await flushPromises()
    expect(headBtn(wrapper, 'sse-load-more').exists()).toBe(false)
  })
})
