// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, shallowMount, type VueWrapper } from '@vue/test-utils'
import { KeepAlive, defineComponent, h } from 'vue'
import { ElMessage, ElMessageBox, ElPagination } from 'element-plus'
import SourceOverviewView from './SourceOverviewView.vue'
import { dataApi, favoriteApi, siteApi, sourceApi, sourceGroupApi, flowCenterApi, type Source } from '@/api'
import { favoriteSourceIds } from '@/utils/sourceFavorites'
import * as xlsxExport from '@/utils/format/xlsxExport'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '@/stores/ui'

// 本组件用到了 launchJob store（Y4-5 批量提交作业条）。这里的 mount 都是裸挂载、
// 没装 pinia 插件，所以在每个用例前设一个活动 pinia 就够——store 是在 setup 里
// 直接 useXxxStore() 拿的，不经过 app.use()。每个用例一个新实例，作业态不串。
beforeEach(() => {
  setActivePinia(createPinia())
  // 组件挂载时会拉源收藏（0924-08）。不 mock 的话真请求挂着不回，模块里"同一时刻只跑一次"
  // 的加载会一直复用这个挂起的 Promise，后面的用例拿不到自己 mock 的收藏
  vi.spyOn(favoriteApi, 'listIds').mockResolvedValue([])
})

const source: Source = {
  sourceId: 'src-1', name: '当前网站源', url: 'https://example.com', configId: 'cfg-1', mainTable: 'TB_1', owner: 'tester', state: 'C', siteId: 'site-current', dataCount: 3,
}

describe('SourceOverviewView', () => {
  it('快捷编辑入口在源名称旁，打开编辑不跳详情；保存后沿用当前筛选和页码刷新', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 40, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', scopeSourceIds: ['src-1'], quickEdit: true }, global: { components: { ElPagination } } })
    await flushPromises()
    await wrapper.get('[data-testid="source-overview-state"]').setValue('E')
    wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('update:current-page', 2)
    await wrapper.get('[data-testid="source-quick-edit-src-1"]').trigger('click')
    const editor = wrapper.findComponent({ name: 'EditSourceDialog' })
    expect(editor.props('source')).toEqual(source)
    expect(editor.props('quick')).toBe(true)
    expect(wrapper.emitted('openSource')).toBeUndefined()
    editor.vm.$emit('saved', { ...source, url: 'https://new.example.com', coreParam: 'a=1' })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'EditSourceDialog' }).exists()).toBe(false)
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, sourceIds: 'src-1', state: 'E' }))
    wrapper.unmount()
  })

  it('分组分页、查询范围导出和任务预览均携带固定源 ID', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    vi.spyOn(xlsxExport, 'downloadXlsx').mockImplementation(() => {})
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', scopeSourceIds: ['src-1'] } })
    await flushPromises()
    await wrapper.get('[data-testid="source-export"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.length).toBeGreaterThan(1)
    for (const [query] of page.mock.calls) expect(query?.sourceIds).toBe('src-1')
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ size: 500, sourceIds: 'src-1' }))
    wrapper.unmount()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })
  // 2026-10-21 源管理「系统目录」页签左侧目录：系统目录按 categorys 筛，范围变了重查，导出 / 发任务同口径
  it('系统目录范围：列表、导出、按条件发任务都带 categorys；范围变了重查；目录说明不发给后端', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    vi.spyOn(xlsxExport, 'downloadXlsx').mockImplementation(() => {})
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', scopeCategoryIds: ['100', '101'], scopeLabel: '系统目录：财经资讯（含子级）' } })
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ categorys: '100,101', dirLabel: '系统目录：财经资讯（含子级）' }))
    await wrapper.get('[data-testid="source-export"]').trigger('click')
    await flushPromises()
    for (const [query] of page.mock.calls) expect(query?.categorys).toBe('100,101')
    page.mockClear()
    await wrapper.setProps({ scopeCategoryIds: ['200'] })
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ categorys: '200' }))
    await wrapper.setProps({ scopeCategoryIds: undefined, scopeLabel: undefined })
    await flushPromises()
    expect(page.mock.lastCall?.[0]).not.toHaveProperty('categorys')
    wrapper.unmount()
  })

  it('空分组不请求全部源；分组条件与手动源 ID 取交集，清空仍限定分组', async () => {
    const api = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', scopeSourceIds: [] } })
    await flushPromises()
    expect(api).not.toHaveBeenCalled()
    await wrapper.setProps({ scopeSourceIds: ['10', '20'] })
    await flushPromises()
    expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: '10,20' }))
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('sourceIds')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('20,30')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: '20' }))
    api.mockClear()
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('30')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(api).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '清空')!.trigger('click')
    await flushPromises()
    expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: '10,20' }))
    wrapper.unmount()
  })

  // 2026-08-28 订正：过滤参数是 **siteIds（复数）**。实测 `sourcePaged({ siteId })` 被后端忽略
  // （返回全库 16929 条），只有 siteIds 生效（返回 20 条，与 site/sources 一致）。
  // 原断言锁的是 siteId，等于把"过滤根本没生效"这个 bug 锁住了。
  it('请求始终带当前网站的 siteIds，没有范围/跨网站切换入口（0812 纠偏）', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: 'site-current' }))
    expect(wrapper.text()).toContain('当前网站源')
    expect(wrapper.find('[data-testid="source-overview-scope"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-overview-config"]').exists()).toBe(false)
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('所属网站')
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('配置 ID')
  })

  it('状态筛选按拆分字段发送：停用走 enable，不向旧接口发 state=disabled（0812 纠偏）', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-state"]').setValue('C')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'C', enable: '0' }))

    await wrapper.get('[data-testid="source-overview-state"]').setValue('disabled')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined, enable: '1' }))

    await wrapper.get('[data-testid="source-overview-state"]').setValue('all')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ state: undefined, enable: undefined }))
  })

  it('排序仍然生效', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('th .sov-sort').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'SOURCE_ID', sorted: 1, type: 'ASC' }))
  })

  it('按源 ID 查询并从列表打开真实源', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('sourceIds')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('src-1, src-2')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: 'src-1, src-2' }))
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('操作')

    await wrapper.get('[data-testid="source-overview-source-link"]').trigger('click')
    expect(wrapper.emitted('openSource')?.[0]).toEqual([source])
  })

  // 2026-09-09：两列指的是同一个源，名称能点、ID 不能点没道理——拿 ID 认源比拿名称更多。
  it('源 ID 与源名称走同一个入口，点哪个都打开源详情', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-1' } })
    await flushPromises()

    const idLink = wrapper.get('[data-testid="source-overview-id-link"]')
    expect(idLink.text()).toBe(source.sourceId)
    await idLink.trigger('click')
    expect(wrapper.emitted('openSource')?.[0]).toEqual([source])
  })

  it('切换网站时重新按新 siteIds 查询，页码重置', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.setProps({ currentSiteId: 'site-other' })
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: 'site-other', page: 1 }))
  })
})

// 勾选 + 批量（0828 W5-4）。落在**源视图这张表**上——最初做到左侧边栏是理解错了，
// 边栏是切换当前源用的，"面向一批源做事"应该在这张表里。
// 复用已有接口：批量发抓取 = sendSnatchWithParam 一次带多个 ids；
// 批量启停 = 逐个 changeSourceEnable（后端没有批量启停端点，旧平台源列表页也是循环调的）。
describe('SourceOverviewView · 勾选与批量', () => {
  afterEach(() => vi.restoreAllMocks())

  const rows: Source[] = [
    source,
    { ...source, sourceId: 'src-2', name: '第二个源' },
  ]
  async function mountWithRows() {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: rows })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    return wrapper
  }

  it('未勾选时不显示批量条；勾选后出现并显示数量', async () => {
    const wrapper = await mountWithRows()
    expect(wrapper.find('[data-testid="source-batch-count"]').exists()).toBe(false)
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    expect(wrapper.get('[data-testid="source-batch-count"]').text()).toContain('已选 1')
  })

  it('表头全选勾中本页所有行', async () => {
    const wrapper = await mountWithRows()
    await wrapper.get('[data-testid="source-check-all"]').setValue(true)
    expect(wrapper.get('[data-testid="source-batch-count"]').text()).toContain('已选 2')
  })

  it('发任务按钮常驻，不勾选也能看到', async () => {
    const wrapper = await mountWithRows()
    expect(wrapper.find('[data-testid="source-launch"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-batch-count"]').exists()).toBe(false)
  })

  it('导出按当前查询条件分页收齐，不导当前页、也不看勾选', async () => {
    const page1 = { ...source, sourceId: 'src-1', name: '当前页这条' }
    const page2 = { ...source, sourceId: 'src-2', name: '下一页这条' }
    const hidden = { ...source, sourceId: 'src-3', name: '第三页这条' }
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (q) => {
      // 列表页 size=20 只回当前页 1 条；导出走 collect 的 size=500，要带回全部命中
      if ((q?.size ?? 20) <= 20) return { total: 3, list: [page1] }
      return { total: 3, list: [page1, page2, hidden] }
    })
    const download = vi.spyOn(xlsxExport, 'downloadXlsx').mockImplementation(() => {})
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    // 查询是多条件（2026-09-28）：源名称一行、备注一行，一起带进导出
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('name')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('财经')
    await wrapper.get('[data-testid="source-overview-condition-add"]').trigger('click')
    await wrapper.findAll('[data-testid="source-overview-search-field"]')[1]!.setValue('remark')
    await wrapper.findAll('[data-testid="source-overview-search-text"]')[1]!.setValue('验证正常')
    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-export"]').trigger('click')
    await flushPromises()

    const collectCalls = page.mock.calls.filter((call) => (call[0]?.size ?? 0) >= 500)
    expect(collectCalls.length).toBeGreaterThanOrEqual(1)
    expect(collectCalls[0]?.[0]).toEqual(expect.objectContaining({
      siteIds: 'site-current',
      name: '财经',
      tags: ['#内容重复'],
      remark: '验证正常',
      page: 1,
      size: 500,
    }))
    expect(collectCalls[0]?.[0]?.sourceIds).toBeUndefined()
    // 没加 URL 条件，URL 参数就不发
    expect(collectCalls[0]?.[0]?.sourceUrl).toBeUndefined()
    expect(download).toHaveBeenCalledTimes(1)
    expect(String(download.mock.calls[0]?.[0] ?? '')).toMatch(/\.xlsx$/)
    const exported = download.mock.calls[0]?.[1] ?? []
    const names = exported.map((row) => row[1]).join('\n')
    expect(names).toContain('当前页这条')
    expect(names).toContain('下一页这条')
    expect(names).toContain('第三页这条')
    wrapper.unmount()
  })

  it('查询、清空、发任务、导出都在筛选行右侧，导出是文字按钮', async () => {
    const wrapper = await mountWithRows()
    const actions = wrapper.get('[data-testid="source-overview-actions"]')
    expect(actions.find('[data-testid="source-overview-search"]').text()).toBe('查询')
    expect(actions.find('[data-testid="source-launch"]').exists()).toBe(true)
    const exportBtn = actions.get('[data-testid="source-export"]')
    expect(exportBtn.text()).toBe('导出')
    expect(wrapper.find('.sov-summary [data-testid="source-launch"]').exists()).toBe(false)
    expect(wrapper.find('.sov-summary [data-testid="source-export"]').exists()).toBe(false)
  })

  // 2026-09-17 对齐旧平台：无参数且勾选 ≤2 个时直接发，不再先弹确认
  // （旧 SourceList.sendBatch 的口径，读代码 + 生产实测两次都验过）。
  it('勾选 2 个且无参数：直接发，不弹确认，all 恒为 0、skip 走默认', async () => {
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: rows })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-all"]').setValue(true)
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="launch-confirm-dialog"]').exists()).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].ids).toEqual(['src-1', 'src-2'])
    expect(send.mock.calls[0][0].all).toBe(0)
    expect(send.mock.calls[0][0].skip).toBe(0)
    wrapper.unmount()
  })

  it('勾选超过 2 个仍然先确认——批量发出去收不回来', async () => {
    const many = [...rows, { ...source, sourceId: 'src-3', name: '第三个源' }]
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: many })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-all"]').setValue(true)
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()

    // 确认前不发
    expect(wrapper.get('[data-testid="launch-confirm-dialog"]').text()).toContain('本次 3 条')
    expect(send).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="launch-confirm"]').trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].ids).toEqual(['src-1', 'src-2', 'src-3'])
    wrapper.unmount()
  })

  it('没勾选时按当前筛选收 ID 再发，all 仍是 0', async () => {
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: rows })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ siteIds: 'site-current', page: 1, size: 500 }))
    expect(wrapper.get('[data-testid="launch-confirm-dialog"]').text()).toContain('当前筛选')
    await wrapper.get('[data-testid="launch-confirm"]').trigger('click')
    await flushPromises()
    expect(send.mock.calls[0][0].all).toBe(0)
    expect(send.mock.calls[0][0].ids).toEqual(['src-1', 'src-2'])
    wrapper.unmount()
  })

  // 0831 X1-11：changeEnable 本来就是批量端点（ids 逗号分隔），一次请求发全部 id，
  // 不再逐个调——之前逐个调是因为适配层还是 mock 占位。
  it('批量停用一次请求发全部 id，且确认后才发', async () => {
    const toggle = vi.spyOn(sourceApi, 'changeSourceEnableBatch').mockResolvedValue({ ok: true, message: 'ok' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = await mountWithRows()
    await wrapper.get('[data-testid="source-check-all"]').setValue(true)
    await wrapper.get('[data-testid="batch-disable"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(toggle).toHaveBeenCalledWith(['src-1', 'src-2'], true)
  })

  it('取消确认就不发请求', async () => {
    const toggle = vi.spyOn(sourceApi, 'changeSourceEnableBatch').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const wrapper = await mountWithRows()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-disable"]').trigger('click')
    await flushPromises()
    expect(toggle).not.toHaveBeenCalled()
  })

  it('「取消」清空勾选', async () => {
    const wrapper = await mountWithRows()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-clear"]').trigger('click')
    expect(wrapper.find('[data-testid="source-batch-count"]').exists()).toBe(false)
  })
})

describe('SourceOverviewView · 标签', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  const marked: Source = {
    ...source,
    tags: ['日期错误待重跑', '正文缺失', '内容重复'],
  }

  it('筛选区和表格带标签列', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [marked] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-tag"]').exists()).toBe(true)
    expect(wrapper.findAll('th').map((th) => th.text())).toContain('标签')
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('日期错误待重跑')
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('+1')
  })

  it('标签筛选是下拉，查询时带 #tags', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [marked] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ['#内容重复'] }))
  })

  it('勾选后打开添加标记浮层，保存调用 tagSource，行上立刻出现标签', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
    const tag = vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-tag-正文缺失"]').trigger('click')
    await wrapper.get('[data-testid="mark-save"]').trigger('click')
    await flushPromises()
    expect(tag).toHaveBeenCalledWith(['src-1'], ['正文缺失'], 'add')
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('正文缺失')
    expect(wrapper.get('[data-testid="source-mark-toast"]').text()).toContain('已更新 1 个源')
    await wrapper.get('[data-testid="source-mark-view-batch"]').trigger('click')
    expect((wrapper.get('[data-testid="source-overview-tag"]').element as HTMLSelectElement).value).toBe('正文缺失')
    wrapper.unmount()
  })

  // 2026-10-16 用户定：这颗提示条带「查看这一批」动作，**由用户手动关**，不做自动收起
  // （唯一自动收掉的时机是离开本视图，见下面那条 KeepAlive 用例）。
  // 假时钟用来证明"不自己走"；只接管 setTimeout/clearTimeout，flushPromises 走 setImmediate 不受影响。
  it('打标提示条不自动消失，靠 × 手动关闭', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
      vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
      const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
      await flushPromises()
      await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
      await wrapper.get('[data-testid="batch-mark"]').trigger('click')
      await wrapper.get('[data-testid="mark-tag-正文缺失"]').trigger('click')
      await wrapper.get('[data-testid="mark-save"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-testid="source-mark-toast"]').exists()).toBe(true)

      // 放一分钟也不自己消失
      vi.advanceTimersByTime(60_000)
      await flushPromises()
      expect(wrapper.find('[data-testid="source-mark-toast"]').exists()).toBe(true)

      await wrapper.get('.sov-toast-close').trigger('click')
      expect(wrapper.find('[data-testid="source-mark-toast"]').exists()).toBe(false)
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  // 2026-10-16 用户报：切换页面后提示仍在。本视图被外层 KeepAlive 缓存（CollectAssets/index、
  // Settings/index、AppShell），切走只是 deactivated、组件不卸载，所以必须在离场时收掉。
  it('被 KeepAlive 缓存时，切走页面即收掉提示条', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
    vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
    const Host = defineComponent({
      props: { show: Boolean },
      setup: (props) => () => h(KeepAlive, null, [props.show ? h(SourceOverviewView, { currentSiteId: 'site-current' }) : null]),
    })
    const wrapper = mount(Host, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    const view = wrapper.findComponent(SourceOverviewView)
    await view.get('[data-testid="source-check-src-1"]').setValue(true)
    await view.get('[data-testid="batch-mark"]').trigger('click')
    await view.get('[data-testid="mark-tag-正文缺失"]').trigger('click')
    await view.get('[data-testid="mark-save"]').trigger('click')
    await flushPromises()
    expect(view.find('[data-testid="source-mark-toast"]').exists()).toBe(true)

    // 切走（KeepAlive 只停用、不卸载）再切回来：提示条不能还挂着
    await wrapper.setProps({ show: false })
    await flushPromises()
    await wrapper.setProps({ show: true })
    await flushPromises()
    expect(view.find('[data-testid="source-mark-toast"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('添加标记失败时不改行上标签，并带上接口错误', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
    vi.spyOn(sourceApi, 'tagSource').mockRejectedValue(new Error('请求失败 500: 标记失败'))
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-tag-正文缺失"]').trigger('click')
    await wrapper.get('[data-testid="mark-save"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toBe('—')
    expect(wrapper.find('[data-testid="source-mark-toast"]').exists()).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('请求失败 500'))
    wrapper.unmount()
  })

  it('添加标记浮层只有一块面板：无 Tab、无侧栏菜单', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    expect(wrapper.find('[data-testid="source-mark-popover"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mark-tab-tags"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-tab-color"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-action-menu"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-action-add-tags"]').exists()).toBe(false)
    // 0831 F02：文案是「清空标签」不是「移除标签」——它清掉整批的全部标签，
    // 「移除」会让人以为能挑一个删（那条路在行内弹窗里）
    expect(wrapper.get('[data-testid="mark-action-clear-tags"]').text()).toBe('清空标签')
    wrapper.unmount()
  })

  it('移除标签需确认后才调用 tagSource clear', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, tags: ['正文缺失'] }] })
    const tag = vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-tags"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(tag).toHaveBeenCalledWith(['src-1'], [], 'clear')
    expect(wrapper.get('[data-testid="source-mark-toast"]').text()).toContain('已清除 1 个源的标签')
    wrapper.unmount()
  })

  it('清除标签失败时不改行上标签', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, tags: ['正文缺失'] }] })
    vi.spyOn(sourceApi, 'tagSource').mockRejectedValue(new Error('请求失败 500'))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-tags"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('正文缺失')
    expect(wrapper.find('[data-testid="source-mark-toast"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('取消移除标签时不发请求', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, tags: ['正文缺失'] }] })
    const tag = vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-tags"]').trigger('click')
    await flushPromises()
    expect(tag).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // 0831 F01：颜色标识整块下线（会上「颜色重复了、根本记不得哪个是哪个」）。
  // 这条锁的是「UI 上一个颜色控件都不许有」——适配层的 setColor 保留是另一回事，旧平台还在用。
  it('筛选区、表格、打标弹窗里都没有任何颜色控件', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, color: 'blue' }] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-color"]').exists()).toBe(false)
    // 旧数据带着 color/usedFlag 也不该渲染出残留色点
    expect(wrapper.find('.sov-mark-dot').exists()).toBe(false)

    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    expect(wrapper.find('[data-testid="mark-color-red"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-color-none"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mark-action-clear-color"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('发任务不会清掉刚打上的标签', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, tags: ['正文缺失'] }] })
    vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
    vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    // 勾 1 个、无参数 → 直接发，没有确认框可点
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('正文缺失')
    wrapper.unmount()
  })
})

// 「勾选只可能来自当前页」是批量备注取原标签的前提（batchSetRemark 按 rows 找行）。
// 这个前提由文件末尾的 watch(rows) 维持，离取标签的代码 400 行远——这里把它锁死：
// 谁要是为了做跨页批量把那个 watcher 去掉，先在这条用例上红一次，别等线上把标签洗了才发现。
describe('SourceOverviewView · 勾选不跨页', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  // 分页 0902 换成 el-pagination，测试环境里它不是真组件、点不动（见 ResultView.test.ts 同款说明）。
  // 但要锁的不变量是「rows 被整份替换 → 勾选清空」，翻页和重新查询走的是同一条路径
  // （都经 loadSources 重设 rows，由 watch(rows) 清勾选），这里用查询来验，等价。
  it('列表重新加载后勾选被清空，批量条里不会残留上一批的源', async () => {
    const page1 = { ...source, sourceId: 'src-1', tags: ['正文缺失'] }
    const page2 = { ...source, sourceId: 'src-2', tags: ['内容重复'] }
    vi.spyOn(sourceApi, 'sourcePaged')
      .mockResolvedValueOnce({ total: 25, list: [page1] })
      .mockResolvedValue({ total: 25, list: [page2] })
    const update = vi.spyOn(sourceApi, 'updateSourceMark').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    expect(wrapper.get('[data-testid="source-batch-count"]').text()).toContain('已选 1')

    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="source-batch-count"]').exists()).toBe(false)

    // 新一批里重新勾选后批量备注，只会命中新那条，且带的是它自己的标签
    await wrapper.get('[data-testid="source-check-src-2"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-remark-input"]').setValue('第二页备注')
    await wrapper.get('[data-testid="mark-remark-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith('src-2', { tags: ['内容重复'], remark: '第二页备注' })
    wrapper.unmount()
  })
})

// 批量设置备注（0901，新功能——旧平台源列表也只有单行「备注信息」弹窗，没有批量入口）。
describe('SourceOverviewView · 批量设置备注', () => {
  afterEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('批量设置备注：每行原有标签原样带上，只覆盖 remark', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2,
      list: [{ ...source, tags: ['正文缺失'] }, { ...source, sourceId: 'src-2', tags: [] }],
    })
    const update = vi.spyOn(sourceApi, 'updateSourceMark').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="source-check-src-2"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-remark-input"]').setValue('批量验证正常')
    await wrapper.get('[data-testid="mark-remark-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('src-1', { tags: ['正文缺失'], remark: '批量验证正常' })
    expect(update).toHaveBeenCalledWith('src-2', { tags: [], remark: '批量验证正常' })
    expect(wrapper.get('[data-testid="source-mark-toast"]').text()).toContain('已设置 2 个源的备注')
    wrapper.unmount()
  })

  it('备注框留空时保存按钮不可点', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    expect(wrapper.get('[data-testid="mark-remark-save"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('批量设置备注失败时不改行上备注', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, remark: '原备注' }] })
    vi.spyOn(sourceApi, 'updateSourceMark').mockRejectedValue(new Error('请求失败 500'))
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-remark-input"]').setValue('新备注')
    await wrapper.get('[data-testid="mark-remark-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="source-remark-edit"]').text()).toBe('原备注')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('请求失败 500'))
    wrapper.unmount()
  })

  // 跟「清空标签」对称的入口：同样整批覆盖成空、同样需要二次确认。
  it('确认后清空备注：每行原有标签原样带上，只把 remark 覆盖成空', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 1, list: [{ ...source, tags: ['正文缺失'], remark: '原备注' }],
    })
    const update = vi.spyOn(sourceApi, 'updateSourceMark').mockResolvedValue({ ok: true, message: 'ok' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-remark"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('src-1', { tags: ['正文缺失'], remark: '' })
    expect(wrapper.get('[data-testid="source-remark-edit"]').text()).toBe('—')
    expect(wrapper.get('[data-testid="source-mark-toast"]').text()).toContain('已清空 1 个源的备注')
    wrapper.unmount()
  })

  it('取消清空备注时不发请求', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, remark: '原备注' }] })
    const update = vi.spyOn(sourceApi, 'updateSourceMark')
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-remark"]').trigger('click')
    await flushPromises()

    expect(update).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="source-remark-edit"]').text()).toBe('原备注')
    wrapper.unmount()
  })
})

// 2026-08-31 会上实测的缺陷：搜「内容重复」，开发人员当场说"他查到了，但是没返回"。
// 服务端返回了行，客户端又按精确相等滤了一遍，滤成空列表，顺带把 total 改写成 0。
// 这两条是红线——列表展示的行数和总数必须等于服务端给的，不允许本地再插一手。
describe('SourceOverviewView · 标签筛选不做客户端二次过滤（0831 X0）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('服务端按标签返回了行，就照原样展示，不因本地不匹配而滤空', async () => {
    // 关键点：行上的 tags 与筛选词**不精确相等**（服务端可能是模糊/前缀匹配，
    // 也可能行上根本没回 tags 字段）——这正是原来被滤空的形状
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 42,
      list: [
        { ...source, sourceId: 'src-1', name: '源一', tags: ['内容重复率高'] },
        { ...source, sourceId: 'src-2', name: '源二', tags: undefined },
      ],
    })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.text()).toContain('源一')
    expect(wrapper.text()).toContain('源二')
  })

  it('total 用服务端的，不按过滤后的行数改写——否则分页页数跟着错', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 42,
      list: [{ ...source, tags: ['内容重复率高'] }],
    })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('共 42 个源')
    // 分页 0902 统一成 el-pagination（页码文字不再由本组件渲染），改断言绑进去的 total：
    // 42 而不是过滤后的 1，否则页数会从 3 页缩成 1 页。
    expect(wrapper.get('[data-testid="source-pagination"]').attributes('total')).toBe('42')
  })

  it('标签候选来自服务端 sourceTags，程序打的标签也能出现在建议里（F03）', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const tags = vi.spyOn(sourceApi, 'sourceTags').mockResolvedValue(['程序打的标签'])
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()

    // 候选按当前查询条件取，所以要带上 siteIds
    expect(tags).toHaveBeenCalledWith(expect.objectContaining({ siteIds: 'site-current' }))
    const options = wrapper.get('[data-testid="source-overview-tag"]').findAll('option').map((o) => o.text())
    expect(options).toContain('全部')
    expect(options).toContain('程序打的标签')
    // 本机「最近使用」降级为输入辅助，仍然在，但不再是可选范围的上限
    expect(options).toContain('正文缺失')
    wrapper.unmount()
  })

  it('服务端标签候选挂了也能照常打标——候选只是输入辅助，不该拖垮整个视图', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    vi.spyOn(sourceApi, 'sourceTags').mockRejectedValue(new Error('请求失败 500'))
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()

    expect(wrapper.text()).toContain('当前网站源')
    expect(wrapper.find('.sov-empty').exists()).toBe(false)
    const options = wrapper.get('[data-testid="source-overview-tag"]').findAll('option').map((o) => o.text())
    expect(options).toContain('正文缺失')
    wrapper.unmount()
  })

  it('「查看这一批」仍能就地筛出刚打标的行，且按包含匹配（用户可能只输了半截词）', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2,
      list: [
        { ...source, sourceId: 'src-1', name: '源一' },
        { ...source, sourceId: 'src-2', name: '源二' },
      ],
    })
    vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()

    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-tag-search"]').setValue('内容重复率高')
    await wrapper.get('[data-testid="mark-tag-add"]').trigger('click')
    await wrapper.get('[data-testid="mark-save"]').trigger('click')
    await flushPromises()

    // 筛选词是半截的「内容重复」，标签是「内容重复率高」——精确相等会一条都留不下
    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-mark-view-batch"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('源一')
    wrapper.unmount()
  })
})

// 会上「标签要能改能删」指的是删掉三个里的中间那个。批量条只能追加和清空，做不到，
// 所以必须有行内这条路，而且它的语义是**覆盖**——这组测试锁的就是覆盖不被 merge 回来。
describe('SourceOverviewView · 行内改标签与备注（0831 X1-C）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
  })

  // 每次现造一份：overlay 会就地改写行对象（rows 里放的就是 list 里那几个对象），
  // 共享一个字面量会让上一条用例的改动漏到下一条
  const threeTags = (): Source => ({ ...source, tags: ['A标签', 'B标签', 'C标签'], remark: '原备注' })

  async function openEditor(testid: 'source-mark-edit' | 'source-remark-edit') {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [threeTags()] })
    vi.spyOn(sourceApi, 'sourceTags').mockResolvedValue([])
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get(`[data-testid="${testid}"]`).trigger('click')
    await flushPromises()
    return wrapper
  }

  it('标签列和备注列打开的是同一个弹窗', async () => {
    const fromTags = await openEditor('source-mark-edit')
    expect(fromTags.find('[data-testid="edit-source-mark-dialog"]').exists()).toBe(true)
    fromTags.unmount()

    const fromRemark = await openEditor('source-remark-edit')
    expect(fromRemark.find('[data-testid="edit-source-mark-dialog"]').exists()).toBe(true)
    fromRemark.unmount()
  })

  it('删掉三个标签里的中间那个，提交的是剩下两个的完整列表，且只带 tags + remark', async () => {
    const update = vi.spyOn(sourceApi, 'updateSourceMark').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = await openEditor('source-mark-edit')

    await wrapper.get('[data-testid="edit-mark-remove-B标签"]').trigger('click')
    await wrapper.get('[data-testid="edit-mark-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('src-1', { tags: ['A标签', 'C标签'], remark: '原备注' })
    // 行上立刻反映覆盖结果：B 标签不能因为本地 merge 又冒出来
    const rowTags = wrapper.get('[data-testid="source-issue-tags"]').text()
    expect(rowTags).toContain('A标签')
    expect(rowTags).not.toContain('B标签')
    wrapper.unmount()
  })

  it('改备注不动标签', async () => {
    const update = vi.spyOn(sourceApi, 'updateSourceMark').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = await openEditor('source-remark-edit')

    await wrapper.get('[data-testid="edit-mark-remark"]').setValue('验证正常')
    await wrapper.get('[data-testid="edit-mark-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('src-1', { tags: ['A标签', 'B标签', 'C标签'], remark: '验证正常' })
    expect(wrapper.text()).toContain('验证正常')
    wrapper.unmount()
  })

  it('敲了一半没回车就点保存的标签也算数', async () => {
    const update = vi.spyOn(sourceApi, 'updateSourceMark').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = await openEditor('source-mark-edit')

    await wrapper.get('[data-testid="edit-mark-tag-input"]').setValue('D标签')
    await wrapper.get('[data-testid="edit-mark-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('src-1', expect.objectContaining({ tags: ['A标签', 'B标签', 'C标签', 'D标签'] }))
    wrapper.unmount()
  })

  it('保存失败时行上标签不变', async () => {
    vi.spyOn(sourceApi, 'updateSourceMark').mockRejectedValue(new Error('请求失败 500'))
    const wrapper = await openEditor('source-mark-edit')

    await wrapper.get('[data-testid="edit-mark-remove-B标签"]').trigger('click')
    await wrapper.get('[data-testid="edit-mark-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('B标签')
    wrapper.unmount()
  })
})

// 后端是支持的：生产源列表页（118.25.96.217:9999/source/source-list）筛选区就有「备注」。
// 本地那份旧代码快照比线上旧、queryParam 里没有 remark，一度让人误判成"新增能力、后端不支持"。
describe('SourceOverviewView · 备注筛选（0831 X1-B）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  // 2026-09-28 起备注并进「查询」条件：字段选「备注」、条件「包含」
  it('备注关键字作为查询条件，查询时把 remark 带进请求', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('remark')
    const input = wrapper.get('[data-testid="source-overview-search-text"]')
    expect(input.attributes('disabled')).toBeUndefined()
    await input.setValue('验证正常')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ remark: '验证正常' }))
  })

  it('清空后不再带 remark（空串不等于"搜空备注"）', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('remark')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('验证正常')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ remark: undefined }))
  })

  // 责任人（author）线上也有，但 0831 明确暂不做——这条防止以后顺手加进来
  it('不提供责任人筛选', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-author"]').exists()).toBe(false)
  })
})

describe('SourceOverviewView · 任务与成功时间排序', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('支持按「最近任务」排序：升序 -> 降序 -> 取消排序', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    const btn = wrapper.get('[data-testid="sort-last-task"]')
    expect(btn.classes()).not.toContain('ascending')
    expect(btn.classes()).not.toContain('descending')
    expect(btn.attributes('title')).toBe('未排序')

    // 1. 点击升序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).toContain('ascending')
    expect(btn.attributes('title')).toBe('升序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_RUN',
      sorted: 1,
      type: 'ASC',
    }))

    // 2. 再次点击降序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).toContain('descending')
    expect(btn.attributes('title')).toBe('降序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_RUN',
      sorted: -1,
      type: 'DESC',
    }))

    // 3. 第三次点击取消排序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).not.toContain('ascending')
    expect(btn.classes()).not.toContain('descending')
    expect(btn.attributes('title')).toBe('未排序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: undefined,
      sorted: undefined,
      type: undefined,
    }))
  })

  it('支持按「最近成功」排序：升序 -> 降序 -> 取消排序', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    const btn = wrapper.get('[data-testid="sort-last-success"]')
    expect(btn.classes()).not.toContain('ascending')
    expect(btn.classes()).not.toContain('descending')
    expect(btn.attributes('title')).toBe('未排序')

    // 1. 点击升序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).toContain('ascending')
    expect(btn.attributes('title')).toBe('升序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_SUCCESS',
      sorted: 1,
      type: 'ASC',
    }))

    // 2. 再次点击降序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).toContain('descending')
    expect(btn.attributes('title')).toBe('降序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_SUCCESS',
      sorted: -1,
      type: 'DESC',
    }))

    // 3. 第三次点击取消排序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).not.toContain('ascending')
    expect(btn.classes()).not.toContain('descending')
    expect(btn.attributes('title')).toBe('未排序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: undefined,
      sorted: undefined,
      type: undefined,
    }))
  })
})

// 2026-09-18 实测反馈：批量导入后「侧栏 2 个源、主区共 0 个源」——侧栏刷新了自己，
// 主区这张表停在旧结果，用户以为导入没成功。
describe('SourceOverviewView · 源归属被别处改过要重查', () => {
  afterEach(() => vi.restoreAllMocks())

  it('ui.notifySourceListChanged() 触发重新查询', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    const before = page.mock.calls.length

    useUiStore().notifySourceListChanged()
    await flushPromises()

    expect(page.mock.calls.length).toBe(before + 1)
  })

  it('重查不动页码与筛选——用户的查询上下文是他自己设的', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...source, sourceId: `src-${i}` }))
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 80, list: many })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    // 翻到第 2 页
    ;(wrapper.vm as unknown as { page: number }).page = 2
    await flushPromises()

    useUiStore().notifySourceListChanged()
    await flushPromises()

    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
  })
})

// 0920-01：会上要「数据<5」这类筛选。后端 sourcePaged 的 count 就是它，
// 语义是 dataCnt <= N（2026-09-20 实测站 12：无条件 5429、count=5 得 416 且含 47 行正好等于 5）。
describe('源视图 · 按数据量筛选（0920-01）', () => {
  const source: Source = {
    sourceId: 'src-1', name: '数据少的源', url: 'https://a.example.com', configId: 'cfg-1',
    mainTable: 'T1', owner: 'admin', state: 'C', dataCount: 3,
  } as Source

  async function mountWithSpy() {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    page.mockClear()
    return { wrapper, page }
  }

  it('填了才带 count，留空不带', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls[0][0]).not.toHaveProperty('count', expect.anything())
    expect(page.mock.calls[0][0]?.count).toBeUndefined()

    await wrapper.get('[data-testid="source-overview-count"]').setValue('5')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ count: 5, siteIds: 'site-current' }))
  })

  // 0 是有意义的条件（一条数据都没有的源），不能和"没填"混为一谈
  it('填 0 要当条件发出去，不能被当成空', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-count"]').setValue('0')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]?.count).toBe(0)
  })

  it('负数 / 非法输入当没填，不发一个后端看不懂的条件', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-count"]').setValue('-3')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]?.count).toBeUndefined()
  })

  it('「清空」把数据量一起清掉', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-count"]').setValue('5')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]?.count).toBe(5)

    const clear = wrapper.findAll('button').find((b) => b.text() === '清空')
    await clear?.trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]?.count).toBeUndefined()
    expect((wrapper.get('[data-testid="source-overview-count"]').element as HTMLInputElement).value).toBe('')
  })

  it('和其它条件一起发（后端是 AND）', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-count"]').setValue('5')
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('name')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('财经')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ count: 5, name: '财经' }))
  })
})

// 0920-07：会上要「备注为空 / 不为空」。原以为要提后端（B28），2026-09-21 复测发现
// 后端本来就支持：remark=% 是有备注、remark=NULL 是无备注（站 12：8 + 5883 = 5891）。
// 2026-09-28 产品：「改成和数据搜索一样」——备注不再单独一格，并进「查询」条件：
// 包含 / 非空 / 为空，非空、为空就是原来的有备注、无备注。
describe('源视图 · 备注筛选（0920-07，2026-09-28 并进查询条件）', () => {
  const source: Source = {
    sourceId: 'src-1', name: '源', url: 'https://a.example.com', configId: 'cfg-1',
    mainTable: 'T1', owner: 'admin', state: 'C',
  } as Source

  async function mountWithSpy() {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    page.mockClear()
    return { wrapper, page }
  }
  const lastQuery = (page: { mock: { calls: unknown[][] } }) => page.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
  const op = (wrapper: VueWrapper) => wrapper.get('[data-testid="source-overview-search-op"]')
  const text = (wrapper: VueWrapper) => wrapper.get('[data-testid="source-overview-search-text"]').element as HTMLInputElement

  it('没有单独的备注格；备注在查询字段里，条件是 包含 / 非空 / 为空，默认不按备注筛', async () => {
    const { wrapper, page } = await mountWithSpy()
    expect(wrapper.find('[data-testid="source-overview-remark-mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-overview-remark"]').exists()).toBe(false)

    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQuery(page)?.remark).toBeUndefined()

    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('remark')
    expect(op(wrapper).findAll('option').map((o) => o.text())).toEqual(['包含', '非空', '为空'])
  })

  it('「非空」立刻发 remark=%，输入框禁用', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('remark')
    await op(wrapper).setValue('notEmpty')
    await flushPromises()
    expect(lastQuery(page)?.remark).toBe('%')
    expect(text(wrapper).disabled).toBe(true)
  })

  it('「为空」发 remark=NULL，之前填的关键字不会一起发出去', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('remark')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('超时')
    await op(wrapper).setValue('empty')
    await flushPromises()
    expect(lastQuery(page)?.remark).toBe('NULL')
    expect(text(wrapper).disabled).toBe(true)
  })

  it('「清空」回到单行、不按备注筛', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('remark')
    await op(wrapper).setValue('empty')
    await flushPromises()
    const clear = wrapper.findAll('button').find((b) => b.text() === '清空')
    await clear?.trigger('click')
    await flushPromises()
    expect(lastQuery(page)?.remark).toBeUndefined()
    expect(wrapper.findAll('[data-testid="source-overview-condition"]')).toHaveLength(1)
    expect((wrapper.get('[data-testid="source-overview-search-field"]').element as HTMLSelectElement).value).toBe('sourceIds')
  })
})

// 2026-09-28 用户定：查询支持多个条件并行（行与行之间是「并且」）。后端四个参数各自独立、一起给取交集；
// 限制也是后端决定的——同一字段只能一行（一个参数一个值），做不了「或者」。
describe('源视图 · 查询多条件（2026-09-28）', () => {
  const source: Source = {
    sourceId: 'src-1', name: '源', url: 'https://a.example.com', configId: 'cfg-1',
    mainTable: 'T1', owner: 'admin', state: 'C',
  } as Source

  async function mountWithSpy(total = 1) {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total, list: total ? [source] : [] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    page.mockClear()
    return { wrapper, page }
  }
  const lastQ = (page: { mock: { calls: unknown[][] } }) => page.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
  const fields = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="source-overview-search-field"]')
  const texts = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="source-overview-search-text"]')
  const add = (wrapper: VueWrapper) => wrapper.get('[data-testid="source-overview-condition-add"]').trigger('click')

  it('名称、URL、备注三行一起发，另一个没加的参数不发', async () => {
    const { wrapper, page } = await mountWithSpy()
    await fields(wrapper)[0]!.setValue('name')
    await texts(wrapper)[0]!.setValue('盛科')
    await add(wrapper)
    await fields(wrapper)[1]!.setValue('sourceUrl')
    await texts(wrapper)[1]!.setValue('centec')
    await add(wrapper)
    await fields(wrapper)[2]!.setValue('remark')
    await wrapper.findAll('[data-testid="source-overview-search-op"]')[2]!.setValue('notEmpty')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ name: '盛科', sourceUrl: 'centec', remark: '%' }))
    expect(lastQ(page)?.sourceIds).toBeUndefined()
  })

  it('同一字段只能一行：别的行占了的字段置灰；六个字段加满后没有「+」', async () => {
    const { wrapper } = await mountWithSpy()
    await add(wrapper)
    const secondOptions = fields(wrapper)[1]!.findAll('option')
    expect(secondOptions.find((o) => o.attributes('value') === 'sourceIds')?.attributes('disabled')).toBeDefined()
    expect((fields(wrapper)[1]!.element as HTMLSelectElement).value).toBe('name')
    await add(wrapper)
    await add(wrapper)
    await add(wrapper)
    await add(wrapper)
    // 1008-04 加了「默认流程 ID」条件字段（defaultFlowId），字段数从 5 变 6
    expect(fields(wrapper).map((f) => (f.element as HTMLSelectElement).value)).toEqual(['sourceIds', 'name', 'sourceUrl', 'remark', 'flowId', 'defaultFlowId'])
    expect(wrapper.find('[data-testid="source-overview-condition-add"]').exists()).toBe(false)
  })

  // 0930-15（会后 Leon：「可以根据流程查有哪些源」）
  it('按流程 ID 查：选「流程 ID」填值后作为 flowId 发出；纯数字不会被自动识别成源 ID', async () => {
    const { wrapper, page } = await mountWithSpy()
    await fields(wrapper)[0]!.setValue('flowId')
    await texts(wrapper)[0]!.setValue('14009350')
    expect((fields(wrapper)[0]!.element as HTMLSelectElement).value).toBe('flowId')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ flowId: '14009350' }))
    expect(lastQ(page)?.sourceIds).toBeUndefined()
  })

  it('流程中心跳过来带的流程 ID 落成一行「流程 ID 等于」并按它查，不再有单独的过滤芯片', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current', initialFlowId: '1400330' }, attachTo: document.body })
    await flushPromises()
    expect(fields(wrapper).map((f) => (f.element as HTMLSelectElement).value)).toEqual(['flowId'])
    expect((texts(wrapper)[0]!.element as HTMLInputElement).value).toBe('1400330')
    expect(lastQ(page)).toEqual(expect.objectContaining({ flowId: '1400330' }))
    expect(wrapper.find('[data-testid="source-flow-chip"]').exists()).toBe(false)

    await wrapper.findAll('[data-testid="source-overview-condition-remove"]')[0]!.trigger('click')
    await flushPromises()
    expect(lastQ(page)?.flowId).toBeUndefined()
    wrapper.unmount()
  })

  it('× 删掉一行并重查；只剩一行时 × 是清空这一行', async () => {
    const { wrapper, page } = await mountWithSpy()
    await texts(wrapper)[0]!.setValue('盛科')
    await add(wrapper)
    await fields(wrapper)[1]!.setValue('remark')
    await wrapper.findAll('[data-testid="source-overview-search-op"]')[1]!.setValue('empty')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ name: '盛科', remark: 'NULL' }))

    await wrapper.findAll('[data-testid="source-overview-condition-remove"]')[1]!.trigger('click')
    await flushPromises()
    expect(fields(wrapper)).toHaveLength(1)
    expect(lastQ(page)).toEqual(expect.objectContaining({ name: '盛科', remark: undefined }))

    await wrapper.get('[data-testid="source-overview-condition-remove"]').trigger('click')
    await flushPromises()
    expect((texts(wrapper)[0]!.element as HTMLInputElement).value).toBe('')
    expect(lastQ(page)?.name).toBeUndefined()
  })

  // 2026-09-29 后端上线 sourceUrl=NULL / NOT NULL：URL 条件是 包含 / 非空 / 为空，全部可选
  it('URL 条件：包含 / 非空 / 为空都能选；为空发 NULL、非空发 NOT NULL', async () => {
    const { wrapper, page } = await mountWithSpy()
    await fields(wrapper)[0]!.setValue('sourceUrl')
    const op = wrapper.get('[data-testid="source-overview-search-op"]')
    const options = op.findAll('option')
    expect(options.map((o) => o.text())).toEqual(['包含', '非空', '为空'])
    expect(options.every((o) => o.attributes('disabled') === undefined)).toBe(true)

    await op.setValue('empty')
    await flushPromises()
    expect(lastQ(page)?.sourceUrl).toBe('NULL')

    await op.setValue('notEmpty')
    await flushPromises()
    expect(lastQ(page)?.sourceUrl).toBe('NOT NULL')
  })

  it('自动识别不抢别的行已占的字段：识别成 URL 但 URL 已有一行时，按名称查', async () => {
    const { wrapper, page } = await mountWithSpy()
    await texts(wrapper)[0]!.setValue('centec.com')
    expect((fields(wrapper)[0]!.element as HTMLSelectElement).value).toBe('sourceUrl')
    await add(wrapper)
    await texts(wrapper)[1]!.setValue('www.sanyoumed.com')
    expect((fields(wrapper)[1]!.element as HTMLSelectElement).value).toBe('name')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceUrl: 'centec.com', name: 'www.sanyoumed.com' }))
  })
})

// 0917-11（2026-09-21 定范围）：源 ID / 源名称 / 源 URL 三格并成「字段 ▾ + 输入框」。
// 代价是一次只能按一个字段查——这几条就是钉住"只发选中的那个参数"。
describe('源视图 · 查询三合一（0917-11）', () => {
  const source: Source = {
    sourceId: 'src-1', name: '源', url: 'https://a.example.com', configId: 'cfg-1',
    mainTable: 'T1', owner: 'admin', state: 'C',
  } as Source

  async function mountWithSpy(props: Record<string, unknown> = {}) {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current', ...props }, attachTo: document.body })
    await flushPromises()
    page.mockClear()
    return { wrapper, page }
  }
  const lastQ = (page: { mock: { calls: unknown[][] } }) => page.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined

  it('选哪个字段就只发哪个参数，另外两个不发', async () => {
    const { wrapper, page } = await mountWithSpy()
    const field = wrapper.get('[data-testid="source-overview-search-field"]')
    const text = wrapper.get('[data-testid="source-overview-search-text"]')

    await field.setValue('name')
    await text.setValue('财经')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ name: '财经' }))
    expect(lastQ(page)?.sourceIds).toBeUndefined()
    expect(lastQ(page)?.sourceUrl).toBeUndefined()

    await field.setValue('sourceUrl')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceUrl: '财经' }))
    expect(lastQ(page)?.name).toBeUndefined()

    await field.setValue('sourceIds')
    await text.setValue('430016214, 430016215')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceIds: '430016214, 430016215' }))
    expect(lastQ(page)?.name).toBeUndefined()
  })

  it('切字段时如果框里有值就立刻重查，空着就不白打一次请求', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('name')
    await flushPromises()
    expect(page).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('财经')
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('sourceUrl')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceUrl: '财经' }))
  })

  // 从流程中心/数据视图反查跳过来时带的是一串源 ID，字段必须跟着切过去，
  // 否则这串 ID 会被当成名称关键字发出去，查出来 0 条
  it('外部带 initialSourceIds 进来时，字段自动切到「源 ID」', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.setProps({ initialSourceIds: '430016214,430016215' })
    await flushPromises()

    expect((wrapper.get('[data-testid="source-overview-search-field"]').element as HTMLSelectElement).value).toBe('sourceIds')
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceIds: '430016214,430016215' }))
  })

  it('占位提示：没手动选字段时说明会自动识别；手动选了就跟着字段走', async () => {
    const { wrapper } = await mountWithSpy()
    const text = () => (wrapper.get('[data-testid="source-overview-search-text"]').element as HTMLInputElement).placeholder
    expect(text()).toBe('源 ID / 名称 / URL，自动识别')
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('sourceUrl')
    expect(text()).toBe('URL 关键字，如 centec')
  })

  // 2026-09-28 产品：「选择要点 2 下」「url 这种可以自动识别」
  it('不点下拉直接输入：按内容自动切字段，只发对应参数', async () => {
    const { wrapper, page } = await mountWithSpy()
    const field = () => (wrapper.get('[data-testid="source-overview-search-field"]').element as HTMLSelectElement).value
    const input = wrapper.get('[data-testid="source-overview-search-text"]')
    const run = async (v: string) => {
      await input.setValue(v)
      await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
      await flushPromises()
    }

    await run('https://www.sanyoumed.com/zh/news')
    expect(field()).toBe('sourceUrl')
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceUrl: 'https://www.sanyoumed.com/zh/news' }))
    expect(lastQ(page)?.name).toBeUndefined()

    await run('430016214, 430016215')
    expect(field()).toBe('sourceIds')
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceIds: '430016214, 430016215' }))

    await run('三友医疗')
    expect(field()).toBe('name')
    expect(lastQ(page)).toEqual(expect.objectContaining({ name: '三友医疗' }))
  })

  it('手动选的字段优先，之后输入不再自动改；清空输入框后恢复自动', async () => {
    const { wrapper } = await mountWithSpy()
    const field = () => (wrapper.get('[data-testid="source-overview-search-field"]').element as HTMLSelectElement).value
    const input = wrapper.get('[data-testid="source-overview-search-text"]')
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('name')
    await input.setValue('www.cls.cn')
    expect(field()).toBe('name')

    await input.setValue('')
    await input.setValue('www.cls.cn')
    expect(field()).toBe('sourceUrl')
  })

  it('按名称没查到、输入像网址片段时提示「改按 URL 查」，点了就按 URL 重查', async () => {
    const { wrapper, page } = await mountWithSpy()
    page.mockResolvedValue({ total: 0, list: [] })
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('centec')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()

    const hint = wrapper.get('[data-testid="source-overview-url-fallback"]')
    expect(hint.text()).toContain('按名称没查到「centec」')
    page.mockResolvedValue({ total: 1, list: [source] })
    await hint.get('button').trigger('click')
    await flushPromises()
    expect(lastQ(page)).toEqual(expect.objectContaining({ sourceUrl: 'centec' }))
    expect(wrapper.find('[data-testid="source-overview-url-fallback"]').exists()).toBe(false)
  })

  it('中文名称查空不提示改按 URL（不可能是网址）；手动选了名称查空也不提示', async () => {
    const { wrapper, page } = await mountWithSpy()
    page.mockResolvedValue({ total: 0, list: [] })
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('不存在的源')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-url-fallback"]').exists()).toBe(false)

    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('name')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('centec')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-url-fallback"]').exists()).toBe(false)
  })

  it('「清空」把字段也还原成源 ID', async () => {
    const { wrapper, page } = await mountWithSpy()
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('name')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('财经')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()

    const clear = wrapper.findAll('button').find((b) => b.text() === '清空')
    await clear?.trigger('click')
    await flushPromises()
    expect((wrapper.get('[data-testid="source-overview-search-field"]').element as HTMLSelectElement).value).toBe('sourceIds')
    expect(lastQ(page)?.name).toBeUndefined()
    expect(lastQ(page)?.sourceIds).toBeUndefined()
  })
})


// 0924-06：采集资产的源列表视图复用本组件，currentSiteId 传空 = 不限网站
describe('源视图 · 不限网站（采集资产源列表视图，0924-06）', () => {
  const rowOf = (over: Partial<Source>): Source => ({
    sourceId: 'src-1', name: '源', url: 'https://a.example.com', configId: 'cfg-1',
    mainTable: 'T1', owner: 'admin', state: 'C', ...over,
  } as Source)

  async function mountCross(props: Record<string, unknown> = {}) {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2,
      list: [rowOf({ sourceId: 's1', siteId: '105', siteName: '公众号采集-测试' }), rowOf({ sourceId: 's2', siteId: '0' })],
    })
    const sites = vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({
      total: 3,
      list: [{ siteId: '105', name: '公众号采集-测试' }, { siteId: '12', name: '上市公司' }, { siteId: '89', name: '主流媒体' }] as never,
    })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: '', ...props }, attachTo: document.body })
    await flushPromises()
    return { wrapper, page, sites }
  }
  const lastQuery = (page: { mock: { calls: unknown[][] } }) => page.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined

  afterEach(() => vi.restoreAllMocks())

  it('不带 siteIds；多出「所属网站」列（用接口返回的 siteName），未关联的源显示「未关联」', async () => {
    const { wrapper, page } = await mountCross()
    expect(lastQuery(page)?.siteIds).toBeUndefined()
    expect(wrapper.findAll('th').map((th) => th.text())).toContain('所属网站')
    const links = wrapper.findAll('[data-testid="source-overview-site-link"]')
    expect(links.map((l) => l.text())).toEqual(['公众号采集-测试'])
    expect(wrapper.text()).toContain('未关联')
  })

  // 生产 sourcePaged 列表只有 siteId、没有 siteName：名称从组件自己拉的网站列表里对
  it('接口没给 siteName 时，用网站列表把 siteId 换成名称', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [rowOf({ sourceId: 's3', siteId: '12' })] })
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 1, list: [{ siteId: '12', name: '上市公司' }] as never })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: '' }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.get('[data-testid="source-overview-site-link"]').text()).toBe('上市公司')
  })

  it('点所属网站发 openSite', async () => {
    const { wrapper } = await mountCross()
    await wrapper.get('[data-testid="source-overview-site-link"]').trigger('click')
    expect(wrapper.emitted('openSite')?.[0]).toEqual(['105'])
  })

  it('「网站」筛选：候选由组件自己拉；选中后按该网站查，「未关联网站」传 -1，清空还原', async () => {
    const { wrapper, page, sites } = await mountCross()
    expect(sites).toHaveBeenCalledTimes(1)
    const select = wrapper.get('[data-testid="source-overview-site"]')
    expect(select.findAll('option').map((o) => o.text())).toEqual(['全部网站', '未关联网站', '公众号采集-测试', '上市公司', '主流媒体'])

    await select.setValue('12')
    await flushPromises()
    expect(lastQuery(page)?.siteIds).toBe('12')

    await select.setValue('-1')
    await flushPromises()
    expect(lastQuery(page)?.siteIds).toBe('-1')

    await wrapper.findAll('button').find((b) => b.text() === '清空')!.trigger('click')
    await flushPromises()
    expect(lastQuery(page)?.siteIds).toBeUndefined()
  })

  it('页签范围 scopeSiteIds：按逗号拼成 siteIds；网站候选只列范围内的，不给「未关联网站」', async () => {
    const { wrapper, page } = await mountCross({ scopeSiteIds: ['89', '12'] })
    expect(lastQuery(page)?.siteIds).toBe('89,12')
    const options = wrapper.get('[data-testid="source-overview-site"]').findAll('option').map((o) => o.text())
    expect(options).toEqual(['全部网站', '上市公司', '主流媒体'])
  })

  it('范围为空数组：不发请求，显示调用方给的空态文案', async () => {
    const { wrapper, page } = await mountCross({ scopeSiteIds: [], scopeEmptyText: '还没有打开过网站' })
    expect(page).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('还没有打开过网站')
  })

  it('范围变了就重查', async () => {
    const { wrapper, page } = await mountCross({ scopeSiteIds: ['89'] })
    page.mockClear()
    await wrapper.setProps({ scopeSiteIds: ['105', '89'] })
    await flushPromises()
    expect(lastQuery(page)?.siteIds).toBe('105,89')
  })

  it('网站详情里（传了 currentSiteId）：没有所属网站列和网站筛选，也不去拉网站列表', async () => {
    const sites = vi.spyOn(siteApi, 'sitePaged')
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [rowOf({})] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: '12' }, attachTo: document.body })
    await flushPromises()
    expect(wrapper.findAll('th').map((th) => th.text())).not.toContain('所属网站')
    expect(wrapper.find('[data-testid="source-overview-site"]').exists()).toBe(false)
    expect(sites).not.toHaveBeenCalled()
  })
})

describe('源视图 · 源收藏（0924-08）', () => {
  const rowOf = (over: Partial<Source>): Source => ({
    sourceId: 'src-1', name: '源', url: 'https://a.example.com', configId: 'cfg-1',
    mainTable: 'T1', owner: 'admin', state: 'C', ...over,
  } as Source)

  async function mountFav(props: Record<string, unknown> = {}, favorites: string[] = []) {
    vi.spyOn(favoriteApi, 'listIds').mockResolvedValue(favorites)
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 2, list: [rowOf({ sourceId: 's1', siteId: '105' }), rowOf({ sourceId: 's2', siteId: '105' })],
    })
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: '', ...props }, attachTo: document.body })
    await flushPromises()
    return { wrapper, page }
  }
  const lastQuery = (page: { mock: { calls: unknown[][] } }) => page.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined

  beforeEach(() => { favoriteSourceIds.value = new Set() })
  afterEach(() => vi.restoreAllMocks())

  it('每行有收藏星标：进来按后端收藏点亮，点击按 SOURCE 收藏 / 取消', async () => {
    const add = vi.spyOn(favoriteApi, 'add').mockResolvedValue({ ok: true, message: '' })
    const remove = vi.spyOn(favoriteApi, 'remove').mockResolvedValue({ ok: true, message: '' })
    const { wrapper } = await mountFav({}, ['s2'])

    expect(wrapper.get('[data-testid="source-fav-s1"]').classes()).not.toContain('on')
    expect(wrapper.get('[data-testid="source-fav-s2"]').classes()).toContain('on')

    await wrapper.get('[data-testid="source-fav-s1"]').trigger('click')
    await flushPromises()
    expect(add).toHaveBeenCalledWith('SOURCE', 's1')
    expect(wrapper.get('[data-testid="source-fav-s1"]').classes()).toContain('on')

    await wrapper.get('[data-testid="source-fav-s2"]').trigger('click')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('SOURCE', 's2')
    expect(wrapper.get('[data-testid="source-fav-s2"]').classes()).not.toContain('on')
  })

  it('网站详情的源视图（传了 currentSiteId）同样有星标', async () => {
    const { wrapper } = await mountFav({ currentSiteId: '105' })
    expect(wrapper.find('[data-testid="source-fav-s1"]').exists()).toBe(true)
  })

  it('范围 scopeSourceIds：按逗号拼成源 ID 发给后端', async () => {
    const { page } = await mountFav({ scopeSourceIds: ['s1', 's2'] })
    expect(lastQuery(page)?.sourceIds).toBe('s1,s2')
  })

  it('范围为空数组：不发请求，显示调用方给的空态文案（空 ids 会被后端当成不限）', async () => {
    const { wrapper, page } = await mountFav({ scopeSourceIds: [], scopeEmptyText: '还没有收藏的源' })
    expect(page).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('还没有收藏的源')
  })

  it('与「源 ID」条件取交集；交集为空不发请求', async () => {
    const hit = await mountFav({ scopeSourceIds: ['s1', 's2'], initialSourceIds: 's2, s9' })
    expect(lastQuery(hit.page)?.sourceIds).toBe('s2')
    hit.wrapper.unmount()
    vi.restoreAllMocks()

    const miss = await mountFav({ scopeSourceIds: ['s1', 's2'], initialSourceIds: 's9' })
    expect(miss.page).not.toHaveBeenCalled()
  })

  it('范围里取消了收藏就重查', async () => {
    const { wrapper, page } = await mountFav({ scopeSourceIds: ['s1', 's2'] })
    page.mockClear()
    await wrapper.setProps({ scopeSourceIds: ['s1'] })
    await flushPromises()
    expect(lastQuery(page)?.sourceIds).toBe('s1')
  })

  // 范围为空时 currentQuery 里的 siteIds / sourceIds 是空的 = 不限，照发就成了导出全库
  it.each([
    ['收藏为空', { scopeSourceIds: [] }],
    ['最近打开为空', { scopeSiteIds: [] }],
  ])('%s时点导出：不发请求，提示没有命中', async (_label, props) => {
    const warn = vi.spyOn(ElMessage, 'warning')
    const xlsx = vi.spyOn(xlsxExport, 'downloadXlsx').mockImplementation(() => {})
    const { wrapper, page } = await mountFav(props)
    await wrapper.findAll('[data-testid="source-export"]')[0]!.trigger('click')
    await flushPromises()
    expect(page).not.toHaveBeenCalled()
    expect(xlsx).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('当前查询条件没有命中任何源')
  })
})

describe('SourceOverviewView · 1008-04 来源组（groupOps）', () => {
  const GROUP_SOURCE: Source = { sourceId: '391000500', name: '组内源', sourceGroupId: '3', state: 'C', siteId: 's1', url: '', configId: '', mainTable: '', owner: '' }
  const INDEP_SOURCE: Source = { sourceId: '430024667', name: '独立源', sourceGroupId: undefined, state: 'C', siteId: 's2', defaultFlowId: '14010130', url: '', configId: '', mainTable: '', owner: '' }

  async function mountGroupOps(sourceList: Source[] = [GROUP_SOURCE, INDEP_SOURCE]) {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: sourceList.length, list: sourceList })
    vi.spyOn(sourceGroupApi, 'list').mockResolvedValue([
      { sourceGroupId: '3', sourceGroupCode: 'twitter1', sourceGroupName: 'twitter1', state: 'ACTIVE', flowIds: ['21000005', '21000006'], defaultFlowId: '21000006', revision: 2 },
      { sourceGroupId: '1', sourceGroupCode: 'test1', sourceGroupName: '测试组1', state: 'ACTIVE', flowIds: [], revision: 1 },
    ])
    vi.spyOn(flowCenterApi, 'list').mockResolvedValue([])
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: '', groupOps: true }, attachTo: document.body })
    await flushPromises()
    page.mockClear()
    return { wrapper, page }
  }

  it('groupOps 时显示来源组 / 默认流程 / 流程配置三列', async () => {
    const { wrapper } = await mountGroupOps()
    expect(wrapper.find('[data-testid="source-overview-group-link"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-overview-default-flow"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-overview-flow-config"]').exists()).toBe(true)
    // 独立源默认流程显示 ID
    expect(wrapper.text()).toContain('14010130')
    // 未归组显示 —
    const groupText = wrapper.findAll('.sov-group').map((n) => n.text())
    expect(groupText.some((t) => t.includes('—'))).toBe(true)
    wrapper.unmount()
  })

  it('默认流程列：组内源后缀「来源组」，没有默认流程的源标红「无流程」（1021-02 / 08）', async () => {
    const { wrapper } = await mountGroupOps([{ ...GROUP_SOURCE, defaultFlowId: '21000006' }, INDEP_SOURCE, { ...INDEP_SOURCE, sourceId: '430024668', defaultFlowId: undefined }])
    const cells = wrapper.findAll('.sov-default-flow')
    expect(cells[0].find('[data-testid="source-overview-default-flow-group"]').exists()).toBe(true)
    expect(cells[1].find('[data-testid="source-overview-default-flow-group"]').exists()).toBe(false)
    expect(cells[2].get('[data-testid="source-overview-no-flow"]').text()).toBe('无流程')
    wrapper.unmount()
  })

  it('点主表：拉表结构并打开表详情抽屉；没有主表的源显示 —', async () => {
    const withTable: Source = { ...INDEP_SOURCE, mainTable: '6200039' }
    const { wrapper } = await mountGroupOps([withTable, { ...GROUP_SOURCE, mainTable: '' }])
    const metaSpy = vi.spyOn(dataApi, 'tableMeta').mockResolvedValue({
      tableId: '6200039', tableName: 'sense_data.TB_TEST02', name: '测试表2', state: 'C', fields: [],
    } as never)

    const links = wrapper.findAll('[data-testid="source-overview-main-table"]')
    expect(links).toHaveLength(1)
    expect(links[0].text()).toBe('6200039')
    await links[0].trigger('click')
    await flushPromises()

    expect(metaSpy).toHaveBeenCalledWith('6200039')
    expect(document.body.textContent).toContain('sense_data.TB_TEST02')
    wrapper.unmount()
  })

  it('非 groupOps（收藏页签）不显示三列', async () => {
    const { wrapper } = await mountGroupOps()
    // groupOps=false 时（收藏 / 最近页签）三列隐藏
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [GROUP_SOURCE] })
    await wrapper.setProps({ groupOps: false })
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-group-link"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="source-overview-flow-config"]').exists()).toBe(false)
    page.mockRestore()
    wrapper.unmount()
  })

  it('来源组筛选：选组后查询带 sourceGroupId；不含「未归组」选项', async () => {
    const { wrapper, page } = await mountGroupOps()
    const groupSelect = wrapper.find('[data-testid="source-overview-group"]')
    expect(groupSelect.exists()).toBe(true)
    const options = groupSelect.findAll('option')
    expect(options.map((o) => o.attributes('value'))).toEqual(['', '3', '1'])
    await groupSelect.setValue('3')
    await wrapper.find('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ sourceGroupId: '3' }))
    wrapper.unmount()
  })

  it('点来源组名发 openSourceGroup 事件', async () => {
    const { wrapper } = await mountGroupOps()
    await wrapper.find('[data-testid="source-overview-group-link"]').trigger('click')
    expect(wrapper.emitted('openSourceGroup')).toEqual([['3']])
    wrapper.unmount()
  })

  it('「选中来源」下拉常驻：不勾选也可点（调整来源组按范围；另两项提示需勾选）', async () => {
    const { wrapper } = await mountGroupOps([GROUP_SOURCE])
    // 不勾选就有下拉
    expect(wrapper.find('[data-testid="source-group-ops"]').exists()).toBe(true)
    // 勾选后仍在
    const check = wrapper.find('[data-testid="source-check-391000500"]')
    ;(check.element as HTMLInputElement).click()
    await flushPromises()
    expect(wrapper.find('[data-testid="source-group-ops"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('默认流程 ID 条件：选「默认流程 ID」填值后作为 defaultFlowId 发出', async () => {
    const { wrapper, page } = await mountGroupOps()
    await wrapper.get('[data-testid="source-overview-search-field"]').setValue('defaultFlowId')
    await wrapper.get('[data-testid="source-overview-search-text"]').setValue('21000006')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ defaultFlowId: '21000006' }))
    wrapper.unmount()
  })
})

// 2026-10-12「我的视图」：外部给定视图状态 → 套用并重查；隐藏列
describe('SourceOverviewView · 视图状态', () => {
  afterEach(() => vi.restoreAllMocks())
  const viewState = {
    v: 1 as const,
    conditions: [{ field: 'name' as const, op: 'like' as const, value: '公告' }],
    site: '', sourceGroup: '', status: 'E' as const, tag: '', countMax: '5',
    sortField: 'DATA_CNT', sortDirection: 'desc' as const, pageSize: 50, hiddenColumns: ['url', 'tags'],
  }

  it('挂载即按视图状态查询：条件、状态、数据量、排序、每页条数都带上；隐藏的列不出', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [source] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', viewState } })
    await flushPromises()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ name: '公告', state: 'E', count: 5, field: 'DATA_CNT', type: 'DESC', size: 50, page: 1 }))
    const heads = wrapper.findAll('th').map((th) => th.text())
    expect(heads).not.toContain('URL')
    expect(heads).not.toContain('标签')
    expect(heads).toContain('主表')
    expect(wrapper.find('.sov-url').exists()).toBe(false)
    wrapper.unmount()
  })

  it('父级换成新的视图状态对象时重新套用并重查', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '', viewState } })
    await flushPromises()
    await wrapper.setProps({ viewState: { ...viewState, status: 'disabled', hiddenColumns: [] } })
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ enable: '1', state: undefined }))
    expect(wrapper.findAll('th').map((th) => th.text())).toContain('URL')
    wrapper.unmount()
  })

  it('不传视图状态时行为不变：全部列、默认 20 条', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: '' } })
    await flushPromises()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ size: 20, field: undefined }))
    expect(wrapper.findAll('th').map((th) => th.text())).toEqual(expect.arrayContaining(['URL', '主表', '标签', '状态', '备注']))
    wrapper.unmount()
  })
})

