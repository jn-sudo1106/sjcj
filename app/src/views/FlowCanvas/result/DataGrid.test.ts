// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import DataGrid from './DataGrid.vue'
import { columnPrefsKey } from '@/utils/table/columnPrefs'

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
    expect(btn.text()).toBe('列 4/4')
    expect(wrapper.find('[data-testid="column-picker-dialog"]').exists()).toBe(false)

    await btn.trigger('click')
    const htmlRow = wrapper.findAll('.cpk-row').find((row) => row.text().includes('正文html路径-K17'))!
    await htmlRow.get('input[type="checkbox"]').setValue(false)
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(expect.arrayContaining(['正文html路径-K17↕']))

    await wrapper.get('[data-testid="column-picker-ok"]').trigger('click')
    const heads = wrapper.findAll('thead th').map((th) => th.text().replace(/[↕↑↓]\s*$/, '').trim())
    expect(heads).not.toContain('正文html路径-K17')
    expect(heads).toContain('标题-K1')
    expect(btn.text()).toBe('列 3/4')
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

  it('首次打开默认只显示预设列，两个身份列一并保留', () => {
    const wrapper = mountGrid(['title'])
    expect(heads(wrapper)).toEqual(expect.arrayContaining(['ENTRY_ID', '源', '标题-K1']))
    expect(heads(wrapper)).not.toContain('正文-K3')
    expect(wrapper.get('[data-testid="column-picker-btn"]').text()).toBe('列 3/5')
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
    expect(toggle().text()).toBe('下一步字段 3')

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
