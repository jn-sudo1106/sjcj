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
/** 列头行的全选勾选框（原生 input，和左栏目录行同一套三态） */
const srcAllCheck = (wrapper: EditorWrapper) => wrapper.find<HTMLInputElement>('[data-testid="sse-src-check-all"]')
const headBtn = (wrapper: EditorWrapper, testid: string) => wrapper.find(`[data-testid="${testid}"]`)
const emittedGrant = (wrapper: EditorWrapper): SourceGrant =>
  wrapper.emitted('update:grant')!.at(-1)![0] as SourceGrant
/** 展开某一层子级（懒加载，箭头没开才点；勾选父级时组件已经替用户展开了） */
async function expand(wrapper: EditorWrapper, id: string) {
  const caret = dirRow(wrapper, id).find('.caret.btn')
  if (!caret.classes('open')) await caret.trigger('click')
  await flushPromises()
}
/** 点左栏目录把右栏的源取回来（首屏不自动聚焦，右栏用例都要先走这一步） */
async function focusOn(wrapper: EditorWrapper, id: string) {
  await dirRow(wrapper, id).trigger('click')
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

    expect(headBtn(wrapper, 'sse-dir-kind').text()).toBe('业务目录')
    expect(dirRow(wrapper, '9001').exists()).toBe(true)
    // 首屏不自动聚焦：一个目录最多取 2000 条源，进页面就取会拖慢左栏的树
    expect(vi.mocked(sourceApi.sourcePaged)).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="sse-focus-dir"]').text()).toContain('未选择目录')
    expect(wrapper.find('.sse-srcs .sse-empty').text()).toBe('在左侧点一个目录')

    await focusOn(wrapper, '9001')
    expect(wrapper.find('[data-testid="sse-focus-dir"]').text()).toContain('产业数据')
    // 子目录 9011 的成员 b3 也在列表里：这就是「业务分类查不到源」修完的样子
    expect(srcRow(wrapper, 'b3').exists()).toBe(true)
    expect(lastDirectory().directory).toEqual({ kind: 'biz', mode: 'selected', selections: [{ id: '9001', includeDescendants: true }] })
  })

  it('点过的目录源结果留着，重复点不再打第二次请求', async () => {
    const wrapper = await mountEditor()
    await focusOn(wrapper, '9001')
    await focusOn(wrapper, '9002')
    expect(vi.mocked(sourceApi.sourcePaged)).toHaveBeenCalledTimes(2)

    await focusOn(wrapper, '9001')
    expect(vi.mocked(sourceApi.sourcePaged)).toHaveBeenCalledTimes(2)
    expect(srcRow(wrapper, 'b1').exists()).toBe(true)
  })

  it('不展示系统目录：左栏只有 -2 下的业务树，也不会按 kind=sys 取源', async () => {
    const wrapper = await mountEditor()

    expect(wrapper.find('[data-testid="sse-kind-sys"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-dir]').map((row) => row.text())).toEqual(['产业数据', '公众号'])
    expect(dirRow(wrapper, 's1').exists()).toBe(false)
    // 根层只取 -2 的子级（系统目录的根层是 parentId=undefined 那次调用）
    expect(vi.mocked(sourceApi.sourceCategories).mock.calls.every(([parentId]) => parentId !== undefined)).toBe(true)
  })

  it('勾选目录=写入 dirIds；父级已授权时自动展开，展开出来的子级显示成已勾选', async () => {
    const wrapper = await mountEditor()
    await dirCheck(wrapper, '9001').setValue(true)
    expect(emittedGrant(wrapper).dirIds).toEqual(['9001'])

    // 真实页面是 v-model 回灌的，用例照着把选择结果喂回去；子级行是勾上时自动取回来展开的
    await wrapper.setProps({ grant: grant({ dirIds: ['9001'] }) })
    await vi.waitFor(() => {
      const kid = dirCheck(wrapper, '9011')
      // 子级不在 dirIds 里（上级展开本来含它），但视觉上必须读成「已勾」：置灰会让人以为它没进权限
      expect(kid.element.checked).toBe(true)
      expect(kid.attributes('aria-disabled')).toBe('true')
      expect(kid.attributes('disabled')).toBeUndefined()
      expect(dirRow(wrapper, '9011').classes()).toContain('sel')
    }, { timeout: 2000, interval: 20 })

    // 点这个「已勾」不给改：要单独调子级得先取消上级目录
    const emissions = wrapper.emitted('update:grant')?.length ?? 0
    await dirCheck(wrapper, '9011').setValue(false)
    expect(wrapper.emitted('update:grant')?.length ?? 0).toBe(emissions)
  })

  it('存量规则父级与子级都存着时，展开子级把冗余的子级条目收敛掉', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9001', '9011'] }) })
    await expand(wrapper, '9001')
    expect(emittedGrant(wrapper).dirIds).toEqual(['9001'])
  })

  it('三态：只勾满一部分显示半选，子树全覆盖才显示勾', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9011'] }) })
    await expand(wrapper, '9001')
    // 父目录的源要取回来才判得成「子树全覆盖」
    await focusOn(wrapper, '9001')
    // 子目录的成员也要看得到才算数：没取过 9011 的源时，不敢替它说「父级也全覆盖了」
    await focusOn(wrapper, '9011')
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
    await focusOn(wrapper, '9001')
    await focusOn(wrapper, '9011')
    expect(dirCheck(wrapper, '9001').element.checked).toBe(true)

    await dirCheck(wrapper, '9001').setValue(false)
    const next = emittedGrant(wrapper)
    expect(next.dirIds).toEqual([])
    expect(next.sourceIds).toEqual([])
  })

  it('被上级目录覆盖时：源行显示已勾选（不压暗）并标「随目录」，列头全选框/清空禁用、点行不改选择', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9001'] }) })
    await expand(wrapper, '9001')
    await focusOn(wrapper, '9011')

    expect(srcRow(wrapper, 'b3').classes()).toContain('cov')
    expect(srcRow(wrapper, 'b3').text()).toContain('随目录')
    expect(srcCheck(wrapper, 'b3').element.checked).toBe(true)
    expect(srcCheck(wrapper, 'b3').attributes('disabled')).toBeUndefined()
    expect(srcCheck(wrapper, 'b3').attributes('aria-disabled')).toBe('true')
    expect(srcAllCheck(wrapper).attributes('disabled')).toBeDefined()
    expect(srcAllCheck(wrapper).element.checked).toBe(true)
    expect(headBtn(wrapper, 'sse-clear').attributes('disabled')).toBeDefined()

    await srcRow(wrapper, 'b3').trigger('click')
    expect(wrapper.emitted('update:grant')).toBeUndefined()
  })

  it('源行是三列（勾选框 / 源 ID / 源名称），点勾选框=单独加入且不动目录勾选', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9002'] }) })
    await focusOn(wrapper, '9001')
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

  // 右栏列头：全选框从标题行挪到搜索框下方，和源行同一套 padding / 列宽，逐列对齐
  it('全选框在搜索框下方的列头行，列头写着源 ID / 源名称', async () => {
    const wrapper = await mountEditor()
    await focusOn(wrapper, '9001')
    const srcs = wrapper.find('.sse-srcs')
    const at = (sel: string) => Array.from(srcs.element.children).findIndex((el) => el.matches(sel))

    expect(at('.sse-pane-search')).toBeLessThan(at('.sse-src-h'))
    expect(at('.sse-src-h')).toBeLessThan(at('.sse-list'))
    const head = srcs.find('[data-testid="sse-src-head"]')
    expect(head.text()).toContain('源 ID')
    expect(head.text()).toContain('源名称')
    expect(head.find('[data-testid="sse-src-check-all"]').exists()).toBe(true)
    // 标题行只留目录名 + 清空，不再挂勾选框
    expect(srcs.find('.sse-pane-h').find('[data-testid="sse-src-check-all"]').exists()).toBe(false)
  })

  // 右栏的源筛选：报源 ID 也要能定位到（源 ID 就是列表那一列），大小写不敏感
  it('源搜索按名称或源 ID 过滤', async () => {
    const wrapper = await mountEditor()
    await focusOn(wrapper, '9001')
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

  it('列头勾选框=全选本目录含子级的源；清空=按目录移除且不动目录勾选与其它目录的源', async () => {
    const wrapper = await mountEditor({ grant: grant({ dirIds: ['9002'], sourceIds: ['other'] }) })
    await focusOn(wrapper, '9001')
    await srcAllCheck(wrapper).trigger('click')
    expect(emittedGrant(wrapper).sourceIds.sort()).toEqual(['b1', 'b2', 'b3', 'other'])

    // 只选上一部分 → 半选；清空按目录收掉，目录勾选和别的目录选中的源都不动
    await wrapper.setProps({ grant: grant({ dirIds: ['9002'], sourceIds: ['other', 'b1', 'b2'] }) })
    expect(srcAllCheck(wrapper).element.checked).toBe(false)
    expect(srcAllCheck(wrapper).element.indeterminate).toBe(true)
    expect(headBtn(wrapper, 'sse-clear').text()).toContain('清空 (2)')
    await headBtn(wrapper, 'sse-clear').trigger('click')
    expect(emittedGrant(wrapper).sourceIds).toEqual(['other'])
    expect(emittedGrant(wrapper).dirIds).toEqual(['9002'])

    // 整目录的源都单独选上 → 勾选框显示勾 → 再点一次就是取消这一批
    await wrapper.setProps({ grant: grant({ dirIds: ['9002'], sourceIds: ['b1', 'b2', 'b3'] }) })
    expect(srcAllCheck(wrapper).element.checked).toBe(true)
    await srcAllCheck(wrapper).trigger('click')
    expect(emittedGrant(wrapper).sourceIds).toEqual([])
    expect(emittedGrant(wrapper).dirIds).toEqual(['9002'])
  })

  it('左栏搜索跨层级，但只留业务目录的命中', async () => {
    const wrapper = await mountEditor()
    await wrapper.find('[data-testid="sse-dir-kw"]').setValue('汽车')
    await vi.waitFor(() => {
      expect(wrapper.findAll('[data-dir]').map((row) => row.attributes('data-dir'))).toEqual(['9011'])
    }, { timeout: 4000, interval: 30 })

    // 换成系统目录那条的关键词（s1a「上市公司」）：命中只剩业务目录的 9011
    await wrapper.find('[data-testid="sse-dir-kw"]').setValue('上市公司')
    await vi.waitFor(() => {
      expect(vi.mocked(sourceApi.searchCategories).mock.calls).toContainEqual(['上市公司'])
      expect(wrapper.findAll('[data-dir]').map((row) => row.attributes('data-dir'))).toEqual(['9011'])
    }, { timeout: 4000, interval: 30 })
  })

  it('还没有业务目录时左栏留空，不再退到系统目录', async () => {
    // 只影响这一次取根层的调用，别把默认实现换掉（会串到后面的用例）
    vi.mocked(sourceApi.sourceCategories).mockResolvedValueOnce([])
    const wrapper = await mountEditor()
    expect(vi.mocked(sourceApi.sourceCategories).mock.calls).toEqual([['-2']])
    expect(dirRow(wrapper, 's1').exists()).toBe(false)
    expect(wrapper.find('.sse-cats .sse-empty').text()).toBe('还没有业务目录')
  })

  it('disabled 时所有写操作控件禁用（非 admin 只能看）', async () => {
    const wrapper = await mountEditor({ disabled: true })
    expect(dirCheck(wrapper, '9001').attributes('disabled')).toBeDefined()
    await focusOn(wrapper, '9001')
    expect(srcCheck(wrapper, 'b1').attributes('disabled')).toBeDefined()
    expect(srcAllCheck(wrapper).attributes('disabled')).toBeDefined()
    expect(headBtn(wrapper, 'sse-clear').attributes('disabled')).toBeDefined()
  })

  it('源列表超出单次渲染上限时支持加载更多', async () => {
    // 这一条直接给 sourcePaged 的返回形状（sourceId/name），因为被测的是渲染分页而不是映射层
    const many = Array.from({ length: 250 }, (_, i) => ({ sourceId: `s_${i + 1}`, name: `源${i + 1}` }))
    vi.mocked(sourceApi.sourcePaged).mockResolvedValueOnce({ total: 250, list: many } as never)
    const wrapper = await mountEditor()
    await focusOn(wrapper, '9001')

    const loadMoreBtn = headBtn(wrapper, 'sse-load-more')
    expect(loadMoreBtn.exists()).toBe(true)
    expect(loadMoreBtn.text()).toContain('加载更多 (50)')

    await loadMoreBtn.trigger('click')
    await flushPromises()
    expect(headBtn(wrapper, 'sse-load-more').exists()).toBe(false)
  })
})
