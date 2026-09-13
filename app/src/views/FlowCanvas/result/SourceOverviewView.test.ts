// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import SourceOverviewView from './SourceOverviewView.vue'
import { sourceApi, type Source } from '@/api'
import * as xlsxExport from '@/utils/format/xlsxExport'
import { createPinia, setActivePinia } from 'pinia'

// 本组件用到了 launchJob store（Y4-5 批量提交作业条）。这里的 mount 都是裸挂载、
// 没装 pinia 插件，所以在每个用例前设一个活动 pinia 就够——store 是在 setup 里
// 直接 useXxxStore() 拿的，不经过 app.use()。每个用例一个新实例，作业态不串。
beforeEach(() => setActivePinia(createPinia()))

const source: Source = {
  sourceId: 'src-1', name: '当前网站源', url: 'https://example.com', configId: 'cfg-1', mainTable: 'TB_1', owner: 'tester', state: 'C', siteId: 'site-current', dataCount: 3,
}

describe('SourceOverviewView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
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

    await wrapper.get('[data-testid="source-overview-source-ids"]').setValue('src-1, src-2')
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
    await wrapper.get('[data-testid="source-overview-name"]').setValue('财经')
    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-overview-remark"]').setValue('验证正常')
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

  it('勾选后走 selected 范围，确认后一次带多个 ids，all 恒为 0', async () => {
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 2, list: rows })
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-all"]').setValue(true)
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="launch-confirm-dialog"]').text()).toContain('已勾选 2')
    await wrapper.get('[data-testid="launch-confirm"]').trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].ids).toEqual(['src-1', 'src-2'])
    expect(send.mock.calls[0][0].all).toBe(0)
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
    await wrapper.get('[data-testid="source-launch"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="launch-confirm"]').trigger('click')
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

  it('备注输入框可用，查询时把 remark 带进请求', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()

    const input = wrapper.get('[data-testid="source-overview-remark"]')
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

    await wrapper.get('[data-testid="source-overview-remark"]').setValue('验证正常')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await wrapper.get('[data-testid="source-overview-remark"]').setValue('')
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
    expect(btn.text()).toContain('最近任务 ↕')
    expect(btn.attributes('title')).toBe('未排序')

    // 1. 点击升序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.text()).toContain('最近任务 ↑')
    expect(btn.attributes('title')).toBe('升序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_RUN',
      sorted: 1,
      type: 'ASC',
    }))

    // 2. 再次点击降序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.text()).toContain('最近任务 ↓')
    expect(btn.attributes('title')).toBe('降序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_RUN',
      sorted: -1,
      type: 'DESC',
    }))

    // 3. 第三次点击取消排序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.text()).toContain('最近任务 ↕')
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
    expect(btn.text()).toContain('最近成功 ↕')
    expect(btn.attributes('title')).toBe('未排序')

    // 1. 点击升序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.text()).toContain('最近成功 ↑')
    expect(btn.attributes('title')).toBe('升序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_SUCCESS',
      sorted: 1,
      type: 'ASC',
    }))

    // 2. 再次点击降序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.text()).toContain('最近成功 ↓')
    expect(btn.attributes('title')).toBe('降序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: 'LAST_SUCCESS',
      sorted: -1,
      type: 'DESC',
    }))

    // 3. 第三次点击取消排序
    await btn.trigger('click')
    await flushPromises()
    expect(btn.text()).toContain('最近成功 ↕')
    expect(btn.attributes('title')).toBe('未排序')
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({
      field: undefined,
      sorted: undefined,
      type: undefined,
    }))
  })
})
