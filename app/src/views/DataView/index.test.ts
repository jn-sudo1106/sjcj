// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import DataView from './index.vue'
import { useAuthStore } from '../../stores/auth'
import { dataApi, sourceApi, type DataTableMeta, type DataRow, type EntryTypeGroup } from '../../api'

// 数据表页_UI重写设计_2026-07-30：检索区/工具条/批量条/动态列表格/数据详情抽屉
describe('DataView · 数据表页', () => {
  let wrapper: VueWrapper

  const GROUP: EntryTypeGroup = {
    list1: [
      { tableId: 't1', tableName: 'sense_data.TB_STOCK_NOTICE', name: '公告表', fields: [] },
      { tableId: 't2', tableName: 'sense_data.TB_ZFB_COMMENT', name: '评论表', fields: [] },
    ],
    list2: [],
    list3: [],
  }
  const META: DataTableMeta = {
    tableId: 't1',
    tableName: 'sense_data.TB_STOCK_NOTICE',
    rowCount: 100,
    state: 'C',
    fields: [
      { prop: 'title', desc: '标题', columnName: 'K1', required: true, type: 'string' },
      { prop: 'pub_date', desc: '发布日期', columnName: 'K2', required: true, type: 'string' },
    ],
  }
  const ROW: DataRow = {
    dataId: '88231', sourceId: '600519', state: 'C', k0: 'json-771',
    values: { K1: '关于利润分配的公告', K2: '2026-07-18' },
    title: '关于利润分配的公告', summary: '', acceptState: 'accepted',
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(dataApi, 'entryTypesGroup').mockResolvedValue(GROUP)
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue(META)
    vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ total: 1, list: [ROW] })
    vi.spyOn(sourceApi, 'sourceSame').mockResolvedValue([{ sourceId: '600519', name: '贵州茅台' }])
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = '' // 清理 el-dropdown/el-message/el-drawer 传送到 body 的残留节点
  })

  async function mountPage(query: Record<string, string> = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/data', component: { template: '<div />' } }],
    })
    await router.push({ path: '/data', query })
    await router.isReady()
    wrapper = mount(DataView, { global: { plugins: [ElementPlus, router] } })
    return wrapper
  }

  async function waitForLoad() {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()
  }

  it('初次加载：entryTypesGroup/tableMeta/rowQueryPaged 依次调用，默认选中 list1 第一个表', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(dataApi.entryTypesGroup).toHaveBeenCalled()
    expect(dataApi.tableMeta).toHaveBeenCalledWith('t1')
    expect(dataApi.rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1', page: 1, size: 20 }))
  })

  it('切表：选表下拉切到 list1 第二个表，重新拉取 tableMeta 并按新 tableId 重查', async () => {
    vi.spyOn(dataApi, 'tableMeta').mockImplementation(async (id: string) => ({ ...META, tableId: id }))
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const tableSelect = wrapper.findAllComponents({ name: 'ElSelect' })[0]
    await tableSelect.vm.$emit('update:modelValue', 't2')
    await tableSelect.vm.$emit('change', 't2')
    await waitForLoad()

    expect(dataApi.tableMeta).toHaveBeenLastCalledWith('t2')
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 't2', page: 1 }))
  })

  it('查询：输入数据 ID 点查询，rowQueryPaged 带上 dataId 且页码归 1', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.find('input[placeholder="请输入数据 ID"]').setValue('88231')
    await wrapper.findAll('button').find((b) => b.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ dataId: '88231', page: 1 }))
  })

  it('高级筛选：状态多选出现在筛选芯片，点击关闭清空该状态并重新查询', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.find('.dv-link').trigger('click') // 展开高级筛选
    await flushPromises()
    const cInitial = wrapper.findAllComponents({ name: 'ElCheckboxButton' }).find((c) => c.text() === 'C 初始')
    await cInitial!.find('input').setValue(true)
    await flushPromises()

    expect(wrapper.findAllComponents({ name: 'ElTag' }).some((t) => t.text() === 'C 初始')).toBe(true)
    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'C' }))

    const tag = wrapper.findAllComponents({ name: 'ElTag' }).find((t) => t.text() === 'C 初始')
    await tag!.vm.$emit('close')
    await flushPromises()

    expect(dataApi.rowQueryPaged).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined }))
  })

  it('展示SQL：切换后本地拼接展示，不发请求', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    const before = (dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.calls.length
    await wrapper.findAll('button').find((b) => b.text() === '展示SQL')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('select * from sense_data.TB_STOCK_NOTICE')
    expect((dataApi.rowQueryPaged as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  it('导出EXCEL：调用 dataApi.exportUrl 拼好的 URL 新窗口打开，不经过 rowQueryPaged', async () => {
    const exportSpy = vi.spyOn(dataApi, 'exportUrl').mockReturnValue('/api/v1/entry/entryExportAll?entryType=t1')
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.findAll('button').find((b) => b.text() === '导出EXCEL')!.trigger('click')

    expect(exportSpy).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't1' }))
    expect(openSpy).toHaveBeenCalledWith('/api/v1/entry/entryExportAll?entryType=t1', '_blank')
  })

  it('删除数据▾：仅 admin 且测试表（state===\'C\'）时显示；正式表（AC）不显示', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('删除数据'))).toBe(true)

    wrapper.unmount()
    vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({ ...META, state: 'AC' })
    await mountPage()
    await waitForLoad()
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('删除数据'))).toBe(false)
  })

  it('动态列：表头按 {desc}-{columnName} 渲染 required 字段', async () => {
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    expect(wrapper.text()).toContain('标题-K1')
    expect(wrapper.text()).toContain('发布日期-K2')
  })

  it('批量条：勾选行后出现"已选择 N 项"，发后续任务调用 dataApi.nextStep；取消选择后批量条消失', async () => {
    const nextStepSpy = vi.spyOn(dataApi, 'nextStep').mockResolvedValue({ message: '已发送' })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage({ sourceId: '600519' })
    await waitForLoad()

    expect(wrapper.text()).not.toContain('已选择')

    const rowCheckbox = wrapper.findAllComponents({ name: 'ElCheckbox' }).find((c) => c.props('ariaLabel') === '选择 88231')
    await rowCheckbox!.vm.$emit('change', true)
    await flushPromises()

    expect(wrapper.text()).toContain('已选择')
    await wrapper.findAll('button').find((b) => b.text() === '发后续任务')!.trigger('click')
    expect(nextStepSpy).toHaveBeenCalledWith('600519', 't1', ['88231'])

    await wrapper.findAll('.dv-batch .dv-link').find((el) => el.text() === '取消选择')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('已选择')
  })

  it('数据详情抽屉：点击 ENTRY_ID 调 dataApi.rowDetail 并展示 showItems', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: ROW,
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '标题', value: '关于利润分配的公告' }],
    })
    const auth = useAuthStore()
    auth.roles = ['admin']
    await mountPage()
    await waitForLoad()

    await wrapper.find('a.dv-a').trigger('click') // ENTRY_ID 链接
    await flushPromises()

    expect(dataApi.rowDetail).toHaveBeenCalledWith('t1', '88231')
    expect(wrapper.text()).toContain('标题')
  })

  it('read 角色：隐藏批量条勾选列/删除数据/工具入口，保留刷新/展示SQL/导出EXCEL', async () => {
    const auth = useAuthStore()
    auth.roles = ['read']
    await mountPage()
    await waitForLoad()

    expect(wrapper.findAll('button').some((b) => b.text().startsWith('删除数据'))).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('工具'))).toBe(false)
    expect(wrapper.find('th .el-checkbox, th input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text() === '刷新')).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '展示SQL')).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '导出EXCEL')).toBe(true)
  })

  it('深链接：?entryType=/?sourceId= 自动带入检索', async () => {
    await mountPage({ entryType: 't9', sourceId: 'src-9' })
    await waitForLoad()

    expect(dataApi.rowQueryPaged).toHaveBeenCalledWith(expect.objectContaining({ tableId: 't9', sourceId: 'src-9' }))
  })
})
