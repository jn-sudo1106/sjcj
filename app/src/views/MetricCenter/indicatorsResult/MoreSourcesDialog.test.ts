// @vitest-environment jsdom
// 「更多源」弹窗（MoreSourcesDialog）—— 旧 `SourceListShow` + `SourceList2` 的等价物。
//
// 1014 这一轮把它从「3 个筛选 + 自拟列表格」补齐成旧版口径：左侧分类树 + 8 项筛选（含展开·收起）
// + 旧 `allColumns.SOURCE.SIMPLE` 八列。这里把参数映射、展开态、重置语义、勾选确认逐个钉死。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import { sourceApi, type Source } from '@/api'

const spies = vi.hoisted(() => ({ clearSelection: vi.fn() }))

// 分类树（真组件是 Monitor 里旧 CategoryTree 的 1:1 迁移件，自重很大），这里只验接线：
// 它 emit 出的分类 id 列表要变成请求参数 categorys，clearSelection 要在重置时被调到。
vi.mock('@/views/Monitor/sourceCheck/SourceCategoryTree.vue', () => ({
  default: defineComponent({
    name: 'SourceCategoryTree',
    emits: ['filter'],
    setup(_props, { expose }) {
      expose({ clearSelection: spies.clearSelection })
      return () => h('div', { class: 'stub-tree' })
    },
  }),
}))

function source(over: Partial<Source> = {}): Source {
  return {
    sourceId: '161725',
    name: '招商中证白酒',
    url: 'https://example.com/a?x=1',
    configId: '70598',
    mainTable: 't1',
    owner: '张三',
    state: 'C',
    flowId: '1400330',
    dataCount: 12,
    domain: '财经',
    ...over,
  }
}

const ROWS: Source[] = [
  source(),
  source({ sourceId: '161726', name: '新浪财经', url: '', configId: '70599', mainTable: 't2', dataCount: undefined, flowId: '' }),
]

function q<T extends Element = HTMLElement>(sel: string): T | null {
  return document.body.querySelector(sel) as T | null
}
function btnByText(text: string): HTMLElement {
  const hit = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!hit) throw new Error(`找不到按钮：${text}`)
  return hit as HTMLElement
}
function headers(): string[] {
  return [...document.body.querySelectorAll('.el-table__header th')].map((th) => th.textContent?.trim() ?? '')
}
function bodyRows(): HTMLElement[] {
  return [...document.body.querySelectorAll('.el-table__body tbody tr')] as HTMLElement[]
}

let paged: ReturnType<typeof vi.spyOn>

async function openDialog(): Promise<VueWrapper> {
  const w = mount(MoreSourcesDialog, {
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  })
  await (w.vm as unknown as { open: () => void }).open()
  await nextTick()
  await flushPromises()
  return w
}

beforeEach(() => {
  spies.clearSelection.mockClear()
  paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: ROWS })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('MoreSourcesDialog · 首屏与筛选', () => {
  it('open() 按旧 queryParam 发首屏请求，表格是旧 SOURCE.SIMPLE 八列', async () => {
    const w = await openDialog()
    expect(paged).toHaveBeenCalledWith({
      page: 1,
      size: 20,
      ids: undefined,
      name: undefined,
      configId: undefined,
      sourceUrl: undefined,
      entryTypeId: undefined,
      // 旧 SourceList2 的 enable 初值就是 '0'（在用）
      enable: '0',
      count: undefined,
      dataDate: undefined,
      categorys: undefined,
    })
    // 勾选列（表头无文字）+ 旧 SIMPLE 的八列
    expect(headers()).toEqual(['', '源ID', '名称', 'URL', '配置ID', '流程ID', '数据', '表ID', '域'])
    w.unmount()
  })

  it('源ID 按换行拆成 ids（trim + 丢空行），点「查询」回第 1 页并带上名称/配置', async () => {
    const w = await openDialog()
    await q('textarea')!.dispatchEvent(new Event('focus'))
    const ids = q('textarea') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ids, ' 161725 \n\n161726,161727\n')
    ids.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await q<HTMLInputElement>('input[placeholder="源名称"]')!.dispatchEvent(new Event('focus'))
    const name = q<HTMLInputElement>('input[placeholder="源名称"]')!
    const nsetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    nsetter.call(name, ' 白酒 ')
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    // 先翻到第 2 页，验证「查询」会回第 1 页
    // （真实分页器会先发 update:current-page 再发 current-change，测试里两个都要发）
    const pg = w.findComponent({ name: 'ElPagination' })
    pg.vm.$emit('update:current-page', 2)
    pg.vm.$emit('current-change', 2)
    await flushPromises()

    btnByText('查询').click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1,
      ids: '161725,161726,161727',
      name: '白酒',
      enable: '0',
    }))
    w.unmount()
  })

  it('「展开」露出 5 个高级筛选（URL / 输出 / 状态 / 数据 / 数据时间），「收起」后收回去', async () => {
    const w = await openDialog()
    expect(q('input[placeholder="URL片断"]')).toBeNull()
    expect(q('input[placeholder="表ID"]')).toBeNull()
    expect(q('input[placeholder="数据量"]')).toBeNull()

    btnByText('展开').click()
    await nextTick()
    expect(q('input[placeholder="URL片断"]')).not.toBeNull()
    expect(q('input[placeholder="表ID"]')).not.toBeNull()
    expect(q('input[placeholder="数据量"]')).not.toBeNull()
    // 状态三个选项：在用 / 停用 / 全部（分页器的每页条数选择器也是 ElOption，按值过滤掉）
    const options = w.findAllComponents({ name: 'ElOption' })
      .map((o) => [o.props('label'), o.props('value')] as [string, string])
      .filter(([, value]) => ['0', '1', ''].includes(value))
    expect(options).toEqual([['在用', '0'], ['停用', '1'], ['全部', '']])

    btnByText('收起').click()
    await nextTick()
    expect(q('input[placeholder="URL片断"]')).toBeNull()
    w.unmount()
  })

  it('分类树 filter → categorys 逗号拼接 + 回第 1 页重查（旧 treeClick/treeCheck）', async () => {
    const w = await openDialog()
    w.findComponent({ name: 'SourceCategoryTree' }).vm.$emit('filter', ['finance', 'stock'])
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ categorys: 'finance,stock', page: 1 }))

    // 清空勾选 → categorys 回空（= 全部）
    w.findComponent({ name: 'SourceCategoryTree' }).vm.$emit('filter', [])
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ categorys: undefined }))
    w.unmount()
  })

  it('「重置」只清条件（含树勾选）不触发查询（旧 `queryParam = {}`），之后再查询按初始条件走', async () => {
    const w = await openDialog()
    const before = paged.mock.calls.length

    btnByText('重置').click()
    await flushPromises()
    expect(spies.clearSelection).toHaveBeenCalled()
    // 旧版重置不重查：调用次数不变
    expect(paged.mock.calls.length).toBe(before)

    btnByText('查询').click()
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({
      page: 1,
      ids: undefined,
      name: undefined,
      configId: undefined,
      categorys: undefined,
      // 旧版替换对象会把 enable 也清空，这里恢复成初始的「在用」（见文件头偏差第 5 条）
      enable: '0',
    }))
    w.unmount()
  })

  it('翻页 / 改条数 → 带新参数重查（改条数回第 1 页）', async () => {
    const w = await openDialog()
    const pg = w.findComponent({ name: 'ElPagination' })
    pg.vm.$emit('update:current-page', 3)
    pg.vm.$emit('current-change', 3)
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, size: 20 }))

    pg.vm.$emit('update:page-size', 100)
    pg.vm.$emit('size-change', 100)
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, size: 100 }))
    w.unmount()
  })

  it('加载失败 → 报错并清空列表', async () => {
    const err = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    paged.mockRejectedValue(new Error('boom'))
    const w = await openDialog()
    expect(String(err.mock.calls[0][0])).toContain('加载源列表失败: boom')
    expect(bodyRows()).toHaveLength(0)
    w.unmount()
  })
})

describe('MoreSourcesDialog · 表格与确认', () => {
  it('URL 列是可点外链，无 URL 的行显示「—」；数据为空也显示「—」', async () => {
    const w = await openDialog()
    const link = q<HTMLAnchorElement>('a.msd-url')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('https://example.com/a?x=1')
    expect(link!.getAttribute('target')).toBe('_blank')
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link!.getAttribute('title')).toBe('https://example.com/a?x=1')

    const rows = bodyRows()
    expect(rows).toHaveLength(2)
    expect(rows[1].querySelector('a')).toBeNull()
    expect(rows[1].textContent).toContain('—') // URL 与「数据」两列
    w.unmount()
  })

  it('未勾选时「确定」置灰（旧版没守卫，空选会让上层 `rows[0].sourceId` 抛错）', async () => {
    const w = await openDialog()
    const ok = btnByText('确定')
    expect(ok.hasAttribute('disabled')).toBe(true)

    // jsdom 里 disabled 按钮不会派发 click，所以这里只能断言「点了也没回传」
    ok.click()
    await flushPromises()
    expect(w.emitted('selected')).toBeUndefined()

    // 勾选一行 → 可点 → 回传该行并关闭
    w.findComponent({ name: 'ElTable' }).vm.$emit('selection-change', [ROWS[1]])
    await nextTick()
    expect(btnByText('确定').hasAttribute('disabled')).toBe(false)
    btnByText('确定').click()
    await flushPromises()
    expect(w.emitted('selected')?.at(-1)).toEqual([[ROWS[1]]])
    w.unmount()
  })
})
