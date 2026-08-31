// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import SourceOverviewView from './SourceOverviewView.vue'
import { sourceApi, type Source } from '@/api'

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

  it('批量发抓取用同一个接口一次带多个 ids，不另起批量端点', async () => {
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = await mountWithRows()
    await wrapper.get('[data-testid="source-check-all"]').setValue(true)
    await wrapper.get('[data-testid="batch-snatch"]').trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].ids).toEqual(['src-1', 'src-2'])
  })

  it('批量停用逐个调 changeSourceEnable，且确认后才发', async () => {
    const toggle = vi.spyOn(sourceApi, 'changeSourceEnable').mockResolvedValue({ ok: true, message: 'ok' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = await mountWithRows()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-disable"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalled()
    expect(toggle).toHaveBeenCalledWith('src-1', true)
  })

  it('取消确认就不发请求', async () => {
    const toggle = vi.spyOn(sourceApi, 'changeSourceEnable').mockResolvedValue({ ok: true, message: 'ok' })
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
    color: 'orange',
  }

  it('筛选区和表格带标签 / 颜色标识列', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [marked] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    expect(wrapper.find('[data-testid="source-overview-tag"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-overview-color"]').exists()).toBe(true)
    expect(wrapper.findAll('th').map((th) => th.text())).toContain('标签')
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('日期错误待重跑')
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('+1')
  })

  it('标签筛选是输入框，查询时带 #tags；颜色筛选带旧 flag 下标', async () => {
    const page = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [marked] })
    const wrapper = shallowMount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    await wrapper.get('[data-testid="source-overview-tag"]').setValue('内容重复')
    await wrapper.get('[data-testid="source-overview-search"]').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ tags: ['#内容重复'] }))
    await wrapper.get('[data-testid="source-overview-color"]').trigger('click')
    expect(wrapper.get('[data-testid="source-overview-color-red"] .sov-mark-dot').attributes('style')).toMatch(/#ef4444|rgb\(239, 68, 68\)/)
    await wrapper.get('[data-testid="source-overview-color-red"]').trigger('click')
    await flushPromises()
    expect(page).toHaveBeenLastCalledWith(expect.objectContaining({ flag: 1 }))
  })

  it('勾选后打开添加标记浮层，保存调用 tagSource，行上立刻出现标签', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source }] })
    const tag = vi.spyOn(sourceApi, 'tagSource').mockResolvedValue({ ok: true, message: 'ok' })
    vi.spyOn(sourceApi, 'setColor').mockResolvedValue({ ok: true, message: 'ok' })
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
    expect((wrapper.get('[data-testid="source-overview-tag"]').element as HTMLInputElement).value).toBe('正文缺失')
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
    expect(wrapper.get('[data-testid="mark-action-clear-tags"]').text()).toBe('移除标签')
    expect(wrapper.get('[data-testid="mark-action-clear-color"]').text()).toBe('清除颜色标识')
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

  it('清除颜色标识不弹确认，直接 setColor', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, color: 'blue' }] })
    const setColor = vi.spyOn(sourceApi, 'setColor').mockResolvedValue({ ok: true, message: 'ok' })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-color"]').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(setColor).toHaveBeenCalledWith(['src-1'], undefined, true)
    expect(wrapper.get('[data-testid="source-mark-toast"]').text()).toContain('已清除 1 个源的颜色标识')
    wrapper.unmount()
  })

  it('清除颜色失败时不改行上圆点', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, color: 'blue' }] })
    vi.spyOn(sourceApi, 'setColor').mockRejectedValue(new Error('请求失败 500'))
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' }, attachTo: document.body })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-mark"]').trigger('click')
    await wrapper.get('[data-testid="mark-action-clear-color"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.sov-mark-dot').exists()).toBe(true)
    expect(wrapper.find('[data-testid="source-mark-toast"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('发起抓取不会清掉刚打上的标签', async () => {
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [{ ...source, tags: ['正文缺失'] }] })
    vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: '已下发' })
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mount(SourceOverviewView, { props: { currentSiteId: 'site-current' } })
    await flushPromises()
    await wrapper.get('[data-testid="source-check-src-1"]').setValue(true)
    await wrapper.get('[data-testid="batch-snatch"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="source-issue-tags"]').text()).toContain('正文缺失')
    wrapper.unmount()
  })
})
