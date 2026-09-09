// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DataGrid from './DataGrid.vue'
import { columnPrefsKey } from '@/utils/table/columnPrefs'
import type { DataRow } from '@/api'

// 按表头文字定位单元格：ENTRY_ID / SOURCE_ID 两个身份合成列固定占最前面，
// 用 nth-child 写死列序号的断言会随它们的显隐而碎（0819 N1-5）。
function cellByHeader(wrapper: ReturnType<typeof mount>, header: string): string {
  // 列头尾部带排序指示符（↕/↑/↓），按去掉它之后的文字匹配
  const idx = wrapper.findAll('thead th').findIndex((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim() === header)
  if (idx < 0) throw new Error(`表头里没有「${header}」列`)
  return wrapper.findAll('tbody tr:first-child td')[idx].text()
}

const GRID_STUBS = { ElDropdown: true, ColumnPickerDialog: true, ElDialog: true }

describe('DataGrid', () => {
  it('全站范围传入源映射时显示所属源名称', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { name: '数据 A' } }],
        sourceNames: { s1: '源 A' },
      },
      global: { stubs: GRID_STUBS },
    })

    expect(wrapper.text()).toContain('所属源')
    expect(wrapper.text()).toContain('源 A')
  })

  it('按 columnName 取值，不是按 prop——旧平台行数据的 key 是物理列名（K1/K2...），跟 tableMeta 的逻辑字段名 prop 不是一回事（真实 bug，2026-08-14 生产环境实测：详情和表格所有字段都显示"—"，不是接口没数据）', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'title', columnName: 'K1', type: 'string', desc: '标题' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { K1: '真实标题' } }],
      },
      global: { stubs: GRID_STUBS },
    })

    // "状态"列本来就没传 state，会正常显示"—"，只断言标题格自己不是"—"
    // 列头是「中文名-物理列名」，对齐旧平台 EntryList2.vue
    expect(cellByHeader(wrapper, '标题-K1')).toBe('真实标题')
  })

  it('ENTRY_ID / SOURCE_ID 两个身份列默认可见——旧平台各表 schema 不声明它们，不补出来就既看不出数据 ID 也看不出属于哪个源（0819 会议 08:16 / 09:44）', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: '430016500', acceptState: 'accepted', values: { name: '数据 A' } }],
      },
      global: { stubs: GRID_STUBS },
    })

    // 这两个合成列用短标签，对齐旧平台固定列（ENTRY_ID 列 label="ENTRY_ID"、SOURCE_ID 列 label="源"）；
    // 跟动态列一样拼成「主键 ID-ENTRY_ID」会长到把列头挤成两行
    expect(cellByHeader(wrapper, 'ENTRY_ID')).toBe('d1')
    expect(cellByHeader(wrapper, '源')).toBe('430016500')
  })

  it('列头是「中文名-物理列名」，对齐旧平台 EntryList2.vue 的 itemName-columnName——SQL 条件框拼的是物理列名，界面不暴露它就等于把人往坑里引', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: {
          tableId: 't1', tableName: '表', rowCount: 1,
          fields: [
            { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
            { prop: 'noDesc', columnName: 'K2', type: 'string', desc: '' },
            { prop: 'inferred', type: 'string', desc: '推断列' },
          ],
        },
        rows: [],
      },
      global: { stubs: GRID_STUBS },
    })

    const heads = wrapper.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())
    expect(heads).toContain('标题-K1')
    expect(heads).toContain('K2') // desc 缺失时只显示物理列名
    expect(heads).toContain('推断列-inferred') // 没有 columnName 的推断列退回 prop
  })

  it('滚动时表头保持在数据行上方，不被表格内容覆盖', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'title', columnName: 'K1', type: 'string', desc: '标题' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { K1: '真实标题' } }],
      },
      global: { stubs: GRID_STUBS },
    })

    expect(wrapper.get('.dg-table').classes()).toContain('dg-sticky-table')
    expect(wrapper.get('.dg-table th').classes()).toContain('dg-sticky-head')
  })

  it('点列头排序：三态循环升→降→取消，派发的是物理列名（迁移旧平台 EntryList2.vue 的 @sort-change）', async () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'title', columnName: 'K1', type: 'string', desc: '标题' }] },
        rows: [],
      },
      global: { stubs: GRID_STUBS },
    })
    const th = wrapper.findAll('thead th').find((t) => t.text().startsWith('标题-K1'))!

    await th.trigger('click')
    expect(wrapper.emitted('sort-change')![0]).toEqual(['K1', 'ascend'])

    await wrapper.setProps({ sortField: 'K1', sortOrder: 'ascend' })
    await th.trigger('click')
    expect(wrapper.emitted('sort-change')![1]).toEqual(['K1', 'descend'])

    // 第三次取消。旧平台这里有瑕疵：u-table 把 order 置 null 后它一律当降序，取消不掉；
    // 我们的查询层支持不传 sortField，故实现成真正的三态。
    await wrapper.setProps({ sortField: 'K1', sortOrder: 'descend' })
    await th.trigger('click')
    expect(wrapper.emitted('sort-change')![2]).toEqual(['', ''])
  })

  it('allowColumnSort=false（旧平台总行数 > 50 万）时业务列不可排，但 ENTRY_ID/SOURCE_ID 这类固定列仍可排', async () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'title', columnName: 'K1', type: 'string', desc: '标题' }] },
        rows: [],
        allowColumnSort: false,
      },
      global: { stubs: GRID_STUBS },
    })

    const kCol = wrapper.findAll('thead th').find((t) => t.text().startsWith('标题-K1'))!
    await kCol.trigger('click')
    expect(wrapper.emitted('sort-change')).toBeUndefined()

    const idCol = wrapper.findAll('thead th').find((t) => t.text().startsWith('ENTRY_ID'))!
    await idCol.trigger('click')
    expect(wrapper.emitted('sort-change')![0]).toEqual(['ENTRY_ID', 'ascend'])
  })

  it('路径类单元格渲染成可点预览，判据迁移自旧平台 EntryList2.vue：itemCode 含 path/minio 或列名含地址/路径/图片，且值以 / 开头', async () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: {
          tableId: 't1', tableName: '表', rowCount: 1,
          fields: [
            { prop: 'content_path', columnName: 'K6', type: 'string', desc: '正文路径' },
            { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
            { prop: 'src_url', columnName: 'K2', type: 'string', desc: 'URL' },
          ],
        },
        rows: [{
          dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted',
          values: { K6: '/qinlong/a/content.txt', K1: '普通标题', K2: 'https://example.com/x' },
        }],
      },
      global: { stubs: GRID_STUBS },
    })

    const cells = wrapper.findAll('[data-testid="data-file-cell"]')
    // 只有 content_path 命中：标题不是路径类；src_url 虽是链接，但值不以 / 开头（旧平台同款判据）
    expect(cells).toHaveLength(1)
    expect(cells[0].text()).toContain('/qinlong/a/content.txt')

    await cells[0].trigger('click')
    expect(wrapper.emitted('file-click')![0][0]).toBe('/qinlong/a/content.txt')
  })

  it('没有 columnName 时（比如兜底推断出的 meta）退回用 prop 取值', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'K1', type: 'string', desc: 'K1' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { K1: '推断出的值' } }],
      },
      global: { stubs: GRID_STUBS },
    })

    expect(wrapper.text()).toContain('推断出的值')
  })

  it('不传 selectable 时不渲染勾选列（不影响现有用法）', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { name: 'A' } }],
      },
      global: { stubs: GRID_STUBS },
    })

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('selectable 时点击行勾选框会 emit update:selectedIds，点表头全选/取消全选', async () => {
    const rows = [
      { dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const, values: {} },
      { dataId: 'd2', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const, values: {} },
    ]
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 2, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows,
        selectable: true,
        selectedIds: [],
      },
      global: { stubs: GRID_STUBS },
    })

    const rowChecks = wrapper.findAll('.dg-select input[type="checkbox"]')
    expect(rowChecks).toHaveLength(2)
    await rowChecks[0].setValue(true)
    expect(wrapper.emitted('update:selectedIds')?.[0]).toEqual([['d1']])

    // 表头全选：基于当前 props（尚未回填 d1），应该发出全部行的 id
    const headCheck = wrapper.find('thead input[type="checkbox"]')
    await headCheck.setValue(true)
    expect(wrapper.emitted('update:selectedIds')?.[1]).toEqual([['d1', 'd2']])
  })

  it('点击勾选框不触发 row-click（详情不应该被顺带打开）', async () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: {} }],
        selectable: true,
        selectedIds: [],
      },
      global: { stubs: GRID_STUBS },
    })

    await wrapper.find('.dg-select input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('row-click')).toBeUndefined()
  })
})

// 单元格复制值（0828 D27）。会上原话「人家有的时候他只需要复制这个值」。
describe('DataGrid · 复制单元格的值', () => {
  function mountGrid() {
    return mount(DataGrid, {
      props: {
        meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
        rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: { name: '数据 A' } }],
      },
      global: { stubs: GRID_STUBS },
    })
  }

  /** 「名称」列所在的那个 td（前面还有自动补的 ENTRY_ID / SOURCE_ID 身份列） */
  function nameCell(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('tbody tr:first-child td').find((td) => td.text().includes('数据 A'))!
  }

  it('有值的单元格带复制按钮，且图标不污染单元格文本', () => {
    const wrapper = mountGrid()
    expect(wrapper.findAll('[data-testid="data-cell-copy"]').length).toBeGreaterThan(0)
    // 图标用 SVG 而非字符：td 的文本必须还是纯数据值，否则会把别处「取值是否正确」的断言污染掉
    expect(nameCell(wrapper).text()).toBe('数据 A')
  })

  it('点复制写入剪贴板，且不触发行点击（行点击是打开详情）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mountGrid()
    await nameCell(wrapper).get('[data-testid="data-cell-copy"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('数据 A')
    expect(wrapper.emitted('row-click')).toBeUndefined()
  })
})

// 0903 H09/H10：数据层级——PARENT_ID 列 + 「下级」条数列。
// 会上要的是"每一层都能看到下一层有多少"：源视图那个 7 进去看到 7 行，这 7 行每行还该有
// 自己的下级数。异表回溯（下游筛出问题行 → 回上游发任务）则全靠 PARENT_ID。
describe('DataGrid · 数据层级（0903 H09/H10）', () => {
  const meta = { tableId: 't1', tableName: '表', rowCount: 2, fields: [{ prop: 'title', columnName: 'K1', type: 'string', desc: '标题' }] }
  const rows: DataRow[] = [
    { dataId: 'd1', title: '', summary: '', sourceId: 's1', parentId: 'p1', acceptState: 'accepted', values: { K1: 'A' } },
    { dataId: 'd2', title: '', summary: '', sourceId: 's1', parentId: '0', acceptState: 'accepted', values: { K1: 'B' } },
  ]
  function mountGrid(props: Record<string, unknown> = {}) {
    return mount(DataGrid, { props: { meta, rows, ...props }, global: { stubs: GRID_STUBS } })
  }

  // 0903 会上定的列序：父 ID 紧挨主键，不夹在「源」后面
  it('列序是 ENTRY_ID → PARENT_ID → 源', () => {
    const heads = mountGrid().findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())
    expect(heads.slice(0, 3)).toEqual(['ENTRY_ID', 'PARENT_ID', '源'])
  })

  it('PARENT_ID 独立成列，有父行时显示父 ID', () => {
    expect(cellByHeader(mountGrid(), 'PARENT_ID')).toContain('p1')
  })

  it("父 ID 为 '0'（后端表示没有父行）显示 —，不显示成一个可点的 0", () => {
    const wrapper = mountGrid()
    const idx = wrapper.findAll('thead th').findIndex((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim() === 'PARENT_ID')
    expect(wrapper.findAll('tbody tr')[1].findAll('td')[idx].text()).toBe('—')
  })

  it('首节点表整列为空时**列仍然渲染**——不做"全空就隐藏"的特判，否则同一个视图在不同节点之间列数忽多忽少', () => {
    const wrapper = mountGrid({ rows: [{ ...rows[1] }] })
    expect(wrapper.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())).toContain('PARENT_ID')
  })

  it('点父 ID 抛 parent-click，交给调用方去打开上游数据', async () => {
    const wrapper = mountGrid()
    await wrapper.get('[data-testid="data-parent-cell"]').trigger('click')
    expect(wrapper.emitted('parent-click')?.[0]?.[0]).toMatchObject({ dataId: 'd1' })
  })

  it('showChildCol 为假（末节点 / 后继无输出表）时「下级」整列不渲染，而不是显示一列 —', () => {
    expect(mountGrid().text()).not.toContain('下级')
  })

  it('有下级时显示条数并可点；为 0 显示 —', async () => {
    const counts = new Map([
      ['d1', { total: 7, byTarget: [{ nodeId: 'b', title: '抽取正文', tableId: 'T', count: 7 }] }],
      ['d2', { total: 0, byTarget: [{ nodeId: 'b', title: '抽取正文', tableId: 'T', count: 0 }] }],
    ])
    const wrapper = mountGrid({ showChildCol: true, childCounts: counts })

    const link = wrapper.get('[data-testid="data-child-count"]')
    expect(link.text()).toBe('7')
    await link.trigger('click')
    expect(wrapper.emitted('child-click')?.[0]?.[0]).toMatchObject({ dataId: 'd1' })

    expect(wrapper.findAll('[data-testid="data-child-count"]')).toHaveLength(1)
  })

  it('多后继时 tooltip 按节点拆开，单后继则只说合计', () => {
    const counts = new Map([['d1', {
      total: 7,
      byTarget: [
        { nodeId: 'b', title: '抽取正文', tableId: 'T1', count: 5 },
        { nodeId: 'c', title: '图片下载', tableId: 'T2', count: 2 },
      ],
    }]])
    const wrapper = mountGrid({ showChildCol: true, childCounts: counts })
    expect(wrapper.get('[data-testid="data-child-count"]').attributes('title')).toBe('抽取正文 5 / 图片下载 2')
  })

  // Y1-14：统计是附加信息，挂了不该让人看不了数据
  it('统计失败（childCounts=null）时只有这一列显示 ?，表格照常渲染', () => {
    const wrapper = mountGrid({ showChildCol: true, childCounts: null, childCountsError: '统计接口 500' })
    expect(wrapper.get('[data-testid="data-child-error"]').text()).toBe('?')
    expect(wrapper.get('[data-testid="data-child-error"]').attributes('title')).toBe('统计接口 500')
    expect(wrapper.text()).toContain('A')
  })
})

describe('DataGrid · 列显示与顺序', () => {
  afterEach(() => localStorage.clear())

  const ElDialogStub = {
    name: 'ElDialog',
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" data-testid="column-picker-dialog"><slot /><slot name="footer" /></div>',
  }

  function mountPickerGrid() {
    return mount(DataGrid, {
      props: {
        meta: {
          tableId: 't-cols',
          tableName: '表',
          rowCount: 1,
          fields: [
            { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
            { prop: 'html', columnName: 'K17', type: 'string', desc: '正文html路径' },
          ],
        },
        rows: [{
          dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const,
          values: { K1: '标题A', K17: '—' },
        }],
      },
      global: { stubs: { ElDropdown: true, ElDialog: ElDialogStub } },
    })
  }

  it('工具行是「列 n/m」，点开弹窗后确定才改表头', async () => {
    const wrapper = mountPickerGrid()
    const btn = wrapper.get('[data-testid="column-picker-btn"]')
    expect(btn.text()).toBe('列 5/5')
    expect(wrapper.find('[data-testid="column-picker-dialog"]').exists()).toBe(false)

    await btn.trigger('click')
    const htmlRow = wrapper.findAll('.cpk-row').find((row) => row.text().includes('正文html路径-K17'))!
    await htmlRow.get('input[type="checkbox"]').setValue(false)
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(expect.arrayContaining(['正文html路径-K17↕']))

    await wrapper.get('[data-testid="column-picker-ok"]').trigger('click')
    const heads = wrapper.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())
    expect(heads).not.toContain('正文html路径-K17')
    expect(heads).toContain('标题-K1')
    expect(btn.text()).toBe('列 4/5')
  })

  it('按 tableId 记住显隐，换表不串', async () => {
    const wrapper = mountPickerGrid()
    await wrapper.get('[data-testid="column-picker-btn"]').trigger('click')
    const htmlRow = wrapper.findAll('.cpk-row').find((row) => row.text().includes('正文html路径-K17'))!
    await htmlRow.get('input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-testid="column-picker-ok"]').trigger('click')
    expect(JSON.parse(localStorage.getItem(columnPrefsKey('t-cols'))!).hidden).toContain('html')

    await wrapper.setProps({
      meta: {
        tableId: 't-other',
        tableName: '另一张',
        rowCount: 0,
        fields: [{ prop: 'html', columnName: 'K17', type: 'string', desc: '正文html路径' }],
      },
    })
    const heads = wrapper.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())
    expect(heads).toContain('正文html路径-K17')
  })
})

describe('DataGrid · 下一步字段预设（0831 F10）', () => {
  afterEach(() => localStorage.clear())

  const ElDialogStub = {
    name: 'ElDialog',
    props: ['modelValue', 'title'],
    template: '<div v-if="modelValue" data-testid="column-picker-dialog"><slot /><slot name="footer" /></div>',
  }

  const META = {
    tableId: 't-preset',
    tableName: '表',
    rowCount: 1,
    fields: [
      { prop: 'title', columnName: 'K1', type: 'string', desc: '标题' },
      { prop: 'url', columnName: 'K2', type: 'string', desc: '链接' },
      { prop: 'body', columnName: 'K3', type: 'string', desc: '正文' },
    ],
  }

  function mountGrid(presetCols: string[] = []) {
    return mount(DataGrid, {
      props: {
        meta: META,
        presetCols,
        rows: [{
          dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const,
          values: { K1: 'A', K2: 'B', K3: 'C' },
        }],
      },
      global: { stubs: { ElDropdown: true, ElDialog: ElDialogStub } },
    })
  }

  const heads = (w: ReturnType<typeof mountGrid>) =>
    w.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())

  // 0903 Y1-5：身份列从两个（ENTRY_ID/源）变成三个——PARENT_ID 并进来了，
  // 它和另外两个一样回答"这行是谁"，异表回溯全靠它，不能被预设筛掉。
  it('首次打开默认只显示预设列，三个身份列一并保留', () => {
    const wrapper = mountGrid(['title'])
    expect(heads(wrapper)).toEqual(expect.arrayContaining(['ENTRY_ID', '源', 'PARENT_ID', '标题-K1']))
    expect(heads(wrapper)).not.toContain('正文-K3')
    expect(wrapper.get('[data-testid="column-picker-btn"]').text()).toBe('列 4/6')
  })

  it('预设为空时退回全部列，也不渲染切换按钮', () => {
    const wrapper = mountGrid([])
    expect(heads(wrapper)).toEqual(expect.arrayContaining(['标题-K1', '链接-K2', '正文-K3']))
    expect(wrapper.find('[data-testid="column-preset-toggle"]').exists()).toBe(false)
  })

  it('预设引用了当前表没有的列时全部丢掉，等同没有预设', () => {
    const wrapper = mountGrid(['ghost', 'K99'])
    expect(heads(wrapper)).toEqual(expect.arrayContaining(['标题-K1', '链接-K2', '正文-K3']))
    expect(wrapper.find('[data-testid="column-preset-toggle"]').exists()).toBe(false)
  })

  it('切换按钮在「全部列」与「下一步字段」之间来回，一次点击到位', async () => {
    const wrapper = mountGrid(['title'])
    const toggle = () => wrapper.get('[data-testid="column-preset-toggle"]')
    expect(toggle().text()).toBe('全部列')

    await toggle().trigger('click')
    expect(heads(wrapper)).toContain('正文-K3')
    expect(toggle().text()).toBe('下一步字段 4')

    await toggle().trigger('click')
    expect(heads(wrapper)).not.toContain('正文-K3')
    expect(toggle().text()).toBe('全部列')
  })

  it('用户存过偏好后预设不再覆盖它——预设只是没表过态时的默认', async () => {
    const first = mountGrid(['title'])
    await first.get('[data-testid="column-preset-toggle"]').trigger('click') // 展开全部列并落盘

    const second = mountGrid(['title'])
    expect(heads(second)).toContain('正文-K3')
  })

  it('弹窗里有「仅下一步字段」快捷项', async () => {
    const wrapper = mountGrid(['title'])
    await wrapper.get('[data-testid="column-preset-toggle"]').trigger('click')
    await wrapper.get('[data-testid="column-picker-btn"]').trigger('click')

    await wrapper.get('[data-testid="column-picker-preset"]').trigger('click')
    await wrapper.get('[data-testid="column-picker-ok"]').trigger('click')
    expect(heads(wrapper)).not.toContain('正文-K3')
    expect(heads(wrapper)).toContain('标题-K1')
  })
})

describe('DataGrid · 强制业务列显示', () => {
  it('传入 visibleFieldProps 时只展示指定字段，其他字段全部隐藏', () => {
    const wrapper = mount(DataGrid, {
      props: {
        meta: {
          tableId: 'T2', tableName: '规则输入', rowCount: 1,
          fields: [
            { prop: 'code', columnName: 'K1', type: 'string', desc: '编码' },
            { prop: 'name', columnName: 'K2', type: 'string', desc: '名称' },
            { prop: 'url', columnName: 'K3', type: 'string', desc: 'URL' },
          ],
        },
        visibleFieldProps: ['code'],
        rows: [{
          dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted' as const,
          values: { K1: '1121250', K2: '万微测试', K3: '执行成功' },
        }],
      },
      global: { stubs: GRID_STUBS },
    })

    const heads = wrapper.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())
    expect(heads).toEqual(['编码-K1', '状态', '操作'])
    expect(heads).not.toContain('ENTRY_ID')
    expect(heads).not.toContain('PARENT_ID')
    expect(heads).not.toContain('源')
    expect(heads).not.toContain('名称-K2')
    expect(heads).not.toContain('URL-K3')
    expect(wrapper.text()).toContain('1121250')
    expect(wrapper.text()).not.toContain('万微测试')
    expect(wrapper.text()).not.toContain('执行成功')
  })
})

// 行内删除（2026-09-09 随源数据视图迁入删除功能一起加）。表格自己不判断表能不能删——
// 表状态（tableMeta.state）在调用方手里，这里只按 allowRowDelete 渲染。
describe('DataGrid · 行内删除单条', () => {
  const MENU_STUBS = {
    ColumnPickerDialog: true,
    ElDialog: true,
    ElDropdown: { name: 'ElDropdown', template: '<div><slot /><slot name="dropdown" /></div>' },
    ElDropdownMenu: { name: 'ElDropdownMenu', template: '<div><slot /></div>' },
    ElDropdownItem: { name: 'ElDropdownItem', props: ['command', 'divided'], template: '<div class="dg-item"><slot /></div>' },
  }
  const props = {
    meta: { tableId: 't1', tableName: '表', rowCount: 1, fields: [{ prop: 'name', type: 'string', desc: '名称' }] },
    rows: [{ dataId: 'd1', title: '', summary: '', sourceId: 's1', acceptState: 'accepted', values: {} }] as DataRow[],
  }

  it('allowRowDelete 为真才出现，默认不出现', () => {
    const off = mount(DataGrid, { props, global: { stubs: MENU_STUBS } })
    expect(off.text()).not.toContain('删除单条')

    const on = mount(DataGrid, { props: { ...props, allowRowDelete: true }, global: { stubs: MENU_STUBS } })
    expect(on.text()).toContain('删除单条【无法恢复】')
    expect(on.text()).toContain('详情')
    expect(on.text()).toContain('查后续任务实例')
  })
})
